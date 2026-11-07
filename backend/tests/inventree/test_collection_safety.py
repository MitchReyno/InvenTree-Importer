"""Incomplete/foreign collection reads must never authorize absence-based writes."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from requests import Timeout

from invimport.inventree import collections
from invimport.inventree.api import Part, connect
from invimport.inventree.collections import DiscoveryError, list_models, list_rows
from invimport.inventree.parts import apply_parameters, find_part_by_ipn
from invimport.inventree.purchase_orders import orders_by_reference, supplier_parts_by_sku
from invimport.inventree.stock import resolve_location


class Pages:
    api_url = "https://inventory.example/prefix/api/"

    def __init__(self, pages):
        self.pages = iter(pages)
        self.calls = []

    def get(self, route, params=None):
        self.calls.append((route, params))
        page = next(self.pages)
        if isinstance(page, Exception):
            raise page
        return page


def page(rows, next_link=None, count=None):
    result = {"results": rows, "next": next_link}
    if count is not None:
        result["count"] = count
    return result


@pytest.mark.parametrize("link", [
    "?offset=1&part=42", "/prefix/api/stock/?offset=1&part=42",
    "https://inventory.example/prefix/api/stock/?offset=1&part=42",
])
def test_follows_valid_links_and_preserves_query_outside_sdk_url(link):
    api = Pages([page([{"pk": 1}], link, 2), page([{"pk": 2}], count=2)])
    assert list_rows(api, "stock/", params={"part": 42}) == [{"pk": 1}, {"pk": 2}]
    assert api.calls == [("stock/", {"part": 42}),
                         ("stock/", {"offset": "1", "part": "42"})]


@pytest.mark.parametrize("link", [
    "https://attacker.example/prefix/api/stock/?offset=1",
    "//attacker.example/prefix/api/stock/", "http://inventory.example/prefix/api/stock/",
    "ftp://inventory.example/prefix/api/stock/", "/other/api/stock/",
    "/prefix/api/../private/", "/prefix/api/%2e%2e/private/",
    "https://user:secret@inventory.example/prefix/api/stock/",
    "/prefix/api/stock/#fragment", "/prefix/api/%5cprivate/",
    "/prefix/api/https://attacker.example/", "/prefix/api//private/",
    "/prefix/api/stock/?offset=1&offset=2",
])
def test_foreign_or_escaping_next_is_rejected_before_dispatch(link):
    api = Pages([page([], link)])
    with pytest.raises(DiscoveryError):
        list_rows(api, "stock/")
    assert len(api.calls) == 1


@pytest.mark.parametrize("invalid", [None, {}, {"results": []},
    {"results": None, "next": None}, [None], page([], False),
    page([], count=1), page([], count=True)])
def test_invalid_collection_never_becomes_empty_success(invalid):
    with pytest.raises(DiscoveryError):
        list_rows(Pages([invalid]), "part/")


def test_late_transport_failure_preserves_cause_without_partial_return():
    failure = Timeout("private transport context")
    api = Pages([page([{"pk": 1}], "?offset=1"), failure])
    with pytest.raises(DiscoveryError, match="part/") as caught:
        list_rows(api, "part/")
    assert caught.value.__cause__ is failure
    assert "private" not in str(caught.value)


@pytest.mark.parametrize("pages", [
    [page([{"pk": 1}], "?offset=1"), page([{"pk": 1}], "?offset=2")],
    [page([], "?offset=1"), page([], "?offset=1")],
])
def test_repeated_page_or_request_is_incomplete(pages):
    with pytest.raises(DiscoveryError, match="loop|repeated"):
        list_rows(Pages(pages), "part/")


def test_page_and_row_bounds_are_failures(monkeypatch):
    monkeypatch.setattr(collections, "MAX_PAGES", 1)
    with pytest.raises(DiscoveryError, match="page bound"):
        list_rows(Pages([page([{"pk": 1}], "?offset=1")]), "part/")
    monkeypatch.setattr(collections, "MAX_ROWS", 1)
    with pytest.raises(DiscoveryError, match="row bound"):
        list_rows(Pages([[{"pk": 1}, {"pk": 2}]]), "part/")


@pytest.mark.parametrize("pk", [None, True, "4", 0, -1])
def test_sdk_adapter_rejects_invalid_identity(pk):
    model = Mock(__name__="Part", URL="part/")
    with pytest.raises(DiscoveryError, match="identity"):
        list_models(model, Pages([[{"pk": pk}]]))
    model.assert_not_called()


@pytest.mark.parametrize("family", ["part", "supplier", "order", "location", "parameter"])
def test_absence_consumers_find_second_page_before_mutation(inventree, family):
    api = connect()
    original = api.get
    row = {
        "part": {"pk": 14, "IPN": "IC-14"},
        "supplier": {"pk": 14, "SKU": "SKU-14", "supplier": 2, "part": 4},
        "order": {"pk": 14, "supplier_reference": "PO-14", "supplier": 2},
        "location": {"pk": 14, "pathstring": "Shelf/Bin"},
        "parameter": {"pk": 14, "template": 3, "model_id": 4, "data": "desired"},
    }[family]
    route = {"part": Part.URL, "supplier": "company/part/", "order": "order/po/",
             "location": "stock/location/", "parameter": "parameter"}[family]
    # SDK URL attributes omit or include a trailing slash depending on class.
    def get(requested, params=None):
        if requested.rstrip("/") == route.rstrip("/"):
            if (params or {}).get("offset"):
                return page([row])
            return page([], "?offset=1")
        return original(requested, params=params)
    api.get = get
    api.post = Mock(side_effect=AssertionError("must not create"))
    if family == "part":
        assert find_part_by_ipn(api, "IC-14").pk == 14
    elif family == "supplier":
        assert supplier_parts_by_sku(api, 2)["SKU-14"].pk == 14
    elif family == "order":
        assert orders_by_reference(api, 2)["PO-14"].pk == 14
    elif family == "location":
        assert resolve_location(api, "Shelf/Bin", write=True).pk == 14
    else:
        assert apply_parameters(api, 4, {"Template": "desired"},
                                {"Template": SimpleNamespace(pk=3)}, write=True) == 0
    api.post.assert_not_called()


def test_late_parameter_failure_does_not_create_missing_values(inventree):
    api = connect()
    api.get = Mock(side_effect=[page([], "?offset=1"), Timeout()])
    api.post = Mock()
    with pytest.raises(DiscoveryError):
        apply_parameters(api, 4, {"Template": "desired"},
                         {"Template": SimpleNamespace(pk=3)}, write=True)
    api.post.assert_not_called()


def test_report_stock_read_keeps_second_page():
    from invimport.inventree.importplan import PlanBuilder
    api = Pages([{"pk": 42, "name": "Part"},
                 page([{"pk": 1, "quantity": 2}], "?offset=1"),
                 page([{"pk": 2, "quantity": 3}])])
    result = PlanBuilder(api, None).part(42)
    assert [row["pk"] for row in result["stock"]] == [1, 2]


@pytest.mark.parametrize("row", [
    {"pk": 1, "model_id": 4},
    {"pk": 1, "model_id": 4, "template": True},
    {"pk": 1, "model_id": 99, "template": 3},
])
def test_malformed_parameter_identity_cannot_authorize_a_create(inventree, row):
    api = connect()
    api.get = Mock(return_value=[row])
    api.post = Mock()
    with pytest.raises(DiscoveryError):
        apply_parameters(api, 4, {"Template": "desired"},
                         {"Template": SimpleNamespace(pk=3)}, write=True)
    api.post.assert_not_called()
