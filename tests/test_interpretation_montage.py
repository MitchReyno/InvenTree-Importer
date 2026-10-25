"""
The interpretation montage script: one paged PDF per import.

The script lives in the stock-import skill and is loaded by path. These tests
build a small version 2 import with tiny PNGs and check how its part sections
are paginated, that the PDF has one page per group, that web images are
fetched and banded, and that a plan's view of the server reaches the page.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest
from PIL import Image

SCRIPT = (Path(__file__).resolve().parents[1] / ".claude" / "skills"
          / "inventree-stock-import" / "scripts" / "interpretation_montage.py")


@pytest.fixture(scope="module")
def im():
    spec = importlib.util.spec_from_file_location("interpretation_montage", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def pages_in(pdf: Path) -> int:
    data = pdf.read_bytes()
    return data.count(b"/Type /Page\n") + data.count(b"/Type /Page ")


# --------------------------------------------------------------------------
# Pagination
# --------------------------------------------------------------------------
def test_paginate_never_splits_a_section(im):
    room = 800 - im.TOP - im.BOTTOM
    one, three = im.HEAD + im.ROW, im.HEAD + 3 * im.ROW
    pages = im.paginate([("a", one), ("b", one), ("c", three), ("d", one)], 800)
    assert pages == [["a"], ["b"], ["c"], ["d"]]
    # the three-line part is taller than a page, so it sits on a page of its own
    assert three > room


def test_paginate_fills_a_page_before_breaking(im):
    one = im.HEAD + im.ROW
    assert im.paginate([("a", one), ("b", one), ("c", one)], 4000) == [["a", "b", "c"]]


def test_plan_lines_make_a_section_taller(im):
    ls = [{"id": "l01"}]
    plan = {"l01": {"action": "created", "quantity": 1, "existing_part": {
        "pk": 5, "ipn": "IC-1", "stock": [{"pk": 9, "quantity": 63, "location": "Bin"}]}}}
    assert im.section_height(ls, plan) > im.section_height(ls, None)


# --------------------------------------------------------------------------
# A small import
# --------------------------------------------------------------------------
def write_import(tmp_path, *, image_a="photos/a.png"):
    folder = tmp_path / "imp"
    (folder / "photos" / "source").mkdir(parents=True)
    for name in ("a", "b", "c", "d"):
        Image.new("RGB", (40, 40), (200, 200, 200)).save(folder / "photos" / f"{name}.png")
        Image.new("RGB", (60, 40), (150, 150, 150)).save(folder / "photos" / "source" / f"{name}.png")
    parts = [{"id": k, "name": k.upper(), "category": "Integrated Circuits/Misc",
              "description": f"part {k}", "image": f"photos/{k}.png"} for k in "abcd"]
    parts[0]["image"] = image_a
    lines = [{"id": "l01", "part": "a", "quantity": 1, "stock_images": ["photos/a.png"]},
             {"id": "l02", "part": "b", "quantity": 1, "stock_images": ["photos/b.png"]},
             {"id": "l03", "part": "c", "quantity": 1, "stock_images": ["photos/c.png"]},
             {"id": "l04", "part": "c", "quantity": 2, "stock_images": ["photos/c.png"]},
             {"id": "l05", "part": "c", "quantity": 3, "stock_images": ["photos/c.png"]},
             {"id": "l06", "part": "d", "quantity": 1, "location": "Bin 1",
              "stock_images": ["photos/d.png"]}]
    doc = {"version": 2, "parts": parts, "manufacturer_parts": [], "lines": lines}
    path = folder / "imp.json"
    path.write_text(json.dumps(doc))
    sources = {l["id"]: [f"photos/source/{l['part']}.png"] for l in lines}
    (folder / "imp.sources.json").write_text(json.dumps(sources))
    return path


def run(im, monkeypatch, *args):
    monkeypatch.setattr(sys, "argv", ["montage", *map(str, args)])
    im.main()


def test_writes_one_paged_pdf(im, tmp_path, monkeypatch, capsys):
    path = write_import(tmp_path)
    out = tmp_path / "out"
    run(im, monkeypatch, path, out, "--width", "600")
    pdf = out / "imp.pdf"
    assert pdf.read_bytes().startswith(b"%PDF")
    assert [p.name for p in out.iterdir()] == ["imp.pdf"]
    # no-location group: a, b, c on a page each (600 px pages fit one part);
    # the Bin 1 location starts its own page
    assert pages_in(pdf) == 4
    captured = capsys.readouterr()
    assert "imp.pdf 4 page(s)" in captured.out
    assert "no --plan given" in captured.err


def test_an_import_with_no_lines_writes_nothing(im, tmp_path, monkeypatch, capsys):
    folder = tmp_path / "imp"
    folder.mkdir()
    path = folder / "imp.json"
    path.write_text(json.dumps({"version": 2, "parts": [], "lines": []}))
    out = tmp_path / "out"
    run(im, monkeypatch, path, out, "--width", "600")
    assert not out.exists() or list(out.iterdir()) == []
    assert "has no lines; no montage written" in capsys.readouterr().err


# --------------------------------------------------------------------------
# Web images
# --------------------------------------------------------------------------
def test_band_overlays_the_bottom_of_an_image(im):
    pic = Image.new("RGB", (200, 140), (255, 255, 255))
    im.band(pic, "WEB IMAGE\nexample.com", im.WEB_C)
    # inside the two-line band (bottom 42 px), right of its text and clear
    # of the 4 px outline that frames the whole image
    assert pic.getpixel((180, 115)) == im.WEB_C
    assert pic.getpixel((100, 60)) == (255, 255, 255)  # the picture above it


def test_a_url_part_image_is_fetched_and_cached(im, tmp_path, monkeypatch):
    buf = io.BytesIO()
    Image.new("RGB", (50, 50), (10, 200, 10)).save(buf, "PNG")
    calls = []

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def urlopen(req, timeout=0):
        calls.append(req.full_url)
        return Response(buf.getvalue())

    monkeypatch.setattr(im.urllib.request, "urlopen", urlopen)
    url = "https://i.example.com/chip.jpg"
    path = write_import(tmp_path, image_a=url)
    out = tmp_path / "out"
    run(im, monkeypatch, path, out, "--width", "600")
    run(im, monkeypatch, path, out, "--width", "600")
    assert calls == [url]                          # cached after the first run
    assert len(list((out / ".web-cache").iterdir())) == 1


def test_an_unreachable_url_is_drawn_missing(im, tmp_path, monkeypatch):
    def urlopen(req, timeout=0):
        raise OSError("offline")
    monkeypatch.setattr(im.urllib.request, "urlopen", urlopen)
    cache = tmp_path / "cache"
    cache.mkdir()  # left behind by an earlier run; the file itself was never written
    monkeypatch.setattr(im, "WEB_CACHE", cache)
    assert im.fetch("https://example.com/x.jpg") is None
    assert list(cache.iterdir()) == []
    pic, ok = im.load(None, 100)
    assert not ok


def test_load_lets_a_bad_path_type_raise(im):
    with pytest.raises(AttributeError):
        im.load(123, 100)


# --------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------
EXISTING = {"pk": 590, "ipn": "IC-00126", "name": "A", "has_image": True,
            "image": "plan-images/part-590.png",
            "stock": [{"pk": 701, "quantity": 63, "batch": "", "packaging": "Foil bag",
                       "location": "Bin 1"},
                      {"pk": 702, "quantity": 1, "batch": "B58608", "packaging": "",
                       "location": "Bin 1"}]}


def test_plan_lines_for_an_existing_part(im):
    plan = {"l06": {"action": "created", "quantity": 1, "existing_part": EXISTING,
                    "manufacturer_part": {"pk": 567, "exists": True},
                    "supplier_part": None, "part_notes_kept": True}}
    text = [t for t, _ in im.plan_lines([{"id": "l06", "manufacturer": "M"}], plan)]
    assert text[0] == "Already on the server: 64 pcs in 2 stock item(s):"
    assert any("stock #701" in t and "63 pcs" in t for t in text)
    assert any(t.startswith("After this import: 65 pcs in 3 stock item(s)") for t in text)
    links = next(t for t in text if t.startswith("Links:"))
    assert "manufacturer part #567 existing" in links
    assert "supplier part new" in links
    assert "server's kept" in links


def test_plan_lines_for_a_new_part(im):
    plan = {"l01": {"action": "created", "quantity": 2, "ipn": "IC-9", "existing_part": None}}
    (text, colour), = im.plan_lines([{"id": "l01"}], plan)
    assert text.startswith("Not on the server: the import creates this part (IC-9)")
    assert "no manufacturer" in text
    assert colour == im.NEW_C


def test_line_badges_and_locations(im):
    assert im.line_badge({"action": "created"})[0] == "+ NEW STOCK ITEM"
    assert im.line_badge({"action": "exists", "stock_item": {"pk": 7}})[0] == \
        "= ALREADY IMPORTED (stock #7)"
    assert im.line_badge({"action": "skipped"})[0] == "- SKIPPED"
    assert im.line_badge(None) is None
    beside = im.location_text({}, {"location": "Bin 1", "existing_part": EXISTING})
    assert beside[0] == "location: Bin 1  (existing, beside #701, #702)"
    assert "NEW" in im.location_text({}, {"location": "Bin 2", "new_location": True})[0]


def test_montage_with_a_plan(im, tmp_path, monkeypatch, capsys):
    path = write_import(tmp_path)
    plan_dir = tmp_path / "plan"
    (plan_dir / "plan-images").mkdir(parents=True)
    Image.new("RGB", (40, 40), (0, 0, 0)).save(plan_dir / "plan-images" / "part-590.png")
    lines = [{"id": f"l0{i}", "action": "created", "quantity": 1, "existing_part": None}
             for i in range(1, 6)]
    lines.append({"id": "l06", "action": "created", "quantity": 1, "location": "Bin 1",
                  "existing_part": EXISTING})
    (plan_dir / "plan.json").write_text(json.dumps({"file": str(path), "lines": lines}))
    out = tmp_path / "out"
    run(im, monkeypatch, path, out, "--width", "600", "--plan", plan_dir / "plan.json")
    assert pages_in(out / "imp.pdf") == 4
    assert "no --plan given" not in capsys.readouterr().err
