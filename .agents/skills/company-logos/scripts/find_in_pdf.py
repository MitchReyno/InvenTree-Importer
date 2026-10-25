"""Find the pages of a PDF that mention a company - an ad, a cover, a logo.

    uv run --with pillow python find_in_pdf.py URL_OR_PDF "Stewart.?Warner" OUT_DIR
        [--fuzzy] [--render 60] [--max 24] [--retries 8]

For scanned magazines and data books (worldradiohistory.com issues of
Electronics, bitsavers data books and EEM catalogues). A URL is streamed to
OUT_DIR/download/ - a fresh folder, never run from - and kept for
scan_logo.py. A dropped connection or SSL error resumes where it stopped (an
HTTP Range request) after a pause that doubles each time; HTTP 429 and 503
wait for the server's Retry-After. Up to --retries retries, then it stops and
keeps the partial NAME.part - running the same command again resumes it.
Several issues from one site: run them one after another, never in parallel.
Each page's text
(pdftotext) is searched for the pattern, case-insensitively; --fuzzy also
accepts OCR misreadings ("STEWART-LIJARAEll" for "Stewart-Warner") by
comparing the pattern's letters with each run of words on the page.

Prints each matching page with the text around the match, renders those pages
at --render dpi into OUT_DIR/pages/, and tiles them into OUT_DIR/matches.png
to look at. Page numbers are 1-based PDF pages, as scan_logo.py takes them.
"""

from __future__ import annotations

import argparse
import datetime
import difflib
import email.utils
import http.client
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

USER_AGENT = "InvenTree-Importer company-logos/1.0"
FUZZY = 0.8
# Retries after a failed or rate-limited fetch, the first pause (seconds,
# doubling each time) and the longest pause, Retry-After included.
RETRIES = 8
BACKOFF = 5.0
MAX_WAIT = 600.0
sleep = time.sleep


def retry_after(value: str | None) -> float | None:
    """Seconds to wait from a Retry-After header (seconds or an HTTP date)."""
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=datetime.timezone.utc)
    now = datetime.datetime.now(datetime.timezone.utc)
    return max(0.0, (when - now).total_seconds())


def backoff(attempt: int) -> float:
    return min(MAX_WAIT, BACKOFF * 2 ** attempt)


def download(url: str, folder: Path, retries: int = RETRIES) -> Path:
    """Stream url into folder, resuming and retrying when the transfer fails.

    The file grows as NAME.part and is renamed when complete, so a finished
    NAME is never a truncated one. A dropped connection or SSL error resumes
    from the bytes already on disk (an HTTP Range request) after a growing
    pause; HTTP 429 and 503 wait for the server's Retry-After (else the same
    pause). Other HTTP errors, such as 404, fail at once.
    """
    folder.mkdir(parents=True, exist_ok=True)
    name = Path(urllib.parse.urlparse(url).path).name or "document.pdf"
    name = urllib.parse.unquote(name)
    path = folder / name
    if path.exists():
        return path
    part = folder / f"{name}.part"
    failures = 0
    while True:
        have = part.stat().st_size if part.exists() else 0
        headers = {"User-Agent": USER_AGENT}
        if have:
            headers["Range"] = f"bytes={have}-"
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                total = None
                if have and response.status == 206:
                    mode = "ab"
                    found = re.search(r"/(\d+)\s*$", response.headers.get(
                        "Content-Range", ""))
                    total = int(found.group(1)) if found else None
                else:
                    # the server ignored the Range: start again
                    mode, have = "wb", 0
                    length = response.headers.get("Content-Length")
                    total = int(length) if length and length.isdigit() \
                        else None
                with part.open(mode) as out:
                    while chunk := response.read(1 << 20):
                        out.write(chunk)
                        have += len(chunk)
            if total is not None and have < total:
                raise ConnectionError(f"connection closed at {have} of "
                                      f"{total} bytes")
            part.rename(path)
            return path
        except urllib.error.HTTPError as exc:
            if exc.code == 416 and have:
                # the range starts at the end: the file is already complete
                part.rename(path)
                return path
            if exc.code not in (429, 503):
                raise
            wait = retry_after(exc.headers.get("Retry-After")
                               if exc.headers else None)
            wait = min(MAX_WAIT, wait if wait is not None
                       else backoff(failures))
            reason = f"HTTP {exc.code}"
        except (urllib.error.URLError, OSError, http.client.HTTPException) \
                as exc:
            wait = backoff(failures)
            reason = f"{type(exc).__name__}: {exc}"
        failures += 1
        if failures > retries:
            sys.exit(f"download failed after {retries} retries ({reason}); "
                     f"{part} keeps the {have} bytes received - run again "
                     f"to resume")
        print(f"  {reason}; retry {failures}/{retries} in {wait:.0f}s, "
              f"resuming at {have} bytes", file=sys.stderr)
        sleep(wait)


