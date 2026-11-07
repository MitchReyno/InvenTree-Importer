# Implementation and delivery tasks

## Plan context

Canonical change: `add-preview-renditions`, delivering [BI-013](../../../docs/PLANNED_FUNCTIONALITY.md#bi-013--preview-renditions-for-media). Read with the [proposal](proposal.md) (reuse recommendation: extend the bounded decoder with `sharp` WebP renditions), the [design](design.md) and the [capture-media delta](specs/capture-media/spec.md). Every delivering branch and commit/PR subject uses the exact name, e.g. `feat(add-preview-renditions): …`.

## Completion and commit ordering

Complete and verify a checkbox action, then check it in the same commit as its work. Keep incomplete actions and parents with unfinished subtasks unchecked. Review, publication, CI and merge actions stay pending until they actually happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Decoder renditions | Behavior | None | Media preview renditions; Media full-resolution crop source |
| 2. Rendition storage and publication | Behavior, migration | 1 | Media preview renditions; Media orphan collection (unchanged guarantees) |
| 3. Sized preview reads and contract | Behavior, contract | 2 | Media authorized byte reads; Media preview renditions (snapshot listing) |
| 4. Sized observation crops | Behavior | None (reads existing full previews) | Media sized observation crops; Media authorized byte reads (revalidation); Media full-resolution crop source |
| 5. Rendition backfill | Behavior, migration of retained data | 2 | Media rendition backfill |
| 6. Frontend preview selection | Behavior (UI) | 3, 4 | Media previews fit their surface |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | New decodes produce, store and serve sized renditions; the snapshot lists them | Tasks 1–3 in full | One end-to-end server slice: protocol, table and route are only testable together, and older clients keep working because the fields are additive | None; merges first | `interactive-app`; `feat/add-preview-renditions-server`; `feat(add-preview-renditions): decode and serve preview renditions` | Decoder, PostgreSQL and HTTP tiers; decoder-bound timing recorded on the PR; `contracts:check`; independent exact-head review; selected CI green |
| PR-B | Observation crops at each size, and retained versions upgraded in the background | Tasks 4–5 in full | Both close the remaining server gaps before the UI relies on sizes; they share the worker and HTTP test setup | After PR-A (task 5 needs the table) | `interactive-app`; `feat/add-preview-renditions-backfill`; `feat(add-preview-renditions): sized observation crops and rendition backfill` | PostgreSQL and HTTP tiers; backfill run against a copy of retained dev data; independent exact-head review; selected CI green |
| PR-C | Each frontend surface loads a suitable size, with the viewer switching to full on zoom | Task 6 in full | One UI pass over the media surfaces with a single helper; reviewed with a demo recording | After PR-A and PR-B | `interactive-app`; `feat/add-preview-renditions-frontend`; `feat(add-preview-renditions): use sized previews in the app` | Frontend typecheck, lint, tests and build; byte-transfer comparison and demo video on the PR; independent exact-head review; selected CI green |

## 1. Decoder renditions

- **PR delivery:** PR-A.
- **Outcome:** a ready decode returns, for every page, `thumb`/`card`/`view` WebP renditions that never upscale. Sizes the page doesn't exceed are omitted, and the full page and crop outputs are unchanged.
- **Scope:** `intake-server/src/media/decode.ts`, `decoder-protocol.ts`, `decoder-main.ts`, `decoder-output.ts` and `decoder-runner.ts` (result framing and a shared header bound raised to 64 KiB), `contracts/src/media.ts` (decoder result header).
- **Prerequisites:** none.
- **Acceptance:** Media preview renditions (photo, small source, multi-page, derived crop, failed decode, decoder bounds); Media full-resolution crop source.
- **Approach:** as in design ("Renditions are produced in the decoder"). Rendition bytes count toward `totalOutputBytes`; only identified limits end `limit_exceeded`, and unexpected encoder failures stay `interrupted`.
- **Verification:** decoder unit tests; real decoder-image timing for a 50 MP JPEG and a 30-page PDF.
- **Risks:** encode time near the 30 s bound. Measure before tuning `effort`.

- [ ] 1.1 Baseline: run the existing decoder tests, and record a 50 MP JPEG and a 30-page PDF decode time through `decodeIsolated()` against its inner 25 s bound.
- [ ] 1.2 RED: add decoder tests for rendition sizes, dimensions, omission, WebP type, unchanged full page, derived-crop sizing, a total-output limit, an injected encoder failure (`interrupted`), and a 30-page result through the real header framing. They fail because no renditions are returned and the header bound is 8192 bytes.
- [ ] 1.3 GREEN: encode renditions per page, extend the result header and byte framing, and raise the shared header bound in the parser and runner.
- [ ] 1.4 Re-measure the two large inputs through `decodeIsolated()`, require successful completion with margin against the 25 s bound, tune `effort` if needed, and record the times for the PR.

## 2. Rendition storage and publication

- **PR delivery:** PR-A.
- **Outcome:** a ready decode commits its renditions with its previews in one transaction. Rendition blobs are referenced for collection, and the decoder role can insert but not alter them.
- **Scope:** `intake-server/migrations/0020_media_preview_renditions.sql`, `media/schema.ts`, `media/worker.ts`, `media/grants.ts` (decoder `INSERT`; API, `processing`, `processing-reader` and `gc` `SELECT`), `media/blob-reference.ts`, intake-server architecture notes and the rollback note in `docs/development.md`.
- **Prerequisites:** task 1.
- **Acceptance:** Media preview renditions (atomic with the page; none on failure); existing Media orphan collection guarantees.
- **Approach:** as in design ("One table keyed by preview and size"), using the existing digest locks and immutability-trigger pattern.
- **Verification:** PostgreSQL tier (`pnpm test:intake:pg`) for the migration, the trigger, grants, atomic publication, interrupted publication and collection.

- [ ] 2.1 RED: add PostgreSQL tests for publication, a rolled-back publication, immutability, decoder/API/processing/`gc` grants, a processing-side snapshot read as the restricted processing reader, and collection run as the restricted `gc` role keeping referenced rendition blobs and removing aged orphans.
- [ ] 2.2 GREEN: add the migration, Drizzle table, grants and reference check, and publish renditions in `publishDecoded`.
- [ ] 2.3 Verify the existing media PostgreSQL and process suites still pass, and update the media architecture note.
- [ ] 2.4 Document and test the rendition-table rollback (owner transaction disabling the immutability trigger to clear rows) before an older collector runs, then confirm every remaining referenced blob survives collection.

## 3. Sized preview reads and contract

- **PR delivery:** PR-A.
- **Outcome:** the snapshot and the inbox workflow thumbnail list each page's dimensions and renditions, and `GET …/media/previews/:id?size=` serves a rendition or falls back to the page. Stored renditions and `full` are private and immutable, fallbacks are `no-cache`, and authorization is unchanged.
- **Scope:** `contracts/src/media.ts` (`MediaVersion.pages[].renditions`), the inbox workflow thumbnail contract and its read model, generated client contracts, `media/read.ts`, `media/content.ts`, `media/routes.ts`.
- **Prerequisites:** task 2.
- **Acceptance:** Media authorized byte reads (cross-batch rendition, private immutable caching); Media preview renditions (snapshot listing).
- **Approach:** as in design ("The route takes a size…"). Override the global `no-store` only on these routes.
- **Verification:** HTTP tests; `pnpm contracts:check`; `pnpm test:intake`.

- [ ] 3.1 RED: add HTTP tests for each size, fallback without renditions marked `no-cache`, the same URL returning WebP once renditions exist, 400 on an unknown size, 404 across batches, content types and caching headers, and the snapshot and inbox thumbnail listings.
- [ ] 3.2 GREEN: extend the contract, regenerate, and implement the read, route and headers.
- [ ] 3.3 Verify `contracts:check`, `typecheck:intake` and `test:intake`.

## 4. Sized observation crops

- **PR delivery:** PR-B.
- **Outcome:** `…/observations/:id/crop?size=` returns the region cut from the full page and then downscaled. The cache is keyed per size, and responses carry a digest ETag and answer 304, so a changed region yields new bytes.
- **Scope:** `media/region-crops.ts`, `media/content.ts`, `media/routes.ts`.
- **Prerequisites:** none. This works on existing full previews.
- **Acceptance:** Media sized observation crops; Media authorized byte reads (revalidated observation crop); Media full-resolution crop source (coordinates unchanged).
- **Approach:** as in design ("Observation crops are cut full, then downscaled").
- **Verification:** HTTP tests.

- [ ] 4.1 RED: add tests for `thumb` dimensions, a small region left unscaled, 400 on an unknown size, the default `full`, ETag/304, and a region change returning new bytes.
- [ ] 4.2 GREEN: implement the sized cut, the per-size cache key and the headers.

## 5. Rendition backfill

- **PR delivery:** PR-B.
- **Outcome:** the media worker upgrades retained ready versions in the background, after pending work. Eligibility comes from the sizes each page's dimensions call for, and attempts are tracked in their own table. It never changes existing previews, versions, commands or decode results, skips a dimension mismatch, and retries an interrupted attempt only on a later run, within a three-attempt cap.
- **Scope:**
  - a migration adding `media_rendition_backfill`, with its partial unique claim index and worker grants;
  - the `media-renditions/1` decoder input in `decoder-protocol.ts`, `decode.ts` and `decoder-runner.ts`;
  - in `media/worker.ts`: eligibility, claiming, abandoned-claim recovery and owner-checked rendition-only publication;
  - snapshot reads, which must not change;
  - adding the backfill table to the rollback procedure.
- **Prerequisites:** task 2.
- **Acceptance:** Media rendition backfill (upgrade, request before backfill, interrupted, source changed).
- **Approach:** as in design ("Backfill renders from the retained page, per preview, with claimed attempts").
- **Verification:** PostgreSQL tier, plus a run against a copy of retained development data. Never run it against the live namespace without a backup.

- [ ] 5.1 RED: add PostgreSQL tests for:
  - an upgrade with an unchanged `preview_id`, bytes, version count, decode state and command count;
  - deferral to pending commands;
  - a dimension mismatch;
  - small pages never selected;
  - a mixed-size PDF;
  - an interrupted attempt retried only on a later run and capped;
  - two concurrent workers never claiming one preview;
  - an abandoned claim recovered after expiry, and a stale owner refused at publication;
  - a retained page whose bytes don't match its recorded digest, skipped;
  - a derived version's recipe backfill.
- [ ] 5.2 GREEN: implement the attempt table, eligibility, claiming and rendition-only publication, with `renditions_backfilled`/`renditions_skipped_mismatch` logs.
- [ ] 5.3 Run the backfill against a copy of a retained development namespace, confirm every ready page gains renditions, and record counts for the PR.
- [ ] 5.4 Update `docs/development.md` to say retained media upgrades in the background after restart.

## 6. Frontend preview selection

- **PR delivery:** PR-C.
- **Outcome:** each image surface uses its usage profile (thumbnail, card, viewer, full) through one helper. Images declare their size and load lazily where offscreen, the viewer switches to full past the `view` resolution, the crop dialog keeps full-resolution coordinates, and missing sizes fall back.
- **Scope:** `frontend/src/media/types.ts`; the image interfaces of `EvidenceTile` and `RotatedCropSelection`, which change from a URL to image attributes; `BatchThumbnail`'s inbox thumbnail data; and the surfaces in the design's usage table: `BatchThumbnail`, `NeedsYou`, `QuestionCard`, `ExamineView`, `LotObservations`, `UnassignedObservations`, `proposed-lots.ts`, `MediaEvidenceCard`, `EvidenceFileTile`, `EvidenceViewer`, `MediaCropDialog`, `ProcessingImages`.
- **Prerequisites:** tasks 3 and 4.
- **Acceptance:** Media previews fit their surface (all scenarios).
- **Approach:** as in design ("The frontend picks a size per surface"). Touch only image elements, to limit overlap with `redesign-batch-workspace` restyling.
- **Verification:** `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend`, `pnpm build`. For the manual check, record transferred bytes from a phone on `pnpm dev --tailscale` before and after.

- [ ] 6.1 RED: add helper tests (`srcSet`/`sizes` per usage, the full page never in `srcSet`, fallback with no renditions) and surface tests: attributes reaching the real `<img>` in `BatchThumbnail`, `EvidenceTile` and `RotatedCropSelection`; thumbnail and card sizes requested; the viewer switching both attributes to full on zoom at 3× density; crop selection coordinates unchanged over `view`.
- [ ] 6.2 GREEN: implement the helper and adopt it on every listed surface.
- [ ] 6.3 Run the frontend checks and build; record the byte-transfer comparison and a demo recording for the PR.

## Delivery evidence and lifecycle follow-up

- [ ] D.1 PR-A: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization.
- [ ] D.2 PR-B: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization.
- [ ] D.3 PR-C: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization.
- [ ] D.4 After all PRs merge with acceptance evidence, update BI-013's status in the index. Archive only when authorized, after `pnpm openspec:overlap --change add-preview-renditions`.
