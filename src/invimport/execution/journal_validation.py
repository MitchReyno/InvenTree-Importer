"""Validate schema-1 journal relationships before projecting or recovering work."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import sqlite3
from typing import Mapping

from .models import (Certainty, Effect, OperationResult, OperationSpec, Output, Plan,
                     Retry, SafeError, State, canonical)
from .ownership import JournalError


def result_from_json(text: str) -> OperationResult:
    try:
        raw = json.loads(text)
        raw["state"] = State(raw["state"])
        raw["certainty"] = Certainty(raw["certainty"])
        raw["retry"] = Retry(raw["retry"])
        raw["outputs"] = tuple(Output(**o) for o in raw["outputs"])
        raw["effects"] = tuple(Effect(**e) for e in raw["effects"])
        if raw["error"]:
            raw["error"] = SafeError(**raw["error"])
        return OperationResult(**raw)
    except (ValueError, KeyError, TypeError) as exc:
        raise JournalError("invalid persisted operation result; recovery required") from exc


@dataclass(frozen=True)
class _AttemptRecord:
    id: str
    operation: str
    number: int
    mutation: int
    reconciliation: int
    state: str


def _attempts(connection: sqlite3.Connection, specs: Mapping[str, OperationSpec]) -> dict[str, _AttemptRecord]:
    attempts = {}
    numbers: dict[str, list[int]] = {}
    for row in connection.execute("SELECT id,operation,number,mutation,reconciliation,state FROM attempts ORDER BY rowid"):
        attempt = _AttemptRecord(*row)
        if (not isinstance(attempt.id, str) or not attempt.id or attempt.id in attempts
                or attempt.operation not in specs or type(attempt.number) is not int or attempt.number < 1
                or attempt.mutation not in {0, 1} or attempt.reconciliation not in {0, 1}
                or (not attempt.reconciliation and bool(attempt.mutation) != specs[attempt.operation].mutation)):
            raise JournalError("invalid journal attempt binding")
        if attempt.state != "intent":
            State(attempt.state)
        attempts[attempt.id] = attempt
        numbers.setdefault(attempt.operation, []).append(attempt.number)
    if any(sorted(values) != list(range(1, len(values) + 1)) for values in numbers.values()):
        raise JournalError("journal attempt sequence mismatch")
    return attempts


def _events(connection: sqlite3.Connection, specs: Mapping[str, OperationSpec],
            attempts: Mapping[str, _AttemptRecord]) -> tuple[dict[str, OperationResult], dict[str, tuple], dict[str, str], dict[str, str]]:
    latest_results = {}
    projection_kinds: dict[str, str] = {}
    output_history: dict[tuple[str, str], Output] = {}
    starts: set[str] = set()
    settlements: set[str] = set()
    requests: dict[str, tuple] = {}
    request_outcomes: dict[str, str] = {}
    for kind, operation, attempt_id, serialized in connection.execute(
            "SELECT kind,operation,attempt,safe_json FROM events ORDER BY sequence"):
        fields = json.loads(serialized)
        if not isinstance(fields, dict) or operation not in specs:
            raise JournalError("invalid journal event binding")
        if kind in {"operation_settled", "output_checkpoint", "dependency_blocked", "read_retry_authorized",
                    "attempt_intent", "stock_repair_authorized", "finalization_revision_authorized"}:
            projection_kinds[operation] = kind
        attempt = attempts.get(attempt_id) if attempt_id else None
        if attempt_id and (attempt is None or attempt.operation != operation):
            raise JournalError("journal event/attempt identity mismatch")
        if kind in {"attempt_intent", "stock_repair_authorized", "finalization_revision_authorized"}:
            if attempt is None or attempt_id in starts:
                raise JournalError("journal attempt intent mismatch")
            if kind == "attempt_intent" and fields["mutation"] != bool(attempt.mutation):
                raise JournalError("journal attempt permissions mismatch")
            if kind != "attempt_intent" and not (attempt.mutation and attempt.reconciliation):
                raise JournalError("journal repair permissions mismatch")
            starts.add(attempt_id)
        if kind in {"operation_settled", "output_checkpoint"}:
            if attempt is None or attempt_id not in starts:
                raise JournalError("journal output has no owning attempt")
            result = result_from_json(canonical(fields["result"]))
            if fields["attribution"] != json.loads(canonical(asdict(specs[operation].attribution))):
                raise JournalError("journal result attribution mismatch")
            if any(output.name not in specs[operation].provides for output in result.outputs):
                raise JournalError("undeclared persisted output")
            for output in result.outputs:
                key = operation, output.name
                if key in output_history and output_history[key] != output:
                    raise JournalError("persisted output identity rebound")
                output_history[key] = output
            latest_results[operation] = result
            if kind == "operation_settled":
                if attempt_id in settlements or attempt.state != result.state:
                    raise JournalError("journal attempt settlement mismatch")
                settlements.add(attempt_id)
        if kind == "request_intent":
            request = fields["request"]
            if attempt is None or attempt_id not in starts or request in requests:
                raise JournalError("journal request intent mismatch")
            requests[request] = (attempt_id, int(fields["mutation"]), fields["label"])
        if kind == "request_settled":
            request = fields["request"]
            if request not in requests or requests[request][0] != attempt_id:
                raise JournalError("journal request settlement mismatch")
            request_outcomes[request] = fields["outcome"]
    if starts != set(attempts) or any((attempt.state == "intent") == (key in settlements)
                                    for key, attempt in attempts.items()):
        raise JournalError("journal attempt history incomplete")
    return latest_results, requests, request_outcomes, projection_kinds


def _requests(connection: sqlite3.Connection, attempts: Mapping[str, _AttemptRecord],
              intents: Mapping[str, tuple], outcomes: Mapping[str, str]) -> None:
    seen = set()
    for request, attempt_id, mutation, label, state in connection.execute(
            "SELECT id,attempt,mutation,label,state FROM requests"):
        attempt = attempts.get(attempt_id)
        if (request in seen or attempt is None or mutation not in {0, 1}
                or (mutation and not attempt.mutation)
                or intents.get(request) != (attempt_id, mutation, label)
                or state != outcomes.get(request, "intent")):
            raise JournalError("journal request/attempt binding mismatch")
        seen.add(request)
    if seen != set(intents):
        raise JournalError("journal request history incomplete")


def validate_journal(connection: sqlite3.Connection, *, plan: Plan, run_id: str) -> None:
    """Check committed projections against their attempt/checkpoint/event history.

    A RUNNING row may retain an earlier settled result or a new output checkpoint.
    It must have exactly one latest open attempt. Settled rows cannot be promoted
    independently of their result/history, especially when effects are UNKNOWN.
    """
    try:
        if connection.execute("PRAGMA user_version").fetchone() != (1,):
            raise JournalError("unsupported run schema; no automatic migration")
        if connection.execute("SELECT id,revision,plan FROM run").fetchall() != [(run_id, plan.revision, plan.dumps())]:
            raise JournalError("run plan/input/target/revision drift")
        specs = {op.id: op for op in plan.operations}
        rows = connection.execute("SELECT id,state,result,attribution FROM operations").fetchall()
        if len(rows) != len(specs) or {row[0] for row in rows} != set(specs):
            raise JournalError("journal operation set mismatch")
        attempts = _attempts(connection, specs)
        latest_results, requests, outcomes, projection_kinds = _events(connection, specs, attempts)
        _requests(connection, attempts, requests, outcomes)
        for key, serialized_state, serialized_result, attribution in rows:
            state = State(serialized_state)
            result = result_from_json(serialized_result) if serialized_result is not None else None
            if result != latest_results.get(key):
                raise JournalError("journal result/checkpoint history mismatch")
            if json.loads(attribution) != json.loads(canonical(asdict(specs[key].attribution))):
                raise JournalError("journal source attribution mismatch")
            owned = sorted((attempt for attempt in attempts.values() if attempt.operation == key), key=lambda item: item.number)
            opened = [attempt for attempt in owned if attempt.state == "intent"]
            if state == State.RUNNING:
                if len(opened) != 1 or opened[0] != owned[-1]:
                    raise JournalError("running operation has no unique latest attempt")
                continue
            if opened:
                raise JournalError("settled operation retains an open attempt")
            if result is None:
                if owned or state not in {State.PENDING, State.READY, State.BLOCKED}:
                    raise JournalError("settled operation result missing")
                continue
            if not owned or owned[-1].state != result.state:
                raise JournalError("journal result/attempt state mismatch")
            transition = projection_kinds.get(key)
            safe_read_queue = (not specs[key].mutation and result.certainty == Certainty.NONE
                               and result.retry == Retry.READ and state in {State.READY, State.BLOCKED}
                               and transition in {"read_retry_authorized", "dependency_blocked"})
            blocked_retry_wait = (state == State.BLOCKED and result.state == State.RETRY_WAIT
                                  and transition == "dependency_blocked")
            if state != result.state and not (safe_read_queue or blocked_retry_wait):
                raise JournalError("journal operation/result state mismatch")
    except (sqlite3.Error, ValueError, KeyError, TypeError) as exc:
        raise JournalError("invalid journal relationships; recovery required") from exc
