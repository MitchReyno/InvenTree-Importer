"""Opt-in DigiKey durable execution using the shared journal and scheduler."""
from __future__ import annotations

from pathlib import Path
from threading import Event

from ..inventree.purchase_orders import as_date

from .digikey_handlers import DigiKeyHandlers
from .digikey_preparation import number
from .executor import ContinuityReview, execute_plan, execute_serial, resume_run, validate_continuity, validate_target_observation
from .models import Plan, State, Target
from .ownership import Registry, normalize_endpoint
from .stock_api import StockAPI
from .domain_repair import repair_selected_operations
from .store import RunStore, load_run_status


def _bind(plan: Plan, api: StockAPI, current_target: Target) -> None:
    validate_target_observation(plan, current_target)
    if normalize_endpoint(api.api_url) != normalize_endpoint(current_target.endpoint):
        raise ValueError("actual API endpoint conflicts with DigiKey target")
    if plan.decisions.values().get("domain") != "digikey_v1" or plan.unsupported:
        raise ValueError("not a supported DigiKey preview")
    if any(op.desired.values().get("action") == "dk_line" and "creation_policy" not in op.desired.values() for op in plan.operations):
        raise ValueError("DigiKey contribution policy is missing; reprepare before a new run")
    decisions = plan.decisions.values()
    for spec in plan.operations:
        desired = spec.desired.values()
        if desired.get("action") == "dk_line":
            source = decisions["sources"][spec.attribution.lines[0]]["source"]
            quantity = number(source.get("quantity_ordered") or source.get("quantity_shipped") or 0)
            price = number(source["unit_price"]) if source.get("unit_price") is not None else None
            if quantity != desired["quantity"] or price != desired["purchase_price"]:
                raise ValueError("frozen DigiKey amounts differ from exact supported source; reviewed reprepare required")
    selected = [(order, sales) for order in decisions["source"] for sales in order.get("sales_orders", [])]
    if len(selected) != 1:
        raise ValueError("DigiKey source scope is not one complete sales order")
    order, sales = selected[0]
    original_date = order.get("date_entered") or sales.get("date_entered")
    if original_date:
        expected = as_date(original_date)
        desired = next(op.desired.values() for op in plan.operations if op.desired.values().get("action") == "dk_order")
        if expected is None or desired["payload"].get("creation_date") != expected or not desired.get("date_policy"):
            raise ValueError("frozen DigiKey historical date requires reviewed reprepare; no active plan migration")
    if any(op.reconciliation not in {"stock_v1", "digikey_v1"} for op in plan.operations):
        raise ValueError("unsupported DigiKey operation contract")


def execute_digikey(plan: Plan, *, api: StockAPI, current_target: Target, run_directory: Path,
                    cancelled: Event | None = None) -> dict:
    _bind(plan, api, current_target)
    return execute_plan(plan, DigiKeyHandlers(api).mapping, current_target=current_target,
                        run_directory=run_directory, cancelled=cancelled)


def resume_digikey(plan: Plan, run_id: str, path: Path, *, api: StockAPI, current_target: Target,
                   continuity: ContinuityReview | None = None, cancelled: Event | None = None) -> dict:
    _bind(plan, api, current_target)
    snapshot = load_run_status(run_id)
    if all(row["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} for row in snapshot["operations"]):
        return snapshot
    return resume_run(plan, run_id, path, DigiKeyHandlers(api).mapping, current_target=current_target,
                      continuity=continuity, cancelled=cancelled)


def repair_digikey(plan: Plan, run_id: str, path: Path, operation_id: str, *, api: StockAPI,
                   current_target: Target, continuity: ContinuityReview | None = None,
                   cancelled: Event | None = None) -> dict:
    _bind(plan, api, current_target)
    registry = Registry()
    try:
        with registry.writer(plan.target, plan.import_id, run_id=run_id, revision=plan.revision, location=path, resume=True):
            with RunStore(path, plan=plan, run_id=run_id, create=False) as store:
                validate_continuity(plan, current_target, review=continuity)
                registry.activate(run_id, location=path, revision=plan.revision)
                store.owner_check = lambda: registry.check_ownership(run_id, location=path, revision=plan.revision)
                store.recover_interrupted()
                handlers = DigiKeyHandlers(api)
                repair_selected_operations(store, handlers, operation_id, cancelled=cancelled or Event())
                snapshot = execute_serial(store, handlers.mapping, cancelled=cancelled)
                if all(row["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} for row in snapshot["operations"]):
                    registry.complete(run_id)
                return snapshot
    finally:
        registry.close()
