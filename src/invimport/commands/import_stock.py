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

Creating the records is phases 4-6 of the proposal and is not built yet; this
command reads, checks and reports.
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
from ..validate import validate

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
                        help="apply (not implemented yet - phases 4-6)")


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
                "properties": {"reference": {"type": "string"},
                               "date": {"type": "string"}},
            },
            "location": {"type": "string",
                         "description": "Stock location path; created if it "
                                        "does not exist."},
            "notes": {"type": "string"},
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
                "description": "Merged into every line; a line always wins.",
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

    if args.write:
        print("ERROR: --write is not implemented yet. Creating the records is "
              "phases 4-6 of PROPOSAL-stock-import.md; this command currently "
              "reads, checks and reports.", file=sys.stderr)
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

    for document, report in reports:
        report_file(document, report)

    problems = sum(len(report.problems) for _, report in reports)
    warnings = sum(len(report.warnings) for _, report in reports)
    total = sum(len(doc.lines) for doc, _ in reports)
    print(f"\n{total} line(s), {problems} error(s), {warnings} warning(s).")
    if problems:
        print("Fix the errors, or re-run with --validate for machine-readable "
              "output.")
        return 1
    print("Nothing written - creating the records is not implemented yet "
          "(phases 4-6).")
    return 0
