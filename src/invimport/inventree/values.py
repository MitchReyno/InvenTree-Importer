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
from functools import lru_cache
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


def _new_registry(units: dict[str, UnitConfig]) -> pint.UnitRegistry:
    registry = pint.UnitRegistry(autoconvert_offset_to_baseunit=True)
    for definition in BASE_DEFINITIONS:
        registry.define(definition)
    for unit in units.values():
        try:
            registry.define(definition_for(unit))
        except Exception as exc:                 # a bad custom unit must not
            log.warning("    [warn] custom unit %s is not usable: %s",
                        unit.name, exc)          # break every other value
    return registry


@lru_cache(maxsize=1)
def _default_registry() -> pint.UnitRegistry:
    return _new_registry(load_units_config())


def build_registry(units: dict[str, UnitConfig] | None = None
                   ) -> pint.UnitRegistry:
    """Build a registry equivalent to the one the server parses values with.

    The default (config/units.yaml) is built once and reused: constructing a
    pint registry is ~100ms, and parsers used to pay that on every call.
    Pass an explicit units dict for a private registry that will not be cached.
    """
    if units is None:
        return _default_registry()
    return _new_registry(units)


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


# SI prefixes used in generated part names: 100000 ohm -> "100k", 2.2e-7 F
# -> "220n". Magnitudes in [0.001, 1000) stay plain so 0.25 W is "0.25".
NAME_PREFIXES = (
    (1e12, "T"), (1e9, "G"), (1e6, "M"), (1e3, "k"),
    (1e-3, "m"), (1e-6, "u"), (1e-9, "n"), (1e-12, "p"), (1e-15, "f"),
)


# Symbol -> scale, for looking a configured prefix up by name. "" is the
# unprefixed unit itself, and "R" is how RKM writes it for ohms - both are
# unity, and both let a parameter say "never go below the base unit".
NAME_PREFIX_SCALE = {symbol: scale for scale, symbol in NAME_PREFIXES}
NAME_PREFIX_SCALE[""] = 1.0
NAME_PREFIX_SCALE["R"] = 1.0

# The SI prefix a configured symbol contributes to a *stored* value. Names may
# write 4.7 ohm as "4R7", but a stored value has the unit spelled out beside
# it, so unity contributes nothing and "u" is written the way pint prints it.
STORED_PREFIX = {"": "", "R": "", "u": "µ"}


def choose_prefix(number: float, prefixes: list[str]) -> tuple[float, str]:
    """
    The prefix a value is written with, given the set it may use.

    Largest first, so a value keeps the biggest unit it can fill; the smallest
    is the floor, because below it there is nothing left to step down to.
    Returns (scale, symbol).
    """
    allowed = sorted(((NAME_PREFIX_SCALE[p], p) for p in prefixes
                      if p in NAME_PREFIX_SCALE), reverse=True)
    if not allowed:
        return 1.0, ""
    return next(((sc, sym) for sc, sym in allowed if abs(number) / sc >= 1),
                allowed[-1])


def rkm(mantissa: float, symbol: str) -> str:
    """
    A value in RKM notation (IEC 60062): 4R7, 3k3, 2M2, 7k.

    The prefix stands where the decimal point would, which is the point of the
    notation - it cannot be lost to a bad photocopy or a narrow column. A
    whole number just takes the symbol as a suffix, and a value below 1 keeps
    its decimal point, because "0R5" reads worse than "0.5R".
    """
    text = clean_number(abs(mantissa))
    sign = "-" if mantissa < 0 else ""
    whole, _, fraction = text.partition(".")
    if not fraction or whole in ("0", ""):
        return sign + text + symbol
    return sign + whole + symbol + fraction


