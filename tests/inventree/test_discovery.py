"""Finding supplier parameters a category does not map, and filing them."""

from __future__ import annotations

import pytest

from invimport.config import (
    ConfigError,
    load_categories_config,
    load_parameters_config,
)
from invimport.inventree.discovery import (
    IGNORE,
    KEY,
    OTHER,
    SKIP,
    discover,
    file_discovery,
    infer,
    parameter_block,
    reload,
    supplier_names,
)

CATEGORIES = """
Resistors:
  identity: spec
  key_parameters: [Resistance]
  parameters: [Resistance]
  aliases:
    - Resistors / Through Hole Resistors
"""

PARAMETERS = "Resistance:\n  units: ohm\n  aliases: [Resistance]\n  parse: quantity\n"


def product(**parameters):
    return {"category_path": ["Resistors", "Through Hole Resistors"],
            "parameters": parameters}


@pytest.fixture
def conf(tmp_path):
    def write(categories=CATEGORIES, parameters=PARAMETERS):
        (tmp_path / "units.yaml").write_text("")
        (tmp_path / "categories.yaml").write_text(categories)
        (tmp_path / "parameters.yaml").write_text(parameters)
        (tmp_path / "manufacturers.yaml").write_text("")
        return tmp_path
    return write


def loaded(directory):
    return load_categories_config(directory), load_parameters_config(directory)


# --------------------------------------------------------------------------
# What gets reported
# --------------------------------------------------------------------------
def test_an_unmapped_parameter_is_found(conf):
    categories, parameters = loaded(conf())
    found = discover([product(Resistance="100 kOhms", Composition="Metal Film")],
                     categories, parameters)

    assert [item.supplier_name for item in found] == ["Composition"]


def test_a_mapped_parameter_is_not_reported(conf):
    """Resistance is already in the category's parameters."""
    categories, parameters = loaded(conf())
    found = discover([product(Resistance="100 kOhms")], categories, parameters)
    assert found == []


def test_an_absent_value_is_not_worth_asking_about(conf):
    categories, parameters = loaded(conf())
    found = discover([product(Features="-")], categories, parameters)
    assert found == []


def test_an_unmapped_category_is_skipped(conf):
    categories, parameters = loaded(conf())
    found = discover([{"category_path": ["Nowhere"], "parameters": {"X": "1"}}],
                     categories, parameters)
    assert found == []


def test_counts_and_samples_accumulate(conf):
    categories, parameters = loaded(conf())
    found = discover([product(Composition="Metal Film"),
                      product(Composition="Carbon Film"),
                      product(Composition="Metal Film")],
                     categories, parameters)

    assert found[0].count == 3
    assert found[0].values == ["Metal Film", "Carbon Film"]


def test_the_commonest_comes_first(conf):
    categories, parameters = loaded(conf())
    found = discover([product(Rare="x"), product(Common="a"),
                      product(Common="b")], categories, parameters)
    assert [item.supplier_name for item in found] == ["Common", "Rare"]


def test_an_ignored_parameter_is_not_offered_again(conf):
    directory = conf(categories=CATEGORIES + "  ignore:\n    - Composition\n")
    categories, parameters = loaded(directory)
    found = discover([product(Composition="Metal Film")], categories, parameters)
    assert found == []


def test_ignore_is_inherited_by_subcategories(conf):
    directory = conf(categories=(
        "Passives:\n  ignore:\n    - Size / Dimension\n"
        "  Resistors:\n    aliases:\n      - Resistors / Through Hole Resistors\n"))
    categories, parameters = loaded(directory)
    found = discover([{"category_path": ["Resistors", "Through Hole Resistors"],
                       "parameters": {"Size / Dimension": "1mm"}}],
                     categories, parameters)
    assert found == []


def test_a_parameter_the_config_knows_is_flagged_as_existing(conf):
    """Defined in parameters.yaml, just not used by this category yet."""
    directory = conf(parameters=PARAMETERS +
                     "Composition:\n  aliases: [Composition]\n")
    categories, parameters = loaded(directory)
    found = discover([product(Composition="Metal Film")], categories, parameters)

    assert found[0].existing_parameter == "Composition"


