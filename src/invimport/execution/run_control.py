"""Local run discovery, portable inspection and explicit audit disposition."""
from __future__ import annotations

from contextlib import closing
import json
from pathlib import Path
import sqlite3
from urllib.parse import quote

from .models import Plan, State
from .ownership import FileLock, JournalError, Registry
from .store import _snapshot, load_run_status

class InvocationFailure(RuntimeError):
    """Safe command-boundary message retaining the original exception cause."""


SUCCESS = {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED}


def complete(snapshot: dict) -> bool:
    """Completion includes selected optional work and current local retention."""
    retention = snapshot.get("retention", {})
    return (all(row["state"] in SUCCESS for row in snapshot["operations"])
            and retention.get("complete", True))


def saved_run(run_id: str) -> tuple[Plan, Path]:
    """Locate and validate the canonical run without making any network request."""
    load_run_status(run_id)  # Validate schema, registry identity and retained bytes.
    registry = Registry()
    try:
        path, revision = registry.locate(run_id)
    finally:
        registry.close()
    try:
        with closing(sqlite3.connect(f"file:{quote(path.as_posix())}?mode=ro", uri=True)) as connection:
            plan = Plan.loads(connection.execute("SELECT plan FROM run WHERE id=?", (run_id,)).fetchone()[0])
        if plan.revision != revision:
            raise JournalError("registered revision mismatch")
        return plan, path
    except (sqlite3.Error, ValueError, TypeError) as exc:
        raise JournalError("run plan unavailable") from exc


def inspect_run(run_id: str) -> dict:
    """Versioned local projection; journal remains the execution authority."""
    plan, path = saved_run(run_id)
    snapshot = load_run_status(run_id)
    try:
        with closing(sqlite3.connect(f"file:{quote(path.as_posix())}?mode=ro", uri=True)) as connection:
            connection.execute("BEGIN")
            if connection.execute("SELECT id,revision FROM run").fetchall() != [(run_id, plan.revision)]:
                raise JournalError("run changed during inspection")
            snapshot = _snapshot(connection, run_id=run_id, revision=plan.revision)
            from .artifacts import retention_snapshot
            snapshot["retention"] = retention_snapshot(path.parent, snapshot)
            attempts = [dict(zip(("id", "operation", "number", "mutation", "reconciliation", "state"), row, strict=True))
                        for row in connection.execute("SELECT id,operation,number,mutation,reconciliation,state FROM attempts ORDER BY rowid")]
            requests = [dict(zip(("id", "attempt", "mutation", "label", "state"), row, strict=True))
                        for row in connection.execute("SELECT id,attempt,mutation,label,state FROM requests ORDER BY rowid")]
        registry = Registry()
        try:
            disposition = registry.connection.execute("SELECT state FROM runs WHERE run_id=?", (run_id,)).fetchone()[0]
        finally:
            registry.close()
        return {"format": "invimport-run-status/1", **snapshot, "disposition": disposition,
                "target": plan.target.endpoint, "attempts": attempts, "requests": requests,
                "complete": complete(snapshot)}
    except sqlite3.Error as exc:
        raise JournalError("run inspection unavailable") from exc


def abandon_run(run_id: str, *, reason: str) -> dict:
    """Record operator disposition, preserving unresolved claims and all effects."""
    if not reason.strip():
        raise ValueError("nonempty abandonment reason required")
    _, path = saved_run(run_id)
    registry = Registry()
    try:
        # Serialize with execution's journal lock. Tombstone continues to block
        # fresh imports and legacy writes; reason is never proof of no effects.
        with FileLock(path.with_suffix(".lock")):
            registry.abandon(run_id, evidence=json.dumps({"disposition": "blocking_tombstone", "reason": reason}))
    finally:
        registry.close()
    return inspect_run(run_id)


def preview(plan: Plan) -> dict:
    """Safe hierarchy without source bytes, notes, payloads or credentials."""
    return {"format": "invimport-run-preview/1", "revision": plan.revision,
            "target": plan.target.endpoint, "import_id": plan.import_id,
            "operations": [{"id": op.id, "kind": op.kind, "group": op.group,
                            "action": op.desired.values().get("action"),
                            "lines": list(op.attribution.lines),
                            "requires": [ref.operation for ref in op.requires],
                            "settled_after": list(op.settled_after)} for op in plan.operations]}


def record_continuity(run_id: str, plan: Plan, *, reason: str) -> None:
    """Retain the explicit reviewed acknowledgement without treating it as identity."""
    registry = Registry()
    try:
        with FileLock(registry.directory / "registry.lock"), registry.connection:
            registry.connection.execute("INSERT INTO audit(action,run_id,evidence) VALUES ('continuity',?,?)",
                                        (run_id, json.dumps({"revision": plan.revision, "endpoint": plan.target.endpoint, "reason": reason})))
    finally:
        registry.close()
