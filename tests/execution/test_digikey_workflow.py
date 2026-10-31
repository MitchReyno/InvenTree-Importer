from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from threading import Event

import pytest

from invimport.execution.digikey_preparation import prepare_digikey
from invimport.execution.digikey_workflow import execute_digikey, repair_digikey
from invimport.execution.models import State, Target
from invimport.execution.ownership import JournalError
from invimport.execution.run_control import complete, inspect_run
from invimport.execution.stock_preparation import PreparationReview
from invimport.execution.store import RunStore
from tests.execution.digikey_server import DigiKeyServer

TARGET = Target("https://inventory.example/api/", "fixture", "persistent fixture continuity")


def source(*, two=True):
    line = {"source_line_id": "original-1", "digikey_part": "SKU-A", "quantity_ordered": 5,
            "unit_price": "0.123456789", "manufacturer_part": "MPN"}
    return [{"order_number": "original-order", "sales_orders": [{"sales_order_id": 7001, "currency": "AUD",
             "line_items": [line, {**line, "source_line_id": "original-2"}] if two else [line]}]}]


@pytest.fixture
def scene(tmp_path):
    server = DigiKeyServer(tmp_path / "server.sqlite3")
    supplier = server.seed("company/", {"name": "DigiKey", "is_supplier": True})
    location = server.seed("stock/location/", {"name": "Shelf", "parent": None})
    part = server.seed("part/", {"name": "Part", "IPN": "P-00001", "keywords": "", "category": 99})
    sku = server.seed("company/part/", {"part": part["pk"], "supplier": supplier["pk"], "SKU": "SKU-A"})
    return server, supplier["pk"], location["pk"], sku["pk"]


def prepare(scene, orders=None, **kwargs):
    server, supplier, location, _ = scene
    return prepare_digikey(orders or source(), supplier=supplier, location=location, target=TARGET, api=server, **kwargs)


def operation(plan, action, index=0):
    return [op for op in plan.operations if op.desired.values()["action"] == action][index]


def row(snapshot, spec):
    return next(row for row in snapshot["operations"] if row["id"] == spec.id)


def repair(plan, snapshot, directory, server, spec):
    return repair_digikey(plan, snapshot["run_id"], directory / "run.sqlite3", spec.id, api=server, current_target=TARGET)


def calls(server, route):
    with server.connect() as connection:
        return connection.execute("SELECT count(*) FROM calls WHERE method='post' AND route=?", (route,)).fetchone()[0]


def test_duplicate_skus_are_distinct_original_contributions_and_one_receipt(scene, tmp_path):
    server = scene[0]
    plan = prepare(scene)
    assert not server.get("order/po/")
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert complete(snapshot)
    lines = server.get("order/po-line/")
    assert len(lines) == len(server.get("stock/")) == 2
    assert len({line["reference"] for line in lines}) == 2
    assert {line["purchase_price"] for line in lines} == {"0.123456789"}
    assert {line["purchase_price_currency"] for line in lines} == {"AUD"}
    po = server.get("order/po/")[0]
    assert calls(server, f"order/po/{po['pk']}/receive/") == 1
    receipt = row(snapshot, operation(plan, "dk_receive"))
    assert len([effect for effect in receipt["result"]["effects"] if effect["kind"] == "receive_accepted"]) == 2
    assert not receipt["result"]["outputs"]  # No invented stock ownership.
    assert inspect_run(snapshot["run_id"])["complete"]
    # A fresh complete source invocation adopts exact contribution references,
    # even when stock has been consumed/deleted; it never recreates history.
    with server.connect() as connection:
        connection.execute("DELETE FROM rows WHERE route='stock/'")
    later = execute_digikey(prepare(scene), api=server, current_target=TARGET, run_directory=tmp_path / "later")
    assert complete(later)
    assert not server.get("stock/")
    assert calls(server, f"order/po/{po['pk']}/receive/") == 1


