# Design assessment

## Context and grounding

Media decoding is owned by `intake-server/src/media`. The API retains originals but never decodes them. One explicitly started worker (`worker.ts`) claims a `media_decode_command`, runs the pinned no-network decoder container (`decoder-main.ts` → `decode.ts`), and publishes the result in one transaction: a `media_decode_result`, a `derived` `media_version` for a recipe command, and one `media_preview` row per page. Blob bytes go to the content-addressed store under a digest lock, and `blobReferenced()` lists every table that keeps a blob alive. `media_preview` holds the full-resolution, orientation-normalized lossless PNG. It is the coordinate space for recipes and observation regions, and the source for `region-crops.ts`.

This is moderate, cross-area work: a decoder protocol extension, one table, one migration, route changes, a backfill and a frontend helper. It needs no new dependency or trust boundary. Everything new is derived from bytes the decoder already produces, and it is published through the existing locks, transaction and grants.

## Goals and constraints

The [proposal](proposal.md) and the [capture-media delta](specs/capture-media/spec.md) set the goals:

- Sized WebP renditions for every ready page, original or derived.
- Sized observation crops.
- Crops cut only from full-resolution sources.
- Private, immutable caching.
- Backfill of retained versions.
- Each surface using a suitable size.

Constraints:

- **Decoder boundary.** Untrusted originals stay inside the decoder.
- **Existing previews.** `preview_id`, page dimensions, existing preview bytes and region and recipe coordinates do not change.
- **Decoder limits.** The 30 s, 1 GiB, 96 MiB total-output and per-output limits still hold.
- **Retained data.** Development data is upgraded in place.

## Decisions and alternatives

### Renditions are produced in the decoder, from the decoded page

`decode()` returns its pages as now, then encodes each page into the sizes it exceeds: `sharp(page.bytes).resize({ width, height, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, effort: 4 })`. For a derivation this runs on the crop output, so renditions are sized from the crop.

The result header gains, per page, `renditions: [{ size, width, height, byte_size, digest }]`, and the rendition bytes follow the page bytes in a fixed order.

- **Header bound.** The 8192-byte result-header bound in `decoder-output.ts` and `decoder-runner.ts` is too small: 30 pages with three renditions each need roughly 16.5 KB. One shared constant raises it to 64 KiB in the parser and runner. Task 1 tests a 30-page result through the real framing.
- **Limits versus failures.** Rendition bytes count toward `totalOutputBytes`. Exceeding that budget, or an identified per-output limit, ends `limit_exceeded` with nothing published. An unexpected encoder or library failure propagates as today, so the worker records `interrupted`, never `limit_exceeded`.

- **Rejected: resizing in the API on request.** It would put image CPU and a cache into the web process, the way the agent path does today.
- **Rejected: a second, separate rendition command.** It would double container start-up and split one decode's outputs across two commits.
- **Accepted trade-off:** more decoder time and stored bytes. A 960 px WebP is typically 100–200 KB against a multi-megabyte page PNG, so storage grows by only a few percent.

Proof of fit (task 1): measure a 50 MP JPEG and a 30-page PDF against the 30 s bound. If the margin is thin, lower `effort` before reducing the sizes.

### One table keyed by preview and size

A new `media_preview_rendition` table has the columns `preview_id`, `size` (`thumb` | `card` | `view`), `width`, `height`, `blob_digest` and `batch_id`. It is unique on (`preview_id`, `size`), immutable through a trigger as the other media tables are, and its foreign key references `media_preview`.

Renditions are rows under the existing preview, not separate previews, so:

- `preview_id` keeps meaning the full page everywhere: agents, regions, recipes and attachment previews;
- a page either has a size or does not;
- `blobReferenced()` gains one more `EXISTS`;
- the decoder role gains `INSERT` on the table, the API role `SELECT`, and the collector (`gc`) role `SELECT`, which its separate grant list needs before `blobReferenced()` can read the table.

Rejected: extra `media_preview` rows per size, which would break every consumer that assumes one preview per page.

### The route takes a size; a missing size falls back to the page

`GET /media/previews/:previewId?size=thumb|card|view|full` serves the rendition row when present, and otherwise the full page.

- Response type: `image/webp` for a rendition, `image/png` for the page.
- Headers for a stored rendition, or `size=full`: `cache-control: private, max-age=31536000, immutable`, with `etag` set to the blob digest. Those bytes never change for that ID and size.
- Headers for a fallback, where a size is requested that has no rendition yet: `cache-control: private, no-cache`, with the page's digest as `etag`. This stops a pre-backfill PNG being cached under a URL that later serves WebP. The frontend requests only sizes listed in the snapshot, so fallbacks are rare.
- The global `no-store` hook is overridden only on these routes.
- Unknown sizes return 400.
- Authorization stays as it is: the preview must belong to the authorized batch.

