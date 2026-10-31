"""Behavioral contracts of the Stage 3 serial/local foundation, no live services."""
from __future__ import annotations

from dataclasses import replace
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from threading import Event, Thread
from types import SimpleNamespace

import pytest

from invimport.execution.executor import (ClassifiedFailure, ContinuityReview, execute_plan,
                                         execute_serial, resume_run, validate_continuity)
from invimport.execution.models import (Attribution, Certainty, Effect, ErrorCategory, Inputs, Kind,
                                       OperationResult, OperationSpec, Output, OutputRef, Plan,
                                       Retry, SafeError, State, Target, validate_plan)
from invimport.execution.observation import Observation, observing
from invimport.execution.ownership import (JournalError, OwnershipError, Registry,
                                         legacy_write_guard, normalize_endpoint, state_root)
from invimport.execution.preparation import (Decision, DiscoverySnapshot, prepare_import,
                                            validate_preparation)
from invimport.execution.store import RunStore
from invimport.execution.transport import ObservedRequests
from invimport.stockfile import StockFile, StockLine, read_file


TARGET = Target("https://inventory.example/api/")


def operation(subject="part", **kwargs):
    return OperationSpec.build(Kind.PART, subject, attribution=Attribution("source-digest", ("lot-a",)), **kwargs)


def plan(*operations):
    return Plan("receipt", 1, "input-hash", "config-hash", Inputs(), TARGET, Inputs(), tuple(operations))


def output(name="part", pk=71):
    return Output(name, "part", pk, "approved-identity-hash")


def success(*outputs):
    return OperationResult(State.SUCCEEDED, Certainty.CONFIRMED, outputs=tuple(outputs))


def test_plan_roundtrip_and_stable_pre_pk_identity():
    desired = {"parameters": {"Resistance": "10 kΩ"}}
    spec = operation(desired=Inputs.freeze(desired), provides=("part",))
    expected = plan(spec)
    desired["parameters"]["Resistance"] = "wrong"
    restored = Plan.loads(expected.dumps())
    assert restored == expected
    assert restored.dumps() == expected.dumps()
    assert restored.revision == expected.revision
    assert restored.operations[0].desired.values()["parameters"]["Resistance"] == "10 kΩ"
    assert operation(provides=("part",)).id == spec.id
    assert replace(spec, conflicts=("part:71",)).id == spec.id
    assert "71" not in spec.id.split(":")


@pytest.mark.parametrize("version", [0, 2, 999])
def test_unknown_plan_schema_refused(version):
    raw = json.loads(plan().dumps())
    raw["schema_version"] = version
    with pytest.raises(ValueError, match="schema"):
        Plan.loads(json.dumps(raw))


def test_missing_output_cycle_and_shared_conflict_rejected():
    parent = operation(provides=("part",))
    child = operation("stock", requires=(OutputRef(parent.id, "missing"),))
    with pytest.raises(ValueError, match="missing"):
        validate_plan(plan(parent, child))
    child = replace(child, provides=("stock",), requires=(OutputRef(parent.id, "part"),))
    parent = replace(parent, requires=(OutputRef(child.id, "stock"),))
    with pytest.raises(ValueError, match="cyclic"):
        validate_plan(plan(parent, child))
    a = operation("supplier_a", conflicts=("supplier:1:sku:ABC",), desired=Inputs.freeze({"part": "a"}))
    b = operation("supplier_b", conflicts=a.conflicts, desired=Inputs.freeze({"part": "b"}))
    with pytest.raises(ValueError, match="conflicting"):
        validate_plan(plan(a, b))


def test_named_outputs_enable_children_even_with_failed_parent_and_unrelated_photo(tmp_path):
    parent = operation(provides=("part",))
    photo = operation("photo", requires=(OutputRef(parent.id, "part"),), group="line-a")
    child = operation("child", requires=(OutputRef(parent.id, "part"),), group="line-b")
    calls = []
    def handler(spec, context):
        calls.append(spec.subject)
        if spec.subject == "part":
            return OperationResult(State.FAILED, Certainty.CONFIRMED, outputs=(output(),),
                                   error=SafeError(ErrorCategory.DENIED, "optional_metadata_denied"))
        if spec.subject == "photo":
            raise ClassifiedFailure(SafeError(ErrorCategory.DENIED, "upload_denied"))
        assert context.inputs[(parent.id, "part")].pk == 71
        return success()
    with RunStore(tmp_path / "run.sqlite3", plan=plan(child, parent, photo), run_id="run", create=True) as store:
        snapshot = execute_serial(store, {Kind.PART: handler})
        assert calls == ["part", "child", "photo"]
        assert [row["state"] for row in snapshot["operations"]] == ["succeeded", "failed", "failed"]


def test_blocked_child_reactivates_after_explicit_reconciliation(tmp_path):
    parent = operation(provides=("part",))
    child = operation("child", requires=(OutputRef(parent.id, "part"),))
    document = plan(parent, child)
    with RunStore(tmp_path / "run.sqlite3", plan=document, run_id="run", create=True) as store:
        attempt = store.start(parent.id, mutation=True)
        store.finish(attempt, OperationResult(State.UNCERTAIN, Certainty.UNKNOWN, Retry.RECONCILE))
        execute_serial(store, {Kind.PART: lambda *args: success()})
        assert store.states()[child.id] == State.BLOCKED
        store.authorize_retry(parent.id, reconciled=success(output()))
        execute_serial(store, {Kind.PART: lambda *args: success()})
        assert store.states()[child.id] == State.SUCCEEDED


