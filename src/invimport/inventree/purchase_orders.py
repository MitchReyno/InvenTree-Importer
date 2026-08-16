"""
Turn DigiKey orders into InvenTree purchase orders.

Importable as a library:

    from invimport import fetch_orders
    from invimport.inventree.purchase_orders import find_supplier, import_orders

    orders = fetch_orders(start_date="2026-01-01")
    supplier = find_supplier(api)                    # existing 'DigiKey' company
    result = import_orders(orders, api, supplier=supplier, write=True)
    print(result.counts())

One InvenTree purchase order is created per DigiKey *sales order*, not per
order: line items hang off the sales order, and a single DigiKey order can be
split across several when it ships in parts.

Nothing is deleted or overwritten. An order already imported is recognised by
its supplier_reference and left alone, so re-running is safe. With write=False
the API is only read from, and the returned actions describe what a write
would do.

Line items need a SupplierPart, and a SupplierPart needs an internal Part - so
a DigiKey line can only be imported if its SKU is already stocked as a supplier
part in InvenTree. Unmatched lines are reported, never invented. By default an
order with any unmatched line is skipped whole, so a purchase order is never
silently short of what was actually bought; pass partial=True to import the
lines that do match.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable

from ..util import dig
from .api import (
    Company,
    InvenTreeError,
    PurchaseOrder,
    PurchaseOrderLineItem,
    SupplierPart,
    connect,
)

log = logging.getLogger(__name__)

# The name a supplier is created under, and the spellings DigiKey trades as -
# an instance set up by hand may well already have one of the others.
SUPPLIER_NAME = "DigiKey"
SUPPLIER_ALIASES = (
    "digikey",
    "digi-key",
    "digikey electronics",
    "digi-key electronics",
    "digikey corporation",
    "digi-key corporation",
)

# Enough to cover any realistic single supplier in one request.
LIST_LIMIT = 1000


@dataclass
class LineAction:
    """What happened (or would happen) to one DigiKey line item."""
    sku: str
    action: str                                  # created | skipped
    quantity: float = 0
    unit_price: float | None = None
    supplier_part: int | None = None
    reason: str = ""
    # DigiKey product details for this SKU, when they were fetched. Carried so
    # an unmatched line can say what the part actually is, rather than leaving
    # the reader to look the SKU up by hand.
    product: dict[str, Any] | None = None

    def describe(self) -> str:
        """Manufacturer part and description, if the product data is here."""
        if not self.product:
            return ""
        bits = [str(self.product.get(field)) for field in
                ("manufacturer_part", "description")
                if self.product.get(field)]
        return "  ".join(bits)


@dataclass
class OrderImport:
    """What happened (or would happen) to one DigiKey sales order."""
    order_number: Any
    sales_order_id: Any
    action: str                                  # created | exists | skipped
    reference: str = ""
    pk: int | None = None
    currency: str = ""
    reason: str = ""
    lines: list[LineAction] = field(default_factory=list)

    @property
    def imported_lines(self) -> int:
        return sum(1 for line in self.lines if line.action == "created")

    @property
    def unmatched(self) -> list[LineAction]:
        return [line for line in self.lines if line.action == "skipped"]


@dataclass
class ImportResult:
    orders: list[OrderImport] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "created": sum(1 for o in self.orders if o.action == "created"),
            "exists": sum(1 for o in self.orders if o.action == "exists"),
            "skipped": sum(1 for o in self.orders if o.action == "skipped"),
            "lines": sum(o.imported_lines for o in self.orders),
            "unmatched": sum(len(o.unmatched) for o in self.orders),
            "problems": len(self.problems),
        }


# --------------------------------------------------------------------------
# Supplier
# --------------------------------------------------------------------------
def list_suppliers(api) -> list[Any]:
    """Every company flagged as a supplier, name-sorted for a stable menu."""
    companies = Company.list(api, is_supplier=True, limit=LIST_LIMIT)
    return sorted(companies, key=lambda c: str(getattr(c, "name", "")).lower())


def find_supplier(api, name: str = SUPPLIER_NAME) -> Any | None:
    """
    Find the supplier to book orders against.

    Matches the given name case-insensitively, then falls back to the known
    DigiKey spellings, so an instance that already calls them 'Digi-Key' is
    recognised rather than gaining a second, near-duplicate company.
    """
    suppliers = list_suppliers(api)
    wanted = name.strip().lower()

    for supplier in suppliers:
        if str(getattr(supplier, "name", "")).strip().lower() == wanted:
            return supplier

    # Only worth guessing at aliases for the default; a name the caller asked
    # for explicitly should match that name or nothing.
    if wanted == SUPPLIER_NAME.lower():
        for supplier in suppliers:
            if str(getattr(supplier, "name", "")).strip().lower() in SUPPLIER_ALIASES:
                return supplier

    return None


def create_supplier(api, name: str = SUPPLIER_NAME, **fields) -> Any:
    """Create a supplier company. Extra fields are passed through untouched."""
    payload = {
        "name": name,
        "description": fields.pop("description", "Electronic component distributor"),
        "website": fields.pop("website", "https://www.digikey.com"),
        "is_supplier": True,
        **fields,
    }
    company = Company.create(api, payload)
    log.info("    created supplier %r (pk=%s)", name, company.pk)
    return company


def supplier_pk(supplier: Any) -> int:
    """Accept a Company or a bare pk, so callers can pass either."""
    return supplier if isinstance(supplier, int) else supplier.pk


# --------------------------------------------------------------------------
# Lookups
# --------------------------------------------------------------------------
def supplier_parts_by_sku(api, supplier: int) -> dict[str, Any]:
    """Index a supplier's parts by SKU, upper-cased so matching is case-blind."""
    parts = SupplierPart.list(api, supplier=supplier, limit=LIST_LIMIT)
    return {str(p.SKU).strip().upper(): p for p in parts if getattr(p, "SKU", None)}