def test_rejected_initial_line_repairs_missing_approved_contribution(scene, tmp_path):
    server = scene[0]
    plan = prepare(scene)
    server.fail("order/po-line/", "rejected")
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    failed = operation(plan, "dk_line")
    assert row(snapshot, failed)["state"] == State.FAILED
    assert len(server.get("order/po-line/")) == 1
    assert not server.get("stock/")
    snapshot = repair(plan, snapshot, directory, server, failed)
    assert complete(snapshot)
    assert len(server.get("order/po/")) == 1
    assert len(server.get("order/po-line/")) == len(server.get("stock/")) == 2


@pytest.mark.parametrize("action", ["dk_order", "dk_line"])
def test_unknown_create_is_never_payload_or_reference_matched(scene, tmp_path, action):
    server = scene[0]
    plan = prepare(scene)
    route = "order/po/" if action == "dk_order" else "order/po-line/"
    server.fail(route, "lost")
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    unknown = operation(plan, action)
    assert row(snapshot, unknown)["state"] == State.UNCERTAIN
    count = calls(server, route)
    snapshot = repair(plan, snapshot, directory, server, unknown)
    assert row(snapshot, unknown)["state"] == State.UNCERTAIN
    assert calls(server, route) == count


@pytest.mark.parametrize("action", ["dk_issue", "dk_receive"])
@pytest.mark.parametrize("mode", ["lost", "crash"])
def test_fresh_process_lost_issue_and_multiline_receive_reconcile_without_replay(scene, tmp_path, action, mode):
    server = scene[0]
    plan = prepare(scene)
    # The fake has deterministic global PKs, but derive the future order PK from
    # its own database rather than embedding production/reference assumptions.
    with server.connect() as connection:
        po_pk = connection.execute("SELECT max(pk)+1 FROM rows").fetchone()[0]
    route = f"order/po/{po_pk}/{'issue' if action == 'dk_issue' else 'receive'}/"
    server.fail(route, mode)
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(plan.dumps())
    directory = tmp_path / "run"
    script = '''from pathlib import Path
import json, sys
from invimport.execution.models import Plan
from invimport.execution.digikey_workflow import execute_digikey, resume_digikey, repair_digikey
from tests.execution.digikey_server import DigiKeyServer
plan = Plan.loads(Path(sys.argv[1]).read_text())
server = DigiKeyServer(Path(sys.argv[2]))
directory = Path(sys.argv[3])
if sys.argv[4] == "execute":
 result = execute_digikey(plan, api=server, current_target=plan.target, run_directory=directory)
else:
 import sqlite3
 with sqlite3.connect(directory / "run.sqlite3") as db: run_id = db.execute("SELECT id FROM run").fetchone()[0]
 result = resume_digikey(plan, run_id, directory / "run.sqlite3", api=server, current_target=plan.target)
 op = next(op for op in plan.operations if op.desired.values()["action"] == sys.argv[4])
 result = repair_digikey(plan, run_id, directory / "run.sqlite3", op.id, api=server, current_target=plan.target)
print(json.dumps(result))
'''
    args = [sys.executable, "-c", script, str(plan_path), str(server.path), str(directory)]
    initial = subprocess.run([*args, "execute"], capture_output=True, text=True)
    assert initial.returncode == (71 if mode == "crash" else 0), initial.stderr
    resumed = subprocess.run([*args, action], capture_output=True, text=True)
    assert resumed.returncode == 0, resumed.stderr
    snapshot = json.loads(resumed.stdout)
    assert complete(snapshot)
    assert len(server.get("stock/")) == 2
    assert calls(server, route) == 1
    with sqlite3.connect(directory / "run.sqlite3") as connection:
        history = connection.execute("SELECT safe_json FROM events WHERE kind='operation_settled' AND operation=?", (operation(plan, action).id,)).fetchall()
        assert any(json.loads(event[0])["result"]["certainty"] == "unknown" for event in history)


def test_partial_applied_receipt_stays_review_without_replaying_other_lines(scene, tmp_path):
    server = scene[0]
    plan = prepare(scene)
    directory = tmp_path / "run"
    with server.connect() as connection:
        pk = connection.execute("SELECT max(pk)+1 FROM rows").fetchone()[0]
    route = f"order/po/{pk}/receive/"
    server.fail(route, "partial")
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    snapshot = repair(plan, snapshot, directory, server, operation(plan, "dk_receive"))
    assert not complete(snapshot)
    assert calls(server, route) == 1
    assert len(server.get("stock/")) == 1


