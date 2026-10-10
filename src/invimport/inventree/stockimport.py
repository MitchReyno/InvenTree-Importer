"""
Turn a stock file into InvenTree records.

    from invimport.stockfile import read_file
    from invimport.inventree.stockimport import import_stock

    result = import_stock(read_file("stock.json"), write=True)
    print(result.counts())

One line becomes, as far as it can: a Part, a ManufacturerPart, a SupplierPart,
a PurchaseOrder line, and a StockItem. Every one of those is optional except
the part and the stock - half of real stock has no MPN, a third has no order,
and an eighth has no supplier at all. Nothing is invented to fill a gap.

Re-running is safe. Each created stock item carries a barcode naming the line
that made it, and InvenTree refuses to assign a barcode twice, so a second run
of the same file reports `exists` rather than doubling the quantity.

The library never prompts. Ambiguity is either settled by a callback the caller
supplied, or reported as `needs-review` for the caller to handle.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

from ..config import (
    CATEGORIES_FILE,
    CONFIG_DIR,
    IDENTITY_MODES,
    IPN_PREFIX_PATTERN,
    CategoryConfig,
    add_category,
    load_categories_config,
    load_manufacturers_config,
    load_parameters_config,
    load_suppliers_config,
)
from .. import notes as notes_md
from ..stockfile import StockFile, StockLine
from ..validate import resolve_category
from .api import (
    ParameterTemplate,
    PartCategory,
    PurchaseOrder,
    PurchaseOrderLineItem,
    ManufacturerPart,
    SupplierPart,
    connect,
)
from .categories import ensure_on_server
from .datasheets import attach_datasheet, prefetch, resolve_datasheet
from .parts import (
    UNRESOLVED_PK,
    ImportContext,
    PartLine,
    PartPolicy,
    apply_parameters,
    attach_line_images,
    attach_part_documents,
    attach_part_files,
    attach_stock_files,
    resolve_part,
)
from .purchase_orders import (
    attach_order_file,
    next_reference,
    resolve_supplier,
    split_marketplace,
    supplier_pk,
)
from .stock import (
    BarcodeInUse,
    add_stock,
    already_imported,
    location_names,
    resolve_location,
)

log = logging.getLogger(__name__)

LIST_LIMIT = 1000

# What a line may end up as.
CREATED = "created"
EXISTS = "exists"
SKIPPED = "skipped"
REVIEW = "needs-review"

# What became of a part's or manufacturer part's notes. Notes already on the
# record are never replaced: they may hold what someone wrote by hand, and a
# re-import is no reason to lose it.
NOTES_WRITTEN = "written"
NOTES_WOULD_WRITE = "would be written"
NOTES_KEPT = "kept - the record already has notes"
NOTES_UNCHANGED = "already there"


@dataclass
class LineAction:
    """What happened, or would happen, to one line of the file."""
    id: str
    action: str = CREATED
    reason: str = ""
    quantity: float = 0
    category: str = ""
    ipn: str = ""
    name: str = ""
    part: int | None = None
    manufacturer_part: int | None = None
    supplier_part: int | None = None
    purchase_order: int | None = None
    stock_item: int | None = None
    location: str = ""
    part_of: str = ""
    parameters: int = 0
    # The datasheet files attached (or that would be), else why there are
    # none - or why one of them is missing.
    datasheet: str = ""
    datasheet_problem: str = ""
    # What became of the part's and the manufacturer part's notes: one of
    # the NOTES_* outcomes, or "" when the line carried none.
    part_notes: str = ""
    manufacturer_part_notes: str = ""
    # Set when the file names an existing part differently from the server.
    name_kept: str = ""
    # Populated when a human has to settle something before this line can run.
    candidates: list[Any] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)


@dataclass
class StockImportResult:
    lines: list[LineAction] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "created": sum(1 for a in self.lines if a.action == CREATED),
            "exists": sum(1 for a in self.lines if a.action == EXISTS),
            "skipped": sum(1 for a in self.lines if a.action == SKIPPED),
            "review": sum(1 for a in self.lines if a.action == REVIEW),
            "quantity": sum(a.quantity for a in self.lines
                            if a.action == CREATED),
            "problems": len(self.problems),
        }


ChooseCategory = Callable[[StockLine, list[str]], "CategoryConfig | str | None"]


@dataclass
class ImportOptions:
    """Everything the caller may decide about how a run behaves."""
    write: bool = False
    create_manufacturers: bool = True
    create_suppliers: bool = True
    create_orders: bool = True
    create_locations: bool = True
    default_location: str = ""
    # Download datasheet URLs and attach a copy, not only link them.
    mirror_datasheets: bool = False
    on_partial: str = "ask"
    min_confidence: float = 0.0
    # Callbacks. Without one, the matching ambiguity is reported instead.
    choose_manufacturer: Any = None
    choose_supplier: Any = None
    choose_part: Any = None
    choose_name_match: Any = None
    choose_category: ChooseCategory | None = None
    confirm_line: Callable[[StockLine, LineAction], bool] | None = None


def import_stock(
    document: StockFile,
    api=None,
    *,
    directory: Path | str | None = None,
    options: ImportOptions | None = None,
) -> StockImportResult:
    """Create the records every line of the file asks for."""
    api = api or connect()
    options = options or ImportOptions()
    directory = Path(directory) if directory is not None else CONFIG_DIR

    categories = load_categories_config(directory)
    parameters = load_parameters_config(directory)
    manufacturers = load_manufacturers_config(directory)
    suppliers = load_suppliers_config(directory)

    ctx = ImportContext(
        categories=categories,
        parameters=parameters,
        manufacturers=manufacturers,
        server_categories={c.pathstring: c
                           for c in PartCategory.list(api, limit=LIST_LIMIT)
                           if getattr(c, "pathstring", None)},
        templates={t.name: t for t in ParameterTemplate.list(api, limit=LIST_LIMIT)},
    )

    result = StockImportResult()
    supplier_cache: dict[str, Any] = {}
    location_cache: dict[str, Any] = {}
    order_cache: dict[tuple[int, str], Any] = {}
    supplier_parts = {(sp.supplier, str(sp.SKU).strip().upper()): sp
                      for sp in SupplierPart.list(api, limit=LIST_LIMIT)}

    # Mirrored datasheets are fetched together up front; each line then finds
    # its file already in the cache instead of waiting on its own download.
    if options.mirror_datasheets:
        prefetch(line.datasheet for line in document.lines)

    by_id: dict[str, LineAction] = {}
    for line in document.lines:
        action = _import_line(
            api, document, line, ctx, suppliers, options,
            directory=directory,
            supplier_cache=supplier_cache, location_cache=location_cache,
            order_cache=order_cache, supplier_parts=supplier_parts,
            by_id=by_id)
        by_id[line.id] = action
        result.lines.append(action)

    return result


def _import_line(api, document: StockFile, line: StockLine,
                 ctx: ImportContext, suppliers, options: ImportOptions, *,
                 directory: Path,
                 supplier_cache, location_cache, order_cache,
                 supplier_parts, by_id=None) -> LineAction:
    action = LineAction(id=line.id, quantity=line.quantity,
                        part_of=line.part_of)
    key = document.key_for(line)

    # Already imported? The barcode is the record, so this survives anything
    # that happened to the file since.
    existing = already_imported(api, key)
    if existing is not None:
        action.action = EXISTS
        action.stock_item = existing
        # The stock is done, but a datasheet added to the file since - or a
        # re-run with mirroring on - still has somewhere to go.
        _existing_datasheet(api, document, line, options, action)
        _existing_notes(api, line, options, action)
        _existing_name(api, line, action)
        if options.write:
            _attach_stock_images(document, line, existing, api)
            if line.attachments and action.part not in (None, UNRESOLVED_PK):
                _attach_documents(document, line, action.part, api)
            elif line.attachments:
                _attach_documents(document, line,
                                  _part_of_stock(api, existing), api)
        return action

    if (line.confidence is not None
            and line.confidence < options.min_confidence):
        action.action = REVIEW
        action.reason = (f"confidence {line.confidence:.0%} is below the "
                         f"{options.min_confidence:.0%} this run requires")
        return action

    category = resolve_category(line, ctx.categories)
    if category is None:
        category = _offer_category(line, ctx, options, action,
                                   api=api, directory=directory)
        if category is None:
            return action
    action.category = category.pathstring

    if ctx.server_categories.get(category.pathstring) is None:
        action.action = SKIPPED
        action.reason = (f"category {category.pathstring} is not on the "
                         f"server - run invimport categories --write")
        return action

    # --- the part ---
    ipn = line.ipn
    if line.part_of:
        # Filed against the part another line of this file resolved. On a
        # write that part exists by now and is found by its IPN; on a dry run
        # a part the other line would create has no IPN yet, so this line is
        # reported as resolving normally, with the link shown.
        ref = (by_id or {}).get(line.part_of)
        ref_part = getattr(ref, "part", None)
        # A line imported on an earlier run stops at its barcode without
        # resolving a part; its stock item still says which part it joined.
        if ref is not None and ref_part is None and ref.action == EXISTS:
            ref_part = ref.part = _part_of_stock(api, ref.stock_item)
        if ref is None or ref_part is None:
            action.action = REVIEW
            action.reason = (f"part_of {line.part_of}: that line did not "
                             f"resolve a part")
            return action
        if ref_part != UNRESOLVED_PK:
            try:
                ipn = str(api.get(f"part/{ref_part}/").get("IPN") or "")
            except Exception:                    # pragma: no cover
                ipn = ""
            if not ipn:
                action.action = REVIEW
                action.reason = (f"part_of {line.part_of}: part {ref_part} "
                                 f"has no IPN to file against")
                return action
    resolved = resolve_part(
        api,
        PartLine(category=category, mpn=line.mpn, type=line.type,
                 ipn=ipn, manufacturer=line.manufacturer, name=line.name,
                 description=line.description, parameters=line.parameters,
                 link=line.link, datasheet=line.datasheet),
        ctx, write=options.write,
        policy=PartPolicy(
            require_mpn=False, require_manufacturer=False,
            create_manufacturers=options.create_manufacturers,
            choose_manufacturer=options.choose_manufacturer,
            on_partial=options.on_partial,
            choose_part=options.choose_part,
            match_by_name=True,
            choose_name_match=options.choose_name_match))

    if resolved.needs_choice:
        action.action = REVIEW
        action.candidates = list(resolved.candidates)
        action.missing = list(resolved.missing)
        action.reason = resolved.reason or (
            f"only part of the specification is given - missing "
            f"{', '.join(resolved.missing)}")
        return action
    if not resolved.ok:
        action.action = SKIPPED
        action.reason = resolved.reason
        return action

    action.part = getattr(resolved.part, "pk", None)
    action.manufacturer_part = getattr(resolved.manufacturer_part, "pk", None)
    action.ipn, action.name = resolved.ipn, resolved.name
    if line.name and resolved.name and resolved.name != line.name:
        # The file's name only names a part it creates. Renaming one that
        # exists would change it for every stock item and order it is on.
        action.name_kept = (f"the part is already called {resolved.name!r}; "
                            f"{line.name!r} only names a new part")
    action.parameters = resolved.part_parameters + resolved.manufacturer_parameters

    # --- the supplier, and what it sold ---
    supplier, seller = _resolve_supplier(api, line, suppliers, options,
                                         supplier_cache)
    try:
        supplier_part = _supplier_part(api, line, supplier, resolved, options,
                                       supplier_parts)
    except SupplierPartConflict as exc:
        action.action = SKIPPED
        action.reason = str(exc)
        return action
    action.supplier_part = getattr(supplier_part, "pk", None)

    # --- where it goes ---
    wanted = line.location or options.default_location
    # Asked first without creating, so the report can say a location is new -
    # on a dry run nothing is created, and a silent blank would hide that this
    # line is about to add a bag or a drawer to the tree.
    existed = resolve_location(api, wanted, write=False, create=False,
                               cache=location_cache) is not None
    location = resolve_location(api, wanted, write=options.write,
                                create=options.create_locations,
                                cache=location_cache)
    action.location = str(getattr(location, "pathstring", "") or "")
    if location_names(wanted) and not existed and options.create_locations:
        action.location = (f"{action.location or '/'.join(location_names(wanted))}"
                           f" (new location)")

    # --- the order it came on ---
    order = _purchase_order(
        api, line, supplier, options, order_cache,
        base_dir=document.path.parent if document.path else None)
    action.purchase_order = getattr(order, "pk", None)
    if order is not None and supplier_part is not None and options.write:
        _order_line(api, order, supplier_part, line)

    datasheets = _line_datasheet(document, line, options, action)
    _record_notes(api, line, options, action)

    if not options.write or action.part in (None, UNRESOLVED_PK):
        return action

    if datasheets:
        attach_datasheet(
            api, datasheets, part=action.part,
            manufacturer_parts=[action.manufacturer_part]
            if action.manufacturer_part is not None else [])

    if line.attachments:
        _attach_documents(document, line, action.part, api)

    if line.images:
        base_dir = document.path.parent if document.path else None
        attach_line_images(resolved.part, line.images, base_dir=base_dir)
        # The first photo is the part's picture; the rest ride along as
        # attachments so the label and packaging shots are not lost.
        attach_part_files(
            api, resolved.part, line.images[1:], base_dir=base_dir,
            comment=f"imported from {document.path.name}"
            if document.path else "")

    notes = notes_md.stock_notes(
        line.notes, seller=seller, approximate=line.approximate,
        source_file=document.path.name if document.path else "")
    try:
        item = add_stock(
            api, part=action.part, quantity=line.quantity,
            location=getattr(location, "pk", None),
            supplier_part=action.supplier_part,
            purchase_price=line.unit_price, currency=line.currency,
            condition=line.condition, notes=notes,
            batch=line.batch, packaging=line.packaging, tags=line.tags,
            key=key)
    except BarcodeInUse:
        # Something else claimed the key between the check above and now.
        action.action = EXISTS
        action.stock_item = already_imported(api, key)
        return action

    if order is not None:
        try:
            item.save({"purchase_order": order.pk})
        except Exception:                        # pragma: no cover
            log.warning("    could not link stock %s to order %s",
                        item.pk, order.pk)
    action.stock_item = item.pk
    _attach_stock_images(document, line, item.pk, api)
    return action


# --------------------------------------------------------------------------
# Pieces
# --------------------------------------------------------------------------
def _attach_documents(document: StockFile, line: StockLine,
                      part: int | None, api) -> None:
    """Attach the line's attachments (source snapshots, scans) to its part."""
    attach_part_documents(
        api, part, line.attachments,
        base_dir=document.path.parent if document.path else None,
        default_comment=f"imported from {document.path.name}"
        if document.path else "")


