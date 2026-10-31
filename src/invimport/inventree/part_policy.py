"""Pure ownership decisions shared by legacy and durable import preparation."""
from __future__ import annotations

from typing import Mapping

from ..config import CategoryConfig


def part_parameters(category: CategoryConfig, values: Mapping[str, str]) -> dict[str, str]:
    """A shared spec Part carries identity facts; maker/SKU models carry all."""
    if category.identity == "spec" and category.key_parameters:
        return {name: value for name, value in values.items() if name in category.key_parameters}
    return dict(values)


def manufacturer_number(*, mpn: str, designator: str) -> str:
    return mpn or designator
