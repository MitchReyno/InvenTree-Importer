"""End-to-end runs through the CLI entrypoint."""

from __future__ import annotations

import json

import pytest

from invimport.__main__ import cli, main, program_name


@pytest.fixture(autouse=True)
def no_real_env(tmp_path, monkeypatch):
    """
    Point the default --env-file at nothing. Otherwise every CLI test quietly
    loads the developer's real .env and stops testing what it thinks it is.
    """
    monkeypatch.setattr("invimport.__main__.DEFAULT_ENV_FILE",
                        tmp_path / "absent.env")


def test_no_command_prints_help(capsys):
    assert main([]) == 2
    assert "COMMAND" in capsys.readouterr().out


def test_unknown_command_is_rejected():
    with pytest.raises(SystemExit):
        main(["nonsense"])


# --------------------------------------------------------------------------
# product
# --------------------------------------------------------------------------
def test_product_reports_the_fields(digikey, digikey_env, workspace, capsys):
    assert main(["product", "296-1411-1-ND"]) == 0
    out = capsys.readouterr().out
    assert "manufacturer_part  NE555P" in out
    assert "packaging          Cut Tape" in out
    assert "fetched=1  not_found=0  no_variation_match=0" in out


def test_product_pricing_flag_adds_the_unit_price(digikey, digikey_env,
                                                  workspace, capsys):
    main(["product", "296-1411-1-ND", "--pricing"])
    assert "unit_price         0.82 AUD" in capsys.readouterr().out


def test_product_json_is_a_bare_list(digikey, digikey_env, workspace):
    out = workspace / "products.json"
    main(["product", "296-1411-1-ND", "--json", str(out)])
    written = json.loads(out.read_text())
    assert isinstance(written, list)
    assert written[0]["SKU"] == "296-1411-1-ND"


def test_product_deduplicates_skus(digikey, digikey_env, workspace):
    main(["product", "296-1411-1-ND", "296-1411-1-ND"])
    assert len(digikey) == 1


def test_product_reads_skus_from_stdin(digikey, digikey_env, workspace,
                                       capsys, monkeypatch):
    import io
    monkeypatch.setattr("sys.stdin", io.StringIO("296-1411-1-ND\n"))
    assert main(["product", "-"]) == 0
    assert "NE555P" in capsys.readouterr().out


def test_product_with_no_usable_skus_exits_2(digikey, digikey_env, workspace,
                                             capsys, monkeypatch):
    import io
    monkeypatch.setattr("sys.stdin", io.StringIO("\n  \n"))
    assert main(["product", "-"]) == 2
    assert "no SKUs given" in capsys.readouterr().err


# --------------------------------------------------------------------------
# orders
# --------------------------------------------------------------------------
def test_orders_reports_history(digikey, digikey_env, workspace, capsys):
    assert main(["orders", "--start-date", "2026-01-01",
                 "--end-date", "2026-01-31"]) == 0
    out = capsys.readouterr().out
    assert "[order 12345678]" in out
    assert "sales order 87654321" in out
    assert "tracking 1Z999AA" in out


def test_orders_json_holds_the_flattened_orders(digikey, digikey_env, workspace):
    out = workspace / "orders.json"
    main(["orders", "--start-date", "2026-01-01", "--end-date", "2026-01-31",
          "--json", str(out)])
    written = json.loads(out.read_text())
    assert written[0]["order_number"] == 12345678
    line = written[0]["sales_orders"][0]["line_items"][0]
    assert line["digikey_part"] == "296-1411-1-ND"


def test_single_order_lookup_skips_the_history_sweep(digikey, digikey_env,
                                                     workspace, capsys):
    assert main(["orders", "--order", "87654321"]) == 0
    assert len(digikey) == 1
    assert not any(url.endswith("/orders") for url in digikey.urls)
    assert "sales order 87654321" in capsys.readouterr().out


def test_inverted_date_range_exits_2(digikey, digikey_env, workspace, capsys):
    assert main(["orders", "--start-date", "2026-08-01",
                 "--end-date", "2026-01-01"]) == 2
    assert "is after" in capsys.readouterr().err


