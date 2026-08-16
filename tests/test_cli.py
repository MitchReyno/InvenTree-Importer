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


def test_import_orders_writes_when_asked(digikey, digikey_env, workspace,
                                         stocked, answers, capsys):
    answers("")
    assert main(["import-orders", "--write"]) == 0
    assert len(stocked.purchase_orders) == 1
    assert stocked.purchase_orders[0]["supplier_reference"] == "87654321"
    assert "PO-0001" in capsys.readouterr().out


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
