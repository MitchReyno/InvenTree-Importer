from __future__ import annotations

import json
import os
import subprocess
import sys
from threading import Event

import pytest
from tests.execution.stock_server import StockServer

from invimport.config import CategoryConfig, ParameterConfig
from invimport.execution.models import Kind, State, Target
from invimport.execution.ownership import JournalError
from invimport.execution.stock_evidence import FrozenEvidence, with_evidence
from invimport.execution.stock_preparation import PreparationReview, prepare_stock
from invimport.execution.stock_workflow import execute_stock, repair_stock, resume_stock
from invimport.execution.store import RunStore
from invimport.stockfile import read_file

TARGET = Target("https://inventory.example/", "test-instance", "fixture verified continuity")


@pytest.fixture
def scene(tmp_path):
    server = StockServer(tmp_path / "server.sqlite3")
    server.seed("part/category/", {"pathstring": "Resistors", "name": "Resistors"})
    server.seed("stock/location/", {"pathstring": "Shelf", "name": "Shelf"})
    server.seed("parameter/template/", {"name": "Resistance"})
    server.seed("parameter/template/", {"name": "Tolerance"})
    categories = {"Resistors": CategoryConfig("Resistors", ["Resistors"], identity="spec", ipn_prefix="R",
                  key_parameters=["Resistance", "Tolerance"], parameters=["Resistance", "Tolerance"], name_template="{Resistance} {Tolerance}")}
    parameters = {name: ParameterConfig(name) for name in ("Resistance", "Tolerance")}
    return server, categories, parameters


def document(tmp_path, *, version=1, identical=False, type_identity=False):
    facts = {"category": "Resistors", "parameters": {"Resistance": "100", "Tolerance": "5"}}
    if type_identity:
        facts["type"] = "R100"
    lines = [{"id": "a", "quantity": 10, "batch": "A"},
             {"id": "b", "quantity": 10 if identical else 20, "batch": "A" if identical else "B"}]
    payload = {"version": version, "source": {"reference": "fixture"},
               "defaults": {"location": "Shelf", "supplier": "Supplier", "order": {"reference": "Invoice-1"}},
               "lines": lines}
    for line in lines:
        line["sku"] = "R-100"
        line["tags"] = ["tested"]
        if version == 1:
            line.update(facts)
        else:
            line["part"] = "resistor"
    if version == 2:
        payload["parts"] = [{"id": "resistor", **facts}]
    path = tmp_path / "input.json"
    path.write_text(json.dumps(payload))
    return read_file(path)


def prepare(scene, doc):
    api, categories, parameters = scene
    return prepare_stock(doc, api=api, categories=categories, parameters=parameters, target=TARGET)


def operation(plan, action, line="a"):
    return next(op for op in plan.operations if op.desired.values()["action"] == action and line in op.attribution.lines)


def row(snapshot, spec):
    return next(row for row in snapshot["operations"] if row["id"] == spec.id)


def repair(plan, snapshot, directory, api, spec):
    return repair_stock(plan, snapshot["run_id"], directory / "run.sqlite3", spec.id, api=api, current_target=TARGET)


@pytest.mark.parametrize("version", [1, 2])
@pytest.mark.parametrize("type_identity", [False, True])
def test_real_preview_shared_part_independent_lots_and_partial_report(scene, tmp_path, version, type_identity):
    api, categories, parameters = scene
    if type_identity:
        categories["Resistors"].identity = "type"
    doc = document(tmp_path, version=version, type_identity=type_identity)
    plan = prepare(scene, doc)
    assert not plan.unsupported
    assert len([op for op in plan.operations if op.kind == Kind.PART]) == 1
    assert not api.get("part/")  # preparation never writes
    plan = with_evidence(plan, FrozenEvidence("a", "evidence.txt", b"frozen evidence"))
    directory = tmp_path / "run"
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    assert {r["state"] for r in snapshot["operations"]} <= {State.SUCCEEDED, State.ALREADY_SATISFIED}
    assert len(api.get("part/")) == 1
    assert len(api.get("parameter/")) == 2
    assert len(api.get("stock/")) == 2
    assert len(api.get("order/po/")) == 1
    assert len(api.get("order/po-line/")) == 2
    assert {row["quantity"] for row in api.get("stock/")} == {10, 20}
    assert {row["batch"] for row in api.get("stock/")} == {"A", "B"}
    assert all(line["registered"] and line["complete"] for line in snapshot["report"]["lines"])
    assert (directory / "partial-report.json").exists()
    assert len(api.get("attachment/")) == 1
    resumed = resume_stock(plan, snapshot["run_id"], directory / "run.sqlite3", api=api, current_target=TARGET)
    assert resumed["report"] == snapshot["report"]
    assert len(api.get("stock/")) == 2


