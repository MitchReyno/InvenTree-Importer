"""
Find-or-create Part, ManufacturerPart and SupplierPart from DigiKey SKUs.

    from invimport.inventree.parts import import_supplier_parts

    result = import_supplier_parts(["296-1411-1-ND"], write=True)
    print(result.counts())

Idempotent: a SKU that is already a supplier part is reported and left
alone. A Part is matched by the category's identity rule - MPN via an
existing ManufacturerPart, or the parameter signature - never by the
generated name, so changing a name template does not duplicate parts.

The library never prompts. Manufacturer matching is normalise, then a
learned alias, then `choose_manufacturer` if the caller supplied one.
Without a chooser, and without create_manufacturers, an unknown
manufacturer skips the SKU. Nothing is guessed: a part under the wrong
manufacturer is tedious to unpick.

Order of writes: manufacturer (if creating one) → Part → parameters →
ManufacturerPart → SupplierPart. Manufacturer is resolved before any
Part is created, so a skip leaves no dangling record.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterable

from .. import cache
from ..config import (
    CONFIG_DIR,
    CategoryConfig,
    ManufacturerConfig,
    ParameterConfig,
    load_categories_config,
    load_manufacturers_config,
    load_parameters_config,
)
from ..digikey.products import fetch_image, fetch_products
from .api import (
    PART_MODEL_TYPE,
    Company,
    ManufacturerPart,
    Parameter,
    ParameterTemplate,
    Part,
    PartCategory,
    SupplierPart,
    connect,
)
from .matching import (
    candidates,
    manufacturer_aliases,
    match_name,
    match_path,
    path_text,
)
from ..util import absolute_url
from .purchase_orders import find_supplier, supplier_parts_by_sku
from .values import compact_for_name, from_supplier, parse_quantity

log = logging.getLogger(__name__)

UNRESOLVED_PK = -1
IPN_WIDTH = 6
LIST_LIMIT = 1000

# Words skipped when turning "Integrated Circuits" into "IC".
PREFIX_SKIP = frozenset({"and", "of", "the", "or", "for"})

ChooseManufacturer = Callable[[str, list[tuple[Any, float]]], Any | str | None]


@dataclass
class SkuAction:
    """What happened (or would happen) to one DigiKey SKU."""
    sku: str
    action: str                                  # created | exists | skipped
    reason: str = ""
    part: int | None = None
    manufacturer_part: int | None = None
    supplier_part: int | None = None
    ipn: str = ""
    name: str = ""
    category: str = ""
    product: dict[str, Any] | None = None

    def describe(self) -> str:
        if not self.product:
            return ""
        bits = [str(self.product.get(field)) for field in
                ("manufacturer_part", "description")
                if self.product.get(field)]
        return "  ".join(bits)


@dataclass
class PartImportResult:
    skus: list[SkuAction] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "created": sum(1 for s in self.skus if s.action == "created"),
            "exists": sum(1 for s in self.skus if s.action == "exists"),
            "skipped": sum(1 for s in self.skus if s.action == "skipped"),
            "problems": len(self.problems),
        }

    def imported_skus(self) -> set[str]:
        """SKUs that are, or would be, supplier parts after this run."""
        return {s.sku.strip().upper() for s in self.skus
                if s.action in ("created", "exists")}


# --------------------------------------------------------------------------
# Naming and IPNs
# --------------------------------------------------------------------------
def ipn_prefix(category: CategoryConfig) -> str:
    """
    The prefix of a meaningless IPN, from the top-level category name.

    'Resistors' -> 'R', 'Integrated Circuits' -> 'IC'. Small words are
    dropped so '&' and 'of' do not become letters.
    """
    words = re.findall(r"[A-Za-z0-9]+", category.path[0] if category.path else "")
    letters = [word[0].upper() for word in words
               if word.casefold() not in PREFIX_SKIP]
    return "".join(letters) or "P"


def next_ipn(api, prefix: str) -> str:
    """The next unused '{prefix}-000001' on the server."""
    existing = Part.list(api, IPN_regex=rf"^{re.escape(prefix)}-\d+$",
                         limit=LIST_LIMIT)
    numbers: list[int] = []
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$", re.IGNORECASE)
    for part in existing:
        match = pattern.match(str(getattr(part, "IPN", "") or ""))
        if match:
            numbers.append(int(match.group(1)))
    nxt = max(numbers) + 1 if numbers else 1
    width = max(IPN_WIDTH, len(str(nxt)))
    return f"{prefix}-{nxt:0{width}d}"


def fill_name(template: str, values: dict[str, str],
              parameters: dict[str, ParameterConfig]) -> str:
    """
    Fill a category name template from stored parameter values.

    Unit-bearing values are compacted without the unit, because the
    template already writes '%', 'W', 'V' next to the placeholder:
    '100 kΩ' -> '100k', '1 %' -> '1', '250 mW' -> '0.25'.
    """
    def replacer(match: re.Match) -> str:
        key = match.group(1)
        text = values.get(key)
        if text is None:
            return ""
        parameter = parameters.get(key)
        if parameter and parameter.units:
            magnitude = parse_quantity(text, parameter.units)
            if magnitude is not None:
                return compact_for_name(magnitude)
        return text

    return re.sub(r"\{([^}]+)\}", replacer, template).strip()


def part_name(category: CategoryConfig, mpn: str, values: dict[str, str],
              parameters: dict[str, ParameterConfig]) -> str:
    if category.identity == "spec" and category.name_template:
        name = fill_name(category.name_template, values, parameters)
        if name:
            return name
    return mpn


# --------------------------------------------------------------------------
# Matching existing parts
# --------------------------------------------------------------------------
def values_match(left: str, right: str, parameter: ParameterConfig | None) -> bool:
    """Are two stored parameter values the same quantity or the same text?"""
    if left == right:
        return True
    if parameter and parameter.units:
        a = parse_quantity(left, parameter.units)
        b = parse_quantity(right, parameter.units)
        if a is not None and b is not None:
            scale = max(abs(a), abs(b), 1.0)
            return abs(a - b) <= 1e-6 * scale
    return str(left).strip() == str(right).strip()


def find_part_by_mpn(api, mpn: str) -> Any | None:
    """The Part that already has this manufacturer part number, or None."""
    if not mpn:
        return None
    found = ManufacturerPart.list(api, MPN=mpn, limit=LIST_LIMIT)
    if not found:
        return None
    pk = getattr(found[0], "part", None)
    if pk is None:
        return None
    matches = Part.list(api, limit=LIST_LIMIT)
    return next((part for part in matches if part.pk == pk), None)


def find_part_by_spec(
    api,
    category_pk: int,
    key_parameters: list[str],
    values: dict[str, str],
    templates: dict[str, Any],
    parameters: dict[str, ParameterConfig],
) -> Any | None:
    """
    The Part in this category whose key parameters match `values`.

    Compared as quantities when the template has units, so '100' and
    '100 kΩ' are the same resistance. A missing key on either side is
    not a match.
    """
    if not key_parameters:
        return None
    needed = [name for name in key_parameters if name in values]
    if len(needed) != len(key_parameters):
        return None

    parts = Part.list(api, category=category_pk, limit=LIST_LIMIT)
    if not parts:
        return None

    stored = Parameter.list(api, model_type=PART_MODEL_TYPE, limit=LIST_LIMIT)
    by_part: dict[int, dict[int, str]] = {}
    for row in stored:
        model_id = getattr(row, "model_id", None)
        template = getattr(row, "template", None)
        if model_id is None or template is None:
            continue
        by_part.setdefault(int(model_id), {})[int(template)] = str(row.data)

    template_pk = {name: tmpl.pk for name, tmpl in templates.items()}

    for part in parts:
        have = by_part.get(part.pk, {})
        matched = True
        for name in key_parameters:
            tmpl_pk = template_pk.get(name)
            if tmpl_pk is None or tmpl_pk not in have:
                matched = False
                break
            if not values_match(have[tmpl_pk], values[name],
                                parameters.get(name)):
                matched = False
                break
        if matched:
            return part
    return None


# --------------------------------------------------------------------------
# Manufacturers
# --------------------------------------------------------------------------
def list_manufacturers(api) -> list[Any]:
    companies = Company.list(api, is_manufacturer=True, limit=LIST_LIMIT)
    return sorted(companies, key=lambda c: str(getattr(c, "name", "")).lower())


def create_manufacturer(api, name: str) -> Any:
    company = Company.create(api, {
        "name": name,
        "is_manufacturer": True,
        "is_supplier": False,
    })
    log.info("    created manufacturer %r (pk=%s)", name, company.pk)
    return company


def resolve_manufacturer(
    api,
    name: str,
    manufacturers: dict[str, ManufacturerConfig],
    *,
    choose: ChooseManufacturer | None = None,
    create: bool = False,
    write: bool = False,
    cache: dict[str, Any] | None = None,
) -> Any | None:
    """
    The manufacturer Company this supplier spelling means, or None.

    cache remembers a decision for the rest of the run so the same
    DigiKey name is not asked about twice.
    """
    if not name or not name.strip():
        return None
    name = name.strip()
    if cache is not None and name in cache:
        return cache[name]

    existing = list_manufacturers(api)
    names = [c.name for c in existing]
    matched = match_name(name, names, manufacturer_aliases(manufacturers))
    company = None
    if matched:
        company = next((c for c in existing if c.name == matched), None)
        if company is None and (create or write):
            # A learned alias names a company the server does not have yet.
            if write:
                company = create_manufacturer(api, matched)
            else:
                company = SimpleNamespace(pk=UNRESOLVED_PK, name=matched)

    if company is None and create:
        if write:
            company = create_manufacturer(api, name)
        else:
            company = SimpleNamespace(pk=UNRESOLVED_PK, name=name)

    if company is None and choose is not None:
        offered = [(c, score) for c, score in
                   ((next((x for x in existing if x.name == n), None), s)
                    for n, s in candidates(name, names))
                   if c is not None]
        picked = choose(name, offered)
        if isinstance(picked, str) and picked.strip():
            if write:
                company = create_manufacturer(api, picked.strip())
            else:
                company = SimpleNamespace(pk=UNRESOLVED_PK, name=picked.strip())
        elif picked is not None and not isinstance(picked, str):
            company = picked

    if cache is not None:
        cache[name] = company
    return company


# --------------------------------------------------------------------------
# Parameters on a part
# --------------------------------------------------------------------------
def apply_parameters(
    api,
    part_pk: int,
    values: dict[str, str],
    templates: dict[str, Any],
    *,
    write: bool,
    update: bool = False,
) -> None:
    """Create missing parameter values; optionally overwrite drifted ones."""
    if part_pk == UNRESOLVED_PK or not values:
        return
    existing = Parameter.list(api, model_type=PART_MODEL_TYPE,
                              model_id=part_pk, limit=LIST_LIMIT)
    by_template = {int(p.template): p for p in existing
                   if getattr(p, "template", None) is not None}

    for name, value in values.items():
        template = templates.get(name)
        if template is None:
            continue
        current = by_template.get(template.pk)
        if current is None:
            if write:
                Parameter.create(api, {
                    "model_type": PART_MODEL_TYPE,
                    "model_id": part_pk,
                    "template": template.pk,
                    "data": value,
                })
        elif update and str(current.data) != value and write:
            current.save(data={"data": value})


# --------------------------------------------------------------------------
# Images
# --------------------------------------------------------------------------
def attach_part_image(part, path: Path) -> bool:
    """Upload a cached image as the part's primary picture. Failures log."""
    if getattr(part, "image", None):
        return False
    try:
        part.uploadImage(str(path))
        return True
    except Exception as exc:
        log.warning("    [warn] could not upload image for part %s: %s",
                    getattr(part, "pk", "?"), exc)
        return False


