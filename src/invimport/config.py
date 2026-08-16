"""
YAML configuration: parameter templates, categories, manufacturer aliases.

Config lives in config/ at the repo root, not inside the package and with no
defaults-plus-override layering. The project already assumes a checkout (.env
is resolved relative to the package, .cache relative to the working directory),
so a second location would buy nothing and cost a merge mechanism. One file per
concern, versioned with the repo, and writable - the interactive "learn" flows
write choices back so the same question is never asked twice.

    from invimport.config import load_parameters_config

    parameters = load_parameters_config()
    print(parameters["Resistance"].units)      # "ohm"

Loading is strict. A malformed file raises ConfigError naming the file and what
was wrong, because a config typo that silently becomes "no parameters" would
show up much later as parts imported with nothing on them.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

log = logging.getLogger(__name__)

# Repo root, then config/. Mirrors how env.py locates the .env.
CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"

UNITS_FILE = "units.yaml"
PARAMETERS_FILE = "parameters.yaml"
CATEGORIES_FILE = "categories.yaml"
MANUFACTURERS_FILE = "manufacturers.yaml"

# Keys a category may carry that describe the category itself rather than a
# child category. Everything else at that level is a subcategory.
CATEGORY_KEYS = {"identity", "key_parameters", "name", "parameters", "aliases",
                 "description", "structural"}

IDENTITY_MODES = ("spec", "mpn")


class ConfigError(RuntimeError):
    """A config file is missing, malformed, or internally inconsistent."""


@dataclass
class UnitConfig:
    """
    A custom unit InvenTree has to be taught before templates can use it.

    definition is a pint expression the server evaluates, e.g.
    'ppm / delta_degC'. symbol is display only and capped at 10 characters by
    the API.
    """
    name: str
    definition: str
    symbol: str = ""


@dataclass
class ParameterConfig:
    """One parameter template, and how to get its value out of supplier data."""
    name: str
    units: str = ""
    description: str = ""
    choices: list[str] = field(default_factory=list)
    checkbox: bool = False
    aliases: list[str] = field(default_factory=list)
    parse: str = ""
    # Canonical value -> the supplier spellings that mean it.
    values: dict[str, list[str]] = field(default_factory=dict)

    @property
    def choices_csv(self) -> str:
        """InvenTree stores choices as one comma-separated string."""
        return ",".join(self.choices)

    def supplier_names(self) -> list[str]:
        """Every name this parameter may arrive under, our own name first."""
        seen = [self.name]
        for alias in self.aliases:
            if alias not in seen:
                seen.append(alias)
        return seen


@dataclass
class CategoryConfig:
    """One part category, with the parameters that apply to parts in it."""
    name: str
    path: list[str]
    identity: str = "mpn"
    key_parameters: list[str] = field(default_factory=list)
    name_template: str = ""
    parameters: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    description: str = ""
    structural: bool = False

    @property
    def pathstring(self) -> str:
        """The form InvenTree uses: 'Capacitors/Film Capacitors'."""
        return "/".join(self.path)


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------
def read_yaml(path: Path) -> dict[str, Any]:
    """Read a YAML mapping, or raise ConfigError saying which file was wrong."""
    if not path.exists():
        raise ConfigError(f"{path} does not exist - see config/README.md")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(f"{path.name} is not valid YAML: {exc}") from None
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ConfigError(f"{path.name} must be a mapping at the top level, "
                          f"got {type(data).__name__}")
    return data


def as_list(value: Any, path: Path, where: str) -> list[str]:
    """Accept a list, or a bare string as a one-item list."""
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value]
    raise ConfigError(f"{path.name}: {where} must be a list, "
                      f"got {type(value).__name__}")


SYMBOL_MAX = 10          # /api/units/ caps symbol at 10 characters


def parse_units(data: dict[str, Any], path: Path) -> dict[str, UnitConfig]:
    units: dict[str, UnitConfig] = {}

    for name, body in data.items():
        body = body or {}
        if not isinstance(body, dict):
            raise ConfigError(f"{path.name}: unit {name!r} must be a mapping, "
                              f"got {type(body).__name__}")

        definition = str(body.get("definition") or "").strip()
        if not definition:
            raise ConfigError(f"{path.name}: unit {name!r} has no definition - "
                              f"a custom unit is a pint expression, e.g. "
                              f"'ppm / delta_degC'")

        symbol = str(body.get("symbol") or "")
        if len(symbol) > SYMBOL_MAX:
            raise ConfigError(f"{path.name}: unit {name!r} symbol {symbol!r} is "
                              f"{len(symbol)} characters; the API allows "
                              f"{SYMBOL_MAX}")

        units[str(name)] = UnitConfig(str(name), definition, symbol)

    return units


def parse_parameters(data: dict[str, Any], path: Path
                     ) -> dict[str, ParameterConfig]:
    parameters: dict[str, ParameterConfig] = {}

    for name, body in data.items():
        body = body or {}
        if not isinstance(body, dict):
            raise ConfigError(f"{path.name}: parameter {name!r} must be a "
                              f"mapping, got {type(body).__name__}")

        values = body.get("values") or {}
        if not isinstance(values, dict):
            raise ConfigError(f"{path.name}: {name!r} values must be a mapping "
                              f"of canonical value -> supplier spellings")

        parameters[str(name)] = ParameterConfig(
            name=str(name),
            units=str(body.get("units") or ""),
            description=str(body.get("description") or ""),
            choices=as_list(body.get("choices"), path, f"{name} choices"),
            checkbox=bool(body.get("checkbox", False)),
            aliases=as_list(body.get("aliases"), path, f"{name} aliases"),
            parse=str(body.get("parse") or ""),
            values={str(k): as_list(v, path, f"{name} values {k}")
                    for k, v in values.items()},
        )

    return parameters


def parse_categories(data: dict[str, Any], path: Path
                     ) -> dict[str, CategoryConfig]:
    """
    Walk the category tree depth-first.

    identity, key_parameters and the name template are inherited by children;
    parameters are inherited and *extended*, so a subcategory adds to its
    parent's set rather than restating it.
    """
    categories: dict[str, CategoryConfig] = {}

    def walk(node: dict[str, Any], parents: list[str], inherited: CategoryConfig
             | None) -> None:
        for key, body in node.items():
            if key in CATEGORY_KEYS:
                continue                        # a property of the parent
            body = body or {}
            if not isinstance(body, dict):
                raise ConfigError(f"{path.name}: category {key!r} must be a "
                                  f"mapping, got {type(body).__name__}")

            here = [*parents, str(key)]
            identity = str(body.get("identity")
                           or (inherited.identity if inherited else "mpn"))
            if identity not in IDENTITY_MODES:
                raise ConfigError(
                    f"{path.name}: category {'/'.join(here)} has identity "
                    f"{identity!r}, expected one of {IDENTITY_MODES}")

            own = as_list(body.get("parameters"), path, f"{key} parameters")
            inherited_params = list(inherited.parameters) if inherited else []
            merged = inherited_params + [p for p in own
                                         if p not in inherited_params]

            config = CategoryConfig(
                name=str(key),
                path=here,
                identity=identity,
                key_parameters=as_list(body.get("key_parameters"), path,
                                       f"{key} key_parameters")
                or (list(inherited.key_parameters) if inherited else []),
                name_template=str(body.get("name")
                                  or (inherited.name_template if inherited
                                      else "")),
                parameters=merged,
                aliases=as_list(body.get("aliases"), path, f"{key} aliases"),
                description=str(body.get("description") or ""),
                structural=bool(body.get("structural", False)),
            )

            if config.pathstring in categories:
                raise ConfigError(f"{path.name}: category "
                                  f"{config.pathstring!r} is defined twice")
            categories[config.pathstring] = config
            walk(body, here, config)

    walk(data, [], None)
    return categories


def check_consistency(categories: dict[str, CategoryConfig],
                      parameters: dict[str, ParameterConfig]) -> None:
    """
    Every parameter a category names must be defined, and a spec category must
    say which parameters identify a part. Caught here rather than half way
    through an import.
    """
    problems: list[str] = []

    for category in categories.values():
        for name in category.parameters:
            if name not in parameters:
                problems.append(f"category {category.pathstring!r} references "
                                f"parameter {name!r}, which is not defined in "
                                f"{PARAMETERS_FILE}")
        if category.identity == "spec" and not category.structural:
            if not category.key_parameters:
                problems.append(f"category {category.pathstring!r} has "
                                f"identity 'spec' but no key_parameters, so "
                                f"parts in it could not be matched")
            for name in category.key_parameters:
                if name not in category.parameters:
                    problems.append(
                        f"category {category.pathstring!r} has key_parameter "
                        f"{name!r}, which is not among its parameters")

    if problems:
        raise ConfigError("config is inconsistent:\n  - "
                          + "\n  - ".join(problems))


# --------------------------------------------------------------------------
# Public entrypoints
# --------------------------------------------------------------------------
def load_units_config(directory: Path | None = None) -> dict[str, UnitConfig]:
    path = (directory or CONFIG_DIR) / UNITS_FILE
    # Custom units are optional: an instance may need none at all.
    if not path.exists():
        return {}
    return parse_units(read_yaml(path), path)


def load_parameters_config(directory: Path | None = None
                           ) -> dict[str, ParameterConfig]:
    path = (directory or CONFIG_DIR) / PARAMETERS_FILE
    return parse_parameters(read_yaml(path), path)


def load_categories_config(directory: Path | None = None
                           ) -> dict[str, CategoryConfig]:
    path = (directory or CONFIG_DIR) / CATEGORIES_FILE
    return parse_categories(read_yaml(path), path)


def load_config(directory: Path | None = None
                ) -> tuple[dict[str, CategoryConfig], dict[str, ParameterConfig]]:
    """Load both files and check they agree."""
    categories = load_categories_config(directory)
    parameters = load_parameters_config(directory)
    check_consistency(categories, parameters)
    return categories, parameters
