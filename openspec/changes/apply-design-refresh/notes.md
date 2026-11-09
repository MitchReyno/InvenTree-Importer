# Implementation notes

The design refresh is delivered in bundles PR-A to PR-G. This file records departures, decisions and open items as each task is implemented.

## Task 10: direct upload

### Changes to the plan

- **2026-11-10T01:19+11:00, task 10 (PR-F):** D5 named four per-file states. Two more were needed, and the `capture-grouped-evidence` delta spec now lists them:
  - **"Added. The current evidence could not be read" with Read again.** The server kept the file but the follow-up read failed. Read again is queued in turn, so it never runs alongside an upload and never sends the file again.
  - **"Added to Ungrouped. Moving it into its group was not confirmed" with Dismiss.** The move into the chosen group was refused or left unconfirmed.
- **2026-11-10T01:19+11:00, task 10 (PR-F):** An earlier move left unconfirmed or refused still owns the media command and the selection. A later file in the queue then stays in Ungrouped, with the same notice, rather than replacing that selection or attempting a move the command would refuse.
- **2026-11-10T01:19+11:00, task 10 (PR-F):** The "Original retained · N bytes" status line went with the Retain step; the file now appears in its group.
- **2026-11-10T01:19+11:00, task 10 (PR-F):** The `@invimport/contracts` media module now exports `isMediaLabel` and `isMediaSourceSize`, used by the contracts upload client and the browser queue.
  - **Why the queue needs them:** the client throws a plain error for a bad name, which the queue would classify as uncertain, leaving the file "Upload not confirmed" for good. The queue now refuses the file locally as "Not added".
  - **Server unchanged:** the server keeps its own route check.

### Decisions made during implementation

- **2026-11-10T01:19+11:00, task 10:** The queue is a hook (`media/useUploadQueue.ts`) owned by `MediaWorkspace`, not by `MediaUpload`, so group panels read tiles and "Uploading N of M" from the same state without a child-to-parent Effect. `MediaUpload` keeps only the pickers.
- **2026-11-10T01:19+11:00, task 10:** Each queued file is a tile in its target group's evidence grid, as the canvas shows. The tile moves to the ungrouped grid if its group has gone. Focus handling:
  - Retry and Read again keep focus on the tile.
  - Dismiss moves focus to a neighbouring tile, else the group region.
  - Refusals are `role="alert"`; other states are `role="status"`.
- **2026-11-10T01:19+11:00, task 10:** Revision refusals and failed reads:
  - **First 412:** the queue re-reads the revision and sends once more with a new key. A second 412 means "Not added".
  - **Revision read fails before sending:** the file is "Not added", because nothing was sent.
  - **Retry after a lost response:** resends the identical request first.
- **2026-11-10T01:19+11:00, task 10 (coordinator):** "Upload not confirmed" offers Retry only, with no Discard. The upload may not be on the server, so navigation protection stays on until a Retry settles it.
- **2026-11-10T01:19+11:00, task 10 (coordinator):** The "Added to Ungrouped" tile stays in its target group, where the operator expected the file, while the file itself appears in Ungrouped. It clears once a later read shows the file in that group.

### Open items

None for task 10.
