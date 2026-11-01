"""
The company-logos scripts must survive flaky archives and clean scans exactly.

find_in_pdf.py fetches large scans from archive sites that drop connections
and rate-limit, so a download resumes rather than restarting and waits as the
server asks. scan_logo.py's masks and uneven-paper whitening change what ends
up as a company's image, so each is held to touching only what it should. The
network is faked: nothing here downloads anything.
"""

from __future__ import annotations

import email.message
import importlib.util
import io
import ssl
import urllib.error

import pytest
from PIL import Image, ImageDraw

from invimport.config import CONFIG_DIR

SCRIPTS = CONFIG_DIR.parent / ".claude" / "skills" / "company-logos" / "scripts"
URL = "https://example.org/Archive/Electronics%201971.pdf"
BODY = bytes(range(256)) * 40


def load(name):
    spec = importlib.util.spec_from_file_location(
        f"logo_{name}", SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def fip(monkeypatch):
    module = load("find_in_pdf")
    module.waits = []
    monkeypatch.setattr(module, "sleep", module.waits.append)
    return module


class Response(io.BytesIO):
    """A urlopen response; fails with `error` after `upto` bytes if given."""

    def __init__(self, data, status=200, headers=None, upto=None, error=None):
        super().__init__(data)
        self.status = status
        self.headers = email.message.Message()
        for key, value in (headers or {}).items():
            self.headers[key] = value
        self.upto, self.error = upto, error

    def read(self, size=-1):
        if self.error and self.tell() >= self.upto:
            raise self.error
        if self.upto is not None and size and size > 0:
            size = min(size, self.upto - self.tell()) or size
        return super().read(size)


def http_error(code, headers=None):
    message = email.message.Message()
    for key, value in (headers or {}).items():
        message[key] = value
    return urllib.error.HTTPError(URL, code, "error", message, None)


def serve(monkeypatch, module, *replies):
    """Answer each urlopen with the next reply; record the Range asked."""
    replies = list(replies)
    ranges = []

    def urlopen(request, timeout=None):
        ranges.append(request.get_header("Range"))
        reply = replies.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        return reply

    monkeypatch.setattr(module.urllib.request, "urlopen", urlopen)
    return ranges


def whole(**kw):
    return Response(BODY, headers={"Content-Length": str(len(BODY))}, **kw)


def rest(start):
    return Response(BODY[start:], status=206, headers={
        "Content-Range": f"bytes {start}-{len(BODY) - 1}/{len(BODY)}"})


def test_download_names_the_file_after_the_url(fip, monkeypatch, tmp_path):
    serve(monkeypatch, fip, whole())
    path = fip.download(URL, tmp_path)
    assert path.name == "Electronics 1971.pdf"
    assert path.read_bytes() == BODY
    assert not list(tmp_path.glob("*.part"))


def test_ssl_error_mid_transfer_resumes_from_the_bytes_received(
        fip, monkeypatch, tmp_path):
    cut = 4000
    ranges = serve(monkeypatch, fip,
                   whole(upto=cut, error=ssl.SSLError("record layer failure")),
                   rest(cut))
    path = fip.download(URL, tmp_path)
    assert path.read_bytes() == BODY
    assert ranges == [None, f"bytes={cut}-"]
    assert fip.waits == [fip.BACKOFF]


def test_a_short_transfer_is_resumed_not_kept(fip, monkeypatch, tmp_path):
    short = Response(BODY[:3000], headers={"Content-Length": str(len(BODY))})
    ranges = serve(monkeypatch, fip, short, rest(3000))
    assert fip.download(URL, tmp_path).read_bytes() == BODY
    assert ranges == [None, "bytes=3000-"]


def test_a_partial_file_from_an_earlier_run_is_resumed(
        fip, monkeypatch, tmp_path):
    (tmp_path / "Electronics 1971.pdf.part").write_bytes(BODY[:5000])
    ranges = serve(monkeypatch, fip, rest(5000))
    assert fip.download(URL, tmp_path).read_bytes() == BODY
    assert ranges == ["bytes=5000-"]
    assert fip.waits == []


def test_a_server_ignoring_the_range_starts_again(fip, monkeypatch, tmp_path):
    (tmp_path / "Electronics 1971.pdf.part").write_bytes(b"x" * 5000)
    serve(monkeypatch, fip, whole())
    assert fip.download(URL, tmp_path).read_bytes() == BODY


def test_a_range_past_the_end_means_the_file_is_complete(
        fip, monkeypatch, tmp_path):
    (tmp_path / "Electronics 1971.pdf.part").write_bytes(BODY)
    serve(monkeypatch, fip, http_error(416))
    assert fip.download(URL, tmp_path).read_bytes() == BODY


def test_429_waits_for_retry_after(fip, monkeypatch, tmp_path):
    serve(monkeypatch, fip, http_error(429, {"Retry-After": "37"}), whole())
    assert fip.download(URL, tmp_path).read_bytes() == BODY
    assert fip.waits == [37.0]


def test_429_without_retry_after_backs_off_and_doubles(
        fip, monkeypatch, tmp_path):
    serve(monkeypatch, fip, http_error(429), http_error(503), whole())
    fip.download(URL, tmp_path)
    assert fip.waits == [fip.BACKOFF, fip.BACKOFF * 2]


def test_a_retry_after_date_and_a_huge_wait_are_capped(fip):
    assert fip.retry_after("Wed, 21 Oct 2015 07:28:00 GMT") == 0.0
    assert fip.retry_after("soon") is None
    assert fip.backoff(30) == fip.MAX_WAIT


def test_404_fails_at_once(fip, monkeypatch, tmp_path):
    serve(monkeypatch, fip, http_error(404))
    with pytest.raises(urllib.error.HTTPError):
        fip.download(URL, tmp_path)
    assert fip.waits == []


def test_giving_up_keeps_the_partial_file(fip, monkeypatch, tmp_path):
    serve(monkeypatch, fip,
          whole(upto=2000, error=ConnectionResetError("reset")),
          *[ConnectionResetError("reset")] * 2)
    with pytest.raises(SystemExit, match="run again to resume"):
        fip.download(URL, tmp_path, retries=2)
    assert (tmp_path / "Electronics 1971.pdf.part").read_bytes() \
        == BODY[:2000]
    assert not (tmp_path / "Electronics 1971.pdf").exists()


# --- scan_logo.py ---------------------------------------------------------

PAPER = (236, 226, 198)
BLOTCH = (242, 204, 208)
RED = (200, 30, 40)


@pytest.fixture
def scan():
    return load("scan_logo")


@pytest.fixture
def page():
    """Aged paper with a pink blotch, a black-and-red mark and a stray 'V'."""
    im = Image.new("RGB", (400, 300), PAPER)
    d = ImageDraw.Draw(im)
    d.ellipse((60, 60, 180, 160), fill=BLOTCH)
    d.rectangle((100, 100, 200, 200), fill=(20, 20, 20))
    d.rectangle((120, 120, 180, 180), fill=RED)
    d.rectangle((210, 180, 230, 200), fill=(20, 20, 20))   # the stray letter
    return im


def test_without_a_mask_the_neighbouring_letter_is_kept(scan, page):
    logo, box, *_ = scan.cut(page, (40, 40, 260, 240))
    assert box[2] > 230


def test_a_mask_paints_out_text_inside_the_region(scan, page):
    logo, box, paper, painted, level, edge = scan.cut(
        page, (40, 40, 260, 240), masks=[(205, 175, 235, 205)])
    assert painted == [(205, 175, 235, 205)]
    assert paper == PAPER
    # trimmed to the mark alone (plus the 4% margin), the letter gone
    assert box[0] >= 90 and box[2] <= 210
    assert not edge


def test_a_mask_outside_the_region_is_ignored(scan, page, capsys):
    *_, painted, _, _ = scan.cut(page, (40, 40, 260, 240),
                                 masks=[(300, 250, 320, 270)])
    assert painted == []
    assert "outside the region" in capsys.readouterr().out


def test_plain_whiten_leaves_the_blotch_tinted(scan, page):
    logo, *_ = scan.cut(page, (40, 40, 260, 240), whiten_paper=True)
    pixels = set(logo.getdata())
    assert (255, 255, 255) in pixels
    assert any(p[0] == 255 and p[1] < 240 for p in pixels)   # pink remains


def test_whiten_uneven_clears_paper_and_blotch_but_keeps_the_logo(scan, page):
    logo, box, paper, painted, level, edge = scan.cut(
        page, (40, 40, 260, 240), masks=[(205, 175, 235, 205)], uneven=True)
    assert level == scan.lightness(PAPER) - scan.INK
    colours = set(logo.getdata())
    assert colours == {(255, 255, 255), (20, 20, 20), RED}


def test_whiten_uneven_level_and_tint_are_tunable(scan):
    im = Image.new("RGB", (3, 1))
    im.putdata([(230, 230, 230), (250, 215, 215), (120, 120, 120)])
    assert list(scan.whiten_uneven(im, 200, 0.25).getdata()) == [
        (255, 255, 255), (255, 255, 255), (120, 120, 120)]
    # a stricter tint keeps the pink; a higher level keeps the grey
    assert list(scan.whiten_uneven(im, 240, 0.1).getdata())[1] \
        == (250, 215, 215)
    assert list(scan.whiten_uneven(im, 240 + scan.RAMP, 0.25)
                .getdata())[0] == (230, 230, 230)


def test_whiten_uneven_ramps_ink_edges(scan):
    im = Image.new("RGB", (1, 1), (190, 190, 190))
    (v,) = scan.whiten_uneven(im, 200).getdata()
    assert 190 < v[0] < 255
