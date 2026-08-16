"""
Test doubles for invimport: canned payloads, a fake DigiKey transport, and an
InvenTree stub that serves only routes present in the OpenAPI spec.

Shared by every suite under tests/. Fixtures that wrap these live in
tests/conftest.py; this module is the plain, importable version.

Nothing here touches the network.
"""

from __future__ import annotations

import json
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests

# Captured before any fixture patches requests.get, so the DigiKey fake can
# still reach the local InvenTree stub through it.
REAL_GET = requests.get

# Up out of the module, then tests/.
REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC_FILE = REPO_ROOT / "docs" / "InvenTree API.yaml"


# --------------------------------------------------------------------------
# Fake DigiKey payloads
# --------------------------------------------------------------------------
PRODUCT_PAYLOAD: dict[str, Any] = {
    "Product": {
        "ProductUrl": "https://www.digikey.com/x",
        "DatasheetUrl": "https://example.com/ds.pdf",
        "ManufacturerProductNumber": "NE555P",
        "Manufacturer": {"Name": "Texas Instruments"},
        "Description": {"ProductDescription": "IC OSC SINGLE TIMER"},
        # Shaped exactly as the real payloads in .cache/.digikey/products:
        # one ChildCategories chain, and Parameters as name/value text.
        "Category": {
            "Name": "Integrated Circuits (ICs)",
            "ChildCategories": [
                {"Name": "Clock/Timing", "ChildCategories": []},
            ],
        },
        "Parameters": [
            {"ParameterText": "Mounting Type", "ValueText": "Through Hole"},
            {"ParameterText": "Package / Case", "ValueText": "8-DIP"},
            {"ParameterText": "Operating Temperature",
             "ValueText": "0°C ~ 70°C"},
            {"ParameterText": "Features", "ValueText": "-"},
        ],
        "ProductVariations": [
            {
                "DigiKeyProductNumber": "296-1411-1-ND",
                "PackageType": {"Name": "Cut Tape"},
                "MinimumOrderQuantity": 1,
                "StandardPackage": 1,
                "StandardPricing": [
                    {"BreakQuantity": 10, "UnitPrice": 0.71},
                    {"BreakQuantity": 1, "UnitPrice": 0.82},
                ],
            }
        ],
    }
}

SALES_ORDER_PAYLOAD: dict[str, Any] = {
    "SalesOrderId": 87654321,
    "Status": {"SalesOrderStatus": "Shipped", "ShortDescription": "All shipped"},
    "PurchaseOrder": "PO-42",
    "DateEntered": "2026-07-01T10:00:00Z",
    "ShipMethod": "DHL",
    "Currency": "AUD",
    "TotalPrice": 41.5,
    "LineItems": [
        {
            "DigiKeyProductNumber": "296-1411-1-ND",
            "ManufacturerProductNumber": "NE555P",
            "Description": "IC OSC SINGLE TIMER",
            "PackType": "Cut Tape",
            "QuantityOrdered": 10,
            "QuantityShipped": 10,
            "QuantityBackOrder": 0,
            "UnitPrice": 0.82,
            "TotalPrice": 8.2,
            "ItemShipments": [
                {
                    "QuantityShipped": 10,
                    "ShippedDate": "2026-07-02",
                    "TrackingNumber": "1Z999AA",
                    "InvoiceId": 555,
                }
            ],
        }
    ],
}

ORDER_PAYLOAD: dict[str, Any] = {
    "OrderNumber": 12345678,
    "CustomerId": 999,
    "DateEntered": "2026-07-01T10:00:00Z",
    "Currency": "AUD",
    "PONumber": "PO-42",
    "EntireOrderStatus": {"OrderStatus": "Shipped", "ShortDescription": "All shipped"},
    "SalesOrders": [SALES_ORDER_PAYLOAD],
}

HISTORY_PAYLOAD: dict[str, Any] = {"TotalOrders": 1, "Orders": [ORDER_PAYLOAD]}


# --------------------------------------------------------------------------
# DigiKey transport fake
# --------------------------------------------------------------------------
class Response:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class FakeDigiKey:
    """
    Records every GET and answers from canned payloads.

    Override .responses to change what an endpoint returns, or .pages to script
    a multi-page history sweep.

    Only DigiKey URLs are intercepted. The fixture patches requests.get on the
    shared requests module, which the inventree library uses too, so anything
    else - notably the InvenTree stub - has to be let through untouched or the
    two fakes cannot be used in the same test.
    """

    HOSTS = ("api.digikey.com", "sandbox-api.digikey.com")

    def __init__(self):
        self.calls: list[dict[str, Any]] = []
        self.product = PRODUCT_PAYLOAD
        self.sales_order = SALES_ORDER_PAYLOAD
        self.history = HISTORY_PAYLOAD
        self.pages: list[dict[str, Any]] | None = None
        self.status_code = 200

    @property
    def urls(self) -> list[str]:
        return [c["url"] for c in self.calls]

    def __len__(self) -> int:
        return len(self.calls)

    def get(self, url, headers=None, params=None, timeout=None, **kwargs):
        if not any(host in url for host in self.HOSTS):
            return REAL_GET(url, headers=headers, params=params,
                            timeout=timeout, **kwargs)

        self.calls.append({"url": url, "params": params, "headers": dict(headers or {})})
        if self.status_code != 200:
            return Response({"detail": "boom"}, self.status_code)
        if "productdetails" in url:
            return Response(self.product)
        if url.endswith("/orders"):
            if self.pages is not None:
                index = (params or {}).get("PageNumber", 1) - 1
                page = self.pages[index] if index < len(self.pages) else {"Orders": []}
                return Response(page)
            return Response(self.history)
        return Response(self.sales_order)


