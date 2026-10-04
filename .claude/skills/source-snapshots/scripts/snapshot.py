"""
Static snapshots of web pages, for keeping the sources a part was identified
from.

A link to an NSN listing, a distributor page or a forum post is evidence for
why a part was recorded the way it was - and links rot, sites redesign, and
listings get cancelled. A snapshot is one self-contained HTML file: the
page's stylesheets, images and fonts are inlined as data URIs, scripts and
frames are removed, and a banner at the top records when and from where the
copy was taken. It opens in any browser with no network access, and it can be
attached to the part like any other file.

    snap = take_snapshot("https://example.com/part")         # plain fetch
    snap = take_snapshot(url, render=True)                    # headless Chrome
    snap = take_snapshot(url, html=saved_dom)                 # HTML you already have
    path = write_snapshot(snap, Path("snapshots/part.html"))
    pdf  = print_pdf(path)                                    # optional, needs Chrome

From the command line (repo root; `requests` comes from the project env):

    uv run python .claude/skills/source-snapshots/scripts/snapshot.py URL [-o OUT]
        [--dir DIR] [--render] [--from-html FILE] [--pdf] [--timeout SECS]

The three ways of getting the page differ in what they can see. A plain fetch
gets what the server sends, which for a JavaScript-built page is an empty
shell. `render` asks headless Chrome for the DOM after scripts have run.
`html` takes markup obtained some other way - a logged-in or bot-protected
page saved from a real browser - and still inlines its resources from `url`.
The banner says which was used, because they are not equally trustworthy.
"""

from __future__ import annotations

import base64
import datetime as dt
import html as htmllib
import logging
import mimetypes
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

log = logging.getLogger(__name__)

USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/128.0 Safari/537.36")

# A snapshot that silently grows to hundreds of megabytes is worse than one
# that leaves a hero video out, so both a per-resource and a total cap apply.
# What is skipped is listed in the banner rather than dropped quietly.
MAX_RESOURCE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 30 * 1024 * 1024

FETCHED = "fetched"            # plain HTTP GET; no scripts were run
RENDERED = "rendered"          # DOM after headless Chrome ran the scripts
PROVIDED = "provided"          # markup supplied by the caller

METHOD_TEXT = {
    FETCHED: "Fetched directly over HTTP. No scripts were run, so content a "
             "page builds with JavaScript may be missing.",
    RENDERED: "Rendered in headless Chrome, then captured after its scripts "
              "had run.",
    PROVIDED: "Captured from page HTML saved in a browser session; resources "
              "were fetched from the page URL.",
}

# Elements whose content must not survive into a static copy.
DROP_WITH_CONTENT = {"script", "iframe", "frame", "frameset", "object",
                     "embed", "template", "applet"}
# Elements dropped but whose children are kept: with scripts gone, what a
# page shows in <noscript> is exactly what a reader of the copy should see.
UNWRAP = {"noscript"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}
DROP_LINK_RELS = {"preload", "prefetch", "modulepreload", "dns-prefetch",
                  "preconnect", "manifest", "prerender", "alternate",
                  "canonical", "amphtml", "search", "pingback"}
URL_ATTRS = {"href", "action", "cite", "longdesc"}

CSS_URL = re.compile(r"""url\(\s*(['"]?)(.*?)\1\s*\)""", re.I | re.S)
CSS_IMPORT = re.compile(
    r"""@import\s+(?:url\(\s*(['"]?)(.*?)\1\s*\)|(['"])(.*?)\3)\s*([^;]*);""",
    re.I | re.S)


class SnapshotError(Exception):
    """The page itself could not be captured."""


