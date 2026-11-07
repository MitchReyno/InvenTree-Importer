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
- **Limits versus failures.** Rendition bytes count toward `totalOutputBytes`. Only a positively identified limit ends `limit_exceeded` with nothing published: the output-byte budget, a per-output limit, or the pixel limits. Anything else is recorded `interrupted`, as today, with nothing published. That covers an unexpected encoder or library failure, the inner `timeout` or outer watchdog expiring, and the container being killed for memory.

- **Rejected: resizing in the API on request.** It would put image CPU and a cache into the web process, the way the agent path does today.
- **Rejected: a second, separate rendition command.** It would double container start-up and split one decode's outputs across two commits.
- **Accepted trade-off:** more decoder time and stored bytes. A 960 px WebP is typically 100–200 KB against a multi-megabyte page PNG, so storage grows by only a few percent.

Proof of fit (task 1): run a 50 MP JPEG and a 30-page PDF through `decodeIsolated()`, which enforces both the container's inner 25 s `timeout` and the 30 s outer watchdog, and require them to complete successfully with margin against the 25 s bound. If the margin is thin, lower `effort` before reducing the sizes.

### One table keyed by preview and size

A new `media_preview_rendition` table has the columns `preview_id`, `size` (`thumb` | `card` | `view`), `width`, `height`, `blob_digest` and `batch_id`. It is unique on (`preview_id`, `size`), immutable through a trigger as the other media tables are, and its foreign key references `media_preview`.

Renditions are rows under the existing preview, not separate previews, so:

- `preview_id` keeps meaning the full page everywhere: agents, regions, recipes and attachment previews;
- a page either has a size or does not;
- `blobReferenced()` gains one more `EXISTS`;
- the decoder role gains `INSERT` on the table, and every role that reads `media_preview` gains `SELECT` on it: the API, `processing` and `processing-reader` roles, whose processing reads reach `mediaSnapshot()` through `media/inputs.ts`, and the collector (`gc`) role, whose separate grant list `blobReferenced()` needs.

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

The cache key gains the size. Crop URLs also carry a region revision, `rev`, built from the observation's source version, page and region values. Editing a region changes the URL, so a mounted image requests the new crop instead of keeping the old one, even when the observation ID and size are unchanged. The route refuses a `rev` that doesn't match the current region with 409. It serves `?size=`, defaulting to `full`, with `cache-control: private, no-cache` and `etag` set to the output digest, and answers a matching `if-none-match` with 304. A region edit keeps the observation ID but changes the region digest, and so the bytes and ETag, so a cached crop is never wrongly reused.

Observation crops stay outside the blob store. They remain a disposable cache, as the existing design intends.

### Backfill renders from the retained page, per preview, with claimed attempts

Ordinary decode commands can't carry the backfill. `media_original_decode_once` allows one command per original, `derivation_id` is unique, snapshot reads assume those cardinalities, and the decoder role can't create commands. Relaxing them would risk duplicate versions, derivations or decode results.

Re-decoding the original wouldn't be safe either. After a decoder or toolchain change it can produce different pixels at the same dimensions, attaching renditions that don't match the retained page that crops, regions and agents still use. So the backfill renders from the retained full-page PNG itself, inside the bounded decoder:

- The decoder protocol gains a `media-renditions/1` input carrying one retained page PNG and its recorded width, height and digest. The entry point (`decoder-main.ts`) and the input-header contract accept it alongside `media-decode/1`.
- Its input bound is the preview bound, `MEDIA_PREVIEW_MAX_BYTES` (64 MiB), because retained page PNGs routinely exceed the 20 MiB upload bound; for example, a 50 MP photo's page is about 25 MiB. `media-decode/1` keeps the 20 MiB source bound.
- The decoder accepts only a PNG whose digest and dimensions match, and returns only its renditions.
- Renditions therefore always derive from exactly the bytes that are retained.
- The response is rendition-only: a header with `state` and `renditions: [{ size, width, height, byte_size, digest }]`, then their bytes. It carries no page bytes, and `decoder-output.ts` and the runner parse this framing as well as the existing one.

Attempts are tracked per preview in a `media_rendition_backfill` table, with these columns:

- `id`, `batch_id` and `preview_id`;
- `owner_id` and `claimed_at`;
- `outcome`: `claimed`, `completed`, `skipped_mismatch` or `interrupted`;
- `attempt` and `created_at`.

How attempts are claimed and published:

