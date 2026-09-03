"""
Create stock, and make creating it twice impossible.

    from invimport.inventree.stock import add_stock, already_imported

    if not already_imported(api, key):
        add_stock(api, part=4, quantity=25, location=2, key=key)

The DigiKey path receives stock against a purchase order, which is its own
guard: a re-run finds the existing order and leaves it alone. A file has no
order to anchor to - 29% of real rows never had one - and "does this part
already have stock?" is the wrong question, because buying more of something
you own is the normal case.

So each created stock item carries a custom barcode naming the line that made
it. InvenTree enforces barcode uniqueness itself, which turns "do not import
twice" from something this code checks into something the database refuses.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace
from typing import Any

from .api import PART_MODEL_TYPE, StockItem, StockLocation

log = logging.getLogger(__name__)

LIST_LIMIT = 1000

# Built-in stock statuses. QUARANTINED is deliberately excluded from
# InvenTree's AVAILABLE_CODES; ATTENTION is not.
STATUS_OK = 10
STATUS_ATTENTION = 50
STATUS_DAMAGED = 55
STATUS_QUARANTINED = 75

# The condition vocabulary a stock file may use, mapped onto status codes.
# `unopened` is bound to ATTENTION rather than QUARANTINED so unopened stock
# still counts as available: the flag says "not verified", not "unusable".
CONDITION_STATUS = {
    "ok": STATUS_OK,
    "unopened": STATUS_ATTENTION,
    "attention": STATUS_ATTENTION,
    "damaged": STATUS_DAMAGED,
    "quarantined": STATUS_QUARANTINED,
}


class BarcodeInUse(RuntimeError):
    """The server refused a barcode because something already has it."""


KIND_LABELS = {
    "part": "Part",
    "stockitem": "Stock item",
    "stocklocation": "Location",
}

# PUI paths. The barcode endpoint's `url` is an API route, not the page a
# human wants to open, so these are built from kind + pk against INVENTREE_URL.
WEB_PATHS = {
    "part": "/web/part/{pk}/",
    "stockitem": "/web/stock/item/{pk}/",
    "stocklocation": "/web/stock/location/{pk}/",
}

ENRICH_PATHS = {
    "part": "part/{pk}/",
    "stockitem": "stock/{pk}/",
    "stocklocation": "stock/location/{pk}/",
}


@dataclass
class BarcodeHit:
    """A barcode that resolved to a part, stock item or location."""

    kind: str
    pk: int
    payload: dict[str, Any]
    scan: str = ""
    url: str | None = None

    @property
    def type_label(self) -> str:
        return KIND_LABELS.get(self.kind, self.kind)

    @property
    def title(self) -> str:
        data = self.payload
        if self.kind == "part":
            return str(data.get("full_name") or data.get("name")
                       or data.get("IPN") or f"Part {self.pk}")
        if self.kind == "stockitem":
            part = data.get("part_detail") or {}
            if isinstance(part, dict):
                name = part.get("full_name") or part.get("name") or part.get("IPN")
                if name:
                    return str(name)
            return f"Stock item {self.pk}"
        if self.kind == "stocklocation":
            return str(data.get("pathstring") or data.get("name")
                       or f"Location {self.pk}")
        return f"{self.type_label} {self.pk}"


def web_url(base: str | None, kind: str, pk: int) -> str | None:
    """The PUI page for this object, or None if we cannot form one."""
    if not base or not pk:
        return None
    path = WEB_PATHS.get(kind)
    if not path:
        return None
    return base.rstrip("/") + path.format(pk=pk)


def barcode_hit(found: dict[str, Any], scan: str = "") -> BarcodeHit | None:
    """Pick part / stock item / location out of a /api/barcode/ response."""
    for kind in ("stockitem", "stocklocation", "part"):
        if kind not in found:
            continue
        payload = found[kind]
        if isinstance(payload, int):
            pk, payload = payload, {"pk": payload}
        elif isinstance(payload, dict):
            pk = payload.get("pk")
        else:
            continue
        if not pk:
            continue
        return BarcodeHit(
            kind=kind, pk=int(pk), payload=payload,
            scan=scan, url=found.get("url"))
    return None


def _api_get(api, path: str, **params):
    try:
        if params:
            return api.get(path, params=params)
        return api.get(path)
    except Exception:
        return None


def _as_list(data) -> list:
    """A list endpoint may answer with a list, or with a paginated dict."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("results"), list):
        return data["results"]
    return []


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, dict):
        value = value.get("pk")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_parameters(api, part_pk: int) -> list[dict[str, str]]:
    """The named parameter values hanging off this part."""
    rows = _as_list(_api_get(api, "parameter/",
                             model_type=PART_MODEL_TYPE, model_id=part_pk))
    templates: dict[int, dict[str, Any]] = {}
    for tmpl in _as_list(_api_get(api, "parameter/template/")):
        pk = _as_int(tmpl.get("pk") if isinstance(tmpl, dict) else None)
        if pk is not None and isinstance(tmpl, dict):
            templates[pk] = tmpl
    out: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name, units = "", ""
        detail = row.get("template_detail")
        if isinstance(detail, dict):
            name = str(detail.get("name") or "")
            units = str(detail.get("units") or "")
        tmpl = templates.get(_as_int(row.get("template")) or -1)
        if tmpl:
            name = name or str(tmpl.get("name") or "")
            units = units or str(tmpl.get("units") or "")
        value = row.get("data")
        if not name or value in (None, ""):
            continue
        item = {"name": name, "value": str(value)}
        if units:
            item["units"] = units
        out.append(item)
    return out