def test_identical_lots_remain_distinct(scene, tmp_path):
    plan = prepare(scene, document(tmp_path, identical=True))
    api = scene[0]
    execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / "run")
    assert len(api.get("stock/")) == len(api.get("order/po-line/")) == 2


@pytest.mark.parametrize("action,route", [("part", "part/"), ("stock", "stock/"), ("order_line", "order/po-line/")])
@pytest.mark.parametrize("fault", ["lost", "before", "multiple", "invalid", "empty"])
def test_uncorrelated_creates_never_replayed(scene, tmp_path, action, route, fault):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    api.fail(route, fault)
    directory = tmp_path / "run"
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    failed = operation(plan, action)
    assert row(snapshot, failed)["state"] == State.UNCERTAIN
    count = len(api.get(route))
    resumed = resume_stock(plan, snapshot["run_id"], directory / "run.sqlite3", api=api, current_target=TARGET)
    assert len(api.get(route)) == count
    repaired = repair(plan, resumed, directory, api, failed)
    assert row(repaired, failed)["state"] == State.UNCERTAIN
    assert len(api.get(route)) == count
    if action in {"stock", "order_line"}:
        assert row(snapshot, operation(plan, action, "b"))["state"] == State.SUCCEEDED
    with RunStore(directory / "run.sqlite3", plan=plan, run_id=snapshot["run_id"], create=False) as store:
        events = store.connection.execute("SELECT kind FROM events WHERE operation=?", (failed.id,)).fetchall()
        assert ("stock_repair_authorized",) in events
        assert len(store.connection.execute("SELECT * FROM attempts WHERE operation=?", (failed.id,)).fetchall()) == 2


@pytest.mark.parametrize("action,route", [("barcode", "barcode/link/"), ("tags", "stock/"), ("order_link", "stock/")])
@pytest.mark.parametrize("fault", ["before", "lost"])
def test_known_stock_repairs_with_identity_readback_without_duplicates(scene, tmp_path, action, route, fault, monkeypatch):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    failed = operation(plan, action)
    if action == "barcode":
        api.fail(route, fault)
    else:
        original = api.patch
        armed = True
        def patch(route, payload):
            nonlocal armed
            if armed and ((action == "tags" and "tags" in payload) or (action == "order_link" and "purchase_order" in payload)):
                api.fail(route, fault)
                armed = False
            return original(route, payload)
        monkeypatch.setattr(api, "patch", patch)
    directory = tmp_path / "run"
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    assert row(snapshot, failed)["state"] == State.UNCERTAIN
    stock = api.get("stock/")[0]
    api.patch(f"stock/{stock['pk']}/", {"tags": [*stock.get("tags", []), "external"], "quantity": 2, "batch": "external"})
    snapshot = repair(plan, snapshot, directory, api, failed)
    assert row(snapshot, failed)["state"] in {State.ALREADY_SATISFIED, State.SUCCEEDED}
    assert len(api.get("stock/")) == 2
    current = api.get(f"stock/{stock['pk']}/")
    assert current["quantity"] == 2 and current["batch"] == "external"
    assert "external" in current["tags"]
    assert all(line["registered"] for line in snapshot["report"]["lines"])


def test_lost_parameter_response_repairs_known_part_not_duplicate_spec(scene, tmp_path):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    api.fail("parameter/", "lost")
    directory = tmp_path / "run"
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    failed = next(op for op in plan.operations if op.kind == Kind.PARAMETER)
    assert row(snapshot, failed)["state"] == State.UNCERTAIN
    snapshot = repair(plan, snapshot, directory, api, failed)
    assert len(api.get("part/")) == 1
    assert len(api.get("parameter/")) == 2
    assert len(api.get("stock/")) == 2


