"""Canonical exclusion for legacy DigiKey order writers, including direct calls."""
from __future__ import annotations

from contextlib import contextmanager, nullcontext
from contextvars import ContextVar
from functools import wraps
from typing import Any, Callable, Iterable, Iterator

from ..digikey.identity import order_namespace
from .models import Target
from .stock_api import StockAPI
from .ownership import legacy_write_guards, normalize_endpoint

_owned: ContextVar[frozenset[tuple[str, str]]] = ContextVar("legacy_digikey_order_scopes", default=frozenset())


@contextmanager
def _order_guards(api: StockAPI, supplier: int, sales_orders: list[dict]) -> Iterator[None]:
    endpoint = normalize_endpoint(api.api_url)
    scopes = {(endpoint, order_namespace(supplier, sales["sales_order_id"])) for sales in sales_orders if sales.get("sales_order_id")}
    unowned = tuple(scope for _, scope in sorted(scopes - _owned.get()))
    with legacy_write_guards(Target(endpoint), unowned) if unowned else nullcontext():
        token = _owned.set(_owned.get() | scopes)
        try:
            yield
        finally:
            _owned.reset(token)


def guard_order_writes(function: Callable) -> Callable:
    @wraps(function)
    def guarded(orders: Iterable[dict], api: StockAPI | None = None, *, supplier: Any, write: bool = False, **kwargs: Any) -> Any:
        from ..inventree.api import connect
        api = api or connect()
        if not write:
            return function(orders, api, supplier=supplier, write=False, **kwargs)
        orders = list(orders)
        supplier_id = supplier if isinstance(supplier, int) else supplier.pk
        with _order_guards(api, supplier_id, [sales for order in orders for sales in order.get("sales_orders", [])]):
            return function(orders, api, supplier=supplier, write=True, **kwargs)
    return guarded


def guard_sales_order_writes(function: Callable) -> Callable:
    @wraps(function)
    def guarded(api: StockAPI, order: dict, sales_order: dict, supplier: int, parts: dict, existing: dict, *, write: bool, **kwargs: Any) -> Any:
        if not write:
            return function(api, order, sales_order, supplier, parts, existing, write=False, **kwargs)
        with _order_guards(api, supplier, [sales_order]):
            return function(api, order, sales_order, supplier, parts, existing, write=True, **kwargs)
    return guarded
