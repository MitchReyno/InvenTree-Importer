"""
Company logos: which companies lack one, and filling them in.

    from invimport.inventree.companies import missing_logos, set_logos

    for company in missing_logos(api):
        print(company.pk, company.name)
    set_logos(api, {"YAGEO": {"image": "logos/yageo.png"}}, write=True)

A logo is only ever added. A company that already has one keeps it, because
the picture on the server may be one somebody chose by hand, and there is no
way to tell that from one an earlier run uploaded.

Names are matched the way manufacturer and supplier names are everywhere else:
normalised. Nothing is fuzzy-matched - a logo on the wrong company is
worse than none.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..execution.transport import exception_reason
from .collections import list_models
from .. import cache
from . import ledger
from .api import Company, ManufacturerPart, PurchaseOrder, SupplierPart
from .matching import candidates, match_name
from .parts import resolve_image_source
from .purchase_orders import attachments

log = logging.getLogger(__name__)

LIST_LIMIT = 1000

# What became of one company's logo.
SET = "set"
WOULD_SET = "would set"
HAS_ONE = "has one"
EXISTING = "on the server - left alone"
NOT_FOUND = "not on the server"
FAILED = "failed"


@dataclass
class LogoAction:
    name: str                                    # as the file gives it
    action: str
    image: str = ""                              # as the file gives it
    company: str = ""                            # the server's name for it
    pk: int | None = None
    reason: str = ""


def list_companies(api) -> list[Any]:
    """Every company, name-sorted for a stable listing."""
    companies = list_models(Company, api, limit=LIST_LIMIT)
    return sorted(companies, key=lambda c: str(getattr(c, "name", "")).lower())


def missing_logos(api) -> list[Any]:
    """The companies with no image set."""
    return [c for c in list_companies(api) if not getattr(c, "image", None)]


def set_logos(api, companies: dict[str, dict[str, str]], *,
              write: bool = False,
              base_dir: Path | None = None,
              only_created: set[int] | None = None,
              cache_dir: Path = cache.IMAGES_DIR) -> list[LogoAction]:
    """
    Upload each company's logo where it has none. Returns one action each.

    only_created: an import's logos, which are for the companies it creates -
    the pks it created. A company already on the server before the import is
    left alone, logo or not (giving one of those a logo is `invimport
    company-logos`); a dry run cannot find the ones it would create, so they
    are reported as would-set rather than missing.
    """
    server = list_companies(api)
    by_name = {str(getattr(c, "name", "")): c for c in server}
    actions: list[LogoAction] = []
    for name, entry in companies.items():
        image = entry.get("image", "")
        action = LogoAction(name=name, action=FAILED, image=image)
        actions.append(action)

        matched = match_name(name, list(by_name))
        company = by_name.get(matched) if matched else None
        if company is None:
            if only_created is not None and not write:
                action.action = WOULD_SET
                action.reason = "not on the server yet; set when the import creates it"
            else:
                action.action = NOT_FOUND
            continue
        action.company = str(company.name)
        action.pk = company.pk
        if only_created is not None and company.pk not in only_created:
            action.action = EXISTING
            continue
        if getattr(company, "image", None):
            action.action = HAS_ONE
            continue

        path = resolve_image_source(image, cache_dir, base_dir=base_dir)
        if path is None:
            action.reason = "not a file, and would not download"
            continue
        if not write:
            action.action = WOULD_SET
            continue
        try:
            company.uploadImage(str(path))
        except Exception as exc:
            log.warning("    [warn] could not upload a logo for %s: %s",
                        company.name, exc)
            action.reason = exception_reason(exc)
            continue
        ledger.note("company", company.pk, ledger.IMAGE_SET,
                    **ledger.file_facts(path))
        action.action = SET
    return actions


SHOW_ROWS = 8


def find_company(api, name: str) -> tuple[Any | None, list[str]]:
    """The company a name means, or None and the closest names on the server."""
    server = list_companies(api)
    by_name = {str(getattr(c, "name", "")): c for c in server}
    matched = match_name(name, list(by_name))
    if matched in by_name:
        return by_name[matched], []
    return None, [n for n, _ in candidates(name, list(by_name))]


def company_details(api, company) -> dict[str, Any]:
    """
    What the server knows that helps say who a company is: its own fields,
    and samples of what it is attached to - a
    supplier's SKUs and listing links, a maker's part numbers, the orders.
    """
    pk = company.pk
    details: dict[str, Any] = {
        "pk": pk, "name": str(company.name),
        "manufacturer": bool(getattr(company, "is_manufacturer", False)),
        "supplier": bool(getattr(company, "is_supplier", False)),
    }
    for key in ("website", "email", "phone", "description", "notes",
                "currency", "image"):
        value = getattr(company, key, None)
        if value:
            details[key] = str(value)
    if details["supplier"]:
        parts = list_models(SupplierPart, api, supplier=pk, limit=LIST_LIMIT)
        details["supplier_parts"] = len(parts)
        details["skus"] = [
            {"sku": str(p.SKU), **({"link": str(p.link)}
                                   if getattr(p, "link", "") else {})}
            for p in parts[:SHOW_ROWS]]
        orders = list_models(PurchaseOrder, api, supplier=pk, limit=LIST_LIMIT)
        details["orders"] = [
            " ".join(str(v) for v in (o.reference,
                                      getattr(o, "supplier_reference", ""),
                                      getattr(o, "issue_date", "")) if v)
            for o in orders[:SHOW_ROWS]]
    if details["manufacturer"]:
        made = list_models(ManufacturerPart, api, manufacturer=pk, limit=LIST_LIMIT)
        details["manufacturer_parts"] = len(made)
        details["mpns"] = [str(m.MPN) for m in made[:SHOW_ROWS]]
    details["attachments"] = [
        str(a.get("filename") or a.get("attachment") or "")
        for a in attachments(api, "company", pk)][:SHOW_ROWS]
    return {k: v for k, v in details.items() if v not in ([], None)}
