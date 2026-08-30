"""Creating stock, and making a second import of the same line impossible."""

from __future__ import annotations

import pytest

from invimport.inventree.api import connect
from invimport.inventree.stock import (
    CONDITION_STATUS,
    STATUS_ATTENTION,
    STATUS_OK,
    STATUS_QUARANTINED,
    BarcodeInUse,
    add_stock,
    already_imported,
    link_barcode,
    resolve_location,
    stock_note,
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
