"""Formatting parameter values so InvenTree can read them back."""

from __future__ import annotations

import pytest

from invimport.config import UnitConfig
from invimport.inventree.units import ambiguous_symbols
from invimport.inventree.values import (
    BASE_DEFINITIONS,
    Formatter,
    build_registry,
    clean_number,
    definition_for,
)

TEMPCO = {"ppm_per_delta_degC": UnitConfig("ppm_per_delta_degC",
                                           "ppm / delta_degC", "ppm/°C")}


@pytest.fixture(scope="module")
def fmt() -> Formatter:
    """One registry for the module; building a pint registry is not cheap."""
    return Formatter(TEMPCO)


# --------------------------------------------------------------------------
# Readable output
# --------------------------------------------------------------------------
@pytest.mark.parametrize("magnitude,unit,expected", [
    (100000, "ohm", "100 kΩ"),
    (4700, "ohm", "4.7 kΩ"),
    (4870, "ohm", "4.87 kΩ"),
    (10, "ohm", "10 Ω"),
    (0.47, "ohm", "470 mΩ"),
    (1e9, "ohm", "1 GΩ"),
    (0.25, "W", "250 mW"),
    (0.125, "W", "125 mW"),
    (6, "W", "6 W"),
    (1e-6, "F", "1 µF"),
    (4.7e-11, "F", "47 pF"),
    (1, "%", "1 %"),
    (0.5, "%", "0.5 %"),
    (-55, "°C", "-55 °C"),
    (155, "°C", "155 °C"),
    (-55, "degC", "-55 °C"),
    (155, "degC", "155 °C"),
    (250, "V", "250 V"),
    (6.3, "V", "6.3 V"),
])
def test_values_are_compact_and_readable(fmt, magnitude, unit, expected):
    assert fmt.format(magnitude, unit) == expected


def test_floating_point_noise_is_rounded_away(fmt):
    """2.2e-7 F rescales to 219.99999999999997 nF before rounding."""
    assert fmt.format(2.2e-7, "F") == "220 nF"


def test_a_whole_number_keeps_no_trailing_zero(fmt):
    assert fmt.format(100000, "ohm") == "100 kΩ"        # not "100.0 kΩ"


def test_a_value_with_no_unit_is_just_the_number(fmt):
    assert fmt.format(42, "") == "42"


@pytest.mark.parametrize("value", ["Metal Film", "Axial", "Through Hole"])
def test_text_values_pass_straight_through(fmt, value):
    assert fmt.format(value) == value


@pytest.mark.parametrize("value", [None, ""])
def test_an_absent_value_formats_as_empty(fmt, value):
    assert fmt.format(value, "ohm") == ""


# --------------------------------------------------------------------------
# Round-tripping - the correctness guarantee
# --------------------------------------------------------------------------
@pytest.mark.parametrize("magnitude,unit", [
    (100000, "ohm"), (4700, "ohm"), (0.47, "ohm"), (1e9, "ohm"),
    (0.25, "W"), (6, "W"), (1e-6, "F"), (2.2e-7, "F"), (4.7e-11, "F"),
    (1, "%"), (0.5, "%"), (20, "%"), (-55, "°C"), (155, "°C"),
    (0, "°C"), (-55, "degC"), (155, "degC"), (0, "degC"),
    (250, "V"), (6.3, "V"), (50, "ppm_per_delta_degC"),
])
def test_every_formatted_value_reads_back_as_itself(fmt, magnitude, unit):
    """
    The guarantee the whole module exists for: InvenTree derives data_numeric
    by parsing the stored string, so a value that reads back differently is a
    wrong number in the database.
    """
    assert fmt.parses_to(fmt.format(magnitude, unit), magnitude, unit)


def test_an_ambiguous_symbol_falls_back_to_the_unit_name(fmt):
    """
    'ppm/°C' parses as ppm divided by an absolute temperature, turning 50 into
    0.18. The pretty form must be rejected in favour of one that survives.
    """
    text = fmt.format(50, "ppm_per_delta_degC")
    assert text == "50 ppm_per_delta_degC"
    assert fmt.parses_to(text, 50, "ppm_per_delta_degC")


def test_the_pretty_form_really_is_broken_for_that_unit(fmt):
    """Guards the test above: if pint ever fixes this, the fallback can go."""
    assert not fmt.parses_to("50 ppm/°C", 50, "ppm_per_delta_degC")


def test_candidates_are_ordered_prettiest_first(fmt):
    candidates = fmt.candidates(100000, "ohm")
    assert candidates[0] == "100 kΩ"
    assert candidates[-1] == "100000 ohm"


# --------------------------------------------------------------------------
# The registry
# --------------------------------------------------------------------------
def test_the_registry_matches_inventrees_overrides():
    """
    R is roentgen in stock pint; InvenTree redefines it as ohm. Formatting
    against a different registry than the server parses with would be how
    wrong values get in.

    Note "4R7" itself is not pint's to parse - InvenTree rewrites engineering
    notation to "4.7R" first, in from_engineering_notation(). This is only the
    half pint does.
    """
    registry = build_registry({})
    assert registry.Quantity("4.7R").to("ohm").magnitude == pytest.approx(4.7)
    assert registry.Quantity("1R").to("ohm").magnitude == pytest.approx(1)


@pytest.mark.parametrize("definition", BASE_DEFINITIONS)
def test_every_base_definition_is_accepted_by_pint(definition):
    build_registry({})                            # raises if any is malformed
    assert definition


def test_custom_units_from_the_config_are_defined():
    registry = build_registry(TEMPCO)
    assert registry.Quantity("50 ppm_per_delta_degC").magnitude == 50


