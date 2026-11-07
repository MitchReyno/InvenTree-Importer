"""Independent Stage7 findings: scope, Company, exact values and historical dates."""
from __future__ import annotations

from decimal import Decimal
import json
import subprocess
import sys

import pytest

from invimport.execution.digikey_preparation import number
from invimport.execution.digikey_workflow import execute_digikey
from invimport.execution.models import State
from invimport.execution.run_control import complete
from invimport.execution.stock_preparation import PreparationReview
from tests.execution.test_digikey_workflow import (
    TARGET, calls, cli_process, operation, prepare, row, scene as scene, source,
)


def mutate_supplier(server, supplier, change):
    company = server.get(f"company/{supplier}/")
    if change == "delete":
        with server.connect() as connection:
            connection.execute("DELETE FROM rows WHERE pk=?", (supplier,))
    else:
        company[change] = "Changed supplier" if change == "name" else False
        server.update(company)


def child_repair(plan, snapshot, directory, server, action):
    path = directory.parent / "approved.json"
    path.write_text(plan.dumps())
    script = '''from pathlib import Path
import sys, json
from invimport.execution.models import Plan
from invimport.execution.digikey_workflow import resume_digikey, repair_digikey
from tests.execution.digikey_server import DigiKeyServer
plan = Plan.loads(Path(sys.argv[1]).read_text())
server = DigiKeyServer(Path(sys.argv[2]))
path = Path(sys.argv[3]) / "run.sqlite3"
result = resume_digikey(plan, sys.argv[4], path, api=server, current_target=plan.target)
spec = next(op for op in plan.operations if op.desired.values()["action"] == sys.argv[5])
result = repair_digikey(plan, sys.argv[4], path, spec.id, api=server, current_target=plan.target)
print(json.dumps(result))
'''
    child = subprocess.run([sys.executable, "-c", script, str(path), str(server.path), str(directory), snapshot["run_id"], action],
                           capture_output=True, text=True)
    assert child.returncode == 0, child.stderr
    return json.loads(child.stdout)


@pytest.mark.parametrize("change", ["name", "is_supplier", "delete"])
@pytest.mark.parametrize("after", ["order", "issue"])
def test_supplier_drift_stops_dependent_effects_and_fresh_process_repair(scene, tmp_path, change, after):
    server, supplier, _, _ = scene
    plan = prepare(scene, source(two=False))
    post = server.post
    def changed(route, payload):
        result = post(route, payload)
        if route == "order/po/" and after == "order" or route.endswith("/issue/") and after == "issue":
            mutate_supplier(server, supplier, change)
        return result
    server.post = changed
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert not complete(snapshot)
    assert not server.get("stock/")
    assert len(server.get("order/po-line/")) == (0 if after == "order" else 1)
    selected = "dk_line" if after == "order" else "dk_receive"
    output_before = row(snapshot, operation(plan, "dk_order"))["result"]["outputs"]
    repaired = child_repair(plan, snapshot, directory, server, selected)
    assert not complete(repaired)
    assert not server.get("stock/")
    assert row(repaired, operation(plan, "dk_order"))["result"]["outputs"] == output_before
    assert row(repaired, operation(plan, selected))["result"]["error"]["code"] == "digikey_supplier_drift"


@pytest.mark.parametrize("after", ["prepare", "line", "issue"])
@pytest.mark.parametrize("correlated", [False, True])
def test_manual_or_duplicate_contribution_cannot_expand_order_wide_effects(scene, tmp_path, after, correlated):
    server = scene[0]
    orders = source(two=False)
    if after == "prepare":
        execute_digikey(prepare(scene, orders, receive=False), api=server, current_target=TARGET, run_directory=tmp_path / "book")
    plan = prepare(scene, orders)
    post = server.post
    def insert():
        line = server.get("order/po-line/")[0]
        server.seed("order/po-line/", {**line, "quantity": "900", "purchase_price": "99", "received": "0",
                                       "reference": line["reference"] if correlated else "manual-unapproved"})
    if after == "prepare":
        insert()
    else:
        def changed(route, payload):
            result = post(route, payload)
            if route == "order/po-line/" and after == "line" or route.endswith("/issue/") and after == "issue":
                insert()
            return result
        server.post = changed
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert not complete(snapshot)
    order = server.get("order/po/")[0]
    assert calls(server, f"order/po/{order['pk']}/issue/") == (1 if after == "issue" else 0)
    assert calls(server, f"order/po/{order['pk']}/receive/") == 0
    assert len(server.get("order/po-line/")) == 2
    assert not server.get("stock/")
    if after == "issue":
        repaired = child_repair(plan, snapshot, directory, server, "dk_receive")
        assert not complete(repaired)
        assert calls(server, f"order/po/{order['pk']}/receive/") == 0


