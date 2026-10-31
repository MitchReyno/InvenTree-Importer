"""Freeze a single DigiKey sales order as distinct approved contributions.

No authentication or supplier fetching is hidden here. Callers supply the complete
selected source; preparation performs inventory reads only. An invocation accepts
one sales order until a server-side PO allocation contract has been established.
"""
from __future__ import annotations

from dataclasses import asdict
from decimal import Decimal, InvalidOperation
from typing import Mapping

from ..config import CategoryConfig, ParameterConfig
from ..digikey.identity import order_namespace
from ..inventree.stockimport import ImportOptions
from ..inventree.collections import list_rows
from .models import Attribution, Inputs, Kind, OperationSpec, OutputRef, Plan, Target, digest, validate_plan
from .ownership import normalize_endpoint
from .order_line_policy import line_values_match, order_line_policy
from .stock_api import StockAPI
from .records import IDENTITY_FIELDS
from .records import record_identity
from .stock_preparation import PreparationReview, single


def number(value: object) -> str:
    """Canonical finite nonnegative decimal, preserving price precision."""
    try:
        parsed = Decimal(str(value))
    except (ValueError, InvalidOperation):
        raise PreparationReview("DigiKey quantity/price must be a finite nonnegative number") from None
    if not parsed.is_finite() or parsed < 0:
        raise PreparationReview("DigiKey quantity/price must be a finite nonnegative number")
    return format(parsed.normalize(), "f")


def baseline(row: dict | None, model: str) -> dict:
    return {"pk": row["pk"], "identity": record_identity(row, IDENTITY_FIELDS[model])} if row else {}


