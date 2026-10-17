"""Inspect, sample and flatten company logos for InvenTree.

    uv run --with pillow python logo.py inspect LOGO [LOGO ...]
    uv run --with pillow python logo.py sample SCREENSHOT --box X0,Y0,X1,Y1
    uv run --with pillow python logo.py flatten LOGO OUT.png --background '#0b2a4a'
        [--pad 0.1] [--size 512] [--aspect square|keep] [--no-trim]

inspect  says whether a logo has transparency (and how much of it), its size,
         the main colours of its opaque pixels and how they contrast with
         white and black - so a white logo that would vanish on white is
         caught before it is uploaded.
sample   gives the dominant colour of a region of an image, e.g. the header
         bar of the company's website in a screenshot, as the background the
         logo is normally shown on.
flatten  composites a transparent logo onto a solid background colour, trims
         it to its content, pads it and writes an opaque PNG. SVGs are
         rasterised with rsvg-convert first. Prints the contrast between the
         logo's main colour and the background, and warns below 3:1.

All coordinates are source pixels. Nothing here downloads anything.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

# Fully transparent below this alpha, fully opaque at or above OPAQUE.
CLEAR = 8
OPAQUE = 248
# Rasterise SVGs this wide before trimming, so the result is not soft.
SVG_WIDTH = 2048
MIN_CONTRAST = 3.0
# A pixel this close (RGB distance) to the ground - the background, or a
# scan's paper - is ground, not logo: it is left out of the logo's colours.
GROUND_DISTANCE = 48
# Wider than this, a wordmark on a square canvas is hard to read small.
WIDE = 4.0
# A colour must cover this share of the logo before its contrast matters.
MAJOR = 0.10


def load(path: Path) -> Image.Image:
    """An RGBA image from a raster file or an SVG."""
    if path.suffix.lower() in (".svg", ".svgz"):
        tool = shutil.which("rsvg-convert")
        if not tool:
            sys.exit("rsvg-convert is needed for SVG (brew install librsvg)")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "logo.png"
            subprocess.run([tool, "--width", str(SVG_WIDTH),
                            "--keep-aspect-ratio", "-o", str(out), str(path)],
                           check=True)
            return Image.open(out).convert("RGBA")
    image = Image.open(path)
    image.load()
    if image.mode == "P" and "transparency" in image.info:
        image = image.convert("RGBA")
    return image.convert("RGBA")


def hex_colour(rgb) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb[:3])


def parse_hex(text: str) -> tuple[int, int, int]:
    value = text.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    if len(value) != 6:
        sys.exit(f"not a colour: {text!r} (use #rrggbb)")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def luminance(rgb) -> float:
    """WCAG relative luminance."""
    def channel(c: int) -> float:
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def dominant(pixels, top: int = 4, step: int = 16):
    """The most common colours, bucketed so anti-aliasing does not split them."""
    buckets = Counter()
    exact: dict[tuple, Counter] = {}
    for rgb in pixels:
        key = tuple(c // step for c in rgb[:3])
        buckets[key] += 1
        exact.setdefault(key, Counter())[rgb[:3]] += 1
    total = sum(buckets.values()) or 1
    return [(exact[key].most_common(1)[0][0], count / total)
            for key, count in buckets.most_common(top)]


def pixels(image: Image.Image) -> list[tuple]:
    """Every pixel; get_flattened_data replaces getdata from Pillow 12."""
    return list(getattr(image, "get_flattened_data", image.getdata)())


def opaque_pixels(image: Image.Image, ground=None):
    """The logo's own pixels: opaque, and not the ground colour."""
    small = image.copy()
    small.thumbnail((256, 256))
    return [p for p in pixels(small) if p[3] >= OPAQUE
            and (ground is None or distance(p, ground) > GROUND_DISTANCE)]


def distance(a, b) -> float:
    return sum((x - y) ** 2 for x, y in zip(a[:3], b[:3], strict=True)) ** 0.5


def is_opaque(image: Image.Image) -> bool:
    return image.getchannel("A").getextrema()[0] >= OPAQUE