- **Claiming.** A claim is an insert, not a row lock. The worker selects eligible previews, reading `media_preview`, its renditions and earlier attempts, which it can already read. For each candidate in turn it runs `INSERT … (outcome 'claimed', owner_id, attempt = prior attempts + 1) ON CONFLICT DO NOTHING RETURNING id`. A partial unique index on `preview_id WHERE outcome = 'claimed'` makes a second concurrent claim on the same preview insert nothing, so that worker moves to the next candidate. No lock on `media_preview` is needed, and the worker role needs only `INSERT`/`UPDATE` on the attempt table. A unique index on (`preview_id`, `attempt`) also stops two workers recording the same attempt number.
- **Eligibility.** A preview qualifies when its version is ready, its dimensions call for a size it lacks (long edge above 320, 960 or 2048), and it has no `completed` or `skipped_mismatch` attempt and fewer than three attempts. Expected sizes come from the dimensions, so a page no larger than 320 px expects none and is never selected, and each page of a mixed-size PDF is judged on its own.
- **Priority.** The worker claims a backfill only when no decode command is waiting, and does one page per claim. The worker runs commands one at a time, so an upload arriving during a backfill waits for at most that one in-flight page, which the decoder's 25 s bound limits, and is decoded before any further backfill.
- **Abandoned claims.** A `claimed` row older than the decoder's outer watchdog plus a grace period (for example 2 minutes) was left by a killed worker. The next worker marks it `interrupted` before claiming, and it becomes eligible again within the three-attempt cap.
- **Publication.** It happens in one transaction that re-locks the attempt and requires `owner_id` to match and the outcome to still be `claimed`. A mismatched or unreadable page PNG inserts nothing and marks the attempt `skipped_mismatch` (logged). Otherwise every rendition row for that preview is inserted and the attempt is marked `completed`. No version, preview, decode command or decode result is written.
- **Roles.** The worker role gets `INSERT`/`UPDATE` on this table only, and snapshot reads never touch it.

Rejected: rendering from the page PNG in the API or a migration. That would decode image bytes outside the bounded container, and keeping every decode inside the container keeps the boundary simple to audit.

### The frontend picks a size per surface with `srcset`

`frontend/src/media/types.ts` gains:

- `previewImage(batchId, page, usage)`, returning `{ src, srcSet, sizes, width, height }` from the page's listed renditions;
- `observationImage(batchId, observation, usage)`, which takes the observation with its pixel region, so it knows the crop's real size.

Rendition and crop output sizes come from one shared function, `renditionDimensions(width, height, size)` in `contracts/src/media.ts`. Task 1 adds it, and the decoder, the crop route and the frontend all use it. It scales the long edge to the size, rounds the other edge, keeps both at least 1, and never upscales, so client and server cannot disagree. Observation images take their intrinsic size from the region, scaled by that function, not from the page.

Usage profiles:

| Usage | Surfaces | `sizes` / sizes offered |
| --- | --- | --- |
| `thumbnail` | `BatchThumbnail`, `NeedsYou`, `ExamineView`, `LotObservations`, `UnassignedObservations`, `ProposedLotsGlance` crops | thumb, then card for 3× density |
| `card` | `MediaEvidenceCard`, `EvidenceFileTile`, `QuestionCard` close-ups, crop output check | thumb and card, with `sizes` from the card width |
| `viewer` | `EvidenceViewer`, `MediaCropDialog` selection | thumb, card and view; the viewer replaces `src` and `srcSet` with the full page once zoom × displayed width exceeds the view width |
| `full` | `ProcessingImages` open link | full page (the original download link keeps using the version route) |

`srcSet` lists the renditions the usage allows, with `w` descriptors from their listed widths. The full page is a candidate only when the usage's largest size was omitted because the page is no larger than it, or because the page hasn't been backfilled yet. Then the full page is no bigger than that size, or is the only accurate image.

- An 800 × 600 page in a card offers `thumb` and the 800 px full page, not `thumb` alone, so it is never blurrier than today.
- A 4032 px photo's card never offers the full page, so a high-density screen can't skip to it.
- `src` is the largest candidate.

The viewer starts with its usage candidates. It promotes to full when `zoom × rendered CSS width × devicePixelRatio` exceeds the `view` rendition's width, where the rendered width is measured at zoom 1. It then replaces both `src` and `srcSet` with the full page alone, and restores them when the product drops back below the width.

Several surfaces don't receive page data today, so their interfaces change too:

- `BatchThumbnail` gets only `{ preview_id, label }` from the inbox workflow read model, so that contract gains the page's dimensions and renditions;
- `EvidenceFileTile` passes a single URL to `EvidenceTile`;
- `RotatedCropSelection` takes a single `source` string;
- `proposed-lots.ts` produces `crops?: string[]` for the images in `ProposedLotsGlance`.

These take an image-attributes object (`src`, `srcSet`, `sizes`, `width`, `height`) instead of a URL.