def _with_category(api, data: dict[str, Any]) -> dict[str, Any]:
    if data.get("category_detail") or data.get("category_path"):
        return data
    cat = _as_int(data.get("category"))
    if cat is None:
        return data
    extra = _api_get(api, f"part/category/{cat}/")
    if isinstance(extra, dict):
        return {**data, "category_detail": extra}
    return data


def _load_part(api, pk: int, existing: dict[str, Any] | None = None
               ) -> dict[str, Any]:
    data = dict(existing or {})
    extra = _api_get(api, f"part/{pk}/")
    if isinstance(extra, dict):
        data = {**data, **extra}
    data = _with_category(api, data)
    if "parameters" not in data:
        data["parameters"] = fetch_parameters(api, pk)
    return data


def fetch_stock_items(api, **filters) -> list[dict[str, Any]]:
    return [row for row in _as_list(
        _api_get(api, "stock/", limit=LIST_LIMIT, **filters))
        if isinstance(row, dict)]


def fetch_child_locations(api, parent_pk: int) -> list[dict[str, Any]]:
    return [row for row in _as_list(
        _api_get(api, "stock/location/", parent=parent_pk, limit=LIST_LIMIT))
        if isinstance(row, dict)]


def _annotate_stock_items(api, items: list[dict[str, Any]]
                          ) -> list[dict[str, Any]]:
    """Fill part_detail / location_detail so a list row can name what it is."""
    parts: dict[int, dict[str, Any]] = {}
    locations: dict[int, dict[str, Any]] = {}
    out = []
    for item in items:
        row = dict(item)
        part_pk = _as_int(row.get("part"))
        if part_pk is not None and not (
                isinstance(row.get("part_detail"), dict)
                and (row["part_detail"].get("name") or row["part_detail"].get("IPN"))):
            if part_pk not in parts:
                extra = _api_get(api, f"part/{part_pk}/")
                parts[part_pk] = extra if isinstance(extra, dict) else {}
            if parts[part_pk]:
                row["part_detail"] = {**(row.get("part_detail") or {}),
                                      **parts[part_pk]}
        loc_pk = _as_int(row.get("location"))
        if loc_pk is not None and not (
                isinstance(row.get("location_detail"), dict)
                and (row["location_detail"].get("pathstring")
                     or row["location_detail"].get("name"))):
            if loc_pk not in locations:
                extra = _api_get(api, f"stock/location/{loc_pk}/")
                locations[loc_pk] = extra if isinstance(extra, dict) else {}
            if locations[loc_pk]:
                row["location_detail"] = {**(row.get("location_detail") or {}),
                                          **locations[loc_pk]}
        out.append(row)
    return out


