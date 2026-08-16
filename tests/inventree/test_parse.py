"""Parsing DigiKey value strings into typed parameter values."""

from __future__ import annotations

import pytest

from invimport.config import ParameterConfig, load_parameters_config
from invimport.inventree.values import (
    Formatter,
    from_supplier,
    parse,
    parse_percent,
    parse_quantity,
    parse_quantity_first,
    parse_range_high,
    parse_range_low,
    read_value,
)


# --------------------------------------------------------------------------
# The proposal's value table
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text,kind,unit,expected", [
    ("100 kOhms", "quantity", "ohm", 100000),
    ("±1%", "percent", "%", 1),
    ("0.25W, 1/4W", "quantity_first", "W", 0.25),
    ("±50ppm/°C", "quantity", "ppm/K", 50),
    ("-55°C ~ 155°C", "range_low", "°C", -55),
    ("-55°C ~ 155°C", "range_high", "°C", 155),
    ("-", "quantity", "ohm", None),
])
def test_the_proposal_table(text, kind, unit, expected):
    assert parse(text, kind, unit) == expected


# --------------------------------------------------------------------------
# quantity - real DigiKey spellings
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text,unit,expected", [
    ("1 Ohms", "ohm", 1),
    ("1 kOhms", "ohm", 1000),
    ("100 kOhms", "ohm", 100000),
    ("1 MOhms", "ohm", 1e6),
    ("2.2 MOhms", "ohm", 2.2e6),
    ("100 mOhms", "ohm", 0.1),
    ("100k", "ohm", 100000),
    ("0.25W", "W", 0.25),
    ("2W", "W", 2),
    ("500 mW", "W", 0.5),
    ("1 W", "W", 1),
    ("1/4W", "W", 0.25),
    ("0.02 µF", "F", 2e-8),
    ("4.7 µF", "F", 4.7e-6),
    ("1000 µF", "F", 0.001),
    ("10 V", "V", 10),
    ("6.3 V", "V", 6.3),
    ("250V", "V", 250),
    ("250VAC", "V", 250),
    ("±50ppm/°C", "ppm/K", 50),
    ("±100ppm/°C", "ppm/K", 100),
    ("100ppm/°C", "ppm/K", 100),
    ("1.055Ohm @ 120Hz", "ohm", 1.055),
    ("520mOhm @ 100kHz", "ohm", 0.52),
    ("40 Ohms", "ohm", 40),
    ("8Ohm", "ohm", 8),
    ("-", "ohm", None),
    ("", "ohm", None),
])
def test_quantity_reads_digikey_spellings(text, unit, expected):
    got = parse_quantity(text, unit)
    if expected is None:
        assert got is None
    else:
        assert got == pytest.approx(expected)


def test_ppm_per_celsius_is_not_converted_through_absolute_temperature():
    """
    The bug this exists to prevent: pint reads ppm/°C as ppm divided by an
    absolute temperature and 50 becomes 0.18. A temperature coefficient of
    50 ppm/°C is 50 ppm/K; the number is what we want.
    """
    assert parse_quantity("±50ppm/°C", "ppm/K") == 50
    assert parse_quantity("50ppm/°C", "ppm/K") != pytest.approx(0.18, abs=0.1)


def test_a_bare_k_is_a_prefix_not_boltzmanns_constant():
    """pint reads '100k' as 100 × k_B. We want 100000."""
    assert parse_quantity("100k", "ohm") == 100000


# --------------------------------------------------------------------------
# percent, quantity_first, ranges
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text,expected", [
    ("±1%", 1),
    ("±0.1%", 0.1),
    ("±0.5%", 0.5),
    ("±5%", 5),
    ("±10%", 10),
    ("±20%", 20),
    ("1%", 1),
    ("-", None),
])
def test_percent_strips_the_sign_and_the_symbol(text, expected):
    got = parse_percent(text)
    if expected is None:
        assert got is None
    else:
        assert got == pytest.approx(expected)


@pytest.mark.parametrize("text,expected", [
    ("0.25W, 1/4W", 0.25),
    ("0.2W, 1/5W", 0.2),
    ("0.5W, 1/2W", 0.5),
    ("2W", 2),
    ("5W", 5),
    ("250VAC, 350VDC", 250),
    ("-", None),
])
def test_quantity_first_takes_the_decimal_form(text, expected):
    unit = "V" if "VAC" in text else "W"
    got = parse_quantity_first(text, unit)
    if expected is None:
        assert got is None
    else:
        assert got == pytest.approx(expected)


@pytest.mark.parametrize("text,low,high", [
    ("-55°C ~ 155°C", -55, 155),
    ("0°C ~ 70°C", 0, 70),
    ("-40°C ~ 85°C", -40, 85),
    ("-40°C ~ 125°C (TJ)", -40, 125),
    ("-55°C ~ 125°C (TA)", -55, 125),
    ("-10°C ~ 105°C", -10, 105),
    ("-", None, None),
])
def test_a_temperature_range_splits_into_two_magnitudes(text, low, high):
    assert parse_range_low(text, "°C") == (None if low is None else pytest.approx(low))
    assert parse_range_high(text, "°C") == (None if high is None else pytest.approx(high))


# --------------------------------------------------------------------------
# read_value - parse then format
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def fmt() -> Formatter:
    return Formatter({})


