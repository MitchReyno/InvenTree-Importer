# Implementation notes

PR-A (tasks 1–3) is in progress on `feat/add-preview-renditions-server`; PR-B and PR-C remain.

## Changes to the plan

None.

## Unexpected challenges

- **2026-11-07T23:20+11:00, task 1:** Synthetic 50 MP test photos with per-pixel noise produce lossless pages of 110–130 MiB, above the 64 MiB output bound, so they end `limit_exceeded` on the pre-change decoder too. That is existing behavior, not a rendition cost. Timing used a smooth 50 MP image instead, since resize and WebP encode time follow pixel count rather than content.

## Decisions made during implementation

- **2026-11-07T23:20+11:00, task 1:** `MEDIA_TOOLCHAIN` gains `;webp/1`. It is recorded only as the informational `decoder_build`, so new decodes now say they include WebP output. Rejected: leaving it unchanged, which would misdescribe the outputs.
- **2026-11-07T23:20+11:00, task 1:** WebP `effort` stays at 4. Through the real container, a 30-page PDF with 90 renditions took 10.3 s, against 4.7 s before, and a 50 MP photo 2.2 s, both well inside the inner 25 s bound.
- **2026-11-07T23:20+11:00, task 1:** The output budget is a parameter of `rendered()`, so the limit path is tested without a 96 MiB fixture.

## Open items

None yet.