def _part_of_stock(api, stock_item: int | None) -> int | None:
    try:
        return int(api.get(f"stock/{stock_item}/")["part"])
    except Exception as exc:                     # pragma: no cover
        log.warning("    could not find the part for stock %s: %s",
                    stock_item, exc)
        return None


def _attach_stock_images(document: StockFile, line: StockLine,
                         stock_item: int | None, api) -> None:
    """Attach the line's stock_images to the stock item it made."""
    if not line.stock_images:
        return
    attach_stock_files(
        api, stock_item, line.stock_images,
        base_dir=document.path.parent if document.path else None,
        comment=f"imported from {document.path.name}"
        if document.path else "")


def _line_datasheet(document: StockFile, line: StockLine,
                    options: ImportOptions, action: LineAction):
    """
    The datasheet files this line would attach, noted on the action.

    Resolved on a dry run too, so the report says whether a local file is
    missing or a URL is not really a PDF before anything is written. A URL
    that is simply not being mirrored is not worth a mention - it is stored
    as the part's link, as it always was.
    """
    if not line.datasheet:
        return []
    files, reason = resolve_datasheet(
        line.datasheet,
        base_dir=document.path.parent if document.path else None,
        pages=line.datasheet_pages, mirror=options.mirror_datasheets)
    action.datasheet = ", ".join(file.path.name for file in files)
    if reason != "linked only":
        action.datasheet_problem = reason
    return files


