"""
Read a stock import file into lines the importer can act on.

    from invimport.stockfile import read_file

    doc = read_file(Path("stock.json"))
    for line in doc.lines:
        print(line.id, line.quantity, line.category)

Three formats, one shape. JSON is canonical because a line's parameters are a
variable-width map and its order is a nested object. YAML is the same shape,
easier to hand-edit. CSV is the flat subset a spreadsheet exports, with dotted
columns (`param.Resistance`, `order.reference`) folded back into the nesting.

Nothing here touches InvenTree or the config. This module answers "is this file
well-formed?"; whether the categories and parameters it names actually exist is
a separate question, asked by validate.py, which needs the config to answer it.

The one rule enforced here that is not merely structural: every line needs a
stable, unique `id`. It becomes part of the barcode that makes a re-import a
no-op, so a file that cannot supply one cannot be safely re-run.
"""

from __future__ import annotations

import csv
import hashlib
import dataclasses
import io
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from . import notes
from .util import absolute_url, parse_pages

# What a line may say. Anything else is a mistake worth reporting rather than
# ignoring - a misspelled key is otherwise indistinguishable from an omission.
LINE_KEYS = {
    "id", "quantity", "approximate", "condition",
    "category", "suggest_category", "name", "description", "type", "mpn",
    "ipn",
    "manufacturer", "parameters",
    "supplier", "sku", "unit_price", "currency", "order",
    "location", "notes", "tags", "batch", "packaging",
    "link", "datasheet", "datasheet_pages", "image", "images",
    "stock_images", "attachments", "part_of",
    "confidence", "needs_review",
}
ORDER_KEYS = {"reference", "date", "target_date", "description",
              "link", "notes", "tags", "invoice"}

# order fields that must look like a date. InvenTree rejects anything else,
# and a server-side rejection is a worse error than one that names the line.
ORDER_DATES = ("date", "target_date")
SOURCE_KEYS = {"kind", "reference", "captured", "agent"}
SUGGEST_KEYS = {"identity", "ipn_prefix", "description", "because"}

# Defaults may set anything a line may set, except what identifies the line or
# the part it names. A file-wide "mpn" would be nonsense.
DEFAULTABLE = {"supplier", "currency", "location", "order", "condition",
               "category", "notes", "tags", "batch", "packaging"}

CONDITIONS = ("ok", "unopened", "attention", "damaged", "quarantined")

SUPPORTED_VERSIONS = (1, 2)

# Version 2 lifts what is true of a part out of the lines, so a part bought in
# six lots is described once rather than six times. A part names the
# Part; a manufacturer part names one maker's number for it; a line is only
# the quantity on hand, and points at one of the other two.
PART_KEYS = {
    "id", "category", "suggest_category", "name", "description", "type",
    "ipn",
    "parameters", "link", "datasheet", "datasheet_pages", "image", "images",
    "attachments", "notes",
}
MANUFACTURER_PART_KEYS = {"id", "part", "manufacturer", "mpn", "notes"}
V2_LINE_KEYS = {
    "id", "part", "manufacturer_part", "quantity", "approximate",
    "condition", "supplier", "sku", "unit_price", "currency", "order",
    "location", "notes", "tags", "batch", "packaging", "link",
    "stock_images", "confidence", "needs_review",
}
# In version 2 the category belongs to the part, so it is not a line default.
V2_DEFAULTABLE = {"supplier", "currency", "location", "order", "condition",
                  "notes", "tags", "batch", "packaging"}
# A version 2 line is expanded into the version 1 shape the importer runs on.
# These carry what that shape had no field for.
EXPANDED_KEYS = {"part_notes", "manufacturer_part_notes", "supplier_link",
                 "part_ref", "manufacturer_part_ref"}

# InvenTree's StockItem.packaging is a 50 character column. Longer is refused
# here, naming the line, rather than by the server mid-import.
PACKAGING_MAX = 50
# Part.name is 100.
NAME_MAX = 100

# New old stock is only as good as its packaging: a sealed tube is a claim
# about the parts inside that an opened bag cannot make. So an NOS line must
# say what it is held in and whether that is still sealed - 'Tube, sealed'.
NOS_TAGS = {"nos", "new old stock"}
SEAL_STATES = ("sealed", "unsealed", "resealed", "opened", "open",
               "partially opened", "damaged")

# A NATO Stock Number rides along as a tag, 'nsn:5961-00-123-4567', so stock
# can be found by the number printed on its surplus label. Thirteen digits,
# written 4-2-3-4 however the label spaced them.
NSN_PREFIX = "nsn:"
NSN_DIGITS = 13


class StockFileError(RuntimeError):
    """The file is not readable as a stock import. Says which line and why."""


