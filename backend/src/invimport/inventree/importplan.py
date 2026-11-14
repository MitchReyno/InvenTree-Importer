"""
A machine-readable account of what a stock import did, or would do, to the
server: for each line, whether its part, manufacturer part, supplier part and
location are new or already there, and what is already on the server for the
records it joins.

Written by `import-stock --plan FILE` beside the human-readable report, and
read by the interpretation montage so a reviewer can see, line by line, how
the import relates to existing stock - a new part, or 63 more of a part that
is already in a drawer.

The plan only reads. Images of existing parts are downloaded into a folder
next to the plan file so the montage can show them without credentials.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from requests import RequestException

from .collections import list_rows
from .api import InvenTreeError
from .parts import UNRESOLVED_PK
from .stockimport import NOTES_KEPT, LineAction

log = logging.getLogger(__name__)

PLAN_VERSION = 1
NEW_LOCATION_SUFFIX = " (new location)"


def _exists(pk: int | None) -> bool:
    return pk not in (None, UNRESOLVED_PK)


def _record(pk: int | None) -> dict[str, Any] | None:
    """None when there is no such record; otherwise its pk and whether it is new."""
    if pk is None:
        return None
    return {"pk": pk if _exists(pk) else None, "exists": _exists(pk)}


class PlanBuilder:
    """Looks up each existing record once, however many lines touch it."""

    def __init__(self, api, image_dir: Path | None):
        self.api = api
        self.image_dir = image_dir
        self._parts: dict[int, dict[str, Any]] = {}
        self._stock: dict[int, dict[str, Any]] = {}

    def _get(self, route: str, **params) -> Any:
        try:
            response = self.api.get(route, params=params or None)
        except RequestException as exc:
            raise InvenTreeError(f"plan: could not read {route}") from exc
        if response is None:
            raise InvenTreeError(f"plan: no response from {route}")
        return response

    def _image(self, pk: int, url: str) -> str:
        """Download a part's server image; the path relative to the plan."""
        if not (url and self.image_dir):
            return ""
        suffix = Path(url.split("?")[0]).suffix or ".jpg"
        dest = self.image_dir / f"part-{pk}{suffix}"
        try:
            self.image_dir.mkdir(parents=True, exist_ok=True)
            if not dest.exists():
                downloaded = self.api.downloadFile(url, str(dest))
                if downloaded is False or not dest.is_file():
                    raise OSError("download did not produce an image file")
        except (RequestException, OSError) as exc:
            log.warning("    plan: could not download image of part %s: %s",
                        pk, exc)
            return ""
        return f"{self.image_dir.name}/{dest.name}"

    def stock_item(self, pk: int) -> dict[str, Any]:
        if pk not in self._stock:
            s = self._get(f"stock/{pk}/", location_detail="true") or {}
            loc = s.get("location_detail") or {}
            self._stock[pk] = {
                "pk": pk, "part": s.get("part"),
                "quantity": s.get("quantity"), "batch": s.get("batch") or "",
                "packaging": s.get("packaging") or "",
                "location": loc.get("pathstring") or "",
            }
        return self._stock[pk]

    def part(self, pk: int) -> dict[str, Any]:
        if pk not in self._parts:
            p = self._get(f"part/{pk}/", path_detail="true") or {}
            items = list_rows(self.api, "stock/", params={
                "part": pk, "location_detail": "true"})
            self._parts[pk] = {
                "pk": pk, "ipn": p.get("IPN") or "", "name": p.get("name") or "",
                "category": p.get("category_path") and "/".join(
                    c.get("name", "") for c in p["category_path"]) or "",
                "has_image": bool(p.get("image")),
                "image": self._image(pk, p.get("image") or ""),
                "stock": [{
                    "pk": s.get("pk"), "quantity": s.get("quantity"),
                    "batch": s.get("batch") or "",
                    "packaging": s.get("packaging") or "",
                    "location": (s.get("location_detail") or {}).get("pathstring") or "",
                } for s in items],
            }
        return self._parts[pk]

    def line(self, action: LineAction) -> dict[str, Any]:
        location = action.location or ""
        new_location = location.endswith(NEW_LOCATION_SUFFIX)
        if new_location:
            location = location[:-len(NEW_LOCATION_SUFFIX)]
        entry: dict[str, Any] = {
            "id": action.id, "action": action.action, "reason": action.reason,
            "quantity": action.quantity, "category": action.category,
            "ipn": action.ipn, "name": action.name, "part_of": action.part_of,
            "part": _record(action.part),
            "manufacturer_part": _record(action.manufacturer_part),
            "supplier_part": _record(action.supplier_part),
            "location": location, "new_location": new_location,
            "name_kept": action.name_kept,
            "part_notes_kept": action.part_notes == NOTES_KEPT,
            "manufacturer_part_notes_kept":
                action.manufacturer_part_notes == NOTES_KEPT,
            "stock_item": None,
            "existing_part": None,
        }
        part_pk = action.part if _exists(action.part) else None
        if _exists(action.stock_item):
            entry["stock_item"] = self.stock_item(action.stock_item)
            part_pk = part_pk or entry["stock_item"]["part"]
        if part_pk is not None:
            entry["existing_part"] = self.part(part_pk)
        return entry


def build_plan(api, document, result, *, image_dir: Path | None = None
               ) -> dict[str, Any]:
    """Build a plan; failed record reads raise rather than imply empty stock.

    Optional image downloads may fail with a warning. Record-read failures
    propagate as InvenTreeError, so callers must not publish an incomplete plan.
    """
    builder = PlanBuilder(api, image_dir)
    return {
        "plan_version": PLAN_VERSION,
        "file": str(document.path) if document.path else "",
        "file_id": document.file_id,
        "lines": [builder.line(a) for a in result.lines],
    }


def write_plan(path: Path, plans: list[dict[str, Any]]) -> None:
    """One plan, or a list of them when several files ran."""
    path.parent.mkdir(parents=True, exist_ok=True)
    body = plans[0] if len(plans) == 1 else plans
    path.write_text(json.dumps(body, indent=1, ensure_ascii=False))
