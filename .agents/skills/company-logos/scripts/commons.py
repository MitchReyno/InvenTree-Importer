"""Find and fetch logo files on Wikimedia Commons.

    uv run --with pillow python commons.py search "Signetics logo" [--limit 10]
    uv run --with pillow python commons.py get "File:Signetics logo.svg" OUT_DIR

search  lists matching files: title, size, type, date, author, and the first
        line of each description.
get     downloads the ORIGINAL file (never a thumbnail) into a new folder,
        OUT_DIR/<file stem>/, renders preview.png beside it (SVGs through
        rsvg-convert), and prints the description, author, credit, date and
        licence. Commons files are sometimes mislabelled - open preview.png
        and check it is the company named before using it.

The API rate-limits bursts and answers some errors with HTML rather than
JSON; requests are spaced and retried with backoff.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = ("InvenTree-Importer company-logos/1.0 "
              "(https://github.com/MitchReyno; logo lookup for an inventory)")
TRIES = 5
PAUSE = 1.5


def fetch(url: str, *, binary: bool = False):
    """GET with backoff on 429/5xx and on non-JSON answers."""
    for attempt in range(TRIES):
        if attempt:
            time.sleep(PAUSE * 2 ** attempt)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504):
                continue
            raise
        except (urllib.error.URLError, OSError):
            continue                              # timeouts, resets
        if binary:
            return body
        try:
            return json.loads(body)
        except ValueError:
            continue                              # an HTML error page
    sys.exit(f"gave up after {TRIES} tries: {url}")


def api(**params) -> dict:
    time.sleep(PAUSE)
    query = urllib.parse.urlencode({"format": "json", **params})
    return fetch(f"{API}?{query}")


def text(value: str) -> str:
    """Commons metadata is HTML; keep the words."""
    words = html.unescape(re.sub(r"<[^>]+>", " ", value or ""))
    return re.sub(r"\s+", " ", words).strip()


def info(titles: list[str]) -> list[dict]:
    data = api(action="query", prop="imageinfo", titles="|".join(titles),
               iiprop="url|size|mime|extmetadata|timestamp")
    pages = (data.get("query") or {}).get("pages") or {}
    found = []
    for page in pages.values():
        ii = (page.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        found.append({
            "title": page.get("title", ""),
            "url": ii.get("url", "").split("?")[0],
            "page": ii.get("descriptionurl", ""),
            "size": f"{ii.get('width', '?')}x{ii.get('height', '?')}",
            "mime": ii.get("mime", ""),
            "uploaded": ii.get("timestamp", ""),
            "description": text(meta.get("ImageDescription", {}).get("value")),
            "author": text(meta.get("Artist", {}).get("value")),
            "credit": text(meta.get("Credit", {}).get("value")),
            "date": text(meta.get("DateTimeOriginal", {}).get("value")),
            "licence": text(meta.get("LicenseShortName", {}).get("value")),
        })
    return found


def search(query: str, limit: int) -> None:
    # File names say what a file is; full text also matches every page
    # that merely mentions a word. Titles first, full text if they miss.
    titles: list[str] = []
    for terms in (" ".join(f"intitle:{w}" for w in query.split()), query):
        data = api(action="query", list="search", srnamespace=6,
                   srsearch=terms, srlimit=limit)
        titles = [hit["title"] for hit in
                  (data.get("query") or {}).get("search") or []]
        if titles:
            break
    if not titles:
        print("no files found")
        return
    # The search stems ("Signetics" finds "signet"); whole words in the
    # file name rank first.
    words = [w.casefold() for w in query.split()]

    def score(item: dict) -> int:
        name = re.split(r"[\W_]+", item["title"].casefold())
        return -sum(w in name for w in words)

    for item in sorted(info(titles), key=score):
        first = item["description"].splitlines()[0][:100] \
            if item["description"] else ""
        print(f"{item['title']}\n    {item['size']} {item['mime']}  "
              f"{item['date'] or item['uploaded'][:10]}  {item['author'][:40]}"
              f"\n    {first}")


def preview(path: Path, out: Path) -> None:
    if path.suffix.lower() in (".svg", ".svgz"):
        tool = shutil.which("rsvg-convert")
        if tool:
            subprocess.run([tool, "--width", "800", "--keep-aspect-ratio",
                            "--background-color", "#dddddd", "-o", str(out),
                            str(path)], check=False)
        return
    from PIL import Image
    image = Image.open(path)
    image.thumbnail((800, 800))
    flat = Image.new("RGB", image.size, "#dddddd")
    flat.paste(image.convert("RGBA"), mask=image.convert("RGBA"))
    flat.save(out)


def get(title: str, out_dir: Path) -> None:
    if not title.startswith("File:"):
        title = f"File:{title}"
    item, = info([title])
    if not item["url"]:
        sys.exit(f"{title}: not on Commons (an en.wikipedia-only file is "
                 f"fetched from its own page)")
    name = urllib.parse.unquote(item["url"].rsplit("/", 1)[1])
    folder = out_dir / Path(name).stem.replace(" ", "_")
    folder.mkdir(parents=True, exist_ok=False)
    path = folder / name
    path.write_bytes(fetch(item["url"], binary=True))
    preview(path, folder / "preview.png")
    (folder / "commons.json").write_text(json.dumps(item, indent=2) + "\n")
    print(f"{path}\n  preview: {folder / 'preview.png'}")
    for key in ("page", "url", "size", "description", "author", "credit",
                "date", "licence"):
        if item[key]:
            print(f"  {key}: {item[key]}")
    print("  CHECK: open preview.png - Commons files can be mislabelled")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("search")
    p.add_argument("query")
    p.add_argument("--limit", type=int, default=10)
    p = sub.add_parser("get")
    p.add_argument("title")
    p.add_argument("out_dir", type=Path)
    a = ap.parse_args()
    if a.command == "search":
        search(a.query, a.limit)
    else:
        get(a.title, a.out_dir)


if __name__ == "__main__":
    main()