def test_supplier_names_indexes_every_alias(conf):
    _, parameters = loaded(conf())
    assert supplier_names(parameters)["resistance"] == "Resistance"


# --------------------------------------------------------------------------
# Inference
# --------------------------------------------------------------------------
def test_a_measurement_suggests_its_unit():
    suggestion = infer(["300 V", "250 V", "1 kV"])
    assert suggestion.units == "V" and suggestion.parse == "quantity"


def test_percentages_are_recognised():
    suggestion = infer(["±1%", "5%", "0.5%"])
    assert suggestion.units == "%" and suggestion.parse == "percent"


def test_a_range_is_flagged_as_needing_two_parameters():
    suggestion = infer(["-55°C ~ 155°C", "-40°C ~ 105°C"])
    assert suggestion.ranged is True
    assert suggestion.parse == "range_low"


def test_a_small_vocabulary_becomes_choices():
    suggestion = infer(["Metal Film", "Carbon Film", "Metal Film"])
    assert suggestion.choices == ["Carbon Film", "Metal Film"]


def test_free_text_suggests_nothing():
    suggestion = infer([f"0.0{n}\" Dia x {n}mm" for n in range(20)])
    assert not suggestion.units and not suggestion.choices


def test_absent_values_are_ignored_when_inferring():
    assert infer(["-", "-"]).describe() == "text"


def test_an_unresolvable_unit_is_not_suggested():
    """A unit pint cannot parse would only fail later, at template sync."""
    assert infer(["10 Widgets", "20 Widgets"]).units == ""


# --------------------------------------------------------------------------
# Filing a decision
# --------------------------------------------------------------------------
def test_filing_as_key_adds_to_both_lists(conf):
    directory = conf()
    categories, parameters = loaded(directory)
    item = discover([product(Composition="Metal Film")], categories, parameters)[0]

    file_discovery(item, KEY, "Composition", categories, parameters, directory)

    categories, parameters = reload(directory)
    assert "Composition" in categories["Resistors"].parameters
    assert "Composition" in categories["Resistors"].key_parameters
    assert "Composition" in parameters


def test_filing_as_other_leaves_key_parameters_alone(conf):
    directory = conf()
    categories, parameters = loaded(directory)
    item = discover([product(Composition="Metal Film")], categories, parameters)[0]

    file_discovery(item, OTHER, "Composition", categories, parameters, directory)

    categories, _ = reload(directory)
    assert "Composition" in categories["Resistors"].parameters
    assert "Composition" not in categories["Resistors"].key_parameters


def test_filing_as_ignore_records_the_supplier_name(conf):
    directory = conf()
    categories, parameters = loaded(directory)
    item = discover([product(Composition="Metal Film")], categories, parameters)[0]

    file_discovery(item, IGNORE, "", categories, parameters, directory)

    categories, _ = reload(directory)
    assert categories["Resistors"].ignore == ["Composition"]
    assert "Composition" not in categories["Resistors"].parameters


def test_skip_writes_nothing(conf):
    directory = conf()
    before = (directory / "categories.yaml").read_text()
    categories, parameters = loaded(directory)
    item = discover([product(Composition="Metal Film")], categories, parameters)[0]

    assert file_discovery(item, SKIP, "", categories, parameters, directory) == []
    assert (directory / "categories.yaml").read_text() == before


def test_a_new_parameter_carries_its_inferred_units(conf):
    directory = conf()
    categories, parameters = loaded(directory)
    item = discover([product(**{"Voltage - Rated": "300 V"})],
                    categories, parameters)[0]

    file_discovery(item, OTHER, "Max Working Voltage", categories, parameters,
                   directory)

    _, parameters = reload(directory)
    assert parameters["Max Working Voltage"].units == "V"
    assert parameters["Max Working Voltage"].parse == "quantity"
    # The supplier spelling becomes an alias, which is how it is recognised.
    assert "Voltage - Rated" in parameters["Max Working Voltage"].aliases


