"""Read-only resolution for the explicitly bounded durable stock workflow.

Manufacturer enrichment, automatic category/location creation and source archives
remain unsupported. Rejection happens before the returned preview can execute.
"""
from __future__ import annotations

import re
from dataclasses import asdict, replace
from types import SimpleNamespace
from typing import Mapping

from ..config import CategoryConfig, ParameterConfig
from ..inventree.collections import list_rows
from ..inventree.matching import match_path, normalise
from ..inventree.parts import answers_to, ipn_prefix, part_name, values_match
from ..inventree.purchase_orders import split_marketplace
from ..inventree.stock import CONDITION_STATUS, already_imported
from ..inventree.values import from_supplier
from ..stockfile import StockFile, StockLine
from .dispatch import barcode_lookup_request
from .models import (
    Attribution,
    Inputs,
    Kind,
    OperationSpec,
    OutputRef,
    Plan,
    Target,
    digest,
    validate_plan,
)
from .ownership import normalize_endpoint
from .preparation import DiscoverySnapshot, ReadAPI, prepare_import
from .stock_api import StockAPI


class PreparationReview(ValueError):
    """The requested scope cannot safely become an executable preview."""


def record_identity(row: Mapping, fields: tuple[str, ...]) -> str:
    return digest({key: row.get(key) for key in fields})


def single(rows: list[dict], label: str) -> dict | None:
    if len(rows) > 1:
        raise PreparationReview(f"ambiguous {label}; explicit record choice required")
    return rows[0] if rows else None


def _unsupported(document: StockFile) -> None:
    if document.provenance:
        raise PreparationReview("source provenance migration requires Stage 5")
    if document.companies:
        raise PreparationReview("company images require Stage 5")
    for line in document.lines:
        names = ("manufacturer", "mpn", "notes", "part_notes", "manufacturer_part_notes",
                 "supplier_link", "link", "datasheet", "datasheet_pages", "image", "images",
                 "stock_images", "attachments", "suggest_category", "needs_review", "approximate",
                 "provenance", "part_provenance", "manufacturer_part_provenance")
        unsupported = [name for name in names if getattr(line, name, None)]
        if line.order.get("invoice"):
            unsupported.append("order.invoice")
        if unsupported:
            raise PreparationReview(f"line {line.id}: unsupported requested fields: {', '.join(unsupported)}")


def matching_parts(api: ReadAPI, *, category_pk: int, identity_kind: str, designator: str,
                   values: Mapping[str, str], templates: Mapping[str, int],
                   parameters: Mapping[str, ParameterConfig]) -> list[dict]:
    """Share the complete spec/type policy between preparation and revalidation."""
    candidates = list_rows(api, "part/", params={"category": category_pk})
    if identity_kind == "type":
        return [row for row in candidates if answers_to(SimpleNamespace(**row), designator)]
    matched = []
    for row in candidates:
        rows = list_rows(api, "parameter/", params={"model_type": "part.part", "model_id": row["pk"]})
        by_template = {parameter["template"]: parameter.get("data") for parameter in rows}
        if all(name in templates and templates[name] in by_template
               and values_match(str(by_template[templates[name]]), value, parameters.get(name))
               for name, value in values.items()):
            matched.append(row)
    return matched


