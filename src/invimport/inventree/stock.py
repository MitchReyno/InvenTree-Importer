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
from dataclasses import dataclass
from typing import Any

from .api import StockItem, StockLocation

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


def enrich_hit(api, hit: BarcodeHit) -> BarcodeHit:
    """Fill in details the barcode response omitted, if the object is there."""
    path = ENRICH_PATHS.get(hit.kind)
    if not path:
        return hit
    try:
        extra = api.get(path.format(pk=hit.pk))
    except Exception:
        return hit
    if not isinstance(extra, dict):
        return hit
    return BarcodeHit(
        kind=hit.kind, pk=hit.pk,
        payload={**hit.payload, **extra},
        scan=hit.scan, url=hit.url,
    )


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


def hit_rows(hit: BarcodeHit) -> list[tuple[str, str]]:
    """Labelled fields worth showing for this hit."""
    data = hit.payload
    rows: list[tuple[str, str]] = [
        ("Type", hit.type_label),
        ("ID", str(hit.pk)),
    ]

    def add(key: str, label: str, source: dict | None = None) -> None:
        value = (source or data).get(key)
        if value not in (None, ""):
            rows.append((label, str(value)))

    if hit.kind == "part":
        add("IPN", "IPN")
        add("name", "Name")
        add("description", "Description")
        add("units", "Units")
        add("total_in_stock", "In stock")
        category = data.get("category_detail")
        if isinstance(category, dict) and category.get("pathstring"):
            rows.append(("Category", str(category["pathstring"])))
        elif data.get("category_path"):
            rows.append(("Category", str(data["category_path"])))
    elif hit.kind == "stockitem":
        part = data.get("part_detail") if isinstance(data.get("part_detail"), dict) else {}
        location = data.get("location_detail") if isinstance(
            data.get("location_detail"), dict) else {}
        part_name = " ".join(
            str(v) for v in (part.get("IPN"), part.get("full_name") or part.get("name"))
            if v)
        if part_name:
            rows.append(("Part", part_name))
        elif data.get("part"):
            rows.append(("Part", str(data["part"])))
        add("quantity", "Quantity")
        add("serial", "Serial")
        add("batch", "Batch")
        add("status_text", "Status")
        path = location.get("pathstring") or location.get("name")
        if path:
            rows.append(("Location", str(path)))
        elif data.get("location"):
            rows.append(("Location", str(data["location"])))
    elif hit.kind == "stocklocation":
        add("name", "Name")
        add("pathstring", "Path")
        add("description", "Description")
    return rows


def hit_markdown(hit: BarcodeHit) -> str:
    lines = [f"**{hit.type_label}** `{hit.pk}` — {hit.title}", ""]
    for label, value in hit_rows(hit):
        if label in {"Type", "ID"}:
            continue
        lines.append(f"- **{label}:** {value}")
    return "\n".join(lines)


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
