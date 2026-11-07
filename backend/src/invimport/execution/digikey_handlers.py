"""DigiKey contribution, issue and one multi-effect receipt reconciliation."""
from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal, localcontext
from typing import Callable

from ..inventree.collections import list_rows
from .executor import ClassifiedFailure, OperationContext
from .models import Certainty, Effect, ErrorCategory, Kind, OperationResult, OperationSpec, Output, Retry, SafeError, State
from .digikey_preparation import line_matches, number
from .stock_api import StockAPI, StockRequests
from .order_line_policy import OrderLineCapabilityError, order_line_policy
from .order_policy import OrderDateCapabilityError, creation_date_policy
from .stock_handlers import StockHandlers
from .stock_preparation import PreparationReview
from .records import IDENTITY_FIELDS, create_record, read_company_role, read_record, record_identity, satisfied_record, review


@dataclass(frozen=True)
class ReceiptPreconditions:
    """Observed state to which this exact receipt or satisfaction is bound."""
    status: int
    received: tuple[tuple[int, str], ...]


class DigiKeyHandlers:
    def __init__(self, api: StockAPI) -> None:
        self.api = api
        self.shared = StockHandlers(api, before_mutation=self._before_mutation)

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
        api = StockRequests(self.api, context, before_mutation=lambda requests: self._before_mutation(requests, context))
        prior = context.store.results().get(spec.id)
        failure = self._consumption_failure(api, context)
        if failure:
            return review(failure, unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
        if not action.startswith("dk_"):
            return self.shared.repair(spec, context) if repair else self.shared.run(spec, context)
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

    def _before_mutation(self, api: StockRequests, context: OperationContext) -> None:
        failure = self._consumption_failure(api, context, mutation=True)
        if failure:
            raise ClassifiedFailure(SafeError(ErrorCategory.CONFLICT, failure), retry=Retry.REVIEW)

    def _consumption_failure(self, api: StockRequests, context: OperationContext, *, mutation: bool = False,
                             receipt: ReceiptPreconditions | None = None) -> str | None:
        operations = context.store.plan.operations
        current = next(op for op in operations if op.id == context.attempt.operation)
        if receipt is not None:
            desired_receipt = current.desired.values()
            location = Output("location", "stock.stocklocation", desired_receipt["location"], desired_receipt["location_identity"])
            if read_record(api, location) is None:
                return "digikey_receiving_location_drift"
        original = next(op for op in operations if op.desired.values().get("action") == "dk_order")
        desired = original.desired.values()
        supplier = Output("record", "company.company", desired["payload"]["supplier"], desired["supplier_identity"]["identity"])
        if read_company_role(api, supplier, role="is_supplier") is None:
            return "digikey_supplier_drift"
        order = context.inputs.get((original.id, "record"))
        if order is not None:
            row = read_record(api, order)
            if row is None or not self._approved(original, row):
                return "digikey_order_metadata_drift"
            if mutation and current.desired.values()["action"] == "dk_issue" and row.get("status") != 10:
                return "digikey_issue_status_changed"
            if receipt is not None and (row.get("status") != receipt.status or mutation and row.get("status") != 20):
                return "digikey_receipt_status_changed"
        if current.desired.values()["action"] in {"dk_issue", "dk_receive"}:
            expected = dict(receipt.received) if receipt is not None else None
            if order is None or not self._order_scope(api, context, order.pk, received=expected):
                return "digikey_receipt_preconditions_changed" if receipt is not None else "digikey_order_contribution_scope_drift"
        return None

    def _order_scope(self, api: StockRequests, context: OperationContext, order_pk: int, *,
                     received: dict[int, str] | None = None) -> bool:
        """Order-wide effects consume exactly the approved complete line set."""
        expected = {}
        for spec in context.store.plan.operations:
            if spec.desired.values().get("action") != "dk_line":
                continue
            output = context.inputs.get((spec.id, "record"))
            if output is None or output.pk in expected:
                return False
            expected[output.pk] = output, spec
        rows = list_rows(api, "order/po-line/", params={"order": order_pk})
        if len(rows) != len(expected) or {row.get("pk") for row in rows} != set(expected):
            return False
        for row in rows:
            output, spec = expected[row["pk"]]
            part = self._line_part(spec, context, api)
            if (part is None or row.get("part") != part.pk or row.get("order") != order_pk or record_identity(row, IDENTITY_FIELDS[output.model]) != output.identity_digest
                    or not self._approved(spec, row)):
                return False
            if received is not None:
                try:
                    if number(row.get("received", 0) or 0) != received.get(output.pk):
                        return False
                except PreparationReview:
                    return False
        return True

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
        if payload.get("creation_date"):
            try:
                creation_date_policy(api.request("order/po/", method="OPTIONS").json())
            except OrderDateCapabilityError:
                return review("digikey_order_date_capability_changed")
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
        location = Output("location", "stock.stocklocation", desired["location"], desired["location_identity"])
        where = read_record(api, location)
        if where is None:
            return review("digikey_receiving_location_drift", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
        order_output = next(output for output, _ in inputs if output.model == "order.purchaseorder")
        order = read_record(api, order_output)
        original = next(op for op in operations.values() if op.desired.values()["action"] == "dk_order")
        if order is None or not self._approved(original, order):
            return review("digikey_order_metadata_drift", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
        if order.get("status") not in {20, 30}:
            return review("digikey_order_not_open_for_receipt", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
        by_pk = {}
        for operation_id in desired["line_operations"]:
            output = context.inputs[(operation_id, "record")]
            current = read_record(api, output)
            if current is None or not self._approved(operations[operation_id], current):
                return review("digikey_receipt_line_drift", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
            by_pk[output.pk] = output, current
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
            try:
                current = Decimal(number(row.get("received", 0) or 0))
            except PreparationReview:
                return review("digikey_received_amount_unsupported", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN))
            approved = Decimal(wanted["quantity"])
            baseline = Decimal(line_spec.baseline.values()["received"])
            totals.append((line_output.pk, str(current), str(approved), str(baseline)))
            if current == approved:
                effects.append(Effect("received_total_observed", Certainty.CONFIRMED, line_output.model, line_output.pk))
            elif current != baseline:
                return review("digikey_partial_or_manual_receipt", unknown=bool(prior and prior.certainty == Certainty.UNKNOWN),
                              effects=prior.effects if prior else ())
            elif approved > current:
                # Embedding callers may lower the process Decimal precision.
                # Supported13+6 digit inputs need no more than19 exact digits.
                with localcontext() as decimal_context:
                    decimal_context.prec = 32
                    remaining = format(approved - current, "f")
                items.append({"line_item": line_output.pk, "supplier_part": row["part"], "quantity": remaining,
                              "status": 10, "location": desired["location"]})
        # This evidence records observed intent satisfaction, not who created stock.
        with context.store.transaction() as connection:
            context.store._event(connection, "digikey_received_totals_observed", spec.id, context.attempt.id,
                                 order=order_output.pk, totals=totals)
        preconditions = ReceiptPreconditions(order["status"], tuple((pk, current) for pk, current, _, _ in totals))
        if not items:
            failure = self._consumption_failure(api, context, receipt=preconditions)
            if failure:
                return review(failure, unknown=bool(prior and prior.certainty == Certainty.UNKNOWN), effects=tuple(effects))
            return OperationResult(State.ALREADY_SATISFIED, Certainty.CONFIRMED, effects=tuple(effects))
        if prior and (prior.certainty == Certainty.UNKNOWN or any(effect.kind == "receive_accepted" for effect in prior.effects)):
            return review("digikey_receipt_outcome_unresolved", unknown=True, effects=prior.effects)
        if order.get("status") != 20:
            return review("digikey_order_not_open_for_receipt")
        previous_check = api.before_mutation
        def receipt_check(requests: StockRequests) -> None:
            failure = self._consumption_failure(requests, context, mutation=True, receipt=preconditions)
            if failure:
                raise ClassifiedFailure(SafeError(ErrorCategory.CONFLICT, failure), retry=Retry.REVIEW)
            with context.store.transaction() as connection:
                context.store._event(connection, "digikey_receipt_preconditions_checked", spec.id, context.attempt.id,
                                     order=order_output.pk, status=preconditions.status, received=preconditions.received,
                                     location=desired["location"])
        api.before_mutation = receipt_check
        try:
            api.post(f"order/po/{order_output.pk}/receive/", {"items": items, "location": desired["location"]})
        except ClassifiedFailure as exc:
            return review(exc.error.code, effects=tuple(effects))
        finally:
            api.before_mutation = previous_check
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
            try:
                matches = row is not None and number(row.get("received", 0) or 0) == expected
            except PreparationReview:
                matches = False
            if not matches:
                return review("digikey_receipt_readback_conflict", effects=checkpoint.effects)
            observed_effects.append(Effect("received_total_observed", Certainty.CONFIRMED, output.model, output.pk))
        return OperationResult(State.SUCCEEDED, Certainty.CONFIRMED, effects=accepted + tuple(observed_effects))
