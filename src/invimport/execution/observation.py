"""Synchronized safe events and immutable correlation for one invocation.

Delivery is serialized before returning to the producer, including start events.
A consumer is best effort; the retained snapshot, never rendering, owns events.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass, replace
from functools import wraps
from queue import SimpleQueue
from threading import RLock, Event as ThreadEvent
from time import monotonic
from typing import Callable, Iterator
from uuid import uuid4


@dataclass(frozen=True)
class Correlation:
    run: str
    operation: str = "invocation"
    attempt: str = ""
    source: str = ""
    group: str = ""


@dataclass(frozen=True)
class Event:
    sequence: int
    kind: str
    context: Correlation
    label: str
    request: str = ""
    status: int | None = None
    elapsed_seconds: float = 0
    outcome: str = ""
    redirects: int = 0
    schema_version: int = 1


class Observation:
    """Own sequence allocation, retained events and serialized observer delivery."""

    def __init__(self, observer: Callable[[Event], None] | None = None):
        self.run = uuid4().hex
        self.context = Correlation(self.run, attempt=uuid4().hex)
        self._observer = observer
        self._lock = RLock()
        self._events: list[Event] = []
        self._queue: SimpleQueue[Event] = SimpleQueue()
        self.cancelled = ThreadEvent()
        self.delivery_failures = 0

    def emit(self, kind: str, label: str, **fields) -> Event:
        with self._lock:
            event = Event(len(self._events) + 1, kind, current_context(self),
                          label, **fields)
            self._events.append(event)
            self._queue.put(event)
            while not self._queue.empty():
                pending = self._queue.get()
                if self._observer:
                    try:
                        self._observer(pending)
                    except Exception:
                        self.delivery_failures += 1
            return event

    def snapshot(self) -> tuple[Event, ...]:
        with self._lock:
            return tuple(self._events)

    def export(self) -> list[dict]:
        return [asdict(event) for event in self.snapshot()]


_active: ContextVar[tuple[Observation, Correlation] | None] = ContextVar(
    "import_observation", default=None)


def active() -> Observation | None:
    value = _active.get()
    return value[0] if value else None


def current_context(observation: Observation) -> Correlation:
    value = _active.get()
    return value[1] if value and value[0] is observation else observation.context


@contextmanager
def observing(observation: Observation) -> Iterator[None]:
    token = _active.set((observation, observation.context))
    try:
        yield
    finally:
        _active.reset(token)


@contextmanager
def operation(label: str, *, source: str | None = None, group: str | None = None) -> Iterator[None]:
    observation = active()
    if observation is None:
        yield
        return
    parent = current_context(observation)
    context = replace(parent, operation=uuid4().hex, attempt=uuid4().hex,
                      source=parent.source if source is None else source,
                      group=parent.group if group is None else group)
    token = _active.set((observation, context))
    started = monotonic()
    observation.emit("operation_started", label)
    try:
        yield
    except BaseException as exc:
        if isinstance(exc, (KeyboardInterrupt, InterruptedError)):
            observation.cancelled.set()
        observation.emit("operation_finished", label,
                         outcome="cancelled" if isinstance(exc, (KeyboardInterrupt, InterruptedError)) else "failed",
                         elapsed_seconds=monotonic() - started)
        raise
    else:
        observation.emit("operation_finished", label, outcome="completed",
                         elapsed_seconds=monotonic() - started)
    finally:
        _active.reset(token)


def correlated(function: Callable) -> Callable:
    """Capture explicitly at submission, restore immutable context in a worker."""
    captured = _active.get()

    @wraps(function)
    def run(*args, **kwargs):
        token = _active.set(captured)
        try:
            return function(*args, **kwargs)
        finally:
            _active.reset(token)
    return run


def worker(function: Callable, *, label: str, group: str) -> Callable:
    """Give a submitted task its own attempt while retaining its source."""
    @correlated
    @wraps(function)
    def run(*args, **kwargs):
        with operation(label, group=group):
            return function(*args, **kwargs)
    return run


_request_origin: ContextVar[str] = ContextVar("import_request_origin", default="")


def request_origin() -> str:
    """Most recent child request in this synchronous SDK call chain."""
    return _request_origin.get()


def mark_request(request: str) -> None:
    _request_origin.set(request)
