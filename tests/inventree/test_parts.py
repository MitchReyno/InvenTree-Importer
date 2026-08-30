"""Find-or-create Part, ManufacturerPart and SupplierPart from SKUs."""

from __future__ import annotations

import pytest

from invimport.config import (
    CategoryConfig,
    ParameterConfig,
)
from invimport.inventree.api import connect
from invimport.inventree.parts import (
    UNRESOLVED_PK,
    ImportContext,
    PartLine,
    PartPolicy,
    fill_name,
    import_supplier_parts,
    ipn_prefix,
    next_ipn,
    resolve_part,
)
from invimport.inventree.parts import find_part_by_type, part_name
from invimport.inventree.values import compact_for_name


def config_dir(tmp_path, categories: str,
               parameters: str = "Package:\n  aliases: [Package / Case]\n"):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text(parameters)
    (tmp_path / "categories.yaml").write_text(categories)
    (tmp_path / "manufacturers.yaml").write_text("")
    return tmp_path


IC = """
Integrated Circuits:
  ipn_prefix: IC
  identity: mpn
  parameters: [Package]
  Timers:
    aliases:
      - Integrated Circuits (ICs) / Clock/Timing
"""

# Enough of parameters.yaml for a resistor's whole identity. The default in
# config_dir() defines only Package, which makes every resistor a *partial*
# spec - a different code path.
RESISTOR_PARAMETERS = (
    "Resistance:\n  units: ohm\n  aliases: [Resistance]\n  parse: quantity\n"
    "Tolerance:\n  units: '%'\n  aliases: [Tolerance]\n  parse: percent\n"
    "Package:\n  aliases: [Package / Case]\n")

RESISTORS = """
Resistors:
  ipn_prefix: RES
  identity: spec
  key_parameters: [Resistance, Tolerance, Package]
  name: "Resistor {Resistance} {Tolerance}% {Package}"
  parameters: [Resistance, Tolerance, Package]
  aliases:
    - Resistors / Through Hole Resistors
"""

IC_PRODUCT = {
    "SKU": "296-1411-1-ND",
    "manufacturer_part": "NE555P",
    "manufacturer_name": "Texas Instruments",
    "description": "IC OSC SINGLE TIMER",
    "category_path": ["Integrated Circuits (ICs)", "Clock/Timing"],
    "parameters": {"Package / Case": "8-DIP", "Mounting Type": "Through Hole"},
    "packaging": "Cut Tape",
    "standard_package": 2500,
    "link": "https://www.digikey.com/x",
    "datasheet": "https://example.com/ds.pdf",
}

RESISTOR_PRODUCT = {
    "SKU": "13-MFR-ND",
    "manufacturer_part": "MFR25SFBE52-100K",
    "manufacturer_name": "YAGEO",
    "description": "RES 100K OHM 1% 1/4W AXIAL",
    "category_path": ["Resistors", "Through Hole Resistors"],
    "parameters": {
        "Resistance": "100 kOhms",
        "Tolerance": "±1%",
        "Package / Case": "Axial",
    },
    "packaging": "Bag",
    "standard_package": 5000,
}


def seed_ic(inventree):
    parent = inventree.add_category("Integrated Circuits", pk=10, structural=True)
    inventree.add_category("Timers", parent=parent["pk"], pk=11)
    inventree.templates.append({"pk": 20, "name": "Package", "units": ""})
    inventree.add_company("DigiKey", pk=1, is_supplier=True)


def seed_resistors(inventree):
    inventree.add_category("Resistors", pk=12)
    inventree.templates.append({"pk": 21, "name": "Resistance", "units": "ohm"})
    inventree.templates.append({"pk": 22, "name": "Tolerance", "units": "%"})
    inventree.templates.append({"pk": 23, "name": "Package", "units": ""})
    inventree.add_company("DigiKey", pk=1, is_supplier=True)


def context(api, directory):
    """The lookups resolve_part() needs, assembled as the importer does."""
    from invimport.config import (
        load_categories_config,
        load_manufacturers_config,
        load_parameters_config,
    )
    from invimport.inventree.api import PartCategory, ParameterTemplate

    return ImportContext(
        categories=load_categories_config(directory),
        parameters=load_parameters_config(directory),
        manufacturers=load_manufacturers_config(directory),
        server_categories={c.pathstring: c
                           for c in PartCategory.list(api, limit=1000)
                           if getattr(c, "pathstring", None)},
        templates={t.name: t for t in ParameterTemplate.list(api, limit=1000)},
    )


# --------------------------------------------------------------------------
# The supplier-agnostic core
#
# import_sku() is one caller of this; the file importer will be another. These
# cover the seam itself - what the core does when a caller relaxes what the
# DigiKey path insists on.
# --------------------------------------------------------------------------
def test_part_line_reads_a_normalised_product():
    line = PartLine.from_product(IC_PRODUCT)
    assert line.mpn == "NE555P"
    assert line.manufacturer == "Texas Instruments"
    assert line.category_path == ["Integrated Circuits (ICs)", "Clock/Timing"]
    assert line.parameters["Package / Case"] == "8-DIP"


