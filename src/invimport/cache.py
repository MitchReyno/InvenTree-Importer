"""
On-disk response cache, shared by every kind of request.

    .cache/.digikey/products/    productdetails payloads
    .cache/.digikey/orders/      order history pages and sales orders

One JSON file per request, named "{readable-key}__{digest}.json" so a cache
directory can be skimmed by eye while still tolerating keys with characters the
filesystem dislikes. Delete a directory (or pass --refresh) to force a refetch.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

# Root for all cached supplier responses, relative to the working directory.
CACHE_ROOT = Path(".cache")
DIGIKEY_ROOT = CACHE_ROOT / ".digikey"
PRODUCTS_DIR = DIGIKEY_ROOT / "products"
ORDERS_DIR = DIGIKEY_ROOT / "orders"


def cache_path(cache_dir: Path, key: str) -> Path:
    """Map a request key to its file. The digest keeps distinct keys distinct
    after the readable part is sanitised and truncated."""
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", key)[:60]
    return cache_dir / f"{safe}__{digest}.json"


def load(cache_dir: Path, key: str) -> dict[str, Any] | None:
    """Return the cached payload for a key, or None if it is not cached."""
    path = cache_path(cache_dir, key)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def store(cache_dir: Path, key: str, data: dict[str, Any]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path(cache_dir, key).write_text(json.dumps(data, indent=2), encoding="utf-8")
