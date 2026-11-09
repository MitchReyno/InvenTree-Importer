# Implementation and delivery tasks

## Plan context

Canonical change: `add-preview-renditions`, delivering [BI-013](../../../../docs/PLANNED_FUNCTIONALITY.md#bi-013--preview-renditions-for-media). Read with the [proposal](proposal.md) (reuse recommendation: extend the bounded decoder with `sharp` WebP renditions), the [design](design.md) and the [capture-media delta](specs/capture-media/spec.md). Every delivering branch and commit/PR subject uses the exact name, e.g. `feat(add-preview-renditions): …`.

## Completion and commit ordering

Complete and verify a checkbox action, then check it in the same commit as its work. Keep incomplete actions and parents with unfinished subtasks unchecked. Review, publication, CI and merge actions stay pending until they actually happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Decoder renditions | Behavior | None | Media preview renditions; Media full-resolution crop source |
| 2. Rendition storage and publication | Behavior, migration | 1 | Media preview renditions; Media orphan collection (unchanged guarantees) |
| 3. Sized preview reads | Behavior | 2 | Media authorized byte reads; Media preview renditions (unchanged response shapes) |
| 4. Sized observation crops | Behavior | 1 (`renditionDimensions()`) | Media sized observation crops; Media authorized byte reads (revalidation); Media full-resolution crop source |
| 5. Rendition backfill | Behavior, migration of retained data | 2 | Media rendition backfill |
| 6. Frontend preview selection | Behavior (UI) | 3, 4 | Media previews fit their surface |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | New decodes produce, store and serve sized renditions, with no JSON response changing shape | Tasks 1–3 in full | One end-to-end server slice: protocol, table and route are only testable together. Response shapes stay as they are, so already-open built clients keep working | None; merges first | `interactive-app`; `feat/add-preview-renditions-server`; `feat(add-preview-renditions): decode and serve preview renditions` | Decoder, PostgreSQL and HTTP tiers; decoder-bound timing recorded on the PR; `contracts:check` showing only the image-route declaration changes; independent exact-head review; selected CI green |
| PR-B | Observation crops at each size, and retained versions upgraded in the background | Tasks 4–5 in full | Both close the remaining server gaps before the UI relies on sizes; they share the worker and HTTP test setup | After PR-A (task 5 needs the table) | `interactive-app`; `feat/add-preview-renditions-backfill`; `feat(add-preview-renditions): sized observation crops and rendition backfill` | PostgreSQL, HTTP and decoder process tiers; `contracts:check` showing only the crop-route declaration change; backfill run against a copy of retained dev data; independent exact-head review; selected CI green |
| PR-C | Each frontend surface loads a suitable size, with the viewer switching to full when its density-adjusted width needs it | Task 6 in full | One UI pass over the media surfaces with a single helper; reviewed with a demo recording | After PR-A and PR-B | `interactive-app`; `feat/add-preview-renditions-frontend`; `feat(add-preview-renditions): use sized previews in the app` | Frontend typecheck, lint, tests and build; byte-transfer comparison and demo video on the PR; independent exact-head review; selected CI green |

## 1. Decoder renditions

- **PR delivery:** PR-A.
- **Outcome:** a ready decode returns, for every page, `thumb`/`card`/`view` WebP renditions that never upscale. Sizes the page doesn't exceed are omitted, and the full page and crop outputs are unchanged.
- **Scope:** `intake-server/src/media/decode.ts`, `decoder-protocol.ts`, `decoder-main.ts`, `decoder-output.ts` and `decoder-runner.ts` (result framing and a shared header bound raised to 64 KiB), and `contracts/src/media.ts` for the decoder result header and the shared `renditionDimensions()`.
- **Prerequisites:** none.
- **Acceptance:** Media preview renditions (photo, small source, multi-page, derived crop, failed decode, decoder bounds); Media full-resolution crop source.
- **Approach:** as in design ("Renditions are produced in the decoder"). Rendition bytes count toward `totalOutputBytes`; only identified limits end `limit_exceeded`, and unexpected encoder failures stay `interrupted`.
- **Verification:** decoder unit tests; real decoder-image timing for a 50 MP JPEG and a 30-page PDF.
- **Risks:** encode time near the 30 s bound. Measure before tuning `effort`.

- [x] 1.1 Baseline: run the existing decoder tests, and record a 50 MP JPEG and a 30-page PDF decode time through `decodeIsolated()` against its inner 25 s bound.
- [x] 1.2 RED: add decoder tests for rendition sizes, dimensions exactly equal to `renditionDimensions()` (including a 1000 × 101 page), omission, WebP type, unchanged full page, derived-crop sizing, a total-output limit (`limit_exceeded`), an injected encoder failure and a watchdog timeout (both `interrupted`), and a 30-page result through the real header framing. They fail because no renditions are returned and the header bound is 8192 bytes.
- [x] 1.3 GREEN: add `renditionDimensions()` with tests for landscape, portrait, square, small and 1-pixel sources, then encode renditions per page, extend the result header and byte framing, and raise the shared header bound in the parser and runner.
- [x] 1.4 Re-measure the two large inputs through `decodeIsolated()`, require successful completion with margin against the 25 s bound, tune `effort` if needed, and record the times for the PR.

## 2. Rendition storage and publication

- **PR delivery:** PR-A.
- **Outcome:** a ready decode commits its renditions with its previews in one transaction. Rendition blobs are referenced for collection, and the decoder role can insert but not alter them.
- **Scope:** `intake-server/migrations/0020_media_preview_renditions.sql`, `media/schema.ts`, `media/worker.ts`, `media/grants.ts` (decoder `INSERT`; API, `processing`, `processing-reader` and `gc` `SELECT`), `media/blob-reference.ts`, intake-server architecture notes and the rollback note in `docs/development.md`.
- **Prerequisites:** task 1.
- **Acceptance:** Media preview renditions (atomic with the page; none on failure); existing Media orphan collection guarantees.
- **Approach:** as in design ("One table keyed by preview and size"), using the existing digest locks and immutability-trigger pattern.
- **Verification:** PostgreSQL tier (`pnpm test:intake:pg`) for the migration, the trigger, grants, atomic publication, interrupted publication and collection.

- [x] 2.1 RED: add PostgreSQL tests for publication, a rolled-back publication, immutability, decoder/API/processing/`gc` grants, a processing-side snapshot read as the restricted processing reader, and collection run as the restricted `gc` role keeping referenced rendition blobs and removing aged orphans.
- [x] 2.2 GREEN: add the migration, Drizzle table, grants and reference check, and publish renditions in `publishDecoded`.
- [x] 2.3 Verify the existing media PostgreSQL and process suites still pass, and update the media architecture note.
- [x] 2.4 Document and test rollback by restore: on the pre-change build, take an `operations backup`; migrate on the new build; then, on the pre-change build again, restore into a fresh `intake_restore_*` database and confirm it passes the compatibility gate and starts against it.

## 3. Sized preview reads

- **PR delivery:** PR-A.
- **Outcome:** `GET …/media/previews/:id?size=` serves a rendition or falls back to the page, and no snapshot or inbox response changes shape. Every image response is private and `no-cache` with a digest ETag and 304, so authorization is checked on each view.
- **Scope:** `media/read.ts`, `media/content.ts`, `media/routes.ts`. Response contracts are deliberately unchanged.
- **Prerequisites:** task 2.
- **Acceptance:** Media authorized byte reads (cross-batch rendition, private revalidated caching, cached bytes under another context); Media preview renditions (response shapes unchanged).
- **Approach:** as in design ("The route takes a size…"). Override the global `no-store` only on these routes.
- **Verification:** HTTP tests; regenerate and run `pnpm contracts:check`; `pnpm test:intake`.

- [x] 3.1 RED: add HTTP tests for each size, fallback without renditions marked `no-cache`, the same URL returning WebP once renditions exist, 400 on an unknown size, 404 across batches, and content types and caching headers. Snapshot and inbox responses must still validate against the pre-change client schemas.
- [x] 3.2 GREEN: implement the sized read, route and headers.
- [x] 3.3 Update `contracts/scripts/generate.cjs` for the preview route's media types, `size` parameter and ETag/304 behavior, regenerate, and confirm with `contracts:check` that the only diffs are those route declarations and that every JSON response schema is unchanged. Then run `typecheck:intake`, `test:intake` and `test:frontend`.

## 4. Sized observation crops

- **PR delivery:** PR-B.
- **Outcome:** `…/observations/:id/crop?size=` returns the region cut from the full page and then downscaled. The cache is keyed per size, and responses carry a digest ETag and answer 304, so a changed region yields new bytes.
- **Scope:** `media/region-crops.ts`, `media/content.ts`, `media/routes.ts`, and the crop route's declaration in `contracts/scripts/generate.cjs`.
- **Prerequisites:** task 1 for `renditionDimensions()`. Otherwise it works on existing full previews.
- **Acceptance:** Media sized observation crops; Media authorized byte reads (revalidated observation crop); Media full-resolution crop source (coordinates unchanged).
- **Approach:** as in design ("Observation crops are cut full, then downscaled").
- **Verification:** HTTP tests.

- [x] 4.1 RED: add tests for `thumb` dimensions, a `rev` that no longer matches refused with 409, a small region left unscaled, 400 on an unknown size, the default `full`, ETag/304, and a region change returning new bytes.
- [x] 4.2 GREEN: implement the sized cut, the per-size cache key and the headers.
- [x] 4.3 Update `contracts/scripts/generate.cjs` for the observation-crop route's `size` and `rev` parameters, WebP output and ETag/304 behavior, regenerate, and confirm with `contracts:check` that only that route's declaration changed.

## 5. Rendition backfill

- **PR delivery:** PR-B.
- **Outcome:** the media worker upgrades retained ready versions in the background, after pending work. Eligibility comes from the sizes each page's dimensions call for, and attempts are tracked in their own table. It never changes existing previews, versions, commands or decode results, skips a dimension mismatch, and retries an interrupted attempt only on a later run, within a three-attempt cap.
- **Scope:**
  - a migration adding `media_rendition_backfill`, with its partial unique claim index and worker grants;
  - the `media-renditions/1` decoder input, with its 64 MiB input bound and rendition-only response framing, through every layer of the container boundary: the input and output contracts in `contracts/src/media.ts`, plus `decoder-protocol.ts`, `decoder-main.ts`, `decode.ts`, `decoder-output.ts` and `decoder-runner.ts`;
  - in `media/worker.ts`: eligibility, claiming, abandoned-claim recovery and owner-checked rendition-only publication;
  - snapshot reads, which must not change;
- **Prerequisites:** task 2.
- **Acceptance:** Media rendition backfill (upgrade, request before backfill, interrupted, source changed).
- **Approach:** as in design ("Backfill renders from the retained page, per preview, with claimed attempts").
- **Verification:** PostgreSQL tier, plus a run against a copy of retained development data. Never run it against the live namespace without a backup.

- [x] 5.1 RED: add PostgreSQL tests for:
  - an upgrade with an unchanged `preview_id`, bytes, version count, decode state and command count;
  - deferral to pending commands;
  - a dimension mismatch;
  - small pages never selected;
  - a mixed-size PDF;
  - an interrupted attempt retried only on a later run and capped;
  - two concurrent workers never claiming one preview, including when one worker pauses between candidate selection and insertion while the other completes or interrupts that preview;
  - a foreign-context batch never claimed, recovered or published, under the restricted worker role;
  - an abandoned claim recovered after expiry, and a stale owner refused at publication;
  - a page whose third attempt was interrupted never claimed again, still serving its full preview;
  - a retained page whose bytes don't match its recorded digest, skipped;
  - a tagged `BlobCorruptError` added to `media/blob-store.ts` in place of the plain `blob_corrupt` error;
  - against the real blob store: a corrupt blob (`blob_corrupt`) recorded `skipped_mismatch`, and a transient read or I/O failure recorded interrupted with backoff, then upgraded once reads recover;
  - process tier: a retained page PNG above 20 MiB, and a mismatched one, through the real decoder image via `decodeIsolated()`;
  - a derived version's recipe backfill.
- [x] 5.2 GREEN: implement the attempt table, eligibility, claiming and rendition-only publication, with `renditions_backfilled`/`renditions_skipped_mismatch` logs.
- [x] 5.3 Run the backfill against a copy of a retained development namespace, confirm every ready page gains renditions, and record counts for the PR.
- [x] 5.4 Update `docs/development.md` to say retained media upgrades in the background after restart.
- [x] 5.5 Add scheduling tests:
  - repeated polling within the backoff never re-claims an interrupted preview, which becomes eligible once `retry_after` passes;
  - claim, recovery and publication all succeed under the restricted worker role;
  - an upload that arrives during a page backfill is decoded right after that one page;
  - after a multi-page PDF backfill is interrupted, its completed pages show renditions and the rest fall back.

## 6. Frontend preview selection

- **PR delivery:** PR-C.
- **Outcome:** each image surface uses its usage profile (thumbnail, card, viewer, full) through one helper. Images declare their size and load lazily where offscreen, the viewer switches to full past the `view` resolution, the crop dialog keeps full-resolution coordinates, and missing sizes fall back.
- **Scope:** `frontend/src/media/types.ts`, which adopts task 1's `renditionDimensions()`, plus crop URLs carrying the region revision; the image interfaces of `EvidenceTile`, `RotatedCropSelection` and `ProposedLotsGlance` (`proposed-lots.ts` crop data), which change from URLs to image attributes; `BatchThumbnail`'s inbox thumbnail data; and the surfaces in the design's usage table: `BatchThumbnail`, `ExamineView`, `LotObservations`, `UnassignedObservations`, `proposed-lots.ts`, `MediaEvidenceCard`, `EvidenceFileTile`, `EvidenceViewer`, `MediaCropDialog`, `ProcessingImages`.
- **Prerequisites:** tasks 3 and 4.
- **Acceptance:** Media previews fit their surface (all scenarios).
- **Approach:** as in design ("The frontend picks a size per surface"). Touch only image elements, to limit overlap with `redesign-batch-workspace` restyling.
- **Verification:** `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend`, `pnpm build`. For the manual check, record transferred bytes from a phone on `pnpm dev --tailscale` before and after.

- [x] 6.1 RED: add helper tests: `srcSet`/`sizes` per usage; a large page with renditions never offering the full page; a small source offering it; identical output for the same page before and after backfill (fallback bytes are checked through the HTTP route, not the helper); observation images sized from their region through `renditionDimensions()` for small, portrait and landscape regions, matching the server's output; a narrow 3600 × 400 region in a 64 px cover thumbnail at 3× density selecting the `view` crop and surface tests: `BatchThumbnail` requesting `size=thumb` as a plain `src`; attributes reaching the real `<img>` in `EvidenceTile` and `RotatedCropSelection` and `ProposedLotsGlance`; thumbnail and card sizes requested; the viewer promoting both attributes to full just above, and not just below, the density-adjusted threshold, including on first render at 3× density; a mounted crop image requesting the new crop after its region is edited; crop selection coordinates unchanged over `view`, including a 10000 × 101 page whose rounded `view` changes aspect ratio, with the same selection recording identical coordinates over the full page and over `view`.
- [x] 6.2 GREEN: implement the helper and adopt it on every listed surface.
- [x] 6.3 Run the frontend checks and build; record the byte-transfer comparison and a demo recording for the PR.

## Delivery evidence and lifecycle follow-up

- [x] D.1 PR-A: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization. Reviewed `e9adfbd`, merged as `24193c7` in [#140](https://github.com/MitchReyno/InvenTree-Importer/pull/140).
- [x] D.2 PR-B: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization. Reviewed `a4cf470`, merged as `ebc93b7` in [#143](https://github.com/MitchReyno/InvenTree-Importer/pull/143).
- [x] D.3 PR-C: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization. Codex gpt-6.1-sol clear at `a507e25b8add00135343e551bfa117e408403813` (round 4); published head `76fd198f3169cb4189a7509fd672e15a0f1816eb` adds only the task checkbox; selected CI green; merged as `77040b1a2597526540a96d1a2075f0421e05d496` in [#144](https://github.com/MitchReyno/InvenTree-Importer/pull/144).
- [x] D.4 After all PRs merge with acceptance evidence, update BI-013's status in the index. Archive only when authorized, after `pnpm openspec:overlap --change add-preview-renditions`. Overlap reported no conflicts; BI-013 is Done.
