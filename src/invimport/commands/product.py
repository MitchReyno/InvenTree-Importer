"""
Fetch canonical product data from the DigiKey Product Information API v4.

Reports: link (canonical ProductUrl), datasheet, packaging, pack_quantity,
         description, manufacturer_part, MOQ, and optionally unit price.

Every raw response is cached to .cache/.digikey/products (--cache-dir). Re-runs
read from cache, so you do not burn API quota re-fetching parts you already
have. Pass --refresh, or delete the cache dir, to force a refetch.

A DigiKey part number identifies a *variation* (cut tape, reel, tube,
digi-reel), not just a product. The requested SKU is resolved against
ProductVariations so packaging and pack quantity describe the SKU you actually
buy, not the product in general.

    invimport product 296-1234-1-ND 311-1.00KHRCT-ND
    printf '296-1234-1-ND\\n' | invimport product -
    invimport product 296-1234-1-ND --pricing --json results.json

The logic lives in invimport.digikey.products; this module is only the CLI.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .. import cache
from ..digikey.api import connect
from ..digikey.products import REPORTED_FIELDS, dumps, fetch_products, summarise
from ._args import add_digikey_args, add_output_args

NAME = "product"
HELP = "fetch DigiKey product data by SKU"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("skus", nargs="+", metavar="SKU",
                        help="DigiKey part number(s) to fetch, or '-' to read them "
                             "from stdin (one per line)")
    parser.add_argument("--cache-dir", type=Path, default=cache.PRODUCTS_DIR)
    parser.add_argument("--pricing", action="store_true",
                        help="also report the unit price at the lowest break quantity")
    add_output_args(parser)
    add_digikey_args(parser)


def read_skus(args_skus: list[str]) -> list[str]:
    """Expand a '-' argument into SKUs read from stdin, one per line."""
    skus: list[str] = []
    for entry in args_skus:
        if entry == "-":
            skus.extend(line.strip() for line in sys.stdin)
        else:
            skus.append(entry.strip())
    # de-duplicate while preserving order
    seen: set[str] = set()
    return [s for s in skus if s and not (s in seen or seen.add(s))]


def print_result(entry: dict[str, Any], payload: dict[str, Any] | None,
                 pricing: bool, currency: str, raw: bool) -> None:
    print(f"[{entry['SKU']}]")
    if raw and payload is not None:
        print(json.dumps(payload.get("Product", payload), indent=2))
    if "error" in entry:
        return

    for field in REPORTED_FIELDS:
        value = entry.get(field)
        if value in (None, ""):
            continue
        print(f"    {field:<18} {value}")

    if pricing and entry.get("unit_price") is not None:
        print(f"    {'unit_price':<18} {entry['unit_price']} {currency}")


def run(args: argparse.Namespace) -> int:
    skus = read_skus(args.skus)
    if not skus:
        print("ERROR: no SKUs given.", file=sys.stderr)
        return 2

    client = connect(sandbox=args.sandbox)
    print(f"Fetching {len(skus)} SKU(s)")

    results = fetch_products(
        skus, client,
        cache_dir=args.cache_dir,
        refresh=args.refresh,
        on_result=lambda entry, payload: print_result(
            entry, payload, args.pricing, client.locale.currency, args.raw),
    )

    counts = summarise(results)
    print(f"\nfetched={counts['fetched']}  not_found={counts['not_found']}  "
          f"no_variation_match={counts['no_variation_match']}")

    if args.json:
        args.json.write_text(dumps(results), encoding="utf-8")
        print(f"results -> {args.json}")

    return 0
