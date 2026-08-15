"""
Parameter loading against a stub InvenTree that serves only routes present in
docs/InvenTree API.yaml. A call to a route the server does not have 404s, which
is what catches the pre-530 /api/part/parameter/ paths the client library still
ships.
"""

from __future__ import annotations

import pandas as pd
import pytest

from invimport.inventree.api import Parameter, ParameterTemplate
from invimport.inventree.parameters import load_parameters

TEMPLATES = pd.DataFrame([{"name": "Resistance", "units": "ohm",
                           "description": "Nominal resistance",
                           "choices": "", "checkbox": "false"}])
VALUES = pd.DataFrame([{"part_ipn": "R-0402-10K", "template": "Resistance",
                        "data": "10000", "source": "datasheet"}])


# --------------------------------------------------------------------------
# API 530 routes and payloads
# --------------------------------------------------------------------------
def test_client_models_point_at_the_530_routes():
    assert Parameter.URL == "parameter"
    assert ParameterTemplate.URL == "parameter/template"


def test_no_off_spec_route_is_touched(inventree):
    load_parameters(TEMPLATES, VALUES, write=True)
    assert inventree.bad_routes == []


def test_template_is_created_with_a_model_type(inventree):
    load_parameters(TEMPLATES, VALUES, write=True)
    assert len(inventree.templates) == 1
    assert inventree.templates[0]["name"] == "Resistance"
    assert inventree.templates[0]["model_type"] == "part.part"


def test_parameter_uses_the_generic_model_reference(inventree):
    """530 dropped the 'part' field for model_type + model_id."""
    load_parameters(TEMPLATES, VALUES, write=True)
    created = inventree.parameters[0]
    assert created["model_type"] == "part.part"
    assert created["model_id"] == 7
    assert created["data"] == "10000"
    assert "part" not in created


def test_existing_parameters_are_filtered_server_side(inventree):
    load_parameters(TEMPLATES, VALUES, write=True)
    query = inventree.parameter_queries[0]
    assert query["model_type"] == ["part.part"]
    assert query["model_id"] == ["7"]
    assert query["template"], "template filter should narrow the lookup"


# --------------------------------------------------------------------------
# Dry run
# --------------------------------------------------------------------------
def test_dry_run_writes_nothing(inventree):
    result = load_parameters(TEMPLATES, VALUES, write=False)
    assert inventree.templates == []
    assert inventree.parameters == []
    assert result.templates[0].action == "created"


def test_dry_run_stops_before_values_when_templates_are_missing(inventree):
    """Template pks are unknown until they exist, so stage 2 cannot run."""
    result = load_parameters(TEMPLATES, VALUES, write=False)
    assert result.templates_pending is True
    assert result.values == []


# --------------------------------------------------------------------------
# Idempotence
# --------------------------------------------------------------------------
def test_unchanged_template_is_left_alone(inventree):
    load_parameters(TEMPLATES, VALUES, write=True)
    inventree.saves.clear()
    result = load_parameters(TEMPLATES, VALUES, write=True)
    assert result.templates[0].action == "unchanged"
    assert inventree.saves == []


def test_matching_value_counts_as_unchanged(inventree):
    inventree.existing_parameters = [{"pk": 5, "template": 101, "data": "10000"}]
    load_parameters(TEMPLATES, VALUES, write=True)
    result = load_parameters(TEMPLATES, VALUES, write=True)
    assert result.counts()["unchanged"] == 1
    assert result.counts()["created"] == 0


def test_differing_value_is_updated(inventree):
    inventree.existing_parameters = [{"pk": 5, "template": 101, "data": "9999"}]
    load_parameters(TEMPLATES, VALUES, write=True)
    result = load_parameters(TEMPLATES, VALUES, write=True)
    action = result.values[0]
    assert action.action == "updated"
    assert action.old == "9999"
    assert action.new == "10000"


# --------------------------------------------------------------------------
# Problem reporting
# --------------------------------------------------------------------------
def test_unknown_ipn_is_reported_not_raised(inventree):
    values = pd.DataFrame([{"part_ipn": "NOPE", "template": "Resistance",
                            "data": "1", "source": ""}])
    result = load_parameters(TEMPLATES, values, write=True)
    assert result.problems == ["no part with IPN 'NOPE'"]
    assert inventree.parameters == []


def test_ambiguous_ipn_refuses_to_guess(inventree):
    inventree.parts["DUPE"] = [1, 2]
    values = pd.DataFrame([{"part_ipn": "DUPE", "template": "Resistance",
                            "data": "1", "source": ""}])
    result = load_parameters(TEMPLATES, values, write=True)
    assert "not unique" in result.problems[0]
    assert inventree.parameters == []


def test_template_not_in_the_csv_is_reported(inventree):
    values = pd.DataFrame([{"part_ipn": "R-0402-10K", "template": "Capacitance",
                            "data": "1", "source": ""}])
    result = load_parameters(TEMPLATES, values, write=True)
    assert "not defined in templates CSV" in result.problems[0]


@pytest.mark.parametrize("row", [
    {"part_ipn": "", "template": "Resistance", "data": "1", "source": ""},
    {"part_ipn": "R-0402-10K", "template": "", "data": "1", "source": ""},
    {"part_ipn": "R-0402-10K", "template": "Resistance", "data": "", "source": ""},
])
def test_incomplete_rows_are_reported(inventree, row):
    result = load_parameters(TEMPLATES, pd.DataFrame([row]), write=True)
    assert "incomplete row" in result.problems[0]


# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------
def test_csv_paths_are_accepted_as_well_as_dataframes(inventree, tmp_path):
    templates_csv = tmp_path / "t.csv"
    values_csv = tmp_path / "v.csv"
    TEMPLATES.to_csv(templates_csv, index=False)
    VALUES.to_csv(values_csv, index=False)

    result = load_parameters(templates_csv, values_csv, write=True)
    assert result.counts()["created"] == 1