def orders_by_reference(api, supplier: int) -> dict[str, Any]:
    """
    Index a supplier's existing purchase orders by supplier_reference.

    That field holds the DigiKey sales order id, which is what makes a re-run
    idempotent. The API has no supplier_reference filter, so the supplier's
    orders are listed and matched here.
    """
    orders = PurchaseOrder.list(api, supplier=supplier, limit=LIST_LIMIT)
    return {str(o.supplier_reference).strip(): o
            for o in orders if getattr(o, "supplier_reference", None)}


def next_reference(api) -> str:
    """
    Ask the server what the next purchase order reference should be.

    reference is required on create and must satisfy the instance's own
    PURCHASEORDER_REFERENCE_PATTERN, so it cannot be made up here. OPTIONS
    returns the next value in the sequence - the same thing the web UI
    pre-fills a new order with.
    """
    response = api.request("order/po/", method="OPTIONS")
    if response is None or response.status_code != 200:
        code = getattr(response, "status_code", "no response")
        raise InvenTreeError(
            f"could not read the next purchase order reference (OPTIONS "
            f"/api/order/po/ returned {code})"
        )
    reference = dig(response.json(), "actions", "POST", "reference", "default")
    if not reference:
        raise InvenTreeError(
            "the server did not offer a default purchase order reference; "
            "check PURCHASEORDER_REFERENCE_PATTERN in the InvenTree settings"
        )
    return str(reference)


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------
def as_date(value: Any) -> str | None:
    """DigiKey sends ISO timestamps; InvenTree wants a bare date."""
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        return None


def plan_lines(sales_order: dict[str, Any], parts: dict[str, Any],
               products: dict[str, dict[str, Any]] | None = None
               ) -> list[LineAction]:
    """Match each DigiKey line item to a supplier part, without writing."""
    actions: list[LineAction] = []
    products = products or {}

    for item in sales_order.get("line_items") or []:
        sku = str(item.get("digikey_part") or "").strip()
        # Ordered, not shipped: the purchase order records what was bought.
        # A part-shipped line still belongs on it at its full quantity.
        quantity = item.get("quantity_ordered") or item.get("quantity_shipped") or 0
        product = products.get(sku.upper()) if sku else None

        if not sku:
            actions.append(LineAction("", "skipped", quantity,
                                      reason="line item has no DigiKey part number"))
            continue

        part = parts.get(sku.upper())
        if part is None:
            actions.append(LineAction(sku, "skipped", quantity,
                                      reason="no supplier part with this SKU",
                                      product=product))
            continue

        if not quantity:
            actions.append(LineAction(sku, "skipped", quantity,
                                      supplier_part=part.pk,
                                      reason="quantity is zero", product=product))
            continue

        actions.append(LineAction(sku, "created", quantity,
                                  unit_price=item.get("unit_price"),
                                  supplier_part=part.pk, product=product))

    return actions


