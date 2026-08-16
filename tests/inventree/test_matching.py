"""Normalise, learned aliases, fuzzy candidates, category path matching."""

from __future__ import annotations

from invimport.config import CategoryConfig
from invimport.inventree.matching import (
    candidates,
    match_name,
    match_path,
    normalise,
    path_text,
    unmapped_paths,
)


def test_normalise_drops_case_punctuation_and_corporate_suffixes():
    assert normalise("YAGEO") == "yageo"
    assert normalise("Yageo Corporation") == "yageo"
    assert normalise("Yageo Corp.") == "yageo"
    assert normalise("Texas Instruments Inc.") == "texas instruments"
    assert normalise("TI") == "ti"


def test_an_exact_normalised_name_matches():
    assert match_name("Yageo Corporation", ["YAGEO", "Vishay"]) == "YAGEO"


def test_a_learned_alias_matches():
    aliases = {"Texas Instruments": ["TI", "Texas Instruments Inc."]}
    assert match_name("TI", ["Texas Instruments"], aliases) == "Texas Instruments"


def test_an_unknown_name_does_not_match():
    assert match_name("Vishay Dale", ["YAGEO"]) is None


def test_fuzzy_candidates_are_offered_not_applied():
    """The threshold decides the menu, not the answer."""
    found = candidates("Vishay Dale", ["Vishay", "Vishay Sfernice", "YAGEO"])
    names = [name for name, _ in found]
    assert "Vishay" in names
    assert "YAGEO" not in names
    assert match_name("Vishay Dale", ["Vishay", "YAGEO"]) is None


def test_candidates_are_best_first():
    found = candidates("Vishay Dale", ["Vishay Sfernice", "Vishay"])
    assert found[0][0] == "Vishay"
    assert found[0][1] > found[1][1]


def test_match_path_is_exact_and_longest_first():
    categories = {
        "Resistors": CategoryConfig("Resistors", ["Resistors"],
                                    aliases=["Resistors / Through Hole Resistors",
                                             "Resistors / Chip Resistor - Surface Mount"]),
        "Capacitors/Film Capacitors": CategoryConfig(
            "Film Capacitors", ["Capacitors", "Film Capacitors"],
            aliases=["Capacitors / Film Capacitors"]),
    }
    assert match_path(["Resistors", "Through Hole Resistors"],
                      categories).pathstring == "Resistors"
    assert match_path("Capacitors / Film Capacitors",
                      categories).pathstring == "Capacitors/Film Capacitors"
    assert match_path(["Resistors", "Something New"], categories) is None


def test_an_unmapped_path_is_reported():
    categories = {
        "Resistors": CategoryConfig("Resistors", ["Resistors"],
                                    aliases=["Resistors / Through Hole Resistors"]),
    }
    assert unmapped_paths(
        [["Resistors", "Through Hole Resistors"],
         ["Capacitors", "Tantalum Capacitors"]],
        categories) == ["Capacitors / Tantalum Capacitors"]


def test_path_text_joins_with_spaces_around_the_slash():
    assert path_text(["Resistors", "Through Hole Resistors"]) == (
        "Resistors / Through Hole Resistors")
