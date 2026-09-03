"""Creating stock, and making a second import of the same line impossible."""

from __future__ import annotations

import pytest

from invimport.inventree.api import connect
from invimport.inventree.stock import (
    CONDITION_STATUS,
    STATUS_ATTENTION,
    STATUS_OK,
    STATUS_QUARANTINED,
    BarcodeHit,
    BarcodeInUse,
    add_stock,
    already_imported,
    barcode_hit,
    hit_sections,
    hit_rows,
    link_barcode,
    lookup_barcode,
    resolve_location,
    stock_note,
    web_url,
)

KEY = "invimport:notes-2026-08-29.jpg:l01"


# --------------------------------------------------------------------------
# Idempotence
# --------------------------------------------------------------------------
def test_an_unknown_key_has_not_been_imported(inventree):
    assert already_imported(connect(), KEY) is None


def test_a_created_line_is_recognised_next_time(inventree):
    api = connect()
    item = add_stock(api, part=4, quantity=25, location=1, key=KEY)
    assert already_imported(api, KEY) == item.pk


def test_the_server_refuses_a_second_import_of_the_same_line(inventree):
    """
    The guard is InvenTree's, not ours.

    Barcode assignment is unique server-side, so importing a line twice is
    refused by the database rather than merely checked for here. Any bug in
    the calling code still cannot double the stock.
    """
    api = connect()
    add_stock(api, part=4, quantity=25, location=1, key=KEY)

    with pytest.raises(BarcodeInUse):
        add_stock(api, part=4, quantity=25, location=1, key=KEY)


def test_a_refused_import_leaves_no_stock_behind(inventree):
    """
    Otherwise the refusal creates exactly what it was meant to prevent.

    The item is made before the barcode can be attached, so a refused link
    has to take the item with it - or the next run finds no barcode, creates
    another, and the pile grows every time.
    """
    api = connect()
    add_stock(api, part=4, quantity=25, location=1, key=KEY)
    before = len(inventree.stock_items)

    with pytest.raises(BarcodeInUse):
        add_stock(api, part=4, quantity=9, location=1, key=KEY)

    assert len(inventree.stock_items) == before


def test_stock_without_a_key_is_still_created(inventree):
    """Not every caller has a line id; the DigiKey path receives instead."""
    api = connect()
    item = add_stock(api, part=4, quantity=5, location=1)
    assert item.pk
    assert inventree.barcodes == {}


def test_two_different_lines_do_not_collide(inventree):
    api = connect()
    first = add_stock(api, part=4, quantity=1, location=1, key=f"{KEY}a")
    second = add_stock(api, part=4, quantity=1, location=1, key=f"{KEY}b")
    assert first.pk != second.pk


def test_stock_created_from_a_list_response_still_carries_its_barcode(inventree):
    """
    /api/stock/ answers a create with a list, not the item it made.

    Taken at face value that list reaches the model constructor and raises
    AttributeError - but only after the server has already written the row.
    The item exists, nothing names it, and the barcode that makes a re-import
    a no-op was never attached, so the next run creates the quantity again.
    A create has to survive the real response shape to keep that promise.
    """
    api = connect()
    item = add_stock(api, part=4, quantity=25, location=1, key=KEY)

    assert item.pk == inventree.stock_items[-1]["pk"]
    assert already_imported(api, KEY) == item.pk


# --------------------------------------------------------------------------
# Conditions
# --------------------------------------------------------------------------
def test_unopened_stock_still_counts_as_available(inventree):
    """
    Bound to ATTENTION, not QUARANTINED.

    QUARANTINED is excluded from InvenTree's AVAILABLE_CODES, so a sealed bag
    of 100 would report as 0 available. The marker is meant to say "not
    verified", not "do not plan around this".
    """
    api = connect()
    add_stock(api, part=4, quantity=100, location=1, condition="unopened")
    assert inventree.stock_items[-1]["status"] == STATUS_ATTENTION
    assert CONDITION_STATUS["unopened"] != STATUS_QUARANTINED


