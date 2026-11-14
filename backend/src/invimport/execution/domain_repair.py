"""Selected domain repair preserving approved IDs, history and usable outputs."""
from __future__ import annotations

from threading import Event
from typing import Mapping, Protocol

from requests import RequestException

from .dispatch import guarded
from .executor import Handler, OperationContext, _dependency_settled, _failed, _invoke
from .models import Kind, OperationResult, OperationSpec, State
from .observation import durable_correlation, operation
from .ownership import JournalError
from .store import RunStore

SETTLED_SUCCESS = {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED}


class DomainHandlers(Protocol):
    @property
    def mapping(self) -> Mapping[Kind, Handler]: ...

    def repair(self, spec: OperationSpec, context: OperationContext) -> OperationResult: ...


def repair_selected_operations(store: RunStore, handlers: DomainHandlers, operation_id: str, *,
                                cancelled: Event) -> None:
    """Recover usable prerequisites, never turn settlement into blanket retry."""
    plan = store.plan
    specs = {op.id: op for op in plan.operations}
    if operation_id not in specs:
        raise ValueError("unknown operation ID")
    attempted: set[str] = set()

    def repair_selected(selected: str) -> None:
        if selected in attempted:
            return
        attempted.add(selected)
        spec = specs[selected]
        # Only required usable outputs need recovery. Settlement
        # barriers authorize finalization after failed inventory;
        # selecting evidence must not retry every failed branch.
        for reference in spec.requires:
            previous = store.results().get(reference.operation)
            if previous is None or not any(output.name == reference.name for output in previous.outputs):
                repair_selected(reference.operation)
        results = store.results()
        outputs = {(key, output.name): output for key, result in results.items() for output in result.outputs}
        if any((ref.operation, ref.name) not in outputs for ref in spec.requires):
            return  # Honest blocked result; no speculative dispatch.
        states = store.states()
        for parent in spec.settled_after:
            if not _dependency_settled(plan, parent, states, outputs):
                repair_selected(parent)
        states, results = store.states(), store.results()
        outputs = {(key, output.name): output for key, result in results.items() for output in result.outputs}
        if not all(_dependency_settled(plan, parent, states, outputs) for parent in spec.settled_after):
            return
        state = states[selected]
        if state in SETTLED_SUCCESS:
            return
        if state in {State.PENDING, State.READY, State.BLOCKED}:
            _invoke(spec, store, handlers.mapping, cancelled=cancelled or Event(), outputs=outputs)
            return
        attempt = store.start_stock_repair(selected)
        context = OperationContext(store, attempt, cancelled=cancelled or Event(), inputs=outputs)
        with durable_correlation(run=store.run_id, operation=selected, attempt=attempt.id,
                                 source=spec.attribution.source, group=spec.group), guarded(context), operation("domain repair"):
            try:
                context.check()
                result = handlers.repair(spec, context)
                context.check()
            except JournalError:
                raise
            except BaseException as exc:
                store.finish(attempt, _failed(exc, context))
                if not isinstance(exc, (RequestException, ConnectionError, TimeoutError, InterruptedError)):
                    raise
            else:
                store.finish(attempt, result)

    repair_selected(operation_id)
