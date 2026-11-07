"""Offline exact-byte controls; actual PG/process proof is explicitly opt-in."""

import importlib
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPIKE = ROOT / "spikes/combined-seams"


@pytest.fixture
def observations(monkeypatch):
    monkeypatch.syspath_prepend(str(SPIKE))
    module = importlib.import_module("seams.observations")
    return module


def test_retained_provider_bytes_not_oracle_validate_through_actual_importer(observations, tmp_path):
    from coordination.boundary import FIXTURE, sha
    from validate_proposal import validate_fixture_proposal

    bundle = tmp_path / "bundle"
    observations.stage(bundle)
    report = validate_fixture_proposal(bundle / "proposal.json")
    assert report["ok"] and report["validation_report"].count("has no sku") == 2
    assert report["proposal_sha256"] == sha((observations.OBSERVED / "proposal.json").read_bytes())
    assert report["proposal_sha256"] != sha((FIXTURE / "expected-stock.json").read_bytes())
    assert report["keys"] == ["invimport:SPIKE-TWO-LOTS-001:lot-a", "invimport:SPIKE-TWO-LOTS-001:lot-b"]
    assert not (bundle / "expected-stock.json").exists()
    assert observations.emissions("attempt-1")[-1]["status"] == "waiting_for_user"
    assert observations.emissions("attempt-2")[-1]["output_ref"]["sha256"] == report["proposal_sha256"]


@pytest.mark.parametrize("name", ["packet-a.png", "packet-b.png", "receipt.pdf"])
def test_changed_original_evidence_rejects_before_replay(observations, tmp_path, name):
    bundle = tmp_path / "bundle"
    observations.stage(bundle)
    (bundle / "evidence" / name).write_bytes(b"changed original")
    with pytest.raises(ValueError, match="digest"):
        observations.validate_input(observations.messages()[0], bundle)


@pytest.mark.parametrize("change", ["unknown_attempt", "changed_capability", "old_manifest_new_attempt"])
def test_schema_valid_unsupported_replays_do_not_become_commands(observations, tmp_path, change):
    bundle = tmp_path / "bundle"
    observations.stage(bundle)
    request = observations.messages()[0]
    if change == "unknown_attempt":
        request["attempt_id"] = "attempt-other"
    elif change == "changed_capability":
        request["allowed_capabilities"] = ["read_evidence"]
    else:
        request["attempt_id"] = "attempt-2"
    with pytest.raises(ValueError, match="unsupported"):
        observations.validate_input(request, bundle)


def test_modified_provider_proposal_cannot_keep_original_result_reference(observations, tmp_path):
    from coordination.boundary import artifact

    bundle = tmp_path / "bundle"
    observations.stage(bundle)
    (bundle / "proposal.json").write_bytes((bundle / "proposal.json").read_bytes() + b"\n")
    with pytest.raises(ValueError, match="digest"):
        artifact(bundle, observations.emissions("attempt-2")[-1]["output_ref"])


@pytest.mark.skipif(os.environ.get("COMBINED_SEAMS_REAL") != "1", reason="explicit owned PostgreSQL/process proof")
def test_real_combined_postgres_process_and_persistent_fake_journey(tmp_path):
    python = SPIKE / ".venv/bin/python"
    assert python.exists(), "Run the locked combined spike sync first"
    result = subprocess.run([str(python), str(SPIKE / "probe.py"), "--state", str(tmp_path / "owned")],
                            cwd=ROOT, capture_output=True, text=True, timeout=240)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (tmp_path / "owned/evidence.json").is_file()
