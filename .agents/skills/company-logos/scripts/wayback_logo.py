"""Fetch the logos a company's own site used, from the Wayback Machine.

    uv run --with pillow python wayback_logo.py microsemi.com OUT_DIR
        [--from 2010] [--to 2018] [--limit 40]

For a company whose site is gone or rebranded. Asks the Wayback CDX index for
images archived under the domain whose URL mentions "logo", one per distinct
file (collapsed by content digest), and downloads each as originally served
(an `id_` URL - no Wayback toolbar or rewriting) into a new folder,
OUT_DIR/<domain>/, named <timestamp>-<file name>. Prints each with its
original URL and capture date, and tiles them into OUT_DIR/<domain>/sheet.png.

archive.org answers 429 or a "Temporarily Offline" page under load; those are
retried with backoff. A logo set as a CSS background, or inlined as SVG, is
not an image URL - find those on an archived page with the browser helper
(browser-scripts/logo_bg.py) instead.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CDX = "https://web.archive.org/cdx/search/cdx"
# The index is cheap; downloads are not. Read this many index rows, rank
# them, and download the best --limit.
INDEX_ROWS = 1000
OWN_PATHS = ("template", "header", "theme", "skin", "/site", "brand",
             "/assets/img", "/images/logo")
OTHERS = ("partner", "application", "customer", "event", "award", "member",
          "certif", "client", "sponsor", "social", "news")
USER_AGENT = "InvenTree-Importer company-logos/1.0"
TRIES = 5


def fetch(url: str, timeout: int = 60) -> bytes:
    for attempt in range(TRIES):
        if attempt:
            time.sleep(2 * 2 ** attempt)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 502, 503, 504):
                continue
            raise
        except (urllib.error.URLError, OSError):
            continue                              # timeouts, resets
        if b"Temporarily Offline" in body[:2000]:
            continue
        return body
    raise RuntimeError(f"gave up after {TRIES} tries: {url}")


def rank(row: dict, company: str) -> int:
    """Higher for what looks like the site's own logo, not a partner's."""
    path = urllib.parse.urlparse(row["original"]).path.casefold()
    name = path.rsplit("/", 1)[-1]
    score = 0
    if name.startswith("logo") or company in name:
        score += 3
    if any(part in path for part in OWN_PATHS):
        score += 2
    if any(part in path for part in OTHERS):
        score -= 3
    return score


def captures(domain: str, since: str, until: str) -> list[dict]:
    params = {"url": f"{domain}/*", "output": "json", "collapse": "digest",
              "filter": ["original:.*[Ll][Oo][Gg][Oo].*",
                         "mimetype:image/.*", "statuscode:200"],
              "limit": str(INDEX_ROWS)}
    if since:
        params["from"] = since
    if until:
        params["to"] = until
    query = urllib.parse.urlencode(params, doseq=True)
    rows = json.loads(fetch(f"{CDX}?{query}", timeout=180) or b"[]")
    if not rows:
        return []
    head, *body = rows
    return [dict(zip(head, row, strict=True)) for row in body]


def sheet(paths: list[Path], out: Path) -> None:
    from PIL import Image, ImageDraw
    images = []
    for path in paths:
        try:
            image = Image.open(path)
            image.load()
        except Exception:                        # an SVG, or not an image
            continue
        images.append((path, image.convert("RGBA")))
    if not images:
        return
    cell, cols = 220, 4
    rows = (len(images) + cols - 1) // cols
    board = Image.new("RGB", (cols * cell, rows * (cell + 20)), "#dddddd")
    draw = ImageDraw.Draw(board)
    for i, (path, image) in enumerate(images):
        image.thumbnail((cell - 10, cell - 10))
        x, y = (i % cols) * cell, (i // cols) * (cell + 20)
        board.paste(image, (x + 5, y + 5), image)
        draw.text((x + 5, y + cell), path.name[:34], fill="black")
    board.save(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("domain")
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--from", dest="since", default="")
    ap.add_argument("--to", dest="until", default="")
    ap.add_argument("--limit", type=int, default=40)
    a = ap.parse_args()

    domain = a.domain.removeprefix("https://").removeprefix("http://") \
        .strip("/")
    found = captures(domain, a.since, a.until)
    if not found:
        sys.exit("no logo images archived for that domain and range")
    company = domain.removeprefix("www.").split(".")[0]
    found = sorted(found, key=lambda row: -rank(row, company))[:a.limit]
    folder = a.out_dir / domain
    folder.mkdir(parents=True, exist_ok=False)
    saved = []
    for row in found:
        name = Path(urllib.parse.urlparse(row["original"]).path).name or "logo"
        path = folder / f"{row['timestamp']}-{name}"
        url = f"https://web.archive.org/web/{row['timestamp']}id_/" \
              f"{row['original']}"
        try:
            path.write_bytes(fetch(url))
        except (RuntimeError, urllib.error.HTTPError) as exc:
            print(f"  ! {row['original']}: {exc}")
            continue
        saved.append(path)
        print(f"{path.name}\n    {row['original']}  captured "
              f"{row['timestamp'][:4]}-{row['timestamp'][4:6]}-"
              f"{row['timestamp'][6:8]}  {row['mimetype']}")
        time.sleep(1)
    sheet(saved, folder / "sheet.png")
    print(f"{len(saved)} file(s) in {folder}"
          + (f"; sheet {folder / 'sheet.png'}" if saved else ""))


if __name__ == "__main__":
    main()