def _existing_datasheet(api, document: StockFile, line: StockLine,
                        options: ImportOptions, action: LineAction) -> None:
    """Attach a datasheet to the part an already-imported line made."""
    datasheets = _line_datasheet(document, line, options, action)
    if not datasheets or not options.write:
        return
    try:
        item = api.get(f"stock/{action.stock_item}/")
        part = int(item["part"])
    except Exception as exc:                     # pragma: no cover
        log.warning("    could not find the part for stock %s: %s",
                    action.stock_item, exc)
        return
    action.part = part
    number = (line.mpn or line.type).strip().upper()
    mfr_parts = [mp.pk for mp in ManufacturerPart.list(api, part=part,
                                                       limit=LIST_LIMIT)
                 if number and str(mp.MPN).strip().upper() == number]
    attach_datasheet(api, datasheets, part=part, manufacturer_parts=mfr_parts)


def _notes_on(api, route: str, pk: int | None, text: str,
              write: bool) -> str:
    """
    Put notes on a part or manufacturer part that has none.

    A record that already has notes keeps them: they may be what someone
    wrote by hand, and they are reported rather than overwritten. A record
    that does not exist yet - a dry run's new part - would get them.
    """
    if not text:
        return ""
    if pk in (None, UNRESOLVED_PK):
        return NOTES_WOULD_WRITE
    try:
        current = str(api.get(f"{route}/{pk}/").get("notes") or "").strip()
    except Exception as exc:                     # pragma: no cover
        log.warning("    could not read the notes of %s %s: %s", route, pk,
                    exc)
        return ""
    if current == text.strip():
        return NOTES_UNCHANGED
    if current:
        return NOTES_KEPT
    if not write:
        return NOTES_WOULD_WRITE
    api.patch(f"{route}/{pk}/", {"notes": text})
    return NOTES_WRITTEN


