"""Shared Part/manufacturer/SKU preparation without inventory lot operations."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Mapping

from ..config import CategoryConfig, ParameterConfig
from ..inventree.collections import list_rows
from ..inventree.matching import match_path
from ..inventree.parts import PartLine
from ..inventree.stockimport import ImportOptions
from ..inventree.values import from_supplier
from ..stockfile import StockLine
from .models import Kind, OperationSpec
from .stock_api import StockAPI
from .stock_enrichment import prepare_company, prepare_manufacturer_part, prepare_parameters
from .records import record_identity
from .stock_preparation import DomainPreview, PreparationReview, _supplier_part


@dataclass
class ComponentSource:
    """Only the source identity and normalized model inputs; no stockfile adapter."""
    file_id: str
    lines: list[StockLine]


def prepare_component_models(source_id: str, products: Mapping[str, dict], *, supplier: dict,
                             api: StockAPI, categories: Mapping[str, CategoryConfig],
                             parameters: Mapping[str, ParameterConfig], options: ImportOptions
                             ) -> tuple[tuple[OperationSpec, ...], dict[str, OperationSpec]]:
    """Reuse stock-domain identity/ownership builders, selecting model work only.

    The caller supplies already-fetched product rows and resolved supplier choice.
    No direct stock, barcode, PO, receipt, archive or download operation is planned.
    Missing taxonomy/templates and unresolved identity choices fail preparation.
    """
    lines = []
    chosen = {}
    for sku, product in products.items():
        description = PartLine.from_product(product)
        category = match_path(description.category_path, dict(categories))
        if category is None or category.structural:
            raise PreparationReview("DigiKey product category must be mapped before durable preparation")
        line = StockLine(id="sku:" + sku.upper(), sku=sku, supplier=supplier["name"],
                         category=category.pathstring, mpn=description.mpn, manufacturer=description.manufacturer,
                         name=description.name, description=description.description, parameters=description.parameters,
                         supplier_link=description.link, datasheet=description.datasheet)
        if not line.mpn or not line.manufacturer:
            raise PreparationReview("DigiKey product needs a manufacturer and manufacturer part number")
        lines.append(line)
        chosen[line.id] = category
    preview = DomainPreview(ComponentSource(source_id, lines), api, parameters, options)
    server_categories = {row["pathstring"]: row for row in list_rows(api, "part/category/")}
    supplied = {}
    for line in lines:
        category = chosen[line.id]
        if category.pathstring not in server_categories:
            raise PreparationReview("DigiKey category must exist on the server before durable preparation")
        if category.identity == "spec" and set(category.key_parameters) - from_supplier(line.parameters, dict(parameters), category.parameters).keys():
            raise PreparationReview("DigiKey partial specification requires an explicit complete component input")
        manufacturer = prepare_company(preview, line, line.manufacturer, role="is_manufacturer")
        if manufacturer is None:
            raise PreparationReview("DigiKey manufacturer choice is unresolved")
        preview.manufacturers[line.id] = manufacturer
        part, gates = preview.part(line, category, server_categories[category.pathstring]["pk"])
        company = preview.add(Kind.COMPANY, f"supplier-pk:{supplier['pk']}", action="supplier",
            payload={"route": "company/", "model": "company.company",
                     "payload": {"name": supplier["name"], "is_supplier": True}, "identity_fields": ["name", "is_supplier"]},
            baseline={"pk": supplier["pk"], "identity": record_identity(supplier, ("name", "is_supplier"))}, line=line)
        maker_part = prepare_manufacturer_part(preview, line, part, category)
        sku = _supplier_part(preview, line, part, company, maker_part)
        sku = replace(sku, requires=tuple(dict.fromkeys((*sku.requires, *gates))))
        preview.operations[sku.id] = sku
        prepare_parameters(preview, line, sku, from_supplier(line.parameters, dict(parameters), category.parameters))
        supplied[line.sku.upper()] = sku
    return tuple(preview.operations.values()), supplied