def cache_product_images(product: dict[str, Any], cache_dir: Path,
                         refresh: bool = False) -> list[Path]:
    """Download every product image into the cache. Missing URLs are skipped."""
    paths: list[Path] = []
    for url in product.get("images") or []:
        path = fetch_image(url, cache_dir=cache_dir, refresh=refresh)
        if path is not None:
            paths.append(path)
    if not paths and product.get("image"):
        path = fetch_image(product["image"], cache_dir=cache_dir,
                           refresh=refresh)
        if path is not None:
            paths.append(path)
    return paths


# --------------------------------------------------------------------------
# One SKU
# --------------------------------------------------------------------------
def _skipped(sku: str, reason: str, product=None, **kw) -> SkuAction:
    return SkuAction(sku, "skipped", reason=reason, product=product, **kw)


def import_sku(
    sku: str,
    product: dict[str, Any],
    api,
    *,
    categories: dict[str, CategoryConfig],
    parameters: dict[str, ParameterConfig],
    manufacturers: dict[str, ManufacturerConfig],
    server_categories: dict[str, Any],
    templates: dict[str, Any],
    supplier_parts: dict[str, Any],
    supplier: int,
    write: bool,
    update_parameters: bool,
    create_manufacturers: bool,
    choose_manufacturer: ChooseManufacturer | None,
    manufacturer_cache: dict[str, Any],
    image_cache_dir: Path,
    refresh: bool,
) -> SkuAction:
    """Find-or-create the records one SKU needs. Does not fetch."""
    existing = supplier_parts.get(sku.strip().upper())
    if existing is not None:
        return SkuAction(sku, "exists",
                         part=getattr(existing, "part", None),
                         supplier_part=existing.pk,
                         product=product)

    if product.get("error"):
        return _skipped(sku, product["error"], product)

    path = product.get("category_path") or []
    category = match_path(path, categories)
    if category is None:
        text = path_text(path) or "(no category)"
        return _skipped(sku, f"unmapped category {text}", product)

    if category.structural:
        return _skipped(sku, f"category {category.pathstring} is structural",
                        product, category=category.pathstring)

    server_cat = server_categories.get(category.pathstring)
    if server_cat is None:
        return _skipped(
            sku,
            f"category {category.pathstring} is not on the server "
            f"- run invimport categories --write",
            product, category=category.pathstring)

    mpn = str(product.get("manufacturer_part") or "").strip()
    if not mpn:
        return _skipped(sku, "product has no manufacturer part number", product)

    manufacturer = resolve_manufacturer(
        api, str(product.get("manufacturer_name") or ""),
        manufacturers, choose=choose_manufacturer,
        create=create_manufacturers, write=write, cache=manufacturer_cache)
    if manufacturer is None:
        return _skipped(
            sku,
            f"unresolved manufacturer "
            f"{product.get('manufacturer_name')!r}",
            product, category=category.pathstring)

    values = from_supplier(product.get("parameters") or {}, parameters,
                           category.parameters)

    if category.identity == "spec":
        part = find_part_by_spec(api, server_cat.pk, category.key_parameters,
                                 values, templates, parameters)
    else:
        part = find_part_by_mpn(api, mpn)

    ipn = str(getattr(part, "IPN", "") or "") if part is not None else ""
    name = str(getattr(part, "name", "") or "") if part is not None else ""

    if part is None:
        name = part_name(category, mpn, values, parameters)
        ipn = next_ipn(api, ipn_prefix(category))
        if write:
            payload = {
                "name": name,
                "description": str(product.get("description") or "")[:250],
                "category": server_cat.pk,
                "IPN": ipn,
            }
            link = (absolute_url(product.get("datasheet"))
                    or absolute_url(product.get("link")))
            if link:
                payload["link"] = link
            part = Part.create(api, payload)
            apply_parameters(api, part.pk, values, templates, write=True)
        else:
            part = SimpleNamespace(pk=UNRESOLVED_PK, IPN=ipn, name=name)
    elif write and update_parameters:
        apply_parameters(api, part.pk, values, templates,
                         write=True, update=True)

    mfr_part = None
    if part.pk != UNRESOLVED_PK:
        found = ManufacturerPart.list(api, part=part.pk, MPN=mpn,
                                      limit=LIST_LIMIT)
        mfr_part = found[0] if found else None
        if mfr_part is None and write:
            payload = {
                "part": part.pk,
                "manufacturer": manufacturer.pk,
                "MPN": mpn,
            }
            datasheet = absolute_url(product.get("datasheet"))
            if datasheet:
                payload["link"] = datasheet
            if product.get("description"):
                payload["description"] = str(product["description"])[:250]
            mfr_part = ManufacturerPart.create(api, payload)

    supplier_part = None
    if write and part.pk != UNRESOLVED_PK:
        payload = {
            "part": part.pk,
            "supplier": supplier,
            "SKU": sku,
            "packaging": str(product.get("packaging") or "")[:50],
            "pack_quantity": str(product.get("pack_quantity") or ""),
        }
        if mfr_part is not None:
            payload["manufacturer_part"] = mfr_part.pk
        page = absolute_url(product.get("link"))
        if page:
            payload["link"] = page               # DigiKey product page
        if product.get("description"):
            payload["description"] = str(product["description"])[:250]
        supplier_part = SupplierPart.create(api, payload)
        supplier_parts[sku.strip().upper()] = supplier_part

    images = cache_product_images(product, image_cache_dir, refresh=refresh)
    if write and part.pk != UNRESOLVED_PK and images:
        attach_part_image(part, images[0])

    return SkuAction(
        sku, "created",
        part=part.pk,
        manufacturer_part=getattr(mfr_part, "pk", None),
        supplier_part=getattr(supplier_part, "pk", None),
        ipn=ipn, name=name, category=category.pathstring,
        product=product,
    )


