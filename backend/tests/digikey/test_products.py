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
    assert row["image"] == "https://mm.digikey.com/photo/NE555P.jpg"
    assert row["images"] == ["https://mm.digikey.com/photo/NE555P.jpg"]


def test_extract_resolves_the_requested_variation():
    """Packaging and MOQ must describe the SKU asked for, not the product."""
    row = extract(PRODUCT_PAYLOAD, "296-1411-1-ND")
    assert row["variation_matched"] is True
    assert row["packaging"] == "Cut Tape"
    assert row["moq"] == 1
    assert row["standard_package"] == 2500


def test_extract_prices_at_the_lowest_break_quantity():
    """0.82 is the qty-1 price; 0.71 is the qty-10 price and must not win."""
    assert extract(PRODUCT_PAYLOAD, "296-1411-1-ND")["unit_price"] == 0.82


def test_extract_flags_a_sku_that_matches_no_variation():
    row = extract(PRODUCT_PAYLOAD, "296-DIFFERENT-ND")
    assert row["variation_matched"] is False
    assert row["packaging"] is None
    assert row["standard_package"] is None


def test_extract_is_case_insensitive_about_the_sku():
    assert extract(PRODUCT_PAYLOAD, "296-1411-1-nd")["variation_matched"] is True


def test_extract_makes_protocol_relative_urls_absolute():
    """DigiKey datasheets often arrive as '//mm.digikey.com/...'; InvenTree rejects those."""
    payload = {
        "Product": {
            "ProductUrl": "//www.digikey.com/x",
            "DatasheetUrl": "//mm.digikey.com/doc.pdf",
            "PhotoUrl": "//mm.digikey.com/photo.jpg",
        }
    }
    row = extract(payload, "P5166-ND")
    assert row["link"] == "https://www.digikey.com/x"
    assert row["datasheet"] == "https://mm.digikey.com/doc.pdf"
    assert row["image"] == "https://mm.digikey.com/photo.jpg"


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


# --------------------------------------------------------------------------
# Categorisation and specs (for the part import)
# --------------------------------------------------------------------------
def test_category_path_flattens_the_nested_chain():
    product = {"Category": {"Name": "Resistors", "ChildCategories": [
        {"Name": "Through Hole Resistors", "ChildCategories": []}]}}
    assert products.category_path(product) == ["Resistors",
                                               "Through Hole Resistors"]


def test_category_path_of_a_payload_without_one():
    assert products.category_path({}) == []


def test_category_path_survives_a_self_referencing_payload():
    """A cycle must not spin forever."""
    node = {"Name": "Loop"}
    node["ChildCategories"] = [node]
    assert products.category_path({"Category": node}) == ["Loop"]


def test_parameters_are_flattened_by_name():
    product = {"Parameters": [
        {"ParameterText": "Resistance", "ValueText": "100 kOhms"},
        {"ParameterText": "Tolerance", "ValueText": "±1%"},
    ]}
    assert products.parameters(product) == {"Resistance": "100 kOhms",
                                            "Tolerance": "±1%"}


def test_parameters_are_passed_through_untouched():
    """'-' means absent, but deciding that belongs to the value layer."""
    product = {"Parameters": [{"ParameterText": "Features", "ValueText": "-"}]}
    assert products.parameters(product) == {"Features": "-"}


def test_a_duplicated_parameter_keeps_the_first_value():
    product = {"Parameters": [
        {"ParameterText": "Package", "ValueText": "Axial"},
        {"ParameterText": "Package", "ValueText": "Radial"},
    ]}
    assert products.parameters(product) == {"Package": "Axial"}


def test_incomplete_parameter_entries_are_dropped():
    product = {"Parameters": [{"ParameterText": "Resistance"},
                              {"ValueText": "orphan"}]}
    assert products.parameters(product) == {}


def test_fetch_image_writes_to_the_cache(digikey, workspace):
    path = products.fetch_image("https://mm.digikey.com/photo/NE555P.jpg")
    assert path is not None
    assert path.read_bytes() == b"\xff\xd8\xff\xd9"
    assert path.resolve().parent == (workspace / ".cache/.digikey/images").resolve()
    assert len(digikey) == 1
    products.fetch_image("https://mm.digikey.com/photo/NE555P.jpg")
    assert len(digikey) == 1, "second call should not hit the network"