def test_extra_line_after_unknown_receipt_keeps_unknown_history_in_fresh_repair(scene, tmp_path):
    server = scene[0]
    plan = prepare(scene, source(two=False))
    with server.connect() as connection:
        pk = connection.execute("SELECT max(pk)+1 FROM rows").fetchone()[0]
    route = f"order/po/{pk}/receive/"
    server.fail(route, "lost")
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    line = server.get("order/po-line/")[0]
    server.seed("order/po-line/", {**line, "reference": "manual", "received": "0"})
    repaired = child_repair(plan, snapshot, directory, server, "dk_receive")
    assert row(repaired, operation(plan, "dk_receive"))["state"] == State.UNCERTAIN
    assert calls(server, route) == 1
    assert len(server.get("stock/")) == 1


@pytest.mark.parametrize("value,expected", [("0", "0"), ("0.000000", "0"), ("0.100000", "0.1"),
    ("9999999999999.999999", "9999999999999.999999"), (Decimal("0.000001"), "0.000001"), ("1e3", "1000")])
def test_supported_amounts_are_exact_without_context_rounding(value, expected):
    assert number(value) == expected


@pytest.mark.parametrize("value", ["0.10000000000000001", Decimal("0.12345678901234567890123456789012345"),
    "10000000000000", "0.0000001", "1e1000000000", "-1", "NaN", "Infinity", True])
def test_unsupported_amounts_require_review_instead_of_rounding(value):
    with pytest.raises(PreparationReview):
        number(value)


@pytest.mark.parametrize("literal", ["0.10000000000000001", "0.12345678901234567890123456789012345", "10000000000000", "NaN"])
def test_public_cli_rejects_nonrepresentable_literal_before_mutation(scene, tmp_path, literal):
    server = scene[0]
    text = json.dumps(source(two=False)).replace('"0.123456"', literal)
    original = tmp_path / "orders.json"
    original.write_text(text)
    output = tmp_path / "approved.json"
    result = cli_process(["prepare-digikey", str(original), "--supplier", str(scene[1]), "--location", str(scene[2]),
                          "--output", str(output), "--json"], server, tmp_path)
    assert result.returncode == 1, result.stderr
    assert not output.exists()
    assert not server.get("order/po/")


def test_zero_price_and_fractional_receipt_remain_exact(scene, tmp_path):
    server = scene[0]
    orders = source(two=False)
    line = orders[0]["sales_orders"][0]["line_items"][0]
    line.update(unit_price="0", quantity_ordered="9999999999999.999999")
    booked = prepare(scene, orders, receive=False)
    execute_digikey(booked, api=server, current_target=TARGET, run_directory=tmp_path / "book")
    remote = server.get("order/po-line/")[0]
    remote["received"] = "0.000001"
    server.update(remote)
    plan = prepare(scene, orders, receive_remaining=True)
    result = execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "receive")
    assert complete(result)
    assert server.get("stock/")[0]["quantity"] == "9999999999999.999998"
    assert server.get("order/po-line/")[0]["purchase_price"] == "0"


@pytest.mark.parametrize("order_date,sales_date,expected", [(None, "2024-05-06T12:30:00", "2024-05-06"),
    ("2023-01-02T09:00:00", "2024-05-06T12:30:00", "2023-01-02"), ("", "2024-05-06", "2024-05-06")])
def test_source_date_uses_shared_precedence_and_is_frozen_and_received(scene, tmp_path, order_date, sales_date, expected):
    orders = source(two=False)
    orders[0]["date_entered"] = order_date
    orders[0]["sales_orders"][0]["date_entered"] = sales_date
    plan = prepare(scene, orders)
    assert operation(plan, "dk_order").desired.values()["payload"]["creation_date"] == expected
    assert operation(plan, "dk_order").desired.values()["date_policy"]["type"] == "date"
    result = execute_digikey(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / "run")
    assert complete(result)
    assert scene[0].get("order/po/")[0]["creation_date"] == expected


