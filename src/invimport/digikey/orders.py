"""
DigiKey OrderStatus API v4 - fetching and parsing.

Importable as a library:

    from invimport.digikey.orders import fetch_orders, fetch_sales_orders

    orders = fetch_orders(start_date="2026-01-01", end_date="2026-06-30")
    for order in orders:
        for so in order["sales_orders"]:
            for line in so["line_items"]:
                print(line["digikey_part"], line["quantity_shipped"])

Responses are cached to .cache/.digikey/orders. Order data is live - statuses,
shipments and tracking numbers move after an order is placed, and a cached
history page will not show orders placed since it was written. Pass
refresh=True whenever the answer has to be current.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Iterable

from .. import cache
from .api import (
    ORDER_SEARCH_URL,
    SALES_ORDER_URL,
    SANDBOX_ORDER_SEARCH_URL,
    SANDBOX_SALES_ORDER_URL,
    Client,
    connect,
)
from ..util import dig

log = logging.getLogger(__name__)

# PageSize is capped at 25 by the API.
PAGE_SIZE = 25
MAX_PAGES = 200      # safety net so a bad TotalOrders cannot loop forever
DEFAULT_DAYS = 30    # matches the API's own default window


def default_range(start_date: str | None = None,
                  end_date: str | None = None) -> tuple[str, str]:
    """Fill in either end of the history window, defaulting to the last 30 days."""
    end = end_date or date.today().isoformat()
    start = start_date or (date.today() - timedelta(days=DEFAULT_DAYS)).isoformat()
    return start, end


# --------------------------------------------------------------------------
# Fetch
# --------------------------------------------------------------------------
def fetch_order_history(client: Client, start_date: str, end_date: str,
                        shared: bool = False, cache_dir: Path = cache.ORDERS_DIR,
                        refresh: bool = False) -> list[dict[str, Any]]:
    """Page through GET /orderstatus/v4/orders and return every raw Order."""
    url = SANDBOX_ORDER_SEARCH_URL if client.sandbox else ORDER_SEARCH_URL

    orders: list[dict[str, Any]] = []
    total: int | None = None

    for page in range(1, MAX_PAGES + 1):
        params = {
            "StartDate": start_date,
            "EndDate": end_date,
            "Shared": "true" if shared else "false",
            "PageNumber": page,
            "PageSize": PAGE_SIZE,
        }
        # Every parameter that changes the result set is in the key, so a
        # different window or scope cannot collide with this one.
        scope = "shared" if shared else "own"
        key = f"history-{start_date}_{end_date}-{scope}-p{page}"

        data = None if refresh else cache.load(cache_dir, key)
        if data is None:
            data = client.get(url, params=params, label=f"orders page {page}",
                              with_account=True)
            if data is not None:
                cache.store(cache_dir, key, data)
        if data is None:
            break

        batch = data.get("Orders") or []
        if total is None:
            total = data.get("TotalOrders")
            log.info("    %s order(s) in range", total if total is not None else "?")

        orders.extend(batch)

        # Stop on a short page, an empty page, or once we have them all.
        if not batch or len(batch) < PAGE_SIZE:
            break
        if total is not None and len(orders) >= total:
            break
    else:
        log.warning("    [warn] stopped at the %s-page safety limit", MAX_PAGES)

    return orders


def fetch_sales_order_payload(client: Client, sales_order_id: int,
                              cache_dir: Path = cache.ORDERS_DIR,
                              refresh: bool = False) -> dict[str, Any] | None:
    """Fetch the raw payload for a single sales order."""
    key = f"salesorder-{sales_order_id}"
    if not refresh:
        cached = cache.load(cache_dir, key)
        if cached is not None:
            return cached

    template = SANDBOX_SALES_ORDER_URL if client.sandbox else SALES_ORDER_URL
    url = template.format(sales_order_id=sales_order_id)
    data = client.get(url, label=f"salesorder {sales_order_id}", with_account=True)
    if data is not None:
        cache.store(cache_dir, key, data)
    return data


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
def extract_line_item(item: dict[str, Any]) -> dict[str, Any]:
    """Flatten a LineItem into the fields an import cares about."""
    return {
        "digikey_part": dig(item, "DigiKeyProductNumber"),
        "manufacturer_part": dig(item, "ManufacturerProductNumber"),
        "description": dig(item, "Description"),
        "packaging": dig(item, "PackType"),
        "quantity_ordered": dig(item, "QuantityOrdered"),
        "quantity_shipped": dig(item, "QuantityShipped"),
        "quantity_backorder": dig(item, "QuantityBackOrder"),
        "unit_price": dig(item, "UnitPrice"),
        "total_price": dig(item, "TotalPrice"),
        "customer_reference": dig(item, "CustomerReference"),
        "country_of_origin": dig(item, "CountryOfOrigin"),
        "shipments": [
            {
                "quantity": dig(ship, "QuantityShipped"),
                "shipped_date": dig(ship, "ShippedDate"),
                "tracking_number": dig(ship, "TrackingNumber"),
                "expected_delivery": dig(ship, "ExpectedDeliveryDate"),
                "invoice_id": dig(ship, "InvoiceId"),
            }
            for ship in (item.get("ItemShipments") or [])
        ],
    }


def extract_sales_order(so: dict[str, Any]) -> dict[str, Any]:
    """Flatten a SalesOrder plus its line items."""
    return {
        "sales_order_id": dig(so, "SalesOrderId"),
        "status": dig(so, "Status", "SalesOrderStatus"),
        "status_description": dig(so, "Status", "ShortDescription"),
        "purchase_order": dig(so, "PurchaseOrder"),
        "date_entered": dig(so, "DateEntered"),
        "ship_method": dig(so, "ShipMethod"),
        "currency": dig(so, "Currency"),
        "total_price": dig(so, "TotalPrice"),
        "line_items": [extract_line_item(li) for li in (so.get("LineItems") or [])],
    }


def extract_order(order: dict[str, Any]) -> dict[str, Any]:
    """Flatten an Order and the sales orders nested under it."""
    return {
        "order_number": dig(order, "OrderNumber"),
        "customer_id": dig(order, "CustomerId"),
        "date_entered": dig(order, "DateEntered"),
        "purchase_order": dig(order, "PONumber"),
        "currency": dig(order, "Currency"),
        "status": dig(order, "EntireOrderStatus", "OrderStatus"),
        "status_description": dig(order, "EntireOrderStatus", "ShortDescription"),
        "sales_orders": [
            extract_sales_order(so) for so in (order.get("SalesOrders") or [])
        ],
    }


# --------------------------------------------------------------------------
# Public entrypoints
# --------------------------------------------------------------------------
def fetch_orders(
    client: Client | None = None,
    *,
    start_date: str | None = None,
    end_date: str | None = None,
    shared: bool = False,
    cache_dir: Path = cache.ORDERS_DIR,
    refresh: bool = False,
    sandbox: bool = False,
    on_order: Callable[[dict[str, Any], dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch order history over a date range (defaults to the last 30 days) and
    return one flattened dict per order.

    Dates are YYYY-MM-DD. Raises ValueError if the range is inverted.
    """
    start, end = default_range(start_date, end_date)
    if start > end:
        raise ValueError(f"start_date {start} is after end_date {end}")

    client = client or connect(sandbox=sandbox, need_account=True)
    orders: list[dict[str, Any]] = []

    for raw in fetch_order_history(client, start, end, shared, cache_dir, refresh):
        order = extract_order(raw)
        orders.append(order)
        if on_order:
            on_order(order, raw)

    return orders