@dataclass
class Snapshot:
    """One captured page, ready to write."""
    url: str                                    # as requested
    final_url: str                              # after redirects
    html: str                                   # self-contained document
    title: str = ""
    captured_at: dt.datetime = field(
        default_factory=lambda: dt.datetime.now().astimezone())
    method: str = FETCHED
    status: int | None = None
    content_type: str = ""
    last_modified: str = ""
    server_date: str = ""
    inlined: int = 0
    skipped: list[str] = field(default_factory=list)
    removed: dict[str, int] = field(default_factory=dict)


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------
class _Resources:
    """Fetches page resources once each, within the size budget."""

    def __init__(self, session: requests.Session, timeout: float):
        self.session = session
        self.timeout = timeout
        self.cache: dict[str, str | None] = {}
        self.total = 0
        self.inlined = 0
        self.skipped: list[str] = []

    def data_uri(self, url: str, default_type: str = "") -> str | None:
        """The resource as a data: URI, or None if it was not captured."""
        if url in self.cache:
            return self.cache[url]
        result = None
        fetched = self._get(url)
        if fetched is not None:
            data, ctype = fetched
            ctype = ctype or default_type or _guess_type(url)
            if ctype.startswith("text/css"):
                data = inline_css(data.decode("utf-8", "replace"), url,
                                  self).encode("utf-8")
            result = (f"data:{ctype};base64,"
                      f"{base64.b64encode(data).decode('ascii')}")
            self.inlined += 1
        self.cache[url] = result
        return result

    def text(self, url: str) -> str | None:
        fetched = self._get(url)
        if fetched is None:
            return None
        self.inlined += 1
        return fetched[0].decode("utf-8", "replace")

    def _get(self, url: str) -> tuple[bytes, str] | None:
        if not url.startswith(("http://", "https://")):
            return None
        try:
            response = self.session.get(url, timeout=self.timeout,
                                        stream=True)
            response.raise_for_status()
            declared = int(response.headers.get("Content-Length") or 0)
            if declared > MAX_RESOURCE_BYTES:
                raise ValueError(f"{declared} bytes")
            data = response.raw.read(MAX_RESOURCE_BYTES + 1,
                                     decode_content=True)
            if len(data) > MAX_RESOURCE_BYTES:
                raise ValueError("over the per-resource limit")
            if self.total + len(data) > MAX_TOTAL_BYTES:
                raise ValueError("over the snapshot's total size limit")
        except Exception as exc:
            self.skipped.append(f"{url} ({_short(exc)})")
            return None
        self.total += len(data)
        ctype = response.headers.get("Content-Type", "").split(";")[0].strip()
        return data, ctype


def _short(exc: Exception) -> str:
    text = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return (text or type(exc).__name__)[:80]


def _guess_type(url: str) -> str:
    return (mimetypes.guess_type(urlparse(url).path)[0]
            or "application/octet-stream")


def _session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT,
                            "Accept-Language": "en"})
    return session


def _decode(response: requests.Response) -> str:
    """Page bytes to text, trusting a declared charset over a guess."""
    declared = response.encoding if "charset" in (
        response.headers.get("Content-Type", "").lower()) else None
    if not declared:
        match = re.search(rb"""<meta[^>]+charset=["']?([\w-]+)""",
                          response.content[:4096], re.I)
        declared = match.group(1).decode("ascii") if match else None
    try:
        return response.content.decode(declared or "utf-8", "replace")
    except LookupError:
        return response.content.decode("utf-8", "replace")


# --------------------------------------------------------------------------
# Rewriting
# --------------------------------------------------------------------------
def inline_css(css: str, base_url: str, resources: _Resources,
               depth: int = 0) -> str:
    """Stylesheet text with its imports and url() references inlined."""
    def do_import(match: re.Match) -> str:
        target = match.group(2) or match.group(4) or ""
        media = (match.group(5) or "").strip()
        if depth >= 3 or not target:
            return ""
        absolute = urljoin(base_url, target.strip())
        imported = resources.text(absolute)
        if imported is None:
            return ""
        body = inline_css(imported, absolute, resources, depth + 1)
        return f"@media {media} {{\n{body}\n}}" if media else body

    def do_url(match: re.Match) -> str:
        target = match.group(2).strip()
        if not target or target.startswith(("data:", "#")):
            return match.group(0)
        uri = resources.data_uri(urljoin(base_url, target))
        # Unquoted: base64 has no quotes or parentheses, and an unquoted
        # url() survives being placed inside a style="" attribute.
        return f"url({uri})" if uri else "url()"

    css = CSS_IMPORT.sub(do_import, css)
    return CSS_URL.sub(do_url, css)