def test_current_target_and_actual_client_binding_rejected_before_dispatch(scene, tmp_path):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    for current in [Target(TARGET.endpoint, "other", "proof"), TARGET]:
        api.api_url = "https://wrong.example/api/" if current == TARGET else StockServer.api_url
        with pytest.raises(ValueError):
            execute_stock(plan, api=api, current_target=current, run_directory=tmp_path / "run")
    assert not api.get("stock/")


def test_unsupported_and_unresolved_location_reject_before_writes(scene, tmp_path):
    doc = document(tmp_path)
    for field, value in [("manufacturer", "Unknown"), ("location", "Missing"), ("approximate", True), ("location", "")]:
        line = doc.lines[0]
        before = getattr(line, field)
        setattr(line, field, value)
        with pytest.raises(PreparationReview):
            prepare(scene, doc)
        setattr(line, field, before)
    assert not scene[0].get("part/")


def test_plan_owns_inputs_and_shared_conflicts_before_mutations(scene, tmp_path):
    doc = document(tmp_path)
    plan = prepare(scene, doc)
    revision = plan.revision
    doc.lines[0].quantity = 999
    assert plan.revision == revision
    assert operation(plan, "stock").desired.values()["payload"]["quantity"] == 10
    doc.lines[1].order["notes"] = "conflict"
    with pytest.raises(PreparationReview):
        prepare(scene, doc)


def test_read_then_cancellation_prevents_child_write(scene, tmp_path, monkeypatch):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    cancelled = Event()
    original = api.get
    def get(route, **kwargs):
        result = original(route, **kwargs)
        cancelled.set()
        return result
    monkeypatch.setattr(api, "get", get)
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / "run", cancelled=cancelled)
    assert not original("part/")
    assert not any(line["registered"] for line in snapshot["report"]["lines"])


def test_fresh_process_applied_stock_response_lost_stays_uncertain(scene, tmp_path):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(plan.dumps())
    api.fail("stock/", "crash")
    directory = tmp_path / "run"
    script = '''import sys
from pathlib import Path
from invimport.execution.models import Plan, Target
from invimport.execution.stock_workflow import execute_stock
from tests.execution.stock_server import StockServer
plan = Plan.loads(Path(sys.argv[1]).read_text())
execute_stock(plan, api=StockServer(Path(sys.argv[2])), current_target=plan.target, run_directory=Path(sys.argv[3]))
'''
    result = subprocess.run([sys.executable, "-c", script, str(plan_path), str(api.path), str(directory)], env=os.environ.copy(), capture_output=True)
    assert result.returncode == 71, result.stderr
    with sqlite_connection(directory / "run.sqlite3") as connection:
        run_id = connection.execute("SELECT id FROM run").fetchone()[0]
    snapshot = resume_stock(plan, run_id, directory / "run.sqlite3", api=api, current_target=TARGET)
    assert row(snapshot, operation(plan, "stock"))["state"] == State.UNCERTAIN
    assert row(snapshot, operation(plan, "stock", "b"))["state"] == State.SUCCEEDED
    assert len(api.get("stock/")) == 2


def sqlite_connection(path):
    import sqlite3
    return sqlite3.connect(path)


@pytest.mark.parametrize("action", ["part", "stock", "order_line"])
def test_fresh_process_pk_checkpoint_crash_preserves_output_and_create_ownership(scene, tmp_path, action):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(plan.dumps())
    directory = tmp_path / "run"
    script = '''import sys, os
from pathlib import Path
from invimport.execution.models import Plan
from invimport.execution.stock_workflow import execute_stock
from invimport.execution.store import RunStore
from tests.execution.stock_server import StockServer
plan = Plan.loads(Path(sys.argv[1]).read_text())
original = RunStore.checkpoint
def checkpoint(self, attempt, result):
    original(self, attempt, result)
    spec = next(op for op in self.plan.operations if op.id == attempt.operation)
    if spec.desired.values()['action'] == sys.argv[4]:
        os._exit(72)
RunStore.checkpoint = checkpoint
execute_stock(plan, api=StockServer(Path(sys.argv[2])), current_target=plan.target, run_directory=Path(sys.argv[3]))
'''
    result = subprocess.run([sys.executable, "-c", script, str(plan_path), str(api.path), str(directory), action], capture_output=True)
    assert result.returncode == 72, result.stderr
    with sqlite_connection(directory / "run.sqlite3") as connection:
        run_id = connection.execute("SELECT id FROM run").fetchone()[0]
    snapshot = resume_stock(plan, run_id, directory / "run.sqlite3", api=api, current_target=TARGET)
    saved = operation(plan, action)
    assert row(snapshot, saved)["result"]["outputs"]
    snapshot = repair(plan, snapshot, directory, api, saved)
    assert all(line["complete"] for line in snapshot["report"]["lines"])
    assert len(api.get("part/")) == 1
    assert len(api.get("stock/")) == len(api.get("order/po-line/")) == 2
    assert all("tested" in stock["tags"] for stock in api.get("stock/"))
    assert any(effect["kind"] == "create" for effect in row(snapshot, saved)["result"]["effects"])


