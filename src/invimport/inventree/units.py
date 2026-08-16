"""
Custom units, defined in config/units.yaml.

Importable as a library:

    from invimport.inventree.units import sync_units

    result = sync_units(write=True)
    print(result.counts())

**Units come before parameter templates.** A template declares its unit by
name, and InvenTree rejects one it cannot resolve - so a template using
ppm_per_delta_degC cannot be created until that unit exists. sync_config() in
invimport.inventree.parameters does the two in the right order; call it rather
than remembering the ordering yourself.

Idempotent, and nothing is deleted: a unit on the server that the config does
not mention is reported and left alone, because templates may reference it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import UnitConfig, load_units_config
from .api import CustomUnit, connect

log = logging.getLogger(__name__)

UNRESOLVED_PK = -1


@dataclass
class UnitAction:
    """What happened (or would happen) to one custom unit."""
    name: str
    action: str                                  # created | updated | unchanged
    pk: int | None = None
    definition: str = ""
    drift: dict[str, tuple[Any, Any]] = field(default_factory=dict)


@dataclass
class UnitSyncResult:
    units: list[UnitAction] = field(default_factory=list)
    unmanaged: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "created": sum(1 for u in self.units if u.action == "created"),
            "updated": sum(1 for u in self.units if u.action == "updated"),
            "unchanged": sum(1 for u in self.units if u.action == "unchanged"),
            "unmanaged": len(self.unmanaged),
            "problems": len(self.problems),
        }


def payload_for(unit: UnitConfig) -> dict[str, Any]:
    return {
        "name": unit.name,
        "definition": unit.definition,
        "symbol": unit.symbol,
    }


def sync_units(
    units: dict[str, UnitConfig] | Path | str | None = None,
    api=None,
    *,
    write: bool = False,
) -> UnitSyncResult:
    """
    Create or update every custom unit the config defines.

    units accepts a loaded config, a path to a config directory, or None to use
    config/ at the repo root.
    """
    if units is None or isinstance(units, (str, Path)):
        directory = Path(units) if units is not None else None
        units = load_units_config(directory)

    api = api or connect()
    existing = {u.name: u for u in CustomUnit.list(api, limit=1000)}
    result = UnitSyncResult()

    for unit in units.values():
        payload = payload_for(unit)
        current = existing.get(unit.name)

        if current is None:
            pk = UNRESOLVED_PK
            if write:
                pk = CustomUnit.create(api, payload).pk
            result.units.append(UnitAction(unit.name, "created", pk,
                                           unit.definition))
            continue

        drift = {
            key: (getattr(current, key, None), value)
            for key, value in payload.items()
            if key != "name" and str(getattr(current, key, None) or "") != str(value)
        }
        if drift:
            if write:
                current.save(data=payload)
            result.units.append(UnitAction(unit.name, "updated", current.pk,
                                           unit.definition, drift))
        else:
            result.units.append(UnitAction(unit.name, "unchanged", current.pk,
                                           unit.definition))

    result.unmanaged = sorted(name for name in existing if name not in units)
    result.problems.extend(ambiguous_symbols(units))
    return result


def ambiguous_symbols(units: dict[str, UnitConfig]) -> list[str]:
    """
    Which custom units have a display symbol that reads back as something else?

    Pint's short format renders a unit by its symbol, so the symbol has to be
    an expression that parses back to the same quantity. Operators are fine -
    "ppm/K" and "ppm*K^-1" both round-trip, because they genuinely mean
    ppm / delta_degC. What breaks is a symbol naming a different quantity:
    "ppm/°C" divides by an *absolute* temperature rather than a temperature
    interval, turning 50 into 0.18.

    Values fall back to the unit's full name when that happens, so nothing is
    ever stored wrongly - but the reason they look verbose is worth saying,
    since the fix is a one-word change to the symbol.
    """
    from .values import Formatter                # local: avoids a cycle

    problems: list[str] = []
    formatter = Formatter(units)

    for unit in units.values():
        if not unit.symbol:
            continue
        if not formatter.parses_to(f"1 {unit.symbol}", 1, unit.name):
            problems.append(
                f"custom unit {unit.name!r} has symbol {unit.symbol!r}, which "
                f"reads back as a different quantity - values will use the "
                f"full name {unit.name!r} instead. A symbol that parses to "
                f"{unit.definition!r} would display neatly; watch for offset "
                f"units like degC, where a temperature interval needs K or "
                f"delta_degC")

    return problems
