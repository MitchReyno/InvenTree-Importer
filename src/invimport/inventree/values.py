"""
Parameter values: parse DigiKey text, format it for InvenTree.

    from invimport.inventree.values import Formatter, from_supplier

    fmt = Formatter()
    fmt.format(100000, "ohm")              # "100 kΩ"
    from_supplier({"Resistance": "100 kOhms"}, parameters)
    # {"Resistance": "100 kΩ"}

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
import re
from typing import Any

import pint

from ..config import PARSE_KINDS, ParameterConfig, UnitConfig, load_units_config

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


# --------------------------------------------------------------------------
# Parsing supplier text
# --------------------------------------------------------------------------
# DigiKey writes '-' for a parameter it does not have. Must not be stored.
ABSENT = frozenset({"-", "—", "n/a", "na", ""})

# SI prefixes that DigiKey sticks on a bare number: "100k" meaning 100000.
# Isolated from pint, because pint reads a trailing 'k' as Boltzmann's constant.
SI_PREFIXES = {
    "f": 1e-15, "p": 1e-12, "n": 1e-9,
    "u": 1e-6, "µ": 1e-6, "μ": 1e-6,
    "m": 1e-3, "k": 1e3, "M": 1e6, "G": 1e9, "T": 1e12,
}

# Spellings pint does not know. Applied only when reading supplier text - the
# formatting registry must stay identical to the server's.
SUPPLIER_DEFINITIONS = (
    "Ohms = ohm",
    "kOhms = kohm",
    "MOhms = Mohm",
    "mOhms = milliohm",
    "Ohm = ohm",
    "VAC = V",
    "VDC = V",
)

# Offset temperatures. Dividing by one is a different quantity than dividing
# by a temperature interval (ppm/°C is not ppm/K), so a conversion that would
# go through one is refused and the magnitude is kept as written.
OFFSET_MARKERS = ("°C", "degC", "celsius", "°F", "degF", "fahrenheit")

NUMBER = re.compile(
    r"^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$"
)
FRACTION = re.compile(r"^\s*([+-]?\d+)\s*/\s*(\d+)\s*(.*)$")
TRAILING_PARENS = re.compile(r"\s*\([^)]*\)\s*$")
AT_FREQUENCY = re.compile(r"\s+@\s+\S+")
RANGE_SPLIT = re.compile(r"\s*[~–—]\s*|\s+to\s+", re.IGNORECASE)


def strip_decoration(text: str) -> str:
    """
    Peel the bits of a DigiKey value that are not the quantity.

    ± is a tolerance marker, (TA)/(TJ) names the measurement point, and
    '@ 120Hz' is a test condition. The leading minus of -55°C is a sign and
    is left alone.
    """
    text = (text or "").strip().replace("\u2212", "-")
    if text.casefold() in ABSENT:
        return ""
    text = text.lstrip("±+")
    text = TRAILING_PARENS.sub("", text).strip()
    text = AT_FREQUENCY.sub("", text).strip()
    return text


def split_magnitude(text: str) -> tuple[float | None, str]:
    """'100 kOhms' -> (100, 'kOhms'); '1/4W' -> (0.25, 'W')."""
    text = text.strip()
    frac = FRACTION.match(text)
    if frac and int(frac.group(2)) != 0:
        return int(frac.group(1)) / int(frac.group(2)), frac.group(3).strip()
    match = NUMBER.match(text)
    if not match:
        return None, text
    return float(match.group(1)), match.group(2).strip()


def divides_by_offset(unit: str) -> bool:
    """Is this an expression that divides by an absolute temperature?"""
    if "/" not in unit:
        return False
    _, _, denom = unit.partition("/")
    lowered = denom.casefold()
    return any(marker.casefold() in lowered for marker in OFFSET_MARKERS)


def build_parse_registry(units: dict[str, UnitConfig] | None = None
                         ) -> pint.UnitRegistry:
    """InvenTree's registry plus the DigiKey spellings it does not know."""
    registry = build_registry(units)
    for definition in SUPPLIER_DEFINITIONS:
        try:
            registry.define(definition)
        except Exception:
            pass                                 # already defined is fine
    return registry


def parse_quantity(text: str, unit: str = "",
                   registry: pint.UnitRegistry | None = None) -> float | None:
    """
    A magnitude in `unit`, or None if the text is absent or unreadable.

    Pint is used to convert '100 kOhms' to 100000 ohm, but it is not trusted
    with the whole string: '100k' is Boltzmann's constant, '@ 120Hz' is
    multiplication, and '50ppm/°C' converts to 0.18 ppm/K. The number is
    taken first; conversion is applied only when the remaining unit is a
    safe scale of the target.
    """
    cleaned = strip_decoration(text)
    if not cleaned:
        return None

    number, rest = split_magnitude(cleaned)
    if number is None:
        return None

    if rest in SI_PREFIXES and rest not in (unit, ""):
        # A lone prefix: "100k" with target ohm is 100000 ohm, not 100 k.
        # Do not treat the target unit itself as a prefix - "m" as meter
        # is not a case we see, and "mW" is a unit, not a prefix.
        if len(rest) == 1:
            return number * SI_PREFIXES[rest]

    if not rest:
        return number

    if divides_by_offset(rest):
        return number

    registry = registry or build_parse_registry()
    try:
        quantity = registry.Quantity(number, rest)
        if unit:
            return float(quantity.to(unit).magnitude)
        return float(quantity.magnitude)
    except Exception:
        return number


