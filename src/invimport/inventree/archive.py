"""
The import's own folder, zipped and kept on the server.

An import file and its sources - the `*.sources.json`, the photos and crops,
the page snapshots and datasheet PDFs - are the only record of what was
imported and why. They live in `.local_imports/<import name>/`, which is
gitignored and on one disk. So `import-stock --write` zips that folder and
attaches the zip in InvenTree, next to the records it explains:

    - on every purchase order the import created or used, and
    - on the supplier, for lines bought on no order.

A line with neither has nowhere to carry it. That is reported, not papered
over with an order or a supplier invented to hold a file.

The zip is named for the folder and a digest of what is in it:

    import-macservice-2026-10-12-1a2b3c4d5e6f.zip

A record already holding that name (or an attachment whose comment carries the
same digest) is left alone, so re-running a file attaches nothing twice. When
the folder has changed since - a corrected line, a new snapshot - the digest
changes and the new zip is attached beside the old one. Earlier zips are never
replaced or deleted: each one is what was on file when that run wrote to the
server, and an attachment silently changing under a record is the opposite of
what an archive is for.

Only a file that sits in its own import folder is archived. The folder must be
named for the file (`<stem>/<stem>.json`) or for its source.reference, which is
how a second file belonging to the same import (a v2 redo of a few lines, say)
shares the folder. A file anywhere else is reported and skipped: zipping
whatever happens to sit beside it - every other import, in the old flat layout
- would attach the wrong evidence to the wrong order.

The library never prints. It returns an ImportArchive for the caller to show.
"""

from __future__ import annotations

import hashlib
import logging
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from ..execution.transport import exception_reason
from ..stockfile import StockFile
from .purchase_orders import AttachmentState, attach_file_outcome, attachments

log = logging.getLogger(__name__)

ARCHIVE_PREFIX = "import-"
ARCHIVE_COMMENT = "Import archive"
DIGEST_LENGTH = 12

PURCHASE_ORDER_MODEL = "purchaseorder"
COMPANY_MODEL = "company"

PURCHASE_ORDER = "purchase order"
SUPPLIER = "supplier"

# What became of the zip on one record.
ATTACHED = "attached"
WOULD_ATTACH = "would attach"
ALREADY_ATTACHED = "already attached"
FAILED = "failed"
UNKNOWN = "unknown"

# The fixed timestamp written into every zip entry. A zip records each file's
# modification time, so without this the same folder zipped twice gives two
# different files - harmless for the name, which comes from the contents, but
# it would make the bytes on the server depend on when a run happened.
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)

# Only lines that are (or would be) in InvenTree have a record to explain.
_IMPORTED = ("created", "exists")


@dataclass
class ArchiveTarget:
    """One record the zip goes on, and what became of it there."""
    kind: str                                    # PURCHASE_ORDER or SUPPLIER
    pk: int | None                               # None: a dry run's new record
    label: str
    lines: list[str] = field(default_factory=list)
    outcome: str = WOULD_ATTACH
    # Zips of this import from earlier runs, already on the record and kept.
    earlier: list[str] = field(default_factory=list)

    @property
    def model_type(self) -> str:
        return PURCHASE_ORDER_MODEL if self.kind == PURCHASE_ORDER \
            else COMPANY_MODEL


@dataclass
class ImportArchive:
    """The zip of one import's folder, and where it went."""
    name: str = ""
    folder: Path | None = None
    digest: str = ""
    files: list[str] = field(default_factory=list)
    size: int = 0
    targets: list[ArchiveTarget] = field(default_factory=list)
    # Imported lines with no order and no supplier: no record to attach to.
    unattached: list[str] = field(default_factory=list)
    # Set when there is no archive at all, saying why.
    reason: str = ""

    def counts(self) -> dict[str, int]:
        return {
            outcome: sum(1 for t in self.targets if t.outcome == outcome)
            for outcome in (ATTACHED, WOULD_ATTACH, ALREADY_ATTACHED, FAILED, UNKNOWN)
        }


