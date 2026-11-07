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
- **Dependency.** Agent-backed data (sessions, live lots, regions) comes from BI-006 `simplify-intake-entry` (revised for the Examine lead session and `processing-lot-forming`, merged in #95). Until then, tasks use the `ProcessingSource` adapter over retained jobs (design D9). BI-006 supplies only data and contracts (its design D11). This change's `ProcessingSource` gains the session and observation adapter whenever those contracts exist: in task 14: one conditional PR (PR-G) after PR-C, PR-D and PR-E, which blocked none of tasks 1–13. The styling uplift (tasks 15–20) follows it.
- **Styling uplift.** Tasks 15–20 move the remaining styling onto the design system's tokens (version 2) and shared components, and close the visual gaps against the canvas (design D11). Their evidence is [styling-audit.md](styling-audit.md): clusters `C1`–`C18` and visual gaps by area `V1`–`V8`. Where the audit's recommendation differs from tokens v2, tokens v2 wins. Each area task's first step swaps only that area's exact values, leaving the screenshot diff unchanged. Its later steps take the visible changes: near values and the visible cluster changes (C1, C3, C4, C8, C9, C10, C15–C17), shared components and the area's gaps, each with before-and-after screenshots. Every area task also gives its controls a 44px hit area below `bp-compact` (G15).

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
| 15 Token foundation and component library | Enabling/UI | 1–14 | ui-design-system: Token-driven layout and type, and Motion and layers follow the design system (all scenarios, at component level); Screens use the shared components (at component level); Layout follows the design's widths and breakpoints (Phone width, for the library's controls) |
| 16 App shell, masthead, Batches and Agents | UI | 15 | ui-design-system: Layout follows the design's widths and breakpoints (Wide screen; Phone width for the masthead) |
| 17 Capture | UI | 15 | ui-design-system: Phone width (the Capture actions); Screens use the shared components on Capture |
| 18 Processing | UI | 15 | ui-design-system: One status vocabulary (the running step); processing-workspace: Overview with running agents and Session drawer, as laid out in the canvas |
| 19 Review Lots and Map | UI | 15 | ui-design-system: Screens use the shared components on Review; Layout follows the design's widths and breakpoints (Review's 1500px and its breakpoints) |
| 20 Records and Changes, then strict lint | UI/enabling | 15–19 | ui-design-system: One status vocabulary (Records and Changes); Literal value refused, with the lint strict |

Tasks 4 and 9 are backend work and can run in parallel with the UI tasks. Tasks 16–19 can run in any order after task 15.

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
| PR-H | Tokens v2 in the app, the screenshot-diff check and the literal-value lint baseline; the component library on tokens, one Button, Dialog and Popover surfaces, and the library's visual gaps | 15 | The foundation the area PRs build on, and their safety net | PR-G. Merges before PR-I, PR-J and PR-K. | `interactive-app` ← `feat/redesign-batch-workspace-styling-foundation`; `feat(redesign-batch-workspace): token foundation and component library` | Frontend checks; contrast script; screenshot diff unchanged for the token-swap commit; before-and-after screenshots; demo video; review; CI |
| PR-I | App shell widths and global CSS, masthead and header popovers, the batch header band, Batches, Agents and settings | 16 | The frame every screen sits in | PR-H | `interactive-app` ← `feat/redesign-batch-workspace-styling-shell`; `feat(redesign-batch-workspace): restyle app shell, masthead, batches and agents` | As PR-H |
| PR-J | Capture and Processing, each as its own task and commits | 17, 18 | Two mid-sized areas that share no files, reviewed together to keep the PR count down | PR-H | `interactive-app` ← `feat/redesign-batch-workspace-styling-capture-processing`; `feat(redesign-batch-workspace): restyle capture and processing` | As PR-H |
| PR-K | Review Lots and Map, then Records and Changes, ending with the strict lint | 19, 20 | The rest of Review and Changes; the lint can only become strict once every area is clean | PR-H, PR-I, PR-J | `interactive-app` ← `feat/redesign-batch-workspace-styling-review-changes`; `feat(redesign-batch-workspace): restyle review, records and changes` | As PR-H, plus the strict lint and a final screenshot pass over every screen |

PR-C and PR-D can be reviewed in parallel after PR-B. PR-I and PR-J can be reviewed in parallel after PR-H.

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

- [x] 1.1 Copy `tokens.json` into `frontend/src/theme/` and add a generator for `tokens.css` and `tokens.ts`, with a check that the generated files are current.
- [x] 1.2 Add the contrast script: every text token against its documented grounds in both themes. It fails the build below threshold.
- [x] 1.3 Add the theme controller: OS default, Light/Dark/System override, try/catch storage, `color-scheme`, and a pre-paint attribute script. Write tests for switching, persistence and throwing storage.
- [x] 1.4 Add `@fontsource-variable/public-sans` and `@fontsource/ibm-plex-mono` (400, 500) at 5.3.0, and check that 650 and 750 render. Update the frontend architecture styling paragraph.
- [x] 1.5 Add the literal-colour check `frontend/scripts/check-literal-colors.cjs` to `lint:frontend`, allowlisting photo-stage fixtures.

## 2. Component library