def test_missing_location_and_batch_scope_fail_before_mutations(scene):
    server, supplier, _, _ = scene
    with pytest.raises(PreparationReview, match="location"):
        prepare_digikey(source(), supplier=supplier, location=None, api=server, target=TARGET)
    with pytest.raises(PreparationReview, match="exactly one"):
        prepare(scene, source() * 2)
    assert not server.get("order/po/")


def test_partial_order_choice_is_frozen_not_silently_selected(scene, tmp_path):
    orders = source()
    orders[0]["sales_orders"][0]["line_items"][1]["digikey_part"] = "MISSING"
    with pytest.raises(PreparationReview, match="partial-order"):
        prepare(scene, orders)
    plan = prepare(scene, orders, partial=True)
    assert plan.decisions.values()["skipped"] == ["id:original-2"]
    snapshot = execute_digikey(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / "run")
    assert complete(snapshot)
    assert len(scene[0].get("stock/")) == 1


def test_cancellation_and_journal_failure_prevent_first_mutation(scene, tmp_path, monkeypatch):
    server = scene[0]
    plan = prepare(scene)
    cancelled = Event()
    cancelled.set()
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "cancelled", cancelled=cancelled)
    assert not complete(snapshot)
    assert not server.get("order/po/")
    # A distinct order can proceed; the cancelled reservation remains exclusive.
    other = source()
    other[0]["sales_orders"][0]["sales_order_id"] = 7002
    plan = prepare(scene, other)
    original = RunStore.request_intent
    def fail(self, attempt, *, mutation, label):
        if mutation:
            raise JournalError("controlled intent failure")
        return original(self, attempt, mutation=mutation, label=label)
    monkeypatch.setattr(RunStore, "request_intent", fail)
    with pytest.raises(JournalError):
        execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "failed")
    assert not server.get("order/po/")


def test_partial_existing_receipt_requires_frozen_remaining_approval(scene, tmp_path):
    server = scene[0]
    booked = execute_digikey(prepare(scene, receive=False), api=server, current_target=TARGET, run_directory=tmp_path / "book")
    assert complete(booked)
    line = server.get("order/po-line/")[0]
    line["received"] = "2"
    server.update(line)
    existing = server.seed("stock/", {"purchase_order": line["order"], "supplier_part": line["part"], "quantity": "1", "location": scene[2]})
    with pytest.raises(PreparationReview, match="remaining"):
        prepare(scene)
    approved = prepare(scene, receive_remaining=True)
    result = execute_digikey(approved, api=server, current_target=TARGET, run_directory=tmp_path / "remaining")
    assert complete(result)
    assert server.get(f"stock/{existing['pk']}/")["quantity"] == "1"
    assert len(server.get("stock/")) == 3
    assert all(line["received"] == "5" for line in server.get("order/po-line/"))


def test_uncorrelated_legacy_order_is_reviewed_before_missing_line_guess(scene):
    server, supplier, _, sku = scene
    po = server.seed("order/po/", {"supplier": supplier, "supplier_reference": "7001", "reference": "PO-legacy", "order_currency": "AUD"})
    server.seed("order/po-line/", {"order": po["pk"], "part": sku, "quantity": 5, "received": 5})
    with pytest.raises(PreparationReview, match="uncorrelated"):
        prepare(scene)


def test_target_mismatch_and_source_reordering_fail_closed(scene, tmp_path):
    server = scene[0]
    plan = prepare(scene)
    with pytest.raises(ValueError, match="target"):
        execute_digikey(plan, api=server, current_target=Target("https://elsewhere.example/"), run_directory=tmp_path / "bad")
    rows = source()
    for line in rows[0]["sales_orders"][0]["line_items"]:
        line.pop("source_line_id")
    plan = prepare(scene, rows)
    execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "book")
    rows[0]["sales_orders"][0]["line_items"].append(dict(rows[0]["sales_orders"][0]["line_items"][0]))
    with pytest.raises(PreparationReview, match="uncorrelated"):
        prepare(scene, rows)


