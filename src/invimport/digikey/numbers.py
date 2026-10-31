"""Exact JSON number handling at vendor/cache/export and durable input boundaries."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import json
import math


def lossless_float(text: str) -> float:
    """Keep legacy numeric interfaces only when JSON roundtrip preserves value.

    A numeric source that would acquire a different decimal value on export is
    rejected before caching/export. Exact decimal strings remain supported.
    """
    value = float(text)
    if not math.isfinite(value) or Decimal(str(value)) != Decimal(text):
        raise ValueError("numeric JSON value loses precision; supply an exact decimal string")
    return value


def reject_nonfinite(value: str) -> None:
    raise ValueError("nonfinite JSON numbers are unsupported")


def load_exact(text: str) -> object:
    """Freeze decimal JSON lexemes as JSON-safe strings, without binary floats."""
    return json.loads(text, parse_float=str, parse_constant=reject_nonfinite)


def supported_decimal(value: object) -> str:
    """Canonicalize without a Decimal context; bound source to13+6 digits.

    The supported PO price/quantity slice permits13 integer and6 fractional
    digits. Values outside that declared bound require review, not rounding.
    Trailing zeroes do not add precision and zero has one canonical form.
    """
    try:
        parsed = Decimal(str(value))
    except (ValueError, InvalidOperation):
        raise ValueError("quantity/price must be a finite nonnegative decimal") from None
    if not parsed.is_finite() or parsed < 0:
        raise ValueError("quantity/price must be a finite nonnegative decimal")
    if parsed.is_zero():
        return "0"
    _, digits, exponent = parsed.as_tuple()
    while digits[-1] == 0:
        digits, exponent = digits[:-1], exponent + 1
    if max(0, len(digits) + exponent) > 13 or max(0, -exponent) > 6:
        raise ValueError("quantity/price exceeds 13 integer and 6 fractional digits")
    text = format(parsed, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def freeze_library_source(value: object) -> object:
    """Copy JSON source values, retaining explicitly supplied Decimal lexemes."""
    def decimal_text(item: object) -> str:
        if isinstance(item, Decimal):
            return str(item)
        raise TypeError("unsupported DigiKey source value")
    return json.loads(json.dumps(value, default=decimal_text, allow_nan=False))
