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


def test_package_framing_keeps_body_at_medium_scale_and_crops_lead_ends(tmp_path):
    src, out = tmp_path / "axial.png", tmp_path / "square.png"
    im = Image.new("RGB", (400, 300), (190, 190, 190))
    d = ImageDraw.Draw(im)
    d.line((0, 150, 399, 150), fill=(40, 40, 40), width=3)
    d.rectangle((150, 120, 249, 179), fill=(20, 80, 180))
    im.save(src)
    r = run(CROP, src, out, 0, 0, 400, 300,
            "--package-box", 150, 120, 250, 180)
    assert r.returncode == 0, r.stderr
    result = Image.open(out)
    assert result.size == (295, 295)
    assert result.getpixel((0, 148)) == (40, 40, 40)
    assert result.getpixel((294, 148)) == (40, 40, 40)
    blue = [(x, y) for y in range(result.height) for x in range(result.width)
            if result.getpixel((x, y)) == (20, 80, 180)]
    assert len(blue) == 100 * 60  # complete package, unchanged colours
    assert max(x for x, _ in blue) - min(x for x, _ in blue) + 1 == 100
    assert "package-fill=0.34" in r.stdout


@pytest.mark.parametrize("fill", [0.34, 1e-320])
def test_package_framing_refuses_to_slide_or_zoom_when_safe_roi_is_tight(photo, tmp_path, fill):
    out = tmp_path / "out.png"
    r = run(CROP, photo, out, 140, 90, 300, 240,
            "--package-box", 150, 100, 250, 200, "--package-fill", fill)
    assert r.returncode == 2
    assert "does not fit the safe ROI" in r.stderr
    assert not out.exists()


def test_package_framing_tracks_off_centre_body_when_straightening(tmp_path):
    src, out = tmp_path / "off-centre.png", tmp_path / "square.png"
    im = Image.new("RGB", (400, 300), (190, 190, 190))
    ImageDraw.Draw(im).rectangle((240, 120, 279, 139), fill=(10, 30, 200))
    im.save(src)
    r = run(CROP, src, out, 0, 0, 400, 300,
            "--package-box", 240, 120, 280, 140, "--straighten", 15)
    assert r.returncode == 0, r.stderr
    result = Image.open(out)
    assert result.width == result.height
    blue = [(x, y) for y in range(result.height) for x in range(result.width)
            if result.getpixel((x, y))[2] > 180
            and result.getpixel((x, y))[0] < 50]
    for axis in (0, 1):
        centre = (min(p[axis] for p in blue) + max(p[axis] for p in blue)) / 2
        assert abs(centre - result.width / 2) < 2


@pytest.mark.parametrize("fill", [0, -0.1, 1.1, "nan", "inf"])
def test_package_fill_rejects_invalid_values(photo, tmp_path, fill):
    r = run(CROP, photo, tmp_path / "out.png", 0, 0, 400, 300,
            "--package-box", 150, 100, 250, 200, "--package-fill", fill)
    assert r.returncode == 2
    assert "--package-fill must be finite" in r.stderr


@pytest.mark.parametrize("option", ["--exact", "--nosquare"])
def test_package_framing_rejects_conflicting_modes(photo, tmp_path, option):
    r = run(CROP, photo, tmp_path / "out.png", 0, 0, 400, 300,
            "--package-box", 150, 100, 250, 200, option)
    assert r.returncode == 2
    assert "cannot be combined" in r.stderr


def test_package_fill_requires_measured_bounds(photo, tmp_path):
    r = run(CROP, photo, tmp_path / "out.png", 0, 0, 400, 300,
            "--package-fill", 0.34)
    assert r.returncode == 2
    assert "requires --package-box" in r.stderr


@pytest.mark.parametrize(("fill", "side"), [(0.5, 200), (0.4, 250)])
def test_package_fill_controls_visible_context(photo, tmp_path, fill, side):
    out = tmp_path / "out.png"
    r = run(CROP, photo, out, 0, 0, 400, 300,
            "--package-box", 150, 100, 250, 200, "--package-fill", fill)
    assert r.returncode == 0, r.stderr
    assert Image.open(out).size == (side, side)


def test_package_bounds_must_be_inside_safe_roi(photo, tmp_path):
    r = run(CROP, photo, tmp_path / "out.png", 100, 50, 300, 250,
            "--package-box", 90, 100, 200, 200)
    assert r.returncode == 2
    assert "inside the safe ROI" in r.stderr


def test_package_straightening_cannot_pull_in_excluded_neighbour(tmp_path):
    src, out = tmp_path / "neighbour.png", tmp_path / "out.png"
    im = Image.new("RGB", (1000, 1000), (190, 190, 190))
    d = ImageDraw.Draw(im)
    d.rectangle((410, 470, 589, 529), fill=(20, 80, 180))
    d.rectangle((180, 320, 199, 350), fill=(230, 0, 0))
    im.save(src)
    r = run(CROP, src, out, 200, 200, 800, 800,
            "--package-box", 410, 470, 590, 530, "--straighten", 15)
    assert r.returncode == 1
    assert "sample outside the safe ROI" in r.stderr
    assert not out.exists()
