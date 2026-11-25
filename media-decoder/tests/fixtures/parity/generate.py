"""Generate the decoder's parity fixtures by running the skills' own scripts.

    uv run --project backend -q --with pillow==13.0.0 --with numpy==2.5.5 \
        python -I media-decoder/tests/fixtures/parity/generate.py

Run from the repository root. It draws a synthetic bench photo, crops it with
component-photo-crops/crop.py, overlays grids with image-grid-overlay/grid.py,
lays out montages with montage.py and ranks degraded logos with
chip-logo-identification/match.py. It also renders the scene with exact geometry
as ground truth for straightened crops. It writes the inputs, the script outputs,
the truths and expected.json next to this file; the TypeScript ports are tested
against them.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[3]
SKILLS = REPOSITORY / ".claude" / "skills"
CROP = SKILLS / "component-photo-crops" / "scripts" / "crop.py"
GRID = SKILLS / "image-grid-overlay" / "scripts" / "grid.py"
MATCH = SKILLS / "chip-logo-identification" / "scripts" / "match.py"
MONTAGE = SKILLS / "component-photo-crops" / "scripts" / "montage.py"
LOGOS = SKILLS / "chip-logo-identification" / "data" / "logos"

PHOTO_SIZE = (480, 360)


def bench_photo() -> Image.Image:
    """A warm-lit bench: a banded resistor, an IC, a blue cap, a grey card."""
    rng = np.random.default_rng(22)
    width, height = PHOTO_SIZE
    x = np.linspace(0, 1, width)[None, :]
    y = np.linspace(0, 1, height)[:, None]
    base = np.stack(
        [150 + 30 * x + 10 * y, 142 + 20 * x + 12 * y, 130 + 10 * x + 8 * y], axis=-1
    )
    image = Image.fromarray(np.clip(base, 0, 255).astype("uint8"))
    draw = ImageDraw.Draw(image)
    # A neutral grey card under the warm light, for cast checks.
    draw.rectangle((30, 250, 130, 330), fill=(150, 142, 130))
    draw.ellipse((50, 50, 130, 130), fill=(40, 80, 200))
    draw.rectangle((300, 60, 420, 140), fill=(38, 38, 40))
    for row, top in enumerate((78, 98, 118)):
        for column in range(6 - row):
            left = 312 + column * 16
            draw.rectangle((left, top, left + 10, top + 8), fill=(225, 225, 215))
    draw.line((120, 200, 360, 200), fill=(170, 170, 175), width=4)
    draw.rounded_rectangle((170, 182, 310, 218), radius=12, fill=(206, 184, 140))
    for left, colour in (
        (190, (110, 60, 20)),
        (214, (25, 25, 25)),
        (238, (200, 30, 30)),
        (280, (190, 150, 50)),
    ):
        draw.rectangle((left, 182, left + 12, 218), fill=colour)
    draw.rectangle((380, 230, 440, 300), fill=(40, 160, 60))
    image = image.filter(ImageFilter.GaussianBlur(0.8))
    noise = rng.normal(0, 4, (height, width, 3))
    pixels = np.asarray(image, dtype=float) + noise
    return Image.fromarray(np.clip(np.round(pixels), 0, 255).astype("uint8"))


def run(arguments: list[str], allowed: tuple[int, ...] = (0,)) -> str:
    done = subprocess.run(
        [sys.executable, "-I", *arguments], capture_output=True, text=True
    )
    if done.returncode not in allowed:
        raise SystemExit(f"{arguments[0]} failed: {done.stderr}")
    return done.stdout


CROPS = [
    {
        "name": "plain",
        "region": [60, 40, 300, 220],
        "quarter_turns": 0,
        "straighten": 0,
        "wb": False,
    },
    {
        "name": "turned-90",
        "region": [150, 160, 330, 240],
        "quarter_turns": 1,
        "straighten": 0,
        "wb": False,
    },
    {
        "name": "turned-180",
        "region": [290, 50, 430, 150],
        "quarter_turns": 2,
        "straighten": 0,
        "wb": False,
    },
    {
        "name": "turned-270",
        "region": [20, 30, 160, 340],
        "quarter_turns": 3,
        "straighten": 0,
        "wb": False,
    },
    {
        "name": "tall",
        "region": [0, 0, 300, 360],
        "quarter_turns": 0,
        "straighten": 0,
        "wb": False,
    },
    {
        "name": "straight-7",
        "region": [140, 150, 340, 250],
        "quarter_turns": 0,
        "straighten": 7,
        "wb": False,
    },
    {
        "name": "straight-neg-3.5",
        "region": [280, 40, 440, 160],
        "quarter_turns": 1,
        "straighten": -3.5,
        "wb": False,
    },
    # The guard leaves these gains intact: the card, the background and the blue cap only.
    {
        "name": "wb-card",
        "region": [20, 230, 200, 345],
        "quarter_turns": 0,
        "straighten": 0,
        "wb": True,
    },
    {
        "name": "wb-turned",
        "region": [20, 20, 180, 170],
        "quarter_turns": 1,
        "straighten": 0,
        "wb": True,
    },
    # The script's gains turn the gold band and the green part by over 5°, so the guard holds back.
    {
        "name": "wb-bands",
        "region": [10, 20, 470, 350],
        "quarter_turns": 1,
        "straighten": 0,
        "wb": True,
        "guard_holds_back": True,
    },
]


def crop_fixtures(photo: Path) -> list[dict]:
    out = []
    for spec in CROPS:
        target = HERE / f"crop-{spec['name']}.png"
        arguments = [
            str(CROP),
            str(photo),
            str(target),
            *map(str, spec["region"]),
            "--exact",
            "--nosquare",
        ]
        if spec["quarter_turns"]:
            arguments += ["--rotate", str(spec["quarter_turns"] * 90)]
        if spec["straighten"]:
            arguments += ["--straighten", str(spec["straighten"])]
        if spec["wb"]:
            arguments += ["--wb"]
        printed = run(arguments)
        gains = re.search(r"wb=([0-9.]+)/([0-9.]+)/([0-9.]+)", printed)
        out.append(
            {
                "guard_holds_back": False,
                **spec,
                "output": target.name,
                "gains": [float(v) for v in gains.groups()] if gains else None,
            }
        )
    return out


GRIDS = [
    {"name": "whole", "arguments": []},
    {
        "name": "zoom",
        "arguments": [
            "--region",
            "150",
            "160",
            "330",
            "240",
            "--width",
            "900",
            "--object",
            "170",
            "182",
            "310",
            "218",
            "--box",
            "160",
            "172",
            "320",
            "228",
            "even",
            "--box",
            "150",
            "170",
            "300",
            "230",
            "lopsided",
            "--box",
            "180",
            "175",
            "320",
            "225",
            "clipping",
        ],
    },
    {
        "name": "stepped",
        "arguments": [
            "--region",
            "0",
            "0",
            "480",
            "360",
            "--width",
            "640",
            "--step",
            "40",
            "--box",
            "300",
            "60",
            "420",
            "140",
        ],
    },
]


def grid_fixtures(photo: Path) -> list[dict]:
    out = []
    for spec in GRIDS:
        target = HERE / ".grid.png"
        # grid.py exits 1 for an off-centre box and 2 for one that clips the object.
        printed = run(
            [str(GRID), str(photo), str(target), *spec["arguments"]], allowed=(0, 1, 2)
        )
        target.unlink()
        lines = [
            line for line in printed.splitlines() if not line.endswith(".grid.png")
        ]
        out.append({**spec, "printed": lines})
    return out


# Each degradation stands for a way a maker's mark looks on a real package.
def etched(logo: Image.Image) -> Image.Image:
    """Light-on-dark laser etching, enlarged and a little soft."""
    big = logo.resize((logo.width * 3, logo.height * 3), Image.Resampling.BICUBIC)
    return big.filter(ImageFilter.GaussianBlur(1.2))


def printed(logo: Image.Image) -> Image.Image:
    """Dark ink on a light package: the reference inverted, on grey."""
    inverted = ImageOps.invert(logo.convert("RGB"))
    big = inverted.resize((logo.width * 2, logo.height * 2), Image.Resampling.BICUBIC)
    return Image.eval(big, lambda v: 60 + v * 150 // 255)


def noisy(logo: Image.Image) -> Image.Image:
    rng = np.random.default_rng(7)
    big = logo.resize((logo.width * 2, logo.height * 2), Image.Resampling.BILINEAR)
    pixels = np.asarray(big.convert("RGB"), dtype=float) + rng.normal(
        0, 18, (big.height, big.width, 3)
    )
    return Image.fromarray(np.clip(pixels, 0, 255).astype("uint8"))


def tilted(logo: Image.Image) -> Image.Image:
    big = logo.convert("RGB").resize(
        (logo.width * 3, logo.height * 3), Image.Resampling.BICUBIC
    )
    return big.rotate(
        3, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(0, 0, 0)
    )


DEGRADATIONS = {"etched": etched, "printed": printed, "noisy": noisy, "tilted": tilted}
LOGO_QUERIES = [
    ("motorola1", "etched"),
    ("fairchild1", "printed"),
    ("harris1", "noisy"),
    ("lattice1", "tilted"),
    ("signetics", "etched"),
    ("micrel", "printed"),
    ("siliconix", "noisy"),
    ("dallas2", "tilted"),
    ("ns2", "printed"),
    ("allegro1", "etched"),
]


def logo_fixtures() -> list[dict]:
    out = []
    for logo_id, degradation in LOGO_QUERIES:
        source = Image.open(LOGOS / f"{logo_id}.gif").convert("RGB")
        target = HERE / f"logo-{logo_id}-{degradation}.png"
        DEGRADATIONS[degradation](source).save(target)
        ranked = run([str(MATCH), str(target), "--top", "5"])
        top = [
            line.split()[2]
            for line in ranked.splitlines()
            if re.match(r"\s*\d+\.", line)
        ]
        out.append(
            {
                "id": logo_id,
                "degradation": degradation,
                "query": target.name,
                "top": top,
            }
        )
    return out


# Oversized and non-square crops, so cell placement, downscaling and aspect all show.
MONTAGE_CROPS = ["plain", "tall", "turned-270"]


def montage_fixture(photo: Path) -> dict:
    target = HERE / "montage-script.png"
    inputs = [photo, *(HERE / f"crop-{name}.png" for name in MONTAGE_CROPS)]
    run([str(MONTAGE), str(target), *map(str, inputs), "--cell", "360", "--cols", "4"])
    return {"output": target.name, "whole_photo_first": True, "crops": MONTAGE_CROPS}


# Ground truth for straightened crops. The bench scene is drawn again with exact geometry at 8x
# supersampling, blurred as the photo is (0.8 px, in floating point), printed with the photo's own
# seed-22 noise as one-pixel cells on the subject, and averaged down. The source is that scene
# upright; each truth is the same scene turned directly onto a straightened crop's output grid,
# so no resampling stands between the scene and the truth.
SUPERSAMPLE = 8
BLUR_SIGMA_PX = 0.8
TRUTH_MARGIN_PX = 4
SCENE_TEXT = [
    (312 + column * 16, top)
    for row, top in enumerate((78, 98, 118))
    for column in range(6 - row)
]
BANDS = [
    (190, (110, 60, 20)),
    (214, (25, 25, 25)),
    (238, (200, 30, 30)),
    (280, (190, 150, 50)),
]
# The decoder's straightened fixtures, as angles of the output grid against the scene: 7 degrees
# straightening, and -3.5 degrees after a quarter turn.
TRUTHS = [
    {"crop": "straight-7", "degrees": -7.0},
    {"crop": "straight-neg-3.5", "degrees": -86.5},
]


def inside(sx, sy, x0, y0, x1, y1):
    return (sx >= x0) & (sx < x1) & (sy >= y0) & (sy < y1)


def scene_colour(sx: np.ndarray, sy: np.ndarray) -> np.ndarray:
    """The bench scene at continuous scene points, drawn in the generator's order."""
    width, height = PHOTO_SIZE
    u = np.clip((sx - 0.5) / (width - 1), 0, 1)
    v = np.clip((sy - 0.5) / (height - 1), 0, 1)
    out = np.stack(
        [150 + 30 * u + 10 * v, 142 + 20 * u + 12 * v, 130 + 10 * u + 8 * v], axis=-1
    ).astype(np.float32)

    def paint(mask, colour):
        out[mask] = colour

    paint(inside(sx, sy, 30, 250, 131, 331), (150, 142, 130))
    paint((sx - 90.5) ** 2 + (sy - 90.5) ** 2 <= 40.5**2, (40, 80, 200))
    paint(inside(sx, sy, 300, 60, 421, 141), (38, 38, 40))
    for left, top in SCENE_TEXT:
        paint(inside(sx, sy, left, top, left + 11, top + 9), (225, 225, 215))
    paint(inside(sx, sy, 120, 198, 361, 202), (170, 170, 175))
    body = inside(sx, sy, 170, 182, 311, 219)
    radius = 12
    for cx, cy in ((182, 194), (299, 194), (182, 207), (299, 207)):
        corner = ((sx < 182) if cx == 182 else (sx >= 299)) & (
            (sy < 194) if cy == 194 else (sy >= 207)
        )
        body &= ~corner | ((sx - cx) ** 2 + (sy - cy) ** 2 <= radius**2)
    paint(body, (206, 184, 140))
    for left, colour in BANDS:
        paint(inside(sx, sy, left, 182, left + 13, 219), colour)
    paint(inside(sx, sy, 380, 230, 441, 301), (40, 160, 60))
    return out


