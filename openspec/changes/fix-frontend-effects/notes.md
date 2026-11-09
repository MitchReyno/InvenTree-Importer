# Implementation notes

Fixes for the #180 Effects audit, delivered as three stacked PRs (E1, E2, E3) on top of #183. E1 is in progress.

## Changes to the plan

- **2026-11-09T20:49+11:00, task 1 (E1):** Items 1 and 2 planned a failing-first test for a late dirty report. It cannot fail: React 19 flushes passive Effects synchronously after a discrete event, so the Effect-based report already reached the guard before the event returned. Both are fixed to follow the guideline, with characterization tests instead. `tasks.md` is unchanged, because its acceptance still holds.
- **2026-11-09T20:49+11:00, task 1 (E1):** Item 11, `MediaCropDialog`'s dirty half, moves to task 7. It shares one Effect with the `showModal` call that task 7 fixes, and changing it twice would split one decision across two PRs. The task map in `tasks.md` is updated.

- **2026-11-09T22:28+11:00, task 1 (E1):** The design allowed React Hook Form editors to keep a subscription-driven report for a typed-back `isDirty`. None does: each compares `getValues()` with its baseline in the form's `onChange`. `design.md` and `tasks.md` now say so, and list the three report Effects that remain for a saved value catching up with a draft: `useDraft`, `EvidenceGroup` and `InstructionField`.

## Unexpected challenges

- **2026-11-09T20:49+11:00, task 1:** `DismissWarning` and `BulkEditPanel` re-latched the guard after a confirmed save. Their report Effect reran when `pending` flipped or the panel reloaded, and reported the still-filled form as dirty. Both now report from the form's `onChange`, comparing values with their defaults, and their tests fail on the old code. `QuickLotEdit` uses the same approach.
- **2026-11-09T20:49+11:00, task 2:** `ExamineView` left the guard latched when it unmounted, or after a confirmed reading save. It now uses `useDirtySources`, and ReadingEdit reports from its handlers and after a confirmed save.

- **2026-11-09T20:57+11:00, task 2:** The audit's low-confidence `EvidenceGroup` finding holds: a polled rename replaced a dirty draft. It now adopts a new name only while the draft is clean, or when the name is the draft's own trimmed rename. Without that second case a rename typed with spaces stayed dirty forever; the test caught it.
- **2026-11-09T20:57+11:00, task 3:** A derived `useDraft` must drop its draft once the saved value catches up. Otherwise a later save resurrects the stale draft as dirty. A guarded render-time adjustment clears it.

## Decisions made during implementation

- **2026-11-09T20:57+11:00, task 2:** `InstructionForm` takes a plain `(dirty) => void` instead of `(key, dirty)`. Its only caller passes the stable `forSource` callback, so the form reports from its `onChange` and releases on unmount like the other editors.
- **2026-11-09T20:57+11:00, task 3:** `useDraft` and `EvidenceGroup` keep a report Effect for one case: a saved value that catches up with the draft, which has no event in the component. Handlers report every other change.
- **2026-11-09T21:18+11:00, task 1:** `TellExamine` keeps one report Effect, for its form being hidden by a poll, and reports typing and sending from its handlers. `RestructureDialog` reports entirely from handlers: the form's `onChange` compares the values with the opening defaults, and the add and remove row buttons report after changing the field array. Keeping its Effect was considered and rejected in review, because a change that leaves `isDirty` unchanged could leave the guard latched.
- **2026-11-09T21:18+11:00, tasks 1–3:** A confirmed command resets its editor to the confirmed values before releasing the guard (`BulkEditPanel`, `DismissWarning`, `InstructionForm`, `QuickLotEdit` and ExamineView's ReadingEdit). Without that, a parent replacing its callback during the follow-up reload heard the stale draft as dirty. After a confirmed bulk apply the panel therefore returns to "Keep".

- **2026-11-09T21:18+11:00, task 3:** `InstructionField` follows the same rule as `useDraft`: a draft equal to the saved text is dropped, both when typed back and when the saved text catches up. Independent review found the first version kept a stale draft.

## Open items

None yet.
