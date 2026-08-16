"""Small helpers shared across commands."""

from __future__ import annotations

from typing import Any


def absolute_url(url: Any, scheme: str = "https") -> str | None:
    """
    A URL InvenTree will accept, or None.

    DigiKey often sends protocol-relative datasheets ('//mm.digikey.com/...')
    which fail the server's URL validator. A leading '//' becomes https.
    Blank or scheme-less values are dropped rather than posted.
    """
    if url is None:
        return None
    text = str(url).strip()
    if not text:
        return None
    if text.startswith("//"):
        return f"{scheme}:{text}"
    if "://" in text:
        return text
    return None


def dig(obj: Any, *path: str, default=None):
    """Safe nested lookup. Suppliers occasionally reshape their payloads."""
    cur = obj
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur if cur not in ("", None) else default