@pytest.mark.parametrize("condition,status", [
    ("ok", STATUS_OK),
    ("attention", STATUS_ATTENTION),
    ("quarantined", STATUS_QUARANTINED),
])
def test_each_condition_maps_to_its_status(inventree, condition, status):
    api = connect()
    add_stock(api, part=4, quantity=1, location=1, condition=condition)
    assert inventree.stock_items[-1]["status"] == status


def test_an_unknown_condition_falls_back_to_ok(inventree):
    """Validation rejects these earlier; this is the belt to that's braces."""
    api = connect()
    add_stock(api, part=4, quantity=1, location=1, condition="sealed")
    assert inventree.stock_items[-1]["status"] == STATUS_OK


# --------------------------------------------------------------------------
# Locations
# --------------------------------------------------------------------------
def test_an_existing_location_is_found(inventree):
    inventree.add_location("Workshop", pk=5)
    assert resolve_location(connect(), "Workshop", write=False).pk == 5


def test_a_nested_path_is_created_with_its_parents(inventree):
    """A location is a shelf, not a taxonomy decision - it may be made."""
    api = connect()
    location = resolve_location(api, "Workshop/Drawer A/Bin 3", write=True)

    assert location.pathstring == "Workshop/Drawer A/Bin 3"
    made = [loc["pathstring"] for loc in inventree.locations]
    assert "Workshop" in made and "Workshop/Drawer A" in made


def test_an_existing_parent_is_reused_not_duplicated(inventree):
    api = connect()
    inventree.add_location("Workshop", pk=5)

    resolve_location(api, "Workshop/Drawer A", write=True)

    assert len([loc for loc in inventree.locations
                if loc["name"] == "Workshop"]) == 1


def test_a_dry_run_creates_no_locations(inventree):
    api = connect()
    before = len(inventree.locations)
    assert resolve_location(api, "Workshop/Drawer A", write=False) is None
    assert len(inventree.locations) == before


def test_matching_a_location_ignores_case(inventree):
    inventree.add_location("Workshop", pk=5)
    assert resolve_location(connect(), "workshop", write=False).pk == 5


def test_no_location_named_means_none(inventree):
    assert resolve_location(connect(), "", write=True) is None


def test_create_may_be_refused(inventree):
    api = connect()
    assert resolve_location(api, "Nowhere", write=True, create=False) is None


# --------------------------------------------------------------------------
# Notes
# --------------------------------------------------------------------------
def test_a_note_joins_only_what_was_said():
    assert stock_note("sold by salash", "", None, "approximate") == (
        "sold by salash\napproximate")
    assert stock_note("", "   ") == ""


# --------------------------------------------------------------------------
# Barcode lookup (part / stock item / location)
# --------------------------------------------------------------------------
def test_lookup_returns_a_stock_item(inventree):
    inventree.barcodes["S-1"] = {
        "stockitem": {"pk": 9, "quantity": 25, "part": 4}}
    hit = lookup_barcode(connect(), "S-1")
    assert hit is not None
    assert hit.kind == "stockitem"
    assert hit.pk == 9
    assert hit.payload["quantity"] == 25


def test_lookup_returns_a_part(inventree):
    inventree.add_part("NE555P", ipn="NE555P", pk=4, description="timer")
    inventree.barcodes["P-4"] = {"part": {"pk": 4}}
    hit = lookup_barcode(connect(), "P-4")
    assert hit is not None
    assert hit.kind == "part"
    assert hit.pk == 4
    assert hit.payload.get("name") == "NE555P"


def test_lookup_returns_a_location(inventree):
    inventree.barcodes["LOC-1"] = {
        "stocklocation": {"pk": 1, "name": "Stock", "pathstring": "Stock"}}
    hit = lookup_barcode(connect(), "LOC-1")
    assert hit is not None
    assert hit.kind == "stocklocation"
    assert hit.pk == 1
    assert hit.title == "Stock"


def test_lookup_unknown_is_none(inventree):
    assert lookup_barcode(connect(), "nope") is None


def test_lookup_accepts_a_bare_pk(inventree):
    inventree.barcodes["S-int"] = {"stockitem": 12}
    hit = lookup_barcode(connect(), "S-int")
    assert hit is not None
    assert hit.kind == "stockitem"
    assert hit.pk == 12


