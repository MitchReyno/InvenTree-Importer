"""Cut a logo out of a scanned PDF page - a data book cover, an ad.

    uv run --with pillow python scan_logo.py PDF --page N OUT_DIR
    uv run --with pillow python scan_logo.py PDF --page N OUT.png --region X0,Y0,X1,Y1
        [--mask X0,Y0,X1,Y1 ...] [--whiten] [--whiten-uneven [--white-level L]
        [--max-tint S]]

Without --region it renders the page at its native resolution (read from
`pdfimages -list`, so a 300 dpi scan is not upsampled) and writes
OUT_DIR/page-N.png and a smaller page-N-preview.png: put the image-grid-overlay
grid on page-N.png and read the logo's region off it.

With --region (in page-N.png's pixels) it crops that region, trims it to the
ink - specks ignored - with a small margin, and writes OUT.png. --mask (page
pixels too, repeatable) paints a box inside the region with the paper colour
first: neighbouring text that reaches into the logo's box. --whiten maps
the paper to white (#ffffff) and leaves the ink's colours as they are, scaled
the same way. Paper that is not one colour - a blotch, uneven ageing - keeps
a tint after that; --whiten-uneven turns every near-white, low-saturation
pixel white instead (lighter than --white-level, saturation at most
--max-tint) and leaves the logo's colours untouched. The two can be combined:
--whiten first, then the leftover tint. It prints the box in page pixels and the dpi, for the logo's
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

from PIL import Image, ImageChops, ImageDraw, ImageFilter

DEFAULT_DPI = 300
# How far from the paper colour (0-255 grey difference) counts as ink.
INK = 40
MARGIN = 0.04
# --whiten-uneven: the most saturation paper may have, and the band below
# the white level over which near-paper pixels are lightened part way.
TINT = 0.25
RAMP = 24


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


def parse_box(text: str, flag: str) -> tuple[int, int, int, int]:
    try:
        x0, y0, x1, y1 = (int(v) for v in text.split(","))
    except ValueError:
        sys.exit(f"{flag} is X0,Y0,X1,Y1")
    if x1 <= x0 or y1 <= y0:
        sys.exit(f"{flag} {text}: X1,Y1 must be right of and below X0,Y0")
    return x0, y0, x1, y1


def paint_masks(region: Image.Image, origin: tuple[int, int], masks,
                paper) -> list[tuple[int, int, int, int]]:
    """Paint each mask (page px) with the paper colour; the boxes painted."""
    painted = []
    draw = ImageDraw.Draw(region)
    for x0, y0, x1, y1 in masks:
        box = (max(0, x0 - origin[0]), max(0, y0 - origin[1]),
               min(region.width, x1 - origin[0]),
               min(region.height, y1 - origin[1]))
        if box[2] <= box[0] or box[3] <= box[1]:
            print(f"  WARNING: mask {x0},{y0},{x1},{y1} is outside the "
                  f"region - ignored")
            continue
        draw.rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=paper)
        painted.append((x0, y0, x1, y1))
    return painted


def lightness(pixel) -> int:
    r, g, b = pixel
    return (r * 299 + g * 587 + b * 114) // 1000


def whiten_uneven(image: Image.Image, level: int,
                  tint: float = TINT) -> Image.Image:
    """Turn near-white, nearly grey pixels white; leave the rest alone.

    Aged paper is not one colour - a blotch, a fold, a fading edge - so
    scaling by one paper colour leaves tint behind. Here a pixel is paper
    when it is at least `level` light (0-255) and its saturation (max-min
    over max channel) is at most `tint`; it becomes white. Within RAMP below
    `level` such pixels are lightened part of the way, so the ink's edges
    stay smooth. Saturated or darker pixels - the logo - are unchanged.
    """
    low = level - RAMP

    def clean(pixel):
        top = max(pixel)
        if top == 0 or (top - min(pixel)) / top > tint:
            return pixel
        light = lightness(pixel)
        if light >= level:
            return (255, 255, 255)
        if light <= low:
            return pixel
        t = (light - low) / RAMP
        return tuple(round(v + (255 - v) * t) for v in pixel)

    out = Image.new("RGB", image.size)
    out.putdata([clean(p) for p in image.getdata()])
    return out


def cut(page: Image.Image, region_box, masks=(), whiten_paper=False,
        uneven=False, level=None, tint=TINT):
    """Crop the region, mask, trim to the ink and clean the paper.

    Returns the logo, its box in page px, the paper colour, the masks
    painted, the whitening level used (or None) and whether the ink touches
    the region's edge.
    """
    x0, y0, x1, y1 = region_box
    region = page.crop((x0, y0, x1, y1))
    paper = paper_colour(region)
    painted = paint_masks(region, (x0, y0), masks, paper)
    box = ink_box(region, paper)
    if box is None:
        return None
    edge = box[0] == 0 or box[1] == 0 or box[2] == region.width \
        or box[3] == region.height
    margin = round(max(box[2] - box[0], box[3] - box[1]) * MARGIN)
    crop = (max(0, box[0] - margin), max(0, box[1] - margin),
            min(region.width, box[2] + margin),
            min(region.height, box[3] + margin))
    logo = region.crop(crop)
    ground = paper
    if whiten_paper:
        logo = whiten(logo, paper)
        ground = (255, 255, 255)
    used = None
    if uneven:
        used = level if level is not None else lightness(ground) - INK
        logo = whiten_uneven(logo, used, tint)
    page_box = (x0 + crop[0], y0 + crop[1], x0 + crop[2], y0 + crop[3])
    return logo, page_box, paper, painted, used, edge


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path)
    ap.add_argument("out", type=Path,
                    help="a folder (no --region) or the output PNG")
    ap.add_argument("--page", type=int, required=True, help="1-based page")
    ap.add_argument("--region", help="X0,Y0,X1,Y1 in the rendered page's px")
    ap.add_argument("--mask", action="append", default=[],
                    help="X0,Y0,X1,Y1 in page px to paint with the paper "
                         "colour before trimming (neighbouring text inside "
                         "the region); repeat for more")
    ap.add_argument("--dpi", type=int, help="render at this dpi instead of "
                                            "the page's native one")
    ap.add_argument("--whiten", action="store_true",
                    help="map the paper colour to white")
    ap.add_argument("--whiten-uneven", action="store_true",
                    help="turn near-white, low-saturation pixels white "
                         "(blotchy or unevenly aged paper); the logo's own "
                         "colours are left as they are")
    ap.add_argument("--white-level", type=int,
                    help="with --whiten-uneven: how light (0-255) a pixel "
                         f"must be to count as paper (default: the paper's "
                         f"lightness - {INK})")
    ap.add_argument("--max-tint", type=float, default=TINT,
                    help="with --whiten-uneven: the most saturation (0-1) "
                         f"paper may have (default {TINT})")
    a = ap.parse_args()

    dpi = a.dpi or native_dpi(a.pdf, a.page)
    page = render(a.pdf, a.page, dpi)

    if not a.region:
        if a.mask or a.whiten or a.whiten_uneven:
            sys.exit("--mask and whitening need --region")
        a.out.mkdir(parents=True, exist_ok=True)
        full = a.out / f"page-{a.page}.png"
        page.save(full)
        preview = page.copy()
        preview.thumbnail((1200, 1200))
        preview.save(a.out / f"page-{a.page}-preview.png")
        print(f"{full}: {page.width}x{page.height} at {dpi} dpi - read the "
              f"logo's region off it, then run again with --region")
        return

    region = parse_box(a.region, "--region")
    masks = [parse_box(m, "--mask") for m in a.mask]
    result = cut(page, region, masks, a.whiten, a.whiten_uneven,
                 a.white_level, a.max_tint)
    if result is None:
        sys.exit("no ink found in that region")
    logo, page_box, paper, painted, level, edge = result
    if edge:
        print("  WARNING: the ink touches the region's edge - the logo may "
              "be cut off; widen the region")
    a.out.parent.mkdir(parents=True, exist_ok=True)
    logo.save(a.out)
    notes = []
    if a.whiten:
        notes.append("whitened")
    if level is not None:
        notes.append(f"uneven paper whitened at level {level}, "
                     f"tint {a.max_tint}")
    if painted:
        notes.append("masked " + "; ".join(",".join(map(str, m))
                                            for m in painted))
    print(f"{a.out}: {logo.width}x{logo.height}, page {a.page} at {dpi} dpi, "
          f"box {','.join(map(str, page_box))}, paper "
          f"#{'%02x%02x%02x' % paper}"
          f"{' (' + '; '.join(notes) + ')' if notes else ''}")


if __name__ == "__main__":
    main()
