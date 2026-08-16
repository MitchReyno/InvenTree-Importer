"""
Create InvenTree parts from DigiKey SKUs.

    invimport supplier-parts 296-1411-1-ND 13-MFR-25FTE52-10RCT-ND
    invimport supplier-parts --from-orders --start-date 2026-01-01 --write
    invimport supplier-parts - < skus.txt --write

Per SKU: match the DigiKey category, find or create the Part (by MPN or
parameter signature), resolve the manufacturer, then create the
ManufacturerPart and SupplierPart. Dry run by default; nothing is deleted.

An unmapped category or an unknown manufacturer skips that SKU rather than
guessing. Interactive runs offer fuzzy manufacturer matches and write the
answer back to config/manufacturers.yaml. Non-interactive runs skip unless
`--create-manufacturers` is passed.

The logic lives in invimport.inventree.parts; this module is the CLI.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from .. import cache
from ..config import CONFIG_DIR, add_alias
from ..digikey.api import connect as digikey_connect
from ..digikey.orders import DEFAULT_DAYS, default_range, fetch_orders, line_items
from ..inventree.api import InvenTreeError
from ..inventree.api import connect as inventree_connect
from ..inventree.parts import PartImportResult, import_supplier_parts
from ..inventree.purchase_orders import find_supplier, list_suppliers
from ._args import add_digikey_args
from ._prompt import choose_one, interactive
from .orders import iso_date
from .product import read_skus

NAME = "supplier-parts"
HELP = "create InvenTree parts from DigiKey SKUs"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("skus", nargs="*", metavar="SKU",
                        help="DigiKey part number(s), or '-' to read them "
                             "from stdin (one per line)")
    parser.add_argument("--from-orders", action="store_true",
                        help="import every SKU on orders in the date range "
                             "instead of (or as well as) SKU arguments")
    parser.add_argument("--start-date", type=iso_date, metavar="YYYY-MM-DD",
                        help=f"order history start (default: {DEFAULT_DAYS} "
                             f"days ago); used with --from-orders")
    parser.add_argument("--end-date", type=iso_date, metavar="YYYY-MM-DD",
                        help="order history end (default: today)")
    parser.add_argument("--shared", action="store_true",
                        help="include all orders on the account, not just "
                             "your own")
    parser.add_argument("--config", type=Path, default=None, metavar="DIR",
                        help="config directory (default: config/ at the repo "
                             "root)")
    parser.add_argument("--supplier", metavar="NAME|PK",
                        help="supplier company for the SupplierPart "
                             "(default: the DigiKey supplier)")
    parser.add_argument("--write", action="store_true",
                        help="apply changes (default is dry run)")
    parser.add_argument("--update-parameters", action="store_true",
                        help="overwrite parameter values on parts that "
                             "already exist")
    parser.add_argument("--create-manufacturers", action="store_true",
                        help="create a manufacturer company for any name "
                             "that does not match; without this, "
                             "non-interactive runs skip those SKUs")
    parser.add_argument("--cache-dir", type=Path, default=cache.PRODUCTS_DIR)
    parser.add_argument("--order-cache-dir", type=Path,
                        default=cache.ORDERS_DIR)
    add_digikey_args(parser)


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


def skus_from_orders(client, args: argparse.Namespace) -> list[str] | None:
    start, end = default_range(args.start_date, args.end_date)
    if start > end:
        print(f"ERROR: --start-date {start} is after --end-date {end}",
              file=sys.stderr)
        return None
    orders = fetch_orders(
        client, start_date=start, end_date=end, shared=args.shared,
        cache_dir=args.order_cache_dir, refresh=args.refresh)
    return sorted({line["digikey_part"] for line in line_items(orders)
                   if line.get("digikey_part")})


def prompt_manufacturer(name: str, offered: list[tuple[Any, float]]):
    """Offer fuzzy matches and creating a new manufacturer."""
    if not interactive():
        return None

    create = object()
    choices: list[Any] = [*offered, create]

    def render(item) -> str:
        if item is create:
            return f"create a new manufacturer {name!r}"
        company, score = item
        return (f"use existing: {company.name} (pk={company.pk})  "
                f"[{score:.0%} similar]")

    picked = choose_one(
        choices, render,
        title=f"DigiKey calls this manufacturer {name!r}. No exact match.")
    if picked is None:
        return None
    if picked is create:
        return name
    return picked[0]


def learn_manufacturer(directory: Path):
    """A chooser that writes the answer back to manufacturers.yaml."""
    file = directory / "manufacturers.yaml"

    def choose(name: str, offered: list[tuple[Any, float]]):
        picked = prompt_manufacturer(name, offered)
        if picked is None:
            return None
        canonical = picked if isinstance(picked, str) else picked.name
        if canonical != name:
            add_alias(file, [canonical], name)
        return picked

    return choose


def report(result: PartImportResult) -> None:
    print("\nSupplier parts")

    for item in result.skus:
        if item.action == "created":
            dest = item.ipn or item.name or item.category
            print(f"  + {item.sku}  -> {dest}")
            if item.name and item.ipn:
                print(f"      {item.ipn}  {item.name}")
        elif item.action == "exists":
            print(f"  = {item.sku}  already a supplier part")
        else:
            print(f"  ! {item.sku}: {item.reason}")
            if item.describe():
                print(f"      {item.describe()}")

    counts = result.counts()
    print(f"\n  created={counts['created']}  exists={counts['exists']}  "
          f"skipped={counts['skipped']}")

    if result.problems:
        print(f"\n  {len(result.problems)} problem(s):")
        for problem in result.problems:
            print(f"    ! {problem}")


def run(args: argparse.Namespace) -> int:
    if not args.write:
        print("DRY RUN - nothing will be changed on the server.\n")

    skus = read_skus(args.skus)
    client = None
    if args.from_orders:
        client = digikey_connect(sandbox=args.sandbox, need_account=True)
        extra = skus_from_orders(client, args)
        if extra is None:
            return 2
        seen = {s.upper() for s in skus}
        skus.extend(s for s in extra if s.upper() not in seen)

    if not skus:
        print("ERROR: no SKUs given.", file=sys.stderr)
        return 2

    api = inventree_connect()
    directory = args.config or CONFIG_DIR

    supplier = None
    if args.supplier:
        supplier = named_supplier(api, args.supplier)
        print(f"Supplier: {supplier.name} (pk={supplier.pk})")
    else:
        supplier = find_supplier(api)
        if supplier is not None:
            print(f"Supplier: {supplier.name} (pk={supplier.pk})")

    chooser = None
    if not args.create_manufacturers and interactive():
        chooser = learn_manufacturer(directory)

    print(f"\n{'Importing' if args.write else 'Previewing'} {len(skus)} "
          f"SKU(s)...")
    result = import_supplier_parts(
        skus, api, write=args.write, directory=directory, supplier=supplier,
        update_parameters=args.update_parameters,
        create_manufacturers=args.create_manufacturers,
        choose_manufacturer=chooser,
        cache_dir=args.cache_dir, refresh=args.refresh,
    )
    report(result)

    if not args.write:
        print("\nDRY RUN complete - re-run with --write to apply.")
    return 0
