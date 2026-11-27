"""Datasheets as files on the server: fetching, slicing, attaching."""

from __future__ import annotations

import io
import threading
import time
from types import SimpleNamespace

import pytest
from pypdf import PdfReader, PdfWriter

from invimport.inventree import datasheets
from invimport.inventree.api import connect
from invimport.inventree.datasheets import (
    ATTACHED,
    DATASHEET_COMMENT,
    FAILED,
    FULL_DOCUMENT_COMMENT,
    HAS_ONE,
    NO_LINK,
    WOULD_ATTACH,
    Downloads,
    backfill,
    download_path,
    download_pdf,
    extract_pages,
    prefetch,
    resolve_datasheet,
)
from invimport.util import parse_pages


def pdf_bytes(pages: int) -> bytes:
    """A real PDF of blank pages, each a distinct width so order shows."""
    writer = PdfWriter()
    for number in range(1, pages + 1):
        writer.add_blank_page(width=100 + number, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def widths(path) -> list[int]:
    return [int(page.mediabox.width) - 100 for page in PdfReader(str(path)).pages]


@pytest.fixture
def web(monkeypatch):
    """Stand in for the network: url -> (status, body, content type)."""
    pages: dict[str, tuple[int, bytes, str]] = {}
    fetched: list[str] = []
    web_delay = [0.0]            # seconds per fetch, to make threads overlap

    def fetch(url):
        fetched.append(url)
        time.sleep(web_delay[0])
        if url not in pages:
            raise datasheets.requests.ConnectionError("no route")
        status, body, kind = pages[url]
        return SimpleNamespace(status_code=status, content=body,
                               headers={"Content-Type": kind})

    monkeypatch.setattr(datasheets, "_fetch", fetch)
    return SimpleNamespace(pages=pages, fetched=fetched, delay=web_delay)


# --------------------------------------------------------------------------
# Page lists
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text,expected", [
    ("140-142", [140, 141, 142]),
    ("3, 5-6", [3, 5, 6]),
    ("7", [7]),
    (7, [7]),
    ("", []),
    (None, []),
])
def test_page_lists_are_read(text, expected):
    assert parse_pages(text) == expected


@pytest.mark.parametrize("text", ["p7", "0", "5-3", "1-2-3", "3,,4"])
def test_anything_else_is_not_a_page_list(text):
    assert parse_pages(text) is None


# --------------------------------------------------------------------------
# Downloading
# --------------------------------------------------------------------------
def test_a_pdf_is_downloaded_under_its_own_name(web, tmp_path):
    web.pages["https://host/lit/82S137.pdf"] = (200, pdf_bytes(1),
                                                "application/pdf")
    path, reason = download_pdf("https://host/lit/82S137.pdf",
                                cache_dir=tmp_path)
    assert reason == ""
    assert path.name == "82S137.pdf"
    assert path.read_bytes().startswith(b"%PDF-")


def test_a_page_fragment_is_not_part_of_the_download(web, tmp_path):
    """'#page=140' is for a viewer; the file is the same one."""
    web.pages["https://host/book.pdf"] = (200, pdf_bytes(1), "application/pdf")
    first, _ = download_pdf("https://host/book.pdf#page=140",
                            cache_dir=tmp_path)
    second, _ = download_pdf("https://host/book.pdf", cache_dir=tmp_path)
    assert first == second
    assert web.fetched == ["https://host/book.pdf"]


def test_a_cached_download_is_not_fetched_again(web, tmp_path):
    web.pages["https://host/ds.pdf"] = (200, pdf_bytes(1), "application/pdf")
    download_pdf("https://host/ds.pdf", cache_dir=tmp_path)
    download_pdf("https://host/ds.pdf", cache_dir=tmp_path)
    assert len(web.fetched) == 1


def test_a_pdf_placed_by_hand_stands_in_for_the_download(web, tmp_path):
    """A link that only a browser can follow still gets its datasheet."""
    url = "https://www.ti.com/general/docs/suppproductinfo.tsp?gotoUrl=cd4051b"
    folder = download_path(url, tmp_path).parent
    folder.mkdir(parents=True)
    (folder / "cd4051b.pdf").write_bytes(pdf_bytes(1))
    path, reason = download_pdf(url, cache_dir=tmp_path)
    assert (path.name, reason) == ("cd4051b.pdf", "")
    assert web.fetched == []


