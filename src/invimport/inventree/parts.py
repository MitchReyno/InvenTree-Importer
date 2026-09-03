"""
Find-or-create Part, ManufacturerPart and SupplierPart from DigiKey SKUs.

    from invimport.inventree.parts import import_supplier_parts

    result = import_supplier_parts(["296-1411-1-ND"], write=True)
    print(result.counts())

Idempotent: a SKU that is already a supplier part is reported and left
alone, unless update_parameters is set, in which case missing and drifted
parameter values are written on the existing Part, ManufacturerPart and
SupplierPart. A Part is matched by the category's identity rule - MPN via an
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
from concurrent.futures import ThreadPoolExecutor
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
    MANUFACTURER_PART_MODEL_TYPE,
    PART_MODEL_TYPE,
    SUPPLIER_PART_MODEL_TYPE,
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
from .discovery import Discovery, UnknownChoice, discover, unknown_choices

log = logging.getLogger(__name__)

UNRESOLVED_PK = -1
IPN_WIDTH = 5
LIST_LIMIT = 1000
# Concurrent POSTs for the values hanging off one record. A typical part
# carries a handful of parameters; each create is a round trip, so the
# workers are waiting on the server rather than on the CPU.
PARAMETER_WORKERS = 5

# Where a part whose category declares no ipn_prefix is numbered. A prefix is
# a deliberate choice - guessing one from the category name produces initials
# nobody recognises - so an unconfigured category lands here visibly instead.
FALLBACK_PREFIX = "MISC"

ChooseManufacturer = Callable[[str, list[tuple[Any, float]]], Any | str | None]
# sku, step, 1-based index, total. step is "start" or a write action
# (manufacturer, part, manufacturer_part, supplier_part, image).
OnStep = Callable[[str, str, int, int], None]
OnSku = Callable[["SkuAction"], None]
# Unmapped supplier fields / unknown choice spellings. The callback writes
# the answers back to the config; this function reloads afterwards.
OnLearnParameters = Callable[[list[Discovery]], None]
OnLearnChoices = Callable[[list[UnknownChoice]], None]


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
    # Parameter values written, per record. The part carries only the ones
    # that identify it; the manufacturer and supplier parts carry everything.
    part_parameters: int = 0
    manufacturer_parameters: int = 0
    supplier_parameters: int = 0

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
            "parameters": sum(s.part_parameters + s.manufacturer_parameters
                              + s.supplier_parameters for s in self.skus),
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
    The prefix of a meaningless IPN, as declared by the category.

    ipn_prefix is inherited, so it is normally set once on a top-level
    category and every child numbers under it: Capacitors -> CAP-00118. A
    subcategory worth counting separately overrides it - Potentiometers is
    POT, its Trimpots child is TRM.

    Categories sharing a prefix share one sequence, which is the point: DIO
    on both Signal Diodes and Zener Diodes numbers all diodes together.
    """
    return category.ipn_prefix or FALLBACK_PREFIX


def next_ipn(api, prefix: str) -> str:
    """The next unused '{prefix}-00001' on the server."""
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
    '100 k' -> '100k', '1' -> '1', '250 m' -> '0.25'.
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
                return compact_for_name(magnitude, parameter.prefixes,
                                        parameter.name_style)
        return text

    return re.sub(r"\{([^}]+)\}", replacer, template).strip()


def part_name(category: CategoryConfig, designator: str,
              values: dict[str, str],
              parameters: dict[str, ParameterConfig],
              description: str = "") -> str:
    """
    What to call a new part.

    A spec category fills its template from the values. Otherwise the
    designator names it - a type number or an MPN. Old stock sometimes has
    neither, and a description is better than an empty name.
    """
    if category.identity == "spec" and category.name_template:
        name = fill_name(category.name_template, values, parameters)
        if name:
            return name
    return designator or str(description or "")[:100]


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


def find_part_by_type(api, category_pk: int, designator: str) -> Any | None:
    """
    The Part in this category already named by this type designator.

    1N4007 from Diotec and 1N4007 from an unmarked bag are the same part for
    stock purposes - that is what a JEDEC number is for. So the designator is
    matched against the part name within the category, and who made it is
    recorded on the stock rather than used to tell two parts apart.
    """
    if not designator:
        return None
    wanted = designator.strip().casefold()
    for part in Part.list(api, category=category_pk, limit=LIST_LIMIT):
        if str(getattr(part, "name", "") or "").strip().casefold() == wanted:
            return part
    return None


