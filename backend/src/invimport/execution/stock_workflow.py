"""Opt-in stock preparation, execution, selected repair and report adapters."""
from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path
from threading import Event
from typing import Mapping

from ..config import CategoryConfig, ParameterConfig
from ..inventree.stockimport import ImportOptions, StockImportResult
from ..stockfile import StockFile

from .executor import (
    ContinuityReview,
    execute_plan,
    execute_serial,
    resume_run,
    validate_continuity,
    validate_target_observation,
)
from .models import OperationSpec, Plan, State, Target, canonical
from .domain_repair import repair_selected_operations
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
            "outputs": result["outputs"] if result else [], "blocked_by": missing,
            "effects": result["effects"] if result else [],
            "certainty": result["certainty"] if result else "none",
            "retry": result["retry"] if result else "never",
            "settled_after": list(spec.settled_after),
            "scope": {key: value for key, value in spec.desired.values().items() if key in {"role", "target", "target_alternatives", "fallback_condition", "inapplicable_lines", "inapplicable_reasons"}}}


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
    return {"format": "invimport-execution-report/1", "run_id": snapshot["run_id"],
            "revision": plan.revision, "lines": lines,
            "prepared_artifacts": snapshot.get("prepared_artifacts", []),
            "artifact_transfers": snapshot.get("artifact_transfers", []),
            "artifact_targets": snapshot.get("artifact_targets", []),
            "retention": snapshot.get("retention", {"checked": False})}


def _report(plan: Plan, snapshot: dict, directory: Path) -> dict:
    from .artifacts import retention_snapshot
    snapshot = snapshot | {"retention": retention_snapshot(directory, snapshot)}
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
    if any(op.desired.values().get("action") == "order_line" and "creation_policy" not in op.desired.values() for op in plan.operations):
        raise ValueError("older prepared PO contribution requires reprepare before starting a new run")
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
                repair_selected_operations(store, StockHandlers(api), operation_id,
                                            cancelled=cancelled or Event())
                snapshot = execute_serial(store, StockHandlers(api).mapping, cancelled=cancelled)
                from .stock_finalization import refresh_finalization
                snapshot = refresh_finalization(store, StockHandlers(api), cancelled=cancelled)
                if all(row["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} for row in snapshot["operations"]):
                    registry.complete(run_id)
        return _report(plan, snapshot, path.parent)
    except BaseException:
        _best_effort_report(plan, path.parent)
        raise
    finally:
        registry.close()


def prepare_full_stock(document: StockFile, *, categories: Mapping[str, CategoryConfig],
                       parameters: Mapping[str, ParameterConfig], target: Target, api: StockAPI,
                       options: ImportOptions | None = None, generated_paths: tuple[Path, ...] = ()) -> Plan:
    """Opt-in full library preparation. All callbacks run before approval.

    Uses the same planner and handlers as the representative compatibility slice.
    Execution is a separate explicit boundary; ``options.write`` never dispatches
    writes while preparing. The ordinary CLI retains its legacy default.
    """
    from .stock_finalization import with_finalization
    from .stock_preparation import prepare_stock
    options = options or ImportOptions()
    plan = prepare_stock(document, categories=categories, parameters=parameters, target=target, api=api, options=options)
    return with_finalization(plan, document, archive=options.archive, provenance=options.provenance,
                             generated_paths=generated_paths)


def project_stock_result(plan: Plan, snapshot: dict, *, run_directory: Path | None = None) -> StockImportResult:
    """Adapt detailed state to the established result and --plan input contract."""
    from .stock_result import project_stock_result as project
    return project(plan, snapshot, run_directory=run_directory)
