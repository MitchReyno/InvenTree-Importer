"""Read-only matching decisions. Callbacks end at the frozen preview boundary."""
from __future__ import annotations

from types import SimpleNamespace
from typing import Callable, NoReturn

from ..config import ParameterConfig
from ..inventree.collections import list_rows
from ..inventree.matching import candidates, normalise
from ..inventree.parts import answers_to
from ..inventree.stockimport import ImportOptions
from ..stockfile import StockLine
from .models import OperationSpec
from .stock_api import StockAPI
from .stock_preparation import PreparationReview, single


def choose_row(rows: list[dict], callback: Callable | None, *arguments: object) -> dict | None:
    if callback is None:
        return single(rows, "matching records")
    models = [SimpleNamespace(**row) for row in rows]
    chosen = callback(*arguments, models)
    if chosen is None:
        raise PreparationReview("matching decision declined")
    if chosen == "new":
        return None
    pk = getattr(chosen, "pk", None)
    return next((row for row in rows if row["pk"] == pk), None) or _invalid_choice()


def _invalid_choice() -> NoReturn:
    raise PreparationReview("callback selected a record outside the offered candidates")


def company_choice(api: StockAPI, name: str, *, role: str, callback: Callable | None) -> tuple[str, dict | None, bool]:
    rows = list_rows(api, "company/", params={role: True})
    exact = [row for row in rows if normalise(row.get("name", "")) == normalise(name)]
    if exact:
        return name, single(exact, role), False
    if callback:
        scores = candidates(name, [row["name"] for row in rows])
        offered = [(SimpleNamespace(**row), score) for label, score in scores for row in rows if row["name"] == label]
        chosen = callback(name, offered)
        if chosen is None:
            return name, None, False
        if isinstance(chosen, str):
            return chosen, None, True
        pk = getattr(chosen, "pk", None)
        row = next((row for row in rows if row["pk"] == pk), None)
        if row is None:
            _invalid_choice()
        return row["name"], row, False
    return name, None, False


def part_choice(api: StockAPI, line: StockLine, *, category_pk: int, identity_kind: str,
                values: dict[str, str], keys: list[str], templates: dict[str, int],
                parameters: dict[str, ParameterConfig], options: ImportOptions, manufacturer: OperationSpec | None = None) -> dict | None:
    from .stock_preparation import matching_parts
    if line.ipn:
        rows = [row for row in list_rows(api, "part/", params={"IPN": line.ipn}) if row.get("IPN") == line.ipn]
        if rows:
            return single(rows, "IPN")
    number = line.mpn or (line.type if identity_kind == "mpn" else "")
    if number:
        filters = {"MPN": number}
        manufacturer_pk = manufacturer.baseline.values().get("pk") if manufacturer else None
        if manufacturer_pk:
            filters["manufacturer"] = manufacturer_pk
        relationships = list_rows(api, "company/part/manufacturer/", params=filters) if manufacturer_pk or not line.manufacturer else []
        parts = {row["part"] for row in relationships}
        if len(parts) > 1:
            raise PreparationReview("MPN identifies several Parts; explicit IPN required")
        if parts:
            return api.get(f"part/{next(iter(parts))}/")
        named = [row for row in list_rows(api, "part/", params={"category": category_pk})
                 if answers_to(SimpleNamespace(**row), number)]
        if named:
            if options.choose_name_match is None:
                raise PreparationReview("name match requires explicit choice")
            return choose_row(named, options.choose_name_match, line)
    if identity_kind == "spec" and set(keys) - values.keys():
        if not values:
            raise PreparationReview("specification has no identifying facts")
        offered = matching_parts(api, category_pk=category_pk, identity_kind="spec", designator="",
                                 values=values, templates=templates, parameters=parameters)
        if options.choose_part:
            return choose_row(offered, options.choose_part, line)
        if options.on_partial == "new":
            return None
        raise PreparationReview("partial specification requires explicit choice")
    if identity_kind == "mpn":
        if not number:
            raise PreparationReview("MPN identity requires MPN or type")
        return None
    rows = matching_parts(api, category_pk=category_pk, identity_kind=identity_kind,
                          designator=line.type, values=values, templates=templates, parameters=parameters)
    return choose_row(rows, options.choose_part, line) if len(rows) > 1 else single(rows, "part")
