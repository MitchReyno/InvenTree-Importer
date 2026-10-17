"""
Where an import's facts came from, and what it did with them.

    from invimport.provenance import fact_value

    fact_value(line, "parameters.Resistance", PART)       # '4k7'

An import file may give each entry a `provenance` list: one row per source -
a datasheet and its pages, a snapshot, a photo, something the user said - and
the facts that source supports. This module reads those rows against the
lines, and (see compile_import) joins them with what a run wrote to the
server, record by record, into the JSON kept with each record and with the
import.

Nothing here touches InvenTree.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .inventree.ledger import file_facts
from .stockfile import StockFile, StockLine

# Which of a line's row groups a row came from. A fact names a field of that
# entry: `notes` on a part row is the part's notes, on a line row the stock's.
PART = "part"
MANUFACTURER_PART = "manufacturer part"
LINE = "line"


def row_groups(line: StockLine) -> list[tuple[str, list[dict[str, Any]]]]:
    """The line's provenance rows, by the entry they are on."""
    return [(PART, line.part_provenance),
            (MANUFACTURER_PART, line.manufacturer_part_provenance),
            (LINE, line.provenance)]


def fact_value(line: StockLine, name: str, group: str = LINE) -> Any:
    """
    The value a fact names, as the file gives it: '' when it is not set.

    `group` matters only where one name means two fields: `notes` and, in a
    version 2 file, `link` (the part's page on a part row, the seller's
    listing on a line row).
    """
    root, _, rest = name.partition(".")
    if root == "parameters":
        return line.parameters.get(rest, "") if rest else line.parameters
    if root == "order":
        return line.order.get(rest, "") if rest else line.order
    if root == "notes":
        notes = {PART: line.part_notes,
                 MANUFACTURER_PART: line.manufacturer_part_notes}.get(
                     group, line.notes)
        if rest:
            return notes.get(rest, "") if isinstance(notes, dict) else ""
        return notes
    if root == "link" and group == LINE and line.part_ref:
        return line.supplier_link
    if root == "attachments":
        return [path for path, _ in line.attachments]
    value = getattr(line, root, "")
    return "" if value is None else value


# --------------------------------------------------------------------------
# What a run did, record by record
# --------------------------------------------------------------------------
FORMAT = "invimport-provenance/1"
PROVENANCE_SUFFIX = ".provenance.json"
RECORD_PREFIX = "provenance-"
RECORD_COMMENT = "Import provenance"
DIGEST_LENGTH = 12

# The records InvenTree can attach a file to, and what each line names.
ATTACHABLE = ("part", "manufacturerpart", "supplierpart", "stockitem",
              "purchaseorder", "company")
_ACTION_FIELDS = {"part": "part", "manufacturerpart": "manufacturer_part",
                  "supplierpart": "supplier_part", "stockitem": "stock_item",
                  "purchaseorder": "purchase_order", "company": "supplier"}

# Who owns a line field, for routing a version 1 line's facts (and a
# version 2 line's stock facts) to the record they describe.
_SUPPLIER_PART_FIELDS = {"supplier", "sku", "unit_price", "currency"}
_PART_FIELDS = {"category", "name", "description", "type", "ipn",
                "parameters", "datasheet", "datasheet_pages", "image",
                "images", "attachments"}


def fact_owners(field: str, group: str, version_2_line: bool) -> list[str]:
    """The record(s) a fact on this kind of row is about."""
    root = field.partition(".")[0]
    if group == PART:
        return ["part"]
    if group == MANUFACTURER_PART:
        return ["manufacturerpart"]
    if root == "order":
        return ["purchaseorder"]
    if root in _SUPPLIER_PART_FIELDS:
        return ["supplierpart"]
    if root == "link":
        # A version 1 line's link was the part's page and the seller's both.
        return ["supplierpart"] if version_2_line else ["part",
                                                        "supplierpart"]
    if not version_2_line:
        if root in _PART_FIELDS:
            return ["part"]
        if root in ("manufacturer", "mpn"):
            return ["manufacturerpart"]
    return ["stockitem"]


def _claim_owner(group: str) -> str:
    return {PART: "part", MANUFACTURER_PART: "manufacturerpart"}.get(
        group, "stockitem")


def _entry(line: StockLine, group: str) -> dict[str, str]:
    if group == PART and line.part_ref:
        return {"kind": "part", "id": line.part_ref}
    if group == MANUFACTURER_PART:
        return {"kind": "manufacturer part", "id": line.manufacturer_part_ref}
    return {"kind": "line", "id": line.id}


def _row_for(row: dict[str, Any], facts: list[dict[str, Any]],
             entry: dict[str, str]) -> dict[str, Any]:
    out = {k: v for k, v in row.items() if k != "facts"}
    out["on"] = entry
    out["facts"] = facts
    return out


def _with_value(fact: dict[str, Any], line: StockLine,
                group: str) -> dict[str, Any]:
    if "field" not in fact:
        return dict(fact)
    return {"field": fact["field"],
            "value": fact_value(line, fact["field"], group),
            **({"note": fact["note"]} if fact.get("note") else {})}


