"""Plan explicit category/template/location creation before record consumption."""
from __future__ import annotations

from typing import TYPE_CHECKING

from ..config import CategoryConfig
from ..stockfile import StockLine
from .models import Kind, OperationSpec, OutputRef
from .stock_preparation import PreparationReview

if TYPE_CHECKING:
    from .stock_preparation import DomainPreview


def path_operation(preview: DomainPreview, line: StockLine, path: str, *, model: str,
                   route: str, existing: dict[str, dict]) -> dict:
    current = []
    parent: OperationSpec | None = None
    parent_pk = None
    for name in path.split("/"):
        if not name.strip():
            raise PreparationReview("empty taxonomy path segment")
        current.append(name)
        key = "/".join(current)
        if key in existing:
            row = existing[key]
            parent = row.get("_operation")
            parent_pk = row.get("pk")
            continue
        operation = preview.add(Kind.METADATA, model + ":" + key, action="taxonomy",
            payload={"model": model, "route": route, "payload": {"name": name, "parent": parent_pk},
                     "identity_fields": ["name", "parent"]},
            requires=(OutputRef(parent.id, "record"),) if parent else (), line=line)
        row = {"pk": None, "pathstring": key, "_operation": operation}
        existing[key] = row
        parent, parent_pk = operation, None
    return existing[path]


def prepare_templates(preview: DomainPreview, line: StockLine, category: CategoryConfig) -> None:
    for name in category.parameters:
        if name in preview.templates:
            continue
        parameter = preview.parameters.get(name)
        if parameter is None:
            raise PreparationReview(f"unconfigured parameter template {name}")
        operation = preview.add(Kind.METADATA, "template:" + name, action="taxonomy",
            payload={"model": "common.parametertemplate", "route": "parameter/template/",
                     "payload": {"name": name, "units": parameter.units}, "identity_fields": ["name"]}, line=line)
        preview.templates[name] = {"pk": None, "name": name, "_operation": operation}


def prepare_location(preview: DomainPreview, line: StockLine, requested: str) -> dict:
    """Resolve the shared escaped-name syntax by name and parent identity."""
    from ..inventree.stock import location_names
    names = location_names(requested)
    parent_pk = None
    parent_operation = None
    walked = []
    for name in names:
        walked.append(name)
        parent_id = parent_operation.id if parent_operation else None
        candidates = [row for row in preview.location_rows if str(row.get("name", "")).casefold() == name.casefold()
                      and row.get("parent") == parent_pk and row.get("_parent_operation") == parent_id]
        if len(candidates) > 1:
            raise PreparationReview("ambiguous requested location name/parent")
        if candidates:
            row = candidates[0]
        else:
            if not preview.options.create_locations:
                raise PreparationReview(f"line {line.id}: requested location unresolved")
            operation = preview.add(Kind.METADATA, "location:" + repr(walked), action="taxonomy",
                payload={"model": "stock.stocklocation", "route": "stock/location/",
                         "payload": {"name": name, "parent": parent_pk}, "identity_fields": ["name", "parent"]},
                requires=(OutputRef(parent_operation.id, "record"),) if parent_operation else (), line=line)
            row = {"pk": None, "name": name, "parent": parent_pk, "_parent_operation": parent_id, "_operation": operation}
            preview.location_rows.append(row)
        parent_pk, parent_operation = row["pk"], row.get("_operation")
    if not names:
        raise PreparationReview(f"line {line.id}: requested location unresolved")
    return row