@dataclass
class Problem:
    """One thing wrong with the file, addressed to whoever wrote it."""
    line: str = ""                               # entry id, or "" for the file
    # Named to match the JSON an agent reads back. `field` shadows
    # dataclasses.field inside this body, hence the qualified call below.
    field: str = ""
    problem: str = ""
    did_you_mean: list[str] = dataclasses.field(default_factory=list)
    # What `line` names: a line, or in a version 2 file a part or a
    # manufacturer part - so a mistake in a part is reported once, against
    # the part, rather than against every line that uses it.
    kind: str = "line"

    def describe(self) -> str:
        where = f"{self.kind} {self.line}" if self.line else "file"
        at = f" {self.field}:" if self.field else ""
        hint = (f" - did you mean {' or '.join(repr(s) for s in self.did_you_mean)}?"
                if self.did_you_mean else "")
        return f"{where}:{at} {self.problem}{hint}"

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"problem": self.problem}
        if self.line:
            out[self.kind.replace(" ", "_")] = self.line
        if self.field:
            out["field"] = self.field
        if self.did_you_mean:
            out["did_you_mean"] = self.did_you_mean
        return out


@dataclass
class StockLine:
    """One quantity of one part, as the file describes it."""
    id: str = ""
    quantity: float = 0
    approximate: bool = False
    condition: str = "ok"

    category: str = ""
    suggest_category: dict[str, Any] = field(default_factory=dict)
    # What a new part is called. Without it the name is generated: from the
    # category's template where it builds one from parameters, else the
    # designator, else the description.
    name: str = ""
    description: str = ""
    type: str = ""
    mpn: str = ""
    ipn: str = ""
    manufacturer: str = ""
    parameters: dict[str, str] = field(default_factory=dict)

    supplier: str = ""
    sku: str = ""
    unit_price: float | None = None
    currency: str = ""
    order: dict[str, Any] = field(default_factory=dict)

    location: str = ""
    # Text, or sections (see notes.STOCK_SECTIONS) rendered as Markdown.
    notes: str | dict[str, Any] = ""
    # Version 2 only: the notes of the part and of the manufacturer part this
    # line names, carried by the first line that names each so they are
    # written once.
    part_notes: str | dict[str, Any] = ""
    manufacturer_part_notes: str | dict[str, Any] = ""
    # Version 2 only: the seller's listing page, kept apart from the part's
    # own link, which a version 1 line used for both.
    supplier_link: str = ""
    # Version 2 only: the part and manufacturer part entries this line was
    # expanded from, for reporting.
    part_ref: str = ""
    manufacturer_part_ref: str = ""

    # Labels and the lot this quantity came out of. Both describe the stock
    # rather than the part: the same component can arrive as new old stock in
    # one delivery and current production in the next, so neither belongs on
    # the part, where it would be claimed by every quantity you ever hold.
    tags: list[str] = field(default_factory=list)
    batch: str = ""
    # What this quantity is held in - cut tape, reel, tube, tray, bag. Also a
    # property of the stock: the same part may come on a reel one time and as
    # a loose handful the next.
    packaging: str = ""

    # Product page, datasheet, photos. Same facts DigiKey's payload carries;
    # a file may have any, all, or none of them.
    link: str = ""
    datasheet: str = ""                          # URL, or a local file
    datasheet_pages: str = ""                    # e.g. '140-142'
    image: str = ""                              # primary; first of `images`
    images: list[str] = field(default_factory=list)
    # Photos of this quantity rather than of the part - the packet this
    # batch came in, its label - attached to the stock item itself.
    stock_images: list[str] = field(default_factory=list)
    # Files kept on the part - snapshots of the pages it was identified
    # from, a scanned label. (path, comment) pairs; paths are relative to
    # the stock file.
    attachments: list[tuple[str, str]] = field(default_factory=list)
    # Another line of this file whose part this stock belongs to - for a lot
    # printed with an older or alternate part number (MDA920-3 for MDA920A3).
    part_of: str = ""

    # Agent hints. Read by the CLI to decide what to confirm; never written to
    # InvenTree, because a number a model made up does not belong in an
    # inventory record.
    confidence: float | None = None
    needs_review: bool = False

    @property
    def order_reference(self) -> str:
        return str(self.order.get("reference") or "").strip()


@dataclass
class StockFile:
    """A whole import file: where it came from, and what it asks for."""
    version: int = 1
    source: dict[str, Any] = field(default_factory=dict)
    lines: list[StockLine] = field(default_factory=list)
    path: Path | None = None
    # Set from source.reference, else a hash of the file. Half of the barcode
    # that makes re-running an import a no-op.
    file_id: str = ""

    def key_for(self, line: StockLine) -> str:
        """The idempotence key: stable per line, per file."""
        return f"invimport:{self.file_id}:{line.id}"


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
def _nest(row: dict[str, Any]) -> dict[str, Any]:
    """
    Fold CSV's dotted columns back into the nesting JSON has natively.

    'param.Resistance' -> parameters['Resistance'], 'order.reference' ->
    order['reference']. The parameter name keeps its own spelling, dots and
    all, because 'Voltage - Input (Max)' is a name, not a path.
    """
    out: dict[str, Any] = {}
    for key, value in row.items():
        if key is None:
            continue
        name = str(key).strip()
        if not name or value in (None, ""):
            continue
        if name.startswith("param.") or name.startswith("parameters."):
            _, _, rest = name.partition(".")
            out.setdefault("parameters", {})[rest] = value
        elif name.startswith("order."):
            _, _, rest = name.partition(".")
            out.setdefault("order", {})[rest] = value
        elif name.startswith("suggest_category."):
            _, _, rest = name.partition(".")
            out.setdefault("suggest_category", {})[rest] = value
        elif name.startswith("notes."):
            _, _, rest = name.partition(".")
            out.setdefault("notes", {})[rest] = value
        else:
            out[name] = value
    return out


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().casefold() in ("true", "yes", "y", "1")


