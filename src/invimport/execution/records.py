"""Shared guarded record identity and raw-create checkpoint policies."""
from __future__ import annotations

from typing import Mapping

from requests import HTTPError

from .executor import OperationContext
from .models import Certainty, Effect, ErrorCategory, OperationResult, OperationSpec, Output, Retry, SafeError, State, digest
from .stock_api import StockRequests


def record_identity(row: Mapping, fields: tuple[str, ...]) -> str:
    return digest({key: row.get(key) for key in fields})


ROUTES = {"part.part": "part/", "company.company": "company/", "company.supplierpart": "company/part/",
          "stock.stockitem": "stock/", "order.purchaseorder": "order/po/",
          "order.purchaseorderlineitem": "order/po-line/", "common.parameter": "parameter/", "company.manufacturerpart": "company/part/manufacturer/",
          "part.partcategory": "part/category/", "stock.stocklocation": "stock/location/",
          "common.parametertemplate": "parameter/template/"}
IDENTITY_FIELDS = {"part.part": ("category", "IPN", "name", "keywords"),
                   "company.company": ("name", "is_supplier"),
                   "company.supplierpart": ("part", "supplier", "SKU"),
                   "stock.stockitem": ("part",),
                   "order.purchaseorder": ("supplier", "supplier_reference"),
                   "order.purchaseorderlineitem": ("order", "part"),
                   "common.parameter": ("model_type", "model_id", "template", "data"),
                   "company.manufacturerpart": ("part", "manufacturer", "MPN"),
                   "part.partcategory": ("name", "parent"), "stock.stocklocation": ("name", "parent"),
                   "common.parametertemplate": ("name",)}


def review(code: str, *, unknown: bool = False, effects: tuple[Effect, ...] = ()) -> OperationResult:
    return OperationResult(State.UNCERTAIN if unknown else State.NEEDS_REVIEW,
                           Certainty.UNKNOWN if unknown else Certainty.NONE,
                           Retry.RECONCILE if unknown else Retry.REVIEW, effects=effects,
                           error=SafeError(ErrorCategory.UNCERTAIN_WRITE if unknown else ErrorCategory.CONFLICT, code))


def record_output(row: dict, model: str, *, name: str = "record") -> Output:
    return Output(name, model, row["pk"], record_identity(row, IDENTITY_FIELDS[model]))


def satisfied_record(output: Output, *, created: bool = False) -> OperationResult:
    return OperationResult(State.SUCCEEDED if created else State.ALREADY_SATISFIED,
                           Certainty.CONFIRMED, outputs=(output,),
                           effects=(Effect("create", Certainty.CONFIRMED, output.model, output.pk),) if created else ())


def read_record(api: StockRequests, output: Output) -> dict | None:
    try:
        row = api.get(f"{ROUTES[output.model]}{output.pk}/")
    except HTTPError as exc:
        from ..inventree.stock import _http_failure
        if _http_failure(exc)[0] == 404:
            return None
        raise
    if not isinstance(row, dict) or row.get("pk") != output.pk:
        return None
    if record_identity(row, IDENTITY_FIELDS[output.model]) != output.identity_digest:
        return None
    return row


def create_record(spec: OperationSpec, context: OperationContext, api: StockRequests, *, model: str, payload: dict) -> OperationResult:
    """Create once and durably checkpoint trustworthy PKs before model work.

    Rejected requests are eligible only for selected domain repair. Malformed or
    lost responses never authorize identity guesses or blind create replay.
    """
    try:
        response = api.post(ROUTES[model], payload)
    except HTTPError as exc:
        from ..inventree.stock import _http_failure
        status, _ = _http_failure(exc)
        if status in {400, 401, 403, 404, 405, 422}:
            return OperationResult(State.FAILED, retry=Retry.RECONCILE,
                                   error=SafeError(ErrorCategory.DENIED if status in {401, 403} else ErrorCategory.VALIDATION,
                                                   "create_rejected"))
        raise
    rows = response if isinstance(response, list) else [response]
    trustworthy = [row for row in rows if isinstance(row, dict) and type(row.get("pk")) is int and row["pk"] > 0]
    effects = tuple(Effect("create", Certainty.CONFIRMED, model, row["pk"]) for row in trustworthy)
    if len(rows) != 1 or len(trustworthy) != 1:
        return review("invalid_create_cardinality", unknown=True, effects=effects + (Effect("create_response", Certainty.UNKNOWN),))
    row = trustworthy[0]
    fields = IDENTITY_FIELDS[model]
    if any(row.get(key) != payload.get(key) for key in fields):
        return review("invalid_create_identity", unknown=True, effects=effects + (Effect("create_response", Certainty.UNKNOWN),))
    result = satisfied_record(record_output(row, model), created=True)
    context.store.checkpoint(context.attempt, result)
    with context.store.transaction() as connection:
        context.store._event(connection, "confirmed_mutation_fields", spec.id, context.attempt.id,
                             model=model, pk=row["pk"], effect_kind="create",
                             fields={key: value for key, value in payload.items() if row.get(key) == value})
    from ..inventree import ledger
    ledger.created(ROUTES[model], row["pk"], payload)
    # No SDK model construction/reload can precede this checkpoint.
    return result
