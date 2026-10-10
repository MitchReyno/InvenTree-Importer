"""Reading a stock import file into lines."""

from __future__ import annotations

import json

import pytest

from invimport.stockfile import (
    StockFileError,
    parse_document,
    parse_text,
    read_file,
)


def doc(**overrides):
    """A minimal valid file, with the given keys replaced."""
    data = {
        "version": 1,
        "lines": [{"id": "a", "quantity": 10,
                   "category": "Resistors/Through Hole Resistors"}],
    }
    data.update(overrides)
    return data


def write(tmp_path, data, name="stock.json"):
    path = tmp_path / name
    path.write_text(json.dumps(data) if isinstance(data, (dict, list)) else data)
    return path


# --------------------------------------------------------------------------
# The shape
# --------------------------------------------------------------------------
def test_a_minimal_file_reads():
    document = parse_document(doc())
    assert len(document.lines) == 1
    assert document.lines[0].quantity == 10
    assert document.lines[0].category == "Resistors/Through Hole Resistors"


def test_a_bare_list_of_lines_is_accepted():
    """The 'lines' wrapper is not worth insisting on for a hand-written file."""
    document = parse_document([{"id": "a", "quantity": 1, "category": "X"}])
    assert len(document.lines) == 1


def test_defaults_fill_what_a_line_leaves_out():
    document = parse_document(doc(
        defaults={"supplier": "Rockby Electronics", "currency": "AUD"}))
    assert document.lines[0].supplier == "Rockby Electronics"
    assert document.lines[0].currency == "AUD"


def test_a_line_beats_a_default():
    document = parse_document(doc(
        defaults={"supplier": "Rockby Electronics"},
        lines=[{"id": "a", "quantity": 1, "category": "X",
                "supplier": "Tayda Electronics"}]))
    assert document.lines[0].supplier == "Tayda Electronics"


def test_order_merges_rather_than_replaces():
    """A file-wide date with a per-line reference is reasonable to write."""
    document = parse_document(doc(
        defaults={"order": {"date": "2026-08-14"}},
        lines=[{"id": "a", "quantity": 1, "category": "X",
                "order": {"reference": "R-99213"}}]))
    assert document.lines[0].order == {"date": "2026-08-14",
                                       "reference": "R-99213"}


def test_a_default_that_identifies_a_part_is_refused():
    """A file-wide MPN would be nonsense, and silently wrong on every line."""
    with pytest.raises(StockFileError, match="cannot be defaulted"):
        parse_document(doc(defaults={"mpn": "NE555P"}))


# --------------------------------------------------------------------------
# Line ids - what makes a re-import a no-op
# --------------------------------------------------------------------------
def test_a_line_without_an_id_is_refused():
    with pytest.raises(StockFileError, match="needs a stable, unique id"):
        parse_document(doc(lines=[{"quantity": 1, "category": "X"}]))


def test_duplicate_ids_are_refused():
    """One would mask the other's import key and silently not be created."""
    with pytest.raises(StockFileError, match="unique"):
        parse_document(doc(lines=[
            {"id": "a", "quantity": 1, "category": "X"},
            {"id": "a", "quantity": 2, "category": "Y"},
        ]))


def test_the_import_key_is_stable_for_a_named_file():
    """source.reference names the file, so regenerating it still matches."""
    document = parse_document(doc(source={"reference": "invoice-8821.jpg"}))
    assert document.key_for(document.lines[0]) == "invimport:invoice-8821.jpg:a"


def test_an_unnamed_file_is_keyed_by_its_contents():
    first = parse_document(doc())
    same = parse_document(doc())
    different = parse_document(doc(lines=[{"id": "a", "quantity": 11,
                                           "category": "X"}]))
    assert first.file_id == same.file_id
    assert first.file_id != different.file_id


# --------------------------------------------------------------------------
# Rejecting what cannot be acted on
# --------------------------------------------------------------------------
@pytest.mark.parametrize("line,expected", [
    ({"id": "a", "category": "X"}, "quantity"),
    ({"id": "a", "quantity": 0, "category": "X"}, "greater than zero"),
    ({"id": "a", "quantity": -3, "category": "X"}, "greater than zero"),
    ({"id": "a", "quantity": "lots", "category": "X"}, "not a number"),
    ({"id": "a", "quantity": 1}, "category"),
])
def test_a_line_that_cannot_be_acted_on_is_refused(line, expected):
    with pytest.raises(StockFileError, match=expected):
        parse_document(doc(lines=[line]))


