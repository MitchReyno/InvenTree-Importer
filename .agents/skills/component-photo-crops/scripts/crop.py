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

The photo's EXIF orientation is applied first, as grid.py does, so ROI
coordinates read off its grid are the coordinates used here.

Options:
  --margin F   margin around the found object, as a fraction of its longer
               side (default 0.06). Raise it when edges or leads are clipped.
  --exact      skip detection: crop the ROI itself (then square it if possible)
  --nosquare   keep the tight box; do not grow towards square
  --package-box X0 Y0 X1 Y1
               measured package bounds, excluding long lead ends. Make a
               square with the package at medium scale, about one third of
               the frame; positional ROI still excludes unwanted content.
  --package-fill F
               approximate package fraction of square width/height (default
               0.34 with --package-box). Refuses if the square cannot fit the
               safe ROI; never silently tightens, slides or pads it.
  --max N      longest side of the saved image (default 1600)

Orientation (the ROI is always given in the unrotated photo's pixels):
  --rotate D   turn the finished crop clockwise by 90, 180 or 270 degrees so
               its markings read upright. Lossless, and a square stays square.
  --straighten D
               level a tilted item: rotate the photo clockwise by D degrees
               (negative is anticlockwise, at most 15) about the ROI centre
               before cropping. Refuses when the rotated-in corner fill would
               reach the crop; tighten the ROI then.

Lighting, applied to the crop in this order (each is off unless asked for):
  --wb         remove a colour cast (warm lamp, blue daylight) by balancing the
               channel averages, each gain held within 0.8-1.25
  --autocontrast [PCT]
               stretch a flat, hazy or dim crop to the full tonal range,
               ignoring the darkest and lightest PCT % (default 0.5); keeps hue
  --gamma G    lift (G > 1) or darken (G < 1) the midtones without clipping
               the ends; 1.2-1.5 suits an underexposed photo
  --sharpen    a light unsharp mask after resizing, for slightly soft focus

Prints the box used, the output size, the aspect ratio and every adjustment
made.
"""

from __future__ import annotations

import argparse
import math
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageStat

# PIL's transpose names count anticlockwise; --rotate counts clockwise
QUARTER_TURNS = {90: Image.Transpose.ROTATE_270,
                 180: Image.Transpose.ROTATE_180,
                 270: Image.Transpose.ROTATE_90}
MAX_STRAIGHTEN = 15.0


def package_square(package: tuple[int, int, int, int],
                   roi: tuple[int, int, int, int], fill: float,
                   degrees: float = 0) -> tuple[int, int, int, int]:
    """A centred square from measured package bounds, within the safe ROI.

    Transform the bounds with the same rotation as the source photo. The
    enclosing rectangle is conservative for a tilted package, so fill is an
    approximate maximum rather than an automatic foreground measurement.
    """
    if not math.isfinite(fill) or not 0 < fill <= 1:
        raise ValueError("--package-fill must be finite and greater than 0 through 1")
    px0, py0, px1, py1 = package
    x0, y0, x1, y1 = roi
    if not (x0 <= px0 < px1 <= x1 and y0 <= py0 < py1 <= y1):
        raise ValueError("--package-box must have positive area inside the safe ROI")
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    theta = math.radians(degrees)
    co, si = math.cos(theta), math.sin(theta)
    points = [(cx + (x-cx)*co - (y-cy)*si,
               cy + (x-cx)*si + (y-cy)*co)
              for x in (px0, px1) for y in (py0, py1)]
    lo_x, hi_x = min(p[0] for p in points), max(p[0] for p in points)
    lo_y, hi_y = min(p[1] for p in points), max(p[1] for p in points)
    if max(hi_x-lo_x, hi_y-lo_y) > fill * min(x1-x0, y1-y0):
        raise ValueError("requested package framing does not fit the safe ROI; "
                         "widen the ROI only if clear, or use a group view")
    side = math.ceil(max(hi_x-lo_x, hi_y-lo_y) / fill)
    left = math.floor((lo_x+hi_x-side) / 2)
    top = math.floor((lo_y+hi_y-side) / 2)
    # Rounding a rotated fractional box must not trim its far edge at fill=1.
    while left+side < hi_x or top+side < hi_y:
        side += 1
        left = math.floor((lo_x+hi_x-side) / 2)
        top = math.floor((lo_y+hi_y-side) / 2)
    box = left, top, left+side, top+side
    if left < x0 or top < y0 or left+side > x1 or top+side > y1:
        raise ValueError("requested package framing does not fit the safe ROI; "
                         "widen the ROI only if clear, or use a group view")
    return box


def find_object(roi: Image.Image,
                valid: Image.Image | None = None) -> tuple[int, int, int, int] | None:
    """Bounding box of the textured / contrasting content inside roi.

    valid, when given, masks out pixels that are not part of the photo (the
    corner fill left by straightening) so they are never taken for the object.
    """
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
    if valid is not None:
        # erode the valid area so texture blurred off the fill edge is ignored
        mask &= np.asarray(valid.filter(ImageFilter.MinFilter(25))) > 0
    rows = np.where(mask.mean(axis=1) > 0.02)[0]
    cols = np.where(mask.mean(axis=0) > 0.02)[0]
    if not len(rows) or not len(cols):
        return None
    return int(cols.min()), int(rows.min()), int(cols.max()), int(rows.max())


def straighten(im: Image.Image, roi: tuple[int, int, int, int],
               degrees: float) -> tuple[Image.Image, Image.Image]:
    """im rotated clockwise about the ROI centre, and a mask of real pixels.

    The corners rotated in are filled with the ROI's median colour, so they
    contrast as little as possible with the background around the object.
    """
    centre = ((roi[0] + roi[2]) / 2, (roi[1] + roi[3]) / 2)
    fill = tuple(int(v) for v in ImageStat.Stat(im.crop(roi)).median)
    out = im.rotate(-degrees, resample=Image.Resampling.BICUBIC,
                    center=centre, fillcolor=fill)
    valid = Image.new("L", im.size, 255).rotate(
        -degrees, resample=Image.Resampling.NEAREST, center=centre, fillcolor=0)
    return out, valid


def white_balance(im: Image.Image) -> tuple[Image.Image, tuple[float, ...]]:
    """Grey-world colour-cast removal, with each channel's gain kept modest."""
    means = ImageStat.Stat(im).mean
    grey = sum(means) / 3
    gains = tuple(min(1.25, max(0.8, grey / max(m, 1.0))) for m in means)
    bands = [b.point(lambda v, k=k: min(255, round(v * k)))
             for b, k in zip(im.split(), gains, strict=True)]
    return Image.merge("RGB", bands), gains


def gamma(im: Image.Image, g: float) -> Image.Image:
    """Midtone lift (g > 1) or darkening (g < 1); black and white stay put."""
    lut = [round(255 * (i / 255) ** (1 / g)) for i in range(256)]
    return im.point(lut * 3)


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
    ap.add_argument("--package-box", type=int, nargs=4, metavar=("X0", "Y0", "X1", "Y1"),
                    help="measured package bounds in source pixels, excluding lead ends")
    ap.add_argument("--package-fill", type=float, metavar="F",
                    help="package fraction of square width/height (default 0.34 with --package-box)")
    ap.add_argument("--max", type=int, default=1600)
    ap.add_argument("--rotate", type=int, choices=sorted(QUARTER_TURNS))
    ap.add_argument("--straighten", type=float, metavar="D")
    ap.add_argument("--wb", action="store_true")
    ap.add_argument("--autocontrast", type=float, nargs="?", const=0.5,
                    metavar="PCT")
    ap.add_argument("--gamma", type=float, metavar="G")
    ap.add_argument("--sharpen", action="store_true")
    a = ap.parse_args()
    if a.package_box is not None and (a.exact or a.nosquare):
        ap.error("--package-box cannot be combined with --exact or --nosquare")
    if a.package_fill is not None and a.package_box is None:
        ap.error("--package-fill requires --package-box")
    fill = a.package_fill if a.package_fill is not None else 0.34
    if not math.isfinite(fill) or not 0 < fill <= 1:
        ap.error("--package-fill must be finite and greater than 0 through 1")
    if a.straighten is not None and abs(a.straighten) > MAX_STRAIGHTEN:
        ap.error(f"--straighten is for small tilts (at most {MAX_STRAIGHTEN:g} "
                 "degrees); use --rotate for quarter turns")
    if a.gamma is not None and a.gamma <= 0:
        ap.error("--gamma must be positive")
    if a.autocontrast is not None and not 0 <= a.autocontrast < 50:
        ap.error("--autocontrast PCT must be from 0 to under 50")

    im = ImageOps.exif_transpose(Image.open(a.src)).convert("RGB")
    W, H = im.size
    x0, y0, x1, y1 = a.x0, a.y0, a.x1, a.y1
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)

    package_box = None
    if a.package_box is not None:
        try:
            package_box = package_square(tuple(a.package_box), (x0, y0, x1, y1),
                                         fill, a.straighten or 0)
        except ValueError as exc:
            ap.error(str(exc))

    valid = None
    if a.straighten:
        im, valid = straighten(im, (x0, y0, x1, y1), a.straighten)
        if package_box is not None:
            # A square inside the unrotated ROI can still sample an excluded
            # neighbour after rotation. Track the source safe area itself,
            # with two pixels of clearance for bicubic interpolation.
            safe = Image.new("L", (W, H), 0)
            safe.paste(255, (x0, y0, x1, y1))
            valid = safe.filter(ImageFilter.MinFilter(5)).rotate(
                -a.straighten, resample=Image.Resampling.NEAREST,
                center=((x0+x1)/2, (y0+y1)/2), fillcolor=0)

    if package_box is not None:
        bx0, by0, bx1, by1 = package_box
    elif a.exact:
        bx0, by0, bx1, by1 = x0, y0, x1, y1
    else:
        found = find_object(im.crop((x0, y0, x1, y1)),
                            valid.crop((x0, y0, x1, y1)) if valid else None)
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
    if valid is not None and valid.crop(box).getextrema()[0] == 0:
        if package_box is not None:
            print("straightening makes the package square sample outside the "
                  "safe ROI; widen it only if clear, or straighten less",
                  file=sys.stderr)
            return 1
        print("straightening brings corner fill into the crop; tighten the "
              "ROI or straighten less", file=sys.stderr)
        return 1
    crop = im.crop(box)

    done = []
    if package_box is not None:
        done.append(f"package-fill={fill:g}")
    if a.straighten:
        done.append(f"straighten={a.straighten:g}")
    if a.rotate:
        crop = crop.transpose(QUARTER_TURNS[a.rotate])
        done.append(f"rotate={a.rotate}")
    if a.wb:
        crop, gains = white_balance(crop)
        done.append("wb=" + "/".join(f"{k:.2f}" for k in gains))
    if a.autocontrast is not None:
        crop = ImageOps.autocontrast(crop, cutoff=a.autocontrast,
                                     preserve_tone=True)
        done.append(f"autocontrast={a.autocontrast:g}")
    if a.gamma is not None:
        crop = gamma(crop, a.gamma)
        done.append(f"gamma={a.gamma:g}")
    if max(crop.size) > a.max:
        crop.thumbnail((a.max, a.max))
    if a.sharpen:
        crop = crop.filter(ImageFilter.UnsharpMask(radius=2, percent=80,
                                                   threshold=3))
        done.append("sharpen")
    crop.save(a.out, quality=90)
    print(f"{a.out}  box={box}  size={crop.size[0]}x{crop.size[1]}  "
          f"aspect={crop.size[0] / crop.size[1]:.2f}"
          + (f"  {' '.join(done)}" if done else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