def _as_url(value: Any, field_name: str, line_id: str,
            problems: list[Problem]) -> str:
    """A URL InvenTree will accept, or '' if none was given."""
    text = str(value or "").strip()
    if not text:
        return ""
    url = absolute_url(text)
    if url is None:
        problems.append(Problem(
            line_id, field_name,
            f"{text!r} is not a URL - it needs a scheme (https://...)"))
        return ""
    return url


def _as_datasheet(value: Any, line_id: str,
                  problems: list[Problem]) -> str:
    """
    A datasheet URL, or a path to a local file.

    A URL is normalised the way `link` is. Anything without a scheme is taken
    as a path, relative to the stock file, and attached to the part as a file
    - that is how a datasheet gets onto the server rather than only linked.
    """
    text = str(value or "").strip()
    if not text:
        return ""
    if "://" in text or text.startswith("//"):
        return _as_url(text, "datasheet", line_id, problems)
    return text


def _as_pages(value: Any, line_id: str, problems: list[Problem]) -> str:
    """Which pages of the datasheet PDF to keep: '140-142', '3, 5-6'."""
    if value is None or value == "":
        return ""
    text = str(value).strip()
    if isinstance(value, bool) or parse_pages(text) is None:
        problems.append(Problem(
            line_id, "datasheet_pages",
            f"{value!r} is not a page list - write e.g. '140-142' or "
            f"'3, 5-6' (1-based PDF pages)"))
        return ""
    return text


def _as_images(raw: dict[str, Any], line_id: str,
               problems: list[Problem]) -> list[str]:
    """
    Photo URLs or local paths, primary first.

    `image` is one; `images` is several. A CSV cell is a comma-separated
    list. Duplicates are dropped so writing both fields with the same
    value does not upload twice.
    """
    collected: list[str] = []

    primary = raw.get("image")
    if isinstance(primary, list):
        problems.append(Problem(
            line_id, "image",
            "must be a single URL or path; use 'images' for several"))
        primary = None
    text = str(primary or "").strip()
    if text:
        collected.append(text)

    extra = raw.get("images")
    if extra in (None, ""):
        extra = []
    elif isinstance(extra, str):
        extra = [item.strip() for item in extra.split(",") if item.strip()]
    elif not isinstance(extra, list):
        problems.append(Problem(line_id, "images",
                                "must be a list of URLs or paths"))
        extra = []
    for item in extra:
        text = str(item).strip()
        if text and text not in collected:
            collected.append(text)
    return collected


def _as_stock_images(raw: dict[str, Any], line_id: str,
                     problems: list[Problem]) -> list[str]:
    """
    Photos for the stock item: URLs or local paths, duplicates dropped.

    The same shapes `images` accepts - a list, or a CSV cell of comma-separated
    values.
    """
    value = raw.get("stock_images")
    if value in (None, ""):
        return []
    if isinstance(value, str):
        value = [item.strip() for item in value.split(",") if item.strip()]
    elif not isinstance(value, list):
        problems.append(Problem(line_id, "stock_images",
                                "must be a list of URLs or paths"))
        return []
    collected: list[str] = []
    for item in value:
        text = str(item).strip()
        if text and text not in collected:
            collected.append(text)
    return collected


def _as_attachments(raw: dict[str, Any], line_id: str,
                    problems: list[Problem]) -> list[tuple[str, str]]:
    """
    Files to attach to the part: paths, or {"file", "comment"} objects.

    A bare path gets no comment of its own (the importer supplies one).
    """
    value = raw.get("attachments")
    if value in (None, ""):
        return []
    if isinstance(value, (str, dict)):
        value = [value]
    if not isinstance(value, list):
        problems.append(Problem(line_id, "attachments",
                                "must be a list of paths or "
                                "{file, comment} objects"))
        return []
    collected: list[tuple[str, str]] = []
    for item in value:
        if isinstance(item, dict):
            unknown = set(item) - {"file", "comment"}
            path = str(item.get("file") or "").strip()
            if unknown or not path:
                problems.append(Problem(
                    line_id, "attachments",
                    f"{item!r}: needs 'file', and may have 'comment'"))
                continue
            entry = (path, str(item.get("comment") or "").strip())
        else:
            path = str(item).strip()
            if not path:
                continue
            entry = (path, "")
        if entry[0] not in [p for p, _ in collected]:
            collected.append(entry)
    return collected


def _as_number(value: Any, field_name: str, line_id: str,
               problems: list[Problem]) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        problems.append(Problem(line_id, field_name,
                                f"{value!r} is not a number"))
        return None