def prepare_digikey(orders: list[dict], *, supplier: int, location: int | None,
                    target: Target, api: StockAPI, partial: bool = False,
                    receive: bool = True, receive_remaining: bool = False,
                    supplier_operations: Mapping[str, OperationSpec] | None = None,
                    component_operations: tuple[OperationSpec, ...] = (),
                    create_parts: bool = False, products: Mapping[str, dict] | None = None,
                    categories: Mapping[str, CategoryConfig] | None = None,
                    parameters: Mapping[str, ParameterConfig] | None = None,
                    options: ImportOptions | None = None) -> Plan:
    """Resolve all choices before any write; repeated SKUs remain separate lines.

    Explicit source line IDs survive source reordering. Without such IDs the
    original position is scoped by the complete immutable line array digest;
    a later changed array cannot be guessed onto existing contributions.
    Partial/manual receipts need explicit remaining-amount approval at prepare.
    """
    selected = [(order, sales) for order in orders for sales in order.get("sales_orders", [])]
    if len(selected) != 1:
        raise PreparationReview("durable DigiKey preparation requires exactly one sales order; no selected batch was imported")
    if type(supplier) is not int or supplier <= 0:
        raise PreparationReview("an explicitly resolved supplier PK is required")
    if normalize_endpoint(api.api_url) != normalize_endpoint(target.endpoint):
        raise PreparationReview("discovery API client target mismatch")
    order, sales = selected[0]
    source_id = order_namespace(supplier, sales.get("sales_order_id"))
    company = api.get(f"company/{supplier}/")
    if not isinstance(company, dict) or not company.get("is_supplier"):
        raise PreparationReview("chosen supplier is missing or no longer a supplier")
    if receive:
        if type(location) is not int or location <= 0:
            raise PreparationReview("durable receiving requires an explicitly resolved location")
        where = api.get(f"stock/location/{location}/")
        if not isinstance(where, dict) or where.get("pk") != location:
            raise PreparationReview("requested receiving location is unresolved")
    else:
        where = None
    creation_policy = order_line_policy(api, correlation=True)
    raw_lines = sales.get("line_items") or []
    source_hash = digest(raw_lines)
    currency = str(sales.get("currency") or order.get("currency") or "")
    parts = list_rows(api, "company/part/", params={"supplier": supplier})
    if create_parts:
        from .component_preparation import prepare_component_models
        known = {str(part.get("SKU", "")).strip().upper() for part in parts}
        missing = {str(line.get("digikey_part") or "").strip().upper() for line in raw_lines} - known - {""}
        indexed = {str(sku).strip().upper(): product for sku, product in (products or {}).items()}
        if missing - indexed.keys():
            raise PreparationReview("missing DigiKey product inputs; fetch them before durable preparation")
        component_operations, supplier_operations = prepare_component_models(source_id, {sku: indexed[sku] for sku in sorted(missing)},
            supplier=company, api=api, categories=categories or {}, parameters=parameters or {}, options=options or ImportOptions())
    rows = list_rows(api, "order/po/", params={"supplier": supplier})
    existing = single([row for row in rows if str(row.get("supplier_reference")) == str(sales["sales_order_id"])], "DigiKey purchase order")
    order_lines = list_rows(api, "order/po-line/", params={"order": existing["pk"]}) if existing else []
    operations = list(component_operations)
    source_lines: dict[str, dict] = {}

    def add(action: str, subject: str, desired: dict, *, before: dict | None = None,
            requires: tuple[OutputRef, ...] = (), provides: tuple[str, ...] = ("record",),
            lines: tuple[str, ...] = ()) -> OperationSpec:
        op = OperationSpec.build(Kind.METADATA, subject, discriminator=action,
            desired=Inputs.freeze({"action": action, **desired}), baseline=Inputs.freeze(before or {}),
            requires=requires, provides=provides, attribution=Attribution(source_id, lines),
            group=source_id, reconciliation="digikey_v1")
        operations.append(op)
        return op

    resolved = []
    seen: set[str] = set()
    skipped = []
    supplied = supplier_operations or {}
    for index, line in enumerate(raw_lines):
        original = line.get("source_line_id")
        if original is not None and (type(original) not in {str, int} or not str(original).strip()):
            raise PreparationReview("invalid original DigiKey source line identity")
        line_id = f"id:{original}" if original is not None else f"array:{source_hash}:{index}"
        if line_id in seen:
            raise PreparationReview("duplicate original DigiKey line identity")
        seen.add(line_id)
        sku = str(line.get("digikey_part") or "").strip()
        quantity = number(line.get("quantity_ordered") or line.get("quantity_shipped") or 0)
        reference = "invimport:dk:" + digest([source_id, line_id])
        candidates = [part for part in parts if str(part.get("SKU", "")).strip().upper() == sku.upper()]
        part = single(candidates, "DigiKey supplier SKU")
        planned = supplied.get(sku.upper())
        if not sku or quantity == "0" or (part is None and planned is None):
            skipped.append(line_id)
            continue
        matched = single([row for row in order_lines if row.get("reference") == reference], "DigiKey source contribution")
        price = number(line["unit_price"]) if line.get("unit_price") is not None else None
        desired = {"creation_policy": creation_policy, "reference": reference, "quantity": quantity, "purchase_price": price,
                   "purchase_price_currency": currency, "sku": sku,
                   "supplier_part": part["pk"] if part else None}
        if matched:
            if part is None or matched.get("part") != part["pk"] or not line_matches(matched, desired):
                raise PreparationReview("existing contribution differs from approved DigiKey source")
        received = number(matched.get("received", 0) or 0) if matched else "0"
        if Decimal(received) > Decimal(quantity):
            raise PreparationReview("received quantity exceeds source; manual review required")
        if receive and Decimal(received) not in {Decimal(0), Decimal(quantity)} and not receive_remaining:
            raise PreparationReview("partially received line requires explicit approval of the remaining quantity")
        source_lines[line_id] = {"source": line, "reference": reference, "received": received}
        resolved.append((line_id, desired, matched, part, planned, received))
    if not resolved:
        raise PreparationReview("no approved DigiKey contributions")
    if skipped and not partial:
        raise PreparationReview("unmatched DigiKey contributions require explicit partial-order approval")
    recognized = {desired["reference"] for _, desired, *_ in resolved}
    if any(row.get("reference") not in recognized for row in order_lines):
        raise PreparationReview("existing order contains uncorrelated contributions; SKU/quantity matching is not safe")
    payload = {"supplier": supplier, "supplier_reference": str(sales["sales_order_id"]),
               "description": existing.get("description", "") if existing else f"DigiKey order {order.get('order_number')}"[:250]}
    if currency:
        if existing and existing.get("order_currency") != currency:
            raise PreparationReview("existing purchase order currency differs from source")
        payload["order_currency"] = currency
    if existing:
        payload["reference"] = existing["reference"]
    else:
        response = api.request("order/po/", method="OPTIONS")
        offered = response.json().get("actions", {}).get("POST", {}).get("reference", {}).get("default")
        if not offered:
            raise PreparationReview("server did not offer a PO reference; allocation is not inferred")
        payload["reference"] = str(offered)
    po = add("dk_order", source_id, {"payload": payload, "supplier_identity": baseline(company, "company.company")},
             before=baseline(existing, "order.purchaseorder"), lines=tuple(source_lines))
    line_ops = []
    for line_id, desired, matched, part, planned, received in resolved:
        before = {**baseline(matched, "order.purchaseorderlineitem"), "received": received,
                  "supplier_identity": baseline(part, "company.supplierpart") if part else {}}
        op = add("dk_line", source_id + ":" + line_id, desired, before=before,
                 requires=(OutputRef(po.id, "record"),) + ((OutputRef(planned.id, "record"),) if planned else ()), lines=(line_id,))
        line_ops.append(op)
    if receive:
        issued = add("dk_issue", source_id, {}, requires=(OutputRef(po.id, "record"), *(OutputRef(op.id, "record") for op in line_ops)), provides=("issued",), lines=tuple(source_lines))
        add("dk_receive", source_id, {"location": location, "location_identity": digest({key: where.get(key) for key in ("name", "parent")}),
                                      "line_operations": [op.id for op in line_ops]},
            requires=(OutputRef(issued.id, "issued"), *(OutputRef(op.id, "record") for op in line_ops)),
            provides=(), lines=tuple(source_lines))
    decisions = {"domain": "digikey_v1", "source": orders, "sources": source_lines,
                 "partial": partial, "skipped": skipped, "receive": receive, "receive_remaining": receive_remaining,
                 "allocation": "one_sales_order_OPTIONS_candidate_not_reservation",
                 "products": dict(products or {}) if create_parts else {}}
    plan = Plan(source_id, 1, digest(orders), digest({"supplier": supplier, "location": location, "partial": partial,
                "receive": receive, "receive_remaining": receive_remaining, "components": [asdict(op) for op in component_operations]}),
                Inputs(), target, Inputs.freeze(decisions), tuple(operations), schema_version=2)
    validate_plan(plan)
    return plan


def line_matches(row: dict, desired: dict) -> bool:
    return row.get("reference") == desired["reference"] and line_values_match(
        row, quantity=desired["quantity"], price=desired["purchase_price"], currency=desired["purchase_price_currency"])
