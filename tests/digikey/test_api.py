"""Transport failures must not be reported as missing DigiKey resources."""

from unittest.mock import Mock

import pytest
import requests

from invimport.digikey import api
from invimport.digikey.orders import fetch_order_history, fetch_sales_orders
from invimport.digikey.products import fetch_products
from tests.support import PRODUCT_PAYLOAD, Response


@pytest.fixture
def transport(monkeypatch):
    request = Mock(return_value=Response({"answer": 1}))
    monkeypatch.setattr(api.requests, "get", request)
    monkeypatch.setattr(api.requests, "post", request)
    sleep = Mock()
    monkeypatch.setattr(api.time, "sleep", sleep)
    return request, sleep


def test_missing_resource_is_the_only_none_result(transport):
    request, sleep = transport
    request.return_value = Response({}, 404)
    assert api.request_json("https://example.com", {}) is None
    assert request.call_count == 1
    sleep.assert_not_called()


@pytest.mark.parametrize("status", [400, 401, 403, 422, 501])
def test_permanent_http_failure_is_not_retried(status, transport):
    request, sleep = transport
    request.return_value = Response({"secret": "do not expose response bodies"}, status)
    with pytest.raises(api.DigiKeyError, match=str(status)) as caught:
        api.request_json("https://example.com", {}, label="part lookup")
    assert "secret" not in str(caught.value)
    assert request.call_count == 1
    sleep.assert_not_called()


@pytest.mark.parametrize("status", [408, 429, 500, 502, 503, 504])
def test_transient_failures_retry_and_then_raise(status, transport):
    request, sleep = transport
    request.return_value = Response({}, status)
    with pytest.raises(api.DigiKeyError, match=f"HTTP {status}"):
        api.request_json("https://example.com", {})
    assert request.call_count == api.MAX_RETRIES
    assert [call.args[0] for call in sleep.call_args_list] == [2, 4, 8]


@pytest.mark.parametrize("failure", [requests.ConnectionError, requests.Timeout])
def test_transport_failures_preserve_cause_after_bounded_retries(failure, transport):
    request, sleep = transport
    error = failure("transport failed")
    request.side_effect = error
    with pytest.raises(api.DigiKeyError, match="Request failed") as caught:
        api.request_json("https://example.com", {})
    assert caught.value.__cause__ is error
    assert request.call_count == api.MAX_RETRIES
    assert sleep.call_count == api.MAX_RETRIES - 1


def test_get_recovers_after_transient_failure(transport):
    request, sleep = transport
    request.side_effect = [Response({}, 503), Response({"answer": 1})]
    assert api.request_json("https://example.com", {}) == {"answer": 1}
    assert request.call_count == 2
    assert sleep.call_args_list[0].args == (2,)


@pytest.mark.parametrize("failure", [Response({}, 503), requests.Timeout("unknown outcome")])
def test_arbitrary_posts_are_not_replayed(failure, transport):
    request, sleep = transport
    request.side_effect = [failure]
    with pytest.raises(api.DigiKeyError):
        api.request_json("https://example.com", {}, json_body={"write": True})
    assert request.call_count == 1
    sleep.assert_not_called()


def test_explicitly_read_only_post_can_retry(transport):
    request, _ = transport
    request.side_effect = [Response({}, 503), Response({"Products": []})]
    client = api.Client("token", "client", api.Locale("AU", "AUD", "en"))
    assert client.post("https://example.com", {"Keywords": "x"},
                       retry_safe=True) == {"Products": []}
    assert request.call_count == 2


@pytest.mark.parametrize("payload", [[], None, "not an object"])
def test_invalid_response_shape_is_an_error(payload, transport):
    request, sleep = transport
    request.return_value = Response(payload)
    with pytest.raises(api.DigiKeyError, match="JSON object"):
        api.request_json("https://example.com", {})
    assert request.call_count == 1
    sleep.assert_not_called()


def test_invalid_json_preserves_cause(transport):
    request, _ = transport
    error = ValueError("invalid JSON")
    request.return_value.json = Mock(side_effect=error)
    with pytest.raises(api.DigiKeyError, match="Invalid JSON") as caught:
        api.request_json("https://example.com", {})
    assert caught.value.__cause__ is error
    assert request.call_count == 1


@pytest.mark.parametrize("fetch", [
    lambda client: fetch_products(["unknown"], client),
    lambda client: fetch_sales_orders([1], client),
    lambda client: fetch_order_history(client, "2026-01-01", "2026-01-31"),
])
def test_fetchers_propagate_service_failure_instead_of_missing_results(
        fetch, client, digikey, workspace, monkeypatch):
    digikey.status_code = 503
    monkeypatch.setattr(api.time, "sleep", lambda _: None)
    with pytest.raises(api.DigiKeyError, match="HTTP 503"):
        fetch(client)
    # A failed product lookup must not start the retired-number fallback.
    assert len(digikey) == api.MAX_RETRIES


def test_later_history_page_failure_does_not_return_partial_success(
        client, workspace, monkeypatch):
    monkeypatch.setattr("invimport.digikey.orders.PAGE_SIZE", 1)
    monkeypatch.setattr(client, "get", Mock(side_effect=[
        {"TotalOrders": 2, "Orders": [{"OrderNumber": 1}]},
        api.DigiKeyError("page 2 unavailable"),
    ]))
    with pytest.raises(api.DigiKeyError, match="page 2 unavailable"):
        fetch_order_history(client, "2026-01-01", "2026-01-31")


def test_retired_number_search_retries_a_safe_post(client, workspace, transport):
    request, _ = transport
    request.side_effect = [Response({}, 404), Response({}, 503),
                           Response({"Products": [PRODUCT_PAYLOAD["Product"]]})]
    rows = fetch_products(["296-1411-1-ND"], client)
    assert rows[0]["manufacturer_part"] == "NE555P"
    assert request.call_count == 3
    assert "json" in request.call_args_list[-1].kwargs
