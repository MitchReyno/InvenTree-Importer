"""Actual HTTP for the bounded synthetic stock scenario, bound to IPv4 loopback."""
from __future__ import annotations

from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import re
from urllib.parse import parse_qs, urlsplit

from .state import DemoState, ROUTES

TOKEN = "DEMO-ONLY-NOT-A-REAL-TOKEN"


def multipart(content_type: str, content: bytes) -> tuple[dict, str, bytes]:
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + content)
    fields = {}
    filename, uploaded = "", b""
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if part.get_filename():
            if name != "attachment" or filename:
                raise ValueError("unsupported demo upload")
            filename, uploaded = part.get_filename(), part.get_payload(decode=True)
        elif name:
            fields[name] = part.get_content()
    if not filename or not fields.get("model_id") or not fields.get("model_type"):
        raise ValueError("incomplete demo attachment")
    return fields, filename, uploaded


class DemoHTTPServer(HTTPServer):
    def __init__(self, state: DemoState, instance: str, port: int = 0) -> None:
        state.validate_schema()
        self.state, self.instance = state, instance
        super().__init__(("127.0.0.1", port), DemoHandler)


class DemoHandler(BaseHTTPRequestHandler):
    server: DemoHTTPServer

    def log_message(self, *args: object) -> None:
        pass

    def send(self, code: int, body: object) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_bytes(code, raw, "application/json")

    def send_bytes(self, code: int, content: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def route(self) -> str | None:
        parsed = urlsplit(self.path)
        if parsed.path in {"/api/", "/demo/identity"}:
            return "" if parsed.path == "/api/" else "identity"
        if self.headers.get("Authorization") != "Token " + TOKEN:
            self.send(401, {"detail": "DEMO token required"})
            return None
        if parsed.path.startswith("/media/"):
            return parsed.path.lstrip("/")
        if not parsed.path.startswith("/api/"):
            self.send(404, {"detail": "Outside demo API"})
            return None
        return parsed.path.removeprefix("/api/")

    def do_GET(self) -> None:
        route = self.route()
        if route is None:
            return
        state = self.server.state
        state.record_request("GET", route, {}, "received")
        if route == "identity":
            return self.send(200, {"demo": True, "instance": self.server.instance})
        if route == "":
            return self.send(200, {"server": "InvenTree", "version": "1.0.0", "apiVersion": 530})
        if route == "user/me/":
            return self.send(200, {"pk": 1, "username": "DEMO"})
        if route.startswith("media/") and route[6:].isdigit():
            content = state.media(int(route[6:]))
            return self.send_bytes(200, content, "application/octet-stream") if content is not None else self.send(404, {})
        collection, pk = state.detail(route)
        if collection not in ROUTES:
            return self.send(404, {"detail": "Unsupported demo endpoint"})
        if pk is not None:
            row = state.get(route)
            return self.send(200, row) if row is not None else self.send(404, {"detail": "Not found"})
        try:
            rows = state.rows(route, parse_qs(urlsplit(self.path).query, keep_blank_values=True))
        except (ValueError, TypeError, re.error):
            return self.send(400, {"detail": "Invalid demo filter"})
        return self.send(200, rows)

    def do_OPTIONS(self) -> None:
        route = self.route()
        if route is None:
            return
        if route not in ROUTES:
            return self.send(404, {})
        self.server.state.record_request("OPTIONS", route, {}, "received")
        return self.send(200, {"actions": {"POST": {
            "reference": {"type": "string", "max_length": 100, "default": f"DEMO-PO-{len(self.server.state.rows('order/po/')) + 1}"},
            "merge_items": {"type": "boolean", "default": True},
            "auto_pricing": {"type": "boolean", "default": False}}}})

    def payload(self) -> tuple[dict, str, bytes]:
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 <= length <= 16 * 1024 * 1024:
            raise ValueError("demo body exceeds limit")
        raw = self.rfile.read(length)
        content_type = self.headers.get("Content-Type", "")
        if content_type.startswith("multipart/form-data"):
            return multipart(content_type, raw)
        body = json.loads(raw or b"{}")
        if not isinstance(body, dict):
            raise ValueError("object required")
        return body, "", b""

    def do_POST(self) -> None:
        self.mutate()

    def do_PATCH(self) -> None:
        self.mutate()

    def mutate(self) -> None:
        route = self.route()
        if route is None:
            return
        state = self.server.state
        collection, pk = state.detail(route)
        if route not in {"barcode/", "barcode/link/"} and collection not in ROUTES:
            return self.send(404, {"detail": "Unsupported demo endpoint"})
        try:
            body, filename, uploaded = self.payload()
        except (ValueError, TypeError):
            return self.send(400, {"detail": "Invalid demo body"})
        if state.reject_before(self.command, route):
            state.record_request(self.command, route, body, "rejected_before_application")
            return self.send(403, {"detail": "DEMO intentional one-shot rejection BEFORE application"})
        state.record_request(self.command, route, body, "received")
        if route == "barcode/" and self.command == "POST":
            owner = state.barcode(str(body.get("barcode", "")))
            if owner is None:
                return self.send(400, {"error": "No match found for barcode data"})
            return self.send(200, {"barcode_data": body["barcode"], "stockitem": owner})
        if route == "barcode/link/" and self.command == "POST":
            owner = body.get("stockitem")
            if type(owner) is not int or state.get(f"stock/{owner}/") is None:
                return self.send(400, {"error": "Unknown demo stock target"})
            if not state.link_barcode(str(body.get("barcode", "")), owner):
                return self.send(400, {"error": "Barcode matches existing item"})
            return self.send(200, {"success": "Barcode associated"})
        if self.command == "PATCH":
            row = state.get(route)
            if row is None or filename:
                return self.send(404, {})
            row.update({key: value for key, value in body.items() if key != "pk"})
            state.update(row)
            return self.send(200, row)
        if pk is not None:
            return self.send(405, {})
        if route == "attachment/":
            if not filename:
                return self.send(400, {})
            return self.send(201, state.upload(body, filename, uploaded))
        if filename:
            return self.send(400, {})
        row = state.create(route, body)
        return self.send(201, [row] if route == "stock/" else row)