@pytest.mark.parametrize("mode", ["lost", "before"])
def test_pending_evidence_bytes_and_target_survive_no_new_inventory_writes(scene, tmp_path, mode):
    api = scene[0]
    plan = with_evidence(prepare(scene, document(tmp_path)), FrozenEvidence("a", "proof.txt", b"exact frozen bytes"))
    api.fail("attachment/", mode)
    directory = tmp_path / "run"
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    evidence = operation(plan, "evidence")
    assert row(snapshot, evidence)["state"] == State.UNCERTAIN
    assert all(line["registered"] for line in snapshot["report"]["lines"])
    inventory_count = len(api.get("stock/"))
    snapshot = repair(plan, snapshot, directory, api, evidence)
    assert len(api.get("stock/")) == inventory_count
    assert len(api.get("attachment/")) == (1 if mode == "lost" else 0)
    assert row(snapshot, evidence)["state"] == (State.ALREADY_SATISFIED if mode == "lost" else State.UNCERTAIN)
    assert any(path.read_bytes() == b"exact frozen bytes" for path in (directory / "artifacts").iterdir())


@pytest.mark.parametrize("content", [b"other bytes", None])
def test_filename_is_never_verified_content_identity(scene, tmp_path, content):
    api = scene[0]
    plan = with_evidence(prepare(scene, document(tmp_path)), FrozenEvidence("a", "proof.txt", b"expected bytes"))
    directory = tmp_path / "run"
    # Delay attachment discovery until stock is known, then provide an existing filename.
    original = api.get
    seeded = False
    def get(route, **kwargs):
        nonlocal seeded
        if route == "attachment/" and not seeded:
            seeded = True
            stock = original("stock/")[0]
            record = api.seed("attachment/", {"model_type": "stock.stockitem", "model_id": stock["pk"], "filename": "proof.txt"})
            if content is not None:
                with api.connect() as connection:
                    record["attachment"] = f"/media/{record['pk']}"
                    connection.execute("UPDATE rows SET body=? WHERE pk=?", (json.dumps(record), record["pk"]))
                    connection.execute("INSERT INTO bytes VALUES (?,?)", (record["pk"], content))
        return original(route, **kwargs)
    api.get = get
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    result = row(snapshot, operation(plan, "evidence"))
    assert result["state"] == State.NEEDS_REVIEW
    assert len(api.get("attachment/")) == 1
    assert result["result"]["error"]["code"] == ("evidence_bytes_conflict" if content else "evidence_verification_unavailable")


def test_journal_failure_stops_before_child_send_and_attempts_partial_report(scene, tmp_path, monkeypatch):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    directory = tmp_path / "run"
    original = RunStore.request_intent
    def request_intent(self, attempt, *, mutation, label):
        if mutation:
            with self.connection:
                self.connection.execute("CREATE TRIGGER fail_request BEFORE INSERT ON requests BEGIN SELECT RAISE(FAIL, 'disk failure'); END")
        return original(self, attempt, mutation=mutation, label=label)
    monkeypatch.setattr(RunStore, "request_intent", request_intent)
    with pytest.raises(JournalError):
        execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    assert not api.get("part/")
    assert (directory / "partial-report.json").exists()


