"""Syncing part categories from the YAML config."""

from __future__ import annotations

import pytest

from invimport.config import CategoryConfig, load_categories_config
from invimport.inventree.api import connect
from invimport.inventree.categories import (
    UNRESOLVED_PK,
    NewCategory,
    cached_category_paths,
    children_of,
    describe_category,
    learn_aliases,
    parent_of,
    sync_categories,
    sync_tree,
)
from invimport.inventree.matching import match_path


@pytest.fixture
def api(inventree):
    return connect()


def cats(*paths: str) -> dict[str, CategoryConfig]:
    """A flat config of pathstrings, parents implied by the path."""
    out: dict[str, CategoryConfig] = {}
    for pathstring in paths:
        parts = pathstring.split("/")
        out[pathstring] = CategoryConfig(name=parts[-1], path=parts)
    return out


# --------------------------------------------------------------------------
# Creating and updating
# --------------------------------------------------------------------------
def test_a_missing_category_is_created(api, inventree):
    result = sync_categories(cats("Resistors"), api, write=True)

    assert result.counts()["created"] == 1
    assert inventree.categories[0]["name"] == "Resistors"
    assert inventree.categories[0]["pathstring"] == "Resistors"


def test_a_dry_run_creates_nothing(api, inventree):
    result = sync_categories(cats("Resistors"), api, write=False)

    assert result.counts()["created"] == 1
    assert inventree.categories == []
    assert result.categories[0].pk == UNRESOLVED_PK


def test_a_child_is_created_under_its_parent(api, inventree):
    result = sync_categories(cats("Capacitors", "Capacitors/Film Capacitors"),
                             api, write=True)

    assert result.counts()["created"] == 2
    child = next(c for c in inventree.categories
                 if c["name"] == "Film Capacitors")
    parent = next(c for c in inventree.categories if c["name"] == "Capacitors")
    assert child["parent"] == parent["pk"]
    assert child["pathstring"] == "Capacitors/Film Capacitors"


def test_an_unchanged_category_is_left_alone(api, inventree):
    sync_categories(cats("Resistors"), api, write=True)
    result = sync_categories(cats("Resistors"), api, write=True)

    assert result.counts() == {"created": 0, "updated": 0, "unchanged": 1,
                               "unmanaged": 0, "problems": 0}
    assert inventree.saves == []


def test_drift_is_detected_and_reported(api, inventree):
    sync_categories(cats("Resistors"), api, write=True)
    wanted = cats("Resistors")
    wanted["Resistors"].description = "Through-hole and SMD"
    result = sync_categories(wanted, api, write=True)

    assert result.counts()["updated"] == 1
    assert result.categories[0].drift["description"] == (
        "", "Through-hole and SMD")
    assert inventree.saves


def test_a_dry_run_reports_drift_without_saving(api, inventree):
    sync_categories(cats("Resistors"), api, write=True)
    inventree.saves.clear()
    wanted = cats("Resistors")
    wanted["Resistors"].structural = True
    result = sync_categories(wanted, api, write=False)

    assert result.counts()["updated"] == 1
    assert inventree.saves == []


def test_an_unmanaged_category_is_reported_not_deleted(api, inventree):
    inventree.add_category("Orphans", pk=9)
    result = sync_categories(cats("Resistors"), api, write=True)

    assert result.unmanaged == ["Orphans"]
    assert any(c["name"] == "Orphans" for c in inventree.categories)


def test_templates_are_created_before_categories(api, inventree, tmp_path):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text("Resistance:\n  units: ohm\n")
    (tmp_path / "categories.yaml").write_text(
        "Resistors:\n  parameters: [Resistance]\n")

    sync_tree(tmp_path, api, write=True)

    posts = [path for path, _ in inventree.posts]
    assert "/api/parameter/template/" in posts
    assert "/api/part/category/" in posts
    assert posts.index("/api/parameter/template/") < posts.index(
        "/api/part/category/")


def test_the_repo_config_syncs_against_the_stub(api, inventree):
    units, templates, categories = sync_tree(None, api, write=True)

    assert templates.counts()["problems"] == 0
    assert categories.counts()["problems"] == 0
    assert {c["pathstring"] for c in inventree.categories} >= {
        "Resistors", "Capacitors", "Capacitors/Film Capacitors"}


