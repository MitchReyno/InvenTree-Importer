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
    """

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

    def get(self, url, headers=None, params=None, timeout=None):
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
        self._next_pk = 100
        self._server: HTTPServer | None = None

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
                return self._send(200, [])

            def do_POST(self):
                parsed = urlparse(self.path)
                if not self._valid(parsed.path):
                    return
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                stub._next_pk += 1
                row = {"pk": stub._next_pk, **body}
                if parsed.path == "/api/parameter/template/":
                    stub.templates.append(row)
                elif parsed.path == "/api/parameter/":
                    stub.parameters.append(row)
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
