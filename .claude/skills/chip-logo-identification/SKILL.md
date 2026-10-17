---
name: chip-logo-identification
description: Identify the manufacturer from the maker's mark on an IC package - laser-etched, printed, worn, symbol-only or look-alike logos - using a reference set of 483 chip logos (403 manufacturers, 1990s-2000s) with a text index, shape-grouped grid pages and a shape matcher that shortlists candidates from a cropped photo. Use whenever a chip's maker cannot be read from its marking - a logo with no text, an unfamiliar or vintage maker nobody recognises, a mark that resembles several makers' - or when a manufacturer taken from a photo must be confirmed before it goes into a stock import.
---

# Chip logo identification

The maker's mark on an IC is often the only thing that names the manufacturer,
and it is the part of the marking hardest to read: a symbol with no text,
laser-etched at low contrast, worn, or drawn so like another maker's that the
two are confused. A wrong maker propagates into the part, the manufacturer
part and every search that follows, so identify it from evidence, not from a
resemblance.

This skill holds 483 logos (403 manufacturers) **as they appear marked on IC
packages**, taken from plasma-online.de's "identify by picture - by
manufacturer logo on chip"
(<http://www.plasma-online.de/english/identify/picture/index_logochip.html>,
downloaded 2026-10-08), with an index, grid pages grouped by shape, and a
matcher. Paths below are relative to this skill's folder,
`.claude/skills/chip-logo-identification/`.

## Tooling

Run everything from the repo root. numpy is not in the project environment,
so bring it (and Pillow) in with `--with`; nothing is installed:

```bash
D=.claude/skills/chip-logo-identification
uv run -q --with numpy --with pillow python -I $D/scripts/match.py CROP.png [--top N] [--sheet OUT.png]
uv run -q --with numpy --with pillow python -I $D/scripts/straighten.py SRC OUT [--quarter N] [--level X1,Y1,X2,Y2 | --rotate DEG | --corners TL TR BR BL]
```

Write crops and candidate sheets to the scratch directory you were given, or
to `.temp/<task>/` at the repo root (e.g. `.temp/<import id>/logo-id/`), never
to `/tmp`, the repo proper, this skill's folder or `.local_imports/`. A crop
made only to identify a logo is scratch, not an image for the import.

## The procedure

