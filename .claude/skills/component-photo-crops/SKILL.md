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

1. Make a small labelled preview (or the montage of the sources) and read off
   approximate pixel positions — remember the preview's scale factor.
2. Draw each ROI generously around one item, and tightly against whatever must
   be excluded. Let `crop.py` find the item's edges inside it.
3. For special layouts:
   - **A collage** — several photos tiled into one image — splits on its white
     gutters, not at the midpoint. Panels are usually unequal; find the
     near-white columns and rows across the whole image and cut there.
   - **Loose components on a plain background** — one ROI per component; if
     they touch, the ROI boundary is the cut.
   - **Detection grabs too much** (a gradient, a shadow, the whole frame) —
     tighten the ROI, or give the box yourself with `--exact`.

## Prefer a square (1:1) crop

InvenTree shows part and stock images as square thumbnails, so a square crop
displays whole and consistently. Find the item's bounds first, then grow the
shorter side about the centre — taking the extra from plain background. Do not
force it: if squaring would pull a neighbouring component, a hand, a label,
tag or other unwanted content back into frame (a long axial part, a strip of
several pouches, a hand-held bag), keep the tighter non-square crop. Cutting
out what does not belong matters more than the aspect ratio. Never stretch, or
pad with a fake background, to reach 1:1.

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
neighbour or tag intruding, dead space, and the wrong item (the montage labels
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