def _record_notes(api, line: StockLine, options: ImportOptions,
                  action: LineAction) -> None:
    """The part's and the manufacturer part's notes, from a version 2 file."""
    action.part_notes = _notes_on(
        api, "part", action.part,
        notes_md.render(line.part_notes, notes_md.PART_SECTIONS),
        options.write)
    mp_text = notes_md.render(line.manufacturer_part_notes,
                              notes_md.MANUFACTURER_PART_SECTIONS)
    if mp_text and line.manufacturer:
        # A manufacturer part a dry run would create has no pk yet.
        action.manufacturer_part_notes = _notes_on(
            api, "company/part/manufacturer", action.manufacturer_part,
            mp_text, options.write)


def _existing_notes(api, line: StockLine, options: ImportOptions,
                    action: LineAction) -> None:
    """
    Notes for the part an already-imported line made.

    Re-running a file is how notes reach parts imported before the file had
    any; a record that has notes by then keeps them.
    """
    if not line.part_notes and not line.manufacturer_part_notes:
        return
    part = _part_of_stock(api, action.stock_item)
    if part is None:
        return
    action.part = part
    number = (line.mpn or line.type).strip().upper()
    if number and line.manufacturer and line.manufacturer_part_notes:
        found = [mp.pk for mp in ManufacturerPart.list(api, part=part,
                                                       limit=LIST_LIMIT)
                 if str(mp.MPN).strip().upper() == number]
        action.manufacturer_part = found[0] if found else None
    _record_notes(api, line, options, action)
    if line.manufacturer_part_notes and action.manufacturer_part is None:
        action.manufacturer_part_notes = ""


