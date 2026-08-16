"""Loading and validating the YAML config."""

from __future__ import annotations

import pytest

from invimport.config import (
    CONFIG_DIR,
    ConfigError,
    add_alias,
    add_category,
    load_categories_config,
    load_config,
    load_manufacturers_config,
    load_parameters_config,
)

PARAMETERS = """
Resistance:
  units: ohm
  description: Nominal resistance value
  aliases: [Resistance, Resistance (Ohms)]
  parse: quantity
Tolerance:
  units: "%"
  parse: percent
Composition:
  choices: [Metal Film, Carbon Film]
Mounting:
  choices: [Through Hole, Surface Mount]
  values:
    Through Hole: [Thru Hole, Axial]
Package: {}
"""

CATEGORIES = """
Resistors:
  identity: spec
  key_parameters: [Resistance, Tolerance]
  name: "Resistor {Resistance} {Tolerance}%"
  parameters: [Resistance, Tolerance, Composition, Package]
  aliases:
    - Resistors / Through Hole Resistors
Integrated Circuits:
  identity: mpn
  parameters: [Package]
  Op-Amps:
    parameters: [Mounting]
    aliases: [ICs / Linear / Amplifiers]
"""


@pytest.fixture
def conf(tmp_path):
    """A config directory, writable per test."""
    def write(parameters=PARAMETERS, categories=CATEGORIES):
        (tmp_path / "parameters.yaml").write_text(parameters)
        (tmp_path / "categories.yaml").write_text(categories)
        return tmp_path
    return write


# --------------------------------------------------------------------------
# Parameters
# --------------------------------------------------------------------------
def test_parameters_load(conf):
    params = load_parameters_config(conf())
    assert set(params) == {"Resistance", "Tolerance", "Composition",
                           "Mounting", "Package"}
    assert params["Resistance"].units == "ohm"
    assert params["Resistance"].parse == "quantity"


def test_an_empty_entry_is_a_bare_parameter(conf):
    """`Package: {}` is a name with no units and no parsing."""
    package = load_parameters_config(conf())["Package"]
    assert package.units == "" and package.parse == "" and not package.choices


def test_choices_join_for_inventree(conf):
    assert load_parameters_config(conf())["Composition"].choices_csv == (
        "Metal Film,Carbon Film")


def test_supplier_names_put_our_own_name_first(conf):
    assert load_parameters_config(conf())["Resistance"].supplier_names() == [
        "Resistance", "Resistance (Ohms)"]


def test_a_bare_string_alias_is_accepted_as_one_item(tmp_path):
    (tmp_path / "parameters.yaml").write_text("Resistance:\n  aliases: Ohms\n")
    assert load_parameters_config(tmp_path)["Resistance"].aliases == ["Ohms"]


def test_value_spellings_map_to_the_canonical_value(conf):
    assert load_parameters_config(conf())["Mounting"].values == {
        "Through Hole": ["Thru Hole", "Axial"]}


# --------------------------------------------------------------------------
# Categories
# --------------------------------------------------------------------------
def test_categories_load_as_paths(conf):
    cats = load_categories_config(conf())
    assert set(cats) == {"Resistors", "Integrated Circuits",
                         "Integrated Circuits/Op-Amps"}


def test_a_subcategory_inherits_identity(conf):
    assert load_categories_config(conf())["Integrated Circuits/Op-Amps"].identity == "mpn"


def test_a_subcategory_extends_its_parents_parameters(conf):
    """Inherited and added, not replaced - otherwise every child restates."""
    op_amps = load_categories_config(conf())["Integrated Circuits/Op-Amps"]
    assert op_amps.parameters == ["Package", "Mounting"]


def test_reserved_keys_are_not_mistaken_for_subcategories(conf):
    """'parameters' and 'aliases' describe the category, not children of it."""
    assert "Resistors/parameters" not in load_categories_config(conf())


def test_a_parent_is_structural_unless_said_otherwise(conf):
    """Children mean the parent holds no parts - matching InvenTree."""
    cats = load_categories_config(conf())
    assert cats["Integrated Circuits"].structural is True
    assert cats["Integrated Circuits/Op-Amps"].structural is False
    assert cats["Resistors"].structural is False


def test_structural_can_be_set_explicitly(tmp_path):
    (tmp_path / "categories.yaml").write_text(
        "Passives:\n  structural: false\n  Films: {}\n"
        "Orphans:\n  structural: true\n")
    cats = load_categories_config(tmp_path)
    assert cats["Passives"].structural is False
    assert cats["Orphans"].structural is True


def test_the_name_template_is_inherited(tmp_path):
    (tmp_path / "categories.yaml").write_text(
        'Passives:\n  identity: mpn\n  name: "P {X}"\n  Films: {}\n')
    assert load_categories_config(tmp_path)["Passives/Films"].name_template == "P {X}"


def test_pathstring_matches_inventrees_form(conf):
    assert load_categories_config(conf())["Integrated Circuits/Op-Amps"].pathstring == (
        "Integrated Circuits/Op-Amps")


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------
def test_a_missing_file_names_itself(tmp_path):
    with pytest.raises(ConfigError, match="does not exist"):
        load_parameters_config(tmp_path)