def _tag_items(value: Any) -> list[str] | None:
    """Tags as written: a list, or the comma-separated cell CSV has to use.

    None means the value was neither, which is the caller's to report.
    """
    if value in (None, ""):
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",")]
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value]
    return None


def _as_tags(raw: dict[str, Any], line_id: str,
             problems: list[Problem]) -> list[str]:
    """
    Labels for the stock this line creates.

    Duplicates are dropped case-insensitively - `NOS` and `nos` are one tag,
    and a file-wide default merged with a per-line repeat should not write it
    twice - keeping the first spelling, because that is the one chosen.
    """
    items = _tag_items(raw.get("tags"))
    if items is None:
        problems.append(Problem(
            line_id, "tags",
            "must be a list, or a comma-separated string"))
        return []
    return _dedupe_tags([_as_nsn_tag(tag, line_id, problems) for tag in items])


def _as_nsn_tag(tag: str, line_id: str, problems: list[Problem]) -> str:
    """'NSN: 5961 00 123 4567' -> 'nsn:5961-00-123-4567'; other tags as-is."""
    if not tag.casefold().startswith(NSN_PREFIX):
        return tag
    digits = "".join(ch for ch in tag[len(NSN_PREFIX):] if ch.isdigit())
    rest = "".join(ch for ch in tag[len(NSN_PREFIX):]
                   if not ch.isdigit() and ch not in " -")
    if len(digits) != NSN_DIGITS or rest:
        problems.append(Problem(
            line_id, "tags",
            f"{tag!r} is not an NSN - it should be {NSN_DIGITS} digits, "
            f"e.g. 'nsn:5961-00-123-4567'"))
        return tag
    return (f"{NSN_PREFIX}{digits[:4]}-{digits[4:6]}-{digits[6:9]}-"
            f"{digits[9:]}")


def _dedupe_tags(items: list[str]) -> list[str]:
    """Blank ones dropped, and one spelling kept per tag."""
    tags: list[str] = []
    seen: set[str] = set()
    for tag in items:
        if not tag or tag.casefold() in seen:
            continue
        seen.add(tag.casefold())
        tags.append(tag)
    return tags


def _as_iso_date(value: Any, field_name: str, line_id: str,
                 problems: list[Problem]) -> str:
    """A YYYY-MM-DD date. A longer ISO timestamp is trimmed to its day."""
    text = str(value or "").strip()[:10]
    if not text:
        return ""
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        problems.append(Problem(
            line_id, field_name,
            f"{text!r} is not a date - write it as YYYY-MM-DD"))
        return ""
    return text


def _seal_state(packaging: str) -> str:
    words = packaging.casefold().replace(",", " ").replace("(", " ") \
        .replace(")", " ").replace("-", " ").split()
    return next((state for state in SEAL_STATES
                 if all(word in words for word in state.split())), "")


def _check_nos_packaging(line: StockLine, problems: list[Problem]) -> None:
    """New old stock must say what it is held in, and whether that is sealed."""
    if not any(tag.casefold() in NOS_TAGS for tag in line.tags):
        return
    states = ", ".join(SEAL_STATES[:5])
    if not line.packaging:
        problems.append(Problem(
            line.id, "packaging",
            f"is required for new old stock: the kind of packaging and "
            f"whether it is still sealed, e.g. 'Tube, sealed' ({states})"))
        return
    state = _seal_state(line.packaging)
    if not state:
        problems.append(Problem(
            line.id, "packaging",
            f"{line.packaging!r} does not say whether it is sealed - new old "
            f"stock needs one of: {states}, e.g. 'Tube, sealed'"))
    elif not line.packaging.casefold().replace(state, "").strip(" ,()-"):
        problems.append(Problem(
            line.id, "packaging",
            f"{line.packaging!r} says it is {state} but not what it is - "
            f"name the packaging too, e.g. 'Tube, {state}'"))


def _as_notes(value: Any, sections, field_name: str, line_id: str,
              problems: list[Problem]) -> str | dict[str, Any]:
    parsed, faults = notes.parse(value, sections)
    problems.extend(Problem(line_id, field_name, fault) for fault in faults)
    return parsed


