"""Find the pages of a PDF that mention a company - an ad, a cover, a logo.

    uv run --with pillow python find_in_pdf.py URL_OR_PDF "Stewart.?Warner" OUT_DIR
        [--fuzzy] [--render 60] [--max 24]

For scanned magazines and data books (worldradiohistory.com issues of
Electronics, bitsavers data books). A URL is streamed to OUT_DIR/download/ -
a fresh folder, never run from - and kept for scan_logo.py. Each page's text
(pdftotext) is searched for the pattern, case-insensitively; --fuzzy also
accepts OCR misreadings ("STEWART-LIJARAEll" for "Stewart-Warner") by
comparing the pattern's letters with each run of words on the page.

Prints each matching page with the text around the match, renders those pages
at --render dpi into OUT_DIR/pages/, and tiles them into OUT_DIR/matches.png
to look at. Page numbers are 1-based PDF pages, as scan_logo.py takes them.
"""

from __future__ import annotations

import argparse
import difflib
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

USER_AGENT = "InvenTree-Importer company-logos/1.0"
FUZZY = 0.8


def download(url: str, folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    name = Path(urllib.parse.urlparse(url).path).name or "document.pdf"
    path = folder / name
    if path.exists():
        return path
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response, \
            path.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    return path


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
    a = ap.parse_args()

    if re.match(r"https?://", a.source):
        pdf = download(a.source, a.out_dir / "download")
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
