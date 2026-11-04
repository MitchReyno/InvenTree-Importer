# Implementation and delivery tasks

## Plan context

Canonical change: `batch-settings-overhaul`; [BI-003](../../../docs/PLANNED_FUNCTIONALITY.md#bi-003--batch-settings-overhaul). Read the [proposal and reuse assessment](proposal.md), [design](design.md), [settings requirements](specs/capture-batch-settings/spec.md), [reference requirements](specs/capture-reference-selection/spec.md) and [inference requirements](specs/capture-inference-preferences/spec.md). Future [PO](../purchase-order-support/) and [logo](../automatic-supplier-logos/) changes remain briefs only. All work below is planned, not implemented; this proposal grants no execution or live-operation authority.

## Completion and commit ordering

Verify each completed action, check it before committing its work and include this task-file update in that commit. Leave unfinished actions and parents unchecked. Record reviews, publication, CI and merge only after they occur. No top-level task or its checklist may span PRs. If discoveries make a task too large, refine the top-level tasks and delivery map before implementing it. A PR can contain multiple whole tasks.

## Task map and dependencies

| Task | Type and outcome | Real prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1 | Compatibility/model: versioned settings, notes, references and creation intents | Existing merged capture foundations | Legacy reads; retained context; intent distinct from effect |
| 2 | Behaviour: bounded catalogue search | Task 1 public contracts | Search scenarios and target isolation |
| 3 | Qualification/UI: reusable input package and components | Task 1 types; package proof before adoption | Keyboard/async/IME and reusable inputs |
| 4 | Behaviour: complete connected autosave panel | Tasks 1–3 | Settings, note, PO preview, disconnect and uncertainty scenarios |
| 5 | Behaviour: explicit location hierarchy | Task 1; Task 2 observation binding | Default precedence and conflicting groups |
| 6 | Behaviour: attributable inference and review | Task 1; preserve Task 5 resolution when materializing | Quantity questions, human authority, manual/Auto tags and order intent |
| 7 | Execution: supervised new records | Tasks 1–2; Task 4 consumes results | Creation, duplicate/unknown, permissions and recovery |
| 8 | Acceptance/docs: integrated delivery | Tasks 3–7 and 9 | Cross-layer acceptance, current docs and evidence |
| 9 | Behaviour/layout: mockup Capture and relocated subject editing | Task 4 panel; existing capture/review commands | No subject panes; Review actions/deep links; responsive hierarchy |

Tasks 2 and 3 need no artificial dependency on one another. Task 7 can be developed after the public foundations but is merged after the integrated context work so final qualification uses the whole slice. No task is a placeholder to explore the codebase; necessary follow-up proof is named below.

## PR delivery map

Every bundle targets `interactive-app` after its prerequisites merge, using an isolated branch. Keep additive compatibility until the UI is enabled. Each bundle requires maintained handover, fresh independent read-only exact-head review, corrected findings, selected green CI and applicable merge authorization. Publish only after local review is clear.

| Bundle | Outcome and task coverage | Boundary rationale | Dependencies / order | Base, branch and subject | Verification / merge gates |
| --- | --- | --- | --- | --- | --- |
| PR-A | Whole Tasks 1–2: additive models and bounded catalogue API | A compatible server foundation independently verifies identity/search before UI use. | First; Task 2 follows Task 1. | `interactive-app`; `feat/batch-settings-overhaul-foundations`; `feat(batch-settings-overhaul): retain settings intent and searchable references` | Contracts/generated drift, HTTP/PG migrations/grants, compatibility and search failure tests. |
| PR-B | Whole Tasks 3–4 and 9: qualified inputs, autosave and mockup Capture layout | Package proof, inputs and their real form/command integration are one cohesive UI review. New-record execution stays capability-gated. | PR-A; Tasks 3 then 4 then 9. | `interactive-app`; `feat/batch-settings-overhaul-panel`; `feat(batch-settings-overhaul): simplify inputs and autosave connected settings` | Exact package/lock/advisory review, frontend checks/build, HTTP/PG autosave and owned headless UI evidence. |
| PR-C | Whole Tasks 5–6: precedence, inference preferences and review | Shared processing freshness and review materialization need coherent cross-layer evidence. | PR-A and PR-B for final integration; Task 5 resolver reused by Task 6. | `interactive-app`; `feat/batch-settings-overhaul-review`; `feat(batch-settings-overhaul): resolve locations and review inferred values` | PG/Processing/Review tests, old input versions, questions and stale-output regressions; frontend checks if changed. |
| PR-D | Whole Tasks 7–8: supervised new-record support and integrated acceptance | Effect/recovery proof and final enablement stay together; UI never advertises unqualified creation. | PR-A through PR-C. | `interactive-app`; `feat/batch-settings-overhaul-records`; `feat(batch-settings-overhaul): qualify supervised reference creation` | Owned-fake PG/process tests, full affected checks, responsive/browser evidence, independent review and selected CI. |

All checklist work belongs to its task's bundle. Each task includes its documentation and boundary verification; final Task 8 consolidates acceptance, not deferred fixes or checkboxes from another bundle. A material defect in an earlier merged bundle needs an explicitly updated delivery map and a distinct corrective top-level task, rather than splitting an existing task after the fact.

## 1. Retain versioned settings and new-record intent

- PR delivery: PR-A.
- Outcome: additive schema and public DTO/client support for batch/order notes, Auto/None/manual intent, manual-plus-Auto tags, assignment provenance and new location/company drafts.
- Scope and approach: `contracts/src/capture.ts`, new focused contract modules where useful, generated public facade, capture repository/read/context and additive migrations/grants. Preserve instruction command identity; do not rewrite immutable SQL, sealed inputs or approval bytes. Include optional retained logo references and current-note tombstones.
- Prerequisites: existing capture foundations and current schema confirmed.
- Acceptance: [retained settings](specs/capture-batch-settings/spec.md#requirement-explicit-retained-settings-and-context), [new-record intents](specs/capture-reference-selection/spec.md#requirement-new-location-and-supplier-intents), [migration](specs/capture-inference-preferences/spec.md#scenario-migrate-capture-only-tags).
- TDD approach: old fixtures establish baseline; RED rejects new valid intent/missing versions and catches legacy loss, then GREEN adds only supported additive parsing/persistence.
- Verification: `pnpm typecheck`, `pnpm contracts:check`, `pnpm test:intake`, `pnpm db:intake test`; disposable DB migration/restart and restricted-role grants. Capture snapshot permissions and exact lexical IDs are part of the test boundary.
- Risks: implicit activation of old capture tags/notes; contain through explicit read mapping and unchanged approved history.

- [ ] 1.1 Establish baseline old snapshot/command/input fixtures and record the concrete additive schema/format plan in the maintained handover.
- [ ] 1.2 RED: add regressions for new intent round-trip, distinct batch/order notes, hide/remove history and manual tags with Auto off on migration.
- [ ] 1.3 GREEN: implement versioned DTOs, facade generation, additive tables/columns, bounded validation and scoped transactional reads/edits.
- [ ] 1.4 Verify old quantity/context choices, archived/frozen permissions, parent/logo references and immutable history survive migrations and restart.
- [ ] 1.5 Refactor by owning responsibility; update server/contract documentation and record checks/limitations before the PR-A review gate.

## 2. Add bounded name-first catalogue search

- PR delivery: PR-A.
- Outcome: location/supplier/parent pickers can search names with typo tolerance and exact-ID supplementation and bounded pagination, without browser target control.
- Scope and approach: public typed list routes, `capture/read.ts`, `inventory/transport.ts`, scoped observations and test fake target. Authorize before traffic, allowlist operations/filters and rebuild same-origin pagination requests.
- Prerequisites: Task 1 models; inspected official API schemas are feasibility evidence, not target qualification.
- Acceptance: [search pickers](specs/capture-reference-selection/spec.md#requirement-scoped-searchable-reference-pickers) and [invalid parent](specs/capture-reference-selection/spec.md#scenario-invalid-parent-or-unsupported-target).
- TDD approach: RED public requests fail until list/search support exists; adverse tests ensure an HTTP200 from an invalid target response is never a valid selection.
- Verification: `pnpm test:intake`, `pnpm db:intake test`, contracts/type checks. Controlled HTTP target tests cover deadlines/body limits, supplier flags, hierarchy, exact PKs, invalid pagination URLs and independent candidate retrieval/truncation for fuzzy matching.
- Risks: target-version and search-field variation. Record admitted fields and unsupported responses explicitly; no live API requests required.

- [ ] 2.1 Confirm supported target serializer/search shapes using versioned source or fixtures; record exact/name/fuzzy tiers, numeric-ID fallback and bounded candidate-snapshot policy independent of strict upstream query filtering.
- [ ] 2.2 RED: cover bounded name search/page results, exact ID, ambiguous names, foreign scope, redirect/off-origin pagination, missing supplier role and a typo candidate absent from strict upstream results but present in the admitted snapshot.
- [ ] 2.3 GREEN: implement allowlisted semantic reads, typed route/client and final selection observation binding.
- [ ] 2.4 Verify auth before target traffic, size/deadline/rate/candidate bounds, visible partial coverage, no-match versus unavailable and stale-context response rejection.
- [ ] 2.5 Update read-adapter docs and handover; run affected contract/HTTP/PG checks and complete the PR-A independent review/selected-CI gates when actually reached.

## 3. Qualify and build reusable input components

- PR delivery: PR-B.
- Outcome: accessible, controlled inputs support searchable references, optional notes, Auto/None/manual values and manual-plus-Auto tags.
- Scope and approach: isolated exact React Select 5.10.2 and Fuse.js 7.1.0 proof first, then a small styled/RHF adapter and one component per TSX file. Reuse native date/text controls and installed upload primitives. No package option object becomes a domain reference.
- Prerequisites: Task 1 types. If package proof fails, revise the dependency decision before adopting a replacement.
- Acceptance: [keyboard picker](specs/capture-reference-selection/spec.md#scenario-numeric-id-and-keyboard-interaction), [fuzzy search](specs/capture-reference-selection/spec.md#requirement-typo-tolerant-reference-search), [notes](specs/capture-batch-settings/spec.md#scenario-optional-batch-and-order-notes), [logo explanation](specs/capture-reference-selection/spec.md#scenario-inspect-future-logo-discovery).
- TDD approach: package qualification uses a disposable harness rather than a false RED claim. Then RED component behaviours precede production wrappers; a new browser dependency is gated on real interaction evidence.
- Verification: targeted Vitest files, type/lint/build, frozen install, lock/advisory/bundle deltas and owned headless desktop/360/390px/native200% browser evidence. No user's normal Chrome profile.
- Risks: second styling runtime, async selection races and disabled-input focus. Expose tooltip on a focusable explanation wrapper.

- [ ] 3.1 Run the scoped package proof with React19/RHF/StrictMode, controlled reset, async cancellation, IME, touch, keyboard, bounded fuzzy ranking latency and zoom; record license, peer, maintenance and dependency/advisory delta.
- [ ] 3.2 RED: add meaningful input tests for name/ID identity, typo/accent/case matches, exact-first stable ranking, false positives, partial coverage, stale results, tags plus Auto, manual date/text, Hide versus Remove and disabled coming-soon explanation.
- [ ] 3.3 GREEN: deliver the reusable components, typed adapters and shared fuzzy ranker with module-scope styled-components and native input validation; prevent default substring filtering from removing scored suggestions.
- [ ] 3.4 Verify the same picker supports supplier/location/parent and the same notes shell supports separate scopes without losing hidden text; verify `Mousr`/`Incomming` suggestions preserve original labels/IDs and never auto-select or create records.
- [ ] 3.5 Refactor integration seams, run frontend checks and record proof limitations before Task 4 consumes the components.

## 4. Deliver the connected autosave Batch settings panel

- PR delivery: PR-B.
- Outcome: the full simplified panel saves valid edits without a normal Save button, with independent instructions acknowledgement and preserved draft/recovery state.
- Scope and approach: `BatchSettingsPanel.tsx`, context/instruction components and retained-command/dirty owners. Use one per-batch serialized save coordinator, 500ms valid idle debounce/blur, IME pause and immutable in-flight payload. Reuse shared API health and socket hints; no socket writes or mutation replay.
- Prerequisites: Tasks 1–3. New-record forms retain draft intent; external execution remains gated until Task 7.
- Acceptance: all [settings delta](specs/capture-batch-settings/spec.md) scenarios; [supplier absence](specs/capture-reference-selection/spec.md#scenario-toggle-supplier-absence), disabled PO preview and logo explanation.
- TDD approach: RED fast-edit/late-receipt, lost-ack/conflict and instruction-interleaving tests before queue implementation; remove obsolete explicit-save assertions only when replacement behaviour is covered.
- Verification: frontend type/lint/tests/build plus HTTP/PG acknowledgement/revision tests. Headless keyboard/narrow/native200% checks verify visible states and retained drafts separately from jsdom.
- Risks: unrelated batch revisions, navigation during debounce and target/API confusion. Immediate dirty guard and explicit reconciliation must precede clearing any draft.

- [ ] 4.1 Establish current save/navigation baseline and record exact queue ownership, availability and revision transitions in the handover.
- [ ] 4.2 RED: cover debounce/blur/IME, invalid title, newer input during an in-flight save, uncertain acknowledgement, foreign revision and instructions/settings interleaving.
  - [ ] 4.2.1 Cover API disconnect/reconnect with pending key, socket-only failure with healthy fallback, target-only failure and focus after clock advancement.
  - [ ] 4.2.2 Cover navigation/unmount protection and prevent an old receipt from labelling newer edits saved.
- [ ] 4.3 GREEN: assemble title/Add batch notes, one Default location, supplier/No supplier/new drafts, disabled PO preview directly below supplier, shared tags and Custom instructions; remove obsolete panel fields/buttons.
- [ ] 4.4 Implement acknowledged serialized autosave, validation/error/conflict/unconfirmed UI and explicit recovery; preserve hidden/removed notes and existing scope restrictions.
- [ ] 4.5 Verify frontend/HTTP/PG boundaries and browser focus/drafts; update owning architecture and handover, then satisfy PR-B exact-head review and selected CI before any authorized merge.

## 5. Resolve location assignments without merging lots

- PR delivery: PR-C.
- Outcome: a single batch fallback and more-specific lot/Part/group locations yield a traceable reviewed destination.
- Scope and approach: capture assignment models/edits, media-linked group resolver, processing input freshness and Review display. Resolve lot → Part → applicable group → batch; explicit clear blocks fallback and different applicable groups require resolution.
- Prerequisites: Task 1; Task 2 provides observed target references. UI assignment affordances accompany the resolver in this task.
- Acceptance: [location precedence](specs/capture-reference-selection/spec.md#requirement-default-location-precedence) and default-change settings scenario.
- TDD approach: RED a matrix of distinct physical lots and conflicting group links, then GREEN scoped resolver/materialization; exact quantities never change.
- Verification: PG resolver/transaction tests, Processing/Review stale-input tests and targeted UI tests, plus affected frontend/server checks.
- Risks: confusing shared Part defaults with inventory Part fields or ambiguous many-group evidence; keep scope and effective-source labels explicit.

- [ ] 5.1 Establish legacy lot-default behaviour and enumerate explicit assignment/unknown/clear compatibility rules.
- [ ] 5.2 RED: cover each precedence level, matching/conflicting groups, higher override over group conflict, clear suppression and batch default edits.
- [ ] 5.3 GREEN: implement attributable assignments, necessary scope controls, resolution and Review source labels without stock splitting.
- [ ] 5.4 Verify evidence-link/group edits invalidate affected inputs/preparations transactionally, while chosen values/approved history and distinct lots remain intact.
- [ ] 5.5 Refactor resolver ownership, run affected PG/UI/contract checks and update docs/handover within PR-C.

## 6. Carry inference preferences through Processing and Review

- PR delivery: PR-C.
- Outcome: evidence-derived quantity suggestions/questions and manual-plus-Auto shared tags remain reviewable, while prepared order intent cannot enable PO effects.
- Scope and approach: versioned capture inputs, Processing protocol/output validation/questions, human choice materialization and Review. Preserve older sealed input versions and provider capability labels. Existing exact human counts dominate later estimates.
- Prerequisites: Task 1 and Task 5 resolver at materialization. Deterministic adapters suffice; no live inference authorized.
- Acceptance: all [inference preference scenarios](specs/capture-inference-preferences/spec.md), particularly opened-packet unknown count, stale suggestion and existing-Part tags.
- TDD approach: RED proposal acceptance/question fallback/stale output fixtures, then GREEN processing/review integration. Old fixtures characterize unchanged byte contracts.
- Verification: contract, PG/Processing and frontend Review tests; controlled process input/output tests as applicable. Neither a schema pass nor a deterministic suggestion qualifies live model reasoning.
- Risks: a plausible estimate becoming a chosen count, Auto inventing values and existing-Part mutation creep.

- [ ] 6.1 Confirm current protocol and review authority seams; record exact new input/output versions and tag deduplication/removal policy.
- [ ] 6.2 RED: cover supported evidence estimate, no-defensible-estimate question, unavailable provider, human count over stale output and manual/Auto tag combinations.
- [ ] 6.3 GREEN: retain inference intent, bind proposals/questions to exact inputs/evidence and require human review before chosen values/execution preparation.
- [ ] 6.4 Verify Auto order/date never fabricates values, manual values remain exact, old input/approval formats still read and existing-Part tags remain unmodified.
- [ ] 6.5 Record actual tests and remaining provider limits; update Processing/Review architecture and complete PR-C review/selected-CI gates when evidenced.

## 7. Qualify supervised location and supplier creation

- PR delivery: PR-D.
- Outcome: new-record drafts can become explicitly approved, attributable create operations under a versioned owned-fake profile with recoverable outcomes.
- Scope and approach: new location/company effect types, preparation/approval dependencies, executor adapter/journal, fake target, confirmed-output mapping and logo attachment admission. Keep web autosave read/app-state only. Actual target mutation stays unavailable without separate qualification.
- Prerequisites: Tasks 1–2; Task 4 new-record UI consumes supported/unavailable capability states.
- Acceptance: [new-record intent scenarios](specs/capture-reference-selection/spec.md#requirement-new-location-and-supplier-intents), scope/duplicate/uncertainty and supplier roles.
- TDD approach: RED fake public-boundary prepared/approved creation and adverse process tests; GREEN exact effects and recovery. Never weaken existing safe-execution tests to accommodate new types.
- Verification: `pnpm test:intake`, `pnpm db:intake test`, `pnpm db:intake test:process`, contract/type checks and fake inventory read-back. Old profiles and pending operations remain valid.
- Risks: creation duplication and unsupported real-target attribution. Do not use a same-name lookup as proof of original-operation success.

- [ ] 7.1 Record effect shapes, exact dependency/output binding, optional logo operation and supported profile/target limits before implementation.
- [ ] 7.2 RED: verify no inventory write on autosave, explicit approval required, exact parent/company roles, scoped permissions and versioned execution binding.
- [ ] 7.3 GREEN: implement supervised fake profile, exact known-output reuse and UI transitions from draft to approved to confirmed without repeating create.
- [ ] 7.4 Verify lost acknowledgement, cancellation, restart, changed payload, duplicate names and invalid parent; unresolved external effects remain unresolved under the original operation.
- [ ] 7.5 Verify optional manual logo retention/attachment limits and unsupported real-target controls; record read-back/recovery evidence and owning execution docs.

## 8. Verify integrated acceptance and record delivery

- PR delivery: PR-D.
- Outcome: the integrated panel and its dependencies have honest, reproducible acceptance evidence and current documentation.
- Scope and approach: synthetic end-to-end fixtures, responsive/browser checks, rollout/rollback instructions and maintained `docs/handovers/batch-settings-overhaul.md`. Documentation uses reference/consistency validation rather than ceremonial RED tests.
- Prerequisites: Tasks 3–7 and 9; each earlier bundle owns its own required tests/docs and remains independently reviewed.
- Acceptance: all three capability deltas, legacy compatibility, truthful PO/logo/provider limits and exact task/PR ownership.
- TDD approach: add an integrated failing regression only for an uncovered behaviour; otherwise use existing suites plus real-boundary acceptance and document the evidence. Never equate screenshots with retained save proof.
- Verification: affected root frontend/contracts/server/PG/process checks, build, formatting/Markdown and headless desktop/360/390px/native200%. No real data migration, target mutation or provider invocation.
- Risks: acceptance work discovering earlier defects; create a new scoped task/bundle before corrective implementation where needed.

- [ ] 8.1 Exercise the full connected autosave → reconnect/conflict → location resolution → estimate review → supervised fake new-record journey with explicit retained read-back.
- [ ] 8.2 Verify note Hide/Remove, no supplier, disabled PO preview, disabled automatic-logo explanation, shared tags, instruction interleaving, dirty navigation and narrow/native200% accessibility.
- [ ] 8.3 Run required affected checks and document actual passes/failures/skips, package/advisory costs, rollout/rollback and unqualified boundaries.
- [ ] 8.4 Obtain fresh independent read-only exact-head review, fix/re-review findings, publish through normal PR tools and verify selected green CI; record actual SHA and PR state.
- [ ] 8.5 Verify the candidate index status matches actual evidence, future PO/logo items remain Proposed and every acceptance claim has a linked result; leave merge/Done/archive outcomes unclaimed until they occur.

## 9. Adopt the mockup Capture layout and remove subject panes

- PR delivery: PR-B, wholly alongside Tasks 3–4; numbering is stable and does not prescribe execution order.
- Outcome: Capture defaults to evidence/groups plus Batch settings, with no Physical lots or Part proposals panes, while subject editing remains available in Review.
- Scope and approach: `CaptureWorkspace.tsx`, `CaptureQueue.tsx` callers, grid/focus/navigation, evidence selection and Review focused editors. Remove unused presentation only; reuse existing capture commands for manual add/edit and Part choice. Preserve exact deep-link identity and dirty guards.
- Prerequisites: Task 4 panel and existing Review/capture public commands. No new inventory effects.
- Acceptance: [responsive placement and pane removal](specs/capture-batch-settings/spec.md#requirement-evidence-based-responsive-placement).
- TDD approach: RED absence and route/access tests before removing composition; characterize manual-start, note/upload and exact editing first so pane removal cannot silently remove those workflows.
- Verification: targeted Capture/App/Review tests plus required frontend type/lint/tests/build and owned headless screenshot/focus checks against the preserved original at desktop, 360/390px and native200%.
- Risks: selected-subject state currently drives Capture actions; separate evidence ownership and relocate subject editing before removing queue chrome. Do not preserve the removed panes under new labels.

- [ ] 9.1 Record original mockup comparison and current queue/editor callers, selection dependencies and legacy route behaviour.
- [ ] 9.2 RED: cover no Physical lots/Part proposals panes, reachable Review add/edit/Part choice/quantity correction and guarded legacy subject navigation.
- [ ] 9.3 GREEN: implement the default two-column mockup composition and narrow stack, remove Capture queue/editor chrome and deliver the focused Review actions.
- [ ] 9.4 Verify evidence upload/note/group selection, default-location override links, saved/dirty drafts and retained subjects survive route changes and reflow.
- [ ] 9.5 Record desktop/narrow/zoom visual/accessibility evidence and owning architecture updates; complete this entire task within PR-B before its exact-head review.

## Delivery evidence and lifecycle follow-up

No implementation, candidate review, implementation PR, CI result or merge is claimed by this plan. Record each bundle's reviewed SHA and selected checks only when they exist. Final post-merge status/evidence, if needed, uses `docs/batch-settings-overhaul-acceptance` with `docs(batch-settings-overhaul): record accepted delivery`; it is lifecycle bookkeeping, not a split of top-level implementation work. Synchronization/archival is not a prerequisite checkbox for completing implementation and is performed only when authorized.