def gaussian_blur(image: np.ndarray, sigma: float) -> np.ndarray:
    """A separable Gaussian in float32, edges repeated, so flat colours keep their level."""
    radius = int(np.ceil(3 * sigma))
    taps = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    taps = (taps / taps.sum()).astype(np.float32)
    for axis in (0, 1):
        padded = np.pad(
            image,
            [(radius, radius) if a == axis else (0, 0) for a in range(3)],
            mode="edge",
        )
        blurred = np.zeros_like(image)
        size = image.shape[axis]
        for index, weight in enumerate(taps):
            window = [slice(None)] * 3
            window[axis] = slice(index, index + size)
            blurred += weight * padded[tuple(window)]
        image = blurred
    return image


def render(width: int, height: int, to_scene, noise: np.ndarray) -> Image.Image:
    """Output pixels (with a margin) mapped to the scene, supersampled, blurred, grained, boxed down."""
    margin = TRUTH_MARGIN_PX
    full_w, full_h = width + 2 * margin, height + 2 * margin
    xs = (np.arange(full_w * SUPERSAMPLE) + 0.5) / SUPERSAMPLE - margin
    ys = (np.arange(full_h * SUPERSAMPLE) + 0.5) / SUPERSAMPLE - margin
    gx, gy = np.meshgrid(xs, ys)
    sx, sy = to_scene(gx, gy)
    fine = scene_colour(sx, sy)
    fine = gaussian_blur(fine, BLUR_SIGMA_PX * SUPERSAMPLE)
    photo_w, photo_h = PHOTO_SIZE
    cx, cy = np.floor(sx).astype(int), np.floor(sy).astype(int)
    on_photo = (cx >= 0) & (cy >= 0) & (cx < photo_w) & (cy < photo_h)
    fine[on_photo] += noise[cy[on_photo], cx[on_photo]]
    boxed = fine.reshape(full_h, SUPERSAMPLE, full_w, SUPERSAMPLE, 3).mean(axis=(1, 3))
    boxed = boxed[margin : margin + height, margin : margin + width]
    return Image.fromarray(np.clip(np.round(boxed), 0, 255).astype("uint8"))


