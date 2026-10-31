"""Persistent fake records, transfers and explicit one-shot demo faults."""
from __future__ import annotations

from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3


ROUTES = frozenset({"part/", "part/category/", "parameter/", "parameter/template/",
                    "company/", "company/part/", "company/part/manufacturer/",
                    "stock/", "stock/location/", "order/po/", "order/po-line/", "attachment/"})


class DemoState:
    """Own a small SQLite fake database; every call opens its own transaction."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path.as_uri() + "?mode=rw", uri=True)

    def initialize(self, *, partial: bool) -> None:
        with sqlite3.connect(self.path) as connection:
            connection.executescript("""
                CREATE TABLE records(route TEXT NOT NULL, pk INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
                CREATE TABLE media(pk INTEGER PRIMARY KEY, content BLOB NOT NULL);
                CREATE TABLE barcodes(key TEXT PRIMARY KEY, owner INTEGER NOT NULL);
                CREATE TABLE faults(method TEXT, route TEXT, mode TEXT, consumed INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE requests(id INTEGER PRIMARY KEY, method TEXT, route TEXT, payload TEXT, outcome TEXT);
            """)
            if partial:
                connection.execute("INSERT INTO faults(method,route,mode) VALUES ('POST','attachment/','reject_before')")
        self.path.chmod(0o600)
        self.create("part/category/", {"name": "Demo Resistors", "pathstring": "Demo Resistors", "parent": None})
        self.create("stock/location/", {"name": "DEMO Shelf", "pathstring": "DEMO Shelf", "parent": None})
        for name in ("Resistance", "Tolerance"):
            self.create("parameter/template/", {"name": name, "model_type": "", "units": ""})

    @staticmethod
    def detail(route: str) -> tuple[str, int | None]:
        pieces = route.rstrip("/").rsplit("/", 1)
        if len(pieces) == 2 and pieces[1].isdigit():
            return pieces[0] + "/", int(pieces[1])
        return route, None

    def rows(self, route: str, query: dict[str, list[str]] | None = None) -> list[dict]:
        with self.connect() as connection:
            rows = [json.loads(body) for body, in connection.execute("SELECT body FROM records WHERE route=? ORDER BY pk", (route,))]
        for field, values in (query or {}).items():
            wanted = values[0]
            if field in {"limit", "offset", "ordering", "cascade"}:
                continue
            if field == "IPN_regex":
                rows = [row for row in rows if re.search(wanted, str(row.get("IPN", "")))]
            else:
                rows = [row for row in rows if str(row.get(field, "")).lower() == wanted.lower()]
        return rows

    def get(self, route: str) -> dict | None:
        collection, pk = self.detail(route)
        with self.connect() as connection:
            result = connection.execute("SELECT body FROM records WHERE route=? AND pk=?", (collection, pk)).fetchone()
        return json.loads(result[0]) if result else None

    def update(self, row: dict) -> None:
        with self.connect() as connection:
            connection.execute("UPDATE records SET body=? WHERE pk=?", (json.dumps(row), row["pk"]))

    def create(self, route: str, payload: dict) -> dict:
        if route == "order/po-line/" and payload.get("merge_items", True):
            matches = self.rows(route, {"order": [str(payload["order"])], "part": [str(payload["part"])]})
            if matches:
                row = matches[0]
                row["quantity"] = str(Decimal(str(row["quantity"])) + Decimal(str(payload["quantity"])))
                self.update(row)
                return row
        row = {"notes": "", "link": "", **payload}
        if route == "order/po/":
            row.setdefault("status", 10)
        if route == "order/po-line/":
            row.setdefault("received", "0")
            if row.pop("auto_pricing", False):
                row.update(purchase_price="999", purchase_price_currency="USD")
            row.pop("merge_items", None)
        if route == "company/":
            row.setdefault("is_supplier", False)
            row.setdefault("is_manufacturer", False)
        with self.connect() as connection:
            cursor = connection.execute("INSERT INTO records(route,body) VALUES (?,?)", (route, "{}"))
            row["pk"] = cursor.lastrowid
            connection.execute("UPDATE records SET body=? WHERE pk=?", (json.dumps(row), row["pk"]))
        return row

    def upload(self, fields: dict, filename: str, content: bytes) -> dict:
        row = self.create("attachment/", {**fields, "filename": filename, "model_id": int(fields["model_id"])})
        row["attachment"] = f"/media/{row['pk']}"
        with self.connect() as connection:
            connection.execute("INSERT INTO media VALUES (?,?)", (row["pk"], content))
            connection.execute("UPDATE records SET body=? WHERE pk=?", (json.dumps(row), row["pk"]))
        return row

    def media(self, pk: int) -> bytes | None:
        with self.connect() as connection:
            row = connection.execute("SELECT content FROM media WHERE pk=?", (pk,)).fetchone()
        return row[0] if row else None

    def barcode(self, key: str) -> int | None:
        with self.connect() as connection:
            row = connection.execute("SELECT owner FROM barcodes WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def link_barcode(self, key: str, owner: int) -> bool:
        with self.connect() as connection:
            try:
                connection.execute("INSERT INTO barcodes VALUES (?,?)", (key, owner))
            except sqlite3.IntegrityError:
                return False
        return True

    def reject_before(self, method: str, route: str) -> bool:
        with self.connect() as connection:
            row = connection.execute("SELECT rowid FROM faults WHERE method=? AND route=? AND consumed=0", (method, route)).fetchone()
            if row:
                connection.execute("UPDATE faults SET consumed=1 WHERE rowid=?", (row[0],))
        return row is not None

    def record_request(self, method: str, route: str, payload: dict, outcome: str) -> None:
        with self.connect() as connection:
            connection.execute("INSERT INTO requests(method,route,payload,outcome) VALUES (?,?,?,?)",
                               (method, route, json.dumps(payload), outcome))

    def inspect(self) -> dict:
        with self.connect() as connection:
            requests = [{"id": key, "method": method, "route": route, "payload": json.loads(payload), "outcome": outcome}
                        for key, method, route, payload, outcome in connection.execute("SELECT * FROM requests ORDER BY id")]
            faults = [{"method": method, "route": route, "mode": mode, "consumed": bool(consumed)}
                      for method, route, mode, consumed in connection.execute("SELECT * FROM faults")]
            barcodes = dict(connection.execute("SELECT key,owner FROM barcodes"))
            media = [{"pk": pk, "size": len(content), "sha256": sha256(content).hexdigest()}
                     for pk, content in connection.execute("SELECT * FROM media ORDER BY pk")]
        records = {route: self.rows(route) for route in sorted(ROUTES)}
        return {"demo": True, "counts": {route: len(rows) for route, rows in records.items()},
                "records": records, "barcodes": barcodes, "media": media, "faults": faults, "requests": requests}