def test_a_line_with_no_mpn_is_refused_by_default(inventree, tmp_path):
    """The DigiKey path's contract: a payload without an MPN is unreadable."""
    seed_resistors(inventree)
    api = connect()
    line = PartLine.from_product({**RESISTOR_PRODUCT, "manufacturer_part": ""})
    directory = config_dir(tmp_path, RESISTORS, RESISTOR_PARAMETERS)

    resolved = resolve_part(api, line, context(api, directory), write=False)

    assert not resolved.ok
    assert "manufacturer part number" in resolved.reason


def test_a_relaxed_policy_creates_a_part_with_no_manufacturer_part(
        inventree, tmp_path):
    """
    Half of real stock has no MPN and no manufacturer. Under `spec` identity
    the key parameters are the identity, so such a part is fully specified -
    and it gets no ManufacturerPart rather than a placeholder one.
    """
    seed_resistors(inventree)
    api = connect()
    line = PartLine.from_product({**RESISTOR_PRODUCT, "manufacturer_part": "",
                                  "manufacturer_name": ""})

    resolved = resolve_part(
        api, line, context(api, config_dir(tmp_path, RESISTORS,
                                           RESISTOR_PARAMETERS)), write=True,
        policy=PartPolicy(require_mpn=False, require_manufacturer=False))

    assert resolved.ok, resolved.reason
    assert resolved.ipn == "RES-00001"
    assert resolved.manufacturer_part is None
    assert inventree.manufacturer_parts == []
    assert inventree.part_rows[-1]["IPN"] == "RES-00001"


def test_a_relaxed_policy_still_uses_a_manufacturer_when_there_is_one(
        inventree, tmp_path):
    """Relaxing the requirement must not mean ignoring the data."""
    seed_resistors(inventree)
    api = connect()

    resolved = resolve_part(
        api, PartLine.from_product(RESISTOR_PRODUCT),
        context(api, config_dir(tmp_path, RESISTORS, RESISTOR_PARAMETERS)),
        write=True,
        policy=PartPolicy(require_mpn=False, require_manufacturer=False,
                          create_manufacturers=True))

    assert resolved.manufacturer_part is not None
    assert inventree.manufacturer_parts[0]["MPN"] == "MFR25SFBE52-100K"


def test_a_relaxed_policy_reports_an_unmapped_category(inventree, tmp_path):
    seed_resistors(inventree)
    api = connect()
    line = PartLine(category_path=["Nowhere", "At All"])

    resolved = resolve_part(
        api, line, context(api, config_dir(tmp_path, RESISTORS,
                                           RESISTOR_PARAMETERS)), write=False,
        policy=PartPolicy(require_mpn=False, require_manufacturer=False))

    assert not resolved.ok
    assert "unmapped category" in resolved.reason


# --------------------------------------------------------------------------
# identity: type - a designator names the part, whoever made it
# --------------------------------------------------------------------------
TYPED = """
Diodes:
  ipn_prefix: DIOD
  identity: type
  parameters: [Package]
  Signal Diodes:
    aliases:
      - Discrete Semiconductor Products / Diodes / Rectifiers / Single Diodes
"""


def seed_diodes(inventree):
    parent = inventree.add_category("Diodes", pk=40, structural=True)
    inventree.add_category("Signal Diodes", parent=parent["pk"], pk=41)
    inventree.templates.append({"pk": 24, "name": "Package", "units": ""})
    inventree.add_company("DigiKey", pk=1, is_supplier=True)


DIODE = {
    "category_path": ["Discrete Semiconductor Products", "Diodes",
                      "Rectifiers", "Single Diodes"],
    "parameters": {"Package / Case": "DO-41"},
    "description": "DIODE STANDARD 1000V 1A DO-41",
}


def typed_line(**overrides):
    line = PartLine.from_product({**DIODE, "manufacturer_part": "",
                                  "manufacturer_name": ""})
    for key, value in overrides.items():
        setattr(line, key, value)
    return line


RELAXED = PartPolicy(require_mpn=False, require_manufacturer=False)


def parts_in(inventree, category_pk):
    """The stub is seeded with unrelated parts, so count only ours."""
    return [p for p in inventree.part_rows if p.get("category") == category_pk]


def test_a_type_designator_creates_a_part_named_after_it(inventree, tmp_path):
    seed_diodes(inventree)
    api = connect()
    directory = config_dir(tmp_path, TYPED)

    resolved = resolve_part(api, typed_line(type="1N4007"),
                            context(api, directory), write=True, policy=RELAXED)

    assert resolved.ok, resolved.reason
    assert resolved.name == "1N4007"
    assert resolved.ipn == "DIOD-00001"
    assert resolved.manufacturer_part is None


