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

import json
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

# How a supplier value is read. Named in parameters.yaml as `parse:`; the
# functions live in inventree/values.py. An empty parse means the text is
# used as-is (after the values: map and a choices check).
PARSE_KINDS = frozenset({
    "quantity", "percent", "quantity_first", "range_low", "range_high",
})


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
class ManufacturerConfig:
    """A manufacturer name, and the supplier spellings that mean it."""
    name: str
    aliases: list[str] = field(default_factory=list)


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

        parse = str(body.get("parse") or "")
        if parse and parse not in PARSE_KINDS:
            raise ConfigError(
                f"{path.name}: {name!r} parse {parse!r} is not one of "
                f"{sorted(PARSE_KINDS)}")

        parameters[str(name)] = ParameterConfig(
            name=str(name),
            units=str(body.get("units") or ""),
            description=str(body.get("description") or ""),
            choices=as_list(body.get("choices"), path, f"{name} choices"),
            checkbox=bool(body.get("checkbox", False)),
            aliases=as_list(body.get("aliases"), path, f"{name} aliases"),
            parse=parse,
            values={str(k): as_list(v, path, f"{name} values {k}")
                    for k, v in values.items()},
        )

    return parameters


def parse_manufacturers(data: dict[str, Any], path: Path
                        ) -> dict[str, ManufacturerConfig]:
    manufacturers: dict[str, ManufacturerConfig] = {}
    for name, body in data.items():
        body = body or {}
        if not isinstance(body, dict):
            raise ConfigError(f"{path.name}: manufacturer {name!r} must be a "
                              f"mapping, got {type(body).__name__}")
        manufacturers[str(name)] = ManufacturerConfig(
            name=str(name),
            aliases=as_list(body.get("aliases"), path, f"{name} aliases"),
        )
    return manufacturers


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
                # A parent holds only children, so it is structural unless
                # the file says otherwise. A leaf holds parts.
                structural=bool(body["structural"]) if "structural" in body
                else any(child not in CATEGORY_KEYS for child in body),
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


def load_manufacturers_config(directory: Path | None = None
                              ) -> dict[str, ManufacturerConfig]:
    path = (directory or CONFIG_DIR) / MANUFACTURERS_FILE
    if not path.exists():
        return {}
    return parse_manufacturers(read_yaml(path), path)


def load_config(directory: Path | None = None
                ) -> tuple[dict[str, CategoryConfig], dict[str, ParameterConfig]]:
    """Load both files and check they agree."""
    categories = load_categories_config(directory)
    parameters = load_parameters_config(directory)
    check_consistency(categories, parameters)
    return categories, parameters


# --------------------------------------------------------------------------
# Write-back
# --------------------------------------------------------------------------
def _indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _line_key(line: str) -> str | None:
    """The mapping key this line declares, or None if it is not a key line."""
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or stripped.startswith("-"):
        return None
    if stripped[0] in "\"'":
        quote = stripped[0]
        end = stripped.find(quote, 1)
        if end > 0 and stripped[end + 1:].lstrip().startswith(":"):
            return stripped[1:end]
        return None
    key, sep, _ = stripped.partition(":")
    return key if sep and key and not key.startswith(" ") else None


def _find_key(lines: list[str], start: int, end: int, key: str,
              indent: int) -> int | None:
    """Index of `key:` at exactly `indent`, or None."""
    for index in range(start, end):
        if _indent_of(lines[index]) == indent and _line_key(lines[index]) == key:
            return index
    return None


def _as_block_mapping(lines: list[str], key_index: int) -> None:
    """
    Turn 'Key: {}' into 'Key:' so a block body can be inserted.

    Empty categories are written as a flow mapping in this repo
    (`Schottky Diodes: {}`). YAML will not accept a block child after that.
    """
    line = lines[key_index]
    newline = "\n" if line.endswith("\n") else ""
    before, sep, comment = line.rstrip("\n").partition("#")
    if ": {}" not in before:
        return
    key = _line_key(line)
    if key is None:
        return
    rebuilt = f"{' ' * _indent_of(line)}{format_yaml_key(key)}:"
    if sep:
        rebuilt += f"  #{comment}"
    lines[key_index] = rebuilt + newline


def _body_end(lines: list[str], key_index: int) -> int:
    """First line after the mapping that starts at key_index."""
    indent = _indent_of(lines[key_index])
    index = key_index + 1
    while index < len(lines):
        line = lines[index]
        if line.strip() and not line.strip().startswith("#"):
            if _indent_of(line) <= indent:
                return index
        index += 1
    return len(lines)


