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
from ..config import CONFIG_DIR, add_alias, load_categories_config
from ..digikey.api import connect as digikey_connect
from ..digikey.orders import DEFAULT_DAYS, default_range, fetch_orders, line_items
from ..inventree.api import InvenTreeError
from ..inventree.api import connect as inventree_connect
from ..inventree.parts import PartImportResult, import_supplier_parts
from ..inventree.purchase_orders import find_supplier, list_suppliers
from . import _prompt
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
                        help="fill missing parameter values (and overwrite "
                             "drifted ones) on parts that already exist")
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


def learn_categories(products: dict[str, Any], skus, directory,
                     api=None, *, write: bool) -> int:
    """
    Offer to map any DigiKey category these SKUs land in but the config lacks.

    An unmapped category stops a part being created at all, and the fix - an
    alias in categories.yaml - is a question, not a lookup: only a human knows
    whether 'Chip Resistor - Surface Mount' belongs under an existing category
    or wants a new one. Asking here, with the products already fetched, saves
    running `invimport categories --learn` and then starting over.

    Returns how many paths were learned. Writes nothing without a terminal.
    """
    from ..inventree.categories import learn_aliases, sync_tree
    from ..inventree.matching import unmapped_paths
    from .categories import _choose

    loaded = load_categories_config(directory)
    paths = [products[sku.upper()].get("category_path")
             for sku in skus if products.get(sku.upper())]
    unmapped = unmapped_paths([p for p in paths if p], loaded)
    if not unmapped:
        return 0

    print(f"\n  {len(unmapped)} DigiKey category path(s) are not mapped to a "
          f"category:")
    for path in unmapped:
        print(f"    {path}")

    if not _prompt.interactive():
        print("  Not a terminal - run `invimport categories --learn` to map "
              "them.")
        return 0

    if not _prompt.confirm("  Map them now?", default=True):
        return 0

    learned = learn_aliases(unmapped, loaded, directory, choose=_choose)
    for path, destination in learned:
        print(f"    + {path} -> {destination}")
    still = [p for p in unmapped if p not in {a for a, _ in learned}]
    for path in still:
        print(f"    ? {path} left unmapped")

    # A learned alias may name a category the server does not have yet.
    if learned and write and api is not None:
        _, _, synced = sync_tree(directory, api, write=True)
        made = synced.counts()["created"]
        if made:
            print(f"    created {made} categor"
                  f"{'y' if made == 1 else 'ies'} on the server")
    return len(learned)


def report_sku(item) -> None:
    """One SKU, as it finishes. Used live and by the summary."""
    if item.action == "created":
        dest = item.ipn or item.name or item.category
        print(f"  + {item.sku}  -> {dest}", flush=True)
        if item.name and item.ipn:
            print(f"      {item.ipn}  {item.name}", flush=True)
        if item.supplier_parameters or item.part_parameters:
            # The part carries only what identifies it; the manufacturer
            # and supplier parts carry the full specification.
            print(f"      parameters: part {item.part_parameters}, "
                  f"manufacturer part {item.manufacturer_parameters}, "
                  f"supplier part {item.supplier_parameters}", flush=True)
    elif item.action == "exists":
        print(f"  = {item.sku}  already a supplier part", flush=True)
        if (item.part_parameters or item.manufacturer_parameters
                or item.supplier_parameters):
            print(f"      parameters: part {item.part_parameters}, "
                  f"manufacturer part {item.manufacturer_parameters}, "
                  f"supplier part {item.supplier_parameters}", flush=True)
    else:
        print(f"  ! {item.sku}: {item.reason}", flush=True)
        if item.describe():
            print(f"      {item.describe()}", flush=True)


STEP_LABELS = {
    "manufacturer": "manufacturer",
    "part": "part",
    "manufacturer_part": "manufacturer part",
    "supplier_part": "supplier part",
    "image": "image",
}


def report_step(sku: str, step: str, index: int, total: int) -> None:
    """Live progress as a SKU moves through its write actions."""
    if step == "start":
        print(f"  [{index}/{total}] {sku}", flush=True)
        return
    label = STEP_LABELS.get(step, step.replace("_", " "))
    print(f"    {label}", flush=True)


def report(result: PartImportResult, *, items: bool = True) -> None:
    if items:
        print("\nSupplier parts")
        for item in result.skus:
            report_sku(item)

    counts = result.counts()
    print(f"\n  created={counts['created']}  exists={counts['exists']}  "
          f"skipped={counts['skipped']}  "
          f"parameter_values={counts['parameters']}", flush=True)

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

    def run_import(wanted):
        print("\nSupplier parts", flush=True)
        return import_supplier_parts(
            wanted, api, write=args.write, directory=directory,
            supplier=supplier,
            update_parameters=args.update_parameters,
            create_manufacturers=args.create_manufacturers,
            choose_manufacturer=chooser,
            cache_dir=args.cache_dir, refresh=args.refresh,
            on_sku=report_sku, on_step=report_step,
        )

    result = run_import(skus)

    # An unmapped category is a question, not a failure. Ask it rather than
    # reporting a skipped SKU and leaving the user to run `categories --learn`
    # and start again. The products are cached by now, so the retry is free.
    blocked = [action for action in result.skus
               if action.action == "skipped"
               and "unmapped category" in action.reason]
    if blocked and interactive():
        products = {action.sku.upper(): action.product
                    for action in blocked if action.product}
        if learn_categories(products, [a.sku for a in blocked], directory,
                            api, write=args.write):
            print(f"\nRetrying {len(blocked)} SKU(s) with the new mapping...")
            retried = run_import([action.sku for action in blocked])
            done = {a.sku.upper(): a for a in retried.skus}
            result.skus = [done.get(a.sku.upper(), a) for a in result.skus]
            result.problems.extend(retried.problems)

    report(result, items=False)

    if not args.write:
        print("\nDRY RUN complete - re-run with --write to apply.")
    return 0
