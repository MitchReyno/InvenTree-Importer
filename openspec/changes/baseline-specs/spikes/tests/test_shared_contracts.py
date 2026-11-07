"""Offline conformance examples shared by the three independent intake spikes."""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError
from PIL import Image
from pypdf import PdfReader
import pytest

from invimport.config import load_categories_config, load_parameters_config
from invimport.stockfile import read_file
from invimport.validate import validate


SHARED = Path(__file__).resolve().parents[3] / "spikes/shared"
FIXTURE = SHARED / "fixtures/two-lots"


def read_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def validator() -> Draft202012Validator:
    schema = read_json(SHARED / "schemas/message.schema.json")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


@pytest.fixture(scope="module")
def messages() -> list[dict]:
    return [json.loads(line) for line in (FIXTURE / "messages.jsonl").read_text(encoding="utf-8").splitlines()]


def test_all_example_messages_conform(validator, messages):
    for message in [*messages, *read_json(FIXTURE / "outcomes.json")]:
        validator.validate(message)


@pytest.mark.parametrize("change", [
    {"protocol_version": "bench-intake-spike/2"},
    {"access_token": "not-a-real-token"},
    {"input_revision": "not-a-digest"},
    {"input_revision": "a" * 64 + "\n"},
    {"job_id": "job-with-newline\n"},
    {"provider": "unknown"},
    {"allowed_capabilities": ["write_inventory"]},
    {"allowed_capabilities": ["read_evidence", "read_evidence"]},
])
def test_request_rejects_unsupported_or_unexpected_fields(validator, messages, change):
    with pytest.raises(ValidationError):
        validator.validate(messages[0] | change)


@pytest.mark.parametrize("path", ["../input.json", "evidence/../input.json", "/input.json", "C:\\input.json", "https://example.invalid/input.json", "evidence//input.json", "input.json\n"])
def test_artifact_references_are_local_relative_names(validator, messages, path):
    message = deepcopy(messages[0])
    message["input_ref"]["path"] = path
    with pytest.raises(ValidationError):
        validator.validate(message)


@pytest.mark.parametrize("patch,remove_output", [
    ({}, True),
    ({"status": "succeeded", "output_ref": None}, False),
    ({"status": "succeeded", "question_ids": ["count-lot-b"]}, False),
    ({"status": "failed"}, True),
    ({"status": "waiting_for_user", "question_ids": []}, True),
    ({"status": "waiting_for_login"}, True),
    ({"status": "interrupted"}, True),
    ({"sequence": 0}, False),
    ({"sequence": True}, False),
    ({"status": "failed", "reason_code": "evidence_unreadable"}, False),
])
def test_result_status_cannot_hide_missing_outputs_or_questions(validator, messages, patch, remove_output):
    base = deepcopy(messages[-1])
    if remove_output:
        base.pop("output_ref")
    with pytest.raises(ValidationError):
        validator.validate(base | patch)


@pytest.mark.parametrize("index,field", [(0, "input_ref"), (8, "output_ref")])
def test_job_boundaries_reference_json_manifests(validator, messages, index, field):
    message = deepcopy(messages[index])
    message[field]["media_type"] = "image/png"
    with pytest.raises(ValidationError):
        validator.validate(message)


@pytest.mark.parametrize("patch", [{"question_revision": 0}, {"value": ""}, {"actor_id": None}])
def test_answers_require_a_question_revision_value_and_actor(validator, messages, patch):
    with pytest.raises(ValidationError):
        validator.validate(messages[4] | patch)


def assert_artifact(reference: dict) -> None:
    path = FIXTURE / reference["path"]
    assert sha256(path.read_bytes()).hexdigest() == reference["sha256"], path


def test_fixture_artifacts_and_input_revisions_are_byte_bound(messages):
    for message in messages:
        for key in ("input_ref", "output_ref"):
            if key in message:
                assert_artifact(message[key])
        if message["type"] == "job.request":
            assert message["input_revision"] == message["input_ref"]["sha256"]
            for evidence in read_json(FIXTURE / message["input_ref"]["path"])["evidence"]:
                assert_artifact(evidence)


def test_question_answer_and_resumed_attempt_keep_distinct_revisions(messages):
    first, question, waiting, answer, resumed, result = [messages[i] for i in (0, 2, 3, 4, 5, 8)]
    assert {m["job_id"] for m in messages} == {first["job_id"]}
    assert {m["batch_id"] for m in messages} == {first["batch_id"]}
    assert question["scope_ids"] == ["lot-b"]
    assert waiting["question_ids"] == [question["question_id"]]
    assert (answer["question_id"], answer["question_revision"]) == (question["question_id"], question["question_revision"])
    assert answer["attempt_id"] == first["attempt_id"]
    assert answer["input_revision"] == first["input_revision"]
    assert resumed["attempt_id"] != first["attempt_id"]
    assert resumed["input_revision"] != first["input_revision"]
    assert result["input_revision"] == resumed["input_revision"]
    for request in (first, resumed):
        emitted = [m for m in messages if "sequence" in m and m["attempt_id"] == request["attempt_id"]]
        assert [m["sequence"] for m in emitted] == [1, 2, 3]
        assert {m["input_revision"] for m in emitted} == {request["input_revision"]}
    original = read_json(FIXTURE / "input.json")
    confirmed = read_json(FIXTURE / "input-confirmed.json")
    assert original["lots"][1]["quantity"] is None
    assert original["human_answers"] == []
    assert Decimal(confirmed["lots"][1]["quantity"]) == Decimal(answer["value"])
    assert confirmed["human_answers"] == [{key: answer[key] for key in ("question_id", "question_revision", "value", "actor_id")}]


def test_shared_part_and_contributions_validate_with_the_real_importer():
    document = read_file(FIXTURE / "expected-stock.json")
    config = FIXTURE / "config"
    report = validate(document, load_categories_config(config), load_parameters_config(config))
    assert report.ok, report.text()
    assert len(read_json(FIXTURE / "expected-stock.json")["parts"]) == 1
    assert [(line.id, line.part_ref, line.quantity, line.batch) for line in document.lines] == [
        ("lot-a", "resistor-100r", 10, "SPIKE-A"),
        ("lot-b", "resistor-100r", 20, "SPIKE-B"),
    ]
    assert [document.key_for(line) for line in document.lines] == [
        "invimport:SPIKE-TWO-LOTS-001:lot-a",
        "invimport:SPIKE-TWO-LOTS-001:lot-b",
    ]
    assert all(not line.manufacturer and not line.mpn for line in document.lines)


def test_visual_evidence_is_readable_synthetic_input():
    text = PdfReader(FIXTURE / "evidence/receipt.pdf").pages[0].extract_text()
    assert "SYNTHETIC RECEIPT" in text
    assert "Confirm the current count" in text
    assert "originally 20" in text
    for name in ("packet-a.png", "packet-b.png"):
        with Image.open(FIXTURE / "evidence" / name) as image:
            image.verify()
        with Image.open(FIXTURE / "evidence" / name) as image:
            assert image.size == (960, 640)