def test_the_same_type_from_a_different_maker_is_the_same_part(inventree, tmp_path):
    """
    A JEDEC number identifies a generic part; the maker is a stock property.

    1N4007 from Diotec and 1N4007 from an unmarked bag are one part, or every
    bag of the commonest rectifier on earth becomes its own inventory line.
    """
    seed_diodes(inventree)
    api = connect()
    ctx = context(api, config_dir(tmp_path, TYPED))

    first = resolve_part(api, typed_line(type="1N4007"), ctx, write=True,
                         policy=RELAXED)
    second = resolve_part(
        api, typed_line(type="1N4007", manufacturer="Diotec Semiconductor",
                        mpn="1N4007-DIO"),
        ctx, write=True,
        policy=PartPolicy(require_mpn=False, require_manufacturer=False,
                          create_manufacturers=True))

    assert second.part.pk == first.part.pk
    assert len(parts_in(inventree, 41)) == 1
    # The maker is still recorded - as a manufacturer part on the shared part.
    assert inventree.manufacturer_parts[0]["MPN"] == "1N4007-DIO"


def test_a_different_type_is_a_different_part(inventree, tmp_path):
    seed_diodes(inventree)
    api = connect()
    ctx = context(api, config_dir(tmp_path, TYPED))

    first = resolve_part(api, typed_line(type="1N4007"), ctx, write=True,
                         policy=RELAXED)
    second = resolve_part(api, typed_line(type="1N4148"), ctx, write=True,
                          policy=RELAXED)

    assert second.part.pk != first.part.pk
    assert {"1N4007", "1N4148"} == {p["name"] for p in parts_in(inventree, 41)}


def test_an_mpn_category_does_not_match_on_a_type_designator(inventree, tmp_path):
    """
    The mode has to mean something.

    Under `identity: mpn` the manufacturer part number is the identity, so a
    bare designator must not match by name - that would merge parts the
    category says are distinct. It creates a new part instead.
    """
    seed_diodes(inventree)
    api = connect()
    ctx = context(api, config_dir(tmp_path, TYPED.replace("identity: type",
                                                          "identity: mpn")))

    first = resolve_part(api, typed_line(type="1N4007"), ctx, write=True,
                         policy=RELAXED)
    second = resolve_part(api, typed_line(type="1N4007"), ctx, write=True,
                          policy=RELAXED)

    assert second.part.pk != first.part.pk
    assert len(parts_in(inventree, 41)) == 2


def test_find_part_by_type_ignores_case(inventree):
    seed_diodes(inventree)
    inventree.add_part("1N4007", pk=99, category=41)
    assert find_part_by_type(connect(), 41, "1n4007").pk == 99


def test_a_part_with_no_identifier_at_all_is_named_from_its_description(
        inventree, tmp_path):
    """Old stock: a marking nobody recognises. Better filed than refused."""
    seed_diodes(inventree)
    api = connect()

    resolved = resolve_part(api, typed_line(), context(api, config_dir(tmp_path, TYPED)),
                            write=True, policy=RELAXED)

    assert resolved.ok, resolved.reason
    assert resolved.name == "DIODE STANDARD 1000V 1A DO-41"


# --------------------------------------------------------------------------
# Partial specifications - the case that must not guess
# --------------------------------------------------------------------------
def partial_line(**overrides):
    """A resistor giving only its resistance, not the full key set."""
    line = PartLine.from_product({
        **RESISTOR_PRODUCT, "manufacturer_part": "", "manufacturer_name": "",
        "parameters": {"Resistance": "100 kOhms"}})
    for key, value in overrides.items():
        setattr(line, key, value)
    return line


def test_a_partial_spec_asks_rather_than_guessing(inventree, tmp_path):
    """
    Matching on a subset can merge two different parts; creating instead can
    duplicate one. InvenTree cannot merge parts, so neither is recoverable.
    """
    seed_resistors(inventree)
    api = connect()
    ctx = context(api, config_dir(tmp_path, RESISTORS, RESISTOR_PARAMETERS))

    before = len(inventree.part_rows)

    resolved = resolve_part(api, partial_line(), ctx, write=True,
                            policy=RELAXED)

    assert resolved.needs_choice is True
    assert not resolved.ok
    assert set(resolved.missing) == {"Tolerance", "Package"}
    assert len(inventree.part_rows) == before    # nothing created while asking


def test_a_partial_spec_offers_the_parts_that_agree_so_far(inventree, tmp_path):
    seed_resistors(inventree)
    api = connect()
    ctx = context(api, config_dir(tmp_path, RESISTORS, RESISTOR_PARAMETERS))
    complete = resolve_part(
        api, PartLine.from_product({**RESISTOR_PRODUCT, "manufacturer_part": "",
                                    "manufacturer_name": ""}),
        ctx, write=True, policy=RELAXED)

    resolved = resolve_part(api, partial_line(), ctx, write=True, policy=RELAXED)

    assert [p.pk for p in resolved.candidates] == [complete.part.pk]


