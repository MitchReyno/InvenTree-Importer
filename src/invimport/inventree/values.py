"""
Parameter values: a pint registry matching InvenTree's, and formatting.

    from invimport.inventree.values import Formatter

    fmt = Formatter()
    fmt.format(100000, "ohm")              # "100 kΩ"
    fmt.format(0.25, "W")                  # "250 mW"
    fmt.format(2.2e-7, "F")                # "220 nF"

Values are stored unit-bearing and human-readable rather than as bare numbers.
That costs nothing in sortability: InvenTree's convert_physical_value() parses
the stored string with pint against the template's unit and derives
data_numeric from it, so "100 kΩ" filters and sorts exactly as 100000 does.

The registry mirrors the one InvenTree builds in
InvenTree/conversion.py::reload_unit_registry - the same aliases, the same
R = ohm override, and the custom units from config/units.yaml declared the same
way. Formatting against a different registry than the server parses with would
be how subtly wrong values get in.

Round-trips are verified, not assumed. Pint's short-pretty format renders a
unit by its symbol, so the symbol has to parse back to the same quantity.
Operators are not the problem - "ppm/K" round-trips fine - but a symbol naming
a *different* quantity is: ppm_per_delta_degC displayed as "ppm/°C" re-reads as
ppm divided by an absolute temperature rather than a temperature interval, and
50 becomes 0.18. Every formatted value is parsed back and checked before it is
returned, so an ambiguous symbol falls back to a form that does round-trip.
"""

from __future__ import annotations

import logging
from typing import Any

import pint

from ..config import UnitConfig, load_units_config

log = logging.getLogger(__name__)

# Significant figures kept when formatting. Enough for any real component
# tolerance, few enough that binary floating point noise is rounded away -
# 2.2e-7 F would otherwise render as 219.99999999999997 nF.
SIGNIFICANT_FIGURES = 6

# How closely a value must survive being parsed back to count as round-tripped.
ROUND_TRIP_TOLERANCE = 1e-9

# Units that are already a scale, so SI-prefixing them compounds two scales
# and reads as nonsense: 0.5 ppm/K compacts to "500 mppm/K", 1500 to
# "1.5 kppm/K". Compaction is skipped for any expression involving one.
# Compared against pint's canonical names, not the spelling in the config.
RATIO_UNITS = frozenset({"ppm", "ppb", "percent", "permille", "permyriad"})

# Exactly what InvenTree defines before loading custom units. Kept in step with
# InvenTree/conversion.py::reload_unit_registry.
BASE_DEFINITIONS = (
    "@alias degC = Celsius",
    "@alias degF = Fahrenheit",
    "@alias degK = Kelvin",
    # pint reads a bare R as an SI prefix; InvenTree overrides it to ohm, which
    # is also what makes engineering notation like 4R7 work.
    "R = ohm",
    "piece = 1",
    "each = 1 = ea",
    "dozen = 12 = dz",
    "hundred = 100",
    "thousand = 1000",
)


def definition_for(unit: UnitConfig) -> str:
    """
    The pint definition string InvenTree builds for a custom unit.

    Mirrors CustomUnit.fmt_string(): 'name = definition' plus ' = symbol' when
    a symbol is set.
    """
    text = f"{unit.name} = {unit.definition}"
    if unit.symbol:
        text += f" = {unit.symbol}"
    return text


def build_registry(units: dict[str, UnitConfig] | None = None
                   ) -> pint.UnitRegistry:
    """Build a registry equivalent to the one the server parses values with."""
    registry = pint.UnitRegistry(autoconvert_offset_to_baseunit=True)

    for definition in BASE_DEFINITIONS:
        registry.define(definition)

    if units is None:
        units = load_units_config()
    for unit in units.values():
        try:
            registry.define(definition_for(unit))
        except Exception as exc:                 # a bad custom unit must not
            log.warning("    [warn] custom unit %s is not usable: %s",
                        unit.name, exc)          # break every other value
    return registry


