"""
DigiKey Product Information API v4 - fetching and parsing.

Importable as a library:

    from invimport.digikey.products import fetch_products

    rows = fetch_products(["296-1234-1-ND", "311-1.00KHRCT-ND"])
    for row in rows:
        print(row["manufacturer_part"], row["packaging"], row["moq"])

Pass an existing Client to reuse one token across several calls; omit it and
one is created from the environment.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable, Iterable

import requests

from .. import cache
from .api import (
    PRODUCT_DETAILS_URL,
    SANDBOX_PRODUCT_DETAILS_URL,
    Client,
    connect,
)
from ..util import dig

log = logging.getLogger(__name__)

# Fields worth reporting for every SKU, in display order.
REPORTED_FIELDS = [
    "manufacturer_part",
    "manufacturer_name",
    "description",
    "packaging",
    "pack_quantity",
    "moq",
    "link",
    "datasheet",
]


# --------------------------------------------------------------------------
# Fetch with cache
# --------------------------------------------------------------------------
def fetch_product_payload(sku: str, client: Client,
                          cache_dir: Path = cache.PRODUCTS_DIR,
                          refresh: bool = False) -> dict[str, Any] | None:
    """Return the raw productdetails payload for a DigiKey part number."""
    if not refresh:
        cached = cache.load(cache_dir, sku)
        if cached is not None:
            print(f"Loaded cached product payload for {sku}")
            return cached

    template = SANDBOX_PRODUCT_DETAILS_URL if client.sandbox else PRODUCT_DETAILS_URL
    url = template.format(pn=requests.utils.quote(sku, safe=""))

    data = client.get(url, label=sku)
    if data is not None:
        cache.store(cache_dir, sku, data)
    return data


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
def extract(payload: dict[str, Any], sku: str) -> dict[str, Any]:
    """
    Pull the fields we care about out of a productdetails payload.

    Resolves the requested SKU against ProductVariations so packaging and pack
    quantity reflect the specific variation (CT / DKR / TR) rather than the
    product as a whole.
    """
    product = payload.get("Product", payload)

    out: dict[str, Any] = {
        "link": dig(product, "ProductUrl"),
        "datasheet": dig(product, "DatasheetUrl"),
        "manufacturer_part": dig(product, "ManufacturerProductNumber"),
        "manufacturer_name": dig(product, "Manufacturer", "Name"),
        "description": (
            dig(product, "Description", "ProductDescription")
            or dig(product, "Description", "DetailedDescription")
        ),
        "packaging": None,
        "pack_quantity": None,
        "moq": None,
        "unit_price": None,
        "variation_matched": False,
    }

    variations = product.get("ProductVariations") or []
    chosen = None
    for var in variations:
        if str(dig(var, "DigiKeyProductNumber", default="")).strip().upper() == sku.strip().upper():
            chosen = var
            break

    if chosen is not None:
        out["variation_matched"] = True
        out["packaging"] = dig(chosen, "PackageType", "Name")
        out["moq"] = dig(chosen, "MinimumOrderQuantity")
        # StandardPackage is how many pieces come in one supplier unit.
        out["pack_quantity"] = dig(chosen, "StandardPackage") or 1
        breaks = chosen.get("StandardPricing") or []
        if breaks:
            cheapest_entry = min(breaks, key=lambda b: b.get("BreakQuantity", 0) or 0)
            out["unit_price"] = cheapest_entry.get("UnitPrice")

    return out


# --------------------------------------------------------------------------
# Public entrypoint
# --------------------------------------------------------------------------
def fetch_products(
    skus: Iterable[str],
    client: Client | None = None,
    *,
    cache_dir: Path = cache.PRODUCTS_DIR,
    refresh: bool = False,
    sandbox: bool = False,
    on_result: Callable[[dict[str, Any], dict[str, Any] | None], None] | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch and parse every SKU, returning one dict per SKU in input order.

    A SKU with no API result yields {"SKU": ..., "error": "no API result"} rather
    than being dropped, so the output lines up with the input.

    on_result, if given, is called as each SKU completes with the extracted row
    and the raw payload - useful for progress output without buffering.
    """
    client = client or connect(sandbox=sandbox)
    results: list[dict[str, Any]] = []

    for sku in skus:
        payload = fetch_product_payload(sku, client, cache_dir, refresh)
        if payload is None:
            entry = {"SKU": sku, "error": "no API result"}
        else:
            entry = {"SKU": sku, **extract(payload, sku)}
            if not entry["variation_matched"]:
                log.warning("    [warn] %s did not match any ProductVariation - "
                            "packaging and pack_quantity unavailable, verify "
                            "manually", sku)
        results.append(entry)
        if on_result:
            on_result(entry, payload)

    return results


def fetch_product(sku: str, client: Client | None = None, **kwargs) -> dict[str, Any]:
    """Single-SKU convenience wrapper around fetch_products."""
    return fetch_products([sku], client, **kwargs)[0]


def summarise(results: list[dict[str, Any]]) -> dict[str, int]:
    """Counts for a run: how many resolved, missed, or matched no variation."""
    return {
        "fetched": sum(1 for r in results if "error" not in r),
        "not_found": sum(1 for r in results if "error" in r),
        "no_variation_match": sum(
            1 for r in results if "error" not in r and not r["variation_matched"]),
    }


def dumps(results: list[dict[str, Any]]) -> str:
    """Serialise results the way the CLI's --json writes them."""
    return json.dumps(results, indent=2)