def test_a_chooser_settles_a_partial_spec(inventree, tmp_path):
    seed_resistors(inventree)
    api = connect()
    ctx = context(api, config_dir(tmp_path, RESISTORS, RESISTOR_PARAMETERS))
    complete = resolve_part(
        api, PartLine.from_product({**RESISTOR_PRODUCT, "manufacturer_part": "",
                                    "manufacturer_name": ""}),
        ctx, write=True, policy=RELAXED)

    resolved = resolve_part(
        api, partial_line(), ctx, write=True,
        policy=PartPolicy(require_mpn=False, require_manufacturer=False,
                          choose_part=lambda line, offered: offered[0]))

    assert resolved.ok
    assert resolved.part.pk == complete.part.pk
    assert len(parts_in(inventree, 12)) == 1     # reused, not duplicated


@pytest.mark.parametrize("mode,creates", [("new", True), ("skip", False)])
def test_on_partial_may_be_set_for_unattended_runs(inventree, tmp_path,
                                                   mode, creates):
    seed_resistors(inventree)
    api = connect()
    ctx = context(api, config_dir(tmp_path, RESISTORS, RESISTOR_PARAMETERS))

    before = len(inventree.part_rows)

    resolved = resolve_part(
        api, partial_line(), ctx, write=True,
        policy=PartPolicy(require_mpn=False, require_manufacturer=False,
                          on_partial=mode))

    assert (len(inventree.part_rows) > before) is creates
    assert resolved.needs_choice is False
    if not creates:
        assert "partial specification" in resolved.reason


def test_a_complete_spec_never_asks(inventree, tmp_path):
    seed_resistors(inventree)
    api = connect()
    resolved = resolve_part(
        api, PartLine.from_product({**RESISTOR_PRODUCT, "manufacturer_part": "",
                                    "manufacturer_name": ""}),
        context(api, config_dir(tmp_path, RESISTORS, RESISTOR_PARAMETERS)),
        write=True, policy=RELAXED)
    assert resolved.needs_choice is False
    assert resolved.ok


def test_a_spec_with_no_parameters_at_all_creates_rather_than_asking(
        inventree, tmp_path):
    """Nothing supplied is not a partial answer - there is nothing to weigh."""
    seed_resistors(inventree)
    api = connect()
    line = PartLine.from_product({**RESISTOR_PRODUCT, "manufacturer_part": "",
                                  "manufacturer_name": "", "parameters": {}})

    resolved = resolve_part(
        api, line, context(api, config_dir(tmp_path, RESISTORS,
                                           RESISTOR_PARAMETERS)),
        write=True, policy=RELAXED)

    assert resolved.needs_choice is False
    assert resolved.ok


# --------------------------------------------------------------------------
# Pure helpers
# --------------------------------------------------------------------------
def test_ipn_prefix_is_what_the_category_declares():
    assert ipn_prefix(CategoryConfig("Timers", ["Integrated Circuits", "Timers"],
                                     ipn_prefix="IC")) == "IC"


def test_a_category_without_a_prefix_falls_back_to_misc():
    """Better a visible MISC-00001 than initials nobody recognises."""
    assert ipn_prefix(CategoryConfig("Widgets", ["Widgets"])) == "MISC"


def test_compact_for_name_uses_si_prefixes_outside_the_middle():
    assert compact_for_name(100000) == "100k"
    assert compact_for_name(0.25) == "0.25"
    assert compact_for_name(2.2e-7) == "220n"
    assert compact_for_name(0) == "0"


def test_fill_name_strips_units_the_template_already_writes():
    parameters = {
        "Resistance": ParameterConfig("Resistance", units="ohm"),
        "Tolerance": ParameterConfig("Tolerance", units="%"),
        "Package": ParameterConfig("Package"),
    }
    name = fill_name(
        "Resistor {Resistance} {Tolerance}% {Package}",
        {"Resistance": "100 kΩ", "Tolerance": "1 %", "Package": "Axial"},
        parameters)
    assert name == "Resistor 100k 1% Axial"


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------
def test_an_existing_supplier_part_is_left_alone(inventree, tmp_path):
    seed_ic(inventree)
    inventree.add_supplier_part("296-1411-1-ND", supplier=1, part=4, pk=9)
    directory = config_dir(tmp_path, IC)

    result = import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True)

    assert result.counts()["exists"] == 1
    assert len(inventree.part_rows) == 1          # the stub's default part
    assert len(inventree.manufacturer_parts) == 0


def test_a_dry_run_creates_nothing(inventree, tmp_path):
    seed_ic(inventree)
    directory = config_dir(tmp_path, IC)

    result = import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=False, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True)

    assert result.counts()["created"] == 1
    assert result.skus[0].part == UNRESOLVED_PK
    assert inventree.manufacturer_parts == []
    assert inventree.supplier_parts == []
    assert not any(c["name"] == "Texas Instruments" for c in inventree.companies)


