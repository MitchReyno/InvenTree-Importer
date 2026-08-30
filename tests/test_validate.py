"""Checking a stock file against the config, without touching InvenTree."""

from __future__ import annotations

import pytest

from invimport.config import load_categories_config, load_parameters_config
from invimport.stockfile import parse_document
from invimport.validate import category_candidates, resolve_category, validate

CATEGORIES = """
Resistors:
  ipn_prefix: RES
  identity: spec
  key_parameters: [Resistance, Tolerance]
  parameters: [Resistance, Tolerance, Composition]
  Through Hole Resistors:
    aliases:
      - Resistors / Through Hole Resistors
  Surface Mount Resistors: {}
Integrated Circuits:
  ipn_prefix: IC
  identity: mpn
  parameters: [Package]
  Op-Amps: {}
# Present so the suggestion ranking has a decoy: 'Transistors' is textually
# very close to 'Resistors', and whole-path scoring picks its children over
# the sibling that is actually meant.
Transistors:
  ipn_prefix: SEM
  identity: mpn
  parameters: [Package]
  BJTs: {}
  MOSFETs: {}
"""

PARAMETERS = """
Resistance:
  units: ohm
  parse: quantity
  aliases: [Resistance]
Tolerance:
  units: '%'
  parse: percent
Composition:
  choices: [Metal Film, Carbon Film]
Package:
  aliases: [Package / Case]
"""


@pytest.fixture
def config(tmp_path):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "categories.yaml").write_text(CATEGORIES)
    (tmp_path / "parameters.yaml").write_text(PARAMETERS)
    (tmp_path / "manufacturers.yaml").write_text("")
    return (load_categories_config(tmp_path), load_parameters_config(tmp_path))


def check(config, *lines):
    categories, parameters = config
    for index, line in enumerate(lines):
        line.setdefault("id", str(index + 1))
        line.setdefault("quantity", 1)
    return validate(parse_document({"lines": list(lines)}),
                    categories, parameters)


# --------------------------------------------------------------------------
# Categories
# --------------------------------------------------------------------------
def test_a_good_line_passes(config):
    report = check(config, {"category": "Resistors/Through Hole Resistors",
                            "parameters": {"Resistance": "1 kohm",
                                           "Tolerance": "1%"}})
    assert report.ok, report.text()


def test_a_category_is_matched_case_insensitively(config):
    categories, _ = config
    from invimport.stockfile import StockLine
    line = StockLine(category="resistors/through hole resistors")
    assert resolve_category(line, categories) is not None


def test_a_digikey_alias_still_resolves(config):
    """A row copied out of a payload should land somewhere sensible."""
    categories, _ = config
    from invimport.stockfile import StockLine
    line = StockLine(category="Resistors / Through Hole Resistors")
    resolved = resolve_category(line, categories)
    assert resolved.pathstring == "Resistors/Through Hole Resistors"


def test_an_unknown_category_is_an_error_with_suggestions(config):
    report = check(config, {"category": "Resistors/SMD"})
    assert not report.ok
    problem = report.problems[0]
    assert "unknown category" in problem.problem
    assert "Resistors/Surface Mount Resistors" in problem.did_you_mean


def test_a_structural_category_is_refused_and_points_at_its_children(config):
    report = check(config, {"category": "Resistors"})
    assert not report.ok
    problem = report.problems[0]
    assert "structural" in problem.problem
    assert "Resistors/Through Hole Resistors" in problem.did_you_mean


def test_an_unknown_category_with_a_suggestion_is_only_a_warning(config):
    """suggest_category means the author knows; the import will offer it."""
    report = check(config, {"category": "Resistors/Wirewound",
                            "suggest_category": {"identity": "spec"},
                            "parameters": {"Resistance": "1 ohm",
                                           "Tolerance": "1%"}})
    assert report.ok
    assert "offer to create it" in report.warnings[0].problem


# --------------------------------------------------------------------------
# The suggestion ranking - the reason this is worth having
# --------------------------------------------------------------------------
def test_a_sibling_beats_a_closer_looking_parent(config):
    """
    'Resistors/SMD' is textually closest to 'Resistors', which is useless.

    Whole-path similarity ranks the parent first because it shares a prefix,
    and once structural categories are excluded it reaches for 'Transistors/*'
    instead - textually close, entirely wrong. The answer is a sibling, so an
    existing parent's children are offered: the plausible set by construction.
    """
    categories, _ = config
    assert category_candidates("Resistors/SMD", categories) == [
        "Resistors/Surface Mount Resistors", "Resistors/Through Hole Resistors"]


def test_suggestions_never_include_a_structural_category(config):
    """Offering a category that cannot hold parts is not a suggestion."""
    categories, _ = config
    for wanted in ("Resistors/SMD", "Integrated Circuits/Amplifiers", "Nonsense"):
        assert "Resistors" not in category_candidates(wanted, categories)


# --------------------------------------------------------------------------
# Parameters
# --------------------------------------------------------------------------
def test_an_unknown_parameter_is_an_error_with_suggestions(config):
    report = check(config, {"category": "Resistors/Through Hole Resistors",
                            "parameters": {"Resistence": "1 kohm"}})
    problem = next(p for p in report.problems if "Resistence" in p.field)
    assert problem.problem == "no such parameter"
    assert "Resistance" in problem.did_you_mean