Snapshot contract: each `MediaVersion.pages[]` item gains `renditions: [{ size, width, height }]`. The URL needs only `preview_id` and the size, so no rendition IDs are exposed.

Rejected: a separate route per rendition ID. It would add identifiers for the frontend to carry, for no gain in authority or caching.

### Observation crops are cut full, then downscaled, and cached per size

`region-crops.ts` keeps cutting from the full-resolution page and then downscales to the requested long edge. Output:

- `thumb`, `card` and `view` crops are WebP;
- `full` stays PNG, as today.

The cache key gains the size. The route serves `?size=`, defaulting to `full`, with `cache-control: private, no-cache` and `etag` set to the output digest, and answers a matching `if-none-match` with 304. A region edit keeps the observation ID but changes the region digest, and so the bytes and ETag, so a cached crop is never wrongly reused.

Observation crops stay outside the blob store. They remain a disposable cache, as the existing design intends.

### Backfill uses its own attempt table, not decode commands

Ordinary decode commands can't carry the backfill. `media_original_decode_once` allows one command per original, `derivation_id` is unique, snapshot reads assume those cardinalities, and the decoder role can't create commands. Relaxing them would risk duplicate versions, derivations or decode results.

Instead, a `media_rendition_backfill` table records attempts: `id`, `batch_id`, `version_id`, `attempt`, `outcome` (`claimed` | `completed` | `skipped_mismatch` | `interrupted`) and `created_at`.

- **Who writes it.** The worker role gets `INSERT`/`UPDATE` on that table only.
- **Decoder input.** The original's bytes and, for a derived version, its derivation's recipe, the same input a normal decode uses.
- **Eligibility.** A ready version qualifies when some page lacks a size its dimensions call for (long edge above 320, 960 or 2048), it has no `completed` or `skipped_mismatch` attempt, and it has fewer than three attempts. Expected sizes are computed from dimensions, so a page no larger than 320 px expects none and is never selected again, while a mixed-size PDF expects sizes per page.
- **Priority.** The worker claims a backfill only when no decode command is waiting, so new uploads never wait behind it.

On publication, in one transaction, the worker:

- compares each re-decoded page's dimensions with the recorded `media_preview`, and on any mismatch inserts nothing and marks the attempt `skipped_mismatch` (logged);
- otherwise inserts every rendition row for the existing preview IDs and marks the attempt `completed`;
- writes no version, preview, decode command or decode result.

An interrupted attempt is marked `interrupted` and becomes eligible again on a later worker run, up to the three-attempt cap, so a failing source cannot loop. Snapshot reads never touch this table.

Rejected: generating renditions from the stored page PNG outside the decoder, in the API or a migration. That would decode image bytes outside the bounded container. The PNG is decoder output, but keeping every decode inside the container keeps the boundary simple to audit.

### The frontend picks a size per surface with `srcset`

`frontend/src/media/types.ts` gains:

- `previewImage(batchId, page, usage)`, returning `{ src, srcSet, sizes, width, height }` from the page's listed renditions;
- `observationImage(batchId, observationId, usage)`.

Usage profiles:

| Usage | Surfaces | `sizes` / sizes offered |
| --- | --- | --- |
| `thumbnail` | `BatchThumbnail`, `NeedsYou`, `ExamineView`, `LotObservations`, `UnassignedObservations`, proposed-lot thumbnails | thumb, then card for 3× density |
| `card` | `MediaEvidenceCard`, `EvidenceFileTile`, `QuestionCard` close-ups, crop output check | thumb and card, with `sizes` from the card width |
| `viewer` | `EvidenceViewer`, `MediaCropDialog` selection | thumb, card and view; the viewer replaces `src` and `srcSet` with the full page once zoom × displayed width exceeds the view width |
| `full` | `ProcessingImages` open link | full page (the original download link keeps using the version route) |

`srcSet` lists only the renditions the usage allows, with `w` descriptors from their listed widths. The full page is never a `srcSet` candidate, so a high-density screen can't skip to it. `src` is the largest allowed rendition, or the full page only when the page has no rendition in that range, as before backfill or for a small source.

The viewer starts with `thumb`, `card` and `view` candidates. Once zoom × displayed width exceeds the `view` width, it replaces both `src` and `srcSet` with the full page alone, and restores them when zoomed back out.

Several surfaces don't receive page data today, so their interfaces change too:

- `BatchThumbnail` gets only `{ preview_id, label }` from the inbox workflow read model, so that contract gains the page's dimensions and renditions;
- `EvidenceFileTile` passes a single URL to `EvidenceTile`;
- `RotatedCropSelection` takes a single `source` string.

These take an image-attributes object (`src`, `srcSet`, `sizes`, `width`, `height`) instead of a URL.