class _Rewriter(HTMLParser):
    """Re-emits a document with resources inlined and active content gone."""

    def __init__(self, base_url: str, resources: _Resources):
        super().__init__(convert_charrefs=False)
        self.base_url = base_url
        self.resources = resources
        self.out: list[str] = []
        self.skip_depth = 0
        self.skip_tag = ""
        self.in_style = False
        self.style_buf: list[str] = []
        self.in_title = False
        self.title_done = False
        self.title_parts: list[str] = []
        self.saw_body = False
        self.body_index: int | None = None
        self.head_index: int | None = None
        self.removed: dict[str, int] = {}

    # -- helpers ----------------------------------------------------------
    def _count(self, what: str) -> None:
        self.removed[what] = self.removed.get(what, 0) + 1

    def _absolute(self, value: str) -> str:
        value = value.strip()
        if not value or value.startswith(("#", "data:", "mailto:", "tel:",
                                          "javascript:")):
            return "#" if value.startswith("javascript:") else value
        return urljoin(self.base_url, value)

    def _emit_tag(self, tag: str, attrs: list[tuple[str, str]],
                  close: bool = False) -> None:
        parts = [tag]
        for name, value in attrs:
            if value is None:
                parts.append(name)
            else:
                parts.append(f'{name}="{htmllib.escape(value, quote=True)}"')
        self.out.append(f"<{' '.join(parts)}{' /' if close else ''}>")

    def _image_attrs(self, attrs: dict[str, str | None]) -> dict[str, str]:
        """Pick the real image source from lazy-loading patterns."""
        candidates = [attrs.get(k) for k in
                      ("data-src", "data-lazy-src", "data-original", "src")]
        srcset = attrs.get("srcset") or attrs.get("data-srcset") or ""
        if srcset:
            first = srcset.split(",")[0].strip().split(" ")[0]
            candidates.append(first)
        for source in candidates:
            if source and not source.startswith("data:image/gif;base64,R0lG"):
                if source.startswith("data:"):
                    return {"src": source}
                uri = self.resources.data_uri(urljoin(self.base_url, source))
                if uri:
                    return {"src": uri}
                return {"src": "", "data-snapshot-missing":
                        urljoin(self.base_url, source)}
        return {}

    def _clean_attrs(self, tag: str, attrs: list[tuple[str, str | None]]
                     ) -> list[tuple[str, str]]:
        values = dict(attrs)
        cleaned: list[tuple[str, str]] = []
        replaced = {}
        if tag in ("img", "source", "input") and (
                tag != "input" or (values.get("type") or "").lower() == "image"):
            replaced = self._image_attrs(values)
        for name, value in attrs:
            lname = name.lower()
            if lname.startswith("on"):
                self._count("event handlers")
                continue
            if lname in ("srcset", "data-srcset", "data-src", "data-lazy-src",
                         "data-original", "loading", "integrity",
                         "crossorigin", "nonce", "sizes"):
                continue
            if lname == "src" and replaced:
                continue
            if lname == "src" and tag in ("audio", "video", "track"):
                cleaned.append((name, self._absolute(value or "")))
                continue
            if lname == "poster" and value:
                uri = self.resources.data_uri(urljoin(self.base_url, value))
                cleaned.append((name, uri or ""))
                continue
            if lname in URL_ATTRS and value is not None:
                cleaned.append((name, self._absolute(value)))
                continue
            if lname == "style" and value:
                cleaned.append((name, inline_css(value, self.base_url,
                                                 self.resources)))
                continue
            cleaned.append((name, value))
        cleaned.extend(replaced.items())
        return cleaned

    # -- parser callbacks -------------------------------------------------
    def handle_decl(self, decl: str) -> None:
        if not self.skip_depth:
            self.out.append(f"<!{decl}>")

    def handle_comment(self, data: str) -> None:
        return                                    # conditional comments too

    def handle_pi(self, data: str) -> None:
        return

    def handle_starttag(self, tag: str, attrs) -> None:
        self._start(tag, attrs, closed=False)

    def handle_startendtag(self, tag: str, attrs) -> None:
        self._start(tag, attrs, closed=True)

    def _start(self, tag: str, attrs, closed: bool) -> None:
        tag = tag.lower()
        if self.skip_depth:
            if tag == self.skip_tag and not closed:
                self.skip_depth += 1
            return
        values = {k.lower(): (v or "") for k, v in attrs}

        if tag in DROP_WITH_CONTENT:
            self._count(f"<{tag}>")
            if not closed and tag not in VOID:
                self.skip_depth, self.skip_tag = 1, tag
            return
        if tag in UNWRAP:
            return
        if tag == "base":
            if values.get("href"):
                self.base_url = urljoin(self.base_url, values["href"])
            return
        if tag == "meta":
            equiv = values.get("http-equiv", "").lower()
            if equiv in ("refresh", "content-security-policy") or (
                    "charset" in values) or (
                    equiv == "content-type"):
                return
        if tag == "link":
            rels = set(values.get("rel", "").lower().split())
            if "stylesheet" in rels and values.get("href"):
                href = urljoin(self.base_url, values["href"])
                css = self.resources.text(href)
                media = values.get("media")
                if css is not None:
                    body = inline_css(css, href, self.resources)
                    media_attr = (f' media="{htmllib.escape(media)}"'
                                  if media else "")
                    self.out.append(f"<style{media_attr}>{body}</style>")
                return
            if rels & {"icon", "shortcut", "apple-touch-icon"} and values.get(
                    "href"):
                uri = self.resources.data_uri(
                    urljoin(self.base_url, values["href"]))
                if uri:
                    self.out.append(f'<link rel="icon" href="{uri}">')
                return
            if rels & DROP_LINK_RELS or not rels:
                return
        if tag == "style":
            self.in_style = True
            self.style_buf = []
        if tag == "title" and not self.title_done:
            # Only the document's own title: inline SVG icons carry <title>
            # elements too, and their text is not the page's name.
            self.in_title = True

        self._emit_tag(tag, self._clean_attrs(tag, attrs), close=closed)
        if tag == "head" and self.head_index is None:
            self.head_index = len(self.out)
        if tag == "body" and not self.saw_body:
            self.saw_body = True
            self.body_index = len(self.out)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.skip_depth:
            if tag == self.skip_tag:
                self.skip_depth -= 1
            return
        if tag in UNWRAP or tag in DROP_WITH_CONTENT or tag in VOID:
            return
        if tag == "style" and self.in_style:
            self.in_style = False
            self.out.append(inline_css("".join(self.style_buf),
                                       self.base_url, self.resources))
        if tag == "title" and self.in_title:
            self.in_title = False
            self.title_done = True
        self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        if self.in_style:
            self.style_buf.append(data)
            return
        if self.in_title:
            self.title_parts.append(data)
        self.out.append(data)

    def handle_entityref(self, name: str) -> None:
        if not self.skip_depth:
            text = f"&{name};"
            if self.in_title:
                self.title_parts.append(htmllib.unescape(text))
            self.out.append(text)

    def handle_charref(self, name: str) -> None:
        if not self.skip_depth:
            text = f"&#{name};"
            if self.in_title:
                self.title_parts.append(htmllib.unescape(text))
            self.out.append(text)

    @property
    def title(self) -> str:
        return re.sub(r"\s+", " ", "".join(self.title_parts)).strip()


