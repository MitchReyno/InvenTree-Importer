"""Actual pinned SDK, retained fake HTTP/SQLite and fresh serial child processes."""
from __future__ import annotations

from contextlib import contextmanager, closing
from dataclasses import replace
import importlib
import os
from pathlib import Path
import subprocess
import sys
from threading import Event, Thread
from time import monotonic, sleep

import pytest

from invimport.demo.runner import child_environment
from invimport.demo.state import DemoState
from invimport.demo.workspace import load_workspace, save_json
from invimport.execution.adoption import inspect_binding
from invimport.execution.ownership import JournalError, OwnershipError, Registry
from invimport.stockfile import read_file

ROOT = Path(__file__).resolve().parents[3]
SPIKE = ROOT / "spikes/importer-adapter"
REASON = "Reviewed original retained synthetic database nonce, canonical journal and record identities"


@pytest.fixture
def adapter(monkeypatch):
    monkeypatch.syspath_prepend(str(SPIKE))
    return importlib.import_module("adapter")


@contextmanager
def running(path):
    from fake_server import FaultServer
    _path, manifest = load_workspace(path)
    state = DemoState(path / "server.sqlite3")
    with FaultServer(state, manifest["instance"], manifest["port"]) as server:
        manifest["port"] = server.server_port
        save_json(path / "invimport-demo.json", manifest)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield state, server
        finally:
            server.release_ack.set()
            server.shutdown()
            thread.join(timeout=3)


def answered_plan(adapter, path, selected, **kwargs):
    from questions import WaitingForAnswer, Questions
    for _ in range(5):
        try:
            return adapter.prepare(path, selected, **kwargs)
        except WaitingForAnswer as exc:
            record = adapter.read_json(path / "questions" / (str(exc) + ".json"))
            question = record["question"]
            adapter.validate_message(question)
            answer = {key: question[key] for key in adapter.question_context(path)}
            answer.update(type="job.answer", question_id=question["question_id"],
                          question_revision=question["question_revision"], value="new", actor_id="reviewer")
            Questions(path / "questions", adapter.question_context(path)).answer(answer)
    pytest.fail("preparation did not settle")


def commit_intent(adapter, path, selected, **kwargs):
    plan, binding = answered_plan(adapter, path, selected, **kwargs)
    return plan, adapter.approve(path, plan, binding, actor="reviewer")


def wait_for(state, mode):
    deadline = monotonic() + 15
    while monotonic() < deadline:
        if any(row["outcome"] == mode for row in state.inspect()["requests"]):
            return
        sleep(0.02)
    pytest.fail("fake request never reached selected fault")


def test_questions_release_preparation_slot_and_validate_stale_answers(adapter, tmp_path):
    from questions import WaitingForAnswer, Questions
    path = adapter.initialize(tmp_path / "owned")
    with running(path) as (state, _server):
        for _ in range(2):
            with pytest.raises(WaitingForAnswer):
                adapter.prepare(path, ["lot-a"])
        assert not (path / "state/execution").exists()
        assert not state.rows("part/") and not state.rows("stock/")
        record = adapter.read_json(next((path / "questions").glob("*.json")))
        question = record["question"]
        answer = {key: question[key] for key in adapter.question_context(path)}
        answer.update(type="job.answer", question_id=question["question_id"], question_revision=2,
                      value="new", actor_id="reviewer")
        questions = Questions(path / "questions", adapter.question_context(path))
        with pytest.raises(ValueError, match="obsolete"):
            questions.answer(answer)
        answer["question_revision"] = 1
        answer["value"] = "999999"
        with pytest.raises(ValueError, match="outside"):
            questions.answer(answer)
        # Another intake can prepare while the first question remains waiting.
        other = adapter.initialize(tmp_path / "other")
        with running(other):
            plan, _binding = answered_plan(adapter, other, ["lot-b"])
            assert set(plan.decisions.values()["sources"]) == {"lot-b"}


