"""A stock file becoming InvenTree records."""

from __future__ import annotations

import io
import json

import pytest

from invimport.config import load_categories_config
from invimport.inventree.api import connect
from invimport.inventree.parts import NEW_PART
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
Integrated Circuits:
  ipn_prefix: IC
  identity: mpn
  parameters: [Package]
  Logic: {}
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


@pytest.fixture(autouse=True)
def _own_cache(tmp_path, monkeypatch):
    """Caches are relative to the working directory; keep them out of the repo."""
    monkeypatch.chdir(tmp_path)


@pytest.fixture
def server(inventree):
    """Categories and templates present, as `invimport categories` leaves them."""
    resistors = inventree.add_category("Resistors", pk=12, structural=True)
    inventree.add_category("Through Hole Resistors", parent=resistors["pk"], pk=13)
    diodes = inventree.add_category("Diodes", pk=14, structural=True)
    inventree.add_category("Signal Diodes", parent=diodes["pk"], pk=15)
    ics = inventree.add_category("Integrated Circuits", pk=16, structural=True)
    inventree.add_category("Logic", parent=ics["pk"], pk=17)
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
    assert result.lines[0].location == "Workshop/Drawer A (new location)"
    assert server.stock_items[0]["location"] == next(
        loc["pk"] for loc in server.locations
        if loc.get("pathstring") == "Workshop/Drawer A")


def test_a_default_location_applies_where_a_line_gives_none(config, server):
    _, result = run(config, RESISTOR, default_location="Workshop/Bulk")
    assert result.lines[0].location == "Workshop/Bulk (new location)"


def test_an_escaped_slash_stays_in_one_location_name(config, server):
    """A part number like JM38510/10103BPC can name a top-level location."""
    _, result = run(config, {**RESISTOR,
                             "location": r"JM38510\/10103BPC - 5962"})
    made = [loc for loc in server.locations
            if loc.get("name") == "JM38510/10103BPC - 5962"]
    assert len(made) == 1 and made[0].get("parent") is None
    assert result.lines[0].location == "JM38510/10103BPC - 5962 (new location)"
    assert server.stock_items[0]["location"] == made[0]["pk"]


def test_part_of_files_a_lot_against_another_lines_part(config, server):
    """
    A lot printed with an older part number (MDA920-3 for MDA920A3) joins
    the part an earlier line made, and its own number becomes a second
    manufacturer part on it.
    """
    _, result = run(config,
                    {**GATE, "manufacturer": "Signetics"},
                    {"category": "Integrated Circuits/Logic", "mpn": "C8162",
                     "manufacturer": "Signetics", "part_of": "1"})
    assert [a.action for a in result.lines] == [CREATED, CREATED]
    assert result.lines[1].part_of == "1"
    parts = {item["part"] for item in server.stock_items}
    assert len(parts) == 1
    assert sorted(m["MPN"] for m in server.manufacturer_parts) == [
        "C8162", "C8162J"]
    assert {m["part"] for m in server.manufacturer_parts} == parts


def test_part_of_must_name_an_earlier_line():
    from invimport.stockfile import StockFileError
    with pytest.raises(StockFileError) as raised:
        parse_document({"source": {"reference": "x"}, "lines": [
            {"id": "1", "quantity": 1, **GATE, "part_of": "2"},
            {"id": "2", "quantity": 1, **GATE, "part_of": "2"},
            {"id": "3", "quantity": 1, **GATE, "part_of": "9"}]})
    text = str(raised.value)
    assert "comes later" in text and "itself" in text and "not a line" in text


def test_batches_of_one_part_can_share_a_new_location(config, server):
    """
    Several stock items of one part kept together in one bag: the dry run
    says the location is new, and the write creates it once for all of them.
    """
    lines = [{**RESISTOR, "batch": "8209", "location": "Bags/RES 4k7"},
             {**RESISTOR, "batch": "7804", "location": "Bags/RES 4k7"}]
    document = parse_document({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": str(i + 1), "quantity": 1, **line}
                  for i, line in enumerate(lines)]})
    dry = import_stock(document, connect(), directory=config,
                       options=ImportOptions(write=False))
    assert [a.location for a in dry.lines] == [
        "Bags/RES 4k7 (new location)"] * 2
    assert not [loc for loc in server.locations
                if str(loc.get("pathstring", "")).startswith("Bags")]

    import_stock(document, connect(), directory=config,
                 options=ImportOptions(write=True))
    bag = [loc for loc in server.locations
           if loc.get("pathstring") == "Bags/RES 4k7"]
    assert len(bag) == 1
    assert {item["location"] for item in server.stock_items} == {bag[0]["pk"]}


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


