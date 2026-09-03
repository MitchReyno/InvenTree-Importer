"""A stock file becoming InvenTree records."""

from __future__ import annotations

import json

import pytest

from invimport.config import load_categories_config
from invimport.inventree.api import connect
from invimport.inventree.stockimport import (
    CREATED,
    EXISTS,
    REVIEW,
    SKIPPED,
    ImportOptions,
    import_stock,
)
from invimport.stockfile import parse_document, read_file

CATEGORIES = """
Resistors:
  ipn_prefix: RES
  identity: spec
  key_parameters: [Resistance, Tolerance]
  parameters: [Resistance, Tolerance]
  Through Hole Resistors: {}
Diodes:
  ipn_prefix: DIOD
  identity: type
  parameters: [Package]
  Signal Diodes: {}
"""

PARAMETERS = (
    "Resistance:\n  units: ohm\n  parse: quantity\n"
    "Tolerance:\n  units: '%'\n  parse: percent\n"
    "Package:\n  aliases: [Package / Case]\n")


@pytest.fixture
def config(tmp_path):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "categories.yaml").write_text(CATEGORIES)
    (tmp_path / "parameters.yaml").write_text(PARAMETERS)
    (tmp_path / "manufacturers.yaml").write_text("")
    (tmp_path / "suppliers.yaml").write_text(
        "eBay:\n  aliases: [ebay]\n")
    return tmp_path


@pytest.fixture
def server(inventree):
    """Categories and templates present, as `invimport categories` leaves them."""
    resistors = inventree.add_category("Resistors", pk=12, structural=True)
    inventree.add_category("Through Hole Resistors", parent=resistors["pk"], pk=13)
    diodes = inventree.add_category("Diodes", pk=14, structural=True)
    inventree.add_category("Signal Diodes", parent=diodes["pk"], pk=15)
    for pk, name, units in [(21, "Resistance", "ohm"), (22, "Tolerance", "%"),
                            (23, "Package", "")]:
        inventree.templates.append({"pk": pk, "name": name, "units": units})
    return inventree


def run(config, *lines, **options):
    document = parse_document({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": str(i + 1), "quantity": 1, **line}
                  for i, line in enumerate(lines)]})
    return document, import_stock(
        document, connect(), directory=config,
        options=ImportOptions(write=True, **options))


RESISTOR = {"category": "Resistors/Through Hole Resistors",
            "parameters": {"Resistance": "4k7", "Tolerance": "1%"}}
DIODE = {"category": "Diodes/Signal Diodes", "type": "1N4007"}


# --------------------------------------------------------------------------
# The happy path
# --------------------------------------------------------------------------
def test_a_line_becomes_a_part_and_some_stock(config, server):
    _, result = run(config, {**RESISTOR, "quantity": 25})

    action = result.lines[0]
    assert action.action == CREATED
    assert action.ipn == "RES-00001"
    assert action.part and action.stock_item
    assert server.stock_items[0]["quantity"] == 25
    assert server.stock_items[0]["part"] == action.part


def test_the_parameters_are_stored_on_the_part(config, server):
    _, result = run(config, RESISTOR)
    stored = {p["data"] for p in server.parameters}
    assert "4.7 k" in stored          # RKM notation read correctly
    assert "1" in stored


def test_a_part_with_no_mpn_or_manufacturer_is_fine(config, server):
    """Half of real stock is exactly this."""
    _, result = run(config, RESISTOR)
    assert result.lines[0].action == CREATED
    assert server.manufacturer_parts == []


def test_a_type_designator_names_the_part(config, server):
    _, result = run(config, DIODE)
    assert result.lines[0].name == "1N4007"
    assert result.lines[0].ipn == "DIOD-00001"


def test_two_lines_of_the_same_part_share_it(config, server):
    """More stock of something you own is normal, and not a duplicate part."""
    _, result = run(config, RESISTOR, {**RESISTOR, "id": "2"})
    first, second = result.lines
    assert first.part == second.part
    assert first.stock_item != second.stock_item
    assert len([p for p in server.part_rows if p.get("category") == 13]) == 1