def add_alias(path: Path, keys: list[str], alias: str) -> bool:
    """
    Add `alias` to the aliases list of the mapping at `keys`.

    Walks the file by indentation so comments and ordering survive. Creates
    the aliases list if the node has none. A missing top-level key (a new
    manufacturer) is appended as a new block; a missing nested key is an
    error, because that would invent a category. Returns True if the file
    changed.
    """
    if not keys:
        raise ConfigError("add_alias needs a key path")

    text = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = text.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"

    start, end, indent = 0, len(lines), 0
    key_index: int | None = None
    for key in keys:
        key_index = _find_key(lines, start, end, key, indent)
        if key_index is None:
            if len(keys) == 1 and indent == 0:
                return _append_alias_block(path, lines, keys[0], alias)
            raise ConfigError(
                f"{path.name}: cannot add an alias under {'/'.join(keys)} - "
                f"that entry does not exist")
        start = key_index + 1
        end = _body_end(lines, key_index)
        indent += 2

    assert key_index is not None
    _as_block_mapping(lines, key_index)
    end = _body_end(lines, key_index)
    aliases_indent = _indent_of(lines[key_index]) + 2
    aliases_at = _find_key(lines, key_index + 1, end, "aliases", aliases_indent)

    item = f"{' ' * (aliases_indent + 2)}- {alias}\n"
    if aliases_at is None:
        insertion = f"{' ' * aliases_indent}aliases:\n{item}"
        lines.insert(key_index + 1, insertion)
        path.write_text("".join(lines), encoding="utf-8")
        return True

    aliases_end = _body_end(lines, aliases_at)
    for index in range(aliases_at + 1, aliases_end):
        if lines[index].lstrip().startswith("- "):
            existing = lines[index].lstrip()[2:].strip()
            if existing == alias or existing.strip("\"'") == alias:
                return False

    # Insert after the last list item, or right after `aliases:` if empty.
    insert_at = aliases_end
    for index in range(aliases_end - 1, aliases_at, -1):
        if lines[index].lstrip().startswith("- "):
            insert_at = index + 1
            break
    lines.insert(insert_at, item)
    path.write_text("".join(lines), encoding="utf-8")
    return True


def _append_block(path: Path, lines: list[str], block: str) -> bool:
    """Append a top-level YAML block, with a blank line before it."""
    body = "".join(lines)
    if body and not body.endswith("\n"):
        body += "\n"
    if body and not body.endswith("\n\n"):
        body += "\n"
    path.write_text(body + block, encoding="utf-8")
    return True


def _append_alias_block(path: Path, lines: list[str], name: str,
                        alias: str) -> bool:
    """A new top-level mapping with one alias, appended to the file."""
    return _append_block(path, lines, _category_block([name], 0, alias))


def format_yaml_key(name: str) -> str:
    """Quote a key only when YAML would misread it."""
    if not name or name != name.strip():
        return json.dumps(name)
    if name.casefold() in {"y", "n", "yes", "no", "true", "false",
                           "on", "off", "null"}:
        return json.dumps(name)
    if any(char in name for char in ":#{}[]&*?|>!%@`'\","):
        return json.dumps(name)
    return name


def _category_block(keys: list[str], indent: int, alias: str | None) -> str:
    """A nested category mapping, leaf either empty or carrying an alias."""
    lines: list[str] = []
    for index, key in enumerate(keys):
        pad = " " * (indent + 2 * index)
        if index == len(keys) - 1 and not alias:
            lines.append(f"{pad}{format_yaml_key(key)}: {{}}")
        else:
            lines.append(f"{pad}{format_yaml_key(key)}:")
    if alias:
        pad = " " * (indent + 2 * len(keys))
        lines.append(f"{pad}aliases:")
        lines.append(f"{pad}  - {alias}")
    return "\n".join(lines) + "\n"


def add_category(path: Path, keys: list[str], alias: str | None = None) -> bool:
    """
    Ensure the category at `keys` exists, creating any missing parents.

    Walks the file by indentation so comments survive. The leaf gets `alias`
    if given. An already-complete path just adds the alias. Returns True if
    the file changed.
    """
    if not keys:
        raise ConfigError("add_category needs a key path")

    text = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = text.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"

    start, end, indent = 0, len(lines), 0
    parent_index: int | None = None
    missing_from = 0
    for index, key in enumerate(keys):
        found = _find_key(lines, start, end, key, indent)
        if found is None:
            missing_from = index
            break
        parent_index = found
        start = found + 1
        end = _body_end(lines, found)
        indent += 2
    else:
        return add_alias(path, keys, alias) if alias else False

    block = _category_block(keys[missing_from:], indent, alias)
    if parent_index is None:
        return _append_block(path, lines, block)

    _as_block_mapping(lines, parent_index)
    lines.insert(_body_end(lines, parent_index), block)
    path.write_text("".join(lines), encoding="utf-8")
    return True
