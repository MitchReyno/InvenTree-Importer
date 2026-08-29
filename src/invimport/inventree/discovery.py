"""
Find supplier parameters a category does not yet map, and file them.

    from invimport.inventree.discovery import discover, file_discovery

    found = discover(products, categories, parameters)
    for item in found:
        print(item.category, item.supplier_name, item.suggestion.units)

A new category starts with no parameters at all, and DigiKey sends far more
than are worth keeping - 264 distinct names across the products in the cache,
most of them dimensions and packaging trivia. Discovery reports which ones a
category is seeing but not importing, and what they look like, so the choice
of key parameter / ordinary parameter / ignore can be made once and recorded.

The library does not prompt. It reports what it found and, given a decision,
writes it back to the config. The command layer asks the questions.

Nothing is decided automatically. A parameter filed as a key parameter changes
what makes two parts the same part, which is not a guess worth making on
someone's behalf.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from ..config import (
    CONFIG_DIR,
    CategoryConfig,
    ParameterConfig,
    add_list_item,
    format_yaml_key,
    load_categories_config,
    load_parameters_config,
)
from .matching import match_path
from .values import (
    build_parse_registry,
    is_absent,
    split_magnitude,
    split_range,
)

log = logging.getLogger(__name__)

# How a discovered parameter may be filed.
KEY = "key"
OTHER = "other"
IGNORE = "ignore"
SKIP = "skip"

# Sample values kept per discovery, for the prompt to show.
SAMPLE_LIMIT = 6

# A value set no larger than this looks like a fixed vocabulary rather than a
# free measurement, so it is offered as `choices`.
CHOICES_LIMIT = 8


@dataclass
class Suggestion:
    """What a discovered parameter looks like, inferred from its values."""
    units: str = ""
    parse: str = ""
    choices: list[str] = field(default_factory=list)
    # Set when the values are ranges ("-55°C ~ 155°C"), which need two
    # parameters rather than one.
    ranged: bool = False

    def describe(self) -> str:
        bits = []
        if self.units:
            bits.append(f"units {self.units}")
        if self.parse:
            bits.append(f"parse {self.parse}")
        if self.choices:
            bits.append(f"{len(self.choices)} "
                        f"choice{'' if len(self.choices) == 1 else 's'}")
        if self.ranged:
            bits.append("a range - needs two parameters")
        return ", ".join(bits) or "text"


@dataclass
class Discovery:
    """One supplier parameter seen on a category but not imported from it."""
    category: str                                # InvenTree category pathstring
    supplier_name: str                           # DigiKey's ParameterText
    count: int = 0                               # products carrying it
    values: list[str] = field(default_factory=list)
    suggestion: Suggestion = field(default_factory=Suggestion)
    # Set when a configured parameter already lists this supplier name, so the
    # category only needs to start using it.
    existing_parameter: str = ""

    def sample(self) -> str:
        return ", ".join(self.values[:SAMPLE_LIMIT])


# --------------------------------------------------------------------------
# Inferring what a parameter is
# --------------------------------------------------------------------------
def infer(values: list[str], registry=None) -> Suggestion:
    """
    Guess units, parse mode and choices from the values a parameter takes.

    A guess, offered for confirmation - never applied on its own. Ranges are
    flagged rather than resolved, because "-55°C ~ 155°C" is two parameters
    and only a human can say what to call them.
    """
    registry = registry or build_parse_registry()
    usable = [v for v in values if not is_absent(v)]
    if not usable:
        return Suggestion()

    if all(split_range(value) for value in usable):
        low = [split_range(v)[0] for v in usable]
        inner = infer(low, registry)
        return Suggestion(units=inner.units, parse="range_low",
                          choices=[], ranged=True)

    if all(value.strip().endswith("%") for value in usable):
        return Suggestion(units="%", parse="percent")

    units = Counter()
    numeric = 0
    for value in usable:
        magnitude, unit = split_magnitude(value)
        if magnitude is None:
            continue
        numeric += 1
        if unit:
            units[unit] += 1

    # Mostly numbers: a measurement. The commonest unit spelling wins, and is
    # only kept if pint can actually resolve it.
    if numeric >= max(1, len(usable) - len(usable) // 4):
        unit = ""
        for candidate, _ in units.most_common():
            try:
                if candidate in registry:
                    unit = candidate
                    break
            except Exception:
                continue
        return Suggestion(units=unit, parse="quantity" if unit else "")

    distinct = sorted({value.strip() for value in usable})
    if len(distinct) <= CHOICES_LIMIT:
        return Suggestion(choices=distinct)
    return Suggestion()


# --------------------------------------------------------------------------
# Finding what is missing
# --------------------------------------------------------------------------
def supplier_names(parameters: dict[str, ParameterConfig]) -> dict[str, str]:
    """{supplier spelling (folded): our parameter name} across the config."""
    index: dict[str, str] = {}
    for parameter in parameters.values():
        for name in parameter.supplier_names():
            index.setdefault(name.strip().casefold(), parameter.name)
    return index


def discover(
    products: Iterable[dict[str, Any]],
    categories: dict[str, CategoryConfig],
    parameters: dict[str, ParameterConfig],
) -> list[Discovery]:
    """
    Supplier parameters each category is seeing but not importing.

    A parameter is reported when the category's parameter list does not
    already cover it, it is not on the category's ignore list, and at least
    one product carried a real value for it. Ordered by how many products
    carried it, so the ones worth deciding about come first.
    """
    index = supplier_names(parameters)
    found: dict[tuple[str, str], Discovery] = {}

    for product in products:
        category = match_path(product.get("category_path") or [], categories)
        if category is None:
            continue

        # What this category already reads, by supplier spelling.
        covered = {
            name.strip().casefold()
            for parameter_name in category.parameters
            for name in (parameters[parameter_name].supplier_names()
                         if parameter_name in parameters else [])
        }
        ignored = {name.strip().casefold() for name in category.ignore}

        for supplier_name, value in (product.get("parameters") or {}).items():
            folded = supplier_name.strip().casefold()
            if folded in covered or folded in ignored or is_absent(value):
                continue

            key = (category.pathstring, supplier_name)
            item = found.get(key)
            if item is None:
                item = Discovery(category.pathstring, supplier_name,
                                 existing_parameter=index.get(folded, ""))
                found[key] = item
            item.count += 1
            if value not in item.values:
                item.values.append(value)

    registry = build_parse_registry()
    for item in found.values():
        item.suggestion = infer(item.values, registry)

    return sorted(found.values(),
                  key=lambda d: (d.category, -d.count, d.supplier_name))


# --------------------------------------------------------------------------
# Writing a decision back
# --------------------------------------------------------------------------
def parameter_block(name: str, supplier_name: str,
                    suggestion: Suggestion) -> str:
    """A parameters.yaml entry for a newly named parameter."""
    lines = [f"{format_yaml_key(name)}:"]
    if suggestion.units:
        lines.append(f"  units: {format_yaml_key(suggestion.units)}")
    if suggestion.parse:
        lines.append(f"  parse: {suggestion.parse}")
    if suggestion.choices:
        lines.append("  choices:")
        lines.extend(f"    - {format_yaml_key(choice)}"
                     for choice in suggestion.choices)
    lines.append("  aliases:")
    lines.append(f"    - {format_yaml_key(supplier_name)}")
    return "\n".join(lines) + "\n"


def file_discovery(
    item: Discovery,
    decision: str,
    parameter_name: str,
    categories: dict[str, CategoryConfig],
    parameters: dict[str, ParameterConfig],
    directory: Path | None = None,
) -> list[str]:
    """
    Record one decision in the config. Returns what changed, for reporting.

    KEY files the parameter under the category's key_parameters *and*
    parameters - a key parameter has to be one of the category's parameters
    for the config to be consistent. OTHER files it under parameters only.
    IGNORE adds the supplier name to the category's ignore list so it is not
    offered again. SKIP writes nothing.
    """
    if decision == SKIP:
        return []

    directory = Path(directory) if directory is not None else CONFIG_DIR
    categories_file = directory / "categories.yaml"
    parameters_file = directory / "parameters.yaml"
    category = categories.get(item.category)
    if category is None:
        raise KeyError(f"unknown category {item.category!r}")
    changed: list[str] = []

    if decision == IGNORE:
        if add_list_item(categories_file, category.path, "ignore",
                         item.supplier_name):
            changed.append(f"{item.category}: ignore {item.supplier_name!r}")
        return changed

    # Define the parameter if it is new, or teach the existing one this
    # supplier's spelling.
    if parameter_name not in parameters:
        block = parameter_block(parameter_name, item.supplier_name,
                                item.suggestion)
        text = parameters_file.read_text(encoding="utf-8") if \
            parameters_file.exists() else ""
        if text and not text.endswith("\n"):
            text += "\n"
        parameters_file.write_text(f"{text}\n{block}", encoding="utf-8")
        changed.append(f"parameters.yaml: + {parameter_name}")
    elif item.supplier_name not in parameters[parameter_name].supplier_names():
        if add_list_item(parameters_file, [parameter_name], "aliases",
                         item.supplier_name):
            changed.append(f"{parameter_name}: alias {item.supplier_name!r}")

    if parameter_name not in category.parameters:
        if add_list_item(categories_file, category.path, "parameters",
                         parameter_name):
            changed.append(f"{item.category}: parameters += {parameter_name}")

    if decision == KEY and parameter_name not in category.key_parameters:
        if add_list_item(categories_file, category.path, "key_parameters",
                         parameter_name):
            changed.append(
                f"{item.category}: key_parameters += {parameter_name}")

    return changed


def reload(directory: Path | None = None
           ) -> tuple[dict[str, CategoryConfig], dict[str, ParameterConfig]]:
    """Re-read the config after writing, so later decisions see the change."""
    return (load_categories_config(directory),
            load_parameters_config(directory))