@pytest.mark.parametrize("date", ["not-a-date", "2024-02-30", "2024-99-01"])
def test_invalid_historical_date_requires_preparation_review(scene, date):
    orders = source(two=False)
    orders[0]["sales_orders"][0]["date_entered"] = date
    with pytest.raises(PreparationReview, match="date"):
        prepare(scene, orders)
    assert not scene[0].get("order/po/")


@pytest.mark.parametrize("capability", [None, {"type": "date", "read_only": True}, {"type": "string"}])
def test_supplied_date_requires_writable_capability_but_absent_date_is_omitted(scene, tmp_path, capability):
    from types import SimpleNamespace
    server = scene[0]
    request = server.request
    def unsupported(route, **kwargs):
        response = request(route, **kwargs)
        metadata = response.json()
        if route == "order/po/":
            if capability is None:
                metadata["actions"]["POST"].pop("creation_date")
            else:
                metadata["actions"]["POST"]["creation_date"] = capability
        return SimpleNamespace(json=lambda: metadata)
    server.request = unsupported
    orders = source(two=False)
    orders[0]["sales_orders"][0]["date_entered"] = "2024-05-06"
    with pytest.raises(PreparationReview, match="creation_date"):
        prepare(scene, orders)
    absent = prepare(scene, source(two=False))
    assert "creation_date" not in operation(absent, "dk_order").desired.values()["payload"]
    assert complete(execute_digikey(absent, api=server, current_target=TARGET, run_directory=tmp_path / "absent"))


def test_date_override_and_later_drift_block_consumers_and_recovery(scene, tmp_path):
    server = scene[0]
    orders = source(two=False)
    orders[0]["sales_orders"][0]["date_entered"] = "2024-05-06T12:30:00"
    plan = prepare(scene, orders)
    post = server.post
    def override(route, payload):
        result = post(route, payload)
        if route == "order/po/":
            result["creation_date"] = "2025-01-01"
            server.update(result)
        return result
    server.post = override
    directory = tmp_path / "run"
    result = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert not complete(result)
    assert row(result, operation(plan, "dk_order"))["result"]["outputs"]
    assert not server.get("order/po-line/")
    assert not complete(child_repair(plan, result, directory, server, "dk_order"))
    assert len(server.get("order/po/")) == 1


def test_company_precondition_is_rechecked_immediately_before_shared_model_create(scene, tmp_path):
    from invimport.config import CategoryConfig, ParameterConfig
    from invimport.execution.dispatch import active_guard
    from invimport.inventree.stockimport import ImportOptions
    server, supplier, _, _ = scene
    server.seed("part/category/", {"name": "Components", "pathstring": "Components"})
    server.seed("parameter/template/", {"name": "Value"})
    categories = {"Components": CategoryConfig("Components", ["Components"], identity="mpn", ipn_prefix="IC",
                                               parameters=["Value"], aliases=["Components"])}
    products = {"NEW-SKU": {"manufacturer_part": "NEW-MPN", "manufacturer_name": "Maker", "category_path": ["Components"],
                            "parameters": {"Value": "10"}, "description": "New model"}}
    orders = source(two=False)
    orders[0]["sales_orders"][0]["line_items"][0]["digikey_part"] = "NEW-SKU"
    plan = prepare(scene, orders, create_parts=True, products=products, categories=categories,
                   parameters={"Value": ParameterConfig("Value")}, options=ImportOptions(create_manufacturers=True))
    get = server.get
    changed = False
    def drift_after_lookup(route, **kwargs):
        nonlocal changed
        result = get(route, **kwargs)
        guard = active_guard()
        if not changed and route == "part/" and guard:
            current = next(op for op in plan.operations if op.id == guard.attempt.operation)
            if current.desired.values()["action"] == "part":
                changed = True
                company = get(f"company/{supplier}/")
                company["is_supplier"] = False
                server.update(company)
        return result
    server.get = drift_after_lookup
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert changed and not complete(snapshot)
    assert len(server.get("part/")) == 1  # Only the originally seeded unrelated Part.
    assert not server.get("company/part/", params={"SKU": "NEW-SKU"})
    maker = next(op for op in plan.operations if op.desired.values().get("payload", {}).get("name") == "Maker")
    assert row(snapshot, maker)["result"]["outputs"]  # Earlier confirmed work retained.
    assert not complete(child_repair(plan, snapshot, directory, server, "part"))
    assert len(server.get("part/")) == 1