def test_deleted_known_stock_and_manual_order_link_are_review_not_recreated(scene, tmp_path, monkeypatch):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    original = api.patch
    fired = False
    def patch(route, payload):
        nonlocal fired
        if not fired and "purchase_order" in payload:
            fired = True
            api.fail(route, "before")
        return original(route, payload)
    monkeypatch.setattr(api, "patch", patch)
    directory = tmp_path / "run"
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    failed = operation(plan, "order_link")
    stock = api.get("stock/")[0]
    original(f"stock/{stock['pk']}/", {"purchase_order": 999})
    snapshot = repair(plan, snapshot, directory, api, failed)
    assert row(snapshot, failed)["state"] == State.NEEDS_REVIEW
    assert api.get(f"stock/{stock['pk']}/")["purchase_order"] == 999
    with api.connect() as connection:
        connection.execute("DELETE FROM rows WHERE pk=?", (stock["pk"],))
    snapshot = repair(plan, snapshot, directory, api, failed)
    assert row(snapshot, failed)["state"] == State.NEEDS_REVIEW
    assert len(api.get("stock/")) == 1


def test_part_of_consumes_part_without_source_stock_metadata_success(scene, tmp_path, monkeypatch):
    api = scene[0]
    doc = document(tmp_path)
    doc.lines[1].part_of = "a"
    doc.lines[1].category = ""
    doc.lines[1].parameters = {}
    plan = prepare(scene, doc)
    original = api.patch
    fired = False
    def patch(route, payload):
        nonlocal fired
        if "tags" in payload and not fired:
            fired = True
            api.fail(route, "before")
        return original(route, payload)
    monkeypatch.setattr(api, "patch", patch)
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / "run")
    assert row(snapshot, operation(plan, "tags"))["state"] == State.UNCERTAIN
    assert row(snapshot, operation(plan, "stock", "b"))["state"] == State.SUCCEEDED
    assert len(api.get("part/")) == 1
    assert len(api.get("stock/")) == 2


def test_caller_ledger_nesting_keeps_confirmed_creates(scene, tmp_path):
    from invimport.inventree import ledger
    plan = prepare(scene, document(tmp_path))
    with ledger.recording() as book:
        execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / "run")
    assert any(event.model == "part" and event.what == ledger.CREATED for event in book.events)
    assert len([event for event in book.events if event.model == "stockitem" and event.what == ledger.CREATED]) == 2
    assert len([event for event in book.events if event.what == ledger.LINE_ADDED]) == 2


@pytest.mark.parametrize("type_identity", [False, True])
def test_rejected_missing_parameter_can_be_repaired_on_checkpointed_part(scene, tmp_path, type_identity):
    api, categories, parameters = scene
    if type_identity:
        categories["Resistors"].identity = "type"
    plan = prepare(scene, document(tmp_path, type_identity=type_identity))
    api.fail("parameter/", "rejected")
    directory = tmp_path / "run"
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    failed = next(op for op in plan.operations if op.kind == Kind.PARAMETER)
    assert row(snapshot, failed)["state"] == State.FAILED
    assert len(api.get("part/")) == 1 and len(api.get("parameter/")) == 1
    assert not api.get("stock/")
    snapshot = repair(plan, snapshot, directory, api, failed)
    assert all(line["complete"] for line in snapshot["report"]["lines"])
    assert len(api.get("part/")) == 1 and len(api.get("parameter/")) == 2
    assert len(api.get("stock/")) == 2