def _existing_name(api, line: StockLine, action: LineAction) -> None:
    """Say when the part an imported line made is called something else."""
    if not line.name or line.part_of:
        return
    part = action.part
    if part in (None, UNRESOLVED_PK):
        part = _part_of_stock(api, action.stock_item)
    if part is None:
        return
    try:
        current = str(api.get(f"part/{part}/").get("name") or "")
    except Exception:                            # pragma: no cover
        return
    if current and current != line.name:
        action.name_kept = (f"the part is already called {current!r}; "
                            f"{line.name!r} only names a new part")


def _offer_category(line: StockLine, ctx: ImportContext,
                    options: ImportOptions,
                    action: LineAction, *,
                    api, directory: Path) -> CategoryConfig | None:
    """
    A category the config does not have. Suggest, confirm, create - never
    silently: a taxonomy that grows itself from typos stops being a taxonomy.
    """
    from ..validate import category_candidates

    near = category_candidates(line.category, ctx.categories)
    if options.choose_category is None:
        action.action = REVIEW
        action.reason = f"unknown category {line.category!r}"
        action.candidates = near
        return None

    picked = options.choose_category(line, near)
    if picked is None:
        action.action = SKIPPED
        action.reason = f"unknown category {line.category!r}"
        return None
    if not isinstance(picked, str):
        return picked
    chosen = ctx.categories.get(picked)
    if chosen is not None:
        return chosen
    return _create_category(picked, line, ctx, options, action,
                            api=api, directory=directory)