- **PR delivery:** PR-A.
- **Outcome:** `components/ui/` provides the design-system components, and existing screens render with them, with no behaviour change.
- **Scope:** `frontend/src/components/ui/`, plus a sweep of existing components onto the token map.
- **Acceptance:** the component building blocks for Provenance on demand and Limits stated once: the source chip, the details disclosure and the disabled-feature box. The "No internal identifiers inline" scenario is split between task 6 (Capture tile, with 6.4) and task 8 (Review lot), and "Test target stated once" is task 11's. Each component's props, measurements, states, motion and accessibility follow [handoff-pr-a.md](handoff-pr-a.md).
- **Approach:** design D10. Retain the behaviour of AutosaveStatus, the reference picker, AutoValueField and the tags input, restyling only.
- **TDD approach:** Each new component starts from a failing component test of its states, keyboard and ARIA. Restyling existing controls relies on their existing tests staying green.
- **Verification:** component tests for each new component (states, keyboard, ARIA); existing frontend tests pass unchanged; the literal-colour check is clean.

- [x] 2.1 Build Button, Pill, SourceChip, Banner, ProblemCard, Toast and Kbd, with the glyph-plus-word status rule.
- [x] 2.2 Build Tabs, SubTabs, SegmentedControl, FilterChips and Breadcrumb, with tests for roving focus and selection.
- [x] 2.3 Build EvidenceTile, EvidenceGroup, KeyValue, RecordChain, DataTable with BulkBar, ChangeSummary and StickyFooter.
- [x] 2.4 Build PhaseRow, QuestionCard, StatusTimeline, NeedsYou and SessionChat.
- [x] 2.5 Restyle the AutosaveStatus, reference picker, AutoValueField, tags input and DisabledFeature to tokens, keeping their tests green.
- [x] 2.6 Sweep the remaining components off module-scope colour literals.

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

- [x] 3.1 Merge the masthead into one bar, in the order wordmark, Dev badge, breadcrumb, spacer, activity, connection, Open InvenTree, and update its tests.
- [x] 3.2 Widen the mask per D4 and add the frame-sampling browser check.
- [x] 3.3 Split the finishes into light and dark, re-tint on theme change without rebuilding geometry, and check outline contrast.

## 4. Attention read model

- **PR delivery:** PR-B.
- **Outcome:** one read gives every tab badge and the need-you items, each with a route.
- **Scope:** `contracts/src/` (attention schema), `intake-server/src/` (route and projection from processing questions, review state, records decisions and results certainty).
- **Acceptance:** Need-you panel (data); Four batch tabs (counts).
- **Approach:** design D8. Until task 9 lands, record decisions read from the operator-review problems that need a choice.
- **TDD approach:** Before the projection, write a failing route test that seeds an open question, a changed-after-review lot and an uncertain result (RED: route missing). GREEN: implement it. Then refactor and re-run the intake suites.
- **Verification:** contract and OpenAPI checks; intake tests for counts across states, including uncertain results and changed-after-review lots.

- [x] 4.1 Add the `BatchAttention` contract and the generated client.
- [x] 4.2 Write failing route tests for each item group and its route target (RED).
- [x] 4.3 Implement the projection and route under the existing batch read authority until they pass (GREEN).

## 5. Batch navigation and redirects

- **PR delivery:** PR-B.
- **Outcome:** four tabs with badges, a second tab row, the need-you panel, and legacy links redirecting.
- **Scope:** `components/batches/Batch.tsx`, a new `BatchHeader`, `navigation/`.
- **Acceptance:** batch-navigation, all requirements.
- **Approach:** design D5. Redirects go through `useNavigationGuard`.
- **TDD approach:** Before the parser, write failing route tests for each redirect row, including query-string preservation and a dirty-draft block (RED). GREEN: implement them. The visual parts of the header are verified in the browser.
- **Verification:** unit tests for every redirect, including dirty-draft blocks and pinned preparation and run IDs; keyboard and Escape tests for the panel.

- [x] 5.1 Build the route parser and builder for the new routes, with redirect handling for `approve`, `results`, bare `review`, the legacy `review/<lot>` and subject links, bare `processing`, and `processing/reading` and `processing/identifying` (to `examine`), preserving the query string.
- [x] 5.2 Build BatchHeader with the tabs, the second row and badges from the attention read.
- [x] 5.3 Build the need-you panel on the Radix popover, with focus return.
- [x] 5.4 Mount the existing Review, Approve and Results components under the new routes temporarily, until tasks 8 and 11 replace them.
- [x] 5.5 Add a target-kind field (owned test target or configured target) to the header connection contract, and show the `info` "Test InvenTree" connection state from it, test-first. This is the single place the test target is named outside Changes.

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

- [x] 6.1 Redesign the Batches home: continue card with counted actions, compact list, search toolbar.
- [x] 6.2 Replace evidence cards with EvidenceTile, moving crop, rotation, download and identity into the viewer and its Details.
- [x] 6.3 Add the read-only Proposed lots glance, linking to Review. It reads proposed lots through a small source function over the existing lot reads, which task 7.1 folds into the `ProcessingSource` adapter, so no part of task 7 moves into PR-B. The per-lot agent status line appears with task 14 (PR-G).
- [x] 6.4 Restyle Batch settings and the evidence groups. Remove inline IDs and revisions.

## 7. Processing workspace