def test_store_restart_keeps_pk_attribution_and_committed_snapshot(tmp_path):
    spec = operation(provides=("part",))
    document = plan(spec)
    path = tmp_path / "run.sqlite3"
    with RunStore(path, plan=document, run_id="run", create=True) as store:
        execute_serial(store, {Kind.PART: lambda *args: success(output())})
        first = store.snapshot()
        store.export(tmp_path / "snapshot.json")
    with RunStore(path, plan=document, run_id="run", create=False) as store:
        assert store.snapshot() == first == json.loads((tmp_path / "snapshot.json").read_text())
        assert store.results()[spec.id].outputs[0].pk == 71
        assert first["operations"][0]["attribution"]["lines"] == ["lot-a"]
    assert "run.sqlite3" not in json.dumps(first)
    assert (tmp_path / "artifacts").is_dir()
    assert path.stat().st_mode & 0o077 == 0


@pytest.mark.parametrize("mutation,expected,retry", [(True, State.UNCERTAIN, Retry.RECONCILE),
                                                       (False, State.RETRY_WAIT, Retry.READ)])
def test_interrupted_intent_recovers_conservatively(tmp_path, mutation, expected, retry):
    spec = operation(mutation=mutation)
    document = plan(spec)
    path = tmp_path / "run.sqlite3"
    with RunStore(path, plan=document, run_id="run", create=True) as store:
        store.start(spec.id, mutation=mutation)
    with RunStore(path, plan=document, run_id="run", create=False) as store:
        store.recover_interrupted()
        result = store.results()[spec.id]
        assert result.state == expected and result.retry == retry
        if mutation:
            with pytest.raises(ValueError, match="reconciliation"):
                store.authorize_retry(spec.id)


def test_unknown_store_schema_and_plan_drift_refused(tmp_path):
    document = plan(operation())
    path = tmp_path / "run.sqlite3"
    with RunStore(path, plan=document, run_id="run", create=True):
        pass
    with pytest.raises(JournalError, match="drift"):
        RunStore(path, plan=replace(document, config_digest="changed"), run_id="run", create=False)
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA user_version=99")
    with pytest.raises(JournalError, match="schema"):
        RunStore(path, plan=document, run_id="run", create=False)


def test_one_store_owner(tmp_path):
    document = plan(operation())
    path = tmp_path / "run.sqlite3"
    with RunStore(path, plan=document, run_id="run", create=True):
        with pytest.raises(OwnershipError):
            RunStore(path, plan=document, run_id="run", create=False)


def test_journal_failure_after_read_prevents_next_child_mutation(tmp_path):
    calls = []
    def handler(spec, context):
        def read():
            calls.append("get")
            # A real SQLite write failure, not a mocked commit method.
            context.store.connection.execute("PRAGMA query_only=ON")
        context.dispatch(read, mutation=False, label="read_part")
        context.dispatch(lambda: calls.append("patch"), mutation=True, label="patch_part")
        return success()
    with RunStore(tmp_path / "run.sqlite3", plan=plan(operation()), run_id="run", create=True) as store:
        with pytest.raises(JournalError):
            execute_serial(store, {Kind.PART: handler})
        assert not store.healthy
    assert calls == ["get"]


def test_cancellation_during_get_stops_patch(tmp_path):
    calls, cancelled = [], Event()
    def handler(spec, context):
        context.dispatch(cancelled.set, mutation=False, label="read_part")
        context.dispatch(lambda: calls.append("patch"), mutation=True, label="patch_part")
        return success()
    with RunStore(tmp_path / "run.sqlite3", plan=plan(operation()), run_id="run", create=True) as store:
        execute_serial(store, {Kind.PART: handler}, cancelled=cancelled)
        assert store.results()[store.plan.operations[0].id].certainty == Certainty.NONE
    assert calls == []


def test_observer_failure_does_not_duplicate_and_uses_stable_correlation(tmp_path):
    calls = []
    def broken_observer(event):
        raise RuntimeError("renderer disconnected")
    observation = Observation(broken_observer)
    def send(url, **kwargs):
        calls.append("post")
        return SimpleNamespace(status_code=201, history=[])
    transport = ObservedRequests(observation, service="inventory", transport=SimpleNamespace(post=send))
    spec = operation(provides=("part",))
    def handler(spec, context):
        transport.post("https://inventory.example/api/part/", json={"name": "safe"})
        return success(output())
    with observing(observation), RunStore(tmp_path / "run.sqlite3", plan=plan(spec), run_id="stable-run", create=True) as store:
        execute_serial(store, {Kind.PART: handler})
        assert store.results()[spec.id].outputs == (output(),)
        snapshot = store.snapshot()
    starts = [e for e in observation.snapshot() if e.kind == "request_started"]
    assert calls == ["post"] and observation.delivery_failures > 0
    assert starts[0].context.run == "stable-run" and starts[0].context.operation == spec.id
    assert starts[0].context.attempt
    assert snapshot["operations"][0]["result"]["outputs"][0]["pk"] == 71


def test_mandatory_sdk_guard_survives_observer_and_checks_every_child(tmp_path):
    calls = []
    cancelled = Event()
    def get(url, **kwargs):
        calls.append("get")
        cancelled.set()
        return SimpleNamespace(status_code=200, history=[])
    transport = ObservedRequests(None, service="inventory", transport=SimpleNamespace(get=get, patch=lambda *a, **k: calls.append("patch")))
    def handler(spec, context):
        transport.get("https://inventory.example/api/part/71/")
        transport.patch("https://inventory.example/api/part/71/", json={})
        return success()
    with RunStore(tmp_path / "run.sqlite3", plan=plan(operation()), run_id="run", create=True) as store:
        execute_serial(store, {Kind.PART: handler}, cancelled=cancelled)
    assert calls == ["get"]


@pytest.mark.parametrize("url", ["https://u:p@example/api/", "https://example/api/?token=x",
                                 "https://example/api/#secret", "file:///api/", "https://example/%2e%2e/"])
