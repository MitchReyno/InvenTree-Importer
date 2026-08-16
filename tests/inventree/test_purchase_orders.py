"""Importing DigiKey orders as InvenTree purchase orders."""

from __future__ import annotations

import copy

import pytest

from invimport.inventree.api import connect
from invimport.inventree.purchase_orders import (
    as_date,
    create_supplier,
    find_supplier,
    import_orders,
    list_suppliers,
    next_reference,
    supplier_parts_by_sku,
)
from tests.support import ORDER_PAYLOAD

# The shape fetch_orders() returns, which is what import_orders() consumes.
ORDER = {
    "order_number": 12345678,
    "date_entered": "2026-07-01T10:00:00Z",
    "currency": "AUD",
    "sales_orders": [
        {
            "sales_order_id": 87654321,
            "currency": "AUD",
            "total_price": 8.2,
            "line_items": [
                {
                    "digikey_part": "296-1411-1-ND",
                    "manufacturer_part": "NE555P",
                    "quantity_ordered": 10,
                    "quantity_shipped": 10,
                    "unit_price": 0.82,
                },
            ],
        }
    ],
}


@pytest.fixture
def order():
    """A fresh copy per test, so mutations cannot leak between them."""
    return copy.deepcopy(ORDER)


@pytest.fixture
def api(inventree):
    """A stub with a DigiKey supplier and one matching supplier part."""
    inventree.add_company("DigiKey", pk=1)
    inventree.add_supplier_part("296-1411-1-ND", supplier=1, part=4)
    return connect()


# --------------------------------------------------------------------------
# Supplier resolution
# --------------------------------------------------------------------------
def test_finds_the_digikey_supplier(api):
    assert find_supplier(api).name == "DigiKey"


def test_supplier_match_ignores_case(inventree):
    inventree.add_company("digikey", pk=1)
    assert find_supplier(connect()).pk == 1


def test_supplier_match_accepts_known_spellings(inventree):
    inventree.add_company("Digi-Key Electronics", pk=3)
    assert find_supplier(connect()).pk == 3


def test_missing_supplier_returns_none(inventree):
    inventree.add_company("Tayda Electronics", pk=2)
    assert find_supplier(connect()) is None


def test_an_explicit_name_is_not_alias_matched(inventree):
    """Aliases are a courtesy for the default, not a fuzzy search."""
    inventree.add_company("Digi-Key", pk=1)
    assert find_supplier(connect(), "Mouser") is None


def test_non_suppliers_are_not_offered(inventree):
    inventree.add_company("YAGEO", pk=5, is_supplier=False)
    inventree.add_company("Tayda", pk=2)
    assert [s.name for s in list_suppliers(connect())] == ["Tayda"]


def test_create_supplier_flags_it_as_a_supplier(inventree):
    create_supplier(connect())
    assert inventree.companies[-1]["name"] == "DigiKey"
    assert inventree.companies[-1]["is_supplier"] is True


# --------------------------------------------------------------------------
# Lookups
# --------------------------------------------------------------------------
def test_supplier_parts_are_indexed_upper_case(api):
    assert "296-1411-1-ND" in supplier_parts_by_sku(api, 1)


def test_supplier_parts_are_scoped_to_the_supplier(inventree):
    inventree.add_company("DigiKey", pk=1)
    inventree.add_supplier_part("OTHER-SKU", supplier=2)
    assert supplier_parts_by_sku(connect(), 1) == {}


def test_next_reference_comes_from_the_server(api):
    assert next_reference(api) == "PO-0001"


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------
def test_creates_a_purchase_order_with_its_line_item(api, inventree, order):
    result = import_orders([order], api, supplier=1, write=True)

    assert result.counts() == {"created": 1, "exists": 0, "skipped": 0,
                               "lines": 1, "unmatched": 0, "problems": 0}
    assert len(inventree.purchase_orders) == 1
    created = inventree.purchase_orders[0]
    assert created["supplier"] == 1
    assert created["reference"] == "PO-0001"
    # The DigiKey sales order id is what makes a re-run idempotent.
    assert created["supplier_reference"] == "87654321"
    assert created["creation_date"] == "2026-07-01"
    assert created["order_currency"] == "AUD"

    line = inventree.line_items[0]
    assert line["order"] == created["pk"]
    assert line["part"] == 1              # the SupplierPart pk, not the Part pk
    assert line["quantity"] == 10
    assert line["purchase_price"] == 0.82