def enrich_hit(api, hit: BarcodeHit) -> BarcodeHit:
    """Fill in details the barcode response omitted, if the object is there."""
    payload = dict(hit.payload)
    path = ENRICH_PATHS.get(hit.kind)
    if path and hit.kind != "part":
        extra = _api_get(api, path.format(pk=hit.pk))
        if isinstance(extra, dict):
            payload = {**payload, **extra}

    if hit.kind == "part":
        payload = _load_part(api, hit.pk, payload)
        if not payload.get("stock_items"):
            payload["stock_items"] = _annotate_stock_items(
                api, fetch_stock_items(api, part=hit.pk, location_detail=True))
    elif hit.kind == "stockitem":
        part_pk = _as_int(payload.get("part"))
        existing = payload.get("part_detail")
        if part_pk is None and isinstance(existing, dict):
            part_pk = _as_int(existing.get("pk"))
        if part_pk is not None:
            part = _load_part(api, part_pk,
                              existing if isinstance(existing, dict) else None)
            payload["part_detail"] = part
        loc_pk = _as_int(payload.get("location"))
        if loc_pk is not None and not isinstance(payload.get("location_detail"), dict):
            loc = _api_get(api, f"stock/location/{loc_pk}/")
            if isinstance(loc, dict):
                payload["location_detail"] = loc
    elif hit.kind == "stocklocation":
        if not payload.get("children"):
            payload["children"] = fetch_child_locations(api, hit.pk)
        if not payload.get("stock_items"):
            payload["stock_items"] = _annotate_stock_items(
                api, fetch_stock_items(
                    api, location=hit.pk, cascade=True, part_detail=True))

    return replace(hit, payload=payload)


def lookup_barcode(api, key: str) -> BarcodeHit | None:
    """Resolve a scan to a part, stock item or location, or None."""
    if not key:
        return None
    try:
        found = api.post("barcode/", {"barcode": key})
    except Exception:
        return None
    if not isinstance(found, dict):
        return None
    hit = barcode_hit(found, scan=key)
    if hit is None:
        return None
    return enrich_hit(api, hit)


# Stock counts arrive as floats from InvenTree (`25.0`). Whole numbers are
# shown as integers; a genuine fraction is left as-is.
COUNT_KEYS = {
    "quantity", "total_in_stock", "unallocated_stock",
    "minimum_stock", "item_count",
}


def format_count(value: Any) -> str:
    """`25.0` -> `25`; leave a real fraction and non-numeric text alone."""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return str(value)
    number: float | None = None
    if isinstance(value, float):
        number = value
    else:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return str(value)
    if number.is_integer():
        return str(int(number))
    return str(value)


def _add_fields(data: dict[str, Any], keys: list[tuple[str, str]]
                ) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for key, label in keys:
        value = data.get(key)
        if value in (None, ""):
            continue
        shown = format_count(value) if key in COUNT_KEYS else str(value)
        rows.append((label, shown))
    return rows


def _category_path(data: dict[str, Any]) -> str | None:
    category = data.get("category_detail")
    if isinstance(category, dict):
        path = category.get("pathstring") or category.get("name")
        if path:
            return str(path)
    for key in ("category_path", "category_name"):
        if data.get(key):
            return str(data[key])
    return None


def parameter_fields(data: dict[str, Any]) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for item in data.get("parameters") or []:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        value = item.get("value")
        if not name or value in (None, ""):
            continue
        units = item.get("units")
        label = f"{name} ({units})" if units else str(name)
        rows.append((label, str(value)))
    return rows


def part_fields(data: dict[str, Any]) -> list[tuple[str, str]]:
    rows = _add_fields(data, [
        ("IPN", "IPN"),
        ("name", "Name"),
        ("description", "Description"),
        ("revision", "Revision"),
        ("keywords", "Keywords"),
        ("units", "Units"),
        ("total_in_stock", "In stock"),
        ("unallocated_stock", "Available"),
        ("minimum_stock", "Minimum"),
        ("link", "Link"),
        ("notes", "Notes"),
    ])
    path = _category_path(data)
    if path:
        after = next((i for i, (label, _) in enumerate(rows)
                      if label == "Description"), 1)
        rows.insert(after + 1, ("Category", path))
    return rows


