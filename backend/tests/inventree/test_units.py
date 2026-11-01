"""Syncing custom units from the YAML config."""

from __future__ import annotations

import pytest

from invimport.config import ConfigError, UnitConfig, load_units_config
from invimport.inventree.api import connect
from invimport.inventree.units import UNRESOLVED_PK, sync_units


def config(name="ppm_per_delta_degC", definition="ppm / delta_degC",
           symbol="ppm/°C") -> dict[str, UnitConfig]:
    return {name: UnitConfig(name, definition, symbol)}


@pytest.fixture
def api(inventree):
    return connect()


# --------------------------------------------------------------------------
# Sync
# --------------------------------------------------------------------------
def test_a_missing_unit_is_created(api, inventree):
    result = sync_units(config(), api, write=True)

    assert result.counts()["created"] == 1
    assert inventree.units[0]["name"] == "ppm_per_delta_degC"
    assert inventree.units[0]["definition"] == "ppm / delta_degC"
    assert inventree.units[0]["symbol"] == "ppm/°C"


def test_a_dry_run_creates_nothing(api, inventree):
    result = sync_units(config(), api, write=False)

    assert result.counts()["created"] == 1        # what *would* happen
    assert inventree.units == []
    assert result.units[0].pk == UNRESOLVED_PK


def test_an_unchanged_unit_is_left_alone(api, inventree):
    sync_units(config(), api, write=True)
    result = sync_units(config(), api, write=True)

    # problems=1 is the ambiguous-symbol note, not a sync failure - the real
    # config's 'ppm/°C' cannot be parsed back. Covered in test_values.py.
    assert result.counts() == {"created": 0, "updated": 0, "unchanged": 1,
                               "unmanaged": 0, "problems": 1}
    assert inventree.saves == []


def test_a_clean_symbol_produces_no_problems(api, inventree):
    result = sync_units({"kph": UnitConfig("kph", "km / hour", "kph")},
                        api, write=True)
    assert result.counts()["problems"] == 0


def test_a_changed_definition_is_detected(api, inventree):
    sync_units(config(), api, write=True)
    result = sync_units(config(definition="ppm / kelvin"), api, write=True)

    assert result.counts()["updated"] == 1
    assert result.units[0].drift["definition"] == ("ppm / delta_degC",
                                                   "ppm / kelvin")
    assert inventree.saves


def test_a_unit_the_config_does_not_mention_is_reported_not_removed(api,
                                                                    inventree):
    """Templates may reference it, so it is surfaced and left alone."""
    inventree.add_unit("legacy_unit", "m / s")
    result = sync_units(config(), api, write=True)

    assert result.unmanaged == ["legacy_unit"]
    assert any(u["name"] == "legacy_unit" for u in inventree.units)


def test_no_custom_units_is_a_valid_configuration(api, inventree):
    result = sync_units({}, api, write=True)

    assert result.counts()["created"] == 0
    assert inventree.units == []


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
def test_units_load_from_the_config(tmp_path):
    (tmp_path / "units.yaml").write_text(
        "ppm_per_delta_degC:\n  definition: ppm / delta_degC\n  symbol: ppm/°C\n")
    units = load_units_config(tmp_path)

    assert units["ppm_per_delta_degC"].definition == "ppm / delta_degC"


def test_a_missing_units_file_is_fine(tmp_path):
    """Custom units are optional; an instance may need none."""
    assert load_units_config(tmp_path) == {}


def test_a_unit_without_a_definition_is_rejected(tmp_path):
    (tmp_path / "units.yaml").write_text("ppm_per_delta_degC:\n  symbol: x\n")
    with pytest.raises(ConfigError, match="no definition"):
        load_units_config(tmp_path)


def test_an_over_long_symbol_is_rejected(tmp_path):
    """The API caps symbol at 10 characters; better to say so than 400."""
    (tmp_path / "units.yaml").write_text(
        "u:\n  definition: m\n  symbol: '12345678901'\n")
    with pytest.raises(ConfigError, match="the API allows 10"):
        load_units_config(tmp_path)


def test_the_repo_units_config_loads():
    """
    Currently empty: everything the parameters need is a pint built-in, and
    ppm/K is a composite of them rather than a unit to define. The file and
    the machinery stay for when a genuinely custom unit is needed.
    """
    units = load_units_config()
    assert isinstance(units, dict)
    for unit in units.values():
        assert unit.definition


def test_the_stub_saw_no_stale_routes(api, inventree):
    sync_units(config(), api, write=True)
    assert inventree.bad_routes == []
