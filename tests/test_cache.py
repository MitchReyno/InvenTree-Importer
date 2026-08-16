"""The shared on-disk cache: layout, key scheme, round-tripping."""

from __future__ import annotations

import json

import pytest

from invimport import cache

from tests.support import REPO_ROOT

# cache.PRODUCTS_DIR is relative to the working directory, so anchor it to the
# repo. Otherwise the check below silently skips whenever pytest is run from
# somewhere else.
REPO_PRODUCTS = REPO_ROOT / cache.PRODUCTS_DIR


def test_cache_layout_is_the_common_root():
    assert str(cache.CACHE_ROOT) == ".cache"
    assert str(cache.DIGIKEY_ROOT) == ".cache/.digikey"
    assert str(cache.PRODUCTS_DIR) == ".cache/.digikey/products"
    assert str(cache.ORDERS_DIR) == ".cache/.digikey/orders"


def test_cache_path_is_readable_plus_a_digest(workspace):
    path = cache.cache_path(workspace, "296-1411-1-ND")
    assert path.name.startswith("296-1411-1-ND__")
    assert path.name.endswith(".json")


def test_cache_path_sanitises_awkward_keys(workspace):
    """A key with slashes must not escape the cache directory."""
    path = cache.cache_path(workspace, "../../etc/passwd")
    assert path.parent == workspace
    assert "/" not in path.name[:-5]


def test_distinct_keys_stay_distinct_after_sanitising(workspace):
    """Two keys that sanitise identically must still get separate files."""
    a = cache.cache_path(workspace, "a/b")
    b = cache.cache_path(workspace, "a_b")
    assert a != b


def test_store_then_load_round_trips(workspace):
    cache.store(workspace / "d", "key", {"hello": "world"})
    assert cache.load(workspace / "d", "key") == {"hello": "world"}


def test_load_returns_none_when_absent(workspace):
    assert cache.load(workspace / "nothing-here", "key") is None


def test_store_creates_the_directory(workspace):
    target = workspace / "deep" / "nested"
    cache.store(target, "key", {"a": 1})
    assert target.is_dir()


def test_stored_file_is_readable_json(workspace):
    cache.store(workspace, "key", {"a": 1})
    path = cache.cache_path(workspace, "key")
    assert json.loads(path.read_text()) == {"a": 1}


# --------------------------------------------------------------------------
# Guard against changing the key scheme under an existing cache
# --------------------------------------------------------------------------
@pytest.mark.skipif(not REPO_PRODUCTS.exists(),
                    reason="no product cache in the repo to check against")
def test_existing_cached_products_still_resolve():
    """
    Every file already in the repo's product cache must be reachable by its
    SKU. If the key scheme changes, those entries silently become misses and
    the next run re-spends API quota.

    The SKU is read out of the payload, not recovered from the filename: the
    readable half of the name is sanitised and truncated, so a SKU containing
    a character the filesystem dislikes cannot be reconstructed from it.
    "MCP3208-CI/P-ND" is cached as "MCP3208-CI_P-ND__<digest of the real key>",
    and only the real key hashes to that digest.
    """
    for path in REPO_PRODUCTS.glob("*.json"):
        payload = json.loads(path.read_text(encoding="utf-8"))
        product = payload.get("Product") or {}
        skus = [variation.get("DigiKeyProductNumber")
                for variation in (product.get("ProductVariations") or [])]
        skus = [sku for sku in skus if sku]
        assert skus, f"{path.name} has no SKU to check against"
        assert any(cache.cache_path(REPO_PRODUCTS, sku) == path for sku in skus), (
            f"{path.name} is no longer reachable by any of its SKUs {skus}")
