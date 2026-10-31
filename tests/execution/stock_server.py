"""Persistent fake InvenTree boundary used across real process restarts."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

from requests import HTTPError


class StockServer:
    api_url = "https://inventory.example/api/"

    def __init__(self, path: Path):
        self.path = path
        with self.connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS rows(route TEXT, pk INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT)")
            connection.execute("CREATE TABLE IF NOT EXISTS faults(route TEXT PRIMARY KEY, mode TEXT)")
            connection.execute("CREATE TABLE IF NOT EXISTS calls(method TEXT, route TEXT)")
            connection.execute("CREATE TABLE IF NOT EXISTS barcodes(key TEXT PRIMARY KEY, owner INTEGER)")
            connection.execute("CREATE TABLE IF NOT EXISTS bytes(pk INTEGER PRIMARY KEY, content BLOB)")

    def connect(self):
        return sqlite3.connect(self.path)

    def seed(self, route: str, body: dict) -> dict:
        with self.connect() as connection:
            cursor = connection.execute("INSERT INTO rows(route,body) VALUES (?,?)", (route, json.dumps(body)))
            body = dict(body, pk=cursor.lastrowid)
            connection.execute("UPDATE rows SET body=? WHERE pk=?", (json.dumps(body), cursor.lastrowid))
        return body

    def fail(self, route: str, mode: str):
        with self.connect() as connection:
            connection.execute("INSERT OR REPLACE INTO faults VALUES (?,?)", (route, mode))

    def _fault(self, route: str):
        with self.connect() as connection:
            row = connection.execute("SELECT mode FROM faults WHERE route=?", (route,)).fetchone()
            connection.execute("DELETE FROM faults WHERE route=?", (route,))
        return row[0] if row else None

    def _call(self, method, route):
        with self.connect() as connection:
            connection.execute("INSERT INTO calls VALUES (?,?)", (method, route))

    def get(self, route: str, *, params: dict | None = None):
        self._call("get", route)
        params = params or {}
        pieces = route.rstrip("/").split("/")
        if pieces[-1].isdigit():
            with self.connect() as connection:
                row = connection.execute("SELECT body FROM rows WHERE pk=? AND route=?", (int(pieces[-1]), "/".join(pieces[:-1]) + "/")).fetchone()
            if row is None:
                raise HTTPError({"status_code": 404, "body": "{}"})
            return json.loads(row[0])
        with self.connect() as connection:
            rows = [json.loads(row[0]) for row in connection.execute("SELECT body FROM rows WHERE route=?", (route,))]
        return [row for row in rows if all(key == "limit" or row.get(key) == value for key, value in params.items())]

    def post(self, route: str, payload: dict):
        self._call("post", route)
        mode = self._fault(route)
        if mode == "before":
            raise ConnectionError("controlled before application")
        if mode == "rejected":
            raise HTTPError({"status_code": 400, "body": "{}"})
        if route == "barcode/":
            with self.connect() as connection:
                row = connection.execute("SELECT owner FROM barcodes WHERE key=?", (payload["barcode"],)).fetchone()
            if row:
                return {"stockitem": row[0]}
            raise HTTPError({"status_code": 400, "body": json.dumps({"error": "No match found for barcode data"})})
        if route == "barcode/link/":
            with self.connect() as connection:
                connection.execute("INSERT INTO barcodes VALUES (?,?)", (payload["barcode"], payload["stockitem"]))
            result = {}
        else:
            result = self.seed(route, payload)
        if mode == "lost":
            raise ConnectionError("controlled applied response lost")
        if mode == "crash":
            import os
            os._exit(71)
        if mode == "multiple":
            return [result, self.seed(route, payload)]
        if mode == "invalid":
            return {"pk": True}
        if mode == "empty":
            return []
        return [result] if route == "stock/" else result

    def patch(self, route: str, payload: dict):
        self._call("patch", route)
        mode = self._fault(route)
        if mode == "before":
            raise ConnectionError("controlled before application")
        row = self.get(route)
        row.update(payload)
        with self.connect() as connection:
            connection.execute("UPDATE rows SET body=? WHERE pk=?", (json.dumps(row), row["pk"]))
        if mode == "lost":
            raise ConnectionError("controlled applied response lost")
        return row

    def request(self, route: str, *, method: str, **kwargs):
        if method == "OPTIONS":
            self._call("options", route)
            with self.connect() as connection:
                count = connection.execute("SELECT count(*) FROM rows WHERE route='order/po/'").fetchone()[0]
            reference = f"PO-{count + 1}"
            return SimpleNamespace(status_code=200, json=lambda: {"actions": {"POST": {"reference": {"default": reference}}}})
        self._call("post", route)
        mode = self._fault(route)
        if mode == "before":
            raise ConnectionError("controlled before application")
        if mode == "rejected":
            raise HTTPError({"status_code": 403, "body": "{}"})
        if "image" in kwargs["files"]:
            filename, handle = kwargs["files"]["image"]
            image = self.seed("image/", {"filename": filename})
            row = self.get(route)
            with self.connect() as connection:
                connection.execute("INSERT INTO bytes VALUES (?,?)", (image["pk"], handle.read()))
                row["image"] = f"/media/{image['pk']}"
                connection.execute("UPDATE rows SET body=? WHERE pk=?", (json.dumps(row), row["pk"]))
            if mode == "lost":
                raise ConnectionError("controlled applied image response lost")
            return SimpleNamespace(status_code=200)
        filename, handle = kwargs["files"]["attachment"]
        row = self.seed(route, {**kwargs["data"], "filename": filename})
        row["attachment"] = f"/media/{row['pk']}"
        with self.connect() as connection:
            connection.execute("UPDATE rows SET body=? WHERE pk=?", (json.dumps(row), row["pk"]))
            connection.execute("INSERT INTO bytes VALUES (?,?)", (row["pk"], handle.read()))
        if mode == "lost":
            raise ConnectionError("controlled applied response lost")
        return SimpleNamespace(status_code=201)

    def downloadFile(self, url: str, destination: str, **kwargs):
        self._call("download", url)
        with self.connect() as connection:
            content = connection.execute("SELECT content FROM bytes WHERE pk=?", (int(url.rsplit("/", 1)[-1]),)).fetchone()[0]
        Path(destination).write_bytes(content)