def test_legacy_writer_cannot_bypass_unknown_durable_order(scene, tmp_path):
    from invimport.inventree.purchase_orders import import_orders
    from invimport.execution.ownership import OwnershipError
    server = scene[0]
    plan = prepare(scene)
    server.fail("order/po/", "lost")
    execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "run")
    with pytest.raises(OwnershipError):
        import_orders(source(), server, supplier=scene[1], location=scene[2], write=True)
    assert len(server.get("order/po/")) == 1


@pytest.mark.parametrize("fault", [None, "issue", "receive"])
def test_actual_sdk_every_send_has_one_guarded_intent_for_issue_and_receipt(scene, tmp_path, fault):
    from urllib.parse import urlsplit
    from requests import HTTPError
    from invimport.execution.dispatch import active_guard
    from invimport.execution.observation import Observation, observing
    from invimport.inventree.observed_api import client
    from invimport.inventree.stock import _http_failure
    from tests.inventree.test_request_observation import Response
    server = scene[0]
    observation = Observation()

    class SDKResponse(Response):
        def json(self):
            return json.loads(self.text)

    class Transport:
        def __init__(self):
            self.guarded = []
        def __getattr__(self, method):
            def send(url, **kwargs):
                route = urlsplit(url).path.removeprefix("/api/")
                guard = active_guard()
                if guard:
                    event = observation.snapshot()[-1]
                    assert event.kind == "request_started"
                    assert guard.store.connection.execute("SELECT state FROM requests WHERE id=?", (event.request,)).fetchone() == ("intent",)
                    self.guarded.append(event.request)
                try:
                    if not route:
                        return SDKResponse({"server": "InvenTree", "apiVersion": 530})
                    if route == "user/me/":
                        return SDKResponse({"username": "fixture"})
                    if method == "get":
                        return SDKResponse(server.get(route, params=kwargs.get("params", {})))
                    if method == "options":
                        return SDKResponse(server.request(route, method="OPTIONS").json())
                    return SDKResponse(server.post(route, kwargs["json"]), 201)
                except HTTPError as exc:
                    status, payload = _http_failure(exc)
                    return SDKResponse(payload, status)
            return send

    transport = Transport()
    with observing(observation):
        api = client(TARGET.endpoint, observation=observation, transport=transport, token="SECRET-TOKEN")
        plan = prepare_digikey(source(), supplier=scene[1], location=scene[2], api=api, target=TARGET)
        if fault:
            with server.connect() as connection:
                pk = connection.execute("SELECT max(pk)+1 FROM rows").fetchone()[0]
            server.fail(f"order/po/{pk}/{fault}/", "lost")
        directory = tmp_path / "run"
        snapshot = execute_digikey(plan, api=api, current_target=TARGET, run_directory=directory)
        if fault:
            spec = operation(plan, "dk_" + fault)
            assert row(snapshot, spec)["state"] == State.UNCERTAIN
            snapshot = repair(plan, snapshot, directory, api, spec)
    assert complete(snapshot)
    with sqlite3.connect(directory / "run.sqlite3") as connection:
        ids = [row[0] for row in connection.execute("SELECT id FROM requests ORDER BY rowid")]
    assert ids == transport.guarded
    assert len(ids) == len(set(ids))
    assert "SECRET-TOKEN" not in json.dumps(observation.export())


def cli_process(arguments, server, tmp_path):
    script = '''import sys
from pathlib import Path
from invimport.commands import import_run
from invimport.__main__ import cli
from tests.execution.digikey_server import DigiKeyServer
server_path = Path(sys.argv.pop(1))
import_run.connect = lambda: DigiKeyServer(server_path)
sys.exit(cli(sys.argv[1:]))
'''
    root = Path(__file__).resolve().parents[2]
    env = dict(os.environ, PYTHONPATH=os.pathsep.join((str(root), str(root / "src"))), INVENTREE_URL=server.api_url)
    return subprocess.run([sys.executable, "-c", script, str(server.path), "--env-file", str(tmp_path / "absent.env"),
                           "import-run", *arguments], env=env, capture_output=True, text=True)