def clean_number(value: float) -> str:
    """
    A number as a human would write it.

    Stripped of a trailing '.0' so 100.0 reads as 100, and rounded to
    significant figures so binary floating point noise does not reach the
    field - 219.99999999999997 is 220, and 999999.9999999999 is 1000000.

    An exact integer is returned whole and unrounded first: rounding one to
    six significant figures would turn 1234567 into 1234570, quietly losing a
    digit that was never noise.
    """
    number = float(value)
    if number == int(number) and abs(number) < 1e16:
        return str(int(number))

    rounded = float(f"{number:.{SIGNIFICANT_FIGURES}g}")
    if rounded == int(rounded) and abs(rounded) < 1e16:
        return str(int(rounded))
    return f"{rounded:g}"


class Formatter:
    """
    Renders magnitudes as unit-bearing strings InvenTree can read back.

    One instance holds one registry; build it once and reuse it, since
    constructing a pint registry is not cheap.
    """

    def __init__(self, units: dict[str, UnitConfig] | None = None,
                 registry: pint.UnitRegistry | None = None):
        if units is None:
            units = load_units_config()
        self.registry = registry or build_registry(units)
        # Custom units are defined at the scale they are used at, so SI
        # prefixing them helps nobody. Built-in units do benefit - 0.25 W
        # really is nicer as 250 mW - so compaction is skipped only for these
        # and for the ratio units above.
        self.custom = set(units)

    def compactable(self, unit: str) -> bool:
        """Would SI-prefixing this unit help, or just compound two scales?"""
        if unit in self.custom:
            return False
        try:
            constituents = set(self.registry.Unit(unit)._units)
        except Exception:
            return False
        return not (constituents & RATIO_UNITS)

    # -- checking ----------------------------------------------------------
    def parses_to(self, text: str, magnitude: float, unit: str) -> bool:
        """Does this text read back as the number we meant, in the right unit?"""
        try:
            parsed = self.registry.Quantity(text)
            value = parsed.to(unit).magnitude if unit else parsed.magnitude
        except Exception:
            return False
        return abs(float(value) - float(magnitude)) <= (
            abs(float(magnitude)) * ROUND_TRIP_TOLERANCE + 1e-12)

    # -- formatting --------------------------------------------------------
    def candidates(self, magnitude: float, unit: str) -> list[str]:
        """
        Renderings to try, best-looking first.

        1. Compact short-pretty - "100 kΩ", the readable form.
        2. Short-pretty without rescaling, for a unit compaction mangles.
        3. The unit's full name - "50 ppm_per_delta_degC". Ugly, but it parses.
        """
        quantity = self.registry.Quantity(magnitude, unit)
        options: list[str] = []
        compact = self._compact(quantity) if self.compactable(unit) else None

        for candidate in (compact, quantity):
            if candidate is None:
                continue
            symbol = f"{candidate.units:~P}".strip()
            number = clean_number(candidate.magnitude)
            text = f"{number} {symbol}" if symbol else number
            if text not in options:
                options.append(text)

        if unit:
            options.append(f"{clean_number(magnitude)} {unit}")
        return options

    def _compact(self, quantity):
        """to_compact(), or None where pint cannot rescale (offset units)."""
        try:
            return quantity.to_compact()
        except Exception:
            return None

    def format(self, magnitude: Any, unit: str = "") -> str:
        """
        Render a magnitude in a unit as a readable, re-readable string.

        Falls back through progressively plainer forms until one parses back to
        the value it started as. If none does - which would mean the unit
        itself is unusable - the bare number is returned, since a number
        without a unit is at least not *wrong*.
        """
        if magnitude is None or magnitude == "":
            return ""

        try:
            number = float(magnitude)
        except (TypeError, ValueError):
            return str(magnitude)                # already a string like "Axial"

        if not unit:
            return clean_number(number)

        for text in self.candidates(number, unit):
            if self.parses_to(text, number, unit):
                return text

        log.warning("    [warn] no readable form of %s %s survives being parsed "
                    "back; storing the bare number", number, unit)
        return clean_number(number)
