"""
Import DigiKey orders into InvenTree as purchase orders.

Fetches order history (the same call `invimport orders` makes), lets you pick
which orders to import from a checklist, fetches the product details for
everything on the chosen orders, and books each one as a purchase order against
a DigiKey supplier.

The product lookup runs after the selection is submitted, so only the orders
being imported cost API calls. It is what lets an unmatched SKU be reported as
a real part - manufacturer part number and description - rather than a bare
number. --no-products skips it.

    invimport import-orders                              # dry run, last 30 days
    invimport import-orders --start-date 2026-01-01 --write
    invimport import-orders --order 87654321 --write
    invimport import-orders --all --supplier 1 --write   # no prompts

Dry run by default, like `invimport parameters`. Nothing is written until
--write, and the checklist is shown either way so a dry run previews exactly
what a real one would do.

Supplier
--------
Looks for a company named 'DigiKey' (or one of the usual spellings) flagged as
a supplier. If there is not one, you are offered the choice of creating it or
matching it to an existing supplier under a different name. --supplier takes a
name or pk and skips the question.

Line items
----------
A DigiKey line can only be imported if its SKU already exists as a supplier
part in InvenTree, because a purchase order line points at a SupplierPart,
which in turn needs an internal Part. Parts are never invented here: an order
with unmatched lines is reported and skipped whole, so no purchase order is
left quietly missing half of what was bought. --partial imports the lines that
do match.

Re-running is safe. An order already imported is recognised by its
supplier_reference (the DigiKey sales order id) and skipped.

The logic lives in invimport.inventree.purchase_orders; this module is the CLI
and the prompts.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from .. import cache
from ..digikey.api import connect as digikey_connect
from ..digikey.orders import (
    DEFAULT_DAYS,
    default_range,
    fetch_orders,
    fetch_sales_orders,
    line_items,
)
from ..digikey.products import fetch_products
from ..inventree.api import InvenTreeError
from ..inventree.api import connect as inventree_connect
from ..inventree.purchase_orders import (
    SUPPLIER_NAME,
    ImportResult,
    create_supplier,
    find_supplier,
    import_orders,
    list_suppliers,
)
from ._args import add_digikey_args
from ._prompt import choose_one, confirm, interactive, select_many
from .orders import iso_date

NAME = "import-orders"
HELP = "import DigiKey orders into InvenTree as purchase orders"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--order", type=int, action="append", default=[],
                        metavar="SALESORDERID", dest="order_ids",
                        help="import specific sales orders by id instead of a "
                             "history range; repeatable")
    parser.add_argument("--start-date", type=iso_date, metavar="YYYY-MM-DD",
                        help=f"history start (default: {DEFAULT_DAYS} days ago)")
    parser.add_argument("--end-date", type=iso_date, metavar="YYYY-MM-DD",
                        help="history end (default: today)")
    parser.add_argument("--shared", action="store_true",
                        help="include all orders on the account, not just your own")
    parser.add_argument("--supplier", metavar="NAME|PK",
                        help="supplier to book orders against; skips the prompt")
    parser.add_argument("--all", action="store_true", dest="select_all",
                        help="import every order found, without the checklist")
    parser.add_argument("--partial", action="store_true",
                        help="import an order even when some line items have no "
                             "matching supplier part")
    parser.add_argument("--plain", action="store_true",
                        help="use the numbered checklist instead of the arrow-key "
                             "one, for a terminal that mangles it")
    parser.add_argument("--write", action="store_true",
                        help="apply changes (default is dry run)")
    parser.add_argument("--no-products", action="store_false", dest="products",
                        help="skip the product lookup for the selected orders; "
                             "faster, but unmatched SKUs are reported bare")
    parser.add_argument("--cache-dir", type=Path, default=cache.ORDERS_DIR)
    parser.add_argument("--product-cache-dir", type=Path,
                        default=cache.PRODUCTS_DIR)
    add_digikey_args(parser)


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------
def collect_orders(client, args: argparse.Namespace
                   ) -> list[dict[str, Any]] | None:
    """Fetch the candidate orders. None means the arguments were unusable."""
    if args.order_ids:
        sales_orders = fetch_sales_orders(
            args.order_ids, client,
            cache_dir=args.cache_dir, refresh=args.refresh,
        )
        # A bare sales order has no parent Order wrapper; give it one so the
        # import sees the same shape either way.
        return [{"order_number": so.get("purchase_order"), "sales_orders": [so]}
                for so in sales_orders]

    start, end = default_range(args.start_date, args.end_date)
    if start > end:
        print(f"ERROR: --start-date {start} is after --end-date {end}",
              file=sys.stderr)
        return None

    scope = "all account orders" if args.shared else "your orders"
    print(f"Order history {start} .. {end} ({scope})")
    return fetch_orders(
        client, start_date=start, end_date=end, shared=args.shared,
        cache_dir=args.cache_dir, refresh=args.refresh,
    )


def collect_products(orders: list[dict[str, Any]], client,
                     args: argparse.Namespace) -> dict[str, dict[str, Any]]:
    """
    Fetch product details for every SKU across the selected orders.

    Runs once the selection is in, so only the orders actually being imported
    cost API calls. Keyed by upper-cased SKU to match how supplier parts are
    indexed. Cached like any other product lookup, so a second run over the
    same orders is free.
    """
    skus = sorted({line["digikey_part"] for line in line_items(orders)
                   if line.get("digikey_part")})
    if not skus:
        return {}

    print(f"\nFetching product details for {len(skus)} SKU(s)...")
    rows = fetch_products(skus, client, cache_dir=args.product_cache_dir,
                          refresh=args.refresh)

    products = {str(row["SKU"]).strip().upper(): row for row in rows
                if not row.get("error")}
    missing = len(rows) - len(products)
    print(f"  {len(products)} found" + (f", {missing} not found" if missing else ""))
    return products


# --------------------------------------------------------------------------
# Supplier resolution
# --------------------------------------------------------------------------
def named_supplier(api, wanted: str):
    """Resolve --supplier, given as a pk or a name."""
    if wanted.isdigit():
        for supplier in list_suppliers(api):
            if supplier.pk == int(wanted):
                return supplier
        raise InvenTreeError(f"no supplier with pk {wanted}")

    supplier = find_supplier(api, wanted)
    if supplier is None:
        raise InvenTreeError(f"no supplier named {wanted!r}")
    return supplier


def prompt_for_supplier(api, *, write: bool):
    """
    Offer to create the DigiKey supplier or match an existing one.

    Returns the Company, or None if the user backed out. In a dry run nothing
    is created, so choosing to create returns None and the caller reports it
    as pending.
    """
    suppliers = list_suppliers(api)

    print(f"\nNo supplier named {SUPPLIER_NAME!r} in InvenTree.")
    if not interactive():
        raise InvenTreeError(
            f"no {SUPPLIER_NAME!r} supplier, and stdin is not a terminal - "
            f"pass --supplier NAME|PK to say which company to use"
        )

    choices: list[tuple[str, Any]] = [("create", None)]
    choices += [("match", supplier) for supplier in suppliers]

    def render(choice) -> str:
        kind, supplier = choice
        if kind == "create":
            return f"create a new supplier named {SUPPLIER_NAME!r}"
        parts = [f"use existing: {supplier.name} (pk={supplier.pk})"]
        if getattr(supplier, "description", ""):
            parts.append(f"- {supplier.description}")
        return " ".join(parts)

    chosen = choose_one(choices, render,
                        title="DigiKey orders need a supplier to book against:")
    if chosen is None:
        return None

    kind, supplier = chosen
    if kind == "match":
        return supplier

    if not write:
        # Creating a company is a write. A dry run says so and stops rather
        # than pretending an order could be booked against a pk that does not
        # exist yet.
        print(f"  would create supplier {SUPPLIER_NAME!r}")
        return None

    if not confirm(f"  create supplier {SUPPLIER_NAME!r}?", default=True):
        return None
    return create_supplier(api)


def resolve_supplier(api, args: argparse.Namespace):
    """Find the supplier to use, prompting only when there is a real choice."""
    if args.supplier:
        supplier = named_supplier(api, args.supplier)
        print(f"Supplier: {supplier.name} (pk={supplier.pk})")
        return supplier

    supplier = find_supplier(api)
    if supplier is not None:
        print(f"Supplier: {supplier.name} (pk={supplier.pk})")
        return supplier

    return prompt_for_supplier(api, write=args.write)


# --------------------------------------------------------------------------
# Selection
# --------------------------------------------------------------------------
def describe_order(order: dict[str, Any]) -> str:
    """One line per order for the checklist."""
    sales_orders = order.get("sales_orders") or []
    lines = sum(len(so.get("line_items") or []) for so in sales_orders)
    total = sum(so.get("total_price") or 0 for so in sales_orders)
    currency = next((so.get("currency") for so in sales_orders
                     if so.get("currency")), order.get("currency") or "")

    bits = [f"{str(order.get('order_number') or '?'):<12}"]
    entered = order.get("date_entered")
    bits.append(f"{str(entered)[:10] or '?':<10}")
    bits.append(f"{total:>9.2f} {currency:<3}")
    bits.append(f"{lines} line{'' if lines == 1 else 's'}")
    if len(sales_orders) > 1:
        bits.append(f"in {len(sales_orders)} sales orders")
    if order.get("status"):
        bits.append(f"[{order['status']}]")
    return "  ".join(bits)


def select_orders(orders: list[dict[str, Any]],
                  args: argparse.Namespace) -> list[dict[str, Any]] | None:
    """Pick which orders to import. None means the user cancelled."""
    if args.select_all:
        return orders

    verb = "import" if args.write else "preview"
    return select_many(orders, describe_order,
                       title=f"Orders found ({len(orders)}):", verb=verb,
                       plain=args.plain)


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------
def report(result: ImportResult, *, write: bool) -> None:
    print("\nPurchase orders")

    for order in result.orders:
        label = f"DigiKey {order.order_number} / sales order {order.sales_order_id}"

        if order.action == "created":
            reference = order.reference or "(reference assigned on write)"
            print(f"  + {reference}  <- {label}  "
                  f"{order.imported_lines} line item(s)")
        elif order.action == "exists":
            print(f"  = {order.reference}  <- {label}  already imported")
        else:
            print(f"  ! skipped {label}: {order.reason}")

        for line in order.unmatched:
            print(f"      - {line.sku or '(no SKU)'}: {line.reason}")
            # What the part actually is, so the supplier part can be created
            # without going back to DigiKey to look the SKU up again.
            if line.describe():
                print(f"          {line.describe()}")

    counts = result.counts()
    print(f"\n  created={counts['created']}  already_imported={counts['exists']}  "
          f"skipped={counts['skipped']}  line_items={counts['lines']}")

    if counts["unmatched"]:
        print(f"\n  {counts['unmatched']} line item(s) had no matching supplier "
              f"part.\n  Add them to InvenTree as supplier parts under this "
              f"supplier, then re-run.")

    if result.problems:
        print(f"\n  {len(result.problems)} problem(s):")
        for problem in result.problems:
            print(f"    ! {problem}")


# --------------------------------------------------------------------------
# Entrypoint
# --------------------------------------------------------------------------
def run(args: argparse.Namespace) -> int:
    if not args.write:
        print("DRY RUN - nothing will be changed.\n")

    # Checked before anything is fetched: a run that could never reach the
    # checklist should say so at once, and must not exit 0 as if it had been
    # cancelled by a user who was never there.
    if not args.select_all and not interactive():
        print("ERROR: stdin is not a terminal - pass --all to import every "
              "order found", file=sys.stderr)
        return 2

    # InvenTree first: a bad token or a missing supplier should surface before
    # spending time on a history sweep.
    api = inventree_connect()
    supplier = resolve_supplier(api, args)
    if supplier is None:
        print("\nNo supplier chosen - nothing imported.")
        return 0 if not args.write else 1

    client = digikey_connect(sandbox=args.sandbox, need_account=True)
    orders = collect_orders(client, args)
    if orders is None:
        return 2
    if not orders:
        print("No orders found in that range.")
        return 0

    chosen = select_orders(orders, args)
    if chosen is None:
        print("\nCancelled - nothing imported.")
        return 0
    if not chosen:
        print("\nNothing selected.")
        return 0

    # Only now, with the selection in, is it worth spending calls on products.
    products = collect_products(chosen, client, args) if args.products else {}

    print(f"\n{'Importing' if args.write else 'Previewing'} {len(chosen)} "
          f"order(s)...")
    result = import_orders(chosen, api, supplier=supplier, write=args.write,
                           partial=args.partial, products=products)
    report(result, write=args.write)

    if not args.write:
        print("\nDRY RUN complete - re-run with --write to apply.")
    return 0
