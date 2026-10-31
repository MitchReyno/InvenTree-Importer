"""Serial scheduler for explicit handlers. No stock-domain mutations are registered."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Event, get_ident
from typing import Callable, Mapping, TypeVar
from uuid import uuid4

from requests import RequestException

from .dispatch import guarded
from .models import (Certainty, ErrorCategory, Kind, OperationResult, OperationSpec,
                     Output, Plan, Retry, SafeError, State, Target, validate_plan)
from .observation import active, durable_correlation
from .ownership import JournalError, Registry, normalize_endpoint
from .store import Attempt, RunStore


T = TypeVar("T")


class ClassifiedFailure(Exception):
    """A handler's explicitly safe failure; original SDK args never persist."""
    def __init__(self, error: SafeError, *, retry: Retry = Retry.NEVER):
        super().__init__(error.code)
        self.error = error
        self.retry = retry


@dataclass(frozen=True)
class ContinuityReview:
    revision: str
    endpoint: str
    evidence_digest: str


def validate_continuity(plan: Plan, current: Target, *, review: ContinuityReview | None) -> None:
    if normalize_endpoint(plan.target.endpoint) != normalize_endpoint(current.endpoint):
        raise ValueError("target endpoint drift requires a reviewed plan revision")
    if plan.target.instance_id and plan.target.identity_evidence:
        if (current.instance_id != plan.target.instance_id or not current.identity_evidence):
            raise ValueError("verified target instance continuity failed")
        return
    if (review is None or review.revision != plan.revision
            or normalize_endpoint(review.endpoint) != normalize_endpoint(current.endpoint)
            or not review.evidence_digest):
        raise ValueError("saved PK reuse requires reviewed target continuity evidence")


class OperationContext:
    """Own one attempt's child dispatch guard, cancellation and usable inputs.

    Handlers use dispatch for fake/non-SDK boundaries. The observed SDK transport
    invokes the same mandatory guard for every actual child send. Stage 4 must
    revalidate each saved model/record identity before consuming its PK.
    """
    def __init__(self, store: RunStore, attempt: Attempt, *, cancelled: Event,
                 inputs: Mapping[tuple[str, str], Output]):
        self.store = store
        self.attempt = attempt
        self.cancelled = cancelled
        self.inputs = dict(inputs)
        self.writes_started = 0
        self.unknown_write = False
        self._requests: dict[str, bool] = {}
        self.owner_thread = get_ident()

    def check(self) -> None:
        if get_ident() != self.owner_thread:
            raise JournalError("serial executor dispatch must stay on its owner thread")
        self.store.check_health()
        observation = active()
        if self.cancelled.is_set() or (observation is not None and observation.cancelled.is_set()):
            raise InterruptedError("execution cancelled before child dispatch")

    def before(self, *, mutation: bool, label: str) -> str:
        self.check()
        if mutation and not self.attempt.mutation:
            raise ValueError("read operation cannot dispatch a mutation")
        SafeError(ErrorCategory.VALIDATION, label)  # labels are controlled identifiers
        request = self.store.request_intent(self.attempt, mutation=mutation, label=label)
        self.check()
        self._requests[request] = mutation
        if mutation:
            self.writes_started += 1
        return request

    def after(self, request: str, *, outcome: str) -> None:
        if self._requests[request] and outcome == "exchange_unknown":
            self.unknown_write = True
        self.store.request_finished(self.attempt, request, outcome=outcome)

    def dispatch(self, function: Callable[[], T], *, mutation: bool, label: str) -> T:
        request = self.before(mutation=mutation, label=label)
        try:
            result = function()
        except BaseException:
            self.after(request, outcome="exchange_unknown")
            raise
        self.after(request, outcome="received")
        return result


Handler = Callable[[OperationSpec, OperationContext], OperationResult]


