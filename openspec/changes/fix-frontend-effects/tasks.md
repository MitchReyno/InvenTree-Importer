# Implementation and delivery tasks

## Plan context

- Change: `fix-frontend-effects`. Proposal: `proposal.md`. Design: `design.md`.
- Specs: skipped (`skip_specs: true`). The fixes bring code into line with existing documented requirements and the frontend guidelines; no requirement text changes.
- Linked BI items: none. This is maintenance from the #180 Effects audit.
- Audit item numbers (1–35) refer to the audit list delivered with #180's follow-up request. Each task names the items it covers.
- Stacked on the three refactor PRs: #181 (shared hooks), #182 (API clients context) and #183 (batch commands context).

## Completion and commit ordering

Check an action off only after it is done and verified, and stage that `tasks.md` update in the same commit as the work. Review, publication and merge actions stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Audit items | Prerequisites |
| --- | --- | --- | --- |
| 1. Dirty reporting from input events | Behavioural fix | 1, 2, 9, 10 (report Effects) | #183 |
| 2. Guard release and source aggregation | Behavioural fix | 3, 4, 5, 10 (EvidenceGroup) | #183 |
| 3. Derived drafts | Behavioural fix | 6, 7, 8 | #183 |
| 4. Review quick-edit request (J/K) | Bug fix, visible | 12, 25 | Task 1–3 PR |
| 5. Commands from handlers | Behavioural fix | 13, 14 | Task 1–3 PR |
| 6. Batch settings Effects | Behavioural fix | 15, 16, 17, 18 | Task 1–3 PR |
| 7. Modal dialog lifecycle | Behavioural fix | 11, 19 | Task 1–3 PR |
| 8. Derived workspace state | Behavioural fix | 20, 21, 22, 23, 24 | Task 1–3 PR |
| 9. Server reads through TanStack Query | Behavioural fix | 26, 27, 28 | Task 4–8 PR |
| 10. Shared sync hooks | Refactor with fixes | 29, 30, 31, 32, 33, 34, 35 | Task 4–8 PR |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | The guard hears dirty from events and is always released; drafts derive from saved values | Tasks 1–3 | One concern, the navigation guard and draft ownership, reviewed against one rule set | #183 | Base #183's branch; `fix/fix-frontend-effects-dirty`; `fix(fix-frontend-effects): report dirty from events and derive drafts` | Owning checks green; regression per item; clean independent review |
| E2 | J/K works after E; commands and copied state move out of Effects | Tasks 4–8 | Behaviour bugs and command authority, which need the edit-snapshot change and a demo of the visible fix | E1 | Base E1; `fix/fix-frontend-effects-commands`; `fix(fix-frontend-effects): send commands from handlers and fix J/K after E` | As E1, plus a demo recording of J/K and browser evidence for the dialog focus fix |
| E3 | Server reads and browser state use their owning APIs | Tasks 9–10 | Subscriptions and reads share the query and sync-hook patterns | E2 | Base E2; `fix/fix-frontend-effects-sync`; `fix(fix-frontend-effects): move reads and subscriptions to their owning APIs` | As E1 |

## 1. Dirty reporting from input events

- PR delivery: E1.
- Outcome: each editor reports dirty in the handler that changes its draft, so the guard blocks navigation without waiting a render.
- Scope and approach: `ExcludeLot` (1), `ExamineView` ReadingEdit (2), and the report Effects in `BulkEditPanel`, `DismissWarning`, `QuickLotEdit`, `RestructureDialog`, `RegionStage` and `AskControl` (10). Also `TellExamine` (9). Use the "report dirty from the event" decision; keep a commented Effect only where no event exists.
- Prerequisites: #183.
- Acceptance: typing into each editor blocks a hash change synchronously; reverting to the saved value releases the guard; a hidden `TellExamine` form is clean.
- TDD approach: a guard test without `waitFor` fails before the change for items 1 and 2, then passes.
- Verification: the owning checks; the new and existing component tests.
- Risks and decisions: React Hook Form's typed-back `isDirty` has no input event. It keeps a subscription-driven report, which the design allows.

- [x] 1.1 Re-read each named file, confirm the finding still applies, and record any dropped finding in `notes.md`.
- [x] 1.2 RED: add synchronous-guard regressions for `ExcludeLot` and `ExamineView` ReadingEdit, and confirm they fail.
- [x] 1.3 GREEN: move reporting into handlers in every file listed, keeping commented exceptions.
- [x] 1.4 Add tests for any changed file without a test file.
- [x] 1.5 Run the owning checks and record the results.

## 2. Guard release and source aggregation

- PR delivery: E1.
- Outcome: no editor can leave the guard latched after it unmounts.
- Scope and approach: replace `ExamineView`'s hand-rolled dirty sources with `useDirtySources` (3). Give `InstructionForm` an unmount release, and pass it a stable source callback instead of the inline `(key, dirty)` adapter (4). Delete `ProcessingStage`'s redundant unmount Effect (5), and add an unmount release to `ui/EvidenceGroup` (10).
- Prerequisites: #183.
- Acceptance: unmounting a dirty Examine correction, a dirty instruction form or a dirty evidence group releases the guard.
- TDD approach: unmount-while-dirty tests fail first for items 3 and 4.
- Verification: the owning checks; the existing one-correction-at-a-time tests still pass.
- Risks and decisions: none.

