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
from ..util import absolute_url, dig

log = logging.getLogger(__name__)

# Fields worth reporting for every SKU, in display order.
REPORTED_FIELDS = [
    "manufacturer_part",
    "manufacturer_name",
    "description",
    "packaging",
    "standard_package",
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
            log.info("    %s: cached", sku)
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
def category_path(product: dict[str, Any]) -> list[str]:
    """
    Flatten DigiKey's nested Category into a path.

    The payload nests one ChildCategories chain per product, deepest last:
    Resistors -> Through Hole Resistors. Only the first child at each level is
    followed, which is all a single product ever has.
    """
    path: list[str] = []
    node = product.get("Category")
    seen: set[int] = set()

    while isinstance(node, dict) and id(node) not in seen:
        seen.add(id(node))                     # a self-referencing payload
        name = dig(node, "Name")               # must not spin forever
        if name:
            path.append(str(name))
        children = node.get("ChildCategories") or []
        node = children[0] if children else None

    return path


def parameters(product: dict[str, Any]) -> dict[str, str]:
    """
    Flatten DigiKey's Parameters list into {name: value}.

    Values are returned exactly as DigiKey sends them, "-" and all: deciding
    what a value means is the caller's job, not this one's. A duplicated
    parameter name keeps the first value, matching the order DigiKey lists
    them in.
    """
    out: dict[str, str] = {}
    for item in product.get("Parameters") or []:
        name = dig(item, "ParameterText")
        value = dig(item, "ValueText")
        if name is None or value is None:
            continue
        out.setdefault(str(name), str(value))
    return out


def product_images(product: dict[str, Any]) -> list[str]:
    """
    Image URLs on a product, primary first.

    DigiKey's productdetails payload has a single PhotoUrl. Extra
    Photos/Images lists are collected if a payload ever carries them.
    """
    urls: list[str] = []
    photo = absolute_url(dig(product, "PhotoUrl"))
    if photo:
        urls.append(photo)
    for item in product.get("Photos") or product.get("Images") or []:
        raw = (item if isinstance(item, str)
               else dig(item, "Url") or dig(item, "PhotoUrl"))
        url = absolute_url(raw)
        if url and url not in urls:
            urls.append(url)
    return urls


def fetch_image(url: str, cache_dir: Path = cache.IMAGES_DIR,
                refresh: bool = False) -> Path | None:
    """
    Download a product image into the cache. Returns the file, or None.

    PhotoUrl is a public CDN link, not a DigiKey API call, so this does
    not use the API token. A cached file is reused unless refresh=True.
    """
    if not url:
        return None
    path = cache.image_path(cache_dir, url)
    if path.exists() and not refresh:
        return path

    try:
        response = requests.get(url, timeout=30)
    except requests.RequestException as exc:
        log.warning("    [warn] image %s: %s", url, exc)
        return None
    if response.status_code != 200 or not response.content:
        log.warning("    [warn] image %s: HTTP %s", url, response.status_code)
        return None

    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_bytes(response.content)
    log.info("    cached image %s", path.name)
    return path


def extract(payload: dict[str, Any], sku: str) -> dict[str, Any]:
    """
    Pull the fields we care about out of a productdetails payload.

    Resolves the requested SKU against ProductVariations so packaging and pack
    quantity reflect the specific variation (CT / DKR / TR) rather than the
    product as a whole.
    """
    product = payload.get("Product", payload)

    out: dict[str, Any] = {
        "link": absolute_url(dig(product, "ProductUrl")),
        "datasheet": absolute_url(dig(product, "DatasheetUrl")),
        "manufacturer_part": dig(product, "ManufacturerProductNumber"),
        "manufacturer_name": dig(product, "Manufacturer", "Name"),
        "description": (
            dig(product, "Description", "ProductDescription")
            or dig(product, "Description", "DetailedDescription")
        ),
        "packaging": None,
        "standard_package": None,
        "moq": None,
        "unit_price": None,
        "variation_matched": False,
        # Categorisation and specs, used by the part import. Not reported by
        # the product command - see REPORTED_FIELDS.
        "category_path": category_path(product),
        "parameters": parameters(product),
        "images": product_images(product),
    }
    out["image"] = out["images"][0] if out["images"] else None

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
        # The manufacturer's full-package size (a 1000-piece reel, a 25-piece
        # tube). Informational only: DigiKey still sells and prices this SKU by
        # the piece, so it is NOT InvenTree's pack_quantity. Mapping it there
        # multiplies every receipt by the reel size - see import_sku().
        out["standard_package"] = dig(chosen, "StandardPackage") or None
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
                            "packaging and standard_package unavailable, verify "
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