def test_commit_before_dispatch_publication_loss_adoption_and_two_original_lots(adapter, tmp_path):
    from supervisor import Child, snapshot
    path = adapter.initialize(tmp_path / "owned")
    with running(path) as (state, _server):
        first, key = commit_intent(adapter, path, ["lot-a"])
        assert not state.rows("stock/")  # committed approval, no dispatcher yet
        assert (path / "intents" / (key + ".json")).is_file()
        assert all(set(op.attribution.lines) <= {"lot-a"} for op in first.operations)
        child = Child(path, key, observer=lambda _event: (_ for _ in ()).throw(ValueError("renderer")))
        child.wait()  # discard the app result, as if publication was lost
        before = state.inspect()
        adopted = Child(path, key).wait()
        assert adopted["adopted"]
        assert state.inspect()["records"] == before["records"]
        assert child.observer_failures > 0 and child.received > 0
        canonical = snapshot(path, key)
        assert canonical["run_id"] == adopted["run_id"]
        assert all(row["state"] in {"succeeded", "already_satisfied", "skipped"} for row in canonical["operations"])
        shared = state.rows("part/")[0]
        second, second_key = commit_intent(adapter, path, ["lot-b"], known_part=(shared["pk"], shared["IPN"]))
        assert second.import_id == first.import_id == "SPIKE-TWO-LOTS-001"
        assert second.decisions.values()["sources"]["lot-b"]["stock_key"] == "invimport:SPIKE-TWO-LOTS-001:lot-b"
        Child(path, second_key).wait()
        assert len(state.rows("part/")) == 1 and len(state.rows("stock/")) == 2
        assert {row["quantity"] for row in state.rows("stock/")} == {10, 20}
        assert {row["batch"] for row in state.rows("stock/")} == {"SPIKE-A", "SPIKE-B"}
        assert set(state.inspect()["barcodes"]) == {"invimport:SPIKE-TWO-LOTS-001:lot-a", "invimport:SPIKE-TWO-LOTS-001:lot-b"}
        # Completed history must remain adoptable after claim points at round 2.
        assert Child(path, key).wait()["run_id"] == canonical["run_id"]
    # New status child works with fake server CLOSED: missing events are irrelevant.
    assert snapshot(path, second_key)["revision"] == second.revision


def test_partial_attachment_selected_repair_and_unresolved_previous_round_blocks(adapter, tmp_path):
    from supervisor import Child, snapshot
    path = adapter.initialize(tmp_path / "owned", partial=True)
    with running(path) as (state, _server):
        plan, key = commit_intent(adapter, path, ["lot-a"])
        Child(path, key).wait()
        initial = snapshot(path, key)
        failed = [row for row in initial["operations"] if row["state"] == "failed"]
        assert len(failed) == 1
        stocks = state.rows("stock/")
        shared = state.rows("part/")[0]
        _second, key2 = commit_intent(adapter, path, ["lot-b"], known_part=(shared["pk"], shared["IPN"]))
        with pytest.raises(RuntimeError, match="OwnershipError"):
            Child(path, key2).wait()
        assert state.rows("stock/") == stocks
    # Restart fake listener, keep same consumed fault, journal and source IDs.
    with running(path) as (state, _server):
        Child(path, key, action="repair", operation=failed[0]["id"], continuity_reason=REASON).wait()
        assert state.rows("stock/") == stocks
        repaired = snapshot(path, key)
        assert repaired["run_id"] == initial["run_id"]
        assert all(row["state"] in {"succeeded", "already_satisfied", "skipped"} for row in repaired["operations"])
        Child(path, key2).wait()
        assert len(state.rows("part/")) == 1 and len(state.rows("stock/")) == 2
        assert plan.revision == repaired["revision"]


