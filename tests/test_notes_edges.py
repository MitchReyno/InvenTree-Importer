"""Notes boundaries that protect label evidence and caller-owned data."""

from __future__ import annotations

from copy import deepcopy

import pytest

from invimport.notes import (
    MANUFACTURER_PART_SECTIONS,
    PART_SECTIONS,
    STOCK_SECTIONS,
    parse,
    render,
    stock_notes,
)


@pytest.mark.parametrize("value", [False, True, 0, 1, [], ["note"], ()])
def test_non_text_notes_report_the_allowed_sections(value):
    parsed, problems = parse(value, STOCK_SECTIONS)
    assert parsed == ""
    assert problems == [
        "must be text, or a mapping of sections (stock, markings, other)",
    ]


@pytest.mark.parametrize("value", [False, 0, 3, {}, ["valid", 7], [None]])
def test_invalid_section_bodies_do_not_erase_valid_sibling_sections(value):
    parsed, problems = parse({"summary": "Op amp", "cautions": value},
                             PART_SECTIONS)
    assert parsed == {"summary": "Op amp"}
    assert problems == ["section 'cautions' must be text or a list of text"]


def test_multiple_section_errors_are_returned_in_input_order():
    parsed, problems = parse({
        "markings": "LOT 123", "summary": 7, "references": ["datasheet"],
    }, PART_SECTIONS)
    assert parsed == {"references": ["datasheet"]}
    assert problems == [
        "'markings' is not a section here - use summary, specifications, "
        "cross_references, cautions, references",
        "section 'summary' must be text or a list of text",
    ]


def test_section_names_are_case_sensitive():
    parsed, problems = parse({"Summary": "Op amp"}, PART_SECTIONS)
    assert parsed == {}
    assert problems == [
        "'Summary' is not a section here - use summary, specifications, "
        "cross_references, cautions, references",
    ]


def test_manufacturer_sections_do_not_accept_stock_or_part_only_facts():
    parsed, problems = parse({
        "identification": "Logo matches", "stock": "Two bags",
        "specifications": "5 V",
    }, MANUFACTURER_PART_SECTIONS)
    assert parsed == {"identification": "Logo matches"}
    assert problems == [
        "'stock' is not a section here - use summary, identification, references",
        "'specifications' is not a section here - use summary, identification, "
        "references",
    ]


def test_parsing_does_not_mutate_the_input_mapping_or_lists():
    supplied = {"summary": ["  Op amp  ", ""], "references": None}
    before = deepcopy(supplied)
    parsed, problems = parse(supplied, PART_SECTIONS)
    assert supplied == before
    assert parsed == {"summary": ["Op amp"]}
    assert problems == []
    parsed["summary"].append("New note")
    assert supplied == before


def test_parsing_preserves_indentation_inside_text_sections():
    supplied = {"references": "\n    indented evidence\n\n"}
    parsed, problems = parse(supplied, PART_SECTIONS)
    assert parsed == {"references": "    indented evidence"}
    assert problems == []


@pytest.mark.parametrize("value", [None, "", "  \n ", [], ["", "  "]])
def test_empty_sections_are_removed_without_errors(value):
    assert parse({"summary": value}, PART_SECTIONS) == ({}, [])


def test_list_items_are_trimmed_without_reflowing_internal_newlines():
    parsed, problems = parse({"stock": ["  first\nsecond  ", "  last  "]},
                             STOCK_SECTIONS)
    assert parsed == {"stock": ["first\nsecond", "last"]}
    assert problems == []


@pytest.mark.parametrize("sections", [
    PART_SECTIONS, MANUFACTURER_PART_SECTIONS, STOCK_SECTIONS,
])
def test_empty_mapping_renders_no_headings(sections):
    assert render({}, sections) == ""


def test_all_part_sections_render_in_schema_order():
    supplied = {key: heading for key, heading in reversed(PART_SECTIONS)}
    text = render(supplied, PART_SECTIONS)
    assert text == (
        "### Summary\n\nSummary\n\n"
        "### Specifications\n\nSpecifications\n\n"
        "### Cross-references\n\nCross-references\n\n"
        "### Cautions\n\nCautions\n\n"
        "### References\n\nReferences"
    )


