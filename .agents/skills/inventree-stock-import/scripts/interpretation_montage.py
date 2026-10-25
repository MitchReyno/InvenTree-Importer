"""Interpretation montage: how the source photos were read into an import file,
and how the import relates to what is already on the server.

    uv run -q --with pillow python interpretation_montage.py IMPORT.json OUT_DIR \\
        [--plan PLAN.json] [--sources SOURCES.json] [--width N]

Writes one PDF, OUT_DIR/<import stem>.pdf, with A4-proportioned pages. Each
stock location starts a new page (lines with no location share one group), and
a part's section is never split across pages - a part too tall for one page
gets a taller page of its own. Every page has a header naming the import, the
location and the page number. Each part has a section - its part image,
MPN/type, maker, category, description, stock-item count and total quantity -
and under it a row per line: what was read (id, quantity, batch, packaging,
condition, confidence), the source photo(s) the line was read from, an arrow,
then the line's stock_images. Grey frames are source photos, orange the part
image, blue stock images. A missing file is drawn as a red placeholder.

A part image that is a URL is downloaded (cached under OUT_DIR/.web-cache) and
drawn in a purple frame with a "WEB IMAGE" band over it, naming the site.

PLAN.json is written by `invimport import-stock FILE --plan PLAN.json` (a dry
run is enough). With it, every part says whether it is NEW or EXISTING on the
server; an existing part lists the stock already on it and what the total
will be after the import, whether its manufacturer and supplier parts and
notes are already there, and shows the server's own image (teal band "ON
SERVER") when the server keeps that image instead of the file's. Every line
says whether it makes a new stock item, is already imported, or is skipped,
and whether its location is new or already holds stock of the part. Without a
plan the montage says so on every page.

SOURCES.json maps line ids to the photos each line was read from, as paths
absolute or relative to the import file:

    {"l01": ["photos/source/41-914hmqb-bag.png"], "l14": [...]}

It defaults to IMPORT.sources.json beside the import file, in the import's own
folder .local_imports/<import id>/ (the import file itself cannot carry it -
its schema is strict). The PDF is a review aid, not a source: write OUT_DIR
under .temp/, not into the import folder, or it ends up in the import's
archive. Lines without an entry show "no source photo listed". Prints the
PDF's path and page count.
"""

import argparse
import hashlib
import json
import sys
import textwrap
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageDraw, ImageFont

BG, INK, MUTED = (250, 250, 248), (25, 25, 25), (110, 110, 110)
SRC_C, IMG_C, STK_C, MISS_C = (90, 90, 90), (200, 120, 0), (0, 120, 200), (200, 0, 0)
WEB_C, SERVER_C = (150, 50, 170), (0, 125, 130)
NEW_C, OLD_C, SKIP_C, REVIEW_C = (30, 140, 60), (0, 125, 130), (200, 0, 0), (190, 140, 0)
ROW, HEAD, TXT_W, PLAN_LINE = 300, 170, 560, 24
TOP, BOTTOM = 110, 30  # page header and bottom margin, in pixels
DPI = 240  # 2000 px wide prints at about A4 width
MAX_STOCK_SHOWN = 5
WEB_CACHE = Path(".web-cache")  # set under OUT_DIR by main()


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


def is_url(s):
    return str(s).startswith(("http://", "https://"))


def fetch(url):
    """Download a web image once into the cache; the cached path, or None."""
    dest = WEB_CACHE / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".img")
    if not dest.exists():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            WEB_CACHE.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        except (OSError, ValueError):
            return None
    return dest