- [x] 2.1 Confirm each finding against the current code.
- [x] 2.2 RED: add unmount-while-dirty regressions and confirm they fail.
- [x] 2.3 GREEN: implement the releases and the `useDirtySources` replacement.
- [x] 2.4 Add tests for any changed file without a test file.
- [x] 2.5 Run the owning checks and record the results.

## 3. Derived drafts

- PR delivery: E1.
- Outcome: drafts that follow saved values never flicker dirty and never overwrite a dirty draft.
- Scope and approach: `useDraft` stores `T | null` (6). `InstructionField` stores `string | null` (7). `AskControl` adjusts `asked` during render (8). Use the "derive drafts" decision.
- Prerequisites: #183.
- Acceptance: a clean draft follows a new saved value without `report(true)`; a dirty draft keeps its value and stays dirty; text arriving after mount shows; newer text is adopted after save or discard.
- TDD approach: the `useDraft` no-flicker test fails first.
- Verification: the owning checks; the records and processing tests.
- Risks and decisions: AskControl's open-with-prefill dirty question stays as is and is raised in the PR.

- [x] 3.1 Confirm each finding against the current code.
- [x] 3.2 RED: add the no-flicker and keep-dirty regressions and confirm they fail.
- [x] 3.3 GREEN: implement the derived drafts.
- [x] 3.4 Add tests for any changed file without a test file.
- [x] 3.5 Run the owning checks and record the results.

## 4. Review quick-edit request (J/K)

- PR delivery: E2.
- Outcome: after pressing E, J and K keep moving between lots, and only the requested lot opens its quick editor.
- Scope and approach: `ReviewWorkspace` holds a `quickEditLotId` request, set in `editQuantity` and cleared once handled. `DecisionPanel` opens and focuses the editor only for that lot (12). Also check the two minor `ReviewWorkspace` items (25) and fix them only if the problem is confirmed.
- Prerequisites: E1.
- Acceptance: press E, then Escape or blur, then J, and the next lot's editor is closed; a second J still moves.
- TDD approach: the J-after-E keyboard test fails first.
- Verification: the owning checks; a demo recording for the PR.
- Risks and decisions: none.

- [x] 4.1 Confirm the finding against the current code.
- [x] 4.2 RED: add the J-after-E regression and confirm it fails.
- [x] 4.3 GREEN: implement the quick-edit request.
- [x] 4.4 Assess item 25 and fix or drop it with a note. Dropped; see `notes.md`.
- [ ] 4.5 Record the demo and run the owning checks.

## 5. Commands from handlers

- PR delivery: E2.
- Outcome: no command is sent from an Effect.
- Scope and approach: replace the confirmation-counter Effects in `EvidenceGroupPanel` and `MediaWorkspace` with awaiting handlers, including the retained-retry path (13). `Batch`'s `edit` resolves with the accepted snapshot, so `ReviewMapStage` sends its follow-up link or move from the handler (14).
- Prerequisites: E1.
- Acceptance: a save closes the editor and releases the guard; an uncertain acknowledgement followed by an exact retry closes it; a failed save keeps the draft; the follow-up link is sent exactly once with the new lot's ID; a refused first edit sends no link.
- TDD approach: the handler tests fail first where behaviour changes.
- Verification: the owning checks.
- Risks and decisions: `MediaWorkspace`'s `unconfirmedMove` ref is low confidence and is changed only with evidence.

- [x] 5.1 Confirm each finding against the current code.
- [x] 5.2 RED: add the save, retry, failure and follow-up regressions and confirm they fail.
- [x] 5.3 GREEN: change `edit`'s result and move the commands into handlers.
- [x] 5.4 Add tests for any changed file without a test file.
- [x] 5.5 Run the owning checks and record the results.

## 6. Batch settings Effects

- PR delivery: E2.
- Outcome: the settings panel reads and registers its lanes only when its inputs change, cancels its own retry timers, and never accepts a stale read after reconnecting.
- Scope and approach: `BatchSettingsPanel` reconnection (15), lane registration (16), logo lane state (17) and instruction adoption dependencies (18). The adoption rule must not change.
- Prerequisites: E1.
- Acceptance: on disconnect and reconnect while a read is in flight, the first read is dropped and a second is issued; unmounting during the retry delay schedules nothing; a refused logo shows its message and is not dirty; the instructions lane still registers when the projection arrives after mount.
- TDD approach: the fake-timer reconnection test fails first.
- Verification: the owning checks; `save-queue.test.ts` covers `onRejected`.
- Risks and decisions: none.

- [x] 6.1 Confirm each finding against the current code.
- [x] 6.2 RED: add the reconnection, retry-cancellation and refused-logo regressions and confirm they fail.
- [x] 6.3 GREEN: implement the latest-ref, generation and `onRejected` changes.
- [x] 6.4 Run the owning checks and record the results.

