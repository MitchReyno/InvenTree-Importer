"""Shared read-only planner for bounded and full durable stock preparation.

With no options, preserve the Stage 4 subset. The full workflow supplies frozen
options and adds explicit enrichment/finalization using these same domain rows.
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
from ..inventree.part_policy import part_parameters
from ..inventree.stockimport import ImportOptions
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
        raise PreparationReview("source provenance migration requires prepare_full_stock")
    if document.companies:
        raise PreparationReview("company images require prepare_full_stock")
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
    def __init__(self, document: StockFile, api: StockAPI, parameters: Mapping[str, ParameterConfig],
                 options: ImportOptions | None = None) -> None:
        self.options = options
        self.document, self.api, self.parameters = document, api, parameters
        self.operations: dict[str, OperationSpec] = {}
        self.parts: dict[str, tuple[OperationSpec, tuple[OutputRef, ...]]] = {}
        self.line_categories: dict[str, CategoryConfig] = {}
        self.line_parts: dict[str, OperationSpec] = {}
        self.manufacturers: dict[str, OperationSpec] = {}
        self.new_order_subject: str | None = None
        self.reserved_ipns = {str(row.get("IPN") or "") for row in list_rows(api, "part/")}
        self.templates = {row["name"]: row for row in list_rows(api, "parameter/template/")}

    def add(self, kind: Kind, subject: str, *, action: str, payload: dict,
            requires: tuple[OutputRef, ...] = (), provides: tuple[str, ...] = ("record",),
            baseline: dict | None = None, settled_after: tuple[str, ...] = (), line: StockLine) -> OperationSpec:
        op = OperationSpec.build(kind, subject, discriminator=action,
                                 desired=Inputs.freeze({"action": action, **payload}),
                                 baseline=Inputs.freeze(baseline or {}), requires=requires, settled_after=settled_after,
                                 provides=provides, attribution=Attribution(self.document.file_id, (line.id,)),
                                 group=line.id, reconciliation="stock_v1")
        existing = self.operations.get(op.id)
        if existing:
            if (existing.desired != op.desired or existing.baseline != op.baseline
                    or existing.requires != op.requires or existing.settled_after != op.settled_after):
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

    def part(self, line: StockLine, category: CategoryConfig, category_pk: int | None) -> tuple[OperationSpec, tuple[OutputRef, ...]]:
        values = from_supplier(line.parameters, dict(self.parameters), category.parameters)
        if set(values) != set(line.parameters):
            # Canonical aliases can change names; reject only inputs that normalization loses.
            if len(values) != len(line.parameters):
                raise PreparationReview(f"line {line.id}: unrecognized parameter")
        if category.identity == "spec":
            missing = set(category.key_parameters) - set(values)
            if (not category.key_parameters or missing) and self.options is None:
                raise PreparationReview(f"line {line.id}: incomplete specification")
            extras = set(values) - set(category.key_parameters)
            if extras and self.options is None:
                raise PreparationReview(f"line {line.id}: nonidentity spec parameters require prepare_full_stock")
            identity = {name: values[name] for name in category.key_parameters if name in values}
        elif category.identity == "type" and line.type:
            identity = {"type": line.type.strip().casefold()}
        elif self.options and category.identity == "mpn" and (line.mpn or line.type):
            identity = {"mpn": line.mpn or line.type,
                        "manufacturer": self.manufacturers[line.id].subject if line.id in self.manufacturers else ""}
        else:
            raise PreparationReview(f"line {line.id}: unresolved part identity")
        subject = f"part:{digest([category.pathstring, identity, line.ipn])}"
        if line.part_of:
            part = self.line_parts[line.part_of]
            self.line_parts[line.id] = part
            # Reference the usable Part output, not the earlier line's stock/evidence.
            return part, ()
        if self.options and category_pk is not None:
            from .stock_choices import part_choice
            existing = part_choice(self.api, line, category_pk=category_pk, identity_kind=category.identity,
                                  values=identity if category.identity == "spec" else values,
                                  keys=category.key_parameters,
                                  templates={name: row["pk"] for name, row in self.templates.items()},
                                  parameters=dict(self.parameters), options=self.options,
                                  manufacturer=self.manufacturers.get(line.id))
            candidates = [existing] if existing else []
        elif self.options and category_pk is None:
            candidates = []
        elif line.ipn:
            candidates = [r for r in list_rows(self.api, "part/", params={"IPN": line.ipn}) if r.get("IPN") == line.ipn]
        else:
            candidates = matching_parts(self.api, category_pk=category_pk, identity_kind=category.identity,
                                        designator=line.type, values=identity,
                                        templates={name: template["pk"] for name, template in self.templates.items()},
                                        parameters=self.parameters)
        existing = single(candidates, "part")
        values = part_parameters(category, values)
        payload = {"category": category_pk, "name": line.name or part_name(category, line.type or line.mpn, values, dict(self.parameters), line.description),
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
            if not part.baseline.values().get("pk") and ((line.name and line.name != frozen_payload.get("name"))
                    or (line.description and line.description[:250] != frozen_payload.get("description"))):
                raise PreparationReview("conflicting shared part metadata")
            if expected != values:
                raise PreparationReview("conflicting shared part parameters")
            self.add(Kind.PART, subject, action="part", payload=part.desired.values() | {},
                     baseline=part.baseline.values(), requires=part.requires, line=line)
            for gate in gates:
                parameter = self.operations[gate.operation]
                self.operations[gate.operation] = replace(parameter, attribution=Attribution(self.document.file_id,
                    tuple(dict.fromkeys((*parameter.attribution.lines, line.id)))))
            self.line_parts[line.id] = part
            return part, gates
        part = self.add(Kind.PART, subject, action="part", payload={"route": "part/", "model": "part.part", "payload": payload,
                        "identity_fields": fields, "parameters": values, "identity_kind": category.identity,
                        "type": line.type, "mpn": line.mpn or (line.type if category.identity == "mpn" else ""),
                        "manufacturer_operation": self.manufacturers[line.id].id if line.id in self.manufacturers else None,
                        "parameter_policies": {name: asdict(self.parameters[name]) for name in values}, "templates": {name: self.templates[name]["pk"] for name in values if name in self.templates}},
                        baseline={"pk": existing["pk"] if existing else None,
                                  "identity": record_identity(existing, tuple(fields)) if existing else None},
                        requires=(OutputRef(self.manufacturers[line.id].id, "record"),)
                                  if category.identity == "mpn" and line.id in self.manufacturers else (), line=line)
        gates = []
        for name, value in values.items():
            template = self.templates.get(name)
            if not template:
                raise PreparationReview(f"line {line.id}: missing parameter template {name}")
            parameter = self.add(Kind.PARAMETER, subject + ":" + name, action="parameter",
                                 payload={"template": template["pk"], "value": value},
                                 requires=(OutputRef(part.id, "record"),) +
                                          ((OutputRef(template["_operation"].id, "record"),) if "_operation" in template else ()), line=line)
            gates.append(OutputRef(parameter.id, "record"))
        self.parts[subject] = part, tuple(gates)
        self.line_parts[line.id] = part
        return part, tuple(gates)

    def company(self, line: StockLine) -> OperationSpec | None:
        if not line.supplier:
            if line.sku or line.order_reference:
                raise PreparationReview(f"line {line.id}: order/SKU requires supplier")
            return None
        if self.options:
            from .stock_enrichment import prepare_company
            return prepare_company(self, line, line.supplier, role="is_supplier")
        name, seller = split_marketplace(line.supplier)
        if seller:
            raise PreparationReview("marketplace seller enrichment requires prepare_full_stock")
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
                  parameters: Mapping[str, ParameterConfig], target: Target, api: StockAPI,
                  options: ImportOptions | None = None) -> Plan:
    """Return a genuinely resolved, immutable mutation preview; never write.

    Without options, existing taxonomy/templates/location and the bounded subset
    are required. The full library supplies options and explicit enrichment rows.
    Unsafe unresolved decisions raise PreparationReview before execution.
    """
    if normalize_endpoint(api.api_url) != normalize_endpoint(target.endpoint):
        raise PreparationReview("discovery API client target mismatch")
    if options is None:
        _unsupported(document)
    semantics = {"categories": {k: asdict(v) for k, v in categories.items()},
                 "parameters": {k: asdict(v) for k, v in parameters.items()}, "stock_subset": 1 if options is None else 2,
                 "options": {key: value for key, value in vars(options).items() if not callable(value)} if options else {}}
    plan = prepare_import(document, config_semantics=semantics, target=target, api=api,
                          discover=lambda read: DiscoverySnapshot((), "stock_v1"))
    preview = _Preview(document, api, parameters, options)
    server_categories = {r["pathstring"]: r for r in list_rows(api, "part/category/")}
    locations = {r["pathstring"]: r for r in list_rows(api, "stock/location/")}
    for line in document.lines:
        _prepare_line(preview, line, categories=categories, server_categories=server_categories, locations=locations)
    result = replace(plan, operations=tuple(preview.operations.values()), unsupported=(),
                     decisions=Inputs.freeze({**plan.decisions.values(), "source": document.source,
                                "line_inputs": {line.id: asdict(line) for line in document.lines}}),
                     schema_version=2 if options else 1)
    validate_plan(result)
    return result


def _prepare_line(preview: _Preview, line: StockLine, *, categories: Mapping[str, CategoryConfig],
                  server_categories: dict[str, dict], locations: dict[str, dict]) -> None:
    options = preview.options
    if options:
        from .stock_enrichment import validate_line_choice
        if not validate_line_choice(line, options):
            with barcode_lookup_request():
                existing = already_imported(preview.api, preview.document.key_for(line))
            if existing is None:
                preview.add(Kind.METADATA, "line:" + line.id, action="line_disposition",
                            payload={"outcome": "review", "reason": "confidence_review_required"}, provides=(), line=line)
                return
    category = categories.get(line.category) or match_path(line.category.split("/"), dict(categories))
    if line.part_of:
        part = preview.line_parts[line.part_of]
        category = preview.line_categories[line.part_of]
        gates = next((gates for resolved, gates in preview.parts.values() if resolved.id == part.id), ())
        preview.line_parts[line.id] = part
    elif not category or category.structural:
        if options and options.choose_category:
            chosen = options.choose_category(line, list(categories))
            category = chosen if isinstance(chosen, CategoryConfig) else categories.get(chosen)
        if not category or category.structural:
            raise PreparationReview(f"line {line.id}: unresolved category")
    if options and category and category.identity == "spec" and options.on_partial == "skip" and not line.ipn and not line.mpn:
        values = from_supplier(line.parameters, dict(preview.parameters), category.parameters)
        if set(category.key_parameters) - values.keys():
            preview.add(Kind.METADATA, "line:" + line.id, action="line_disposition",
                        payload={"outcome": "skip", "reason": "partial_specification"}, provides=(), line=line)
            return
    if category and category.pathstring not in server_categories:
        if options is None:
            raise PreparationReview(f"line {line.id}: unresolved category")
        from .stock_taxonomy import path_operation
        path_operation(preview, line, category.pathstring, model="part.partcategory", route="part/category/", existing=server_categories)
    if options and category:
        from .stock_taxonomy import prepare_templates
        prepare_templates(preview, line, category)
    if options and not line.location and options.default_location:
        line = replace(line, location=options.default_location)
    if line.location and line.location not in locations and options and options.create_locations:
        from .stock_taxonomy import path_operation
        path_operation(preview, line, line.location, model="stock.stocklocation", route="stock/location/", existing=locations)
    if not line.location or line.location not in locations:
        raise PreparationReview(f"line {line.id}: requested location unresolved")
    if options and line.manufacturer:
        from .stock_enrichment import prepare_company
        manufacturer = prepare_company(preview, line, line.manufacturer, role="is_manufacturer")
        if manufacturer:
            preview.manufacturers[line.id] = manufacturer
    if not line.part_of:
        part, gates = preview.part(line, category, server_categories[category.pathstring]["pk"])
        category_operation = server_categories[category.pathstring].get("_operation")
        if category_operation:
            part = replace(part, requires=tuple(dict.fromkeys((*part.requires, OutputRef(category_operation.id, "record")))))
            preview.operations[part.id] = part
            preview.line_parts[line.id] = part
            for key, (cached, cached_gates) in preview.parts.items():
                if cached.id == part.id:
                    preview.parts[key] = part, cached_gates
    preview.line_categories[line.id] = category
    supplier = preview.company(line)
    manufacturer_part = None
    if options:
        from .stock_enrichment import prepare_manufacturer_part
        manufacturer_part = prepare_manufacturer_part(preview, line, part, category)
    supplier_part = _supplier_part(preview, line, part, supplier, manufacturer_part)
    order = _order(preview, line, supplier)
    if options and order and not options.create_orders and not order.baseline.values().get("pk"):
        raise PreparationReview("purchase order creation disabled")
    _stock(preview, line, part, gates, supplier_part, order, locations)
    if options:
        from .stock_enrichment import prepare_enrichment
        prepare_enrichment(preview, line, part, manufacturer_part, supplier_part, order, category)


def _supplier_part(preview: _Preview, line: StockLine, part: OperationSpec,
                   supplier: OperationSpec | None, manufacturer_part: OperationSpec | None = None) -> OperationSpec | None:
    if not line.sku:
        if line.order_reference:
            raise PreparationReview("PO line requires a supplier SKU")
        return None
    if supplier is None:
        if preview.options:
            return None
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
                       payload={"SKU": line.sku.strip().upper(), "description": line.description[:250],
                                "link": line.supplier_link or line.link},
                       baseline={"pk": existing["pk"] if existing else None,
                                 "identity": record_identity(existing, ("part", "supplier", "SKU")) if existing else None},
                       requires=(OutputRef(part.id, "record"), OutputRef(supplier.id, "record")) +
                                ((OutputRef(manufacturer_part.id, "record"),) if manufacturer_part else ()), line=line)


def _order(preview: _Preview, line: StockLine, supplier: OperationSpec | None) -> OperationSpec | None:
    if not line.order_reference or (preview.options and not preview.options.create_orders):
        return None
    if supplier is None:
        if preview.options:
            return None
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
            raise PreparationReview("multiple new purchase order allocations require a verified target allocator contract")
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
        if preview.options is None or not order.baseline.values().get("pk"):
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
    location_operation = locations[line.location].get("_operation")
    if location_operation:
        requires += (OutputRef(location_operation.id, "record"),)
    if supplier_part:
        requires += (OutputRef(supplier_part.id, "record"),)
    stock = preview.add(Kind.STOCK, key, action="stock", payload={"payload": payload, "key": key},
                        baseline={"pk": owner}, requires=requires, line=line)
    barcode = preview.add(Kind.BARCODE, key, action="barcode", payload={"key": key},
                          requires=(OutputRef(stock.id, "record"),), line=line)
    preview.add(Kind.METADATA, key, action="tags", payload={"tags": line.tags},
                requires=(OutputRef(stock.id, "record"), OutputRef(barcode.id, "record")), line=line)
    if order and supplier_part and not owner:
        contribution = preview.add(Kind.METADATA, key, action="order_line", payload={"quantity": line.quantity, "unit_price": line.unit_price, "currency": line.currency},
                                    requires=(OutputRef(order.id, "record"), OutputRef(supplier_part.id, "record")), line=line)
        preview.add(Kind.METADATA, key, action="order_link", payload={},
                    requires=(OutputRef(stock.id, "record"), OutputRef(order.id, "record"), OutputRef(contribution.id, "record")), line=line)