def _suggestion_fields(line: StockLine) -> dict[str, str]:
    """What suggest_category asked to store. `because` is never written."""
    suggest = line.suggest_category or {}
    fields: dict[str, str] = {}
    identity = str(suggest.get("identity") or "").strip()
    if identity in IDENTITY_MODES:
        fields["identity"] = identity
    prefix = str(suggest.get("ipn_prefix") or "").strip().upper()
    if prefix and IPN_PREFIX_PATTERN.match(prefix):
        fields["ipn_prefix"] = prefix
    description = str(suggest.get("description") or "").strip()
    if description:
        fields["description"] = description
    return fields


def _category_from_suggestion(
    keys: list[str], line: StockLine,
    categories: dict[str, CategoryConfig],
) -> CategoryConfig:
    """In-memory category for a dry run, inheriting from the nearest parent."""
    parent = None
    for depth in range(len(keys) - 1, 0, -1):
        parent = categories.get("/".join(keys[:depth]))
        if parent is not None:
            break
    fields = _suggestion_fields(line)
    return CategoryConfig(
        name=keys[-1],
        path=list(keys),
        identity=fields.get("identity") or (parent.identity if parent else "mpn"),
        ipn_prefix=fields.get("ipn_prefix") or (
            parent.ipn_prefix if parent else ""),
        key_parameters=list(parent.key_parameters) if parent else [],
        name_template=parent.name_template if parent else "",
        parameters=list(parent.parameters) if parent else [],
        description=fields.get("description") or "",
        structural=False,
        ignore=list(parent.ignore) if parent else [],
    )


def _create_category(pathstring: str, line: StockLine, ctx: ImportContext,
                     options: ImportOptions, action: LineAction, *,
                     api, directory: Path) -> CategoryConfig | None:
    """
    Write the proposed path to the config and the server, or to neither.

    A dry run keeps an in-memory copy so later lines of the same file can
    share it, without leaving a taxonomy entry the human did not confirm
    with --write.
    """
    keys = [part.strip() for part in pathstring.split("/") if part.strip()]
    if not keys:
        action.action = SKIPPED
        action.reason = f"unknown category {pathstring!r}"
        return None

    if options.write:
        add_category(directory / CATEGORIES_FILE, keys,
                     fields=_suggestion_fields(line) or None)
        fresh = load_categories_config(directory)
        ctx.categories.clear()
        ctx.categories.update(fresh)
        chosen = ctx.categories.get("/".join(keys))
        if chosen is None:
            action.action = SKIPPED
            action.reason = f"unknown category {pathstring!r}"
            return None
        ensure_on_server(api, chosen.path, ctx.server_categories,
                         ctx.categories)
        return chosen

    chosen = _category_from_suggestion(keys, line, ctx.categories)
    ctx.categories[chosen.pathstring] = chosen
    ctx.server_categories[chosen.pathstring] = SimpleNamespace(
        pk=UNRESOLVED_PK, pathstring=chosen.pathstring, name=chosen.name)
    return chosen


def _resolve_supplier(api, line: StockLine, suppliers,
                      options: ImportOptions, cache) -> tuple[Any, str]:
    """The supplier company, and the marketplace seller if there was one."""
    if not line.supplier:
        return None, ""
    _canonical, seller = split_marketplace(line.supplier, suppliers)
    company = resolve_supplier(
        api, line.supplier, suppliers,
        choose=options.choose_supplier, create=options.create_suppliers,
        write=options.write, cache=cache)
    return company, seller


class SupplierPartConflict(Exception):
    """A line's SKU already belongs to a supplier part of a different part."""


