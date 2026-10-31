"""DigiKey contribution, issue and one multi-effect receipt reconciliation."""
from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Callable

from ..inventree.collections import list_rows
from .executor import OperationContext
from .models import Certainty, Effect, Kind, OperationResult, OperationSpec, Output, Retry, State, digest
from .digikey_preparation import line_matches, number
from .stock_api import StockAPI, StockRequests
from .order_line_policy import OrderLineCapabilityError, order_line_policy
from .stock_handlers import StockHandlers
from .records import create_record, read_record, satisfied_record, review


class DigiKeyHandlers:
    def __init__(self, api: StockAPI) -> None:
        self.api = api
        self.shared = StockHandlers(api)

    @property
    def mapping(self) -> dict[Kind, Callable]:
        return {kind: self.run for kind in self.shared.mapping}

    def run(self, spec: OperationSpec, context: OperationContext) -> OperationResult:
        return self._run(spec, context, repair=False)

    def repair(self, spec: OperationSpec, context: OperationContext) -> OperationResult:
        return self._run(spec, context, repair=True)

    def _run(self, spec: OperationSpec, context: OperationContext, *, repair: bool) -> OperationResult:
        desired = spec.desired.values()
        action = desired["action"]
        if not action.startswith("dk_"):
            return self.shared.repair(spec, context) if repair else self.shared.run(spec, context)
        api = StockRequests(self.api, context)
        prior = context.store.results().get(spec.id)
        operations = {op.id: op for op in context.store.plan.operations}
        inputs = []
        for ref in spec.requires:
            output = context.inputs[(ref.operation, ref.name)]
            row = read_record(api, output)
            parent = operations[ref.operation]
            approved = row is not None and self._approved(parent, row)
            if approved and output.model == "order.purchaseorder":
                original = next(op for op in operations.values() if op.desired.values().get("action") == "dk_order")
                approved = self._approved(original, row)
            if approved and output.model == "order.purchaseorderlineitem" and parent.desired.values()["action"] == "dk_line":
                part = self._line_part(parent, context, api)
                approved = part is not None and row.get("part") == part.pk
            if not approved:
                return review("digikey_dependency_drift", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
            inputs.append((output, row))
        if action == "dk_order":
            return self._order(spec, context, api, prior, repair=repair)
        if action == "dk_line":
            return self._line(spec, context, api, prior, inputs, repair=repair)
        if action == "dk_issue":
            return self._issue(spec, context, api, prior, inputs)
        if action == "dk_receive":
            return self._receive(spec, context, api, prior, inputs, operations)
        raise ValueError("unsupported DigiKey domain action")

    @staticmethod
    def _approved(spec: OperationSpec, row: dict) -> bool:
        desired = spec.desired.values()
        if desired["action"] == "dk_order":
            return all(row.get(key) == value for key, value in desired["payload"].items())
        if desired["action"] == "dk_line":
            return line_matches(row, desired)
        return True

    def _order(self, spec: OperationSpec, context: OperationContext, api: StockRequests, prior: OperationResult | None, *, repair: bool) -> OperationResult:
        desired, before = spec.desired.values(), spec.baseline.values()
        payload = desired["payload"]
        supplier = desired["supplier_identity"]
        chosen = Output("record", "company.company", payload["supplier"], supplier["identity"])
        company = read_record(api, chosen)
        if company is None or not company.get("is_supplier"):
            return review("digikey_supplier_drift")
        saved = prior.outputs[0] if prior and prior.outputs else None
        if saved is None and before.get("pk"):
            saved = Output("record", "order.purchaseorder", before["pk"], before["identity"])
        if saved:
            row = read_record(api, saved)
            if row is None or not self._approved(spec, row):
                return review("digikey_saved_order_drift", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
            return replace(satisfied_record(saved), effects=prior.effects if prior else ())
        if repair and prior and prior.certainty == Certainty.UNKNOWN:
            return review("digikey_uncorrelated_order_create", unknown=True, effects=prior.effects)
        rows = list_rows(api, "order/po/", params={"supplier": payload["supplier"]})
        if any(str(row.get("supplier_reference")) == payload["supplier_reference"] or row.get("reference") == payload["reference"] for row in rows):
            return review("digikey_order_discovery_changed")
        return self._create_approved(spec, context, api, model="order.purchaseorder", payload=payload)

    def _line(self, spec: OperationSpec, context: OperationContext, api: StockRequests, prior: OperationResult | None, inputs: list[tuple[Output, dict]], *, repair: bool) -> OperationResult:
        desired, before = spec.desired.values(), spec.baseline.values()
        order = next(output for output, _ in inputs if output.model == "order.purchaseorder")
        part = next((output for output, _ in inputs if output.model == "company.supplierpart"), None)
        if part is None:
            chosen = before["supplier_identity"]
            part = Output("record", "company.supplierpart", desired["supplier_part"], chosen["identity"])
        supplier_part = read_record(api, part)
        if supplier_part is None or str(supplier_part.get("SKU", "")).strip().upper() != desired["sku"].upper():
            return review("digikey_supplier_part_drift")
        saved = prior.outputs[0] if prior and prior.outputs else None
        if saved is None and before.get("pk"):
            saved = Output("record", "order.purchaseorderlineitem", before["pk"], before["identity"])
        if saved:
            row = read_record(api, saved)
            if row is None or row.get("order") != order.pk or row.get("part") != part.pk or not line_matches(row, desired):
                return review("digikey_saved_contribution_drift", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
            return replace(satisfied_record(saved), effects=prior.effects if prior else ())
        if repair and prior and prior.certainty == Certainty.UNKNOWN:
            return review("digikey_uncorrelated_line_create", unknown=True, effects=prior.effects)
        rows = list_rows(api, "order/po-line/", params={"order": order.pk})
        if any(row.get("reference") == desired["reference"] for row in rows):
            return review("digikey_contribution_discovery_changed")
        try:
            policy = order_line_policy(api, correlation=True)
        except OrderLineCapabilityError:
            return review("digikey_order_line_capability_changed")
        if policy["payload"] != desired["creation_policy"]["payload"]:
            return review("digikey_order_line_policy_changed")
        payload = {**policy["payload"], "order": order.pk, "part": part.pk, "quantity": desired["quantity"], "reference": desired["reference"]}
        if desired["purchase_price"] is not None:
            payload.update(purchase_price=desired["purchase_price"], purchase_price_currency=desired["purchase_price_currency"])
        return self._create_approved(spec, context, api, model="order.purchaseorderlineitem", payload=payload)

    def _create_approved(self, spec: OperationSpec, context: OperationContext, api: StockRequests, *, model: str, payload: dict) -> OperationResult:
        result = create_record(spec, context, api, model=model, payload=payload)
        if not result.outputs:
            return result
        row = read_record(api, result.outputs[0])
        if row is None or not self._approved(spec, row):
            return replace(review("digikey_created_record_fields_unconfirmed"), outputs=result.outputs,
                           effects=result.effects, certainty=Certainty.CONFIRMED)
        return result

    @staticmethod
    def _line_part(spec: OperationSpec, context: OperationContext, api: StockRequests) -> Output | None:
        desired, before = spec.desired.values(), spec.baseline.values()
        candidates = [context.inputs[(ref.operation, ref.name)] for ref in spec.requires
                      if context.inputs[(ref.operation, ref.name)].model == "company.supplierpart"]
        if candidates:
            output = candidates[0]
        else:
            chosen = before["supplier_identity"]
            output = Output("record", "company.supplierpart", desired["supplier_part"], chosen["identity"])
        return output if read_record(api, output) is not None else None

    def _issue(self, spec: OperationSpec, context: OperationContext, api: StockRequests, prior: OperationResult | None, inputs: list[tuple[Output, dict]]) -> OperationResult:
        output, row = inputs[0]
        status = row.get("status", 10)
        if status in {20, 30}:
            return self._issued(output, observed=True)
        if status != 10:
            return review("digikey_order_status_not_issuable", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
        if prior and (prior.certainty == Certainty.UNKNOWN or any(effect.kind == "issue_accepted" for effect in prior.effects)):
            return review("digikey_issue_outcome_unresolved", unknown=True, effects=prior.effects)
        api.post(f"order/po/{output.pk}/issue/", {})
        context.store.checkpoint(context.attempt, OperationResult(
            State.NEEDS_REVIEW, Certainty.CONFIRMED, Retry.RECONCILE,
            effects=(Effect("issue_accepted", Certainty.CONFIRMED, output.model, output.pk),)))
        # Acknowledgement is not a status observation; read back through guard.
        row = read_record(api, output)
        if row is None or row.get("status") not in {20, 30}:
            return review("digikey_issue_not_confirmed", unknown=True)
        return self._issued(output, observed=False)

    @staticmethod
    def _issued(output: Output, *, observed: bool) -> OperationResult:
        effect = Effect("issue_status_observed" if observed else "issue", Certainty.CONFIRMED, output.model, output.pk)
        return OperationResult(State.ALREADY_SATISFIED if observed else State.SUCCEEDED, Certainty.CONFIRMED,
                               outputs=(replace(output, name="issued"),), effects=(effect,))

    def _receive(self, spec: OperationSpec, context: OperationContext, api: StockRequests, prior: OperationResult | None, inputs: list[tuple[Output, dict]], operations: dict[str, OperationSpec]) -> OperationResult:
        desired = spec.desired.values()
        where = api.get(f"stock/location/{desired['location']}/")
        if not isinstance(where, dict) or digest({key: where.get(key) for key in ("name", "parent")}) != desired["location_identity"]:
            return review("digikey_receiving_location_drift", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
        order_output, order = next((output, row) for output, row in inputs if output.model == "order.purchaseorder")
        by_pk = {output.pk: (output, row) for output, row in inputs if output.model == "order.purchaseorderlineitem"}
        items = []
        effects = []
        totals = []
        for operation_id in desired["line_operations"]:
            line_spec = operations[operation_id]
            line_output = context.inputs[(operation_id, "record")]
            _, row = by_pk[line_output.pk]
            if row.get("order") != order_output.pk:
                return review("digikey_receipt_order_drift")
            wanted = line_spec.desired.values()
            current = Decimal(number(row.get("received", 0) or 0))
            approved = Decimal(wanted["quantity"])
            baseline = Decimal(line_spec.baseline.values()["received"])
            totals.append((line_output.pk, str(current), str(approved), str(baseline)))
            if current == approved:
                effects.append(Effect("received_total_observed", Certainty.CONFIRMED, line_output.model, line_output.pk))
            elif current != baseline:
                return review("digikey_partial_or_manual_receipt", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN),
                              effects=prior.effects if prior else ())
            elif approved > current:
                items.append({"line_item": line_output.pk, "supplier_part": row["part"], "quantity": str(approved - current),
                              "status": 10, "location": desired["location"]})
        # This evidence records observed intent satisfaction, not who created stock.
        with context.store.transaction() as connection:
            context.store._event(connection, "digikey_received_totals_observed", spec.id, context.attempt.id,
                                 order=order_output.pk, totals=totals)
        if not items:
            return OperationResult(State.ALREADY_SATISFIED, Certainty.CONFIRMED, effects=tuple(effects))
        if prior and (prior.certainty == Certainty.UNKNOWN or any(effect.kind == "receive_accepted" for effect in prior.effects)):
            return review("digikey_receipt_outcome_unresolved", unknown=True, effects=prior.effects)
        if order.get("status") != 20:
            return review("digikey_order_not_open_for_receipt")
        api.post(f"order/po/{order_output.pk}/receive/", {"items": items, "location": desired["location"]})
        # Checkpoint accepted multi-effect exchange BEFORE any dependent read.
        accepted = tuple(Effect("receive_accepted", Certainty.CONFIRMED, "order.purchaseorderlineitem", item["line_item"]) for item in items)
        checkpoint = OperationResult(State.NEEDS_REVIEW, Certainty.CONFIRMED, Retry.RECONCILE, effects=tuple(effects) + accepted)
        context.store.checkpoint(context.attempt, checkpoint)
        observed_effects = list(effects)
        for item in items:
            output, _ = by_pk[item["line_item"]]
            row = read_record(api, output)
            expected = next(spec.desired.values()["quantity"] for spec in operations.values()
                            if spec.id in desired["line_operations"] and context.inputs[(spec.id, "record")].pk == output.pk)
            if row is None or number(row.get("received", 0) or 0) != expected:
                return review("digikey_receipt_readback_conflict", effects=checkpoint.effects)
            observed_effects.append(Effect("received_total_observed", Certainty.CONFIRMED, output.model, output.pk))
        return OperationResult(State.SUCCEEDED, Certainty.CONFIRMED, effects=accepted + tuple(observed_effects))