def pages_text(pdf: Path) -> list[str]:
    out = subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                         capture_output=True, text=True, check=True).stdout
    return out.split("\f")


def letters(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.casefold())


def fuzzy_hit(text: str, pattern: str) -> str:
    """The run of words on the page that best matches the pattern, if close."""
    want = letters(re.sub(r"[\\.?*+()\[\]|^$]", "", pattern))
    words = text.split()
    best, best_ratio = "", 0.0
    span = max(1, len(pattern.split()))
    for i in range(len(words)):
        for n in (span, span + 1):
            got = " ".join(words[i:i + n])
            ratio = difflib.SequenceMatcher(None, want, letters(got)).ratio()
            if ratio > best_ratio:
                best, best_ratio = got, ratio
    return best if best_ratio >= FUZZY else ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("source", help="a PDF URL or a local PDF")
    ap.add_argument("pattern", help="a regular expression, case-insensitive")
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--fuzzy", action="store_true",
                    help="also accept close OCR misreadings")
    ap.add_argument("--render", type=int, default=60,
                    help="dpi for the page previews")
    ap.add_argument("--max", type=int, default=24,
                    help="render at most this many matching pages")
    ap.add_argument("--retries", type=int, default=RETRIES,
                    help="retries of a failed or rate-limited download")
    a = ap.parse_args()

    if re.match(r"https?://", a.source):
        pdf = download(a.source, a.out_dir / "download", a.retries)
        print(f"downloaded {pdf} ({pdf.stat().st_size / 1e6:.1f} MB)")
    else:
        pdf = Path(a.source)
    try:
        regex = re.compile(a.pattern, re.I)
    except re.error as exc:
        sys.exit(f"bad pattern: {exc}")

    hits: list[tuple[int, str]] = []
    for number, text in enumerate(pages_text(pdf), start=1):
        found = regex.search(text)
        if found:
            start = max(0, found.start() - 60)
            hits.append((number, " ".join(text[start:found.end() + 60]
                                          .split())))
        elif a.fuzzy:
            near = fuzzy_hit(text, a.pattern)
            if near:
                hits.append((number, f"(fuzzy) {near}"))
    if not hits:
        print("no page matches")
        return

    pages_dir = a.out_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    rendered = []
    for number, context in hits:
        print(f"page {number}: {context}")
    for number, _ in hits[:a.max]:
        stem = pages_dir / f"p{number:04d}"
        subprocess.run(["pdftoppm", "-f", str(number), "-l", str(number),
                        "-r", str(a.render), "-png", "-singlefile", str(pdf),
                        str(stem)], check=True)
        rendered.append((number, Path(f"{stem}.png")))
    if len(hits) > a.max:
        print(f"... {len(hits) - a.max} more matching page(s) not rendered")

    cell, cols = 320, 4
    rows = (len(rendered) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 20)), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (number, path) in enumerate(rendered):
        image = Image.open(path).convert("RGB")
        image.thumbnail((cell - 8, cell - 8))
        x, y = (i % cols) * cell, (i // cols) * (cell + 20)
        sheet.paste(image, (x + 4, y + 4))
        draw.text((x + 4, y + cell), f"page {number}", fill="black")
    sheet.save(a.out_dir / "matches.png")
    print(f"{a.out_dir / 'matches.png'}: {len(rendered)} page(s)")


if __name__ == "__main__":
    main()