# --------------------------------------------------------------------------
# The banner
# --------------------------------------------------------------------------
def _fmt_time(moment: dt.datetime) -> str:
    local = moment.astimezone()
    utc = moment.astimezone(dt.timezone.utc)
    return (f"{local:%Y-%m-%d %H:%M:%S %Z (UTC%z)} "
            f"= {utc:%Y-%m-%d %H:%M:%S} UTC")


def banner_rows(snap: Snapshot) -> list[tuple[str, str, bool]]:
    """(label, value, is_link) rows shown at the top of the snapshot."""
    rows = [("Captured", _fmt_time(snap.captured_at), False),
            ("URL", snap.url, True)]
    if snap.final_url and snap.final_url != snap.url:
        rows.append(("Final URL (after redirects)", snap.final_url, True))
    if snap.title:
        rows.append(("Page title", snap.title, False))
    if snap.status is not None:
        rows.append(("HTTP status", str(snap.status), False))
    if snap.content_type:
        rows.append(("Content type", snap.content_type, False))
    if snap.last_modified:
        rows.append(("Last-Modified (server)", snap.last_modified, False))
    if snap.server_date:
        rows.append(("Date (server)", snap.server_date, False))
    rows.append(("Capture method", METHOD_TEXT.get(snap.method, snap.method),
                 False))
    removed = ", ".join(f"{n} {what}" for what, n in sorted(
        snap.removed.items()))
    contents = (f"{snap.inlined} resources inlined; "
                f"{len(snap.skipped)} could not be captured"
                + (f"; removed: {removed}" if removed else ""))
    rows.append(("Contents", contents, False))
    rows.append(("Note", "Static copy for reference. Scripts and frames are "
                         "removed; links still point to the live site.",
                 False))
    return rows