def stock_fields(data: dict[str, Any]) -> list[tuple[str, str]]:
    rows = _add_fields(data, [
        ("quantity", "Quantity"),
        ("serial", "Serial"),
        ("batch", "Batch"),
        ("status_text", "Status"),
        ("packaging", "Packaging"),
        ("expiry_date", "Expiry"),
        ("updated", "Updated"),
        ("notes", "Notes"),
    ])
    price = data.get("purchase_price")
    if price not in (None, ""):
        currency = data.get("purchase_price_currency") or ""
        rows.append(("Purchase price", f"{price} {currency}".strip()))
    location = data.get("location_detail") if isinstance(
        data.get("location_detail"), dict) else {}
    path = location.get("pathstring") or location.get("name")
    if path:
        rows.append(("Location", str(path)))
    elif data.get("location") not in (None, ""):
        rows.append(("Location", str(data["location"])))
    return rows


def location_fields(data: dict[str, Any]) -> list[tuple[str, str]]:
    return _add_fields(data, [
        ("name", "Name"),
        ("pathstring", "Path"),
        ("description", "Description"),
        ("item_count", "Items"),
        ("structural", "Structural"),
    ])


def _part_label(data: dict[str, Any]) -> str:
    part = data.get("part_detail") if isinstance(data.get("part_detail"), dict) else {}
    name = part.get("IPN") or part.get("full_name") or part.get("name")
    if name:
        return str(name)
    if data.get("part") not in (None, ""):
        return f"Part {data['part']}"
    return f"Item {data.get('pk') or '?'}"


def _location_label(data: dict[str, Any]) -> str:
    location = data.get("location_detail") if isinstance(
        data.get("location_detail"), dict) else {}
    path = location.get("pathstring") or location.get("name")
    if path:
        return str(path)
    if data.get("location") not in (None, ""):
        return str(data["location"])
    return ""


def location_ref(data: dict[str, Any]
                 ) -> tuple[int, str, dict[str, Any]] | None:
    """pk, display name and payload to open this stock item's location."""
    loc = data.get("location_detail") if isinstance(
        data.get("location_detail"), dict) else {}
    pk = _as_int(data.get("location")) or _as_int(loc.get("pk") if loc else None)
    if pk is None:
        return None
    label = loc.get("pathstring") or loc.get("name") or _location_label(data)
    if not label:
        label = str(pk)
    payload = {"pk": pk, **loc} if loc else {"pk": pk}
    return pk, str(label), payload


def child_location_ref(data: dict[str, Any]
                       ) -> tuple[int, str, dict[str, Any]] | None:
    """pk, display name and payload for a nested location row."""
    pk = _as_int(data.get("pk"))
    if pk is None:
        return None
    label = data.get("pathstring") or data.get("name") or str(pk)
    return pk, str(label), {"pk": pk, **data}


def location_hit(pk: int, payload: dict[str, Any] | None = None) -> BarcodeHit:
    """A location hit to show, before enrich fills children and stock."""
    data = dict(payload or {})
    data.setdefault("pk", pk)
    return BarcodeHit(kind="stocklocation", pk=pk, payload=data)


def stock_line(item: dict[str, Any]) -> str:
    """One-line summary for a compact, expandable stock row."""
    qty = format_count(item.get("quantity") if item.get("quantity") not in (None, "") else 0)
    bits = [f"{qty} × {_part_label(item)}"]
    serial = item.get("serial")
    if serial:
        bits.append(f"SN {serial}")
    status = item.get("status_text")
    if status:
        bits.append(str(status))
    return "  ·  ".join(bits)


