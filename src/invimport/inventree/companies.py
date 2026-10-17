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
normalised, then through the learned aliases in manufacturers.yaml and
suppliers.yaml. Nothing is fuzzy-matched - a logo on the wrong company is
worse than none.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .. import cache
from ..config import CONFIG_DIR, load_manufacturers_config, load_suppliers_config
from .api import Company
from .matching import company_aliases, match_name
from .parts import resolve_image_source

log = logging.getLogger(__name__)

LIST_LIMIT = 1000

# What became of one company's logo.
SET = "set"
WOULD_SET = "would set"
HAS_ONE = "has one"
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
    companies = Company.list(api, limit=LIST_LIMIT)
    return sorted(companies, key=lambda c: str(getattr(c, "name", "")).lower())


def missing_logos(api) -> list[Any]:
    """The companies with no image set."""
    return [c for c in list_companies(api) if not getattr(c, "image", None)]


def config_aliases(directory: Path | str | None = None) -> dict[str, list[str]]:
    """The learned manufacturer and supplier aliases, together."""
    directory = Path(directory) if directory is not None else CONFIG_DIR
    aliases = company_aliases(load_manufacturers_config(directory))
    for name, spellings in company_aliases(
            load_suppliers_config(directory)).items():
        aliases.setdefault(name, []).extend(spellings)
    return aliases


def set_logos(api, companies: dict[str, dict[str, str]], *,
              write: bool = False,
              base_dir: Path | None = None,
              aliases: dict[str, list[str]] | None = None,
              created_by_run: bool = False,
              cache_dir: Path = cache.IMAGES_DIR) -> list[LogoAction]:
    """
    Upload each company's logo where it has none. Returns one action each.

    created_by_run: the names come from an import that creates the companies
    it lacks. A dry run of it cannot find them yet, so they are reported as
    would-set rather than as missing.
    """
    server = list_companies(api)
    by_name = {str(getattr(c, "name", "")): c for c in server}
    actions: list[LogoAction] = []
    for name, entry in companies.items():
        image = entry.get("image", "")
        action = LogoAction(name=name, action=FAILED, image=image)
        actions.append(action)

        matched = match_name(name, list(by_name), aliases)
        company = by_name.get(matched) if matched else None
        if company is None:
            if created_by_run and not write:
                action.action = WOULD_SET
                action.reason = "not on the server yet; set when the import creates it"
            else:
                action.action = NOT_FOUND
            continue
        action.company = str(company.name)
        action.pk = company.pk
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
            action.reason = str(exc)
            continue
        action.action = SET
    return actions