def test_an_mpn_part_is_created_with_its_dependents(inventree, tmp_path):
    seed_ic(inventree)
    directory = config_dir(tmp_path, IC)

    result = import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True)

    assert result.counts()["created"] == 1
    action = result.skus[0]
    assert action.ipn == "IC-00001"
    assert action.name == "NE555P"
    part = next(p for p in inventree.part_rows if p.get("IPN") == "IC-00001")
    assert part["category"] == 11
    assert part["name"] == "NE555P"
    assert any(c["name"] == "Texas Instruments" and c.get("is_manufacturer")
               for c in inventree.companies)
    assert inventree.manufacturer_parts[0]["MPN"] == "NE555P"
    assert inventree.supplier_parts[0]["SKU"] == "296-1411-1-ND"
    assert inventree.supplier_parts[0]["link"] == "https://www.digikey.com/x"
    assert inventree.supplier_parts[0]["packaging"] == "Cut Tape"
    assert any(p["data"] == "8-DIP" for p in inventree.parameters)


def test_a_reel_size_is_not_a_pack_quantity(inventree, tmp_path):
    """
    The supplier part must not carry a pack, or every receipt is multiplied.

    DigiKey's StandardPackage is the manufacturer's reel or tube size (2500
    here), not the size of a purchasable unit - the SKU is sold and priced by
    the piece. InvenTree receives quantity x pack_quantity into stock, so
    mapping the reel size across turns an order for 2 into 5000 in stock.
    """
    seed_ic(inventree)
    directory = config_dir(tmp_path, IC)

    import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True)

    created = inventree.supplier_parts[0]
    assert not created.get("pack_quantity"), (
        "pack_quantity must stay unset so InvenTree defaults it to 1")


def test_reimporting_the_same_sku_is_a_noop(inventree, tmp_path):
    seed_ic(inventree)
    directory = config_dir(tmp_path, IC)
    api = connect()
    import_supplier_parts(
        ["296-1411-1-ND"], api, write=True, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True)
    before = (len(inventree.part_rows), len(inventree.supplier_parts))

    result = import_supplier_parts(
        ["296-1411-1-ND"], api, write=True, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True)

    assert result.counts()["exists"] == 1
    assert (len(inventree.part_rows), len(inventree.supplier_parts)) == before


def test_an_unmapped_category_is_skipped(inventree, tmp_path):
    inventree.add_company("DigiKey", pk=1, is_supplier=True)
    directory = config_dir(tmp_path, "Resistors: {}\n")
    product = {**IC_PRODUCT}
    result = import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True, directory=directory,
        products={"296-1411-1-ND": product}, fetch=False,
        create_manufacturers=True)

    assert result.skus[0].action == "skipped"
    assert "unmapped category" in result.skus[0].reason
    assert inventree.supplier_parts == []


def test_an_unknown_manufacturer_is_skipped_without_create(inventree, tmp_path):
    seed_ic(inventree)
    directory = config_dir(tmp_path, IC)
    result = import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False)

    assert result.skus[0].action == "skipped"
    assert "unresolved manufacturer" in result.skus[0].reason
    assert inventree.part_rows[-1].get("IPN") != "IC-00001"


def test_a_spec_part_is_reused_for_the_same_parameters(inventree, tmp_path):
    seed_resistors(inventree)
    directory = config_dir(tmp_path, RESISTORS, (
        "Resistance:\n  units: ohm\n  aliases: [Resistance]\n  parse: quantity\n"
        "Tolerance:\n  units: '%'\n  aliases: [Tolerance]\n  parse: percent\n"
        "Package:\n  aliases: [Package / Case]\n"))
    api = connect()
    first = import_supplier_parts(
        ["13-MFR-ND"], api, write=True, directory=directory,
        products={"13-MFR-ND": RESISTOR_PRODUCT}, fetch=False,
        create_manufacturers=True)
    assert first.counts()["created"] == 1
    assert first.skus[0].name.startswith("Resistor 100k")

    other = {**RESISTOR_PRODUCT, "SKU": "OTHER-ND",
             "manufacturer_part": "CFR-25JB-52-100K",
             "manufacturer_name": "Yageo Corporation"}
    second = import_supplier_parts(
        ["OTHER-ND"], api, write=True, directory=directory,
        products={"OTHER-ND": other}, fetch=False,
        create_manufacturers=True)

    assert second.counts()["created"] == 1
    assert second.skus[0].part == first.skus[0].part
    assert len([p for p in inventree.part_rows
                if p.get("IPN") == first.skus[0].ipn]) == 1
    assert len(inventree.supplier_parts) == 2


def test_next_ipn_increments_the_prefix(inventree):
    inventree.add_part("old", ipn="IC-00007")
    assert next_ipn(connect(), "IC") == "IC-00008"


def test_a_subcategory_prefix_wins_over_its_parents(inventree, tmp_path):
    """The part lands in Timers, so it numbers under Timers' own prefix."""
    seed_ic(inventree)
    directory = config_dir(tmp_path, IC.replace(
        "  Timers:\n", "  Timers:\n    ipn_prefix: TMR\n"))

    result = import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True)

    assert result.skus[0].ipn == "TMR-00001"


