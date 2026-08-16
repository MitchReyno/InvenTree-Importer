"""Syncing parameter templates from the YAML config."""

from __future__ import annotations

import pytest

from invimport.config import ParameterConfig
from invimport.inventree.api import connect
from invimport.inventree.parameters import (
    UNRESOLVED_PK,
    matches,
    payload_for,
    sync_config,
    sync_templates,
)


def config(**overrides) -> dict[str, ParameterConfig]:
    """One-parameter config, tweakable per test."""
    base = {"name": "Resistance", "units": "ohm",
            "description": "Nominal resistance value"}
    base.update(overrides)
    return {base["name"]: ParameterConfig(**base)}


@pytest.fixture
def api(inventree):
    return connect()


# --------------------------------------------------------------------------
# Creating and updating
# --------------------------------------------------------------------------
def test_a_missing_template_is_created(api, inventree):
    result = sync_templates(config(), api, write=True)

    assert result.counts()["created"] == 1
    assert inventree.templates[0]["name"] == "Resistance"
    assert inventree.templates[0]["units"] == "ohm"


def test_a_dry_run_creates_nothing(api, inventree):
    result = sync_templates(config(), api, write=False)

    assert result.counts()["created"] == 1        # what *would* happen
    assert inventree.templates == []
    assert result.templates[0].pk == UNRESOLVED_PK


def test_an_unchanged_template_is_left_alone(api, inventree):
    sync_templates(config(), api, write=True)
    result = sync_templates(config(), api, write=True)

    assert result.counts() == {"created": 0, "updated": 0, "unchanged": 1,
                               "unmanaged": 0, "problems": 0}
    assert inventree.saves == []


def test_drift_is_detected_and_reported(api, inventree):
    sync_templates(config(), api, write=True)
    result = sync_templates(config(units="kohm"), api, write=True)

    assert result.counts()["updated"] == 1
    assert result.templates[0].drift["units"] == ("ohm", "kohm")
    assert inventree.saves


def test_a_dry_run_reports_drift_without_saving(api, inventree):
    sync_templates(config(), api, write=True)
    inventree.saves.clear()
    result = sync_templates(config(units="kohm"), api, write=False)

    assert result.counts()["updated"] == 1
    assert inventree.saves == []


def test_choices_are_sent_as_one_comma_separated_string(api, inventree):
    sync_templates(config(name="Mounting", units="",
                          choices=["Through Hole", "Surface Mount"]),
                   api, write=True)
    assert inventree.templates[0]["choices"] == "Through Hole,Surface Mount"


def test_templates_are_scoped_to_part_parameters(api, inventree):
    """530 templates declare the model they attach to."""
    sync_templates(config(), api, write=True)
    assert inventree.templates[0]["model_type"] == "part.part"


# --------------------------------------------------------------------------
# Nothing is ever deleted
# --------------------------------------------------------------------------
def test_a_template_the_config_does_not_mention_is_reported_not_removed(
        api, inventree):
    """Parts may be using it, so it is surfaced and left alone."""
    inventree.templates.append({"pk": 99, "name": "Blah", "units": "",
                                "description": "", "choices": "",
                                "checkbox": False, "model_type": "part.part"})
    result = sync_templates(config(), api, write=True)

    assert result.unmanaged == ["Blah"]
    assert result.counts()["unmanaged"] == 1
    assert any(t["name"] == "Blah" for t in inventree.templates)


# --------------------------------------------------------------------------
# The checkbox comparison
# --------------------------------------------------------------------------
@pytest.mark.parametrize("current,wanted,expected", [
    (False, False, True),
    (None, False, True),                          # absent reads as False
    ("", False, True),
    (True, True, True),
    (False, True, False),
    ("ohm", "ohm", True),
    (None, "", True),
    ("ohm", "kohm", False),
    (10, "10", True),
])
def test_matches(current, wanted, expected):
    assert matches(current, wanted) is expected


def test_a_false_checkbox_does_not_look_like_drift(api, inventree):
    """
    Stringifying booleans makes a False on both sides read as '' vs 'False',
    so every run would re-save a template it need not touch.
    """
    sync_templates(config(), api, write=True)
    inventree.saves.clear()
    result = sync_templates(config(), api, write=True)

    assert result.counts()["unchanged"] == 1
    assert inventree.saves == []


# --------------------------------------------------------------------------
# Config plumbing
# --------------------------------------------------------------------------
def test_payload_carries_every_managed_field():
    payload = payload_for(ParameterConfig(name="Tolerance", units="%",
                                          description="d", choices=["a", "b"],
                                          checkbox=True))
    assert payload == {"name": "Tolerance", "units": "%", "description": "d",
                       "choices": "a,b", "checkbox": True,
                       "model_type": "part.part"}


def test_the_repo_config_syncs_against_the_stub(api, inventree):
    """The real config must be loadable and appliable, units included."""
    units, result = sync_config(None, api, write=True)

    assert result.counts()["problems"] == 0
    assert {t["name"] for t in inventree.templates} >= {
        "Resistance", "Tolerance", "Power Rating", "Composition"}
    # Every declared unit must be resolvable by the server.
    assert [t.name for t in result.templates if t.action == "created"]


def test_an_unresolvable_unit_is_reported_before_anything_is_sent(api, inventree):
    """
    InvenTree rejects a template whose unit it cannot resolve. Saying which
    parameter and which unit beats a bare HTTP 400.
    """
    result = sync_templates(config(name="Tempco", units="not_a_real_unit"),
                            api, write=True)

    assert result.counts()["problems"] == 1
    assert "cannot resolve" in result.problems[0]


def test_a_composite_unit_expression_is_accepted(api, inventree):
    """
    'ppm/K' is no single entry in any list of unit names, but it is a perfectly
    valid unit - which is why the check asks pint rather than the server's
    index. Getting this wrong flagged a working config as broken.
    """
    result = sync_templates(config(name="Tempco", units="ppm/K"), api,
                            write=True)

    assert result.counts()["problems"] == 0
    assert result.counts()["created"] == 1


def test_the_degree_celsius_symbol_is_accepted(api, inventree):
    """°C and degC are the same pint unit; the config uses the symbol."""
    result = sync_templates(config(name="Operating Temp Min", units="°C"),
                            api, write=True)

    assert result.counts()["problems"] == 0
    assert result.counts()["created"] == 1


def test_units_are_created_before_templates(api, inventree, tmp_path):
    """
    The ordering is the whole point: a template naming a custom unit cannot be
    created until that unit exists. Driven from a config that actually needs
    one, since the repo config now gets by on pint built-ins.
    """
    (tmp_path / "units.yaml").write_text(
        "dog_year:\n  definition: 52 * day\n  symbol: dy\n")
    (tmp_path / "parameters.yaml").write_text(
        "Service Life:\n  units: dog_year\n")

    sync_config(tmp_path, api, write=True)

    posts = [path for path, _ in inventree.posts]
    assert "/api/units/" in posts
    assert posts.index("/api/units/") < posts.index("/api/parameter/template/")


def test_the_stub_saw_no_stale_routes(api, inventree):
    sync_templates(config(), api, write=True)
    assert inventree.bad_routes == []
