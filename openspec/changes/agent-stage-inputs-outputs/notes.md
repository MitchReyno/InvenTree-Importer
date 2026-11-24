# Implementation notes

In progress. Task 5 (PR-E1) adds recipe `/2` and the decoder operations behind `inspect_region`, `preview_images` and `match_logo`; nothing outside tests calls them yet. The other tasks are not started in this file's history.

## Changes to the plan

### Task 5 (PR-E1)

- **2026-11-25T11:05+11:00, task 5 (PR-E1):** the design said the montage is a `sharp` composite and the 6.9 MB logo set is bundled. The montage takes `sharp` thumbnails onto a canvas, since its labels need the canvas's bundled font, and the bundle is the set's index and logos (2 MB); its grid pages are for reading by eye and stay with the skill. The design is updated to match.

- **2026-11-25T09:39+11:00, task 5 (PR-E1):** the contract schemas for recipe `/2` and the new decoder headers were written with their contract tests rather than before them; the decoder's parity tests were written first and failed first.

## Unexpected challenges

### Task 5 (PR-E1)

- **2026-11-25T09:39+11:00, task 5:** straightened crops can't match crop.py pixel for pixel. Pillow's rotation uses a cubic with a = −1 and libvips, which renders every view, Catmull-Rom (a = −0.5); resampling the script's geometry with a = −1 leaves no value more than four levels off, and with a = −0.5 it reproduces the decoder's residual. Matching exactly would need a second resampler, which the task's single geometry path rules out, so the parity test allows a mean of 1.5 levels and 8% of values over four levels apart (measured 0.8–1.2 and 1–6% on the noisy fixture; the same geometry off by half a pixel measures over 2.5 and 14%). Crops, quarter turns and white balance with intact gains match exactly.
- **2026-11-25T09:39+11:00, task 5:** crop.py's own white balance turns saturated parts on the bench fixture (a gold band, a green part) by 7–9.5°, so on those crops the guard holds the gains back and parity can't apply. The parity fixtures use crops whose gains the guard leaves intact, and a third crop checks the guard on the script's gains.

## Decisions made during implementation

### Task 5 (PR-E1)

- **2026-11-25T09:39+11:00, task 5:** the light bounds. White balance: grey-world gains bounded to ±15% (crop.py allows 0.8–1.25), held back in eighths towards 1 until no saturated pixel turns more than 5°, and refused when even an eighth would. "Saturated" is HSV saturation of at least ½ with channels at least 48 levels apart: near-neutral pixels are what white balance should turn, and below that spread one level of rounding moves hue by several degrees. Contrast is a luminance autocontrast clipping 0–5% at each end (`contrast_clip_permille` 0–50), gamma 0.5–2.0 (`gamma_thousandths` 500–2000), and sharpening crop.py's unsharp mask (radius 2, 80%, threshold 3) on luminance; each scales a pixel's three channels together, held back where one would clip, so only rounding turns a hue; outside the saturated pixels the guard protects, rounding can turn or erase the hue of a dim pixel. Rejected: per-channel versions as in crop.py, which shift hue.
- **2026-11-25T09:39+11:00, task 5:** a recipe `/2` derivation (`media-decode/1` with the recipe) that doesn't fit its page, or whose white balance the guard refuses, returns `malformed` rather than a new decode state, which would change the retained media states. `preview_images` reports that refusal per crop, so a refused recipe needn't reach a proposal; a page or geometry mismatch fails the whole preview as `malformed`.
- **2026-11-25T11:05+11:00, task 5:** after review, the light step as a whole turns no pixel that was saturated before it more than 5° from its source. Independent rounding could turn a dark saturated pixel such as RGB 48, 5, 0 to another hue or to grey, so luminance adjustments keep such a pixel's output spread at 12 levels or more and rebuild its middle channel from the rounded ends, which bounds their hue error at 2.5°; when they follow white balance, its guard gets the remaining 2.5°. `render_view` takes a recipe `/2` without marks, lit at full resolution and then sized, as the task's outcome says. Each `preview_images` page names the evidence version, digest and page it came from; a recipe naming another, two slots giving one version different originals, or two slots claiming one evidence page with different pixels, is `malformed`. `match_logo` shrinks a query to 1024 px on its long edge before thresholding, so an elongated crop can't square up beyond the decoder's memory.
- **2026-11-25T09:39+11:00, task 5:** `match_logo` straightens with the shared view geometry (quarter turns and at most 15°), not straighten.py's arbitrary rotation or four-corner flattening, which would be a second geometry path. A blank region returns no candidates, where match.py fails.
- **2026-11-25T09:39+11:00, task 5:** the logo set bundled with the decoder is the skill's `index.json` and 483 logo GIFs (2 MB), copied into `media-decoder/src/chip-logos/` so the image build's existing `media-decoder/src` copy carries it; the grid pages (4.7 MB) stay with the skill. A test checks the copy against the skill byte for byte. Reference shapes are computed on each request rather than shipped precomputed, so the set can't drift from its shapes; a match took under 3 s in the decoder container, within its time limit.

## Open items

### Task 5 (PR-E1)

- Recipe `/2` is in the decoder's input header only. The retained `MediaRecipe` DTO, its OpenAPI schema and the intake server's parsing of the new output headers (`media/decoder-output.ts`) come with their first consumer in task 10 (PR-E2) or task 6 (PR-F).