def test_manufacturer_identification_renders_between_summary_and_references():
    text = render({
        "references": ["Catalogue"], "identification": "CAGE 12345",
        "summary": "House number",
    }, MANUFACTURER_PART_SECTIONS)
    assert text == (
        "### Summary\n\nHouse number\n\n"
        "### Identification\n\nCAGE 12345\n\n"
        "### References\n\n- Catalogue"
    )


def test_empty_extra_sections_do_not_add_blank_headings():
    text = render("Evidence", PART_SECTIONS,
                  extra=[("Empty", []), ("Blank", ["", "  "])])
    assert text == "Evidence"


def test_extra_sections_follow_notes_and_preserve_their_order():
    text = render({"summary": "Op amp"}, PART_SECTIONS,
                  extra=[("Source", ["Drawer"]), ("Audit", ["Counted"])])
    assert text == (
        "### Summary\n\nOp amp\n\n### Source\n\n- Drawer\n\n"
        "### Audit\n\n- Counted"
    )


def test_multiple_multiline_bullets_keep_their_own_continuations():
    text = render({"references": ["first\ncontinued", "second\ncontinued"]},
                  PART_SECTIONS)
    assert text == (
        "### References\n\n- first\n  continued\n- second\n  continued"
    )


@pytest.mark.parametrize("marking,fence", [
    ("plain label", "```"),
    ("one ` tick", "```"),
    ("two `` ticks", "```"),
    ("three ``` ticks", "````"),
    ("four ```` ticks", "`````"),
    ("`` and ````` and ```", "``````"),
])
def test_label_fence_exceeds_every_embedded_backtick_run(marking, fence):
    text = render({"markings": marking}, STOCK_SECTIONS)
    assert text == f"### Markings\n\n{fence}\n{marking}\n{fence}"


def test_markings_preserve_spaces_and_blank_lines_inside_the_label():
    marking = "  TOP  \n\n    BOTTOM"
    assert render({"markings": marking}, STOCK_SECTIONS) == (
        f"### Markings\n\n```\n{marking}\n```"
    )


def test_marking_lists_are_lines_in_a_code_block_and_never_bullets():
    text = render({"markings": ["# TITLE", "- literal dash", "*stars*"]},
                  STOCK_SECTIONS)
    assert text == (
        "### Markings\n\n```\n# TITLE\n- literal dash\n*stars*\n```"
    )


def test_approximate_stock_notes_do_not_mutate_caller_owned_lists():
    supplied = {"stock": ["Counted by weight"], "markings": ["LOT A"]}
    before = deepcopy(supplied)
    first = stock_notes(supplied, approximate=True)
    second = stock_notes(supplied, approximate=True)
    assert supplied == before
    assert first == second
    assert first.count("Quantity is approximate") == 1


def test_approximate_text_section_precedes_the_authored_explanation():
    text = stock_notes({"stock": "Counted by weight"}, approximate=True)
    assert text == (
        "### This stock\n\nQuantity is approximate.\n\nCounted by weight"
    )


def test_empty_approximate_text_gets_only_the_quantity_statement():
    assert stock_notes("  \n", approximate=True) == "Quantity is approximate."


def test_seller_only_source_has_no_empty_import_file_bullet():
    assert stock_notes("", seller="Bench shop") == (
        "### Source\n\n- Sold by Bench shop"
    )


def test_file_only_source_has_no_empty_seller_bullet():
    assert stock_notes({}, source_file="bench-lot.yaml") == (
        "### Source\n\n- Imported from `bench-lot.yaml`"
    )


def test_source_follows_other_stock_notes_as_well_as_markings():
    text = stock_notes({
        "other": "Retest before use", "markings": "LOT A", "stock": ["Two bags"],
    }, seller="Shop", source_file="lot.json")
    assert text == (
        "### This stock\n\n- Two bags\n\n"
        "### Markings\n\n```\nLOT A\n```\n\n"
        "### Other\n\nRetest before use\n\n"
        "### Source\n\n- Sold by Shop\n- Imported from `lot.json`"
    )


def test_rendering_does_not_change_mapping_list_or_extra_inputs():
    supplied = {"summary": ["One", "Two\ncontinued"]}
    extra = [("Source", ["File", " "])]
    before = deepcopy((supplied, extra))
    render(supplied, PART_SECTIONS, extra=extra)
    assert (supplied, extra) == before