def test_unsafe_targets_rejected(url):
    with pytest.raises(ValueError):
        normalize_endpoint(url)


def test_target_normalization_and_continuity_require_more_than_url():
    assert normalize_endpoint("HTTPS://Inventory.Example:443/") == TARGET.endpoint
    document = plan(operation())
    with pytest.raises(ValueError, match="reviewed"):
        validate_continuity(document, TARGET, review=None)
    validate_continuity(document, TARGET, review=ContinuityReview(document.revision, TARGET.endpoint, "operator-evidence-hash"))
    verified = replace(document, target=replace(TARGET, instance_id="verified-instance", identity_evidence="trusted-probe-hash"))
    with pytest.raises(ValueError, match="continuity"):
        validate_continuity(verified, TARGET, review=None)


def test_registry_claim_survives_owner_exit_and_custom_journal_cannot_bypass(tmp_path):
    document = plan(operation())
    registry = Registry()
    path = tmp_path / "custom" / "run.sqlite3"
    try:
        with registry.writer(TARGET, document.import_id, run_id="prior", revision=document.revision, location=path):
            with RunStore(path, plan=document, run_id="prior", create=True):
                pass
        with pytest.raises(OwnershipError, match="unresolved"):
            execute_plan(document, {Kind.PART: lambda *args: success()}, run_directory=tmp_path / "alternate", current_target=TARGET)
        with pytest.raises(OwnershipError, match="unresolved"):
            with legacy_write_guard(TARGET, document.import_id):
                pytest.fail("guard allowed legacy write")
        registry.abandon("prior", evidence="reviewed_unknown_effect")
        with pytest.raises(OwnershipError):
            with legacy_write_guard(TARGET, document.import_id):
                pytest.fail("abandonment cleared unknown effect")
        path.unlink()
        with pytest.raises(JournalError, match="missing"):
            with registry.writer(TARGET, document.import_id, run_id="prior", revision=document.revision, location=path, resume=True):
                pass
    finally:
        registry.close()


def test_legacy_public_library_cannot_bypass_claim(tmp_path):
    from invimport.inventree.stockimport import ImportOptions, import_stock
    document = StockFile(file_id="receipt", lines=[StockLine(id="lot-a", quantity=1)])
    registry = Registry()
    try:
        with registry.writer(TARGET, document.file_id, run_id="prior", revision="revision", location=tmp_path / "gone.sqlite3"):
            pass
        with pytest.raises(OwnershipError):
            import_stock(document, SimpleNamespace(api_url=TARGET.endpoint), options=ImportOptions(write=True))
    finally:
        registry.close()


def test_registry_missing_corrupt_and_unknown_schema_fail_closed(tmp_path):
    registry = Registry()
    path = registry.path
    registry.close()
    path.unlink()
    with pytest.raises(JournalError, match="missing"):
        Registry()
    path.write_bytes(b"not sqlite")
    with pytest.raises(JournalError):
        Registry()
    path.unlink()
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA user_version=99")
    with pytest.raises(JournalError, match="schema"):
        Registry()


def test_complete_run_allows_new_revision_without_overwriting_prior_journal(tmp_path):
    document = plan(operation())
    one = execute_plan(document, {Kind.PART: lambda *args: success()}, run_directory=tmp_path / "one", current_target=TARGET)
    two = execute_plan(replace(document, config_digest="enrichment-approved"), {Kind.PART: lambda *args: success()}, run_directory=tmp_path / "two", current_target=TARGET)
    assert one["run_id"] != two["run_id"]
    assert (tmp_path / "one" / "run.sqlite3").is_file()


def test_process_ledger_overlap_rejected_but_nested_recording_preserved(tmp_path):
    from invimport.inventree import ledger
    errors = []
    with ledger.recording() as parent:
        with ledger.recording():
            ledger.note("part", 1, "created")
        def other():
            try:
                execute_plan(plan(operation()), {Kind.PART: lambda *args: success()}, run_directory=tmp_path / "other", current_target=TARGET)
            except OwnershipError as exc:
                errors.append(type(exc))
        thread = Thread(target=other)
        thread.start()
        thread.join()
    assert errors == [OwnershipError]
    assert len(parent.events) == 1


def test_preparation_freezes_source_ids_decisions_files_and_detects_drift(tmp_path):
    image = tmp_path / "part.jpg"
    image.write_bytes(b"original")
    document = StockFile(file_id="receipt", path=tmp_path / "stock.json", lines=[StockLine(id="a", quantity=1), StockLine(id="b", quantity=2, part_of="a")])
    calls = []
    class API:
        def get(self, route, *, params):
            calls.append(route)
            return [{"pk": 71}]
    def discover(reader):
        rows = reader.rows("part/")
        return DiscoverySnapshot((Decision("a", "part", rows[0]["pk"], "identity-hash", "explicit_choice"),), "complete-read-hash")
    prepared = prepare_import(document, config_semantics={"normalization": "v1"}, target=TARGET,
                              api=API(), discover=discover, files={"part.jpg": image})
    assert calls == ["part/"]
    assert prepared.decisions.values()["sources"]["b"] == {"stock_key": "invimport:receipt:b", "part_subject": "a", "manufacturer_part_subject": "", "part_of": "a"}
    assert Plan.loads(prepared.dumps()) == prepared
    with pytest.raises(ValueError, match="unsupported"):
        execute_plan(prepared, {}, current_target=TARGET)
    validate_preparation(prepared, document, config_semantics={"normalization": "v1"}, target=TARGET, files={"part.jpg": image})
    image.write_bytes(b"changed")
    with pytest.raises(ValueError, match="content drift"):
        validate_preparation(prepared, document, config_semantics={"normalization": "v1"}, target=TARGET, files={"part.jpg": image})
    document.lines[0].quantity = 20
    with pytest.raises(ValueError, match="drift"):
        validate_preparation(prepared, document, config_semantics={"normalization": "v1"}, target=TARGET)