def test_public_cli_fresh_process_prepare_execute_resume_retry_and_local_status(scene, tmp_path):
    server = scene[0]
    orders = tmp_path / "orders.json"
    orders.write_text(json.dumps(source()))
    output = tmp_path / "approved.json"
    prepared = cli_process(["prepare-digikey", str(orders), "--supplier", str(scene[1]), "--location", str(scene[2]),
                            "--output", str(output), "--json"], server, tmp_path)
    assert prepared.returncode == 0, prepared.stderr
    assert json.loads(prepared.stdout)["prepared"]
    assert not server.get("order/po/")
    from invimport.execution.models import Plan
    plan = Plan.loads(output.read_text())
    preview = cli_process(["execute", str(output), "--json"], server, tmp_path)
    assert preview.returncode == 0 and json.loads(preview.stdout)["preview_only"]
    server.fail("order/po-line/", "rejected")
    events = tmp_path / "events.jsonl"
    run = cli_process(["execute", str(output), "--write", "--json", "--events", str(events)], server, tmp_path)
    assert run.returncode == 1, run.stderr
    run_id = json.loads(run.stdout)["run_id"]
    orders.unlink()
    output.unlink()
    resumed = cli_process(["resume", run_id, "--write", "--json", "--continuity-reason", "verified fixture database"], server, tmp_path)
    assert resumed.returncode == 1
    retry = cli_process(["retry-operation", run_id, operation(plan, "dk_line").id, "--write", "--json",
                         "--continuity-reason", "verified fixture database"], server, tmp_path)
    assert retry.returncode == 0, retry.stderr
    status = cli_process(["status", run_id, "--json"], server, tmp_path)
    assert status.returncode == 0 and json.loads(status.stdout)["complete"]
    exported = [json.loads(line) for line in events.read_text().splitlines()]
    assert [event["sequence"] for event in exported] == list(range(1, len(exported) + 1))
    assert len(server.get("stock/")) == 2


def test_shared_model_planning_creates_supplier_models_without_direct_stock_or_barcode(scene, tmp_path):
    from invimport.config import CategoryConfig, ParameterConfig
    from invimport.inventree.stockimport import ImportOptions
    server = scene[0]
    category = server.seed("part/category/", {"name": "Components", "pathstring": "Components"})
    server.seed("parameter/template/", {"name": "Value"})
    categories = {"Components": CategoryConfig("Components", ["Components"], identity="mpn", ipn_prefix="IC", parameters=["Value"], aliases=["Components"])}
    products = {"NEW-SKU": {"manufacturer_part": "NEW-MPN", "manufacturer_name": "Maker", "category_path": ["Components"],
                            "parameters": {"Value": "10"}, "description": "New model", "link": "https://example.com/product"}}
    orders = source(two=False)
    orders[0]["sales_orders"][0]["line_items"][0]["digikey_part"] = "NEW-SKU"
    plan = prepare(scene, orders, create_parts=True, products=products, categories=categories,
                   parameters={"Value": ParameterConfig("Value")}, options=ImportOptions(create_manufacturers=True))
    actions = {op.desired.values()["action"] for op in plan.operations}
    assert {"part", "supplier_part", "manufacturer_part", "parameter"} <= actions
    assert not actions & {"stock", "barcode", "order_line"}
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "run")
    assert complete(snapshot)
    assert len(server.get("stock/")) == 1
    model = server.get("company/part/", params={"SKU": "NEW-SKU"})[0]
    assert server.get(f"part/{model['part']}/")["category"] == category["pk"]