def stock_list_rows(items: list[dict[str, Any]], *, context: str
                    ) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for item in items:
        qty = format_count(item.get("quantity") if item.get("quantity") not in (None, "") else 0)
        extra = " · ".join(
            str(bit) for bit in (
                item.get("serial") and f"SN {item['serial']}",
                item.get("batch") and f"batch {item['batch']}",
                item.get("status_text"),
            ) if bit)
        if context == "part":
            rows.append((qty, " · ".join(bit for bit in (_location_label(item), extra) if bit)
                         or f"#{item.get('pk')}"))
        else:
            rows.append((f"{qty} × {_part_label(item)}", extra))
    return rows


def child_location_rows(children: list[dict[str, Any]]) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for child in children:
        name = str(child.get("name") or f"Location {child.get('pk') or '?'}")
        path = child.get("pathstring") or ""
        rows.append((name, str(path)))
    return rows


def stock_expand_fields(item: dict[str, Any]) -> list[tuple[str, str]]:
    """The fields shown when a compact location stock row is opened."""
    rows: list[tuple[str, str]] = []
    part = item.get("part_detail") if isinstance(item.get("part_detail"), dict) else {}
    part_name = part.get("IPN") or part.get("full_name") or part.get("name")
    if part_name:
        rows.append(("Part", str(part_name)))
    rows.extend(stock_fields(item))
    return rows


@dataclass
class DetailSection:
    """One bordered panel of labelled fields, optionally with nested panels."""

    title: str
    rows: list[tuple[str, str]] = field(default_factory=list)
    children: list[DetailSection] = field(default_factory=list)

    def all_rows(self) -> list[tuple[str, str]]:
        rows = list(self.rows)
        for child in self.children:
            rows.extend(child.all_rows())
        return rows


def _part_section(data: dict[str, Any]) -> DetailSection:
    params = parameter_fields(data)
    children = [DetailSection("Parameters", params)] if params else []
    return DetailSection("Part", part_fields(data), children)


def field_sections(hit: BarcodeHit, *, include_location: bool = True
                   ) -> list[DetailSection]:
    """The identity panels: part / stock item / location fields and parameters."""
    if hit.kind == "part":
        return [_part_section(hit.payload)]
    if hit.kind == "stockitem":
        rows = stock_fields(hit.payload)
        if not include_location:
            rows = [row for row in rows if row[0] != "Location"]
        sections = [DetailSection("Stock item", rows)]
        part = hit.payload.get("part_detail")
        if isinstance(part, dict) and part:
            sections.append(_part_section(part))
        return sections
    if hit.kind == "stocklocation":
        return [DetailSection("Location", location_fields(hit.payload))]
    return []


def list_sections(hit: BarcodeHit) -> list[DetailSection]:
    """Child locations (for a location) and stock of a part."""
    sections: list[DetailSection] = []
    if hit.kind == "stocklocation":
        children = [c for c in (hit.payload.get("children") or [])
                    if isinstance(c, dict)]
        if children:
            sections.append(DetailSection(
                f"Locations ({len(children)})",
                child_location_rows(children)))
    if hit.kind == "part":
        items = [i for i in (hit.payload.get("stock_items") or [])
                 if isinstance(i, dict)]
        if items:
            sections.append(DetailSection(
                f"Stock ({len(items)})",
                stock_list_rows(items, context="part")))
    return sections


def location_stock_sections(hit: BarcodeHit) -> list[DetailSection]:
    """Compact stock rows at a location (the TUI expands these)."""
    if hit.kind != "stocklocation":
        return []
    items = [i for i in (hit.payload.get("stock_items") or [])
             if isinstance(i, dict)]
    if not items:
        return []
    return [DetailSection(
        f"Stock ({len(items)})",
        stock_list_rows(items, context="location"))]


def hit_sections(hit: BarcodeHit) -> list[DetailSection]:
    """The panels to draw for this hit, including nested lists."""
    return field_sections(hit) + list_sections(hit) + location_stock_sections(hit)


def hit_rows(hit: BarcodeHit) -> list[tuple[str, str]]:
    """Labelled fields worth showing for this hit."""
    rows: list[tuple[str, str]] = [
        ("Type", hit.type_label),
        ("ID", str(hit.pk)),
    ]
    for section in hit_sections(hit):
        rows.extend(section.all_rows())
    return rows


