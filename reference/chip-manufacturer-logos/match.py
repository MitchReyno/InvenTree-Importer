"""Rank reference logos by visual similarity to a cropped photo of an IC marking.

usage: python3 match.py CROP.png [--top N] [--sheet OUT.png]

CROP should be tightly cropped to the logo only (no part number text).
Polarity (light-on-dark vs dark-on-light) and size are normalised, so laser-etched,
printed or inverted marks all work. Output is a SHORTLIST - confirm by eye on the
--sheet image or the referenced page before trusting a match.
"""
import argparse, json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
S = 48

def otsu(a):
    h, _ = np.histogram(a, 256, (0, 256)); p = h / h.sum(); w = np.cumsum(p); m = np.cumsum(p * np.arange(256))
    with np.errstate(divide="ignore", invalid="ignore"):
        v = (m[-1] * w - m) ** 2 / (w * (1 - w))
    return int(np.nanargmax(v))

def masks(im):
    """Return candidate binary masks (foreground=True), one per polarity."""
    g = ImageOps.autocontrast(im.convert("L"), cutoff=1)
    g = g.resize((max(1, g.width * 2), max(1, g.height * 2)), Image.LANCZOS) if max(g.size) < 60 else g
    a = np.asarray(g, dtype=np.uint8); t = otsu(a)
    return [a > t, a <= t]

def feature(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) < 4: return None, 1.0
    r = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = r.shape; side = max(h, w)
    c = np.zeros((side, side), bool); c[(side - h) // 2:(side - h) // 2 + h, (side - w) // 2:(side - w) // 2 + w] = r
    im = Image.fromarray((c * 255).astype(np.uint8)).resize((S, S), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.2))
    v = np.asarray(im, float).ravel(); v -= v.mean(); n = np.linalg.norm(v)
    return (v / n if n else v), w / h

def ref_features(index):
    out = []
    for e in index:
        m = masks(Image.open(os.path.join(HERE, e["file"])).convert("RGB"))[0]  # refs are light-on-dark
        f, ar = feature(m)
        out.append((e, f, ar))
    return out

def rank(query_path, top):
    index = json.load(open(os.path.join(HERE, "index.json")))
    refs = [r for r in ref_features(index) if r[1] is not None]
    qs = [feature(m) for m in masks(Image.open(query_path).convert("RGB"))]
    scored = []
    for e, f, ar in refs:
        best = -1
        for qf, qar in qs:
            if qf is None: continue
            arp = min(qar, ar) / max(qar, ar)            # aspect-ratio agreement, 0..1
            best = max(best, float(qf @ f) * (0.6 + 0.4 * arp))
        scored.append((best, e))
    scored.sort(key=lambda t: -t[0])
    return scored[:top]

def sheet(query_path, results, out):
    f = ImageFont.load_default(size=15) if hasattr(ImageFont, "load_default") else None
    CW, CH, cols = 250, 140, 4
    rows = -(-(len(results) + 1) // cols)
    img = Image.new("RGB", (cols * CW, rows * CH), (24, 24, 28)); d = ImageDraw.Draw(img)
    tiles = [(Image.open(query_path).convert("RGB"), "QUERY", "")] + \
            [(Image.open(os.path.join(HERE, e["file"])).convert("RGB"), f"#{i+1} {e['id']} ({s:.2f})", e["manufacturer"]) for i, (s, e) in enumerate(results)]
    for n, (im, a, b) in enumerate(tiles):
        x, y = (n % cols) * CW, (n // cols) * CH
        sc = min(4, (CW - 12) / im.width, 95 / im.height)
        im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
        d.rectangle((x + 2, y + 2, x + CW - 2, y + CH - 2), fill=(0, 0, 0), outline=(255, 170, 60) if n == 0 else (70, 70, 70))
        img.paste(im, (x + (CW - im.width) // 2, y + 5 + (95 - im.height) // 2))
        d.text((x + 6, y + 102), a, font=f, fill=(255, 210, 0)); d.text((x + 6, y + 119), b[:30], font=f, fill=(235, 235, 235))
    img.save(out)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("crop"); ap.add_argument("--top", type=int, default=15); ap.add_argument("--sheet")
    a = ap.parse_args()
    res = rank(a.crop, a.top)
    for i, (s, e) in enumerate(res, 1):
        print(f"{i:2d}. {s:.3f}  {e['id']:<16} {e['manufacturer']:<40} [{e['family']}] {e['page']}")
    if a.sheet: sheet(a.crop, res, a.sheet); print("sheet:", a.sheet)
