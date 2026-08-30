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
