"""Static snapshots of web pages: self-contained, inert, and labelled."""

from __future__ import annotations

import importlib.util
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

# The tool lives in the source-snapshots skill, not the invimport package.
_SCRIPT = (Path(__file__).resolve().parents[1]
           / ".claude/skills/source-snapshots/scripts/snapshot.py")
_spec = importlib.util.spec_from_file_location("source_snapshot", _SCRIPT)
snapshot = importlib.util.module_from_spec(_spec)
sys.modules["source_snapshot"] = snapshot
_spec.loader.exec_module(snapshot)

FETCHED = snapshot.FETCHED
PROVIDED = snapshot.PROVIDED
SnapshotError = snapshot.SnapshotError
default_name = snapshot.default_name
take_snapshot = snapshot.take_snapshot
write_snapshot = snapshot.write_snapshot

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
       b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f"
       b"\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")

PAGE = """<!DOCTYPE html>
<html><head>
<meta charset="iso-8859-1">
<meta http-equiv="refresh" content="5; url=/elsewhere">
<title>NSN 5961-00-782-7187 &amp; friends</title>
<link rel="stylesheet" href="/css/site.css">
<link rel="icon" href="/favicon.png">
<link rel="preconnect" href="https://cdn.example">
<style>.hero { background: url('/img/hero.png'); }</style>
<script src="/js/app.js"></script>
</head>
<body onload="track()">
<p class="hero">Rectifier, <a href="/parts/other">another part</a></p>
<img src="/img/chip.png" alt="chip">
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/img/lazy.png">
<img srcset="/img/chip.png 1x, /img/big.png 2x">
<img src="/img/missing.png">
<div style="background-image:url(/img/hero.png)" onclick="go()">x</div>
<script>document.write('<b>injected</b>')</script>
<iframe src="https://ads.example/frame"></iframe>
<noscript><p>Shown without scripts</p></noscript>
</body></html>"""

FILES = {
    "/page": ("text/html; charset=utf-8", PAGE.encode()),
    "/css/site.css": ("text/css",
                      b"@import url('/css/extra.css');\n"
                      b"body { background: url(../img/bg.png) }\n"
                      b"@font-face { src: url('/fonts/f.woff2') }"),
    "/css/extra.css": ("text/css", b"p { background: url(/img/extra.png) }"),
    "/favicon.png": ("image/png", PNG),
    "/img/hero.png": ("image/png", PNG),
    "/img/chip.png": ("image/png", PNG),
    "/img/lazy.png": ("image/png", PNG),
    "/img/bg.png": ("image/png", PNG),
    "/img/extra.png": ("image/png", PNG),
    "/fonts/f.woff2": ("font/woff2", b"wOF2fake"),
    "/datasheet.pdf": ("application/pdf", b"%PDF-1.4 fake"),
}


@pytest.fixture
def site():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/blocked":
                self.send_response(403)
                self.end_headers()
                return
            if self.path == "/old":
                self.send_response(301)
                self.send_header("Location", "/page")
                self.end_headers()
                return
            found = FILES.get(self.path)
            if found is None:
                self.send_response(404)
                self.end_headers()
                return
            ctype, body = found
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Last-Modified", "Tue, 01 Sep 2026 00:00:00 GMT")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


def test_the_copy_needs_nothing_from_the_network(site):
    """Every image, stylesheet and font is inlined; nothing loads remotely."""
    snap = take_snapshot(f"{site}/page")
    html = snap.html
    assert html.count("data:image/png;base64,") >= 6
    assert "data:font/woff2;base64," in html
    loaded = re.findall(r'<(?:img|link|source)[^>]*\s(?:src|href)="([^"]+)"',
                        html)
    assert all(u.startswith("data:") or u == "" for u in loaded), loaded
    css_urls = re.findall(r'url\("?([^")]*)', html)
    assert all(u.startswith("data:") or not u for u in css_urls), css_urls
    assert "@import" not in html


