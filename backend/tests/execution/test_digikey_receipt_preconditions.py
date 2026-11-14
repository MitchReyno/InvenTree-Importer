"""Late receipt/issue state is bound to the selected call, never cached input."""
from __future__ import annotations

import sqlite3

import pytest

from invimport.execution.digikey_workflow import execute_digikey
from invimport.execution.dispatch import active_guard
from invimport.execution.models import Certainty, Effect, State
from invimport.execution.records import review
from invimport.execution.run_control import complete
from tests.execution.test_digikey_review_regressions import child_repair
from tests.execution.test_digikey_workflow import TARGET, calls, operation, prepare, row, scene as scene, source


def current_action(plan):
    guard = active_guard()
    return next(op.desired.values()["action"] for op in plan.operations if guard and op.id == guard.attempt.operation) if guard else None


def mutation_requests(directory, spec):
    with sqlite3.connect(directory / "run.sqlite3") as connection:
        return connection.execute("SELECT count(*) FROM requests JOIN attempts ON requests.attempt=attempts.id WHERE attempts.operation=? AND requests.mutation=1", (spec.id,)).fetchone()[0]


@pytest.mark.parametrize("at_lookup", [1, 2])
@pytest.mark.parametrize("received", ["2", "5"])
def test_manual_received_change_before_final_dispatch_never_receives_stale_amount(scene, tmp_path, at_lookup, received):
    server = scene[0]
    plan = prepare(scene, source(two=False))
    get = server.get
    lookups = 0
    def changed(route, **kwargs):
        nonlocal lookups
        result = get(route, **kwargs)
        if current_action(plan) == "dk_receive" and route.startswith("stock/location/"):
            lookups += 1
            if lookups == at_lookup:
                line = get("order/po-line/")[0]
                line["received"] = received
                server.update(line)
        return result
    server.get = changed
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    po = server.get("order/po/")[0]
    receipt = operation(plan, "dk_receive")
    assert calls(server, f"order/po/{po['pk']}/receive/") == 0
    assert mutation_requests(directory, receipt) == 0
    assert server.get("order/po-line/")[0]["received"] == received
    assert not server.get("stock/")
    if at_lookup == 2 or received == "2":
        assert not complete(snapshot)
        assert row(snapshot, receipt)["state"] == State.NEEDS_REVIEW
    else:
        assert complete(snapshot)  # Fully satisfied intent, with no stock ownership guess.
    repaired = child_repair(plan, snapshot, directory, server, "dk_receive") if not complete(snapshot) else snapshot
    assert complete(repaired) == (received == "5")
    assert calls(server, f"order/po/{po['pk']}/receive/") == 0
    assert not server.get("stock/")


@pytest.mark.parametrize("at_lookup", [1, 2])
@pytest.mark.parametrize("status", [10, 30, 40, 50])
def test_current_nonopen_status_cannot_receive_from_cached_open_state(scene, tmp_path, at_lookup, status):
    server = scene[0]
    plan = prepare(scene, source(two=False))
    get = server.get
    lookups = 0
    def changed(route, **kwargs):
        nonlocal lookups
        result = get(route, **kwargs)
        if current_action(plan) == "dk_receive" and route.startswith("stock/location/"):
            lookups += 1
            if lookups == at_lookup:
                po = get("order/po/")[0]
                po["status"] = status
                server.update(po)
        return result
    server.get = changed
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert not complete(snapshot)
    po = server.get("order/po/")[0]
    assert po["status"] == status
    assert calls(server, f"order/po/{po['pk']}/receive/") == 0
    assert mutation_requests(directory, operation(plan, "dk_receive")) == 0
    assert not complete(child_repair(plan, snapshot, directory, server, "dk_receive"))
    assert not server.get("stock/")


@pytest.mark.parametrize("change", ["rename", "delete"])
def test_location_drift_after_payload_selection_requires_review_without_fallback(scene, tmp_path, change):
    server = scene[0]
    plan = prepare(scene, source(two=False))
    get = server.get
    line_reads = 0
    def changed(route, **kwargs):
        nonlocal line_reads
        result = get(route, **kwargs)
        if current_action(plan) == "dk_receive" and route.startswith("order/po-line/") and route != "order/po-line/":
            line_reads += 1
            if line_reads == 2:
                location = get(f"stock/location/{scene[2]}/")
                if change == "rename":
                    location["name"] = "Changed shelf"
                    server.update(location)
                else:
                    with server.connect() as connection:
                        connection.execute("DELETE FROM rows WHERE pk=?", (scene[2],))
        return result
    server.get = changed
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert not complete(snapshot)
    assert row(snapshot, operation(plan, "dk_receive"))["state"] == State.NEEDS_REVIEW
    assert mutation_requests(directory, operation(plan, "dk_receive")) == 0
    assert not server.get("stock/")
    assert not complete(child_repair(plan, snapshot, directory, server, "dk_receive"))
    assert not server.get("stock/")


