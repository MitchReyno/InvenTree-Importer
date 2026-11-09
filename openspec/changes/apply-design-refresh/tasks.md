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
| 4. Phone header | Frontend | 1, 2, 3 | `batch-navigation` › Phone header; `header-workflow-status` (phone bar); `header-connection-status` › Independent connection observations, Accessible connection disclosure |
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
- Full gate: the frontend gate, plus `pnpm contracts:check && pnpm typecheck:intake` (root `pnpm test` already runs the intake tests).
- PR-B also runs `pnpm --filter @invimport/frontend check:masthead`.
- Every task also updates the architecture docs it affects (`frontend/ARCHITECTURE.md`, `intake-server/ARCHITECTURE.md`) and `notes.md` in its own PR.
- Then local review rounds until clean, green selected CI, and merge pinned to the reviewed head.

## 1. Design-system foundation

- **PR delivery:** PR-A.
- **Outcome:** the app's `components/ui` library matches design system v20, so screens can use the new parts.
- **Scope and approach (design D1):**
  - Add `ai` (#7c3aed / #c4a7ff) and `ai-weak` (#f1e8ff / #2d2148) to `frontend/src/theme/tokens.json`, regenerate with `pnpm --filter @invimport/frontend tokens`, and make `check-contrast.cjs` pass `ai` on `ai-weak` in both themes.
  - Add `components/ui/icons.tsx` with `AiSparkle`, `Help`, `Info`, `Settings`, `Menu` and `Back` as inline `currentColor` SVGs.
  - Add components: `AiMark` (sm, md, lg; it makes its parent a centred flex row), `IconButton`, `HelpButton`, `SettingsNav`, `SettingRow`, `Switch`, `NumberStepper`, `DescriptionField`, `TreeView`, `CompareTable`, `SourceChipPopover`.
  - Generalise `DisabledFeature` to wrap any control (checkbox, select, stepper, text field, button): `aria-disabled="true"` so it stays focusable, activation and input ignored, explanation linked with `aria-describedby`. `DescriptionField` and `SettingRow` accept a disabled reason that renders through it. The three existing callers (`capture/SupplierField.tsx`, `capture/PurchaseOrderPreview.tsx` and the gallery entry in `ui/fixtures/ComponentGallery.tsx`) move to the wrapping form with their checkbox inside. `DisabledFeature.test.tsx` is rewritten from native `disabled` plus a focusable group to the `aria-disabled` behaviour, and `capture/BatchSettingsPanel.test.tsx`'s `toBeDisabled()` check on the purchase-order checkbox becomes `aria-disabled="true"` plus its accessible description, keeping its document-order checks. The visible "Coming later" eyebrow stays as it is until R10 is decided.
  - Change `SourceChip` to the short form (source, info icon, attention glyph, full text as its tooltip) with the popover.
  - `Pill` drops ✦ and the "AI-proposed" state.
  - `KeyValue` and `Breadcrumb` follow D29.
  - Show everything in the component gallery fixture.
- **Prerequisites:** none.
- **Acceptance:** the `ui-design-system` added requirements (AI mark, Short source chips, Help instead of helper text, Disabled controls explain themselves, Descriptions with InvenTree's limits).
- **TDD approach:** each component gets tests first for its roles, names, keyboard handling, focus return and states. RED: the components don't exist, and `SourceChip` renders "source · certainty".
- **Verification:** frontend gate; gallery screenshots in both themes and at 390px.
- **Risks and decisions:** `SourceChip` call sites change shape. Keep a compatible prop signature so Task 7 can migrate the call sites.

- [x] 1.1 Confirm the design system v20 component guides and the existing `components/ui` APIs that change.
- [x] 1.2 RED: write tests for the new components and the short `SourceChip`, and see them fail.
  - [x] 1.2.1 `SourceChip`: the accessible name holds source and certainty; the glyph for likely, conflict and user; the popover opens, closes on Escape and returns focus.
  - [x] 1.2.2 `HelpButton`, `IconButton`, `Switch`, `NumberStepper` (limits disable the buttons), `DescriptionField` (count, over-limit state, disabled with a reason).
  - [x] 1.2.3 `DisabledFeature` around a checkbox, a select, a stepper, a text field and a button: each takes focus, announces its explanation, ignores Enter, Space, clicks and typing, and sends no request.
- [x] 1.3 GREEN: implement the tokens, icons and components; update `Pill`, `KeyValue` and `Breadcrumb`; add gallery entries.
- [x] 1.4 Refactor shared styles onto tokens; check both themes for contrast.
- [x] 1.5 Run the frontend gate, update the docs it affects, and record the results.
- [ ] 1.6 Run local review rounds on the bundle's exact head until one is clean, open its PR, wait for green selected CI, and merge pinned to the reviewed head.

## 2. Desktop masthead and server menu

- **PR delivery:** PR-B.
- **Outcome:** the masthead ends with activity, the connection menu and the Settings gear. There's no Open InvenTree button, no "⋯" menu, and no batch title in the breadcrumb.
- **Scope and approach (design D2):**
  - `masthead/HeaderStatus.tsx`, `ConnectionStatus.tsx` and `ConnectionDetails.tsx`: Open InvenTree, the development badge line and a Server settings link move into the menu. Check connection now renders disabled (BI-015).
  - `ActivityIndicator.tsx`: `AiMark` first, no needs-you badge, batch name only outside a batch.
  - Change the route match and `currentBatch` derivation (`App.tsx`), and `useRouteBreadcrumb`'s page lookup (`masthead/AppMasthead.tsx`), to a `settings` prefix here, so the menu's Server settings link (`#settings/inventree`) works before PR-C; until Settings exists, `#settings` routes keep opening today's agent settings page.
  - Remove `MastheadMenu.tsx` in PR-B. The theme choice moves into the server menu as an interim item, which Task 5 (PR-C) moves to Settings › Appearance.
- **Prerequisites:** Task 1.
- **Acceptance:** `header-connection-status` › Safe target details and navigation; `header-workflow-status` › Accessible workflow disclosure and layout (desktop); `batch-navigation` › Calm batch header (masthead parts).
- **TDD approach:** update the header tests first: Open InvenTree is only inside the menu; the chip has no `?` count; the breadcrumb inside a batch is "Batches"; `#settings/inventree` sends no capture read (spy on `readBatch`) and its breadcrumb reads "Batches / Agent settings". These fail against the current header.
- **Verification:** frontend gate; keyboard check of the menu at 360px and 390px.
- **Risks and decisions:** theme access between PR-B and PR-C is handled as above.

- [x] 2.1 Confirm current masthead tests and `header-connection-status` coverage.
- [x] 2.2 RED: update header tests to the new layout and confirm they fail.
- [x] 2.3 GREEN: move Open InvenTree into the menu, add the gear, update the chip and breadcrumb, and remove the "⋯" menu (theme interim as noted).
- [x] 2.4 Refactor; check opener isolation and that the unavailable-link states are unchanged.
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
- **TDD approach:** test `tabCount` against the table in design D3, and a header test asserts one badge per tab. Both fail first.
- **Verification:** frontend gate.
- **Risks and decisions:** none.

- [x] 3.1 Confirm the need-you aggregate inputs and current badge rendering.
- [x] 3.2 RED: `tabCount` table tests and the one-badge-per-tab header test fail.
- [x] 3.3 GREEN: new layout, counts, status icons and short summary; remove the duplicate counts.
- [x] 3.4 Refactor; verify the redirects and second-row behaviour are unchanged.
- [ ] 3.5 Run the frontend gate, update the docs it affects, and record the results.

## 4. Phone header

- **PR delivery:** PR-B.
- **Outcome:**
  - At phone width the masthead shows brand, Dev badge, agents status button and menu.
  - On scroll, the batch title condenses to one sticky row with status and needs-you count.
- **Scope and approach (design D2):**
  - A phone variant in `AppMasthead.tsx` and `BatchHeader.tsx`.
  - A menu sheet holding Agents, Settings, server details and theme; the menu button carries the connection-state dot and names the state.
  - An `IntersectionObserver`-driven condensed row.
  - The bottom tab bar (P5) is excluded.
- **Prerequisites:** Tasks 1, 2 and 3.
- **Acceptance:** `batch-navigation` › Phone header; `header-connection-status` › Independent connection observations (Phone indicator) and Accessible connection disclosure.
- **TDD approach:** viewport tests at 390px for the layout, sheet focus and Escape, and the condensed row appearing when the header leaves view (mocked observer). They fail first.
- **Verification:** frontend gate; a film at 390px.
- **Risks and decisions:** `IntersectionObserver` is mocked in jsdom, so real scroll behaviour is checked in the film.

- [x] 4.1 Confirm the existing viewport helpers and phone tests.
- [x] 4.2 RED: write the phone layout, sheet and condensed-row tests.
- [x] 4.3 GREEN: implement the phone masthead, sheet and condensed row.
- [x] 4.4 Refactor; check there's no horizontal scroll at 360px and 390px.
- [ ] 4.5 Run the frontend gate, update the docs it affects, and record the results.
- [ ] 4.6 Run local review rounds on the bundle's exact head until one is clean, open its PR, wait for green selected CI, and merge pinned to the reviewed head.

## 5. Settings page

- **PR delivery:** PR-C.
- **Outcome:** Settings opens from the gear, with a back link, sections, working agent settings, disabled deferred controls, InvenTree details and Appearance.
- **Scope and approach (design D4):**
  - A new `components/settings/Settings.tsx` and section components.
  - `App.tsx` routes `#settings/<section>` to the new sections (the `settings` prefix match came in Task 2), with a test that `#settings/inventree` opens Settings › InvenTree.
  - `AiMark` on the Settings › Agents heading and its nav item.
  - The `PersonalClaudeCredential` and `ChatGPTSignIn` panels move into the Agents section. Their state, handlers and the Codex sign-in poll query lift unchanged into `usePersonalClaudeCredential` and `useChatGPTSignIn`, which the Agents section component calls once (so they mount and unmount with the section) and passes to both the panel and its provider card (design D4), so the card mirrors the panel's status with no Effect. The panels' existing tests keep passing through a small wrapper that calls the hook.
  - `AgentSettingsForm` is restyled onto `SettingRow`s (provider option cards, authentication segmented control, model select, sessions `NumberStepper`). It keeps its contract, revision check, conflict handling and explicit Save, with tests for each. Pause all reuses the pause command from `AgentSessions.tsx`; the slot meter reads the agent sessions query.
  - The InvenTree section's token row, Check now, Replace token and import reference prefix render disabled.
  - The Agents page link points here, and `AppMasthead`'s page label becomes "Settings", with a test that `#settings/inventree` shows "Batches / Settings".
  - The theme preference moves from the removed menu.
- **Prerequisites:** Tasks 1 and 2.
- **Acceptance:** `app-settings`: Settings page and navigation (both scenarios), Agent settings section (all scenarios), Deferred settings, InvenTree and appearance sections; `ui-design-system` › AI mark at agent touchpoints (Settings parts).
- **TDD approach:** route, back link (with and without history), deferred controls not operable and sending nothing (fetch spy), conflict keeps the edit, theme persistence, and the provider cards mirroring their panels: each Claude and Codex state, a failure, removing the key, a completed sign-in poll, "Not checked" after a collapse and after a key edit, a Claude key edit after a failure keeping "Check failed", a late poll result for an edited key not changing the card, and switching to another section and back while signing in sending no poll with an empty key. These fail first.
- **Verification:** frontend gate; film.
- **Risks and decisions:** none.

- [ ] 5.1 Confirm the current `#settings` route, `AgentSettingsForm` contract and theme storage.
- [ ] 5.2 RED: write the Settings route, back link, deferred-control, theme and provider-card tests.
- [ ] 5.3 GREEN: build the shell, sections, back link and disabled cards; move the theme here and drop the interim theme item from Task 2.
- [ ] 5.4 Refactor; check the navigation guard with unsaved edits.
- [ ] 5.5 Run the frontend gate, update the docs it affects, and record the results.
- [ ] 5.6 Run local review rounds on the bundle's exact head until one is clean, open its PR, wait for green selected CI, and merge pinned to the reviewed head.

## 6. Descriptions

- **PR delivery:** PR-D.
- **Outcome:**
  - Part descriptions are editable with their count.
  - Existing descriptions for categories, companies, parameter templates and locations show read-only.
  - Descriptions the app can't store or read show as disabled fields.
- **Scope and approach (design D7):** frontend only. `PartEditor`, `CompanyEditor`, `ProposedCompanyEditor`, `SourcingEditor`, `TemplateEditor`, `ParameterMatrix` and `RecordDetail` use `DescriptionField`. Existing descriptions come from the existing-values query that already feeds `RecordDetail`'s "In InvenTree" table. New locations and suppliers created in Capture show their draft description. A catalogue proposal over the limit (`description_unsupported`) shows the over-limit state and the existing "Not supported yet" state; it is never written, and approval isn't blocked.
- **Prerequisites:** Task 1.
- **Acceptance:** `ui-design-system` › Descriptions with InvenTree's limits; `review-records` › Descriptions on records.
- **TDD approach:** UI tests for read-only (from mocked existing values), disabled and editable states, and the over-limit state shown for an existing `description_unsupported` problem. They fail first.
- **Verification:** frontend gate.
- **Risks and decisions:** InvenTree descriptions set outside the app can exceed 250 characters. Show them with an over-limit count but don't block, because the app doesn't write them.

- [ ] 6.1 Confirm which existing types the existing-values query returns and how `RecordDetail` reads them.
- [ ] 6.2 RED: write the UI tests for the three description states and the over-limit problem.
- [ ] 6.3 GREEN: wire `DescriptionField` into the editors and record detail, and surface the existing `description_unsupported` problem as the field's over-limit state.
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
  - remove the Review "ready to add" banner;
  - remove the helper sentences (Batches, Capture notes, Proposed lots, Records subtitle, Tree footnote, "Your edits are kept…");
  - add `HelpButton` for Capture groups and the Map legend;
  - add the Review "Shortcuts" button;
  - drop the duplicate "Test InvenTree" on Added;
  - change "✦ New" pills to "＋ New";
  - migrate every `SourceChip` call site, and move `operator/ProvenancePill.tsx` (used by `DecisionPanel`) onto the short chip;
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
- [ ] 7.6 Run local review rounds on the bundle's exact head until one is clean, open its PR, wait for green selected CI, and merge pinned to the reviewed head.

## 8. Records › Locations and Tree view

- **PR delivery:** PR-E.
- **Outcome:**
  - Records lists Locations with a detail view.
  - Ready to add keeps "Lots to include" beside the Tree.
  - Lot rows show a location only when it differs from the batch default.
- **Scope and approach (design D8):** `review/records/RecordsStage.tsx` and `RecordDetail.tsx`; `changes/ReadyToAdd.tsx` and `PreparationTreeView.tsx`, using `TreeView`.
- **Prerequisites:** Tasks 1 and 6.
- **Acceptance:** `review-records` › Locations view; `changes-commit` › Tree view, Lot rows name only an overriding location.
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
- **Acceptance:** `processing-workspace` › Inventory step page, Inventory session drawer.
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
- [ ] 9.6 Run local review rounds on the bundle's exact head until one is clean, open its PR, wait for green selected CI, and merge pinned to the reviewed head.

## 10. Direct upload

- **PR delivery:** PR-F.
- **Outcome:** picking files uploads them straight away, several at once, one after another, with per-file states and Retry.
- **Scope and approach (design D5):**
  - `media/MediaUpload.tsx`: `multiple` inputs, a sequential queue, per-file states (an indeterminate "Uploading…", since the upload request reports no byte progress).
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

- [x] 10.1 Confirm the upload call, revision handling and the tests that click Retain or Discard.
- [x] 10.2 RED: rewrite the existing tests and add the multi-file, failure and Retry tests.
- [x] 10.3 GREEN: remove Retain and Discard; implement the queue, per-file states and progress.
- [x] 10.4 Refactor; check navigation protection during the queue.
- [x] 10.5 Run the frontend gate, update the docs it affects, and record the results.
- [ ] 10.6 Run local review rounds on the bundle's exact head until one is clean, open its PR, wait for green selected CI, and merge pinned to the reviewed head.

## 11. Evidence removal backend

- **PR delivery:** PR-G.
- **Outcome:** photos and documents can be removed and restored as append-only events. Removal is refused when an approved run pinned the file, enforced on every read and approval path, and announced to the affected lots' agents.
- **Scope and approach (design D6):**
  - Migration `0031_media_evidence_removal.sql` with its immutability trigger, and grants in `media/grants.ts`.
  - `contracts/src/media.ts` `remove` and `restore` `MediaEdit` kinds, handled in `media/edit.ts`.
  - The media read model returns removed items in a separate list, and each item gains `pinned_by`, `lot_ids` and `sole_evidence_lot_ids`.
  - Other edits on a removed item (`move`, `move_many`, `link`, attachment selection, `derive`, evidence note) are refused with `media_evidence_removed`; `ungroup` also moves removed members; removed items keep counting towards capacity.
  - `requireEvidenceRegion` refuses observations on removed versions; `leadBatchView` omits them.
  - The delete command appends an `unset` attachment selection for any selected removed version; the projection adds `selected_attachment_of`, and `pinned_by` takes its time from `executor_run` → `command.created_at`.
  - `review/model.ts` `hasSupportingEvidence` ignores removed items, so the existing `no_supporting_evidence` warning applies.
  - `evidence_removed` stale reasons through all three joins (media sources, observation sources via `evidence_version_id`, evidence notes); the removed item's notes leave new inputs. A batch notice to the Examine lead, and notices to the lots' Research and Images sessions keyed by removal revision. A restore appends its own lead `evidence` item keyed `restored:<evidence>:<revision>`.
  - Filtering in `processing/examine-trigger.ts`, the agent evidence reads, lot-session observation views, the processing input builder and preparation.
  - The proposal publication source check in `agents/tools/handlers.ts` refuses removed `media_version` sources, observations on removed versions, and notes that are a removed item's evidence notes.
  - `review/approve-preparation.ts` checks for removed evidence before re-materialising and refuses with `approval_evidence_removed` (409); `media/execution-pins.ts` also refuses removed versions as defence in depth.
  - Removal cascades staleness through `cascadeAll(..., 'evidence_removed')`.
  - Operator byte routes serve only a removed version's thumbnail; Review projections omit its observations.
- **Prerequisites:** none.
- **Acceptance:** `capture-grouped-evidence` › Delete evidence, Restore deleted evidence, Delete refused where history must stay; `capture-media` › Media removed evidence; `processing-stage-pipeline` › Evidence removal and restore notices; `approval-preparation` › Removed evidence blocks approval, Removed evidence doesn't support a lot.
- **TDD approach:**
  - Postgres tests first (`pnpm test:intake:pg`):
    - remove, then restore;
    - stale revision 412;
    - replay returns the first result;
    - pinned evidence refused with `media_removal_refused`;
    - UPDATE and DELETE on the new table rejected;
    - stale reasons and notices written, and remove → restore → remove delivers a second notice while the proposal stays stale;
    - edits on a removed item refused;
    - projection fields `pinned_by`, `lot_ids`, `sole_evidence_lot_ids`;
    - restore appends a lead notice, is refused in an archived batch, and returns to ungrouped when its group was retired;
    - observations recorded or edited on a removed version are refused; the lead batch view omits them;
    - a snapshot with 200 items, some removed, validates against the contract;
    - deleting a selected attachment clears the selection; `move_many` refuses removed IDs; `ungroup` moves removed members;
    - a lot whose only evidence is removed raises `no_supporting_evidence`;
    - each of the three stale joins marks a proposal stale, and a downstream proposal goes stale through the cascade;
    - operator routes refuse a removed original and region crop but serve its thumbnail;
    - approval refused with `approval_evidence_removed`;
    - publishing a proposal that cites a removed version, an observation on one, or a removed item's evidence note is refused even after earlier delivery, and lot-session views omit those observations;
    - approval of a preparation citing a removed version refused;
    - new processing inputs exclude removed evidence while frozen inputs keep their manifest.
  - Process tests (`pnpm test:intake:process`): the Examine trigger and agent evidence reads skip removed versions.
- **Verification:** full gate, `pnpm test:intake:pg`, `pnpm test:intake:process`, `pnpm contracts:generate`.
- **Risks and decisions:** a file selected as an unapproved attachment can be removed; approval then refuses the stale preparation.

- [x] 11.1 Gate: the user decided on 2026-11-09 that deletion ships with its backend. For reference, the fallback had they chosen otherwise was to: move Tasks 11–12 to BI-015 and build the delete UI disabled; rewrite the deletion deltas (`capture-media`, `processing-stage-pipeline`, `approval-preparation` and the three `capture-grouped-evidence` deletion requirements) into one disabled-delete requirement; and update BI-014, BI-015 and the `complete-design-refresh-backend` README.
- [ ] 11.1a Before writing deletion code, confirm the `MediaEdit` pattern, pin tables, `currentness.ts` stale reasons and notices, and every evidence read path.
- [ ] 11.2 RED: write the Postgres and process tests above and confirm they fail.
- [ ] 11.3 GREEN: implement the removal backend.
  - [ ] 11.3.1 Migration, trigger and grants; `remove` and `restore` edits with refusals.
  - [ ] 11.3.2 Stale reasons and notices on remove and restore.
  - [ ] 11.3.3 Filtering in the read model, Examine trigger, agent reads, processing inputs and preparation; approval refusal.
  - [ ] 11.3.4 `hasSupportingEvidence` ignores removed items; the delete clears attachment selections; `ungroup` and restore handle retired groups.
- [ ] 11.4 Refactor; update the `intake-server/ARCHITECTURE.md` media section.
- [ ] 11.5 Run the full gate and both intake tiers, and record the results.
- [ ] 11.6 Validate migration 0031 against a database migrated to 0030 with existing evidence: it applies, existing evidence stays present with no removal rows, and an app build without the change still runs with the table unused. Record the evidence.

## 12. Evidence removal UI

- **PR delivery:** PR-G.
- **Outcome:** each photo and document tile has an actions menu with Delete. There's a bulk "Delete N files", a confirmation naming the affected lots, an Undo toast, a "Deleted files" list with Restore, a disabled Delete with its reason when refused, and a disabled Delete on written notes.
- **Scope and approach (design D6):** `ui/EvidenceTile.tsx`, `capture/EvidencePanel.tsx`, the bulk bar, `Dialog` and `Toast`, using the projection's lot links and pinned state.
- **Prerequisites:** Tasks 1, 10 and 11.
- **Acceptance:** same as Task 11 (UI parts).
- **TDD approach:** UI tests for menu keyboard use, dialog content with lots and a no-evidence warning, Undo and Restore sending `restore`, the disabled refusal, the disabled note delete, and the bulk delete. They fail first.
- **Verification:** full gate; film.
- **Risks and decisions:** none.

- [ ] 12.1 Confirm Task 11's projection fields (`pinned_by`, `lot_ids`, `sole_evidence_lot_ids`, `selected_attachment_of`, `removed`) cover the dialog, refusal and Deleted files list.
- [ ] 12.2 RED: write the menu, dialog, undo, refusal and bulk tests.
- [ ] 12.3 GREEN: build the menu, dialog (affected lots, lots left without evidence, attachment selections it clears), toast, "Deleted files" list (thumbnail and label), bulk action and disabled states.
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
- [ ] 13.3 Run local review rounds on PR-G's exact head until one is clean, open its PR, wait for green selected CI, and merge pinned to the reviewed head.

## Delivery evidence and lifecycle follow-up

For each bundle, record:

- the reviewed head SHA;
- local review results;
- CI;
- the merged PR.

Attach films and screenshots to the PR descriptions, not the repository. After PR-G merges, mark BI-014 Done with its PRs in a follow-up docs commit or PR. Archive only when authorized, after `pnpm openspec:overlap --change apply-design-refresh` is clean.
