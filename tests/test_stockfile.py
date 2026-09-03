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
        "tags": ["NOS", "new old stock"],
    }]))
    assert document.lines[0].tags == ["NOS", "new old stock"]


def test_csv_tags_are_a_comma_separated_cell():
    """A spreadsheet has no way to write a list, so a cell has to be one."""
    text = ("id,quantity,category,tags\n"
            "a,1,X,\"NOS, new old stock\"\n")
    document = parse_document(parse_text(text, ".csv"))
    assert document.lines[0].tags == ["NOS", "new old stock"]


def test_tags_are_deduplicated_case_insensitively():
    """`NOS` and `nos` are one tag, and the spelling written first wins."""
    document = parse_document(doc(lines=[{
        "id": "a", "quantity": 1, "category": "X",
        "tags": ["NOS", "nos", "  ", "NOS"],
    }]))
    assert document.lines[0].tags == ["NOS"]


def test_file_wide_tags_merge_with_a_line_of_its_own():
    """
    Both are true at once. Replacing would silently drop the file-wide tag,
    which is the one that describes every line in the delivery.
    """
    document = parse_document(doc(
        defaults={"tags": ["NOS", "new old stock"]},
        lines=[{"id": "a", "quantity": 1, "category": "X",
                "tags": ["sealed tube"]},
               {"id": "b", "quantity": 1, "category": "X"}]))
    assert document.lines[0].tags == ["NOS", "new old stock", "sealed tube"]
    assert document.lines[1].tags == ["NOS", "new old stock"]


def test_a_line_repeating_a_file_wide_tag_does_not_get_it_twice():
    document = parse_document(doc(
        defaults={"tags": ["NOS"]},
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


def test_tags_that_are_neither_a_list_nor_a_string_are_refused():
    with pytest.raises(StockFileError) as caught:
        parse_document(doc(lines=[{
            "id": "a", "quantity": 1, "category": "X", "tags": {"NOS": True},
        }]))
    assert "tags" in str(caught.value)