def test_an_unrecognised_field_is_reported_with_a_suggestion():
    """A misspelled key is otherwise indistinguishable from an omission."""
    with pytest.raises(StockFileError, match="did you mean 'quantity'"):
        parse_document(doc(lines=[{"id": "a", "quantitiy": 5,
                                   "category": "X"}]))


def test_an_unknown_condition_is_refused():
    with pytest.raises(StockFileError, match="not a known condition"):
        parse_document(doc(lines=[{"id": "a", "quantity": 1, "category": "X",
                                   "condition": "sealed"}]))


def test_confidence_outside_zero_to_one_is_refused():
    with pytest.raises(StockFileError, match="between 0 and 1"):
        parse_document(doc(lines=[{"id": "a", "quantity": 1, "category": "X",
                                   "confidence": 87}]))


def test_an_unsupported_version_is_refused():
    with pytest.raises(StockFileError, match="unsupported version"):
        parse_document(doc(version=99))


def test_every_problem_is_reported_at_once():
    """An agent fixing one error at a time would need a round trip each."""
    with pytest.raises(StockFileError) as caught:
        parse_document(doc(lines=[
            {"id": "a", "quantity": -1, "category": "X"},
            {"quantity": 1, "category": "Y"},
            {"id": "c", "quantity": 1},
        ]))
    assert len(str(caught.value).splitlines()) >= 3


# --------------------------------------------------------------------------
# Formats
# --------------------------------------------------------------------------
def test_csv_dotted_columns_become_nesting():
    text = ("id,quantity,category,order.reference,param.Resistance\n"
            "a,25,Resistors/Through Hole Resistors,91033876,1 ohm\n")
    document = parse_document(parse_text(text, ".csv"))
    line = document.lines[0]
    assert line.order == {"reference": "91033876"}
    assert line.parameters == {"Resistance": "1 ohm"}


def test_a_parameter_name_containing_a_dot_survives():
    """'Lifetime @ Temp.' is a name, not a path."""
    text = "id,quantity,category,param.Lifetime @ Temp.\na,1,X,2000 Hrs\n"
    document = parse_document(parse_text(text, ".csv"))
    assert document.lines[0].parameters == {"Lifetime @ Temp.": "2000 Hrs"}


def test_csv_empty_cells_are_omitted_not_stored_as_blank():
    text = "id,quantity,category,mpn,param.Resistance\na,1,X,,\n"
    document = parse_document(parse_text(text, ".csv"))
    assert document.lines[0].mpn == ""
    assert document.lines[0].parameters == {}


def test_yaml_reads_the_same_shape(tmp_path):
    path = tmp_path / "stock.yaml"
    path.write_text(
        "lines:\n"
        "  - id: a\n"
        "    quantity: 4\n"
        "    category: Resistors/Through Hole Resistors\n"
        "    parameters:\n"
        "      Resistance: 1 ohm\n")
    document = read_file(path)
    assert document.lines[0].parameters == {"Resistance": "1 ohm"}


@pytest.mark.parametrize("flag", ["true", "True", "yes", "1"])
def test_csv_booleans_read_as_booleans(flag):
    text = f"id,quantity,category,approximate\na,1,X,{flag}\n"
    document = parse_document(parse_text(text, ".csv"))
    assert document.lines[0].approximate is True


def test_a_file_that_is_not_readable_says_so(tmp_path):
    path = tmp_path / "stock.json"
    path.write_text("{not json at all")
    with pytest.raises(StockFileError, match="could not be read"):
        read_file(path)


def test_a_missing_file_says_which(tmp_path):
    with pytest.raises(StockFileError, match="nope.json"):
        read_file(tmp_path / "nope.json")


def test_the_path_is_kept_for_reporting(tmp_path):
    path = write(tmp_path, doc())
    assert read_file(path).path == path