def fetch_sales_orders(
    sales_order_ids: Iterable[int],
    client: Client | None = None,
    *,
    cache_dir: Path = cache.ORDERS_DIR,
    refresh: bool = False,
    sandbox: bool = False,
    on_order: Callable[[dict[str, Any], dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch specific sales orders by id. Ids with no result are skipped, so the
    output can be shorter than the input.
    """
    client = client or connect(sandbox=sandbox, need_account=True)
    found: list[dict[str, Any]] = []

    for sales_order_id in sales_order_ids:
        raw = fetch_sales_order_payload(client, sales_order_id, cache_dir, refresh)
        if raw is None:
            continue
        so = extract_sales_order(raw)
        found.append(so)
        if on_order:
            on_order(so, raw)

    return found


def line_items(orders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Flatten nested orders into one row per line item, each carrying its order
    and sales-order context. Convenient for feeding an import.
    """
    rows: list[dict[str, Any]] = []
    for order in orders:
        for so in order.get("sales_orders") or []:
            for line in so.get("line_items") or []:
                rows.append({
                    "order_number": order.get("order_number"),
                    "sales_order_id": so.get("sales_order_id"),
                    "order_date": order.get("date_entered") or so.get("date_entered"),
                    "currency": so.get("currency") or order.get("currency"),
                    **line,
                })
    return rows