def test_active_content_is_removed(site):
    snap = take_snapshot(f"{site}/page")
    html = snap.html.lower()
    assert "<script" not in html
    assert "<iframe" not in html
    assert "injected" not in html
    assert "onload=" not in html and "onclick=" not in html
    assert 'http-equiv="refresh"' not in html
    assert "preconnect" not in html
    assert snap.removed["<script>"] == 2
    assert snap.removed["<iframe>"] == 1
    assert snap.removed["event handlers"] == 2


def test_noscript_content_is_kept(site):
    """With scripts gone, the no-script view is what a reader should see."""
    snap = take_snapshot(f"{site}/page")
    assert "Shown without scripts" in snap.html
    assert "<noscript" not in snap.html.lower()


def test_the_banner_says_when_where_and_how(site):
    snap = take_snapshot(f"{site}/old")
    html = snap.html
    banner = html[html.index("invimport-snapshot-banner"):]
    banner = banner[:banner.index("</table>")]
    assert f"{site}/old" in banner                 # as requested
    assert f"{site}/page" in banner                # after the redirect
    assert "Final URL" in banner
    assert snap.captured_at.strftime("%Y-%m-%d %H:%M:%S") in banner
    assert "UTC" in banner
    assert "NSN 5961-00-782-7187 &amp; friends" in banner
    assert "200" in banner
    assert "Tue, 01 Sep 2026 00:00:00 GMT" in banner
    assert "Fetched directly" in banner
    # The banner sits at the top of the body, before the page's own content.
    assert html.index("invimport-snapshot-banner") < html.index("Rectifier")
    assert snap.method == FETCHED
    assert snap.title == "NSN 5961-00-782-7187 & friends"


def test_the_capture_is_also_in_machine_readable_meta_tags(site):
    snap = take_snapshot(f"{site}/page")
    assert f'name="snapshot:url" content="{site}/page"' in snap.html
    assert 'name="snapshot:captured"' in snap.html
    assert snap.html.count("<meta charset") == 1  # the page's own is replaced
    assert "iso-8859-1" not in snap.html
    assert '<meta charset="utf-8">' in snap.html


def test_the_title_ignores_svg_icon_titles(site):
    saved = ('<html><head><title>Real title</title></head><body>'
             '<svg><title>Search Icon</title></svg></body></html>')
    snap = take_snapshot(f"{site}/page", html=saved)
    assert snap.title == "Real title"


def test_links_point_to_the_live_site(site):
    snap = take_snapshot(f"{site}/page")
    assert f'href="{site}/parts/other"' in snap.html


def test_what_could_not_be_captured_is_listed(site):
    snap = take_snapshot(f"{site}/page")
    assert any("/img/missing.png" in s for s in snap.skipped)
    assert any("/img/big.png" not in s for s in snap.skipped)
    assert "Resources not captured" in snap.html
    assert f"{len(snap.skipped)} could not be captured" in snap.html


def test_saved_html_is_used_with_resources_from_the_url(site):
    """A bot-protected page saved from a browser: markup given, URL kept."""
    saved = ('<html><head><title>Saved</title></head><body>'
             '<img src="/img/chip.png"><p>logged-in view</p></body></html>')
    snap = take_snapshot(f"{site}/blocked", html=saved)
    assert snap.method == PROVIDED
    assert "logged-in view" in snap.html
    assert "data:image/png;base64," in snap.html
    assert snap.status == 403
    assert "saved in a browser session" in snap.html


def test_a_refused_page_says_how_to_capture_it(site):
    with pytest.raises(SnapshotError, match="--from-html"):
        take_snapshot(f"{site}/blocked")


def test_a_pdf_is_not_snapshotted(site):
    with pytest.raises(SnapshotError, match="datasheet"):
        take_snapshot(f"{site}/datasheet.pdf")


def test_a_default_name_comes_from_the_url_and_time(site, tmp_path):
    snap = take_snapshot(f"{site}/page")
    name = default_name(snap)
    assert name.startswith("127.0.0.1_")
    assert name.endswith(f"{snap.captured_at:%Y%m%d-%H%M%S}.html")
    path = write_snapshot(snap, tmp_path / "out" / name)
    assert path.read_text(encoding="utf-8") == snap.html
