"""Attachment list errors block writes; existing and unknown are distinct."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from requests import Timeout

from invimport.inventree.datasheets import DatasheetFile, attach_datasheet_outcomes
from invimport.inventree.purchase_orders import (
    AttachmentState, attach_file, attach_file_outcome,
)


@pytest.fixture
def evidence(tmp_path):
    path = tmp_path / "evidence.pdf"
    path.write_bytes(b"evidence")
    return path


def test_failed_attachment_listing_blocks_upload(evidence):
    api = Mock()
    api.get.side_effect = Timeout()
    result = attach_file_outcome(api, "part", 4, evidence)
    assert result.state == AttachmentState.FAILED
    api.request.assert_not_called()


def test_late_attachment_page_failure_blocks_upload(evidence):
    api = Mock(api_url="https://inventory.example/api/")
    api.get.side_effect = [{"results": [], "next": "?offset=1"}, Timeout()]
    assert attach_file_outcome(api, "part", 4, evidence).state == AttachmentState.FAILED
    api.request.assert_not_called()


def test_second_page_existing_file_is_satisfied_and_boolean_stays_false(evidence):
    api = Mock(api_url="https://inventory.example/api/")
    pages = [{"results": [], "next": "?offset=1"},
             {"results": [{"filename": "media/" + evidence.name}], "next": None}]
    api.get.side_effect = pages * 2
    assert attach_file_outcome(api, "part", 4, evidence).state == AttachmentState.ALREADY_SATISFIED
    assert not attach_file(api, "part", 4, evidence)
    api.request.assert_not_called()


def test_lost_upload_response_is_unknown(evidence):
    api = Mock()
    api.get.return_value = []
    api.request.side_effect = Timeout()
    outcome = attach_file_outcome(api, "part", 4, evidence)
    assert outcome.state == AttachmentState.UNKNOWN
    assert (outcome.model_id, outcome.filename) == (4, evidence.name)
    assert not outcome.satisfied
    assert api.request.call_count == 1


def test_confirmed_upload_is_counted_once(evidence):
    api = Mock()
    api.get.return_value = []
    api.request.return_value = SimpleNamespace(status_code=201)
    assert attach_file_outcome(api, "part", 4, evidence).state == AttachmentState.UPLOADED


def test_datasheet_structured_outcomes_keep_existing_success(evidence):
    api = Mock()
    api.get.return_value = [{"filename": evidence.name}]
    results = attach_datasheet_outcomes(api, [DatasheetFile(evidence)], part=4,
                                       manufacturer_parts=[5])
    assert len(results) == 2 and all(result.satisfied for result in results)
    assert all(result.state == AttachmentState.ALREADY_SATISFIED for result in results)
    api.request.assert_not_called()


def test_malformed_attachment_row_blocks_upload(evidence):
    api = Mock()
    api.get.return_value = [{}]
    assert attach_file_outcome(api, "part", 4, evidence).state == AttachmentState.FAILED
    api.request.assert_not_called()


def test_explicit_upload_rejection_is_failed(evidence):
    from requests import HTTPError
    api = Mock()
    api.get.return_value = []
    api.request.side_effect = HTTPError({"status_code": 403, "body": "denied"})
    assert attach_file_outcome(api, "part", 4, evidence).state == AttachmentState.FAILED


def test_archive_failed_discovery_cannot_fall_through_to_upload(tmp_path, monkeypatch):
    from invimport.inventree import archive
    folder = tmp_path / "import-example"
    folder.mkdir()
    source = folder / "import-example.json"
    source.write_text("{}")
    document = SimpleNamespace(path=source, source={})
    target = archive.ArchiveTarget(kind=archive.SUPPLIER, pk=4, label="Supplier")
    monkeypatch.setattr(archive, "plan_targets", lambda lines: ([target], []))
    api = Mock()
    api.get.side_effect = Timeout()
    result = archive.archive_import(api, document, [], write=True)
    assert result.targets[0].outcome == archive.FAILED
    api.request.assert_not_called()


def test_archive_racing_existing_upload_is_satisfied(tmp_path, monkeypatch):
    from invimport.inventree import archive
    folder = tmp_path / "import-example"
    folder.mkdir()
    source = folder / "import-example.json"
    source.write_text("{}")
    document = SimpleNamespace(path=source, source={})
    target = archive.ArchiveTarget(kind=archive.SUPPLIER, pk=4, label="Supplier")
    monkeypatch.setattr(archive, "plan_targets", lambda lines: ([target], []))
    api = Mock()
    digest = archive.archive_digest(folder, [source])
    name = archive.archive_name(folder, digest)
    # Archive preflight sees absence; upload's own mandatory read sees the winner.
    api.get.side_effect = [[], [{"filename": name}]]
    result = archive.archive_import(api, document, [], write=True)
    assert result.targets[0].outcome == archive.ALREADY_ATTACHED
    api.request.assert_not_called()


def test_provenance_existing_file_is_not_failed(tmp_path, monkeypatch):
    from invimport.inventree import stockimport
    from invimport.inventree.purchase_orders import AttachmentOutcome
    document = SimpleNamespace(file_id="example")
    path = tmp_path / "provenance.json"
    path.write_text("{}")
    monkeypatch.setattr(stockimport.provenance, "record_file", lambda *args: path)
    monkeypatch.setattr(stockimport, "attach_file_outcome", lambda *args:
                        AttachmentOutcome(AttachmentState.ALREADY_SATISFIED,
                                          "part", 4, path.name))
    result = stockimport.StockImportResult(provenance=stockimport.ProvenanceOutcome())
    stockimport._attach_provenance(Mock(), document,
                                  {("part", 4): {"import": {}}}, result)
    assert result.provenance.failed == []
    assert result.provenance.already_satisfied == [("part", 4, path.name)]