def test_an_existing_parameter_gains_the_supplier_alias(conf):
    """A supplier spelling that differs from our name has to be recorded."""
    directory = conf(parameters=PARAMETERS +
                     "Composition:\n  choices: [Metal Film]\n")
    categories, parameters = loaded(directory)
    item = discover([product(Material="Metal Film")], categories, parameters)[0]

    file_discovery(item, OTHER, "Composition", categories, parameters, directory)

    _, parameters = reload(directory)
    assert "Material" in parameters["Composition"].aliases


def test_a_supplier_spelling_that_is_already_our_name_needs_no_alias(conf):
    """supplier_names() includes the parameter's own name, so it matches."""
    directory = conf(parameters=PARAMETERS +
                     "Composition:\n  choices: [Metal Film]\n")
    categories, parameters = loaded(directory)
    item = discover([product(Composition="Metal Film")], categories, parameters)[0]

    file_discovery(item, OTHER, "Composition", categories, parameters, directory)

    _, parameters = reload(directory)
    assert parameters["Composition"].aliases == []


def test_filing_twice_is_a_no_op(conf):
    directory = conf()
    categories, parameters = loaded(directory)
    item = discover([product(Composition="Metal Film")], categories, parameters)[0]

    file_discovery(item, KEY, "Composition", categories, parameters, directory)
    categories, parameters = reload(directory)
    file_discovery(item, KEY, "Composition", categories, parameters, directory)

    categories, _ = reload(directory)
    assert categories["Resistors"].parameters.count("Composition") == 1
    assert categories["Resistors"].key_parameters.count("Composition") == 1


def test_the_config_stays_loadable_after_filing(conf):
    """A written list must not break the consistency check."""
    from invimport.config import load_config

    directory = conf()
    categories, parameters = loaded(directory)
    item = discover([product(Composition="Metal Film")], categories, parameters)[0]
    file_discovery(item, KEY, "Composition", categories, parameters, directory)

    load_config(directory)                        # raises if inconsistent


def test_comments_and_ordering_survive_a_write(conf):
    directory = conf(categories=(
        "# top comment\nResistors:\n  identity: spec\n"
        "  key_parameters: [Resistance]\n  parameters: [Resistance]\n"
        "  aliases:\n    - Resistors / Through Hole Resistors\n"))
    categories, parameters = loaded(directory)
    item = discover([product(Composition="Metal Film")], categories, parameters)[0]
    file_discovery(item, OTHER, "Composition", categories, parameters, directory)

    text = (directory / "categories.yaml").read_text()
    assert text.startswith("# top comment")


def test_filing_under_an_unknown_category_is_an_error(conf):
    directory = conf()
    categories, parameters = loaded(directory)
    item = discover([product(Composition="Metal Film")], categories, parameters)[0]
    item.category = "Nowhere"

    with pytest.raises(KeyError):
        file_discovery(item, OTHER, "Composition", categories, parameters,
                       directory)


# --------------------------------------------------------------------------
# The generated YAML
# --------------------------------------------------------------------------
@pytest.mark.parametrize("name", [
    "Package / Case",                             # a slash is fine unquoted
    "Voltage: Rated",                             # a colon is not
    "No",                                         # YAML would read this as False
    "Ratings, Approvals",
])
def test_a_generated_block_parses_back_to_the_name_it_names(name):
    """Whatever quoting is needed, the block has to read back correctly."""
    import yaml

    from invimport.inventree.discovery import Suggestion

    parsed = yaml.safe_load(parameter_block(name, name, Suggestion()))
    assert list(parsed) == [name]
    assert parsed[name]["aliases"] == [name]


def test_parameter_block_includes_choices():
    import yaml

    from invimport.inventree.discovery import Suggestion

    parsed = yaml.safe_load(parameter_block(
        "Composition", "Composition",
        Suggestion(choices=["Metal Film", "Carbon Film"])))
    assert parsed["Composition"]["choices"] == ["Metal Film", "Carbon Film"]