## 7. Modal dialog lifecycle

- PR delivery: E2.
- Outcome: dialogs return focus to their opener after a StrictMode remount, and never call `showModal` on an open dialog.
- Scope and approach: `ui/Dialog` cleanup and opener recording, and a shared modal hook used by `MediaCropDialog` (19), including its dirty report (11).
- Prerequisites: E1.
- Acceptance: focus returns to the opener in development StrictMode; a replaced dirty callback does not reopen the crop dialog.
- TDD approach: the `showModal` guard test fails first in jsdom. Focus return needs a real browser, so it is verified there and recorded as manual evidence.
- Verification: the owning checks; browser evidence on the PR.
- Risks and decisions: `reconcileNativeClose` and the disconnected path must keep working; they are checked before adding `close()`.

- [x] 7.1 Confirm the finding against the current code.
- [x] 7.2 RED: add the `showModal` guard regression and confirm it fails.
- [x] 7.3 GREEN: implement the dialog lifecycle fix.
- [x] 7.4 Verify focus return in a real browser and record it.
- [x] 7.5 Run the owning checks and record the results.

## 8. Derived workspace state

- PR delivery: E2.
- Outcome: workspace state that mirrors props or reads is derived during render, so no frame shows stale or wrong text.
- Scope and approach:
  - `ProcessingWorkspace` session drawer (20) and pinned question (21).
  - `ManualWorkspace` selection (22) and last preview (23), with `navigate` memoized in `Batch`.
  - `Batch`'s first-read latch and a shared `useAcceptedOperatorReview` (24).
- Prerequisites: E1.
- Acceptance: a pinned question's first context stays and the unavailable text never appears; an approved or removed lot is not counted, sent or blocking the tenth selection; a pinned preparation still shows after it leaves the workspace; a matching accepted projection keeps draft owners mounted when polling fails.
- TDD approach: the pinned-question and selection regressions fail first.
- Verification: the owning checks.
- Risks and decisions: the pinned-snapshot rules are the main risk, so each fix keeps an explicit test for them.

- [x] 8.1 Confirm each finding against the current code.
- [x] 8.2 RED: add the regressions and confirm they fail.
- [x] 8.3 GREEN: implement the render-time derivations and the shared hook.
- [x] 8.4 Add tests for any changed file without a test file.
- [x] 8.5 Run the owning checks and record the results.

## 9. Server reads through TanStack Query

- PR delivery: E3.
- Outcome: polling and searches use scoped queries that share, cancel and report failure.
- Scope and approach: `processing/session-status.ts` (26), `ChatGPTSignIn` (27) and `SearchableReferencePicker` (28).
- Prerequisites: E2.
- Acceptance:
  - the status line refreshes on its interval and on a revision change, and clears on failure;
  - sign-in polls only while pending and open, and a key edit drops in-flight results;
  - one search fires 250 ms after typing stops, and a late older response never replaces newer results.
- TDD approach: the fake-timer tests fail first where behaviour changes.
- Verification: the owning checks.
- Risks and decisions: the management key must never enter a query key. Whether `useCatalogue.search` can take a signal is recorded as a limit if it cannot.

- [ ] 9.1 Confirm each finding against the current code.
- [ ] 9.2 RED: add the regressions and confirm they fail.
- [ ] 9.3 GREEN: move each read to TanStack Query.
- [ ] 9.4 Add tests for any changed file without a test file.
- [ ] 9.5 Run the owning checks and record the results.

## 10. Shared sync hooks

- PR delivery: E3.
- Outcome: browser and form subscriptions use stable shared hooks, and measured layouts stop re-measuring on unchanged data.
- Scope and approach:
  - `LiveUpdates` adopts `useOnForeground` (29).
  - `useDevicePixelRatio` (30) and an `EvidenceViewer` callback ref (31).
  - `useMountedRef` (32) and `useDraftGeneration` (33).
  - A stable `subscribe` in `useMediaQuery` (34).
  - Memoized retired and predecessor sets, so `ReviewMap` stops re-measuring (35).
- Prerequisites: E2.
- Acceptance: full resolution is chosen after two pixel-ratio changes; an identical rerender does not re-measure the map; existing `LiveUpdates`, viewer and form tests still pass.
- TDD approach: the pixel-ratio and re-measure regressions fail first.
- Verification: the owning checks.
- Risks and decisions: none.

- [ ] 10.1 Confirm each finding against the current code.
- [ ] 10.2 RED: add the regressions and confirm they fail.
- [ ] 10.3 GREEN: implement the hooks and adopt them.
- [ ] 10.4 Add tests for any changed file without a test file.
- [ ] 10.5 Run the owning checks and record the results.

## Delivery evidence and lifecycle follow-up

- [ ] E1 reviewed, published and its reviewed commit recorded.
- [ ] E2 reviewed, published and its reviewed commit recorded.
- [ ] E3 reviewed, published and its reviewed commit recorded.

No BI items are linked. Archive the change only when authorized after the PRs merge.