def test_bad_date_format_is_rejected_by_argparse(digikey, digikey_env, workspace):
    with pytest.raises(SystemExit):
        main(["orders", "--start-date", "01/01/2026"])


def test_orders_without_account_id_raises(digikey, digikey_env, workspace,
                                          monkeypatch):
    monkeypatch.delenv("DIGIKEY_ACCOUNT_ID")
    with pytest.raises(Exception, match="DIGIKEY_ACCOUNT_ID"):
        main(["orders"])


# --------------------------------------------------------------------------
# import-orders
# --------------------------------------------------------------------------
@pytest.fixture
def stocked(inventree):
    """An InvenTree with a DigiKey supplier and the canned order's SKU."""
    inventree.add_company("DigiKey", pk=1)
    inventree.add_supplier_part("296-1411-1-ND", supplier=1, part=4)
    return inventree


def test_import_orders_is_a_dry_run_by_default(digikey, digikey_env, workspace,
                                               stocked, answers, capsys):
    answers("")                                   # accept the whole checklist
    assert main(["import-orders"]) == 0
    out = capsys.readouterr().out
    assert "DRY RUN" in out
    assert "Supplier: DigiKey (pk=1)" in out
    assert "re-run with --write" in out
    assert stocked.purchase_orders == []
    assert stocked.stock_items == []


def test_import_orders_writes_when_asked(digikey, digikey_env, workspace,
                                         stocked, answers, capsys):
    answers("")
    assert main(["import-orders", "--write"]) == 0
    assert len(stocked.purchase_orders) == 1
    assert stocked.purchase_orders[0]["supplier_reference"] == "87654321"
    assert len(stocked.stock_items) == 1
    out = capsys.readouterr().out
    assert "PO-0001" in out
    assert "1 stock item(s)" in out


def test_unselecting_the_only_order_imports_nothing(digikey, digikey_env,
                                                    workspace, stocked, answers,
                                                    capsys):
    answers("n", "q")                             # clear it, then back out
    assert main(["import-orders", "--write"]) == 0
    assert "Cancelled" in capsys.readouterr().out
    assert stocked.purchase_orders == []


def test_all_skips_the_checklist(digikey, digikey_env, workspace, stocked):
    """No answers fixture: with --all nothing may read stdin."""
    assert main(["import-orders", "--all", "--write"]) == 0
    assert len(stocked.purchase_orders) == 1


def test_non_interactive_without_all_is_refused(digikey, digikey_env, workspace,
                                                stocked, capsys):
    assert main(["import-orders"]) == 2
    assert "not a terminal" in capsys.readouterr().err


def test_a_missing_supplier_offers_to_create_one(digikey, digikey_env, workspace,
                                                 inventree, answers, capsys):
    inventree.add_supplier_part("296-1411-1-ND", supplier=1, part=4)
    answers("1", "y", "")                         # create, confirm, import
    assert main(["import-orders", "--write"]) == 0
    out = capsys.readouterr().out
    assert "No supplier named 'DigiKey'" in out
    assert inventree.companies[-1]["name"] == "DigiKey"


def test_a_missing_supplier_can_be_matched_to_an_existing_one(
        digikey, digikey_env, workspace, inventree, answers, capsys):
    inventree.add_company("Digi-Key AU", pk=7)
    inventree.add_supplier_part("296-1411-1-ND", supplier=7, part=4)
    answers("2", "")                              # option 1 is 'create'
    assert main(["import-orders", "--write"]) == 0
    assert "use existing: Digi-Key AU" in capsys.readouterr().out
    assert inventree.purchase_orders[0]["supplier"] == 7
    assert len(inventree.companies) == 1          # nothing new created


def test_a_dry_run_will_not_create_the_supplier(digikey, digikey_env, workspace,
                                                inventree, answers, capsys):
    answers("1")                                  # choose create, in a dry run
    assert main(["import-orders"]) == 0
    out = capsys.readouterr().out
    assert "would create supplier 'DigiKey'" in out
    assert inventree.companies == []


