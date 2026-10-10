"""Crop one object out of a photo, square where the photo allows it.

    uv run --with pillow --with numpy python crop.py SRC OUT X0 Y0 X1 Y1 [options]

X0 Y0 X1 Y1 is the region of interest (ROI) in source pixels: the area the
object lies in, drawn so that it EXCLUDES everything that must not appear in
the crop - a neighbouring component, a hand, a price or count tag. It may be
the whole image (0 0 W H) when there is nothing to keep out.

Inside the ROI the object is found by texture (local gradient), by contrast
with the background and by colour saturation, so a pale bag on a pale table is
found by its creases and print rather than by brightness alone. A margin is
added, then the short side grows towards a square about the object's centre.
The box is never slid sideways to fit the ROI: margin and growth are equal on
opposite sides, so the object stays centred, and where the ROI is tight on one
side the crop stays short of square instead. To get a square there, widen the
ROI on the tight side. The crop never leaves the ROI and is never padded or
stretched.

Options:
  --margin F   margin around the found object, as a fraction of its longer
               side (default 0.06). Raise it when edges or leads are clipped.
  --exact      skip detection: crop the ROI itself (then square it if possible)
  --nosquare   keep the tight box; do not grow towards square
  --max N      longest side of the saved image (default 1600)

Prints the box used, the output size and the aspect ratio.
"""

from __future__ import annotations

import argparse
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageOps


def find_object(roi: Image.Image) -> tuple[int, int, int, int] | None:
    """Bounding box of the textured / contrasting content inside roi."""
    gray = roi.convert("L").filter(ImageFilter.GaussianBlur(1.5))
    g = np.asarray(gray, dtype=float)
    gx = np.abs(np.diff(g, axis=1, prepend=g[:, :1]))
    gy = np.abs(np.diff(g, axis=0, prepend=g[:1, :]))
    edges = Image.fromarray(np.clip((gx + gy) * 8, 0, 255).astype("uint8"))
    tex = np.asarray(edges.filter(ImageFilter.MaxFilter(9))
                     .filter(ImageFilter.GaussianBlur(6)), dtype=float)
    lum = np.asarray(roi.convert("L"), dtype=float)
    sat = np.asarray(roi.convert("HSV"), dtype=float)[..., 1]
    mask = (tex > 40) | (np.abs(lum - np.median(lum)) > 45) | (sat > 90)
    rows = np.where(mask.mean(axis=1) > 0.02)[0]
    cols = np.where(mask.mean(axis=0) > 0.02)[0]
    if not len(rows) or not len(cols):
        return None
    return int(cols.min()), int(rows.min()), int(cols.max()), int(rows.max())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("out")
    for name in ("x0", "y0", "x1", "y1"):
        ap.add_argument(name, type=int, help=f"ROI {name.upper()} in source pixels")
    ap.add_argument("--margin", type=float, default=0.06)
    ap.add_argument("--exact", action="store_true")
    ap.add_argument("--nosquare", action="store_true")
    ap.add_argument("--max", type=int, default=1600)
    a = ap.parse_args()

    im = ImageOps.exif_transpose(Image.open(a.src)).convert("RGB")
    W, H = im.size
    x0, y0, x1, y1 = a.x0, a.y0, a.x1, a.y1
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)

    if a.exact:
        bx0, by0, bx1, by1 = x0, y0, x1, y1
    else:
        found = find_object(im.crop((x0, y0, x1, y1)))
        if found is None:
            print("nothing found in the ROI; use --exact or redraw it",
                  file=sys.stderr)
            return 1
        bx0, by0, bx1, by1 = (found[0] + x0, found[1] + y0,
                              found[2] + x0, found[3] + y0)
        m = int(max(bx1 - bx0, by1 - by0) * a.margin)
        # the margin never leaves the ROI, and stays equal on opposite sides
        # so the object stays centred
        mx = min(m, bx0 - x0, x1 - bx1)
        my = min(m, by0 - y0, y1 - by1)
        bx0, by0, bx1, by1 = bx0 - mx, by0 - my, bx1 + mx, by1 + my

    if not a.nosquare:
        # grow the short side about the centre, never sliding the box off it:
        # each side takes only as much as the ROI allows on *both* sides
        w, h = bx1 - bx0, by1 - by0
        if w < h:
            g = min((h - w) // 2, bx0 - x0, x1 - bx1)
            bx0, bx1 = bx0 - g, bx1 + g
        elif h < w:
            g = min((w - h) // 2, by0 - y0, y1 - by1)
            by0, by1 = by0 - g, by1 + g
        if abs((bx1 - bx0) - (by1 - by0)) > 1:
            print("a centred square would leave the ROI; grew towards square "
                  "as far as it stays centred", file=sys.stderr)

    box = (int(bx0), int(by0), int(bx1), int(by1))
    crop = im.crop(box)
    if max(crop.size) > a.max:
        crop.thumbnail((a.max, a.max))
    crop.save(a.out, quality=90)
    print(f"{a.out}  box={box}  size={crop.size[0]}x{crop.size[1]}  "
          f"aspect={crop.size[0] / crop.size[1]:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