class _Preview:
    def __init__(self, document: StockFile, api: StockAPI, parameters: Mapping[str, ParameterConfig]) -> None:
        self.document, self.api, self.parameters = document, api, parameters
        self.operations: dict[str, OperationSpec] = {}
        self.parts: dict[str, tuple[OperationSpec, tuple[OutputRef, ...]]] = {}
        self.line_parts: dict[str, OperationSpec] = {}
        self.new_order_subject: str | None = None
        self.reserved_ipns = {str(row.get("IPN") or "") for row in list_rows(api, "part/")}
        self.templates = {row["name"]: row for row in list_rows(api, "parameter/template/")}

    def add(self, kind: Kind, subject: str, *, action: str, payload: dict,
            requires: tuple[OutputRef, ...] = (), provides: tuple[str, ...] = ("record",),
            baseline: dict | None = None, line: StockLine) -> OperationSpec:
        op = OperationSpec.build(kind, subject, discriminator=action,
                                 desired=Inputs.freeze({"action": action, **payload}),
                                 baseline=Inputs.freeze(baseline or {}), requires=requires,
                                 provides=provides, attribution=Attribution(self.document.file_id, (line.id,)),
                                 group=line.id, reconciliation="stock_v1")
        existing = self.operations.get(op.id)
        if existing:
            if (existing.desired != op.desired or existing.baseline != op.baseline
                    or existing.requires != op.requires):
                raise PreparationReview(f"conflicting shared inputs for {subject}")
            op = replace(existing, attribution=Attribution(self.document.file_id,
                         tuple(dict.fromkeys((*existing.attribution.lines, line.id)))))
        self.operations[op.id] = op
        return op

    def next_ipn(self, category: CategoryConfig) -> str:
        prefix = ipn_prefix(category)
        pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$", re.I)
        numbers = [int(match[1]) for value in self.reserved_ipns if (match := pattern.match(value))]
        value = f"{prefix}-{max(numbers, default=0) + 1:05d}"
        self.reserved_ipns.add(value)
        return value

    def part(self, line: StockLine, category: CategoryConfig, category_pk: int) -> tuple[OperationSpec, tuple[OutputRef, ...]]:
        values = from_supplier(line.parameters, dict(self.parameters), category.parameters)
        if set(values) != set(line.parameters):
            # Canonical aliases can change names; reject only inputs that normalization loses.
            if len(values) != len(line.parameters):
                raise PreparationReview(f"line {line.id}: unrecognized parameter")
        if category.identity == "spec":
            missing = set(category.key_parameters) - set(values)
            if not category.key_parameters or missing:
                raise PreparationReview(f"line {line.id}: incomplete specification")
            extras = set(values) - set(category.key_parameters)
            if extras:
                raise PreparationReview(f"line {line.id}: nonidentity spec parameters require Stage 5")
            identity = {name: values[name] for name in category.key_parameters}
        elif category.identity == "type" and line.type:
            identity = {"type": line.type.strip().casefold()}
        else:
            raise PreparationReview(f"line {line.id}: only complete spec and type identity supported")
        subject = f"part:{digest([category.pathstring, identity, line.ipn])}"
        if line.part_of:
            part = self.line_parts[line.part_of]
            self.line_parts[line.id] = part
            # Reference the usable Part output, not the earlier line's stock/evidence.
            return part, ()
        if line.ipn:
            candidates = [r for r in list_rows(self.api, "part/", params={"IPN": line.ipn}) if r.get("IPN") == line.ipn]
        else:
            candidates = matching_parts(self.api, category_pk=category_pk, identity_kind=category.identity,
                                        designator=line.type, values=identity,
                                        templates={name: template["pk"] for name, template in self.templates.items()},
                                        parameters=self.parameters)
        existing = single(candidates, "part")
        payload = {"category": category_pk, "name": line.name or part_name(category, line.type, values, dict(self.parameters), line.description),
                   "description": line.description[:250], "IPN": line.ipn or self.next_ipn(category), "keywords": ""}
        if line.type and normalise(payload["name"]) != normalise(line.type):
            payload["keywords"] = line.type[:250]
        fields = ["category", "IPN", "name", "keywords"]
        if existing:
            payload = {key: existing.get(key) for key in fields}
        # Shared logical identities reuse the first frozen create payload/IPN.
        if subject in self.parts:
            part, gates = self.parts[subject]
            expected = part.desired.values()["parameters"]
            frozen_payload = part.desired.values()["payload"]
            if ((line.name and line.name != frozen_payload.get("name"))
                    or (line.description and line.description[:250] != frozen_payload.get("description"))):
                raise PreparationReview("conflicting shared part metadata")
            if expected != values:
                raise PreparationReview("conflicting shared part parameters")
            self.add(Kind.PART, subject, action="part", payload=part.desired.values() | {},
                     baseline=part.baseline.values(), line=line)
            for gate in gates:
                parameter = self.operations[gate.operation]
                self.operations[gate.operation] = replace(parameter, attribution=Attribution(self.document.file_id,
                    tuple(dict.fromkeys((*parameter.attribution.lines, line.id)))))
            self.line_parts[line.id] = part
            return part, gates
        part = self.add(Kind.PART, subject, action="part", payload={"route": "part/", "model": "part.part", "payload": payload,
                        "identity_fields": fields, "parameters": values, "identity_kind": category.identity,
                        "type": line.type, "parameter_policies": {name: asdict(self.parameters[name]) for name in values}, "templates": {name: self.templates[name]["pk"] for name in values if name in self.templates}},
                        baseline={"pk": existing["pk"] if existing else None,
                                  "identity": record_identity(existing, tuple(fields)) if existing else None}, line=line)
        gates = []
        for name, value in values.items():
            template = self.templates.get(name)
            if not template:
                raise PreparationReview(f"line {line.id}: missing parameter template {name}")
            parameter = self.add(Kind.PARAMETER, subject + ":" + name, action="parameter",
                                 payload={"template": template["pk"], "value": value},
                                 requires=(OutputRef(part.id, "record"),), line=line)
            gates.append(OutputRef(parameter.id, "record"))
        self.parts[subject] = part, tuple(gates)
        self.line_parts[line.id] = part
        return part, tuple(gates)

    def company(self, line: StockLine) -> OperationSpec | None:
        if not line.supplier:
            if line.sku or line.order_reference:
                raise PreparationReview(f"line {line.id}: order/SKU requires supplier")
            return None
        name, seller = split_marketplace(line.supplier)
        if seller:
            raise PreparationReview("marketplace seller enrichment requires Stage 5")
        rows = [row for row in list_rows(self.api, "company/", params={"is_supplier": True})
                if normalise(row.get("name", "")) == normalise(name)]
        existing = single(rows, "supplier")
        payload = {"name": existing["name"] if existing else name, "is_supplier": True}
        return self.add(Kind.COMPANY, f"supplier:{normalise(name)}", action="supplier",
                        payload={"route": "company/", "model": "company.company", "payload": payload,
                                 "identity_fields": ["name", "is_supplier"]},
                        baseline={"pk": existing["pk"] if existing else None,
                                  "identity": record_identity(existing, ("name", "is_supplier")) if existing else None}, line=line)