def _line_from(raw: dict[str, Any], index: int,
               problems: list[Problem],
               allowed: set[str] = LINE_KEYS) -> StockLine:
    line_id = str(raw.get("id") or "").strip()

    for key in raw:
        if key not in allowed:
            problems.append(Problem(
                line_id or f"#{index + 1}", key, "not a recognised field",
                did_you_mean=_close(key, LINE_KEYS)))

    line = StockLine(id=line_id)

    if not line_id:
        problems.append(Problem(
            f"#{index + 1}", "id",
            "every line needs a stable, unique id - it is what makes "
            "re-importing this file a no-op rather than a duplicate"))

    quantity = _as_number(raw.get("quantity"), "quantity", line_id, problems)
    if quantity is None and raw.get("quantity") in (None, ""):
        problems.append(Problem(line_id, "quantity", "is required"))
    elif quantity is not None and quantity <= 0:
        problems.append(Problem(line_id, "quantity",
                                f"must be greater than zero, got {quantity:g}"))
    line.quantity = quantity or 0

    condition = str(raw.get("condition") or "ok").strip().casefold()
    if condition not in CONDITIONS:
        problems.append(Problem(line_id, "condition",
                                f"{condition!r} is not a known condition",
                                did_you_mean=_close(condition, CONDITIONS)))
        condition = "ok"
    line.condition = condition

    for name in ("category", "name", "description", "type", "mpn", "ipn",
                 "manufacturer", "supplier", "sku", "currency", "location",
                 "batch", "packaging", "part_ref", "manufacturer_part_ref"):
        setattr(line, name, str(raw.get(name) or "").strip())
    if len(line.name) > NAME_MAX:
        problems.append(Problem(line_id, "name",
                                f"is {len(line.name)} characters; InvenTree "
                                f"keeps at most {NAME_MAX}"))
    line.notes = _as_notes(raw.get("notes"), notes.STOCK_SECTIONS, "notes",
                           line_id, problems)
    line.part_notes = _as_notes(raw.get("part_notes"), notes.PART_SECTIONS,
                                "part_notes", line_id, problems)
    line.manufacturer_part_notes = _as_notes(
        raw.get("manufacturer_part_notes"),
        notes.MANUFACTURER_PART_SECTIONS, "manufacturer_part_notes",
        line_id, problems)
    if len(line.packaging) > PACKAGING_MAX:
        problems.append(Problem(line_id, "packaging",
                                f"is {len(line.packaging)} characters; "
                                f"InvenTree keeps at most {PACKAGING_MAX}"))

    line.link = _as_url(raw.get("link"), "link", line_id, problems)
    line.supplier_link = _as_url(raw.get("supplier_link"), "supplier_link",
                                 line_id, problems)
    line.datasheet = _as_datasheet(raw.get("datasheet"), line_id, problems)
    line.datasheet_pages = _as_pages(raw.get("datasheet_pages"), line_id,
                                     problems)
    line.images = _as_images(raw, line_id, problems)
    line.image = line.images[0] if line.images else ""
    line.stock_images = _as_stock_images(raw, line_id, problems)
    line.attachments = _as_attachments(raw, line_id, problems)
    line.part_of = str(raw.get("part_of") or "").strip()
    line.tags = _as_tags(raw, line_id, problems)
    _check_nos_packaging(line, problems)

    line.approximate = _as_bool(raw.get("approximate"))
    line.needs_review = _as_bool(raw.get("needs_review"))
    line.unit_price = _as_number(raw.get("unit_price"), "unit_price",
                                 line_id, problems)
    line.confidence = _as_number(raw.get("confidence"), "confidence",
                                 line_id, problems)
    if line.confidence is not None and not 0 <= line.confidence <= 1:
        problems.append(Problem(line_id, "confidence",
                                f"must be between 0 and 1, got "
                                f"{line.confidence:g}"))

    parameters = raw.get("parameters") or {}
    if not isinstance(parameters, dict):
        problems.append(Problem(line_id, "parameters", "must be a mapping of "
                                                       "name to value"))
        parameters = {}
    line.parameters = {str(k): str(v) for k, v in parameters.items()
                       if v not in (None, "")}

    order = raw.get("order") or {}
    if not isinstance(order, dict):
        problems.append(Problem(line_id, "order",
                                "must be a mapping with reference and date"))
        order = {}
    for key in order:
        if key not in ORDER_KEYS:
            problems.append(Problem(line_id, f"order.{key}",
                                    "not a recognised field",
                                    did_you_mean=_close(key, ORDER_KEYS)))
    line.order = {}
    for key, value in order.items():
        if key not in ORDER_KEYS or value in (None, ""):
            continue
        if key == "tags":
            items = _tag_items(value)
            if items is None:
                problems.append(Problem(
                    line_id, "order.tags",
                    "must be a list, or a comma-separated string"))
                continue
            tags = _dedupe_tags(items)
            if tags:
                line.order["tags"] = tags
            continue
        if key in ORDER_DATES:
            date_text = _as_iso_date(value, f"order.{key}", line_id, problems)
            if date_text:
                line.order[key] = date_text
            continue
        line.order[key] = str(value).strip()

    suggest = raw.get("suggest_category") or {}
    if not isinstance(suggest, dict):
        problems.append(Problem(line_id, "suggest_category",
                                "must be a mapping"))
        suggest = {}
    for key in suggest:
        if key not in SUGGEST_KEYS:
            problems.append(Problem(line_id, f"suggest_category.{key}",
                                    "not a recognised field",
                                    did_you_mean=_close(key, SUGGEST_KEYS)))
    line.suggest_category = dict(suggest)

    if not line.category:
        problems.append(Problem(line_id, "category", "is required"))

    return line


def _close(word: str, options) -> list[str]:
    """The nearest recognised spellings, for a 'did you mean'."""
    from .inventree.matching import candidates
    return [name for name, _ in candidates(str(word), list(options))][:2]