# --------------------------------------------------------------------------
# The folder
# --------------------------------------------------------------------------
def import_folder(document: StockFile) -> tuple[Path | None, str]:
    """
    The folder that holds this import and its sources, or why there is none.

    See the module docstring for why a file outside its own folder is not
    archived rather than archived with its neighbours.
    """
    if document.path is None:
        return None, "the import was not read from a file"
    folder = document.path.resolve().parent
    names = {document.path.stem}
    reference = str((document.source or {}).get("reference") or "").strip()
    if reference:
        names.add(reference)
    if folder.name not in names:
        return None, (f"{document.path.name} is not in its own import folder "
                      f"- move it and its sources to "
                      f".local_imports/{document.path.stem}/")
    return folder, ""


def archive_files(folder: Path) -> list[Path]:
    """
    Everything in the folder that belongs in the zip, in a stable order.

    Hidden files are left out - .DS_Store and the like are the machine's, not
    the import's - and so is any earlier archive of this import that ended up
    in the folder, which would otherwise be zipped into the next one.
    """
    found = []
    for path in sorted(folder.rglob("*")):
        relative = path.relative_to(folder)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if not path.is_file():
            continue
        if (path.suffix.lower() == ".zip"
                and path.name.startswith(ARCHIVE_PREFIX)):
            continue
        found.append(path)
    return found


def archive_digest(folder: Path, files: Iterable[Path]) -> str:
    """
    A digest of the folder's contents: each file's relative path and bytes.

    Computed from the files rather than the zip, so it depends on nothing but
    what the import is - not on when or where it was zipped.
    """
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(folder).as_posix().encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def archive_name(folder: Path, digest: str) -> str:
    return f"{ARCHIVE_PREFIX}{folder.name}-{digest[:DIGEST_LENGTH]}.zip"


def archive_comment(archive: ImportArchive) -> str:
    """What the attachment says it is. Plain facts, and the digest to match on."""
    return (f"{ARCHIVE_COMMENT}: {archive.folder.name if archive.folder else ''}"
            f" - the import file and its sources, {len(archive.files)} "
            f"file(s), sha256 {archive.digest[:DIGEST_LENGTH]}")


def build_zip(folder: Path, files: Iterable[Path], target: Path) -> Path:
    """
    Zip the files under a top-level folder of the import's name.

    The folder name inside the zip means it unpacks to
    `<import name>/...` - exactly the layout it came from under
    .local_imports/, so relative paths in the import file still resolve.
    """
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            info = zipfile.ZipInfo(
                f"{folder.name}/{path.relative_to(folder).as_posix()}",
                date_time=ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, path.read_bytes())
    return target


# --------------------------------------------------------------------------
# Where it goes
# --------------------------------------------------------------------------
def plan_targets(lines: Iterable[Any]) -> tuple[list[ArchiveTarget], list[str]]:
    """
    The records the zip belongs on, from what each line was imported as.

    A line on a purchase order puts the zip on that order; every order the
    import touched gets the whole zip, because the file is one record and its
    sources are not split by order. A line on no order puts it on its
    supplier instead. A line with neither is returned in the second list.

    A dry run may name an order or a supplier that does not exist yet; those
    have no pk and are told apart by their label.
    """
    targets: dict[tuple, ArchiveTarget] = {}
    unattached: list[str] = []

    def add(key, kind, pk, label, line_id):
        target = targets.get(key)
        if target is None:
            target = targets[key] = ArchiveTarget(kind=kind, pk=pk,
                                                  label=label)
        target.lines.append(line_id)

    for action in lines:
        if getattr(action, "action", "") not in _IMPORTED:
            continue
        order = getattr(action, "purchase_order", None)
        reference = getattr(action, "order_reference", "") or ""
        supplier = getattr(action, "supplier", None)
        supplier_name = getattr(action, "supplier_name", "") or ""
        if order is not None:
            add((PURCHASE_ORDER, order), PURCHASE_ORDER, order,
                f"{order}" + (f" ({reference})" if reference else ""),
                action.id)
        elif reference and supplier is not None:
            # Only reachable on a dry run: the order would be created.
            add((PURCHASE_ORDER, supplier_name, reference), PURCHASE_ORDER,
                None, f"new order {reference} from {supplier_name}",
                action.id)
        elif supplier is not None and supplier >= 0:
            add((SUPPLIER, supplier), SUPPLIER, supplier,
                f"{supplier} {supplier_name}".strip(), action.id)
        elif supplier is not None:
            add((SUPPLIER, supplier_name), SUPPLIER, None,
                f"new supplier {supplier_name}", action.id)
        else:
            unattached.append(action.id)
    return list(targets.values()), unattached