def test_v2_preparation_keeps_expanded_shared_subjects(tmp_path):
    source = tmp_path / "v2.json"
    source.write_text(json.dumps({"version": 2, "source": {"reference": "v2"},
                                  "parts": [{"id": "shared", "category": "Resistors", "name": "Resistor"}],
                                  "lines": [{"id": "a", "part": "shared", "quantity": 1}, {"id": "b", "part": "shared", "quantity": 2}]}))
    document = read_file(source)
    prepared = prepare_import(document, config_semantics={}, target=TARGET, api=SimpleNamespace(),
                              discover=lambda reader: DiscoverySnapshot((), "discovery-hash"))
    assert prepared.input_version == 2
    assert {v["part_subject"] for v in prepared.decisions.values()["sources"].values()} == {"shared"}
    assert prepared.unsupported


def test_fresh_process_lost_write_stays_uncertain_and_no_duplicate(tmp_path):
    """Persistent fake remote + real local journal across an abrupt process exit."""
    document = plan(operation(provides=("part",)))
    (tmp_path / "plan.json").write_text(document.dumps())
    script = tmp_path / "crash.py"
    script.write_text('''import os, sqlite3, sys
from pathlib import Path
from invimport.execution.models import Plan
from invimport.execution.ownership import Registry
from invimport.execution.store import RunStore
base = Path(sys.argv[1])
plan = Plan.loads((base / "plan.json").read_text())
registry = Registry()
with registry.writer(plan.target, plan.import_id, run_id="crashed", revision=plan.revision, location=base / "run.sqlite3"):
    with RunStore(base / "run.sqlite3", plan=plan, run_id="crashed", create=True) as store:
        attempt = store.start(plan.operations[0].id, mutation=True)
        store.request_intent(attempt, mutation=True, label="create_part")
        remote = sqlite3.connect(base / "remote.sqlite3")
        remote.execute("CREATE TABLE parts(pk INTEGER PRIMARY KEY)")
        remote.execute("INSERT INTO parts VALUES (71)")
        remote.commit()
        os._exit(19)
''')
    environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[2] / "src"))
    result = subprocess.run([sys.executable, str(script), str(tmp_path)], env=environment, capture_output=True, timeout=20)
    assert result.returncode == 19, result.stderr.decode()
    with pytest.raises(OwnershipError):
        execute_plan(document, {Kind.PART: lambda *args: success(output())}, run_directory=tmp_path / "alternate", current_target=TARGET)
    resumed = resume_run(document, "crashed", tmp_path / "run.sqlite3", {Kind.PART: lambda *args: pytest.fail("replayed create")}, current_target=TARGET)
    assert resumed["operations"][0]["state"] == "uncertain"
    with sqlite3.connect(tmp_path / "remote.sqlite3") as connection:
        assert connection.execute("SELECT pk FROM parts").fetchall() == [(71,)]


def test_state_override_must_be_absolute(monkeypatch):
    monkeypatch.setenv("INVIMPORT_STATE_DIR", "relative")
    with pytest.raises(ValueError):
        state_root()


def test_semantic_barcode_post_is_read_and_cancellation_blocks_patch(tmp_path):
    from invimport.execution.dispatch import barcode_lookup_request
    calls, cancelled = [], Event()
    def lookup(url, **kwargs):
        calls.append("lookup")
        cancelled.set()
        return SimpleNamespace(status_code=200, history=[])
    transport = ObservedRequests(None, service="inventory", transport=SimpleNamespace(post=lookup, patch=lambda *a, **k: calls.append("patch")))
    def handler(spec, context):
        with barcode_lookup_request():
            transport.post("https://inventory.example/api/barcode/", json={"barcode": "safe-key"})
        transport.patch("https://inventory.example/api/part/71/", json={})
        return success()
    spec = operation()
    with RunStore(tmp_path / "run.sqlite3", plan=plan(spec), run_id="run", create=True) as store:
        execute_serial(store, {Kind.PART: handler}, cancelled=cancelled)
        assert store.results()[spec.id].certainty == Certainty.NONE
        assert store.connection.execute("SELECT mutation FROM requests").fetchall() == [(0,)]
    assert calls == ["lookup"]


def test_registry_disappearance_after_get_prevents_next_mutation(tmp_path):
    calls = []
    def handler(spec, context):
        def read():
            calls.append("get")
            (state_root() / "execution" / "registry.sqlite3").unlink()
        context.dispatch(read, mutation=False, label="read_part")
        context.dispatch(lambda: calls.append("patch"), mutation=True, label="patch_part")
        return success()
    with pytest.raises(JournalError):
        execute_plan(plan(operation()), {Kind.PART: handler}, run_directory=tmp_path / "run", current_target=TARGET)
    assert calls == ["get"]


def test_replaced_journal_is_not_accepted_as_healthy(tmp_path):
    document = plan(operation())
    path = tmp_path / "run.sqlite3"
    with RunStore(path, plan=document, run_id="run", create=True) as store:
        path.rename(tmp_path / "moved.sqlite3")
        path.write_bytes(b"replacement")
        with pytest.raises(JournalError, match="replaced"):
            store.check_health()