def test_a_type_with_a_manufacturer_gets_a_manufacturer_part(config, server):
    """The designator printed by that maker stands as its MPN."""
    _, result = run(config, {**DIODE, "manufacturer": "Diotec"})
    assert result.lines[0].action == CREATED
    assert [(m["MPN"], m["manufacturer"]) for m in server.manufacturer_parts] \
        == [("1N4007", next(c["pk"] for c in server.companies
                             if c["name"] == "Diotec"))]


def test_two_makers_of_one_type_share_the_part_not_the_manufacturer_part(
        config, server):
    run(config, {**DIODE, "manufacturer": "Diotec"},
        {**DIODE, "manufacturer": "Vishay"})
    diodes = [p for p in server.part_rows if p.get("name") == "1N4007"]
    assert len(diodes) == 1
    assert sorted(m["manufacturer"] for m in server.manufacturer_parts) == \
        sorted(c["pk"] for c in server.companies
               if c["name"] in ("Diotec", "Vishay"))


# --------------------------------------------------------------------------
# An MPN with no manufacturer, seen again
# --------------------------------------------------------------------------
GATE = {"category": "Integrated Circuits/Logic", "mpn": "C8162J"}


def _gates(server):
    return [p for p in server.part_rows if p.get("name") == "C8162J"]


def test_a_repeat_mpn_without_a_manufacturer_is_held_not_merged(config, server):
    """No ManufacturerPart says they are the same chip, only the name."""
    run(config, GATE)
    _, result = run(config, {**GATE, "id": "x"})
    assert result.lines[0].action == REVIEW
    assert "C8162J" in result.lines[0].reason
    assert [c.name for c in result.lines[0].candidates] == ["C8162J"]
    assert len(_gates(server)) == 1


def test_a_name_match_can_be_accepted(config, server):
    run(config, GATE)
    asked = []

    def choose(line, offered):
        asked.append([p.name for p in offered])
        return offered[0]

    _, result = run(config, {**GATE, "id": "x"}, choose_name_match=choose)
    assert asked == [["C8162J"]]
    assert result.lines[0].action == CREATED
    assert len(_gates(server)) == 1
    part_pk = _gates(server)[0]["pk"]
    assert [s["part"] for s in server.stock_items] == [part_pk, part_pk]


def test_a_name_match_can_be_refused_for_a_new_part(config, server):
    run(config, GATE)
    _, result = run(config, {**GATE, "id": "x"},
                    choose_name_match=lambda line, offered: NEW_PART)
    assert result.lines[0].action == CREATED
    assert len(_gates(server)) == 2


def test_a_name_match_can_skip_the_line(config, server):
    run(config, GATE)
    _, result = run(config, {**GATE, "id": "x"},
                    choose_name_match=lambda line, offered: None)
    assert result.lines[0].action == SKIPPED
    assert len(_gates(server)) == 1
    assert len(server.stock_items) == 1


def _photos(tmp_path, *names):
    for name in names:
        (tmp_path / name).write_bytes(b"\xff\xd8\xff\xd9")


def test_further_images_are_attached_to_the_part(config, server, tmp_path):
    """The picture slot takes one photo; the label and box shots attach."""
    _photos(tmp_path, "chip.jpg", "label.jpg", "box.jpg")
    path = tmp_path / "stock.json"
    path.write_text(json.dumps({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": "1", "quantity": 1, **RESISTOR, "image": "chip.jpg",
                   "images": ["label.jpg", "box.jpg"]}]}))
    import_stock(read_file(path), connect(), directory=config,
                 options=ImportOptions(write=True))
    part = next(p for p in server.part_rows if p.get("IPN") == "RES-00001")
    assert part.get("image")
    attached = [a for a in server.attachments if a["model_type"] == "part"]
    assert sorted(a["filename"] for a in attached) == ["box.jpg", "label.jpg"]
    assert {a["model_id"] for a in attached} == {part["pk"]}
    assert all(a["comment"] == "imported from stock.json" for a in attached)


