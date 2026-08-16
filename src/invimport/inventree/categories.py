"""
InvenTree part categories, defined in config/categories.yaml.

Importable as a library:

    from invimport.inventree.categories import sync_categories, match_path

    result = sync_categories(write=True)
    category = match_path(["Resistors", "Through Hole Resistors"], categories)

Idempotent: every category in the config is created if missing and updated if
it has drifted. Nothing is deleted or renamed. A category on the server that
the config does not mention is reported, not removed.

Templates are ensured first - see sync_tree(), which does units, templates,
then categories, because a category names parameters that have to exist.

Matching a DigiKey path is exact alias lookup, longest first. An unmapped
path is None: a part in the wrong category is worse than a part not imported.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

from .. import cache
from ..config import (
    CONFIG_DIR,
    CategoryConfig,
    add_alias,
    add_category,
    load_categories_config,
    load_parameters_config,
    load_units_config,
)
from ..digikey.products import category_path
from .api import PartCategory, connect
from .matching import candidates, match_path, unmapped_paths
from .parameters import SyncResult, matches, sync_templates
from .units import UnitSyncResult, sync_units

log = logging.getLogger(__name__)

UNRESOLVED_PK = -1


@dataclass
class CategoryAction:
    """What happened (or would happen) to one part category."""
    pathstring: str
    action: str                                  # created | updated | unchanged
    pk: int | None = None
    drift: dict[str, tuple[Any, Any]] = field(default_factory=dict)


@dataclass
class CategorySyncResult:
    categories: list[CategoryAction] = field(default_factory=list)
    unmanaged: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "created": sum(1 for c in self.categories if c.action == "created"),
            "updated": sum(1 for c in self.categories if c.action == "updated"),
            "unchanged": sum(1 for c in self.categories if c.action == "unchanged"),
            "unmanaged": len(self.unmanaged),
            "problems": len(self.problems),
        }


def payload_for(category: CategoryConfig, parent: int | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": category.name,
        "description": category.description,
        "structural": category.structural,
    }
    if parent is not None:
        payload["parent"] = parent
    return payload


def parent_pathstring(category: CategoryConfig) -> str | None:
    if len(category.path) < 2:
        return None
    return "/".join(category.path[:-1])


def sync_categories(
    categories: dict[str, CategoryConfig] | Path | str | None = None,
    api=None,
    *,
    write: bool = False,
) -> CategorySyncResult:
    """
    Create or update every category the config defines.

    categories accepts a loaded config, a path to a config directory, or None
    to use config/ at the repo root. Parents are created before children
    because the config walk is depth-first.
    """
    if categories is None or isinstance(categories, (str, Path)):
        directory = Path(categories) if categories is not None else None
        categories = load_categories_config(directory)

    api = api or connect()
    existing = {c.pathstring: c for c in PartCategory.list(api, limit=1000)
                if getattr(c, "pathstring", None)}
    resolved = {path: cat.pk for path, cat in existing.items()}
    result = CategorySyncResult()

    for category in categories.values():
        current = existing.get(category.pathstring)
        parent = resolved.get(parent_pathstring(category) or "")
        if parent_pathstring(category) and parent in (None, UNRESOLVED_PK) and write:
            if parent is None:
                result.problems.append(
                    f"category {category.pathstring!r} has no parent "
                    f"{parent_pathstring(category)!r} on the server")
                continue

        if current is None:
            pk = UNRESOLVED_PK
            if write:
                pk = PartCategory.create(
                    api, payload_for(category, parent)).pk
            resolved[category.pathstring] = pk
            result.categories.append(CategoryAction(category.pathstring,
                                                    "created", pk))
            continue

        payload = payload_for(category, None)    # parent is identity, not drift
        drift = {
            key: (getattr(current, key, None), value)
            for key, value in payload.items()
            if key != "name" and not matches(getattr(current, key, None), value)
        }
        if drift:
            if write:
                current.save(data=payload)
            result.categories.append(CategoryAction(category.pathstring,
                                                    "updated", current.pk,
                                                    drift))
        else:
            result.categories.append(CategoryAction(category.pathstring,
                                                    "unchanged", current.pk))

    result.unmanaged = sorted(path for path in existing
                              if path not in categories)
    return result


def sync_tree(
    directory: Path | str | None = None,
    api=None,
    *,
    write: bool = False,
) -> tuple[UnitSyncResult, SyncResult, CategorySyncResult]:
    """
    Units, then templates, then categories.

    A category names parameters, and a template names a unit, so the three
    have to land in that order. Call this rather than the pieces separately.
    """
    api = api or connect()
    directory = Path(directory) if directory is not None else None
    units = load_units_config(directory)
    parameters = load_parameters_config(directory)
    categories = load_categories_config(directory)

    unit_result = sync_units(units, api, write=write)
    template_result = sync_templates(parameters, api, write=write, units=units)
    category_result = sync_categories(categories, api, write=write)
    return unit_result, template_result, category_result


def cached_category_paths(cache_dir: Path = cache.PRODUCTS_DIR) -> list[str]:
    """Unique DigiKey category paths from cached productdetails payloads."""
    if not cache_dir.exists():
        return []
    seen: set[str] = set()
    for file in sorted(cache_dir.glob("*.json")):
        try:
            payload = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        product = payload.get("Product", payload)
        path = category_path(product)
        if path:
            seen.add(" / ".join(path))
    return sorted(seen)


@dataclass
class NewCategory:
    """A category path to create, then attach the DigiKey alias to the leaf."""
    path: list[str]

    @property
    def pathstring(self) -> str:
        return "/".join(self.path)


def children_of(
    parent: CategoryConfig | None,
    categories: dict[str, CategoryConfig] | Iterable[CategoryConfig],
) -> list[CategoryConfig]:
    """Direct children of parent, or the roots if parent is None. Name-sorted."""
    if not isinstance(categories, dict):
        categories = {c.pathstring: c for c in categories}
    if parent is None:
        kids = [c for c in categories.values() if len(c.path) == 1]
    else:
        depth = len(parent.path) + 1
        kids = [c for c in categories.values()
                if len(c.path) == depth and c.path[:len(parent.path)] == parent.path]
    return sorted(kids, key=lambda c: c.name.casefold())


def parent_of(category: CategoryConfig,
              categories: dict[str, CategoryConfig]) -> CategoryConfig | None:
    if len(category.path) < 2:
        return None
    return categories.get("/".join(category.path[:-1]))


def describe_category(category: CategoryConfig,
                      categories: dict[str, CategoryConfig] | Iterable[CategoryConfig]
                      ) -> str:
    """'Capacitors  (structural, 3 subcategories)' - the leaf name plus hints."""
    n = len(children_of(category, categories))
    extra: list[str] = []
    if category.structural:
        extra.append("structural")
    if n == 1:
        extra.append("1 subcategory")
    elif n:
        extra.append(f"{n} subcategories")
    if extra:
        return f"{category.name}  ({', '.join(extra)})"
    return category.name


def learn_options(path: str,
                  categories: dict[str, CategoryConfig]) -> list[CategoryConfig]:
    """Categories to offer for an unmapped path: close matches first, then the rest."""
    names = [c.pathstring for c in categories.values()]
    leaf = path.rsplit(" / ", 1)[-1]
    close = {name for name, _ in candidates(path, names)}
    close |= {name for name, _ in candidates(leaf, names)}
    ranked = [c for c in categories.values() if c.pathstring in close]
    rest = [c for c in categories.values() if c.pathstring not in close]
    ranked.sort(key=lambda c: c.pathstring.casefold())
    rest.sort(key=lambda c: c.pathstring.casefold())
    return ranked + rest


def learn_aliases(
    paths: Iterable[str],
    categories: dict[str, CategoryConfig],
    directory: Path | None = None,
    *,
    choose: Callable[[list[CategoryConfig], str],
                     CategoryConfig | NewCategory | None] | None = None,
) -> list[tuple[str, str]]:
    """
    Map each unmapped DigiKey path by asking `choose`, and write the alias back.

    choose(options, path) returns an existing category, a NewCategory to
    create, or None to skip. Without a chooser (non-interactive) every
    unmapped path is skipped. Returns [(digikey_path, category_pathstring),
    ...] for the ones learned. Creating a category reloads the in-memory
    config so the next path can map to it.
    """
    directory = directory or CONFIG_DIR
    file = Path(directory) / "categories.yaml"
    learned: list[tuple[str, str]] = []

    for path in unmapped_paths(paths, categories):
        if choose is None:
            continue
        chosen = choose(list(categories.values()), path)
        if chosen is None:
            continue
        if isinstance(chosen, NewCategory):
            add_category(file, chosen.path, alias=path)
            fresh = load_categories_config(directory)
            categories.clear()
            categories.update(fresh)
            dest = chosen.pathstring
        else:
            add_alias(file, chosen.path, path)
            chosen.aliases.append(path)
            dest = chosen.pathstring
        learned.append((path, dest))
        log.info("    mapped %r -> %s", path, dest)

    return learned