# --------------------------------------------------------------------------
# Re-running
# --------------------------------------------------------------------------
def test_importing_the_same_file_twice_creates_nothing_the_second_time(
        config, server):
    document, first = run(config, {**RESISTOR, "quantity": 25})
    before = len(server.stock_items)

    second = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=True))

    assert first.counts()["created"] == 1
    assert second.counts()["exists"] == 1
    assert second.counts()["created"] == 0
    assert len(server.stock_items) == before


def test_a_re_run_reports_the_stock_it_found(config, server):
    document, first = run(config, RESISTOR)
    second = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=True))
    assert second.lines[0].stock_item == first.lines[0].stock_item


def test_editing_one_line_does_not_re_import_the_others(config, server):
    """Ids are per line, so a changed line is the only one that moves."""
    document, _ = run(config, RESISTOR, {**DIODE, "id": "2"})
    document.lines[1].quantity = 99

    second = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=True))

    assert [a.action for a in second.lines] == [EXISTS, EXISTS]


# --------------------------------------------------------------------------
# Suppliers, orders and locations
# --------------------------------------------------------------------------
def test_a_supplier_and_sku_become_a_supplier_part(config, server):
    _, result = run(config, {**RESISTOR, "supplier": "Rockby Electronics",
                             "sku": "R-1234"})
    assert result.lines[0].supplier_part is not None
    assert server.supplier_parts[0]["SKU"] == "R-1234"


def test_an_ebay_seller_becomes_one_ebay_supplier_and_a_note(config, server):
    _, result = run(config, {**RESISTOR, "supplier": "salash (eBay)"})
    assert [c["name"] for c in server.companies] == ["eBay"]
    assert "sold by salash" in server.stock_items[0]["notes"]


def test_an_order_reference_creates_one_purchase_order(config, server):
    _, result = run(config,
                    {**RESISTOR, "supplier": "Rockby Electronics",
                     "sku": "R-1", "order": {"reference": "R-99213"}},
                    {**DIODE, "id": "2", "supplier": "Rockby Electronics",
                     "sku": "R-2", "order": {"reference": "R-99213"}})

    assert len(server.purchase_orders) == 1
    assert server.purchase_orders[0]["supplier_reference"] == "R-99213"
    assert {a.purchase_order for a in result.lines} == {
        server.purchase_orders[0]["pk"]}


def test_a_line_with_no_order_gets_no_purchase_order(config, server):
    """29% of real rows never had one; inventing one records a fiction."""
    _, result = run(config, RESISTOR)
    assert result.lines[0].purchase_order is None
    assert server.purchase_orders == []


def test_a_location_path_is_created_and_used(config, server):
    _, result = run(config, {**RESISTOR, "location": "Workshop/Drawer A"})
    assert result.lines[0].location == "Workshop/Drawer A"
    assert server.stock_items[0]["location"] == next(
        loc["pk"] for loc in server.locations
        if loc.get("pathstring") == "Workshop/Drawer A")


def test_a_default_location_applies_where_a_line_gives_none(config, server):
    _, result = run(config, RESISTOR, default_location="Workshop/Bulk")
    assert result.lines[0].location == "Workshop/Bulk"


# --------------------------------------------------------------------------
# Condition and notes
# --------------------------------------------------------------------------
def test_unopened_stock_is_flagged_but_still_counted(config, server):
    _, result = run(config, {**RESISTOR, "quantity": 100,
                             "condition": "unopened", "approximate": True})
    item = server.stock_items[0]
    assert item["status"] == 50                  # ATTENTION, in AVAILABLE_CODES
    assert item["quantity"] == 100
    assert "approximate" in item["notes"]


# --------------------------------------------------------------------------
# When it must not guess
# --------------------------------------------------------------------------
def test_a_partial_spec_is_held_for_review(config, server):
    _, result = run(config, {"category": "Resistors/Through Hole Resistors",
                             "parameters": {"Resistance": "4k7"}})
    action = result.lines[0]
    assert action.action == REVIEW
    assert action.missing == ["Tolerance"]
    assert server.stock_items == []


def test_an_unknown_category_is_held_for_review(config, server):
    _, result = run(config, {"category": "Resistors/SMD"})
    action = result.lines[0]
    assert action.action == REVIEW
    assert "Resistors/Surface Mount Resistors" not in action.candidates
    assert "Resistors/Through Hole Resistors" in action.candidates


