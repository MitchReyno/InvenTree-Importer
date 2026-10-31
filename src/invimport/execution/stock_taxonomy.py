"""Plan explicit category/template/location creation before record consumption."""
from __future__ import annotations

from typing import TYPE_CHECKING

from ..config import CategoryConfig
from ..stockfile import StockLine
from .models import Kind, OperationSpec, OutputRef
from .stock_preparation import PreparationReview

if TYPE_CHECKING:
    from .stock_preparation import _Preview


def path_operation(preview: _Preview, line: StockLine, path: str, *, model: str,
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


def prepare_templates(preview: _Preview, line: StockLine, category: CategoryConfig) -> None:
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