def compact_for_name(magnitude: float,
                     prefixes: list[str] | None = None,
                     style: str = "") -> str:
    """
    A magnitude as it appears in a generated part name, without a unit.

    With `prefixes`, the parameter is written only with those SI prefixes,
    largest first, and the smallest one that leaves a mantissa of at least 1
    wins. That is how component values are actually written: a 3300 uF
    capacitor is '3300u', not the '3.3m' a free choice of prefix would give,
    and 100 pF stays '100p' rather than becoming '0.1n'.

    Without them, any prefix may be used, and a number that already reads
    plainly is left alone - '0.25' for a quarter-watt rating, whose template
    supplies the 'W' itself.

    style="rkm" writes the prefix where the decimal point would go: 4R7, 3k3.
    """
    if magnitude == 0:
        return "0"
    sign = "-" if magnitude < 0 else ""
    number = abs(float(magnitude))

    if prefixes:
        scale, symbol = choose_prefix(number, prefixes)
        if style == "rkm":
            return sign + rkm(number / scale, symbol)
        return sign + clean_number(number / scale) + symbol

    if 0.001 <= number < 1000:
        return sign + clean_number(number)
    for scale, symbol in NAME_PREFIXES:
        mantissa = number / scale
        if 1 <= mantissa < 1000:
            return sign + clean_number(mantissa) + symbol
    return sign + clean_number(number)


class Formatter:
    """
    Renders magnitudes as unit-bearing strings InvenTree can read back.

    One instance holds one registry; build it once and reuse it, since
    constructing a pint registry is not cheap.
    """

    def __init__(self, units: dict[str, UnitConfig] | None = None,
                 registry: pint.UnitRegistry | None = None):
        default = units is None
        if default:
            units = load_units_config()
        # The default config hits the cached registry; an explicit dict
        # (tests, a caller with its own units) gets a private one.
        self.registry = registry or (build_registry() if default
                                     else build_registry(units))
        # Custom units are defined at the scale they are used at, so SI
        # prefixing them helps nobody. Built-in units do benefit - 0.25 W
        # really is nicer as 250 mW - so compaction is skipped only for these
        # and for the ratio units above.
        self.custom = set(units)

    def compactable(self, unit: str) -> bool:
        """Would SI-prefixing this unit help, or just compound two scales?"""
        if unit in self.custom:
            return False
        if "/" in unit:
            # A rate reads best in the units it was written in. Compacting
            # only moves the prefix across the divide: an op-amp's 13 V/µs
            # becomes 13 MV/s, which is the same number and nobody's idiom.
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
    def preferred(self, quantity, unit: str, prefixes: list[str]):
        """
        The quantity rescaled to the prefix its parameter is written with.

        Keeps a stored value in the unit the part table should show it in -
        3300 µF rather than the 3.3 mF pint's own compaction picks, and 0.05 Ω
        rather than 50 mΩ. Returns None if the rescale is not possible, and
        the caller falls back to compaction as before.
        """
        scale, symbol = choose_prefix(float(quantity.magnitude), prefixes)
        si = STORED_PREFIX.get(symbol, symbol)
        try:
            return quantity.to(f"{si}{self.registry.Unit(unit):~P}")
        except Exception:
            return None

    def candidates(self, magnitude: float, unit: str,
                   prefixes: list[str] | None = None) -> list[str]:
        """
        Renderings to try, best-looking first.

        1. The parameter's preferred prefix, where it names one.
        2. Compact short-pretty - "100 kΩ", the readable form.
        3. Short-pretty without rescaling, for a unit compaction mangles.
        4. The unit's full name - "50 ppm_per_delta_degC". Ugly, but it parses.
        """
        quantity = self.registry.Quantity(magnitude, unit)
        options: list[str] = []
        rescalable = self.compactable(unit)
        wanted = (self.preferred(quantity, unit, prefixes)
                  if prefixes and rescalable else None)
        compact = self._compact(quantity) if rescalable else None

        for candidate in (wanted, compact, quantity):
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

    def format(self, magnitude: Any, unit: str = "",
               prefixes: list[str] | None = None) -> str:
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

        for text in self.candidates(number, unit, prefixes):
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


@lru_cache(maxsize=1)
def _default_parse_registry() -> pint.UnitRegistry:
    return _new_parse_registry(load_units_config())


def _new_parse_registry(units: dict[str, UnitConfig]) -> pint.UnitRegistry:
    # Built from scratch, not from the cached InvenTree registry: supplier
    # aliases are extra definitions and must not leak into Formatter's copy.
    registry = _new_registry(units)
    for definition in SUPPLIER_DEFINITIONS:
        try:
            registry.define(definition)
        except Exception:
            pass                                 # already defined is fine
    return registry


def build_parse_registry(units: dict[str, UnitConfig] | None = None
                         ) -> pint.UnitRegistry:
    """InvenTree's registry plus the DigiKey spellings it does not know."""
    if units is None:
        return _default_parse_registry()
    return _new_parse_registry(units)


