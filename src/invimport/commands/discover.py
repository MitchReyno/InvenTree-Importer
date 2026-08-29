"""
Triage supplier parameters a category is seeing but not importing.

A new category starts with no parameters, and DigiKey sends far more than are
worth keeping. This lists what each category is receiving and not using, then
asks - once per parameter - whether it identifies the part, is worth recording,
or should be ignored. Answers are written to config/categories.yaml and
config/parameters.yaml, so nothing is asked twice.

    invimport discover                       # report what is unmapped
    invimport discover --write               # decide, and record the answers
    invimport discover --write --category Resistors
    invimport discover --write --sku 296-1411-1-ND

Products come from the DigiKey product cache by default, so a plain run costs
no API calls. --sku fetches specific SKUs instead.

Key parameters are what makes two parts the same part under `identity: spec`,
so filing one changes how parts are matched from then on. Nothing is decided
automatically for that reason.

The logic lives in invimport.inventree.discovery; this module is the CLI.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .. import cache
from ..config import load_categories_config, load_parameters_config
from ..digikey.api import connect as digikey_connect
from ..digikey.products import category_path
from ..digikey.products import fetch_products
from ..digikey.products import parameters as supplier_parameters
from ..inventree.discovery import (
    IGNORE,
    KEY,
    OTHER,
    SKIP,
    Discovery,
    discover,
    file_discovery,
    reload,
)
from . import _prompt
from ._args import add_digikey_args

NAME = "discover"
HELP = "triage supplier parameters into the category config"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", type=Path, default=None, metavar="DIR",
                        help="config directory (default: config/ at the repo "
                             "root)")
    parser.add_argument("--sku", action="append", default=[], dest="skus",
                        metavar="SKU",
                        help="fetch these SKUs instead of reading the cache; "
                             "repeatable")
    parser.add_argument("--category", metavar="NAME",
                        help="only consider one category, by path or leaf name")
    parser.add_argument("--limit", type=int, default=0, metavar="N",
                        help="stop after N parameters")
    parser.add_argument("--write", action="store_true",
                        help="ask about each parameter and record the answers "
                             "(default is a report)")
    parser.add_argument("--cache-dir", type=Path, default=cache.PRODUCTS_DIR)
    add_digikey_args(parser)


# --------------------------------------------------------------------------
# Products to look at
# --------------------------------------------------------------------------
def cached_products(cache_dir: Path) -> list[dict[str, Any]]:
    """Every cached productdetails payload, reduced to what discovery needs."""
    products: list[dict[str, Any]] = []
    for path in sorted(cache_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        product = payload.get("Product", payload)
        products.append({
            "category_path": category_path(product),
            "parameters": supplier_parameters(product),
        })
    return products


def collect_products(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.skus:
        client = digikey_connect(sandbox=args.sandbox)
        return fetch_products(args.skus, client, cache_dir=args.cache_dir,
                              refresh=args.refresh)
    return cached_products(args.cache_dir)


def matching_category(item: Discovery, wanted: str) -> bool:
    """--category takes a full path or just the leaf, case-insensitively."""
    folded = wanted.strip().casefold()
    path = item.category.casefold()
    return path == folded or path.rsplit("/", 1)[-1] == folded


# --------------------------------------------------------------------------
# Prompts
# --------------------------------------------------------------------------
CHOICES = [
    (KEY, "key parameter", "identifies the part - changes how parts are matched"),
    (OTHER, "parameter", "recorded on the part, not identifying"),
    (IGNORE, "ignore", "never import this one for this category"),
    (SKIP, "skip", "leave undecided, ask again next time"),
]


def ask_decision(item: Discovery) -> str | None:
    """Key, other, ignore or skip. None if the user quit."""
    title = (f"{item.category}\n"
             f"  {item.supplier_name}  (on {item.count} product"
             f"{'' if item.count == 1 else 's'})\n"
             f"  values: {item.sample()}\n"
             f"  looks like: {item.suggestion.describe()}")
    if item.existing_parameter:
        title += f"\n  matches the existing parameter {item.existing_parameter!r}"
    if item.suggestion.ranged:
        title += ("\n  note: a range needs two parameters (min and max); "
                  "this files the low end")

    picked = _prompt.choose_one(
        CHOICES, lambda c: f"{c[1]:<16} {c[2]}", title=title,
        prompt="  file as > ")
    return None if picked is None else picked[0]


def ask_name(item: Discovery) -> str | None:
    """What to call the parameter. None if the user backed out."""
    if item.existing_parameter:
        return item.existing_parameter

    default = item.supplier_name.strip()
    options = [(default, f"call it {default!r}"),
               (None, "type a different name")]
    picked = _prompt.choose_one(options, lambda o: o[1],
                                title=f"  name for {item.supplier_name!r}:",
                                prompt="  name > ")
    if picked is None:
        return None
    if picked[0] is not None:
        return picked[0]

    typed = _prompt.ask(f"  name [{default}] > ")
    if typed is None:
        return None
    return typed.strip() or default


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------
def report(found: list[Discovery]) -> None:
    current = ""
    for item in found:
        if item.category != current:
            current = item.category
            print(f"\n{current}")
        known = (f"  -> {item.existing_parameter}"
                 if item.existing_parameter else "")
        print(f"  {item.supplier_name:<34} x{item.count:<4} "
              f"{item.suggestion.describe()}{known}")
        print(f"      {item.sample()}")


def run(args: argparse.Namespace) -> int:
    categories = load_categories_config(args.config)
    parameters = load_parameters_config(args.config)

    products = collect_products(args)
    if not products:
        print("No products to look at. Fetch some first, or pass --sku.")
        return 0

    found = discover(products, categories, parameters)
    if args.category:
        found = [item for item in found
                 if matching_category(item, args.category)]
    if args.limit:
        found = found[:args.limit]

    if not found:
        print(f"Nothing unmapped across {len(products)} product(s).")
        return 0

    print(f"{len(found)} unmapped parameter(s) across {len(products)} "
          f"product(s).")

    if not args.write:
        report(found)
        print("\nRe-run with --write to decide what to do with them.")
        return 0

    if not _prompt.interactive():
        print("ERROR: --write needs a terminal to ask the questions",
              file=sys.stderr)
        return 2

    decided = 0
    for item in found:
        decision = ask_decision(item)
        if decision is None:
            print("\nStopped - answers so far are already saved.")
            break
        if decision == SKIP:
            continue

        name = ""
        if decision in (KEY, OTHER):
            chosen = ask_name(item)
            if chosen is None:
                continue
            name = chosen

        for change in file_discovery(item, decision, name, categories,
                                     parameters, directory=args.config):
            print(f"    {change}")
        decided += 1
        # Reload so the next decision sees what this one wrote - a parameter
        # filed under one category is already known to the next.
        categories, parameters = reload(args.config)

    print(f"\n{decided} parameter(s) filed.")
    return 0