def prepare_stock(document: StockFile, *, categories: Mapping[str, CategoryConfig],
                  parameters: Mapping[str, ParameterConfig], target: Target, api: StockAPI) -> Plan:
    """Return a genuinely resolved, immutable mutation preview; never write.

    Existing taxonomy/templates and an explicitly requested existing location are
    required. Ambiguous matches and unsupported enrichment raise PreparationReview.
    Use execute_stock/resume_stock for canonical ownership and domain handlers.
    """
    if normalize_endpoint(api.api_url) != normalize_endpoint(target.endpoint):
        raise PreparationReview("discovery API client target mismatch")
    _unsupported(document)
    semantics = {"categories": {k: asdict(v) for k, v in categories.items()},
                 "parameters": {k: asdict(v) for k, v in parameters.items()}, "stock_subset": 1}
    plan = prepare_import(document, config_semantics=semantics, target=target, api=api,
                          discover=lambda read: DiscoverySnapshot((), "stock_v1"))
    preview = _Preview(document, api, parameters)
    server_categories = {r["pathstring"]: r for r in list_rows(api, "part/category/")}
    locations = {r["pathstring"]: r for r in list_rows(api, "stock/location/")}
    for line in document.lines:
        category = categories.get(line.category) or match_path(line.category.split("/"), dict(categories))
        if line.part_of:
            part = preview.line_parts[line.part_of]
            gates = next((gates for resolved, gates in preview.parts.values() if resolved.id == part.id), ())
            preview.line_parts[line.id] = part
        elif not category or category.structural or category.pathstring not in server_categories:
            raise PreparationReview(f"line {line.id}: unresolved category")
        if not line.location or line.location not in locations:
            raise PreparationReview(f"line {line.id}: requested location unresolved")
        if not line.part_of:
            part, gates = preview.part(line, category, server_categories[category.pathstring]["pk"])
        supplier = preview.company(line)
        supplier_part = _supplier_part(preview, line, part, supplier)
        order = _order(preview, line, supplier)
        _stock(preview, line, part, gates, supplier_part, order, locations)
    result = replace(plan, operations=tuple(preview.operations.values()), unsupported=(),
                     decisions=Inputs.freeze({**plan.decisions.values(), "source": document.source}))
    validate_plan(result)
    return result


