"""Conditional enrichment of empty fields, preserving every manual value."""
from __future__ import annotations

from .executor import OperationContext
from .models import OperationResult, OperationSpec, Output
from .stock_api import StockRequests
from .stock_handlers import ROUTES, StockHandlers, _read, _success, checkpoint_effect, review


def ensure_empty_field(spec: OperationSpec, context: OperationContext, api: StockRequests,
                       inputs: list[tuple[Output, dict]]) -> OperationResult:
    target, row = inputs[0]
    desired = spec.desired.values()
    field = "notes" if desired["action"] == "notes" else desired["field"]
    if field not in {"notes", "link"}:
        raise ValueError("unapproved enrichment field")
    if str(row.get(field) or "").strip():
        return _success(target)
    StockHandlers._authorize(context, spec, "empty_field_observed", target)
    response = api.patch(f"{ROUTES[target.model]}{target.pk}/", {field: desired["text"]})
    fields = {field: desired["text"]} if isinstance(response, dict) and response.get(field) == desired["text"] else {}
    checkpoint_effect(context, target, field, fields=fields)
    observed = _read(api, target)
    if observed is None or observed.get(field) != desired["text"]:
        return review("enrichment_not_confirmed", unknown=True)
    return _success(target)