def border_colour(image: Image.Image):
    """The median colour of the outermost pixels: a scan's paper."""
    rgb = image.convert("RGB")
    w, h = rgb.size
    edge = [rgb.getpixel((x, y)) for x in range(0, w, max(1, w // 64))
            for y in (0, h - 1)]
    edge += [rgb.getpixel((x, y)) for y in range(0, h, max(1, h // 64))
             for x in (0, w - 1)]
    return tuple(sorted(c[i] for c in edge)[len(edge) // 2] for i in range(3))


def ink_box(image: Image.Image, ground):
    """Bounds of what differs from the ground colour, ignoring specks."""
    rgb = image.convert("RGB")
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, ground))
    mask = diff.convert("L").filter(ImageFilter.MedianFilter(3))
    return mask.point(lambda v: 255 if v > GROUND_DISTANCE else 0).getbbox()


def inspect(paths: list[Path]) -> None:
    for path in paths:
        image = load(path)
        alpha = image.getchannel("A")
        histogram = alpha.histogram()
        total = image.width * image.height
        clear = sum(histogram[:CLEAR]) / total
        partial = sum(histogram[CLEAR:OPAQUE]) / total
        kind = ("SVG" if path.suffix.lower() in (".svg", ".svgz")
                else Image.open(path).format)
        print(f"{path.name}: {image.width}x{image.height}, {kind}")
        if clear == 0 and partial == 0:
            print("  opaque - no transparency")
        else:
            print(f"  transparent: {clear:.0%} clear, {partial:.0%} partly "
                  f"(edges, shadows) - needs a background")
        box = alpha.point(lambda a: 255 if a >= CLEAR else 0).getbbox()
        if box:
            print(f"  content box: {box[0]},{box[1]} - {box[2]},{box[3]} "
                  f"({box[2] - box[0]}x{box[3] - box[1]})")
        ground = None
        if clear == 0 and partial == 0:
            ground = border_colour(image)
            print(f"  ground (border colour): {hex_colour(ground)} - left "
                  f"out of the logo's colours")
        colours = dominant(opaque_pixels(image, ground))
        for rgb, share in colours:
            print(f"  {hex_colour(rgb)}  {share:5.0%}  contrast on white "
                  f"{contrast(rgb, (255, 255, 255)):4.1f}, on black "
                  f"{contrast(rgb, (0, 0, 0)):4.1f}")
        if colours and clear:
            main = colours[0][0]
            if contrast(main, (255, 255, 255)) < MIN_CONTRAST:
                print("  NOTE: the main colour is light - this variant is "
                      "made for a dark or coloured background, not white")


def sample(path: Path, box: str) -> None:
    try:
        x0, y0, x1, y1 = (int(v) for v in box.split(","))
    except ValueError:
        sys.exit("--box is X0,Y0,X1,Y1 in source pixels")
    region = Image.open(path).convert("RGB").crop((x0, y0, x1, y1))
    colours = dominant(pixels(region), top=3, step=8)
    for rgb, share in colours:
        print(f"{hex_colour(rgb)}  {share:5.0%}")


def flatten(source: Path, out: Path, background: str, pad: float, size: int,
            aspect: str, trim: bool) -> None:
    image = load(source)
    colour = parse_hex(background)
    # An opaque source (a scan, a logo on its own ground) has a ground of
    # its own; its pixels are not the logo's colours.
    ground = border_colour(image) if is_opaque(image) else None
    if trim:
        box = (ink_box(image, ground) if ground is not None else
               image.getchannel("A").point(
                   lambda a: 255 if a >= CLEAR else 0).getbbox())
        if box:
            image = image.crop(box)

    margin = round(max(image.size) * pad)
    width, height = image.width + 2 * margin, image.height + 2 * margin
    if aspect == "square":
        width = height = max(width, height)
    canvas = Image.new("RGBA", (width, height), colour + (255,))
    canvas.alpha_composite(image, ((width - image.width) // 2,
                                   (height - image.height) // 2))
    result = canvas.convert("RGB")
    if max(result.size) > size:
        result.thumbnail((size, size), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    result.save(out, "PNG", optimize=True)

    # Only the source's own ground (a scan's paper) is left out; a logo
    # colour close to the new background is exactly what must show up.
    colours = dominant(opaque_pixels(image, ground))
    print(f"{out}: {result.width}x{result.height} on {hex_colour(colour)}")
    if max(result.size) < size:
        print(f"  NOTE: the source only gives {max(result.size)} px, not "
              f"{size} - it is never enlarged; find a larger source if it "
              f"looks soft")
    if aspect == "square" and image.width > WIDE * image.height:
        print(f"  NOTE: the logo is {image.width / image.height:.1f}:1 wide -"
              f" check it at 64 px; --pad 0.04 lets it fill the width")
    for rgb, share in colours[:2]:
        ratio = contrast(rgb, colour)
        # A sliver of colour is anti-aliasing at the letters' edges.
        flag = ("  LOW - check it is legible"
                if ratio < MIN_CONTRAST and share >= MAJOR else "")
        print(f"  logo {hex_colour(rgb)} ({share:.0%}) contrast "
              f"{ratio:.1f}:1{flag}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("inspect")
    p.add_argument("logos", nargs="+", type=Path)

    p = sub.add_parser("sample")
    p.add_argument("image", type=Path)
    p.add_argument("--box", required=True)

    p = sub.add_parser("flatten")
    p.add_argument("logo", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--background", required=True,
                   help="#rrggbb the logo is normally shown on")
    p.add_argument("--pad", type=float, default=0.1,
                   help="margin as a fraction of the logo's longer side")
    p.add_argument("--size", type=int, default=512,
                   help="longest side of the output, at most (a smaller "
                        "source is never enlarged)")
    p.add_argument("--aspect", choices=("square", "keep"), default="square")
    p.add_argument("--no-trim", dest="trim", action="store_false",
                   help="keep the source's own transparent margin")

    a = ap.parse_args()
    if a.command == "inspect":
        inspect(a.logos)
    elif a.command == "sample":
        sample(a.image, a.box)
    else:
        flatten(a.logo, a.out, a.background, a.pad, a.size, a.aspect, a.trim)


if __name__ == "__main__":
    main()
