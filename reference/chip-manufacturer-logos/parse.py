import re, json, sys, html, glob, os
d = sys.argv[1]
order = ["page.html"] + [f"page_{c}.html" for c in "abcdefghijklmnopqrstuvwxyz"]
rows = []
for f in order:
    t = open(os.path.join(d, f), encoding="latin-1").read()
    for tr in re.findall(r"<tr>(.*?)</tr>", t, re.S | re.I):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)
        if len(tds) < 2: continue
        imgs = re.findall(r'src="[./]*(bilder/identify/logo/chip/[^"]+)"', tds[0], re.I)
        if not imgs: continue
        name = html.unescape(re.sub(r"<[^>]+>", "", tds[1])).strip()
        name = re.sub(r"\s+", " ", name)
        rows.append({"page": f, "name": name, "imgs": imgs})
json.dump(rows, open(sys.argv[2], "w"), indent=1)
print(len(rows), sum(len(r["imgs"]) for r in rows))