def test_a_broken_custom_unit_does_not_break_the_registry(caplog):
    """One bad definition must not take every other value down with it."""
    units = {"nonsense": UnitConfig("nonsense", "!!! not a unit !!!")}
    registry = build_registry(units)
    assert registry.Quantity("1 ohm").magnitude == 1


def test_definition_string_matches_inventrees_format():
    """CustomUnit.fmt_string(): 'name = definition = symbol'."""
    assert definition_for(UnitConfig("u", "ppm / delta_degC", "x")) == (
        "u = ppm / delta_degC = x")
    assert definition_for(UnitConfig("u", "ppm / delta_degC")) == (
        "u = ppm / delta_degC")


# --------------------------------------------------------------------------
# clean_number
# --------------------------------------------------------------------------
@pytest.mark.parametrize("value,expected", [
    (100.0, "100"),
    (1.0, "1"),
    (4.7, "4.7"),
    (4.87, "4.87"),
    (0.5, "0.5"),
    (-55.0, "-55"),
    (0, "0"),
    (219.99999999999997, "220"),
    (1e9, "1000000000"),
    # Noise just below a round number must not render in exponent form.
    (999999.9999999999, "1000000"),
    # ...but an exact integer keeps every digit rather than being rounded to
    # six significant figures.
    (1234567.0, "1234567"),
    (0.30000000000000004, "0.3"),
])
def test_clean_number(value, expected):
    assert clean_number(value) == expected


# --------------------------------------------------------------------------
# Reporting an ambiguous symbol
# --------------------------------------------------------------------------
def test_an_ambiguous_symbol_is_reported():
    problems = ambiguous_symbols(TEMPCO)
    assert len(problems) == 1
    assert "ppm/°C" in problems[0]


def test_a_clean_symbol_is_not_reported():
    assert ambiguous_symbols(
        {"kph": UnitConfig("kph", "km / hour", "kph")}) == []


def test_a_unit_without_a_symbol_is_not_reported():
    assert ambiguous_symbols({"u": UnitConfig("u", "km / hour")}) == []


# --------------------------------------------------------------------------
# Which symbols survive a round trip
# --------------------------------------------------------------------------
@pytest.mark.parametrize("symbol,expected", [
    # Operators are fine when the expression means the same thing.
    ("ppm/K", "50 ppm/K"),
    ("ppm/delta_degC", "50 ppm/delta_degC"),
    ("ppm*K^-1", "50 ppm*K^-1"),
    # Unicode notation parses as a single token.
    ("ppm·K⁻¹", "50 ppm·K⁻¹"),
    ("ppmK", "50 ppmK"),
    # degC is an *absolute* temperature: dividing by it is a different
    # quantity, so these fall back to the unit's full name.
    ("ppm/°C", "50 ppm_per_delta_degC"),
    ("ppm/degC", "50 ppm_per_delta_degC"),
    # No symbol at all renders the canonical name.
    ("", "50 ppm_per_delta_degC"),
])
def test_symbol_choice_decides_how_a_value_reads(symbol, expected):
    units = {"ppm_per_delta_degC": UnitConfig("ppm_per_delta_degC",
                                              "ppm / delta_degC", symbol)}
    formatter = Formatter(units)
    text = formatter.format(50, "ppm_per_delta_degC")

    assert text == expected
    # Whatever form it lands on must read back as 50.
    assert formatter.parses_to(text, 50, "ppm_per_delta_degC")


@pytest.mark.parametrize("symbol", ["ppm/K", "ppm*K^-1", "ppm·K⁻¹", "ppmK"])
def test_an_equivalent_symbol_is_not_flagged(symbol):
    """The check is semantic, not a ban on punctuation."""
    assert ambiguous_symbols(
        {"u": UnitConfig("u", "ppm / delta_degC", symbol)}) == []


def test_the_repo_units_config_has_no_ambiguous_symbols():
    """
    Every symbol shipped in config/units.yaml must read back as itself, so
    values render in the pretty form rather than falling back to unit names.
    """
    from invimport.config import load_units_config

    assert ambiguous_symbols(load_units_config()) == []


# --------------------------------------------------------------------------
# Compaction is for built-in units only
# --------------------------------------------------------------------------
CLEAN_TEMPCO = {"ppm_per_delta_degC": UnitConfig("ppm_per_delta_degC",
                                                 "ppm / delta_degC", "ppm/K")}


@pytest.mark.parametrize("magnitude,expected", [
    (0.5, "0.5 ppm/K"),
    (5, "5 ppm/K"),
    (50, "50 ppm/K"),
    (1500, "1500 ppm/K"),
])
def test_a_custom_unit_is_never_si_prefixed(magnitude, expected):
    """
    A custom unit is defined at the scale it is used at, so compaction only
    makes it strange: 0.5 would otherwise render as "500 mppm/K".
    """
    assert Formatter(CLEAN_TEMPCO).format(
        magnitude, "ppm_per_delta_degC") == expected


@pytest.mark.parametrize("magnitude,unit,expected", [
    (0.25, "W", "250 mW"),
    (100000, "ohm", "100 kΩ"),
    (2.2e-7, "F", "220 nF"),
])
def test_built_in_units_are_still_compacted(magnitude, unit, expected):
    assert Formatter(CLEAN_TEMPCO).format(magnitude, unit) == expected


def test_uncompacted_custom_values_still_round_trip():
    formatter = Formatter(CLEAN_TEMPCO)
    for magnitude in (0.5, 50, 1500):
        text = formatter.format(magnitude, "ppm_per_delta_degC")
        assert formatter.parses_to(text, magnitude, "ppm_per_delta_degC")
