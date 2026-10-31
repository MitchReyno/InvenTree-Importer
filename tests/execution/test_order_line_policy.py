from __future__ import annotations

from dataclasses import replace

import pytest

from invimport.execution.models import Inputs, Plan
from invimport.execution.stock_workflow import execute_stock
from invimport.execution.stock_preparation import prepare_stock
from tests.execution.digikey_server import DigiKeyServer
from tests.execution.test_stock_workflow import TARGET, document, scene as scene


def test_old_plan_is_readable_but_new_execution_cannot_silently_add_controls(scene, tmp_path):
    server, categories, parameters = scene
    current = prepare_stock(document(tmp_path), api=server, target=TARGET, categories=categories, parameters=parameters)
    old = replace(current, operations=tuple(replace(op, desired=Inputs.freeze({key: value for key, value in op.desired.values().items() if key != "creation_policy"}))
                                          if op.desired.values()["action"] == "order_line" else op for op in current.operations))
    assert Plan.loads(old.dumps()).dumps() == old.dumps()
    with pytest.raises(ValueError, match="reprepare"):
        execute_stock(old, api=server, current_target=TARGET, run_directory=tmp_path / "run")
    assert not server.get("stock/")
    assert not server.get("order/po/")


def test_stock_contributions_share_explicit_no_merge_and_source_price_controls(scene, tmp_path):
    persisted, categories, parameters = scene
    server = DigiKeyServer(persisted.path)
    plan = prepare_stock(document(tmp_path, identical=True), api=server, target=TARGET, categories=categories, parameters=parameters)
    execute_stock(plan, api=server, current_target=TARGET, run_directory=tmp_path / "run")
    lines = server.get("order/po-line/")
    assert len(lines) == 2
    assert all(line["merge_items"] is False and line["auto_pricing"] is False for line in lines)
