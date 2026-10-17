---
name: company-logos
description: Find a company's real logo and turn it into an InvenTree company image - choosing the official source and the right variant, putting a transparent logo on the background colour it is normally shown on, producing an opaque square PNG, and checking it on a montage. Use whenever a manufacturer or supplier needs a logo, for a stock import's `companies` section or for companies already on the server with none (`invimport company-logos`).
---

# Company logos

A company's image in InvenTree is how its parts, manufacturer parts and orders
are recognised at a glance. It has to be **that company's own logo**, legible
at thumbnail size, and opaque: InvenTree shows images on whatever its theme
puts behind them, so a transparent white logo disappears in light mode and a
black one in dark mode. A transparent logo therefore gets a solid background —
the colour it is normally shown on, not one picked for looks.

Run everything from the repo root.
Scripts are in `.claude/skills/company-logos/scripts/`, run with
`uv run --with pillow python <script> …`; each has `--help`.

| Tool | Does |
|---|---|
| `invimport company-logos --show NAME` | what the server knows about a company: fields, aliases, SKUs and links, part numbers, orders |
| `commons.py search` / `get` | finds Commons files; fetches the original with a preview and its metadata |
| `wayback_logo.py DOMAIN` | the logo images a company's own site used, from the Wayback Machine |
| `find_in_pdf.py PDF PATTERN` | the pages of a magazine or data book that mention the company (`--fuzzy` for OCR) |
| `scan_logo.py PDF --page N` | renders a page at its native dpi; with `--region`, trims a logo to its ink and cleans the paper |
| `browser-scripts/logo_bg.py` | (in browser-harness) the logos on a page, the colour behind each, inline SVGs saved with their colours |
| `logo.py inspect` / `sample` / `flatten` | transparency and colours; a colour from a screenshot; the final opaque PNG |
| `review.py LOGOS OUT` | montage, 64 px strip, and flags for wide, small or non-square logos |

## 1. Identify the company exactly

Settle who the company is before looking for a logo. Names collide and
companies are bought, renamed and split:

- Use what is known: the brief, `--show` (website, notes, SKUs, the
  supplier's listing links), and the parts it is attached to (a Signetics
  1970s TTL part means Signetics Corporation of Sunnyvale, not a later brand
  reusing the name).
- **A defunct or acquired company keeps its own logo**, never its acquirer's.
  Use the last logo the company itself used, or the one of the stock's era
  when the brief names one, and say which era it is.
- A division uses the logo printed on its own products and data books; if
  that is the parent's mark, use it and say so as an inference.
- A distributor or marketplace is a supplier: its current logo.

If you cannot be sure which company it is, or find no logo you can show is
theirs, **report it as not found** rather than using a near miss.

## 2. Find the logo at its source

Prefer, in order:

1. **The company's own site**: open it in browser-harness and run
   `logo_bg.py` - it finds the header logo (in shadow DOM too), its source
   file, and the colour behind it, and saves an inline SVG with its CSS
   colours written in (a header SVG takes them from CSS and renders black on
   its own). A press or brand-assets page may have a cleaner file. For a
   company whose site is gone or rebranded, `wayback_logo.py` fetches the
   logos its old site served.