@pytest.mark.parametrize("action", ["dk_order", "dk_line"])
def test_fresh_process_known_output_checkpoint_survives_before_dependent_read(scene, tmp_path, action):
    server = scene[0]
    plan = prepare(scene)
    plan_path = tmp_path / "approved.json"
    plan_path.write_text(plan.dumps())
    directory = tmp_path / "run"
    script = '''import os, sys
from pathlib import Path
from invimport.execution.models import Plan
from invimport.execution.digikey_workflow import execute_digikey
from invimport.execution.store import RunStore
from tests.execution.digikey_server import DigiKeyServer
plan = Plan.loads(Path(sys.argv[1]).read_text())
original = RunStore.checkpoint
def checkpoint(self, attempt, result):
 original(self, attempt, result)
 spec = next(op for op in plan.operations if op.id == attempt.operation)
 if spec.desired.values()["action"] == sys.argv[4]: os._exit(72)
RunStore.checkpoint = checkpoint
execute_digikey(plan, api=DigiKeyServer(Path(sys.argv[2])), current_target=plan.target, run_directory=Path(sys.argv[3]))
'''
    child = subprocess.run([sys.executable, "-c", script, str(plan_path), str(server.path), str(directory), action], capture_output=True, text=True)
    assert child.returncode == 72, child.stderr
    with sqlite3.connect(directory / "run.sqlite3") as connection:
        run_id = connection.execute("SELECT id FROM run").fetchone()[0]
    from invimport.execution.digikey_workflow import resume_digikey
    resumed = resume_digikey(plan, run_id, directory / "run.sqlite3", api=server, current_target=TARGET)
    saved = row(resumed, operation(plan, action))["result"]["outputs"]
    assert saved
    repaired = repair(plan, resumed, directory, server, operation(plan, action))
    assert complete(repaired)
    assert row(repaired, operation(plan, action))["result"]["outputs"] == saved
    assert len(server.get("order/po/")) == 1
    assert len(server.get("order/po-line/")) == len(server.get("stock/")) == 2


def test_unrelated_order_continues_while_original_unknown_claim_stays_reserved(scene, tmp_path):
    server = scene[0]
    plan = prepare(scene)
    server.fail("order/po/", "lost")
    original = execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "original")
    assert not complete(original)
    another = source()
    another[0]["sales_orders"][0]["sales_order_id"] = 7002
    other = execute_digikey(prepare(scene, another), api=server, current_target=TARGET, run_directory=tmp_path / "other")
    assert complete(other)
    assert len(server.get("order/po/")) == 2
    assert len(server.get("stock/")) == 2
    assert not inspect_run(original["run_id"])["complete"]


def test_manual_metadata_change_after_issue_blocks_receipt_consumer(scene, tmp_path):
    server = scene[0]
    plan = prepare(scene)
    original = server.post
    def post(route, payload):
        response = original(route, payload)
        if route.endswith("/issue/"):
            order = server.get("order/po/")[0]
            order["order_currency"] = "USD"
            server.update(order)
        return response
    server.post = post
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "run")
    assert not complete(snapshot)
    assert row(snapshot, operation(plan, "dk_receive"))["state"] == State.NEEDS_REVIEW
    assert not server.get("stock/")


def test_supported_target_controls_disable_default_merging_and_repricing(scene, tmp_path):
    server = scene[0]
    plan = prepare(scene)
    for spec in [spec for spec in plan.operations if spec.desired.values()["action"] == "dk_line"]:
        assert spec.desired.values()["creation_policy"]["payload"] == {"merge_items": False, "auto_pricing": False}
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "run")
    assert complete(snapshot)
    rows = server.get("order/po-line/")
    assert len(rows) == 2
    assert all(row["merge_items"] is False and row["auto_pricing"] is False for row in rows)
    # Demonstrate that this fake actually implements the dangerous server default.
    server.post("order/po-line/", {"order": rows[0]["order"], "part": rows[0]["part"], "quantity": "1"})
    assert len(server.get("order/po-line/")) == 2
    assert server.get(f"order/po-line/{rows[0]['pk']}/")["quantity"] == "6"


def test_missing_capabilities_and_price_override_block_before_receipt(scene, tmp_path):
    from types import SimpleNamespace
    from invimport.execution.order_line_policy import OrderLineCapabilityError
    server = scene[0]
    request = server.request
    server.request = lambda *args, **kwargs: SimpleNamespace(json=lambda: {"actions": {"POST": {}}})
    with pytest.raises(OrderLineCapabilityError):
        prepare(scene)
    assert not server.get("order/po/")
    server.request = request
    plan = prepare(scene)
    original = server.post
    def post(route, payload):
        response = original(route, payload)
        if route == "order/po-line/":
            response["purchase_price"] = "42"
            response["purchase_price_currency"] = "USD"
            server.update(response)
        return response
    server.post = post
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "run")
    assert not complete(snapshot)
    assert not server.get("stock/")
    assert all(row["status"] == 10 for row in server.get("order/po/"))
