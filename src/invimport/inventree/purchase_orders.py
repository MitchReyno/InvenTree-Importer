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
its supplier_reference, so re-running will not book a second purchase order.
Missing stock items are still created: each line is received against the
order if that order does not already have a stock item for it. With
write=False the API is only read from, and the returned actions describe
what a write would do.

Line items need a SupplierPart, and a SupplierPart needs an internal Part - so
a DigiKey line can only be imported if its SKU is already stocked as a supplier
part in InvenTree. Unmatched lines are reported, never invented. By default an
order with any unmatched line is skipped whole, so a purchase order is never
silently short of what was actually bought; pass partial=True to import the
lines that do match.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date
from types import SimpleNamespace
from typing import Any, Iterable

from ..util import dig
from .matching import candidates, company_aliases, match_name
from .api import (
    Company,
    InvenTreeError,
    PurchaseOrder,
    PurchaseOrderLineItem,
    StockItem,
    StockLocation,
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

# InvenTree status codes used when receiving imported stock.
PO_PENDING = 10
STOCK_OK = 10


@dataclass
class LineAction:
    """What happened (or would happen) to one DigiKey line item."""
    sku: str
    action: str                                  # created | exists | skipped
    quantity: float = 0
    unit_price: float | None = None
    supplier_part: int | None = None
    reason: str = ""
    stock: str = ""                              # created | exists | skipped | ""
    stock_item: int | None = None
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
    def imported_stock(self) -> int:
        return sum(1 for line in self.lines if line.stock == "created")

    @property
    def unmatched(self) -> list[LineAction]:
        return [line for line in self.lines if line.action == "skipped"]


@dataclass
class ImportResult:
    orders: list[OrderImport] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    # Set when create_parts ran, so the CLI can report the parts too.
    parts: Any = None

    def counts(self) -> dict[str, int]:
        return {
            "created": sum(1 for o in self.orders if o.action == "created"),
            "exists": sum(1 for o in self.orders if o.action == "exists"),
            "skipped": sum(1 for o in self.orders if o.action == "skipped"),
            "lines": sum(o.imported_lines for o in self.orders),
            "stock": sum(o.imported_stock for o in self.orders),
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
        "is_supplier": True,
        **fields,
    }
    # Only DigiKey gets a default website. Stamping digikey.com onto a company
    # called 'Rockby Electronics' would be a fact nobody stated.
    website = fields.pop("website", None)
    if website:
        payload["website"] = website
    elif name.strip().casefold() in SUPPLIER_ALIASES or name == SUPPLIER_NAME:
        payload["website"] = "https://www.digikey.com"
    company = Company.create(api, payload)
    log.info("    created supplier %r (pk=%s)", name, company.pk)
    return company


# 'salash (eBay)', '33audiomarko (eBay)' - a seller on a marketplace, not a
# distributor. The parenthesised part names the company; the rest is who sold
# it, which belongs on the stock item, not in the company list.
MARKETPLACE = re.compile(r"^\s*(?P<seller>.+?)\s*\(\s*(?P<market>[^()]+?)\s*\)\s*$")


def split_marketplace(name: str, suppliers: dict[str, Any]
                      ) -> tuple[str, str]:
    """
    'salash (eBay)' -> ('eBay', 'salash'), when eBay is a configured supplier.

    Driven by suppliers.yaml rather than a hard-coded list, so adding
    Tindie or AliExpress is a config change. A name whose bracketed part is
    not a known supplier is left alone - '(Max)' and '(2024)' are not
    marketplaces.
    """
    match = MARKETPLACE.match(name or "")
    if not match:
        return name, ""
    market = match.group("market")
    matched = match_name(market, list(suppliers), company_aliases(suppliers))
    if not matched:
        return name, ""
    return matched, match.group("seller").strip()


def resolve_supplier(
    api,
    name: str,
    suppliers: dict[str, Any],
    *,
    choose=None,
    create: bool = False,
    write: bool = False,
    cache: dict[str, Any] | None = None,
) -> Any | None:
    """
    The supplier Company this spelling means, or None.

    The same shape as resolve_manufacturer: exact after normalisation, then a
    learned alias, then - only if the caller offers a chooser - a fuzzy prompt.
    Nothing is created silently.
    """
    if not name or not name.strip():
        return None
    name = name.strip()
    if cache is not None and name in cache:
        return cache[name]

    wanted, _seller = split_marketplace(name, suppliers)

    existing = list_suppliers(api)
    names = [c.name for c in existing]
    matched = match_name(wanted, names, company_aliases(suppliers))
    company = None
    if matched:
        company = next((c for c in existing if c.name == matched), None)
        if company is None and (create or write):
            company = (create_supplier(api, matched) if write
                       else SimpleNamespace(pk=-1, name=matched))

    if company is None and create:
        company = (create_supplier(api, wanted) if write
                   else SimpleNamespace(pk=-1, name=wanted))

    if company is None and choose is not None:
        offered = [(c, score) for c, score in
                   ((next((x for x in existing if x.name == n), None), s)
                    for n, s in candidates(wanted, names))
                   if c is not None]
        picked = choose(wanted, offered)
        if isinstance(picked, str) and picked.strip():
            company = (create_supplier(api, picked.strip()) if write
                       else SimpleNamespace(pk=-1, name=picked.strip()))
        elif picked is not None and not isinstance(picked, str):
            company = picked

    if cache is not None:
        cache[name] = company
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


def default_stock_location(api) -> int | None:
    """
    Pick a destination for received stock when the caller did not name one.

    One location is unambiguous. Several: prefer a top-level location so
    imported stock does not land in a nested bin by accident. None at all
    means the order can still be booked, but nothing can be received.
    """
    locations = StockLocation.list(api, limit=LIST_LIMIT)
    if not locations:
        return None
    if len(locations) == 1:
        return locations[0].pk
    roots = [loc for loc in locations
             if getattr(loc, "parent", None) in (None, "")]
    return (roots[0] if roots else locations[0]).pk


def receive_stock(
    api,
    po,
    booked: list[tuple[LineAction, Any]],
    *,
    write: bool,
    location: int | None,
) -> None:
    """
    Receive each line that does not already have a stock item on this order.

    Existence is checked two ways: a StockItem already linked to the
    purchase order for that supplier part, or the line's received quantity
    already covering it. Either one is enough to leave the line alone, so a
    re-run cannot double-book stock.

    Receiving is the InvenTree path (issue, then POST receive) so line.received
    stays in sync with the stock items. location is required by that endpoint;
    without one the lines are marked skipped and nothing is posted.
    """
    existing: list[Any] = []
    if po is not None:
        existing = list(StockItem.list(api, purchase_order=po.pk, limit=LIST_LIMIT))
    claimed: set[int] = set()

    outstanding: list[dict[str, Any]] = []
    for action, po_line in booked:
        if action.action not in ("created", "exists"):
            continue
        if not action.supplier_part:
            continue

        match = next(
            (item for item in existing
             if item.pk not in claimed
             and getattr(item, "supplier_part", None) == action.supplier_part),
            None,
        )
        if match is not None:
            claimed.add(match.pk)
            action.stock = "exists"
            action.stock_item = match.pk
            continue

        received = float(getattr(po_line, "received", 0) or 0) if po_line else 0
        remaining = float(action.quantity) - received
        if remaining <= 0:
            action.stock = "exists"
            continue

        if location is None:
            action.stock = "skipped"
            continue

        action.stock = "created"
        if write and po is not None and po_line is not None:
            outstanding.append({
                "line_item": po_line.pk,
                "supplier_part": action.supplier_part,
                "quantity": remaining,
                "status": STOCK_OK,
                "location": location,
            })

    if not outstanding:
        return

    status = getattr(po, "status", PO_PENDING)
    if status is None or int(status) == PO_PENDING:
        api.post(f"order/po/{po.pk}/issue/", {})
        try:
            po.status = 20
        except Exception:
            pass

    api.post(f"order/po/{po.pk}/receive/", {
        "items": outstanding,
        "location": location,
    })


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


def line_skus(orders: Iterable[dict[str, Any]]) -> list[str]:
    """Every DigiKey part number across these orders, sorted and deduplicated."""
    return sorted({
        str(item.get("digikey_part") or "").strip()
        for order in orders
        for sales_order in (order.get("sales_orders") or [])
        for item in (sales_order.get("line_items") or [])
        if item.get("digikey_part")
    })


def unmatched_skus(orders: Iterable[dict[str, Any]],
                   parts: dict[str, Any]) -> list[str]:
    """
    The SKUs in these orders that are not yet supplier parts.

    Worth knowing *before* booking anything: a line item needs a supplier
    part, so these are exactly the lines that would be reported as unmatched
    and skipped. The CLI asks whether to create them rather than failing and
    telling the user to go and do it by hand.
    """
    return [sku for sku in line_skus(orders) if sku.upper() not in parts]


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
    location: int | None = None,
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

    # Already imported: do not book a second purchase order, but still
    # receive any line that has no stock item on this one yet.
    already = existing.get(reference_key)
    if already is not None:
        parts_by_pk = {p.pk: p for p in parts.values()}
        po_lines = PurchaseOrderLineItem.list(api, order=already.pk, limit=LIST_LIMIT)
        actions: list[LineAction] = []
        booked: list[tuple[LineAction, Any]] = []
        for po_line in po_lines:
            sp = parts_by_pk.get(po_line.part)
            sku = str(getattr(sp, "SKU", "") or "")
            action = LineAction(sku, "exists", float(po_line.quantity),
                                supplier_part=po_line.part)
            actions.append(action)
            booked.append((action, po_line))
        receive_stock(api, already, booked, write=write, location=location)
        return outcome("exists", reference=str(getattr(already, "reference", "")),
                       pk=already.pk, lines=actions)

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
    # hang line items off, so the plan above is as far as it can go. Stock
    # is still marked so the preview includes what a write would receive.
    if not write:
        receive_stock(api, None, [(line, None) for line in lines],
                      write=False, location=location)
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

    booked: list[tuple[LineAction, Any]] = []
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
        booked.append((line, PurchaseOrderLineItem.create(api, item)))

    receive_stock(api, purchase_order, booked, write=True, location=location)

    log.info("    %s <- DigiKey sales order %s (%s line item(s), %s stock)",
             purchase_order.reference, reference_key,
             sum(1 for line in lines if line.action == "created"),
             sum(1 for line in lines if line.stock == "created"))

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
    create_parts: bool = False,
    directory: Any = None,
    update_parameters: bool = False,
    create_manufacturers: bool = False,
    choose_manufacturer=None,
    location: int | None = None,
) -> ImportResult:
    """
    Import DigiKey orders as InvenTree purchase orders.

    orders are the flattened dicts fetch_orders() returns. supplier is a
    Company or its pk. Pass an existing api handle to reuse a connection; omit
    it and one is created from the environment.

    products, if given, maps an upper-cased SKU to the row fetch_products()
    returns; each line item carries its match so an unmatched SKU can be
    reported as a real part rather than a bare number.

    create_parts sends unmatched SKUs through import_supplier_parts first.
    In a dry run those SKUs are treated as if the supplier parts would
    exist, so the order preview shows what a write would book.

    location is the stock location pk received items land in. Omit it and
    the only (or first top-level) location on the server is used. Without
    any location, purchase orders are still created but stock is skipped.

    Returns everything that happened, or with write=False everything that
    would happen.
    """
    api = api or connect()
    supplier = supplier_pk(supplier)
    if location is None:
        location = default_stock_location(api)

    parts = supplier_parts_by_sku(api, supplier)
    existing = orders_by_reference(api, supplier)
    log.info("    %s supplier part(s), %s existing purchase order(s)",
             len(parts), len(existing))

    part_result = None
    if create_parts:
        orders = list(orders)
        missing = unmatched_skus(orders, parts)
        if missing:
            from .parts import import_supplier_parts
            created = import_supplier_parts(
                missing, api, write=write, products=products,
                directory=directory, supplier=supplier,
                update_parameters=update_parameters,
                create_manufacturers=create_manufacturers,
                choose_manufacturer=choose_manufacturer,
                fetch=not products,
            )
            if write:
                parts = supplier_parts_by_sku(api, supplier)
            else:
                for action in created.skus:
                    if action.action in ("created", "exists"):
                        parts[action.sku.strip().upper()] = SimpleNamespace(
                            pk=action.supplier_part or -1)
            part_result = created

    result = ImportResult(parts=part_result)

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
                    location=location,
                ))
            except Exception as exc:                      # one bad order
                # should not lose the rest of the batch
                result.problems.append(
                    f"order {order.get('order_number')} / sales order "
                    f"{sales_order.get('sales_order_id')}: {exc}")

    if any(line.stock == "skipped"
           for imported in result.orders
           for line in imported.lines):
        result.problems.append(
            "no stock location to receive into - create one in InvenTree "
            "or pass location="
        )

    return result