def banner_html(snap: Snapshot) -> str:
    cell = ("padding:2px 12px 2px 0;vertical-align:top;"
            "font:13px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;"
            "color:#1d1d1f;text-align:left;border:0;background:none")
    rows = []
    for label, value, is_link in banner_rows(snap):
        shown = htmllib.escape(value)
        if is_link:
            shown = (f'<a href="{htmllib.escape(value, quote=True)}" '
                     f'style="color:#0645ad;word-break:break-all">{shown}</a>')
        rows.append(f'<tr><th style="{cell};font-weight:600;'
                    f'white-space:nowrap">{htmllib.escape(label)}</th>'
                    f'<td style="{cell};word-break:break-word">{shown}</td>'
                    f"</tr>")
    skipped = ""
    if snap.skipped:
        items = "".join(f"<li>{htmllib.escape(s)}</li>"
                        for s in snap.skipped[:50])
        more = (f"<li>... and {len(snap.skipped) - 50} more</li>"
                if len(snap.skipped) > 50 else "")
        skipped = (f'<details style="margin-top:6px;font:12px/1.4 '
                   f'-apple-system,Helvetica,Arial,sans-serif;color:#444">'
                   f"<summary>Resources not captured</summary>"
                   f'<ul style="margin:4px 0 0 18px;padding:0">{items}{more}'
                   f"</ul></details>")
    return (
        '<div id="invimport-snapshot-banner" style="all:initial;display:block;'
        "box-sizing:border-box;width:100%;margin:0;padding:10px 16px;"
        "background:#fff8d6;border-bottom:3px solid #c9a400;"
        'position:relative;z-index:2147483647">'
        '<div style="font:700 14px/1.4 -apple-system,Helvetica,Arial,'
        'sans-serif;color:#5c4a00;margin:0 0 4px">'
        "Snapshot - static copy of a web page</div>"
        f'<table style="border-collapse:collapse;margin:0">'
        f'{"".join(rows)}</table>{skipped}</div>')


def _meta_tags(snap: Snapshot) -> str:
    pairs = {"snapshot:url": snap.url, "snapshot:final-url": snap.final_url,
             "snapshot:captured": snap.captured_at.isoformat(),
             "snapshot:method": snap.method,
             "snapshot:status": "" if snap.status is None else str(snap.status)}
    return "".join(f'<meta name="{k}" content="{htmllib.escape(v, quote=True)}">'
                   for k, v in pairs.items() if v)


def _assemble(rewriter: _Rewriter, snap: Snapshot) -> str:
    out = rewriter.out
    head_bits = '<meta charset="utf-8">' + _meta_tags(snap)
    banner = banner_html(snap)
    if rewriter.body_index is not None:
        out.insert(rewriter.body_index, banner)
    else:
        out.insert(0, banner)
    if rewriter.head_index is not None:
        out.insert(rewriter.head_index, head_bits)
    else:
        out.insert(0, head_bits)
    document = "".join(out)
    if not document.lstrip().lower().startswith("<!doctype"):
        document = "<!DOCTYPE html>\n" + document
    return document


# --------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------
def find_chrome() -> str | None:
    """A Chrome/Chromium binary, from INVIMPORT_CHROME or the usual places."""
    candidates = [os.environ.get("INVIMPORT_CHROME", ""),
                  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                  "/Applications/Chromium.app/Contents/MacOS/Chromium",
                  shutil.which("google-chrome") or "",
                  shutil.which("google-chrome-stable") or "",
                  shutil.which("chromium") or "",
                  shutil.which("chromium-browser") or ""]
    return next((c for c in candidates if c and Path(c).exists()), None)


CHROME_FLAGS = ["--headless=new", "--disable-gpu", "--no-first-run",
                "--no-default-browser-check", "--disable-extensions",
                "--disable-background-networking", "--disable-component-update",
                "--disable-sync", "--hide-scrollbars"]


