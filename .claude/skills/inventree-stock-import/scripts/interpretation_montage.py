"""Interpretation montage: how the source photos were read into an import file.

    uv run -q --with pillow python interpretation_montage.py IMPORT.json OUT_DIR \
        [--sources SOURCES.json] [--width N]

One PNG per stock location (lines with no location share one sheet). Each sheet
has a section per proposed part - its part image, MPN/type, maker, category,
description, stock-item count and total quantity - and under it a row per line:
what was read (id, quantity, batch, packaging, condition, confidence), the
source photo(s) the line was read from, an arrow, then the line's
stock_images. Grey frames are source photos, orange the part image, blue
stock images. A missing file is drawn as a red placeholder, not skipped.

SOURCES.json maps line ids to the photos each line was read from, as paths
absolute or relative to the import file:

    {"l01": ["photos/<import id>/source/41-914hmqb-bag.png"], "l14": [...]}

It defaults to IMPORT.sources.json beside the import file (the import file
itself cannot carry it - its schema is strict). Lines without an entry show
"no source photo listed". Prints the path of every sheet written.
"""

import argparse
import json
import re
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG, INK, MUTED = (250, 250, 248), (25, 25, 25), (110, 110, 110)
SRC_C, IMG_C, STK_C, MISS_C = (90, 90, 90), (200, 120, 0), (0, 120, 200), (200, 0, 0)
ROW, HEAD, TXT_W = 300, 170, 560


def font(n):
    try:
        return ImageFont.load_default(size=n)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


F_H1, F_H2, F_B, F_S = font(30), font(22), font(17), font(15)


def ascii_safe(s):
    # the bundled font has no dashes, arrows or degree signs
    return (str(s).replace("—", "-").replace("–", "-")
            .replace("°", " deg ").replace("µ", "u"))