def _failed(exc: BaseException, context: OperationContext) -> OperationResult:
    if context.writes_started or context.attempt.reconciliation:
        return OperationResult(State.UNCERTAIN, Certainty.UNKNOWN, Retry.RECONCILE,
                               error=SafeError(ErrorCategory.UNCERTAIN_WRITE, "write_requires_reconciliation"))
    if isinstance(exc, ClassifiedFailure):
        return OperationResult(State.FAILED, retry=exc.retry, error=exc.error)
    if isinstance(exc, (RequestException, TimeoutError, ConnectionError)):
        return OperationResult(State.FAILED, retry=Retry.READ if not context.attempt.mutation else Retry.REVIEW,
                               error=SafeError(ErrorCategory.TRANSPORT, "request_failed"))
    return OperationResult(State.RETRY_WAIT if isinstance(exc, InterruptedError) else State.FAILED,
                           retry=Retry.READ if not context.attempt.mutation else Retry.REVIEW,
                           error=SafeError(ErrorCategory.TRANSPORT if isinstance(exc, InterruptedError) else ErrorCategory.PROGRAMMER,
                                           "cancelled" if isinstance(exc, InterruptedError) else "handler_failed"))


def _invoke(spec: OperationSpec, store: RunStore, handlers: Mapping[Kind, Handler], *,
            cancelled: Event, outputs: Mapping[tuple[str, str], Output]) -> None:
    attempt = store.start(spec.id, mutation=spec.mutation)
    context = OperationContext(store, attempt, cancelled=cancelled, inputs=outputs)
    with durable_correlation(run=store.run_id, operation=spec.id, attempt=attempt.id,
                             source=spec.attribution.source, group=spec.group), guarded(context):
        try:
            result = handlers[spec.kind](spec, context)
        except JournalError:
            raise  # no failed-result write can make a broken journal healthy
        except BaseException as exc:
            store.finish(attempt, _failed(exc, context))
            if not isinstance(exc, (ClassifiedFailure, InterruptedError, RequestException, TimeoutError, ConnectionError)):
                raise  # programming errors and Ctrl-C stop new work
            return
        if context.unknown_write and result.certainty != Certainty.UNKNOWN:
            raise ValueError("handler swallowed an uncertain write without reconciliation")
        store.finish(attempt, result)


def execute_serial(store: RunStore, handlers: Mapping[Kind, Handler], *,
                   cancelled: Event | None = None) -> dict:
    """Run ready operations once, retaining deterministic plan order.

    A failed parent can expose confirmed outputs; only the named output gates
    consumers. Blocked work is reconsidered whenever repaired outputs appear.
    This is not an automatic retry or reconciliation policy.
    """
    validate_plan(store.plan)
    if store.plan.unsupported or any(op.kind not in handlers for op in store.plan.operations):
        raise ValueError("plan contains unsupported work; no dispatch performed")
    cancelled = cancelled or Event()
    attempted: set[str] = set()
    while True:
        states, results = store.states(), store.results()
        outputs = {(operation, output.name): output for operation, result in results.items() for output in result.outputs}
        eligible = [op for op in store.plan.operations if op.id not in attempted and states[op.id] in {State.PENDING, State.READY, State.BLOCKED, State.RETRY_WAIT}]
        ready = next((op for op in eligible if all((r.operation, r.name) in outputs for r in op.requires)), None)
        if ready is None or cancelled.is_set():
            for op in eligible:
                if any((r.operation, r.name) not in outputs for r in op.requires):
                    store.block(op.id)
            return store.snapshot()
        _invoke(ready, store, handlers, cancelled=cancelled, outputs=outputs)
        attempted.add(ready.id)


