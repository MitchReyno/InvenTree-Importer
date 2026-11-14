"""Stable source-order namespace shared by durable and supported legacy writers."""
from __future__ import annotations


def order_namespace(supplier: int, sales_order_id: object) -> str:
    if type(sales_order_id) not in {int, str}:
        raise ValueError("DigiKey sales order requires a scalar original ID")
    value = str(sales_order_id or "").strip()
    if not value or value == "None":
        raise ValueError("DigiKey sales order requires its original ID")
    return f"digikey:{supplier}:{value}"
