"""Capability evidence for source-owned purchase order metadata."""
from __future__ import annotations


class OrderDateCapabilityError(ValueError):
    pass


def creation_date_policy(metadata: object) -> dict:
    """Require an advertised writable historical date; never substitute today."""
    fields = metadata.get("actions", {}).get("POST", {}) if isinstance(metadata, dict) else {}
    field = fields.get("creation_date")
    if not isinstance(field, dict) or field.get("type") != "date" or field.get("read_only", False):
        raise OrderDateCapabilityError("historical order date requires an advertised writable creation_date")
    return {key: field[key] for key in ("type", "read_only") if key in field}