def test_lines_sharing_a_part_attach_each_image_once(config, server, tmp_path):
    _photos(tmp_path, "chip.jpg", "label.jpg")
    path = tmp_path / "stock.json"
    line = {**RESISTOR, "image": "chip.jpg", "images": ["label.jpg"]}
    path.write_text(json.dumps({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": "1", "quantity": 1, **line},
                  {"id": "2", "quantity": 2, **line}]}))
    import_stock(read_file(path), connect(), directory=config,
                 options=ImportOptions(write=True))
    attached = [a for a in server.attachments if a["model_type"] == "part"]
    assert [a["filename"] for a in attached] == ["label.jpg"]


def test_stock_images_attach_to_each_stock_item_not_the_part(
        config, server, tmp_path):
    """
    Two batches of one part: one part picture, but each stock item carries
    the photo of its own packet, and a re-run does not attach them twice.
    """
    _photos(tmp_path, "pouch.jpg", "batch-a.jpg", "batch-b.jpg")
    path = tmp_path / "stock.json"
    path.write_text(json.dumps({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": "1", "quantity": 2, **RESISTOR, "image": "pouch.jpg",
                   "stock_images": ["batch-a.jpg"]},
                  {"id": "2", "quantity": 1, **RESISTOR, "image": "pouch.jpg",
                   "stock_images": ["batch-b.jpg"]}]}))
    for _ in range(2):
        import_stock(read_file(path), connect(), directory=config,
                     options=ImportOptions(write=True))

    first, second = server.stock_items[0]["pk"], server.stock_items[1]["pk"]
    attached = [(a["model_id"], a["filename"]) for a in server.attachments
                if a["model_type"] == "stockitem"]
    assert attached == [(first, "batch-a.jpg"), (second, "batch-b.jpg")]
    assert not [a for a in server.attachments if a["model_type"] == "part"]


def test_attachments_are_kept_on_the_part(config, server, tmp_path):
    """
    Source snapshots go on the part, with their comment; a bare path gets
    the file's name as its comment; a missing one is skipped, not fatal; and
    a re-run attaches nothing twice.
    """
    (tmp_path / "snapshots").mkdir()
    (tmp_path / "snapshots" / "nsn.html").write_text("<html>snapshot</html>")
    (tmp_path / "label-scan.pdf").write_bytes(b"%PDF-1.4")
    path = tmp_path / "stock.json"
    path.write_text(json.dumps({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": "1", "quantity": 1, **RESISTOR, "attachments": [
            {"file": "snapshots/nsn.html",
             "comment": "Source: NSN listing (snapshot)"},
            "label-scan.pdf",
            "snapshots/gone.html"]}]}))
    for _ in range(2):
        result = import_stock(read_file(path), connect(), directory=config,
                              options=ImportOptions(write=True))
    assert result.lines[0].action == EXISTS
    part = next(p for p in server.part_rows if p.get("IPN") == "RES-00001")
    attached = sorted((a["filename"], a["comment"]) for a in server.attachments
                      if a["model_type"] == "part")
    assert attached == [("label-scan.pdf", "imported from stock.json"),
                        ("nsn.html", "Source: NSN listing (snapshot)")]
    assert {a["model_id"] for a in server.attachments} == {part["pk"]}


def test_attachments_must_name_a_file():
    from invimport.stockfile import StockFileError
    with pytest.raises(StockFileError) as raised:
        parse_document({"source": {"reference": "x"}, "lines": [
            {"id": "1", "quantity": 1, **RESISTOR,
             "attachments": [{"comment": "no file"},
                             {"file": "a", "url": "b"}]}]})
    assert str(raised.value).count("attachments:") == 2


def test_a_missing_further_image_is_skipped(config, server, tmp_path):
    _photos(tmp_path, "chip.jpg", "label.jpg")
    path = tmp_path / "stock.json"
    path.write_text(json.dumps({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": "1", "quantity": 1, **RESISTOR, "image": "chip.jpg",
                   "images": ["gone.jpg", "label.jpg"]}]}))
    result = import_stock(read_file(path), connect(), directory=config,
                          options=ImportOptions(write=True))
    assert result.lines[0].action == CREATED
    attached = [a for a in server.attachments if a["model_type"] == "part"]
    assert [a["filename"] for a in attached] == ["label.jpg"]