# --------------------------------------------------------------------------
# Public entrypoint
# --------------------------------------------------------------------------
def import_supplier_parts(
    skus: Iterable[str],
    api=None,
    *,
    write: bool = False,
    products: dict[str, dict[str, Any]] | None = None,
    categories: dict[str, CategoryConfig] | Path | str | None = None,
    parameters: dict[str, ParameterConfig] | None = None,
    manufacturers: dict[str, ManufacturerConfig] | None = None,
    directory: Path | str | None = None,
    supplier: Any = None,
    update_parameters: bool = False,
    create_manufacturers: bool = False,
    choose_manufacturer: ChooseManufacturer | None = None,
    fetch: bool = True,
    cache_dir: Path | None = None,
    image_cache_dir: Path | None = None,
    refresh: bool = False,
) -> PartImportResult:
    """
    Find-or-create the InvenTree records each SKU needs.

    products maps an upper-cased SKU to a fetch_products() row. Missing
    SKUs are fetched unless fetch=False. supplier is a Company or pk; omit
    it to use the DigiKey supplier already on the server.

    choose_manufacturer(name, [(company, score), ...]) returns an existing
    Company, a name to create, or None to skip. The CLI writes the answer
    back to manufacturers.yaml; this function does not.
    """
    api = api or connect()
    directory = Path(directory) if directory is not None else CONFIG_DIR
    if categories is None or isinstance(categories, (str, Path)):
        categories = load_categories_config(
            Path(categories) if isinstance(categories, (str, Path))
            else directory)
    if parameters is None:
        parameters = load_parameters_config(directory)
    if manufacturers is None:
        manufacturers = load_manufacturers_config(directory)

    wanted = [sku.strip() for sku in skus if sku and sku.strip()]
    result = PartImportResult()
    if not wanted:
        return result

    if supplier is None:
        supplier = find_supplier(api)
    if supplier is None:
        result.problems.append(
            "no DigiKey supplier on the server - create one, or pass supplier=")
        for sku in wanted:
            result.skus.append(_skipped(sku, "no DigiKey supplier"))
        return result
    supplier_pk = supplier if isinstance(supplier, int) else supplier.pk

    rows = products or {}
    missing = [sku for sku in wanted
               if sku.strip().upper() not in {k.upper() for k in rows}]
    if missing and fetch:
        fetched = fetch_products(
            missing, cache_dir=cache_dir or cache.PRODUCTS_DIR,
            refresh=refresh)
        for row in fetched:
            rows[str(row["SKU"]).strip().upper()] = row
    indexed = {str(key).strip().upper(): value for key, value in rows.items()}

    server_categories = {c.pathstring: c
                         for c in PartCategory.list(api, limit=LIST_LIMIT)
                         if getattr(c, "pathstring", None)}
    templates = {t.name: t for t in ParameterTemplate.list(api, limit=LIST_LIMIT)}
    existing_parts = supplier_parts_by_sku(api, supplier_pk)
    manufacturer_cache: dict[str, Any] = {}

    for sku in wanted:
        product = indexed.get(sku.strip().upper()) or {
            "SKU": sku, "error": "no product data"}
        try:
            result.skus.append(import_sku(
                sku, product, api,
                categories=categories,
                parameters=parameters,
                manufacturers=manufacturers,
                server_categories=server_categories,
                templates=templates,
                supplier_parts=existing_parts,
                supplier=supplier_pk,
                write=write,
                update_parameters=update_parameters,
                create_manufacturers=create_manufacturers,
                choose_manufacturer=choose_manufacturer,
                manufacturer_cache=manufacturer_cache,
                image_cache_dir=image_cache_dir or cache.IMAGES_DIR,
                refresh=refresh,
            ))
        except Exception as exc:
            result.problems.append(f"{sku}: {exc}")
            result.skus.append(_skipped(sku, str(exc), product))

    return result
