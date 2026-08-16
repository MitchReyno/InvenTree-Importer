"""
InvenTree parameter templates, defined in config/parameters.yaml.

Importable as a library:

    from invimport.inventree.parameters import sync_templates

    result = sync_templates(write=True)
    print(result.counts())
    for problem in result.problems:
        print(problem)

Idempotent: every template in the config is created if missing and updated if
it has drifted. Nothing is deleted, ever - a template on the server that the
config does not mention is reported, not removed, because parts may be using
it. With write=False the API is only read from, and the returned actions
describe what a write would do.

Parameter *values* are not set here. They come from supplier data as parts are
imported (see invimport.inventree.values), rather than from a hand-maintained
file - which is why the old CSV loader is gone.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import (
    ParameterConfig,
    UnitConfig,
    load_parameters_config,
    load_units_config,
)
from .api import PART_MODEL_TYPE, ParameterTemplate, connect
from .units import UnitSyncResult, sync_units
from .values import build_registry

log = logging.getLogger(__name__)

# Marks a template that a dry run did not create, so its pk is not yet known.
UNRESOLVED_PK = -1


@dataclass
class TemplateAction:
    """What happened (or would happen) to one parameter template."""
    name: str
    action: str                                  # created | updated | unchanged
    pk: int | None = None
    units: str = ""
    drift: dict[str, tuple[Any, Any]] = field(default_factory=dict)


@dataclass
class SyncResult:
    templates: list[TemplateAction] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    # Templates on the server that the config does not describe. Reported so
    # they can be adopted or removed by hand; never touched automatically.
    unmanaged: list[str] = field(default_factory=list)

    def resolved(self) -> dict[str, int]:
        """{name: pk} for every template that exists, for callers that need it."""
        return {action.name: action.pk for action in self.templates
                if action.pk not in (None, UNRESOLVED_PK)}

    def counts(self) -> dict[str, int]:
        return {
            "created": sum(1 for t in self.templates if t.action == "created"),
            "updated": sum(1 for t in self.templates if t.action == "updated"),
            "unchanged": sum(1 for t in self.templates
                             if t.action == "unchanged"),
            "unmanaged": len(self.unmanaged),
            "problems": len(self.problems),
        }


def matches(current: Any, wanted: Any) -> bool:
    """
    Is a template field already what we want?

    Booleans compare as booleans: stringifying them means a False on both sides
    reads as "" vs "False" and every run re-saves a template it need not touch.
    Everything else compares as text, with None treated as empty.
    """
    if isinstance(wanted, bool):
        return bool(current) == wanted
    return str("" if current is None else current) == str(wanted)


def payload_for(parameter: ParameterConfig) -> dict[str, Any]:
    """The InvenTree template fields one config entry describes."""
    return {
        "name": parameter.name,
        "units": parameter.units,
        "description": parameter.description,
        "choices": parameter.choices_csv,
        "checkbox": parameter.checkbox,
        # 530 templates declare which model they may attach to. Blank means
        # "any model"; this importer only does part parameters.
        "model_type": PART_MODEL_TYPE,
    }


def unknown_units(parameters: dict[str, ParameterConfig],
                  registry) -> dict[str, str]:
    """
    Which parameters declare a unit that cannot be resolved?

    Checked against a pint registry rather than the server's list of unit
    names, because InvenTree validates a template unit with `unit in ureg` and
    that resolves *expressions*: "ppm/K" is perfectly valid while being no
    single entry in any list. The registry is built from config/units.yaml, so
    a custom unit a dry run has not created on the server yet still counts as
    known.
    """
    unknown: dict[str, str] = {}
    for parameter in parameters.values():
        if not parameter.units:
            continue
        try:
            resolvable = parameter.units in registry
        except Exception:
            resolvable = False
        if not resolvable:
            unknown[parameter.name] = parameter.units
    return unknown


def sync_templates(
    parameters: dict[str, ParameterConfig] | Path | str | None = None,
    api=None,
    *,
    write: bool = False,
    units: dict[str, UnitConfig] | None = None,
) -> SyncResult:
    """
    Create or update every parameter template the config defines.

    parameters accepts a loaded config, a path to a config directory, or None
    to use config/ at the repo root. Pass an existing api handle to reuse a
    connection; omit it and one is created from the environment.

    Custom units must already exist - see sync_config(), which does units
    first. units, if given, names the custom units the config declares so a
    dry run does not report one it has not created yet as unknown.
    """
    if parameters is None or isinstance(parameters, (str, Path)):
        directory = Path(parameters) if parameters is not None else None
        parameters = load_parameters_config(directory)

    api = api or connect()
    existing = {t.name: t for t in ParameterTemplate.list(api, limit=1000)}
    result = SyncResult()

    # Checked before anything is written: InvenTree rejects a template whose
    # unit it cannot resolve, and a named unit beats a bare HTTP 400.
    for name, unit in unknown_units(parameters, build_registry(units)).items():
        result.problems.append(
            f"parameter {name!r} declares unit {unit!r}, which pint cannot "
            f"resolve - define it in units.yaml or correct the spelling")

    for parameter in parameters.values():
        payload = payload_for(parameter)
        template = existing.get(parameter.name)

        if template is None:
            pk = UNRESOLVED_PK
            if write:
                pk = ParameterTemplate.create(api, payload).pk
            result.templates.append(TemplateAction(parameter.name, "created",
                                                   pk, parameter.units))
            continue

        drift = {
            key: (getattr(template, key, None), value)
            for key, value in payload.items()
            if key != "name" and not matches(getattr(template, key, None), value)
        }
        if drift:
            if write:
                template.save(data=payload)
            result.templates.append(TemplateAction(parameter.name, "updated",
                                                   template.pk,
                                                   parameter.units, drift))
        else:
            result.templates.append(TemplateAction(parameter.name, "unchanged",
                                                   template.pk,
                                                   parameter.units))

    result.unmanaged = sorted(name for name in existing
                              if name not in parameters)
    if result.unmanaged:
        log.info("    %s template(s) on the server are not in the config: %s",
                 len(result.unmanaged), ", ".join(result.unmanaged))

    return result


def sync_config(
    directory: Path | str | None = None,
    api=None,
    *,
    write: bool = False,
) -> tuple[UnitSyncResult, SyncResult]:
    """
    Bring the server in step with the config: units first, then templates.

    The ordering is the point. A parameter template names its unit, and
    InvenTree refuses one it cannot resolve, so a custom unit has to exist
    before any template that uses it. Call this rather than the two separately.
    """
    api = api or connect()
    units = load_units_config(Path(directory) if directory is not None else None)
    parameters = load_parameters_config(
        Path(directory) if directory is not None else None)

    unit_result = sync_units(units, api, write=write)
    template_result = sync_templates(parameters, api, write=write, units=units)
    return unit_result, template_result