def test_exact_library_price_outside_supported_range_stops_preparation(scene):
    orders = source(two=False)
    orders[0]["sales_orders"][0]["line_items"][0]["unit_price"] = Decimal("0.12345678901234567890123456789012345")
    with pytest.raises(PreparationReview):
        prepare(scene, orders)
    assert not scene[0].get("order/po/")


def test_source_date_drift_after_issue_blocks_fresh_process_receipt(scene, tmp_path):
    server = scene[0]
    orders = source(two=False)
    orders[0]["sales_orders"][0]["date_entered"] = "2024-05-06T12:30:00"
    plan = prepare(scene, orders)
    post = server.post
    def changed(route, payload):
        result = post(route, payload)
        if route.endswith("/issue/"):
            order = server.get("order/po/")[0]
            order["creation_date"] = "2025-01-01"
            server.update(order)
        return result
    server.post = changed
    directory = tmp_path / "run"
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=directory)
    assert not complete(snapshot)
    order = server.get("order/po/")[0]
    assert calls(server, f"order/po/{order['pk']}/issue/") == 1
    assert calls(server, f"order/po/{order['pk']}/receive/") == 0
    assert not complete(child_repair(plan, snapshot, directory, server, "dk_receive"))
    assert not server.get("stock/")


def test_historical_date_capability_change_blocks_create_and_old_omission_is_not_migrated(scene, tmp_path):
    from dataclasses import replace
    from types import SimpleNamespace
    from invimport.execution.models import Inputs, Plan
    server = scene[0]
    orders = source(two=False)
    orders[0]["date_entered"] = "2024-05-06"
    plan = prepare(scene, orders)
    old = replace(plan, operations=tuple(replace(spec, desired=Inputs.freeze({**spec.desired.values(), "date_policy": None,
                  "payload": {key: value for key, value in spec.desired.values()["payload"].items() if key != "creation_date"}}))
                  if spec.desired.values()["action"] == "dk_order" else spec for spec in plan.operations))
    assert Plan.loads(old.dumps()).dumps() == old.dumps()
    with pytest.raises(ValueError, match="date"):
        execute_digikey(old, api=server, current_target=TARGET, run_directory=tmp_path / "old")
    request = server.request
    def readonly(route, **kwargs):
        metadata = request(route, **kwargs).json()
        if route == "order/po/":
            metadata["actions"]["POST"]["creation_date"]["read_only"] = True
        return SimpleNamespace(json=lambda: metadata)
    server.request = readonly
    snapshot = execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "changed")
    assert not complete(snapshot)
    assert not server.get("order/po/")


def test_low_embedding_decimal_precision_cannot_round_receipt_payload(scene, tmp_path):
    from decimal import localcontext
    server = scene[0]
    orders = source(two=False)
    orders[0]["sales_orders"][0]["line_items"][0].update(unit_price="0", quantity_ordered="9999999999999.999999")
    execute_digikey(prepare(scene, orders, receive=False), api=server, current_target=TARGET, run_directory=tmp_path / "book")
    line = server.get("order/po-line/")[0]
    line["received"] = "0.000001"
    server.update(line)
    plan = prepare(scene, orders, receive_remaining=True)
    post = server.post
    posted = []
    def independent_server_context(route, payload):
        if route.endswith("/receive/"):
            posted.append(payload["items"][0]["quantity"])
        # The remote server has its own context rather than the embedding client's.
        with localcontext() as remote:
            remote.prec = 64
            return post(route, payload)
    server.post = independent_server_context
    with localcontext() as embedding:
        embedding.prec = 5
        assert number("9999999999999.999999") == "9999999999999.999999"
        result = execute_digikey(plan, api=server, current_target=TARGET, run_directory=tmp_path / "receipt")
    assert complete(result)
    assert posted == ["9999999999999.999998"]