def _apply_defaults(raw: dict[str, Any],
                    defaults: dict[str, Any]) -> dict[str, Any]:
    """A line always wins; defaults only fill what it left out."""
    merged = dict(defaults)
    merged.update({k: v for k, v in raw.items() if v not in (None, "")})
    # order is a mapping, so it merges rather than replaces: a file-wide date
    # with a per-line reference is a reasonable thing to write.
    if isinstance(defaults.get("order"), dict) or isinstance(raw.get("order"), dict):
        order = dict(defaults.get("order") or {})
        order.update(raw.get("order") or {})
        merged["order"] = order
    # tags are a list, so they merge for the same reason: a file-wide "NOS"
    # and a per-line "sealed tube" are both true, and making the line's tags
    # replace the file's would silently drop the one that applies to
    # everything. A value that is neither list nor string is left alone, so
    # that _as_tags reports it rather than this quietly discarding it.
    file_tags = _tag_items(defaults.get("tags"))
    line_tags = _tag_items(raw.get("tags"))
    if file_tags is not None and line_tags is not None and (file_tags or line_tags):
        merged["tags"] = file_tags + line_tags
    return merged


def parse_document(data: Any, path: Path | None = None) -> StockFile:
    """Turn already-decoded file contents into a StockFile, or raise."""
    problems: list[Problem] = []

    if isinstance(data, list):                    # a bare list of lines
        data = {"lines": data}
    if not isinstance(data, dict):
        raise StockFileError(
            "a stock file is a mapping with a 'lines' list, or a bare list of "
            f"lines; got {type(data).__name__}")

    version = data.get("version", 1)
    try:
        version = int(version)
    except (TypeError, ValueError):
        version = -1
    if version not in SUPPORTED_VERSIONS:
        problems.append(Problem(
            "", "version",
            f"unsupported version {data.get('version')!r}; this build reads "
            f"{', '.join(str(v) for v in SUPPORTED_VERSIONS)}"))

    source = data.get("source") or {}
    if not isinstance(source, dict):
        problems.append(Problem("", "source", "must be a mapping"))
        source = {}
    for key in source:
        if key not in SOURCE_KEYS:
            problems.append(Problem("", f"source.{key}",
                                    "not a recognised field",
                                    did_you_mean=_close(key, SOURCE_KEYS)))

    defaultable = V2_DEFAULTABLE if version == 2 else DEFAULTABLE
    defaults = data.get("defaults") or {}
    if not isinstance(defaults, dict):
        problems.append(Problem("", "defaults", "must be a mapping"))
        defaults = {}
    for key in defaults:
        if key not in defaultable:
            reason = ("belongs to each part in a version 2 file"
                      if key in PART_KEYS else
                      "cannot be defaulted for the whole file - it "
                      "identifies a single line or the part it names")
            problems.append(Problem("", f"defaults.{key}", reason,
                                    did_you_mean=_close(key, defaultable)))
    defaults = {k: v for k, v in defaults.items() if k in defaultable}

    rows = data.get("lines")
    if rows is None:
        raise StockFileError("no 'lines' in the file")
    if not isinstance(rows, list):
        raise StockFileError(f"'lines' must be a list, got {type(rows).__name__}")

    lines: list[StockLine] = []
    if version == 2:
        lines = _expand(data, rows, defaults, problems)
    else:
        for key in ("parts", "manufacturer_parts"):
            if key in data:
                problems.append(Problem("", key, "needs \"version\": 2"))
        for index, raw in enumerate(rows):
            if not isinstance(raw, dict):
                problems.append(Problem(f"#{index + 1}", "",
                                        f"a line must be a mapping, got "
                                        f"{type(raw).__name__}"))
                continue
            lines.append(_line_from(_apply_defaults(raw, defaults), index,
                                    problems))

    seen: dict[str, int] = {}
    for index, line in enumerate(lines):
        if not line.id:
            continue
        if line.id in seen:
            problems.append(Problem(
                line.id, "id",
                f"is used by line #{seen[line.id] + 1} as well; ids must be "
                f"unique or one import would mask the other"))
        seen[line.id] = index

    # part_of has to name a line that comes first: that line resolves (or
    # creates) the part, and this one is filed against it.
    for index, line in enumerate(lines):
        if not line.part_of:
            continue
        target = seen.get(line.part_of)
        if line.part_of == line.id:
            problems.append(Problem(line.id, "part_of", "names this line itself"))
        elif target is None:
            problems.append(Problem(line.id, "part_of",
                                    f"{line.part_of!r} is not a line in this file"))
        elif target > index:
            problems.append(Problem(line.id, "part_of",
                                    f"{line.part_of!r} comes later in the file; "
                                    f"it must come first"))

    if problems:
        raise StockFileError("\n".join(
            p.describe() for p in unique(problems)))

    document = StockFile(version=version, source=source, lines=lines, path=path)
    document.file_id = file_id_for(document, data)
    return document