def test_dry_run_writes_nothing(api, inventree, order):
    result = import_orders([order], api, supplier=1, write=False)

    assert result.counts()["created"] == 1        # what *would* happen
    assert inventree.purchase_orders == []
    assert inventree.line_items == []


def test_reimporting_the_same_order_is_a_no_op(api, inventree, order):
    import_orders([order], api, supplier=1, write=True)
    result = import_orders([order], api, supplier=1, write=True)

    assert result.counts()["exists"] == 1
    assert result.counts()["created"] == 0
    assert len(inventree.purchase_orders) == 1    # not two


def test_a_duplicate_within_one_run_is_caught(api, inventree, order):
    """Both copies share a sales order id, so the second must see the first."""
    result = import_orders([order, copy.deepcopy(order)], api,
                           supplier=1, write=True)

    assert result.counts() == {"created": 1, "exists": 1, "skipped": 0,
                               "lines": 1, "unmatched": 0, "problems": 0}
    assert len(inventree.purchase_orders) == 1


def test_references_advance_across_several_orders(api, inventree, order):
    second = copy.deepcopy(order)
    second["order_number"] = 999
    second["sales_orders"][0]["sales_order_id"] = 111

    import_orders([order, second], api, supplier=1, write=True)

    assert [po["reference"] for po in inventree.purchase_orders] == ["PO-0001",
                                                                    "PO-0002"]


def test_an_unknown_sku_skips_the_whole_order(api, inventree, order):
    order["sales_orders"][0]["line_items"][0]["digikey_part"] = "NOT-STOCKED"
    result = import_orders([order], api, supplier=1, write=True)

    assert result.counts()["skipped"] == 1
    assert result.counts()["unmatched"] == 1
    assert inventree.purchase_orders == []
    assert "no supplier part" in result.orders[0].lines[0].reason
    # Nothing matched, so --partial would not help and must not be suggested.
    assert result.orders[0].reason == "no line item matched a supplier part"


def test_one_unmatched_line_skips_an_otherwise_good_order(api, inventree, order):
    """
    The default refuses to book a purchase order that is quietly short of what
    was actually bought. Without this, a half-imported order looks complete.
    """
    order["sales_orders"][0]["line_items"].append({
        "digikey_part": "NOT-STOCKED",
        "quantity_ordered": 5,
        "unit_price": 1.0,
    })
    result = import_orders([order], api, supplier=1, write=True)

    assert result.counts()["created"] == 0
    assert result.counts()["skipped"] == 1
    assert inventree.purchase_orders == []
    assert "--partial" in result.orders[0].reason


def test_partial_imports_only_the_matched_lines(api, inventree, order):
    order["sales_orders"][0]["line_items"].append({
        "digikey_part": "NOT-STOCKED",
        "quantity_ordered": 5,
        "unit_price": 1.0,
    })
    result = import_orders([order], api, supplier=1, write=True, partial=True)

    assert result.counts()["created"] == 1
    assert result.counts()["lines"] == 1          # only the matched one
    assert result.counts()["unmatched"] == 1
    assert len(inventree.line_items) == 1


def test_partial_still_skips_an_order_with_nothing_matched(api, inventree, order):
    order["sales_orders"][0]["line_items"][0]["digikey_part"] = "NOT-STOCKED"
    result = import_orders([order], api, supplier=1, write=True, partial=True)

    assert result.counts()["created"] == 0
    assert inventree.purchase_orders == []