# --------------------------------------------------------------------------
# URLs and images
# --------------------------------------------------------------------------
def test_link_and_datasheet_are_kept():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "link": "https://www.rockby.com.au/product/123",
        "datasheet": "https://www.yageo.com/ds.pdf",
    }]))
    line = document.lines[0]
    assert line.link == "https://www.rockby.com.au/product/123"
    assert line.datasheet == "https://www.yageo.com/ds.pdf"


def test_a_protocol_relative_url_is_made_absolute():
    """DigiKey-style '//host/path' is what InvenTree's validator rejects."""
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "datasheet": "//www.yageo.com/ds.pdf",
    }]))
    assert document.lines[0].datasheet == "https://www.yageo.com/ds.pdf"


def test_a_link_without_a_scheme_is_refused():
    with pytest.raises(StockFileError, match="not a URL"):
        parse_document(doc(lines=[{
            "id": "a", "quantity": 1, "category": "X",
            "link": "www.rockby.com.au/product/123",
        }]))


def test_a_datasheet_may_be_a_local_file():
    """A path is kept as written, to be attached rather than linked."""
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "datasheet": "datasheets/82S137.pdf",
    }]))
    assert document.lines[0].datasheet == "datasheets/82S137.pdf"


def test_datasheet_pages_are_kept_as_written():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "datasheet": "https://bitsavers.org/book.pdf",
        "datasheet_pages": "140-142",
    }]))
    assert document.lines[0].datasheet_pages == "140-142"


def test_a_single_datasheet_page_may_be_a_number():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "datasheet": "book.pdf", "datasheet_pages": 7,
    }]))
    assert document.lines[0].datasheet_pages == "7"


@pytest.mark.parametrize("pages", ["p140", "142-140", "0", "1-2-3", True])
def test_datasheet_pages_that_are_not_a_page_list_are_refused(pages):
    with pytest.raises(StockFileError, match="not a page list"):
        parse_document(doc(lines=[{
            "id": "a", "quantity": 1, "category": "X",
            "datasheet": "book.pdf", "datasheet_pages": pages,
        }]))


def test_image_is_a_url_or_a_path():
    """Photos are allowed to be local files; product pages are not."""
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "image": "packets/l01.jpg",
    }]))
    assert document.lines[0].image == "packets/l01.jpg"
    assert document.lines[0].images == ["packets/l01.jpg"]


def test_images_are_collected_with_the_primary_first():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "image": "https://example.com/a.jpg",
        "images": ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    }]))
    assert document.lines[0].images == [
        "https://example.com/a.jpg", "https://example.com/b.jpg"]


def test_csv_images_are_a_comma_separated_cell():
    text = ("id,quantity,category,image,images\n"
            "a,1,X,front.jpg,\"front.jpg, back.jpg\"\n")
    document = parse_document(parse_text(text, ".csv"))
    assert document.lines[0].images == ["front.jpg", "back.jpg"]


# --------------------------------------------------------------------------
# Tags and the batch code
# --------------------------------------------------------------------------
def test_tags_are_read_as_a_list():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "tags": ["NOS", "new old stock"], "packaging": "Tube, sealed",
    }]))
    assert document.lines[0].tags == ["NOS", "new old stock"]


def test_csv_tags_are_a_comma_separated_cell():
    """A spreadsheet has no way to write a list, so a cell has to be one."""
    text = ("id,quantity,category,tags,packaging\n"
            "a,1,X,\"NOS, new old stock\",\"Tube, sealed\"\n")
    document = parse_document(parse_text(text, ".csv"))
    assert document.lines[0].tags == ["NOS", "new old stock"]


def test_tags_are_deduplicated_case_insensitively():
    """`NOS` and `nos` are one tag, and the spelling written first wins."""
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "tags": ["NOS", "nos", "  ", "NOS"], "packaging": "Tube, sealed",
    }]))
    assert document.lines[0].tags == ["NOS"]


def test_file_wide_tags_merge_with_a_line_of_its_own():
    """
    Both are true at once. Replacing would silently drop the file-wide tag,
    which is the one that describes every line in the delivery.
    """
    document = parse_document(doc(
        defaults={"tags": ["NOS", "new old stock"],
                  "packaging": "Tube, sealed"},
        lines=[{"id": "a", "quantity": 1, "category": "X",
                "tags": ["surplus"]},
               {"id": "b", "quantity": 1, "category": "X"}]))
    assert document.lines[0].tags == ["NOS", "new old stock", "surplus"]
    assert document.lines[1].tags == ["NOS", "new old stock"]