def _run_chrome(args: list[str], output: Path, *, timeout: float,
                finished=None, watch: Path | None = None) -> None:
    """
    Run headless Chrome until `output` is complete, then stop it.

    Chrome writes a PDF or a DOM dump within seconds but often never exits:
    its updater and crash handler outlive the page and hold the process (and
    any captured pipes) open. So the result file is what is waited on, not
    the process - once it exists and has stopped growing, or `finished` says
    it is whole, Chrome's whole process group is stopped.
    """
    with open(output, "wb") as sink:
        process = subprocess.Popen(args, stdout=sink,
                                   stderr=subprocess.DEVNULL,
                                   start_new_session=True)
    watch = watch or output
    deadline = time.monotonic() + timeout
    last_size, stable_since = -1, None
    try:
        while time.monotonic() < deadline:
            exited = process.poll() is not None
            size = watch.stat().st_size if watch.exists() else 0
            if size and size == last_size:
                stable_since = stable_since or time.monotonic()
            else:
                stable_since = None
            last_size = size
            whole = size > 0 and (finished(watch) if finished else True)
            if whole and (exited or (stable_since and
                                     time.monotonic() - stable_since > 1.0)):
                return
            if exited and not size:
                raise SnapshotError("Chrome exited without producing output")
            time.sleep(0.25)
        raise SnapshotError(f"Chrome did not finish within {timeout:.0f}s")
    finally:
        if process.poll() is None:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(process.pid, sig)
                    process.wait(timeout=5)
                    break
                except subprocess.TimeoutExpired:
                    continue
                except (ProcessLookupError, PermissionError):
                    break


def render_dom(url: str, *, timeout: float = 60) -> str:
    """The page's DOM after headless Chrome has run its scripts."""
    chrome = find_chrome()
    if chrome is None:
        raise SnapshotError("--render needs Chrome or Chromium; set "
                            "INVIMPORT_CHROME to its path")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as work:
        dump = Path(work) / "dom.html"
        _run_chrome([chrome, *CHROME_FLAGS, f"--user-data-dir={work}/profile",
                     f"--user-agent={USER_AGENT}",
                     "--virtual-time-budget=10000", "--dump-dom", url],
                    dump, timeout=timeout,
                    finished=lambda p: b"</html>" in p.read_bytes()[-4096:]
                    .lower())
        text = dump.read_text(encoding="utf-8", errors="replace")
    if not text.strip():
        raise SnapshotError(f"Chrome could not render {url}")
    return text


def take_snapshot(url: str, *, html: str | None = None, render: bool = False,
                  timeout: float = 30,
                  session: requests.Session | None = None) -> Snapshot:
    """Capture a page as one self-contained HTML document."""
    session = session or _session()
    snap = Snapshot(url=url, final_url=url, html="")

    response = None
    try:
        response = session.get(url, timeout=timeout)
    except Exception as exc:
        if html is None and not render:
            raise SnapshotError(f"could not fetch {url}: {_short(exc)}")
    if response is not None:
        snap.final_url = response.url or url
        snap.status = response.status_code
        snap.content_type = response.headers.get("Content-Type", "")
        snap.last_modified = response.headers.get("Last-Modified", "")
        snap.server_date = response.headers.get("Date", "")

    if html is not None:
        snap.method, markup = PROVIDED, html
    elif render:
        snap.method, markup = RENDERED, render_dom(url, timeout=timeout * 2)
    else:
        if response is None:
            raise SnapshotError(f"could not fetch {url}")
        if response.status_code >= 400:
            raise SnapshotError(
                f"{url} answered HTTP {response.status_code}; for a "
                f"bot-protected page, save it from a browser and pass it "
                f"with --from-html")
        ctype = snap.content_type.lower()
        if "pdf" in ctype or response.content[:5] == b"%PDF-":
            raise SnapshotError(
                f"{url} is a PDF, not a web page - attach it as the line's "
                f"datasheet (or download it) instead")
        if ctype and "html" not in ctype and "xml" not in ctype:
            raise SnapshotError(f"{url} is {ctype}, not a web page")
        snap.method, markup = FETCHED, _decode(response)

    resources = _Resources(session, timeout)
    rewriter = _Rewriter(snap.final_url, resources)
    rewriter.feed(markup)
    rewriter.close()
    snap.title = rewriter.title
    snap.inlined = resources.inlined
    snap.skipped = resources.skipped
    snap.removed = rewriter.removed
    snap.html = _assemble(rewriter, snap)
    return snap