def test_supplier_flag_skips_the_prompt(digikey, digikey_env, workspace,
                                        inventree, capsys):
    inventree.add_company("Some Other Name", pk=9)
    inventree.add_supplier_part("296-1411-1-ND", supplier=9, part=4)
    assert main(["import-orders", "--supplier", "9", "--all", "--write"]) == 0
    assert inventree.purchase_orders[0]["supplier"] == 9


def test_an_unknown_supplier_flag_is_an_error(digikey, digikey_env, workspace,
                                              inventree, capsys):
    assert cli(["import-orders", "--supplier", "Nope", "--all"]) == 1
    assert "no supplier named 'Nope'" in capsys.readouterr().err


def test_an_unmatched_sku_is_reported_not_invented(digikey, digikey_env,
                                                   workspace, inventree, capsys):
    inventree.add_company("DigiKey", pk=1)        # supplier, but no parts
    assert main(["import-orders", "--all", "--write"]) == 0
    out = capsys.readouterr().out
    assert "no supplier part with this SKU" in out
    assert "1 line item(s) had no matching supplier part" in out
    assert inventree.purchase_orders == []


def test_reimporting_reports_it_as_already_imported(digikey, digikey_env,
                                                    workspace, stocked, capsys):
    main(["import-orders", "--all", "--write"])
    capsys.readouterr()
    assert main(["import-orders", "--all", "--write"]) == 0
    assert "already imported" in capsys.readouterr().out
    assert len(stocked.purchase_orders) == 1


def test_import_by_sales_order_id_skips_the_history_sweep(digikey, digikey_env,
                                                          workspace, stocked):
    assert main(["import-orders", "--order", "87654321", "--all", "--write"]) == 0
    assert not any(url.endswith("/orders") for url in digikey.urls)
    assert len(stocked.purchase_orders) == 1


def test_import_orders_rejects_an_inverted_date_range(digikey, digikey_env,
                                                      workspace, stocked, capsys):
    assert main(["import-orders", "--all", "--start-date", "2026-08-01",
                 "--end-date", "2026-01-01"]) == 2
    assert "is after" in capsys.readouterr().err


def test_import_orders_hit_no_stale_routes(digikey, digikey_env, workspace,
                                           stocked):
    main(["import-orders", "--all", "--write"])
    assert stocked.bad_routes == []


# -- product lookup for the selected orders --------------------------------
def two_orders(digikey):
    """A history of two orders, each with its own SKU."""
    import copy

    from tests.support import ORDER_PAYLOAD

    first = copy.deepcopy(ORDER_PAYLOAD)
    second = copy.deepcopy(ORDER_PAYLOAD)
    second["OrderNumber"] = 12345679
    second["SalesOrders"][0]["SalesOrderId"] = 87654322
    second["SalesOrders"][0]["LineItems"][0]["DigiKeyProductNumber"] = "OTHER-ND"
    digikey.history = {"TotalOrders": 2, "Orders": [first, second]}


def product_lookups(digikey) -> list[str]:
    return [url for url in digikey.urls if "productdetails" in url]


def test_products_are_fetched_for_the_selected_orders(digikey, digikey_env,
                                                      workspace, stocked, capsys):
    assert main(["import-orders", "--all", "--write"]) == 0
    out = capsys.readouterr().out
    assert "Fetching product details for 1 SKU(s)" in out
    assert any("296-1411-1-ND" in url for url in product_lookups(digikey))


def test_only_the_selected_orders_cost_product_calls(digikey, digikey_env,
                                                     workspace, stocked, answers):
    """The lookup runs after submission, so a deselected order is not paid for."""
    two_orders(digikey)
    answers("2", "")                              # drop the second order
    assert main(["import-orders", "--write"]) == 0

    looked_up = product_lookups(digikey)
    assert any("296-1411-1-ND" in url for url in looked_up)
    assert not any("OTHER-ND" in url for url in looked_up)


def test_no_products_skips_the_lookup(digikey, digikey_env, workspace, stocked,
                                      capsys):
    assert main(["import-orders", "--all", "--write", "--no-products"]) == 0
    assert product_lookups(digikey) == []
    assert "Fetching product details" not in capsys.readouterr().out