# --------------------------------------------------------------------------
# Datasheets kept on the server
# --------------------------------------------------------------------------
def _pdf(path, pages=1):
    from pypdf import PdfWriter

    writer = PdfWriter()
    for number in range(1, pages + 1):
        writer.add_blank_page(width=100 + number, height=200)
    with path.open("wb") as handle:
        writer.write(handle)


def _stock_file(tmp_path, *lines):
    path = tmp_path / "stock.json"
    path.write_text(json.dumps({
        "source": {"reference": "notes.jpg"},
        "lines": [{"id": str(i + 1), "quantity": 1, **line}
                  for i, line in enumerate(lines)]}))
    return read_file(path)


def _datasheets(server):
    return sorted((a["model_type"], a["filename"]) for a in server.attachments
                  if a["comment"].startswith("Datasheet"))


@pytest.fixture
def web(monkeypatch):
    """Datasheet downloads, without the network: url -> (body, type)."""
    from types import SimpleNamespace

    from invimport.inventree import datasheets

    pages: dict[str, tuple[bytes, str]] = {}

    def fetch(url):
        body, kind = pages[url]
        return SimpleNamespace(status_code=200, content=body,
                               headers={"Content-Type": kind})

    monkeypatch.setattr(datasheets, "_fetch", fetch)
    return pages


def test_a_local_datasheet_is_attached_to_the_part_and_manufacturer_part(
        config, server, tmp_path):
    (tmp_path / "ds").mkdir()
    _pdf(tmp_path / "ds" / "1N4007.pdf")
    document = _stock_file(tmp_path, {**DIODE, "manufacturer": "Diotec",
                                      "datasheet": "ds/1N4007.pdf"})
    result = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=True))
    assert result.lines[0].datasheet == "1N4007.pdf"
    assert _datasheets(server) == [("manufacturerpart", "1N4007.pdf"),
                                   ("part", "1N4007.pdf")]
    part = next(a for a in server.attachments if a["model_type"] == "part")
    assert part["model_id"] == result.lines[0].part
    assert part["contents"].startswith(b"%PDF-")


def test_a_data_book_attaches_the_device_pages_and_the_whole_book(
        config, server, tmp_path):
    from pypdf import PdfReader

    _pdf(tmp_path / "book.pdf", pages=12)
    document = _stock_file(tmp_path, {**DIODE, "manufacturer": "Diotec",
                                      "datasheet": "book.pdf",
                                      "datasheet_pages": "10-11"})
    result = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=True))
    assert result.lines[0].datasheet == "book_p10-11.pdf, book.pdf"
    attached = sorted((a["model_type"], a["filename"], a["comment"])
                      for a in server.attachments)
    assert attached == [
        ("manufacturerpart", "book.pdf", "Datasheet (full document)"),
        ("manufacturerpart", "book_p10-11.pdf", "Datasheet"),
        ("part", "book.pdf", "Datasheet (full document)"),
        ("part", "book_p10-11.pdf", "Datasheet"),
    ]

    def pages(name):
        row = next(a for a in server.attachments if a["filename"] == name)
        reader = PdfReader(io.BytesIO(row["contents"]))
        return [int(p.mediabox.width) - 100 for p in reader.pages]

    assert pages("book_p10-11.pdf") == [10, 11]
    assert pages("book.pdf") == list(range(1, 13))


def test_a_datasheet_url_is_only_linked_without_mirroring(config, server, web,
                                                         tmp_path):
    document = _stock_file(tmp_path, {**DIODE,
                                      "datasheet": "https://host/1N4007.pdf"})
    result = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=True))
    assert _datasheets(server) == []
    assert result.lines[0].datasheet_problem == ""
    part = next(p for p in server.part_rows
                if p["pk"] == result.lines[0].part)
    assert part["link"] == "https://host/1N4007.pdf"


