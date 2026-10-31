"""Bind pinned SDK HTTP globals per client before its constructor connects.

SDK 0.13.5 has no injectable transport. Copying function *globals* keeps its
actual methods (and upstream behavior) while substituting only requests/logger.
No SDK module, requests module, class or other instance is mutated. Copies and
facade have client lifetime. Re-audit on changing the SDK compatibility pin.
"""
from __future__ import annotations

from functools import wraps
from types import FunctionType, MethodType

from inventree.api import InvenTreeAPI

from ..execution.observation import Observation, active
from ..execution.transport import ObservedRequests, QuietSDKLog, protect_import_logs


def _decoded(function, observation: Observation | None):
    @wraps(function)
    def call(*args, **kwargs):
        observer = observation or active()
        try:
            result = function(*args, **kwargs)
        except BaseException:
            if observer:
                observer.emit("decode_finished", "SDK response", outcome="unavailable")
            raise
        if observer:
            observer.emit("decode_finished", "SDK response",
                             outcome="decoded" if result is not None else "no_decoded_result")
        return result
    return call


def client(host: str, *, observation: Observation | None = None,
           transport=None, **kwargs) -> InvenTreeAPI:
    protect_import_logs()
    api = InvenTreeAPI.__new__(InvenTreeAPI)
    facade_options = {} if transport is None else {"transport": transport}
    facade = ObservedRequests(observation, service="inventory", **facade_options)
    # All methods share SDK's logger; requestToken logs the token at INFO.
    # Bind before __init__, including connect/testServer/auth/token acquisition.
    for name, function in vars(InvenTreeAPI).items():
        if not isinstance(function, FunctionType):
            continue
        namespace = dict(function.__globals__, requests=facade, logger=QuietSDKLog())
        bound = FunctionType(function.__code__, namespace, function.__name__,
                             function.__defaults__, function.__closure__)
        bound.__kwdefaults__ = function.__kwdefaults__
        if name in {"get", "post", "patch", "put"}:
            bound = _decoded(bound, observation)
        setattr(api, name, MethodType(bound, api))
    api.__init__(host, **kwargs)
    return api
