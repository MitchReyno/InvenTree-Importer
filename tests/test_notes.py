"""Notes as sections, rendered to the Markdown InvenTree shows."""

from __future__ import annotations

from invimport.notes import (
    MANUFACTURER_PART_SECTIONS,
    PART_SECTIONS,
    STOCK_SECTIONS,
    parse,
    render,
    stock_notes,
)


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------
def test_text_is_taken_as_it_stands():
    assert parse("  bought at a hamfest \n", STOCK_SECTIONS) == (
        "bought at a hamfest", [])


def test_nothing_is_no_notes():
    assert parse(None, PART_SECTIONS) == ("", [])
    assert parse("", PART_SECTIONS) == ("", [])


def test_sections_drop_blank_entries():
    notes, problems = parse({"summary": ["Op amp", "  ", ""],
                             "cautions": "", "references": []},
                            PART_SECTIONS)
    assert notes == {"summary": ["Op amp"]}
    assert problems == []


def test_a_section_from_another_record_is_refused():
    """Markings are about one lot; a part has no such section."""
    _, problems = parse({"markings": "A 7/81"}, PART_SECTIONS)
    assert problems == ["'markings' is not a section here - use summary, "
                        "specifications, cross_references, cautions, "
                        "references"]


def test_a_section_must_be_text_or_a_list_of_text():
    _, problems = parse({"summary": {"a": 1}}, MANUFACTURER_PART_SECTIONS)
    assert problems == ["section 'summary' must be text or a list of text"]


def test_notes_that_are_neither_text_nor_sections_are_refused():
    _, problems = parse(["a"], STOCK_SECTIONS)
    assert problems and "mapping of sections" in problems[0]


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------
def test_sections_render_in_a_fixed_order_under_level_3_headings():
    text = render({"cautions": ["Not the LM118"],
                   "summary": ["Op amp module", "Discrete, potted"]},
                  PART_SECTIONS)
    assert text == ("### Summary\n\n- Op amp module\n- Discrete, potted\n\n"
                    "### Cautions\n\n- Not the LM118")


def test_a_text_section_is_written_as_markdown():
    table = "| CAGE | Company |\n|---|---|\n| 24355 | Analog Devices |"
    assert render({"cross_references": table}, PART_SECTIONS) == (
        f"### Cross-references\n\n{table}")


def test_a_multi_line_bullet_stays_inside_its_bullet():
    assert render({"summary": ["first\nsecond"]}, PART_SECTIONS) == (
        "### Summary\n\n- first\n  second")


def test_markings_are_copied_verbatim_into_a_code_block():
    """A label is evidence: no reflowing, no `*` read as emphasis."""
    text = render({"markings": ["NSN 5962-00-482-5624", "*A 7/81*"]},
                  STOCK_SECTIONS)
    assert text == ("### Markings\n\n```\nNSN 5962-00-482-5624\n*A 7/81*\n"
                    "```")


def test_backticks_in_a_marking_cannot_close_its_block():
    text = render({"markings": "a ``` b"}, STOCK_SECTIONS)
    assert text.startswith("### Markings\n\n````\n")
    assert text.endswith("\n````")


def test_plain_text_notes_render_unchanged():
    assert render("line one\nline two", PART_SECTIONS) == (
        "line one\nline two")


# --------------------------------------------------------------------------
# A stock item's notes
# --------------------------------------------------------------------------
def test_the_source_is_a_section_of_its_own_and_comes_last():
    text = stock_notes({"stock": ["Two bags, sealed"]}, seller="salash",
                       source_file="lot.json")
    assert text == ("### This stock\n\n- Two bags, sealed\n\n"
                    "### Source\n\n- Sold by salash\n"
                    "- Imported from `lot.json`")


def test_an_approximate_quantity_leads_the_stock_section():
    text = stock_notes({"stock": ["Counted by weight"]}, approximate=True)
    assert text == ("### This stock\n\n- Quantity is approximate\n"
                    "- Counted by weight")


def test_an_approximate_quantity_needs_no_stock_section_of_its_own():
    text = stock_notes({"markings": "A 4/86"}, approximate=True)
    assert text.startswith("### This stock\n\n- Quantity is approximate\n\n"
                           "### Markings")


def test_plain_text_stock_notes_still_get_a_source():
    text = stock_notes("from the bench drawer", approximate=True,
                       source_file="bench.json")
    assert text == ("Quantity is approximate.\n\nfrom the bench drawer\n\n"
                    "### Source\n\n- Imported from `bench.json`")


def test_no_notes_and_no_source_is_nothing():
    assert stock_notes("") == ""
