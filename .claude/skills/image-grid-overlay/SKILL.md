---
name: image-grid-overlay
description: Overlay a labelled pixel grid on a photo (labels always in source pixels, legible on foil and glare), zoom into a region for exact edges, and draw proposed crop boxes with centre crosshairs and margin readouts to an object's bounds - so coordinates can be read off by eye and a crop checked for clipping and centring before it is made. Use whenever you need pixel positions in an image - drawing crop ROIs, locating a label or component, checking a box is centred - rather than guessing fractions of the frame.
---

# Image grid overlay

Reading positions off a plain photo by eye is guesswork: a "two-thirds across"
estimate is routinely 100 px out, and the error only shows once the crop is
made. A grid with coordinate labels turns the photo into something you can
read numbers off, and drawing the box you intend to use over it shows you the
crop before you make it.

One script does it. Run it from the repo root (Pillow comes in with `--with`;
nothing is installed):

```bash
G=.claude/skills/image-grid-overlay/scripts/grid.py
uv run -q --with pillow python $G SRC OUT.png [--region X0 Y0 X1 Y1] [--width N] [--step N] \
    [--object X0 Y0 X1 Y1] [--box X0 Y0 X1 Y1 [NAME]] ...
```

`grid.py --help` documents every option. Write the previews to the scratch
directory you were given, never into the repo or `/tmp`. `--quiet` prints only
the box lines, for checking many crops in a loop. In zsh, a variable holding
four coordinates must be split explicitly: `--object ${=OBJ}`, not `$OBJ`.

**Every number on the grid is a source pixel**, whatever the preview's scale
or zoom, so a value read off it goes straight into a crop command. Never
convert by hand.

## The loop

1. **Overview.** Grid the whole photo (`grid.py SRC OUT.png`) and look at it.
   Note roughly where each item, and everything that must stay out (tags,
   hands, neighbours, other lots), lies.
2. **Zoom for edges.** For each item, grid just that area with `--region`,
   with some room around it. The grid gets finer and the edges become
   readable to ~10 px. Read the item's bounds: the outer edge of the pouch,
   the lead tips, the label's corners.
3. **Draw the box before cropping.** Pass the item's bounds as `--object` and
   your intended crop as `--box` (several boxes, for alternatives). Each box
   gets a centre crosshair, and the script prints its size, aspect and its
   left/right/top/bottom margins to the object. It flags `OFF-CENTRE` when
   opposite margins differ by more than 15% of the larger one (and by more
   than 10 px), and
   `CLIPS THE OBJECT` when a margin is negative (exit codes 1 and 2).
4. **Adjust and redraw** until the box is centred and contains nothing that
   must stay out, then make the crop with those numbers.

```bash
# overview, then zoom on one bag and test two candidate crops
uv run -q --with pillow python $G photo.png $T/g-photo.png
uv run -q --with pillow python $G photo.png $T/g-bag.png --region 200 150 1250 1400 \
    --object 275 240 1150 1255 --box 225 195 1200 1300 even --box 200 200 1260 1260 square
```

## Reading it well

- The default grid aims for 15-20 lines across a `--region` zoom and is
  coarser on a whole-photo overview; heavy lines mark every fifth. Use `--step` for a particular spacing, e.g. `--step 10` on a
  tight zoom of a chip's leads.
- Labels sit on white chips at the top and left edges and are drawn after the
  lines, so they stay readable on foil, glare and print. When the grid is
  dense, every other line is labelled; count from a labelled one.
- Look at the zoom, not the overview, for any edge that matters. The overview
  is for layout.
- A box can be centred on the object and still take in something unwanted
  (a neighbouring label just below a pouch). The grid shows it: look at what
  lies inside the box, not only at the margins.
- **Read edges by eye off a zoomed grid; do not trust automatic bounds.**
  Foil throws a light halo onto the table and shadows look like edges, so
  colour- or texture-based detection over-grows a box. Smooth paper and labels
  have little texture, so texture-based detection under-grows it. Errors of
  50-150 px have been seen both ways. A 0.5-scale overview with 100 px lines is
  good only to about +/-30 px, which is enough for layout but not for edges.