# --------------------------------------------------------------------------
# Tree walk
# --------------------------------------------------------------------------
def test_children_of_returns_roots_and_direct_children():
    tree = cats("Capacitors", "Capacitors/Film Capacitors",
                "Capacitors/Ceramic Capacitors", "Resistors")
    assert [c.pathstring for c in children_of(None, tree)] == [
        "Capacitors", "Resistors"]
    assert [c.pathstring for c in children_of(tree["Capacitors"], tree)] == [
        "Capacitors/Ceramic Capacitors", "Capacitors/Film Capacitors"]
    assert children_of(tree["Resistors"], tree) == []


def test_parent_of_walks_one_level_up():
    tree = cats("Capacitors", "Capacitors/Film Capacitors")
    assert parent_of(tree["Capacitors/Film Capacitors"], tree) is tree["Capacitors"]
    assert parent_of(tree["Capacitors"], tree) is None


def test_describe_category_marks_structural_and_counts_children():
    tree = cats("Capacitors", "Capacitors/Film Capacitors",
                "Capacitors/Ceramic Capacitors", "Resistors")
    tree["Capacitors"].structural = True
    assert describe_category(tree["Capacitors"], tree) == (
        "Capacitors  (structural, 2 subcategories)")
    assert describe_category(tree["Resistors"], tree) == "Resistors"


# --------------------------------------------------------------------------
# Learning aliases
# --------------------------------------------------------------------------
def test_learn_aliases_writes_the_chosen_mapping(tmp_path):
    (tmp_path / "categories.yaml").write_text(
        "Resistors:\n"
        "  aliases:\n"
        "    - Resistors / Through Hole Resistors\n")
    categories = load_categories_config(tmp_path)

    def choose(options, path):
        return next(c for c in options if c.pathstring == "Resistors")

    learned = learn_aliases(
        ["Resistors / Through Hole Resistors",
         "Resistors / Chip Resistor - Surface Mount"],
        categories, tmp_path, choose=choose)

    assert learned == [("Resistors / Chip Resistor - Surface Mount",
                        "Resistors")]
    assert "Resistors / Chip Resistor - Surface Mount" in (
        load_categories_config(tmp_path)["Resistors"].aliases)


def test_learn_aliases_can_create_a_new_category(tmp_path):
    (tmp_path / "categories.yaml").write_text("Capacitors: {}\n")
    categories = load_categories_config(tmp_path)

    def choose(options, path):
        return NewCategory(["Capacitors", "Tantalum Capacitors"])

    learned = learn_aliases(["Capacitors / Tantalum Capacitors"],
                            categories, tmp_path, choose=choose)

    assert learned == [("Capacitors / Tantalum Capacitors",
                        "Capacitors/Tantalum Capacitors")]
    loaded = load_categories_config(tmp_path)
    assert "Capacitors/Tantalum Capacitors" in loaded
    assert loaded["Capacitors/Tantalum Capacitors"].aliases == [
        "Capacitors / Tantalum Capacitors"]
    # In-memory config is reloaded so the next path can map here.
    assert "Capacitors/Tantalum Capacitors" in categories


def test_learn_aliases_without_a_chooser_writes_nothing(tmp_path):
    (tmp_path / "categories.yaml").write_text("Resistors: {}\n")
    categories = load_categories_config(tmp_path)
    assert learn_aliases(["Resistors / Foo"], categories, tmp_path) == []
    assert load_categories_config(tmp_path)["Resistors"].aliases == []


def test_cached_category_paths_reads_productdetails(tmp_path):
    folder = tmp_path / "products"
    folder.mkdir()
    (folder / "a.json").write_text(
        '{"Product": {"Category": {"Name": "Resistors", '
        '"ChildCategories": [{"Name": "Through Hole Resistors"}]}}}')
    (folder / "b.json").write_text(
        '{"Product": {"Category": {"Name": "Resistors", '
        '"ChildCategories": [{"Name": "Through Hole Resistors"}]}}}')
    assert cached_category_paths(folder) == [
        "Resistors / Through Hole Resistors"]


def test_match_path_uses_the_repo_aliases():
    categories = load_categories_config()
    assert match_path(["Resistors", "Through Hole Resistors"],
                      categories).pathstring == "Resistors"
    assert match_path(["Capacitors", "Tantalum Capacitors"],
                      categories) is None
