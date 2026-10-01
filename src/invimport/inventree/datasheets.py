"""
Datasheets kept on the InvenTree server rather than only linked from it.

A datasheet URL is a promise someone else keeps. Vintage parts in particular
lean on datasheet mirrors and scanned data books that come and go, and a dead
link on a part is a fact lost. So a datasheet can also be a file attached to
the Part and its ManufacturerPart:

    - a stock file line may name a local PDF (`"datasheet": "ds/82S137.pdf"`),
    - a URL is downloaded and attached when mirroring is asked for, and
    - `invimport datasheets` does the same for parts already imported.

`datasheet_pages` picks out part of a PDF - one device's pages out of a
190-page data book. Both are attached: the extract, so the device's datasheet
is one click away, and the whole document, because the pages around it (the
family's timing diagrams, the package outlines, the ordering codes) are often
where the rest of the answer is.

Attachments carry a comment starting DATASHEET_COMMENT, which is how a part
that already has one is recognised. Media on InvenTree needs a login, so these are
for the people using the server, not for linking from elsewhere.
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import re
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urldefrag, urlparse

import requests
from pypdf import PdfReader, PdfWriter

from .. import cache
from ..util import absolute_url, parse_pages
from .api import ManufacturerPart, Part, PartCategory
from .purchase_orders import ATTACHMENT_URL, attach_file

log = logging.getLogger(__name__)

DATASHEETS_DIR = cache.CACHE_ROOT / "datasheets"
DATASHEET_COMMENT = "Datasheet"
FULL_DOCUMENT_COMMENT = "Datasheet (full document)"
PART_MODEL = "part"
MANUFACTURER_PART_MODEL = "manufacturerpart"
LIST_LIMIT = 1000

# Downloads at once. Datasheet hosts are many and slow rather than few and
# busy, so a handful in flight is what makes a few hundred PDFs take minutes
# instead of most of an hour.
DOWNLOAD_WORKERS = 8

# The PDF header may follow a little junk; readers look in the first 1 KB.
PDF_MAGIC = b"%PDF-"
MAGIC_WINDOW = 1024

# Some datasheet hosts refuse the default python-requests agent outright.
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36")


# --------------------------------------------------------------------------
# Page ranges
# --------------------------------------------------------------------------
def pages_label(text: Any) -> str:
    """'140-142' -> 'p140-142', for a filename. '3, 5-6' -> 'p3_5-6'."""
    return "p" + "_".join(chunk.strip().replace(" ", "")
                          for chunk in str(text).split(","))


# --------------------------------------------------------------------------
# Getting the file
# --------------------------------------------------------------------------
def is_pdf(data: bytes) -> bool:
    return PDF_MAGIC in data[:MAGIC_WINDOW]


def _clean_name(name: str, fallback: str = "datasheet") -> str:
    stem = name[:-4] if name.lower().endswith(".pdf") else name
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._") or fallback
    return f"{stem[:80]}.pdf"


def download_path(url: str, cache_dir: Path = DATASHEETS_DIR) -> Path:
    """
    Where a downloaded datasheet is kept.

    One directory per URL (by digest) so the file inside keeps the URL's own
    name: that name is what the attachment is called on the server, and
    '82S137.pdf' says more than a hash does.
    """
    url, _ = urldefrag(url)
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    name = Path(unquote(urlparse(url).path)).name
    return cache_dir / digest / _clean_name(name)


def cached_pdf(url: str, cache_dir: Path = DATASHEETS_DIR) -> Path | None:
    """
    A PDF already in this URL's cache folder, whatever it is called.

    Some links will not download here - a redirect page, a bot wall - but
    open fine in a browser. A PDF fetched by hand and dropped into the URL's
    folder (see download_path) is used as though it had downloaded, under
    its own name, which is how 'cd4051b.pdf' can stand in for a link that
    ends 'suppproductinfo.tsp'.
    """
    folder = download_path(url, cache_dir).parent
    if not folder.is_dir():
        return None
    found = sorted(p for p in folder.glob("*.pdf") if p.is_file())
    return found[0] if found else None


def _fetch(url: str) -> requests.Response:
    """One GET. Separate so tests can stand in for the network."""
    return requests.get(url, timeout=60, headers={"User-Agent": USER_AGENT})


def download_pdf(url: str, *, cache_dir: Path = DATASHEETS_DIR,
                 refresh: bool = False) -> tuple[Path | None, str]:
    """
    Fetch a datasheet URL into the cache. Returns (file, reason).

    The file is None when the download failed or was not a PDF - many
    datasheet links are a viewer page, a login wall or a search result, and
    attaching one of those as "the datasheet" would be worse than none. The
    reason says which, for the report.
    """
    url, _ = urldefrag(url)               # '#page=140' is for the viewer
    path = download_path(url, cache_dir)
    if not refresh:
        cached = cached_pdf(url, cache_dir)
        if cached is not None:
            return cached, ""
    try:
        response = _fetch(url)
    except requests.RequestException as exc:
        return None, f"download failed: {exc.__class__.__name__}"
    if response.status_code != 200:
        return None, f"download failed: HTTP {response.status_code}"
    if not is_pdf(response.content):
        kind = response.headers.get("Content-Type", "").split(";")[0]
        return None, f"not a PDF ({kind or 'unknown type'})"
    path.parent.mkdir(parents=True, exist_ok=True)
    # Written aside and renamed into place, so a download running alongside
    # never sees half a file where the cached one should be.
    partial = path.with_name(f".{path.name}.{os.getpid()}."
                             f"{threading.get_ident()}.part")
    partial.write_bytes(response.content)
    os.replace(partial, path)
    log.debug("    cached datasheet %s", path)
    return path, ""


class Downloads:
    """
    download_pdf, shared by threads: each URL is fetched at most once.

    Parts often share a link - two speed grades out of one data book - and a
    second thread asking for a URL already on its way waits for that download
    rather than starting its own.
    """

    def __init__(self, *, cache_dir: Path = DATASHEETS_DIR,
                 refresh: bool = False):
        self.cache_dir = cache_dir
        self.refresh = refresh
        self._lock = threading.Lock()
        self._results: dict[str, Future] = {}

    def get(self, url: str) -> tuple[Path | None, str]:
        url, _ = urldefrag(url)
        with self._lock:
            future = self._results.get(url)
            owner = future is None
            if owner:
                future = self._results[url] = Future()
        if owner:
            try:
                future.set_result(download_pdf(
                    url, cache_dir=self.cache_dir, refresh=self.refresh))
            except Exception as exc:             # pragma: no cover
                future.set_result((None, f"download failed: {exc}"))
        return future.result()


def prefetch(urls, *, cache_dir: Path = DATASHEETS_DIR,
             workers: int = DOWNLOAD_WORKERS) -> None:
    """
    Download these URLs into the cache, several at once.

    Results are not returned: whoever resolves the datasheet next finds the
    file cached, and a failure is simply fetched - and reported - again then.
    """
    wanted = list(dict.fromkeys(u for u in (absolute_url(x) for x in urls) if u))
    if len(wanted) < 2 or workers < 2:
        return
    downloads = Downloads(cache_dir=cache_dir)
    with ThreadPoolExecutor(max_workers=min(workers, len(wanted))) as pool:
        list(pool.map(downloads.get, wanted))


def extract_pages(source: Path, pages_text: str, *,
                  cache_dir: Path = DATASHEETS_DIR) -> tuple[Path | None, str]:
    """
    A PDF holding only the given pages of source. Returns (file, reason).

    Written under the cache, never next to the source, and reused if it is
    already there. The name records the pages ('book_p140-142.pdf') so the
    attachment says what it is a slice of.
    """
    pages = parse_pages(pages_text)
    if not pages:
        return None, f"datasheet_pages {pages_text!r} is not a page list"
    digest = hashlib.sha256(
        f"{source.resolve()}|{source.stat().st_size}".encode()).hexdigest()[:16]
    stem = _clean_name(source.name)[:-4]
    target = cache_dir / "pages" / digest / f"{stem}_{pages_label(pages_text)}.pdf"
    if target.exists():
        return target, ""
    try:
        reader = PdfReader(str(source))
        count = len(reader.pages)
        beyond = [p for p in pages if p > count]
        if beyond:
            return None, (f"page {beyond[0]} is past the end - "
                          f"{source.name} has {count} pages")
        writer = PdfWriter()
        for number in pages:
            writer.add_page(reader.pages[number - 1])
        buffer = io.BytesIO()
        writer.write(buffer)
    except Exception as exc:
        return None, f"could not read {source.name} as a PDF: {exc}"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(buffer.getvalue())
    return target, ""


@dataclass
class DatasheetFile:
    """One file to attach, and the comment it is attached with."""
    path: Path
    comment: str = DATASHEET_COMMENT


def resolve_datasheet(source: str, *, base_dir: Path | None = None,
                      pages: str = "", mirror: bool = False,
                      cache_dir: Path = DATASHEETS_DIR,
                      refresh: bool = False
                      ) -> tuple[list[DatasheetFile], str]:
    """
    The files to attach for a line's datasheet. Returns (files, reason).

    A local path is used as it is; a URL only when mirroring, since without
    it the URL is stored as the part's link and that is the whole job.

    With pages, two files: the extract, as the datasheet, and the whole
    document beside it. If the pages cannot be cut out, the whole document is
    still attached as the datasheet - it does contain them - and the reason
    says what went wrong with the extract.

    The reason is empty on success, and otherwise says why a file is missing
    - including 'linked only' for an unmirrored URL, which is not a failure.
    """
    text = str(source or "").strip()
    if not text:
        return [], ""
    url = absolute_url(text)
    if url:
        if not mirror:
            return [], "linked only"
        path, reason = download_pdf(url, cache_dir=cache_dir, refresh=refresh)
    else:
        path = Path(text).expanduser()
        if not path.is_absolute() and base_dir is not None:
            path = base_dir / path
        if not path.is_file():
            return [], f"{text}: not a file"
        reason = ""
    if path is None:
        return [], reason
    if not pages:
        return [DatasheetFile(path)], ""
    extract, reason = extract_pages(path, pages, cache_dir=cache_dir)
    if extract is None:
        return [DatasheetFile(path)], reason
    return [DatasheetFile(extract),
            DatasheetFile(path, FULL_DOCUMENT_COMMENT)], ""


# --------------------------------------------------------------------------
# Attaching
# --------------------------------------------------------------------------
def attach_datasheet(api, files: list[DatasheetFile], *, part: int | None,
                     manufacturer_parts: list[int] | tuple[int, ...] = ()
                     ) -> int:
    """
    Attach datasheet files to a part and its manufacturer parts.

    Returns how many uploads were made. A record already holding a file of
    that name is left alone, so re-running attaches nothing twice.
    """
    uploaded = 0
    targets = [(PART_MODEL, part)] + [(MANUFACTURER_PART_MODEL, pk)
                                      for pk in manufacturer_parts]
    for file in files:
        for model_type, pk in targets:
            if pk is not None and attach_file(api, model_type, pk, file.path,
                                              file.comment):
                uploaded += 1
    return uploaded


def parts_with_datasheets(api) -> set[int]:
    """Parts already carrying an attachment commented as a datasheet."""
    response = api.get(ATTACHMENT_URL, params={
        "model_type": PART_MODEL, "limit": LIST_LIMIT})
    rows = (response.get("results") or []) if isinstance(response, dict) \
        else list(response or [])
    return {int(row["model_id"]) for row in rows
            if str(row.get("comment") or "").strip().startswith(
                DATASHEET_COMMENT)
            and row.get("model_id") is not None}


# --------------------------------------------------------------------------
# Back-filling parts already imported
# --------------------------------------------------------------------------
ATTACHED = "attached"
WOULD_ATTACH = "would attach"
HAS_ONE = "has one"
NO_LINK = "no link"
FAILED = "failed"


@dataclass
class BackfillItem:
    """One part, and what became of its datasheet."""
    part: int
    ipn: str = ""
    name: str = ""
    action: str = NO_LINK
    url: str = ""
    file: str = ""
    reason: str = ""


def candidate_urls(part, manufacturer_parts: list[Any]) -> list[str]:
    """
    Links that might be this part's datasheet, most likely first.

    A ManufacturerPart's link is only ever set from a datasheet, so those
    come first. The part's own link may be a datasheet or a product page -
    it is worth trying, and the PDF check sorts out which.
    """
    urls: list[str] = []
    for link in [getattr(mp, "link", "") for mp in manufacturer_parts] + [
            getattr(part, "link", "")]:
        url = absolute_url(link)
        if url and url not in urls:
            urls.append(url)
    return urls


def _category_pks(api, pathstring: str) -> set[int]:
    """The named category and everything under it."""
    categories = PartCategory.list(api, limit=LIST_LIMIT)
    wanted = pathstring.strip("/").casefold()
    roots = {c.pk for c in categories
             if str(getattr(c, "pathstring", "")).casefold() == wanted}
    if not roots:
        raise ValueError(f"no category {pathstring!r} on the server")
    found = set(roots)
    for category in categories:
        path = str(getattr(category, "pathstring", "")).casefold()
        if path.startswith(wanted + "/"):
            found.add(category.pk)
    return found


def _first_pdf(downloads: Downloads, urls: list[str]
               ) -> tuple[str, Path | None, list[str]]:
    """The first of these links that is a PDF: (url, file, why the others were not)."""
    reasons: list[str] = []
    for url in urls:
        path, reason = downloads.get(url)
        if path is not None:
            return url, path, reasons
        reasons.append(reason)
    return "", None, reasons


def backfill(api, *, write: bool = False, category: str = "",
             cache_dir: Path = DATASHEETS_DIR, refresh: bool = False,
             workers: int = DOWNLOAD_WORKERS,
             on_item: Callable[[BackfillItem], None] | None = None
             ) -> list[BackfillItem]:
    """
    Attach a copy of every part's linked datasheet that is not yet attached.

    Dry run by default. A dry run still downloads - that is the only way to
    say which links are real PDFs - but uploads nothing. Downloads are
    cached, so the run that writes does not fetch them again.

    Downloads run `workers` at a time. Uploads, and on_item, stay in part
    order on this thread, so the report reads the same however many ran.
    """
    parts = Part.list(api, limit=LIST_LIMIT)
    if category:
        keep = _category_pks(api, category)
        parts = [p for p in parts if getattr(p, "category", None) in keep]
    by_part: dict[int, list[Any]] = {}
    for mp in ManufacturerPart.list(api, limit=LIST_LIMIT):
        by_part.setdefault(int(mp.part), []).append(mp)
    done = parts_with_datasheets(api)

    parts = sorted(parts, key=lambda p: str(getattr(p, "IPN", "") or ""))
    links = {part.pk: candidate_urls(part, by_part.get(part.pk, []))
             for part in parts}
    downloads = Downloads(cache_dir=cache_dir, refresh=refresh)
    pool = ThreadPoolExecutor(max_workers=max(1, workers))
    pending = {part.pk: pool.submit(_first_pdf, downloads, links[part.pk])
               for part in parts
               if part.pk not in done and links[part.pk]}

    items: list[BackfillItem] = []
    try:
        for part in parts:
            item = BackfillItem(part=part.pk,
                                ipn=str(getattr(part, "IPN", "") or ""),
                                name=str(getattr(part, "name", "") or ""))
            urls = links[part.pk]
            if part.pk in done:
                item.action = HAS_ONE
            elif not urls:
                item.action = NO_LINK
            else:
                url, path, reasons = pending[part.pk].result()
                if path is None:
                    item.action = FAILED
                    item.url = urls[0]
                    item.reason = "; ".join(dict.fromkeys(reasons))
                else:
                    item.url, item.file = url, path.name
                    item.action = WOULD_ATTACH
                    if write:
                        same = [mp.pk for mp in by_part.get(part.pk, [])
                                if absolute_url(getattr(mp, "link", "")) == url]
                        attach_datasheet(api, [DatasheetFile(path)],
                                         part=part.pk, manufacturer_parts=same)
                        item.action = ATTACHED
            items.append(item)
            if on_item is not None:
                on_item(item)
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    return items