def find_part_by_ipn(api, ipn: str) -> Any | None:
    """The Part with this IPN. An explicit override - no matching involved."""
    if not ipn:
        return None
    found = Part.list(api, IPN=ipn, limit=LIST_LIMIT)
    return found[0] if found else None


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

    Compared as quantities when the template has units, so '100 k' and
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
    model_id: int,
    values: dict[str, str],
    templates: dict[str, Any],
    *,
    write: bool,
    update: bool = False,
    model_type: str = PART_MODEL_TYPE,
) -> int:
    """
    Create missing parameter values; optionally overwrite drifted ones.

    model_type says what the values hang off - a Part, a ManufacturerPart or a
    SupplierPart. API 530 addresses all of them through the same endpoint, and
    the templates are model-agnostic, so the only difference is this field.

    Writes for one record are issued concurrently: each Parameter.create is
    its own round trip, and a part's values do not depend on each other.

    Returns how many values were created or updated.
    """
    if model_id in (None, UNRESOLVED_PK) or not values:
        return 0
    existing = Parameter.list(api, model_type=model_type,
                              model_id=model_id, limit=LIST_LIMIT)
    by_template = {int(p.template): p for p in existing
                   if getattr(p, "template", None) is not None}
    touched = 0
    writes: list[Callable[[], Any]] = []

    for name, value in values.items():
        template = templates.get(name)
        if template is None:
            continue
        current = by_template.get(template.pk)
        if current is None:
            if write:
                payload = {
                    "model_type": model_type,
                    "model_id": model_id,
                    "template": template.pk,
                    "data": value,
                }
                writes.append(lambda payload=payload: Parameter.create(api, payload))
            touched += 1
        elif update and str(current.data) != value:
            if write:
                writes.append(
                    lambda current=current, value=value: current.save(
                        data={"data": value}))
            touched += 1

    _write_parameters(writes)
    return touched


def _write_parameters(writes: list[Callable[[], Any]]) -> None:
    """Run the collected Parameter.create / save calls, concurrently if many."""
    if not writes:
        return
    if len(writes) == 1:
        writes[0]()
        return
    workers = min(PARAMETER_WORKERS, len(writes))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(lambda fn: fn(), writes))


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


def resolve_image_source(source: str, cache_dir: Path = cache.IMAGES_DIR,
                         *, base_dir: Path | None = None,
                         refresh: bool = False) -> Path | None:
    """
    A local image file, or a downloaded URL. Returns the file, or None.

    Relative paths are resolved against base_dir (the stock file's folder).
    Failures log and are skipped, matching DigiKey's missing-PhotoUrl
    behaviour: a part with no picture is better than an import that stops.
    """
    text = str(source or "").strip()
    if not text:
        return None
    url = absolute_url(text)
    if url:
        return fetch_image(url, cache_dir=cache_dir, refresh=refresh)
    path = Path(text).expanduser()
    if not path.is_absolute() and base_dir is not None:
        path = base_dir / path
    if path.is_file():
        return path
    log.warning("    [warn] image %s: not a file", source)
    return None


def attach_line_images(part, sources: list[str], *,
                       cache_dir: Path = cache.IMAGES_DIR,
                       base_dir: Path | None = None) -> bool:
    """Upload the first resolvable image as the part's picture."""
    if (not sources or part is None
            or getattr(part, "pk", None) in (None, UNRESOLVED_PK)
            or getattr(part, "image", None)):
        return False
    for source in sources:
        path = resolve_image_source(source, cache_dir, base_dir=base_dir)
        if path is not None:
            return attach_part_image(part, path)
    return False


# --------------------------------------------------------------------------
# The supplier-agnostic core
#
# A Part, its ManufacturerPart and their parameters are the same records
# whether the row came from a DigiKey payload or a file someone typed. What
# differs is only what the caller is willing to require: DigiKey always knows
# the MPN and the manufacturer, a hand-written list often knows neither.
#
# So the shape below carries the facts, PartPolicy carries the demands, and
# import_sku() is left as the DigiKey-specific part - the SKU and the
# supplier part. Images and URLs are shared: a file names them the same way
# a product payload does.
# --------------------------------------------------------------------------
@dataclass
class PartLine:
    """One part to find-or-create, described without reference to a supplier."""
    category_path: list[str] | str = ""      # supplier path, matched by alias
    category: CategoryConfig | None = None   # already resolved, by a file
    mpn: str = ""
    type: str = ""                           # type designator: 1N4007, XR-2206
    ipn: str = ""                            # explicit part, skips matching
    manufacturer: str = ""
    description: str = ""
    parameters: dict[str, str] = field(default_factory=dict)
    link: str = ""                           # product page
    datasheet: str = ""

    @classmethod
    def from_product(cls, product: dict[str, Any]) -> "PartLine":
        """The normalised row fetch_products() returns."""
        return cls(
            category_path=product.get("category_path") or [],
            mpn=str(product.get("manufacturer_part") or "").strip(),
            manufacturer=str(product.get("manufacturer_name") or ""),
            description=str(product.get("description") or ""),
            parameters=product.get("parameters") or {},
            link=str(product.get("link") or ""),
            datasheet=str(product.get("datasheet") or ""),
        )


