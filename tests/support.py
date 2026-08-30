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
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests

# Captured before any fixture patches requests.get, so the DigiKey fake can
# still reach the local InvenTree stub through it.
REAL_GET = requests.get
REAL_POST = requests.post

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
        "PhotoUrl": "https://mm.digikey.com/photo/NE555P.jpg",
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
                # The manufacturer's reel size. You still buy these one at a
                # time - see test_a_reel_size_is_not_a_pack_quantity.
                "StandardPackage": 2500,
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
# Minimal JPEG so image downloads in tests never touch the network.
TINY_JPEG = bytes([0xFF, 0xD8, 0xFF, 0xD9])


class Response:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        if isinstance(payload, (bytes, bytearray)):
            self._payload = None
            self.content = bytes(payload)
            self.text = ""
        else:
            self._payload = payload
            self.text = json.dumps(payload)
            self.content = self.text.encode()

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
    IMAGE_HOSTS = ("mm.digikey.com",)

    def __init__(self):
        self.calls: list[dict[str, Any]] = []
        self.product = PRODUCT_PAYLOAD
        self.sales_order = SALES_ORDER_PAYLOAD
        self.history = HISTORY_PAYLOAD
        self.pages: list[dict[str, Any]] | None = None
        self.image = TINY_JPEG
        self.status_code = 200
        # Set to a SKU to make productdetails 404 for it, as DigiKey does for
        # a retired part number. search_results is what keyword search then
        # returns - the fallback that recovers the product.
        self.retired: set[str] = set()
        self.search_results: list[dict[str, Any]] | None = None

    @property
    def urls(self) -> list[str]:
        return [c["url"] for c in self.calls]

    def __len__(self) -> int:
        return len(self.calls)

    def get(self, url, headers=None, params=None, timeout=None, **kwargs):
        if any(host in url for host in self.IMAGE_HOSTS):
            self.calls.append({"url": url, "params": params,
                               "headers": dict(headers or {})})
            return Response(self.image, self.status_code)
        if not any(host in url for host in self.HOSTS):
            return REAL_GET(url, headers=headers, params=params,
                            timeout=timeout, **kwargs)

        self.calls.append({"url": url, "params": params, "headers": dict(headers or {})})
        if self.status_code != 200:
            return Response({"detail": "boom"}, self.status_code)
        if "productdetails" in url:
            if any(sku.lower() in url.lower() for sku in self.retired):
                return Response({"detail": "Not Found"}, 404)
            return Response(self.product)
        if url.endswith("/orders"):
            if self.pages is not None:
                index = (params or {}).get("PageNumber", 1) - 1
                page = self.pages[index] if index < len(self.pages) else {"Orders": []}
                return Response(page)
            return Response(self.history)
        return Response(self.sales_order)

    def post(self, url, headers=None, json=None, timeout=None, **kwargs):
        """
        DigiKey's keyword search, used when productdetails 404s.

        requests.post is patched globally, so anything not aimed at DigiKey -
        the InvenTree stub, most of all - has to pass straight through.
        """
        if not any(host in url for host in self.HOSTS):
            return REAL_POST(url, headers=headers, json=json, timeout=timeout,
                             **kwargs)
        self.calls.append({"url": url, "params": json,
                           "headers": dict(headers or {})})
        if self.status_code != 200:
            return Response({"detail": "boom"}, self.status_code)
        if "search/keyword" in url:
            products = (self.search_results
                        if self.search_results is not None
                        else [self.product["Product"]])
            return Response({"Products": products, "ExactMatches": []})
        return Response({})


# --------------------------------------------------------------------------
# InvenTree stub server
# --------------------------------------------------------------------------
@lru_cache(maxsize=1)
def spec_paths() -> frozenset[str]:
    """
    The API paths declared in docs/InvenTree API.yaml.

    Read straight from the spec so the stub cannot drift from the real server
    contract - this is what catches calls to routes that no longer exist.
    Cached: the spec is large and every inventree test used to re-parse it.
    """
    text = SPEC_FILE.read_text(encoding="utf-8")
    return frozenset(re.findall(r"^  (/[^:\s]*):", text, flags=re.MULTILINE))