def test_a_line_repeating_a_file_wide_tag_does_not_get_it_twice():
    document = parse_document(doc(
        defaults={"tags": ["NOS"], "packaging": "Tube, sealed"},
        lines=[{"id": "a", "quantity": 1, "category": "X", "tags": ["nos"]}]))
    assert document.lines[0].tags == ["NOS"]


def test_a_batch_code_is_kept():
    """The date code is the evidence for new old stock, so it gets a field."""
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X", "batch": "8231",
    }]))
    assert document.lines[0].batch == "8231"


def test_a_file_wide_batch_applies_to_every_line():
    document = parse_document(doc(
        defaults={"batch": "8231"},
        lines=[{"id": "a", "quantity": 1, "category": "X"},
               {"id": "b", "quantity": 1, "category": "X", "batch": "8244"}]))
    assert document.lines[0].batch == "8231"
    assert document.lines[1].batch == "8244"      # a line still wins


def test_packaging_is_kept_and_may_be_file_wide():
    document = parse_document(doc(
        defaults={"packaging": "Cut Tape"},
        lines=[{"id": "a", "quantity": 1, "category": "X"},
               {"id": "b", "quantity": 1, "category": "X", "packaging": "Tube"}]))
    assert document.lines[0].packaging == "Cut Tape"
    assert document.lines[1].packaging == "Tube"


@pytest.mark.parametrize("packaging", [
    "Tube, sealed", "Anti-static bag (opened)", "Tray - unsealed",
    "Reel, resealed", "Bag, partially opened"])
def test_new_old_stock_packaging_with_a_kind_and_seal_state_is_accepted(
        packaging):
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X", "tags": ["NOS"],
        "packaging": packaging,
    }]))
    assert document.lines[0].packaging == packaging


@pytest.mark.parametrize("packaging, complaint", [
    ("", "required for new old stock"),
    ("Tube", "does not say whether it is sealed"),
    ("sealed", "not what it is"),
])
def test_new_old_stock_must_say_what_it_is_in_and_whether_it_is_sealed(
        packaging, complaint):
    """
    'Sealed tube' is a claim about the parts inside that 'opened bag' cannot
    make, so an NOS line has to say both.
    """
    with pytest.raises(StockFileError, match=complaint):
        parse_document(doc(lines=[{
            "id": "a", "quantity": 1, "category": "X",
            "tags": ["NOS", "new old stock"], "packaging": packaging,
        }]))


def test_stock_that_is_not_nos_needs_no_seal_state():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X", "packaging": "Cut Tape",
    }]))
    assert document.lines[0].packaging == "Cut Tape"


def test_packaging_longer_than_inventree_keeps_is_refused():
    with pytest.raises(StockFileError, match="packaging"):
        parse_document(doc(lines=[{
            "id": "a", "quantity": 1, "category": "X", "packaging": "x" * 51,
        }]))


def test_tags_that_are_neither_a_list_nor_a_string_are_refused():
    with pytest.raises(StockFileError) as caught:
        parse_document(doc(lines=[{
            "id": "a", "quantity": 1, "category": "X", "tags": {"NOS": True},
        }]))
    assert "tags" in str(caught.value)


# --------------------------------------------------------------------------
# Order details
# --------------------------------------------------------------------------
def test_every_order_field_is_read():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "order": {"reference": "INV-1", "date": "2026-03-14",
                  "target_date": "2026-03-28", "description": "March restock",
                  "link": "https://example.com/i/1", "notes": "paid cash",
                  "tags": ["surplus"], "invoice": "scans/inv-1.pdf"},
    }]))
    order = document.lines[0].order
    assert order["reference"] == "INV-1"
    assert order["date"] == "2026-03-14"
    assert order["target_date"] == "2026-03-28"
    assert order["tags"] == ["surplus"]
    assert order["invoice"] == "scans/inv-1.pdf"


def test_an_unknown_order_field_is_reported():
    with pytest.raises(StockFileError) as caught:
        parse_document(doc(lines=[{
            "id": "a", "quantity": 1, "category": "X",
            "order": {"reference": "INV-1", "referance": "typo"},
        }]))
    assert "order.referance" in str(caught.value)