@pytest.mark.parametrize("status", [20, 30, 40])
def test_issue_rechecks_current_status_before_dispatch(scene, tmp_path, status):
    server = scene[0]
    plan = prepare(scene, source(two=False))
    get = server.get
    reads = 0
    def changed(route, **kwargs):
        nonlocal reads
        result = get(route, **kwargs)
        if current_action(plan) == "dk_issue" and route.startswith("order/po/") and route != "order/po/":
            reads += 1
            if reads == 2:
                po = dict(result, status=status)
                server.update(po)
        return result
    server.get = changed
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert not complete(snapshot)
    po = server.get("order/po/")[0]
    assert po["status"] == status
    assert calls(server, f"order/po/{po['pk']}/issue/") == 0
    assert mutation_requests(directory, operation(plan, "dk_issue")) == 0
    assert not server.get("stock/")


@pytest.mark.parametrize("received", ["3", "5.0000001"])
def test_accepted_receipt_readback_conflict_retains_confirmed_effects_without_error_or_replay(scene, tmp_path, received):
    server = scene[0]
    plan = prepare(scene, source(two=False))
    post = server.post
    def changed(route, payload):
        result = post(route, payload)
        if route.endswith("/receive/"):
            line = server.get("order/po-line/")[0]
            line["received"] = received
            server.update(line)
        return result
    server.post = changed
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    receipt = operation(plan, "dk_receive")
    result = row(snapshot, receipt)["result"]
    assert result["state"] == State.NEEDS_REVIEW
    assert result["certainty"] == Certainty.CONFIRMED
    assert any(effect["kind"] == "receive_accepted" for effect in result["effects"])
    assert len(server.get("stock/")) == 1
    repaired = child_repair(plan, snapshot, directory, server, "dk_receive")
    assert not complete(repaired)
    assert any(effect["kind"] == "receive_accepted" for effect in row(repaired, receipt)["result"]["effects"])
    assert len(server.get("stock/")) == 1
    po = server.get("order/po/")[0]
    assert calls(server, f"order/po/{po['pk']}/receive/") == 1
    assert server.get("order/po-line/")[0]["received"] == received


def test_review_aggregate_certainty_preserves_confirmed_and_unknown_effects():
    confirmed = Effect("receive_accepted", Certainty.CONFIRMED, "order.purchaseorderlineitem", 1)
    assert review("receipt_conflict", effects=(confirmed,)).certainty == Certainty.CONFIRMED
    assert review("receipt_conflict", effects=(confirmed,)).state == State.NEEDS_REVIEW
    unknown = Effect("exchange", Certainty.UNKNOWN)
    result = review("receipt_conflict", effects=(confirmed, unknown))
    assert result.certainty == Certainty.UNKNOWN and result.state == State.UNCERTAIN
    assert result.effects == (confirmed, unknown)


@pytest.mark.parametrize("status", [20, 30, 40])
def test_lost_receipt_reconciliation_requires_stable_totals_status_and_retains_unknown_on_drift(scene, tmp_path, status):
    server = scene[0]
    plan = prepare(scene, source(two=False))
    with server.connect() as connection:
        pk = connection.execute("SELECT max(pk)+1 FROM rows").fetchone()[0]
    route = f"order/po/{pk}/receive/"
    server.fail(route, "lost")
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert row(snapshot, operation(plan, "dk_receive"))["state"] == State.UNCERTAIN
    po = server.get("order/po/")[0]
    po["status"] = status
    server.update(po)
    if status == 20:
        # Change a satisfied total during the final no-write satisfaction check.
        get = server.get
        lookups = 0
        def changed(route, **kwargs):
            nonlocal lookups
            result = get(route, **kwargs)
            if current_action(plan) == "dk_receive" and route.startswith("stock/location/"):
                lookups += 1
                if lookups == 2:
                    line = get("order/po-line/")[0]
                    line["received"] = "3"
                    server.update(line)
            return result
        server.get = changed
        from tests.execution.test_digikey_workflow import repair
        result = repair(plan, snapshot, directory, server, operation(plan, "dk_receive"))
    else:
        result = child_repair(plan, snapshot, directory, server, "dk_receive")
    assert complete(result) == (status == 30)
    if status != 30:
        assert row(result, operation(plan, "dk_receive"))["state"] == State.UNCERTAIN
    assert calls(server, route) == 1
    assert len(server.get("stock/")) == 1
    assert row(result, operation(plan, "dk_receive"))["result"]["outputs"] == []
