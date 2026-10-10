---
name: component-photo-crops
description: Crop photos of electronic components, their packets and labels into clean part and stock images - finding bounds by measurement rather than eyeballing, preferring square crops without pulling in unwanted content, keeping leads, reviewing every crop on a montage, and keeping the originals. Use whenever photos of components need to become product or stock images (e.g. for an InvenTree stock import), or existing crops need redoing.
---

# Component photo crops

Turn the user's photos of components — loose parts, sealed packets, tubes,
blister strips, labels — into images that show one thing clearly. These become
the part's picture and the stock items' photos in their inventory, so a crop
that clips the leads, shows a neighbour's corner or cuts a label in half is a
worse record than no crop at all.

Two scripts do the mechanical work; your job is choosing what each crop should
contain and checking that it does. Run them from the repo root with `uv run`
(Pillow and numpy come in with `--with`; nothing is installed):

```bash
S=.claude/skills/component-photo-crops/scripts
uv run --with pillow --with numpy python $S/crop.py SRC OUT X0 Y0 X1 Y1 [--margin F] [--exact] [--nosquare]
uv run --with pillow python $S/montage.py OUT.png IMG [IMG ...]
```

`crop.py --help` documents the options. In short: X0 Y0 X1 Y1 is a region of
interest (ROI) that contains the object and **excludes everything that must
not appear** — a neighbouring component, a hand, a price or count tag. Inside
it the script finds the object by texture and contrast, adds a margin, and
squares the box when the square still fits in the ROI; otherwise it grows the
short side as far as the ROI allows. It never pads or stretches.

zsh does not word-split variables, so wrap the command in a function
(`C() { uv run -q --with pillow --with numpy python $S/crop.py "$@"; }`)
rather than putting it in a variable.

## What to crop, and whether to

**Crop only when the photo needs it.** One component per photo, already framed
against a plain background with little empty space, can be used as it is.
Cropping earns its place when a photo holds several items, when the item is
small in a wide frame, or when a tag, hand, ruler or tray edge shares the
frame. Zooming in to *read* a marking is a different thing and always fine; it
does not have to become a stored image.

Typical outputs for one photo set:

- **The part image** — the component itself, markings readable, leads in. If
  only the packet was photographed, the packet is the best image there is;
  say so rather than presenting it as a device photo.
- **One stock image per batch** — the packet, tube or card of *that* lot, with
  its label (NSN, part number, contract, date code) legible, so stock items of
  one part can be told apart.
- **A group shot** — when several packets of one part are photographed
  together, a crop of the group, without the tray, tags or props.

Price, count and note tags (green stickers and the like) are the seller's or
the user's annotations, not part of the item: keep them out of the crop, but
read them and report what they say.

## Find the bounds, do not guess them

Fractions eyeballed off a full image are the most common way crops come out
wrong, and the error is invisible until you look at the result.

Measure on a grid with the **`image-grid-overlay` skill** (load it with the
Skill tool; its script is
`.claude/skills/image-grid-overlay/scripts/grid.py`). Its labels are in source
pixels at any zoom, so there is no scale factor to convert.

1. Grid the whole photo to see the layout: where each item is, and where the
   tags, hands and neighbours that must stay out are.
2. Zoom on each item (`--region`) and read its bounds off the finer grid.
3. Draw each ROI generously around one item, and tightly against whatever must
   be excluded. Let `crop.py` find the item's edges inside it. For an
   `--exact` crop, or to check a box before cropping, draw it over the grid
   with `--box`, giving the item's bounds as `--object`. The script prints the
   margins and flags a box that is off-centre or clips the item.
4. For special layouts:
   - **A collage** — several photos tiled into one image — splits on its white
     gutters, not at the midpoint. Panels are usually unequal; find the
     near-white columns and rows across the whole image and cut there.
   - **Loose components on a plain background** — one ROI per component; if
     they touch, the ROI boundary is the cut.
   - **Detection grabs too much** (a gradient, a shadow, the whole frame) —
     tighten the ROI, or give the box yourself with `--exact`. `crop.py`'s
     detector over-reaches on foil glare and shadows, and under-reaches on
     smooth paper. Always check its `box=(…)` against the edges you read off
     the zoomed grid (`grid.py --object … --box …`), and switch to `--exact`
     with your own measured bounds when they disagree.