def _supplier_part(api, line: StockLine, supplier, resolved,
                   options: ImportOptions, supplier_parts):
    """Find or create the SupplierPart, when there is a supplier and a SKU."""
    if supplier is None or not line.sku:
        return None
    pk = supplier_pk(supplier)
    if pk == UNRESOLVED_PK:
        return None
    key = (pk, line.sku.strip().upper())
    if key in supplier_parts:
        found = supplier_parts[key]
        part_pk = getattr(resolved.part, "pk", None)
        if part_pk not in (None, UNRESOLVED_PK) and getattr(found, "part", part_pk) != part_pk:
            # InvenTree refuses stock whose supplier part belongs to another
            # part; say which, before anything is posted, instead of a 400.
            raise SupplierPartConflict(
                f"SKU {line.sku!r} from this supplier is already the supplier "
                f"part of part {found.part}, not of part {part_pk} that this "
                f"line resolved to - give the line the other part's ipn, or "
                f"part_of the line that created it")
        return found
    if not options.write or resolved.part is None:
        return None
    payload = {
        "part": resolved.part.pk,
        "supplier": pk,
        "SKU": line.sku,
    }
    if resolved.manufacturer_part is not None:
        payload["manufacturer_part"] = resolved.manufacturer_part.pk
    if line.description:
        payload["description"] = line.description[:250]
    link = line.supplier_link or line.link
    if link:
        payload["link"] = link
    created = SupplierPart.create(api, payload)
    supplier_parts[key] = created
    return created


def _invoice_path(source: Any, base_dir: Path | None) -> Path | None:
    """The invoice scan named by a line, resolved against the file's folder."""
    text = str(source or "").strip()
    if not text:
        return None
    path = Path(text).expanduser()
    if not path.is_absolute() and base_dir is not None:
        path = base_dir / path
    if path.is_file():
        return path
    log.warning("    [warn] invoice %s: not a file", text)
    return None


def _purchase_order(api, line: StockLine, supplier,
                    options: ImportOptions, cache, *,
                    base_dir: Path | None = None):
    """
    The order this line was bought on, keyed by its reference.

    Lines sharing a supplier and a reference share one purchase order, and a
    reference already on the server is reused - the same idempotence the
    DigiKey path gets from supplier_reference. A line with no reference gets
    no order: 29% of real rows never had one, and inventing one would be a
    record of a purchase that did not happen this way.
    """
    reference = line.order_reference
    if not reference or supplier is None or not options.create_orders:
        return None
    pk = supplier_pk(supplier)
    if pk == UNRESOLVED_PK:
        return None

    key = (pk, reference)
    if key in cache:
        # Already handled this run, invoice and all.
        return cache[key]

    order = None
    found = PurchaseOrder.list(api, supplier=pk, limit=LIST_LIMIT)
    for existing in found:
        if str(getattr(existing, "supplier_reference", "")).strip() == reference:
            order = existing
            break

    if order is None:
        if not options.write:
            return None
        payload = {
            "supplier": pk,
            "reference": next_reference(api),
            "supplier_reference": reference,
            "description": (str(line.order.get("description") or "").strip()
                            or f"Imported order {reference}")[:250],
        }
        # creation_date is read-only - it records when the row was written,
        # not when the goods were bought - so a purchase date silently went
        # nowhere. start_date is writable and is the order's own beginning,
        # which is the closest thing the model has to "ordered on".
        if line.order.get("date"):
            payload["start_date"] = line.order["date"]
        if line.order.get("target_date"):
            payload["target_date"] = line.order["target_date"]
        for name in ("link", "notes"):
            value = str(line.order.get(name) or "").strip()
            if value:
                payload[name] = value
        if line.order.get("tags"):
            payload["tags"] = list(line.order["tags"])
        if line.currency:
            payload["order_currency"] = line.currency
        order = PurchaseOrder.create(api, payload)

    cache[key] = order
    # Once per order per run: lines sharing a reference share the order, and
    # the upload itself skips a scan the order already carries, so a re-import
    # does not stack up copies.
    if options.write:
        invoice = _invoice_path(line.order.get("invoice"), base_dir)
        if invoice is not None:
            attach_order_file(api, getattr(order, "pk", None), invoice,
                              comment=f"Invoice for {reference}")
    return order


def _order_line(api, order, supplier_part, line: StockLine) -> None:
    """Record on the order what was actually bought."""
    payload = {
        "order": order.pk,
        "part": supplier_part.pk,
        "quantity": line.quantity,
        "received": line.quantity,
    }
    if line.unit_price is not None:
        payload["purchase_price"] = line.unit_price
        if line.currency:
            payload["purchase_price_currency"] = line.currency
    PurchaseOrderLineItem.create(api, payload)
