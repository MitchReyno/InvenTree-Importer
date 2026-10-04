"""Tile images into one labelled contact sheet, for reviewing crops at a glance.

    uv run --with pillow python montage.py OUT.png IMG [IMG ...] [--cell 360] [--cols 4]

Each image is scaled to fit its cell (aspect kept) and labelled with its file
name and pixel size, so a wrong aspect ratio or a tiny crop shows up as well
as a clipped edge.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("images", nargs="+")
    ap.add_argument("--cell", type=int, default=360)
    ap.add_argument("--cols", type=int, default=4)
    a = ap.parse_args()

    cell, cols = a.cell, a.cols
    rows = (len(a.images) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 22)), "white")
    draw = ImageDraw.Draw(sheet)
    for i, path in enumerate(a.images):
        im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        size = im.size
        im.thumbnail((cell - 8, cell - 8))
        x, y = (i % cols) * cell, (i // cols) * (cell + 22)
        sheet.paste(im, (x + 4, y + 4))
        label = f"{Path(path).name[:40]}  {size[0]}x{size[1]}"
        draw.text((x + 4, y + cell), label, fill="black")
    sheet.save(a.out)
    print(a.out)


if __name__ == "__main__":
    main()