def test_a_category_with_no_prefix_numbers_under_misc(inventree, tmp_path):
    seed_ic(inventree)
    directory = config_dir(tmp_path, IC.replace("  ipn_prefix: IC\n", ""))

    result = import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True)

    assert result.skus[0].ipn == "MISC-00001"


def test_two_categories_sharing_a_prefix_share_one_sequence(inventree, tmp_path):
    """DIO on both diode subcategories numbers all diodes together."""
    inventree.add_company("DigiKey", pk=1, is_supplier=True)
    parent = inventree.add_category("Diodes", pk=30, structural=True)
    inventree.add_category("Signal Diodes", parent=parent["pk"], pk=31)
    inventree.add_category("Zener Diodes", parent=parent["pk"], pk=32)
    inventree.templates.append({"pk": 20, "name": "Package", "units": ""})
    directory = config_dir(tmp_path, """
Diodes:
  ipn_prefix: DIO
  identity: mpn
  parameters: [Package]
  Signal Diodes:
    aliases:
      - Discrete Semiconductor Products / Diodes / Rectifiers / Single Diodes
  Zener Diodes:
    aliases:
      - Discrete Semiconductor Products / Diodes / Zener / Single Zener Diodes
""")
    signal = {**IC_PRODUCT, "SKU": "1N4148-ND", "manufacturer_part": "1N4148",
              "category_path": ["Discrete Semiconductor Products", "Diodes",
                                "Rectifiers", "Single Diodes"]}
    zener = {**IC_PRODUCT, "SKU": "1N4733A-ND", "manufacturer_part": "1N4733A",
             "category_path": ["Discrete Semiconductor Products", "Diodes",
                               "Zener", "Single Zener Diodes"]}

    result = import_supplier_parts(
        ["1N4148-ND", "1N4733A-ND"], connect(), write=True, directory=directory,
        products={"1N4148-ND": signal, "1N4733A-ND": zener}, fetch=False,
        create_manufacturers=True)

    assert [s.ipn for s in result.skus] == ["DIO-00001", "DIO-00002"]


def test_a_product_image_is_cached_and_uploaded(inventree, tmp_path, monkeypatch):
    seed_ic(inventree)
    directory = config_dir(tmp_path, IC)
    image = tmp_path / "NE555P.jpg"
    image.write_bytes(b"\xff\xd8\xff\xd9")

    def fake_fetch(url, cache_dir=None, refresh=False):
        assert url == "https://mm.digikey.com/photo/NE555P.jpg"
        return image

    monkeypatch.setattr("invimport.inventree.parts.fetch_image", fake_fetch)
    product = {**IC_PRODUCT, "image": "https://mm.digikey.com/photo/NE555P.jpg",
               "images": ["https://mm.digikey.com/photo/NE555P.jpg"]}

    result = import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True, directory=directory,
        products={"296-1411-1-ND": product}, fetch=False,
        create_manufacturers=True)

    assert result.counts()["created"] == 1
    assert inventree.images
    part = next(p for p in inventree.part_rows if p.get("IPN") == "IC-00001")
    assert part.get("image")


def test_no_supplier_skips_every_sku(inventree, tmp_path):
    directory = config_dir(tmp_path, IC)
    result = import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True, directory=directory,
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True)
    assert result.problems
    assert result.skus[0].action == "skipped"


# --------------------------------------------------------------------------
# Where parameter values land
# --------------------------------------------------------------------------
RESISTOR_PARAMETERS = (
    "Resistance:\n  units: ohm\n  aliases: [Resistance]\n  parse: quantity\n"
    "Tolerance:\n  units: '%'\n  aliases: [Tolerance]\n  parse: percent\n"
    "Package:\n  aliases: [Package / Case]\n"
    "Mounting:\n  aliases: [Mounting Type]\n")

# Package is a key parameter; Mounting is not.
RESISTORS_WITH_EXTRA = """
Resistors:
  identity: spec
  key_parameters: [Resistance, Tolerance, Package]
  name: "Resistor {Resistance} {Tolerance}% {Package}"
  parameters: [Resistance, Tolerance, Package, Mounting]
  aliases:
    - Resistors / Through Hole Resistors
"""


def written(inventree, model_type: str) -> dict[str, str]:
    """Parameter values the run created against one model type, by template."""
    names = {t["pk"]: t["name"] for t in inventree.templates}
    return {names[p["template"]]: p["data"] for p in inventree.parameters
            if p["model_type"] == model_type}


def import_resistor(inventree, tmp_path):
    seed_resistors(inventree)
    inventree.templates.append({"pk": 24, "name": "Mounting", "units": ""})
    product = {**RESISTOR_PRODUCT,
               "parameters": {**RESISTOR_PRODUCT["parameters"],
                              "Mounting Type": "Through Hole"}}
    directory = config_dir(tmp_path, RESISTORS_WITH_EXTRA, RESISTOR_PARAMETERS)
    return import_supplier_parts(
        ["13-MFR-ND"], connect(), write=True, directory=directory,
        products={"13-MFR-ND": product}, fetch=False, create_manufacturers=True)


