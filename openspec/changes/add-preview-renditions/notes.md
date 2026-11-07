# Implementation notes

PR-A (tasks 1–3) is in progress on `feat/add-preview-renditions-server`; PR-B and PR-C remain.

## Changes to the plan

- **2026-11-08T00:20+11:00, task 3 (PR-A):** The "same URL returns WebP once renditions exist" check moved to task 5. Only the backfill can add renditions to a page that already has a full preview, because renditions are otherwise written in the same decode. PR-A tests the fallback on a small page and WebP on a large one.
- **2026-11-08T00:20+11:00, task 3 (PR-A):** The observation-crop route has no declaration in `contracts/scripts/generate.cjs` today. Task 4.3 will add one rather than edit one; `tasks.md` is unchanged because its check ("only that route's declaration changed") still holds.

## Unexpected challenges

- **2026-11-07T23:20+11:00, task 1:** Synthetic 50 MP test photos with per-pixel noise produce lossless pages of 110–130 MiB, above the 64 MiB output bound, so they end `limit_exceeded` on the pre-change decoder too. That is existing behavior, not a rendition cost. Timing used a smooth 50 MP image instead, since resize and WebP encode time follow pixel count rather than content.

## Decisions made during implementation

- **2026-11-07T23:20+11:00, task 1:** `MEDIA_TOOLCHAIN` gains `;webp/1`. It is recorded only as the informational `decoder_build`, so new decodes now say they include WebP output. Rejected: leaving it unchanged, which would misdescribe the outputs.
- **2026-11-07T23:20+11:00, task 1:** WebP `effort` stays at 4. Through the real container, a 30-page PDF with 90 renditions took 10.3 s, against 4.7 s before, and a 50 MP photo 2.2 s, both well inside the inner 25 s bound.
- **2026-11-07T23:20+11:00, task 1:** The output budget is a parameter of `rendered()`, so the limit path is tested without a 96 MiB fixture.
- **2026-11-07T23:55+11:00, task 2:** Rollback was qualified with a three-phase run across builds rather than a single test, because only the pre-change checkout can back up and restore its schema. The pre-change build refused the upgraded database, restored its archive as `restored-quarantined`, and accepted the restored copy. The same media fixture and owned `pg_dump` tools were used as `tests/pg/operations.test.ts`.
- **2026-11-08T00:55+11:00, PR-A review:** `If-None-Match` uses RFC 9110 weak comparison over the whole list (`*`, `W/` tags, several tags), still after authorization. A publication-failure test now injects a fault after the page and first rendition are written, and confirms no result, page or rendition commits and the written bytes are unreferenced orphans.

## Open items

None yet.
