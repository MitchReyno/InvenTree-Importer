# Implementation notes

Fixes for the #180 Effects audit, delivered as three stacked PRs (E1, E2, E3) on top of #183. E1, E2 and E3 are implemented and awaiting independent review.

## Changes to the plan

- **2026-11-09T20:49+11:00, task 1 (E1):** Items 1 and 2 planned a failing-first test for a late dirty report. It cannot fail: React 19 flushes passive Effects synchronously after a discrete event, so the Effect-based report already reached the guard before the event returned. Both are fixed to follow the guideline, with characterization tests instead. `tasks.md` is unchanged, because its acceptance still holds.
- **2026-11-09T20:49+11:00, task 1 (E1):** Item 11, `MediaCropDialog`'s dirty half, moves to task 7. It shares one Effect with the `showModal` call that task 7 fixes, and changing it twice would split one decision across two PRs. The task map in `tasks.md` is updated.

- **2026-11-09T21:35+11:00, task 4 (E2):** Audit item 25 is dropped. (a) If a draft is dirty when lots first appear, Review skips its automatic first lot. A fix would auto-open a lot later, after the operator has started working, moving the view under them. (b) Moving focus to the queue when polling retires the focused lot is correct, because the focused evidence disappears with it. `tasks.md` records the decision in 4.4.

- **2026-11-09T21:49+11:00, task 9 (E3):** Audit item 28 (`SearchableReferencePicker`) is dropped. The picker is a design-system form control that receives a `search` function and knows nothing of batches, models or server scope. A TanStack query inside it would couple the `forms` barrel to server state and every caller's key. Its Effect already synchronizes a timer and a request with a generation guard, which the guidelines allow. The part of the finding that holds is listed under open items.
- **2026-11-09T21:49+11:00, task 9 (E3):** Session status lines use a query keyed by the capture revision (`processing`, batch, `status`, revision) rather than sharing `ProcessingWorkspace`'s key. That query's function records its own successful-read state, and a different function on the same key would mix the two. A revision change is a new key, so it reads again with no Effect; previous lines stay as placeholder data until it arrives.

## Unexpected challenges

- **2026-11-09T20:49+11:00, task 1:** `DismissWarning` and `BulkEditPanel` re-latched the guard after a confirmed save. Their report Effect reran when `pending` flipped or the panel reloaded, and reported the still-filled form as dirty. Both now report from the form's `onChange`, comparing values with their defaults, and their tests fail on the old code. `QuickLotEdit` uses the same approach.
- **2026-11-09T20:49+11:00, task 2:** `ExamineView` left the guard latched when it unmounted, or after a confirmed reading save. It now uses `useDirtySources`, and ReadingEdit reports from its handlers and after a confirmed save.

- **2026-11-09T20:57+11:00, task 2:** The audit's low-confidence `EvidenceGroup` finding holds: a polled rename replaced a dirty draft. It now adopts a new name only while the draft is clean, or when the name is the draft's own trimmed rename. Without that second case a rename typed with spaces stayed dirty forever; the test caught it.
- **2026-11-09T20:57+11:00, task 3:** A derived `useDraft` must drop its draft once the saved value catches up. Otherwise a later save resurrects the stale draft as dirty. A guarded render-time adjustment clears it.

- **2026-11-09T21:35+11:00, task 7:** `Dialog`'s StrictMode focus loss depends on inertness, which jsdom does not model. Stubbing `focus` to ignore elements outside an open modal reproduces it, and the test fails on the old code. The fix was also checked in headless Chromium against a temporary StrictMode copy of the component gallery: focus returned to the opener, and with the old `Dialog` it fell to the page body. The temporary page was not committed.
- **2026-11-09T21:35+11:00, task 8:** Items 22 and 23 had no observable bug in jsdom. The old Effects reached the same end state one render later, so their tests are characterization tests. Item 21 had one: a `MutationObserver` shows the old code inserting the "pinned question is unavailable" text for a commit.

