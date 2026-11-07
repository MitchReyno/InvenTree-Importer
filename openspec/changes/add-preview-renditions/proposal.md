# Change proposal

## Problem and intended outcome

Every image the app shows is the full-resolution decoded page. For a phone photo that is a lossless PNG of several to 25 MiB, and it is sent for every 44 px thumbnail, every evidence card and every viewer. Pages load slowly, especially from a phone over Tailscale, and a batch with a few dozen photos moves hundreds of megabytes. Documentary crops have the same problem: their only preview is the full crop PNG. Observation crops are cut and returned at full resolution even when shown at 64 px.

The requested outcome:

- Decoding produces several preview resolutions for each image page, sized for the app's preview surfaces.
- Documentary crops and observation crops get preview resolutions too.
- The retained original, and the full-resolution page decoded from it, remain the only sources for cutting crops. A downscaled preview is never used to cut one.
- Each frontend surface requests the preview that suits its display size.

## Change identity and linked items

Canonical name: `add-preview-renditions`. Branches `feat/add-preview-renditions-<suffix>`; subjects `feat(add-preview-renditions): …`.

Linked item: [BI-013 — Preview renditions for media](../../../docs/PLANNED_FUNCTIONALITY.md#bi-013--preview-renditions-for-media).

## Current behavior and evidence

- **Decoder output.** `intake-server/src/media/decode.ts` `raster()` auto-orients a JPEG or PNG, converts it to sRGB and writes one lossless PNG at full resolution. PDFs are rendered at scale 1 and then go through the same step. The worker stores one `media_preview` row per page (`page`, `width`, `height`, `blob_digest`); see `media/schema.ts` and `media/worker.ts`. `decoder-protocol.ts` notes that a 50 MP photo's preview reaches about 25 MiB.
- **Documentary crops.** A derivation re-decodes the original inside the decoder, extracts the recipe region from the full page, and publishes the PNG both as the `derived` version and as its single preview (`publishDerivedVersion`, then the preview insert in `publishDecoded`). The original is already the crop source.
- **Observation crops.** `media/region-crops.ts` cuts an observation's pixel region from the full page preview and caches the PNG under `cropCacheDir`. Untrusted originals deliberately never leave the decoder. Region coordinates are measured against the full page's width and height and are refused with `region_preview_mismatch` when those differ.
- **Serving.** `/media/previews/:id` and `/media/observations/:id/crop` return `image/png`. The API's global hook sets `cache-control: no-store` (`api/server.ts`), so immutable preview bytes are downloaded again on every render.
- **Frontend.** `mediaResource(…, 'previews', page.preview_id)` and `observationCrop(…)` are the only image URLs (`frontend/src/media/types.ts`). They are used at full resolution in:
  - small thumbnails: `BatchThumbnail`, `ExamineView` (56 px), `LotObservations` and `UnassignedObservations` (64 px);
  - cards: `MediaEvidenceCard` (at most 280 px tall), `EvidenceFileTile`.

  `NeedsYou` thumbnails and `QuestionCard` close-ups take plain image URLs, but no production code supplies them media today: `QuestionCard` is used only in the component gallery. They are out of scope until real media reaches them.
  - the zoomable `EvidenceViewer` (up to 460 px tall);
  - `MediaCropDialog` (selection and output check);
  - the `ProcessingImages` open link.

  The crop dialog already maps selections through `page.width`/`page.height`, so it can display a smaller image without changing coordinates.
- **Agents.** `agents/tools/handlers.ts` downscales previews on the fly to a 768 px long edge for lead sessions. This is evidence delivery with its own digest semantics.

## Scope and non-goals

In scope:

- **Image renditions.** The bounded decoder produces downscaled WebP renditions for every ready page, original or derived, in the same decode command, never upscaling. The full-resolution PNG page stays as it is: same row, identity, dimensions and role as the coordinate and crop source.
- **Crop renditions.** Observation crops are served at a requested rendition size, cut from the full page and then downscaled.
- **Contracts and routes.** No JSON response changes shape. Clients derive rendition sizes from the page dimensions they already receive, and the preview and observation-crop routes gain optional `size` (and, for crops, `rev`) query parameters. Every image response becomes privately cacheable and is revalidated by digest, so repeat views cost a 304 while authorization is still checked each time. The generated route contract records the new media type, parameters and validators.
- **Existing data.** Retained versions decoded before this change get renditions through a bounded backfill. Until then, the frontend falls back to the full page.
- **Frontend.** A shared helper picks the rendition per surface with `srcset`/`sizes`. The viewer switches to the full page when zoomed beyond the largest rendition.

Non-goals:

- Changing what agents receive.
- Changing attachment uploads to InvenTree; attachments still use the selected version's retained bytes.
- Changing crop recipes or region coordinates.
- Re-encoding originals.
- Client-side resizing.
- Any new external service.

Compatibility:

- `preview_id`, page dimensions, region coordinates, recipe digests and existing preview bytes stay unchanged.
- No API response gains fields. The client validates responses strictly, so this keeps already-open built clients working across the upgrade.
- Retained development data is upgraded in place, without reseeding.

## Reuse and dependency assessment

The existing stack already has the encoder: `sharp` 0.35.5, with libvips 8.18.7, in `intake-server`, which is also baked into the pinned decoder image. It can write WebP and AVIF (`sharp.format.webp.output.buffer` and `sharp.format.heif.output.buffer` are both true; checked 2026-11-07). React 19.3.1 passes `srcSet`/`sizes` through to `<img>`.

| Option and relevant version | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence and date checked | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| Extend the decoder with `sharp` resize → WebP (sharp 0.35.5) | Runs inside the existing bounded container on the already-decoded page; no new dependency, trust boundary or process; deterministic per toolchain | Adds encode time and output bytes per page within the 30 s and output-byte limits | `sharp` [resize](https://sharp.pixelplumbing.com/api-resize) and [WebP output](https://sharp.pixelplumbing.com/api-output#webp) docs; `intake-server/package.json`; local `sharp.format` check, 2026-11-07 | Encode time for a 50 MP page at three sizes; measure in task 1 |
| Same, encoding AVIF | About 20–30% smaller than WebP at similar quality | Several times slower to encode, which risks the 30 s decode bound on large photos and PDFs; savings are small at thumbnail sizes | `sharp` [AVIF output](https://sharp.pixelplumbing.com/api-output#avif) docs, 2026-11-07 | Not pursued |
| Resize on request in the API (as the agent path does) | No storage or schema change | CPU in the web process on every uncached view; would need its own cache and limits; repeats work across devices | `agents/tools/handlers.ts` | Rejected |
| External image proxy (imgproxy, thumbor) | Mature resizing and caching | New service, container and network path for private evidence; conflicts with the no-network decoder and blob authorization model | Project architecture (`intake-server/ARCHITECTURE.md`) | Rejected |
| Browser-side downscale | No server change | Still downloads the full PNG, so it doesn't solve the problem | — | Rejected |

Recommendation: extend the decoder with `sharp` WebP renditions. It reuses the bounded decoder, the content-addressed blob store and orphan collection, and needs no new dependency. Every major browser supports WebP, including Safari 14+ and iOS 14+, which covers the phone used over Tailscale. Custom work is limited to choosing sizes, recording renditions, the backfill and the frontend helper.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `capture-media`:
  - decoding gains preview renditions;
  - documentary and observation crops gain sized previews and stay cut from the full-resolution source;
  - authorized reads gain size selection and caching;
  - a new requirement covers surface-appropriate preview use and the fallback for media decoded before the change.

## Impact and dependencies

- **Server and decoder:**
  - the decode result protocol, the worker's publication step, and a new `media_preview_rendition` table and migration with its decoder grants;
  - orphan collection references;
  - the preview and observation-crop routes, and the observation-crop cache key;
  - the backfill path.
- **Contracts:** no API response changes shape. Clients derive rendition sizes from page dimensions with the shared `renditionDimensions()`, and the preview route falls back for a missing size, so already-open built clients keep validating every response.
- **Frontend:** the media URL helper and the image surfaces listed above.
- **Retained data:** existing versions get renditions from the backfill. Bytes and IDs that already exist are never altered.
- **Coordination:** `redesign-batch-workspace` PR-I to PR-K restyle several of these components. The edits here are limited to image sources and attributes. Whichever lands second rebases.
- **Prerequisites:** none. No external service or authorization is needed.

## Open decisions and assumptions

Assumptions, adjustable at review:

- **Sizes.** Rendition long edges of 320 px (`thumb`), 960 px (`card`) and 2048 px (`view`). These cover the 44–64 px thumbnails, cards up to 280 px tall, and the 460 px viewer, at up to 3× pixel density.
- **Encoding.** WebP at quality 80.
- **Small sources.** A rendition is omitted when the page is no larger than its long edge, and the next size up, or the full page, serves that size.
- **Crop source.** "The original retained as the source for crops" is met by keeping the original bytes inside the decoder boundary as today. Crops are cut from the original, or from the full-resolution page decoded from it, never from a rendition.
- **Backfill.** It runs automatically through the media worker for every retained page preview that lacks the sizes its dimensions call for. Renditions are rendered from the retained page PNG inside the bounded decoder, one page at a time, after any pending decode work.
- **Agents.** Agent evidence delivery is unchanged. Reusing renditions for agents could be a later change.
