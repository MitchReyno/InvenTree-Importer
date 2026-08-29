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
from pathlib import Path
from typing import Any

import yaml

# What a line may say. Anything else is a mistake worth reporting rather than
# ignoring - a misspelled key is otherwise indistinguishable from an omission.
LINE_KEYS = {
    "id", "quantity", "approximate", "condition",
    "category", "suggest_category", "description", "type", "mpn", "ipn",
    "manufacturer", "parameters",
    "supplier", "sku", "unit_price", "currency", "order",
    "location", "notes",
    "confidence", "needs_review",
}
ORDER_KEYS = {"reference", "date"}
SOURCE_KEYS = {"kind", "reference", "captured", "agent"}
SUGGEST_KEYS = {"identity", "ipn_prefix", "description", "because"}

# Defaults may set anything a line may set, except what identifies the line or
# the part it names. A file-wide "mpn" would be nonsense.
DEFAULTABLE = {"supplier", "currency", "location", "order", "condition",
               "category", "notes"}

CONDITIONS = ("ok", "unopened", "attention", "damaged", "quarantined")

SUPPORTED_VERSIONS = (1,)


class StockFileError(RuntimeError):
    """The file is not readable as a stock import. Says which line and why."""


@dataclass
class Problem:
    """One thing wrong with the file, addressed to whoever wrote it."""
    line: str = ""                               # line id, or "" for the file
    # Named to match the JSON an agent reads back. `field` shadows
    # dataclasses.field inside this body, hence the qualified call below.
    field: str = ""
    problem: str = ""
    did_you_mean: list[str] = dataclasses.field(default_factory=list)

    def describe(self) -> str:
        where = f"line {self.line}" if self.line else "file"
        at = f" {self.field}:" if self.field else ""
        hint = (f" - did you mean {' or '.join(repr(s) for s in self.did_you_mean)}?"
                if self.did_you_mean else "")
        return f"{where}:{at} {self.problem}{hint}"

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"problem": self.problem}
        if self.line:
            out["line"] = self.line
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
    order: dict[str, str] = field(default_factory=dict)

    location: str = ""
    notes: str = ""

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
        else:
            out[name] = value
    return out


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().casefold() in ("true", "yes", "y", "1")


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


def _line_from(raw: dict[str, Any], index: int,
               problems: list[Problem]) -> StockLine:
    line_id = str(raw.get("id") or "").strip()

    for key in raw:
        if key not in LINE_KEYS:
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

    for name in ("category", "description", "type", "mpn", "ipn",
                 "manufacturer", "supplier", "sku", "currency", "location",
                 "notes"):
        setattr(line, name, str(raw.get(name) or "").strip())

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
    line.order = {str(k): str(v).strip() for k, v in order.items()
                  if v not in (None, "")}

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

    defaults = data.get("defaults") or {}
    if not isinstance(defaults, dict):
        problems.append(Problem("", "defaults", "must be a mapping"))
        defaults = {}
    for key in defaults:
        if key not in DEFAULTABLE:
            problems.append(Problem(
                "", f"defaults.{key}",
                "cannot be defaulted for the whole file - it identifies a "
                "single line or the part it names",
                did_you_mean=_close(key, DEFAULTABLE)))
    defaults = {k: v for k, v in defaults.items() if k in DEFAULTABLE}

    rows = data.get("lines")
    if rows is None:
        raise StockFileError("no 'lines' in the file")
    if not isinstance(rows, list):
        raise StockFileError(f"'lines' must be a list, got {type(rows).__name__}")

    lines: list[StockLine] = []
    for index, raw in enumerate(rows):
        if not isinstance(raw, dict):
            problems.append(Problem(f"#{index + 1}", "",
                                    f"a line must be a mapping, got "
                                    f"{type(raw).__name__}"))
            continue
        lines.append(_line_from(_apply_defaults(raw, defaults), index, problems))

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

    if problems:
        raise StockFileError("\n".join(p.describe() for p in problems))

    document = StockFile(version=version, source=source, lines=lines, path=path)
    document.file_id = file_id_for(document, data)
    return document


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