- **PR delivery:** PR-C.
- **Outcome:** Processing › Overview and the Examine, Research, Images and Inventory step pages, each with a session drawer, over the `ProcessingSource` adapter.
- **Scope:** `frontend/src/processing/` (adapter), `components/processing/`.
- **Acceptance:** processing-workspace: the Processing overview and Step page pattern requirements in their no-session form (steps, questions, outputs, links; no session drawer), and Works before agent sessions exist (Fixture profile scenario). The session-dependent scenarios are task 14's.
- **Approach:** design D9. The retained-jobs adapter maps reading and identifying to Examine, and has no sessions.
- **TDD approach:** Before the adapter, write failing tests mapping each fixture job kind to its step, and asserting that no session appears (RED). GREEN: implement the adapter. Screen layout is verified in the browser.
- **Verification:** component tests with the fixture profile (no fabricated sessions); a browser check.

- [x] 7.1 Define the `ProcessingSource` interface and the retained-jobs adapter, with tests mapping each job kind to its step.
- [x] 7.2 Build Overview: step progress, the session list, Needs you, batch instructions, activity, and glances.
- [x] 7.3 Build the step-page pattern and the Examine, Research, Images and Inventory pages from it.
- [x] 7.4 Build the session drawer (status timeline, question, chat), shown only when the adapter reports sessions.

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

- [x] 8.1 Rebuild the Workspace's three panes, loading the evidence pane on selection (no Inspect step).
- [x] 8.2 Add problem fix actions that route to their owners.
- [x] 8.3 Restyle the Table with shared selection and filters. (The "excluded" filter waits for the Exclude command in Task 9/10.)
- [x] 8.4 Build the Map from lot–evidence links, with flags and the existing split, merge and move commands.

## 9. Record edits backend