# RKM code (IEC 60062): the multiplier stands in for the decimal point, so a
# marking survives a photocopier that would lose a '.'. 4k7 is 4.7 kilo, 4R7 is
# 4.7 with no multiplier, 2M2 is 2.2 mega. Digits are required on both sides,
# which keeps part numbers like 1N4007 out of it.
RKM = re.compile(r"^(\d+)\s*([RrKkMGgTtmuµnp])\s*(\d+)$")
RKM_PREFIX = {"R": "", "r": "", "K": "k", "k": "k", "M": "M", "G": "G",
              "g": "G", "T": "T", "t": "T", "m": "m", "u": "µ", "µ": "µ",
              "n": "n", "p": "p"}


def expand_rkm(text: str) -> str:
    """
    '4k7' -> '4.7k'. Unchanged if it is not RKM code.

    Worth handling because it is what is printed on the part and what people
    write on a bag. Left alone, '4k7' reads as 4 - the trailing digits are
    silently dropped, giving a value wrong by three orders of magnitude with
    nothing to indicate it.
    """
    match = RKM.match(str(text or "").strip())
    if not match:
        return text
    whole, letter, fraction = match.groups()
    return f"{whole}.{fraction}{RKM_PREFIX[letter]}"


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
    cleaned = expand_rkm(strip_decoration(text))
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


# The parenthesised metric equivalent DigiKey appends to an imperial
# dimension: 0.197" Dia (5.00mm). Requires a number and a length unit, so
# measurement-point notes like (TA) and (Max) never match.
PARENS_GROUP = re.compile(r"\(([^()]*)\)")
METRIC_LENGTH = re.compile(r"[\d.]+\s*(?:nm|µm|um|mm|cm|m)\b", re.IGNORECASE)


def metric_measurements(text: str) -> list[str] | None:
    """
    The metric length measurements in a DigiKey (or already-metric) dimension.

    DigiKey states a dimension imperial-first with the metric equivalent in
    parentheses: 0.197" Dia (5.00mm), or 0.094" Dia x 0.248" L (2.40mm x
    6.30mm). That parenthesised group is what we want; taking the number off
    the front instead reads 0.197 as though it were already mm, storing
    197 µm for a 5 mm can - wrong by 25.4x, and silently so.

    A stock file already written in millimetres ('2.4 mm', '2.4 mm x 6.3 mm')
    has no such group, and is used as-is. Returns None when nothing metric is
    there, so an imperial value without a conversion is not stored as though
    it were already mm.
    """
    groups = PARENS_GROUP.findall(text or "")
    metric = [g for g in groups if METRIC_LENGTH.search(g)]
    if metric:
        inner = metric[-1].strip()
    else:
        inner = (text or "").strip()
        if not METRIC_LENGTH.search(inner):
            return None
    parts = [p.strip() for p in re.split(r"\s*x\s*", inner, flags=re.IGNORECASE)
             if p.strip()]
    return parts or None


def parse_metric(text: str, unit: str = "",
                 registry: pint.UnitRegistry | None = None) -> float | None:
    """
    '0.197" Dia (5.00mm)' -> 5.0 - the metric value, not the imperial one.

    A value naming two dimensions at once ('0.094" Dia x 0.248" L (2.40mm x
    6.30mm)', a resistor body) is not one measurement, so it returns None
    rather than picking a side. metric_first / metric_last split those.
    """
    parts = metric_measurements(text)
    if not parts or len(parts) != 1:
        return None
    return parse_quantity(parts[0], unit, registry)


def parse_metric_first(text: str, unit: str = "",
                       registry: pint.UnitRegistry | None = None
                       ) -> float | None:
    """
    The first metric measurement: diameter of '2.40mm x 6.30mm', or the
    only one of a single-dimension can.
    """
    parts = metric_measurements(text)
    if not parts:
        return None
    return parse_quantity(parts[0], unit, registry)


def parse_metric_last(text: str, unit: str = "",
                      registry: pint.UnitRegistry | None = None
                      ) -> float | None:
    """
    The last metric measurement: body length of '2.40mm x 6.30mm'.

    A single dimension is not a pair, so it returns None rather than
    duplicating the diameter as a length.
    """
    parts = metric_measurements(text)
    if not parts or len(parts) < 2:
        return None
    return parse_quantity(parts[-1], unit, registry)