def test_confirmed_output_resume_requires_review_and_never_reruns_parent(tmp_path):
    parent = operation(provides=("part",))
    child = operation("child", requires=(OutputRef(parent.id, "part"),))
    document = plan(parent, child)
    registry = Registry()
    path = tmp_path / "run.sqlite3"
    try:
        with registry.writer(TARGET, document.import_id, run_id="restart", revision=document.revision, location=path):
            with RunStore(path, plan=document, run_id="restart", create=True) as store:
                attempt = store.start(parent.id, mutation=True)
                store.finish(attempt, success(output()))
        with pytest.raises(ValueError, match="continuity"):
            resume_run(document, "restart", path, {Kind.PART: lambda *args: success()}, current_target=TARGET)
        calls = []
        def handler(spec, context):
            calls.append(spec.subject)
            assert context.inputs[(parent.id, "part")].pk == 71
            return success()
        resumed = resume_run(document, "restart", path, {Kind.PART: handler}, current_target=TARGET,
                             continuity=ContinuityReview(document.revision, TARGET.endpoint, "review-hash"))
        assert calls == ["child"]
        assert resumed["operations"][0]["result"]["outputs"][0]["pk"] == 71
    finally:
        registry.close()


def test_reviewed_alias_cannot_bypass_unresolved_claim(tmp_path):
    registry = Registry()
    try:
        with registry.writer(TARGET, "receipt", run_id="prior", revision="v1", location=tmp_path / "missing"):
            pass
        registry.register_alias(TARGET, "https://alternate.example", evidence="reviewed_same_target_hash")
        with pytest.raises(OwnershipError):
            with registry.writer(Target("https://alternate.example"), "receipt", run_id="new", revision="v1", location=tmp_path / "new"):
                pytest.fail("alias bypassed ownership")
    finally:
        registry.close()


def test_invalid_handler_result_preserves_unresolved_intent(tmp_path):
    spec = operation(provides=("part",))
    document = plan(spec)
    def handler(spec, context):
        context.dispatch(lambda: None, mutation=True, label="create_part")
        return success(output(name="undeclared"))
    path = tmp_path / "run.sqlite3"
    with RunStore(path, plan=document, run_id="run", create=True) as store:
        with pytest.raises(ValueError, match="undeclared"):
            execute_serial(store, {Kind.PART: handler})
    with RunStore(path, plan=document, run_id="run", create=False) as store:
        store.recover_interrupted()
        assert store.results()[spec.id].state == State.UNCERTAIN


def test_raw_handler_error_is_not_saved(tmp_path):
    spec = operation(mutation=False)
    def handler(spec, context):
        raise RuntimeError("Authorization SECRET_CANARY response-body")
    with RunStore(tmp_path / "run.sqlite3", plan=plan(spec), run_id="run", create=True) as store:
        with pytest.raises(RuntimeError):
            execute_serial(store, {Kind.PART: handler})
        snapshot = json.dumps(store.snapshot())
        assert "SECRET_CANARY" not in snapshot and "response-body" not in snapshot
        assert store.results()[spec.id].error.category == ErrorCategory.PROGRAMMER


def test_status_reads_active_and_completed_runs_after_later_revision(tmp_path):
    from invimport.execution.store import load_run_status
    snapshots = []
    def handler(spec, context):
        snapshots.append(load_run_status(context.store.run_id))
        return success()
    document = plan(operation())
    first = execute_plan(document, {Kind.PART: handler}, run_directory=tmp_path / "first", current_target=TARGET)
    execute_plan(replace(document, config_digest="new"), {Kind.PART: handler}, run_directory=tmp_path / "second", current_target=TARGET)
    assert snapshots[0]["operations"][0]["state"] == State.RUNNING
    assert load_run_status(first["run_id"]) == first


def test_archive_excludes_state_custom_run_and_sqlite_sidecars(tmp_path):
    from invimport.execution.artifacts import initialize_run_directory
    from invimport.inventree.archive import archive_files
    source = tmp_path / "source"
    source.mkdir()
    (source / "evidence.pdf").write_bytes(b"evidence")
    custom = source / "retained-run"
    initialize_run_directory(custom)
    (custom / "run.sqlite3").write_bytes(b"journal")
    (custom / "artifacts" / "report.json").write_bytes(b"report")
    (source / "run.sqlite3-wal").write_bytes(b"active")
    assert [p.name for p in archive_files(source)] == ["evidence.pdf"]


def test_cancelled_reconciliation_preserves_unknown_effect_and_saved_pk(tmp_path):
    from invimport.execution.executor import retry_operation
    spec = operation(provides=("part",))
    document = plan(spec)
    path = tmp_path / "run.sqlite3"
    registry = Registry()
    try:
        with registry.writer(TARGET, document.import_id, run_id="reconcile", revision=document.revision, location=path):
            with RunStore(path, plan=document, run_id="reconcile", create=True) as store:
                attempt = store.start(spec.id, mutation=True)
                store.finish(attempt, OperationResult(State.UNCERTAIN, Certainty.UNKNOWN, Retry.RECONCILE, outputs=(output(),)))
        cancelled, calls = Event(), []
        def reconcile(spec, context):
            context.dispatch(cancelled.set, mutation=False, label="read_part")
            context.dispatch(lambda: calls.append("patch"), mutation=True, label="patch_part")
            return success()
        snapshot = retry_operation(document, "reconcile", path, spec.id, reconcile,
                                   current_target=TARGET, continuity=ContinuityReview(document.revision, TARGET.endpoint, "review"), cancelled=cancelled)
        result = snapshot["operations"][0]["result"]
        assert result["certainty"] == Certainty.UNKNOWN and result["retry"] == Retry.RECONCILE
        assert result["outputs"][0]["pk"] == 71 and not calls
    finally:
        registry.close()


def test_reconciliation_cannot_rebind_confirmed_pk(tmp_path):
    spec = operation(provides=("part",))
    with RunStore(tmp_path / "run.sqlite3", plan=plan(spec), run_id="run", create=True) as store:
        attempt = store.start(spec.id, mutation=True)
        store.finish(attempt, OperationResult(State.UNCERTAIN, Certainty.UNKNOWN, Retry.RECONCILE, outputs=(output(),)))
        with pytest.raises(ValueError, match="rebound"):
            store.authorize_retry(spec.id, reconciled=success(output(pk=99)))
        assert store.results()[spec.id].outputs[0].pk == 71


