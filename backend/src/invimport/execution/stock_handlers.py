"""Semantic stock handlers. Creates never replay without a known saved identity."""
from __future__ import annotations

from dataclasses import replace
from typing import Callable

from ..inventree.collections import list_rows
from ..inventree.stock import already_imported
from .dispatch import barcode_lookup_request
from .executor import OperationContext
from .models import (
    Certainty,
    Effect,
    Kind,
    OperationResult,
    OperationSpec,
    Output,
    Retry,
    State,
)
from .stock_api import StockAPI, StockRequests
from .stock_preparation import matching_parts
from .records import ROUTES, create_record, record_output, read_record, satisfied_record, review
from .order_line_policy import OrderLineCapabilityError, line_values_match, order_line_policy

def _order_metadata_matches(spec: OperationSpec, row: dict) -> bool:
    """Identity permits locating an order; approved metadata gates new effects."""
    return all(row.get(key) == value for key, value in spec.desired.values()["payload"].items())


def _validated_input(parent: OperationSpec, output: Output, api: StockRequests) -> dict | None:
    """One identity/approved-metadata policy for every output consumer."""
    row = read_record(api, output)
    if row is None:
        return None
    if parent.kind == Kind.COMPANY and any(row.get(key, False) != value for key, value in parent.desired.values()["payload"].items() if key.startswith("is_")):
        return None
    desired = parent.desired.values()
    if desired.get("action") == "order_line" and not line_values_match(row, quantity=desired["quantity"], price=desired["unit_price"], currency=desired["currency"]):
        return None
    if desired.get("action") == "order" and not _order_metadata_matches(parent, row):
        return None
    return row


def _inputs(spec: OperationSpec, context: OperationContext, api: StockRequests) -> list[tuple[Output, dict]] | None:
    resolved = []
    operations = {operation.id: operation for operation in context.store.plan.operations}
    for reference in spec.requires:
        output = context.inputs[(reference.operation, reference.name)]
        row = _validated_input(operations[reference.operation], output, api)
        if row is None:
            return None
        resolved.append((output, row))
    return resolved