def test_extract_carries_category_and_parameters():
    row = products.extract(PRODUCT_PAYLOAD, "296-1411-1-ND")
    assert row["category_path"] == ["Integrated Circuits (ICs)", "Clock/Timing"]
    assert row["parameters"]["Package / Case"] == "8-DIP"
    assert row["parameters"]["Operating Temperature"] == "0°C ~ 70°C"


# --------------------------------------------------------------------------
# Retired part numbers
#
# DigiKey retires part numbers. A SKU on a 2024 invoice can 404 today even
# though the product is still listed under a new one, and an order full of
# historical SKUs would otherwise import nothing.
# --------------------------------------------------------------------------
def test_a_retired_part_number_is_found_by_search(digikey, digikey_env,
                                                  workspace):
    from invimport.digikey.products import fetch_product

    digikey.retired = {"296-1411-1-ND"}          # productdetails 404s for it

    row = fetch_product("296-1411-1-ND")

    assert row["manufacturer_part"] == "NE555P"
    assert row.get("error") is None


def _renumbered_as(new_pn: str) -> dict:
    """The canned product, listed under a different part number than asked for."""
    import copy

    product = copy.deepcopy(PRODUCT_PAYLOAD["Product"])
    product["ProductVariations"][0]["DigiKeyProductNumber"] = new_pn
    return product


def test_the_current_part_number_is_reported(digikey, digikey_env, workspace):
    """The user should know the SKU they asked for is not the current one."""
    from invimport.digikey.products import fetch_product

    digikey.retired = {"296-1411-1-ND"}
    digikey.search_results = [_renumbered_as("296-NE555P-ND")]

    row = fetch_product("296-1411-1-ND")

    assert row["renumbered"] == "296-NE555P-ND"


def test_a_renumbered_product_still_yields_packaging_and_price(
        digikey, digikey_env, workspace):
    """
    The old number named this product, and it has one variation.

    Without this the fallback recovers the identity but drops the packaging,
    MOQ and price - most of why the lookup exists - because the requested SKU
    matches no variation any more.
    """
    from invimport.digikey.products import fetch_product

    digikey.retired = {"296-1411-1-ND"}
    digikey.search_results = [_renumbered_as("296-NE555P-ND")]

    row = fetch_product("296-1411-1-ND")

    assert row["variation_matched"] is True
    assert row["packaging"] == "Cut Tape"
    assert row["unit_price"] == 0.82


def test_a_product_with_several_variations_is_not_assumed(digikey, digikey_env,
                                                          workspace):
    """
    One variation means there is nothing to choose between.

    With several, the retired number picked one of them and we no longer know
    which - so the packaging is left unset rather than guessed.
    """
    import copy

    from invimport.digikey.products import fetch_product

    product = copy.deepcopy(PRODUCT_PAYLOAD["Product"])
    first = product["ProductVariations"][0]
    product["ProductVariations"] = [
        {**first, "DigiKeyProductNumber": "296-NE555P-ND"},
        {**first, "DigiKeyProductNumber": "296-NE555P-TR-ND",
         "PackageType": {"Name": "Tape & Reel"}},
    ]
    digikey.retired = {"296-1411-1-ND"}
    digikey.search_results = [product]

    row = fetch_product("296-1411-1-ND")

    assert row["manufacturer_part"] == "NE555P"   # identity still recovered
    assert row["variation_matched"] is False
    assert row["packaging"] is None


def test_an_ambiguous_search_is_not_guessed_at(digikey, digikey_env, workspace):
    """
    Several matches means the old number does not identify one product.

    Picking one is how the wrong part ends up in an inventory, so nothing is
    returned and the SKU is reported as not found.
    """
    from invimport.digikey.products import fetch_product

    product = PRODUCT_PAYLOAD["Product"]
    digikey.retired = {"296-1411-1-ND"}
    digikey.search_results = [product, {**product, "ManufacturerProductNumber": "OTHER"}]

    row = fetch_product("296-1411-1-ND")

    assert row["error"] == "no API result"


def test_a_search_with_no_match_is_still_not_found(digikey, digikey_env,
                                                   workspace):
    from invimport.digikey.products import fetch_product

    digikey.retired = {"NOPE-ND"}
    digikey.search_results = []

    assert fetch_product("NOPE-ND")["error"] == "no API result"


def test_a_current_part_number_never_reaches_the_search(digikey, digikey_env,
                                                        workspace):
    """The fallback must cost nothing when productdetails answers."""
    from invimport.digikey.products import fetch_product

    fetch_product("296-1411-1-ND")

    assert not any("search/keyword" in call["url"] for call in digikey.calls)

