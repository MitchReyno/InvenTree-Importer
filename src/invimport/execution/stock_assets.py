"""Freeze source bytes during preparation; execute local transforms visibly."""
from __future__ import annotations

from base64 import b64encode
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import unquote, urlsplit

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError

from .transport import external_get
from ..stockfile import StockLine
from ..util import absolute_url, parse_pages
from .models import Kind, OperationSpec, OutputRef
from .stock_preparation import PreparationReview

if TYPE_CHECKING:
    from .stock_preparation import _Preview


def stable_bytes(path: Path) -> bytes:
    """Reject source replacement or mutation while obtaining a preview snapshot."""
    before = path.stat()
    content = path.read_bytes()
    after = path.stat()
    signature = lambda stat: (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    if signature(before) != signature(after) or len(content) != after.st_size:
        raise PreparationReview("source changed while preparing frozen bytes")
    return content


def source_bytes(source: str, base: Path | None) -> tuple[str, bytes]:
    if absolute_url(source):
        response = external_get(source, timeout=30)
        response.raise_for_status()
        return Path(unquote(urlsplit(source).path)).name or "evidence.bin", response.content
    path = Path(source)
    if not path.is_absolute():
        if base is None:
            raise PreparationReview("relative asset requires a source directory")
        path = base / path
    if base is not None and not path.resolve().is_relative_to(base.resolve()):
        raise PreparationReview("asset escapes its source directory")
    if not path.is_file():
        raise PreparationReview(f"missing requested asset {path.name}")
    return path.name, stable_bytes(path)


def extract_pdf(content: bytes, pages: str) -> bytes:
    numbers = parse_pages(pages)
    if not numbers:
        raise PreparationReview("invalid datasheet page selection")
    try:
        reader = PdfReader(BytesIO(content))
        if any(number > len(reader.pages) for number in numbers):
            raise PreparationReview("datasheet page selection exceeds document")
        writer = PdfWriter()
        for number in numbers:
            writer.add_page(reader.pages[number - 1])
        buffer = BytesIO()
        writer.write(buffer)
        return buffer.getvalue()
    except PdfReadError as exc:
        raise PreparationReview("requested datasheet cannot be read as PDF") from exc


def prepare_asset(preview: _Preview, line: StockLine, target: OperationSpec, source: str, *,
                  comment: str = "", image: bool = False, pages: str = "", only_created: bool = False) -> None:
    base = preview.document.path.parent if preview.document.path else None
    filename, content = source_bytes(source, base)
    content_hash = sha256(content).hexdigest()
    # Local hashing/staging and optional PDF extraction have their own plan rows.
    artifact = preview.add(Kind.EVIDENCE, "asset:" + content_hash, action="asset_stage",
                           payload={"filename": filename, "sha256": content_hash,
                                    "bytes": b64encode(content).decode("ascii")},
                           provides=(), line=line)
    preview.add(Kind.EVIDENCE, target.subject + ":asset:" + filename, action="evidence",
                payload={"filename": filename, "sha256": content_hash,
                         "bytes": b64encode(content).decode("ascii"), "comment": comment,
                         "image": image, "only_created": only_created,
                         "staged_by": artifact.id},
                requires=(OutputRef(target.id, "record"),), settled_after=(artifact.id,), line=line)

    if pages:
        extracted = extract_pdf(content, pages)
        extracted_hash = sha256(extracted).hexdigest()
        name = Path(filename).stem + "-p" + pages.replace(",", "_") + ".pdf"
        transform = preview.add(Kind.EVIDENCE, "pdf:" + content_hash + ":" + pages, action="asset_extract",
            payload={"filename": name, "sha256": extracted_hash, "bytes": b64encode(content).decode("ascii"),
                     "pages": pages}, provides=(), settled_after=(artifact.id,), line=line)
        preview.add(Kind.EVIDENCE, target.subject + ":asset:" + name, action="evidence",
            payload={"filename": name, "sha256": extracted_hash, "bytes": b64encode(extracted).decode("ascii"),
                     "comment": "Datasheet extract", "staged_by": transform.id},
            requires=(OutputRef(target.id, "record"),), settled_after=(transform.id,), line=line)
