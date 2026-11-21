"""Mandatory dispatch seam, deliberately separate from best-effort observers."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Protocol


class DispatchGuard(Protocol):
    def check(self) -> None: ...
    def before(self, *, mutation: bool, label: str) -> str: ...
    def after(self, request: str, *, outcome: str) -> None: ...


_guard: ContextVar[DispatchGuard | None] = ContextVar("durable_dispatch_guard", default=None)


def active_guard() -> DispatchGuard | None:
    return _guard.get()


@contextmanager
def guarded(guard: DispatchGuard) -> Iterator[None]:
    token = _guard.set(guard)
    try:
        yield
    finally:
        _guard.reset(token)


_semantic_barcode_read: ContextVar[bool] = ContextVar("semantic_barcode_read", default=False)


@contextmanager
def barcode_lookup_request() -> Iterator[None]:
    """Declare the supported lookup POST a read, never all POSTs in an operation."""
    token = _semantic_barcode_read.set(True)
    try:
        yield
    finally:
        _semantic_barcode_read.reset(token)


def request_is_mutation(method: str, url: str) -> bool:
    from urllib.parse import urlsplit
    if _semantic_read.get() == (method.lower(), url):
        return False
    if method.lower() in {"get", "options"}:
        return False
    if (_semantic_barcode_read.get() and method.lower() == "post"
            and urlsplit(url).path.rstrip("/").endswith("/barcode")):
        return False
    return True


_semantic_read: ContextVar[tuple[str, str] | None] = ContextVar("semantic_read_request", default=None)


@contextmanager
def semantic_read_request(method: str, url: str) -> Iterator[None]:
    """Declare precisely one endpoint exchange a semantic read (e.g. search POST)."""
    token = _semantic_read.set((method.lower(), url))
    try:
        yield
    finally:
        _semantic_read.reset(token)