class StockHandlers:
    """Own API binding and the explicit original/repair domain policies."""
    def __init__(self, api: StockAPI, *,
                 before_mutation: Callable[[StockRequests, OperationContext], None] | None = None) -> None:
        self.api = api
        self.before_mutation = before_mutation

    @property
    def mapping(self) -> dict[Kind, Callable]:
        return {kind: self.run for kind in (Kind.PART, Kind.PARAMETER, Kind.COMPANY, Kind.STOCK, Kind.BARCODE, Kind.METADATA, Kind.EVIDENCE)}

    def run(self, spec: OperationSpec, context: OperationContext) -> OperationResult:
        return self._run(spec, context, repair=False)

    def repair(self, spec: OperationSpec, context: OperationContext) -> OperationResult:
        return self._run(spec, context, repair=True)

    def _run(self, spec: OperationSpec, context: OperationContext, *, repair: bool) -> OperationResult:
        check = (lambda requests: self.before_mutation(requests, context)) if self.before_mutation else None
        api = StockRequests(self.api, context, before_mutation=check)
        prior = context.store.results().get(spec.id)
        inputs = _inputs(spec, context, api)
        if inputs is None:
            return review("dependency_identity_drift", unknown=prior is not None and prior.certainty == Certainty.UNKNOWN)
        desired = spec.desired.values()
        action = desired["action"]
        if action == "line_disposition":
            return OperationResult(State.SKIPPED) if desired["outcome"] == "skip" else review(desired["reason"])
        unknown_create = repair and prior is not None and prior.certainty == Certainty.UNKNOWN
        if prior and prior.outputs:
            saved = prior.outputs[0]
            saved_row = read_record(api, saved)
            if saved_row is None:
                return review("saved_record_missing_or_changed", unknown=prior.certainty == Certainty.UNKNOWN)
            if action == "order_line" and not line_values_match(saved_row, quantity=desired["quantity"], price=desired["unit_price"], currency=desired["currency"]):
                return review("chosen_order_line_financial_drift")
            if action == "order" and not _order_metadata_matches(spec, saved_row):
                return review("chosen_order_metadata_drift")
            if action in {"part", "supplier", "stock", "supplier_part", "manufacturer_part", "order", "order_line", "parameter", "taxonomy"}:
                if action == "parameter":
                    if saved_row.get("data") != desired["value"]:
                        return review("parameter_value_drift")
                return replace(satisfied_record(saved), effects=tuple(effect for effect in prior.effects if effect.certainty == Certainty.CONFIRMED))
        if action in {"asset_stage", "asset_extract", "provenance_snapshot", "evidence_archive", "artifact_upload", "outcome_report"}:
            from .stock_finalization import run_local_or_final
            return run_local_or_final(spec, context, api, repair=repair)
        if action in {"notes", "empty_field"}:
            from .stock_metadata import ensure_empty_field
            return ensure_empty_field(spec, context, api, inputs)
        if action == "manufacturer_part":
            return self._manufacturer_part(spec, context, api, desired, inputs, repair=unknown_create)
        if action in {"part", "supplier", "taxonomy"}:
            desired = {**desired, "payload": dict(desired["payload"])}
            for output, _ in inputs:
                if action == "part" and output.model == "part.partcategory":
                    desired["payload"]["category"] = output.pk
                elif action == "taxonomy" and output.model == desired["model"]:
                    desired["payload"]["parent"] = output.pk
            return self._record(spec, context, api, desired, repair=unknown_create)
        if action == "parameter":
            return self._parameter(spec, context, api, desired, inputs, repair=unknown_create)
        if action == "stock":
            return self._stock(spec, context, api, desired, inputs, repair=unknown_create)
        if action == "barcode":
            return self._barcode(spec, context, api, desired, inputs)
        if action in {"tags", "order_link"}:
            return self._patch(spec, context, api, desired, inputs)
        if action == "supplier_part":
            return self._supplier_part(spec, context, api, desired, inputs, repair=unknown_create)
        if action == "order":
            return self._order(spec, context, api, desired, inputs, repair=unknown_create)
        if action == "order_line":
            if unknown_create:
                return review("uncorrelated_order_line_create", unknown=True)
            order = next(output for output, row in inputs if output.model == "order.purchaseorder")
            part = next(output for output, row in inputs if output.model == "company.supplierpart")
            if "creation_policy" not in desired:
                return review("order_line_create_policy_unapproved")
            try:
                policy = order_line_policy(api)
            except OrderLineCapabilityError:
                return review("order_line_create_policy_unavailable")
            if policy["payload"] != desired["creation_policy"]["payload"]:
                return review("order_line_create_policy_changed")
            payload = {**policy["payload"], "order": order.pk, "part": part.pk, "quantity": desired["quantity"], "received": desired["quantity"]}
            if desired["unit_price"] is not None:
                payload["purchase_price"] = desired["unit_price"]
                if desired["currency"]:
                    payload["purchase_price_currency"] = desired["currency"]
            result = create_record(spec, context, api, model="order.purchaseorderlineitem", payload=payload)
            if result.outputs:
                observed = read_record(api, result.outputs[0])
                if observed is None or not line_values_match(observed, quantity=desired["quantity"], price=desired["unit_price"], currency=desired["currency"]):
                    return replace(review("order_line_financial_fields_unconfirmed"), outputs=result.outputs,
                                   effects=result.effects, certainty=Certainty.CONFIRMED)
            return result
        if action == "evidence":
            from .stock_evidence import ensure_evidence
            return ensure_evidence(spec, context, api, inputs, repair=repair)
        raise ValueError("unsupported stock domain action")

    def _record(self, spec: OperationSpec, context: OperationContext, api: StockRequests,
                desired: dict, *, repair: bool) -> OperationResult:
        baseline = spec.baseline.values()
        model = desired["model"]
        if baseline.get("pk"):
            output = Output("record", model, baseline["pk"], baseline["identity"])
            return satisfied_record(output) if read_record(api, output) is not None else review("chosen_record_drift")
        if repair:
            return review("uncorrelated_create", unknown=True)
        # Revalidate absence; a newly matching record requires a fresh reviewed choice.
        payload = desired["payload"]
        filters = {"IPN": payload["IPN"]} if model == "part.part" else {"name": payload["name"]}
        if "parent" in payload:
            filters["parent"] = payload["parent"]
        if model == "part.part":
            if desired.get("mpn") and desired["identity_kind"] == "mpn":
                filters_mpn = {"MPN": desired["mpn"]}
                manufacturer = desired.get("manufacturer_operation")
                if manufacturer:
                    filters_mpn["manufacturer"] = context.inputs[(manufacturer, "record")].pk
                if list_rows(api, "company/part/manufacturer/", params=filters_mpn):
                    return review("manufacturer_relationship_discovery_changed")
            from ..config import ParameterConfig
            policies = {name: ParameterConfig(**policy) for name, policy in desired["parameter_policies"].items()}
            candidates = matching_parts(api, category_pk=payload["category"], identity_kind=desired["identity_kind"],
                                        designator=desired["type"], values={name: value for name, value in desired["parameters"].items()},
                                        templates=desired["templates"], parameters=policies)
            if desired["identity_kind"] != "mpn":
                from .stock_preparation import candidate_identities
                approved = baseline.get("declined_candidates")
                if approved is not None:
                    if candidate_identities(candidates) != approved:
                        return review("part_discovery_changed")
                elif candidates:
                    return review("part_discovery_changed")
        if list_rows(api, ROUTES[model], params=filters):
            return review("discovery_changed")
        return create_record(spec, context, api, model=model, payload=payload)

    def _parameter(self, spec: OperationSpec, context: OperationContext, api: StockRequests,
                   desired: dict, inputs: list[tuple[Output, dict]], *, repair: bool) -> OperationResult:
        part = inputs[0][0]
        template = desired["template"]
        if template is None:
            template = next(output.pk for output, _ in inputs if output.model == "common.parametertemplate")
        rows = list_rows(api, "parameter/", params={"model_type": part.model, "model_id": part.pk})
        rows = [row for row in rows if row.get("template") == template]
        if len(rows) > 1:
            return review("duplicate_parameter")
        if rows:
            if rows[0].get("data") != desired["value"]:
                return review("parameter_value_drift")
            return satisfied_record(record_output(rows[0], "common.parameter"))
        if repair and context.store.results()[spec.id].certainty == Certainty.UNKNOWN:
            return review("uncorrelated_parameter_create", unknown=True)
        payload = {"model_type": part.model, "model_id": part.pk, "template": template, "data": desired["value"]}
        return create_record(spec, context, api, model="common.parameter", payload=payload)

    def _stock(self, spec: OperationSpec, context: OperationContext, api: StockRequests,
                   desired: dict, inputs: list[tuple[Output, dict]], *, repair: bool) -> OperationResult:
        with barcode_lookup_request():
            owner = already_imported(api, desired["key"])
        part = inputs[0][0]
        if owner:
            row = api.get(f"stock/{owner}/")
            if not isinstance(row, dict) or row.get("part") != part.pk:
                return review("barcode_owner_conflict")
            baseline = spec.baseline.values().get("pk")
            if baseline != owner:
                return review("unowned_stock_create", unknown=repair)
            return satisfied_record(record_output(row, "stock.stockitem"))
        if spec.baseline.values().get("pk"):
            return review("historical_stock_missing")
        if repair:
            return review("uncorrelated_stock_create", unknown=True)
        payload = {**desired["payload"], "part": part.pk}
        location = next((output for output, _ in inputs if output.model == "stock.stocklocation"), None)
        if location:
            payload["location"] = location.pk
        supplier_part = next((output for output, row in inputs if output.model == "company.supplierpart"), None)
        if supplier_part:
            payload["supplier_part"] = supplier_part.pk
        return create_record(spec, context, api, model="stock.stockitem", payload=payload)

    def _barcode(self, spec: OperationSpec, context: OperationContext, api: StockRequests,
                  desired: dict, inputs: list[tuple[Output, dict]]) -> OperationResult:
        stock = inputs[0][0]
        with barcode_lookup_request():
            owner = already_imported(api, desired["key"])
        if owner == stock.pk:
            return satisfied_record(replace(stock, name="record"))
        if owner is not None:
            return review("barcode_owner_conflict")
        self._authorize(context, spec, "barcode_absent", stock)
        api.post("barcode/link/", {"barcode": desired["key"], "stockitem": stock.pk})
        checkpoint_effect(context, stock, "barcode")
        with barcode_lookup_request():
            owner = already_imported(api, desired["key"])
        if owner != stock.pk:
            return review("barcode_not_confirmed", unknown=True)
        return satisfied_record(stock)

    def _patch(self, spec: OperationSpec, context: OperationContext, api: StockRequests,
                  desired: dict, inputs: list[tuple[Output, dict]]) -> OperationResult:
        stock, row = inputs[0]
        if desired["action"] == "tags":
            # Only this import's newly created stock may have missing tags repaired.
            creator = context.store.results()[spec.requires[0].operation]
            owned = any(effect.kind == "create" and effect.pk == stock.pk for effect in creator.effects)
            current = row.get("tags") or []
            if not isinstance(current, list) or any(not isinstance(tag, str) for tag in current):
                return review("invalid_tags")
            if set(desired["tags"]).issubset(current):
                return satisfied_record(stock)
            if not owned:
                return review("historical_stock_tags_require_review")
            payload = {"tags": list(dict.fromkeys([*current, *desired["tags"]]))}
        else:
            order = next(output for output, row in inputs if output.model == "order.purchaseorder")
            current = row.get("purchase_order")
            if current == order.pk:
                return satisfied_record(stock)
            if current is not None:
                return review("order_link_drift")
            payload = {"purchase_order": order.pk}
        self._authorize(context, spec, "observed_missing_metadata", stock)
        response = api.patch(f"stock/{stock.pk}/", payload)
        fields = {key: value for key, value in payload.items() if isinstance(response, dict) and response.get(key) == value}
        checkpoint_effect(context, stock, desired["action"], fields=fields)
        observed = read_record(api, stock)
        if observed is None or any(observed.get(key) != value for key, value in payload.items()):
            return review("metadata_not_confirmed", unknown=True)
        if desired["action"] == "order_link":
            from ..inventree import ledger
            ledger.note("stockitem", stock.pk, ledger.LINKED_TO_ORDER, purchase_order=payload["purchase_order"])
        return satisfied_record(stock)

    @staticmethod
    def _authorize(context: OperationContext, spec: OperationSpec, reason: str, output: Output) -> None:
        with context.store.transaction() as connection:
            context.store._event(connection, "conditional_domain_write", spec.id, context.attempt.id,
                                 reason=reason, model=output.model, pk=output.pk,
                                 identity=output.identity_digest)
        context.check()

    def _supplier_part(self, spec: OperationSpec, context: OperationContext, api: StockRequests,
                   desired: dict, inputs: list[tuple[Output, dict]], *, repair: bool) -> OperationResult:
        part = next(output for output, row in inputs if output.model == "part.part")
        supplier = next(output for output, row in inputs if output.model == "company.company")
        baseline = spec.baseline.values()
        if baseline.get("pk"):
            output = Output("record", "company.supplierpart", baseline["pk"], baseline["identity"])
            return satisfied_record(output) if read_record(api, output) else review("chosen_supplier_part_drift")
        if repair:
            return review("uncorrelated_supplier_part_create", unknown=True)
        rows = [row for row in list_rows(api, "company/part/", params={"supplier": supplier.pk})
                if str(row.get("SKU", "")).strip().upper() == desired["SKU"]]
        if len(rows) > 1 or (rows and rows[0].get("part") != part.pk):
            return review("supplier_part_conflict")
        if rows:
            return review("supplier_part_discovery_changed")
        if repair:
            return review("uncorrelated_supplier_part_create", unknown=True)
        return create_record(spec, context, api, model="company.supplierpart",
                       payload={"part": part.pk, "supplier": supplier.pk, "SKU": desired["SKU"],
                                **({"manufacturer_part": next(output.pk for output, _ in inputs if output.model == "company.manufacturerpart")}
                                   if any(output.model == "company.manufacturerpart" for output, _ in inputs) else {}),
                                **{key: desired[key] for key in ("description", "link") if desired.get(key)}})

    def _order(self, spec: OperationSpec, context: OperationContext, api: StockRequests,
                   desired: dict, inputs: list[tuple[Output, dict]], *, repair: bool) -> OperationResult:
        supplier = inputs[0][0]
        payload = {**desired["payload"], "supplier": supplier.pk}
        baseline = spec.baseline.values()
        if baseline.get("pk"):
            output = Output("record", "order.purchaseorder", baseline["pk"], baseline["identity"])
            row = read_record(api, output)
            if row is None or any(row.get(key) != value for key, value in payload.items()):
                return review("chosen_order_metadata_drift")
            return satisfied_record(output)
        if repair:
            return review("uncorrelated_order_create", unknown=True)
        rows = [row for row in list_rows(api, "order/po/", params={"supplier": supplier.pk})
                if row.get("supplier_reference") == payload["supplier_reference"]]
        if len(rows) > 1:
            return review("ambiguous_order")
        if rows:
            return review("order_discovery_changed")
        if repair:
            return review("uncorrelated_order_create", unknown=True)
        from ..inventree.purchase_orders import next_reference
        if next_reference(api) != payload["reference"]:
            return review("order_reference_allocation_changed")
        return create_record(spec, context, api, model="order.purchaseorder", payload=payload)

    def _manufacturer_part(self, spec: OperationSpec, context: OperationContext, api: StockRequests,
                           desired: dict, inputs: list[tuple[Output, dict]], *, repair: bool) -> OperationResult:
        part = next(output for output, _ in inputs if output.model == "part.part")
        manufacturer = next(output for output, _ in inputs if output.model == "company.company")
        baseline = spec.baseline.values()
        if baseline.get("pk"):
            output = Output("record", "company.manufacturerpart", baseline["pk"], baseline["identity"])
            return satisfied_record(output) if read_record(api, output) else review("chosen_manufacturer_part_drift")
        if repair:
            return review("uncorrelated_manufacturer_part_create", unknown=True)
        rows = list_rows(api, "company/part/manufacturer/",
                         params={"part": part.pk, "manufacturer": manufacturer.pk, "MPN": desired["MPN"]})
        if rows:
            return review("manufacturer_part_discovery_changed")
        payload = {key: desired[key] for key in ("MPN", "description", "link") if desired.get(key)}
        return create_record(spec, context, api, model="company.manufacturerpart",
                       payload={**payload, "part": part.pk, "manufacturer": manufacturer.pk})


def checkpoint_effect(context: OperationContext, target: Output, kind: str, *, fields: dict | None = None) -> None:
    """Persist confirmed response attribution before any verification request."""
    context.store.checkpoint(context.attempt, OperationResult(State.NEEDS_REVIEW, Certainty.CONFIRMED,
        Retry.RECONCILE, outputs=(target,), effects=(Effect(kind, Certainty.CONFIRMED, target.model, target.pk),)))
    if fields:
        with context.store.transaction() as connection:
            context.store._event(connection, "confirmed_mutation_fields", context.attempt.operation, context.attempt.id,
                                 model=target.model, pk=target.pk, effect_kind=kind, fields=fields)