def test_the_part_carries_only_its_key_parameters(inventree, tmp_path):
    """
    Non-key values may differ between manufacturers of the same spec, so
    pinning one manufacturer's figures to the shared part would make them look
    authoritative.
    """
    import_resistor(inventree, tmp_path)

    assert set(written(inventree, "part.part")) == {"Resistance", "Tolerance",
                                                    "Package"}
    assert "Mounting" not in written(inventree, "part.part")


def test_the_manufacturer_part_carries_everything(inventree, tmp_path):
    import_resistor(inventree, tmp_path)

    assert set(written(inventree, "company.manufacturerpart")) == {
        "Resistance", "Tolerance", "Package", "Mounting"}


def test_the_supplier_part_carries_everything(inventree, tmp_path):
    import_resistor(inventree, tmp_path)

    values = written(inventree, "company.supplierpart")
    assert set(values) == {"Resistance", "Tolerance", "Package", "Mounting"}
    assert values["Resistance"] == "100 kΩ"


def test_parameters_are_counted_per_record(inventree, tmp_path):
    action = import_resistor(inventree, tmp_path).skus[0]

    assert action.part_parameters == 3           # key only
    assert action.manufacturer_parameters == 4
    assert action.supplier_parameters == 4


def test_an_mpn_part_carries_every_parameter(inventree, tmp_path):
    """
    Under mpn identity there is one part per MPN, so there is no
    cross-manufacturer variation to keep off it.
    """
    seed_ic(inventree)
    inventree.templates.append({"pk": 25, "name": "Mounting", "units": ""})
    directory = config_dir(tmp_path, IC, (
        "Package:\n  aliases: [Package / Case]\n"
        "Mounting:\n  aliases: [Mounting Type]\n"))
    IC_WITH_MOUNTING = IC.replace("parameters: [Package]",
                                  "parameters: [Package, Mounting]")
    (tmp_path / "categories.yaml").write_text(IC_WITH_MOUNTING)

    import_supplier_parts(["296-1411-1-ND"], connect(), write=True,
                          directory=directory,
                          products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
                          create_manufacturers=True)

    assert set(written(inventree, "part.part")) == {"Package", "Mounting"}


def test_reimporting_does_not_duplicate_parameters(inventree, tmp_path):
    import_resistor(inventree, tmp_path)
    before = len(inventree.parameters)
    import_resistor(inventree, tmp_path)
    assert len(inventree.parameters) == before


def test_update_parameters_fills_missing_values_on_an_existing_sku(
        inventree, tmp_path):
    """
    --update-parameters used to no-op: a SKU that was already a supplier part
    returned before any parameter code ran.
    """
    import_resistor(inventree, tmp_path)
    names = {t["pk"]: t["name"] for t in inventree.templates}
    # Drop Mounting everywhere, and a key parameter from the Part, so the
    # write has to touch the existing Part as well as the manufacturer and
    # supplier records.
    inventree.parameters[:] = [
        p for p in inventree.parameters
        if names.get(p["template"]) != "Mounting"
        and not (names.get(p["template"]) == "Resistance"
                 and p["model_type"] == "part.part")]

    product = {**RESISTOR_PRODUCT,
               "parameters": {**RESISTOR_PRODUCT["parameters"],
                              "Mounting Type": "Through Hole"}}
    result = import_supplier_parts(
        ["13-MFR-ND"], connect(), write=True,
        directory=config_dir(tmp_path, RESISTORS_WITH_EXTRA, RESISTOR_PARAMETERS),
        products={"13-MFR-ND": product}, fetch=False,
        create_manufacturers=True, update_parameters=True)

    assert result.counts()["exists"] == 1
    assert result.counts()["created"] == 0
    assert result.counts()["parameters"] > 0
    assert len(inventree.supplier_parts) == 1
    assert "Resistance" in written(inventree, "part.part")
    assert "Mounting" in written(inventree, "company.manufacturerpart")
    assert "Mounting" in written(inventree, "company.supplierpart")


def test_on_sku_fires_as_each_sku_finishes(inventree, tmp_path):
    seed_ic(inventree)
    seen = []
    import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True,
        directory=config_dir(tmp_path, IC),
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True, on_sku=seen.append)
    assert [a.sku for a in seen] == ["296-1411-1-ND"]
    assert seen[0].action == "created"


def test_on_step_reports_write_actions_in_order(inventree, tmp_path):
    """Callers see each record as it is written, not only the finished SKU."""
    seed_ic(inventree)
    steps = []
    import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=True,
        directory=config_dir(tmp_path, IC),
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True,
        on_step=lambda sku, step, i, n: steps.append((sku, step, i, n)))
    assert steps[0] == ("296-1411-1-ND", "start", 1, 1)
    assert [s[1] for s in steps] == [
        "start", "manufacturer", "part", "manufacturer_part", "supplier_part"]