- **PR delivery:** PR-E.
- **Outcome:** record-level edits and the records projection on the existing capture authority.
- **Scope:** `contracts/src/records.ts` (`record` change, `RecordRef`, added to the `contracts/src/capture.ts` edit union), `contracts/src/effects.ts` (optional Part description), `contracts/src/` (records projection), `intake-server/src/capture/` (apply), `intake-server/src/execution/` (description in `partEffects`, `decodeEffectsPlan`, `supportedCreateBody`), the owned fake, and the `/api/v1/batches/:id/records` route.
- **Acceptance:** Record-level edits with stated scope; Supported record edits; Unsupported record changes are honest (the requirement: unsupported values never enter a spec and are kept with a reason; its New category proposed scenario needs BI-006's proposals and is evidenced end to end in task 14).
- **Approach:** design D6–D7, as one transaction per edit at `expected_revision`.
- **TDD approach:** Baseline: confirm the intake and PostgreSQL suites pass. For each operation, first write a failing integration test (RED) covering CAS 412, fan-out, `set_category` refusal and `changed_after_review` read-back. GREEN: implement it, then refactor.
- **Verification:** `pnpm contracts:check`; intake and PostgreSQL integration tests for each operation, CAS 412, multi-Part fan-out, `changed_after_review`, re-validation failures, and unsupported items never entering a spec.
- **Risks:** fan-out scope. The shared `recordScope` gives the affected Parts and lots, which the UI shows before saving.

- [x] 9.1 Add the `record` change kind with `RecordRef` and its operations to the contracts, with schema tests.
- [x] 9.2 Write failing integration tests (RED) for each operation and failure path:
  - [x] 9.2.1 CAS 412, and multi-Part fan-out in one transaction.
  - [x] 9.2.2 Role-mismatched company map refused.
  - [x] 9.2.3 `map_template` refused for a Part without a category mapping, unless excluded.
  - [x] 9.2.4 `set_category` refused for unmapped, undropped parameters.
  - [x] 9.2.5 `lotReviewState` reads `changed_after_review` for reviewed lots of an edited Part, with no capture call into operator-review.
  - [x] 9.2.6 An existing frozen-plan fixture without a description decodes with unchanged digests; a set description reaches the owned fake and is confirmed by `fieldsMatch()`; clearing deletes the property.
- [x] 9.3 Add the optional Part `description` to `InventoryPartSpec`, `partEffects()`, `decodeEffectsPlan()`, `supportedCreateBody()` and the owned fake, deleting the property when unset or cleared (GREEN for 9.2.6).
- [x] 9.4 Implement the transactional apply: a new operator-attributed `choice` selection version per affected Part, re-validated with `validatePartSpec`, with the company-role, template-mapping and category rules (GREEN for 9.2.1–9.2.5).
- [x] 9.5 Write a failing projection test, then implement the records route: records by type, "Needs a decision" Parts without a spec, per-field origin from a retained processing proposal (about the Part or one of its lots) the field still matches, and proposed-new values only from retained structured proposals.

## 10. Records UI

- **PR delivery:** PR-E.
- **Outcome:** Review › Records with a type rail, list and detail; edits with stated scope; per-field "Ask".
- **Scope:** `components/review/records/`.
- **Acceptance:** Records by type and Record sources as far as Before agent proposals exist; Steering routed to the proposing step, for its no-sessions scenario (the proposing step shown, Ask hidden); the UI half of the other review-records requirements. The decision and "Not supported yet" views are built and component-tested with fixture proposals here; the end-to-end evidence for New company with a likely match, New category proposed and the Ask scenario is task 14's.
- **Approach:** the canvas screens for Companies, a Part and Parameters. "Ask" is hidden when the adapter has no sessions.
- **TDD approach:** Before each screen, write failing component tests for the scope text, the 412 path keeping drafts, and unsupported fields (RED). GREEN: implement them.
- **Verification:** component tests for each record type, the 412 path keeping drafts, and the scope text; a browser check.

- [x] 10.1 Build the type rail with counts and decision badges, and the list per type.
- [x] 10.2 Build the Company decision view: use the likely match or pick another observed company in the same role, with creation shown as not supported yet.
- [x] 10.3 Build the Part record: category change with per-parameter mapping or drop, name, description, tags, parameters table, sourcing, images, unsupported fields, and the "Needs a decision" start for Parts without a spec.
- [x] 10.4 Build Parameters across Parts with batch-wide template mapping, asking for a category mapping per affected category.
- [x] 10.5 Add "Who proposed what", with Ask hidden until agent sessions exist (Ask routing is 14.6).

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

- [x] 11.1 Add `GET /api/v1/preparations/:id/tree`, computed from the stored plan for each plan version (`nodes: null` for an unknown version). First write a failing test (RED) that reads a stored preparation of each version, and checks that replayed preparation results stay byte-identical.
- [x] 11.2 Build Ready to add: lot selection that triggers preparation, the By type view, the Tree view with category or location grouping, and the sticky approve action.
- [x] 11.3 Build Added: outcome strip, runs with InvenTree links, recovery actions, pending changes, not included, activity log. A value InvenTree rejected is named and linked to where it is set (Review, or Capture for a new location or supplier); re-sending a corrected value needs the executor to settle a refused create, which is follow-up work outside this change (design D7).
- [x] 11.4 Remove the old Approve and Results presentation after the ported tests pass.

## 12. Agents page

- **PR delivery:** PR-C.
- **Outcome:** an app-level Agents page from the adapter's sessions across batches.
- **Scope:** `components/agents/`.
- **Acceptance:** agents-overview: page layout, summary and filters, and the No session support yet scenario. Waiting sessions do not count as running is task 14's.
- **TDD approach:** Before the page, write failing tests for the summary's no-session state, the filters and the "not available for this setup" state (RED). GREEN: implement it. Slot-counting tests belong to 14.4.
- **Verification:** component tests for the no-session summary, the filters and the "not available for this setup" state.

- [x] 12.1 Build the Agents page with summary, filters and per-batch groups.
- [x] 12.2 Add the explicit "not available for this setup" state for adapters without sessions.

## 13. Documentation and browser qualification

- **PR delivery:** PR-F.
- **Outcome:** documentation matches the code, and browser evidence exists for every redesigned screen.
- **Scope:** `frontend/ARCHITECTURE.md`, `intake-server/ARCHITECTURE.md`, `frontend/README.md`, `docs/handovers/redesign-batch-workspace.md`.
- **Acceptance:** all specs in their pre-BI-006 forms, browser evidence. Step 14.8 records the session and proposal scenarios.
- **TDD approach:** Documentation only, so test-first does not apply. It is verified by checking each statement against the merged code, plus the markdown lint.
- **Verification:** headless screenshots of each canvas screen in both themes at 1440, 860 and 390 and 200%, against the owned fake and the fixture profile, linked from the handover, with stated limits (no live provider, no real InvenTree).

- [x] 13.1 Rewrite the frontend architecture styling, navigation and screen sections, and update `intake-server/ARCHITECTURE.md` for the record edit, records, attention and preparation-tree reads.
- [x] 13.2 Record the browser qualification and any deviations from the canvas in the handover.

## 14. BI-006 sessions, observations and proposals (conditional)

- **PR delivery:** PR-G, as one PR, once PR-C, PR-D and PR-E have merged and BI-006's contracts are on `interactive-app`. It never ships early inside another bundle, so no part can land before the adapter it needs or before its screen exists.
- **Outcome:** Processing, the Agents page, the Capture lots glance, Review › Map and Records show live sessions, region-level observations and BI-006's proposed-new and unsupported catalogue values.
- **Scope:** `frontend/src/processing/` (a second `ProcessingSource` adapter); the Processing overview session list and session drawer; the Agents page; the Capture Proposed lots glance's status line; the Review evidence pane's region crops and Lot details' agent line; the Map's region links and instruction field; the Records Ask control; and the records projection's reading of BI-006's structured catalogue proposals (`bench-intake-proposal/5`) in `contracts/src/` and `intake-server/src/` (the `/api/v1/batches/:id/records` read from task 9).
- **Prerequisites:** tasks 6, 7, 8, 9, 10 and 12, and BI-006's contracts merged. It was not a prerequisite of tasks 1–13; until it landed the screens kept their honest "not available" states. Task 15 follows it.
- **Acceptance:** capture-batch-settings: Read-only lots glance (its agent status line); processing-workspace: Overview with running agents, and Session drawer; agents-overview: Waiting sessions do not count as running; review-workspace: Lot details with the agent line, Evidence pane with region crops, and Map at region level with its instruction field; review-records: Ask about a proposed value (steering routed to the proposing step), New company with a likely match, and New category proposed, end to end.
- **TDD approach:** write failing adapter tests against BI-006's `synthetic-session/1` fixture data, and failing records-projection tests with `bench-intake-proposal/5` fixtures, first (RED), then implement (GREEN).
- **Verification:** `pnpm contracts:check`, `pnpm test:intake`, `test:intake:pg`, frontend checks, and a browser check of each screen with the synthetic session profile.

- [x] 14.1 Write failing tests mapping BI-006 sessions, questions, inbox state and evidence observations into `ProcessingSource` (RED).
- [x] 14.2 Implement the adapter and switch to it when the contracts are present (GREEN).
- [x] 14.3 Turn on the Processing overview session list and the session drawer.
- [x] 14.4 Turn on live sessions and slot counts on the Agents page, and each lot's latest agent status line in the Capture Proposed lots glance.
- [x] 14.5 Turn on region crops in the Review evidence pane, each lot's agent line in Lot details, and Tell Examine and region-level Map links in Review › Map.
- [x] 14.6 Turn on Ask on Records.
- [x] 14.7 Write failing projection tests (RED), then read BI-006's structured catalogue proposals into the records projection (GREEN): proposed-new values, unsupported values with reasons, and the GCT and new-category scenarios end to end.
- [x] 14.8 Record the browser check of every screen above in the handover.

## 15. Token foundation and component library

- **PR delivery:** PR-H.
- **Outcome:** the app's tokens match design system v2, every token family is generated, and a screenshot diff and a literal-value lint guard the later tasks. The component library uses tokens throughout, has one Button and shared Dialog and Popover surfaces, and matches the design in its states, glyphs and motion.
- **Scope:** `frontend/src/theme/` and its generator, `frontend/scripts/` checks, `components/ui/` (including `media.ts`, `primitives.tsx` and a motion module). Gaps G15 for `components/ui/` (Button `link` and `sm`, interactive chips and links). Audit clusters C1, C2, C3 (library cards), C5–C7, C8 (`media.ts`), C9, C10, C15, C16 and C18, and gaps V1.
- **Prerequisites:** tasks 1–14.
- **Acceptance:** ui-design-system: Token-driven layout and type (Literal value refused, for the library); Layout follows the design's widths and breakpoints (Phone width, for the library's controls); Motion and layers follow the design system (Reduced motion; Toast above an open menu); Screens use the shared components, at component level.
- **TDD approach:** a failing component or layout test first (RED) for each behaviour that changes (states, glyphs, layers, motion under reduced motion, layout at a breakpoint), then the change (GREEN). Token swaps need no new tests: the screenshot diff proves them. The generator's contract test and the lint's tests fail first on the new families.
- **Verification:** frontend typecheck, lint (with the literal-value baseline), tests and build; the contrast script; the screenshot diff unchanged for the token-swap commit; before-and-after screenshots of every changed screen in both themes at 1440 and 390 px (plus 860 px and 200% zoom where a layout changes), recorded in the handover; a demo video on the PR.