def import_sales_order(
    api,
    order: dict[str, Any],
    sales_order: dict[str, Any],
    supplier: int,
    parts: dict[str, Any],
    existing: dict[str, Any],
    *,
    write: bool,
    partial: bool,
    products: dict[str, dict[str, Any]] | None = None,
) -> OrderImport:
    """Create one purchase order from one DigiKey sales order."""
    sales_order_id = sales_order.get("sales_order_id")
    reference_key = str(sales_order_id).strip()
    order_number = order.get("order_number")
    currency = sales_order.get("currency") or order.get("currency") or ""

    def outcome(action: str, **kw) -> OrderImport:
        return OrderImport(order_number, sales_order_id, action,
                           currency=currency, **kw)

    if not reference_key or reference_key == "None":
        return outcome("skipped", reason="sales order has no id to key an import on")

    # Already imported: leave it alone rather than book the stock twice.
    already = existing.get(reference_key)
    if already is not None:
        return outcome("exists", reference=str(getattr(already, "reference", "")),
                       pk=already.pk)

    lines = plan_lines(sales_order, parts, products)
    if not lines:
        return outcome("skipped", reason="no line items", lines=lines)

    unmatched = [line for line in lines if line.action == "skipped"]
    # Checked before the strict guard below: with nothing to import there is no
    # "rest", and pointing at --partial would be advice that cannot help.
    if len(unmatched) == len(lines):
        return outcome("skipped", lines=lines,
                       reason="no line item matched a supplier part")
    if unmatched and not partial:
        return outcome(
            "skipped", lines=lines,
            reason=f"{len(unmatched)} of {len(lines)} line item(s) have no "
                   f"supplier part - use --partial to import the rest",
        )

    # A dry run stops here: without a real purchase order there is no pk to
    # hang line items off, so the plan above is as far as it can go.
    if not write:
        return outcome("created", lines=lines)

    payload = {
        "supplier": supplier,
        "reference": next_reference(api),
        "supplier_reference": reference_key,
        "description": f"DigiKey order {order_number}"[:250],
    }
    if currency:
        payload["order_currency"] = currency
    created_on = as_date(order.get("date_entered") or sales_order.get("date_entered"))
    if created_on:
        payload["creation_date"] = created_on

    purchase_order = PurchaseOrder.create(api, payload)
    existing[reference_key] = purchase_order

    for line in lines:
        if line.action != "created":
            continue
        item = {
            "order": purchase_order.pk,
            "part": line.supplier_part,
            "quantity": line.quantity,
        }
        if line.unit_price is not None:
            item["purchase_price"] = line.unit_price
            if currency:
                item["purchase_price_currency"] = currency
        PurchaseOrderLineItem.create(api, item)

    log.info("    %s <- DigiKey sales order %s (%s line item(s))",
             purchase_order.reference, reference_key,
             sum(1 for line in lines if line.action == "created"))

    return outcome("created", reference=str(purchase_order.reference),
                   pk=purchase_order.pk, lines=lines)


def import_orders(
    orders: Iterable[dict[str, Any]],
    api=None,
    *,
    supplier: Any,
    write: bool = False,
    partial: bool = False,
    products: dict[str, dict[str, Any]] | None = None,
) -> ImportResult:
    """
    Import DigiKey orders as InvenTree purchase orders.

    orders are the flattened dicts fetch_orders() returns. supplier is a
    Company or its pk. Pass an existing api handle to reuse a connection; omit
    it and one is created from the environment.

    products, if given, maps an upper-cased SKU to the row fetch_products()
    returns; each line item carries its match so an unmatched SKU can be
    reported as a real part rather than a bare number.

    Returns everything that happened, or with write=False everything that
    would happen.
    """
    api = api or connect()
    supplier = supplier_pk(supplier)

    parts = supplier_parts_by_sku(api, supplier)
    existing = orders_by_reference(api, supplier)
    log.info("    %s supplier part(s), %s existing purchase order(s)",
             len(parts), len(existing))

    result = ImportResult()

    for order in orders:
        sales_orders = order.get("sales_orders") or []
        if not sales_orders:
            result.problems.append(
                f"order {order.get('order_number')}: no sales orders to import")
            continue

        for sales_order in sales_orders:
            try:
                result.orders.append(import_sales_order(
                    api, order, sales_order, supplier, parts, existing,
                    write=write, partial=partial, products=products,
                ))
            except Exception as exc:                      # one bad order
                # should not lose the rest of the batch
                result.problems.append(
                    f"order {order.get('order_number')} / sales order "
                    f"{sales_order.get('sales_order_id')}: {exc}")

    return result
