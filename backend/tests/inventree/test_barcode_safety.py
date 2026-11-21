"""Barcode classification and lost-response reconciliation with no live effects."""
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from requests import HTTPError, Timeout
from requests.exceptions import InvalidJSONError

from invimport.inventree import stock
from invimport.inventree.stock import BarcodeError, BarcodeInUse, add_stock, already_imported


def http_error(status, body):
    return HTTPError({"status_code": status, "body": json.dumps(body),
                      "headers": {"Authorization": "secret"}})


@pytest.mark.parametrize(("failure", "category"), [
    (http_error(400, {"error": "invalid input"}), "validation"),
    (http_error(401, {"error": "No match found for barcode data"}), "denied/auth"),
    (http_error(403, {}), "denied/auth"),
    (http_error(429, {}), "transient"),
    (http_error(500, {}), "transient"), (Timeout("secret"), "transport"),
    (InvalidJSONError("secret"), "invalid_response"),
])
def test_lookup_failure_is_not_absence(failure, category):
    api = Mock()
    api.post.side_effect = failure
    with pytest.raises(BarcodeError) as caught:
        already_imported(api, "key")
    assert caught.value.category == category
    assert caught.value.__cause__ is failure
    assert "secret" not in str(caught.value)


def test_only_specific_unknown_barcode_contract_is_absence():
    api = Mock()
    api.post.side_effect = http_error(400, {"error": "No match found for barcode data"})
    assert already_imported(api, "key") is None


@pytest.mark.parametrize("response", [None, [], {}, {"stockitem": {}},
    {"stockitem": True}, {"stockitem": {"pk": True}}, {"stockitem": {"pk": "4"}},
    {"stockitem": {"pk": -1}}, {"stockitem": {"pk": "invalid"}}])
def test_invalid_lookup_response_is_not_absence(response):
    api = Mock()
    api.post.return_value = response
    with pytest.raises(BarcodeError) as caught:
        already_imported(api, "key")
    assert caught.value.category == "invalid_response"


def test_non_stock_barcode_conflicts_instead_of_authorizing_stock_create():
    api = Mock()
    api.post.return_value = {"part": {"pk": 4}}
    with pytest.raises(BarcodeError) as caught:
        already_imported(api, "key")
    assert caught.value.category == "conflict"


@pytest.mark.parametrize("lookup", [Timeout(), None, {},
    http_error(400, {"error": "No match found for barcode data"})])
def test_uncertain_link_never_deletes_and_retains_created_pk(monkeypatch, lookup):
    item = Mock(pk=42)
    monkeypatch.setattr(stock.StockItem, "create", Mock(return_value=item))
    api = Mock()
    api.post.side_effect = [Timeout("link response lost"), lookup]
    with pytest.raises(BarcodeError) as caught:
        add_stock(api, part=4, quantity=1, key="key")
    assert not isinstance(caught.value, BarcodeInUse)
    assert caught.value.category == "uncertain_write"
    assert caught.value.stock_item_pk == 42
    item.delete.assert_not_called()
    item.save.assert_not_called()


def test_lost_link_response_with_confirmed_intended_owner_is_success(monkeypatch):
    item = Mock(pk=42)
    monkeypatch.setattr(stock.StockItem, "create", Mock(return_value=item))
    api = Mock()
    api.post.side_effect = [Timeout(), {"stockitem": {"pk": 42}}]
    assert add_stock(api, part=4, quantity=1, key="key") is item
    item.delete.assert_not_called()


def test_confirmed_other_owner_allows_only_new_duplicate_cleanup(monkeypatch):
    item = Mock(pk=42)
    item.delete.return_value = SimpleNamespace(status_code=204)
    monkeypatch.setattr(stock.StockItem, "create", Mock(return_value=item))
    api = Mock()
    api.post.side_effect = [http_error(400, {"error": "Barcode matches existing item"}),
                            {"stockitem": {"pk": 41}}]
    with pytest.raises(BarcodeInUse) as caught:
        add_stock(api, part=4, quantity=1, key="key")
    assert caught.value.stock_item_pk == 42 and caught.value.owner_pk == 41
    item.delete.assert_called_once_with()


def test_unsettled_duplicate_delete_remains_uncertain(monkeypatch):
    item = Mock(pk=42)
    item.delete.side_effect = Timeout()
    monkeypatch.setattr(stock.StockItem, "create", Mock(return_value=item))
    api = Mock()
    api.post.side_effect = [None, {"stockitem": {"pk": 41}}]
    with pytest.raises(BarcodeError) as caught:
        add_stock(api, part=4, quantity=1, key="key")
    assert not isinstance(caught.value, BarcodeInUse)
    assert caught.value.category == "uncertain_write"
    assert caught.value.stock_item_pk == 42


def test_http_success_without_ownership_is_uncertain(monkeypatch):
    item = Mock(pk=42)
    monkeypatch.setattr(stock.StockItem, "create", Mock(return_value=item))
    api = Mock()
    api.post.side_effect = [{"success": "okay"}, {}]
    with pytest.raises(BarcodeError, match="uncertain_write"):
        add_stock(api, part=4, quantity=1, key="key")
    item.delete.assert_not_called()


@pytest.mark.parametrize("response", [None, SimpleNamespace(status_code=200)])
def test_unconfirmed_delete_response_cannot_report_duplicate_success(monkeypatch, response):
    item = Mock(pk=42)
    item.delete.return_value = response
    monkeypatch.setattr(stock.StockItem, "create", Mock(return_value=item))
    api = Mock()
    api.post.side_effect = [None, {"stockitem": {"pk": 41}}]
    with pytest.raises(BarcodeError) as caught:
        add_stock(api, part=4, quantity=1, key="key")
    assert not isinstance(caught.value, BarcodeInUse)
    assert caught.value.stock_item_pk == 42 and caught.value.owner_pk == 41


@pytest.mark.parametrize("stock_owner", [None, {}, "bad", [], True, {"pk": "4"}])
@pytest.mark.parametrize("other_owner", ["part", "stocklocation"])
def test_malformed_stock_owner_cannot_fall_back_to_another_model(stock_owner, other_owner):
    api = Mock()
    api.post.return_value = {"stockitem": stock_owner, other_owner: {"pk": 4}}
    with pytest.raises(BarcodeError) as caught:
        already_imported(api, "key")
    assert caught.value.category == "invalid_response"


def test_multiple_valid_model_owners_are_ambiguous():
    api = Mock()
    api.post.return_value = {"stockitem": {"pk": 42}, "part": {"pk": 4}}
    with pytest.raises(BarcodeError, match="invalid_response"):
        already_imported(api, "key")


def test_malformed_mixed_link_readback_cannot_authorize_duplicate_cleanup(monkeypatch):
    item = Mock(pk=42)
    monkeypatch.setattr(stock.StockItem, "create", Mock(return_value=item))
    api = Mock()
    api.post.side_effect = [None, {"stockitem": "bad", "part": {"pk": 4}}]
    with pytest.raises(BarcodeError) as caught:
        add_stock(api, part=4, quantity=1, key="key")
    assert caught.value.category == "uncertain_write"
    assert caught.value.stock_item_pk == 42
    item.delete.assert_not_called()


@pytest.mark.parametrize("contradiction", [{"stockitem": {"pk": 4}}, {"plugin": "matched"}])
def test_no_match_text_with_conflicting_owner_evidence_is_not_absence(contradiction):
    api = Mock()
    api.post.side_effect = http_error(400, {
        "error": "No match found for barcode data", **contradiction})
    with pytest.raises(BarcodeError):
        already_imported(api, "key")
