"""Narrow HTTP adapters; labels deliberately exclude URLs, bodies and headers."""
from __future__ import annotations

import logging
import re
from time import monotonic
from uuid import uuid4
from urllib.parse import urlsplit

import requests

from .observation import Observation, active, mark_request
from .dispatch import active_guard, request_is_mutation


class QuietSDKLog:
    """SDK logs include credentials even at INFO; replace at the bound boundary."""

    def __getattr__(self, name: str):
        return lambda *args, **kwargs: None


class ObservedRequests:
    """Requests-compatible facade owned by one client, without global patches."""

    def __init__(self, observation: Observation | None, *, service: str,
                 transport=requests):
        self.observation = observation
        self.service = service
        self.transport = transport

    def __getattr__(self, name: str):
        if name == "exceptions":
            return requests.exceptions
        if name not in {"get", "post", "patch", "put", "delete", "options"}:
            return getattr(self.transport, name)

        def dispatch(url, **kwargs):
            observation = self.observation or active()
            guard = active_guard()
            if guard is not None:
                request = guard.before(mutation=request_is_mutation(name, url),
                                       label=f"{name}_inventory")
                try:
                    # Retain the existing observer/cancellation boundary without
                    # recursively invoking this mandatory guard.
                    response = self._observed_dispatch(name, url, kwargs, observation, request=request)
                except BaseException:
                    guard.after(request, outcome="exchange_unknown")
                    raise
                guard.after(request, outcome="http_received")
                if not request_is_mutation(name, url):
                    guard.check()
                return response
            return self._observed_dispatch(name, url, kwargs, observation)
        return dispatch

    def _observed_dispatch(self, name, url, kwargs, observation, *, request=None):
        if observation is None:
            return getattr(self.transport, name)(url, **kwargs)
        label = f"{name.upper()} {self.service}{safe_target(url, self.service)}"
        request = request or uuid4().hex
        if observation.cancelled.is_set():
            observation.emit("request_cancelled", label, request=request,
                             outcome="not_dispatched")
            raise InterruptedError("import cancelled before request dispatch")
        started = monotonic()
        mark_request(request)
        observation.emit("request_started", label, request=request)
        guard = active_guard()
        if guard is not None:
            guard.check()
        if observation.cancelled.is_set():
            observation.emit("request_finished", label, request=request,
                             outcome="not_dispatched")
            raise InterruptedError("import cancelled before request dispatch")
        try:
            response = getattr(self.transport, name)(url, **kwargs)
        except BaseException:
            observation.emit("request_finished", label, request=request,
                             elapsed_seconds=monotonic() - started,
                             outcome="exchange_unknown")
            raise
        observation.emit(
            "request_finished", label, request=request,
            status=response.status_code if response is not None else None,
            elapsed_seconds=monotonic() - started,
            outcome=("no_response" if response is None else
                     "http_error" if response.status_code >= 300 else "http_received"),
            redirects=len(getattr(response, "history", ())))
        if name in {"get", "options"} and observation.cancelled.is_set():
            raise InterruptedError("import cancelled after read")
        return response


def external_get(url: str, *, transport=requests, **kwargs):
    return ObservedRequests(active(), service="external download",
                            transport=transport).get(url, **kwargs)


class SafeImportLog(logging.Filter):
    """Suppress free-form diagnostic bodies while observing an import.

    Existing legacy helpers interpolate exception args and signed URLs. Until
    migrated to structured safe fields they are not a safe diagnostic channel.
    Events carry method, service, status and outcomes instead. Context is copied
    into worker tasks so the same rule applies there.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return active() is None


def protect_import_logs() -> None:
    # Logger filters do not inherit; attach to each existing package logger.
    for name in ("inventree", "urllib3.connectionpool", "urllib3.util.retry", "requests"):
        logging.getLogger(name)
    for name, logger in logging.Logger.manager.loggerDict.copy().items():
        if isinstance(logger, logging.Logger) and name.startswith(
                ("invimport", "inventree", "urllib3", "requests")):
            if not any(isinstance(item, SafeImportLog) for item in logger.filters):
                logger.addFilter(SafeImportLog())


def safe_failure(exc: Exception) -> str:
    """Retain the established safe plan-read diagnostic, never arbitrary args."""
    if len(exc.args) == 1 and isinstance(exc.args[0], str):
        message = exc.args[0]
        if re.fullmatch(r"plan: (?:could not read|no response from) "
                        r"(?:stock/|part/[0-9]+/?)", message):
            return message
    return f"import stopped ({type(exc).__name__}); see correlated request outcomes"


def safe_target(url: str, service: str) -> str:
    """Expose only known SDK route nouns and numeric identities, never queries."""
    if service != "inventory":
        return ""
    nouns = {"api", "part", "parameter", "template", "stock", "location",
             "company", "manufacturer", "supplier", "attachment", "image",
             "order", "po", "po-line", "barcode", "user", "me", "token",
             "units", "category", "metadata", "tags"}
    segments = urlsplit(url).path.strip("/").split("/")
    if all(segment in nouns or segment.isdecimal() for segment in segments):
        return " /" + "/".join(segments) + "/"
    return " [other target]"


def exception_reason(exc: Exception) -> str:
    """Keep legacy library diagnostics, but never export exception args in a run."""
    return f"operation failed ({type(exc).__name__})" if active() is not None else str(exc)