def parse_percent(text: str, unit: str = "",
                  registry: pint.UnitRegistry | None = None) -> float | None:
    """'±1%' -> 1. The percent sign is decoration; the number is the value."""
    cleaned = strip_decoration(text).rstrip("%").strip()
    if not cleaned:
        return None
    number, rest = split_magnitude(cleaned)
    if number is None or (rest and rest not in SI_PREFIXES):
        return None
    if rest in SI_PREFIXES:
        number *= SI_PREFIXES[rest]
    return number


def parse_quantity_first(text: str, unit: str = "",
                         registry: pint.UnitRegistry | None = None
                         ) -> float | None:
    """'0.25W, 1/4W' -> 0.25. DigiKey puts the decimal form first."""
    cleaned = strip_decoration(text)
    if not cleaned:
        return None
    first = cleaned.split(",", 1)[0].strip()
    return parse_quantity(first, unit, registry)


def split_range(text: str) -> tuple[str, str] | None:
    """'-55°C ~ 155°C' -> ('-55°C', '155°C')."""
    cleaned = strip_decoration(text)
    if not cleaned:
        return None
    parts = RANGE_SPLIT.split(cleaned)
    if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
        return None
    return parts[0].strip(), parts[1].strip()


def parse_range_low(text: str, unit: str = "",
                    registry: pint.UnitRegistry | None = None) -> float | None:
    parts = split_range(text)
    if parts is None:
        return None
    return parse_quantity(parts[0], unit, registry)


def parse_range_high(text: str, unit: str = "",
                     registry: pint.UnitRegistry | None = None) -> float | None:
    parts = split_range(text)
    if parts is None:
        return None
    return parse_quantity(parts[1], unit, registry)


PARSERS = {
    "quantity": parse_quantity,
    "percent": parse_percent,
    "quantity_first": parse_quantity_first,
    "range_low": parse_range_low,
    "range_high": parse_range_high,
}


def parse(text: str, kind: str, unit: str = "",
          registry: pint.UnitRegistry | None = None) -> float | None:
    """Dispatch to the named parser. Unknown kinds raise KeyError."""
    if kind not in PARSE_KINDS:
        raise KeyError(kind)
    return PARSERS[kind](text, unit, registry)


def mapped_value(text: str, parameter: ParameterConfig) -> str | None:
    """The canonical spelling, if this text is one we know."""
    wanted = text.strip().casefold()
    if not wanted:
        return None
    if wanted == parameter.name.casefold():
        return parameter.name
    for canonical, spellings in parameter.values.items():
        if wanted == canonical.casefold():
            return canonical
        for spelling in spellings:
            if wanted == spelling.casefold():
                return canonical
    return None


def choice_value(text: str, parameter: ParameterConfig) -> str | None:
    """
    A value that is allowed by this parameter's choices, or None.

    The values: map is applied first, so 'Axial' becomes 'Through Hole'
    before the choices list is checked. Matching is case-insensitive; the
    canonical (or listed) spelling is what gets stored.
    """
    mapped = mapped_value(text, parameter)
    if mapped is not None:
        if not parameter.choices or mapped in parameter.choices:
            return mapped
        return None
    for choice in parameter.choices:
        if choice.casefold() == text.strip().casefold():
            return choice
    return None


def is_absent(text: Any) -> bool:
    """Is this DigiKey's way of saying the parameter is not there?"""
    if text is None:
        return True
    return str(text).strip().casefold() in ABSENT


def read_value(text: str, parameter: ParameterConfig,
               formatter: Formatter | None = None,
               registry: pint.UnitRegistry | None = None) -> str | None:
    """
    One supplier value -> the string we would store, or None if there is
    nothing to store (absent, unparseable, or not a valid choice).
    """
    if is_absent(text):
        return None

    raw = str(text).strip()

    if parameter.parse:
        magnitude = parse(raw, parameter.parse, parameter.units, registry)
        if magnitude is None:
            return None
        formatter = formatter or Formatter()
        return formatter.format(magnitude, parameter.units)

    if parameter.values or parameter.choices:
        chosen = choice_value(raw, parameter)
        if chosen is not None:
            return chosen
        if parameter.choices:
            return None                          # a fixed set: do not invent
        return raw

    return raw


def supplier_text(supplier: dict[str, str],
                  parameter: ParameterConfig) -> str | None:
    """The first supplier field this parameter recognises, or None."""
    for name in parameter.supplier_names():
        if name in supplier:
            return supplier[name]
    return None


def from_supplier(
    supplier: dict[str, str],
    parameters: dict[str, ParameterConfig],
    names: list[str] | None = None,
    formatter: Formatter | None = None,
    registry: pint.UnitRegistry | None = None,
) -> dict[str, str]:
    """
    Read the named parameters out of a DigiKey parameters dict.

    names defaults to every parameter. A parameter whose aliases miss every
    supplier key, or whose value cannot be read, is omitted - never written
    as '-' or as a guess.
    """
    formatter = formatter or Formatter()
    registry = registry or build_parse_registry()
    wanted = names if names is not None else list(parameters)
    out: dict[str, str] = {}

    for name in wanted:
        parameter = parameters.get(name)
        if parameter is None:
            continue
        text = supplier_text(supplier, parameter)
        if text is None:
            continue
        value = read_value(text, parameter, formatter, registry)
        if value is not None:
            out[name] = value
    return out