def test_an_order_date_that_is_not_a_date_is_refused():
    """The server would reject it, and an error naming the line is kinder."""
    with pytest.raises(StockFileError) as caught:
        parse_document(doc(lines=[{
            "id": "a", "quantity": 1, "category": "X",
            "order": {"reference": "INV-1", "date": "14/03/2026"},
        }]))
    assert "order.date" in str(caught.value)
    assert "YYYY-MM-DD" in str(caught.value)


def test_an_order_timestamp_is_trimmed_to_its_day():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "order": {"reference": "INV-1", "date": "2026-03-14T09:31:00Z"},
    }]))
    assert document.lines[0].order["date"] == "2026-03-14"


# --------------------------------------------------------------------------
# Version 2: parts and manufacturer parts described once
# --------------------------------------------------------------------------
def v2(**overrides):
    """A part bought in three lots, two marked with a special number."""
    data = {
        "version": 2,
        "parts": [{"id": "118a", "category": "Amplifiers/Op Amps",
                   "description": "Op amp module",
                   "parameters": {"Supply Voltage": "±15 V"},
                   "datasheet": "https://example.com/118.pdf",
                   "link": "https://example.com/118",
                   "notes": {"summary": ["General-purpose op amp"]}}],
        "manufacturer_parts": [
            {"id": "118a/118A", "part": "118a",
             "manufacturer": "Analog Devices", "mpn": "118A"},
            {"id": "118a/5716", "part": "118a",
             "manufacturer": "Analog Devices", "mpn": "5716",
             "notes": {"summary": ["A special number for the 118A"]}}],
        "lines": [
            {"id": "l1", "manufacturer_part": "118a/5716", "quantity": 65,
             "link": "https://seller.example/123",
             "notes": {"stock": ["65 bags"], "markings": "A 7/81"}},
            {"id": "l2", "manufacturer_part": "118a/5716", "quantity": 14},
            {"id": "l3", "manufacturer_part": "118a/118A", "quantity": 1},
            {"id": "l4", "part": "118a", "quantity": 2}],
    }
    data.update(overrides)
    return data


def problems_of(data) -> str:
    with pytest.raises(StockFileError) as raised:
        parse_document(data)
    return str(raised.value)


def test_every_line_takes_its_parts_fields():
    lines = parse_document(v2()).lines
    assert [line.category for line in lines] == ["Amplifiers/Op Amps"] * 4
    assert all(line.parameters == {"Supply Voltage": "±15 V"}
               for line in lines)
    assert all(line.datasheet == "https://example.com/118.pdf"
               for line in lines)


def test_a_line_takes_the_number_its_lot_is_marked_with():
    lines = parse_document(v2()).lines
    assert [(line.manufacturer, line.mpn) for line in lines] == [
        ("Analog Devices", "5716"), ("Analog Devices", "5716"),
        ("Analog Devices", "118A"), ("", "")]


def test_later_lines_of_a_part_are_filed_against_the_first():
    lines = parse_document(v2()).lines
    assert [line.part_of for line in lines] == ["", "l1", "l1", "l1"]


def test_notes_travel_once_with_the_first_line_of_each_record():
    lines = parse_document(v2()).lines
    assert lines[0].part_notes == {"summary": ["General-purpose op amp"]}
    assert lines[0].manufacturer_part_notes == {
        "summary": ["A special number for the 118A"]}
    assert all(not line.part_notes for line in lines[1:])
    assert all(not line.manufacturer_part_notes for line in lines[1:])


def test_stock_notes_stay_with_their_own_line():
    lines = parse_document(v2()).lines
    assert lines[0].notes == {"stock": ["65 bags"], "markings": "A 7/81"}
    assert lines[1].notes == ""


def test_a_lines_link_is_the_sellers_listing_not_the_parts_page():
    first = parse_document(v2()).lines[0]
    assert first.link == "https://example.com/118"
    assert first.supplier_link == "https://seller.example/123"


def test_lines_remember_which_entries_they_came_from():
    first = parse_document(v2()).lines[0]
    assert (first.part_ref, first.manufacturer_part_ref) == (
        "118a", "118a/5716")


