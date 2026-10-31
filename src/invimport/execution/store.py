"""One-owner SQLite run state. JSON snapshots are projections, never recovery input."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
import json
from pathlib import Path
import sqlite3
from typing import Callable, Iterator
from uuid import uuid4

from .models import (Certainty, Effect, ErrorCategory, OperationResult, Output,
                     Plan, Retry, SafeError, State, canonical, execution_eligible)
from .ownership import FileLock, JournalError, open_database
from .artifacts import initialize_run_directory


@dataclass(frozen=True)
class Attempt:
    id: str
    run_id: str
    operation: str
    number: int
    mutation: bool
    reconciliation: bool = False


def result_from_json(text: str) -> OperationResult:
    raw = json.loads(text)
    raw["state"] = State(raw["state"])
    raw["certainty"] = Certainty(raw["certainty"])
    raw["retry"] = Retry(raw["retry"])
    raw["outputs"] = tuple(Output(**o) for o in raw["outputs"])
    raw["effects"] = tuple(Effect(**e) for e in raw["effects"])
    if raw["error"]:
        raw["error"] = SafeError(**raw["error"])
    return OperationResult(**raw)


class RunStore:
    """Own the journal connection and lifetime OS lock; close releases both.

    A failed transaction poisons this owner. No further dispatch may use it.
    Unhandled remote success before a failed commit is intentionally unresolved.
    """
    def __init__(self, path: Path, *, plan: Plan, run_id: str, create: bool,
                 owner_check: Callable[[], None] | None = None):
        if path.is_symlink():
            raise JournalError("journal must not be a symlink")
        self.path = path.resolve()
        self.plan = plan
        self.run_id = run_id
        self.healthy = True
        self.owner_check = owner_check
        self.connection = None
        if create:
            initialize_run_directory(self.path.parent)
            if self.path.exists():
                raise JournalError("refusing to replace an existing journal")
        self.lock = FileLock(self.path.with_suffix(".lock"))
        self.lock.__enter__()
        try:
            self.connection = open_database(self.path, create=create)
            if create:
                self._initialize()
            self._validate()
            self.file_identity = self.path.stat().st_dev, self.path.stat().st_ino
        except BaseException:
            self.close()
            raise

    def __enter__(self) -> RunStore:
        return self

    def __exit__(self, *args) -> None:
        self.close()

    def close(self) -> None:
        if self.connection is not None:
            self.connection.close()
            self.connection = None
        self.lock.__exit__()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        self.check_health()
        try:
            with self.connection:
                yield self.connection
        except (sqlite3.Error, OSError) as exc:
            self.healthy = False
            raise JournalError("journal commit failed; new mutations stopped") from exc

    def check_health(self) -> None:
        if not self.healthy or self.connection is None or not self.path.is_file():
            self.healthy = False
            raise JournalError("journal unavailable; new mutations stopped")
        try:
            identity = self.path.stat().st_dev, self.path.stat().st_ino
            if identity != self.file_identity:
                self.healthy = False
                raise JournalError("journal replaced; mutations stopped")
            if self.owner_check is not None:
                self.owner_check()
            self.connection.execute("SELECT revision FROM run").fetchone()
        except (sqlite3.Error, OSError) as exc:
            self.healthy = False
            raise JournalError("journal unavailable; new mutations stopped") from exc

    def _initialize(self) -> None:
        # Schema bootstrap precedes check_health's run-table query.
        try:
            with self.connection:
                self.connection.executescript("""
                    BEGIN IMMEDIATE;
                CREATE TABLE run(id TEXT PRIMARY KEY, revision TEXT NOT NULL, plan TEXT NOT NULL);
                CREATE TABLE operations(id TEXT PRIMARY KEY, state TEXT NOT NULL,
                    result TEXT, attribution TEXT NOT NULL);
                CREATE TABLE attempts(id TEXT PRIMARY KEY, operation TEXT NOT NULL,
                    number INTEGER NOT NULL, mutation INTEGER NOT NULL,
                    reconciliation INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, started TEXT DEFAULT CURRENT_TIMESTAMP,
                    ended TEXT, UNIQUE(operation,number));
                CREATE TABLE requests(id TEXT PRIMARY KEY, attempt TEXT NOT NULL,
                    mutation INTEGER NOT NULL, label TEXT NOT NULL,
                    state TEXT NOT NULL, started TEXT DEFAULT CURRENT_TIMESTAMP, ended TEXT);
                CREATE TABLE events(sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL,
                    operation TEXT NOT NULL, attempt TEXT NOT NULL, safe_json TEXT NOT NULL);
                PRAGMA user_version=1;
                """)
                self.connection.execute("INSERT INTO run VALUES (?,?,?)", (self.run_id, self.plan.revision, self.plan.dumps()))
                self.connection.executemany("INSERT INTO operations VALUES (?,?,NULL,?)", [(op.id, State.PENDING, canonical(asdict(op.attribution))) for op in self.plan.operations])
        except sqlite3.Error as exc:
            raise JournalError("journal initialization failed") from exc

    def _validate(self) -> None:
        try:
            if self.connection.execute("PRAGMA user_version").fetchone()[0] != 1:
                raise JournalError("unsupported run schema; no automatic migration")
            rows = self.connection.execute("SELECT id,revision,plan FROM run").fetchall()
            if rows != [(self.run_id, self.plan.revision, self.plan.dumps())]:
                raise JournalError("run plan/input/target/revision drift")
            if {r[0] for r in self.connection.execute("SELECT id FROM operations")} != {op.id for op in self.plan.operations}:
                raise JournalError("journal operation set mismatch")
        except sqlite3.Error as exc:
            raise JournalError("run schema unavailable") from exc

    def _event(self, connection: sqlite3.Connection, kind: str, operation: str,
               attempt: str = "", **safe_fields) -> None:
        connection.execute("INSERT INTO events(kind,operation,attempt,safe_json) VALUES (?,?,?,?)", (kind, operation, attempt, canonical(safe_fields)))

    def states(self) -> dict[str, State]:
        self.check_health()
        return {key: State(state) for key, state in self.connection.execute("SELECT id,state FROM operations")}

    def results(self) -> dict[str, OperationResult]:
        self.check_health()
        return {key: result_from_json(raw) for key, raw in self.connection.execute("SELECT id,result FROM operations WHERE result IS NOT NULL")}

    def start(self, operation: str, *, mutation: bool, reconciliation: bool = False) -> Attempt:
        with self.transaction() as connection:
            row = connection.execute("SELECT state,result FROM operations WHERE id=?", (operation,)).fetchone()
            state = State(row[0])
            previous = result_from_json(row[1]) if row[1] is not None else None
            if reconciliation:
                eligible = (not mutation and previous is not None and previous.retry == Retry.RECONCILE
                            and state in {State.UNCERTAIN, State.NEEDS_REVIEW, State.FAILED, State.RETRY_WAIT, State.BLOCKED})
            else:
                eligible = execution_eligible(state, previous, mutation=mutation)
            if not eligible:
                raise ValueError("operation is not eligible for dispatch; reconciliation or review required")
            number = connection.execute("SELECT count(*)+1 FROM attempts WHERE operation=?", (operation,)).fetchone()[0]
            attempt = Attempt(uuid4().hex, self.run_id, operation, number, mutation, reconciliation)
            connection.execute("INSERT INTO attempts(id,operation,number,mutation,reconciliation,state) VALUES (?,?,?,?,?,?)", (attempt.id, operation, number, mutation, reconciliation, "intent"))
            connection.execute("UPDATE operations SET state=? WHERE id=?", (State.RUNNING, operation))
            self._event(connection, "attempt_intent", operation, attempt.id, mutation=mutation)
        return attempt

    def finish(self, attempt: Attempt, result: OperationResult) -> None:
        spec = next(op for op in self.plan.operations if op.id == attempt.operation)
        if any(o.name not in spec.provides for o in result.outputs):
            raise ValueError("handler returned an undeclared output")
        previous = self.results().get(attempt.operation)
        if previous is not None:
            old_outputs = {o.name: o for o in previous.outputs}
            for output in result.outputs:
                if output.name in old_outputs and old_outputs[output.name] != output:
                    raise ValueError("confirmed output identity cannot be rebound")
                old_outputs[output.name] = output
            result = replace(result, outputs=tuple(old_outputs.values()))
        with self.transaction() as connection:
            row = connection.execute("SELECT state FROM attempts WHERE id=?", (attempt.id,)).fetchone()
            if row != ("intent",):
                raise ValueError("attempt already settled or missing")
            connection.execute("UPDATE operations SET state=?,result=? WHERE id=?", (result.state, canonical(asdict(result)), attempt.operation))
            connection.execute("UPDATE attempts SET state=?,ended=CURRENT_TIMESTAMP WHERE id=?", (result.state, attempt.id))
            # Output identities, effect certainty, source attribution and state
            # share this commit. There is no separate best-effort output callback.
            self._event(connection, "operation_settled", attempt.operation, attempt.id,
                        result=asdict(result), attribution=asdict(spec.attribution))

    def block(self, operation: str) -> None:
        with self.transaction() as connection:
            connection.execute("UPDATE operations SET state=? WHERE id=? AND state IN ('pending','ready','retry_wait')", (State.BLOCKED, operation))
            self._event(connection, "dependency_blocked", operation)

    def request_intent(self, attempt: Attempt, *, mutation: bool, label: str) -> str:
        request = uuid4().hex
        with self.transaction() as connection:
            connection.execute("INSERT INTO requests(id,attempt,mutation,label,state) VALUES (?,?,?,?,?)", (request, attempt.id, mutation, label, "intent"))
            self._event(connection, "request_intent", attempt.operation, attempt.id, request=request, mutation=mutation, label=label)
        return request

    def request_finished(self, attempt: Attempt, request: str, *, outcome: str) -> None:
        with self.transaction() as connection:
            connection.execute("UPDATE requests SET state=?,ended=CURRENT_TIMESTAMP WHERE id=?", (outcome, request))
            self._event(connection, "request_settled", attempt.operation, attempt.id, request=request, outcome=outcome)

    def recover_interrupted(self) -> None:
        """Read intents may retry; write intents require reconciliation, even if
        a crash occurred just before dispatch. Do not guess across the gap.
        """
        rows = list(self.connection.execute("SELECT id,operation,mutation,reconciliation FROM attempts WHERE state='intent'"))
        for attempt_id, operation, mutation, reconciliation in rows:
            mutation = mutation or reconciliation
            result = OperationResult(State.UNCERTAIN if mutation else State.RETRY_WAIT,
                                     Certainty.UNKNOWN if mutation else Certainty.NONE,
                                     Retry.RECONCILE if mutation else Retry.READ,
                                     error=SafeError(ErrorCategory.UNCERTAIN_WRITE if mutation else ErrorCategory.TRANSPORT, "interrupted_attempt"))
            number = self.connection.execute("SELECT number FROM attempts WHERE id=?", (attempt_id,)).fetchone()[0]
            self.finish(Attempt(attempt_id, self.run_id, operation, number, bool(mutation), bool(reconciliation)), result)

    def authorize_retry(self, operation: str, *, reconciled: OperationResult | None = None) -> None:
        """Only safe reads requeue automatically; write recovery supplies evidence.

        Stage 4 reconciliation handlers own domain identity validation. A caller
        cannot reset unknown effects to pending with a force/retry flag.
        """
        result = self.results()[operation]
        if reconciled is not None:
            if result.retry != Retry.RECONCILE or reconciled.certainty == Certainty.UNKNOWN:
                raise ValueError("invalid reconciliation result")
            # A reconciliation is its own durable attempt, not a history rewrite.
            attempt = self.start(operation, mutation=False, reconciliation=True)
            self.finish(attempt, reconciled)
            return
        if result.retry != Retry.READ or result.certainty != Certainty.NONE:
            raise ValueError("operation needs reconciliation or review")
        with self.transaction() as connection:
            connection.execute("UPDATE operations SET state=?,result=NULL WHERE id=?", (State.READY, operation))
            self._event(connection, "read_retry_authorized", operation)

    def snapshot(self) -> dict:
        self.check_health()
        return _snapshot(self.connection, run_id=self.run_id, revision=self.plan.revision)

    def export(self, path: Path) -> None:
        """Atomic credential-free portable snapshot, outside active DB/WAL bytes."""
        if path.resolve() == self.path or path.name in {"registry.sqlite3", "run.sqlite3", ".invimport-run"}:
            raise ValueError("export cannot replace execution authority")
        temporary = path.with_name(path.name + ".tmp-" + uuid4().hex)
        try:
            temporary.write_text(canonical(self.snapshot()), encoding="utf-8")
            temporary.chmod(0o600)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def _snapshot(connection: sqlite3.Connection, *, run_id: str, revision: str) -> dict:
    return {"schema_version": 1, "run_id": run_id, "revision": revision,
            "sequence": connection.execute("SELECT coalesce(max(sequence),0) FROM events").fetchone()[0],
            "operations": [{"id": key, "state": state, "result": json.loads(result) if result else None,
                            "attribution": json.loads(source)} for key, state, result, source in connection.execute("SELECT id,state,result,attribution FROM operations ORDER BY rowid")],
            "artifacts": "artifacts/"}


def load_run_status(run_id: str) -> dict:
    """Read a committed snapshot through canonical discovery, including old runs.

    This neither acquires the writer lock nor connects to inventory. A SQLite
    read transaction presents one committed version while a writer is active.
    """
    from contextlib import closing
    from urllib.parse import quote
    from .ownership import Registry, state_root
    if not (state_root() / "execution" / "registry.sqlite3").is_file():
        raise JournalError("canonical registry missing")
    registry = Registry()
    try:
        path, revision = registry.locate(run_id)
    finally:
        registry.close()
    try:
        with closing(sqlite3.connect(f"file:{quote(path.as_posix())}?mode=ro", uri=True)) as connection:
            connection.execute("BEGIN")
            if connection.execute("PRAGMA user_version").fetchone() != (1,):
                raise JournalError("unsupported run schema")
            rows = connection.execute("SELECT id,revision,plan FROM run").fetchall()
            if len(rows) != 1 or rows[0][:2] != (run_id, revision):
                raise JournalError("registered run identity mismatch")
            plan = Plan.loads(rows[0][2])
            if plan.revision != revision:
                raise JournalError("stored plan revision mismatch")
            return _snapshot(connection, run_id=run_id, revision=revision)
    except (sqlite3.Error, ValueError) as exc:
        raise JournalError("run snapshot unavailable") from exc