@pytest.mark.parametrize("fault", [None, "multiple", "invalid", "empty"])
def test_actual_observed_sdk_stock_slice_each_http_send_has_one_durable_request(scene, tmp_path, fault, monkeypatch):
    from urllib.parse import urlsplit

    from requests import HTTPError
    from tests.inventree.test_request_observation import Response

    from invimport.execution.dispatch import active_guard
    from invimport.execution.observation import Observation, observing
    from invimport.inventree.observed_api import client
    from invimport.inventree.stock import _http_failure

    server, categories, parameters = scene
    observation = Observation(lambda event: (_ for _ in ()).throw(OSError("renderer unavailable")))

    class SDKResponse(Response):
        def json(self):
            return json.loads(self.text)

    class Transport:
        def __init__(self):
            self.calls = []

        def __getattr__(self, method):
            def send(url, **kwargs):
                route = urlsplit(url).path.removeprefix("/api/")
                guard = active_guard()
                latest = observation.snapshot()[-1]
                assert latest.kind == "request_started"
                if guard is not None:
                    persisted = guard.store.connection.execute("SELECT state FROM requests WHERE id=?", (latest.request,)).fetchone()
                    assert persisted == ("intent",)
                self.calls.append((method, route, guard is not None, latest.request))
                try:
                    if route == "":
                        return SDKResponse({"server": "InvenTree", "apiVersion": 530})
                    if route == "user/me/":
                        return SDKResponse({"username": "fixture"})
                    if method == "get":
                        return SDKResponse(server.get(route, params=kwargs.get("params", {})))
                    if method == "options":
                        response = server.request(route, method="OPTIONS")
                        return SDKResponse(response.json())
                    if method == "patch":
                        return SDKResponse(server.patch(route, kwargs["json"]))
                    return SDKResponse(server.post(route, kwargs["json"]), 201)
                except HTTPError as exc:
                    status, payload = _http_failure(exc)
                    return SDKResponse(payload, status)
            return send

    transport = Transport()
    with observing(observation):
        api = client(TARGET.endpoint, observation=observation, transport=transport, token="test-token")
        plan = prepare_stock(document(tmp_path), api=api, categories=categories, parameters=parameters, target=TARGET)
        directory = tmp_path / "run"
        if fault:
            server.fail("stock/", fault)
        from invimport.inventree.api import StockItem
        def forbidden_constructor(*args, **kwargs):
            raise RuntimeError("durable raw create must checkpoint without SDK construction/reload")
        monkeypatch.setattr(StockItem, "__init__", forbidden_constructor)
        snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    if fault is None:
        assert all(line["complete"] for line in snapshot["report"]["lines"])
    else:
        assert row(snapshot, operation(plan, "stock"))["state"] == State.UNCERTAIN
        assert row(snapshot, operation(plan, "stock", "b"))["state"] == State.SUCCEEDED
    assert observation.delivery_failures > 0
    with sqlite_connection(directory / "run.sqlite3") as connection:
        request_ids = {row[0] for row in connection.execute("SELECT id FROM requests")}
    durable_sends = [call for call in transport.calls if call[2]]
    assert request_ids == {call[3] for call in durable_sends}
    assert len(request_ids) == len(durable_sends)
    assert all(call[2] for call in transport.calls if call[0] in {"post", "patch"} and call[1] != "barcode/")
    durable_events = [event for event in observation.snapshot() if event.kind == "request_started" and event.request in request_ids]
    assert len(durable_events) == len(request_ids)
    assert all(event.context.operation in {op.id for op in plan.operations} and event.context.attempt for event in durable_events)
    assert len(server.get("stock/")) == (3 if fault == "multiple" else 2)


def test_rejected_upload_is_failed_and_repair_can_upload_pending_bytes(scene, tmp_path):
    api = scene[0]
    plan = with_evidence(prepare(scene, document(tmp_path)), FrozenEvidence("a", "proof.txt", b"bytes"))
    directory = tmp_path / "run"
    api.fail("attachment/", "rejected")
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    evidence = operation(plan, "evidence")
    assert row(snapshot, evidence)["state"] == State.FAILED
    assert not api.get("attachment/")
    snapshot = repair(plan, snapshot, directory, api, evidence)
    assert row(snapshot, evidence)["state"] == State.SUCCEEDED
    assert len(api.get("attachment/")) == 1
    assert len(api.get("stock/")) == 2


def test_known_existing_type_part_manual_parameter_preserved_and_missing_addition_explicit(scene, tmp_path):
    api, categories, parameters = scene
    categories["Resistors"].identity = "type"
    category = api.get("part/category/")[0]
    resistance = api.get("parameter/template/")[0]
    part = api.seed("part/", {"name": "R100", "IPN": "R-00001", "category": category["pk"]})
    api.seed("parameter/", {"model_type": "part.part", "model_id": part["pk"], "template": resistance["pk"], "data": "manual"})
    plan = prepare(scene, document(tmp_path, type_identity=True))
    assert len([op for op in plan.operations if op.kind == Kind.PARAMETER]) == 2
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / "run")
    assert len(api.get("part/")) == 1
    assert any(row["data"] == "manual" for row in api.get("parameter/"))
    assert len(api.get("parameter/")) == 2
    assert not api.get("stock/")
    assert any(row["state"] == State.NEEDS_REVIEW for row in snapshot["operations"])
    assert all(not line["registered"] for line in snapshot["report"]["lines"])