def _existing(api, target: ArchiveTarget, folder: Path, name: str,
              digest: str) -> tuple[bool, list[str]]:
    """
    Is this zip already on the record, and which earlier ones are.

    Matched on the filename, and on the digest in the comment as well: the
    server may store a file under a changed name, and the digest is what says
    two zips hold the same import.
    """
    if target.pk is None:
        return False, []
    rows = attachments(api, target.model_type, target.pk)
    marker = f"sha256 {digest[:DIGEST_LENGTH]}"
    prefix = f"{ARCHIVE_PREFIX}{folder.name}-"
    present, earlier = False, []
    for row in rows:
        filename = str(row.get("filename") or "").rsplit("/", 1)[-1]
        comment = str(row.get("comment") or "")
        if filename == name or (comment.startswith(ARCHIVE_COMMENT)
                                and marker in comment):
            present = True
        elif filename.startswith(prefix) and filename.endswith(".zip"):
            earlier.append(filename)
    return present, sorted(earlier)


def archive_import(api, document: StockFile, lines: Iterable[Any], *,
                   write: bool = False) -> ImportArchive:
    """
    Zip the import's folder and attach it where its lines landed.

    Without write, nothing is built or uploaded: the folder is still read,
    so the report can give the zip's name and size and say which records
    would get it.
    """
    archive = ImportArchive()
    folder, reason = import_folder(document)
    if folder is None:
        archive.reason = reason
        return archive

    files = archive_files(folder)
    archive.folder = folder
    archive.files = [p.relative_to(folder).as_posix() for p in files]
    archive.size = sum(p.stat().st_size for p in files)
    archive.digest = archive_digest(folder, files)
    archive.name = archive_name(folder, archive.digest)
    archive.targets, archive.unattached = plan_targets(lines)

    pending = []
    for target in archive.targets:
        try:
            present, target.earlier = _existing(api, target, folder, archive.name,
                                                archive.digest)
        except Exception:
            target.outcome = FAILED
            continue
        if present:
            target.outcome = ALREADY_ATTACHED
        elif write and target.pk is not None:
            pending.append(target)
        else:
            target.outcome = WOULD_ATTACH

    if not pending:
        return archive

    comment = archive_comment(archive)
    with tempfile.TemporaryDirectory(prefix="invimport-archive-") as scratch:
        try:
            path = build_zip(folder, files, Path(scratch) / archive.name)
        except OSError as exc:
            archive.reason = f"could not zip {folder}: {exception_reason(exc)}"
            for target in pending:
                target.outcome = FAILED
            return archive
        for target in pending:
            outcome = attach_file_outcome(api, target.model_type, target.pk, path, comment)
            target.outcome = {
                AttachmentState.UPLOADED: ATTACHED,
                AttachmentState.ALREADY_SATISFIED: ALREADY_ATTACHED,
                AttachmentState.FAILED: FAILED,
                AttachmentState.UNKNOWN: UNKNOWN,
            }[outcome.state]
    return archive
