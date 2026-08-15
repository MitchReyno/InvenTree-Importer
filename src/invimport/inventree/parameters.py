"""
InvenTree part parameters - templates and values.

Importable as a library:

    from invimport.inventree.parameters import load_parameters

    result = load_parameters("templates.csv", "values.csv", write=True)
    print(result.counts())
    for problem in result.problems:
        print(problem)

Two stages, both idempotent:
  1. Ensure every template in the templates CSV exists (create or update).
  2. Ensure every (part, template) pair in the values CSV has the right value.

Re-running is safe. Nothing is deleted, ever. With write=False the API is only
read from, and the returned actions describe what a write would do.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from .api import PART_MODEL_TYPE, Parameter, ParameterTemplate, Part, connect

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
class ValueAction:
    """What happened (or would happen) to one part parameter value."""
    ipn: str
    template: str
    action: str                                  # created | updated | unchanged
    new: str = ""
    old: str | None = None


@dataclass
class SyncResult:
    templates: list[TemplateAction] = field(default_factory=list)
    values: list[ValueAction] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    # True when a dry run could not resolve every template, so stage 2 was skipped.
    templates_pending: bool = False

    def counts(self) -> dict[str, int]:
        return {
            "created": sum(1 for v in self.values if v.action == "created"),
            "updated": sum(1 for v in self.values if v.action == "updated"),
            "unchanged": sum(1 for v in self.values if v.action == "unchanged"),
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


def clean(value) -> str:
    """Normalise a CSV cell to a stripped string. NaN becomes empty."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def read_table(source: pd.DataFrame | Path | str) -> pd.DataFrame:
    """Accept a DataFrame or a path to a CSV, so callers can pass either."""
    if isinstance(source, pd.DataFrame):
        return source
    return pd.read_csv(source, dtype=str)


# --------------------------------------------------------------------------
# Stage 1 - templates
# --------------------------------------------------------------------------
def sync_templates(api, df: pd.DataFrame, write: bool
                   ) -> tuple[dict[str, int], list[TemplateAction]]:
    """Create or update parameter templates. Returns ({name: pk}, actions)."""
    existing = {t.name: t for t in ParameterTemplate.list(api, limit=1000)}
    resolved: dict[str, int] = {}
    actions: list[TemplateAction] = []

    for _, row in df.iterrows():
        name = clean(row.get("name"))
        if not name:
            continue

        payload = {
            "name": name,
            "units": clean(row.get("units")),
            "description": clean(row.get("description")),
            "choices": clean(row.get("choices")),
            "checkbox": clean(row.get("checkbox")).lower() in ("true", "1", "yes"),
            # 530 templates declare which model they may be attached to.
            # Blank means "any model"; this importer only does part parameters.
            "model_type": PART_MODEL_TYPE,
        }

        if name in existing:
            tmpl = existing[name]
            drift = {
                k: (getattr(tmpl, k, None), v)
                for k, v in payload.items()
                if k != "name" and not matches(getattr(tmpl, k, None), v)
            }
            if drift:
                if write:
                    tmpl.save(data=payload)
                actions.append(TemplateAction(name, "updated", tmpl.pk,
                                              payload["units"], drift))
            else:
                actions.append(TemplateAction(name, "unchanged", tmpl.pk,
                                              payload["units"]))
            resolved[name] = tmpl.pk
        else:
            if write:
                created = ParameterTemplate.create(api, payload)
                resolved[name] = created.pk
            else:
                resolved[name] = UNRESOLVED_PK
            actions.append(TemplateAction(name, "created", resolved[name],
                                          payload["units"]))

    return resolved, actions


# --------------------------------------------------------------------------
# Stage 2 - parameter values
# --------------------------------------------------------------------------
def find_part(api, ipn: str):
    """Look up a single part by IPN. Refuses to guess if the match is ambiguous."""
    matches = Part.list(api, IPN=ipn)
    if not matches:
        return None, f"no part with IPN {ipn!r}"
    if len(matches) > 1:
        return None, f"IPN {ipn!r} matched {len(matches)} parts - not unique"
    return matches[0], None


def sync_values(api, df: pd.DataFrame, templates: dict[str, int], write: bool
                ) -> tuple[list[ValueAction], list[str]]:
    part_cache: dict[str, object] = {}
    actions: list[ValueAction] = []
    problems: list[str] = []

    for _, row in df.iterrows():
        ipn = clean(row.get("part_ipn"))
        tmpl_name = clean(row.get("template"))
        data = clean(row.get("data"))

        if not (ipn and tmpl_name and data):
            problems.append(
                f"incomplete row: ipn={ipn!r} template={tmpl_name!r} data={data!r}")
            continue

        if tmpl_name not in templates:
            problems.append(f"{ipn}: template {tmpl_name!r} not defined in templates CSV")
            continue

        if ipn not in part_cache:
            part, err = find_part(api, ipn)
            if err:
                problems.append(err)
                part_cache[ipn] = None
            else:
                part_cache[ipn] = part
        part = part_cache[ipn]
        if part is None:
            continue

        tmpl_pk = templates[tmpl_name]
        # 530 filters parameters by the generic model reference, and can narrow
        # by template server-side - no need to pull every parameter and sift.
        current = Parameter.list(
            api, model_type=PART_MODEL_TYPE, model_id=part.pk, template=tmpl_pk
        )

        if current:
            existing_value = str(getattr(current[0], "data", "")).strip()
            if existing_value == data:
                actions.append(ValueAction(ipn, tmpl_name, "unchanged", data,
                                           existing_value))
                continue
            if write:
                current[0].save(data={"data": data})
            actions.append(ValueAction(ipn, tmpl_name, "updated", data, existing_value))
        else:
            if write:
                Parameter.create(api, {
                    "model_type": PART_MODEL_TYPE,
                    "model_id": part.pk,
                    "template": tmpl_pk,
                    "data": data,
                })
            actions.append(ValueAction(ipn, tmpl_name, "created", data))

    return actions, problems


# --------------------------------------------------------------------------
# Public entrypoint
# --------------------------------------------------------------------------
def load_parameters(
    templates: pd.DataFrame | Path | str,
    values: pd.DataFrame | Path | str,
    api=None,
    *,
    write: bool = False,
) -> SyncResult:
    """
    Run both stages and return everything that happened.

    templates/values accept a DataFrame or a path to a CSV. Pass an existing
    InvenTree api handle to reuse a connection; omit it and one is created from
    the environment.
    """
    templates_df = read_table(templates)
    values_df = read_table(values)
    api = api or connect()

    resolved, template_actions = sync_templates(api, templates_df, write)
    result = SyncResult(templates=template_actions)

    # A dry run cannot check values against templates that do not exist yet.
    if not write and any(pk == UNRESOLVED_PK for pk in resolved.values()):
        result.templates_pending = True
        return result

    result.values, result.problems = sync_values(api, values_df, resolved, write)
    return result