@dataclass
class ImportContext:
    """Config and server lookups every line resolution needs."""
    categories: dict[str, CategoryConfig]
    parameters: dict[str, ParameterConfig]
    manufacturers: dict[str, ManufacturerConfig]
    server_categories: dict[str, Any]
    templates: dict[str, Any]
    manufacturer_cache: dict[str, Any] = field(default_factory=dict)


@dataclass
class PartPolicy:
    """
    What a caller insists on before a part may be created.

    The DigiKey path requires both, because a product payload that lacks
    either is a payload we failed to read. A file may legitimately supply
    neither - half of real stock has no MPN - so the file importer relaxes
    them and accepts a part with no ManufacturerPart at all.
    """
    require_mpn: bool = True
    require_manufacturer: bool = True
    create_manufacturers: bool = False
    choose_manufacturer: ChooseManufacturer | None = None
    # What to do when a spec category's key parameters are only partly
    # supplied. Matching on a subset can merge two different parts; creating
    # instead can duplicate one you already have. Both are wrong and neither
    # announces itself, and InvenTree cannot merge parts afterwards - so the
    # default refuses to guess.
    on_partial: str = "ask"                  # ask | new | skip
    choose_part: Callable[[PartLine, list[Any]], Any | None] | None = None


@dataclass
class PartResolution:
    """The outcome of resolving one PartLine. reason set means it did not."""
    reason: str = ""
    # The category is reported alongside a failure when one was resolved, so
    # the caller can say which category a skipped row belonged to.
    category: CategoryConfig | None = None
    report_category: bool = False
    part: Any | None = None
    manufacturer_part: Any | None = None
    values: dict[str, str] = field(default_factory=dict)
    part_values: dict[str, str] = field(default_factory=dict)
    ipn: str = ""
    name: str = ""
    part_parameters: int = 0
    manufacturer_parameters: int = 0
    # Set when a partial spec could not be decided without a human. The
    # candidates are existing parts matching the subset that was supplied.
    needs_choice: bool = False
    candidates: list[Any] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.reason and not self.needs_choice


def resolve_category(line: PartLine, ctx: ImportContext) -> PartResolution:
    """Map a line's supplier category path onto a usable server category."""
    category = line.category
    path = line.category_path or []
    if category is None:
        category = match_path(path, ctx.categories)
    if category is None:
        text = path_text(path) or "(no category)"
        return PartResolution(reason=f"unmapped category {text}")

    if category.structural:
        return PartResolution(
            reason=f"category {category.pathstring} is structural",
            category=category, report_category=True)

    if ctx.server_categories.get(category.pathstring) is None:
        return PartResolution(
            reason=f"category {category.pathstring} is not on the server "
                   f"- run invimport categories --write",
            category=category, report_category=True)

    return PartResolution(category=category)


def parts_matching_partial_spec(
    api,
    category_pk: int,
    supplied: dict[str, str],
    templates: dict[str, Any],
    parameters: dict[str, ParameterConfig],
) -> list[Any]:
    """
    Parts in this category that agree with every value we were given.

    Used only to offer candidates for a partial spec. They agree on what was
    supplied and say nothing about what was not, which is exactly why the
    choice belongs to a human.
    """
    if not supplied:
        return []
    stored = Parameter.list(api, model_type=PART_MODEL_TYPE, limit=LIST_LIMIT)
    by_part: dict[int, dict[int, str]] = {}
    for row in stored:
        model_id = getattr(row, "model_id", None)
        template = getattr(row, "template", None)
        if model_id is None or template is None:
            continue
        by_part.setdefault(int(model_id), {})[int(template)] = str(row.data)

    template_pk = {name: tmpl.pk for name, tmpl in templates.items()}
    found = []
    for part in Part.list(api, category=category_pk, limit=LIST_LIMIT):
        have = by_part.get(part.pk, {})
        agrees = True
        for name, value in supplied.items():
            tmpl_pk = template_pk.get(name)
            if tmpl_pk is None or tmpl_pk not in have:
                agrees = False
                break
            if not values_match(have[tmpl_pk], value, parameters.get(name)):
                agrees = False
                break
        if agrees:
            found.append(part)
    return found