def test_a_web_page_is_not_taken_for_a_datasheet(web, tmp_path):
    """Viewer pages and login walls come back 200 too."""
    web.pages["https://host/ds"] = (200, b"<html>viewer</html>",
                                    "text/html; charset=utf-8")
    path, reason = download_pdf("https://host/ds", cache_dir=tmp_path)
    assert path is None
    assert reason == "not a PDF (text/html)"
    assert not list(tmp_path.rglob("*"))


def test_a_failed_download_says_why(web, tmp_path):
    web.pages["https://host/gone.pdf"] = (404, b"", "text/html")
    assert download_pdf("https://host/gone.pdf", cache_dir=tmp_path) == (
        None, "download failed: HTTP 404")
    assert download_pdf("https://nowhere/ds.pdf", cache_dir=tmp_path) == (
        None, "download failed: ConnectionError")


# --------------------------------------------------------------------------
# Slicing
# --------------------------------------------------------------------------
def test_only_the_named_pages_are_kept_in_order(tmp_path):
    book = tmp_path / "book.pdf"
    book.write_bytes(pdf_bytes(10))
    path, reason = extract_pages(book, "7-8, 3", cache_dir=tmp_path / "cache")
    assert reason == ""
    assert widths(path) == [7, 8, 3]
    assert path.name == "book_p7-8_3.pdf"


def test_the_source_is_never_written_next_to(tmp_path):
    book = tmp_path / "book.pdf"
    book.write_bytes(pdf_bytes(3))
    extract_pages(book, "2", cache_dir=tmp_path / "cache")
    assert sorted(p.name for p in tmp_path.iterdir()) == ["book.pdf", "cache"]


def test_a_page_past_the_end_is_refused(tmp_path):
    book = tmp_path / "book.pdf"
    book.write_bytes(pdf_bytes(3))
    path, reason = extract_pages(book, "2-4", cache_dir=tmp_path / "cache")
    assert path is None
    assert reason == "page 4 is past the end - book.pdf has 3 pages"


def test_a_file_that_is_not_a_pdf_cannot_be_sliced(tmp_path):
    fake = tmp_path / "scan.pdf"
    fake.write_bytes(b"not a pdf")
    path, reason = extract_pages(fake, "1", cache_dir=tmp_path / "cache")
    assert path is None
    assert reason.startswith("could not read scan.pdf as a PDF")


# --------------------------------------------------------------------------
# Resolving a line's datasheet
# --------------------------------------------------------------------------
def _named(files):
    return [(file.path.name, file.comment) for file in files]


def test_a_url_is_only_a_link_unless_mirroring(web, tmp_path):
    assert resolve_datasheet("https://host/ds.pdf", cache_dir=tmp_path) == (
        [], "linked only")
    assert web.fetched == []


def test_a_mirrored_url_is_downloaded(web, tmp_path):
    web.pages["https://host/ds.pdf"] = (200, pdf_bytes(2), "application/pdf")
    files, reason = resolve_datasheet("https://host/ds.pdf", mirror=True,
                                      cache_dir=tmp_path)
    assert reason == ""
    assert _named(files) == [("ds.pdf", DATASHEET_COMMENT)]


def test_pages_attach_the_extract_and_the_whole_document(web, tmp_path):
    """The device's pages are the datasheet; the book rides along."""
    web.pages["https://host/book.pdf"] = (200, pdf_bytes(5), "application/pdf")
    files, reason = resolve_datasheet("https://host/book.pdf#page=4",
                                      pages="4-5", mirror=True,
                                      cache_dir=tmp_path)
    assert reason == ""
    assert _named(files) == [("book_p4-5.pdf", DATASHEET_COMMENT),
                             ("book.pdf", FULL_DOCUMENT_COMMENT)]
    assert widths(files[0].path) == [4, 5]
    assert widths(files[1].path) == [1, 2, 3, 4, 5]


def test_pages_that_cannot_be_cut_still_attach_the_whole_document(tmp_path):
    """It contains the pages; only the shortcut to them is missing."""
    (tmp_path / "book.pdf").write_bytes(pdf_bytes(3))
    files, reason = resolve_datasheet("book.pdf", base_dir=tmp_path,
                                      pages="4-5",
                                      cache_dir=tmp_path / "cache")
    assert _named(files) == [("book.pdf", DATASHEET_COMMENT)]
    assert reason == "page 4 is past the end - book.pdf has 3 pages"


