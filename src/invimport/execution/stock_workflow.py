"""Supported library entry points for the bounded durable stock slice."""
from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path
from threading import Event

from requests import RequestException

from .dispatch import guarded
from .executor import (
    ContinuityReview,
    OperationContext,
    _failed,
    execute_plan,
    execute_serial,
    resume_run,
    validate_continuity,
    validate_target_observation,
)
from .models import OperationSpec, Plan, State, Target, canonical
from .observation import durable_correlation
from .ownership import JournalError, Registry, normalize_endpoint
from .stock_api import StockAPI
from .stock_handlers import StockHandlers
from .store import RunStore, load_run_status


def _bind(plan: Plan, api: StockAPI, current: Target) -> None:
    validate_target_observation(plan, current)
    if normalize_endpoint(api.api_url) != normalize_endpoint(current.endpoint):
        raise ValueError("actual API client target conflicts with current target")
    if plan.unsupported or any(op.reconciliation != "stock_v1" for op in plan.operations):
        raise ValueError("not a supported stock-domain preview")


SETTLED_SUCCESS = {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED}


def _operation_report(spec: OperationSpec, row: dict, rows: dict[str, dict]) -> dict:
    missing = []
    for reference in spec.requires:
        parent = rows[reference.operation]["result"]
        if parent is None or not any(output["name"] == reference.name for output in parent["outputs"]):
            missing.append(reference.operation + ":" + reference.name)
    result = row["result"]
    return {"id": spec.id, "state": row["state"],
            "error": result["error"] if result else None,
            "outputs": result["outputs"] if result else [], "blocked_by": missing}


def _line_report(line: str, source: dict, operations: list[OperationSpec], rows: dict[str, dict]) -> dict:
    projected = [_operation_report(spec, rows[spec.id], rows) for spec in operations]
    barcode = next((spec for spec in operations if spec.desired.values().get("action") == "barcode"), None)
    registered = barcode is not None and rows[barcode.id]["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED}
    return {"line": line, "stock_key": source["stock_key"], "registered": registered,
            "complete": all(operation["state"] in SETTLED_SUCCESS for operation in projected),
            "operations": projected}


def partial_report(plan: Plan, snapshot: dict) -> dict:
    """Project settled failures as well as successes; registration needs barcode."""
    rows = {row["id"]: row for row in snapshot["operations"]}
    sources = plan.decisions.values()["sources"]
    by_line = {line: [] for line in sources}
    for spec in plan.operations:
        for line in spec.attribution.lines:
            by_line[line].append(spec)
    lines = [_line_report(line, source, by_line[line], rows) for line, source in sources.items()]
    return {"run_id": snapshot["run_id"], "revision": plan.revision, "lines": lines}


def _report(plan: Plan, snapshot: dict, directory: Path) -> dict:
    report = partial_report(plan, snapshot)
    temporary = directory / "partial-report.json.tmp"
    temporary.write_text(canonical(report), encoding="utf-8")
    temporary.replace(directory / "partial-report.json")
    return snapshot | {"report": report}


def _best_effort_report(plan: Plan, directory: Path) -> None:
    try:
        path = directory / "run.sqlite3"
        if not path.is_file():
            return
        with closing(sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)) as connection:
            run_id = connection.execute("SELECT id FROM run").fetchone()[0]
        snapshot = load_run_status(run_id)
        if snapshot["revision"] == plan.revision:
            _report(plan, snapshot, directory)
    except (OSError, sqlite3.Error, JournalError, ValueError):
        pass  # Reporting cannot repair a damaged journal or mask the first failure.


def execute_stock(plan: Plan, *, api: StockAPI, current_target: Target, run_directory: Path,
                  cancelled: Event | None = None) -> dict:
    """Execute only a reviewed frozen preview, acquiring canonical ownership."""
    _bind(plan, api, current_target)
    try:
        snapshot = execute_plan(plan, StockHandlers(api).mapping, current_target=current_target,
                                run_directory=run_directory, cancelled=cancelled)
    except BaseException:
        _best_effort_report(plan, run_directory)
        raise
    return _report(plan, snapshot, run_directory)


def resume_stock(plan: Plan, run_id: str, path: Path, *, api: StockAPI, current_target: Target,
                 continuity: ContinuityReview | None = None, cancelled: Event | None = None) -> dict:
    _bind(plan, api, current_target)
    settled = load_run_status(run_id)
    if settled["revision"] != plan.revision:
        raise ValueError("saved stock plan revision drift")
    if all(row["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} for row in settled["operations"]):
        return _report(plan, settled, path.parent)
    try:
        snapshot = resume_run(plan, run_id, path, StockHandlers(api).mapping, current_target=current_target,
                              continuity=continuity, cancelled=cancelled)
    except BaseException:
        _best_effort_report(plan, path.parent)
        raise
    return _report(plan, snapshot, path.parent)


def repair_stock(plan: Plan, run_id: str, path: Path, operation_id: str, *, api: StockAPI,
                 current_target: Target, continuity: ContinuityReview | None = None,
                 cancelled: Event | None = None) -> dict:
    """Read current identity/state and conditionally repair under the same op ID.

    Unknown uncorrelated creates remain unresolved. This is explicit selected
    work, never an automatic replay or a reset to READY. Events retain prior
    certainty, attempts and the evidence authorizing every conditional mutation.
    """
    _bind(plan, api, current_target)
    registry = Registry()
    try:
        with registry.writer(plan.target, plan.import_id, run_id=run_id, revision=plan.revision,
                             location=path, resume=True):
            with RunStore(path, plan=plan, run_id=run_id, create=False) as store:
                validate_continuity(plan, current_target, review=continuity)
                registry.activate(run_id, location=path, revision=plan.revision)
                store.owner_check = lambda: registry.check_ownership(run_id, location=path, revision=plan.revision)
                store.recover_interrupted()
                spec = next(op for op in plan.operations if op.id == operation_id)
                results = store.results()
                outputs = {(key, output.name): output for key, result in results.items() for output in result.outputs}
                if any((reference.operation, reference.name) not in outputs for reference in spec.requires):
                    raise ValueError("repair dependencies have no usable output")
                attempt = store.start_stock_repair(operation_id)
                context = OperationContext(store, attempt, cancelled=cancelled or Event(), inputs=outputs)
                with durable_correlation(run=run_id, operation=operation_id, attempt=attempt.id,
                                         source=spec.attribution.source, group=spec.group), guarded(context):
                    try:
                        context.check()
                        result = StockHandlers(api).repair(spec, context)
                        context.check()
                    except JournalError:
                        raise
                    except (RequestException, ConnectionError, TimeoutError, InterruptedError) as exc:
                        store.finish(attempt, _failed(exc, context))
                    else:
                        store.finish(attempt, result)
                snapshot = execute_serial(store, StockHandlers(api).mapping, cancelled=cancelled)
                if all(row["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} for row in snapshot["operations"]):
                    registry.complete(run_id)
        return _report(plan, snapshot, path.parent)
    except BaseException:
        _best_effort_report(plan, path.parent)
        raise
    finally:
        registry.close()