@pytest.mark.parametrize("route", ["stock/", "attachment/"])
def test_applied_response_lost_is_not_replayed_by_redelivery_or_supported_repair(adapter, tmp_path, route):
    from supervisor import Child, snapshot
    path = adapter.initialize(tmp_path / "owned")
    with running(path) as (state, server):
        _plan, key = commit_intent(adapter, path, ["lot-a"])
        server.arm(route, "lose_ack")
        Child(path, key).wait()
        before = state.inspect()
        status = snapshot(path, key)
        unknown = [row for row in status["operations"] if row["result"] and row["result"]["certainty"] == "unknown"]
        assert unknown
        Child(path, key).wait()
        assert state.inspect()["records"] == before["records"]
        shared = state.rows("part/")[0]
        _second, key2 = commit_intent(adapter, path, ["lot-b"], known_part=(shared["pk"], shared["IPN"]))
        with pytest.raises(RuntimeError, match="OwnershipError"):
            Child(path, key2).wait()
    with running(path) as (state, _server):
        Child(path, key, action="repair", operation=unknown[0]["id"], continuity_reason=REASON).wait()
        assert state.inspect()["records"] == before["records"]
        after = snapshot(path, key)
        historical = [attempt for attempt in after["attempts"] if attempt["operation"] == unknown[0]["id"]]
        assert historical[0]["state"] == "uncertain" and len(historical) >= 2
        assert any(request["state"] == "exchange_unknown" for request in after["requests"])
        if route == "stock/":
            assert any(row["state"] in {"uncertain", "needs_review"} for row in after["operations"])
            assert len(state.rows("stock/")) == 1
        else:
            assert len(state.rows("attachment/")) == len(before["records"]["attachment/"])
            assert any(row["result"] and row["result"]["certainty"] == "unknown" for row in status["operations"])


def test_alive_child_duplicate_dispatch_and_cancellation_during_accepted_request(adapter, tmp_path):
    from supervisor import Child, snapshot
    path = adapter.initialize(tmp_path / "owned")
    with running(path) as (state, server):
        _plan, key = commit_intent(adapter, path, ["lot-a"])
        server.arm("stock/", "hold_ack")
        received_cancel = Event()
        original = Child(path, key, observer=lambda event: received_cancel.set() if event["kind"] == "cancellation_received" else None)
        wait_for(state, "hold_ack")
        with pytest.raises(RuntimeError, match="OwnershipError"):
            Child(path, key).wait()
        original.cancel()
        assert received_cancel.wait(timeout=3)
        server.release_ack.set()
        original.wait()
        status = snapshot(path, key)
        assert len(state.rows("stock/")) == 1
        assert any(row["result"] and row["result"]["effects"] for row in status["operations"])
        requests = state.inspect()["requests"]
        held = next(row["id"] for row in requests if row["outcome"] == "hold_ack")
        assert not any(row["method"] in {"POST", "PATCH"} for row in requests if row["id"] > held)
        assert Child(path, key).wait()["adopted"]
        assert len(state.rows("stock/")) == 1


def test_crash_after_reservation_before_journal_never_starts_again(adapter, tmp_path, monkeypatch):
    from supervisor import Child
    path = adapter.initialize(tmp_path / "owned")
    with running(path) as (state, _server):
        plan, key = commit_intent(adapter, path, ["lot-a"])
        _path, manifest = load_workspace(path)
        env = child_environment(path, manifest)
        env["PYTHONPATH"] += os.pathsep + str(SPIKE)
        script = """import os,sys
from pathlib import Path
import invimport.execution.executor as executor
from adapter import start_or_adopt
def die(*args, **kwargs):
    os._exit(77)
executor.RunStore = die
start_or_adopt(Path(sys.argv[1]), sys.argv[2])
"""
        died = subprocess.run([sys.executable, "-c", script, str(path), key], env=env, capture_output=True, timeout=20)
        assert died.returncode == 77, died.stderr
        monkeypatch.setenv("INVIMPORT_STATE_DIR", str(path / "state"))
        found = inspect_binding(plan, path / "state/execution/runs" / key)
        assert found.state == "recovery_required" and found.snapshot is None
        with pytest.raises(RuntimeError, match="JournalError"):
            Child(path, key).wait()
        assert not state.rows("part/") and not state.rows("stock/")