def test_broken_yaml_names_the_file(tmp_path):
    (tmp_path / "parameters.yaml").write_text("Resistance:\n  units: [oops\n")
    with pytest.raises(ConfigError, match="parameters.yaml is not valid YAML"):
        load_parameters_config(tmp_path)


def test_a_top_level_list_is_rejected(tmp_path):
    (tmp_path / "parameters.yaml").write_text("- Resistance\n- Tolerance\n")
    with pytest.raises(ConfigError, match="must be a mapping"):
        load_parameters_config(tmp_path)


def test_an_empty_file_loads_as_nothing(tmp_path):
    (tmp_path / "parameters.yaml").write_text("")
    assert load_parameters_config(tmp_path) == {}


def test_an_unknown_identity_is_rejected(tmp_path):
    (tmp_path / "categories.yaml").write_text("Resistors:\n  identity: guess\n")
    with pytest.raises(ConfigError, match="expected one of"):
        load_categories_config(tmp_path)


def test_the_same_leaf_under_different_parents_is_fine(tmp_path):
    (tmp_path / "categories.yaml").write_text(
        "Passives:\n  Films: {}\nMore:\n  Films: {}\n")
    assert set(load_categories_config(tmp_path)) == {
        "Passives", "Passives/Films", "More", "More/Films"}


def test_a_slash_in_a_category_name_cannot_shadow_a_nested_pair(tmp_path):
    """
    'Power Converters/Controllers' is a real category name containing a slash,
    so its path is indistinguishable from a nested Power Converters/Controllers.
    Silently keeping one of the two would attach parts to the wrong category.
    """
    (tmp_path / "categories.yaml").write_text(
        'Integrated Circuits:\n'
        '  "Power Converters/Controllers": {}\n'
        '  Power Converters:\n'
        '    Controllers: {}\n')
    with pytest.raises(ConfigError, match="defined twice"):
        load_categories_config(tmp_path)


def test_a_category_referencing_an_undefined_parameter_is_caught(conf):
    directory = conf(categories="Resistors:\n  parameters: [Nonexistent]\n")
    with pytest.raises(ConfigError, match="Nonexistent"):
        load_config(directory)


def test_a_spec_category_without_key_parameters_is_caught(conf):
    directory = conf(categories=(
        "Resistors:\n  identity: spec\n  parameters: [Resistance]\n"))
    with pytest.raises(ConfigError, match="no key_parameters"):
        load_config(directory)


def test_an_unknown_parse_kind_is_rejected(tmp_path):
    (tmp_path / "parameters.yaml").write_text("Resistance:\n  parse: guess\n")
    with pytest.raises(ConfigError, match="not one of"):
        load_parameters_config(tmp_path)


def test_a_key_parameter_outside_the_category_is_caught(conf):
    directory = conf(categories=(
        "Resistors:\n  identity: spec\n  key_parameters: [Tolerance]\n"
        "  parameters: [Resistance]\n"))
    with pytest.raises(ConfigError, match="not among its parameters"):
        load_config(directory)


# --------------------------------------------------------------------------
# Manufacturers and write-back
# --------------------------------------------------------------------------
def test_manufacturers_load(tmp_path):
    (tmp_path / "manufacturers.yaml").write_text(
        "YAGEO:\n  aliases: [Yageo, Yageo Corporation]\n")
    makers = load_manufacturers_config(tmp_path)
    assert makers["YAGEO"].aliases == ["Yageo", "Yageo Corporation"]


def test_a_missing_manufacturers_file_is_empty(tmp_path):
    assert load_manufacturers_config(tmp_path) == {}


def test_add_alias_appends_a_new_manufacturer(tmp_path):
    path = tmp_path / "manufacturers.yaml"
    path.write_text("# learned mappings\n")
    assert add_alias(path, ["YAGEO"], "Yageo") is True
    makers = load_manufacturers_config(tmp_path)
    assert makers["YAGEO"].aliases == ["Yageo"]
    assert path.read_text().startswith("# learned mappings")


def test_add_alias_extends_an_existing_list(tmp_path):
    path = tmp_path / "manufacturers.yaml"
    path.write_text("YAGEO:\n  aliases:\n    - Yageo\n")
    assert add_alias(path, ["YAGEO"], "Yageo Corporation") is True
    assert load_manufacturers_config(tmp_path)["YAGEO"].aliases == [
        "Yageo", "Yageo Corporation"]


def test_add_alias_is_idempotent(tmp_path):
    path = tmp_path / "manufacturers.yaml"
    path.write_text("YAGEO:\n  aliases:\n    - Yageo\n")
    assert add_alias(path, ["YAGEO"], "Yageo") is False
    assert path.read_text() == "YAGEO:\n  aliases:\n    - Yageo\n"