def test_a_chooser_settles_an_unknown_category(config, server):
    _, result = run(config, {**RESISTOR, "category": "Resistors/SMD"},
                    choose_category=lambda line, near: near[0])
    assert result.lines[0].action == CREATED
    assert result.lines[0].category == "Resistors/Through Hole Resistors"


def test_a_chooser_can_create_the_proposed_category(config, server):
    """Picking the path the file named writes it to the config and the server."""
    calls = []

    def choose(line, near):
        calls.append(line.id)
        return line.category

    before = (config / "categories.yaml").read_text()
    _, result = run(
        config,
        {"category": "Resistors/Wirewound",
         "suggest_category": {"identity": "spec", "ipn_prefix": "WW"},
         "parameters": {"Resistance": "4k7", "Tolerance": "1%"}},
        {"category": "Resistors/Wirewound",
         "suggest_category": {"identity": "spec"},
         "parameters": {"Resistance": "10k", "Tolerance": "1%"}},
        choose_category=choose)

    assert calls == ["1"]                         # the second line reuses it
    assert [a.action for a in result.lines] == [CREATED, CREATED]
    assert {a.category for a in result.lines} == {"Resistors/Wirewound"}
    cats = load_categories_config(config)
    assert "Resistors/Wirewound" in cats
    assert cats["Resistors/Wirewound"].ipn_prefix == "WW"
    assert before != (config / "categories.yaml").read_text()
    assert any(c.get("pathstring") == "Resistors/Wirewound"
               for c in server.categories)


def test_creating_a_category_in_a_dry_run_writes_nothing(config, server):
    yaml_before = (config / "categories.yaml").read_text()
    categories_before = len(server.categories)
    document = parse_document({"source": {"reference": "notes.jpg"}, "lines": [
        {"id": "1", "quantity": 1, "category": "Resistors/Wirewound",
         "suggest_category": {"identity": "spec"},
         "parameters": {"Resistance": "4k7", "Tolerance": "1%"}}]})

    result = import_stock(
        document, connect(), directory=config,
        options=ImportOptions(
            write=False,
            choose_category=lambda line, near: line.category))

    assert result.lines[0].action == CREATED
    assert result.lines[0].category == "Resistors/Wirewound"
    assert (config / "categories.yaml").read_text() == yaml_before
    assert len(server.categories) == categories_before
    assert server.stock_items == []


def test_a_low_confidence_line_is_held_when_a_floor_is_set(config, server):
    _, result = run(config, {**RESISTOR, "confidence": 0.4},
                    min_confidence=0.7)
    assert result.lines[0].action == REVIEW
    assert "below" in result.lines[0].reason
    assert server.stock_items == []


def test_confidence_is_ignored_without_a_floor(config, server):
    """It is an agent's hint, not a fact about the part."""
    _, result = run(config, {**RESISTOR, "confidence": 0.1})
    assert result.lines[0].action == CREATED


def test_a_category_not_on_the_server_is_skipped_with_advice(config, inventree):
    """No categories seeded: the config knows them, the server does not."""
    _, result = run(config, RESISTOR)
    assert result.lines[0].action == SKIPPED
    assert "invimport categories --write" in result.lines[0].reason


# --------------------------------------------------------------------------
# Dry run
# --------------------------------------------------------------------------
def test_a_dry_run_writes_nothing(config, server):
    document = parse_document({"lines": [
        {"id": "1", "quantity": 5, **RESISTOR}]})
    before = len(server.part_rows)               # the stub seeds an unrelated part

    result = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=False))

    assert result.lines[0].action == CREATED     # what it would do
    assert server.stock_items == []
    assert len(server.part_rows) == before
    assert server.barcodes == {}


