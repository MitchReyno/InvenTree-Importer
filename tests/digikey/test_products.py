"""Product fetching, parsing and caching."""

from __future__ import annotations

import pytest

from invimport.digikey import products
from invimport.digikey.products import extract, fetch_product, fetch_products, summarise

from tests.support import PRODUCT_PAYLOAD


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
def test_extract_pulls_the_reported_fields():
    row = extract(PRODUCT_PAYLOAD, "296-1411-1-ND")
    assert row["manufacturer_part"] == "NE555P"
    assert row["manufacturer_name"] == "Texas Instruments"
    assert row["description"] == "IC OSC SINGLE TIMER"
    assert row["link"] == "https://www.digikey.com/x"
    assert row["datasheet"] == "https://example.com/ds.pdf"


def test_extract_resolves_the_requested_variation():
    """Packaging and MOQ must describe the SKU asked for, not the product."""
    row = extract(PRODUCT_PAYLOAD, "296-1411-1-ND")
    assert row["variation_matched"] is True
    assert row["packaging"] == "Cut Tape"
    assert row["moq"] == 1
    assert row["pack_quantity"] == 1


def test_extract_prices_at_the_lowest_break_quantity():
    """0.82 is the qty-1 price; 0.71 is the qty-10 price and must not win."""
    assert extract(PRODUCT_PAYLOAD, "296-1411-1-ND")["unit_price"] == 0.82


def test_extract_flags_a_sku_that_matches_no_variation():
    row = extract(PRODUCT_PAYLOAD, "296-DIFFERENT-ND")
    assert row["variation_matched"] is False
    assert row["packaging"] is None
    assert row["pack_quantity"] is None


def test_extract_is_case_insensitive_about_the_sku():
    assert extract(PRODUCT_PAYLOAD, "296-1411-1-nd")["variation_matched"] is True


def test_extract_survives_a_payload_with_nothing_in_it():
    row = extract({}, "296-1411-1-ND")
    assert row["manufacturer_part"] is None
    assert row["variation_matched"] is False


# --------------------------------------------------------------------------
# fetch_products
# --------------------------------------------------------------------------
def test_fetch_products_returns_one_row_per_sku(digikey, digikey_env, workspace):
    rows = fetch_products(["296-1411-1-ND"])
    assert len(rows) == 1
    assert rows[0]["SKU"] == "296-1411-1-ND"
    assert rows[0]["packaging"] == "Cut Tape"


def test_fetch_products_keeps_a_missing_sku_in_place(digikey, digikey_env, workspace):
    """A 404 must not silently drop the SKU, or output stops matching input."""
    digikey.status_code = 404
    rows = fetch_products(["no-such-sku"])
    assert rows == [{"SKU": "no-such-sku", "error": "no API result"}]


def test_fetch_product_wraps_a_single_sku(digikey, digikey_env, workspace):
    assert fetch_product("296-1411-1-ND")["SKU"] == "296-1411-1-ND"


def test_fetch_products_reuses_a_supplied_client(client, workspace):
    """Passing a client must not trigger a second token grant."""
    rows = fetch_products(["296-1411-1-ND"], client)
    assert rows[0]["manufacturer_part"] == "NE555P"


def test_on_result_fires_per_sku_with_the_raw_payload(digikey, digikey_env, workspace):
    seen = []
    fetch_products(["296-1411-1-ND"], on_result=lambda row, raw: seen.append((row, raw)))
    assert len(seen) == 1
    row, raw = seen[0]
    assert row["SKU"] == "296-1411-1-ND"
    assert raw == PRODUCT_PAYLOAD


def test_library_call_prints_nothing(digikey, digikey_env, workspace, capsys):
    """Importing callers own their output; the library only logs."""
    fetch_products(["296-1411-1-ND"])
    assert capsys.readouterr().out == ""


# --------------------------------------------------------------------------
# Caching
# --------------------------------------------------------------------------
def test_second_fetch_is_served_from_cache(digikey, digikey_env, workspace):
    fetch_products(["296-1411-1-ND"])
    assert len(digikey) == 1
    fetch_products(["296-1411-1-ND"])
    assert len(digikey) == 1, "second call should not hit the API"


def test_refresh_bypasses_the_cache(digikey, digikey_env, workspace):
    fetch_products(["296-1411-1-ND"])
    fetch_products(["296-1411-1-ND"], refresh=True)
    assert len(digikey) == 2


def test_products_land_in_the_shared_cache_root(digikey, digikey_env, workspace):
    fetch_products(["296-1411-1-ND"])
    written = list((workspace / ".cache/.digikey/products").glob("*.json"))
    assert len(written) == 1


def test_cache_dir_can_be_overridden(digikey, digikey_env, workspace):
    alt = workspace / "elsewhere"
    fetch_products(["296-1411-1-ND"], cache_dir=alt)
    assert list(alt.glob("*.json"))


# --------------------------------------------------------------------------
# summarise
# --------------------------------------------------------------------------
@pytest.mark.parametrize("rows,expected", [
    ([], {"fetched": 0, "not_found": 0, "no_variation_match": 0}),
    ([{"SKU": "a", "error": "no API result"}],
     {"fetched": 0, "not_found": 1, "no_variation_match": 0}),
    ([{"SKU": "a", "variation_matched": True}],
     {"fetched": 1, "not_found": 0, "no_variation_match": 0}),
    ([{"SKU": "a", "variation_matched": False}],
     {"fetched": 1, "not_found": 0, "no_variation_match": 1}),
])
def test_summarise_counts(rows, expected):
    assert summarise(rows) == expected


def test_dumps_is_a_json_list():
    import json
    assert json.loads(products.dumps([{"SKU": "a"}])) == [{"SKU": "a"}]
