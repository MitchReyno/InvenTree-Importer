"""Overlay a labelled pixel grid on a photo, to read coordinates off it by eye.

    uv run -q --with pillow python grid.py SRC OUT [options]

Every label is in SOURCE pixels, whatever the preview's scale, so a number read
off the preview goes straight into a crop command. Labels sit on solid chips so
they stay legible on foil, glare and busy backgrounds.

Options:
  --region X0 Y0 X1 Y1   zoom into this part of the source (default: whole image)
  --width N              width of the preview in pixels (default 1000)
  --step N               grid spacing in source pixels (default: chosen so there
                         are about 15-20 lines across the region)
  --box X0 Y0 X1 Y1 [NAME]
                         draw a proposed box (repeatable). Each box gets a centre
                         crosshair and its four margins to the --object box, so
                         centring can be checked.
  --object X0 Y0 X1 Y1   the subject's own bounds (dashed); margins of every
                         --box are measured to it and printed
  --quiet                print only the box lines (for batch checks)

Prints the scale and, for each box, its size, aspect and margins
(left/right/top/bottom) to the object, flagging lopsided ones.
"""

import argparse
import sys

from PIL import Image, ImageDraw, ImageFont

BOX_COLOURS = [(0, 200, 0), (255, 140, 0), (200, 0, 200), (0, 170, 220)]


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def chip(d, xy, text, fg, f):
    x, y = xy
    l, t, r, b = d.textbbox((x, y), text, font=f)
    d.rectangle((l - 2, t - 1, r + 2, b + 1), fill=(255, 255, 255))
    d.text((x, y), text, fill=fg, font=f)


def nice_step(span):
    raw = span / 18
    for s in (5, 10, 20, 25, 50, 100, 200, 250, 500, 1000):
        if s >= raw:
            return s
    return 1000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--region", type=int, nargs=4)
    ap.add_argument("--width", type=int, default=1000)
    ap.add_argument("--step", type=int)
    ap.add_argument("--box", nargs="+", action="append", default=[])
    ap.add_argument("--object", type=int, nargs=4)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGB")
    W, H = im.size
    rx0, ry0, rx1, ry1 = a.region or (0, 0, W, H)
    rx0, ry0, rx1, ry1 = max(0, rx0), max(0, ry0), min(W, rx1), min(H, ry1)
    s = a.width / (rx1 - rx0)
    p = im.crop((rx0, ry0, rx1, ry1)).resize(
        (a.width, max(1, round((ry1 - ry0) * s))))
    d = ImageDraw.Draw(p)
    f = font(14)
    # a whole-photo overview is for layout, so it gets a coarser grid
    step = a.step or nice_step(max(rx1 - rx0, ry1 - ry0) * (1 if a.region else 1.6))

    def X(x):
        return (x - rx0) * s

    def Y(y):
        return (y - ry0) * s

    major = step * 5
    for x in range((rx0 // step + 1) * step, rx1, step):
        c = (230, 0, 0) if x % major == 0 else (255, 110, 110)
        d.line([(X(x), 0), (X(x), p.height)], fill=c, width=2 if x % major == 0 else 1)
    for y in range((ry0 // step + 1) * step, ry1, step):
        c = (0, 0, 230) if y % major == 0 else (110, 110, 255)
        d.line([(0, Y(y)), (p.width, Y(y))], fill=c, width=2 if y % major == 0 else 1)
    # labels last, so lines never cross them; label every other line when dense
    lab = step if step * s >= 45 else step * 2
    for x in range((rx0 // lab + 1) * lab, rx1, lab):
        chip(d, (X(x) + 3, 3), str(x), (200, 0, 0), f)
    for y in range((ry0 // lab + 1) * lab, ry1, lab):
        chip(d, (3, Y(y) + 3), str(y), (0, 0, 200), f)

    if not a.quiet:
        print(f"source {W}x{H}, region {rx0},{ry0}-{rx1},{ry1}, "
              f"preview scale {s:.3f}, grid every {step}px")

    if a.object:
        ox0, oy0, ox1, oy1 = a.object
        for i in range(int(X(ox0)), int(X(ox1)), 12):
            d.line([(i, Y(oy0)), (i + 6, Y(oy0))], fill=(0, 0, 0), width=2)
            d.line([(i, Y(oy1)), (i + 6, Y(oy1))], fill=(0, 0, 0), width=2)
        for j in range(int(Y(oy0)), int(Y(oy1)), 12):
            d.line([(X(ox0), j), (X(ox0), j + 6)], fill=(0, 0, 0), width=2)
            d.line([(X(ox1), j), (X(ox1), j + 6)], fill=(0, 0, 0), width=2)

    rc = 0
    for i, b in enumerate(a.box):
        if len(b) not in (4, 5):
            ap.error("--box takes X0 Y0 X1 Y1 [NAME]")
        x0, y0, x1, y1 = map(int, b[:4])
        name = b[4] if len(b) == 5 else f"box{i + 1}"
        c = BOX_COLOURS[i % len(BOX_COLOURS)]
        d.rectangle((X(x0), Y(y0), X(x1), Y(y1)), outline=c, width=3)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        d.line([(X(cx) - 12, Y(cy)), (X(cx) + 12, Y(cy))], fill=c, width=2)
        d.line([(X(cx), Y(cy) - 12), (X(cx), Y(cy) + 12)], fill=c, width=2)
        chip(d, (X(x0) + 4, Y(y0) + 4), name, c, f)
        w, h = x1 - x0, y1 - y0
        msg = f"{name}: {x0},{y0}-{x1},{y1}  {w}x{h}  aspect {w / h:.2f}"
        if a.object:
            ox0, oy0, ox1, oy1 = a.object
            ml, mr, mt, mb = ox0 - x0, x1 - ox1, oy0 - y0, y1 - oy1
            msg += f"  margins L{ml} R{mr} T{mt} B{mb}"
            # lopsided: a margin differs from its opposite by more than 15%
            # of the larger one (ignoring differences under 10 px)
            off = [ax for ax, m1, m2 in (("x", ml, mr), ("y", mt, mb))
                   if abs(m1 - m2) > max(10, 0.15 * max(m1, m2))]
            if min(ml, mr, mt, mb) < 0:
                msg += "  CLIPS THE OBJECT"
                rc = 2
            elif off:
                msg += f"  OFF-CENTRE in {'/'.join(off)}"
                rc = max(rc, 1)
        print(msg)

    p.save(a.out)
    if not a.quiet:
        print(a.out)
    return rc


if __name__ == "__main__":
    sys.exit(main())