def test_the_value_suggests_the_parameter_when_the_name_cannot(config):
    """
    'Wattage' and 'Power Rating' share almost no letters.

    Fuzzy matching on the name alone returns nothing useful here, which is a
    dead end for an agent. The value is better evidence: 0.25 W is watts, and
    exactly one of this category's parameters is measured in watts.
    """
    categories, parameters = config
    categories["Resistors"].parameters.append("Power Rating")
    categories["Resistors/Through Hole Resistors"].parameters.append("Power Rating")
    parameters["Power Rating"] = type(parameters["Resistance"])(
        "Power Rating", units="W", parse="quantity")

    report = validate(
        parse_document({"lines": [{"id": "1", "quantity": 1,
                                   "category": "Resistors/Through Hole Resistors",
                                   "parameters": {"Wattage": "0.25 W"}}]}),
        categories, parameters)

    problem = next(p for p in report.problems if "Wattage" in p.field)
    assert problem.did_you_mean[0] == "Power Rating"


def test_a_bare_number_suggests_nothing_by_unit(config):
    """Every numeric parameter would 'match', which is not a suggestion."""
    categories, parameters = config
    report = validate(
        parse_document({"lines": [{"id": "1", "quantity": 1,
                                   "category": "Resistors/Through Hole Resistors",
                                   "parameters": {"Thingy": "42"}}]}),
        categories, parameters)
    problem = next(p for p in report.problems if "Thingy" in p.field)
    assert problem.did_you_mean == []


def test_a_supplier_spelling_is_accepted(config):
    """A line may use DigiKey's name for a parameter as well as ours."""
    report = check(config, {"category": "Integrated Circuits/Op-Amps",
                            "mpn": "NE5532",
                            "parameters": {"Package / Case": "8-DIP"}})
    assert report.ok, report.text()
    assert report.resolved["1"] == {"Package": "8-DIP"}


def test_an_unreadable_value_is_an_error(config):
    report = check(config, {"category": "Resistors/Through Hole Resistors",
                            "parameters": {"Resistance": "banana"}})
    assert any("cannot be read as ohm" in p.problem for p in report.problems)


def test_a_value_outside_the_choices_lists_them(config):
    report = check(config, {"category": "Resistors/Through Hole Resistors",
                            "parameters": {"Composition": "Cheese"}})
    problem = next(p for p in report.problems if "Composition" in p.field)
    assert "Metal Film" in problem.problem


def test_a_parameter_the_category_does_not_carry_is_a_warning(config):
    """Not fatal, but it silently would not be stored, which is worth saying."""
    report = check(config, {"category": "Integrated Circuits/Op-Amps",
                            "mpn": "NE5532",
                            "parameters": {"Resistance": "1 kohm"}})
    assert report.ok
    assert "not one of" in report.warnings[0].problem


def test_resolved_values_are_reported_for_preview(config):
    report = check(config, {"category": "Resistors/Through Hole Resistors",
                            "parameters": {"Resistance": "1 kohm",
                                           "Tolerance": "1%"}})
    assert report.resolved["1"] == {"Resistance": "1 k", "Tolerance": "1"}


# --------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------
def test_a_partial_spec_warns_that_the_import_will_ask(config):
    """The Case B hazard: a subset can neither match nor be created safely."""
    report = check(config, {"category": "Resistors/Through Hole Resistors",
                            "parameters": {"Resistance": "1 kohm"}})
    assert report.ok
    assert "will ask rather than guess" in report.warnings[0].problem


def test_a_complete_spec_does_not_warn(config):
    report = check(config, {"category": "Resistors/Through Hole Resistors",
                            "parameters": {"Resistance": "1 kohm",
                                           "Tolerance": "1%"}})
    assert report.warnings == []


def test_a_spec_part_needs_no_mpn(config):
    """Half of real stock has none; the parameters are the identity."""
    report = check(config, {"category": "Resistors/Through Hole Resistors",
                            "parameters": {"Resistance": "1 kohm",
                                           "Tolerance": "1%"}})
    assert report.ok, report.text()


def test_an_mpn_category_with_nothing_identifying_is_an_error(config):
    report = check(config, {"category": "Integrated Circuits/Op-Amps"})
    assert not report.ok
    assert "nothing identifies this part" in report.problems[0].problem


def test_an_mpn_category_with_only_a_description_warns(config):
    """Old stock is often exactly this, and refusing it would lose the stock."""
    report = check(config, {"category": "Integrated Circuits/Op-Amps",
                            "description": "4151-103 E/P KYR 1928"})
    assert report.ok
    assert "created from its description alone" in report.warnings[0].problem


@pytest.mark.parametrize("field", ["mpn", "type", "sku", "ipn"])
def test_any_identifier_is_enough(config, field):
    report = check(config, {"category": "Integrated Circuits/Op-Amps",
                            field: "XR-2206"})
    assert report.ok, report.text()


# --------------------------------------------------------------------------
# The machine-readable form
# --------------------------------------------------------------------------
def test_the_report_serialises_for_an_agent(config):
    report = check(config, {"category": "Resistors/SMD"})
    payload = report.as_dict()
    assert payload["ok"] is False
    assert payload["problems"] == 1
    entry = payload["by_line"][0]
    assert entry["line"] == "1"
    assert entry["errors"][0]["field"] == "category"
    assert entry["errors"][0]["did_you_mean"]


def test_a_clean_file_serialises_as_ok(config):
    report = check(config, {"category": "Resistors/Through Hole Resistors",
                            "parameters": {"Resistance": "1 kohm",
                                           "Tolerance": "1%"}})
    assert report.as_dict() == {"ok": True, "lines": 1, "problems": 0,
                                "warnings": 0, "by_line": []}