- [ ] 15.1 Add the screenshot-diff check over every owned fixture page in light and dark at 1440 and 390 px, with a `pnpm` command and its use documented in `frontend/README.md`, and capture its baseline before any other change in this task, so 15.2 and 15.3 are diffed against it.
- [ ] 15.2 Copy the design system's tokens v2 into `frontend/src/theme/tokens.json`; write failing generator contract tests for the `duration`, `easing`, `zIndex`, `breakpoint`, `opacity` and `size` families and the new spacing and radius steps (RED), then generate them as CSS custom properties and typed constants (GREEN), with each type style's size, line-height, weight and letter-spacing also emitted as its own variable.
- [ ] 15.3 Make `ui/media.ts` use the generated breakpoints and add a shared motion module (keyframes, durations, easings, reduced-motion guard) in place of the library's duplicated `pulse` keyframes (Progress, PhaseRow); 16.3 removes the header popovers' copies.
- [ ] 15.4 Extend the literal-colour lint to spacing, radius, shadow, type, z-index, duration, easing, breakpoint, opacity and size values in components that equal a token, judging equality only against the tokens meant for each property (design D11, including `min-height` and `min-width` against `size-*`), leaving a value whose equal token has the wrong role for the visible step, allowing values with no token, grid track widths (`grid-template-*`), values with an annotated allow comment because their role has no token, `calc()` adjustments of a token, the scene palette and photo masks (design D11), and counting a type property as token-equal when it matches that property's variable, reporting the file, line and token to use, with a recorded baseline that a change may only shrink.
- [ ] 15.5 Swap exact values for tokens in `components/ui/` and `primitives.tsx`, with the screenshot diff unchanged.
- [ ] 15.6 Make `primitives.Button` the shared `ui/Button`, and add `Dialog` and `Popover` surfaces (radius, padding, shadow, layer and motion from tokens).
- [ ] 15.7 Close the library's V1 gaps: G3 (each status's glyph and colour), G7 and G11 (a shared hover-transition mixin, applied to the library's hover rules; G7's Batches, HeaderStatus and MastheadMenu sites go to 16.6 and EvidenceActions to 17.5), G8 (table row hover), G10 (toast exit), the toast's layer from `z-index: 50` to `z-toast`, G15 for the library's own controls (Button `link` and `sm`, interactive chips and links) and the `Banner` component's part of G12; and move the library's near values and visible cluster changes onto tokens (C2, C3, C9, C10, C15, C16, and C18's control heights and icon sizes), with before-and-after screenshots. The other V1 gaps belong to the area task that owns their files: G1 and G9 to task 16, G2 to tasks 16 and 19, G4 to task 20, G5 and G16 (Processing) to task 18, G6 to tasks 17 and 19, G12's screens to tasks 17, 18 and 20, G13, G14 and G17 to task 19, G15's screen-local controls to every area task, and G16 (Records) to task 20.
- [ ] 15.8 Record the screenshots, the shrunk baseline and the results in the handover.

## 16. App shell, masthead, Batches and Agents

- **PR delivery:** PR-I.
- **Outcome:** pages sit at the design's content widths, the masthead stays one row at phone width, the batch header is the design's full-width band with tab counts, and Batches, Agents and settings match the canvas.
- **Scope:** `App.tsx` and global CSS, `components/masthead/` and the header popovers (`NeedYouPanel`, `MastheadMenu`, `HeaderDisclosure`), `BatchHeader`, `components/batches/`, `components/agents/` (including `AgentSettings*`) and `components/operations/`. Clusters C1, C3, C4, C8 (the app shell's 700px), C9, C10 and C15–C17, and gaps V2, V3 and V6, plus G1, G2 (the app shell), G7 (Batches, HeaderStatus and MastheadMenu), G9 and G15 for these screens.
- **Prerequisites:** task 15.
- **Acceptance:** ui-design-system: Layout follows the design's widths and breakpoints (Wide screen; Phone width for the masthead).
- **TDD approach:** a failing component or layout test first (RED) for each behaviour that changes (states, glyphs, layers, motion under reduced motion, layout at a breakpoint), then the change (GREEN). Token swaps need no new tests: the screenshot diff proves them.
- **Verification:** frontend typecheck, lint (with the literal-value baseline), tests and build; the contrast script; the screenshot diff unchanged for the token-swap commit; before-and-after screenshots of every changed screen in both themes at 1440 and 390 px (plus 860 px and 200% zoom where a layout changes), recorded in the handover; a demo video on the PR.

- [ ] 16.1 Swap exact values for tokens in these areas, with the screenshot diff unchanged.
- [ ] 16.2 Set the content widths (G1) (`width-content`, `width-review`) and page padding (`space-6` at desktop, at least `space-4` at phone width), move the app shell's 700px query to `bp-compact` (G2), and move the global focus ring and body type onto tokens.
- [ ] 16.3 Move the three header popovers onto `Popover` (closing G9) and drop their copied keyframes (C6), keep the masthead to one row at phone width (M2), and give these screens' controls a 44px hit area below `bp-compact` (G15).
- [ ] 16.4 Make the batch header a full-width band (M5, M8) with the tabs on the title row, the second tab row as its own band, tab counts with sub-tab counts and badges (M9), and the Processing step icons.
- [ ] 16.5 Close the V3 and V6 gaps (B1–B7, A1–A4) on Batches, Agents and Agent settings (`components/agents/AgentSettings*`).
- [ ] 16.6 Apply the hover-transition mixin to G7's Batches, HeaderStatus and MastheadMenu rows, move this area's near values and visible cluster changes (C3, C4, C9, C10, C15–C17) onto tokens, local button look-alikes onto `Button` (C1), with before-and-after screenshots, and close the remaining V2 gaps: M1, M3, M4, M6, M7, M10 and M11.
- [ ] 16.7 Record the screenshots and results in the handover.

## 17. Capture

- **PR delivery:** PR-J.
- **Outcome:** Capture matches the canvas: outlined capture-action tiles with a glyph and a subline, groups with an inline name and small actions, the move handle on the tile, and the Proposed lots glance as thumbnail rows with a footer band.
- **Scope:** `components/capture/` and `components/media/`, including `MediaCropDialog` onto `Dialog`. Gaps V4 (K1–K10), G6, G7 (`EvidenceActions`), G12 and G15 for Capture, and the Capture rows of clusters C1, C3, C4, C8 (430px, and the inclusive 760px and 860px edges), C9, C10 and C15–C17.
- **Prerequisites:** task 15.
- **Acceptance:** ui-design-system: Phone width (the Capture actions); Screens use the shared components on Capture.
- **TDD approach:** a failing component or layout test first (RED) for each behaviour that changes (states, glyphs, layers, motion under reduced motion, layout at a breakpoint), then the change (GREEN). Token swaps need no new tests: the screenshot diff proves them.
- **Verification:** frontend typecheck, lint (with the literal-value baseline), tests and build; the contrast script; the screenshot diff unchanged for the token-swap commit; before-and-after screenshots of every changed screen in both themes at 1440 and 390 px (plus 860 px and 200% zoom where a layout changes), recorded in the handover; a demo video on the PR.

- [ ] 17.1 Swap exact values for tokens in Capture and media, with the screenshot diff unchanged, recording in the handover each inclusive 760px or 860px query that moves to just below its token's edge.
- [ ] 17.2 Restyle the capture actions as the design's tiles (K1), and give every Capture control a 44px hit area below `bp-compact` (G15).
- [ ] 17.3 Restyle evidence groups and tiles (K3–K5): inline group name, small and ghost actions, the move handle on the tile.
- [ ] 17.4 Restyle the Proposed lots glance (K6; its chips onto `Pill`, G6), and move `MediaCropDialog` onto `Dialog`.
- [ ] 17.5 Move Capture's notices onto `Banner` (G12), apply the hover-transition mixin to `EvidenceActions` (G7), move this area's near values and visible cluster changes (C3, C4, C8: 430px to `bp-phone`, C9, C10, C15–C17) onto tokens, local button look-alikes onto `Button` (C1), with before-and-after screenshots, and close the remaining V4 gaps: K2, K7, K8, K9 and K10.
- [ ] 17.6 Record the screenshots and results in the handover.

## 18. Processing

- **PR delivery:** PR-J.
- **Outcome:** the Processing overview is the canvas's two-column layout with a step progress bar, Needs-you items as cards and activity as a timeline; the session drawer docks on the right with its timeline and chat; running states use the accent colour.
- **Scope:** `components/processing/`, the session drawer and `ui/PhaseRow.tsx` (P10, P11). Gaps V5, G5, G12 and G16 for Processing and the drawer, and G15, plus the Processing rows of clusters C1, C3, C4, C8 (480px, an exact swap with its edge recorded), C9, C10 and C15–C17.
- **Prerequisites:** task 15.
- **Acceptance:** ui-design-system: One status vocabulary (the running step); processing-workspace: Overview with running agents and Session drawer, as laid out in the canvas.
- **TDD approach:** a failing component or layout test first (RED) for each behaviour that changes (states, glyphs, layers, motion under reduced motion, layout at a breakpoint), then the change (GREEN). Token swaps need no new tests: the screenshot diff proves them.
- **Verification:** frontend typecheck, lint (with the literal-value baseline), tests and build; the contrast script; the screenshot diff unchanged for the token-swap commit; before-and-after screenshots of every changed screen in both themes at 1440 and 390 px (plus 860 px and 200% zoom where a layout changes), recorded in the handover; a demo video on the PR.

- [ ] 18.1 Swap exact values for tokens in Processing, with the screenshot diff unchanged, recording in the handover the inclusive 480px query that moves to just below `bp-phone`.
- [ ] 18.2 Lay out the overview in two columns (P1, P2, P4, P5) with the step progress bar, Needs-you cards and the activity timeline.
- [ ] 18.3 Dock the session drawer on the right (P9) with its timeline and chat, use the accent colour for running states (G5), and restyle the Processing banners, empty states (G12, G16) and phone-width hit areas (G15).
- [ ] 18.4 Move this area's near values and visible cluster changes (C3, C4, C9, C10, C15–C17) onto tokens, local button look-alikes onto `Button` (C1), with before-and-after screenshots, and close the remaining V5 gaps: P3, P6, P7, P8, P10 and P11 (P10 and P11 in `ui/PhaseRow.tsx`).
- [ ] 18.5 Record the screenshots and results in the handover.

## 19. Review Lots and Map

- **PR delivery:** PR-K.
- **Outcome:** Review uses the shared components and the design's breakpoints: lot rows with thumbnails and a current-row border, the view switch as `SegmentedControl`, filters as `FilterChips` that wrap at phone width, the table as `DataTable` with the dark `BulkBar` above it, and styled Map controls with Tell Examine inside its card.
- **Scope:** `components/review/` (Lots and Map) and `components/operator/`, including `Modal` onto `Dialog` and `StatusChip` onto `Pill`. Gaps V7 (Lots and Map), G2, G6, G13, G14, G15 and G17 for Review, clusters C8 (700px to `bp-compact`, 1000px to `bp-wide`), C1, C3, C4, C9, C10, C11 (`ReviewTable`, `CompareMatches`), C12, C13 and C15–C17.
- **Prerequisites:** task 15.
- **Acceptance:** ui-design-system: Screens use the shared components on Review; Layout follows the design's widths and breakpoints (Review's 1500px and its breakpoints).
- **TDD approach:** a failing component or layout test first (RED) for each behaviour that changes (states, glyphs, layers, motion under reduced motion, layout at a breakpoint), then the change (GREEN). Token swaps need no new tests: the screenshot diff proves them.
- **Verification:** frontend typecheck, lint (with the literal-value baseline), tests and build; the contrast script; the screenshot diff unchanged for the token-swap commit; before-and-after screenshots of every changed screen in both themes at 1440 and 390 px (plus 860 px and 200% zoom where a layout changes), recorded in the handover; a demo video on the PR.

- [ ] 19.1 Swap exact values for tokens in Review Lots, Map and the operator components, with the screenshot diff unchanged, recording in the handover the inclusive 600px queries (`RestructureDialog`, `ImpactSummary`) that move to just below `bp-narrow`.
- [ ] 19.2 Move Review's breakpoints onto `bp-compact` and `bp-wide` (G2), with screenshots at 700–800 and 1000–1200 px.
- [ ] 19.3 Move `StatusChip` (G6), the filters, the view switch and the tables (R1, R2, R11, R12) onto `Pill`, `FilterChips`, `SegmentedControl` and `DataTable` with `BulkBar`, and `Modal` onto `Dialog`.
- [ ] 19.4 Restyle the lot rows (R4), the observation cards and their small buttons (R14), the Map's selects (G13) and Tell Examine placement, the evidence pane's broken-preview and date text (G14, G17), and phone-width hit areas (G15).
- [ ] 19.5 Move this area's near values and visible cluster changes (C3, C4, C9, C10, C15–C17) onto tokens, local button look-alikes onto `Button` (C1), with before-and-after screenshots, and close the remaining V7 gaps for Lots and Map: R3, R5, R6, R7, R8, R9, R10 and R13.
- [ ] 19.6 Record the screenshots and results in the handover.

## 20. Records and Changes, then strict lint

- **PR delivery:** PR-K.
- **Outcome:** Records and Changes match the canvas, with one status vocabulary between them; nothing uses `primitives.Notice` or the legacy primitives any more; and the literal-value lint is strict.
- **Scope:** `components/review/records/`, `components/changes/`, the remaining `primitives.Notice` users and leftover legacy primitives. Gaps V7 (Records) and V8, G4, G12 (Added), G15 and G16 (Records), and clusters C1, C3, C4, C8 (`RecordsStage`'s inclusive 860px edge), C9, C10, C11 (`RecordDetail`'s table onto `DataTable`), C14 and C15–C17.
- **Prerequisites:** tasks 15–19.
- **Acceptance:** ui-design-system: One status vocabulary (Records and Changes); Literal value refused, with the lint strict.
- **TDD approach:** a failing component or layout test first (RED) for each behaviour that changes (states, glyphs, layers, motion under reduced motion, layout at a breakpoint), then the change (GREEN). Token swaps need no new tests: the screenshot diff proves them.
- **Verification:** frontend typecheck, lint (with the literal-value baseline), tests and build; the contrast script; the screenshot diff unchanged for the token-swap commit; before-and-after screenshots of every changed screen in both themes at 1440 and 390 px (plus 860 px and 200% zoom where a layout changes), recorded in the handover; a demo video on the PR. Also a final screenshot pass over every screen.

- [ ] 20.1 Swap exact values for tokens in Records and Changes, with the screenshot diff unchanged, recording in the handover each inclusive 860px query that moves to just below `bp-stacked`.
- [ ] 20.2 Restyle the Records type rail (R15), `RecordDetail`'s table onto `DataTable`, its empty state (G16), and the Ready to add layout and lot rows (X1, X2); give New, Update and Exists the same colours on both screens (G4); and give these screens' controls a 44px hit area below `bp-compact` (G15).
- [ ] 20.3 Move the remaining `primitives.Notice` users, including Added's (G12), onto `Banner` and remove the unused legacy primitives.
- [ ] 20.4 Move this area's near values and visible cluster changes (C3, C4, C9, C10, C15–C17) onto tokens, local button look-alikes onto `Button` (C1), with before-and-after screenshots, and close the remaining V7 gaps for Records and the V8 gaps: R16, R17, X3, X4, X5 and X6.
- [ ] 20.5 Empty the literal-value baseline and make the lint strict.
- [ ] 20.6 Update `frontend/ARCHITECTURE.md`'s styling paragraph, and record the final screenshot pass and results in the handover.

## Delivery evidence and lifecycle follow-up

- [x] D.1 PR-A: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization. Review clear at `9fea7c7`; merged as #96 (`50ff181`). The frontend, TypeScript, Markdown and workflow checks passed; the two intake jobs failed identically on `interactive-app` itself (#93's sandbox limit test and #97's startup timeouts).
- [x] D.2 PR-B: same gates. Review clear at `7c42f99` after seven rounds; merged as #100 (`4080ea9`). Every CI job passed; the HTTP lane's two start-up timeouts, which also fail on `interactive-app`'s own push, passed on rerun, and #99 retired the PostgreSQL lane.
- [x] D.3 PR-C: same gates. Review clear at `8d725fd` after five rounds; merged as #102 (`d38e6ad`) with every CI job green and a demo video attached.
- [x] D.4 PR-D: same gates. Review clear at `7330b65` after eight rounds; merged as #104 (`1672e00`) with every CI job that ran green and a demo video attached.
- [x] D.5 PR-E: same gates. Review clear at `18b2381` after fourteen rounds, then the merge of #107 and its two fixes reviewed clear at `ad15957`; merged as #108 (`ab80c3b`) with every CI job that ran green and a demo video attached.
- [x] D.6 PR-F: same gates. BI-008 is updated to Done only after acceptance and merge are evidenced. Task 14 is tracked separately by D.7. Review clear at `cabe29c` after six rounds; merged as #109 (`c15e9ce`) with every CI job that ran green and a demo video attached. BI-008 is Done; task 14 follows as PR-G.
- [x] D.7 PR-G (task 14): same gates, once PR-C, PR-D, PR-E and BI-006's contracts are on `interactive-app`. Review clear at `e99d14f` after seven rounds, with its wording follow-up `2139767` reviewed clear; merged as #110 (`3ed53f2`) with every CI job that ran green and a demo video attached.
- [ ] D.8 PR-H (task 15): same gates, with the screenshot diff unchanged for the token-swap commit.
- [ ] D.9 PR-I (task 16): same gates, after PR-H.
- [ ] D.10 PR-J (tasks 17 and 18): same gates, after PR-H.
- [ ] D.11 PR-K (tasks 19 and 20): same gates, after PR-H, PR-I and PR-J. BI-008 returns to Done once PR-K merges.

After delivery, sync and archive only when authorized, and update the index link if the change moves.
