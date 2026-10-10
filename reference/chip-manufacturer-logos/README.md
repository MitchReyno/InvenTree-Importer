# Chip manufacturer logo reference

483 manufacturer logos (403 manufacturers) as they appear **marked on IC packages**,
from plasma-online.de "identify by picture – by manufacturer logo on chip"
(<http://www.plasma-online.de/english/identify/picture/index_logochip.html>, downloaded 2026-10-08).
The set dates from the 1990s–2000s: it covers classic manufacturers well, but has no
newer logos (e.g. GigaDevice, WCH, Espressif) and no post-rebrand variants.

## How an agent should identify a manufacturer from an IC photo

1. **Read any text in the logo first.** If the mark contains letters (e.g. "ST", "AMI", "ON"),
   grep `index.csv` on the `text` and `description` columns:
   `grep -i ',ST,' index.csv` or `grep -i 'triangle' index.csv`.
   162 logos are plain wordmarks, so the text alone usually settles it.
2. **For symbol-only marks, get a shortlist by shape.** Crop the photo tightly to the logo only
   (no part number) and run
   `python3 -I reference/chip-manufacturer-logos/match.py crop.png --top 15 --sheet /tmp/candidates.png`.
   It handles either polarity (laser-etched, printed, light or dark), so you don't have to clean the
   image first. Then **view the candidate sheet** and confirm by eye. The scores are a ranking, not proof.
3. **Browse the right page.** Every page is ≤1544×808 px, so vision models see it without downscaling.
   Pages are grouped by **what the logo looks like**, not by name, and sorted by the letter/text it
   resembles within each group:

| pages | family | contents |
|---|---|---|
| p01–p04 | `mono` | stylised letters / digits / monograms (A…Z, then symbols like Σ, ∫) |
| p05–p07 | `circ` | circles, rings, globes, round emblems (Motorola, Microchip, Hitachi, AT&T…) |
| p08–p09 | `quad` | squares, diamonds, boxes, polygons (AMD, Analog Devices, Burr-Brown, Micronas…) |
| p10 | `tri` | triangles, mountains, V / arrow shapes |
| p11 | `stripe` | striped or line-built marks (IBM-style stripes, NS, Cirrus) |
| p12–p13 | `pict` | pictorial / abstract (Texas outline, cherries, rabbit, crab, trees…) |
| p14–p19 | `text` | readable wordmarks, A→Z |

   Each cell shows the logo, its **id** (yellow) and the manufacturer. Logos with a symbol *and* text
   (`kind = symbol+text`) are filed under their symbol's family.

4. Report the match with the id, e.g. "logo matches `motorola2` (Motorola)". If nothing matches
   closely, say so rather than forcing the nearest candidate.

## Known look-alikes (check carefully)

- `dtc1` (DTC Data Technology) vs `sierra` (Sierra Semiconductor): dashed circle with radiating bars
- `motorola1` / `motorola2` vs `msystems`, `micronix`: M shapes
- `analog1` / `analog2` (Analog Devices) vs `rectron`, `goodark`: triangle-in-square
- `ti1` / `ti2` (Texas Instruments): Texas outline, unique but often crudely etched
- `sanken1` (SK) vs `sanken2`; `nec1` / `nec2`; `zilog1`…`zilog5`: same maker, several variants

## Files

| file | purpose |
|---|---|
| `pages/*.png` | 19 agent-sized grid pages grouped by visual family |
| `index.csv` / `index.json` | one row per logo: id, manufacturer, kind, family, text, description, page, file |
| `index_table.md` | same index as Markdown tables, by family |
| `logos/*.gif` | original logo images (id = filename stem) |
| `match.py` | shortlists likely logos for a cropped photo (numpy + Pillow) |
| `annotations.tsv` | hand-written source annotations (kind/family/text/description) |
| `build.py`, `parse.py`, `rows.json` | rebuild pages and index: `python3 -I build.py annotations.tsv rows.json logos .` |

The matcher was tested on all 483 logos after synthetic degradation (5× upscale, ±4° rotation,
blur, low contrast, noise, JPEG, half with inverted polarity). The correct logo ranked first for
95%, in the top 5 for 99% and in the top 15 for 99.8%. Real photos will do worse, so always confirm by eye.