## Prefer a square (1:1) crop

InvenTree shows part and stock images as square thumbnails, so a square crop
displays whole and consistently. Find the item's bounds first, then grow the
shorter side about the centre — taking the extra from plain background, equally
on both sides (see [Centre the subject](#centre-the-subject)). Do not
force it: if squaring would pull a neighbouring component, a hand, a label,
tag or other unwanted content back into frame (a long axial part, a strip of
several pouches, a hand-held bag), keep the tighter non-square crop. Cutting
out what does not belong matters more than the aspect ratio. Never stretch, or
pad with a fake background, to reach 1:1.

## Centre the subject

The subject sits in the middle of the frame: equal space left and right, and
top and bottom. A square bought by sliding the box to one side, leaving the
item hard against one edge with empty table on the other, is worse than a
centred crop slightly short of square. `crop.py` grows the box symmetrically
about the found object and never slides it. So when a crop comes out short of
square, the ROI is tight on one side. Widen it there if the extra area is
clean background; otherwise accept the centred non-square crop.

- The subject is the item, not the frame you happened to draw: a group of
  packets is centred as a group, and a pouch is centred on its edges, not on
  its label.
- `--exact` crops exactly the ROI you give, so centre that box yourself:
  measure the item's bounds and set equal margins on opposite sides. Check it
  with `grid.py --object … --box …` (image-grid-overlay), which prints the four
  margins and flags `OFF-CENTRE`.
- To check a finished crop's centring, draw the box `crop.py` printed
  (`box=(…)`) over the source with the item's bounds as `--object`.
- When an excluded neighbour or tag is close to the item on one side only, the
  margin on that side caps the margin on the other. Keep the crop tight and
  centred rather than lopsided.

## Keep the whole item

- **Include the leads.** A box on the body alone cuts the pins off, and a DIP
  with no legs is a worse picture than a stock photo. Raise `--margin`
  (0.12–0.15) for parts with leads, or extend the ROI well past the body.
- **Include the packet's edges and seal.** The seal state is part of the
  record (sealed / opened), so a crop of a pouch shows all four edges.
- **Keep labels whole.** A label cut mid-line loses the date code or contract
  number that tells two batches apart.

## Then look at every crop

Build a montage of all the crops and read it:

```bash
uv run --with pillow python $S/montage.py /path/to/tmp/review.png OUT1.jpg OUT2.jpg ...
```

Look for an item clipped at an edge (leads, pouch edges, label text), a
neighbour or tag intruding, dead space, a subject off-centre (more space on
one side than the other), and the wrong item (the montage labels
each file with its name and size). Fix the offenders and look again; a second
pass is normal. Never report a crop you have not looked at.

**A photo taken through a tube or bag stays soft.** Upscaling adds pixels, not
detail. Say so instead of presenting it as a good image; a fresh close-up is
the only fix, and the user can decide whether it is worth taking.

## Files

- Write crops as JPEG (quality 90, longest side ≤ 1600 px — the script does
  this) into the per-import folder the caller names, e.g.
  `.local_imports/photos/<import id>/`, named for the item and what it shows:
  `mn3001h-device.jpg`, `l35-mn3001h-bag-a-4-86.jpg`. The per-import folder
  stops two imports that both number from `l01` overwriting each other.
- **Keep the originals.** Copy each full-frame source photo into a `source/`
  subfolder of that folder, named for what it shows, before or alongside
  cropping. Session image paths (`/private/tmp/...`) disappear; the originals
  are what a later recrop starts from.
- When redoing crops, write the new file under the same name (change the
  extension only if the format changes) and tell the caller every path that
  changed, so references can be updated. Do not delete an original.

## Report

Return, for every output: its path, which source photo and ROI it came from,
its final size and aspect ratio, what it shows, and anything worth flagging —
non-square and why, soft or low-resolution, a label only partly legible, a tag
read (and what it says), an item you could not isolate. Include the montage
path. Do not edit stock files or upload anything; that is the caller's job.