1. **Read the text in the mark first.** Many marks contain letters ("ST",
   "AMI", "ON", a stylised "M"), and 162 logos are plain wordmarks, so the
   text alone usually settles it. Grep the index on the `text` and
   `description` columns:

   ```bash
   grep -i ',ST,' $D/data/index.csv
   grep -i 'triangle' $D/data/index.csv
   ```

   The descriptions are plain English shapes ("dashed circle with radiating
   bars", "Texas outline"), so grep for what you see as well as what you read.
2. **For symbol-only marks, shortlist by shape.** Work on the photo with the
   `image-grid-overlay` skill so every coordinate is measured, not guessed.

   **a. Decide whether the mark needs straightening - usually it does not.**
   The matcher normalises polarity and size but not orientation or
   perspective: it was tested to ±4° of tilt, and a mark turned further, or
   photographed at an angle so its box is a trapezoid, ranks the right logo
   far lower. (In tests, Motorola's mark ranked 4th rotated 25°, 13th turned
   sideways and 2nd keystoned; straightened, it ranked 1st in each.)
   Straighten only when:

   - the mark is **sideways or upside down** (the chip's text runs
     vertically, or reads upside down): `--quarter`, exact, no resampling;
   - it is **tilted more than about 3°**: `--level` on two points along a
     line that should be horizontal (the text baseline, the logo's frame,
     the package edge) - measure them, do not estimate the angle;
   - it is **foreshortened or skewed** (the package top was photographed at
     an angle, so its edges converge or lean): `--corners` on four corners of
     something truly rectangular - the package top, the logo's frame, a
     block of text - as top-left, top-right, bottom-right, bottom-left as it
     should read.

   Leave an upright, square-on mark alone and go to (b): every resample
   softens fine etched strokes, and the matcher already copes with a degree
   or two.

   To straighten, crop a **generous** region first - the mark plus the edge
   or text you will measure against - measure on it, then straighten:

   ```bash
   T=.temp/<task>
   CROP="uv run -q --with pillow --with numpy python .claude/skills/component-photo-crops/scripts/crop.py"
   S="uv run -q --with numpy --with pillow python -I $D/scripts/straighten.py"
   $CROP photo.jpg $T/region.png X0 Y0 X1 Y1 --exact --nosquare
   $S $T/region.png $T/upright.png --level 112,388,904,341                 # tilted
   $S $T/region.png $T/upright.png --quarter 1                             # sideways
   $S $T/region.png $T/upright.png --corners 80,60 940,110 910,700 50,640  # at an angle
   ```

   `--quarter` runs first, so for a sideways mark that is also tilted, run
   `--quarter` alone, measure on its output, then `--level` or `--corners`.
   `--aspect W:H` gives `--corners` the rectangle's true proportions when
   they are known. Look at the result: the mark should read upright, with
   its frame or text lines level and parallel. Straightening moves every
   coordinate, so overlay the grid again on `upright.png` before (b).

   **b. Crop tightly to the logo alone** - no part number, date code or
   package edge - from the photo, or from `upright.png` if you straightened,
   and run the matcher:

   ```bash
   $CROP photo.jpg $T/mark.png X0 Y0 X1 Y1 --exact --nosquare   # the ROI as drawn
   uv run -q --with numpy --with pillow python -I $D/scripts/match.py $T/mark.png --top 15 --sheet $T/candidates.png
   ```

   The matcher normalises polarity and size, so laser-etched, printed,
   light-on-dark and dark-on-light marks all work without cleaning the
   image first. It prints a ranked list (score, id, manufacturer, family,
   page) and draws the query beside the candidates on the sheet. **The
   scores are a ranking, not proof**; a close second can be the right
   answer.
3. **Confirm by eye.** Open the candidate sheet, then the page of the family
   the best candidates belong to, and compare the details the matcher cannot
   weigh: line counts, gaps, which way a stroke turns, what is filled and what
   is outline. Every page is at most 1544x808 px, so it is seen without
   downscaling. Pages are grouped by **what the logo looks like**, not by
   name, and within a family sorted by the letter or text it resembles:

   | pages | family | contents |
   |---|---|---|
   | p01-p04 | `mono` | stylised letters / digits / monograms (A...Z, then symbols like Σ, ∫) |
   | p05-p07 | `circ` | circles, rings, globes, round emblems (Motorola, Microchip, Hitachi, AT&T...) |
   | p08-p09 | `quad` | squares, diamonds, boxes, polygons (AMD, Analog Devices, Burr-Brown, Micronas...) |
   | p10 | `tri` | triangles, mountains, V / arrow shapes |
   | p11 | `stripe` | striped or line-built marks (IBM-style stripes, NS, Cirrus) |
   | p12-p13 | `pict` | pictorial / abstract (Texas outline, cherries, rabbit, crab, trees...) |
   | p14-p19 | `text` | readable wordmarks, A to Z |

   Each cell shows the logo, its **id** (yellow) and the manufacturer. Logos
   with a symbol *and* text (`kind` = `symbol+text`) are filed under their
   symbol's family. Browse the family page even when the matcher is
   confident: a symbol-only mark with no good match may still be there.
4. **Mind the look-alikes** (below). When the candidates include one, decide
   between them from the rest of the marking - the part-number prefix, the
   product line, the date code's era - and say which evidence decided it.
5. **Report the logo id**, e.g. "logo matches `motorola2` (Motorola)", with
   what it rested on (text read, matcher rank, the details compared). If
   nothing matches closely, **say that nothing matched**. Never force the
   nearest candidate: a set this old is missing many makers, and the nearest
   wrong logo still scores well.

## Known look-alikes

- `dtc1` (DTC Data Technology) vs `sierra` (Sierra Semiconductor): dashed
  circle with radiating bars. The two are near-identical, and the matcher
  ranks them within 0.01 of each other; the logo alone cannot separate them.
- `motorola1` / `motorola2` vs `msystems`, `micronix`: M shapes.
- `analog1` / `analog2` (Analog Devices) vs `rectron`, `goodark`:
  triangle-in-square.
- `ti1` / `ti2` (Texas Instruments): Texas outline, unique but often crudely
  etched.
- `sanken1` (SK) vs `sanken2`; `nec1` / `nec2`; `zilog1`...`zilog5`: the same
  maker in several variants. Any of them names the maker.

## When the set has no match

The set dates from the 1990s-2000s. It covers the classic manufacturers well,
but has **no newer makers** (e.g. GigaDevice, WCH, Espressif), **no
post-rebrand variants**, and a 1960s-70s chip may carry an earlier form of a
maker's logo than the one here. No close match means the maker is not covered, not that the nearest
candidate is right. Then:

- look for the maker's **data books** and catalogues (e.g. bitsavers) for the
  part-number prefix, and compare the logo printed in them;
- check **NSN/CAGE records**: for military or drawing-controlled stock, the
  NSN cross-reference names the makers, and their CAGE records give the
  company;
- **web-search the marking** (part number plus "logo" or the shape), and
  look at photos of the same part from known sources.

Report an identification made this way as **inferred**, with the evidence,
not as a logo match; snapshot any page relied on (`source-snapshots` skill).

## Matcher accuracy

The matcher was tested on all 483 logos after synthetic degradation (5x
upscale, +/-4 degree rotation, blur, low contrast, noise, JPEG, half with
inverted polarity). The correct logo ranked first for 95%, in the top 5 for
99% and in the top 15 for 99.8%. Real photos will do worse, so always confirm
by eye.

## Files

| file | purpose |
|---|---|
| `data/pages/*.png` | 19 agent-sized grid pages grouped by visual family |
| `data/index.csv` / `data/index.json` | one row per logo: id, manufacturer, kind, family, text, description, page, file |
| `data/index_table.md` | the same index as Markdown tables, by family |
| `data/logos/*.gif` | original logo images, white on black (id = filename stem) |
| `data/annotations.tsv` | hand-written annotations, one row per logo: `id`, `kind`, `family`, `text`, `shape` |
| `data/rows.json` | manufacturer name and logo files per source table row |
| `scripts/match.py` | shortlists likely logos for a cropped photo (numpy + Pillow) |
| `scripts/straighten.py` | turns, levels or flattens a tilted, sideways or foreshortened mark before matching |
| `scripts/build.py` | rebuilds the pages and the index from `annotations.tsv`, `rows.json` and `logos/` |
| `scripts/parse.py` | extracts `rows.json` from the saved plasma-online pages (not kept) |

## Adding a logo and rebuilding

1. Put the image in `data/logos/<id>.gif` (light logo on a black background,
   like the rest; the matcher assumes that polarity for references).
2. Add it to `data/rows.json`: append the path to an existing manufacturer's
   `imgs`, or add `{"page": "", "name": "<Manufacturer>", "imgs":
   ["logos/<id>.gif"]}`. Only the file name is used.
3. Add a tab-separated row to `data/annotations.tsv`: `id`, `kind` (`W`
   wordmark, `S` symbol, `C` symbol+text), `family` (`mono`, `circ`, `quad`,
   `tri`, `stripe`, `pict`, `abstr` (filed with `pict`) or `text`), the
   `text` it reads as or resembles (this sets its place in the family), and a
   plain-English `shape` description to grep for.
4. Rebuild into scratch, look at the changed page, then rebuild in place:

   ```bash
   uv run -q --with pillow python -I $D/scripts/build.py \
       $D/data/annotations.tsv $D/data/rows.json $D/data/logos .temp/<task>/logo-build
   uv run -q --with pillow python -I $D/scripts/build.py \
       $D/data/annotations.tsv $D/data/rows.json $D/data/logos $D/data
   ```

   `build.py` deletes everything in `<out>/pages/` before writing, and uses
   macOS Arial fonts. The page numbers after the new logo's family may shift;
   nothing refers to them except the index it rewrites.
5. Run `match.py` on a crop of the new logo to see that it ranks first.