def load(path, h):
    try:
        im = Image.open(path).convert("RGB")
    except (OSError, ValueError):
        im = Image.new("RGB", (h, h), (255, 235, 235))
        d = ImageDraw.Draw(im)
        d.text((10, h // 2 - 10), "missing", fill=MISS_C, font=F_B)
        return im, False
    im.thumbnail((int(h * 1.6), h))
    return im, True


def framed(c, d, path, x, y, h, colour, label):
    im, ok = load(path, h)
    c.paste(im, (x, y))
    colour = colour if ok else MISS_C
    d.rectangle((x - 2, y - 2, x + im.width + 1, y + im.height + 1), outline=colour, width=3)
    # keep the label within the image's width so neighbours never overlap
    label = ascii_safe(label)
    while len(label) > 4 and d.textlength(label, font=F_S) > im.width:
        label = label[:-4] + "..."
    d.text((x, y + im.height + 4), label, fill=colour, font=F_S)
    return x + im.width + 18


def arrow(d, x, y):
    d.line((x, y, x + 30, y), fill=INK, width=4)
    d.polygon([(x + 30, y - 10), (x + 42, y), (x + 30, y + 10)], fill=INK)
    return x + 56


def part_key(l):
    return (l.get("_part") or l.get("ipn") or l.get("mpn") or l.get("type")
            or l.get("sku") or l.get("description", "?"))


def flat_lines(doc):
    """Lines with their part's fields, as version 1 wrote them on every line.

    Version 2 describes each part once and has a line name its manufacturer
    part (or its part), so fold those back onto the line for the sheet.
    """
    if doc.get("version") != 2:
        return doc["lines"]
    parts = {p["id"]: p for p in doc.get("parts", [])}
    mps = {m["id"]: m for m in doc.get("manufacturer_parts", [])}
    out = []
    for l in doc["lines"]:
        mp = mps.get(l.get("manufacturer_part"), {})
        part = parts.get(mp.get("part") or l.get("part"), {})
        maker = {k: mp[k] for k in ("manufacturer", "mpn") if k in mp}
        out.append({**part, **maker, **l, "_part": part.get("id")})
    return out


def sheet(lines, title, base, sources, width, out):
    parts = {}
    for l in lines:
        parts.setdefault(part_key(l), []).append(l)
    c = Image.new("RGB", (width, 110 + sum(HEAD + ROW * len(v) for v in parts.values())), BG)
    d = ImageDraw.Draw(c)
    nsns = sorted({t[4:] for l in lines for t in l.get("tags", []) if t.startswith("nsn:")})
    d.text((24, 20), ascii_safe(title), fill=INK, font=F_H1)
    d.text((24, 62), ascii_safe(
        f"{len(lines)} lines, {sum(l.get('quantity', 0) for l in lines)} pieces"
        + (f"  -  NSN {', '.join(nsns)}" if nsns else "")
        + "   |   grey = source photo, orange = part image, blue = stock image"),
        fill=MUTED, font=F_B)
    y = 110
    for key, ls in parts.items():
        l0 = ls[0]
        d.line((20, y, width - 20, y), fill=(180, 180, 180), width=2)
        hx = 40
        if l0.get("image"):
            im, ok = load(base / l0["image"], 140)
            c.paste(im, (24, y + 14))
            d.rectangle((22, y + 12, 25 + im.width, y + 15 + im.height),
                        outline=IMG_C if ok else MISS_C, width=3)
            hx = 40 + im.width
        kind = "IPN" if l0.get("ipn") else "MPN" if l0.get("mpn") else "type" if l0.get("type") else "part"
        maker = l0.get("manufacturer") or "(no manufacturer)"
        number = l0.get("mpn") or l0.get("type") or key
        label = (f"{l0['name']}  ({kind} {number})"
                 if l0.get("name") and l0["name"] != number else f"{kind} {number}")
        d.text((hx, y + 16), ascii_safe(f"PART {label}  -  {maker}"), fill=INK, font=F_H2)
        d.text((hx, y + 48), ascii_safe(
            f"{l0.get('category', '?')}   |   {len(ls)} stock item(s), "
            f"{sum(l.get('quantity', 0) for l in ls)} pcs"), fill=MUTED, font=F_B)
        d.text((hx, y + 74), ascii_safe(textwrap.shorten(l0.get("description", ""), 150)),
               fill=MUTED, font=F_S)
        d.text((hx, y + 98), ascii_safe("part image: " + (l0.get("image", "").split("/")[-1] or "none")),
               fill=IMG_C, font=F_S)
        y += HEAD
        for l in ls:
            approx = "  (approx.)" if l.get("approximate") else ""
            d.text((40, y + 6), ascii_safe(f"{l['id']}   qty {l.get('quantity', '?')}{approx}"),
                   fill=INK, font=F_H2)
            rows = [(f"batch: {l.get('batch', '-')}", INK),
                    (f"packaging: {l.get('packaging', '-')}", INK),
                    (f"condition: {l.get('condition') or '-'}", MUTED),
                    (f"confidence: {l.get('confidence', '-')}"
                     + ("  NEEDS REVIEW" if l.get("needs_review") else ""), MUTED)]
            for i, (t, col) in enumerate(rows):
                for j, w in enumerate(textwrap.wrap(ascii_safe(t), 52)[:2]):
                    d.text((40, y + 40 + i * 44 + j * 19), w, fill=col, font=F_B)
            x, h = TXT_W, ROW - 50
            srcs = sources.get(l["id"], [])
            # shrink a crowded row so every image fits within the sheet
            paths = ([Path(s) if Path(s).is_absolute() else base / s for s in srcs]
                     + [base / s for s in l.get("stock_images", [])])
            need = 56 + (220 if not srcs else 0)
            for p in paths:
                try:
                    with Image.open(p) as im:
                        need += min(1.6 * h, h * im.width / im.height) + 18
                except (OSError, ValueError):
                    need += h + 18
            if need > width - TXT_W - 20:
                h = int(h * (width - TXT_W - 20) / need)
            if not srcs:
                d.text((x, y + h // 2), "no source photo listed", fill=MISS_C, font=F_B)
                x += 220
            for s in srcs:
                p = Path(s) if Path(s).is_absolute() else base / s
                x = framed(c, d, p, x, y + 6, h, SRC_C, p.name)
            x = arrow(d, x - 6, y + 6 + h // 2)
            for s in l.get("stock_images", []):
                x = framed(c, d, base / s, x, y + 6, h, STK_C, Path(s).name)
            y += ROW
    c.save(out, optimize=True)
    print(out, f"{c.width}x{c.height}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("import_file")
    ap.add_argument("out_dir")
    ap.add_argument("--sources")
    ap.add_argument("--width", type=int, default=2000)
    a = ap.parse_args()

    imp = Path(a.import_file).resolve()
    base = imp.parent
    doc = json.loads(imp.read_text())
    sp = Path(a.sources) if a.sources else imp.with_suffix(".sources.json")
    sources = json.loads(sp.read_text()) if sp.exists() else {}
    if not sources:
        print(f"no sources map at {sp}; rows will say 'no source photo listed'",
              file=sys.stderr)
    out_dir = Path(a.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    groups = {}
    for l in flat_lines(doc):
        groups.setdefault(l.get("location") or "", []).append(l)
    stem = imp.stem
    for loc, ls in groups.items():
        slug = re.sub(r"[^a-z0-9]+", "-", ascii_safe(loc).lower()).strip("-") or "no-location"
        title = f"{stem}  -  location '{loc}'" if loc else f"{stem}  -  no location"
        sheet(ls, title, base, sources, a.width, out_dir / f"{stem}-{slug}.png")


if __name__ == "__main__":
    main()