Images get explicit `width` and `height`, from the page dimensions for page images and from `renditionDimensions()` of the region for observation images, plus `loading="lazy"` and `decoding="async"`, except the viewer's current image. The crop dialog already maps selections through `page.width`/`page.height`, so showing the `view` rendition leaves recorded coordinates unchanged. A test pins this.

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
- **Atomicity.** A normal decode commits previews and renditions together, so an interrupted or limited decode leaves neither. A backfill commits each page's complete rendition set or nothing for that page, so an interrupted multi-page PDF shows renditions for its finished pages and falls back on the rest.
- **Live updates.** Backfill publication appends the same `media_prepared` live event a decode appends, in the same transaction, so mounted pages refresh their rendition listings without polling.
- **Collection.** Rendition blobs are protected by the new reference. Orphans from a rolled-back publication follow the existing collection rules.
- **Compatibility.** The client validates responses against strict schemas (`additionalProperties: false`, `contracts/src/client-policy.ts`), so an older build would reject the new fields rather than ignore them. Because the frontend and API are one app built from the same contracts, PR-A regenerates the client contracts with the server change, so the served frontend and API always agree. A browser tab still open from before the upgrade reloads through Vite when the contract sources change; this is checked manually in task 3. Attachments, approval pins and agent evidence still reference versions and full previews.

## Verification strategy

- **Decoder unit tests.** A 30-page result passes through the real header framing, and an injected encoder failure stays `interrupted`, not `limit_exceeded`. Fixtures cover a JPEG with EXIF orientation, a small PNG, a three-page PDF, a recipe crop and a rotated region. Each checks the expected sizes, dimensions and omitted sizes, that the output is WebP, and that the full page is unchanged. An oversized total output must end `limit_exceeded` with no renditions.
- **Decoder bounds (process tier).** Run the real decoder image through `decodeIsolated()` against a 50 MP photo and a 30-page PDF. Both must complete within the inner 25 s bound, and the times go on the PR. Also run a `media-renditions/1` input with a matching page, a digest mismatch and a dimension mismatch.
- **PostgreSQL tier.** Run the concurrent first-claim test with two workers on the restricted worker role. Check the migration, the immutability trigger, grants (decoder inserts; API, `processing`, `processing-reader` and `gc` read; none update), a processing-side snapshot read run as the restricted processing reader, and `blobReferenced()` and collection with rendition blobs run as the restricted `gc` role. Check atomic publication. Check the backfill:
  - it upgrades without touching previews, versions, commands or decode results, and marks a mismatch skipped;
  - it never selects small pages, and defers to pending commands;
  - two concurrent workers never claim one preview;
  - a claim abandoned by a killed worker is recovered and retried within the cap;
  - a stale owner cannot publish.

  Check rollback by restore: back up, migrate, restore into a fresh database, and start the pre-change build against it through the compatibility gate.
- **HTTP tests.** Check a crop request with a stale `rev` refused with 409, and size selection and fallback, with fallbacks marked `no-cache` and a same-URL request after backfill returning WebP, 400 on an unknown size, 404 across batches, the caching headers, and observation-crop sizes, aspect ratio, ETag and 304, plus a region change returning new bytes.
- **Frontend tests.** Check the helper's `srcSet`/`sizes` per usage. A large page with its renditions present never offers the full page in `srcSet`; a small source and a page not yet backfilled do offer it. Check the attributes reach the real `<img>` in `BatchThumbnail`, `EvidenceTile` and `RotatedCropSelection`, an 800 × 600 page offering its full page in cards and the viewer, the viewer promoting to full just above, and not just below, the density-adjusted threshold at 1× and 3×, crop dialog coordinates unchanged while showing `view`, and each listed surface using its usage profile.
- **Manual check.** On `pnpm dev --tailscale` from a phone, record transferred bytes for the batch list, Capture and the viewer before and after, and attach them to the PR.

## Migration, rollout and recovery

- **Migration.** Migration `0020_media_preview_renditions.sql` adds the table, the trigger, the grants and the reference check. Dev setup reapplies grants on start, so retained namespaces upgrade automatically.
- **Backfill.** It then runs in the background worker, and the UI shows full previews until each page is upgraded.
- **Rollback.** Older code cannot run against an upgraded database. The schema compatibility gate (`operations/compatibility.ts`) quarantines a database whose migration names and hashes don't exactly match the checkout. So rollback means restoring a backup, not running older code:
  - Before migrating a retained namespace, take a coherent archive with `pnpm --filter @invimport/intake-server operations backup`.
  - To go back, restore that archive into a fresh `intake_restore_*` database with `operations restore`, and point the older build at it.
  - The restored database predates the rendition tables, so the older collector has no rendition references to miss. Work done after the upgrade is not carried back.
  - Task 2 checks this: back up, upgrade, restore, then start the pre-change build against the restored database and confirm it passes the compatibility gate.

  A down-migration is not provided, matching the project's forward-only migrations.
- **Observability.** The worker logs backfill progress (`renditions_backfilled`, `renditions_skipped_mismatch`) without content or digests beyond existing log policy.
- **Authorization.** This plan does not authorize live operations. It touches only the local development stack and its own data.

## Risks and open decisions

- **Decoder time on the largest inputs.** Mitigated by measuring first. Reduce `effort`, or skip the `view` size for PDF pages, before touching limits.
- **Overlap with `redesign-batch-workspace` frontend restyling.** Keep edits to image elements, and rebase whichever lands second.
- **Open decisions.** None material. Sizes, WebP quality 80 and automatic backfill are recorded assumptions in the proposal and can be changed at review.