def test_a_zero_quantity_line_is_not_ordered(api, inventree, order):
    order["sales_orders"][0]["line_items"][0]["quantity_ordered"] = 0
    order["sales_orders"][0]["line_items"][0]["quantity_shipped"] = 0
    result = import_orders([order], api, supplier=1, write=True, partial=True)

    assert result.counts()["created"] == 0
    assert "quantity is zero" in result.orders[0].lines[0].reason


def test_quantity_ordered_wins_over_quantity_shipped(api, inventree, order):
    """A part-shipped line still belongs on the order at its full quantity."""
    order["sales_orders"][0]["line_items"][0]["quantity_shipped"] = 4
    import_orders([order], api, supplier=1, write=True)

    assert inventree.line_items[0]["quantity"] == 10


def test_each_sales_order_becomes_its_own_purchase_order(api, inventree, order):
    split = copy.deepcopy(order["sales_orders"][0])
    split["sales_order_id"] = 87654322
    order["sales_orders"].append(split)

    result = import_orders([order], api, supplier=1, write=True)

    assert result.counts()["created"] == 2
    assert len(inventree.purchase_orders) == 2


def test_an_order_without_sales_orders_is_a_problem(api, order):
    order["sales_orders"] = []
    result = import_orders([order], api, supplier=1, write=True)

    assert result.counts()["problems"] == 1
    assert "no sales orders" in result.problems[0]


def test_a_sales_order_without_an_id_is_skipped(api, order):
    order["sales_orders"][0]["sales_order_id"] = None
    result = import_orders([order], api, supplier=1, write=True)

    assert result.counts()["skipped"] == 1
    assert "no id" in result.orders[0].reason


def test_product_details_ride_along_with_an_unmatched_line(api, order):
    order["sales_orders"][0]["line_items"][0]["digikey_part"] = "NOT-STOCKED"
    products = {"NOT-STOCKED": {"SKU": "NOT-STOCKED",
                                "manufacturer_part": "NE555P",
                                "description": "IC OSC SINGLE TIMER"}}
    result = import_orders([order], api, supplier=1, write=True,
                           products=products)

    line = result.orders[0].lines[0]
    assert line.product["manufacturer_part"] == "NE555P"
    assert line.describe() == "NE555P  IC OSC SINGLE TIMER"


def test_product_matching_ignores_sku_case(api, order):
    products = {"296-1411-1-ND": {"SKU": "296-1411-1-nd",
                                  "manufacturer_part": "NE555P"}}
    order["sales_orders"][0]["line_items"][0]["digikey_part"] = "296-1411-1-nd"
    result = import_orders([order], api, supplier=1, write=False,
                           products=products)
    assert result.orders[0].lines[0].product is not None


def test_lines_describe_nothing_without_product_data(api, order):
    """--no-products must not break the report, only thin it."""
    result = import_orders([order], api, supplier=1, write=False)
    assert result.orders[0].lines[0].product is None
    assert result.orders[0].lines[0].describe() == ""


def test_a_company_object_is_accepted_instead_of_a_pk(api, inventree, order):
    import_orders([order], api, supplier=find_supplier(api), write=True)
    assert inventree.purchase_orders[0]["supplier"] == 1


def test_the_stub_saw_no_stale_routes(api, inventree, order):
    """Every call must hit a path the OpenAPI spec actually declares."""
    import_orders([order], api, supplier=1, write=True)
    assert inventree.bad_routes == []


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
@pytest.mark.parametrize("value,expected", [
    ("2026-07-01T10:00:00Z", "2026-07-01"),
    ("2026-07-01", "2026-07-01"),
    ("", None),
    (None, None),
    ("not a date", None),
])
def test_as_date(value, expected):
    assert as_date(value) == expected


def test_the_canned_digikey_payload_still_carries_the_fields_we_import():
    """Guards the fixture above against drift in the shared payload."""
    line = ORDER_PAYLOAD["SalesOrders"][0]["LineItems"][0]
    assert line["DigiKeyProductNumber"] == ORDER["sales_orders"][0]["line_items"][0][
        "digikey_part"]
