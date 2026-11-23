# Implementation notes

Task 1 (dialogs close from their backdrop) is delivered through PR-A. The other tasks remain.

## Changes to the plan

None.

## Unexpected challenges

- **2026-11-23T17:40+11:00, task 1 (PR-A):** Task 1.1's inventory of `Dialog` users is wider than the design lists: `RestructureDialog` and `CompareMatches` also use `Dialog`, besides `RemovalDialog`, `EvidenceGroupPanel` and the session drawer. All close through `onClose` with `closeDisabled` for pending or dirty work, so they get the backdrop click with no change. `MediaCropDialog` is still the only direct `DialogSurface` user.

## Decisions made during implementation

- **2026-11-23T17:40+11:00, task 1 (PR-A):** The design's "outside its content box" is read as outside the dialog's border box (`getBoundingClientRect`), since a press on the surface's padding must not count and the padding lies outside the content box. The check lives in `ui/useBackdropClick.ts`, which both `Dialog` and `MediaCropDialog` use.
- **2026-11-23T17:40+11:00, task 1 (PR-A):** `MediaCropDialog` ignores Esc, and its Discard and close button drops even an uncertain request. Its backdrop click uses the guard its native close already applies instead: an unsent or confirmed view closes, and a pending or uncertain request stays open until explicitly discarded. Following the Discard button was rejected because a stray click would drop an unconfirmed request's identity.

## Open items

None.