def test_selected_v2_materializes_before_part_of_expansion_and_v1_is_explicitly_unsupported(adapter, tmp_path):
    raw = adapter.read_json(adapter.FIXTURE / "expected-stock.json")
    save_json(tmp_path / "all.json", raw)
    full = read_file(tmp_path / "all.json")
    assert full.lines[1].part_of == "lot-a"
    selected = adapter.materialize(raw, ["lot-b"])
    save_json(tmp_path / "selected.json", selected)
    document = read_file(tmp_path / "selected.json")
    assert len(document.lines) == 1 and not document.lines[0].part_of
    assert document.key_for(document.lines[0]) == "invimport:SPIKE-TWO-LOTS-001:lot-b"
    with pytest.raises(ValueError, match="v1 part_of"):
        adapter.materialize({"version": 1, "lines": [{"id": "child", "part_of": "parent"}]}, ["child"])


def test_canonical_binding_missing_registry_drift_and_unresolved_other_directory(adapter, tmp_path, monkeypatch):
    path = adapter.initialize(tmp_path / "owned")
    with running(path):
        plan, key = commit_intent(adapter, path, ["lot-a"])
        directory = path / "state/execution/runs" / key
        monkeypatch.setenv("INVIMPORT_STATE_DIR", str(path / "state"))
        assert inspect_binding(plan, directory) is None
        with closing(Registry()) as registry:
            with registry.writer(plan.target, plan.import_id, run_id="reserved", revision=plan.revision,
                                 location=directory / "run.sqlite3"):
                pass
        assert inspect_binding(plan, directory).snapshot is None
        with pytest.raises(OwnershipError):
            inspect_binding(plan, directory.with_name("different"))
        with pytest.raises(OwnershipError):
            inspect_binding(replace(plan, input_digest="changed"), directory)
        (path / "state/execution/registry.sqlite3").unlink()
        with pytest.raises(JournalError, match="authority"):
            inspect_binding(plan, directory)


def test_approval_input_build_and_intent_bytes_drift_are_rejected(adapter, tmp_path, monkeypatch):
    path = adapter.initialize(tmp_path / "owned")
    with running(path):
        plan, binding = answered_plan(adapter, path, ["lot-a"])
        config = path / "config/parameters.yaml"
        original = config.read_bytes()
        config.write_bytes(original + b"\n")
        with pytest.raises(ValueError, match="inputs changed"):
            adapter.approve(path, plan, binding, actor="reviewer")
        config.write_bytes(original)
        key = adapter.approve(path, plan, binding, actor="reviewer")
        monkeypatch.setattr(adapter, "build_digest", lambda: "changed-build")
        with pytest.raises(ValueError, match="build drift"):
            adapter.load_intent(path, key)
        monkeypatch.undo()
        intent_path = path / "intents" / (key + ".json")
        intent = adapter.read_json(intent_path)
        save_json(intent_path, {**intent, "selected": ["lot-b"]})
        with pytest.raises(ValueError, match="intent/build drift"):
            adapter.load_intent(path, key)


def test_slow_ipc_consumer_drops_events_without_affecting_frozen_artifacts(adapter, tmp_path):
    from supervisor import Child, snapshot
    path = adapter.initialize(tmp_path / "owned")
    released = Event()
    with running(path) as (state, _server):
        plan, key = commit_intent(adapter, path, ["lot-a"])
        hashes = adapter.artifact_hashes(plan)
        assert hashes
        original = (path / "source/evidence/packet-a.png").read_bytes()
        # Source edit after approval cannot rewrite the embedded approved output.
        (path / "source/evidence/packet-a.png").write_bytes(b"different source revision")
        child = Child(path, key, observer=lambda _event: released.wait(10))
        try:
            result = child.wait()
        finally:
            released.set()
            child.reader.join(timeout=2)
        assert result["ipc_dropped"] > 0
        assert len(state.rows("stock/")) == 1
        packet = next(row for row in state.rows("attachment/") if row["filename"] == "packet-a.png")
        assert state.media(packet["pk"]) == original
        status = snapshot(path, key)
        assert len(status["operations"]) > child.received
        assert all(row["state"] in {"succeeded", "already_satisfied", "skipped"} for row in status["operations"])
