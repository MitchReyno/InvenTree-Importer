"""Build agent-oriented logo pages + index from annotations.
usage: build.py ann.tsv rows.json logos_dir out_dir"""
import csv, json, os, sys
from PIL import Image, ImageDraw, ImageFont
ann_f, rows_f, logodir, out = sys.argv[1:5]
names = {i.split("/")[-1].rsplit(".", 1)[0]: (r["name"], i.split("/")[-1]) for r in json.load(open(rows_f)) for i in r["imgs"]}
ann = list(csv.DictReader(open(ann_f), delimiter="\t", quoting=csv.QUOTE_NONE))
FAM = [  # order = page order; symbol families first, wordmarks last
    ("mono", "Letter monograms (stylised letters/digits, no full name)"),
    ("circ", "Circles, rings, globes and round emblems"),
    ("quad", "Squares, diamonds, boxes and polygons"),
    ("tri", "Triangles, mountains, V and arrow shapes"),
    ("stripe", "Striped / line-built marks"),
    ("pict", "Pictorial and abstract symbols"),
    ("text", "Wordmarks (readable name text)"),
]
fam_of = lambda a: "pict" if a["family"] == "abstr" else a["family"]
C, R, CW, CH, LOGO_H, HDR = 6, 5, 256, 152, 100, 44
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"; BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
f_id, f_nm, f_h = ImageFont.truetype(BOLD, 17), ImageFont.truetype(FONT, 16), ImageFont.truetype(BOLD, 22)
os.makedirs(os.path.join(out, "pages"), exist_ok=True)
for f in os.listdir(os.path.join(out, "pages")): os.remove(os.path.join(out, "pages", f))

def fit(d, s, font, w):
    while d.textlength(s, font=font) > w: s = s[:-2] + "…"
    return s

index, pageno = [], 0
for fam, title in FAM:
    group = sorted((a for a in ann if fam_of(a) == fam), key=lambda a: (a["text"].upper().lstrip("∫"), a["id"]))
    chunks = [group[i:i + C * R] for i in range(0, len(group), C * R)]
    for ci, chunk in enumerate(chunks):
        pageno += 1
        fn = f"p{pageno:02d}-{fam}-{ci + 1}.png"
        img = Image.new("RGB", (C * CW + 8, HDR + R * CH + 4), (24, 24, 28)); d = ImageDraw.Draw(img)
        d.text((10, 10), f"Page {pageno:02d} · {title} ({ci + 1}/{len(chunks)})", font=f_h, fill=(255, 170, 60))
        for n, a in enumerate(chunk):
            name, gif = names[a["id"]]
            x, y = 4 + (n % C) * CW, HDR + (n // C) * CH
            d.rectangle((x, y, x + CW - 4, y + CH - 4), fill=(0, 0, 0), outline=(70, 70, 70))
            im = Image.open(os.path.join(logodir, gif)).convert("RGB")
            s = min(4, (CW - 16) / im.width, LOGO_H / im.height)
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
            img.paste(im, (x + (CW - 4 - im.width) // 2, y + 4 + (LOGO_H - im.height) // 2))
            d.text((x + 6, y + LOGO_H + 8), fit(d, a["id"], f_id, CW - 16), font=f_id, fill=(255, 210, 0))
            d.text((x + 6, y + LOGO_H + 27), fit(d, name, f_nm, CW - 16), font=f_nm, fill=(235, 235, 235))
            index.append({"id": a["id"], "manufacturer": name, "kind": {"W": "wordmark", "S": "symbol", "C": "symbol+text"}[a["kind"]],
                          "family": fam, "text": a["text"], "description": a["shape"], "page": fn, "file": f"logos/{gif}"})
        img.save(os.path.join(out, "pages", fn), optimize=True)
json.dump(index, open(os.path.join(out, "index.json"), "w"), indent=1, ensure_ascii=False)
with open(os.path.join(out, "index.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(index[0])); w.writeheader(); w.writerows(index)
# markdown index grouped by page
md = []
for fam, title in FAM:
    md.append(f"\n## {title} (`{fam}`)\n\n| id | manufacturer | kind | text | description | page |\n|---|---|---|---|---|---|")
    md += [f"| {e['id']} | {e['manufacturer']} | {e['kind']} | {e['text']} | {e['description']} | {e['page']} |".replace("\\", "\\\\") for e in index if e["family"] == fam]
open(os.path.join(out, "index_table.md"), "w").write("\n".join(md).lstrip() + "\n")
print(pageno, "pages,", len(index), "logos")
