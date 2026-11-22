# Implementation notes

Implementation of `bound-agent-evidence-images` (BI-018) started with PR-A (tasks 1 to 3). PR-B (tasks 4 to 6) remains.

## Changes to the plan

- **2026-11-22T22:56+11:00, task 2 (PR-A):** The design had `regionCropCache` gain a bounded size with its own cache key. The handler bounds the cache's full-size crop instead, so the cache, its keys and its UI caller in `media/content.ts` are unchanged, at the cost of one resize per large region fetch. Tasks and design updated.

## Unexpected challenges

- **2026-11-22T23:32+11:00, task 2 (PR-A):** Review found that bounding pixels didn't bound bytes: a detailed 1,650 px PNG was about 8 MB, over Claude's 10 MB once base64-encoded and over the 2 MiB relay frame. Every delivery now has a 1.25 MiB cap, with PNG then falling JPEG quality. Review also found that the merged path checked removal only before the read, where the old original path checked it at the read; removal is now checked again after encoding. Spec, design and tasks updated.

## Decisions made during implementation

- **2026-11-22T22:56+11:00, task 2:** A lot session's pinned derived versions stay fetchable: the lead session's originals-only filter now applies to Examine only, since the merged path would otherwise have refused derived versions the old original branch served. Undecoded and encrypted versions never reach `fetch_evidence`: a lot manifest refuses them as `media_not_ready` and Examine leaves them out. The fetch-time refusal is for a requested page without a preview, tested as page 2 of a one-page photo.

## Open items

- **A JSON-RPC batch of several `fetch_evidence` calls can outgrow a VM relay frame.** The relay gives the larger evidence reply limit only to a standalone `fetch_evidence` request, so a batch whose images together exceed the default frame fails after the host has recorded delivery. This predates the change (the old path sent originals of up to 8 MiB), and the provider CLIs send single requests. Refusing batches that contain `fetch_evidence` is a follow-up. Found in PR-A's review, 2026-11-22T23:45+11:00.