# --------------------------------------------------------------------------
# Version 2: parts and manufacturer parts apart from the lines
# --------------------------------------------------------------------------
def _entries(value: Any, section: str, kind: str, keys: set[str],
             problems: list[Problem]) -> dict[str, dict[str, Any]]:
    """A list of part or manufacturer part entries, by id."""
    if value in (None, ""):
        return {}
    if not isinstance(value, list):
        problems.append(Problem("", section, "must be a list"))
        return {}
    entries: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(value):
        label = f"#{index + 1}"
        if not isinstance(raw, dict):
            problems.append(Problem(label, "", f"must be a mapping, got "
                                               f"{type(raw).__name__}",
                                    kind=kind))
            continue
        entry_id = str(raw.get("id") or "").strip()
        for key in raw:
            if key not in keys:
                problems.append(Problem(entry_id or label, key,
                                        "not a recognised field",
                                        did_you_mean=_close(key, keys),
                                        kind=kind))
        if not entry_id:
            problems.append(Problem(label, "id", "is required - lines refer "
                                                 "to it", kind=kind))
        elif entry_id in entries:
            problems.append(Problem(entry_id, "id", "is used twice",
                                    kind=kind))
        else:
            entries[entry_id] = raw
    return entries


# Where a problem with an expanded line's field really lies.
_PART_FIELDS = PART_KEYS - {"id", "notes"}
_MANUFACTURER_PART_FIELDS = {"mpn", "manufacturer"}


def attribute(problems: list[Problem], part_id: str, mp_id: str) -> None:
    """Point problems raised by a part's or manufacturer part's own fields
    at that entry, not at the line that happened to carry them."""
    for problem in problems:
        root = problem.field.split(".", 1)[0]
        if root in _PART_FIELDS or root == "part_notes":
            problem.kind, problem.line = "part", part_id
            if root == "part_notes":
                problem.field = "notes"
        elif mp_id and (root in _MANUFACTURER_PART_FIELDS
                        or root == "manufacturer_part_notes"):
            problem.kind, problem.line = "manufacturer part", mp_id
            if root == "manufacturer_part_notes":
                problem.field = "notes"
        elif root == "supplier_link":
            problem.field = "link"


def unique(problems: list[Problem]) -> list[Problem]:
    """A part used by six lines is wrong once, not six times."""
    seen: set[tuple[str, str, str, str]] = set()
    out: list[Problem] = []
    for problem in problems:
        key = (problem.kind, problem.line, problem.field, problem.problem)
        if key not in seen:
            seen.add(key)
            out.append(problem)
    return out


