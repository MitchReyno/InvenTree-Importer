"""Plan company relationships, model-owned values and selected enrichment."""
from __future__ import annotations

from typing import TYPE_CHECKING

from .. import notes
from ..inventree.collections import list_rows
from ..inventree.matching import normalise
from ..inventree.part_policy import manufacturer_number
from ..inventree.purchase_orders import split_marketplace
from ..inventree.stockimport import ImportOptions, LineAction
from ..inventree.values import from_supplier
from ..stockfile import StockLine
from ..util import absolute_url
from .models import Kind, OperationSpec, OutputRef
from .stock_preparation import PreparationReview, record_identity, single

if TYPE_CHECKING:
    from ..config import CategoryConfig
    from .stock_preparation import _Preview


def validate_line_choice(line: StockLine, options: ImportOptions) -> bool:
    low = line.confidence is not None and line.confidence < options.min_confidence
    if low or line.needs_review:
        if options.confirm_line is None or not options.confirm_line(line, LineAction(line.id, action="review")):
            return False
    return True


def prepare_company(preview: _Preview, line: StockLine, name: str, *, role: str) -> OperationSpec | None:
    from .stock_choices import company_choice
    options = preview.options
    callback = options.choose_supplier if role == "is_supplier" else options.choose_manufacturer
    company_name, _ = split_marketplace(name) if role == "is_supplier" else (name, "")
    company_name, existing, approved_create = company_choice(preview.api, company_name, role=role, callback=callback if not (options.create_suppliers if role == "is_supplier" else options.create_manufacturers) else None)
    create = options.create_suppliers if role == "is_supplier" else options.create_manufacturers
    if existing is None and not create and not approved_create:
        return None
    payload = {"name": existing["name"] if existing else company_name, role: True}
    # Supplier remains part of the v1 company output identity for historical plans.
    payload["is_supplier"] = existing.get("is_supplier", False) if existing else role == "is_supplier"
    if existing is None:
        if options.create_suppliers and any(normalise(split_marketplace(item.supplier)[0]) == normalise(company_name) for item in preview.document.lines if item.supplier):
            payload["is_supplier"] = True
        if options.create_manufacturers and any(normalise(item.manufacturer) == normalise(company_name) for item in preview.document.lines if item.manufacturer):
            payload["is_manufacturer"] = True
    return preview.add(Kind.COMPANY, f"company:{normalise(company_name)}", action="supplier",
                       payload={"route": "company/", "model": "company.company", "payload": payload,
                                "identity_fields": ["name", "is_supplier"]},
                       baseline={"pk": existing["pk"] if existing else None,
                                 "identity": record_identity(existing, ("name", "is_supplier")) if existing else None}, line=line)


def prepare_parameters(preview: _Preview, line: StockLine, target: OperationSpec,
                       values: dict[str, str]) -> None:
    for name, value in values.items():
        template = preview.templates.get(name)
        if not template:
            raise PreparationReview(f"missing parameter template {name}; synchronize categories before preparing")
        preview.add(Kind.PARAMETER, target.subject + ":" + name, action="parameter",
                    payload={"template": template["pk"], "value": value},
                    requires=(OutputRef(target.id, "record"),) +
                             ((OutputRef(template["_operation"].id, "record"),) if "_operation" in template else ()), line=line)


def prepare_manufacturer_part(preview: _Preview, line: StockLine, part: OperationSpec,
                              category: CategoryConfig) -> OperationSpec | None:
    if not line.manufacturer:
        return None
    company = preview.manufacturers.get(line.id)
    if company is None:
        return None
    number = manufacturer_number(mpn=line.mpn, designator=line.type)
    if not number:
        return None
    part_pk, company_pk = part.baseline.values().get("pk"), company.baseline.values().get("pk")
    rows = list_rows(preview.api, "company/part/manufacturer/", params={"MPN": number})
    matches = [row for row in rows if row.get("part") == part_pk and row.get("manufacturer") == company_pk]
    existing = single(matches, "manufacturer part")
    payload = {"MPN": number, "description": line.description[:250]}
    if absolute_url(line.datasheet):
        payload["link"] = line.datasheet
    operation = preview.add(Kind.METADATA, company.subject + ":mpn:" + number + ":" + part.subject,
        action="manufacturer_part", payload=payload,
        baseline={"pk": existing["pk"] if existing else None,
                  "identity": record_identity(existing, ("part", "manufacturer", "MPN")) if existing else None},
        requires=(OutputRef(part.id, "record"), OutputRef(company.id, "record")), line=line)
    prepare_parameters(preview, line, operation, from_supplier(line.parameters, dict(preview.parameters), category.parameters))
    return operation


def _notes(preview: _Preview, line: StockLine, target: OperationSpec | None, text: str) -> None:
    if target and text:
        preview.add(Kind.METADATA, target.subject + ":notes", action="notes",
                    payload={"text": text}, requires=(OutputRef(target.id, "record"),), line=line)


def prepare_enrichment(preview: _Preview, line: StockLine, part: OperationSpec,
                       manufacturer_part: OperationSpec | None, supplier_part: OperationSpec | None,
                       order: OperationSpec | None, category: CategoryConfig) -> None:
    from .stock_assets import prepare_asset
    stock = next(op for op in preview.operations.values() if op.kind == Kind.STOCK and line.id in op.attribution.lines)
    _notes(preview, line, part, notes.render(line.part_notes, notes.PART_SECTIONS))
    _notes(preview, line, manufacturer_part, notes.render(line.manufacturer_part_notes, notes.MANUFACTURER_PART_SECTIONS))
    _notes(preview, line, stock, notes.stock_notes(line.notes, seller=split_marketplace(line.supplier)[1],
           approximate=line.approximate, source_file=preview.document.path.name if preview.document.path else ""))
    if supplier_part:
        prepare_parameters(preview, line, supplier_part, from_supplier(line.parameters, dict(preview.parameters), category.parameters))
    link = absolute_url(line.datasheet) or absolute_url(line.link)
    if link:
        preview.add(Kind.METADATA, part.subject + ":link", action="empty_field",
                    payload={"field": "link", "text": link}, requires=(OutputRef(part.id, "record"),), line=line)
    for source, comment in line.attachments:
        prepare_asset(preview, line, part, source, comment=comment)
    images = list(dict.fromkeys([image for image in [line.image, *line.images] if image]))
    for index, source in enumerate(images):
        prepare_asset(preview, line, part, source, image=index == 0)
    for source in line.stock_images:
        prepare_asset(preview, line, stock, source)
    if line.datasheet and (not absolute_url(line.datasheet) or preview.options.mirror_datasheets):
        for target in [part, manufacturer_part]:
            if target:
                prepare_asset(preview, line, target, line.datasheet, comment="Datasheet", pages=line.datasheet_pages)
    invoice = line.order.get("invoice")
    if invoice and order:
        source = invoice.get("file") if isinstance(invoice, dict) else invoice
        prepare_asset(preview, line, order, source, comment="Invoice")
    for company in list(preview.operations.values()):
        if company.kind != Kind.COMPANY or line.id not in company.attribution.lines:
            continue
        name = company.desired.values()["payload"]["name"]
        logo = next((entry.get("image") for key, entry in preview.document.companies.items()
                     if normalise(key) == normalise(name)), None)
        if logo:
            prepare_asset(preview, line, company, logo, image=True, only_created=True)
