"""Persistent order effects for fresh-process DigiKey recovery tests."""
from __future__ import annotations

import json
import os

from requests import HTTPError

from tests.execution.stock_server import StockServer


class DigiKeyServer(StockServer):
    def update(self, row: dict) -> None:
        with self.connect() as connection:
            connection.execute("UPDATE rows SET body=? WHERE pk=?", (json.dumps(row), row["pk"]))

    def post(self, route: str, payload: dict):
        if route == "order/po-line/":
            # Model the documented dangerous default: source reference is not a
            # unique key and does not opt out of same-part contribution merging.
            if payload.get("merge_items", True):
                matches = self.get(route, params={"order": payload["order"], "part": payload["part"]})
                if matches:
                    from decimal import Decimal
                    row = matches[0]
                    row["quantity"] = str(Decimal(str(row["quantity"])) + Decimal(str(payload["quantity"])))
                    self.update(row)
                    self._call("post", route)
                    return row
            if payload.get("auto_pricing", False):
                payload = {**payload, "purchase_price": "999", "purchase_price_currency": "USD"}
        if not route.endswith(("/issue/", "/receive/")):
            row = super().post(route, payload)
            if isinstance(row, dict) and route == "order/po/":
                row.setdefault("status", 10)
                self.update(row)
            if isinstance(row, dict) and route == "order/po-line/":
                row.setdefault("received", "0")
                self.update(row)
            return row
        self._call("post", route)
        mode = self._fault(route)
        if mode == "rejected":
            raise HTTPError({"status_code": 400, "body": "{}"})
        order = self.get("/".join(route.split("/")[:-2]) + "/")
        if route.endswith("/issue/"):
            order["status"] = 20
            self.update(order)
        else:
            from decimal import Decimal
            for index, item in enumerate(payload["items"]):
                if mode == "partial" and index > 0:
                    continue
                line = self.get(f"order/po-line/{item['line_item']}/")
                line["received"] = str(Decimal(str(line.get("received", 0))) + Decimal(str(item["quantity"])))
                self.update(line)
                self.seed("stock/", {"purchase_order": order["pk"], "supplier_part": item["supplier_part"],
                                     "quantity": item["quantity"], "location": payload["location"]})
        if mode == "crash":
            os._exit(71)
        if mode in {"lost", "partial"}:
            raise ConnectionError("applied response lost")
        return {}