def test_on_step_skips_write_actions_on_a_dry_run(inventree, tmp_path):
    seed_ic(inventree)
    steps = []
    import_supplier_parts(
        ["296-1411-1-ND"], connect(), write=False,
        directory=config_dir(tmp_path, IC),
        products={"296-1411-1-ND": IC_PRODUCT}, fetch=False,
        create_manufacturers=True,
        on_step=lambda sku, step, i, n: steps.append(step))
    assert steps == ["start"]


# --------------------------------------------------------------------------
# Preferred SI prefixes
# --------------------------------------------------------------------------
FARAD = ["u", "n", "p"]


def test_a_preferred_prefix_keeps_a_big_capacitor_in_microfarads():
    """3300 uF is written '3300u'. A free choice of prefix gives '3.3m'."""
    assert compact_for_name(0.0033, FARAD) == "3300u"
    assert compact_for_name(0.001, FARAD) == "1000u"
    assert compact_for_name(0.0056, FARAD) == "5600u"


def test_a_preferred_prefix_steps_down_as_the_value_shrinks():
    assert compact_for_name(16e-6, FARAD) == "16u"
    assert compact_for_name(4.7e-7, FARAD) == "470n"
    assert compact_for_name(1e-9, FARAD) == "1n"
    assert compact_for_name(1e-10, FARAD) == "100p"
    assert compact_for_name(2.2e-11, FARAD) == "22p"


def test_the_smallest_preferred_prefix_is_the_floor():
    """Below the last prefix there is nothing to step down to."""
    assert compact_for_name(5e-13, FARAD) == "0.5p"


def test_a_preferred_prefix_never_leaves_the_allowed_set():
    """Milli is available to the general rule but not to capacitance."""
    assert compact_for_name(0.0033) == "0.0033"
    assert "m" not in compact_for_name(0.0033, FARAD)


def test_no_preferred_prefix_leaves_the_general_rule_alone():
    assert compact_for_name(0.25, []) == "0.25"
    assert compact_for_name(100000, None) == "100k"


@pytest.mark.parametrize("path,kind", [
    ("Capacitors/Ceramic Capacitors", "Ceramic Capacitor"),
    ("Capacitors/Electrolytic Capacitors", "Electrolytic Capacitor"),
    ("Capacitors/Film Capacitors", "Film Capacitor"),
    ("Capacitors/Tantalum Capacitors", "Tantalum Capacitor"),
])
def test_a_capacitor_name_includes_its_type(path, kind):
    """End to end, through the real config."""
    from invimport.config import load_config

    categories, parameters = load_config()
    name = fill_name(categories[path].name_template,
                     {"Capacitance": "3.3 mF", "Max Working Voltage": "16 V",
                      "Tolerance": "20 %", "Mounting": "Through Hole",
                      "Package": "Radial"},
                     parameters)
    assert name == f"{kind} 3300u 16V 20% Through Hole Radial"


# --------------------------------------------------------------------------
# RKM notation
# --------------------------------------------------------------------------
OHM = ["M", "k", "R"]


def test_rkm_puts_the_prefix_where_the_decimal_point_goes():
    assert compact_for_name(4.7, OHM, "rkm") == "4R7"
    assert compact_for_name(3300, OHM, "rkm") == "3k3"
    assert compact_for_name(2.2e6, OHM, "rkm") == "2M2"
    assert compact_for_name(4.75, OHM, "rkm") == "4R75"


def test_a_whole_number_takes_the_symbol_as_a_suffix():
    assert compact_for_name(4, OHM, "rkm") == "4R"
    assert compact_for_name(7000, OHM, "rkm") == "7k"
    assert compact_for_name(100, OHM, "rkm") == "100R"
    assert compact_for_name(1e7, OHM, "rkm") == "10M"


def test_a_value_below_one_keeps_its_decimal_point():
    """'0R5' reads worse than '0.5R', and 'R05' worse still."""
    assert compact_for_name(0.5, OHM, "rkm") == "0.5R"
    assert compact_for_name(0.05, OHM, "rkm") == "0.05R"


def test_resistance_never_goes_below_ohms():
    """No milliohms: R is the floor, so a shunt stays in ohms."""
    assert "m" not in compact_for_name(0.05, OHM, "rkm")
    assert compact_for_name(0.0047, OHM, "rkm") == "0.0047R"


def test_rkm_is_off_unless_the_style_asks_for_it():
    assert compact_for_name(3300, OHM) == "3.3k"


def test_a_resistor_name_uses_rkm_through_the_real_config():
    from invimport.config import load_config

    categories, parameters = load_config()
    category = categories["Resistors/Through Hole Resistors"]
    name = fill_name(category.name_template,
                     {"Resistance": "3.3 kΩ", "Tolerance": "1 %",
                      "Power Rating": "0.25 W", "Composition": "Metal Film",
                      "Mounting": "Through Hole", "Package": "Axial"},
                     parameters)
    assert name == "Resistor 3k3 1% 0.25W Metal Film"