def default_name(snap: Snapshot) -> str:
    """'nsnparts.us_parts_nsn_5961007827187-20261004-153210.html'."""
    parsed = urlparse(snap.final_url or snap.url)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_",
                  f"{parsed.netloc}{parsed.path}").strip("_")
    stem = re.sub(r"_?\.html?$", "", stem)[:90] or "snapshot"
    return f"{stem}-{snap.captured_at:%Y%m%d-%H%M%S}.html"


def write_snapshot(snap: Snapshot, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(snap.html, encoding="utf-8")
    return path


def print_pdf(html_path: Path, pdf_path: Path | None = None, *,
              timeout: float = 120) -> Path:
    """Print a written snapshot to PDF with headless Chrome."""
    chrome = find_chrome()
    if chrome is None:
        raise SnapshotError("--pdf needs Chrome or Chromium; set "
                            "INVIMPORT_CHROME to its path")
    pdf_path = (pdf_path or html_path.with_suffix(".pdf")).resolve()
    if pdf_path.exists():
        pdf_path.unlink()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as work:
        log_file = Path(work) / "chrome.log"
        _run_chrome([chrome, *CHROME_FLAGS, f"--user-data-dir={work}/profile",
                     "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}",
                     html_path.resolve().as_uri()],
                    log_file, timeout=timeout, watch=pdf_path,
                    finished=_pdf_complete)
    if not _pdf_complete(pdf_path):
        raise SnapshotError(f"Chrome could not print {html_path}")
    return pdf_path


def _pdf_complete(path: Path) -> bool:
    try:
        data = path.read_bytes()
    except OSError:
        return False
    return data.startswith(b"%PDF-") and b"%%EOF" in data[-1024:]


# --- command line -----------------------------------------------------------

import argparse  # noqa: E402
import sys  # noqa: E402

DEFAULT_DIR = Path(".local_imports/snapshots")


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("url", help="the page to capture")
    parser.add_argument("-o", "--output", type=Path, metavar="PATH",
                        help="file to write (default: a name from the URL and "
                             f"time, in {DEFAULT_DIR}/ or --dir)")
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR,
                        metavar="DIR",
                        help="folder for the default file name")
    parser.add_argument("--render", action="store_true",
                        help="capture the DOM after headless Chrome has run "
                             "the page's scripts")
    parser.add_argument("--from-html", type=Path, metavar="FILE",
                        help="use this saved page HTML instead of fetching "
                             "the page; URL is still recorded and used for "
                             "its resources")
    parser.add_argument("--pdf", action="store_true",
                        help="also print the snapshot to PDF beside it")
    parser.add_argument("--timeout", type=float, default=30, metavar="SECS",
                        help="per-request timeout (default: 30)")


def run(args: argparse.Namespace) -> int:
    html = None
    if args.from_html:
        try:
            html = args.from_html.read_text(encoding="utf-8",
                                            errors="replace")
        except OSError as exc:
            print(f"cannot read {args.from_html}: {exc}")
            return 2
    try:
        snap = take_snapshot(args.url, html=html, render=args.render,
                             timeout=args.timeout)
    except SnapshotError as exc:
        print(f"snapshot failed: {exc}")
        return 1

    path = args.output or args.dir / default_name(snap)
    write_snapshot(snap, path)
    print(f"wrote {path}  ({path.stat().st_size // 1024} KB)")
    for label, value, _ in banner_rows(snap):
        print(f"  {label}: {value}")
    for skipped in snap.skipped[:10]:
        print(f"    not captured: {skipped}")
    if len(snap.skipped) > 10:
        print(f"    ... and {len(snap.skipped) - 10} more")

    if args.pdf:
        try:
            pdf = print_pdf(path)
        except SnapshotError as exc:
            print(f"pdf failed: {exc}")
            return 1
        print(f"wrote {pdf}  ({pdf.stat().st_size // 1024} KB)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="snapshot.py",
        description="Save a web page as one static HTML file (and PDF) "
                    "for attaching as a source.")
    add_arguments(parser)
    return run(parser.parse_args(argv))


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    sys.exit(main())