def test_line_defaults_apply_but_a_category_is_the_parts_to_set():
    document = parse_document(v2(defaults={"supplier": "macservice"}))
    assert {line.supplier for line in document.lines} == {"macservice"}
    assert ("file: defaults.category: belongs to each part in a version 2 "
            "file") in problems_of(v2(defaults={"category": "X"}))


def test_a_part_field_on_a_line_says_where_it_belongs():
    data = v2()
    data["lines"][1].update(category="X", mpn="5716")
    text = problems_of(data)
    assert ("line l2: category: belongs on its part in a version 2 file"
            in text)
    assert ("line l2: mpn: belongs on its manufacturer part in a version 2 "
            "file" in text)


def test_part_of_is_not_needed_in_version_2():
    data = v2()
    data["lines"][1]["part_of"] = "l1"
    assert "line l2: part_of: is not needed" in problems_of(data)


def test_a_mistake_in_a_part_is_reported_once_against_the_part():
    data = v2()
    data["parts"][0]["link"] = "not a url"
    text = problems_of(data)
    assert text.count("not a URL") == 1
    assert "part 118a: link: 'not a url' is not a URL" in text


def test_a_section_the_part_does_not_have_is_reported_on_the_part():
    data = v2()
    data["parts"][0]["notes"] = {"markings": "A 7/81"}
    assert ("part 118a: notes: 'markings' is not a section here"
            in problems_of(data))


def test_references_must_name_entries_in_the_file():
    data = v2()
    data["lines"][3]["part"] = "118"
    data["lines"][2]["manufacturer_part"] = "118a/118"
    data["manufacturer_parts"][0]["part"] = "nope"
    text = problems_of(data)
    assert "line l4: part: '118' is not a part in this file" in text
    assert ("line l3: manufacturer_part: '118a/118' is not a manufacturer "
            "part in this file" in text)
    assert ("manufacturer part 118a/118A: part: 'nope' is not a part in "
            "this file" in text)


def test_a_line_must_name_a_part():
    data = v2()
    del data["lines"][3]["part"]
    assert "line l4: part: is required" in problems_of(data)


def test_a_line_naming_both_must_name_the_same_part():
    data = v2(parts=[*v2()["parts"], {"id": "other", "category": "X"}])
    data["lines"][0]["part"] = "other"
    assert ("line l1: part: is 'other', but manufacturer part '118a/5716' "
            "is a number for '118a'") in problems_of(data)


def test_entries_no_line_uses_are_reported():
    data = v2()
    data["lines"] = data["lines"][:1]
    assert ("manufacturer part 118a/118A: id: no line uses this "
            "manufacturer part" in problems_of(data))


def test_manufacturer_part_notes_need_a_manufacturer():
    """Without a maker no ManufacturerPart is made, so nothing holds them."""
    data = v2()
    del data["manufacturer_parts"][1]["manufacturer"]
    assert ("manufacturer part 118a/5716: notes: need a manufacturer"
            in problems_of(data))


def test_parts_need_version_2():
    data = doc(parts=[{"id": "p", "category": "X"}])
    assert 'file: parts: needs "version": 2' in problems_of(data)


def test_a_version_1_line_may_give_its_notes_as_sections():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "notes": {"stock": ["two bags"]}}]))
    assert document.lines[0].notes == {"stock": ["two bags"]}


def test_a_csv_spreads_note_sections_across_dotted_columns():
    document = parse_document(parse_text(
        "id,quantity,category,notes.stock,notes.markings\n"
        "a,1,X,two bags,A 4/86\n", ".csv"))
    assert document.lines[0].notes == {"stock": "two bags",
                                       "markings": "A 4/86"}


def test_a_part_may_be_given_a_name():
    data = v2()
    data["parts"][0]["name"] = "118A"
    assert {line.name for line in parse_document(data).lines} == {"118A"}


def test_a_version_1_line_may_name_its_part_too():
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X", "name": "Thing"}]))
    assert document.lines[0].name == "Thing"


def test_a_name_longer_than_inventree_keeps_is_refused_on_the_part():
    data = v2()
    data["parts"][0]["name"] = "x" * 101
    assert ("part 118a: name: is 101 characters; InvenTree keeps at most 100"
            in problems_of(data))
