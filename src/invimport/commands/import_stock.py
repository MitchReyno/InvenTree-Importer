"""
Import stock from a data file, for everything DigiKey cannot tell us about.

    invimport import-stock stock.json            # read, check, report
    invimport import-stock stock.json --validate # check only, machine-readable
    invimport import-stock --schema              # the input format, as JSON Schema
    invimport import-stock --vocabulary          # the category and parameter names

JSON, YAML or CSV; see PROPOSAL-stock-import.md for the shape and the reasoning.

`--vocabulary` is the important one for generating a file with an LLM. It emits
the category paths, parameter names, units and choices *from this config*, so an
agent handed a photo produces values that land in the schema rather than near
it. Pair it with `--validate`, whose errors carry `did_you_mean`, and an agent
can iterate to a clean file without touching InvenTree at all.

`--write` creates the records: parts, manufacturer and supplier parts, purchase
orders and stock. Re-running the same file is a no-op - each stock item carries
a barcode naming the line that made it, and InvenTree refuses to assign one
twice.

Anything ambiguous stops and asks, with the same interactive prompts the other
commands use: an unknown category offers close matches before creating one, and
a partly-specified part offers the parts that match what was given. Neither is
guessed, because InvenTree has no part merge and both mistakes are cleaned up
by hand.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from ..config import load_categories_config, load_parameters_config
from ..stockfile import (
    CONDITIONS,
    LINE_KEYS,
    SUPPORTED_VERSIONS,
    StockFileError,
    read_file,
)
from ..inventree.api import connect
from ..inventree.stockimport import (
    CREATED,
    EXISTS,
    REVIEW,
    SKIPPED,
    ImportOptions,
    import_stock,
)
from ..validate import category_candidates, validate
from . import _prompt

NAME = "import-stock"
HELP = "import stock from a JSON/YAML/CSV file"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("files", nargs="*", type=Path, metavar="FILE",
                        help="stock files to read (.json, .yaml, .csv)")
    parser.add_argument("--config", type=Path, default=None, metavar="DIR",
                        help="config directory (default: config/ at the repo "
                             "root)")
    parser.add_argument("--validate", action="store_true",
                        help="check only, and report as JSON for an agent to "
                             "act on")
    parser.add_argument("--schema", action="store_true",
                        help="print the input format as JSON Schema and exit")
    parser.add_argument("--vocabulary", action="store_true",
                        help="print the categories, parameters and units this "
                             "config defines, for generating a file")
    parser.add_argument("--write", action="store_true",
                        help="create the records (default is a dry run)")
    parser.add_argument("--location", metavar="PATH",
                        help="where stock with no location of its own goes")
    parser.add_argument("--on-partial", choices=("ask", "new", "skip"),
                        default="ask",
                        help="a part whose key parameters are only partly "
                             "given (default: ask)")
    parser.add_argument("--min-confidence", type=float, default=0.0,
                        metavar="N",
                        help="hold any line the file rates below this, 0-1")
    parser.add_argument("--no-orders", action="store_true",
                        help="import the stock without creating purchase "
                             "orders for it")
    parser.add_argument("--yes", action="store_true",
                        help="do not prompt; report anything ambiguous "
                             "instead")


# --------------------------------------------------------------------------
# Describing the format
# --------------------------------------------------------------------------
def schema() -> dict[str, Any]:
    """JSON Schema for a stock file. Generated, so it cannot drift."""
    line = {
        "type": "object",
        "required": ["id", "quantity", "category"],
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string", "minLength": 1,
                   "description": "Stable and unique within the file. Part of "
                                  "the key that makes a re-import a no-op."},
            "quantity": {"type": "number", "exclusiveMinimum": 0},
            "approximate": {"type": "boolean",
                            "description": "The quantity is an estimate."},
            "condition": {"enum": list(CONDITIONS), "default": "ok"},
            "category": {"type": "string",
                         "description": "InvenTree category path, e.g. "
                                        "'Resistors/Through Hole Resistors'. "
                                        "See --vocabulary."},
            "suggest_category": {
                "type": "object", "additionalProperties": False,
                "description": "Only when the category does not exist yet; the "
                               "import prompts before creating it.",
                "properties": {
                    "identity": {"enum": ["spec", "mpn", "type"]},
                    "ipn_prefix": {"type": "string"},
                    "description": {"type": "string"},
                    "because": {"type": "string",
                                "description": "Shown to whoever confirms. "
                                               "Never stored."},
                },
            },
            "description": {"type": "string"},
            "type": {"type": "string",
                     "description": "Type designator such as 1N4007 or "
                                    "XR-2206, when there is no MPN."},
            "mpn": {"type": "string"},
            "ipn": {"type": "string",
                    "description": "Explicit existing part; skips matching."},
            "manufacturer": {"type": "string"},
            "parameters": {
                "type": "object", "additionalProperties": {"type": "string"},
                "description": "Parameter name to value. See --vocabulary.",
            },
            "supplier": {"type": "string"},
            "sku": {"type": "string"},
            "unit_price": {"type": "number",
                           "description": "Ex-tax, per piece."},
            "currency": {"type": "string"},
            "order": {
                "type": "object", "additionalProperties": False,
                "description": "The purchase order this line was bought on. "
                               "Lines sharing a supplier and a reference "
                               "share one order.",
                "properties": {
                    "reference": {
                        "type": "string",
                        "description": "The seller's own invoice or order "
                                       "number. Stored as supplier_reference "
                                       "and used to recognise an order "
                                       "already imported. Without it no "
                                       "order is created."},
                    "date": {
                        "type": "string", "format": "date",
                        "description": "When it was ordered, YYYY-MM-DD. "
                                       "Stored as the order's start_date - "
                                       "InvenTree's creation_date is "
                                       "read-only and always the day the "
                                       "record was written."},
                    "target_date": {
                        "type": "string", "format": "date",
                        "description": "Expected delivery, YYYY-MM-DD."},
                    "description": {
                        "type": "string",
                        "description": "Defaults to 'Imported order X'."},
                    "link": {"type": "string", "format": "uri",
                             "description": "Order or invoice page."},
                    "notes": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "invoice": {
                        "type": "string",
                        "description": "Invoice or receipt scan to attach to "
                                       "the order: a path relative to this "
                                       "file, or an absolute one. Uploaded "
                                       "once; re-importing will not attach a "
                                       "second copy."},
                },
            },
            "location": {"type": "string",
                         "description": "Stock location path; created if it "
                                        "does not exist."},
            "notes": {"type": "string"},
            "tags": {
                "type": "array", "items": {"type": "string"},
                "description": "Labels for the stock item, not the part. New "
                               "old stock is [\"NOS\", \"new old stock\"]; "
                               "use both spellings so either search finds it. "
                               "A comma-separated string in CSV.",
            },
            "batch": {"type": "string",
                      "description": "Lot or date code for this quantity, "
                                     "e.g. 8231 for week 31 of 1982. Stored "
                                     "on the stock item."},
            "link": {"type": "string", "format": "uri",
                     "description": "Product or listing page. Stored on the "
                                    "Part (if there is no datasheet) and on "
                                    "the SupplierPart."},
            "datasheet": {"type": "string", "format": "uri",
                          "description": "Datasheet URL. Stored on the Part "
                                         "and on the ManufacturerPart."},
            "image": {"type": "string",
                      "description": "Product photo: an http(s) URL, or a "
                                     "path relative to this file. Becomes "
                                     "the Part's image when it has none."},
            "images": {"type": "array", "items": {"type": "string"},
                       "description": "Additional photos; the first "
                                      "resolvable one is used if image is "
                                      "absent."},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1,
                           "description": "Agent hint. Never stored."},
            "needs_review": {"type": "boolean",
                             "description": "Agent hint. Never stored."},
        },
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "invimport stock file",
        "type": "object",
        "required": ["lines"],
        "additionalProperties": False,
        "properties": {
            "version": {"enum": list(SUPPORTED_VERSIONS), "default": 1},
            "source": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "kind": {"type": "string"},
                    "reference": {"type": "string",
                                  "description": "Names the file; keeps the "
                                                 "import key stable if it is "
                                                 "regenerated."},
                    "captured": {"type": "string"},
                    "agent": {"type": "string"},
                },
            },
            "defaults": {
                "type": "object",
                "description": "Merged into every line; a line always wins, except tags and order, which merge.",
            },
            "lines": {"type": "array", "items": line},
        },
    }


def vocabulary(directory: Path | None) -> dict[str, Any]:
    """
    The controlled vocabulary, generated from the config.

    This is what an agent needs and cannot guess: that the category is
    'Resistors/Through Hole Resistors', that the parameter is 'Power Rating'
    and not 'Wattage', that Composition is one of a fixed set.
    """
    categories = load_categories_config(directory)
    parameters = load_parameters_config(directory)

    return {
        "categories": [
            {
                "path": category.pathstring,
                "identity": category.identity,
                "ipn_prefix": category.ipn_prefix,
                "key_parameters": category.key_parameters,
                "parameters": category.parameters,
            }
            for category in categories.values() if not category.structural
        ],
        "parameters": [
            {
                "name": parameter.name,
                **({"units": parameter.units} if parameter.units else {}),
                **({"choices": parameter.choices} if parameter.choices else {}),
                **({"description": parameter.description}
                   if parameter.description else {}),
                **({"also_accepts": parameter.aliases}
                   if parameter.aliases else {}),
            }
            for parameter in parameters.values()
        ],
        "conditions": list(CONDITIONS),
        "line_fields": sorted(LINE_KEYS),
        "notes": [
            "Use a category path exactly as listed; the importer will offer "
            "close matches for anything else.",
            "A parameter value is written as the supplier writes it - "
            "'4.7 kohm', '±1%', '0.25 W'. Units are parsed, not assumed.",
            "A category with identity 'spec' is matched on its "
            "key_parameters; supply all of them or the import will stop and "
            "ask.",
            "Every line needs a stable, unique id.",
            "link and datasheet must be URLs (https://...). image may be a "
            "URL or a path relative to the stock file.",
            "Once a part is identified, look up its datasheet URL, one "
            "product image, and every remaining parameter this category "
            "lists. Copy what you opened; do not invent a typical part.",
        ],
    }


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------
def report_file(document, report, resolved_preview: bool = True) -> None:
    name = document.path.name if document.path else "(input)"
    print(f"\n{name}: {len(document.lines)} line(s), file id {document.file_id}")

    for line in document.lines:
        flags = []
        if line.approximate:
            flags.append("approx")
        if line.condition != "ok":
            flags.append(line.condition)
        if line.needs_review:
            flags.append("needs review")
        if line.confidence is not None:
            flags.append(f"confidence {line.confidence:.0%}")
        suffix = f"   [{', '.join(flags)}]" if flags else ""
        identity = line.mpn or line.type or line.sku or line.ipn or "-"
        print(f"  {line.id:<10} {line.quantity:>8g}  {line.category:<42} "
              f"{identity}{suffix}")
        if resolved_preview and report.resolved.get(line.id):
            values = report.resolved[line.id]
            print(f"             {', '.join(f'{k}={v}' for k, v in values.items())}")

    if report.problems or report.warnings:
        print()
        print(report.text())


# --------------------------------------------------------------------------
# Prompts
# --------------------------------------------------------------------------
def ask_category(line, near: list[str]):
    """
    An unknown category. Existing matches first, then create, then skip.

    Leading with what already exists is the point: inventing
    'Resistors/SMD' when 'Resistors/Surface Mount Resistors' is right there is
    the failure this is here to prevent.
    """
    title = f"  line {line.id}: category {line.category!r} is not in the config"
    if line.description:
        title += f"\n    {line.description}"
    because = (line.suggest_category or {}).get("because")
    if because:
        title += f"\n    the file says: {because}"

    options = [(path, f"use {path}") for path in near]
    options.append((line.category, f"create {line.category}"))
    options.append((None, "skip this line"))
    picked = _prompt.choose_one(options, lambda o: o[1], title=title,
                                prompt="  category > ")
    return None if picked is None else picked[0]


def ask_part(line, offered: list[Any]):
    """
    A partial specification: which existing part, or a new one.

    Offered parts agree with every value the line gave and say nothing about
    the ones it did not - which is exactly why a human picks.
    """
    title = (f"  line {line.id}: {line.description or line.category} gives "
             f"only part of its specification")
    if line.parameters:
        title += ("\n    given: "
                  + ", ".join(f"{k}={v}" for k, v in line.parameters.items()))

    options = [(part, f"{getattr(part, 'IPN', '?')}  "
                      f"{getattr(part, 'name', '')}") for part in offered]
    options.append((None, "create a new part"))
    picked = _prompt.choose_one(options, lambda o: o[1], title=title,
                                prompt="  part > ")
    return None if picked is None else picked[0]


def ask_company(kind: str):
    """A chooser for an unmatched manufacturer or supplier name."""
    def choose(name: str, offered: list[tuple[Any, float]]):
        options = [(company, f"{company.name}  ({score:.0%} match)")
                   for company, score in offered]
        options.append((name, f"create {kind} {name!r}"))
        options.append((None, "skip"))
        picked = _prompt.choose_one(
            options, lambda o: o[1],
            title=f"  {kind} {name!r} is not on the server",
            prompt=f"  {kind} > ")
        return None if picked is None else picked[0]
    return choose


def report_actions(document, result, resolved=None) -> None:
    """
    One line per line: what it is, and what happened to it.

    The parsed parameter values are shown underneath because they are how a
    human checks a transcription - seeing '4k7' read back as '4.7 k' is the
    point at which a misreading becomes obvious.
    """
    resolved = resolved or {}
    name = document.path.name if document.path else "(input)"
    print(f"\n{name}: {len(result.lines)} line(s), file id {document.file_id}")
    for action in result.lines:
        mark = {CREATED: "+", EXISTS: "=", SKIPPED: "-", REVIEW: "?"}.get(
            action.action, " ")
        print(f"  {mark} {action.id:<8} {action.quantity:>8g}  "
              f"{action.ipn or '-':<12} {action.name or action.category}")
        values = resolved.get(action.id)
        if values:
            print(f"      {', '.join(f'{k}={v}' for k, v in values.items())}")
        detail = []
        if action.location:
            detail.append(action.location)
        if action.supplier_part:
            detail.append(f"supplier part {action.supplier_part}")
        if action.purchase_order:
            detail.append(f"order {action.purchase_order}")
        if detail:
            print(f"      {'  '.join(detail)}")
        if action.reason:
            print(f"      {action.reason}")
        for candidate in action.candidates[:3]:
            shown = candidate if isinstance(candidate, str) else (
                f"{getattr(candidate, 'IPN', '')} "
                f"{getattr(candidate, 'name', '')}".strip())
            print(f"        -> {shown}")


def write_run(args: argparse.Namespace, reports: list[Any]) -> int:
    interactive = _prompt.interactive() and not args.yes
    options = ImportOptions(
        write=args.write,
        default_location=args.location or "",
        on_partial=args.on_partial,
        min_confidence=args.min_confidence,
        create_orders=not args.no_orders,
        choose_category=ask_category if interactive else None,
        choose_part=ask_part if interactive else None,
        choose_manufacturer=ask_company("manufacturer") if interactive else None,
        choose_supplier=ask_company("supplier") if interactive else None,
    )

    api = connect()
    totals = {"created": 0, "exists": 0, "skipped": 0, "review": 0}
    for document, report in reports:
        result = import_stock(document, api, directory=args.config,
                              options=options)
        report_actions(document, result, report.resolved)
        for key in totals:
            totals[key] += result.counts()[key]

    print(f"\n{totals['created']} created, {totals['exists']} already there, "
          f"{totals['skipped']} skipped, {totals['review']} need review.")
    if not args.write:
        print("Dry run - nothing was written. Re-run with --write to apply.")
    if totals["review"]:
        print("Lines needing review were left alone; run interactively to "
              "settle them.")
    return 1 if totals["skipped"] or totals["review"] else 0


def run(args: argparse.Namespace) -> int:
    if args.schema:
        print(json.dumps(schema(), indent=2))
        return 0

    if args.vocabulary:
        print(json.dumps(vocabulary(args.config), indent=2))
        return 0

    if not args.files:
        print("ERROR: name a file to import, or use --schema / --vocabulary",
              file=sys.stderr)
        return 2

    categories = load_categories_config(args.config)
    parameters = load_parameters_config(args.config)

    documents = []
    failures: list[str] = []
    for path in args.files:
        try:
            documents.append(read_file(path))
        except StockFileError as exc:
            failures.append(str(exc))

    if failures:
        if args.validate:
            print(json.dumps({"ok": False, "unreadable": failures}, indent=2))
        else:
            for failure in failures:
                print(f"ERROR {failure}", file=sys.stderr)
        return 1

    reports = [(doc, validate(doc, categories, parameters))
               for doc in documents]

    if args.validate:
        payload = {
            "ok": all(report.ok for _, report in reports),
            "files": [
                {"file": str(doc.path) if doc.path else "", **report.as_dict()}
                for doc, report in reports
            ],
        }
        print(json.dumps(payload, indent=2))
        return 0 if payload["ok"] else 1

    problems = sum(len(report.problems) for _, report in reports)
    warnings = sum(len(report.warnings) for _, report in reports)
    total = sum(len(doc.lines) for doc, _ in reports)

    if problems:
        for document, report in reports:
            report_file(document, report)
        print(f"\n{total} line(s), {problems} error(s), {warnings} warning(s).")
        print("Fix the errors, or re-run with --validate for machine-readable "
              "output.")
        return 1

    if warnings:
        for _, report in reports:
            for warning in report.warnings:
                print(f"  warn  {warning.describe()}")

    return write_run(args, reports)