@lru_cache(maxsize=1)
def spec_path_regexes() -> tuple[re.Pattern, ...]:
    return tuple(path_to_regex(p) for p in spec_paths())


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
        self.valid = spec_path_regexes()
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
        self.manufacturer_parts: list[dict[str, Any]] = []
        self.part_rows: list[dict[str, Any]] = []
        for ipn, pk in self.parts.items():
            if isinstance(pk, list):
                for p in pk:
                    self.part_rows.append({"pk": p, "IPN": ipn, "name": ipn})
            else:
                self.part_rows.append({"pk": pk, "IPN": ipn, "name": ipn})
        self.purchase_orders: list[dict[str, Any]] = []
        self.line_items: list[dict[str, Any]] = []
        self.stock_items: list[dict[str, Any]] = []
        # A default bin so import-orders can receive without every test
        # having to seed one. Tests that care can clear or replace it.
        self.locations: list[dict[str, Any]] = [
            {"pk": 1, "name": "Stock", "parent": None, "pathstring": "Stock"},
        ]
        self.images: list[int] = []
        # barcode string -> {"stockitem": pk}. InvenTree enforces uniqueness
        # here, which is what makes a double import impossible rather than
        # merely guarded against - so the stub enforces it too.
        self.barcodes: dict[str, dict[str, Any]] = {}
        self.deletes: list[str] = []
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

    def add_part(self, name: str, ipn: str = "", category: int | None = None,
                 pk: int | None = None, **fields) -> dict[str, Any]:
        row = {"pk": pk if pk is not None else len(self.part_rows) + 1,
               "name": name, "IPN": ipn, "category": category,
               "description": fields.pop("description", ""), **fields}
        self.part_rows.append(row)
        if ipn:
            self.parts[ipn] = row["pk"]
        return row

    def add_manufacturer_part(self, part: int, manufacturer: int, mpn: str,
                              pk: int | None = None, **fields) -> dict[str, Any]:
        row = {"pk": pk if pk is not None else len(self.manufacturer_parts) + 1,
               "part": part, "manufacturer": manufacturer, "MPN": mpn, **fields}
        self.manufacturer_parts.append(row)
        return row

    def add_location(self, name: str, pk: int | None = None,
                     parent: int | None = None, **fields) -> dict[str, Any]:
        path = name
        if parent is not None:
            above = next((loc for loc in self.locations
                          if loc["pk"] == parent), None)
            if above:
                path = f"{above.get('pathstring', above['name'])}/{name}"
        row = {"pk": pk if pk is not None else len(self.locations) + 1,
               "name": name, "parent": parent, "pathstring": path, **fields}
        self.locations.append(row)
        return row

    def add_parameter(self, model_id: int, template: int, data: str,
                      pk: int | None = None, **fields) -> dict[str, Any]:
        row = {"pk": pk if pk is not None else len(self.existing_parameters) + 1,
               "model_id": model_id, "template": template, "data": data,
               "model_type": fields.pop("model_type", "part.part"), **fields}
        self.existing_parameters.append(row)
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
                match = re.match(r"^/api/part/(\d+)/$", parsed.path)
                if match:
                    pk = int(match.group(1))
                    row = next((r for r in stub.part_rows if r["pk"] == pk),
                               None)
                    return self._send(200, row or {"pk": pk})
                if parsed.path == "/api/part/":
                    rows = list(stub.part_rows)
                    ipn = (query.get("IPN") or [None])[0]
                    if ipn:
                        rows = [r for r in rows if r.get("IPN") == ipn]
                        if not rows:
                            pk = stub.parts.get(ipn)
                            if isinstance(pk, list):
                                rows = [{"pk": p, "IPN": ipn} for p in pk]
                            elif pk is not None:
                                rows = [{"pk": pk, "IPN": ipn}]
                    regex = (query.get("IPN_regex") or [None])[0]
                    if regex:
                        try:
                            rx = re.compile(regex)
                            rows = [r for r in rows if rx.search(str(r.get("IPN") or ""))]
                        except re.error:
                            rows = []
                    rows = _by(rows, query, "category")
                    return self._send(200, rows)
                if parsed.path == "/api/parameter/template/":
                    return self._send(200, stub.templates)
                if parsed.path == "/api/parameter/":
                    stub.parameter_queries.append(query)
                    rows = stub.existing_parameters + stub.parameters
                    rows = _by(rows, query, "model_id")
                    rows = _by(rows, query, "template")
                    wanted_type = (query.get("model_type") or [None])[0]
                    if wanted_type:
                        rows = [r for r in rows
                                if r.get("model_type") == wanted_type]
                    return self._send(200, rows)
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
                    if (query.get("is_manufacturer") or [""])[0].lower() == "true":
                        rows = [c for c in rows if c.get("is_manufacturer")]
                    return self._send(200, rows)
                if parsed.path == "/api/company/part/":
                    return self._send(200, _by(stub.supplier_parts, query, "supplier"))
                if parsed.path == "/api/company/part/manufacturer/":
                    rows = stub.manufacturer_parts
                    mpn = (query.get("MPN") or [None])[0]
                    if mpn:
                        rows = [r for r in rows
                                if str(r.get("MPN") or "").casefold()
                                == mpn.casefold()]
                    rows = _by(rows, query, "part")
                    rows = _by(rows, query, "manufacturer")
                    return self._send(200, rows)
                if parsed.path == "/api/order/po/":
                    return self._send(200, _by(stub.purchase_orders, query, "supplier"))
                match = re.match(r"^/api/order/po/(\d+)/$", parsed.path)
                if match:
                    pk = int(match.group(1))
                    row = next((o for o in stub.purchase_orders if o["pk"] == pk),
                               None)
                    return self._send(200, row or {"pk": pk})
                if parsed.path == "/api/order/po-line/":
                    return self._send(200, _by(stub.line_items, query, "order"))
                if parsed.path == "/api/stock/":
                    return self._send(200, _by(stub.stock_items, query,
                                              "purchase_order"))
                if parsed.path == "/api/stock/location/":
                    return self._send(200, stub.locations)
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
                stub.posts.append((parsed.path, body))
                issue = re.match(r"^/api/order/po/(\d+)/issue/$", parsed.path)
                if issue:
                    pk = int(issue.group(1))
                    for po in stub.purchase_orders:
                        if po["pk"] == pk:
                            po["status"] = 20
                            return self._send(201, po)
                    return self._send(404, {"detail": "Not found."})
                if parsed.path == "/api/barcode/":
                    key = body.get("barcode")
                    found = stub.barcodes.get(key)
                    if found is None:
                        return self._send(400, {"error": "No match found for "
                                                         "barcode data"})
                    return self._send(200, {"barcode_data": key, **found})

                if parsed.path == "/api/barcode/link/":
                    key = body.get("barcode")
                    if key in stub.barcodes:
                        # Exactly what the real server does: assigning a
                        # barcode that already exists is a validation error.
                        return self._send(400, {
                            "error": "Barcode matches existing item",
                            "barcode_data": key})
                    item = body.get("stockitem")
                    if item is None:
                        return self._send(400, {"error": "no target"})
                    stub.barcodes[key] = {"stockitem": int(item)}
                    return self._send(200, {"success": "Barcode associated"})

                receive = re.match(r"^/api/order/po/(\d+)/receive/$", parsed.path)
                if receive:
                    po_pk = int(receive.group(1))
                    created = []
                    for item in body.get("items") or []:
                        stub._next_pk += 1
                        line = next((li for li in stub.line_items
                                     if li["pk"] == item.get("line_item")), None)
                        qty = item.get("quantity") or 0
                        if line is not None:
                            line["received"] = (line.get("received") or 0) + float(qty)
                        sp_pk = item.get("supplier_part") or (line or {}).get("part")
                        sp = next((p for p in stub.supplier_parts
                                   if p["pk"] == sp_pk), None)
                        # InvenTree receives in supplier units and stores base
                        # units: SupplierPart.base_quantity() scales by the
                        # pack. Mirrored here so a wrong pack shows up as wrong
                        # stock, which is how it shows up in a real instance.
                        pack = float((sp or {}).get("pack_quantity") or 1)
                        stock = {
                            "pk": stub._next_pk,
                            "part": (sp or {}).get("part"),
                            "quantity": float(qty) * pack,
                            "purchase_order": po_pk,
                            "supplier_part": sp_pk,
                            "status": item.get("status", 10),
                            "location": item.get("location", body.get("location")),
                        }
                        stub.stock_items.append(stock)
                        created.append(stock)
                    return self._send(201, created)
                stub._next_pk += 1
                row = {"pk": stub._next_pk, **body}
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
                elif parsed.path == "/api/part/":
                    row.setdefault("IPN", "")
                    row.setdefault("description", "")
                    stub.part_rows.append(row)
                    if row.get("IPN"):
                        stub.parts[row["IPN"]] = row["pk"]
                elif parsed.path == "/api/company/":
                    stub.companies.append(row)
                elif parsed.path == "/api/company/part/":
                    stub.supplier_parts.append(row)
                elif parsed.path == "/api/company/part/manufacturer/":
                    stub.manufacturer_parts.append(row)
                elif parsed.path == "/api/order/po/":
                    row.setdefault("status", 10)
                    stub.purchase_orders.append(row)
                elif parsed.path == "/api/order/po-line/":
                    row.setdefault("received", 0)
                    stub.line_items.append(row)
                elif parsed.path == "/api/stock/":
                    row.setdefault("status", 10)
                    stub.stock_items.append(row)
                    # The spec declares this 201 as an array, and the server
                    # answers with one even for a single item. Anything that
                    # creates stock has to cope with that, so serve the real
                    # shape rather than the convenient one.
                    return self._send(201, [row])
                elif parsed.path == "/api/stock/location/":
                    parent = body.get("parent")
                    name = body.get("name", "")
                    path = name
                    if parent is not None:
                        parent_row = next((loc for loc in stub.locations
                                           if loc["pk"] == parent), None)
                        if parent_row:
                            path = f"{parent_row.get('pathstring', parent_row['name'])}/{name}"
                    row["pathstring"] = path
                    row.setdefault("parent", parent)
                    stub.locations.append(row)
                return self._send(201, row)

            def do_PATCH(self):
                parsed = urlparse(self.path)
                if not self._valid(parsed.path):
                    return
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                content_type = self.headers.get("Content-Type") or ""
                if "multipart" in content_type.lower():
                    pk_match = re.search(r"/(\d+)/?$", parsed.path)
                    pk = int(pk_match.group(1)) if pk_match else 1
                    stub.saves.append((parsed.path, {"image": True}))
                    stub.images.append(pk)
                    for row in stub.part_rows:
                        if row["pk"] == pk:
                            row["image"] = f"/media/part_images/{pk}.png"
                    return self._send(200, {"pk": pk, "image": "uploaded"})
                body = json.loads(raw or b"{}")
                stub.saves.append((parsed.path, body))
                return self._send(200, {"pk": 1, **body})

            do_PUT = do_PATCH

            def do_DELETE(self):
                parsed = urlparse(self.path)
                if not self._valid(parsed.path):
                    return
                pk_match = re.search(r"/(\d+)/?$", parsed.path)
                pk = int(pk_match.group(1)) if pk_match else None
                collections = {
                    "/api/stock/": stub.stock_items,
                    "/api/part/": stub.part_rows,
                    "/api/company/part/": stub.supplier_parts,
                    "/api/company/part/manufacturer/": stub.manufacturer_parts,
                    "/api/stock/location/": stub.locations,
                }
                for prefix, rows in collections.items():
                    if parsed.path.startswith(prefix) and pk is not None:
                        for index, row in enumerate(rows):
                            if row.get("pk") == pk:
                                rows.pop(index)
                                break
                        break
                stub.deletes.append(parsed.path)
                return self._send(204, {})

        self._server = HTTPServer(("127.0.0.1", 0), Handler)
        # serve_forever polls at 0.5s by default, so shutdown() waits that long
        # on every test. 0.01s is still plenty for the stub.
        threading.Thread(
            target=self._server.serve_forever,
            kwargs={"poll_interval": 0.01},
            daemon=True,
        ).start()
        return self

    def __exit__(self, *exc):
        if self._server:
            self._server.shutdown()
            self._server.server_close()

    @property
    def url(self) -> str:
        assert self._server is not None
        return f"http://127.0.0.1:{self._server.server_port}"
