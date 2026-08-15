"""
Using invimport as an imported library rather than a CLI.

This is the contract other code depends on: data returned, nothing printed,
errors raised rather than sys.exit, and one client reusable across APIs.
"""

from __future__ import annotations

import logging

import pytest

import invimport


def test_public_api_is_importable():
    for name in invimport.__all__:
        assert hasattr(invimport, name), f"{name} missing from the package"


def test_load_env_reads_the_given_file(tmp_path, monkeypatch):
    monkeypatch.delenv("DIGIKEY_CLIENT_ID", raising=False)
    path = tmp_path / ".env"
    path.write_text("DIGIKEY_CLIENT_ID=from-file\n")
    assert invimport.load_env(path) == 1

    import os
    assert os.environ["DIGIKEY_CLIENT_ID"] == "from-file"


def test_real_environment_beats_the_env_file(tmp_path, monkeypatch):
    monkeypatch.setenv("DIGIKEY_CLIENT_ID", "from-environment")
    path = tmp_path / ".env"
    path.write_text("DIGIKEY_CLIENT_ID=from-file\n")
    invimport.load_env(path)

    import os
    assert os.environ["DIGIKEY_CLIENT_ID"] == "from-environment"


def test_fetch_products_needs_no_argparse(digikey, digikey_env, workspace):
    rows = invimport.fetch_products(["296-1411-1-ND"])
    assert rows[0]["manufacturer_part"] == "NE555P"


def test_nothing_is_printed_to_stdout(digikey, digikey_env, workspace, capsys):
    invimport.fetch_products(["296-1411-1-ND"])
    invimport.fetch_orders(start_date="2026-01-01", end_date="2026-01-31")
    assert capsys.readouterr().out == ""


def test_one_client_serves_both_apis(digikey, digikey_env, workspace):
    """A caller should not have to pay for two token grants."""
    client = invimport.digikey_connect(need_account=True)
    rows = invimport.fetch_products(["296-1411-1-ND"], client)
    orders = invimport.fetch_orders(client, start_date="2026-01-01",
                                    end_date="2026-01-31")
    assert isinstance(client, invimport.Client)
    assert rows[0]["SKU"] == "296-1411-1-ND"
    assert orders[0]["order_number"] == 12345678


def test_composing_orders_into_products(digikey, digikey_env, workspace):
    """
    The motivating case: a new command built from the existing ones - take the
    SKUs off recent orders and look up their datasheets.
    """
    client = invimport.digikey_connect(need_account=True)
    orders = invimport.fetch_orders(client, start_date="2026-01-01",
                                    end_date="2026-01-31")
    skus = sorted({line["digikey_part"] for line in invimport.line_items(orders)})
    products = invimport.fetch_products(skus, client)

    assert skus == ["296-1411-1-ND"]
    assert {p["SKU"]: p["datasheet"] for p in products} == {
        "296-1411-1-ND": "https://example.com/ds.pdf"}


def test_missing_account_id_raises_rather_than_exits(digikey, digikey_env,
                                                     workspace, monkeypatch):
    monkeypatch.delenv("DIGIKEY_ACCOUNT_ID")
    with pytest.raises(invimport.DigiKeyError, match="DIGIKEY_ACCOUNT_ID"):
        invimport.fetch_orders()


def test_missing_credentials_raise_rather_than_exit(workspace, monkeypatch):
    for key in ("DIGIKEY_CLIENT_ID", "DIGIKEY_CLIENT_SECRET"):
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(invimport.DigiKeyError, match="DIGIKEY_CLIENT_ID"):
        invimport.fetch_products(["x"])


def test_log_output_is_opt_in(digikey, digikey_env, workspace):
    """Messages are available through the logger, not forced onto the caller."""
    records: list[str] = []

    class Capture(logging.Handler):
        def emit(self, record):
            records.append(record.getMessage())

    logger = logging.getLogger("invimport")
    handler = Capture()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        invimport.fetch_products(["296-1411-1-ND"])
    finally:
        logger.removeHandler(handler)

    assert any("Access token" in message for message in records)