def test_a_local_path_is_relative_to_the_stock_file(tmp_path):
    (tmp_path / "ds").mkdir()
    (tmp_path / "ds" / "part.pdf").write_bytes(pdf_bytes(1))
    files, reason = resolve_datasheet("ds/part.pdf", base_dir=tmp_path)
    assert reason == ""
    assert [f.path for f in files] == [tmp_path / "ds" / "part.pdf"]


def test_a_missing_local_file_says_so(tmp_path):
    assert resolve_datasheet("ds/gone.pdf", base_dir=tmp_path) == (
        [], "ds/gone.pdf: not a file")


# --------------------------------------------------------------------------
# Back-filling parts already on the server
# --------------------------------------------------------------------------
@pytest.fixture
def parts(inventree, web):
    """
    Five memory parts, each in a different state, and a resistor:

        ROM-1  its manufacturer part links a PDF
        ROM-2  already has a datasheet attached
        ROM-3  no link anywhere
        ROM-4  links a viewer page, not a PDF
        ROM-5  a product page on the part, a PDF on the manufacturer part
        RES-1  a PDF, but in another category
    """
    ics = inventree.add_category("Integrated Circuits", pk=16)
    memory = inventree.add_category("Memory", parent=ics["pk"], pk=17)
    other = inventree.add_category("Resistors", pk=12)
    rom1 = inventree.add_part("82S137", "ROM-1", memory["pk"], pk=101)
    inventree.add_manufacturer_part(101, 9, "82S137", pk=201,
                                    link="https://host/82S137.pdf")
    inventree.add_part("2102", "ROM-2", memory["pk"], pk=102,
                       link="https://host/2102.pdf")
    inventree.attachments.append({
        "pk": 1, "model_type": "part", "model_id": 102,
        "comment": FULL_DOCUMENT_COMMENT, "filename": "2102.pdf"})
    inventree.add_part("2114", "ROM-3", memory["pk"], pk=103)
    inventree.add_part("27C256", "ROM-4", memory["pk"], pk=104,
                       link="https://host/viewer?id=27C256")
    inventree.add_part("28F020", "ROM-5", memory["pk"], pk=105,
                       link="https://shop/28F020")
    inventree.add_manufacturer_part(105, 9, "P28F020", pk=205,
                                    link="https://host/28F020.pdf")
    inventree.add_part("4k7", "RES-1", other["pk"], pk=106,
                       link="https://host/resistor.pdf")
    for name in ("82S137", "28F020", "resistor"):
        web.pages[f"https://host/{name}.pdf"] = (200, pdf_bytes(1),
                                                 "application/pdf")
    web.pages["https://host/viewer?id=27C256"] = (200, b"<html/>", "text/html")
    web.pages["https://shop/28F020"] = (200, b"<html/>", "text/html")
    return rom1


def _by_ipn(items):
    return {item.ipn: item for item in items}


def test_a_dry_run_reports_each_part_and_uploads_nothing(inventree, parts,
                                                         tmp_path):
    items = _by_ipn(backfill(connect(), cache_dir=tmp_path))
    assert {ipn: item.action for ipn, item in items.items()
            if ipn.startswith(("ROM-", "RES-"))} == {
        "ROM-1": WOULD_ATTACH, "ROM-2": HAS_ONE, "ROM-3": NO_LINK,
        "ROM-4": FAILED, "ROM-5": WOULD_ATTACH, "RES-1": WOULD_ATTACH}
    assert items["ROM-4"].reason == "not a PDF (text/html)"
    assert len(inventree.attachments) == 1          # the one already there


def test_the_manufacturer_part_link_is_tried_before_the_part_link(parts,
                                                                  tmp_path):
    """A part's own link may be a shop page; the MfrPart's is a datasheet."""
    items = _by_ipn(backfill(connect(), cache_dir=tmp_path))
    assert items["ROM-5"].url == "https://host/28F020.pdf"