def execute_plan(plan: Plan, handlers: Mapping[Kind, Handler], *,
                 run_directory: Path | None = None, cancelled: Event | None = None) -> dict:
    """Library foundation only; handlers must be explicitly supplied and reviewed."""
    validate_plan(plan)
    if plan.unsupported:
        raise ValueError("preparation has unsupported domain work")
    registry = Registry()
    run_id = uuid4().hex
    directory = run_directory or registry.directory / "runs" / run_id
    path = directory / "run.sqlite3"
    try:
        if directory.exists() and any(directory.iterdir()):
            raise ValueError("new run directory must be empty")
        with registry.writer(plan.target, plan.import_id, run_id=run_id,
                             revision=plan.revision, location=path):
            with RunStore(path, plan=plan, run_id=run_id, create=True) as store:
                registry.activate(run_id, location=path, revision=plan.revision)
                store.owner_check = lambda: registry.check_ownership(run_id, location=path, revision=plan.revision)
                snapshot = execute_serial(store, handlers, cancelled=cancelled)
                if all(row["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} for row in snapshot["operations"]):
                    registry.complete(run_id)
                return snapshot
    finally:
        registry.close()


def resume_run(plan: Plan, run_id: str, path: Path, handlers: Mapping[Kind, Handler], *,
               current_target: Target, continuity: ContinuityReview | None = None,
               cancelled: Event | None = None) -> dict:
    registry = Registry()
    try:
        with registry.writer(plan.target, plan.import_id, run_id=run_id, revision=plan.revision,
                             location=path, resume=True):
            with RunStore(path, plan=plan, run_id=run_id, create=False) as store:
                if plan.decisions.values().get("choices") or any(result.outputs for result in store.results().values()):
                    validate_continuity(plan, current_target, review=continuity)
                elif normalize_endpoint(current_target.endpoint) != normalize_endpoint(plan.target.endpoint):
                    raise ValueError("target drift")
                registry.activate(run_id, location=path, revision=plan.revision)
                store.owner_check = lambda: registry.check_ownership(run_id, location=path, revision=plan.revision)
                store.recover_interrupted()
                snapshot = execute_serial(store, handlers, cancelled=cancelled)
                if all(row["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} for row in snapshot["operations"]):
                    registry.complete(run_id)
                return snapshot
    finally:
        registry.close()


def retry_operation(plan: Plan, run_id: str, path: Path, operation_id: str,
                    reconcile: Handler, *, current_target: Target,
                    continuity: ContinuityReview | None = None,
                    cancelled: Event | None = None) -> dict:
    """Perform a read-only reconciliation attempt; never repeat an unknown write.

    Domain handlers supply identity-validated results. Cancelling a reconciliation
    read preserves the earlier unknown effect and prevents later child mutations.
    Completion/continuation is explicit through resume_run after reconciliation.
    """
    registry = Registry()
    try:
        with registry.writer(plan.target, plan.import_id, run_id=run_id, revision=plan.revision,
                             location=path, resume=True):
            with RunStore(path, plan=plan, run_id=run_id, create=False) as store:
                validate_continuity(plan, current_target, review=continuity)
                registry.activate(run_id, location=path, revision=plan.revision)
                store.owner_check = lambda: registry.check_ownership(run_id, location=path, revision=plan.revision)
                store.recover_interrupted()
                previous = store.results()[operation_id]
                if previous.retry != Retry.RECONCILE:
                    raise ValueError("operation is not eligible for reconciliation")
                spec = next(op for op in plan.operations if op.id == operation_id)
                attempt = store.start(operation_id, mutation=False, reconciliation=True)
                outputs = {(key, output.name): output for key, result in store.results().items() for output in result.outputs}
                context = OperationContext(store, attempt, cancelled=cancelled or Event(), inputs=outputs)
                with durable_correlation(run=run_id, operation=operation_id, attempt=attempt.id,
                                         source=spec.attribution.source, group=spec.group), guarded(context):
                    try:
                        context.check()
                        result = reconcile(spec, context)
                        context.check()
                    except JournalError:
                        raise
                    except BaseException as exc:
                        store.finish(attempt, _failed(exc, context))
                        if not isinstance(exc, (ClassifiedFailure, InterruptedError, RequestException, TimeoutError, ConnectionError)):
                            raise
                    else:
                        store.finish(attempt, result)
                return store.snapshot()
    finally:
        registry.close()