def test_guard_rechecks_journal_after_best_effort_request_start_delivery(tmp_path):
    calls = []
    def observer(event):
        if event.kind == "request_started":
            path.unlink()
    observation = Observation(observer)
    path = tmp_path / "run.sqlite3"
    transport = ObservedRequests(observation, service="inventory", transport=SimpleNamespace(post=lambda *a, **k: calls.append("post")))
    def handler(spec, context):
        transport.post("https://inventory.example/api/part/", json={})
        return success()
    with observing(observation), RunStore(path, plan=plan(operation()), run_id="run", create=True) as store:
        with pytest.raises(JournalError):
            execute_serial(store, {Kind.PART: handler})
    assert calls == []


def test_nested_visual_operations_keep_durable_request_identity(tmp_path):
    from invimport.execution.observation import operation as visual_operation
    observation = Observation()
    transport = ObservedRequests(observation, service="inventory", transport=SimpleNamespace(get=lambda *a, **k: SimpleNamespace(status_code=200, history=[])))
    spec = operation(mutation=False)
    def handler(spec, context):
        with visual_operation("read identity", group="discovery"):
            transport.get("https://inventory.example/api/part/71/")
        return success()
    with observing(observation), RunStore(tmp_path / "run.sqlite3", plan=plan(spec), run_id="run", create=True) as store:
        execute_serial(store, {Kind.PART: handler})
        ids = [r[0] for r in store.connection.execute("SELECT id FROM requests")]
    starts = [e for e in observation.snapshot() if e.kind == "request_started"]
    assert [e.request for e in starts] == ids
    assert starts[0].context.operation == spec.id


def test_missing_registry_is_refused_in_fresh_process_with_custom_run(tmp_path):
    registry = Registry()
    path = registry.path
    with registry.writer(TARGET, "receipt", run_id="lost", revision="v1", location=tmp_path / "custom" / "run.sqlite3"):
        pass
    registry.close()
    path.unlink()
    code = "from invimport.execution.ownership import Registry, JournalError\ntry:\n Registry()\nexcept JournalError:\n raise SystemExit(23)\n"
    environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[2] / "src"))
    result = subprocess.run([sys.executable, "-c", code], env=environment, capture_output=True, timeout=20)
    assert result.returncode == 23, result.stderr.decode()
    assert not path.exists()


