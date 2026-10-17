"""
The crop and grid scripts must agree on pixels and do only what they are asked.

The image subagent measures on grid.py's overlay and crops with crop.py, so a
photo the two orient differently is cropped in the wrong place. The
orientation and lighting options change what ends up in the inventory, so each
is held to doing what the skill says it does, and to nothing when not asked.
The scripts are run as the skills run them, through ``uv run --with``.
"""

from __future__ import annotations

import re
import shutil
import subprocess

import pytest
from PIL import Image, ImageDraw, ImageStat

from invimport.config import CONFIG_DIR

SCRIPTS = CONFIG_DIR.parent / ".claude" / "skills"
CROP = SCRIPTS / "component-photo-crops" / "scripts" / "crop.py"
GRID = SCRIPTS / "image-grid-overlay" / "scripts" / "grid.py"

pytestmark = pytest.mark.skipif(
    not CROP.exists() or shutil.which("uv") is None,
    reason="skill scripts or uv not available")


def run(script, *args) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["uv", "run", "-q", "--with", "pillow", "--with", "numpy", "python",
         str(script), *map(str, args)],
        capture_output=True, text=True, check=False)


@pytest.fixture
def photo(tmp_path):
    """A grey table with one dark part, a red mark at its top-left corner."""
    im = Image.new("RGB", (400, 300), (190, 190, 190))
    d = ImageDraw.Draw(im)
    d.rectangle((150, 100, 250, 200), fill=(40, 40, 40))
    d.rectangle((150, 100, 165, 115), fill=(220, 20, 20))
    path = tmp_path / "photo.png"
    im.save(path)
    return path


def is_red(px) -> bool:
    return px[0] > 150 and px[1] < 90 and px[2] < 90


def test_a_plain_crop_reports_no_adjustments(photo, tmp_path):
    out = tmp_path / "out.jpg"
    r = run(CROP, photo, out, 0, 0, 400, 300)
    assert r.returncode == 0, r.stderr
    assert re.search(r"aspect=1\.00$", r.stdout.strip())


def test_rotate_turns_the_crop_clockwise(photo, tmp_path):
    out = tmp_path / "out.png"
    r = run(CROP, photo, out, 140, 90, 260, 210, "--exact", "--rotate", 90)
    assert r.returncode == 0, r.stderr
    assert "rotate=90" in r.stdout
    im = Image.open(out).convert("RGB")
    w, h = im.size
    # the mark at the part's top-left ends up at its top-right
    assert is_red(im.getpixel((w - 20, 20)))
    assert not is_red(im.getpixel((20, 20)))


def test_straighten_refuses_when_corner_fill_would_show(photo, tmp_path):
    r = run(CROP, photo, tmp_path / "out.jpg", 0, 0, 400, 300, "--exact",
            "--straighten", 5)
    assert r.returncode == 1
    assert "corner fill" in r.stderr


def test_straighten_crops_a_roi_clear_of_the_fill(photo, tmp_path):
    r = run(CROP, photo, tmp_path / "out.jpg", 100, 50, 300, 250,
            "--straighten", -4)
    assert r.returncode == 0, r.stderr
    assert "straighten=-4" in r.stdout


def test_straighten_is_only_for_small_tilts(photo, tmp_path):
    r = run(CROP, photo, tmp_path / "out.jpg", 0, 0, 400, 300,
            "--straighten", 30)
    assert r.returncode == 2
    assert "--rotate" in r.stderr


def test_white_balance_removes_a_colour_cast(tmp_path):
    src = tmp_path / "warm.png"
    Image.new("RGB", (200, 200), (200, 170, 140)).save(src)
    out = tmp_path / "out.png"
    r = run(CROP, src, out, 0, 0, 200, 200, "--exact", "--wb")
    assert r.returncode == 0, r.stderr
    red, green, blue = ImageStat.Stat(Image.open(out).convert("RGB")).mean
    assert max(red, green, blue) - min(red, green, blue) < 6


def test_gamma_lifts_midtones(tmp_path):
    src = tmp_path / "dim.png"
    Image.new("RGB", (100, 100), (60, 60, 60)).save(src)
    out = tmp_path / "out.png"
    r = run(CROP, src, out, 0, 0, 100, 100, "--exact", "--gamma", 1.5)
    assert r.returncode == 0, r.stderr
    assert ImageStat.Stat(Image.open(out).convert("L")).mean[0] > 80


def test_grid_and_crop_both_apply_exif_orientation(tmp_path):
    src = tmp_path / "sideways.jpg"
    exif = Image.Exif()
    exif[0x0112] = 6  # stored sideways; display turned 90 degrees clockwise
    Image.new("RGB", (300, 200), (190, 190, 190)).save(src, exif=exif)

    r = run(GRID, src, tmp_path / "grid.png")
    assert r.returncode == 0, r.stderr
    assert "source 200x300" in r.stdout

    r = run(CROP, src, tmp_path / "out.jpg", 0, 0, 200, 300, "--exact",
            "--nosquare")
    assert r.returncode == 0, r.stderr
    assert "size=200x300" in r.stdout
