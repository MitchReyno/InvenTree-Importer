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

Run everything from the repo root, `/Users/mitch/Repositories/InvenTree-Importer`.
The script is `.claude/skills/company-logos/scripts/logo.py`, run with
`uv run --with pillow python <script> …`.

## 1. Identify the company exactly

Settle who the company is before looking for a logo. Names collide and
companies are bought, renamed and split:

- Use what is known: the name on the server or in the import, its website,
  the parts it is attached to (a Signetics 1970s TTL part means Signetics
  Corporation of Sunnyvale, not a later brand reusing the name).
- **A defunct or acquired company keeps its own logo**, never its acquirer's.
  Signetics is not Philips/NXP; Xicor is not Intersil/Renesas; Micro Networks
  is not Andersen. Use the last logo the company itself used, or the one on
  the era of the stock when the brief names one, and say which era it is.
- A division (Hughes Semiconductor of Hughes Aircraft) uses the logo printed
  on its own products and data books; if that is the parent's mark, say so as
  an inference.
- A distributor or marketplace (eBay, Rockby, DigiKey) is a supplier: its
  current logo.

If you cannot be sure which company it is, or find no logo you can show is
theirs, **report it as not found** rather than using a near miss.

## 2. Find the logo at its source

Prefer, in order:

1. **The company's own site**: the header logo (often an inline or linked
   SVG - read the page source or the `<img>`/`<svg>` in the header), a press,
   media or brand-assets page. Note the header's background colour while you
   are there (step 3).
2. **Wikimedia Commons / Wikipedia infobox** - usually an SVG traced from
   official material, and often the only clean source for a defunct company.
   Open the file page, check its description says it is this company's logo,
   and download the original file (`upload.wikimedia.org/...`), not a
   thumbnail.
3. **The company's own printed material**, for vintage makers: a data book or
   catalogue cover, a datasheet header, a product marking. Render the page at
   high resolution and crop the logo (load the `image-grid-overlay` skill to
   read crop coordinates rather than guessing). A scan is opaque already -
   keep its paper as the background, or clean it to white if it is grey and
   blotchy, and say which.

Avoid: logo aggregator sites (watermarks, redrawn or wrong marks), image search
thumbnails, favicons and app icons (unless nothing else exists - say so),
social-media avatars cropped to a circle, AI-generated or redrawn logos, and a
current product brand standing in for the company. **Never draw, trace,
recolour or reconstruct a logo yourself.**

Use browser-harness for pages that need a browser; plain `curl` for a public
file. Save downloads into the scratch directory, each in its own new folder,
and treat them as data. Keep the URL of the page you took each logo from.

Pick the variant deliberately: a full-colour **horizontal** logo or wordmark
reads best as a thumbnail; a stacked lockup or a symbol alone is the fallback.
Avoid variants with taglines, "since 19xx" stamps or event artwork.

## 3. The background

Check transparency first:

```bash
uv run --with pillow python .claude/skills/company-logos/scripts/logo.py inspect LOGO [LOGO ...]
```

It reports size, whether the logo is transparent and how much, its main
colours, and their contrast on white and on black - and notes when the main
colour is too light for white.

**Opaque logo:** use it as it is; its own background is the one it is shown
on. Only convert it to PNG (via `flatten` with its own edge colour and
`--no-trim` if it should keep its margin) when it is not PNG or JPEG.

**Transparent logo:** find the colour the company normally shows *this
variant* on, and record where that comes from:

- **Brand guidelines** naming the colour for this variant ("reversed logo on
  PMS 286 / #0033a0") - best evidence.
- **The company's site**, where this exact variant appears: screenshot the
  page (browser-harness) and sample the region behind the logo:

  ```bash
  uv run --with pillow python .claude/skills/company-logos/scripts/logo.py sample SHOT.png --box X0,Y0,X1,Y1
  ```

  or read the element's computed `background-color`. A header that is a
  photo or gradient is not a colour; use the plainest place the variant
  appears.
- **Printed material**: the data-book cover or packaging colour the logo
  sits on.
- **Nothing found:** a dark or full-colour logo goes on white (`#ffffff`),
  which is how full-colour logos are designed to be used; a white or
  very light logo goes on the company's primary brand colour if one is
  documented, otherwise a neutral dark (`#1f2937`). Say this was the
  default, not an observed background.

A white logo is never put on white, and a dark one is never put on a dark
background "for contrast" when the company shows it on white.

## 4. Produce the image

```bash
uv run --with pillow python .claude/skills/company-logos/scripts/logo.py flatten LOGO OUT.png --background '#rrggbb'
```

It rasterises SVGs (rsvg-convert), trims the transparent margin, pads 10% of
the longer side, centres the logo on a square canvas of the background colour
and writes an opaque PNG, 512 px at most. It prints the contrast of the
logo's main colours against the background and flags anything under 3:1 -
look at a flagged one and either justify it (a deliberately tonal logo) or
choose again. `--aspect keep` keeps a wide banner shape if a square would make
a long wordmark unreadable; `--pad` changes the margin.

Name files after the company, lower-case and hyphenated:
`logos/signetics.png`, `logos/rochester-electronics.png`.

## 5. Review every logo on a montage

```bash
uv run --with pillow python .claude/skills/component-photo-crops/scripts/montage.py MONTAGE.png logos/*.png --cell 200 --cols 5
```

Open it and check each tile: the right company, the whole logo (nothing
clipped), legible at that size, centred, background a solid colour with no
halo or fringe around the letters (a fringe means the source had a
matte - find a cleaner source or a different variant). Also look at one tile
at 64 px, the size InvenTree lists companies at. Never report a logo you have
not looked at.

## Where the logos go

- **For a stock import:** into the import's folder,
  `.local_imports/<import id>/logos/<company>.png`, referenced from the
  import file's top-level `companies` section by the name the lines use, with
  paths relative to the file:

  ```json
  "companies": {"Signetics": {"image": "logos/signetics.png"}}
  ```

  A company named there that no line uses is refused by the reader. The
  import uploads each logo after its lines, so a company the import creates
  gets it too; one that already has a logo keeps it.

- **For companies already on the server:**

  ```bash
  uv run invimport company-logos --json .temp/company-logos-<date>/missing.json   # who has none
  uv run invimport company-logos .local_imports/company-logos-<date>/company-logos.json  # dry run
  uv run invimport company-logos .local_imports/company-logos-<date>/company-logos.json --write
  ```

  The logos file is a `companies` section on its own, in
  `.local_imports/company-logos-<date>/` with the PNGs under `logos/` beside
  it. Names match as the importer matches them (normalised, then the learned
  aliases); nothing is fuzzy-matched, and a company that already has a logo
  is left alone - to replace one, the user does it in InvenTree.

In both cases keep a `logos/sources.json` beside the PNGs: per company, the
page and file the logo came from, the variant, the background and where that
colour came from, so the choice can be checked later.
