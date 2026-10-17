"""Review finished logos: a montage, a 64 px strip, and flags.

    uv run --with pillow python review.py LOGOS_DIR OUT_DIR [--cell 200]

Writes OUT_DIR/montage.png (each logo labelled with its name and size) and
OUT_DIR/strip64.png (every logo at 64 px - the size InvenTree lists
companies at), then prints a flag for each logo that needs a second look:

  wide        the logo itself is wider than 4:1 - may be unreadable at 64 px
  not square  the image is not square
  small       the image is under 256 px
  transparent the image still has transparency

Look at both images; the flags only say where to look first.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

WIDE = 4.0
SMALL = 256
STRIP = 64


def content_box(image: Image.Image):
    """The logo's bounds inside its background (the corner colour)."""
    rgb = image.convert("RGB")
    ground = Image.new("RGB", rgb.size, rgb.getpixel((0, 0)))
    mask = ImageChops.difference(rgb, ground).convert("L")
    return mask.point(lambda v: 255 if v > 40 else 0).getbbox()


def flags(image: Image.Image) -> list[str]:
    found = []
    box = content_box(image)
    if box:
        w, h = box[2] - box[0], box[3] - box[1]
        if h and w / h > WIDE:
            found.append(f"wide ({w / h:.1f}:1)")
    if image.width != image.height:
        found.append(f"not square ({image.width}x{image.height})")
    if max(image.size) < SMALL:
        found.append(f"small ({max(image.size)} px)")
    if image.mode in ("RGBA", "LA", "P") and \
            image.convert("RGBA").getchannel("A").getextrema()[0] < 255:
        found.append("transparent")
    return found


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("logos", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--cell", type=int, default=200)
    ap.add_argument("--cols", type=int, default=5)
    a = ap.parse_args()

    paths = sorted(p for p in a.logos.iterdir()
                   if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"))
    if not paths:
        raise SystemExit(f"no images in {a.logos}")
    a.out.mkdir(parents=True, exist_ok=True)

    cell, cols = a.cell, a.cols
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 30)), "#f4f4f4")
    strip = Image.new("RGB", (len(paths) * (STRIP + 8) + 8, STRIP + 16),
                      "#f4f4f4")
    draw = ImageDraw.Draw(sheet)
    for i, path in enumerate(paths):
        image = Image.open(path)
        image.load()
        found = flags(image)
        print(f"{path.name}: {image.width}x{image.height}"
              + (f"  - {', '.join(found)}" if found else ""))
        tile = image.convert("RGB")
        tile.thumbnail((cell - 10, cell - 10))
        x, y = (i % cols) * cell, (i // cols) * (cell + 30)
        sheet.paste(tile, (x + 5, y + 5))
        draw.text((x + 5, y + cell), f"{path.stem[:30]}", fill="black")
        draw.text((x + 5, y + cell + 12),
                  f"{image.width}x{image.height}"
                  + ("  !" if found else ""), fill="#b00000" if found
                  else "#555555")
        small = image.convert("RGB")
        small.thumbnail((STRIP, STRIP), Image.LANCZOS)
        strip.paste(small, (8 + i * (STRIP + 8), 8))
    sheet.save(a.out / "montage.png")
    strip.save(a.out / "strip64.png")
    print(f"{a.out / 'montage.png'}\n{a.out / 'strip64.png'}")


if __name__ == "__main__":
    main()
