"""Small helpers shared across commands."""

from __future__ import annotations

import re
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


_RANGE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$")


def parse_pages(text: Any) -> list[int] | None:
    """
    '140-142' or '3, 5-6' as 1-based page numbers, in the order given.

    None if the text is not a page list. Empty text is an empty list: no
    selection, keep the whole document.
    """
    raw = str(text if text is not None else "").strip()
    if not raw:
        return []
    pages: list[int] = []
    for chunk in raw.split(","):
        match = _RANGE.match(chunk)
        if not match:
            return None
        first = int(match.group(1))
        last = int(match.group(2) or first)
        if first < 1 or last < first:
            return None
        pages.extend(range(first, last + 1))
    return pages