def test_an_unmatched_sku_is_reported_with_what_it_is(digikey, digikey_env,
                                                      workspace, inventree,
                                                      capsys):
    """The whole point of the lookup: a bare SKU is not enough to act on."""
    inventree.add_company("DigiKey", pk=1)        # supplier, but no parts
    assert main(["import-orders", "--all", "--write"]) == 0
    out = capsys.readouterr().out
    assert "296-1411-1-ND: no supplier part with this SKU" in out
    assert "NE555P" in out
    assert "IC OSC SINGLE TIMER" in out


def test_the_product_cache_is_reused_on_a_second_run(digikey, digikey_env,
                                                     workspace, stocked):
    main(["import-orders", "--all", "--write"])
    before = len(product_lookups(digikey))
    main(["import-orders", "--all", "--write"])
    assert len(product_lookups(digikey)) == before   # served from .cache


# --------------------------------------------------------------------------
# categories
# --------------------------------------------------------------------------
def test_categories_is_a_dry_run_by_default(inventree, capsys):
    assert main(["categories"]) == 0
    out = capsys.readouterr().out
    assert "DRY RUN" in out
    assert "Part categories" in out
    assert inventree.categories == []


def test_categories_writes_when_asked(inventree):
    assert main(["categories", "--write"]) == 0
    assert any(c["pathstring"] == "Resistors" for c in inventree.categories)


def test_categories_learn_writes_an_alias(inventree, answers, tmp_path, capsys):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text("Package: {}\n")
    (tmp_path / "categories.yaml").write_text(
        "Resistors:\n  parameters: [Package]\n")
    answers("1")
    assert main(["categories", "--config", str(tmp_path), "--learn",
                 "Resistors / Through Hole Resistors"]) == 0
    written = (tmp_path / "categories.yaml").read_text()
    assert "Resistors / Through Hole Resistors" in written
    assert "Resistors / Through Hole Resistors" in capsys.readouterr().out


def test_categories_learn_can_create_a_subcategory(inventree, answers,
                                                   tmp_path, capsys):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text("Package: {}\n")
    (tmp_path / "categories.yaml").write_text(
        "Capacitors:\n  parameters: [Package]\n")
    # Capacitors is a leaf here, so ENTER would map to it. Open it, then
    # create a child at that level.
    answers("o 1", "c", "Tantalum Capacitors")
    assert main(["categories", "--config", str(tmp_path), "--learn",
                 "Capacitors / Tantalum Capacitors"]) == 0
    cats = (tmp_path / "categories.yaml").read_text()
    assert "Tantalum Capacitors:" in cats
    assert "Capacitors / Tantalum Capacitors" in cats
    out = capsys.readouterr().out
    assert "Capacitors/Tantalum Capacitors" in out


def test_categories_learn_can_create_a_top_level(inventree, answers,
                                                 tmp_path):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text("Package: {}\n")
    (tmp_path / "categories.yaml").write_text(
        "Resistors:\n  parameters: [Package]\n")
    answers("c", "Connectors/Headers")
    assert main(["categories", "--config", str(tmp_path), "--learn",
                 "Connectors, Interconnects / Headers, Male Pins"]) == 0
    written = (tmp_path / "categories.yaml").read_text()
    assert "Connectors:" in written
    assert "Headers:" in written


def test_categories_learn_drills_into_a_parent(inventree, answers, tmp_path):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text("Package: {}\n")
    (tmp_path / "categories.yaml").write_text(
        "Capacitors:\n"
        "  parameters: [Package]\n"
        "  Film Capacitors:\n"
        "    parameters: [Package]\n")
    # ENTER on a folder opens it; ENTER on the leaf maps there.
    answers("1", "1")
    assert main(["categories", "--config", str(tmp_path), "--learn",
                 "Capacitors / Film Capacitors"]) == 0
    written = (tmp_path / "categories.yaml").read_text()
    assert "Capacitors / Film Capacitors" in written


def test_categories_learn_lists_top_level_with_hints(inventree, answers,
                                                     tmp_path, capsys):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text("Package: {}\n")
    (tmp_path / "categories.yaml").write_text(
        "Capacitors:\n"
        "  parameters: [Package]\n"
        "  Ceramic Capacitors: {}\n"
        "  Film Capacitors: {}\n")
    answers("q")
    main(["categories", "--config", str(tmp_path), "--learn",
          "Capacitors / Tantalum Capacitors"])
    out = capsys.readouterr().out
    assert "Capacitors  (structural, 2 subcategories)" in out
    assert "create a new category here" in out


