"""Cut a logo out of a scanned PDF page - a data book cover, an ad.

    uv run --with pillow python scan_logo.py PDF --page N OUT_DIR
    uv run --with pillow python scan_logo.py PDF --page N OUT.png --region X0,Y0,X1,Y1 [--whiten]

Without --region it renders the page at its native resolution (read from
`pdfimages -list`, so a 300 dpi scan is not upsampled) and writes
OUT_DIR/page-N.png and a smaller page-N-preview.png: put the image-grid-overlay
grid on page-N.png and read the logo's region off it.

With --region (in page-N.png's pixels) it crops that region, trims it to the
ink - specks ignored - with a small margin, and writes OUT.png. --whiten maps
the paper to white (#ffffff) and leaves the ink's colours as they are, scaled
the same way. It prints the box in page pixels and the dpi, for the logo's
provenance note, and warns when the ink touches the region's edge (the logo
may run on past it).

A page's colour can sit in a lower-resolution layer than its black text; the
page is rendered whole, so both come out at the render dpi.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

DEFAULT_DPI = 300
# How far from the paper colour (0-255 grey difference) counts as ink.
INK = 40
MARGIN = 0.04


def native_dpi(pdf: Path, page: int) -> int:
    """The highest image resolution on the page, else DEFAULT_DPI."""
    try:
        out = subprocess.run(["pdfimages", "-list", "-f", str(page), "-l",
                              str(page), str(pdf)], capture_output=True,
                             text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return DEFAULT_DPI
    dpis = []
    for line in out.splitlines()[2:]:
        cols = line.split()
        if len(cols) >= 14 and re.fullmatch(r"\d+", cols[12]):
            dpis.append(int(cols[12]))
    return max(dpis) if dpis else DEFAULT_DPI


def render(pdf: Path, page: int, dpi: int) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        stem = Path(tmp) / "page"
        subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-r",
                        str(dpi), "-png", "-singlefile", str(pdf), str(stem)],
                       check=True)
        image = Image.open(f"{stem}.png")
        image.load()
        return image.convert("RGB")


def paper_colour(image: Image.Image) -> tuple[int, int, int]:
    """The median of the region's border: the paper around the logo."""
    w, h = image.size
    edge = [image.getpixel((x, y)) for x in range(w) for y in (0, h - 1)]
    edge += [image.getpixel((x, y)) for y in range(h) for x in (0, w - 1)]
    return tuple(sorted(c[i] for c in edge)[len(edge) // 2] for i in range(3))


def ink_box(image: Image.Image, paper) -> tuple[int, int, int, int] | None:
    diff = ImageChops.difference(image, Image.new("RGB", image.size, paper))
    mask = diff.convert("L").filter(ImageFilter.MedianFilter(5))
    return mask.point(lambda v: 255 if v > INK else 0).getbbox()


def whiten(image: Image.Image, paper) -> Image.Image:
    """Scale each channel so the paper becomes white."""
    bands = []
    for band, level in zip(image.split(), paper, strict=True):
        scale = 255 / max(level, 1)
        bands.append(band.point([min(255, round(v * scale))
                                 for v in range(256)]))
    return Image.merge("RGB", bands)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path)
    ap.add_argument("out", type=Path,
                    help="a folder (no --region) or the output PNG")
    ap.add_argument("--page", type=int, required=True, help="1-based page")
    ap.add_argument("--region", help="X0,Y0,X1,Y1 in the rendered page's px")
    ap.add_argument("--dpi", type=int, help="render at this dpi instead of "
                                            "the page's native one")
    ap.add_argument("--whiten", action="store_true",
                    help="map the paper colour to white")
    a = ap.parse_args()

    dpi = a.dpi or native_dpi(a.pdf, a.page)
    page = render(a.pdf, a.page, dpi)

    if not a.region:
        a.out.mkdir(parents=True, exist_ok=True)
        full = a.out / f"page-{a.page}.png"
        page.save(full)
        preview = page.copy()
        preview.thumbnail((1200, 1200))
        preview.save(a.out / f"page-{a.page}-preview.png")
        print(f"{full}: {page.width}x{page.height} at {dpi} dpi - read the "
              f"logo's region off it, then run again with --region")
        return

    try:
        x0, y0, x1, y1 = (int(v) for v in a.region.split(","))
    except ValueError:
        sys.exit("--region is X0,Y0,X1,Y1")
    region = page.crop((x0, y0, x1, y1))
    paper = paper_colour(region)
    box = ink_box(region, paper)
    if box is None:
        sys.exit("no ink found in that region")
    if box[0] == 0 or box[1] == 0 or box[2] == region.width \
            or box[3] == region.height:
        print("  WARNING: the ink touches the region's edge - the logo may "
              "be cut off; widen the region")
    margin = round(max(box[2] - box[0], box[3] - box[1]) * MARGIN)
    crop = (max(0, box[0] - margin), max(0, box[1] - margin),
            min(region.width, box[2] + margin),
            min(region.height, box[3] + margin))
    logo = region.crop(crop)
    if a.whiten:
        logo = whiten(logo, paper)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    logo.save(a.out)
    page_box = (x0 + crop[0], y0 + crop[1], x0 + crop[2], y0 + crop[3])
    print(f"{a.out}: {logo.width}x{logo.height}, page {a.page} at {dpi} dpi, "
          f"box {','.join(map(str, page_box))}, paper "
          f"#{'%02x%02x%02x' % paper}{' (whitened)' if a.whiten else ''}")


if __name__ == "__main__":
    main()