def load(path, h):
    """The image at path, or a red 'missing' tile when it cannot be read.

    None is fetch()'s failure value. A path of the wrong type is left to raise
    rather than being drawn as missing.
    """
    im = None
    if path is not None:
        try:
            im = Image.open(path).convert("RGB")
        except (OSError, ValueError):
            im = None
    if im is None:
        im = Image.new("RGB", (h, h), (255, 235, 235))
        d = ImageDraw.Draw(im)
        d.text((10, h // 2 - 10), "missing", fill=MISS_C, font=F_B)
        return im, False
    im.thumbnail((int(h * 1.6), h))
    return im, True


def band(im, text, colour):
    """Overlay a solid band across the bottom of an image, with white text."""
    d = ImageDraw.Draw(im)
    lines = [ascii_safe(t) for t in text.split("\n")]
    bh = 6 + 18 * len(lines)
    d.rectangle((0, im.height - bh, im.width, im.height), fill=colour)
    for i, t in enumerate(lines):
        while len(t) > 4 and d.textlength(t, font=F_S) > im.width - 8:
            t = t[:-4] + "..."
        d.text((4, im.height - bh + 3 + 18 * i), t, fill=(255, 255, 255), font=F_S)
    d.rectangle((0, 0, im.width - 1, im.height - 1), outline=colour, width=4)


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


def pill(d, x, y, text, colour):
    """A filled badge; returns the x after it."""
    text = ascii_safe(text)
    w = d.textlength(text, font=F_B) + 16
    d.rounded_rectangle((x, y, x + w, y + 26), radius=6, fill=colour)
    d.text((x + 8, y + 4), text, fill=(255, 255, 255), font=F_B)
    return x + w + 10


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


def qty(n):
    return f"{n:g}" if isinstance(n, (int, float)) else str(n)


# ----------------------------------------------------------------- the plan
def part_plan(ls, plan):
    """What the plan says about one part: its lines' entries and the existing part."""
    entries = [plan[l["id"]] for l in ls if l["id"] in plan]
    existing = next((e["existing_part"] for e in entries if e.get("existing_part")), None)
    return entries, existing


def plan_lines(ls, plan):
    """The coloured text lines under a part's header that the plan adds."""
    if plan is None:
        return []
    entries, existing = part_plan(ls, plan)
    if not entries:
        return [("not in the plan - re-run import-stock --plan", MISS_C)]
    adding = sum(e.get("quantity") or 0 for e in entries if e.get("action") == "created")
    new_items = sum(1 for e in entries if e.get("action") == "created")
    out = []
    if existing:
        stock = existing.get("stock", [])
        have = sum(s.get("quantity") or 0 for s in stock)
        out.append((f"Already on the server: {qty(have)} pcs in {len(stock)} stock item(s)"
                    + (":" if stock else ""), OLD_C))
        for s in stock[:MAX_STOCK_SHOWN]:
            out.append((f"    stock #{s['pk']}   {qty(s.get('quantity'))} pcs   batch "
                        f"{s.get('batch') or '-'}   {s.get('packaging') or ''}   @ "
                        f"{s.get('location') or 'no location'}", OLD_C))
        if len(stock) > MAX_STOCK_SHOWN:
            out.append((f"    ... and {len(stock) - MAX_STOCK_SHOWN} more", OLD_C))
        out.append((f"After this import: {qty(have + adding)} pcs in "
                    f"{len(stock) + new_items} stock item(s)  (+{qty(adding)} pcs, "
                    f"+{new_items} item(s))", INK))
        e0 = entries[0]
        links = []
        for key, what in (("manufacturer_part", "manufacturer part"),
                          ("supplier_part", "supplier part")):
            rec = e0.get(key)
            if rec and rec.get("exists"):
                links.append(f"{what} #{rec['pk']} existing")
            elif e0.get("action") == "created":
                links.append(f"{what} new")
        if any(e.get("part_notes_kept") for e in entries):
            links.append("part notes: server's kept, file's not written")
        if links:
            out.append(("Links: " + ";  ".join(links), OLD_C))
        for e in entries:
            if e.get("name_kept"):
                out.append((f"Name kept - {e['name_kept']}", OLD_C))
                break
    elif any(e.get("action") == "created" for e in entries):
        links = ("its manufacturer and supplier parts" if ls[0].get("manufacturer")
                 else "its supplier part (no manufacturer)")
        out.append(("Not on the server: the import creates this part"
                    + (f" ({entries[0].get('ipn')})" if entries[0].get("ipn") else "")
                    + f", {links}, and "
                    + f"{new_items} stock item(s) of {qty(adding)} pcs", NEW_C))
    return out


def line_badge(entry):
    if entry is None:
        return None
    action = entry.get("action")
    if action == "created":
        return "+ NEW STOCK ITEM", NEW_C
    if action == "exists":
        item = entry.get("stock_item") or {}
        return f"= ALREADY IMPORTED (stock #{item.get('pk', '?')})", MUTED
    if action == "skipped":
        return "- SKIPPED", SKIP_C
    return "? NEEDS REVIEW", REVIEW_C


def location_text(l, entry):
    if entry is None:
        return f"location: {l.get('location') or 'none'}", MUTED
    loc = entry.get("location") or ""
    if not loc:
        return "location: none", MUTED
    if entry.get("new_location"):
        return f"location: {loc}  (NEW - created)", NEW_C
    existing = entry.get("existing_part") or {}
    here = [s for s in existing.get("stock", []) if s.get("location") == loc]
    if here:
        return (f"location: {loc}  (existing, beside "
                + ", ".join(f"#{s['pk']}" for s in here) + ")"), OLD_C
    return f"location: {loc}  (existing)", OLD_C


# ----------------------------------------------------------------- drawing
def part_image(c, d, l0, ls, base, plan, plan_dir, y):
    """The part image: the server's when it keeps its own, else the file's."""
    _, existing = part_plan(ls, plan or {})
    if existing and existing.get("has_image") and existing.get("image"):
        im, ok = load(plan_dir / existing["image"], 140)
        if ok:
            band(im, "ON SERVER\nkept", SERVER_C)
        colour = SERVER_C if ok else MISS_C
        label = "part image: on server (kept; file image not used)"
    elif is_url(l0.get("image", "")):
        site = urlparse(l0["image"]).netloc
        im, ok = load(fetch(l0["image"]), 140)
        if ok:
            band(im, f"WEB IMAGE\n{site}", WEB_C)
        colour, label = (WEB_C if ok else MISS_C), f"part image: web, {site}"
    elif l0.get("image"):
        im, ok = load(base / l0["image"], 140)
        colour, label = (IMG_C if ok else MISS_C), "part image: " + l0["image"].split("/")[-1]
    else:
        return 40, "part image: none", IMG_C
    c.paste(im, (24, y + 14))
    d.rectangle((22, y + 12, 25 + im.width, y + 15 + im.height), outline=colour, width=3)
    return 40 + im.width, label, colour


def section_height(ls, plan):
    return HEAD + PLAN_LINE * len(plan_lines(ls, plan)) + ROW * len(ls)


def section(c, d, y, key, ls, base, sources, width, plan, plan_dir):
    """Draw one part and its lines from y; return the y below it."""
    l0 = ls[0]
    d.line((20, y, width - 20, y), fill=(180, 180, 180), width=2)
    hx, img_label, img_colour = part_image(c, d, l0, ls, base, plan, plan_dir, y)
    kind = "IPN" if l0.get("ipn") else "MPN" if l0.get("mpn") else "type" if l0.get("type") else "part"
    maker = l0.get("manufacturer") or "(no manufacturer)"
    number = l0.get("mpn") or l0.get("type") or key
    label = (f"{l0['name']}  ({kind} {number})"
             if l0.get("name") and l0["name"] != number else f"{kind} {number}")
    tx = hx
    if plan is not None:
        _, existing = part_plan(ls, plan)
        tx = (pill(d, hx, y + 14, f"EXISTING PART {existing.get('ipn') or ''} #{existing['pk']}",
                   OLD_C) if existing else pill(d, hx, y + 14, "NEW PART", NEW_C))
    d.text((tx, y + 16), ascii_safe(f"PART {label}  -  {maker}"), fill=INK, font=F_H2)
    d.text((hx, y + 48), ascii_safe(
        f"{l0.get('category', '?')}   |   {len(ls)} stock item(s), "
        f"{sum(l.get('quantity', 0) for l in ls)} pcs in this import"), fill=MUTED, font=F_B)
    d.text((hx, y + 74), ascii_safe(textwrap.shorten(l0.get("description", ""), 150)),
           fill=MUTED, font=F_S)
    d.text((hx, y + 98), ascii_safe(img_label), fill=img_colour, font=F_S)
    py = y + 126
    for text, colour in plan_lines(ls, plan):
        d.text((hx, py), ascii_safe(text), fill=colour, font=F_B)
        py += PLAN_LINE
    y = py + (HEAD - 126)
    for l in ls:
        entry = (plan or {}).get(l["id"])
        approx = "  (approx.)" if l.get("approximate") else ""
        head = f"{l['id']}   qty {l.get('quantity', '?')}{approx}"
        if entry and entry.get("part_of"):
            head += f"   same part as {entry['part_of']}"
        d.text((40, y + 6), ascii_safe(head), fill=INK, font=F_H2)
        badge = line_badge(entry)
        if badge:
            pill(d, 40 + d.textlength(ascii_safe(head), font=F_H2) + 14, y + 4, *badge)
        rows = [(f"batch: {l.get('batch', '-')}", INK),
                (f"packaging: {l.get('packaging', '-')}", INK),
                location_text(l, entry),
                (f"condition: {l.get('condition') or '-'}", MUTED),
                (f"confidence: {l.get('confidence', '-')}"
                 + ("  NEEDS REVIEW" if l.get("needs_review") else ""), MUTED)]
        if (l.get("manufacturer"), l.get("mpn")) != (l0.get("manufacturer"), l0.get("mpn")):
            rows.insert(0, (f"lot marked: {l.get('manufacturer') or 'no maker'} "
                            f"{l.get('mpn') or ''}".rstrip(), INK))
        if entry and entry.get("reason"):
            rows.append((f"why: {entry['reason']}", SKIP_C))
        for i, (t, col) in enumerate(rows):
            for j, w in enumerate(textwrap.wrap(ascii_safe(t), 52)[:2]):
                d.text((40, y + 40 + i * 42 + j * 19), w, fill=col, font=F_B)
        x, h = TXT_W, ROW - 50
        srcs = sources.get(l["id"], [])
        # shrink a crowded row so every image fits within the page
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
    return y


def paginate(sections, height):
    """Group (key, height) sections into pages; a section is never split."""
    room = height - TOP - BOTTOM
    pages, cur, used = [], [], 0
    for key, need in sections:
        if cur and used + need > room:
            pages.append(cur)
            cur, used = [], 0
        cur.append(key)
        used += need
    if cur:
        pages.append(cur)
    return pages


def fit(d, text, width, f):
    """Shorten text with '...' until it fits within width pixels."""
    text = ascii_safe(text)
    if d.textlength(text, font=f) <= width:
        return text
    while len(text) > 4 and d.textlength(text + "...", font=f) > width:
        text = text[:-1]
    return text + "..."


def page(title, note, width, height):
    c = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(c)
    d.text((24, 20), fit(d, title, width - 48, F_H1), fill=INK, font=F_H1)
    d.text((24, 62), fit(d, note, width - 48, F_B), fill=MUTED, font=F_B)
    return c, d


def plan_summary(lines, plan):
    if plan is None:
        return "NO PLAN - relations to existing server records are not shown"
    entries = [plan[l["id"]] for l in lines if l["id"] in plan]
    joins = sum(1 for e in entries if e.get("existing_part") and e.get("action") == "created")
    count = {a: sum(1 for e in entries if e.get("action") == a)
             for a in ("created", "exists", "skipped", "review")}
    return (f"plan: {count['created']} new stock item(s) ({joins} on existing parts), "
            f"{count['exists']} already imported, {count['skipped']} skipped, "
            f"{count['review']} need review")


def location_pages(lines, title, base, sources, width, plan, plan_dir):
    """Pages for one stock location, each with its own header."""
    parts = {}
    for l in lines:
        parts.setdefault(part_key(l), []).append(l)
    height = round(width * 2 ** 0.5)
    nsns = sorted({t[4:] for l in lines for t in l.get("tags", []) if t.startswith("nsn:")})
    summary = (f"{len(lines)} lines, {sum(l.get('quantity', 0) for l in lines)} pieces"
               + (f", {len(nsns)} NSN(s)" if len(nsns) > 3 else
                  f"  -  NSN {', '.join(nsns)}" if nsns else ""))
    legend = ("frames: grey source photo, orange part image, blue stock image, "
              "purple web image, teal server image")
    heights = {k: section_height(ls, plan) for k, ls in parts.items()}
    groups = paginate(list(heights.items()), height)
    out = []
    for n, group in enumerate(groups, 1):
        need = TOP + BOTTOM + sum(heights[k] for k in group)
        first = summary if n == 1 else f"continued ({n}/{len(groups)})"
        c, d = page(f"{title}   [{n}/{len(groups)}]" if len(groups) > 1 else title,
                    f"{plan_summary(lines, plan)}   |   {first}", width, max(height, need))
        d.text((24, 86), ascii_safe(legend), fill=MUTED, font=F_S)
        y = TOP
        for key in group:
            y = section(c, d, y, key, parts[key], base, sources, width, plan, plan_dir)
        out.append(c)
    return out


def main():
    global WEB_CACHE
    ap = argparse.ArgumentParser()
    ap.add_argument("import_file")
    ap.add_argument("out_dir")
    ap.add_argument("--plan", help="JSON from `invimport import-stock FILE --plan PLAN.json`")
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
    plan, plan_dir = None, base
    if a.plan:
        pp = Path(a.plan).resolve()
        raw = json.loads(pp.read_text())
        if isinstance(raw, list):
            raw = next((p for p in raw if Path(p.get("file", "")).name == imp.name), raw[0])
        plan, plan_dir = {e["id"]: e for e in raw.get("lines", [])}, pp.parent
    else:
        print("no --plan given; the montage will not show how lines relate "
              "to existing server records", file=sys.stderr)
    out_dir = Path(a.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    WEB_CACHE = out_dir / ".web-cache"

    groups = {}
    for l in flat_lines(doc):
        groups.setdefault(l.get("location") or "", []).append(l)
    stem = imp.stem
    pages = []
    for loc, ls in groups.items():
        title = f"{stem}  -  location '{loc}'" if loc else f"{stem}  -  no location"
        pages += location_pages(ls, title, base, sources, a.width, plan, plan_dir)
    out = out_dir / f"{stem}.pdf"
    if not pages:
        print(f"{imp.name} has no lines; no montage written", file=sys.stderr)
        return
    pages[0].save(out, "PDF", save_all=True, append_images=pages[1:], resolution=DPI)
    print(out, f"{len(pages)} page(s)")


if __name__ == "__main__":
    main()
