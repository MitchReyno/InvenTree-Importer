"""Generate the decoder's parity fixtures by running the skills' own scripts.

    uv run --project backend -q --with pillow==13.0.0 --with numpy==2.5.5 \
        python -I media-decoder/tests/fixtures/parity/generate.py

Run from the repository root. It draws a synthetic bench photo, crops it with
component-photo-crops/crop.py, overlays grids with image-grid-overlay/grid.py
and ranks degraded logos with chip-logo-identification/match.py, then writes
the inputs, the script outputs and expected.json next to this file. The
TypeScript ports are tested against these outputs.
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


def run(arguments: list[str]) -> str:
    done = subprocess.run(
        [sys.executable, "-I", *arguments], capture_output=True, text=True
    )
    # grid.py exits 1 for an off-centre box and 2 for one that clips the object.
    if done.returncode not in (0, 1, 2):
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
        printed = run([str(GRID), str(photo), str(target), *spec["arguments"]])
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


def main() -> None:
    photo = HERE / "bench-photo.png"
    bench_photo().save(photo)
    expected = {
        "photo": photo.name,
        "crops": crop_fixtures(photo),
        "grids": grid_fixtures(photo),
        "logos": logo_fixtures(),
        "montage": montage_fixture(photo),
    }
    (HERE / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")


if __name__ == "__main__":
    main()