def test_serial_guard_cannot_disappear_in_captured_worker(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from invimport.execution.observation import correlated
    calls = []
    transport = ObservedRequests(None, service="inventory", transport=SimpleNamespace(post=lambda *a, **k: calls.append("post")))
    def handler(spec, context):
        with ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(correlated(lambda: transport.post("https://inventory.example/api/part/", json={}))).result()
        return success()
    with RunStore(tmp_path / "run.sqlite3", plan=plan(operation()), run_id="run", create=True) as store:
        with pytest.raises(JournalError, match="owner thread"):
            execute_serial(store, {Kind.PART: handler})
    assert calls == []


def test_failed_settlement_rolls_back_output_state_and_source_event_together(tmp_path):
    spec = operation(provides=("part",))
    document = plan(spec)
    path = tmp_path / "run.sqlite3"
    with RunStore(path, plan=document, run_id="run", create=True) as store:
        attempt = store.start(spec.id, mutation=True)
        store.connection.execute("CREATE TRIGGER reject_settlement BEFORE INSERT ON events WHEN NEW.kind='operation_settled' BEGIN SELECT RAISE(FAIL,'storage failure'); END")
        with pytest.raises(JournalError):
            store.finish(attempt, success(output()))
        assert not store.healthy
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT state,result FROM operations").fetchone() == ("running", None)
        assert connection.execute("SELECT count(*) FROM events WHERE kind='operation_settled'").fetchone() == (0,)
        assert connection.execute("SELECT state FROM attempts").fetchone() == ("intent",)


def test_approved_records_defensively_own_all_sequence_inputs():
    from invimport.execution.models import Effect
    lines, provides, conflicts = ["lot-a"], ["part"], ["logical:part"]
    parent = OperationSpec.build(Kind.PART, "parent", provides=provides, conflicts=conflicts,
                                 attribution=Attribution("source", lines))
    requires = [OutputRef(parent.id, "part")]
    child = operation("child", requires=requires)
    operations, unsupported = [parent, child], ["domain_handler"]
    approved = replace(plan(), operations=operations, unsupported=unsupported)
    validate_plan(approved)
    before, revision = approved.dumps(), approved.revision
    outputs, effects = [output()], [Effect("created", Certainty.CONFIRMED, "part", 71)]
    settled = OperationResult(State.SUCCEEDED, Certainty.CONFIRMED, outputs=outputs, effects=effects)
    for sequence in (lines, provides, conflicts, requires, operations, unsupported, outputs, effects):
        sequence.clear()
    assert approved.dumps() == before and approved.revision == revision
    assert Plan.loads(before) == approved
    assert settled.outputs == (output(),) and settled.effects[0].pk == 71
    assert approved.operations[1].requires == (OutputRef(parent.id, "part"),)


@pytest.mark.parametrize("construct", [
    lambda: OperationResult("unrecognized_state"),
    lambda: OperationResult(State.FAILED, retry="unrecognized_retry"),
    lambda: Effect("update", "unrecognized_certainty", pk=-1),
    lambda: Effect("update", Certainty.CONFIRMED, "part", -1),
    lambda: Output("", "", 1, "proof"),
    lambda: Output("part", "part", True, "proof"),
    lambda: Output("part", "part", 1, ["mutable-proof"]),
    lambda: Attribution("source", "not-an-array"),
    lambda: operation(provides=["part", "part"]),
    lambda: operation(requires=[{"operation": "mutable", "name": "part"}]),
    lambda: OperationResult(State.FAILED, outputs=[{"pk": 71}]),
    lambda: replace(plan(), target={"endpoint": TARGET.endpoint}),
])
def test_invalid_typed_record_construction_is_rejected(construct):
    with pytest.raises(ValueError):
        construct()


@pytest.mark.parametrize("location", ["plan", "attribution", "desired", "target", "reference"])
def test_plan_load_rejects_unknown_nested_schema_fields(location):
    parent = operation(provides=("part",))
    child = operation("child", requires=(OutputRef(parent.id, "part"),))
    raw = json.loads(plan(parent, child).dumps())
    records = {"plan": raw, "attribution": raw["operations"][0]["attribution"],
               "desired": raw["operations"][0]["desired"], "target": raw["target"],
               "reference": raw["operations"][1]["requires"][0]}
    records[location]["future_field"] = "must-not-disappear"
    with pytest.raises(ValueError, match="schema"):
        Plan.loads(json.dumps(raw))


def test_duplicate_json_keys_are_not_silently_rebound():
    with pytest.raises(ValueError, match="duplicate"):
        Plan.loads(plan().dumps().replace('"import_id":"receipt"', '"import_id":"receipt","import_id":"changed"'))
    with pytest.raises(ValueError, match="duplicate"):
        Inputs('{"part":71,"part":99}')


@pytest.mark.parametrize("platform,variable", [("linux", "XDG_STATE_HOME"), ("win32", "LOCALAPPDATA")])
def test_relative_platform_state_root_cannot_change_authority_with_cwd(tmp_path, monkeypatch, platform, variable):
    import invimport.execution.ownership as ownership
    monkeypatch.delenv("INVIMPORT_STATE_DIR")
    monkeypatch.setattr(ownership.sys, "platform", platform)
    monkeypatch.setenv(variable, str(tmp_path / "canonical"))
    registry = Registry()
    try:
        with registry.writer(TARGET, "receipt", run_id="prior", revision="v1", location=tmp_path / "custom" / "run.sqlite3"):
            pass
    finally:
        registry.close()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    with pytest.raises(OwnershipError):
        with legacy_write_guard(TARGET, "receipt"):
            pytest.fail("cwd bypassed claim")
    monkeypatch.setenv(variable, "relative-state")
    with pytest.raises(ValueError, match="absolute"):
        Registry()
    assert not (elsewhere / "relative-state").exists()


def test_resume_rejects_changed_verified_target_without_any_saved_outputs(tmp_path):
    from invimport.execution.store import load_run_status
    original = Target(TARGET.endpoint, "instance-a", "verified-a")
    changed = Target(TARGET.endpoint, "instance-b", "verified-b")
    first, pending = operation("first"), operation("pending")
    approved = replace(plan(first, pending), target=original)
    cancelled, writes = Event(), []
    def handler(spec, context):
        if spec.subject == "first":
            cancelled.set()
            raise ClassifiedFailure(SafeError(ErrorCategory.DENIED, "part_denied"))
        context.dispatch(lambda: writes.append("mutation"), mutation=True, label="create_part")
        return success()
    snapshot = execute_plan(approved, {Kind.PART: handler}, run_directory=tmp_path / "run", cancelled=cancelled, current_target=original)
    assert not any(row["result"] and row["result"]["outputs"] for row in snapshot["operations"])
    with pytest.raises(ValueError, match="continuity"):
        resume_run(approved, snapshot["run_id"], tmp_path / "run" / "run.sqlite3", {Kind.PART: handler}, current_target=changed)
    assert not writes
    assert load_run_status(snapshot["run_id"])["operations"][1]["state"] == State.PENDING


def test_execute_and_reconcile_reject_known_target_conflicts(tmp_path):
    from invimport.execution.executor import retry_operation
    original = Target(TARGET.endpoint, "instance-a", "verified-a")
    changed = Target(TARGET.endpoint, "instance-b", "verified-b")
    spec = operation()
    approved = replace(plan(spec), target=original)
    with pytest.raises(ValueError, match="continuity"):
        execute_plan(approved, {Kind.PART: lambda *args: pytest.fail("dispatched")}, current_target=changed)
    registry = Registry()
    path = tmp_path / "run.sqlite3"
    try:
        with registry.writer(original, approved.import_id, run_id="unknown", revision=approved.revision, location=path):
            with RunStore(path, plan=approved, run_id="unknown", create=True) as store:
                attempt = store.start(spec.id, mutation=True)
                store.finish(attempt, OperationResult(State.UNCERTAIN, Certainty.UNKNOWN, Retry.RECONCILE))
        with pytest.raises(ValueError, match="continuity"):
            retry_operation(approved, "unknown", path, spec.id, lambda *args: pytest.fail("reconciled wrong target"), current_target=changed)
    finally:
        registry.close()


@pytest.mark.parametrize("certainty,retry", [(Certainty.UNKNOWN, Retry.RECONCILE),
                                             (Certainty.UNKNOWN, Retry.REVIEW),
                                             (Certainty.NONE, Retry.REVIEW)])
def test_retry_wait_cannot_replay_original_mutation_handler(tmp_path, certainty, retry):
    spec = operation(provides=("part",))
    writes = []
    def handler(spec, context):
        def create():
            writes.append("applied-create")
            if certainty == Certainty.UNKNOWN:
                raise ConnectionError("lost response")
        try:
            context.dispatch(create, mutation=True, label="create_part")
        except ConnectionError:
            pass
        return OperationResult(State.RETRY_WAIT, certainty, retry, outputs=(output(),))
    with RunStore(tmp_path / "run.sqlite3", plan=plan(spec), run_id="run", create=True) as store:
        execute_serial(store, {Kind.PART: handler})
        execute_serial(store, {Kind.PART: handler})
        with pytest.raises(ValueError, match="reconciliation or review"):
            store.start(spec.id, mutation=True)
        assert writes == ["applied-create"]
        assert store.results()[spec.id].outputs[0].pk == 71


def test_resume_retry_wait_reconciles_without_replaying_unknown_create(tmp_path):
    from invimport.execution.executor import retry_operation
    spec = operation(provides=("part",))
    document = plan(spec)
    writes = []
    def handler(spec, context):
        def create():
            writes.append("applied-create")
            raise ConnectionError("response lost")
        try:
            context.dispatch(create, mutation=True, label="create_part")
        except ConnectionError:
            pass
        return OperationResult(State.RETRY_WAIT, Certainty.UNKNOWN, Retry.RECONCILE)
    path = tmp_path / "run" / "run.sqlite3"
    first = execute_plan(document, {Kind.PART: handler}, run_directory=path.parent, current_target=TARGET)
    resumed = resume_run(document, first["run_id"], path, {Kind.PART: handler}, current_target=TARGET)
    assert resumed["operations"][0]["result"]["certainty"] == Certainty.UNKNOWN
    reviewed = ContinuityReview(document.revision, TARGET.endpoint, "reviewed-continuity")
    def reconcile(spec, context):
        context.dispatch(lambda: None, mutation=False, label="read_identity")
        return success(output())
    reconciled = retry_operation(document, first["run_id"], path, spec.id, reconcile,
                                 current_target=TARGET, continuity=reviewed)
    assert writes == ["applied-create"]
    assert reconciled["operations"][0]["result"]["outputs"][0]["pk"] == 71


@pytest.mark.parametrize("certainty", [Certainty.NONE, Certainty.CONFIRMED])
def test_unknown_effect_cannot_be_hidden_by_aggregate_certainty(certainty):
    with pytest.raises(ValueError, match="unknown aggregate"):
        OperationResult(State.RETRY_WAIT, certainty, Retry.READ,
                        effects=[Effect("create", Certainty.UNKNOWN)])


def test_confirmed_effect_cannot_be_hidden_as_no_effect():
    with pytest.raises(ValueError, match="aggregate"):
        OperationResult(State.FAILED, Certainty.NONE, Retry.READ,
                        effects=[Effect("create", Certainty.CONFIRMED, "part", 71)])


def test_authorize_retry_cannot_reset_mutation_mislabeled_as_read(tmp_path):
    spec = operation(provides=("part",))
    writes = []
    def handler(spec, context):
        context.dispatch(lambda: writes.append("applied-create"), mutation=True, label="create_part")
        return OperationResult(State.FAILED, Certainty.NONE, Retry.READ, outputs=(output(),))
    with RunStore(tmp_path / "run.sqlite3", plan=plan(spec), run_id="run", create=True) as store:
        execute_serial(store, {Kind.PART: handler})
        with pytest.raises(ValueError, match="only semantic reads"):
            store.authorize_retry(spec.id)
        execute_serial(store, {Kind.PART: handler})
        assert writes == ["applied-create"]
        assert store.results()[spec.id].outputs == (output(),)
        assert store.states()[spec.id] == State.FAILED


def test_legacy_inconsistent_unknown_effect_is_not_erased_or_replayed(tmp_path):
    """Real SQLite may contain a pre-fix result; no aggregate flag can clear it."""
    from dataclasses import asdict
    from invimport.execution.models import canonical
    spec = operation(provides=("part",))
    document = plan(spec)
    path = tmp_path / "run.sqlite3"
    registry = Registry()
    writes = []
    try:
        with registry.writer(TARGET, document.import_id, run_id="legacy-result", revision=document.revision, location=path):
            with RunStore(path, plan=document, run_id="legacy-result", create=True) as store:
                attempt = store.start(spec.id, mutation=True)
                store.finish(attempt, OperationResult(State.RETRY_WAIT, Certainty.UNKNOWN, Retry.RECONCILE,
                                                      outputs=(output(),), effects=(Effect("create", Certainty.UNKNOWN),)))
                persisted = asdict(store.results()[spec.id])
                persisted.update(certainty=Certainty.NONE, retry=Retry.READ)
                with store.connection:
                    store.connection.execute("UPDATE operations SET result=? WHERE id=?", (canonical(persisted), spec.id))
                for action in (lambda: store.authorize_retry(spec.id),
                               lambda: store.start(spec.id, mutation=True),
                               lambda: execute_serial(store, {Kind.PART: lambda *args: writes.append("replayed-create")})):
                    with pytest.raises(JournalError, match="persisted operation result"):
                        action()
                raw = json.loads(store.connection.execute("SELECT result FROM operations WHERE id=?", (spec.id,)).fetchone()[0])
                assert raw["effects"][0]["certainty"] == Certainty.UNKNOWN
                assert raw["outputs"][0]["pk"] == 71
        with pytest.raises(JournalError, match="persisted operation result"):
            resume_run(document, "legacy-result", path, {Kind.PART: lambda *args: writes.append("replayed-create")}, current_target=TARGET)
        assert writes == []
    finally:
        registry.close()


def test_safe_read_retry_keeps_confirmed_output_identity(tmp_path):
    spec = operation(mutation=False, provides=("part",))
    with RunStore(tmp_path / "run.sqlite3", plan=plan(spec), run_id="run", create=True) as store:
        attempt = store.start(spec.id, mutation=False)
        store.finish(attempt, OperationResult(State.FAILED, Certainty.NONE, Retry.READ, outputs=(output(),)))
        store.authorize_retry(spec.id)
        assert store.results()[spec.id].outputs == (output(),)
        execute_serial(store, {Kind.PART: lambda *args: success()})
        assert store.results()[spec.id].outputs == (output(),)
