"""Order history and sales orders: paging, parsing, cache keys."""

from __future__ import annotations

import pytest

from invimport.digikey.orders import (
    PAGE_SIZE,
    default_range,
    extract_order,
    fetch_order_history,
    fetch_orders,
    fetch_sales_orders,
    line_items,
)

from tests.support import ORDER_PAYLOAD


# --------------------------------------------------------------------------
# Paging
# --------------------------------------------------------------------------
def pages(*sizes):
    """Script a history sweep: one page per size given."""
    total = sum(sizes)
    return [{"TotalOrders": total, "Orders": [{"OrderNumber": i} for i in range(n)]}
            for n in sizes]


def test_short_final_page_ends_the_sweep(client, digikey, workspace):
    digikey.pages = pages(PAGE_SIZE, PAGE_SIZE, 10)
    orders = fetch_order_history(client, "2026-01-01", "2026-02-01")
    assert len(orders) == 60
    assert [c["params"]["PageNumber"] for c in digikey.calls] == [1, 2, 3]


def test_exact_multiple_stops_on_total_not_an_extra_call(client, digikey, workspace):
    """50 orders in two full pages: a third request would be wasted quota."""
    digikey.pages = pages(PAGE_SIZE, PAGE_SIZE)
    orders = fetch_order_history(client, "2026-01-01", "2026-02-01")
    assert len(orders) == 50
    assert len(digikey) == 2


def test_empty_range_makes_one_call(client, digikey, workspace):
    digikey.pages = pages(0)
    assert fetch_order_history(client, "2026-01-01", "2026-02-01") == []
    assert len(digikey) == 1


def test_runaway_total_hits_the_safety_limit(client, digikey, workspace):
    """A bad TotalOrders must not loop forever."""
    from invimport.digikey.orders import MAX_PAGES
    digikey.pages = [{"TotalOrders": 10 ** 9,
                      "Orders": [{"OrderNumber": i} for i in range(PAGE_SIZE)]}] * 500
    fetch_order_history(client, "2026-01-01", "2026-02-01")
    assert len(digikey) == MAX_PAGES


def test_request_carries_the_documented_parameters(client, digikey, workspace):
    fetch_order_history(client, "2026-06-01", "2026-07-31")
    call = digikey.calls[0]
    assert call["params"] == {
        "StartDate": "2026-06-01", "EndDate": "2026-07-31",
        "Shared": "false", "PageNumber": 1, "PageSize": 25,
    }


def test_account_header_is_sent_for_orders(client, digikey, workspace):
    """Two-legged OAuth requires X-DIGIKEY-Account-Id or the API refuses."""
    fetch_order_history(client, "2026-06-01", "2026-07-31")
    assert digikey.calls[0]["headers"]["X-DIGIKEY-Account-Id"] == "test-account"


def test_shared_flag_is_sent_as_a_lowercase_string(client, digikey, workspace):
    fetch_order_history(client, "2026-06-01", "2026-07-31", shared=True)
    assert digikey.calls[0]["params"]["Shared"] == "true"


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
def test_extract_order_flattens_the_nesting():
    order = extract_order(ORDER_PAYLOAD)
    assert order["order_number"] == 12345678
    assert order["status"] == "Shipped"
    assert order["purchase_order"] == "PO-42"

    so = order["sales_orders"][0]
    assert so["sales_order_id"] == 87654321
    assert so["ship_method"] == "DHL"

    line = so["line_items"][0]
    assert line["digikey_part"] == "296-1411-1-ND"
    assert line["quantity_ordered"] == 10
    assert line["quantity_shipped"] == 10
    assert line["unit_price"] == 0.82


def test_extract_order_keeps_shipment_tracking():
    ship = extract_order(ORDER_PAYLOAD)["sales_orders"][0]["line_items"][0]["shipments"][0]
    assert ship["tracking_number"] == "1Z999AA"
    assert ship["shipped_date"] == "2026-07-02"
    assert ship["quantity"] == 10


def test_extract_order_survives_missing_sections():
    order = extract_order({"OrderNumber": 1})
    assert order["sales_orders"] == []
    assert order["status"] is None


def test_line_items_carries_order_context():
    rows = line_items([extract_order(ORDER_PAYLOAD)])
    assert len(rows) == 1
    assert rows[0]["order_number"] == 12345678
    assert rows[0]["sales_order_id"] == 87654321
    assert rows[0]["digikey_part"] == "296-1411-1-ND"


def test_line_items_of_nothing_is_empty():
    assert line_items([]) == []


# --------------------------------------------------------------------------
# Date range
# --------------------------------------------------------------------------
def test_default_range_is_the_last_30_days():
    from datetime import date, timedelta
    start, end = default_range()
    assert end == date.today().isoformat()
    assert start == (date.today() - timedelta(days=30)).isoformat()


def test_explicit_dates_are_kept():
    assert default_range("2026-01-01", "2026-02-01") == ("2026-01-01", "2026-02-01")


def test_inverted_range_raises(client, workspace):
    with pytest.raises(ValueError, match="after"):
        fetch_orders(client, start_date="2026-08-01", end_date="2026-01-01")


# --------------------------------------------------------------------------
# Caching
# --------------------------------------------------------------------------
def test_history_page_is_cached_and_reused(client, digikey, workspace):
    fetch_orders(client, start_date="2026-01-01", end_date="2026-01-31")
    assert len(digikey) == 1
    fetch_orders(client, start_date="2026-01-01", end_date="2026-01-31")
    assert len(digikey) == 1


def test_orders_land_in_the_shared_cache_root(client, digikey, workspace):
    fetch_orders(client, start_date="2026-01-01", end_date="2026-01-31")
    names = [p.name for p in (workspace / ".cache/.digikey/orders").glob("*.json")]
    assert any(n.startswith("history-2026-01-01_2026-01-31-own-p1") for n in names)


def test_a_different_window_is_a_different_key(client, digikey, workspace):
    """Reusing a cached page across windows would serve the wrong orders."""
    fetch_orders(client, start_date="2026-01-01", end_date="2026-01-31")
    fetch_orders(client, start_date="2026-02-01", end_date="2026-02-28")
    assert len(digikey) == 2


def test_shared_does_not_collide_with_unshared(client, digikey, workspace):
    fetch_orders(client, start_date="2026-01-01", end_date="2026-01-31")
    fetch_orders(client, start_date="2026-01-01", end_date="2026-01-31", shared=True)
    assert len(digikey) == 2


def test_refresh_bypasses_the_order_cache(client, digikey, workspace):
    fetch_orders(client, start_date="2026-01-01", end_date="2026-01-31")
    fetch_orders(client, start_date="2026-01-01", end_date="2026-01-31", refresh=True)
    assert len(digikey) == 2


def test_sales_order_is_cached_by_id(client, digikey, workspace):
    fetch_sales_orders([87654321], client)
    assert len(digikey) == 1
    fetch_sales_orders([87654321], client)
    assert len(digikey) == 1


def test_sales_order_lookup_does_not_sweep_history(client, digikey, workspace):
    """Asking for one order must not also spend quota on 30 days of history."""
    fetch_sales_orders([87654321], client)
    assert len(digikey) == 1
    assert not any(url.endswith("/orders") for url in digikey.urls)


def test_missing_sales_order_is_skipped(client, digikey, workspace):
    digikey.status_code = 404
    assert fetch_sales_orders([1], client) == []
