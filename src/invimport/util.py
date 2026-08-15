"""Small helpers shared across commands."""

from __future__ import annotations

from typing import Any


def dig(obj: Any, *path: str, default=None):
    """Safe nested lookup. Suppliers occasionally reshape their payloads."""
    cur = obj
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur if cur not in ("", None) else default