Images get explicit `width` and `height` from the page dimensions, plus `loading="lazy"` and `decoding="async"`, except the viewer's current image. The crop dialog already maps selections through `page.width`/`page.height`, so showing the `view` rendition leaves recorded coordinates unchanged. A test pins this.

## State, authority and failure behavior

```text
upload ─▶ original (retained, decoder-only) ─▶ decode command ─▶ decoder container
                                                                     │
                                         full page PNG ◀─────────────┤  (coordinates, crop source)
                                         thumb/card/view WebP ◀───────┘  (display only)
derive recipe ─▶ decoder re-reads original ─▶ crop PNG ─▶ its own thumb/card/view
observation region ─▶ cut from full page PNG ─▶ downscaled per size (cache)
```

- **Identity.** A rendition is identified by (`preview_id`, `size`) and is immutable. Re-decoding never replaces an existing rendition.
- **Authority.** The decoder role publishes renditions only for the command it holds. It still cannot edit drafts, links or attachment selections. The API role only reads them.
- **Atomicity.** A normal decode commits previews and renditions together, so an interrupted or limited decode leaves neither. A backfill commits a version's complete rendition set or nothing.
- **Collection.** Rendition blobs are protected by the new reference. Orphans from a rolled-back publication follow the existing collection rules.
- **Compatibility.** The new contract fields are additive. Older clients ignore `renditions` and keep using full previews. Attachments, approval pins and agent evidence still reference versions and full previews.

## Verification strategy

- **Decoder unit tests.** A 30-page result passes through the real header framing, and an injected encoder failure stays `interrupted`, not `limit_exceeded`. Fixtures cover a JPEG with EXIF orientation, a small PNG, a three-page PDF, a recipe crop and a rotated region. Each checks the expected sizes, dimensions and omitted sizes, that the output is WebP, and that the full page is unchanged. An oversized total output must end `limit_exceeded` with no renditions.
- **Decoder bounds (process tier).** Run the real decoder image against a 50 MP photo and a 30-page PDF and record the time against the 30 s limit. Results go on the PR.
- **PostgreSQL tier.** Check the migration, the immutability trigger, grants (decoder inserts, API and `gc` read, none update), and `blobReferenced()` and collection with rendition blobs run as the restricted `gc` role. Check atomic publication. Check the backfill: it upgrades without touching previews, versions, commands or decode results; marks a mismatch skipped; never selects small pages; retries an interrupted attempt only on a later run and within the cap; and defers to pending commands. Check the rollback procedure: after clearing rendition rows, the collector keeps every remaining referenced blob.
- **HTTP tests.** Check size selection and fallback, with fallbacks marked `no-cache` and a same-URL request after backfill returning WebP, 400 on an unknown size, 404 across batches, the caching headers, and observation-crop sizes, aspect ratio, ETag and 304, plus a region change returning new bytes.
- **Frontend tests.** Check the helper's `srcSet`/`sizes` per usage, with the full page never offered in `srcSet`, and its fallback with no renditions. Check the attributes reach the real `<img>` in `BatchThumbnail`, `EvidenceTile` and `RotatedCropSelection`, the viewer switching both attributes to full on zoom at 3× density, crop dialog coordinates unchanged while showing `view`, and each listed surface using its usage profile.
- **Manual check.** On `pnpm dev --tailscale` from a phone, record transferred bytes for the batch list, Capture and the viewer before and after, and attach them to the PR.

## Migration, rollout and recovery

- **Migration.** Migration `0020_media_preview_renditions.sql` adds the table, the trigger, the grants and the reference check. Dev setup reapplies grants on start, so retained namespaces upgrade automatically.
- **Backfill.** It then runs in the background worker, and the UI shows full previews until each page is upgraded.
- **Rollback.** Older code ignores the table for reads, but its collector also ignores rendition references, and could delete aged rendition blobs whose rows remain. So a rollback must not run the older collector until the rendition rows are cleared. The owner role runs `DELETE FROM media_preview_rendition; DELETE FROM media_rendition_backfill;` first, which is safe because renditions are display-only and are backfilled again after re-upgrading. A down-migration is not provided, matching the project's forward-only migrations.
- **Observability.** The worker logs backfill progress (`renditions_backfilled`, `renditions_skipped_mismatch`) without content or digests beyond existing log policy.
- **Authorization.** This plan does not authorize live operations. It touches only the local development stack and its own data.

## Risks and open decisions

- **Decoder time on the largest inputs.** Mitigated by measuring first. Reduce `effort`, or skip the `view` size for PDF pages, before touching limits.
- **Overlap with `redesign-batch-workspace` frontend restyling.** Keep edits to image elements, and rebase whichever lands second.
- **Open decisions.** None material. Sizes, WebP quality 80 and automatic backfill are recorded assumptions in the proposal and can be changed at review.