def test_writing_attaches_to_the_part_and_its_manufacturer_part(inventree,
                                                                parts,
                                                                tmp_path):
    items = _by_ipn(backfill(connect(), write=True, cache_dir=tmp_path,
                             category="Integrated Circuits/Memory"))
    assert items["ROM-1"].action == ATTACHED
    new = [(a["model_type"], a["model_id"], a["filename"], a["comment"])
           for a in inventree.attachments[1:]]
    assert sorted(new) == [
        ("manufacturerpart", 201, "82S137.pdf", DATASHEET_COMMENT),
        ("manufacturerpart", 205, "28F020.pdf", DATASHEET_COMMENT),
        ("part", 101, "82S137.pdf", DATASHEET_COMMENT),
        ("part", 105, "28F020.pdf", DATASHEET_COMMENT),
    ]


def test_a_second_run_finds_nothing_left_to_do(inventree, parts, tmp_path):
    backfill(connect(), write=True, cache_dir=tmp_path)
    count = len(inventree.attachments)
    items = backfill(connect(), write=True, cache_dir=tmp_path)
    assert len(inventree.attachments) == count
    assert not [i for i in items if i.action == ATTACHED]


def test_a_category_takes_its_subcategories_and_nothing_else(parts, tmp_path):
    items = backfill(connect(), cache_dir=tmp_path,
                     category="Integrated Circuits")
    assert "RES-1" not in _by_ipn(items)
    assert "ROM-1" in _by_ipn(items)


def test_an_unknown_category_is_an_error(parts, tmp_path):
    with pytest.raises(ValueError, match="no category"):
        backfill(connect(), cache_dir=tmp_path, category="Nope")


# --------------------------------------------------------------------------
# Several downloads at once
# --------------------------------------------------------------------------
def test_threads_asking_for_one_url_share_one_download(web, tmp_path):
    """The second asker waits for the first download instead of repeating it."""
    web.pages["https://host/book.pdf"] = (200, pdf_bytes(1), "application/pdf")
    web.delay[0] = 0.2
    downloads = Downloads(cache_dir=tmp_path)
    results = []
    threads = [threading.Thread(target=lambda: results.append(
        downloads.get("https://host/book.pdf#page=3"))) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert web.fetched == ["https://host/book.pdf"]
    assert len({path for path, _ in results}) == 1


def test_no_partial_file_is_left_in_the_cache(web, tmp_path):
    web.pages["https://host/ds.pdf"] = (200, pdf_bytes(1), "application/pdf")
    download_pdf("https://host/ds.pdf", cache_dir=tmp_path)
    assert [p.name for p in tmp_path.rglob("*") if p.is_file()] == ["ds.pdf"]


def test_prefetch_fetches_each_link_once_and_skips_local_files(web, tmp_path):
    for name in ("a", "b"):
        web.pages[f"https://host/{name}.pdf"] = (200, pdf_bytes(1),
                                                 "application/pdf")
    prefetch(["https://host/a.pdf", "ds/local.pdf", "https://host/b.pdf",
              "https://host/a.pdf#page=2", ""], cache_dir=tmp_path)
    assert sorted(web.fetched) == ["https://host/a.pdf", "https://host/b.pdf"]
    assert download_pdf("https://host/a.pdf", cache_dir=tmp_path)[0].exists()
    assert len(web.fetched) == 2                    # served from the cache


def test_parallel_back_fill_reports_in_part_order(inventree, parts, web,
                                                  tmp_path):
    """Downloads finish in any order; the report and uploads do not."""
    web.delay[0] = 0.05
    serial = backfill(connect(), cache_dir=tmp_path / "one", workers=1)
    seen = []
    parallel = backfill(connect(), cache_dir=tmp_path / "many", workers=6,
                        on_item=lambda item: seen.append(item.ipn))
    assert parallel == serial
    assert seen == [item.ipn for item in serial]


def test_parts_sharing_a_link_download_it_once(inventree, web, tmp_path):
    """Two speed grades out of one data book is one download."""
    memory = inventree.add_category("Memory", pk=17)
    for pk, ipn in [(111, "ROM-A"), (112, "ROM-B"), (113, "ROM-C")]:
        inventree.add_part("2112", ipn, memory["pk"], pk=pk,
                           link="https://host/catalog.pdf#page=40")
    web.pages["https://host/catalog.pdf"] = (200, pdf_bytes(1),
                                             "application/pdf")
    web.delay[0] = 0.1
    items = backfill(connect(), cache_dir=tmp_path, workers=3)
    assert web.fetched == ["https://host/catalog.pdf"]
    assert [i.action for i in items if i.ipn.startswith("ROM-")] == \
        [WOULD_ATTACH] * 3
