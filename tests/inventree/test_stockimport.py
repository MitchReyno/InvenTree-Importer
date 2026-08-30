"""A stock file becoming InvenTree records."""

from __future__ import annotations

import pytest

from invimport.inventree.api import connect
from invimport.inventree.stockimport import (
    CREATED,
    EXISTS,
    REVIEW,
    SKIPPED,
    ImportOptions,
    import_stock,
)
from invimport.stockfile import parse_document

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
