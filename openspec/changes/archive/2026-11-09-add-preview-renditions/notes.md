# Implementation notes

PR-A (tasks 1–3) merged in [#140](https://github.com/MitchReyno/InvenTree-Importer/pull/140), PR-B (tasks 4–5) in [#143](https://github.com/MitchReyno/InvenTree-Importer/pull/143), and PR-C (task 6) in [#144](https://github.com/MitchReyno/InvenTree-Importer/pull/144).

## Changes to the plan

- **2026-11-07T23:50+11:00, task 3 (PR-A):** The "same URL returns WebP once renditions exist" check moved to task 5. Only the backfill can add renditions to a page that already has a full preview, because renditions are otherwise written in the same decode. PR-A tests the fallback on a small page and WebP on a large one.
- **2026-11-07T23:50+11:00, task 3 (PR-A):** The observation-crop route has no declaration in `contracts/scripts/generate.cjs` today. Task 4.3 will add one rather than edit one; `tasks.md` is unchanged because its check ("only that route's declaration changed") still holds.

## Unexpected challenges

- **2026-11-07T23:20+11:00, task 1:** Synthetic 50 MP test photos with per-pixel noise produce lossless pages of 110–130 MiB, above the 64 MiB output bound, so they end `limit_exceeded` on the pre-change decoder too. That is existing behavior, not a rendition cost. Timing used a smooth 50 MP image instead, since resize and WebP encode time follow pixel count rather than content.

## Decisions made during implementation

- **2026-11-07T23:20+11:00, task 1:** `MEDIA_TOOLCHAIN` gains `;webp/1`. It is recorded only as the informational `decoder_build`, so new decodes now say they include WebP output. Rejected: leaving it unchanged, which would misdescribe the outputs.
- **2026-11-07T23:20+11:00, task 1:** WebP `effort` stays at 4. Through the real container, a 30-page PDF with 90 renditions took 10.3 s, against 4.7 s before, and a 50 MP photo 2.2 s, both well inside the inner 25 s bound.
- **2026-11-07T23:20+11:00, task 1:** The output budget is a parameter of `rendered()`, so the limit path is tested without a 96 MiB fixture.
- **2026-11-07T23:55+11:00, task 2:** Rollback was qualified with a three-phase run across builds rather than a single test, because only the pre-change checkout can back up and restore its schema. The pre-change build refused the upgraded database, restored its archive as `restored-quarantined`, and accepted the restored copy. The same media fixture and owned `pg_dump` tools were used as `tests/pg/operations.test.ts`.
- **2026-11-08T00:05+11:00, PR-A review:** `If-None-Match` uses RFC 9110 weak comparison over the whole list (`*`, `W/` tags, several tags), still after authorization. A publication-failure test now injects a fault after the page and first rendition are written, and confirms no result, page or rendition commits and the written bytes are unreferenced orphans.
- **2026-11-08T00:22+11:00, task 4 (PR-B):** Agent evidence delivery keeps receiving the full-size PNG region crop; it reads `.bytes` from the crop cache's new `{ bytes, mediaType }` result. Sized crops are for display only.
- **2026-11-08T00:22+11:00, task 5 (PR-B):** The worker loop's single pass became `mediaWorkerStep()`, so "a waiting decode runs before a backfill" is tested directly rather than only through `media-main`. The backfill tests reproduce media decoded before renditions existed by clearing the rendition rows as the owner, with the immutability trigger disabled for that statement only.
- **2026-11-08T00:22+11:00, task 5 (PR-B):** "One worker pauses between selection and insertion" is covered two ways: concurrent workers racing for one page, and a worker paused mid-attempt whose claim another worker recovers. The paused worker then publishes nothing. The per-preview advisory lock with an eligibility recheck is what makes a stale candidate list harmless.
- **2026-11-08T00:39+11:00, PR-B review:** The worker keeps its 500 ms pause after every decode, because an interrupted decode still reports as handled; only a backfill that made progress runs straight on (`pauseAfter()`). Backfill failures are contained in `mediaWorkerStep()`, while a thrown decode still stops the media worker as it did before.
- **2026-11-08T01:18+11:00, task 6 (PR-C):** `EvidenceTile` accepts either a URL or image attributes, so the component gallery's string fixtures keep working. `ProcessingImages`' open link already pointed at the full page and is unchanged. The viewer measures its stage with a `ResizeObserver`, falling back to `clientWidth`, and drops `loading="lazy"` for the image being inspected.

## Open items

None.
