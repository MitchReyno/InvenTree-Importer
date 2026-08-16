"""
InvenTree import tooling - see `invimport --help` for the CLI.

Every command is also importable. The CLI modules under invimport.commands are
thin adapters (argparse in, printing out); the reusable logic lives in the
modules re-exported here, and none of it prints - it logs and returns data.

    from invimport import fetch_products, fetch_orders, load_env

    load_env()                                   # read the repo-root .env
    rows = fetch_products(["296-1234-1-ND"])
    orders = fetch_orders(start_date="2026-01-01")

Pass an explicit client to reuse one token across several calls:

    from invimport import digikey_connect, fetch_products, fetch_orders

    client = digikey_connect(need_account=True)
    rows = fetch_products(["296-1234-1-ND"], client)
    orders = fetch_orders(client, start_date="2026-01-01")

Library callers see no output by default. To surface the log messages:

    import logging
    logging.getLogger("invimport").addHandler(logging.StreamHandler())
"""

from .config import ConfigError, load_config
from .digikey.api import Client, DigiKeyError
from .digikey.api import connect as digikey_connect
from .digikey.orders import fetch_orders, fetch_sales_orders, line_items
from .digikey.products import fetch_product, fetch_products
from .env import DEFAULT_ENV_FILE, load_env_file
from .inventree.api import InvenTreeError
from .inventree.api import connect as inventree_connect
from .inventree.parameters import SyncResult, sync_config, sync_templates
from .inventree.purchase_orders import (
    ImportResult,
    create_supplier,
    find_supplier,
    import_orders,
    list_suppliers,
)
from .inventree.units import sync_units


def load_env(path=None) -> int:
    """Load the repo-root .env (or a given path) into os.environ."""
    return load_env_file(path or DEFAULT_ENV_FILE)


__all__ = [
    "Client",
    "ConfigError",
    "DigiKeyError",
    "ImportResult",
    "InvenTreeError",
    "SyncResult",
    "create_supplier",
    "digikey_connect",
    "fetch_orders",
    "fetch_product",
    "fetch_products",
    "fetch_sales_orders",
    "find_supplier",
    "import_orders",
    "inventree_connect",
    "line_items",
    "list_suppliers",
    "load_config",
    "load_env",
    "load_env_file",
    "sync_config",
    "sync_templates",
    "sync_units",
]