# --------------------------------------------------------------------------
# URLs and images
# --------------------------------------------------------------------------
def test_a_datasheet_is_stored_on_the_part_and_the_manufacturer_part(
        config, server):
    _, result = run(config, {
        **RESISTOR, "manufacturer": "YAGEO", "mpn": "MFR-25FTE52-4K7",
        "datasheet": "https://www.yageo.com/ds.pdf",
        "link": "https://www.rockby.com.au/product/123",
        "supplier": "Rockby Electronics", "sku": "R-4K7",
    })
    assert result.lines[0].action == CREATED
    part = next(p for p in server.part_rows if p.get("IPN") == "RES-00001")
    assert part["link"] == "https://www.yageo.com/ds.pdf"
    assert server.manufacturer_parts[0]["link"] == "https://www.yageo.com/ds.pdf"
    assert server.supplier_parts[0]["link"] == "https://www.rockby.com.au/product/123"


def test_a_link_alone_becomes_the_part_link(config, server):
    """No datasheet: the product page is still worth keeping."""
    run(config, {**RESISTOR, "link": "https://www.rockby.com.au/product/123"})
    part = next(p for p in server.part_rows if p.get("IPN") == "RES-00001")
    assert part["link"] == "https://www.rockby.com.au/product/123"


def test_a_local_image_is_uploaded_as_the_part_picture(config, server, tmp_path):
    photo = tmp_path / "packet.jpg"
    photo.write_bytes(b"\xff\xd8\xff\xd9")
    document = parse_document({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": "1", "quantity": 1, **RESISTOR,
                   "image": str(photo)}]})
    import_stock(document, connect(), directory=config,
                 options=ImportOptions(write=True))
    part = next(p for p in server.part_rows if p.get("IPN") == "RES-00001")
    assert part.get("image")
    assert server.images


def test_an_image_next_to_the_file_is_found_by_relative_path(
        config, server, tmp_path):
    photo = tmp_path / "packet.jpg"
    photo.write_bytes(b"\xff\xd8\xff\xd9")
    path = tmp_path / "stock.json"
    path.write_text(json.dumps({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": "1", "quantity": 1, **RESISTOR,
                   "image": "packet.jpg"}]}))
    import_stock(read_file(path), connect(), directory=config,
                 options=ImportOptions(write=True))
    part = next(p for p in server.part_rows if p.get("IPN") == "RES-00001")
    assert part.get("image")


def test_an_image_url_is_downloaded_and_uploaded(config, server, tmp_path,
                                                 monkeypatch):
    photo = tmp_path / "NE555P.jpg"
    photo.write_bytes(b"\xff\xd8\xff\xd9")

    def fake_fetch(url, cache_dir=None, refresh=False):
        assert url == "https://example.com/photo.jpg"
        return photo

    monkeypatch.setattr("invimport.inventree.parts.fetch_image", fake_fetch)
    run(config, {**RESISTOR, "image": "https://example.com/photo.jpg"})
    part = next(p for p in server.part_rows if p.get("IPN") == "RES-00001")
    assert part.get("image")


def test_a_missing_image_does_not_fail_the_import(config, server):
    """A part with no picture is better than an import that stops."""
    _, result = run(config, {**RESISTOR, "image": "no-such-file.jpg"})
    assert result.lines[0].action == CREATED
    assert result.lines[0].stock_item
    part = next(p for p in server.part_rows if p.get("IPN") == "RES-00001")
    assert not part.get("image")


# --------------------------------------------------------------------------
# Tags and the batch code
# --------------------------------------------------------------------------
def test_tags_and_batch_reach_the_stock_item(config, server):
    """
    Both describe the lot, not the part. New old stock is a claim about where
    this quantity came from - the same component can arrive as NOS in one
    delivery and current production in the next - so they are written to the
    stock item, where they can differ, rather than to the part, where they
    could not.
    """
    _, result = run(config, {**RESISTOR,
                             "tags": ["NOS", "new old stock"],
                             "batch": "8231",
                             "notes": "sealed tube from a surplus dealer"})

    assert result.lines[0].action == CREATED
    item = server.stock_items[0]
    assert item["tags"] == ["NOS", "new old stock"]
    assert item["batch"] == "8231"
    assert "sealed tube from a surplus dealer" in item["notes"]


def test_stock_without_tags_or_batch_sends_neither(config, server):
    """An absent tag list is not an empty one - do not write fields we were
    not given, or every item gets a blank batch it never had."""
    run(config, RESISTOR)
    item = server.stock_items[0]
    assert "tags" not in item
    assert "batch" not in item
