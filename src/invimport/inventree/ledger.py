"""
What a run wrote to the server, record by record.

    from invimport.inventree import ledger

    with ledger.recording() as book:
        ...                                      # create, attach, upload
    for (model, pk), events in book.records().items():
        ...

The few places that write - every create (one override in api.py), every
attachment, every image upload, notes, linking stock to an order - note what
they did here. Outside recording() they note nothing, so the library behaves
exactly as before for any caller that does not ask.

The provenance JSON kept with each record is built from this: it is the only
account of what a run actually changed, as opposed to what the file asked for.
Writes happen on worker threads (parameters are created in parallel), so the
book is guarded by a lock rather than held in a context variable, which a
thread pool would not carry.
"""

from __future__ import annotations

import hashlib
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

# What happened to a record.
CREATED = "created"
PARAMETER_ADDED = "parameter added"
PARAMETER_UPDATED = "parameter updated"
LINE_ADDED = "order line added"
FILE_ATTACHED = "file attached"
IMAGE_SET = "image set"
NOTES_WRITTEN = "notes written"
LINKED_TO_ORDER = "linked to purchase order"

# API route -> the model name InvenTree's attachments use for it.
MODELS = {
    "part": "part",
    "company/part/manufacturer": "manufacturerpart",
    "company/part": "supplierpart",
    "company": "company",
    "stock": "stockitem",
    "stock/location": "stocklocation",
    "order/po": "purchaseorder",
    "part/category": "partcategory",
    "parameter/template": "parametertemplate",
    "units": "customunit",
}

# Payload fields worth keeping on a create; the rest is noise or repeated.
_KEPT = ("name", "IPN", "description", "category", "MPN", "SKU",
         "manufacturer", "supplier", "part", "manufacturer_part", "link",
         "quantity", "location", "batch", "packaging", "status",
         "reference", "supplier_reference", "is_manufacturer", "is_supplier",
         "purchase_price", "purchase_price_currency", "parent", "pathstring")


@dataclass
class Event:
    model: str
    pk: int
    what: str
    detail: dict[str, Any] = field(default_factory=dict)
    at: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {"what": self.what, "at": self.at, **self.detail}


class Ledger:
    """Every write of one run, in the order they happened."""

    def __init__(self, parent: Ledger | None = None) -> None:
        self.events: list[Event] = []
        self._lock = threading.Lock()
        # An enclosing recording sees what a nested one notes as well.
        self._parent = parent

    def note(self, model: str, pk: Any, what: str, **detail: Any) -> None:
        try:
            pk = int(pk)
        except (TypeError, ValueError):
            return
        event = Event(model, pk, what,
                      {k: v for k, v in detail.items()
                       if v not in (None, "", [], {})},
                      datetime.now(timezone.utc).isoformat(timespec="seconds"))
        self._add(event)

    def _add(self, event: Event) -> None:
        with self._lock:
            self.events.append(event)
        if self._parent is not None:
            self._parent._add(event)

    def records(self) -> dict[tuple[str, int], list[Event]]:
        """Events grouped by record, records in the order first touched."""
        grouped: dict[tuple[str, int], list[Event]] = {}
        with self._lock:
            for event in self.events:
                grouped.setdefault((event.model, event.pk), []).append(event)
        return grouped


_active: Ledger | None = None


@contextmanager
def recording() -> Iterator[Ledger]:
    """Note every write made inside the block, nested blocks included."""
    global _active
    previous = _active
    _active = Ledger(parent=previous)
    try:
        yield _active
    finally:
        _active = previous


def note(model: str, pk: Any, what: str, **detail: Any) -> None:
    if _active is not None:
        _active.note(model, pk, what, **detail)


def created(route: str, pk: Any, payload: dict[str, Any]) -> None:
    """A create through the API: the record itself, or a row on another."""
    if _active is None:
        return
    route = route.strip("/")
    if route == "parameter":
        # A parameter belongs to the record it describes.
        model = str(payload.get("model_type") or "").rpartition(".")[2]
        note(model, payload.get("model_id"), PARAMETER_ADDED,
             template=payload.get("template"), value=payload.get("data"))
        return
    if route == "order/po-line":
        note("purchaseorder", payload.get("order"), LINE_ADDED,
             supplier_part=payload.get("part"),
             quantity=payload.get("quantity"),
             purchase_price=payload.get("purchase_price"),
             purchase_price_currency=payload.get("purchase_price_currency"))
        return
    model = MODELS.get(route)
    if model is None:
        return
    note(model, pk, CREATED, **{k: payload.get(k) for k in _KEPT})


def file_facts(path: Path) -> dict[str, Any]:
    """Name, size and digest of a file sent to the server."""
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        size = path.stat().st_size
    except OSError:
        return {"file": path.name}
    return {"file": path.name, "size": size, "sha256": digest.hexdigest()}
