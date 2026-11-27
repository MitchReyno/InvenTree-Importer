# Implementation and delivery tasks

## Plan context

Canonical change: `capture-tab-uplift`; linked [BI-001](../../../../docs/PLANNED_FUNCTIONALITY.md#bi-001--capture-tab-uplift). Read the [proposal/reuse comparison](proposal.md), [design](design.md), [settings requirements](specs/capture-batch-settings/spec.md) and [grouped-evidence requirements](specs/capture-grouped-evidence/spec.md). The index owns mutable metadata. Implementation evidence is recorded below and in the handover; checklist completion alone does not establish a merged release.

## Completion and commit ordering

Verify each completed checklist action, check it before its corresponding completed work is committed, and stage this `tasks.md` update in the same commit. Parents with unfinished required children remain unchecked. Record review/publication/CI/merge only after the actual event. Use the exact canonical change name in every delivering branch and conventional commit/PR subject.

## Task map and dependencies

Tasks 1 and 2 are independent data foundations. Task 3 consumes Task 1; Task 4 consumes Tasks 1/2 and the chosen panel/draft integration from Task 3. Task 5 qualifies the complete uplift after Task 4. Every top-level task, including every subtask/checklist, belongs wholly to one PR. A PR can bundle several whole tasks; refine overly broad tasks before assigning new boundaries rather than splitting their checkboxes between PRs.

## PR delivery map

| Bundle | Whole tasks and outcome | Rationale / dependencies | Base / branch / subject | Verification and merge gates |
| ------ | ----------------------- | ------------------------ | ----------------------- | ---------------------------- |
| PR-A | Tasks 1 and 2: additive settings/context and group/note command foundations | Server contracts and migration/currentness behavior land before consumers; independent data tasks share one coherent compatibility boundary | `interactive-app`; `feat/capture-tab-uplift-foundations`; `feat(capture-tab-uplift): retain settings and grouped context` | Generated contracts, transaction/idempotency/currentness and owned-PG migration tests; independent exact-head review and selected CI |
| PR-B | Task 3: layout comparison and single Batch settings consumer, including disabled PO controls | Complete settings behavior with a reasoned layout decision; requires PR-A, no status-signalling prerequisite | `interactive-app`; `feat/capture-tab-uplift-settings`; `feat(capture-tab-uplift): consolidate Batch settings` | Both placement comparisons, draft/conflict/disabled-PO regressions and browser evidence; independent exact-head review and selected CI |
| PR-C | Tasks 4 and 5: three evidence actions, grouped UI and end-to-end qualification | Ship coherent evidence behavior plus its accessibility/adverse integration proof; requires PR-A and PR-B draft/layout integration | `interactive-app`; `feat/capture-tab-uplift-evidence`; `feat(capture-tab-uplift): expose grouped Capture evidence` | Dependency proof, media/group/note regressions, original-reference browser journeys and owning checks; independent exact-head review and selected CI |

The user authorized implementation after both proposals merged. PR-A merged as [#75](https://github.com/MitchReyno/InvenTree-Importer/pull/75); PR-B merged as [#76](https://github.com/MitchReyno/InvenTree-Importer/pull/76); PR-C merged as [#78](https://github.com/MitchReyno/InvenTree-Importer/pull/78), delivering the complete evidence and integration tasks. Record real PR references when created; update the map for coherent review, compatibility or delivery risk, never arbitrary task counts. Coverage is complete and no top-level task is shared between bundles.

## 1. Retain composite settings and human context

- Type / PR: Contracts, persistence and input currency; PR-A.
- Outcome: Atomic explicit settings save and correctly scoped inherited/overridden human context.
- Scope and approach: `contracts/src/capture.ts`, Capture repository/commands, additive migrations and Review/processing input materialization. Reuse observed company/location mappings and exact string modes, with no new inventory effects.
- Prerequisites: Existing retained batch/lot/revision and mapping boundaries; independent of Task 2.
- Acceptance: Settings retention, conflict, inheritance and disabled-PO requirements; PO intent must not enter accepted commands.
- TDD approach: RED contract and real-PG transaction/currentness regressions before adding the composite command and context state.
- Verification: `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm typecheck:intake`, targeted contract/server tests, `pnpm test:intake:pg` and affected process tests.
- Risks: Context may be confused with executable supplier/tag choices; partial composite saves and immutable historical plans require explicit tests.

- [x] 1.1 Define bounded supplier/date/tag context, per-lot modes, effective-value provenance and one composite settings command; document their distinction from inventory effects.
- [x] 1.2 RED: cover atomic rollback, exact quantity/PK/date roundtrip, invalid company role/context, tag bounds, duplicate command keys, changed payload refusal and rejected PO intent.
- [x] 1.3 RED: cover explicit overrides surviving default changes, old data defaulting to unset/inherit and affected processing/preparation currency after context changes.
- [x] 1.4 GREEN: add additive migrations, strict schemas/typed clients, retained projections and transactional composite save; preserve historical plan/approval bytes.
  - [x] 1.4.1 Include optional appended human note in the same acknowledged save, preserving human provenance and version identity.
  - [x] 1.4.2 Integrate context dependencies into canonical input/manifest currency and Review readback projections without new automatic effects.
- [x] 1.5 Refactor only affected helpers, validate migration upgrade/readback/consumer rollback against owned data, and record actual boundary evidence.

- [x] 1.6 Correct reviewed note-bound issues: retain full maximum-length Unicode notes, bound escape-heavy Capture context without truncation, and refuse excessive note counts with a typed capacity result.

## 2. Extend durable group and evidence-note operations

- Type / PR: Media contracts, persistence and contextual reads; PR-A.
- Outcome: Atomic multi-file moves, rename/ungroup and retained group/per-evidence notes across Capture, Review/viewer and future processing inputs.
- Scope and approach: Existing media group tables/commands, operator group instructions, new evidence annotation versions and scoped reads. Keep original evidence/subject links and archived/frozen checks.
- Prerequisites: Existing media identities/receipts and group-instruction storage; independent of Task 1 implementation.
- Acceptance: Group/note persistence, movement/foreign-group/conflict and ungroup-history scenarios.
- TDD approach: RED at the real transaction/currentness boundary; do not mock away multi-move rollback or ownership checks.
- Verification: Contract/client drift checks, focused media/operator tests, real `pnpm test:intake:pg` and affected input/processing process tests.
- Risks: Deleting group identity would orphan historical instructions; optimistic per-item moves can partially succeed.

- [x] 2.1 Specify bounded rename/multi-move/ungroup commands and versioned evidence notes; preserve existing single-move/create compatibility and exact request identities.
- [x] 2.2 RED: test cross-batch destinations, duplicate/missing evidence IDs, stale revisions, all-or-nothing move, repeated payload-bound requests and frozen edit refusal.
- [x] 2.3 RED: cover ungroup preserving originals/links/history, annotation roundtrip in the scoped read projections consumed by Review/viewer and changed context invalidating dependent inputs/preparations.
- [x] 2.4 GREEN: extend commands/migrations/read projections and canonical input materialization using existing group IDs and group instructions.
  - [x] 2.4.1 Retire ungrouped group's active presentation while preserving attributable historical group records/instructions.
  - [x] 2.4.2 Return retained note/instruction version identities without changing original bytes or attachment selections.
- [x] 2.5 Verify rollback/idempotence and currentness, run owning checks and document migration/compatibility limits in the handover.

- [x] 2.6 Reject group-instruction writes to retired groups under the shared Capture lock, preserving old history and proving stale-editor refusal.

## 3. Consolidate and position Batch settings

- Type / PR: UI behavior and layout experiment; PR-B.
- Outcome: One visible settings panel with all current controls, original mockup context/overrides and visibly disabled PO components.
- Scope and approach: Capture queue/workspace/editor composition, a focused RHF-backed settings component, existing input controls and coordinated dirty registry. Remove Shared details navigation buttons, retain lot/Part editors.
- Prerequisites: Merged PR-A settings foundation; original Capture references are available.
- Acceptance: All settings requirements, including no partial save, draft retention, PO inactivity and compared responsive placement.
- TDD approach: RED component tests for one-panel visibility, removed buttons, saved context/inheritance, conflict/uncertain receipt and disabled PO semantics. Use compare/adjust/verify for spatial layout rather than fabricated unit-test RED.
- Verification: Focused Capture/App navigation tests, `pnpm typecheck`, `pnpm lint:frontend`, `pnpm build`, desktop/narrow/zoom browser fixture.
- Risks: Duplicate responsive forms or background resets can erase drafts; batch notes must share one composer with the future top action.

- [x] 3.1 RED: cover all retained Shared details controls in one panel, current quantity modes and visible supplier/date/location/tags/override provenance.
- [x] 3.2 RED: cover conflict/lost acknowledgement/polling/reflow without resetting inputs, combined save semantics and dirty navigation protection.
- [x] 3.3 GREEN: integrate composite settings and one mounted RHF form, explicit save/discard and the shared batch-note composer.
  - [x] 3.3.1 Render PO controls/related components disabled and greyed out with readable unavailable text; verify no editable PO intent or submitted field.
  - [x] 3.3.2 Preserve all original context fields, current default controls and explicit override visibility; label capture-only context clearly in Review.
- [x] 3.4 Compare right-side versus above-content placements with the same representative content at desktop, 360px, 390px and 200% zoom; record evidence and a reasoned chosen layout.
- [x] 3.5 Refactor within scope, verify focus/reading order and no document horizontal overflow/draft remount, and run owning checks before accepting this task.

- [x] 3.6 Correct reviewed discard/submission and unsent-validation races; restore original Batch/Part/lot note scope in the atomic settings contract and qualify same-batch/retired ownership plus long retained context wrapping.

## 4. Compose the evidence actions and grouped workspace

- Type / PR: Media UI and interaction integration; PR-C.
- Outcome: Three prominent top actions and durable named-group/evidence-note organization with equivalent movement controls.
- Scope and approach: EvidencePanel, MediaWorkspace and focused group/action components; existing upload/cards/viewer/crop/notes with the Task 2 contracts. Prefer a narrow qualified drag adapter rather than replacing the uploader.
- Prerequisites: PR-A media/context foundations and PR-B shared layout/draft/note composition.
- Acceptance: Evidence actions, grouping/context, atomic move/ungroup and dirty-navigation requirements.
- TDD approach: RED component/contract integration regressions before new composition; dependency browser proof is an explicit preflight experiment, not a claimed executed test in this plan.
- Verification: Focused MediaWorkspace/Capture/App tests, media/client contract checks, frontend typecheck/lint/build and owned browser drag/keyboard/touch checks.
- Risks: Retained original followed by failed group move is two receipts/states, not an atomic upload; grouping cannot imply attachment/lot approval.

- [x] 4.1 Verify the chosen dnd-kit release/maintenance/advisories/license/lock impact and exercise React 19.3.1 sensors, cancellation and scrolling in an owned fixture before relying on it; record a qualified fallback if needed.
- [x] 4.2 RED: cover visible top3 actions, media-disabled/unsupported/uncertain uploads, shared note focus, grouped/ungrouped rendering and note readback.
- [x] 4.3 RED: cover equivalent select/move and drag paths, preserved selection on conflict, atomic bulk-move refusal and retained-original-but-unmoved readback.
- [x] 4.4 GREEN: compose top actions, group names/counts/notes, per-evidence notes, create/rename/add/ungroup and explicit movement controls over existing identities.
  - [x] 4.4.1 Route drag/keyboard/touch movement through the same retained command, with screen-reader instructions and cancellation feedback.
  - [x] 4.4.2 Preserve upload receipt/retry identity and show a retained original in ungrouped if its subsequent membership command fails.
- [x] 4.5 Refactor duplicate per-file controls without dropping subject links/crop/attachment behavior; verify surrounding media and dirty-registry contracts and owning checks.

- [x] 4.6 Correct independent-review media-query invalidation and duplicate-filename accessibility findings; verify actual shared-cache invalidation with mounted instructions and exact evidence control labels.

## 5. Qualify the complete Capture uplift

- Type / PR: Integration/browser evidence and documentation; PR-C.
- Outcome: End-to-end evidence for settings, evidence groups, provenance/currentness and responsive usability.
- Scope and approach: Owned synthetic preview/PG/fake media, affected architecture and maintained handover; original mockup files remain unchanged.
- Prerequisites: Task 4 integrated candidate and merged settings behavior from PR-B. Entire task ships in PR-C.
- Acceptance: Both capability specs, including no PO effects, no lost drafts, exact lots and unchanged originals.
- TDD approach: Browser comparison/qualification uses observable journeys; behavioral defects discovered receive focused failing regressions before fixes.
- Verification: Desktop/360px/390px/200% zoom, keyboard/touch/drag, reload/conflict/adverse uploads; required contract/app/format/readability checks with owned services only.
- Risks: Screenshot similarity cannot prove transactional containment, provider quality or real-inventory behavior; report limits separately.

- [x] 5.1 Exercise original-reference journeys with related front/back evidence, independent physical lots, notes, per-lot overrides and disabled PO controls; retain representative synthetic evidence.
- [x] 5.2 Verify reload/Review/viewer context, stale processing/preparation after edits, ungroup history and failed/conflicting membership without duplicated originals.
- [x] 5.3 Verify keyboard/touch equivalents, labelled controls/focus, long filenames/tags, all target widths and zoom without overflow or dirty form resets.
- [x] 5.4 Run relevant contract/server/frontend/PG/process checks and required formatting/readability/build checks; update owning architecture and handover with actual outcomes and limits.
- [x] 5.5 Reconcile acceptance and current index metadata; keep BI-001 short of Done until accepted merged implementation exists.

## Delivery evidence and lifecycle follow-up

For each bundle, maintain the handover, obtain independent exact-head read-only review, fix/re-review until clear, publish through the normal PR workflow and verify selected CI before an authorized merge. Record actual PRs/SHAs/checks only after those events. Preserve any user hold; a proposal or checkbox does not grant implementation/merge authority. The merged proposal alone leaves BI-001 Proposed. Synchronize/archive only when authorized and update index paths if moved.