def test_categories_learn_without_a_terminal_does_not_write(
        inventree, tmp_path, capsys):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text("Package: {}\n")
    (tmp_path / "categories.yaml").write_text(
        "Resistors:\n  parameters: [Package]\n")
    assert main(["categories", "--config", str(tmp_path), "--learn",
                 "Resistors / Foo"]) == 0
    out = capsys.readouterr().out
    assert "not a terminal" in out
    assert "Resistors / Foo" not in (tmp_path / "categories.yaml").read_text()


# --------------------------------------------------------------------------
# supplier-parts
# --------------------------------------------------------------------------
def _part_config(tmp_path):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text("Package: {}\n")
    (tmp_path / "categories.yaml").write_text(
        "Integrated Circuits:\n"
        "  ipn_prefix: IC\n"
        "  identity: mpn\n"
        "  parameters: [Package]\n"
        "  Timers:\n"
        "    aliases:\n"
        "      - Integrated Circuits (ICs) / Clock/Timing\n")
    (tmp_path / "manufacturers.yaml").write_text("")
    return tmp_path


def _seed_ic_tree(inventree):
    parent = inventree.add_category("Integrated Circuits", pk=10, structural=True)
    inventree.add_category("Timers", parent=parent["pk"], pk=11)
    inventree.templates.append({"pk": 20, "name": "Package", "units": ""})
    inventree.add_company("DigiKey", pk=1, is_supplier=True)


def test_supplier_parts_is_a_dry_run_by_default(digikey, digikey_env, workspace,
                                                inventree, tmp_path, capsys):
    _seed_ic_tree(inventree)
    _part_config(tmp_path)
    assert main(["supplier-parts", "--config", str(tmp_path),
                 "--create-manufacturers", "296-1411-1-ND"]) == 0
    out = capsys.readouterr().out
    assert "DRY RUN" in out
    assert "296-1411-1-ND" in out
    assert inventree.supplier_parts == []


def test_supplier_parts_writes_when_asked(digikey, digikey_env, workspace,
                                          inventree, tmp_path):
    _seed_ic_tree(inventree)
    _part_config(tmp_path)
    assert main(["supplier-parts", "--config", str(tmp_path),
                 "--create-manufacturers", "--write", "296-1411-1-ND"]) == 0
    assert any(p["SKU"] == "296-1411-1-ND" for p in inventree.supplier_parts)
    assert any(p.get("IPN") == "IC-00001" for p in inventree.part_rows)


def test_supplier_parts_from_orders(digikey, digikey_env, workspace,
                                    inventree, tmp_path):
    _seed_ic_tree(inventree)
    _part_config(tmp_path)
    assert main(["supplier-parts", "--config", str(tmp_path),
                 "--from-orders", "--create-manufacturers", "--write"]) == 0
    assert any(p["SKU"] == "296-1411-1-ND" for p in inventree.supplier_parts)


def test_import_orders_create_parts_books_an_unmatched_sku(
        digikey, digikey_env, workspace, inventree, tmp_path):
    _seed_ic_tree(inventree)
    _part_config(tmp_path)
    assert main(["import-orders", "--all", "--write", "--create-parts",
                 "--create-manufacturers", "--config", str(tmp_path)]) == 0
    assert any(p["SKU"] == "296-1411-1-ND" for p in inventree.supplier_parts)
    assert len(inventree.purchase_orders) == 1


# --------------------------------------------------------------------------
# credentials
# --------------------------------------------------------------------------
def test_env_file_supplies_credentials(digikey, workspace, env_file,
                                       monkeypatch, capsys):
    for key in ("DIGIKEY_CLIENT_ID", "DIGIKEY_CLIENT_SECRET", "DIGIKEY_ACCOUNT_ID"):
        monkeypatch.delenv(key, raising=False)
    assert main(["--env-file", str(env_file), "product", "296-1411-1-ND"]) == 0
    assert "NE555P" in capsys.readouterr().out


