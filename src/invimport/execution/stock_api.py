"""Guarded JSON/request adapter and the stock workflow's external API contract."""
from __future__ import annotations

from typing import Any, Callable, Protocol

from requests import HTTPError

from .executor import OperationContext
from .ownership import normalize_endpoint


class StockAPI(Protocol):
    """SDK-compatible external boundary. Any is confined to untrusted responses.

    Custom implementations must perform exactly one request per method. The
    project SDK is marked only by its factory and guards actual transport sends.
    """
    api_url: str

    def get(self, route: str, *, params: dict | None = None) -> Any: ...
    def post(self, route: str, payload: dict) -> Any: ...
    def patch(self, route: str, payload: dict) -> Any: ...
    def request(self, route: str, *, method: str, **kwargs) -> Any: ...
    def downloadFile(self, url: str, destination: str, **kwargs) -> Any: ...


class StockRequests:
    """Adapt a project guarded SDK or a single-request test/custom API boundary.

    Project SDK requests already journal each actual HTTP send, including pages.
    Other adapters must implement each method as exactly one external request.
    A domain before_mutation callback may perform guarded prerequisite reads;
    failure stops before the actual mutation intent/send, rather than becoming
    an ordinary best-effort observer. Existing callers need no callback.
    """
    def __init__(self, api: StockAPI, context: OperationContext, *,
                 before_mutation: Callable[[StockRequests], None] | None = None) -> None:
        self.api, self.context = api, context
        self.before_mutation = before_mutation
        self.api_url = api.api_url

    def _check(self) -> None:
        self.context.check()
        expected = normalize_endpoint(self.context.store.plan.target.endpoint)
        if normalize_endpoint(self.api.api_url) != expected:
            raise ValueError("API client target changed during stock execution")
        base = getattr(self.api, "base_url", self.api.api_url)
        if normalize_endpoint(base) != expected:
            raise ValueError("API client base target conflicts with stock execution")

    def _call(self, method: str, route: str, *args, **kwargs) -> Any:
        function = lambda: getattr(self.api, method)(route, *args, **kwargs)
        self._check()
        if self.before_mutation and method not in {"get", "options"} and route != "barcode/":
            self.before_mutation(self)
            self._check()
        if getattr(self.api, "_invimport_guarded", False):
            return function()
        request = self.context.before(mutation=method not in {"get", "options"} and route != "barcode/", label=method + "_inventory")
        try:
            result = function()
        except HTTPError:
            self.context.after(request, outcome="http_error")
            raise
        except BaseException:
            self.context.after(request, outcome="exchange_unknown")
            raise
        self.context.after(request, outcome="received")
        if method in {"get", "options"} or route == "barcode/":
            self.context.check()
        return result

    def get(self, route: str, *, params: dict | None = None) -> Any:
        return self._call("get", route, params=params or {})

    def post(self, route: str, payload: dict) -> Any:
        return self._call("post", route, payload)

    def request(self, route: str, *, method: str, **kwargs) -> Any:
        function = lambda: self.api.request(route, method=method, **kwargs)
        self._check()
        if self.before_mutation and method.upper() not in {"GET", "OPTIONS"}:
            self.before_mutation(self)
            self._check()
        if getattr(self.api, "_invimport_guarded", False):
            return function()
        request = self.context.before(mutation=method.upper() not in {"GET", "OPTIONS"}, label=method.lower() + "_inventory")
        try:
            result = function()
        except HTTPError:
            self.context.after(request, outcome="http_error")
            raise
        except BaseException:
            self.context.after(request, outcome="exchange_unknown")
            raise
        self.context.after(request, outcome="received")
        return result

    def patch(self, route: str, payload: dict) -> Any:
        return self._call("patch", route, payload)
