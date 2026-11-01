"""Offline boundary checks plus explicitly opted-in real PostgreSQL/DBOS probe."""

import copy
import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest
from jsonschema import ValidationError

ROOT = Path(__file__).resolve().parents[3]
SPIKE = ROOT / "spikes/durable-coordination"
SPEC = importlib.util.spec_from_file_location("coordination_boundary", SPIKE / "coordination/boundary.py")
boundary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(boundary)


@pytest.mark.parametrize("raw", [
    '{"a":1,"a":2}', '{"nested":{"a":1,"a":2}}', '{"a":NaN}',
    '{"a":Infinity}', '{"a":-Infinity}', '{"a":1e9999}', '{"a":0.99999999999999999999}',
])
def test_durable_coordination_rejects_lossy_json(raw):
    with pytest.raises(ValueError):
        boundary.decode(raw)


def test_durable_coordination_requires_utf8():
    with pytest.raises(UnicodeDecodeError):
        boundary.decode('{"a":1}'.encode("utf-16"))


def test_durable_coordination_integer_lexemes_preserve_identity():
    emitted = boundary.transcript()[1]
    emitted["sequence"] = 1.0
    assert boundary.message(json.dumps(emitted)) == boundary.transcript()[1]
    assert boundary.decode('{"sequence":9007199254740993.0}')["sequence"] == 9007199254740993


def test_durable_coordination_validates_shared_transcript_and_input_bytes():
    messages = boundary.transcript()
    for request in (messages[0], messages[5]):
        raw = boundary.request_input(request)
        assert boundary.sha(raw) == request["input_revision"]
    assert messages[0]["input_revision"] != messages[5]["input_revision"]


@pytest.mark.parametrize("field,value", [("provider", "unknown"), ("protocol_version", "v2")])
def test_durable_coordination_rejects_unknown_wire_values(field, value):
    request = copy.deepcopy(boundary.transcript()[0])
    request[field] = value
    with pytest.raises(ValidationError):
        boundary.message(boundary.canonical(request))


def test_durable_coordination_canonical_duplicates_do_not_depend_on_transport():
    request = boundary.transcript()[0]
    reordered = dict(reversed(list(request.items())))
    assert boundary.canonical(boundary.message(json.dumps(reordered, indent=2))) == boundary.canonical(request)


def test_durable_coordination_rejects_changed_artifact(tmp_path):
    path = tmp_path / "output.json"
    original = b'{"proposal":true}'
    path.write_bytes(original + b" ")
    with pytest.raises(ValueError, match="digest"):
        boundary.artifact(tmp_path, {"path": path.name, "sha256": boundary.sha(original)})


def test_durable_coordination_rejects_escaping_symlink(tmp_path):
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    outside = tmp_path / "outside.json"
    outside.write_bytes(b"{}")
    (bundle / "output.json").symlink_to(outside)
    with pytest.raises(ValueError, match="symlink"):
        boundary.artifact(bundle, {"path": "output.json", "sha256": boundary.sha(b"{}")})


@pytest.mark.parametrize("path", ["../outside.json", "/outside.json", "evidence/../../outside.json"])
def test_durable_coordination_rejects_path_escape(tmp_path, path):
    with pytest.raises(ValueError, match="path"):
        boundary.artifact(tmp_path, {"path": path, "sha256": "0" * 64})


def test_durable_coordination_real_process_fault_matrix(tmp_path):
    if os.environ.get("COORDINATION_SPIKE_REAL") != "1":
        pytest.skip("Opt in with COORDINATION_SPIKE_REAL=1 and PostgreSQL >=14 tools on PATH")
    result = subprocess.run(
        ["uv", "run", "--locked", "--project", str(SPIKE), "python", str(SPIKE / "probe.py"),
         "--state", str(tmp_path / "cluster")],
        cwd=ROOT, capture_output=True, text=True, timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads((tmp_path / "cluster/evidence.json").read_text())
    assert report["result"] == "passed"
    assert report["kill_commit_returncode"] == report["kill_enqueue_returncode"] == -9
    expected_error = [row for row in report["dbos_workflows"] if row["id"] == "unowned-workflow-control"]
    commands = [row for row in report["dbos_workflows"] if row["id"] != "unowned-workflow-control"]
    assert len(expected_error) == 1 and expected_error[0]["status"] == "ERROR"
    assert len(commands) == 5 and all(row["status"] == "SUCCESS" for row in commands)