# --------------------------------------------------------------------------
# InvenTree stub server
# --------------------------------------------------------------------------
def spec_paths() -> set[str]:
    """
    The API paths declared in docs/InvenTree API.yaml.

    Read straight from the spec so the stub cannot drift from the real server
    contract - this is what catches calls to routes that no longer exist.
    """
    text = SPEC_FILE.read_text(encoding="utf-8")
    return set(re.findall(r"^  (/[^:\s]*):", text, flags=re.MULTILINE))


def _by(rows: list[dict[str, Any]], query: dict[str, list[str]],
        field: str) -> list[dict[str, Any]]:
    """Apply one integer query filter, the way the real list endpoints do."""
    wanted = (query.get(field) or [None])[0]
    if wanted is None:
        return rows
    return [row for row in rows if str(row.get(field)) == str(wanted)]


def path_to_regex(path: str) -> re.Pattern:
    """Turn an OpenAPI path template into a matcher: /api/x/{id}/ -> /api/x/\\d+/."""
    return re.compile("^" + re.sub(r"\{[^}]+\}", r"[^/]+", re.escape(path)
                                   .replace(r"\{", "{").replace(r"\}", "}")) + "$")


class InvenTreeStub:
    """
    A fake InvenTree that serves ONLY routes present in the OpenAPI spec and
    404s everything else, so a call to a stale route fails loudly.
    """

    def __init__(self, parts: dict[str, int] | None = None):
        self.valid = [path_to_regex(p) for p in spec_paths()]
        self.parts = parts if parts is not None else {"R-0402-10K": 7}
        self.templates: list[dict[str, Any]] = []
        self.parameters: list[dict[str, Any]] = []
        self.existing_parameters: list[dict[str, Any]] = []
        self.bad_routes: list[str] = []
        self.parameter_queries: list[dict[str, list[str]]] = []
        self.saves: list[tuple[str, dict[str, Any]]] = []
        # Every POST in order, so a test can assert on sequencing.
        self.posts: list[tuple[str, dict[str, Any]]] = []
        # Purchase order side: companies and supplier parts are seeded by the
        # test, orders and line items accumulate as they are created.
        # Custom units. "known" is what /api/units/all/ reports: pint's own
        # names plus whatever has been created.
        self.units: list[dict[str, Any]] = []
        self.categories: list[dict[str, Any]] = []
        self.builtin_units = {"ohm", "F", "V", "W", "degC", "°C", "%", "Hz",
                              "A", "ppm", "ppm/K"}
        self.companies: list[dict[str, Any]] = []
        self.supplier_parts: list[dict[str, Any]] = []
        self.purchase_orders: list[dict[str, Any]] = []
        self.line_items: list[dict[str, Any]] = []
        self._next_pk = 100
        self._server: HTTPServer | None = None

    # -- seeding -----------------------------------------------------------
    def add_company(self, name: str, pk: int = 1, **fields) -> dict[str, Any]:
        row = {"pk": pk, "name": name, "is_supplier": True,
               "is_manufacturer": False, "active": True, "description": "",
               **fields}
        self.companies.append(row)
        return row

    def add_unit(self, name: str, definition: str = "x", symbol: str = "",
                 pk: int | None = None) -> dict[str, Any]:
        row = {"pk": pk if pk is not None else len(self.units) + 1,
               "name": name, "definition": definition, "symbol": symbol}
        self.units.append(row)
        return row

    def add_category(self, name: str, parent: int | None = None,
                     pk: int | None = None, **fields) -> dict[str, Any]:
        path = name
        if parent is not None:
            parent_row = next(c for c in self.categories if c["pk"] == parent)
            path = f"{parent_row['pathstring']}/{name}"
        row = {"pk": pk if pk is not None else len(self.categories) + 1,
               "name": name, "parent": parent, "pathstring": path,
               "description": fields.get("description", ""),
               "structural": fields.get("structural", False), **fields}
        row["pathstring"] = path
        self.categories.append(row)
        return row

    def add_supplier_part(self, sku: str, supplier: int = 1, part: int = 4,
                          pk: int | None = None) -> dict[str, Any]:
        row = {"pk": pk if pk is not None else len(self.supplier_parts) + 1,
               "SKU": sku, "supplier": supplier, "part": part}
        self.supplier_parts.append(row)
        return row

    # -- lifecycle ---------------------------------------------------------
    def __enter__(self) -> InvenTreeStub:
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, body):
                raw = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def _valid(self, path):
                if any(rx.match(path) for rx in stub.valid):
                    return True
                stub.bad_routes.append(f"{self.command} {path}")
                self._send(404, {"detail": "Not found."})
                return False

            def do_GET(self):
                parsed = urlparse(self.path)
                if not self._valid(parsed.path):
                    return
                query = parse_qs(parsed.query)

                if parsed.path == "/api/":
                    return self._send(200, {"server": "InvenTree", "version": "1.0.0",
                                            "apiVersion": 530})
                if parsed.path.startswith("/api/user/me"):
                    return self._send(200, {"pk": 1, "username": "tester"})
                if parsed.path == "/api/part/":
                    ipn = (query.get("IPN") or [""])[0]
                    pk = stub.parts.get(ipn)
                    if pk is None:
                        return self._send(200, [])
                    if isinstance(pk, list):     # ambiguous-IPN case
                        return self._send(200, [{"pk": p, "IPN": ipn} for p in pk])
                    return self._send(200, [{"pk": pk, "IPN": ipn}])
                if parsed.path == "/api/parameter/template/":
                    return self._send(200, stub.templates)
                if parsed.path == "/api/parameter/":
                    stub.parameter_queries.append(query)
                    return self._send(200, stub.existing_parameters)
                if parsed.path == "/api/units/":
                    return self._send(200, stub.units)
                if parsed.path == "/api/units/all/":
                    names = stub.builtin_units | {u["name"] for u in stub.units}
                    return self._send(200, {
                        "default_system": "SI",
                        "available_systems": ["SI"],
                        "available_units": {n: {"name": n} for n in names},
                    })
                if parsed.path == "/api/part/category/":
                    return self._send(200, stub.categories)
                if parsed.path == "/api/company/":
                    rows = stub.companies
                    if (query.get("is_supplier") or [""])[0].lower() == "true":
                        rows = [c for c in rows if c.get("is_supplier")]
                    return self._send(200, rows)
                if parsed.path == "/api/company/part/":
                    return self._send(200, _by(stub.supplier_parts, query, "supplier"))
                if parsed.path == "/api/order/po/":
                    return self._send(200, _by(stub.purchase_orders, query, "supplier"))
                return self._send(200, [])

            def do_OPTIONS(self):
                parsed = urlparse(self.path)
                if not self._valid(parsed.path):
                    return
                # Only the bit the importer reads: the next free reference,
                # which the real server derives from the orders it already has.
                nxt = f"PO-{len(stub.purchase_orders) + 1:04d}"
                return self._send(200, {
                    "actions": {"POST": {"reference": {"default": nxt}}}
                })

            def do_POST(self):
                parsed = urlparse(self.path)
                if not self._valid(parsed.path):
                    return
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                stub._next_pk += 1
                row = {"pk": stub._next_pk, **body}
                stub.posts.append((parsed.path, body))
                if parsed.path == "/api/parameter/template/":
                    stub.templates.append(row)
                elif parsed.path == "/api/parameter/":
                    stub.parameters.append(row)
                elif parsed.path == "/api/units/":
                    stub.units.append(row)
                elif parsed.path == "/api/part/category/":
                    parent = body.get("parent")
                    name = body.get("name", "")
                    path = name
                    if parent is not None:
                        parent_row = next((c for c in stub.categories
                                           if c["pk"] == parent), None)
                        if parent_row:
                            path = f"{parent_row['pathstring']}/{name}"
                    row["pathstring"] = path
                    row.setdefault("description", "")
                    row.setdefault("structural", False)
                    stub.categories.append(row)
                elif parsed.path == "/api/company/":
                    stub.companies.append(row)
                elif parsed.path == "/api/company/part/":
                    stub.supplier_parts.append(row)
                elif parsed.path == "/api/order/po/":
                    stub.purchase_orders.append(row)
                elif parsed.path == "/api/order/po-line/":
                    stub.line_items.append(row)
                return self._send(201, row)

            def do_PATCH(self):
                parsed = urlparse(self.path)
                if not self._valid(parsed.path):
                    return
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                stub.saves.append((parsed.path, body))
                return self._send(200, {"pk": 1, **body})

            do_PUT = do_PATCH

        self._server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        if self._server:
            self._server.shutdown()
            self._server.server_close()

    @property
    def url(self) -> str:
        assert self._server is not None
        return f"http://127.0.0.1:{self._server.server_port}"