def P(name, **kw) -> ParameterConfig:
    return ParameterConfig(name=name, **kw)


@pytest.mark.parametrize("text,parameter,expected", [
    ("100 kOhms", P("Resistance", units="ohm", parse="quantity"), "100 kΩ"),
    ("±1%", P("Tolerance", units="%", parse="percent"), "1 %"),
    ("0.25W, 1/4W", P("Power Rating", units="W", parse="quantity_first"), "250 mW"),
    ("±50ppm/°C", P("Tempco", units="ppm/K", parse="quantity"), "50 ppm/K"),
    ("-55°C ~ 155°C", P("Tmin", units="°C", parse="range_low"), "-55 °C"),
    ("-55°C ~ 155°C", P("Tmax", units="°C", parse="range_high"), "155 °C"),
    ("0.02 µF", P("Capacitance", units="F", parse="quantity"), "20 nF"),
    ("-", P("Resistance", units="ohm", parse="quantity"), None),
    ("Metal Film", P("Composition", choices=["Metal Film", "Carbon Film"]),
     "Metal Film"),
    ("Wirewound", P("Composition", choices=["Wire Wound"],
                    values={"Wire Wound": ["Wirewound"]}), "Wire Wound"),
    ("Axial", P("Mounting", choices=["Through Hole", "Surface Mount"],
                values={"Through Hole": ["Axial", "Radial"]}), "Through Hole"),
    ("Metal Foil", P("Composition", choices=["Metal Film", "Wire Wound"]), None),
    ("Axial", P("Package"), "Axial"),
    ("8-DIP", P("Package"), "8-DIP"),
    ("-", P("Package"), None),
    ("Bi-Polar", P("Polarity", choices=["Bipolar", "Polar"],
                   values={"Bipolar": ["Bi-Polar"]}), "Bipolar"),
])
def test_read_value_formats_or_maps(fmt, text, parameter, expected):
    assert read_value(text, parameter, fmt) == expected


# --------------------------------------------------------------------------
# from_supplier - aliases, two parsers on one field, omissions
# --------------------------------------------------------------------------
RESISTOR = {
    "Resistance": "100 kOhms",
    "Tolerance": "±1%",
    "Power (Watts)": "0.25W, 1/4W",
    "Temperature Coefficient": "±50ppm/°C",
    "Operating Temperature": "-55°C ~ 155°C",
    "Composition": "Metal Film",
    "Mounting Type": "Through Hole",
    "Package / Case": "Axial",
    "Features": "-",
}

PARAMS = {
    "Resistance": P("Resistance", units="ohm", parse="quantity",
                    aliases=["Resistance (Ohms)"]),
    "Tolerance": P("Tolerance", units="%", parse="percent"),
    "Power Rating": P("Power Rating", units="W", parse="quantity_first",
                      aliases=["Power (Watts)"]),
    "Temperature Coefficient": P("Temperature Coefficient", units="ppm/K",
                                 parse="quantity"),
    "Operating Temp Min": P("Operating Temp Min", units="°C", parse="range_low",
                            aliases=["Operating Temperature"]),
    "Operating Temp Max": P("Operating Temp Max", units="°C", parse="range_high",
                            aliases=["Operating Temperature"]),
    "Composition": P("Composition", choices=["Metal Film", "Wire Wound"]),
    "Mounting": P("Mounting", choices=["Through Hole", "Surface Mount"],
                  aliases=["Mounting Type"],
                  values={"Through Hole": ["Axial", "Thru Hole"]}),
    "Package": P("Package", aliases=["Package / Case"]),
    "Features": P("Features"),
}


def test_from_supplier_reads_a_resistor(fmt):
    got = from_supplier(RESISTOR, PARAMS, formatter=fmt)
    assert got == {
        "Resistance": "100 kΩ",
        "Tolerance": "1 %",
        "Power Rating": "250 mW",
        "Temperature Coefficient": "50 ppm/K",
        "Operating Temp Min": "-55 °C",
        "Operating Temp Max": "155 °C",
        "Composition": "Metal Film",
        "Mounting": "Through Hole",
        "Package": "Axial",
    }
    assert "Features" not in got                  # '-' is absent


def test_from_supplier_restricts_to_the_names_asked_for(fmt):
    got = from_supplier(RESISTOR, PARAMS, names=["Resistance", "Tolerance"],
                        formatter=fmt)
    assert set(got) == {"Resistance", "Tolerance"}


def test_from_supplier_omits_a_parameter_the_payload_does_not_have(fmt):
    got = from_supplier({"Resistance": "10 Ohms"}, PARAMS, formatter=fmt)
    assert got == {"Resistance": "10 Ω"}


def test_the_repo_config_reads_the_proposal_resistor():
    """The real parameters.yaml must produce the values the design promised."""
    parameters = load_parameters_config()
    got = from_supplier(RESISTOR, parameters)
    assert got["Resistance"] == "100 kΩ"
    assert got["Tolerance"] == "1 %"
    assert got["Power Rating"] == "250 mW"
    assert got["Temperature Coefficient"] == "50 ppm/K"
    assert got["Operating Temp Min"] == "-55 °C"
    assert got["Operating Temp Max"] == "155 °C"
    assert got["Composition"] == "Metal Film"
    assert got["Package"] == "Axial"