# --------------------------------------------------------------------------
# cli() wrapper - the console script's entrypoint
# --------------------------------------------------------------------------
def test_cli_turns_a_known_error_into_a_clean_exit(digikey, digikey_env,
                                                   workspace, monkeypatch, capsys):
    """
    The console script calls cli(), not main(). Without the wrapper a missing
    credential would reach the user as a traceback.
    """
    monkeypatch.delenv("DIGIKEY_ACCOUNT_ID")
    assert cli(["orders"]) == 1
    err = capsys.readouterr().err
    assert "ERROR: order lookups need DIGIKEY_ACCOUNT_ID" in err
    assert "Traceback" not in err


def test_cli_handles_interruption(digikey, digikey_env, workspace,
                                  monkeypatch, capsys):
    monkeypatch.setattr("invimport.__main__.main",
                        lambda argv=None: (_ for _ in ()).throw(KeyboardInterrupt()))
    assert cli(["product", "x"]) == 130
    assert "interrupted" in capsys.readouterr().err


def test_cli_passes_through_a_success(digikey, digikey_env, workspace):
    assert cli(["product", "296-1411-1-ND"]) == 0


def test_unexpected_errors_still_surface(digikey, digikey_env, workspace,
                                         monkeypatch):
    """Only known failures are tidied away; bugs must not be swallowed."""
    monkeypatch.setattr("invimport.__main__.main",
                        lambda argv=None: (_ for _ in ()).throw(RuntimeError("bug")))
    with pytest.raises(RuntimeError, match="bug"):
        cli(["product", "x"])


@pytest.mark.parametrize("argv0,expected", [
    ("/usr/lib/python3.12/invimport/__main__.py", "python -m invimport"),
    ("/path/to/.venv/bin/invimport", "invimport"),
    ("", "python -m invimport"),
])
def test_program_name_matches_how_it_was_invoked(monkeypatch, argv0, expected):
    """Help text should show the command the user actually typed."""
    monkeypatch.setattr("sys.argv", [argv0])
    assert program_name() == expected


# --------------------------------------------------------------------------
# discover
# --------------------------------------------------------------------------
DISCOVER_CATEGORIES = """
Resistors:
  identity: spec
  key_parameters: [Resistance]
  parameters: [Resistance]
  aliases:
    - Resistors / Through Hole Resistors
"""

DISCOVER_PARAMETERS = (
    "Resistance:\n  units: ohm\n  aliases: [Resistance]\n  parse: quantity\n")


@pytest.fixture
def discover_config(tmp_path):
    """A config directory plus a product cache holding one resistor."""
    import json

    directory = tmp_path / "config"
    directory.mkdir()
    (directory / "units.yaml").write_text("")
    (directory / "categories.yaml").write_text(DISCOVER_CATEGORIES)
    (directory / "parameters.yaml").write_text(DISCOVER_PARAMETERS)
    (directory / "manufacturers.yaml").write_text("")

    products = tmp_path / "products"
    products.mkdir()
    (products / "r.json").write_text(json.dumps({"Product": {
        "Category": {"Name": "Resistors", "ChildCategories": [
            {"Name": "Through Hole Resistors", "ChildCategories": []}]},
        "Parameters": [
            {"ParameterText": "Resistance", "ValueText": "100 kOhms"},
            {"ParameterText": "Composition", "ValueText": "Metal Film"},
            {"ParameterText": "Size / Dimension", "ValueText": "1mm x 2mm"},
        ],
    }}))
    return directory, products


def test_discover_reports_without_writing(discover_config, workspace, capsys):
    directory, products = discover_config
    before = (directory / "categories.yaml").read_text()

    assert main(["discover", "--config", str(directory),
                 "--cache-dir", str(products)]) == 0

    out = capsys.readouterr().out
    assert "2 unmapped parameter(s)" in out
    assert "Composition" in out
    assert "Resistance" not in out.split("Resistors")[-1].split("Composition")[0]
    assert (directory / "categories.yaml").read_text() == before


