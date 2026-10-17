"""Make a maker's mark upright and flat before matching it.

    uv run -q --with numpy --with pillow python -I straighten.py SRC OUT [options]

Only for a mark that needs it: match.py tolerates a few degrees of tilt, and
every resample softens fine etched strokes, so an upright, square-on photo is
passed to match.py as it is.

Options (measure the points on the image-grid-overlay grid, in source pixels):
  --quarter N           turn N x 90 degrees anticlockwise first - exact, no
                        resampling - for a mark photographed sideways (1, 3)
                        or upside down (2)
  --level X1,Y1,X2,Y2   rotate so the line from (X1,Y1) to (X2,Y2) is
                        horizontal: two points on a text baseline, the top
                        edge of the logo's box or the package edge
  --rotate DEG          rotate by DEG anticlockwise (negative: clockwise),
                        when the angle is known rather than measured
  --corners TL TR BR BL four X,Y corners of something truly rectangular - the
                        package top, the logo's frame, a block of text - in
                        that order (top-left, top-right, bottom-right,
                        bottom-left as it should read). Maps them to a flat,
                        upright rectangle: corrects skew and keystone (a
                        package shot at an angle) as well as rotation.
  --aspect W:H          the rectangle's true proportions, when known; default
                        is the mean of the measured side lengths

--quarter is applied first, so measure --level, --rotate and --corners on the
turned image (run --quarter alone, overlay the grid, then measure). Uncovered
areas are filled with the image's median border colour rather than black, so a
wedge of fill does not look like part of the mark. Crop tightly afterwards.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def point(text: str) -> tuple[float, float]:
    try:
        x, y = (float(v) for v in text.split(","))
    except ValueError:
        sys.exit(f"not an X,Y point: {text!r}")
    return x, y


def border_colour(image: Image.Image):
    """The median colour of the outermost pixels, to fill uncovered corners."""
    a = np.asarray(image.convert("RGB"))
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    return tuple(int(v) for v in np.median(edge, axis=0))


def perspective_coefficients(src, dst) -> list[float]:
    """Coefficients mapping each output point in dst back to src (Pillow's
    PERSPECTIVE transform works from the output to the input)."""
    rows, rhs = [], []
    for (x, y), (u, v) in zip(dst, src, strict=True):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs += [u, v]
    return list(np.linalg.solve(np.array(rows, float), np.array(rhs, float)))


def flatten(image: Image.Image, corners, aspect: str | None) -> Image.Image:
    tl, tr, br, bl = corners
    width = (math.dist(tl, tr) + math.dist(bl, br)) / 2
    height = (math.dist(tl, bl) + math.dist(tr, br)) / 2
    if aspect:
        try:
            w, h = (float(v) for v in aspect.split(":"))
        except ValueError:
            sys.exit(f"--aspect is W:H, got {aspect!r}")
        # Keep the measured area; take the proportions from --aspect.
        area = width * height
        width, height = math.sqrt(area * w / h), math.sqrt(area * h / w)
    size = (max(1, round(width)), max(1, round(height)))
    dst = [(0, 0), (size[0], 0), size, (0, size[1])]
    return image.transform(size, Image.PERSPECTIVE,
                           perspective_coefficients(corners, dst),
                           Image.BICUBIC, fillcolor=border_colour(image))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--quarter", type=int, default=0)
    turn = ap.add_mutually_exclusive_group()
    turn.add_argument("--level", metavar="X1,Y1,X2,Y2")
    turn.add_argument("--rotate", type=float, metavar="DEG")
    turn.add_argument("--corners", nargs=4, metavar="X,Y")
    ap.add_argument("--aspect", metavar="W:H")
    a = ap.parse_args()

    image = Image.open(a.src).convert("RGB")
    steps = []
    quarter = a.quarter % 4
    if quarter:
        image = image.transpose([None, Image.ROTATE_90, Image.ROTATE_180,
                                 Image.ROTATE_270][quarter])
        steps.append(f"turned {quarter * 90} deg")

    angle = a.rotate
    if a.level:
        values = a.level.split(",")
        if len(values) != 4:
            sys.exit("--level is X1,Y1,X2,Y2")
        x1, y1, x2, y2 = (float(v) for v in values)
        if x2 < x1:
            x1, y1, x2, y2 = x2, y2, x1, y1
        # Image y runs down, so a line falling to the right needs an
        # anticlockwise (positive) turn to come level.
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
    if angle:
        image = image.rotate(angle, Image.BICUBIC, expand=True,
                             fillcolor=border_colour(image))
        steps.append(f"rotated {angle:+.1f} deg")
        if abs(angle) < 2:
            steps.append("(under 2 deg - match.py would likely have coped "
                         "without it)")

    if a.corners:
        image = flatten(image, [point(c) for c in a.corners], a.aspect)
        steps.append("flattened from 4 corners")
    elif a.aspect:
        sys.exit("--aspect only applies with --corners")

    a.out.parent.mkdir(parents=True, exist_ok=True)
    image.save(a.out)
    print(f"{a.out}: {image.width}x{image.height}; "
          f"{', '.join(steps) or 'unchanged'}")


if __name__ == "__main__":
    main()