def _expand(data: dict[str, Any], rows: list[Any],
            defaults: dict[str, Any],
            problems: list[Problem]) -> list[StockLine]:
    """
    Version 2 lines, expanded into the version 1 lines the importer runs on.

    Each line takes its part's fields, and the number and maker of its
    manufacturer part. The first line of a part resolves or creates it; the
    rest are filed against it with part_of, exactly as if the file had said
    so. The part's notes travel on that first line only, and a manufacturer
    part's on the first line that names it, so each is written once.
    """
    parts = _entries(data.get("parts"), "parts", "part", PART_KEYS, problems)
    makers = _entries(data.get("manufacturer_parts"), "manufacturer_parts",
                      "manufacturer part", MANUFACTURER_PART_KEYS, problems)
    for mp_id, entry in makers.items():
        owner = str(entry.get("part") or "").strip()
        if not owner:
            problems.append(Problem(mp_id, "part", "is required - name the "
                                                   "part this number is for",
                                    kind="manufacturer part"))
        elif owner not in parts:
            problems.append(Problem(mp_id, "part",
                                    f"{owner!r} is not a part in this file",
                                    did_you_mean=_close(owner, parts),
                                    kind="manufacturer part"))
        if not str(entry.get("mpn") or "").strip():
            problems.append(Problem(mp_id, "mpn", "is required",
                                    kind="manufacturer part"))
        if entry.get("notes") and not str(entry.get("manufacturer")
                                          or "").strip():
            # No maker, no ManufacturerPart - nothing is invented to stand in
            # for one - so these notes would have nowhere to go.
            problems.append(Problem(
                mp_id, "notes", "need a manufacturer: without one no "
                                "manufacturer part is created to hold them - "
                                "put general facts on the part instead",
                kind="manufacturer part"))

    first_line: dict[str, str] = {}
    noted_makers: set[str] = set()
    used_parts: set[str] = set()
    used_makers: set[str] = set()
    lines: list[StockLine] = []
    for index, raw in enumerate(rows):
        label = f"#{index + 1}"
        if not isinstance(raw, dict):
            problems.append(Problem(label, "", f"a line must be a mapping, "
                                               f"got {type(raw).__name__}"))
            continue
        line_id = str(raw.get("id") or "").strip()
        label = line_id or label
        for key in raw:
            if key in V2_LINE_KEYS:
                continue
            if key in PART_KEYS or key in _MANUFACTURER_PART_FIELDS:
                where = ("its manufacturer part" if key in
                         _MANUFACTURER_PART_FIELDS else "its part")
                problems.append(Problem(
                    label, key, f"belongs on {where} in a version 2 file, "
                                f"not on the line"))
            elif key == "part_of":
                problems.append(Problem(
                    label, key, "is not needed in a version 2 file - lines "
                                "naming the same part are already one part"))
            else:
                problems.append(Problem(label, key, "not a recognised field",
                                        did_you_mean=_close(key,
                                                            V2_LINE_KEYS)))

        part_id = str(raw.get("part") or "").strip()
        mp_id = str(raw.get("manufacturer_part") or "").strip()
        maker = makers.get(mp_id) if mp_id else None
        if mp_id and maker is None:
            problems.append(Problem(label, "manufacturer_part",
                                    f"{mp_id!r} is not a manufacturer part "
                                    f"in this file",
                                    did_you_mean=_close(mp_id, makers)))
        if maker is not None:
            owner = str(maker.get("part") or "").strip()
            if part_id and owner and part_id != owner:
                problems.append(Problem(
                    label, "part", f"is {part_id!r}, but manufacturer part "
                                   f"{mp_id!r} is a number for {owner!r}"))
            part_id = part_id or owner
        if not part_id and not mp_id:
            problems.append(Problem(label, "part",
                                    "is required - name the part, or the "
                                    "manufacturer part, this stock is"))
        part = parts.get(part_id)
        if part is None:
            if part_id and maker is None and not mp_id:
                problems.append(Problem(label, "part",
                                        f"{part_id!r} is not a part in this "
                                        f"file",
                                        did_you_mean=_close(part_id, parts)))
            continue

        used_parts.add(part_id)
        merged: dict[str, Any] = {k: v for k, v in part.items()
                                  if k not in ("id", "notes")}
        merged["part_ref"] = part_id
        if part_id in first_line:
            merged["part_of"] = first_line[part_id]
        else:
            first_line[part_id] = line_id
            merged["part_notes"] = part.get("notes")
        if maker is not None:
            used_makers.add(mp_id)
            merged["mpn"] = maker.get("mpn")
            merged["manufacturer"] = maker.get("manufacturer")
            merged["manufacturer_part_ref"] = mp_id
            if mp_id not in noted_makers:
                noted_makers.add(mp_id)
                merged["manufacturer_part_notes"] = maker.get("notes")

        stock = _apply_defaults(
            {k: v for k, v in raw.items()
             if k in V2_LINE_KEYS and k not in ("part", "manufacturer_part")},
            defaults)
        if "link" in stock:
            merged["supplier_link"] = stock.pop("link")
        merged.update(stock)

        before = len(problems)
        line = _line_from(merged, index, problems,
                          allowed=LINE_KEYS | EXPANDED_KEYS)
        attribute(problems[before:], part_id, mp_id if maker else "")
        lines.append(line)

    for part_id in parts:
        if part_id not in used_parts:
            problems.append(Problem(part_id, "id", "no line uses this part, "
                                                   "so nothing would import "
                                                   "it", kind="part"))
    for mp_id in makers:
        if mp_id not in used_makers:
            problems.append(Problem(mp_id, "id",
                                    "no line uses this manufacturer part, so "
                                    "nothing would import it",
                                    kind="manufacturer part"))
    return lines


def file_id_for(document: StockFile, data: Any) -> str:
    """
    Half of the idempotence key, identifying the file rather than the line.

    `source.reference` when the file names itself - a photo filename, an
    invoice number - so the same import re-run from a regenerated file still
    matches. Otherwise a hash of the contents, which is stable for as long as
    the file is.
    """
    reference = str(document.source.get("reference") or "").strip()
    if reference:
        return reference
    blob = json.dumps(data, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


# --------------------------------------------------------------------------
# Formats
# --------------------------------------------------------------------------
def parse_csv(text: str) -> Any:
    """CSV is a flat list of lines; file-level keys have nowhere to live."""
    rows = list(csv.DictReader(io.StringIO(text)))
    return {"lines": [_nest(row) for row in rows]}


def parse_text(text: str, suffix: str = "") -> Any:
    """Decode by extension, falling back to sniffing the first character."""
    suffix = suffix.lower()
    if suffix == ".csv":
        return parse_csv(text)
    if suffix in (".yaml", ".yml"):
        return yaml.safe_load(text)
    if suffix == ".json":
        return json.loads(text)

    stripped = text.lstrip()
    if stripped.startswith(("{", "[")):
        return json.loads(text)
    if "," in stripped.split("\n", 1)[0] and ":" not in stripped.split("\n", 1)[0]:
        return parse_csv(text)
    return yaml.safe_load(text)


def read_file(path: Path | str) -> StockFile:
    """Read one stock file. Raises StockFileError listing everything wrong."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise StockFileError(f"{path}: {exc}") from exc

    try:
        data = parse_text(text, path.suffix)
    except (json.JSONDecodeError, yaml.YAMLError, csv.Error) as exc:
        raise StockFileError(f"{path}: could not be read as "
                             f"{path.suffix.lstrip('.') or 'JSON/YAML/CSV'} - "
                             f"{exc}") from exc

    try:
        return parse_document(data, path=path)
    except StockFileError as exc:
        raise StockFileError(f"{path}:\n{exc}") from exc
