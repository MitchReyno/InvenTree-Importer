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
