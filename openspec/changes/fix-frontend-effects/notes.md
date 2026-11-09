# Implementation notes

Fixes for the #180 Effects audit, delivered as three stacked PRs (E1, E2, E3) on top of #183. E1 is in progress.

## Changes to the plan

- **2026-11-09T20:49+11:00, task 1 (E1):** Items 1 and 2 planned a failing-first test for a late dirty report. It cannot fail: React 19 flushes passive Effects synchronously after a discrete event, so the Effect-based report already reached the guard before the event returned. Both are fixed to follow the guideline, with characterization tests instead.
- **2026-11-09T20:49+11:00, task 1 (E1):** Item 11, `MediaCropDialog`'s dirty half, moves to task 7. It shares one Effect with the `showModal` call that task 7 fixes, and changing it twice would split one decision across two PRs. The task map in `tasks.md` is updated.

- **2026-11-09T22:28+11:00, task 1 (E1):** The design allowed React Hook Form editors to keep a subscription-driven report for a typed-back `isDirty`. None does: each compares `getValues()` with its baseline in the form's `onChange`. `design.md` and `tasks.md` now say so, and list the three report Effects that remain for a saved value catching up with a draft: `useDraft`, `EvidenceGroup` and `InstructionField`.

## Unexpected challenges

- **2026-11-09T20:49+11:00, task 1:** `DismissWarning` and `BulkEditPanel` re-latched the guard after a confirmed save. Their report Effect reran when `pending` flipped or the panel reloaded, and reported the still-filled form as dirty. Both now report from the form's `onChange`, comparing values with their defaults, and their tests fail on the old code. `QuickLotEdit` uses the same approach.
- **2026-11-09T20:49+11:00, task 2:** `ExamineView` left the guard latched when it unmounted, or after a confirmed reading save. It now uses `useDirtySources`, and ReadingEdit reports from its handlers and after a confirmed save.

- **2026-11-09T20:57+11:00, task 2:** The audit's low-confidence `EvidenceGroup` finding holds: a polled rename replaced a dirty draft. It now adopts a new name only while the draft is clean, or when the name is the draft's own trimmed rename. Without that second case a rename typed with spaces stayed dirty forever; the test caught it.
- **2026-11-09T20:57+11:00, task 3:** A derived `useDraft` must drop its draft once the saved value catches up. Otherwise a later save resurrects the stale draft as dirty. A guarded render-time adjustment clears it.
- **2026-11-09T22:48+11:00, task 3:** Review round 4 found that `InstructionField` released the guard when its saved text dropped out after load, such as a failed or paused read or a newer batch revision, while the typed draft was still shown. Dirty no longer depends on the text being loaded, so the draft stays guarded; Save stays disabled until the text is readable again. A regression test fails on the old code.
- **2026-11-09T23:06+11:00, task 1 (review round 5):** `ExamineView`'s ReadingEdit compares its draft with readings that arrive by poll, so a reload can make it clean (an unconfirmed save the server applied) or dirty (a region read again) with no event in the component. Only its handlers reported, so the guard kept the stale value. It keeps a commented report Effect for that case, and two tests fail on the previous code.
- **2026-11-09T23:15+11:00, task 1 (review round 6):** After one confirmed save, ReadingEdit's confirmed baseline hid every later poll, so the round-5 bug returned. The confirmed values are now the baseline only until the readings they were saved over change; then the polled readings are the baseline again, as before any save.
- **2026-11-09T23:22+11:00, task 1 (review round 7):** ReadingEdit saves trimmed markings without empty ones but kept the raw draft, so once the batch reloaded the saved form an untidy draft read as unsaved again. A confirmed save now puts the saved form into the draft.
- **2026-11-09T23:34+11:00, task 1 (review round 8):** ReadingEdit now compares the form Save would send (trimmed, without empty markings) with its baseline, so spacing or an empty marking is not an unsaved change and an untidy unconfirmed draft is released when the readings catch up. The review rounds 5–7 entries say readings arrive by poll; in the app Processing remounts on each revision, so these paths cover the component's prop contract rather than an observed one.

## Decisions made during implementation

- **2026-11-09T20:57+11:00, task 2:** `InstructionForm` takes a plain `(dirty) => void` instead of `(key, dirty)`. Its only caller passes the stable `forSource` callback, so the form reports from its `onChange` and releases on unmount like the other editors.
- **2026-11-09T20:57+11:00, task 3:** `useDraft` and `EvidenceGroup` keep a report Effect for one case: a saved value that catches up with the draft, which has no event in the component. Handlers report every other change.
- **2026-11-09T21:18+11:00, task 1:** `TellExamine` keeps one report Effect, for its form being hidden by a poll, and reports typing and sending from its handlers. `RestructureDialog` reports entirely from handlers: the form's `onChange` compares the values with the opening defaults, and the add and remove row buttons report after changing the field array. Keeping its Effect was considered and rejected in review, because a change that leaves `isDirty` unchanged could leave the guard latched.
- **2026-11-09T21:18+11:00, tasks 1–3:** A confirmed command resets its editor before releasing the guard. `InstructionForm` and `QuickLotEdit` reset to the confirmed values, `BulkEditPanel` and `DismissWarning` reset to their empty defaults, and ExamineView's ReadingEdit records the confirmed values as its baseline. Without that, a parent replacing its callback during the follow-up reload heard the stale draft as dirty. After a confirmed bulk apply the panel therefore returns to "Keep".

- **2026-11-09T21:18+11:00, task 3:** `InstructionField` follows the same rule as `useDraft`: a draft equal to the saved text is dropped, both when typed back and when the saved text catches up. Independent review found the first version kept a stale draft.

## Open items

- **2026-11-09T23:34+11:00:** Outside this change, `ExamineView` calls `useRef` after an early return when it has no observations, which breaks the Rules of Hooks if its observations go between empty and non-empty without a remount. Found in review; not fixed here.