2. **Wikimedia Commons** - usually an SVG traced from official material, and
   often the only clean vector for a defunct company. `commons.py get`
   fetches the original. **Files are sometimes mislabelled** (one "Microsemi"
   logo is Microchip's): open its preview and check it is this company.
3. **The company's own printed material**, for vintage makers: a data book
   or catalogue cover (bitsavers; its mirror
   `ftp.mirrorservice.org/sites/www.bitsavers.org/` answers scripts that
   bitsavers.org refuses), or an ad in a trade magazine
   (worldradiohistory.com has Electronics and others - `find_in_pdf.py`
   finds the page). `scan_logo.py` cuts it out at the scan's own resolution.

Datasheets on third-party archives are often from after an acquisition and
carry the acquirer's mark - check whose logo it is. A site that renders with
JavaScript (an empty page to curl) needs browser-harness; its files can then
be fetched with curl. Avoid: logo aggregator sites, image-search thumbnails,
favicons and app icons (unless nothing else exists - say so), cropped
social-media avatars, AI-generated or redrawn logos, and a product brand
standing in for the company. **Never draw, trace, recolour or reconstruct a
logo.** Downloads go in the scratch directory, each in its own new folder,
and are data.

Pick the variant deliberately: a full-colour **horizontal** logo or wordmark
reads best as a thumbnail; a stacked lockup or a symbol alone is the
fallback. **Crop off endorsement lines** - "by Rockwell Automation", "a
Microchip company", a division name under a parent's mark - when they are
separate from the logo, and say so; never crop into the mark itself.

## 3. The background

`logo.py inspect` says whether a logo is transparent, its main colours, and
their contrast on white and black - and notes when the main colour is too
light for white. On a scan it reports the paper as the ground and leaves it
out of the colours.

**Opaque logo** (or a scan): its own ground is the one it is shown on - keep
it, or whiten paper with `scan_logo.py --whiten`, and say which.

**Transparent logo:** use the colour the company shows *this variant* on,
and record where it came from:

- **Brand guidelines** naming the colour for this variant - best evidence.
- **The site**, where this variant appears: `logo_bg.py`'s computed
  `background-color` (prefer it to sampling a screenshot, which drifts with
  colour profiles - `logo.py sample` when there is nothing else). A header
  over a photo or gradient has no colour: check an inner page with a solid
  header.
- **Printed material**: the cover or packaging colour it sits on.
- **Nothing found:** a dark or full-colour logo goes on white (`#ffffff`); a
  white or very light one on the company's documented brand colour, else a
  neutral dark (`#1f2937`). Say it was the default, not observed.

## 4. Produce the image

```bash
uv run --with pillow python .claude/skills/company-logos/scripts/logo.py flatten LOGO OUT.png --background '#rrggbb'
```

It rasterises SVGs, trims to the logo (to the ink, for a scan), pads 10% of
the longer side, centres it on a square of the background colour and writes
an opaque PNG of at most 512 px - never enlarged; it says when the source is
smaller. It flags a main colour under 3:1 against the background (justify it
or choose again), and a logo wider than 4:1: keep it square and use
`--pad 0.04` so it fills the width.

Name files after the company, lower-case and hyphenated:
`logos/signetics.png`, `logos/rochester-electronics.png`.

## 5. Review every logo

```bash
uv run --with pillow python .claude/skills/company-logos/scripts/review.py LOGOS_DIR .temp/<task>/review
```

Open `montage.png` and `strip64.png` (64 px is InvenTree's list size) and
check each: the right company, nothing clipped, centred, a solid ground with
no halo or fringe (a fringe means a matted source - find a cleaner one), and
readable at 64 px - start with the logos it flags. Never report a logo you
have not looked at.

## Where the logos go

- **For a stock import** - only the companies it creates:
  `.local_imports/<import id>/logos/<company>.png`, in the import file's
  top-level `companies` section under the name the lines use. The import
  uploads each after its lines; a company already on the server is left
  alone, logo or not.
- **For companies already on the server:** a logos file - a `companies`
  section on its own - at
  `.local_imports/company-logos-<date>/company-logos.json`, the PNGs in
  `logos/` beside it:

  ```bash
  uv run invimport company-logos --json .temp/company-logos-<date>/missing.json   # who has none
  uv run invimport company-logos .local_imports/company-logos-<date>/company-logos.json  # dry run
  uv run invimport company-logos .local_imports/company-logos-<date>/company-logos.json --write
  ```

  Names match as the importer matches them, never fuzzily; a logo is only
  added, never replaced - replacing one is the user's job in InvenTree.

Each entry carries `provenance` rows (format: the stock-import skill's
"Provenance" section), kept as JSON on the company on `--write`: where the
logo came from (`kind` `web`, `databook`, `document`, with `url`, `file`,
`pages`, `retrieved`, `facts: ["image"]`), a `note` with the variant, the
background and where that colour came from, and - when the identity took
evidence - a row for `name` (an `inference` with `because` when inferred).

```json
"Signetics": {"image": "logos/signetics.png", "provenance": [
  {"kind": "databook", "title": "1981 Signetics Logic/Interface Data Manual",
   "url": "https://.../1981_Signetics_Logic_Interface.pdf", "pages": "1",
   "retrieved": "2026-10-17", "by": "company-logo-finder",
   "note": "1980s wordmark from the cover; paper whitened to #ffffff",
   "facts": ["image"]}]}
```