def resolve_part(
    api,
    line: PartLine,
    ctx: ImportContext,
    *,
    write: bool,
    update_parameters: bool = False,
    policy: PartPolicy | None = None,
    on_step: Callable[[str], None] | None = None,
) -> PartResolution:
    """
    Find-or-create the Part and ManufacturerPart one line describes.

    Everything up to, but not including, the supplier part: the category, the
    part, its parameters, the manufacturer and the manufacturer part. Returns
    a PartResolution whose `reason` is set when the line could not be used.

    on_step, if given, is called with a short action name just before each
    write (manufacturer, part, manufacturer_part) so a caller can show
    progress without buffering until the SKU is done.
    """
    policy = policy or PartPolicy()

    def step(name: str) -> None:
        if on_step and write:
            on_step(name)

    found = resolve_category(line, ctx)
    if not found.ok:
        return found
    category = found.category
    assert category is not None
    server_cat = ctx.server_categories[category.pathstring]

    def refused(reason: str, *, name_category: bool) -> PartResolution:
        return PartResolution(reason=reason, category=category,
                              report_category=name_category)

    if policy.require_mpn and not line.mpn:
        # Historically reported without the category; kept that way so the
        # DigiKey path's output does not shift under the refactor.
        return refused("product has no manufacturer part number",
                       name_category=False)

    manufacturer = None
    if line.manufacturer:
        step("manufacturer")
        manufacturer = resolve_manufacturer(
            api, line.manufacturer, ctx.manufacturers,
            choose=policy.choose_manufacturer,
            create=policy.create_manufacturers, write=write,
            cache=ctx.manufacturer_cache)
    if manufacturer is None and policy.require_manufacturer:
        return refused(f"unresolved manufacturer {line.manufacturer!r}",
                       name_category=True)

    values = from_supplier(line.parameters, ctx.parameters,
                           category.parameters)

    # Only the parameters that identify a part belong on the part itself.
    # Everything else - packaging, temperature range, tolerance grade - may
    # legitimately differ between manufacturers of the same specification, and
    # pinning one manufacturer's figures to the shared part would make them
    # look authoritative. Under mpn identity there is one part per MPN, so
    # there is no variation to keep out and the part carries the lot.
    if category.identity == "spec" and category.key_parameters:
        part_values = {name: value for name, value in values.items()
                       if name in category.key_parameters}
    else:
        part_values = values

    # Identity, most specific first. An explicit IPN is an instruction, not a
    # guess; an MPN or a type designator names the part directly; a spec is
    # matched on the parameters that identify it.
    step("part")
    part = find_part_by_ipn(api, line.ipn)
    if part is None and line.mpn:
        part = find_part_by_mpn(api, line.mpn)
    if part is None and line.type and category.identity == "type":
        # Only where the category says a designator identifies the part. Under
        # `mpn` identity the manufacturer part number is the identity, and
        # matching on a name instead would quietly merge parts the category
        # says are distinct.
        part = find_part_by_type(api, server_cat.pk, line.type)

    if part is None and category.identity == "spec":
        supplied = {name: value for name, value in values.items()
                    if name in category.key_parameters}
        missing = [name for name in category.key_parameters
                   if name not in supplied]

        if missing and supplied:
            # A partial spec. It cannot be matched - a subset match may be a
            # different part - and it must not be created blind, because that
            # may duplicate one already there. InvenTree has no part merge, so
            # both mistakes are cleaned up by hand.
            offered = parts_matching_partial_spec(
                api, server_cat.pk, supplied, ctx.templates, ctx.parameters)
            chosen = None
            if policy.choose_part is not None:
                chosen = policy.choose_part(line, offered)
            if chosen is not None:
                part = chosen
            elif policy.on_partial == "new":
                pass                         # fall through and create one
            elif policy.on_partial == "skip":
                return PartResolution(
                    reason=f"partial specification: missing "
                           f"{', '.join(missing)}",
                    category=category, report_category=True)
            else:
                return PartResolution(
                    category=category, report_category=True,
                    needs_choice=True, candidates=offered, missing=missing,
                    reason="")
        else:
            part = find_part_by_spec(api, server_cat.pk,
                                     category.key_parameters, values,
                                     ctx.templates, ctx.parameters)

    ipn = str(getattr(part, "IPN", "") or "") if part is not None else ""
    name = str(getattr(part, "name", "") or "") if part is not None else ""

    if part is None:
        name = part_name(category, line.type or line.mpn, values,
                         ctx.parameters, line.description)
        ipn = next_ipn(api, ipn_prefix(category))
        if write:
            payload = {
                "name": name,
                "description": line.description[:250],
                "category": server_cat.pk,
                "IPN": ipn,
            }
            link = absolute_url(line.datasheet) or absolute_url(line.link)
            if link:
                payload["link"] = link
            part = Part.create(api, payload)
            part_written = apply_parameters(api, part.pk, part_values,
                                            ctx.templates, write=True)
        else:
            part = SimpleNamespace(pk=UNRESOLVED_PK, IPN=ipn, name=name)
            part_written = len({n for n in part_values if n in ctx.templates})
    elif update_parameters:
        part_written = apply_parameters(api, part.pk, part_values,
                                        ctx.templates, write=write,
                                        update=True)
    else:
        part_written = 0

    mfr_part = None
    # No manufacturer means no ManufacturerPart - nothing is invented to stand
    # in for one. A part may legitimately have none.
    if part.pk != UNRESOLVED_PK and manufacturer is not None and line.mpn:
        step("manufacturer_part")
        existing = ManufacturerPart.list(api, part=part.pk, MPN=line.mpn,
                                         limit=LIST_LIMIT)
        mfr_part = existing[0] if existing else None
        if mfr_part is None and write:
            payload = {
                "part": part.pk,
                "manufacturer": manufacturer.pk,
                "MPN": line.mpn,
            }
            datasheet = absolute_url(line.datasheet)
            if datasheet:
                payload["link"] = datasheet
            if line.description:
                payload["description"] = line.description[:250]
            mfr_part = ManufacturerPart.create(api, payload)

    # The manufacturer part is one manufacturer's realisation of the spec, so
    # it carries every parameter, including the ones kept off the part.
    mfr_written = apply_parameters(
        api, getattr(mfr_part, "pk", None), values, ctx.templates,
        write=write, update=update_parameters,
        model_type=MANUFACTURER_PART_MODEL_TYPE)

    return PartResolution(
        category=category, part=part, manufacturer_part=mfr_part,
        values=values, part_values=part_values, ipn=ipn, name=name,
        part_parameters=part_written, manufacturer_parameters=mfr_written,
    )


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
    on_step: Callable[[str], None] | None = None,
) -> SkuAction:
    """Find-or-create the records one SKU needs. Does not fetch."""
    def step(name: str) -> None:
        if on_step and write:
            on_step(name)

    existing = supplier_parts.get(sku.strip().upper())
    if existing is not None and not update_parameters:
        return SkuAction(sku, "exists",
                         part=getattr(existing, "part", None),
                         supplier_part=existing.pk,
                         product=product)

    if product.get("error"):
        if existing is not None:
            return SkuAction(sku, "exists",
                             part=getattr(existing, "part", None),
                             supplier_part=existing.pk,
                             product=product)
        return _skipped(sku, product["error"], product)

    ctx = ImportContext(
        categories=categories, parameters=parameters,
        manufacturers=manufacturers, server_categories=server_categories,
        templates=templates, manufacturer_cache=manufacturer_cache)

    # DigiKey always states both, so a payload missing either is one we failed
    # to read rather than a part that genuinely has none.
    resolved = resolve_part(
        api, PartLine.from_product(product), ctx,
        write=write, update_parameters=update_parameters,
        policy=PartPolicy(require_mpn=True, require_manufacturer=True,
                          create_manufacturers=create_manufacturers,
                          choose_manufacturer=choose_manufacturer,
                          # DigiKey states a full parameter set consistently,
                          # and this path has never prompted. The partial-spec
                          # question belongs to hand-written files, where a
                          # missing value means nobody knew it.
                          on_partial="new"),
                on_step=step)

    if resolved.needs_choice:                    # cannot happen under "new"
        return _skipped(sku, "partial specification", product,
                        category=resolved.category.pathstring
                        if resolved.category else "")

    if not resolved.ok:
        extra = ({"category": resolved.category.pathstring}
                 if resolved.report_category and resolved.category else {})
        return _skipped(sku, resolved.reason, product, **extra)

    category = resolved.category
    assert category is not None
    part, mfr_part = resolved.part, resolved.manufacturer_part
    values, ipn, name = resolved.values, resolved.ipn, resolved.name
    part_written = resolved.part_parameters
    mfr_written = resolved.manufacturer_parameters

    supplier_part = existing
    if write and part.pk != UNRESOLVED_PK and existing is None:
        step("supplier_part")
        # pack_quantity is deliberately left unset (InvenTree defaults it to 1).
        # DigiKey sells and prices this SKU by the piece, so one ordered unit is
        # one piece. Setting it from the product's standard_package - the
        # manufacturer's reel or tube size - would make InvenTree receive
        # quantity x reel size on every purchase order line.
        payload = {
            "part": part.pk,
            "supplier": supplier,
            "SKU": sku,
            "packaging": str(product.get("packaging") or "")[:50],
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

    # And so does the supplier part: it is what you actually buy, so it is
    # where the full specification of this SKU is worth reading off.
    supplier_written = apply_parameters(
        api, getattr(supplier_part, "pk", None), values, templates,
        write=write, update=update_parameters,
        model_type=SUPPLIER_PART_MODEL_TYPE)

    images = cache_product_images(product, image_cache_dir, refresh=refresh)
    if write and part.pk != UNRESOLVED_PK and images:
        step("image")
        attach_part_image(part, images[0])

    return SkuAction(
        sku, "exists" if existing is not None else "created",
        part=part.pk,
        manufacturer_part=getattr(mfr_part, "pk", None),
        supplier_part=getattr(supplier_part, "pk", None),
        ipn=ipn, name=name, category=category.pathstring,
        product=product,
        part_parameters=part_written,
        manufacturer_parameters=mfr_written,
        supplier_parameters=supplier_written,
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
    on_learn_parameters: OnLearnParameters | None = None,
    on_learn_choices: OnLearnChoices | None = None,
    fetch: bool = True,
    cache_dir: Path | None = None,
    image_cache_dir: Path | None = None,
    refresh: bool = False,
    on_sku: OnSku | None = None,
    on_step: OnStep | None = None,
) -> PartImportResult:
    """
    Find-or-create the InvenTree records each SKU needs.

    products maps an upper-cased SKU to a fetch_products() row. Missing
    SKUs are fetched unless fetch=False. supplier is a Company or pk; omit
    it to use the DigiKey supplier already on the server.

    choose_manufacturer(name, [(company, score), ...]) returns an existing
    Company, a name to create, or None to skip. The CLI writes the answer
    back to manufacturers.yaml; this function does not.

    on_learn_parameters / on_learn_choices are called after products are
    fetched with supplier fields this category does not yet map, and with
    choice-parameter values that are not in the allowed set. The callback
    writes the config; this function reloads it before creating records.

    on_sku is called as each SKU finishes. on_step(sku, action, index, total)
    is called just before each write action (and with action "start" as the
    SKU begins), so a caller can print progress without buffering.
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
            action = _skipped(sku, "no DigiKey supplier")
            result.skus.append(action)
            if on_sku:
                on_sku(action)
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

    usable = [row for row in indexed.values() if not row.get("error")]
    if on_learn_parameters:
        found = discover(usable, categories, parameters)
        if found:
            on_learn_parameters(found)
            categories = load_categories_config(directory)
            parameters = load_parameters_config(directory)
    if on_learn_choices:
        found = unknown_choices(usable, categories, parameters)
        if found:
            on_learn_choices(found)
            parameters = load_parameters_config(directory)

    server_categories = {c.pathstring: c
                         for c in PartCategory.list(api, limit=LIST_LIMIT)
                         if getattr(c, "pathstring", None)}
    templates = {t.name: t for t in ParameterTemplate.list(api, limit=LIST_LIMIT)}
    existing_parts = supplier_parts_by_sku(api, supplier_pk)
    manufacturer_cache: dict[str, Any] = {}

    for index, sku in enumerate(wanted, 1):
        if on_step:
            on_step(sku, "start", index, len(wanted))
        product = indexed.get(sku.strip().upper()) or {
            "SKU": sku, "error": "no product data"}
        notify = ((lambda name, sku=sku, index=index: on_step(
            sku, name, index, len(wanted))) if on_step else None)
        try:
            action = import_sku(
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
                on_step=notify,
            )
        except Exception as exc:
            result.problems.append(f"{sku}: {exc}")
            action = _skipped(sku, str(exc), product)
        result.skus.append(action)
        if on_sku:
            on_sku(action)

    return result
