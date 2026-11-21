"""Menu rows for unmapped parameters and unknown choice spellings."""

from __future__ import annotations

from invimport.commands.learn import choice_actions, parameter_actions
from invimport.config import ParameterConfig
from invimport.inventree.discovery import Discovery, UnknownChoice


def test_similar_parameters_are_offered_before_create_and_ignore():
    item = Discovery("Resistors", "Mounting Type", count=3,
                     values=["Through Hole"])
    parameters = {
        "Mounting": ParameterConfig("Mounting"),
        "Package": ParameterConfig("Package"),
    }
    labels = [label for _, _, label in parameter_actions(item, parameters)]
    assert labels[0].startswith("map to Mounting")
    assert "similar" in labels[0]
    assert "create a new parameter" in labels
    assert "ignore for this category" in labels
    # Unrelated names stay off the suggestion list.
    assert not any("Package" in label and "map to Package" in label
                   for label in labels[:2])


def test_an_already_defined_parameter_is_the_first_option():
    item = Discovery("Resistors", "Mounting Type", count=1,
                     values=["Through Hole"], existing_parameter="Mounting")
    parameters = {"Mounting": ParameterConfig("Mounting")}
    action, name, label = parameter_actions(item, parameters)[0]
    assert action == "map"
    assert name == "Mounting"
    assert "already defined" in label


def test_similar_choices_are_offered_before_create():
    item = UnknownChoice(
        parameter="Mounting", supplier_name="Mounting Type",
        value="Through Hole", choices=["Through-hole", "Surface Mount"])
    labels = [label for _, _, label in choice_actions(item)]
    assert labels[0].startswith("map to Through-hole")
    assert "create a new choice" in labels