def hit_markdown(hit: BarcodeHit) -> str:
    lines = [f"# {hit.title}", f"*{hit.type_label}* `{hit.pk}`", ""]

    def write(section: DetailSection, level: int) -> None:
        lines.append(f"{'#' * level} {section.title}")
        lines.append("")
        if section.rows:
            lines.append("| | |")
            lines.append("| --- | --- |")
            for label, value in section.rows:
                lines.append(f"| **{label}** | {value} |")
            lines.append("")
        for child in section.children:
            write(child, level + 1)

    for section in hit_sections(hit):
        write(section, 2)
    return "\n".join(lines)


_PANEL_STYLE = {
    "Stock item": "green",
    "Stock": "green",
    "Part": "cyan",
    "Location": "yellow",
    "Locations": "yellow",
    "Parameters": "magenta",
}


def _panel_style(title: str) -> str:
    for key, style in _PANEL_STYLE.items():
        if title == key or title.startswith(f"{key} "):
            return style
    return "cyan"


def render_section(section: DetailSection):
    """A Rich panel for this section, with child panels nested inside."""
    from rich import box
    from rich.console import Group
    from rich.panel import Panel
    from rich.table import Table

    compact = section.title.startswith(("Stock (", "Locations ("))
    if section.title == "Parameters" or compact:
        table = Table(box=box.SIMPLE, expand=True, pad_edge=False,
                      show_edge=False)
        if compact:
            if section.title.startswith("Locations"):
                table.add_column("Name", style="bold", no_wrap=True, min_width=12)
                table.add_column("Path", overflow="fold")
            elif section.title.startswith("Stock (") and section.rows and " × " in section.rows[0][0]:
                table.add_column("Stock", style="bold", no_wrap=True, min_width=16)
                table.add_column("Detail", overflow="fold")
            else:
                table.add_column("Qty", style="bold", no_wrap=True, min_width=6)
                table.add_column("Detail", overflow="fold")
        else:
            table.add_column("Parameter", style="bold", no_wrap=True, min_width=16)
            table.add_column("Value", overflow="fold")
        for label, value in section.rows:
            table.add_row(label, value)
        body: Any = table
    else:
        table = Table(box=box.SIMPLE, expand=True, pad_edge=False,
                      show_header=False, show_edge=False)
        table.add_column("Field", style="bold cyan", no_wrap=True, min_width=16)
        table.add_column("Value", overflow="fold")
        for label, value in section.rows:
            table.add_row(label, value)
        pieces: list[Any] = [table] if section.rows else []
        pieces.extend(render_section(child) for child in section.children)
        if not pieces:
            body = ""
        elif len(pieces) == 1:
            body = pieces[0]
        else:
            body = Group(*pieces)
    return Panel(
        body,
        title=f"[bold]{section.title}[/]",
        border_style=_panel_style(section.title),
        padding=(0, 1),
    )


def render_hit(hit: BarcodeHit, *, lists: bool = True,
               include_location: bool = True):
    """Rich panels for the lookup view.

    `lists=False` leaves stock and child-location lists out so the TUI can
    draw those as clickable widgets. `include_location=False` omits the
    Location field on a stock item for the same reason.
    """
    from rich.console import Group
    sections = field_sections(hit, include_location=include_location)
    if lists:
        sections = sections + list_sections(hit) + location_stock_sections(hit)
    panels = [render_section(section) for section in sections]
    if not panels:
        return ""
    if len(panels) == 1:
        return panels[0]
    return Group(*panels)


# --------------------------------------------------------------------------
# Idempotence
# --------------------------------------------------------------------------
def find_by_barcode(api, key: str) -> dict[str, Any] | None:
    """What this barcode points at, or None if nothing does."""
    if not key:
        return None
    try:
        found = api.post("barcode/", {"barcode": key})
    except Exception:
        # The endpoint answers 400 for an unknown barcode, which the client
        # raises. Not knowing it is the normal case, not a failure.
        return None
    if isinstance(found, dict) and found.get("stockitem"):
        return found
    return None


