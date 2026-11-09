# Implementation and delivery tasks

## Plan context

- **Change:** `apply-design-refresh`.
- **Items:** [BI-014](../../../docs/PLANNED_FUNCTIONALITY.md#bi-014--design-refresh) is delivered here. Its deferred backend is [BI-015](../../../docs/PLANNED_FUNCTIONALITY.md#bi-015--design-refresh-backend-follow-ups).
- **Plan:** [proposal](proposal.md) (reuse recommendation: extend the existing `components/ui` library and intake-server command pattern; no new dependency), [design](design.md) (D1–D8) and the delta specs under `specs/`.
- **Design sources:** the canvas (v58) and design system (v20), and the design change log entries D1–D31, which name each change's screens and likely components.
- **Branches and subjects:** every branch is `feat/apply-design-refresh-<bundle>`, and every subject is `type(apply-design-refresh): …`.

## Completion and commit ordering

- Tick each action after it is done and verified, in the same commit as its work.
- Leave parents unticked while any required subtask is open.
- Tick review, publication, CI and merge only after they happen.
- Record departures from the plan in `notes.md` as they occur.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Design-system foundation | Frontend components | None | `ui-design-system` (all added requirements) |
| 2. Desktop masthead and server menu | Frontend | 1 | `header-connection-status` › Safe target details; `header-workflow-status` › Accessible workflow disclosure and layout; `batch-navigation` › Calm batch header |
| 3. Batch header layout and counts | Frontend | 1 | `batch-navigation` › Four batch tabs, Second tab row, Calm batch header; `processing-workspace` › Processing overview |
| 4. Phone header | Frontend | 1, 2, 3 | `batch-navigation` › Phone header; `header-workflow-status` (phone bar) |
| 5. Settings page | Frontend | 1, 2 | `app-settings` (all) |
| 6. Descriptions | Frontend | 1 | `ui-design-system` › Descriptions; `review-records` › Descriptions on records |
| 7. Screen clean-up and agent marks | Frontend | 1 | `ui-design-system` › AI mark, Short source chips, Help instead of helper text |
| 8. Records › Locations and Tree view | Frontend | 1, 6 | `review-records` › Locations view; `changes-commit` › Tree view, Lot rows name only an overriding location |
| 9. Processing › Inventory step page | Frontend | 1 | `processing-workspace` › Inventory step page, Inventory session drawer |
| 10. Direct upload | Frontend | None | `capture-grouped-evidence` › Three prominent evidence actions (incl. Retry), Preserve editing and approval boundaries |
| 11. Evidence removal backend | Migration, contracts, server | None | `capture-grouped-evidence` › Delete evidence, Restore deleted evidence, Delete refused where history must stay |
| 12. Evidence removal UI | Frontend | 1, 10, 11 | same as 11, plus Written notes can't be deleted yet |
| 13. Closing notes and index | Docs | 1–12 | Index and notes current before the last merge |

Tasks 1, 10 and 11 can start in parallel.

## PR delivery map

| Bundle | Outcome and included work | Tasks | Why this boundary | Prerequisites and order | Base, branch and subject | Verification and gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Tokens, icons and the new and changed design-system components, shown in the component gallery fixture | 1 | Every later bundle consumes these; reviewable alone | None | `interactive-app`, `feat/apply-design-refresh-foundation`, `feat(apply-design-refresh): add the refreshed design-system components` | Frontend gate, gallery film, review rounds |
| PR-B | Calmer desktop masthead, server menu, batch header and phone header | 2, 3, 4 | One coherent header change touching the same components | PR-A merged | `feat/apply-design-refresh-header`, `feat(apply-design-refresh): calm the masthead and batch header` | Frontend gate, desktop and 390px film |
| PR-C | Settings page with working, deferred and appearance sections | 5 | A new page with its own route and tests | PR-A, PR-B (gear and menu removal) | `feat/apply-design-refresh-settings`, `feat(apply-design-refresh): add the Settings page` | Frontend gate, film |
| PR-D | Descriptions, removals, help buttons, short chips and agent marks across screens | 6, 7 | Cross-screen content pass sharing the same components | PR-A | `feat/apply-design-refresh-screens`, `feat(apply-design-refresh): refresh screen content and descriptions` | Frontend gate, film |
| PR-E | Records › Locations, the two-column Tree view and the Inventory step page | 8, 9 | New views and pages, separate from the content pass | PR-A, PR-D (description field use) | `feat/apply-design-refresh-views`, `feat(apply-design-refresh): add Locations, Tree layout and the Inventory step page` | Frontend gate, film |
| PR-F | Uploads start on pick, several files at once | 10 | Frontend-only, independent, easy to verify | None | `feat/apply-design-refresh-upload`, `feat(apply-design-refresh): upload evidence as soon as it is picked` | Frontend gate, film |
| PR-G | Evidence removal with undo, restore and refusal rules, server and UI; closing notes and index | 11, 12, 13 | The only migration, reviewed with its UI; merges last so Task 13 can describe the whole change | PR-A to PR-F merged | `feat/apply-design-refresh-evidence-removal`, `feat(apply-design-refresh): delete and restore evidence` | Full gate, `pnpm test:intake:pg`, `pnpm test:intake:process`, film |

**Gates for every bundle:**

- Frontend gate: `pnpm lint && pnpm build && pnpm test` from the repository root.
- Full gate: the frontend gate, plus `pnpm contracts:check && pnpm typecheck:intake && pnpm test:intake`.
- Every task also updates the architecture docs it affects (`frontend/ARCHITECTURE.md`, `intake-server/src/media` docs) and `notes.md` in its own PR.
- Then local review rounds until clean, green selected CI, and merge pinned to the reviewed head.

## 1. Design-system foundation

- **PR delivery:** PR-A.
- **Outcome:** the app's `components/ui` library matches design system v20, so screens can use the new parts.
- **Scope and approach (design D1):**
  - Add `ai` (#7c3aed / #c4a7ff) and `ai-weak` (#f1e8ff / #2d2148) to `frontend/src/theme/tokens.json`, regenerate with `pnpm --filter @invimport/frontend tokens`, and make `check-contrast.cjs` pass `ai` on `ai-weak` in both themes.
  - Add `components/ui/icons.tsx` with `AiSparkle`, `Help`, `Info`, `Settings`, `Menu` and `Back` as inline `currentColor` SVGs.
  - Add components: `AiMark` (sm, md, lg; it makes its parent a centred flex row), `IconButton`, `HelpButton`, `SettingsNav`, `SettingRow`, `Switch`, `NumberStepper`, `DescriptionField`, `TreeView`, `CompareTable`, `SourceChipPopover`.
  - Change `SourceChip` to the short form (source, info icon, attention glyph, full text as its tooltip) with the popover.
  - `Pill` drops ✦.
  - `KeyValue` and `Breadcrumb` follow D29.
  - Show everything in the component gallery fixture.
- **Prerequisites:** none.
- **Acceptance:** the `ui-design-system` added requirements (AI mark, Short source chips, Help instead of helper text, Descriptions with InvenTree's limits).
- **TDD approach:** each component gets tests first for its roles, names, keyboard handling, focus return and states. RED: the components don't exist, and `SourceChip` renders "source · certainty".
- **Verification:** frontend gate; gallery screenshots in both themes and at 390px.
- **Risks and decisions:** `SourceChip` call sites change shape. Keep a compatible prop signature so Task 7 can migrate the call sites.

- [ ] 1.1 Confirm the design system v20 component guides and the existing `components/ui` APIs that change.
- [ ] 1.2 RED: write tests for the new components and the short `SourceChip`, and see them fail.
  - [ ] 1.2.1 `SourceChip`: the accessible name holds source and certainty; the glyph for likely, conflict and user; the popover opens, closes on Escape and returns focus.
  - [ ] 1.2.2 `HelpButton`, `IconButton`, `Switch`, `NumberStepper` (limits disable the buttons), `DescriptionField` (count, over-limit state).
- [ ] 1.3 GREEN: implement the tokens, icons and components; update `Pill`, `KeyValue` and `Breadcrumb`; add gallery entries.
- [ ] 1.4 Refactor shared styles onto tokens; check both themes for contrast.
- [ ] 1.5 Run the frontend gate, update the docs it affects, and record the results.

## 2. Desktop masthead and server menu

- **PR delivery:** PR-B.
- **Outcome:** the masthead ends with activity, the connection menu and the Settings gear. There's no Open InvenTree button, no "⋯" menu, and no batch title in the breadcrumb.
- **Scope and approach (design D2):**
  - `masthead/HeaderStatus.tsx`, `ConnectionStatus.tsx` and `ConnectionDetails.tsx`: Open InvenTree, the development badge line and a Server settings link move into the menu. Check connection now renders disabled (BI-015).
  - `ActivityIndicator.tsx`: `AiMark` first, no needs-you badge, batch name only outside a batch.
  - Remove `MastheadMenu.tsx` in PR-B. The theme choice moves into the server menu as an interim item, which Task 5 (PR-C) moves to Settings › Appearance.
- **Prerequisites:** Task 1.
- **Acceptance:** `header-connection-status` › Safe target details and navigation; `header-workflow-status` › Accessible workflow disclosure and layout (desktop); `batch-navigation` › Calm batch header (masthead parts).
- **TDD approach:** update the header tests first: Open InvenTree is only inside the menu; the chip has no `?` count; the breadcrumb inside a batch is "Batches". These fail against the current header.
- **Verification:** frontend gate; keyboard check of the menu at 360px and 390px.
- **Risks and decisions:** theme access between PR-B and PR-C is handled as above.

- [ ] 2.1 Confirm current masthead tests and `header-connection-status` coverage.
- [ ] 2.2 RED: update header tests to the new layout and confirm they fail.
- [ ] 2.3 GREEN: move Open InvenTree into the menu, add the gear, update the chip and breadcrumb, and remove the "⋯" menu (theme interim as noted).
- [ ] 2.4 Refactor; check opener isolation and that the unavailable-link states are unchanged.
- [ ] 2.5 Run the frontend gate, update the docs it affects, and record the results.

## 3. Batch header layout and counts

- **PR delivery:** PR-B.
- **Outcome:** tabs sit under the title, left-aligned with it. Each tab and sub-tab shows one count; the summary is short.
- **Scope and approach (design D3):**
  - `batches/BatchHeader.tsx` gets a pure `tabCount` helper.
  - Step sub-tabs show status icons.
  - The Overview sub-tab and the Needs you card heading drop their counts, and the "Elsewhere in this batch" card goes (`processing/ProcessingOverview.tsx`).
- **Prerequisites:** Task 1.
- **Acceptance:** `batch-navigation` › Four batch tabs, Second tab row (both scenarios) and Calm batch header; `processing-workspace` › Processing overview.
- **TDD approach:** test `tabCount` against the change log's D16 table, and a header test asserts one badge per tab. Both fail first.
- **Verification:** frontend gate.
- **Risks and decisions:** none.

- [ ] 3.1 Confirm the need-you aggregate inputs and current badge rendering.
- [ ] 3.2 RED: `tabCount` table tests and the one-badge-per-tab header test fail.
- [ ] 3.3 GREEN: new layout, counts, status icons and short summary; remove the duplicate counts.
- [ ] 3.4 Refactor; verify the redirects and second-row behaviour are unchanged.
- [ ] 3.5 Run the frontend gate, update the docs it affects, and record the results.

## 4. Phone header

- **PR delivery:** PR-B.
- **Outcome:**
  - At phone width the masthead shows brand, Dev badge, agents status button and menu.
  - On scroll, the batch title condenses to one sticky row with status and needs-you count.
- **Scope and approach (design D2):**
  - A phone variant in `AppMasthead.tsx` and `BatchHeader.tsx`.
  - A menu sheet holding Agents, Settings, server details and theme.
  - An `IntersectionObserver`-driven condensed row.
  - The bottom tab bar (P5) is excluded.
- **Prerequisites:** Tasks 1, 2 and 3.
- **Acceptance:** `batch-navigation` › Phone header.
- **TDD approach:** viewport tests at 390px for the layout, sheet focus and Escape, and the condensed row appearing when the header leaves view (mocked observer). They fail first.
- **Verification:** frontend gate; a film at 390px.
- **Risks and decisions:** `IntersectionObserver` is mocked in jsdom, so real scroll behaviour is checked in the film.

- [ ] 4.1 Confirm the existing viewport helpers and phone tests.
- [ ] 4.2 RED: write the phone layout, sheet and condensed-row tests.
- [ ] 4.3 GREEN: implement the phone masthead, sheet and condensed row.
- [ ] 4.4 Refactor; check there's no horizontal scroll at 360px and 390px.
- [ ] 4.5 Run the frontend gate, update the docs it affects, and record the results.

## 5. Settings page

- **PR delivery:** PR-C.
- **Outcome:** Settings opens from the gear, with a back link, sections, working agent settings, disabled deferred controls, InvenTree details and Appearance.
- **Scope and approach (design D4):**
  - A new `components/settings/Settings.tsx` and section components.
  - `App.tsx` routes `#settings` and `#settings/<section>`.
  - `AgentSettingsForm` is restyled onto `SettingRow`s (provider option cards, authentication segmented control, model select, sessions `NumberStepper`). It keeps its contract, revision check, conflict handling and explicit Save, with tests for each. Provider sign-in state isn't shown (BI-015). Pause all reuses the pause command from `AgentSessions.tsx`; the slot meter reads the agent sessions query.
  - The InvenTree section's token row, Check now, Replace token and import reference prefix render disabled.
  - The Agents page link points here.
  - The theme preference moves from the removed menu.
- **Prerequisites:** Tasks 1 and 2.
- **Acceptance:** `app-settings`: Settings page and navigation (both scenarios), Agent settings section (both), Deferred settings, InvenTree and appearance sections.
- **TDD approach:** route, back link (with and without history), deferred controls not operable and sending nothing (fetch spy), conflict keeps the edit, theme persistence. These fail first.
- **Verification:** frontend gate; film.
- **Risks and decisions:** none.

- [ ] 5.1 Confirm the current `#settings` route, `AgentSettingsForm` contract and theme storage.
- [ ] 5.2 RED: write the Settings route, back link, deferred-control and theme tests.
- [ ] 5.3 GREEN: build the shell, sections, back link and disabled cards; move the theme here and drop the interim theme item from Task 2.
- [ ] 5.4 Refactor; check the navigation guard with unsaved edits.
- [ ] 5.5 Run the frontend gate, update the docs it affects, and record the results.

## 6. Descriptions

- **PR delivery:** PR-D.
- **Outcome:**
  - Part descriptions are editable with their count.
  - Existing descriptions for categories, companies, parameter templates and locations show read-only.
  - Descriptions the app can't store or read show as disabled fields.
- **Scope and approach (design D7):** frontend only. `PartEditor`, `CompanyEditor`, `ProposedCompanyEditor`, `SourcingEditor`, `TemplateEditor`, `ParameterMatrix` and `RecordDetail` use `DescriptionField`. Existing descriptions come from the existing-values query that already feeds `RecordDetail`'s "In InvenTree" table. New locations and suppliers created in Capture show their draft description. A catalogue proposal over the limit (`description_unsupported`) shows the over-limit state and blocks through the existing problem routing.
- **Prerequisites:** Task 1.
- **Acceptance:** `ui-design-system` › Descriptions with InvenTree's limits; `review-records` › Descriptions on records.
- **TDD approach:** UI tests for read-only (from mocked existing values), disabled and editable states, and the over-limit blocking problem. They fail first.
- **Verification:** frontend gate.
- **Risks and decisions:** InvenTree descriptions set outside the app can exceed 250 characters. Show them with an over-limit count but don't block, because the app doesn't write them.

- [ ] 6.1 Confirm which existing types the existing-values query returns and how `RecordDetail` reads them.
- [ ] 6.2 RED: write the UI tests for the three description states and the over-limit problem.
- [ ] 6.3 GREEN: wire `DescriptionField` into the editors and record detail; add the over-limit problem for Parts.
- [ ] 6.4 Refactor; verify the record edit tests are unchanged.
- [ ] 6.5 Run the frontend gate, update the docs it affects, and record the results.

## 7. Screen clean-up and agent marks

- **PR delivery:** PR-D.
- **Outcome:**
  - The approved removals are applied.
  - Help buttons replace helper text.
  - Short source chips are used everywhere.
  - The AI mark sits at each agent touchpoint.
- **Scope and approach (design D8):** change log entries D17–D22 and D26–D27:
  - remove the Part "Who proposed what" panel;
  - remove the Review "ready to add" banner;
  - remove the helper sentences (Batches, Capture notes, Proposed lots, Records subtitle, Tree footnote, "Your edits are kept…");
  - add `HelpButton` for Capture groups and the Map legend;
  - add the Review "Shortcuts" button;
  - drop the duplicate "Test InvenTree" on Added;
  - change "✦ New" pills to "＋ New";
  - migrate every `SourceChip` call site;
  - place `AiMark` where the change log lists it.
- **Prerequisites:** Task 1.
- **Acceptance:** `ui-design-system` › AI mark at agent touchpoints, Short source chips with details on demand, Help instead of helper text.
- **TDD approach:**
  - Update the screen tests first to assert the removed text is absent, the help buttons are present, and the mark appears on the touchpoint labels but not on values.
  - Tests of removed copy are rewritten, not deleted.
- **Verification:** frontend gate; film.
- **Risks and decisions:** none.

- [ ] 7.1 List every `SourceChip` call site and each removal target from the change log.
- [ ] 7.2 RED: update the screen tests for removals, help buttons and mark placement.
- [ ] 7.3 GREEN: apply the removals, help buttons, chip migration and marks.
- [ ] 7.4 Refactor; search for leftover helper sentences and "source · certainty" strings.
- [ ] 7.5 Run the frontend gate, update the docs it affects, and record the results.

## 8. Records › Locations and Tree view

- **PR delivery:** PR-E.
- **Outcome:**
  - Records lists Locations with a detail view.
  - Ready to add keeps "Lots to include" beside the Tree.
  - Lot rows show a location only when it differs from the batch default.
- **Scope and approach (design D8):** `review/records/RecordsStage.tsx` and `RecordDetail.tsx`; `changes/ReadyToAdd.tsx` and `PreparationTreeView.tsx`, using `TreeView`.
- **Prerequisites:** Tasks 1 and 6.
- **Acceptance:** `review-records` › Locations view; `changes-commit` › Tree view keeps the lot list.
- **TDD approach:** Locations list and detail from the projection; unticking a lot updates the tree beside the list; location shown only on a difference. All fail first.
- **Verification:** frontend gate; film.
- **Risks and decisions:** location mapping edits stay under "Unsupported record changes are honest" where the app can't store them.

- [ ] 8.1 Confirm the location records and tree data in the projections.
- [ ] 8.2 RED: write the Locations and Tree layout tests.
- [ ] 8.3 GREEN: build the Locations view and the two-column Tree layout.
- [ ] 8.4 Refactor onto `TreeView`; check stacking at narrow widths.
- [ ] 8.5 Run the frontend gate, update the docs it affects, and record the results.

## 9. Processing › Inventory step page

- **PR delivery:** PR-E.
- **Outcome:** Inventory has its own step page with Part matches, a duplicate-stock comparison, location and company matches, and the session drawer.
- **Scope and approach (design D8):** a new `processing/ProcessingInventory.tsx` on `StepPage.tsx`, with `CompareTable` built from the retained duplicate question. Fields the data doesn't hold read "Not known".
- **Prerequisites:** Task 1.
- **Acceptance:** `processing-workspace` › Inventory step page.
- **TDD approach:**
  - Fixture-based tests: the comparison renders both records; missing fields read "Not known"; answering resolves the question.
  - They fail first.
- **Verification:** frontend gate; film.
- **Risks and decisions:** if the retained question lacks the existing stock fields, the comparison shows only what's known; full data is BI-015.

- [ ] 9.1 Confirm what the Inventory question payload and step snapshot hold.
- [ ] 9.2 RED: write the step page tests.
- [ ] 9.3 GREEN: build the page and drawer wiring; link the sub-tab.
- [ ] 9.4 Refactor shared step-page parts.
- [ ] 9.5 Run the frontend gate, update the docs it affects, and record the results.

## 10. Direct upload

- **PR delivery:** PR-F.
- **Outcome:** picking files uploads them straight away, several at once, one after another, with per-file states and Retry.
- **Scope and approach (design D5):**
  - `media/MediaUpload.tsx`: `multiple` inputs, a sequential queue, per-file states.
  - `media/MediaWorkspace.tsx`: `finish` runs per file; group header progress.
  - The dirty guard covers the queue.
- **Prerequisites:** none.
- **Acceptance:** `capture-grouped-evidence` › Three prominent evidence actions (all scenarios, including Dismiss on "Not added" and Retry) and › Preserve editing and approval boundaries.
- **TDD approach:**
  - Rewrite the tests that click Retain or Discard (`MediaUpload.test.tsx`, `CaptureWorkspace.media.test.tsx`, `MediaWorkspace.query.test.tsx`, `MediaWorkspace.groups.test.tsx`) to pick-to-upload.
  - Add a multi-file test, a 4xx "Not added" test, a lost-response Retry test that resends the identical request and adopts the receipt, and a Retry-gets-412 test that re-sends with a new key.
  - All fail against the current Retain gate.
- **Verification:** frontend gate; film.
- **Risks and decisions:** Retry resends the identical request (same key, revision, label, bytes); a 412 then proves the file wasn't kept, and it is sent once more with a new key at the current revision. Group moves also advance the revision, so the queue re-reads it before each upload.

- [ ] 10.1 Confirm the upload call, revision handling and the tests that click Retain or Discard.
- [ ] 10.2 RED: rewrite the existing tests and add the multi-file, failure and Retry tests.
- [ ] 10.3 GREEN: remove Retain and Discard; implement the queue, per-file states and progress.
- [ ] 10.4 Refactor; check navigation protection during the queue.
- [ ] 10.5 Run the frontend gate, update the docs it affects, and record the results.

## 11. Evidence removal backend

- **PR delivery:** PR-G.
- **Outcome:** photos and documents can be removed and restored as append-only events. Removal is refused when an approved run pinned the file, enforced on every read and approval path, and announced to the affected lots' agents.
- **Scope and approach (design D6):**
  - Migration `0031_media_evidence_removal.sql` with its immutability trigger, and grants in `media/grants.ts`.
  - `contracts/src/media.ts` `remove` and `restore` `MediaEdit` kinds, handled in `media/edit.ts`.
  - The media read model returns removed items in a separate list, and each item gains `attached_in_run`, `lot_ids` and `sole_evidence_lot_ids`.
  - Other edits on a removed item are refused with `media_evidence_removed`; `requireUploadCapacity` counts only present items.
  - `evidence_removed` stale reasons; a batch notice to the Examine lead; notices to the lots' Research and Images sessions keyed by removal revision. A restore reaches the lead as new evidence.
  - Filtering in `processing/examine-trigger.ts`, the agent evidence reads, the processing input builder and preparation.
  - `media/execution-pins.ts` refuses removed versions.
  - A "No evidence" blocking problem for lots whose observations and subject links all point at removed evidence.
- **Prerequisites:** none.
- **Acceptance:** `capture-grouped-evidence` › Delete evidence, Restore deleted evidence, Delete refused where history must stay; `capture-media` › Media removed evidence; `processing-stage-pipeline` › Evidence removal and restore notices; `approval-preparation` › Removed evidence blocks approval.
- **TDD approach:**
  - Postgres tests first (`pnpm test:intake:pg`):
    - remove, then restore;
    - stale revision 412;
    - replay returns the first result;
    - pinned evidence refused with `media_removal_refused`;
    - UPDATE and DELETE on the new table rejected;
    - stale reasons and notices written, and remove → restore → remove delivers a second notice while the proposal stays stale;
    - edits on a removed item refused; capacity freed;
    - projection fields `attached_in_run`, `lot_ids`, `sole_evidence_lot_ids`;
    - approval of a preparation citing a removed version refused;
    - new processing inputs exclude removed evidence while frozen inputs keep their manifest.
  - Process tests (`pnpm test:intake:process`): the Examine trigger and agent evidence reads skip removed versions.
- **Verification:** full gate, `pnpm test:intake:pg`, `pnpm test:intake:process`, `pnpm contracts:generate`.
- **Risks and decisions:** a file selected as an unapproved attachment can be removed; approval then refuses the stale preparation.

- [ ] 11.1 Confirm the `MediaEdit` pattern, pin tables, `currentness.ts` stale reasons and notices, and every evidence read path.
- [ ] 11.2 RED: write the Postgres and process tests above and confirm they fail.
- [ ] 11.3 GREEN: implement the removal backend.
  - [ ] 11.3.1 Migration, trigger and grants; `remove` and `restore` edits with refusals.
  - [ ] 11.3.2 Stale reasons and notices on remove and restore.
  - [ ] 11.3.3 Filtering in the read model, Examine trigger, agent reads, processing inputs and preparation; approval refusal.
  - [ ] 11.3.4 "No evidence" problem in the records and review projections.
- [ ] 11.4 Refactor; update the `intake-server/src/media` architecture notes.
- [ ] 11.5 Run the full gate and both intake tiers, and record the results.

## 12. Evidence removal UI

- **PR delivery:** PR-G.
- **Outcome:** each photo and document tile has an actions menu with Delete. There's a bulk "Delete N files", a confirmation naming the affected lots, an Undo toast, a "Deleted files" list with Restore, a disabled Delete with its reason when refused, and a disabled Delete on written notes.
- **Scope and approach (design D6):** `ui/EvidenceTile.tsx`, `capture/EvidencePanel.tsx`, the bulk bar, `Dialog` and `Toast`, using the projection's lot links and pinned state.
- **Prerequisites:** Tasks 1, 10 and 11.
- **Acceptance:** same as Task 11 (UI parts).
- **TDD approach:** UI tests for menu keyboard use, dialog content with lots and a no-evidence warning, Undo and Restore sending `restore`, the disabled refusal, the disabled note delete, and the bulk delete. They fail first.
- **Verification:** full gate; film.
- **Risks and decisions:** none.

- [ ] 12.1 Confirm Task 11's projection fields (`attached_in_run`, `lot_ids`, `sole_evidence_lot_ids`, `removed`) cover the dialog, refusal and Deleted files list.
- [ ] 12.2 RED: write the menu, dialog, undo, refusal and bulk tests.
- [ ] 12.3 GREEN: build the menu, dialog, toast, "Deleted files" list, bulk action and disabled states.
- [ ] 12.4 Refactor; check focus return after the dialog and toast.
- [ ] 12.5 Run the full gate, update the docs it affects, and record the results.

## 13. Closing notes and index

- **PR delivery:** PR-G, which merges last.
- **Outcome:** `notes.md` and the index describe the whole change before its last PR merges.
- **Scope and approach:** `notes.md` (final open items); `docs/PLANNED_FUNCTIONALITY.md` (BI-014 moves to In review with PR-G; BI-015's remaining scope reflects what shipped disabled).
- **Prerequisites:** Tasks 1–12 (PR-A to PR-F merged, PR-G's own tasks done).
- **Acceptance:** documentation and links consistent with the code.
- **TDD approach:** documentation work, verified by reference and link checks instead of tests.
- **Verification:** prettier and remark on the changed files; link check.
- **Risks and decisions:** none.

- [ ] 13.1 Bring `notes.md` up to date with the final open items.
- [ ] 13.2 Update BI-014 and BI-015 in the index to match what PR-G delivers.

## Delivery evidence and lifecycle follow-up

For each bundle, record:

- the reviewed head SHA;
- local review results;
- CI;
- the merged PR.

Attach films and screenshots to the PR descriptions, not the repository. After PR-G merges, mark BI-014 Done with its PRs in a follow-up docs commit or PR. Archive only when authorized, after `redesign-batch-workspace` is archived and `pnpm openspec:overlap --change apply-design-refresh` is clean.