- **2026-11-09T21:49+11:00, task 9:** `ChatGPTSignIn` had no observable bug: the old interval Effect passes the new polling tests. The rewrite follows the guideline, and its tests are characterization tests. A request's result now starts a new polling generation, because bumping the generation before the request captured the old account as the new key's initial data.

- **2026-11-09T22:24+11:00, task 10:** Only items 34 and 35 had observable bugs (`useMediaQuery` resubscribed on every render; `ReviewMap` committed an extra render for an unchanged layout); their tests fail on the old code. The old `EvidenceViewer` density Effect already re-armed on each change, so the pixel-ratio, callback-ref, mounted-ref, draft-generation and `LiveUpdates` tests are characterization tests.
- **2026-11-09T22:24+11:00, task 9:** Independent review found the sign-in query stayed enabled after an error or once the login finished, so app-wide reconciliation refetched it. It now enables itself from its own state, and its key carries a per-mount ID. Session status no longer shows a failed read's last lines as placeholder data for the next revision.

## Decisions made during implementation

- **2026-11-09T20:57+11:00, task 2:** `InstructionForm` takes a plain `(dirty) => void` instead of `(key, dirty)`. Its only caller passes the stable `forSource` callback, so the form reports from its `onChange` and releases on unmount like the other editors.
- **2026-11-09T20:57+11:00, task 3:** `useDraft` and `EvidenceGroup` keep a report Effect for one case: a saved value that catches up with the draft, which has no event in the component. Handlers report every other change.
- **2026-11-09T21:18+11:00, task 1:** `TellExamine` keeps one report Effect, for its form being hidden by a poll, and reports typing and sending from its handlers. `RestructureDialog` reports entirely from handlers: the form's `onChange` compares the values with the opening defaults, and the add and remove row buttons report after changing the field array. Keeping its Effect was considered and rejected in review, because a change that leaves `isDirty` unchanged could leave the guard latched.
- **2026-11-09T21:18+11:00, tasks 1–3:** A confirmed command resets its editor to the confirmed values before releasing the guard (`BulkEditPanel`, `DismissWarning`, `InstructionForm`, `QuickLotEdit` and ExamineView's ReadingEdit). Without that, a parent replacing its callback during the follow-up reload heard the stale draft as dirty. After a confirmed bulk apply the panel therefore returns to "Keep".

- **2026-11-09T21:18+11:00, task 3:** `InstructionField` follows the same rule as `useDraft`: a draft equal to the saved text is dropped, both when typed back and when the saved text catches up. Independent review found the first version kept a stale draft.

- **2026-11-09T21:35+11:00, task 5:** `Batch`'s `edit` resolves with the accepted snapshot, or `false`, so `ReviewMapStage` finds the lot it created in the handler that created it. `CaptureEdit`'s type includes the snapshot; its contract is still that `false` means not saved.
- **2026-11-09T21:35+11:00, task 5:** The evidence workspace's confirmation counter is replaced by an `onConfirmed` callback passed to `edit`. It is stored with the retained intent, so an exact retry closes the editor that sent the request. Broadcasting to every listener was rejected because it closed editors that had sent nothing.
- **2026-11-09T21:35+11:00, task 6:** The save queue's `LaneSpec` gains `onRejected`, called once when the server definitely refuses a lane's payload. The logo lane uses it to show its refusal and discard; the unconfirmed-upload message is derived from queue state in render.

- **2026-11-09T21:49+11:00, task 10:** `LiveUpdates` reconciles through `useOnForeground`, which also fires when a hidden tab becomes visible again; it previously listened only for focus and reconnection. A returning tab is when retained reads are most likely stale.

## Open items

- `useCatalogue.search` does not pass the picker's `AbortSignal` to the catalogue client, so an abandoned search still completes on the network; its result is dropped. The generated client would need to accept a signal. Not tracked elsewhere yet.