def test_a_mirrored_datasheet_is_attached_and_still_linked(config, server,
                                                          web, tmp_path):
    from pypdf import PdfWriter

    buffer = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(buffer)
    web["https://host/1N4007.pdf"] = (buffer.getvalue(), "application/pdf")
    document = _stock_file(tmp_path, {**DIODE,
                                      "datasheet": "https://host/1N4007.pdf"})
    result = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=True,
                                                mirror_datasheets=True))
    assert _datasheets(server) == [("part", "1N4007.pdf")]
    part = next(p for p in server.part_rows
                if p["pk"] == result.lines[0].part)
    assert part["link"] == "https://host/1N4007.pdf"


def test_a_mirrored_link_that_is_not_a_pdf_is_reported_not_attached(
        config, server, web, tmp_path):
    web["https://host/viewer"] = (b"<html/>", "text/html")
    document = _stock_file(tmp_path, {**DIODE,
                                      "datasheet": "https://host/viewer"})
    result = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=True,
                                                mirror_datasheets=True))
    assert result.lines[0].action == CREATED
    assert result.lines[0].datasheet_problem == "not a PDF (text/html)"
    assert _datasheets(server) == []


def test_a_dry_run_names_the_datasheet_and_attaches_nothing(config, server,
                                                           tmp_path):
    _pdf(tmp_path / "1N4007.pdf")
    document = _stock_file(tmp_path, {**DIODE, "datasheet": "1N4007.pdf"})
    result = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=False))
    assert result.lines[0].datasheet == "1N4007.pdf"
    assert server.attachments == []


def test_a_missing_local_datasheet_does_not_stop_the_line(config, server,
                                                         tmp_path):
    document = _stock_file(tmp_path, {**DIODE, "datasheet": "gone.pdf"})
    result = import_stock(document, connect(), directory=config,
                          options=ImportOptions(write=True))
    assert result.lines[0].action == CREATED
    assert result.lines[0].datasheet_problem == "gone.pdf: not a file"


def test_a_datasheet_added_later_reaches_a_line_already_imported(
        config, server, tmp_path):
    """The stock is not doubled, but the part still gets its datasheet."""
    line = {**DIODE, "manufacturer": "Diotec"}
    first = import_stock(_stock_file(tmp_path, line), connect(),
                         directory=config, options=ImportOptions(write=True))
    assert _datasheets(server) == []

    _pdf(tmp_path / "1N4007.pdf")
    again = import_stock(
        _stock_file(tmp_path, {**line, "datasheet": "1N4007.pdf"}), connect(),
        directory=config, options=ImportOptions(write=True))
    assert again.lines[0].action == EXISTS
    assert len(server.stock_items) == 1
    assert _datasheets(server) == [("manufacturerpart", "1N4007.pdf"),
                                   ("part", "1N4007.pdf")]
    part = next(a for a in server.attachments if a["model_type"] == "part")
    assert part["model_id"] == first.lines[0].part


def test_lines_sharing_a_part_attach_its_datasheet_once(config, server,
                                                       tmp_path):
    _pdf(tmp_path / "1N4007.pdf")
    line = {**DIODE, "datasheet": "1N4007.pdf"}
    import_stock(_stock_file(tmp_path, line, line), connect(),
                 directory=config, options=ImportOptions(write=True))
    assert _datasheets(server) == [("part", "1N4007.pdf")]


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
                             "batch": "8231", "packaging": "Tube, sealed",
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


def test_packaging_reaches_the_stock_item(config, server):
    run(config, {**RESISTOR, "packaging": "Cut Tape"})
    assert server.stock_items[0]["packaging"] == "Cut Tape"


def test_stock_without_packaging_does_not_send_it(config, server):
    run(config, RESISTOR)
    assert "packaging" not in server.stock_items[0]


# --------------------------------------------------------------------------
# Everything else an order can say
# --------------------------------------------------------------------------
ORDER = {"supplier": "Rockby Electronics", "sku": "R-1"}