def test_add_alias_under_a_nested_category(tmp_path):
    path = tmp_path / "categories.yaml"
    path.write_text(
        "Capacitors:\n"
        "  Film Capacitors:\n"
        "    aliases:\n"
        "      - Capacitors / Film Capacitors\n")
    assert add_alias(path, ["Capacitors", "Film Capacitors"],
                     "Capacitors / Tantalum Capacitors") is True
    cats = load_categories_config(tmp_path)
    assert "Capacitors / Tantalum Capacitors" in (
        cats["Capacitors/Film Capacitors"].aliases)


def test_add_alias_creates_the_list_when_missing(tmp_path):
    path = tmp_path / "categories.yaml"
    path.write_text("Resistors:\n  identity: spec\n")
    assert add_alias(path, ["Resistors"], "Resistors / Through Hole Resistors")
    assert load_categories_config(tmp_path)["Resistors"].aliases == [
        "Resistors / Through Hole Resistors"]


def test_add_category_creates_a_child_under_an_existing_parent(tmp_path):
    path = tmp_path / "categories.yaml"
    path.write_text("Capacitors:\n  Film Capacitors: {}\n")
    assert add_category(path, ["Capacitors", "Tantalum Capacitors"],
                        alias="Capacitors / Tantalum Capacitors")
    cats = load_categories_config(tmp_path)
    assert "Capacitors/Tantalum Capacitors" in cats
    assert cats["Capacitors/Tantalum Capacitors"].aliases == [
        "Capacitors / Tantalum Capacitors"]
    assert "Film Capacitors" in path.read_text()   # sibling kept


def test_add_category_creates_a_new_top_level(tmp_path):
    path = tmp_path / "categories.yaml"
    path.write_text("Resistors: {}\n")
    assert add_category(path, ["Connectors"], alias="Connectors / Headers")
    cats = load_categories_config(tmp_path)
    assert cats["Connectors"].aliases == ["Connectors / Headers"]


def test_add_category_creates_missing_parents(tmp_path):
    path = tmp_path / "categories.yaml"
    path.write_text("Integrated Circuits: {}\n")
    assert add_category(
        path, ["Integrated Circuits", "Logic", "Latches"],
        alias="Integrated Circuits (ICs) / Logic / Latches")
    cats = load_categories_config(tmp_path)
    assert "Integrated Circuits/Logic" in cats
    assert cats["Integrated Circuits/Logic"].structural is True
    assert cats["Integrated Circuits/Logic/Latches"].aliases == [
        "Integrated Circuits (ICs) / Logic / Latches"]


def test_add_category_on_an_existing_path_just_adds_the_alias(tmp_path):
    path = tmp_path / "categories.yaml"
    path.write_text("Resistors: {}\n")
    assert add_category(path, ["Resistors"], alias="Resistors / Through Hole")
    assert add_category(path, ["Resistors"], alias="Resistors / Through Hole") is False
    assert load_categories_config(tmp_path)["Resistors"].aliases == [
        "Resistors / Through Hole"]


def test_add_alias_cannot_invent_a_nested_category(tmp_path):
    path = tmp_path / "categories.yaml"
    path.write_text("Resistors: {}\n")
    with pytest.raises(ConfigError, match="does not exist"):
        add_alias(path, ["Resistors", "No Such Child"], "x")


# --------------------------------------------------------------------------
# The config shipped in the repo
# --------------------------------------------------------------------------
@pytest.mark.skipif(not CONFIG_DIR.exists(), reason="no config/ in the repo")
def test_the_repo_config_is_valid():
    """The real config must load and be self-consistent."""
    categories, parameters = load_config()
    assert categories and parameters


@pytest.mark.skipif(not CONFIG_DIR.exists(), reason="no config/ in the repo")
def test_no_repo_alias_is_claimed_by_two_categories():
    """
    An alias appearing under two categories would make categorisation depend
    on dict ordering - the exact silent-miscategorisation the design forbids.
    """
    categories, _ = load_config()
    seen: dict[str, str] = {}
    for category in categories.values():
        for alias in category.aliases:
            assert alias not in seen, (
                f"alias {alias!r} is claimed by both {seen.get(alias)!r} and "
                f"{category.pathstring!r}")
            seen[alias] = category.pathstring


@pytest.mark.skipif(not CONFIG_DIR.exists(), reason="no config/ in the repo")
def test_repo_parents_are_structural():
    """Parents hold children, not parts - the server already marks them so."""
    categories, _ = load_config()
    assert categories["Capacitors"].structural is True
    assert categories["Integrated Circuits/Power Management"].structural is True
    assert categories["Resistors"].structural is False
    assert categories["Inductors"].structural is False
    assert categories["Capacitors/Film Capacitors"].structural is False


@pytest.mark.skipif(not CONFIG_DIR.exists(), reason="no config/ in the repo")
def test_repo_spec_categories_can_name_their_parts():
    """A spec category's name template may only use its own parameters."""
    import re

    categories, _ = load_config()
    for category in categories.values():
        if category.identity != "spec" or not category.name_template:
            continue
        for field in re.findall(r"\{([^}]+)\}", category.name_template):
            assert field in category.parameters, (
                f"{category.pathstring}: name template uses {field!r}, which "
                f"is not one of its parameters")
