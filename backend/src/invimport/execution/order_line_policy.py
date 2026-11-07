"""Read-only capability gate for distinct, source-priced PO contributions."""
from __future__ import annotations

from .stock_api import StockAPI


class OrderLineCapabilityError(ValueError):
    """The target has not advertised the required line-create controls."""


def order_line_policy(api: StockAPI, *, correlation: bool = False) -> dict:
    """Require explicit supported opt-outs; OPTIONS is evidence, not uniqueness.

    Current InvenTree defaults merge_items to true. Reference is not unique and
    cannot prevent that merge. Older/modified targets without advertised boolean
    write controls require review rather than silently merging contributions or
    replacing approved prices using supplier price breaks.
    """
    response = api.request("order/po-line/", method="OPTIONS")
    metadata = response.json()
    fields = metadata.get("actions", {}).get("POST", {}) if isinstance(metadata, dict) else {}
    evidence = {}
    for name in ("merge_items", "auto_pricing"):
        field = fields.get(name)
        if not isinstance(field, dict) or field.get("type") != "boolean" or field.get("read_only", False):
            raise OrderLineCapabilityError("PO line creation requires advertised writable merge_items and auto_pricing controls")
        evidence[name] = {key: field[key] for key in ("type", "read_only", "default") if key in field}
    if correlation:
        field = fields.get("reference")
        if (not isinstance(field, dict) or field.get("type") != "string" or field.get("read_only", False)
                or ("max_length" in field and (type(field["max_length"]) is not int or field["max_length"] < 77))):
            raise OrderLineCapabilityError("PO line creation requires a writable source contribution reference")
        evidence["reference"] = {key: field[key] for key in ("type", "read_only", "max_length") if key in field}
    return {"payload": {"merge_items": False, "auto_pricing": False}, "evidence": evidence}


def line_values_match(row: dict, *, quantity: object, price: object = None, currency: str = "") -> bool:
    """Validate numeric source intent without float rounding or automatic repricing."""
    from decimal import Decimal, InvalidOperation
    try:
        have, wanted = Decimal(str(row.get("quantity"))), Decimal(str(quantity))
        if not have.is_finite() or not wanted.is_finite() or have != wanted:
            return False
        if price is None:
            return True
        have, wanted = Decimal(str(row.get("purchase_price"))), Decimal(str(price))
        return have.is_finite() and wanted.is_finite() and have == wanted and row.get("purchase_price_currency") == currency
    except (InvalidOperation, ValueError):
        return False