def _values(model: str, line: StockLine) -> dict[str, Any]:
    """What the file said about this record, as given."""
    v1 = not line.part_ref
    picks = {
        "part": ["category", "name", "ipn", "description", "type",
                 "parameters", "datasheet", "datasheet_pages", "images"]
        + (["link"] if v1 else []),
        "manufacturerpart": ["manufacturer", "mpn"],
        "supplierpart": ["supplier", "sku", "unit_price", "currency"],
        "stockitem": ["quantity", "approximate", "condition", "location",
                      "batch", "packaging", "tags", "stock_images"],
        "purchaseorder": ["order"],
        "company": [],
    }[model]
    values = {name: fact_value(line, name) for name in picks}
    if model == "supplierpart":
        values["link"] = line.supplier_link or line.link
    if model == "part":
        values["attachments"] = [path for path, _ in line.attachments]
    return {k: v for k, v in values.items() if v not in ("", None, [], {})}


def _file_entry(base: Path | None, text: str) -> dict[str, Any]:
    """A local file named by the import, with its digest when it exists."""
    path = Path(text)
    if base is not None and not path.is_absolute():
        path = base / path
    facts = file_facts(path) if path.is_file() else {}
    facts.pop("file", None)
    return {"path": text, **facts}


def load_sources_map(document: StockFile) -> dict[str, list[str]]:
    """<import>.sources.json: which photos each line was read from."""
    if document.path is None:
        return {}
    path = document.path.with_suffix(".sources.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {str(k): [str(p) for p in v] for k, v in data.items()
            if isinstance(v, list)} if isinstance(data, dict) else {}


def import_header(document: StockFile, *, run: str = "",
                  version: str = "") -> dict[str, Any]:
    folder = document.path.parent.name if document.path else ""
    header = {
        "id": document.file_id,
        "reference": str((document.source or {}).get("reference") or ""),
        "file": document.path.name if document.path else "",
        "folder": folder,
        "source": dict(document.source or {}),
        "run": run,
        "invimport": version,
    }
    return {k: v for k, v in header.items() if v not in ("", {}, None)}


def _event_dict(event, templates: dict[int, str]) -> dict[str, Any]:
    out = event.as_dict()
    if "template" in out and out["template"] in templates:
        out["parameter"] = templates[out.pop("template")]
    return out


def compile_records(document: StockFile, actions, book, *,
                    templates: dict[int, str] | None = None,
                    logos=(), run: str = "", version: str = ""
                    ) -> dict[tuple[str, int], dict[str, Any]]:
    """
    One provenance document per record this run created or changed.

    `actions` are the run's LineActions, `book` its ledger. A record the run
    did not touch gets nothing: a re-run that changes nothing leaves no new
    file on anything.
    """
    templates = templates or {}
    lines = {line.id: line for line in document.lines}
    base = document.path.parent if document.path else None
    photos = load_sources_map(document)
    events = book.records()
    header = import_header(document, run=run, version=version)

    # Companies a line names by pk: its supplier, and the maker of a
    # manufacturer part this run created.
    makers: dict[int, int] = {}
    for (model, pk), evs in events.items():
        if model == "manufacturerpart":
            for event in evs:
                if event.what == "created" and event.detail.get(
                        "manufacturer") is not None:
                    makers[pk] = int(event.detail["manufacturer"])
    logo_pk = {logo.name: logo.pk for logo in logos if logo.pk}

    docs: dict[tuple[str, int], dict[str, Any]] = {}
    for (model, pk), evs in events.items():
        if model not in ATTACHABLE:
            continue
        related = []
        for action in actions:
            if action.id not in lines:
                continue
            ids = {m: getattr(action, f) for m, f in _ACTION_FIELDS.items()}
            if action.manufacturer_part in makers:
                ids.setdefault("maker", makers[action.manufacturer_part])
            if ids.get(model) == pk or (model == "company"
                                        and ids.get("maker") == pk):
                related.append((action, lines[action.id]))

        rows: list[dict[str, Any]] = []
        seen: set[int] = set()
        for _action, line in related:
            for group, group_rows in row_groups(line):
                for row in group_rows:
                    if id(row) in seen:
                        continue
                    facts = [
                        _with_value(f, line, group) for f in row["facts"]
                        if (model in fact_owners(f["field"], group,
                                                 bool(line.part_ref))
                            if "field" in f else
                            model == _claim_owner(group))]
                    if facts:
                        seen.add(id(row))
                        rows.append(_row_for(row, facts,
                                             _entry(line, group)))
        if model == "company":
            for name, company in document.companies.items():
                if logo_pk.get(name) == pk:
                    for row in company.get("provenance") or []:
                        rows.append(_row_for(row, [dict(f) for f in
                                                   row["facts"]],
                                             {"kind": "company", "id": name}))

        first = related[0][1] if related else None
        linked: dict[str, list[int]] = {}
        for action, _ in related:
            for other, attr in _ACTION_FIELDS.items():
                value = getattr(action, attr)
                if other != model and isinstance(value, int) and value > 0:
                    linked.setdefault(other, [])
                    if value not in linked[other]:
                        linked[other].append(value)

        doc = {
            "format": FORMAT,
            "record": {"model": model, "pk": pk},
            "import": header,
            "lines": [action.id for action, _ in related],
            "entries": sorted({ref for _, line in related
                               for ref in (line.part_ref,
                                           line.manufacturer_part_ref)
                               if ref}),
            "changes": [_event_dict(e, templates) for e in evs],
            "values": _values(model, first) if first else {},
            "provenance": rows,
            "source_photos": [
                _file_entry(base, p) for action, _ in related
                for p in photos.get(action.id, [])],
            "related": linked,
        }
        docs[(model, pk)] = {k: v for k, v in doc.items()
                             if v not in ([], {}) or k in ("provenance",)}
    return docs


