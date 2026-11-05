# Implementation and delivery tasks

## Plan context

- **Planning artifacts.**
  - [Proposal](proposal.md) and [design assessment](design.md).
  - New specs: [ui-design-system](specs/ui-design-system/spec.md), [batch-navigation](specs/batch-navigation/spec.md), [processing-workspace](specs/processing-workspace/spec.md), [review-workspace](specs/review-workspace/spec.md), [review-records](specs/review-records/spec.md), [changes-commit](specs/changes-commit/spec.md) and [agents-overview](specs/agents-overview/spec.md).
  - Modified specs: [capture-batch-settings](specs/capture-batch-settings/spec.md) and [header-workflow-status](specs/header-workflow-status/spec.md).
- **Visual sources.** The [design system](https://claude.ai/artifact/TbKY47cDmdA3Nuh2jufTmo) and the [redesign canvas](https://claude.ai/artifact/TFjujLEMdBcqdRUBbvJKRf). When a screen is ambiguous, the canvas is the reference. When the canvas and a spec disagree, the spec wins.
- **Reuse recommendation.**
  - Keep styled-components, driven by token CSS variables.
  - Pin `@fontsource-variable/public-sans` and `@fontsource/ibm-plex-mono` 5.3.0.
  - Use a custom WAI-ARIA tree.
  - Use the existing Radix popover.
  - Build record edits on `CaptureEdit` and `InventoryPartSpec`.
- **Change name.** `redesign-batch-workspace`, delivering [BI-008](../../../docs/PLANNED_FUNCTIONALITY.md#bi-008--batch-workspace-redesign).
- **Branches and subjects.** Branches are `feat/redesign-batch-workspace-<bundle>`, targeting `interactive-app`. Subjects are `type(redesign-batch-workspace): …`.
- **Dependency.** Agent-backed data (sessions, live lots, regions) comes from BI-006 `simplify-intake-entry` (revised for the Examine lead session and `processing-lot-forming`, merged in #95). Until then, tasks use the `ProcessingSource` adapter over retained jobs (design D9). BI-006 supplies only data and contracts (its design D11). This change's `ProcessingSource` gains the session and observation adapter whenever those contracts exist: in task 14: one conditional PR (PR-G) after PR-C, PR-D and PR-E, which doesn't block any task, PR or BI-008.

## Completion and commit ordering

1. Complete and verify a checkbox action.
2. Mark it checked in this file.
3. Commit the work and this file together.

Keep a parent unchecked while any of its required subtasks are open. Review, publication, CI and merge actions are checked only after the event has happened.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1 Tokens, themes and fonts | Enabling/UI | None | ui-design-system: Token-driven themes; Legible in both themes; Typography and self-hosted fonts |
| 2 Component library | UI | 1 | ui-design-system: the source chip, Details disclosure and disabled-feature box at component level (Provenance on demand is owned end to end by tasks 6 and 8, and Limits stated once by task 11) |
| 3 Masthead option A and dark current | UI | 1 | header-workflow-status delta; ui-design-system: Masthead and electronics current |
| 4 Attention read model | Behavior (backend) | None | batch-navigation: Need-you panel (data) |
| 5 Batch navigation and redirects | UI/behavior | 2, 4 | batch-navigation: all requirements |
| 6 Batches home and Capture | UI | 2, 5 | capture-batch-settings delta (read-only glance without sessions); ui-design-system: Provenance on demand (Capture-tile half of No internal identifiers inline) |
| 7 Processing workspace | UI | 2, 5 | processing-workspace: Processing overview and Step page pattern without sessions; Works before agent sessions exist |
| 8 Review Lots and Map | UI | 2, 5 | review-workspace in its no-observation, no-session forms: file-level evidence, no agent line, Map before agent sessions; ui-design-system: No internal identifiers inline for the Review lot |
| 9 Record edits backend | Behavior (contracts/server) | None | review-records: Record-level edits; Supported record edits; Unsupported record changes are honest (requirement text; its proposal scenario is task 14's) |
| 10 Records UI | UI | 2, 5, 9 | review-records: Records by type and Record sources, as far as Before agent proposals exist; Steering routed to the proposing step (no-sessions scenario) |
| 11 Preparation tree and Changes | Behavior/UI | 2, 5 | changes-commit: all requirements; ui-design-system: Test target stated once, end to end |
| 12 Agents page | UI | 2, 7 | agents-overview: layout and the No session support yet scenario |
| 13 Documentation and browser qualification | Docs/evidence | 6–12 | All specs in their pre-BI-006 forms: browser evidence |
| 14 BI-006 sessions, observations and proposals (conditional) | Behavior/UI | 6, 7, 8, 9, 10, 12, and BI-006's contracts on `interactive-app` | capture-batch-settings: Read-only lots glance (with sessions); processing-workspace: Overview with running agents and the session drawer; agents-overview: Waiting sessions do not count as running; review-workspace region crops, agent line, and Map at region level with its instruction field; review-records: Ask scenario, New company with a likely match, New category proposed |

Tasks 4 and 9 are backend work and can run in parallel with the UI tasks.

## PR delivery map

| Bundle | Outcome and included work | Task coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Tokens, light and dark themes, fonts and the component library, applied app-wide through the token map; masthead option A with the dark current | 1–3 | A foundation every later screen uses. It is visible on its own (theme switch, new masthead) and changes no behaviour. | None. Merges first. | `interactive-app` ← `feat/redesign-batch-workspace-foundation`; `feat(redesign-batch-workspace): adopt design system tokens, themes and masthead` | Frontend typecheck, lint (including the literal-colour check), test and build; contrast script; browser screenshots in both themes; independent exact-head review; CI green |
| PR-B | Four tabs, second tab row, need-you panel, redirects, attention read model; Batches home and Capture redesigned | 4–6 | Navigation and the attention model ship together so the badges are real; Capture and Batches are the first screens rebuilt under the new navigation. | PR-A | `interactive-app` ← `feat/redesign-batch-workspace-navigation`; `feat(redesign-batch-workspace): four-tab batch navigation and capture` | `pnpm contracts:check`, `pnpm typecheck`, `pnpm test:intake`, `test:intake:pg`, frontend checks; redirect tests; browser check of Capture at 1440/860/390 and 200%; review; CI |
| PR-C | Processing Overview, step pages and session drawer over the `ProcessingSource` adapter; Agents page | 7, 12 | Both present agent work from one adapter and can be qualified with the fixture profile. | PR-B | `interactive-app` ← `feat/redesign-batch-workspace-processing`; `feat(redesign-batch-workspace): processing overview and step pages` | Frontend checks; fixture-profile browser check; review; CI |
| PR-D | Review Lots (Workspace and Table) and Map | 8 | The lot-centred half of Review, independent of record editing. | PR-B | `interactive-app` ← `feat/redesign-batch-workspace-review-lots`; `feat(redesign-batch-workspace): review lots and map` | Frontend checks; browser check; review; CI |
| PR-E | Record edits on capture authority, records projection, and the Records UI | 9–10 | Backend and UI for one capability, reviewable together; the server half has its own integration tests. | PR-B (UI); task 9 may start earlier | `interactive-app` ← `feat/redesign-batch-workspace-records`; `feat(redesign-batch-workspace): review and edit records` | Contracts, intake and PostgreSQL tests; frontend checks; browser check; review; CI |
| PR-F | Preparation tree, Changes Ready to add (By type and Tree) and Added; removal of the old Approve and Results screens | 11, 13 | Commits the batch on the existing authority, and ends the migration by removing the old screens. Documentation and qualification close the change. | PR-D, PR-E | `interactive-app` ← `feat/redesign-batch-workspace-changes`; `feat(redesign-batch-workspace): changes ready to add and added` | All checks; full browser qualification recorded in the handover; review; CI |
| PR-G | Task 14: the `ProcessingSource` adapter for BI-006's sessions and observations, live sessions on Processing and Agents, Tell Examine and region-level Map links, Ask, and BI-006's catalogue proposals in the records projection | 14 | One conditional PR after the screens it switches on exist, so nothing ships before its adapter or screen | PR-C, PR-D, PR-E, and BI-006's contracts on `interactive-app` | `interactive-app` ← `feat/redesign-batch-workspace-agent-data`; `feat(redesign-batch-workspace): wire agent sessions, observations and proposals` | `pnpm contracts:check`, `pnpm test:intake`, `test:intake:pg`, frontend checks; synthetic-session browser check; review; CI |

PR-C and PR-D can be reviewed in parallel after PR-B.

## 1. Tokens, themes and fonts

- **PR delivery:** PR-A.
- **Outcome:** every component reads colours, radii, spacing and shadows from token CSS variables, the theme follows the OS or an explicit choice, and both fonts load locally.
- **Scope:**
  - `frontend/src/theme/` (tokens.json, generated `tokens.css` and `tokens.ts`);
  - `GlobalStyle`, `index.html` (pre-paint script), `package.json`;
  - `frontend/scripts/`.
- **Acceptance:** Token-driven themes; Legible in both themes; Typography and self-hosted fonts. Values, theme control and the token changes listed there (`photo-scrim`, `photo-fg`, dark `part-*`, the `font-sans` stack, `color-scheme: light`) follow [handoff-pr-a.md](handoff-pr-a.md).
- **Approach:** design D1–D3. Copy the design system's `tokens.json`, apply the token changes in the handoff (and make the same changes in the artifact), and generate from it, never by hand.
- **TDD approach:** Generators and checks are written test-first: write a failing check (stale generated file, low-contrast pair, literal colour, theme switch) before each implementation. Font loading is verified in the browser.
- **Verification:** `pnpm --filter frontend typecheck lint test build`; the contrast script; a browser reload in dark mode with no wrong-theme flash.

- [ ] 1.1 Copy `tokens.json` into `frontend/src/theme/` and add a generator for `tokens.css` and `tokens.ts`, with a check that the generated files are current.
- [ ] 1.2 Add the contrast script: every text token against its documented grounds in both themes. It fails the build below threshold.
- [ ] 1.3 Add the theme controller: OS default, Light/Dark/System override, try/catch storage, `color-scheme`, and a pre-paint attribute script. Write tests for switching, persistence and throwing storage.
- [ ] 1.4 Add `@fontsource-variable/public-sans` and `@fontsource/ibm-plex-mono` (400, 500) at 5.3.0, and check that 650 and 750 render. Update the frontend architecture styling paragraph.
- [ ] 1.5 Add the literal-colour check `frontend/scripts/check-literal-colors.cjs` to `lint:frontend`, allowlisting photo-stage fixtures.

## 2. Component library

- **PR delivery:** PR-A.
- **Outcome:** `components/ui/` provides the design-system components, and existing screens render with them, with no behaviour change.
- **Scope:** `frontend/src/components/ui/`, plus a sweep of existing components onto the token map.
- **Acceptance:** the component building blocks for Provenance on demand and Limits stated once: the source chip, the details disclosure and the disabled-feature box. The "No internal identifiers inline" scenario is split between task 6 (Capture tile, with 6.4) and task 8 (Review lot), and "Test target stated once" is task 11's. Each component's props, measurements, states, motion and accessibility follow [handoff-pr-a.md](handoff-pr-a.md).
- **Approach:** design D10. Retain the behaviour of AutosaveStatus, the reference picker, AutoValueField and the tags input, restyling only.
- **TDD approach:** Each new component starts from a failing component test of its states, keyboard and ARIA. Restyling existing controls relies on their existing tests staying green.
- **Verification:** component tests for each new component (states, keyboard, ARIA); existing frontend tests pass unchanged; the literal-colour check is clean.

- [ ] 2.1 Build Button, Pill, SourceChip, Banner, ProblemCard, Toast and Kbd, with the glyph-plus-word status rule.
- [ ] 2.2 Build Tabs, SubTabs, SegmentedControl, FilterChips and Breadcrumb, with tests for roving focus and selection.
- [ ] 2.3 Build EvidenceTile, EvidenceGroup, KeyValue, RecordChain, DataTable with BulkBar, ChangeSummary and StickyFooter.
- [ ] 2.4 Build PhaseRow, QuestionCard, StatusTimeline, NeedsYou and SessionChat.
- [ ] 2.5 Restyle the AutosaveStatus, reference picker, AutoValueField, tags input and DisabledFeature to tokens, keeping their tests green.
- [ ] 2.6 Sweep the remaining components off module-scope colour literals.

## 3. Masthead option A and dark current

- **PR delivery:** PR-A.
- **Outcome:** one masthead bar with the breadcrumb; parts never cross the text; a visible dark finish.
- **Scope:** `components/masthead/`, `src/electronics-current/finishes.ts`, `scene.ts` and the mask.
- **Acceptance:** the header-workflow-status delta, and the masthead requirement of ui-design-system. Layout, order, compact behaviour and mask follow the Masthead section of [handoff-pr-a.md](handoff-pr-a.md).
- **Approach:** design D4.
- **TDD approach:** Slot order and phone-width hiding are test-first in masthead tests. Mask and finish are visual, so they are verified by the frame-sampling browser check and the contrast check.
- **Verification:**
  - Masthead tests: slot order, and phone-width hiding of the breadcrumb and activity labels.
  - Browser frame sampling showing no part over the text boxes in both themes.
  - The reduced-motion still frame.

- [ ] 3.1 Merge the masthead into one bar, in the order wordmark, Dev badge, breadcrumb, spacer, activity, connection, Open InvenTree, and update its tests.
- [ ] 3.2 Widen the mask per D4 and add the frame-sampling browser check.
- [ ] 3.3 Split the finishes into light and dark, re-tint on theme change without rebuilding geometry, and check outline contrast.

## 4. Attention read model

- **PR delivery:** PR-B.
- **Outcome:** one read gives every tab badge and the need-you items, each with a route.
- **Scope:** `contracts/src/` (attention schema), `intake-server/src/` (route and projection from processing questions, review state, records decisions and results certainty).
- **Acceptance:** Need-you panel (data); Four batch tabs (counts).
- **Approach:** design D8. Until task 9 lands, record decisions read from the operator-review problems that need a choice.
- **TDD approach:** Before the projection, write a failing route test that seeds an open question, a changed-after-review lot and an uncertain result (RED: route missing). GREEN: implement it. Then refactor and re-run the intake suites.
- **Verification:** contract and OpenAPI checks; intake tests for counts across states, including uncertain results and changed-after-review lots.

- [ ] 4.1 Add the `BatchAttention` contract and the generated client.
- [ ] 4.2 Write failing route tests for each item group and its route target (RED).
- [ ] 4.3 Implement the projection and route under the existing batch read authority until they pass (GREEN).

## 5. Batch navigation and redirects

- **PR delivery:** PR-B.
- **Outcome:** four tabs with badges, a second tab row, the need-you panel, and legacy links redirecting.
- **Scope:** `components/batches/Batch.tsx`, a new `BatchHeader`, `navigation/`.
- **Acceptance:** batch-navigation, all requirements.
- **Approach:** design D5. Redirects go through `useNavigationGuard`.
- **TDD approach:** Before the parser, write failing route tests for each redirect row, including query-string preservation and a dirty-draft block (RED). GREEN: implement them. The visual parts of the header are verified in the browser.
- **Verification:** unit tests for every redirect, including dirty-draft blocks and pinned preparation and run IDs; keyboard and Escape tests for the panel.

- [ ] 5.1 Build the route parser and builder for the new routes, with redirect handling for `approve`, `results`, bare `review`, the legacy `review/<lot>` and subject links, bare `processing`, and `processing/reading` and `processing/identifying` (to `examine`), preserving the query string.
- [ ] 5.2 Build BatchHeader with the tabs, the second row and badges from the attention read.
- [ ] 5.3 Build the need-you panel on the Radix popover, with focus return.
- [ ] 5.4 Mount the existing Review, Approve and Results components under the new routes temporarily, until tasks 8 and 11 replace them.
- [ ] 5.5 Add a target-kind field (owned test target or configured target) to the header connection contract, and show the `info` "Test InvenTree" connection state from it, test-first. This is the single place the test target is named outside Changes.

## 6. Batches home and Capture

- **PR delivery:** PR-B.
- **Outcome:**
  - Capture matches the canvas: compact evidence tiles, controls in the viewer, a read-only Proposed lots glance, and restyled settings.
  - The Batches home matches the canvas.
- **Scope:** `components/batches/`, `components/capture/`, `components/media/`.
- **Acceptance:**
  - capture-batch-settings delta (layout, read-only glance without sessions; its status line is task 14's);
  - capture-grouped-evidence (unchanged behaviour);
  - ui-design-system Provenance on demand, including the Capture-tile half of the No internal identifiers inline scenario (6.4 removes inline IDs and revisions); task 8 owns the Review-lot half.
- **TDD approach:** The Proposed lots glance and the moved viewer controls start from failing component tests. Layout and restyling are verified by existing tests and the browser check.
- **Verification:**
  - Existing capture and media tests stay green, adjusted only for moved controls.
  - A new glance test.
  - A browser check at 1440, 860 and 390 and 200% showing Capture under 2,500 px tall for an 11-file fixture.

- [ ] 6.1 Redesign the Batches home: continue card with counted actions, compact list, search toolbar.
- [ ] 6.2 Replace evidence cards with EvidenceTile, moving crop, rotation, download and identity into the viewer and its Details.
- [ ] 6.3 Add the read-only Proposed lots glance from the `ProcessingSource` adapter, linking to Review. The per-lot agent status line appears with task 14 (PR-G).
- [ ] 6.4 Restyle Batch settings and the evidence groups. Remove inline IDs and revisions.

## 7. Processing workspace

- **PR delivery:** PR-C.
- **Outcome:** Processing › Overview and the Examine, Research, Images and Inventory step pages, each with a session drawer, over the `ProcessingSource` adapter.
- **Scope:** `frontend/src/processing/` (adapter), `components/processing/`.
- **Acceptance:** processing-workspace: the Processing overview and Step page pattern requirements in their no-session form (steps, questions, outputs, links; no session drawer), and Works before agent sessions exist (Fixture profile scenario). The session-dependent scenarios are task 14's.
- **Approach:** design D9. The retained-jobs adapter maps reading and identifying to Examine, and has no sessions.
- **TDD approach:** Before the adapter, write failing tests mapping each fixture job kind to its step, and asserting that no session appears (RED). GREEN: implement the adapter. Screen layout is verified in the browser.
- **Verification:** component tests with the fixture profile (no fabricated sessions); a browser check.

- [ ] 7.1 Define the `ProcessingSource` interface and the retained-jobs adapter, with tests mapping each job kind to its step.
- [ ] 7.2 Build Overview: step progress, the session list, Needs you, batch instructions, activity, and glances.
- [ ] 7.3 Build the step-page pattern and the Examine, Research, Images and Inventory pages from it.
- [ ] 7.4 Build the session drawer (status timeline, question, chat), shown only when the adapter reports sessions.

## 8. Review Lots and Map

- **PR delivery:** PR-D.
- **Outcome:**
  - a Lots Workspace with evidence shown immediately and problems routed to their owners;
  - a Table with scoped bulk edits;
  - a file-level Map with direct lot edits.
- **Scope:** `components/review/`, `components/operator/`.
- **Acceptance:** review-workspace in its no-observation, no-session forms: Lots workspace and table; Lot details without the agent line; Evidence pane with the lot's linked files; Problems route to their owner; Review map with file-level links and the Map before agent sessions scenario. Also ui-design-system Provenance on demand: No internal identifiers inline for the Review lot. Region crops, agent lines, region-level Map links and the instruction field are task 14's.
- **Approach:**
  - Reuse the existing operator-review commands for merge, split and move, and the existing bulk edit.
  - "Tell Examine" uses the adapter's message path, and is hidden when there are no sessions.
- **TDD approach:** Before each behaviour, write failing tests for evidence shown on selection, problem routes and Map flags (RED). GREEN: implement them. Visual restyling relies on existing tests and browser checks.
- **Verification:** existing review and operator tests stay green; new tests for keeping the place across views, problem routing and the Map flags; a browser check.

- [ ] 8.1 Rebuild the Workspace's three panes, loading the evidence pane on selection (no Inspect step).
- [ ] 8.2 Add problem fix actions that route to their owners.
- [ ] 8.3 Restyle the Table with shared selection and filters.
- [ ] 8.4 Build the Map from lot–evidence links, with flags and the existing split, merge and move commands.

## 9. Record edits backend

- **PR delivery:** PR-E.
- **Outcome:** record-level edits and the records projection on the existing capture authority.
- **Scope:** `contracts/src/capture.ts` (`record` change, `RecordRef`), `contracts/src/effects.ts` (optional Part description), `contracts/src/` (records projection), `intake-server/src/capture/` (apply), `intake-server/src/execution/` (description in `partEffects`, `decodeEffectsPlan`, `supportedCreateBody`), the owned fake, and the `/api/v1/batches/:id/records` route.
- **Acceptance:** Record-level edits with stated scope; Supported record edits; Unsupported record changes are honest (the requirement: unsupported values never enter a spec and are kept with a reason; its New category proposed scenario needs BI-006's proposals and is evidenced end to end in task 14).
- **Approach:** design D6–D7, as one transaction per edit at `expected_revision`.
- **TDD approach:** Baseline: confirm the intake and PostgreSQL suites pass. For each operation, first write a failing integration test (RED) covering CAS 412, fan-out, `set_category` refusal and `changed_after_review` read-back. GREEN: implement it, then refactor.
- **Verification:** `pnpm contracts:check`; intake and PostgreSQL integration tests for each operation, CAS 412, multi-Part fan-out, `changed_after_review`, re-validation failures, and unsupported items never entering a spec.
- **Risks:** fan-out scope. The response lists the affected Parts and lots, which the UI shows.

- [ ] 9.1 Add the `record` change kind with `RecordRef` and its operations to the contracts, with schema tests.
- [ ] 9.2 Write failing integration tests (RED) for each operation and failure path:
  - [ ] 9.2.1 CAS 412, and multi-Part fan-out in one transaction.
  - [ ] 9.2.2 Role-mismatched company map refused.
  - [ ] 9.2.3 `map_template` refused for a Part without a category mapping, unless excluded.
  - [ ] 9.2.4 `set_category` refused for unmapped, undropped parameters.
  - [ ] 9.2.5 `lotReviewState` reads `changed_after_review` for reviewed lots of an edited Part, with no capture call into operator-review.
  - [ ] 9.2.6 An existing frozen-plan fixture without a description decodes with unchanged digests; a set description reaches the owned fake and is confirmed by `fieldsMatch()`; clearing deletes the property.
- [ ] 9.3 Add the optional Part `description` to `InventoryPartSpec`, `partEffects()`, `decodeEffectsPlan()`, `supportedCreateBody()` and the owned fake, deleting the property when unset or cleared (GREEN for 9.2.6).
- [ ] 9.4 Implement the transactional apply: a new operator-attributed `choice` selection version per affected Part, re-validated with `validatePartSpec`, with the company-role, template-mapping and category rules (GREEN for 9.2.1–9.2.5).
- [ ] 9.5 Write a failing projection test, then implement the records route: records by type, "Needs a decision" Parts without a spec, per-field origin from the latest processing proposal, and proposed-new values only from retained structured proposals.

## 10. Records UI

- **PR delivery:** PR-E.
- **Outcome:** Review › Records with a type rail, list and detail; edits with stated scope; per-field "Ask".
- **Scope:** `components/review/records/`.
- **Acceptance:** Records by type and Record sources as far as Before agent proposals exist; Steering routed to the proposing step, for its no-sessions scenario (the proposing step shown, Ask hidden); the UI half of the other review-records requirements. The decision and "Not supported yet" views are built and component-tested with fixture proposals here; the end-to-end evidence for New company with a likely match, New category proposed and the Ask scenario is task 14's.
- **Approach:** the canvas screens for Companies, a Part and Parameters. "Ask" is hidden when the adapter has no sessions.
- **TDD approach:** Before each screen, write failing component tests for the scope text, the 412 path keeping drafts, and unsupported fields (RED). GREEN: implement them.
- **Verification:** component tests for each record type, the 412 path keeping drafts, and the scope text; a browser check.

- [ ] 10.1 Build the type rail with counts and decision badges, and the list per type.
- [ ] 10.2 Build the Company decision view: use the likely match or pick another observed company in the same role, with creation shown as not supported yet.
- [ ] 10.3 Build the Part record: category change with per-parameter mapping or drop, name, description, tags, parameters table, sourcing, images, unsupported fields, and the "Needs a decision" start for Parts without a spec.
- [ ] 10.4 Build Parameters across Parts with batch-wide template mapping, asking for a category mapping per affected category.
- [ ] 10.5 Add "Who proposed what" with Ask routing.

## 11. Preparation tree and Changes

- **PR delivery:** PR-F.
- **Outcome:**
  - Changes › Ready to add, with selection, By type and Tree views, and one approve action;
  - Changes › Added, with outcomes and recovery;
  - removal of the old Approve and Results screens.
- **Scope:** `contracts/src/` (preparation `tree`), `intake-server/src/review/` (tree from plan), `components/changes/`; remove `components/results/` presentation once replaced.
- **Acceptance:** changes-commit, all requirements; ui-design-system Test target stated once, end to end, with its connection half from task 5.5 and its Changes footer and outcome strip here.
- **Approach:** design D7. Reuse the existing preparation, approval, queueing and results certainty and recovery actions.
- **TDD approach:** Before the tree, write a failing test reading a stored preparation that predates it (RED) and the node-count property test. GREEN: implement the read-time projection. Port the existing manual workflow tests before removing old screens.
- **Verification:**
  - Tree property test (node counts match the By type view per state).
  - Tests for the WAI-ARIA tree keyboard pattern.
  - Existing manual workflow tests ported to the new screens: a stale preparation stays disabled, and no create-again on an unknown result.

- [ ] 11.1 Add `GET /api/v1/preparations/:id/tree`, computed from the stored plan for each plan version (`tree: null` for an unknown version). First write a failing test (RED) that reads a stored preparation of each version, and checks that replayed preparation results stay byte-identical.
- [ ] 11.2 Build Ready to add: lot selection that triggers preparation, the By type view, the Tree view with category or location grouping, and the sticky approve action.
- [ ] 11.3 Build Added: outcome strip, runs with InvenTree links, recovery actions, pending changes, not included, activity log.
- [ ] 11.4 Remove the old Approve and Results presentation after the ported tests pass.

## 12. Agents page

- **PR delivery:** PR-C.
- **Outcome:** an app-level Agents page from the adapter's sessions across batches.
- **Scope:** `components/agents/`.
- **Acceptance:** agents-overview: page layout, summary and filters, and the No session support yet scenario. Waiting sessions do not count as running is task 14's.
- **TDD approach:** Before the page, write failing tests for the summary's no-session state, the filters and the "not available for this setup" state (RED). GREEN: implement it. Slot-counting tests belong to 14.4.
- **Verification:** component tests for the no-session summary, the filters and the "not available for this setup" state.

- [ ] 12.1 Build the Agents page with summary, filters and per-batch groups.
- [ ] 12.2 Add the explicit "not available for this setup" state for adapters without sessions.

## 13. Documentation and browser qualification

- **PR delivery:** PR-F.
- **Outcome:** documentation matches the code, and browser evidence exists for every redesigned screen.
- **Scope:** `frontend/ARCHITECTURE.md`, `intake-server/ARCHITECTURE.md`, `frontend/README.md`, `docs/handovers/redesign-batch-workspace.md`.
- **Acceptance:** all specs in their pre-BI-006 forms, browser evidence. Step 14.8 records the session and proposal scenarios.
- **TDD approach:** Documentation only, so test-first does not apply. It is verified by checking each statement against the merged code, plus the markdown lint.
- **Verification:** headless screenshots of each canvas screen in both themes at 1440, 860 and 390 and 200%, against the owned fake and the fixture profile, linked from the handover, with stated limits (no live provider, no real InvenTree).

- [ ] 13.1 Rewrite the frontend architecture styling, navigation and screen sections, and update `intake-server/ARCHITECTURE.md` for the record edit, records, attention and preparation-tree reads.
- [ ] 13.2 Record the browser qualification and any deviations from the canvas in the handover.

## 14. BI-006 sessions, observations and proposals (conditional)

- **PR delivery:** PR-G, as one PR, once PR-C, PR-D and PR-E have merged and BI-006's contracts are on `interactive-app`. It never ships early inside another bundle, so no part can land before the adapter it needs or before its screen exists.
- **Outcome:** Processing, the Agents page, the Capture lots glance, Review › Map and Records show live sessions, region-level observations and BI-006's proposed-new and unsupported catalogue values.
- **Scope:** `frontend/src/processing/` (a second `ProcessingSource` adapter); the Processing overview session list and session drawer; the Agents page; the Capture Proposed lots glance's status line; the Review evidence pane's region crops and Lot details' agent line; the Map's region links and instruction field; the Records Ask control; and the records projection's reading of BI-006's structured catalogue proposals (`bench-intake-proposal/5`) in `contracts/src/` and `intake-server/src/` (the `/api/v1/batches/:id/records` read from task 9).
- **Prerequisites:** tasks 6, 7, 8, 9, 10 and 12, and BI-006's contracts merged. It is not a prerequisite of any other task, and BI-008 can be marked Done without it; until then the screens keep their honest "not available" states.
- **Acceptance:** capture-batch-settings: Read-only lots glance, with sessions; processing-workspace: Overview with running agents and the session drawer; agents-overview: Waiting sessions do not count as running; review-workspace: Evidence pane with region crops, Lot details with the agent line, and the Map at region level with its instruction field; review-records Steering routed to the proposing step, for the Ask scenario; review-records New company with a likely match and New category proposed, end to end.
- **TDD approach:** write failing adapter tests against BI-006's `synthetic-session/1` fixture data, and failing records-projection tests with `bench-intake-proposal/5` fixtures, first (RED), then implement (GREEN).
- **Verification:** `pnpm contracts:check`, `pnpm test:intake`, `test:intake:pg`, frontend checks, and a browser check of each screen with the synthetic session profile.

- [ ] 14.1 Write failing tests mapping BI-006 sessions, questions, inbox state and evidence observations into `ProcessingSource` (RED).
- [ ] 14.2 Implement the adapter and switch to it when the contracts are present (GREEN).
- [ ] 14.3 Turn on the Processing overview session list and the session drawer.
- [ ] 14.4 Turn on live sessions and slot counts on the Agents page, and each lot's latest agent status line in the Capture Proposed lots glance.
- [ ] 14.5 Turn on region crops in the Review evidence pane, each lot's agent line in Lot details, and Tell Examine and region-level Map links in Review › Map.
- [ ] 14.6 Turn on Ask on Records.
- [ ] 14.7 Write failing projection tests (RED), then read BI-006's structured catalogue proposals into the records projection (GREEN): proposed-new values, unsupported values with reasons, and the GCT and new-category scenarios end to end.
- [ ] 14.8 Record the browser check of every screen above in the handover.

## Delivery evidence and lifecycle follow-up

- [ ] D.1 PR-A: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization.
- [ ] D.2 PR-B: same gates.
- [ ] D.3 PR-C: same gates.
- [ ] D.4 PR-D: same gates.
- [ ] D.5 PR-E: same gates.
- [ ] D.6 PR-F: same gates. BI-008 is updated to Done only after acceptance and merge are evidenced. Task 14 is tracked separately by D.7.
- [ ] D.7 PR-G (task 14): same gates, once PR-C, PR-D, PR-E and BI-006's contracts are on `interactive-app`.

After delivery, sync and archive only when authorized, and update the index link if the change moves.