def test_web_url_points_at_the_pui():
    assert web_url("http://inv.example/", "part", 4) == (
        "http://inv.example/web/part/4/")
    assert web_url("http://inv.example", "stockitem", 9) == (
        "http://inv.example/web/stock/item/9/")
    assert web_url("http://inv.example", "stocklocation", 1) == (
        "http://inv.example/web/stock/location/1/")
    assert web_url(None, "part", 4) is None


def test_barcode_hit_picks_stock_before_part():
    hit = barcode_hit({"stockitem": {"pk": 3}, "part": {"pk": 4}})
    assert hit is not None
    assert hit.kind == "stockitem"
    assert hit.pk == 3


def test_hit_rows_list_part_fields():
    hit = BarcodeHit(
        kind="part", pk=4,
        payload={"pk": 4, "IPN": "NE555P", "name": "NE555P",
                 "description": "timer", "total_in_stock": 12})
    rows = dict(hit_rows(hit))
    assert rows["IPN"] == "NE555P"
    assert rows["In stock"] == "12"


def test_stock_counts_display_as_integers():
    hit = BarcodeHit(
        kind="stockitem", pk=9,
        payload={"pk": 9, "quantity": 25.0,
                 "part_detail": {
                     "name": "NE555P",
                     "total_in_stock": 12.0,
                     "unallocated_stock": 10.0,
                     "minimum_stock": 0.0}})
    rows = dict(hit_rows(hit))
    assert rows["Quantity"] == "25"
    assert rows["In stock"] == "12"
    assert rows["Available"] == "10"
    assert rows["Minimum"] == "0"


def test_lookup_includes_part_parameters(inventree):
    inventree.add_part("NE555P", ipn="NE555P", pk=4, description="timer")
    inventree.templates.append({"pk": 21, "name": "Supply Voltage", "units": "V"})
    inventree.templates.append({"pk": 22, "name": "Package", "units": ""})
    inventree.add_parameter(4, 21, "4.5 V ~ 16 V")
    inventree.add_parameter(4, 22, "DIP-8")
    inventree.barcodes["P-4"] = {"part": {"pk": 4}}
    hit = lookup_barcode(connect(), "P-4")
    assert hit is not None
    names = {row["name"]: row["value"] for row in hit.payload["parameters"]}
    assert names["Supply Voltage"] == "4.5 V ~ 16 V"
    assert names["Package"] == "DIP-8"


def test_lookup_stock_embeds_the_part_and_its_parameters(inventree):
    inventree.add_part("NE555P", ipn="NE555P", pk=4, description="timer")
    inventree.templates.append({"pk": 21, "name": "Package", "units": ""})
    inventree.add_parameter(4, 21, "DIP-8")
    inventree.stock_items.append({"pk": 9, "quantity": 25, "part": 4,
                                  "location": 1})
    inventree.barcodes["S-9"] = {"stockitem": {"pk": 9}}
    hit = lookup_barcode(connect(), "S-9")
    assert hit is not None
    part = hit.payload["part_detail"]
    assert part["name"] == "NE555P"
    assert part["parameters"][0]["value"] == "DIP-8"
    assert hit.payload["location_detail"]["pathstring"] == "Stock"
    sections = hit_sections(hit)
    assert [s.title for s in sections] == ["Stock item", "Part"]
    assert sections[1].children[0].title == "Parameters"
    assert ("Package", "DIP-8") in sections[1].children[0].rows


def test_stock_hit_nests_part_details_in_a_subpanel():
    hit = BarcodeHit(
        kind="stockitem", pk=9,
        payload={"pk": 9, "quantity": 25,
                 "part_detail": {
                     "pk": 4, "name": "NE555P", "IPN": "NE555P",
                     "description": "timer",
                     "parameters": [{"name": "Package", "value": "DIP-8"}]},
                 "location_detail": {"pathstring": "Workshop/Bins"}})
    sections = hit_sections(hit)
    assert sections[0].title == "Stock item"
    assert ("Quantity", "25") in sections[0].rows
    assert ("Location", "Workshop/Bins") in sections[0].rows
    part = sections[1]
    assert part.title == "Part"
    assert ("IPN", "NE555P") in part.rows
    assert part.children[0].title == "Parameters"
    assert ("Package", "DIP-8") in part.children[0].rows


