"""
Fetch order history and sales orders from the DigiKey OrderStatus API v4.

Reports order/sales-order status, line items with ordered vs shipped
quantities, unit and total price, and shipment tracking numbers.

Responses are cached to .cache/.digikey/orders (--cache-dir). Mind that order
data is live: statuses, shipments and tracking numbers change after an order is
placed, and a history sweep will not show orders placed since the page was
cached. Pass --refresh whenever the answer has to be current.

Needs DIGIKEY_ACCOUNT_ID: under two-legged OAuth there is no signed-in user, so
DigiKey must be told whose orders to return.

    invimport orders                                  # last 30 days
    invimport orders --start-date 2026-01-01 --end-date 2026-06-30 --shared
    invimport orders --order 87654321

The logic lives in invimport.digikey.orders; this module is only the CLI.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from .. import cache
from ..digikey.api import connect
from ..digikey.orders import (
    DEFAULT_DAYS,
    default_range,
    fetch_orders,
    fetch_sales_orders,
)
from ._args import add_digikey_args, add_output_args

NAME = "orders"
HELP = "fetch DigiKey order history and sales orders"


def iso_date(value: str) -> str:
    """argparse type: validate a YYYY-MM-DD date, as the API requires."""
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"{value!r} is not a YYYY-MM-DD date") from None


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--order", type=int, action="append", default=[],
                        metavar="SALESORDERID", dest="order_ids",
                        help="fetch one sales order by id instead of a history "
                             "range; repeatable")
    parser.add_argument("--start-date", type=iso_date, metavar="YYYY-MM-DD",
                        help=f"history start (default: {DEFAULT_DAYS} days ago)")
    parser.add_argument("--end-date", type=iso_date, metavar="YYYY-MM-DD",
                        help="history end (default: today)")
    parser.add_argument("--shared", action="store_true",
                        help="include all orders on the account, not just your own")
    parser.add_argument("--cache-dir", type=Path, default=cache.ORDERS_DIR)
    add_output_args(parser)
    add_digikey_args(parser)


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------
def print_sales_order(so: dict[str, Any], indent: str = "    ") -> None:
    parts = [f"sales order {so['sales_order_id']}"]
    if so.get("status"):
        parts.append(f"status={so['status']}")
    if so.get("total_price") is not None:
        parts.append(f"total={so['total_price']} {so.get('currency') or ''}".strip())
    if so.get("ship_method"):
        parts.append(f"ship={so['ship_method']}")
    print(indent + "  ".join(parts))

    for li in so["line_items"]:
        qty = f"{li.get('quantity_shipped') or 0}/{li.get('quantity_ordered') or 0}"
        print(f"{indent}    {str(li.get('digikey_part') or '?'):<24} "
              f"{str(li.get('manufacturer_part') or '?'):<24} "
              f"qty {qty:<10} @ {li.get('unit_price')}")
        if li.get("description"):
            print(f"{indent}        {li['description']}")
        if li.get("quantity_backorder"):
            print(f"{indent}        [backorder] {li['quantity_backorder']}")
        for ship in li["shipments"]:
            bits = [f"shipped {ship.get('quantity')}"]
            if ship.get("shipped_date"):
                bits.append(f"on {ship['shipped_date']}")
            if ship.get("tracking_number"):
                bits.append(f"tracking {ship['tracking_number']}")
            print(f"{indent}        " + "  ".join(bits))


def print_order(order: dict[str, Any]) -> None:
    header = f"[order {order['order_number']}]"
    if order.get("date_entered"):
        header += f"  entered={order['date_entered']}"
    if order.get("purchase_order"):
        header += f"  po={order['purchase_order']}"
    if order.get("status"):
        header += f"  status={order['status']}"
    print(header)
    for so in order["sales_orders"]:
        print_sales_order(so)


def run(args: argparse.Namespace) -> int:
    client = connect(sandbox=args.sandbox, need_account=True)

    def show(item, raw, printer):
        if args.raw:
            print(json.dumps(raw, indent=2))
        printer(item)
        print()

    # --order is an explicit lookup; only sweep history without it.
    if args.order_ids:
        sales_orders = fetch_sales_orders(
            args.order_ids, client,
            cache_dir=args.cache_dir, refresh=args.refresh,
            on_order=lambda so, raw: show(so, raw, print_sales_order),
        )
        # A bare sales order has no parent Order wrapper; report it on its own.
        collected = [{"order_number": None, "sales_orders": [so]}
                     for so in sales_orders]
    else:
        start, end = default_range(args.start_date, args.end_date)
        if start > end:
            print(f"ERROR: --start-date {start} is after --end-date {end}",
                  file=sys.stderr)
            return 2

        scope = "all account orders" if args.shared else "your orders"
        print(f"Order history {start} .. {end} ({scope})")

        collected = fetch_orders(
            client, start_date=start, end_date=end, shared=args.shared,
            cache_dir=args.cache_dir, refresh=args.refresh,
            on_order=lambda order, raw: show(order, raw, print_order),
        )

    if args.json:
        args.json.write_text(json.dumps(collected, indent=2), encoding="utf-8")
        print(f"results -> {args.json}")

    return 0
