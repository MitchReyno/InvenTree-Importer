"""
InvenTree connection and API 530 model compatibility.

Credentials come from the environment (see invimport.env):

    INVENTREE_URL=https://inventree.example.com
    INVENTREE_TOKEN=...           # preferred
    # or, if you have not generated a token yet:
    INVENTREE_USER=...
    INVENTREE_PASSWORD=...
"""

from __future__ import annotations

import logging
import os
import sys

log = logging.getLogger(__name__)

try:
    from inventree.api import InvenTreeAPI
    from inventree.base import InventreeObject
    from inventree.company import Company  # noqa: F401  (re-exported for commands)
    from inventree.company import SupplierPart  # noqa: F401
    from inventree.part import Part  # noqa: F401
    from inventree.part import Parameter as _Parameter
    from inventree.part import ParameterTemplate as _ParameterTemplate
    from inventree.purchase_order import PurchaseOrder  # noqa: F401
    from inventree.purchase_order import PurchaseOrderLineItem  # noqa: F401
except ImportError:
    print("ERROR: dependencies missing - run `uv sync`", file=sys.stderr)
    raise


# --------------------------------------------------------------------------
# API 530 compatibility
# --------------------------------------------------------------------------
# InvenTree generalised parameters in API 530: they now hang off any model via
# model_type + model_id instead of a hard-coded part field, and the routes
# moved out from under /api/part/:
#
#     /api/part/parameter/           ->  /api/parameter/
#     /api/part/parameter/template/  ->  /api/parameter/template/
#
# The inventree python library (0.13.5) still points at the pre-530 routes, so
# a stock Parameter.list() 404s. Patch the URLs here rather than downgrade the
# server or pin a library version that does not exist yet.
#
# Only parameters moved. Company, SupplierPart, PurchaseOrder and
# PurchaseOrderLineItem still sit at the routes the library expects
# (company/, company/part/, order/po/, order/po-line/), so they are re-exported
# above unchanged.
PART_MODEL_TYPE = "part.part"


class Parameter(_Parameter):
    URL = "parameter"


class ParameterTemplate(_ParameterTemplate):
    URL = "parameter/template"


class CustomUnit(InventreeObject):
    """
    A user-defined unit, e.g. ppm_per_delta_degC = 'ppm / delta_degC'.

    The library ships no model for /api/units/, so it is declared here rather
    than hand-rolling requests. Parameter templates reference units by name, so
    a custom unit has to exist before any template that uses it.
    """
    URL = "units"


class InvenTreeError(RuntimeError):
    pass


def connect() -> InvenTreeAPI:
    url = os.getenv("INVENTREE_URL")
    token = os.getenv("INVENTREE_TOKEN")
    user = os.getenv("INVENTREE_USER")
    password = os.getenv("INVENTREE_PASSWORD")

    if not url:
        raise InvenTreeError("set INVENTREE_URL in the .env or environment")

    if token:
        api = InvenTreeAPI(url, token=token)
    elif user and password:
        api = InvenTreeAPI(url, username=user, password=password)
    else:
        raise InvenTreeError(
            "set INVENTREE_TOKEN, or INVENTREE_USER and INVENTREE_PASSWORD"
        )

    log.info("Connected to %s", url)
    return api