def test_stock_repair_cannot_turn_semantic_read_into_mutation(scene, tmp_path):
    from dataclasses import replace
    from invimport.execution.models import OperationResult, Retry
    plan = prepare(scene, document(tmp_path))
    spec = replace(operation(plan, "part"), mutation=False)
    plan = replace(plan, operations=(spec,))
    with RunStore(tmp_path / "read-run" / "run.sqlite3", plan=plan, run_id="read-run", create=True) as store:
        attempt = store.start(spec.id, mutation=False)
        store.finish(attempt, OperationResult(State.FAILED, retry=Retry.REVIEW))
        with pytest.raises(ValueError, match="repair authorization"):
            store.start_stock_repair(spec.id)


def test_journal_failure_after_remote_create_stops_and_never_replays_lost_checkpoint(scene, tmp_path, monkeypatch):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    original = RunStore.checkpoint
    def checkpoint(self, attempt, result):
        with self.connection:
            self.connection.execute("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON events WHEN NEW.kind='output_checkpoint' BEGIN SELECT RAISE(FAIL, 'disk failure'); END")
        return original(self, attempt, result)
    monkeypatch.setattr(RunStore, "checkpoint", checkpoint)
    directory = tmp_path / "run"
    with pytest.raises(JournalError):
        execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    assert len(api.get("part/")) == 1
    assert not api.get("parameter/") and not api.get("stock/")
    with sqlite_connection(directory / "run.sqlite3") as connection:
        run_id = connection.execute("SELECT id FROM run").fetchone()[0]
        connection.execute("DROP TRIGGER fail_checkpoint")
    monkeypatch.setattr(RunStore, "checkpoint", original)
    snapshot = resume_stock(plan, run_id, directory / "run.sqlite3", api=api, current_target=TARGET)
    assert row(snapshot, operation(plan, "part"))["state"] == State.UNCERTAIN
    snapshot = repair(plan, snapshot, directory, api, operation(plan, "part"))
    assert row(snapshot, operation(plan, "part"))["state"] == State.UNCERTAIN
    assert len(api.get("part/")) == 1


def test_repair_cancellation_after_record_read_prevents_conditional_mutation(scene, tmp_path, monkeypatch):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    directory = tmp_path / "run"
    original_patch = api.patch
    armed = True
    def patch(route, payload):
        nonlocal armed
        if "tags" in payload and armed:
            armed = False
            api.fail(route, "before")
        return original_patch(route, payload)
    monkeypatch.setattr(api, "patch", patch)
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    cancelled = Event()
    original_get = api.get
    def get(route, **kwargs):
        result = original_get(route, **kwargs)
        if route.startswith("stock/"):
            cancelled.set()
        return result
    monkeypatch.setattr(api, "get", get)
    with api.connect() as connection:
        before = connection.execute("SELECT count(*) FROM calls WHERE method='patch'").fetchone()[0]
    result = repair_stock(plan, snapshot["run_id"], directory / "run.sqlite3", operation(plan, "tags").id,
                          api=api, current_target=TARGET, cancelled=cancelled)
    assert row(result, operation(plan, "tags"))["state"] == State.UNCERTAIN
    with api.connect() as connection:
        assert connection.execute("SELECT count(*) FROM calls WHERE method='patch'").fetchone()[0] == before


def test_client_target_change_after_read_is_rejected_before_any_write(scene, tmp_path, monkeypatch):
    api = scene[0]
    plan = prepare(scene, document(tmp_path))
    original = api.get
    def get(route, **kwargs):
        result = original(route, **kwargs)
        api.api_url = "https://changed.example/api/"
        return result
    monkeypatch.setattr(api, "get", get)
    with pytest.raises(ValueError, match="target changed"):
        execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / "run")
    assert not original("part/")
    assert not original("stock/")


@pytest.mark.parametrize("stop", ["checkpoint", "settled"])
@pytest.mark.parametrize("field,value", [("description", "manual description"), ("order_currency", "EUR"),
                                         ("tags", ["manual"]), ("notes", "manual notes"),
                                         ("start_date", "2025-01-01"), ("target_date", "2025-01-02"),
                                         ("link", "https://manual.example/"), ("reference", "MANUAL-PO")])
