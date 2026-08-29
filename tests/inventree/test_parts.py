"""Find-or-create Part, ManufacturerPart and SupplierPart from SKUs."""

from __future__ import annotations

from invimport.config import (
    CategoryConfig,
    ParameterConfig,
)
from invimport.inventree.api import connect
from invimport.inventree.parts import (
    UNRESOLVED_PK,
    fill_name,
    import_supplier_parts,
    ipn_prefix,
    next_ipn,
)
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
