"""
Interactive filing of supplier parameters and choice spellings.

Used by supplier-parts (and import-orders --create-parts) when a DigiKey
field is not mapped, or a choices-parameter is sent a spelling it does not
allow. Answers are written to the YAML config so the same question is not
asked twice. Templates are synced to the server only when the caller is
writing.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import PARSE_KINDS, ParameterConfig, load_parameters_config
from ..inventree.discovery import (
    IGNORE,
    KEY,
    OTHER,
    SKIP,
    Discovery,
    Suggestion,
    UnknownChoice,
    file_choice,
    file_discovery,
    reload,
)
from ..inventree.matching import candidates, name_ratio, parameter_candidates
from ..inventree.parameters import sync_templates
from ..inventree.values import NAME_PREFIX_SCALE
from . import _prompt

MAP = "map"
CREATE = "create"


def _ask_default(prompt: str, default: str = "") -> str | None:
    suffix = f" [{default}]" if default else ""
    typed = _prompt.ask(f"  {prompt}{suffix} > ")
    if typed is None:
        return None
    return typed or default


def _comma_list(text: str) -> list[str]:
    return [part.strip() for part in text.split(",") if part.strip()]


# --------------------------------------------------------------------------
# Unmapped supplier parameters
# --------------------------------------------------------------------------
def parameter_actions(
    item: Discovery, parameters: dict[str, ParameterConfig],
) -> list[tuple[str, str, str]]:
    """
    Menu rows for one unmapped field: (action, mapped_name, label).

    Similar existing parameters (and one already defined under this
    supplier name) are offered as one-keystroke mappings. mapped_name is
    empty for create / ignore / skip, and for 'map to a different one'.
    """
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    if item.existing_parameter and item.existing_parameter in parameters:
        rows.append((
            MAP, item.existing_parameter,
            f"map to {item.existing_parameter} (already defined)"))
        seen.add(item.existing_parameter)
    for name, score in parameter_candidates(item.supplier_name, parameters):
        if name in seen:
            continue
        rows.append((MAP, name, f"map to {name}  [{score:.0%} similar]"))
        seen.add(name)
    map_label = ("map to a different parameter" if seen
                 else "map to an existing parameter (as an alias)")
    rows.append((MAP, "", map_label))
    rows.append((CREATE, "", "create a new parameter"))
    rows.append((IGNORE, "", "ignore for this category"))
    rows.append((SKIP, "", "skip (ask again next time)"))
    return rows


def ask_parameter_action(
    item: Discovery, parameters: dict[str, ParameterConfig],
) -> tuple[str, str] | None:
    title = (f"{item.category}\n"
             f"  {item.supplier_name}  (on {item.count} product"
             f"{'' if item.count == 1 else 's'})\n"
             f"  values: {item.sample()}\n"
             f"  looks like: {item.suggestion.describe()}")
    if item.existing_parameter:
        title += (f"\n  already defined as {item.existing_parameter!r} "
                  f"(not used by this category yet)")
    if item.suggestion.ranged:
        title += ("\n  note: a range needs two parameters (min and max); "
                  "creating one files the low end")
    options = parameter_actions(item, parameters)
    picked = _prompt.choose_one(
        options, lambda c: c[2], title=title, prompt="  > ")
    return None if picked is None else (picked[0], picked[1])


def ask_existing_parameter(
    item: Discovery, parameters: dict[str, ParameterConfig],
) -> str | None:
    names = sorted(parameters)
    offered: list[str] = []
    labels: dict[str, str] = {}
    if item.existing_parameter:
        offered.append(item.existing_parameter)
        labels[item.existing_parameter] = (
            f"use {item.existing_parameter} (already defined)")
    for name, score in parameter_candidates(item.supplier_name, parameters):
        if name not in offered:
            offered.append(name)
            labels[name] = f"use {name}  [{score:.0%} similar]"
    rest = [name for name in names if name not in offered]

    options: list[tuple[str, str]] = [
        (name, labels.get(name, f"use {name}")) for name in offered]
    if rest:
        if len(rest) <= 12:
            options.extend((name, f"use {name}") for name in rest)
        else:
            options.append(("__all__", "pick from all parameters..."))
    options.append(("__type__", "type a name"))

    picked = _prompt.choose_one(
        options, lambda o: o[1],
        title=f"  map {item.supplier_name!r} to:",
        prompt="  parameter > ")
    if picked is None:
        return None
    name = picked[0]
    if name == "__all__":
        picked = _prompt.choose_one(
            [(n, n) for n in names], lambda o: o[1],
            title="  all parameters:", prompt="  parameter > ")
        return None if picked is None else picked[0]
    if name == "__type__":
        typed = _prompt.ask("  parameter name > ")
        return None if typed is None else typed.strip()
    return name


def ask_new_parameter(item: Discovery) -> tuple[str, Suggestion, bool] | None:
    """Name and config for a new parameter. None if the user backed out."""
    default = item.supplier_name.strip()
    options = [(default, f"call it {default!r}"),
               (None, "type a different name")]
    picked = _prompt.choose_one(options, lambda o: o[1],
                                title=f"  name for {item.supplier_name!r}:",
                                prompt="  name > ")
    if picked is None:
        return None
    if picked[0] is not None:
        name = picked[0]
    else:
        typed = _ask_default("name", default)
        if typed is None:
            return None
        name = typed.strip() or default

    suggestion = Suggestion(
        units=item.suggestion.units,
        parse=item.suggestion.parse,
        choices=list(item.suggestion.choices),
        ranged=item.suggestion.ranged,
    )
    print(f"  inferred: {item.suggestion.describe()}")

    description = _ask_default("description")
    if description is None:
        return None
    suggestion.description = description

    units = _ask_default("units", suggestion.units)
    if units is None:
        return None
    suggestion.units = units

    while True:
        parse = _ask_default(
            f"parse ({', '.join(sorted(PARSE_KINDS))} or empty)",
            suggestion.parse)
        if parse is None:
            return None
        if not parse or parse in PARSE_KINDS:
            suggestion.parse = parse
            break
        print(f"  {parse!r} is not a known parse kind")

    choice_default = ", ".join(suggestion.choices)
    choices = _ask_default("choices (comma-separated)", choice_default)
    if choices is None:
        return None
    suggestion.choices = _comma_list(choices)

    prefixes = _ask_default("prefixes (comma-separated, e.g. u, n, p)")
    if prefixes is None:
        return None
    suggestion.prefixes = _comma_list(prefixes)
    unknown = [p for p in suggestion.prefixes if p not in NAME_PREFIX_SCALE]
    if unknown:
        print(f"  unknown prefix(es) {unknown}; dropping prefixes")
        suggestion.prefixes = []
    if suggestion.prefixes and not suggestion.units:
        print("  prefixes need units; dropping prefixes")
        suggestion.prefixes = []

    if suggestion.prefixes:
        style = _ask_default("name_style (rkm or empty)")
        if style is None:
            return None
        suggestion.name_style = style if style == "rkm" else ""

    key = _prompt.confirm("  key parameter (identifies the part)?",
                          default=False)
    return name, suggestion, key


def learn_parameters(
    items: list[Discovery],
    directory: Path,
    api: Any | None = None,
    *,
    write: bool = False,
) -> int:
    """Prompt for each unmapped field. Returns how many were decided."""
    if not items or not _prompt.interactive():
        return 0
    print(f"\n{len(items)} unmapped supplier parameter(s).")
    if not _prompt.confirm("  Map them now?", default=True):
        return 0

    categories, parameters = reload(directory)
    decided = 0
    sync = False
    for item in items:
        picked = ask_parameter_action(item, parameters)
        if picked is None:
            print("  Stopped - answers so far are already saved.")
            break
        action, name = picked
        if action == SKIP:
            continue

        decision = IGNORE if action == IGNORE else OTHER
        if action == MAP:
            chosen = name or ask_existing_parameter(item, parameters)
            if not chosen:
                continue
            if chosen not in parameters:
                print(f"    ! no parameter named {chosen!r}")
                continue
            name = chosen
        elif action == CREATE:
            created = ask_new_parameter(item)
            if created is None:
                continue
            name, item.suggestion, as_key = created
            decision = KEY if as_key else OTHER
            sync = True

        for change in file_discovery(item, decision, name, categories,
                                     parameters, directory=directory):
            print(f"    {change}")
        decided += 1
        categories, parameters = reload(directory)

    if write and sync and api is not None:
        result = sync_templates(directory, api, write=True)
        made = result.counts()["created"]
        if made:
            print(f"    created {made} parameter template(s) on the server")
    return decided


# --------------------------------------------------------------------------
# Unknown choice spellings
# --------------------------------------------------------------------------
def choice_actions(item: UnknownChoice) -> list[tuple[str, str, str]]:
    """Menu rows for one unknown spelling: (action, canonical, label)."""
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for name, score in candidates(item.value, item.choices, scorer=name_ratio):
        rows.append((MAP, name, f"map to {name}  [{score:.0%} similar]"))
        seen.add(name)
    leftover = [choice for choice in item.choices if choice not in seen]
    if leftover:
        map_label = ("map to a different choice" if seen
                     else "map to an existing choice (as an alias)")
        rows.append((MAP, "", map_label))
    elif not item.choices:
        rows.append((MAP, "", "map to an existing choice (as an alias)"))
    rows.append((CREATE, "", "create a new choice"))
    rows.append((SKIP, "", "skip (ask again next time)"))
    return rows


def ask_choice_action(item: UnknownChoice) -> tuple[str, str] | None:
    listed = ", ".join(item.choices) or "(none)"
    title = (f"{item.parameter}  ({item.category})\n"
             f"  {item.supplier_name} = {item.value!r}  "
             f"(on {item.count} product"
             f"{'' if item.count == 1 else 's'})\n"
             f"  choices: {listed}")
    options = choice_actions(item)
    picked = _prompt.choose_one(
        options, lambda c: c[2], title=title, prompt="  > ")
    return None if picked is None else (picked[0], picked[1])


def ask_existing_choice(item: UnknownChoice) -> str | None:
    offered = [(name, f"use {name}  [{score:.0%} similar]")
               for name, score in
               candidates(item.value, item.choices, scorer=name_ratio)]
    rest = [name for name in item.choices
            if name not in {n for n, _ in offered}]
    options = [*offered, *((name, f"use {name}") for name in rest)]
    if not options:
        return None
    picked = _prompt.choose_one(
        options, lambda o: o[1],
        title=f"  map {item.value!r} to:",
        prompt="  choice > ")
    return None if picked is None else picked[0]


def ask_new_choice(item: UnknownChoice) -> str | None:
    typed = _ask_default("choice name", item.value)
    if typed is None:
        return None
    return typed.strip() or item.value


def learn_choices(
    items: list[UnknownChoice],
    directory: Path,
    api: Any | None = None,
    *,
    write: bool = False,
) -> int:
    """Prompt for each unknown choice spelling. Returns how many were decided."""
    if not items or not _prompt.interactive():
        return 0
    print(f"\n{len(items)} unknown choice value(s).")
    if not _prompt.confirm("  Map them now?", default=True):
        return 0

    decided = 0
    sync = False
    for item in items:
        picked = ask_choice_action(item)
        if picked is None:
            print("  Stopped - answers so far are already saved.")
            break
        action, canonical = picked
        if action == SKIP:
            continue
        if action == MAP:
            canonical = canonical or ask_existing_choice(item)
            create = False
        else:
            canonical = ask_new_choice(item)
            create = True
        if not canonical:
            continue
        for change in file_choice(item, canonical, create=create,
                                  directory=directory):
            print(f"    {change}")
        decided += 1
        if create:
            sync = True
        # Refresh choices on later items of the same parameter.
        parameters = load_parameters_config(directory)
        parameter = parameters.get(item.parameter)
        if parameter is not None:
            for later in items:
                if later.parameter == item.parameter:
                    later.choices = list(parameter.choices)

    if write and sync and api is not None:
        result = sync_templates(directory, api, write=True)
        updated = result.counts()["updated"]
        if updated:
            print(f"    updated {updated} parameter template(s) on the server")
    return decided