def test_render_hit_draws_nested_part_and_parameter_panels():
    from rich.console import Console

    from invimport.inventree.stock import render_hit

    hit = BarcodeHit(
        kind="stockitem", pk=9,
        payload={"pk": 9, "quantity": 25,
                 "part_detail": {
                     "pk": 4, "name": "NE555P", "IPN": "NE555P",
                     "parameters": [{"name": "Package", "value": "DIP-8"}]},
                 "location_detail": {"pathstring": "Workshop/Bins"}})
    console = Console(width=80, force_terminal=False, color_system=None)
    with console.capture() as cap:
        console.print(render_hit(hit))
    text = cap.get()
    assert "Stock item" in text
    assert "Part" in text
    assert "Parameters" in text
    assert "NE555P" in text
    assert "DIP-8" in text
    assert "Workshop/Bins" in text


def test_lookup_part_lists_its_stock(inventree):
    inventree.add_part("NE555P", ipn="NE555P", pk=4)
    inventree.stock_items.append(
        {"pk": 9, "quantity": 25.0, "part": 4, "location": 1})
    inventree.stock_items.append(
        {"pk": 10, "quantity": 5, "part": 4, "location": 1, "serial": "A1"})
    inventree.stock_items.append(
        {"pk": 11, "quantity": 3, "part": 7, "location": 1})
    inventree.barcodes["P-4"] = {"part": {"pk": 4}}
    hit = lookup_barcode(connect(), "P-4")
    assert hit is not None
    assert [item["pk"] for item in hit.payload["stock_items"]] == [9, 10]
    assert hit.payload["stock_items"][0]["location_detail"]["pathstring"] == "Stock"
    section = next(s for s in hit_sections(hit) if s.title == "Stock (2)")
    assert section.rows[0][0] == "25"
    assert "Stock" in section.rows[0][1]
    assert "SN A1" in section.rows[1][1]


def test_lookup_location_lists_children_and_stock(inventree):
    inventree.add_location("Bins", pk=2, parent=1)
    inventree.add_part("NE555P", ipn="NE555P", pk=4)
    inventree.stock_items.append(
        {"pk": 9, "quantity": 25.0, "part": 4, "location": 1})
    inventree.stock_items.append(
        {"pk": 10, "quantity": 3, "part": 4, "location": 2})
    inventree.barcodes["LOC-1"] = {
        "stocklocation": {"pk": 1, "name": "Stock", "pathstring": "Stock"}}
    hit = lookup_barcode(connect(), "LOC-1")
    assert hit is not None
    assert [child["pk"] for child in hit.payload["children"]] == [2]
    assert [item["pk"] for item in hit.payload["stock_items"]] == [9]
    assert hit.payload["stock_items"][0]["part_detail"]["IPN"] == "NE555P"
    titles = [section.title for section in hit_sections(hit)]
    assert "Locations (1)" in titles
    assert "Stock (1)" in titles
    stock = next(s for s in hit_sections(hit) if s.title == "Stock (1)")
    assert stock.rows[0][0] == "25 × NE555P"


def test_location_ref_reads_pk_and_path():
    from invimport.inventree.stock import location_ref

    assert location_ref({
        "location": 2,
        "location_detail": {"pk": 2, "pathstring": "Workshop/Bins"},
    }) == (2, "Workshop/Bins", {"pk": 2, "pathstring": "Workshop/Bins"})
    assert location_ref({"quantity": 25}) is None


def test_fetch_stock_unwraps_a_paginated_response():
    from invimport.inventree.stock import fetch_stock_items

    class Pages:
        def get(self, url, params=None):
            return {"count": 1, "next": None, "previous": None,
                    "results": [{"pk": 9, "quantity": 25.0, "part": 4,
                                 "location": 1}]}

    items = fetch_stock_items(Pages(), location=1)
    assert len(items) == 1
    assert items[0]["pk"] == 9
