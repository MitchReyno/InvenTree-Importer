"""Canonical binding inspection against the real registry, state root and run store."""
from __future__ import annotations

from contextlib import closing
from dataclasses import replace

import pytest

from invimport.execution import adoption
from invimport.execution.adoption import CanonicalBinding, inspect_binding
from invimport.execution.ownership import JournalError, OwnershipError, Registry, state_root
from invimport.execution.store import RunStore
from tests.execution.test_foundation import operation, plan


@pytest.fixture
def prepared():
    return plan(operation(provides=("part",)))


@pytest.fixture
def run_directory(tmp_path):
    return tmp_path / "runs" / "receipt"


def reserve(prepared, run_directory, *, run_id="run-1", import_id=None):
    with closing(Registry()) as registry:
        with registry.writer(prepared.target, import_id or prepared.import_id, run_id=run_id,
                             revision=prepared.revision, location=run_directory / "run.sqlite3"):
            pass


def journal(prepared, run_directory, *, run_id="run-1"):
    with RunStore(run_directory / "run.sqlite3", plan=prepared, run_id=run_id, create=True):
        pass


def test_no_registry_and_no_markers_is_unbound(prepared, run_directory):
    assert inspect_binding(prepared, run_directory) is None
    assert not (state_root() / "execution").exists()


def test_initialized_marker_without_registry_fails_closed(prepared, run_directory):
    Registry().close()
    (state_root() / "execution" / "registry.sqlite3").unlink()
    with pytest.raises(JournalError, match="canonical authority missing"):
        inspect_binding(prepared, run_directory)


def test_existing_run_directory_without_registry_fails_closed(prepared, run_directory):
    run_directory.mkdir(parents=True)
    with pytest.raises(JournalError, match="canonical authority missing"):
        inspect_binding(prepared, run_directory)


def test_registry_without_binding_is_unbound_until_directory_exists(prepared, run_directory):
    Registry().close()
    assert inspect_binding(prepared, run_directory) is None
    run_directory.mkdir(parents=True)
    with pytest.raises(JournalError, match="unregistered bound directory"):
        inspect_binding(prepared, run_directory)


def test_reservation_without_journal_requires_recovery_not_restart(prepared, run_directory):
    reserve(prepared, run_directory)
    assert inspect_binding(prepared, run_directory) == CanonicalBinding("run-1", "recovery_required", None)


def test_non_file_journal_requires_recovery(prepared, run_directory):
    reserve(prepared, run_directory)
    (run_directory / "run.sqlite3").mkdir(parents=True)
    assert inspect_binding(prepared, run_directory) == CanonicalBinding("run-1", "recovery_required", None)


def test_other_directory_with_unresolved_claim_is_ownership_conflict(prepared, run_directory, tmp_path):
    reserve(prepared, run_directory)
    with pytest.raises(OwnershipError, match="earlier same-source claim"):
        inspect_binding(prepared, tmp_path / "runs" / "other")


def test_changed_plan_identity_at_bound_directory_is_ownership_conflict(prepared, run_directory):
    reserve(prepared, run_directory)
    changed = replace(prepared, input_digest="other-input-hash")
    assert changed.revision != prepared.revision
    with pytest.raises(OwnershipError, match="revision differs"):
        inspect_binding(changed, run_directory)


def test_bound_run_without_matching_claim_fails_closed(prepared, run_directory):
    reserve(prepared, run_directory, import_id="other-import")
    with pytest.raises(JournalError, match="no matching canonical claim"):
        inspect_binding(prepared, run_directory)


def test_multiple_runs_at_bound_location_fail_closed(prepared, run_directory):
    reserve(prepared, run_directory, run_id="run-1")
    with closing(Registry()) as registry:
        registry.complete("run-1")
    reserve(prepared, run_directory, run_id="run-2")
    with pytest.raises(JournalError, match="multiple canonical runs"):
        inspect_binding(prepared, run_directory)


def test_journaled_run_returns_canonical_snapshot(prepared, run_directory):
    reserve(prepared, run_directory)
    journal(prepared, run_directory)
    binding = inspect_binding(prepared, run_directory)
    assert (binding.run_id, binding.state) == ("run-1", "reserved")
    assert binding.snapshot["run_id"] == "run-1"
    assert binding.snapshot["revision"] == prepared.revision
    assert [item["id"] for item in binding.snapshot["operations"]] == [prepared.operations[0].id]


def test_completed_run_stays_discoverable(prepared, run_directory):
    reserve(prepared, run_directory)
    journal(prepared, run_directory)
    with closing(Registry()) as registry:
        registry.complete("run-1")
    binding = inspect_binding(prepared, run_directory)
    assert (binding.state, binding.snapshot["revision"]) == ("complete", prepared.revision)


def test_snapshot_revision_differing_from_approval_fails_closed(prepared, run_directory, monkeypatch):
    # The registry and status API already pin revision; only a stale status read reaches this guard.
    reserve(prepared, run_directory)
    journal(prepared, run_directory)
    real = adoption.load_run_status
    monkeypatch.setattr(adoption, "load_run_status", lambda run_id: real(run_id) | {"revision": "stale"})
    with pytest.raises(JournalError, match="canonical revision differs"):
        inspect_binding(prepared, run_directory)