def truth_fixtures() -> list[dict]:
    noise = np.random.default_rng(22).normal(0, 4, (PHOTO_SIZE[1], PHOTO_SIZE[0], 3))
    noise = noise.astype(np.float32)
    source = HERE / "truth-source.png"
    render(*PHOTO_SIZE, lambda x, y: (x, y), noise).save(source)
    out = []
    for truth in TRUTHS:
        spec = next(item for item in CROPS if item["name"] == truth["crop"])
        x0, y0, x1, y1 = spec["region"]
        width, height = x1 - x0, y1 - y0
        if spec["quarter_turns"] % 2:
            width, height = height, width
        centre_x, centre_y = (x0 + x1) / 2, (y0 + y1) / 2
        theta = np.radians(truth["degrees"])
        cos, sin = np.cos(theta), np.sin(theta)

        def to_scene(x, y, w=width, h=height, cx=centre_x, cy=centre_y, c=cos, s=sin):
            dx, dy = x - w / 2, y - h / 2
            return cx + c * dx - s * dy, cy + s * dx + c * dy

        target = HERE / f"truth-{truth['crop']}.png"
        render(width, height, to_scene, noise).save(target)
        script = HERE / f"truth-crop-{truth['crop']}.png"
        arguments = [str(CROP), str(source), str(script), *map(str, spec["region"])]
        arguments += ["--exact", "--nosquare", "--straighten", str(spec["straighten"])]
        if spec["quarter_turns"]:
            arguments += ["--rotate", str(spec["quarter_turns"] * 90)]
        run(arguments)
        out.append({**truth, "truth": target.name, "script": script.name})
    return out


def main() -> None:
    photo = HERE / "bench-photo.png"
    bench_photo().save(photo)
    expected = {
        "photo": photo.name,
        "crops": crop_fixtures(photo),
        "grids": grid_fixtures(photo),
        "logos": logo_fixtures(),
        "montage": montage_fixture(photo),
        "source": "truth-source.png",
        "truths": truth_fixtures(),
    }
    (HERE / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")


if __name__ == "__main__":
    main()
