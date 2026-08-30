"""Resolving a supplier spelling onto a Company."""

from __future__ import annotations

import pytest

from invimport.config import SupplierConfig, load_suppliers_config
from invimport.inventree.api import connect
from invimport.inventree.purchase_orders import (
    create_supplier,
    resolve_supplier,
    split_marketplace,
)

SUPPLIERS = {
    "eBay": SupplierConfig("eBay", aliases=["ebay"]),
    "Rockby Electronics": SupplierConfig("Rockby Electronics",
                                         aliases=["Rockby"]),
}


# --------------------------------------------------------------------------
# Marketplace sellers
# --------------------------------------------------------------------------
@pytest.mark.parametrize("name,supplier,seller", [
    ("salash (eBay)", "eBay", "salash"),
    ("33audiomarko (eBay)", "eBay", "33audiomarko"),
    ("privet_dnpr (eBay)", "eBay", "privet_dnpr"),
    ("  y-0009  ( ebay ) ", "eBay", "y-0009"),
])
def test_a_marketplace_seller_resolves_to_one_company(name, supplier, seller):
    """
    Eight one-off eBay sellers would be eight companies you never use again.

    The seller is a fact about the purchase, not a distributor you have a
    relationship with, so it is returned separately for the stock note.
    """
    assert split_marketplace(name, SUPPLIERS) == (supplier, seller)


@pytest.mark.parametrize("name", [
    "Rockby Electronics",
    "Voltage - Forward (Max)",             # brackets that are not a marketplace
    "Some Seller (Tindie)",                # a marketplace we do not know
    "",
])
def test_a_name_that_is_not_a_marketplace_is_left_alone(name):
    assert split_marketplace(name, SUPPLIERS) == (name, "")


def test_marketplaces_come_from_config_not_from_code():
    """Adding Tindie should be a config change, not a code change."""
    with_tindie = {**SUPPLIERS, "Tindie": SupplierConfig("Tindie")}
    assert split_marketplace("Some Seller (Tindie)", with_tindie) == (
        "Tindie", "Some Seller")


# --------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------
def test_an_exact_name_matches(inventree):
    inventree.add_company("Rockby Electronics", pk=7, is_supplier=True)
    company = resolve_supplier(connect(), "Rockby Electronics", SUPPLIERS)
    assert company.pk == 7


@pytest.mark.parametrize("spelling", [
    "Rockby Electronics Pty Ltd",
    "ROCKBY ELECTRONICS",
    "Rockby",                          # 'electronics' is a dropped suffix
    "Rockby, Electronics.",
])
def test_normalisation_matches_before_any_alias_is_needed(inventree, spelling):
    """
    Case, punctuation and corporate suffixes are stripped before comparing.

    'electronics' is on the suffix list alongside Pty and Ltd, so all of these
    normalise to 'rockby' and match without anyone being asked.
    """
    inventree.add_company("Rockby Electronics", pk=7, is_supplier=True)
    assert resolve_supplier(connect(), spelling, SUPPLIERS).pk == 7


def test_a_configured_alias_matches(inventree):
    inventree.add_company("Rockby Electronics", pk=7, is_supplier=True)
    assert resolve_supplier(connect(), "Rockby", SUPPLIERS).pk == 7


def test_an_ebay_seller_resolves_to_the_ebay_company(inventree):
    inventree.add_company("eBay", pk=8, is_supplier=True)
    assert resolve_supplier(connect(), "salash (eBay)", SUPPLIERS).pk == 8


def test_an_unknown_supplier_is_not_created_silently(inventree):
    """Nothing is invented; the caller must ask for it."""
    assert resolve_supplier(connect(), "Tayda Electronics", SUPPLIERS) is None
    assert inventree.companies == []


def test_create_makes_the_company_when_asked(inventree):
    company = resolve_supplier(connect(), "Tayda Electronics", SUPPLIERS,
                               create=True, write=True)
    assert company.name == "Tayda Electronics"
    assert inventree.companies[0]["is_supplier"] is True


def test_a_dry_run_creates_nothing(inventree):
    company = resolve_supplier(connect(), "Tayda Electronics", SUPPLIERS,
                               create=True, write=False)
    assert company.pk == -1
    assert inventree.companies == []


def test_a_chooser_may_pick_an_existing_company(inventree):
    inventree.add_company("Rockby Electronics", pk=7, is_supplier=True)
    seen = {}

    def choose(name, offered):
        seen["name"] = name
        seen["offered"] = [c.name for c, _ in offered]
        return offered[0][0]

    company = resolve_supplier(connect(), "Rokby Electronics", SUPPLIERS,
                               choose=choose)
    assert company.pk == 7
    assert seen["offered"] == ["Rockby Electronics"]


def test_a_chooser_may_name_a_new_company(inventree):
    company = resolve_supplier(connect(), "Tyda", SUPPLIERS,
                               choose=lambda name, offered: "Tayda Electronics",
                               write=True)
    assert company.name == "Tayda Electronics"


def test_a_decision_is_remembered_for_the_run(inventree):
    """The same spelling must not be asked about twice in one import."""
    inventree.add_company("Rockby Electronics", pk=7, is_supplier=True)
    cache: dict = {}
    asked = []

    def choose(name, offered):
        asked.append(name)
        return offered[0][0] if offered else None

    for _ in range(3):
        resolve_supplier(connect(), "Rokby Electronics", SUPPLIERS,
                         choose=choose, cache=cache)
    assert len(asked) == 1


# --------------------------------------------------------------------------
# Creating one
# --------------------------------------------------------------------------
def test_a_new_supplier_gets_no_invented_website(inventree):
    """Stamping digikey.com onto Rockby would be a fact nobody stated."""
    create_supplier(connect(), "Rockby Electronics")
    assert "website" not in inventree.companies[0]


def test_digikey_still_gets_its_website(inventree):
    create_supplier(connect(), "DigiKey")
    assert inventree.companies[0]["website"] == "https://www.digikey.com"


def test_the_repo_config_maps_ebay(tmp_path):
    """The shipped suppliers.yaml should already handle the common case."""
    suppliers = load_suppliers_config()
    assert "eBay" in suppliers
    assert split_marketplace("salash (eBay)", suppliers)[0] == "eBay"