def test_checkpointed_and_settled_order_metadata_drift_blocks_new_contributions(scene, tmp_path, stop, field, value):
    api = scene[0]
    doc = document(tmp_path)
    for line in doc.lines:
        line.currency = "USD"
        line.unit_price = 1
        line.order.update({"description": "approved description", "tags": ["approved"], "notes": "approved notes",
                           "date": "2026-10-01", "target_date": "2026-10-02", "link": "https://approved.example/"})
    plan = prepare(scene, doc)
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(plan.dumps())
    directory = tmp_path / "run"
    script = '''import sys, os
from pathlib import Path
from invimport.execution.models import Plan
from invimport.execution.stock_workflow import execute_stock
from invimport.execution.store import RunStore
from tests.execution.stock_server import StockServer
plan = Plan.loads(Path(sys.argv[1]).read_text())
method = 'checkpoint' if sys.argv[4] == 'checkpoint' else 'finish'
original = getattr(RunStore, method)
def stop(self, attempt, result):
    original(self, attempt, result)
    if next(op for op in self.plan.operations if op.id == attempt.operation).desired.values()['action'] == 'order':
        os._exit(74)
setattr(RunStore, method, stop)
execute_stock(plan, api=StockServer(Path(sys.argv[2])), current_target=plan.target, run_directory=Path(sys.argv[3]))
'''
    result = subprocess.run([sys.executable, "-c", script, str(plan_path), str(api.path), str(directory), stop], capture_output=True)
    assert result.returncode == 74, result.stderr
    order = api.get("order/po/")[0]
    api.patch(f"order/po/{order['pk']}/", {field: value})
    with sqlite_connection(directory / "run.sqlite3") as connection:
        run_id = connection.execute("SELECT id FROM run").fetchone()[0]
    snapshot = resume_stock(plan, run_id, directory / "run.sqlite3", api=api, current_target=TARGET)
    assert not api.get("order/po-line/")
    selected = operation(plan, "order") if stop == "checkpoint" else operation(plan, "order_line")
    snapshot = repair(plan, snapshot, directory, api, selected)
    assert row(snapshot, selected)["state"] == State.NEEDS_REVIEW
    assert not api.get("order/po-line/")
    assert api.get(f"order/po/{order['pk']}/")[field] == value
    assert all(not line["complete"] for line in snapshot["report"]["lines"])
    assert len(api.get("order/po/")) == 1


def test_confirmed_upload_missing_from_listing_is_verification_only_on_repeated_repairs(scene, tmp_path, monkeypatch):
    api = scene[0]
    plan = with_evidence(prepare(scene, document(tmp_path)), FrozenEvidence("a", "proof.txt", b"retained exact bytes"))
    original_get = api.get
    def get(route, **kwargs):
        return [] if route == "attachment/" else original_get(route, **kwargs)
    monkeypatch.setattr(api, "get", get)
    directory = tmp_path / "run"
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    evidence = operation(plan, "evidence")
    assert row(snapshot, evidence)["state"] == State.NEEDS_REVIEW
    assert len(original_get("attachment/")) == 1
    for _ in range(3):
        snapshot = repair(plan, snapshot, directory, api, evidence)
        result = row(snapshot, evidence)
        assert result["state"] == State.NEEDS_REVIEW
        assert any(effect["kind"] == "upload" and effect["certainty"] == "confirmed" for effect in result["result"]["effects"])
        assert len(original_get("attachment/")) == 1
    assert any(path.read_bytes() == b"retained exact bytes" for path in (directory / "artifacts").iterdir())


def test_multiple_distinct_new_order_allocations_reject_during_read_only_preparation(scene, tmp_path):
    api = scene[0]
    doc = document(tmp_path)
    doc.lines[1].order["reference"] = "Different-Invoice"
    with pytest.raises(PreparationReview, match="multiple new purchase order allocations"):
        prepare(scene, doc)
    assert not api.get("part/") and not api.get("stock/")
    assert not api.get("company/") and not api.get("order/po/")
    # A read-only OPTIONS default is not a reservation: it advances only on create.
    assert api.request("order/po/", method="OPTIONS").json()["actions"]["POST"]["reference"]["default"] == "PO-1"
    api.seed("order/po/", {"reference": "PO-1"})
    assert api.request("order/po/", method="OPTIONS").json()["actions"]["POST"]["reference"]["default"] == "PO-2"