def split_range(text: str) -> tuple[str, str] | None:
    """
    '-55°C ~ 155°C' -> ('-55°C', '155°C'); prose stays prose.

    Both halves must start with a number. Without that check the ' to '
    separator turns any phrase containing the word into a range - a
    connector's 'Board to Board' splits into ('Board', 'Board') and gets
    offered as a two-parameter measurement, and a parameter configured that
    way then silently stores nothing.
    """
    cleaned = strip_decoration(text)
    if not cleaned:
        return None
    parts = RANGE_SPLIT.split(cleaned)
    if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
        return None
    low, high = parts[0].strip(), parts[1].strip()
    if split_magnitude(low)[0] is None or split_magnitude(high)[0] is None:
        return None
    return low, high


def range_bounds(text: str) -> tuple[str, str] | None:
    """
    The low and high of a supplier range, or the same value twice.

    DigiKey's op-amp supply is '2.7V ~ 5.5V, ±1.35V ~ 2.75V': the first
    comma-separated group is the single-supply range, the dual follows.
    Taking the first group is the same rule as quantity_first. A lone
    value ('5V') is a range of one, so both ends are that value rather
    than storing nothing.
    """
    cleaned = strip_decoration(text)
    if not cleaned:
        return None
    first = cleaned.split(",", 1)[0].strip()
    parts = split_range(first)
    if parts is not None:
        return parts
    if split_magnitude(first)[0] is None:
        return None
    return first, first


def parse_range_low(text: str, unit: str = "",
                    registry: pint.UnitRegistry | None = None) -> float | None:
    parts = range_bounds(text)
    if parts is None:
        return None
    return parse_quantity(parts[0], unit, registry)


def parse_range_high(text: str, unit: str = "",
                     registry: pint.UnitRegistry | None = None) -> float | None:
    parts = range_bounds(text)
    if parts is None:
        return None
    return parse_quantity(parts[1], unit, registry)


PARSERS = {
    "quantity": parse_quantity,
    "percent": parse_percent,
    "quantity_first": parse_quantity_first,
    "range_low": parse_range_low,
    "range_high": parse_range_high,
    "metric": parse_metric,
    "metric_first": parse_metric_first,
    "metric_last": parse_metric_last,
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
        return formatter.format(magnitude, parameter.units,
                                parameter.prefixes)

    if parameter.values or parameter.choices:
        chosen = choice_value(raw, parameter)
        if chosen is not None:
            return chosen
        if parameter.choices:
            return None                          # a fixed set: do not invent
        return raw

    return raw


def same_dimension(text: str, unit: str,
                   registry: pint.UnitRegistry | None = None) -> bool:
    """
    Does this value carry a unit measuring the same thing as `unit`?

    Stricter than "does it parse": parse_quantity deliberately falls back to
    the bare number when the trailing unit will not convert, so by that test
    '0.25 W' is a valid voltage. Comparing dimensionality is what makes a
    value usable as evidence of which parameter was meant.
    """
    if not unit:
        return False
    registry = registry or build_parse_registry()
    magnitude, given = split_magnitude(expand_rkm(strip_decoration(str(text))))
    if magnitude is None or not given.strip():
        return False
    try:
        return (registry.Unit(given.strip()).dimensionality
                == registry.Unit(unit).dimensionality)
    except Exception:
        return False


def fold_supplier_name(name: str) -> str:
    """
    The form two spellings of one supplier field have in common.

    Case and whitespace only: 'Package / Case', 'Package/Case' and
    'package / case' are the same field. DigiKey is consistent enough not to
    need this, but a file written by hand or by an agent is not, and a
    parameter that silently stores nothing is the worst way to find out.
    """
    return re.sub(r"\s+", "", str(name or "")).casefold()


def supplier_text(supplier: dict[str, str],
                  parameter: ParameterConfig) -> str | None:
    """
    The first supplier field this parameter recognises, or None.

    Exact matches are tried first, in the order supplier_names() gives them,
    so a product carrying two of a parameter's aliases resolves to whichever
    the config lists first. Only then is the folded comparison tried.
    """
    for name in parameter.supplier_names():
        if name in supplier:
            return supplier[name]

    folded = {fold_supplier_name(key): value for key, value in supplier.items()}
    for name in parameter.supplier_names():
        match = folded.get(fold_supplier_name(name))
        if match is not None:
            return match
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