def test_every_order_field_reaches_the_purchase_order(config, server):
    run(config, {**RESISTOR, **ORDER, "currency": "AUD", "order": {
        "reference": "INV-88213",
        "date": "2026-03-14",
        "target_date": "2026-03-28",
        "description": "March restock",
        "link": "https://rockby.example/invoice/88213",
        "notes": "paid on collection",
        "tags": ["surplus", "counter sale"],
    }})

    order = server.purchase_orders[0]
    assert order["supplier_reference"] == "INV-88213"
    assert order["target_date"] == "2026-03-28"
    assert order["description"] == "March restock"
    assert order["link"] == "https://rockby.example/invoice/88213"
    assert order["notes"] == "paid on collection"
    assert order["tags"] == ["surplus", "counter sale"]
    assert order["order_currency"] == "AUD"


def test_the_purchase_date_is_sent_as_start_date(config, server):
    """
    InvenTree's creation_date is read-only - it records when the row was
    written - so sending the purchase date there went nowhere at all. The
    order's start_date is writable and is the closest thing the model has.
    """
    run(config, {**RESISTOR, **ORDER,
                 "order": {"reference": "INV-1", "date": "2026-03-14"}})

    order = server.purchase_orders[0]
    assert order["start_date"] == "2026-03-14"
    assert "creation_date" not in order


def test_an_order_description_defaults_to_the_reference(config, server):
    run(config, {**RESISTOR, **ORDER, "order": {"reference": "INV-2"}})
    assert server.purchase_orders[0]["description"] == "Imported order INV-2"


# --------------------------------------------------------------------------
# The invoice scan
# --------------------------------------------------------------------------
def _with_invoice(tmp_path, *lines, name="inv-88213.pdf"):
    """A document that has a path, so a relative invoice resolves."""
    scan = tmp_path / name
    scan.write_bytes(b"%PDF-1.4 pretend scan")
    return parse_document(
        {"source": {"reference": "invoice.pdf"},
         "lines": [{"id": str(i + 1), "quantity": 1, **line}
                   for i, line in enumerate(lines)]},
        path=tmp_path / "stock.json")


def test_the_invoice_is_attached_to_the_order(config, server, tmp_path):
    document = _with_invoice(tmp_path, {
        **RESISTOR, **ORDER,
        "order": {"reference": "INV-88213", "invoice": "inv-88213.pdf"}})
    import_stock(document, connect(), directory=config,
                 options=ImportOptions(write=True))

    assert len(server.attachments) == 1
    attached = server.attachments[0]
    assert attached["model_type"] == "purchaseorder"
    assert attached["model_id"] == server.purchase_orders[0]["pk"]
    assert attached["filename"] == "inv-88213.pdf"
    assert attached["contents"] == b"%PDF-1.4 pretend scan"
    assert "INV-88213" in attached["comment"]


def test_lines_sharing_an_order_attach_the_invoice_once(config, server,
                                                        tmp_path):
    order = {"reference": "INV-88213", "invoice": "inv-88213.pdf"}
    document = _with_invoice(
        tmp_path,
        {**RESISTOR, **ORDER, "order": dict(order)},
        {**DIODE, "supplier": "Rockby Electronics", "sku": "R-2",
         "order": dict(order)})
    import_stock(document, connect(), directory=config,
                 options=ImportOptions(write=True))

    assert len(server.purchase_orders) == 1
    assert len(server.attachments) == 1


def test_re_importing_does_not_attach_the_invoice_twice(config, server,
                                                        tmp_path):
    """The order already carries that scan; a second copy is not a record of
    anything that happened."""
    def once():
        document = _with_invoice(tmp_path, {
            **RESISTOR, **ORDER,
            "order": {"reference": "INV-88213", "invoice": "inv-88213.pdf"}})
        import_stock(document, connect(), directory=config,
                     options=ImportOptions(write=True))

    once()
    once()
    assert len(server.attachments) == 1


def test_an_invoice_that_is_not_there_does_not_stop_the_import(config, server,
                                                               tmp_path):
    """The stock is the point; a missing scan warns and the import goes on."""
    document = parse_document(
        {"lines": [{"id": "1", "quantity": 3, **RESISTOR, **ORDER,
                    "order": {"reference": "INV-9",
                              "invoice": "not-there.pdf"}}]},
        path=tmp_path / "stock.json")
    import_stock(document, connect(), directory=config,
                 options=ImportOptions(write=True))

    assert server.attachments == []
    assert len(server.stock_items) == 1
    assert len(server.purchase_orders) == 1