def test_discover_files_answers_into_the_config(discover_config, workspace,
                                                answers, capsys):
    directory, products = discover_config
    # Composition -> key parameter, keep the suggested name;
    # Size / Dimension -> ignore.
    answers("1", "1", "3")

    assert main(["discover", "--config", str(directory),
                 "--cache-dir", str(products), "--write"]) == 0

    from invimport.config import load_categories_config, load_parameters_config
    categories = load_categories_config(directory)
    parameters = load_parameters_config(directory)

    assert "Composition" in categories["Resistors"].key_parameters
    assert "Composition" in categories["Resistors"].parameters
    assert "Composition" in parameters
    assert "Size / Dimension" in categories["Resistors"].ignore


def test_a_filed_parameter_is_not_offered_again(discover_config, workspace,
                                                answers, capsys):
    directory, products = discover_config
    answers("2", "1", "3")                        # other, keep name, ignore
    main(["discover", "--config", str(directory),
          "--cache-dir", str(products), "--write"])
    capsys.readouterr()

    assert main(["discover", "--config", str(directory),
                 "--cache-dir", str(products)]) == 0
    assert "Nothing unmapped" in capsys.readouterr().out


def test_discover_needs_a_terminal_to_ask(discover_config, workspace, capsys):
    directory, products = discover_config
    assert main(["discover", "--config", str(directory),
                 "--cache-dir", str(products), "--write"]) == 2
    assert "needs a terminal" in capsys.readouterr().err


def test_discover_can_be_limited_to_one_category(discover_config, workspace,
                                                 capsys):
    directory, products = discover_config
    assert main(["discover", "--config", str(directory),
                 "--cache-dir", str(products), "--category", "Nowhere"]) == 0
    assert "Nothing unmapped" in capsys.readouterr().out


# --------------------------------------------------------------------------
# import-stock
# --------------------------------------------------------------------------
def _stock_config(tmp_path):
    (tmp_path / "units.yaml").write_text("")
    (tmp_path / "manufacturers.yaml").write_text("")
    (tmp_path / "parameters.yaml").write_text(
        "Resistance:\n  units: ohm\n  parse: quantity\n")
    (tmp_path / "categories.yaml").write_text(
        "Resistors:\n"
        "  ipn_prefix: RES\n"
        "  identity: spec\n"
        "  key_parameters: [Resistance]\n"
        "  parameters: [Resistance]\n"
        "  Through Hole Resistors: {}\n")
    return tmp_path


def _stock_file(tmp_path, lines, name="stock.json"):
    path = tmp_path / name
    path.write_text(json.dumps({"lines": lines}))
    return path


def test_import_stock_schema_is_valid_json(capsys):
    assert main(["import-stock", "--schema"]) == 0
    schema = json.loads(capsys.readouterr().out)
    assert schema["properties"]["lines"]["items"]["required"] == [
        "id", "quantity", "category"]


def test_import_stock_vocabulary_lists_the_real_config(capsys, tmp_path):
    """An agent cannot guess these names, so they are generated, not written."""
    directory = _stock_config(tmp_path)
    assert main(["import-stock", "--config", str(directory), "--vocabulary"]) == 0
    vocabulary = json.loads(capsys.readouterr().out)
    paths = [c["path"] for c in vocabulary["categories"]]
    assert "Resistors/Through Hole Resistors" in paths
    assert "Resistors" not in paths           # structural: cannot hold parts
    assert any(p["name"] == "Resistance" and p["units"] == "ohm"
               for p in vocabulary["parameters"])


def _seed_stock_tree(inventree):
    parent = inventree.add_category("Resistors", pk=12, structural=True)
    inventree.add_category("Through Hole Resistors", parent=parent["pk"], pk=13)
    inventree.templates.append({"pk": 21, "name": "Resistance", "units": "ohm"})


def test_import_stock_dry_runs_against_the_server(capsys, inventree, tmp_path):
    """
    The default asks the server what would happen; --validate does not.

    A dry run has to know whether the part already exists, which is a question
    only InvenTree can answer.
    """
    _seed_stock_tree(inventree)
    directory = _stock_config(tmp_path)
    path = _stock_file(tmp_path, [
        {"id": "a", "quantity": 25,
         "category": "Resistors/Through Hole Resistors",
         "parameters": {"Resistance": "1 kohm"}}])

    assert main(["import-stock", "--config", str(directory), str(path)]) == 0

    out = capsys.readouterr().out
    assert "Resistance=1 kΩ" in out
    assert "nothing was written" in out
    assert inventree.stock_items == []