def _supplier_part(preview: _Preview, line: StockLine, part: OperationSpec,
                   supplier: OperationSpec | None) -> OperationSpec | None:
    if not line.sku:
        if line.order_reference:
            raise PreparationReview("PO line requires a supplier SKU")
        return None
    if supplier is None:
        raise PreparationReview("supplier part requires a resolved supplier")
    existing = None
    supplier_pk = supplier.baseline.values().get("pk")
    part_pk = part.baseline.values().get("pk")
    if supplier_pk:
        rows = [row for row in list_rows(preview.api, "company/part/", params={"supplier": supplier_pk})
                if str(row.get("SKU", "")).strip().upper() == line.sku.strip().upper()]
        existing = single(rows, "supplier SKU")
        if existing and existing.get("part") != part_pk:
            raise PreparationReview(f"line {line.id}: supplier SKU belongs to another part")
    return preview.add(Kind.METADATA, supplier.subject + ":sku:" + line.sku.strip().upper(), action="supplier_part",
                       payload={"SKU": line.sku.strip().upper()},
                       baseline={"pk": existing["pk"] if existing else None,
                                 "identity": record_identity(existing, ("part", "supplier", "SKU")) if existing else None},
                       requires=(OutputRef(part.id, "record"), OutputRef(supplier.id, "record")), line=line)


def _order(preview: _Preview, line: StockLine, supplier: OperationSpec | None) -> OperationSpec | None:
    if not line.order_reference:
        return None
    if supplier is None:
        raise PreparationReview("order requires a resolved supplier")
    order = dict(line.order)
    payload = {"supplier_reference": line.order_reference, "description": str(order.get("description") or f"Imported order {line.order_reference}")[:250]}
    for source, field in (("date", "start_date"), ("target_date", "target_date"), ("link", "link"), ("notes", "notes"), ("tags", "tags")):
        if order.get(source):
            payload[field] = order[source]
    if line.currency:
        payload["order_currency"] = line.currency
    existing = None
    supplier_pk = supplier.baseline.values().get("pk")
    if supplier_pk:
        existing = single([row for row in list_rows(preview.api, "order/po/", params={"supplier": supplier_pk})
                           if row.get("supplier_reference") == line.order_reference], "purchase order")
        if existing and any(existing.get(key) != value for key, value in payload.items()):
            raise PreparationReview(f"line {line.id}: existing order metadata/currency conflict")
    subject = supplier.subject + ":order:" + line.order_reference
    if existing is None:
        if preview.new_order_subject not in {None, subject}:
            raise PreparationReview("multiple new purchase order allocations require Stage 5")
        preview.new_order_subject = subject
    from ..inventree.purchase_orders import next_reference
    payload["reference"] = existing["reference"] if existing else next_reference(preview.api)
    return preview.add(Kind.METADATA, subject, action="order",
                       payload={"payload": payload},
                       baseline={"pk": existing["pk"] if existing else None,
                                 "identity": record_identity(existing, ("supplier", "supplier_reference")) if existing else None},
                       requires=(OutputRef(supplier.id, "record"),), line=line)


def _stock(preview: _Preview, line: StockLine, part: OperationSpec, gates: tuple[OutputRef, ...],
           supplier_part: OperationSpec | None, order: OperationSpec | None, locations: dict) -> None:
    key = preview.document.key_for(line)
    with barcode_lookup_request():
        owner = already_imported(preview.api, key)
    if owner and order is not None:
        raise PreparationReview("historical stock PO contributions require existing run recovery/review")
    payload = {"quantity": line.quantity, "status": CONDITION_STATUS[line.condition],
               "batch": line.batch, "packaging": line.packaging}
    if line.location:
        payload["location"] = locations[line.location]["pk"]
    if line.unit_price is not None:
        payload["purchase_price"] = line.unit_price
        if line.currency:
            payload["purchase_price_currency"] = line.currency
    requires = (OutputRef(part.id, "record"), *gates)
    if supplier_part:
        requires += (OutputRef(supplier_part.id, "record"),)
    stock = preview.add(Kind.STOCK, key, action="stock", payload={"payload": payload, "key": key},
                        baseline={"pk": owner}, requires=requires, line=line)
    barcode = preview.add(Kind.BARCODE, key, action="barcode", payload={"key": key},
                          requires=(OutputRef(stock.id, "record"),), line=line)
    preview.add(Kind.METADATA, key, action="tags", payload={"tags": line.tags},
                requires=(OutputRef(stock.id, "record"), OutputRef(barcode.id, "record")), line=line)
    if order and supplier_part:
        contribution = preview.add(Kind.METADATA, key, action="order_line", payload={"quantity": line.quantity, "unit_price": line.unit_price, "currency": line.currency},
                                    requires=(OutputRef(order.id, "record"), OutputRef(supplier_part.id, "record")), line=line)
        preview.add(Kind.METADATA, key, action="order_link", payload={},
                    requires=(OutputRef(stock.id, "record"), OutputRef(order.id, "record"), OutputRef(contribution.id, "record")), line=line)