def already_imported(api, key: str) -> int | None:
    """The pk of the stock item this key already created, or None."""
    found = find_by_barcode(api, key)
    if not found:
        return None
    item = found.get("stockitem")
    if isinstance(item, dict):
        return item.get("pk")
    return item


def link_barcode(api, key: str, stock_item_pk: int) -> None:
    """
    Stamp the import key onto a stock item.

    InvenTree rejects a barcode that is already assigned, so this is the guard
    itself rather than a record of one: a second import of the same line
    cannot succeed even if every check above it were wrong.
    """
    try:
        api.post("barcode/link/", {"barcode": key, "stockitem": stock_item_pk})
    except Exception as exc:
        raise BarcodeInUse(f"{key!r} is already assigned: {exc}") from exc


# --------------------------------------------------------------------------
# Locations
# --------------------------------------------------------------------------
def locations_by_path(api) -> dict[str, Any]:
    return {str(loc.pathstring): loc
            for loc in StockLocation.list(api, limit=LIST_LIMIT)
            if getattr(loc, "pathstring", None)}


def resolve_location(api, path: str, *, write: bool,
                     create: bool = True,
                     cache: dict[str, Any] | None = None) -> Any | None:
    """
    The StockLocation at this path, created with its parents if missing.

    Creating locations is the one piece of structure this importer will make
    without being asked each time. A location is a shelf, not a taxonomy
    decision, and refusing to file stock because a drawer does not exist yet
    would be obstructive.
    """
    path = (path or "").strip().strip("/")
    if not path:
        return None
    known = cache if cache is not None else locations_by_path(api)
    if not known and cache is not None:
        known.update(locations_by_path(api))

    existing = known.get(path)
    if existing is not None:
        return existing
    for candidate, location in known.items():
        if candidate.casefold() == path.casefold():
            return location
    if not create:
        return None

    parent = None
    walked = ""
    for part in path.split("/"):
        walked = f"{walked}/{part}" if walked else part
        found = known.get(walked)
        if found is None:
            found = next((loc for name, loc in known.items()
                          if name.casefold() == walked.casefold()), None)
        if found is None:
            if not write:
                return None
            payload: dict[str, Any] = {"name": part}
            if parent is not None:
                payload["parent"] = parent.pk
            found = StockLocation.create(api, payload)
            log.info("    created stock location %r", walked)
            known[walked] = found
        parent = found
    return parent


# --------------------------------------------------------------------------
# Stock
# --------------------------------------------------------------------------
def add_stock(
    api,
    *,
    part: int,
    quantity: float,
    location: int | None = None,
    supplier_part: int | None = None,
    purchase_price: float | None = None,
    currency: str = "",
    condition: str = "ok",
    notes: str = "",
    key: str = "",
) -> Any:
    """
    Create one stock item and stamp its import key on it.

    The key is linked immediately after creation. If that link is refused the
    item is removed again, so a refused import leaves nothing behind rather
    than an untracked pile of stock that the next run would create once more.
    """
    payload: dict[str, Any] = {
        "part": part,
        "quantity": quantity,
        "status": CONDITION_STATUS.get(condition, STATUS_OK),
    }
    if location is not None:
        payload["location"] = location
    if supplier_part is not None:
        payload["supplier_part"] = supplier_part
    if purchase_price is not None:
        payload["purchase_price"] = purchase_price
        if currency:
            payload["purchase_price_currency"] = currency
    if notes:
        payload["notes"] = notes

    item = StockItem.create(api, payload)
    if key:
        try:
            link_barcode(api, key, item.pk)
        except BarcodeInUse:
            try:
                item.delete()
            except Exception:                    # pragma: no cover - best effort
                log.warning("    could not remove stock item %s after a "
                            "refused barcode", item.pk)
            raise
    return item


def stock_note(*parts: str) -> str:
    """Join the things worth recording about where a quantity came from."""
    return "\n".join(part for part in parts if part and part.strip())