def test_import_stock_writes_when_asked(capsys, inventree, tmp_path):
    _seed_stock_tree(inventree)
    directory = _stock_config(tmp_path)
    path = _stock_file(tmp_path, [
        {"id": "a", "quantity": 25,
         "category": "Resistors/Through Hole Resistors",
         "parameters": {"Resistance": "1 kohm"}}])

    assert main(["import-stock", "--config", str(directory),
                 "--write", "--yes", str(path)]) == 0

    assert inventree.stock_items[0]["quantity"] == 25
    assert "1 created" in capsys.readouterr().out


def test_import_stock_re_run_creates_nothing(capsys, inventree, tmp_path):
    """The barcode key makes a second run of the same file a no-op."""
    _seed_stock_tree(inventree)
    directory = _stock_config(tmp_path)
    path = _stock_file(tmp_path, [
        {"id": "a", "quantity": 25,
         "category": "Resistors/Through Hole Resistors",
         "parameters": {"Resistance": "1 kohm"}}])
    argv = ["import-stock", "--config", str(directory), "--write", "--yes",
            str(path)]

    main(argv)
    capsys.readouterr()
    main(argv)

    assert len(inventree.stock_items) == 1
    assert "1 already there" in capsys.readouterr().out


def test_import_stock_validate_emits_machine_readable_errors(capsys, tmp_path):
    directory = _stock_config(tmp_path)
    path = _stock_file(tmp_path, [
        {"id": "a", "quantity": 1, "category": "Resistors/SMD"}])

    assert main(["import-stock", "--config", str(directory),
                 "--validate", str(path)]) == 1

    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is False
    error = payload["files"][0]["by_line"][0]["errors"][0]
    assert error["field"] == "category"
    assert error["did_you_mean"]


def test_import_stock_reports_an_unreadable_file(capsys, tmp_path):
    directory = _stock_config(tmp_path)
    path = tmp_path / "broken.json"
    path.write_text("{not json")
    assert main(["import-stock", "--config", str(directory), str(path)]) == 1
    assert "could not be read" in capsys.readouterr().err


def test_import_stock_needs_a_file(capsys):
    assert main(["import-stock"]) == 2
    assert "name a file" in capsys.readouterr().err


def test_import_stock_holds_an_unknown_category_without_a_terminal(
        capsys, inventree, tmp_path):
    """
    Nothing is created unattended.

    A category the file proposes with suggest_category passes validation as a
    warning - the author meant it - but without a terminal to confirm on, the
    line is held rather than created. A taxonomy that grows itself from typos
    stops being a taxonomy.
    """
    _seed_stock_tree(inventree)
    directory = _stock_config(tmp_path)
    path = _stock_file(tmp_path, [{"id": "a", "quantity": 1,
                                   "category": "Resistors/Wirewound",
                                   "suggest_category": {"identity": "spec"}}])

    assert main(["import-stock", "--config", str(directory),
                 "--write", "--yes", str(path)]) == 1

    out = capsys.readouterr().out
    assert "need review" in out
    assert "Resistors/Through Hole Resistors" in out   # the near miss offered
    assert inventree.stock_items == []


def test_import_stock_rejects_an_unknown_category_before_connecting(
        capsys, inventree, tmp_path):
    """A plain typo is an error with a suggestion, caught before any writing."""
    _seed_stock_tree(inventree)
    directory = _stock_config(tmp_path)
    path = _stock_file(tmp_path, [{"id": "a", "quantity": 1,
                                   "category": "Resistors/SMD"}])

    assert main(["import-stock", "--config", str(directory),
                 "--write", "--yes", str(path)]) == 1

    out = capsys.readouterr().out
    assert "unknown category" in out
    assert "Resistors/Through Hole Resistors" in out
    assert inventree.stock_items == []