def file_rows(document: StockFile) -> list[dict[str, Any]]:
    """Every source row in the file once, with the entry it is on."""
    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    shared = {id(row) for row in document.provenance}
    for row in document.provenance:
        seen.add(id(row))
        rows.append(_row_for(row, [dict(f) for f in row["facts"]],
                             {"kind": "file"}))
    for line in document.lines:
        for group, group_rows in row_groups(line):
            for row in group_rows:
                if id(row) in seen or id(row) in shared:
                    continue
                seen.add(id(row))
                rows.append(_row_for(
                    row, [_with_value(f, line, group) for f in row["facts"]],
                    _entry(line, group)))
    for name, company in document.companies.items():
        for row in company.get("provenance") or []:
            rows.append(_row_for(row, [dict(f) for f in row["facts"]],
                                 {"kind": "company", "id": name}))
    return rows


def combined_path(folder: Path, document: StockFile) -> Path:
    stem = document.path.stem if document.path else folder.name
    return folder / f"{stem}{PROVENANCE_SUFFIX}"


def write_combined(path: Path, document: StockFile, actions, book,
                   records: dict[tuple[str, int], dict[str, Any]], *,
                   templates: dict[int, str] | None = None, run: str = "",
                   version: str = "") -> Path:
    """
    Add this run to the import's combined provenance file, creating it.

    Earlier runs are kept: each is what that run did. The file's own rows
    are rewritten from the file as it is now.
    """
    templates = templates or {}
    runs: list[Any] = []
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(previous, dict) and previous.get("format") == FORMAT:
            runs = list(previous.get("runs") or [])
    except (OSError, ValueError):
        pass
    runs.append({
        "run": run,
        "invimport": version,
        "lines": [_action_dict(action) for action in actions],
        "records": [{k: v for k, v in doc.items()
                     if k not in ("format", "import")}
                    for doc in records.values()],
        "events": [{"model": e.model, "pk": e.pk, **_event_dict(e, templates)}
                   for e in book.events],
    })
    combined = {
        "format": FORMAT,
        "import": import_header(document),
        "sources_map": load_sources_map(document),
        "provenance": file_rows(document),
        "runs": runs,
    }
    path.write_text(json.dumps(combined, indent=2, ensure_ascii=False,
                               default=str) + "\n", encoding="utf-8")
    return path


def _action_dict(action) -> dict[str, Any]:
    out = {"id": action.id, "action": action.action}
    for name in ("reason", "ipn", "name", "category", "location",
                 *_ACTION_FIELDS.values()):
        value = getattr(action, name, None)
        if value not in (None, "", -1):
            out[name] = value
    return out


def record_file(directory: Path, document: StockFile,
                doc: dict[str, Any]) -> Path:
    """Write one record's document under a name unique to its content."""
    text = json.dumps(doc, indent=2, ensure_ascii=False, default=str) + "\n"
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:DIGEST_LENGTH]
    name = (document.path.parent.name if document.path else "import")
    path = directory / f"{RECORD_PREFIX}{name}-{doc['record']['model']}-" \
                       f"{doc['record']['pk']}-{digest}.json"
    path.write_text(text, encoding="utf-8")
    return path


def logo_records(path: Path, companies: dict[str, dict[str, Any]], actions,
                 book, *, run: str = "", version: str = ""
                 ) -> dict[tuple[str, int], dict[str, Any]]:
    """
    One document per company `invimport company-logos` gave a logo: what it
    set, from which logos file, and the rows saying where the logo came from.
    """
    events = book.records()
    docs: dict[tuple[str, int], dict[str, Any]] = {}
    for action in actions:
        key = ("company", action.pk)
        if action.pk is None or key not in events:
            continue
        rows = [_row_for(row, [dict(f) for f in row["facts"]],
                         {"kind": "company", "id": action.name})
                for row in companies.get(action.name, {}).get("provenance")
                or []]
        docs[key] = {
            "format": FORMAT,
            "record": {"model": "company", "pk": action.pk},
            "import": {k: v for k, v in {
                "file": path.name, "folder": path.parent.name, "run": run,
                "invimport": version}.items() if v},
            "changes": [_event_dict(e, {}) for e in events[key]],
            "values": {"name": action.company,
                       "image": _file_entry(path.parent, action.image)},
            "provenance": rows,
        }
    return docs
