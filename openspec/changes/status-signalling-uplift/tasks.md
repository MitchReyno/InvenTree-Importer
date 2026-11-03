# Implementation and delivery tasks

## Plan context

Canonical change: `status-signalling-uplift`, linked [BI-002](../../../docs/PLANNED_FUNCTIONALITY.md#bi-002--status-signalling-uplift). Read the [proposal and reuse assessment](proposal.md), [design](design.md), [connection requirements](specs/header-connection-status/spec.md) and [workflow requirements](specs/header-workflow-status/spec.md). The index owns mutable metadata. This document plans future implementation; all implementation checkboxes start unchecked.

## Completion and commit ordering

Verify each completed action, check it before committing its corresponding work, and stage this `tasks.md` update in that same commit. Keep parents with unfinished required children unchecked. Never pre-check review, publication, CI or merge events. Every delivering branch and conventional commit/PR subject includes the exact canonical change name.

## Task map and dependencies

Tasks 1 and 2 are independent foundations. Task 3 consumes both. Task 4 qualifies the integrated header and ships with Task 3. Each top-level task, including all subtasks, belongs wholly to exactly one PR; several whole tasks can share a PR. Refine an oversized task before changing bundles rather than distributing its checkbox work across PRs.

## PR delivery map

| Bundle | Outcome / whole tasks | Rationale and dependencies | Base / branch / subject | Verification and merge gates |
| ------ | --------------------- | -------------------------- | ----------------------- | ---------------------------- |
| PR-A | Foundations: Tasks 1 and 2 in full | Qualify the disclosure primitive and additive read contracts before any consumer depends on them; these tasks may proceed independently inside one coherent integration foundation | `interactive-app`; `feat/status-signalling-uplift-foundations`; `feat(status-signalling-uplift): add qualified header read foundations` | Package proof-of-fit, generated contracts, scope/freshness/probe and retained-reader tests; exact-head review and selected CI |
| PR-B | Visible header and integrated qualification: Tasks 3 and 4 in full | One complete user-facing replacement with accessibility/adverse evidence; requires merged PR-A, not Capture uplift | `interactive-app`; `feat/status-signalling-uplift-header`; `feat(status-signalling-uplift): expose connection and workflow header` | Header regressions, browser evidence, app checks and updated architecture/handover; exact-head review and selected CI |

This proposal documentation PR is separate from those future implementation bundles. Neither implementation PR is authorized merely by this plan. Add actual references when published and revise boundaries for coherence, compatibility or risk rather than task counts. No task/checklist appears in more than one bundle.

## 1. Qualify and wrap the disclosure primitive

- Type / PR: Dependency and UI foundation; PR-A.
- Outcome: A focused, styled accessible disclosure primitive suitable for both header controls.
- Scope and approach: Apply the proposal's Radix recommendation and bounded fallback; use existing React/styled-components rather than adopting a new design system.
- Prerequisites: None; independent of the read-model task.
- Acceptance: Connection/workflow disclosure keyboard, focus and viewport requirements; no claimed compatibility from peer ranges alone.
- TDD approach: Characterize trigger, dismissal, focus return and clipping first; package qualification is a browser experiment, not an artificial unit-test RED requirement.
- Verification: Focused Vitest interaction tests plus owned desktop/narrow browser fixture; typecheck, frontend lint/build and lockfile audit.
- Risks: Source-main version may differ from published release; fail qualification before consumers rely on it.

- [x] 1.1 Refresh official release, peer/license/advisory evidence and choose an exact published version; record lock/transitive cost without leaking local paths.
- [x] 1.2 Exercise the candidate in an owned masthead fixture with React 19.3.1, portals, 360px/390px and 200% zoom; record actual focus/escape/collision results.
  - [x] 1.2.1 If Radix fails, qualify the documented alternative and update proposal/design before adopting it; record the selected outcome rather than installing competing systems.
- [x] 1.3 Build the narrow styled wrapper and interaction regressions; verify open-state labels, dismissal and focus return, with no canvas pointer interception.
- [x] 1.4 Refactor only shared disclosure mechanics, run owning checks and record the selected package proof and remaining limitations.

## 2. Add scoped connection/work projections

- Type / PR: Contracts and server read behavior; PR-A.
- Outcome: Sanitized target observations plus complete-or-explicitly-partial work/active-session summaries.
- Scope and approach: Shared schemas/generated client, authenticated read routes, existing inventory read adapter and retained readers; no browser-selected targets, new execution path or new socket.
- Prerequisites: Existing server scope/transport/read contracts; Task 1 is not required to implement these reads.
- Acceptance: Connection observation/navigation and workflow steps/occupancy requirements, including timeout, stale context and active session outside history page one.
- TDD approach: RED at contract/transport/PG boundaries before new read behavior; use controlled clocks and owned fakes, preserving actual serialization and scoping.
- Verification: `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm typecheck:intake`, focused contract/server tests, `pnpm test:intake:pg` and affected process checks.
- Risks: Probe budget/route, partial global lists and old-context response reuse; explicit bounds are part of acceptance.

- [x] 2.1 Identify the adapter's harmless supported read route, scope/configuration source and query indexes; record its exact response/error policy before enabling observation.
- [x] 2.2 RED: cover sanitized URL refusal, wrong scope/context, missing configuration, timeout, duplicate/coalesced probes, 30s cache and 60s stale threshold, distinguishing fresh failed probes from stale observations.
- [x] 2.3 Characterize existing retained readers and add boundary regression cases for logically cancelled occupied agents, active rows beyond history page one, unknown step detail and independent truncation flags.
- [x] 2.4 GREEN: add TypeBox read schemas, authenticated routes and typed/generated clients; implement bounded observations and retained projections using existing adapters/readers.
  - [x] 2.4.1 Preserve safe failure codes, observation time, actor/target/context identity and credential redaction.
  - [x] 2.4.2 Apply active-only filtering before pagination; include deterministic ordering, current-batch preference and explicit collection limits.
- [x] 2.5 Refactor shared read composition where useful, verify fake-only transport and PG isolation, and document contract compatibility and actual results.

- [x] 2.6 Correct reviewed default-transport Content-Type loss and incomplete-configuration probe bypass; verify real owned HTTP reachability, zero unconfigured traffic and existing single-send containment.

## 3. Integrate both header indicators

- Type / PR: Frontend behavior; PR-B.
- Outcome: Top-right connection control with details and Open InvenTree, plus a separate same-row workflow/steps/agents disclosure across tabs.
- Scope and approach: Masthead and scoped shell, existing LiveUpdates/query contexts and activity selectors; reuse Tasks 1/2 and retire only the redundant global activity strip.
- Prerequisites: PR-A foundations and compatible generated client available.
- Acceptance: All connection/workflow requirements; original mockup composition with light palette, preserved drafts and no fabricated status.
- TDD approach: RED component regressions for the static label replacement, socket/target disagreement, failed/partial reads, stale context and occupied agents; GREEN integrates the read model and wrapper.
- Verification: Focused frontend Vitest files, `pnpm typecheck`, `pnpm lint:frontend`, `pnpm build`; Task 4 supplies browser qualification in the same PR.
- Risks: Moving provider boundaries can remount dirty forms or duplicate subscriptions; test those actual boundaries.

- [ ] 3.1 RED: add regressions for healthy socket/unavailable target, missing URL, healthy-socket foreground polling, local expiry/visibility recomputation, fresh failed versus stale observations, scope races and failed reads not becoming idle.
- [ ] 3.2 RED: cover current-batch priority, partial active-agent coverage, retained step labels and tab navigation preserving dirty inputs and query subscription identity.
- [ ] 3.3 GREEN: integrate scoped connection/work hooks, expose read-only update health, and render independent triggers, detail panels and safe target navigation.
  - [ ] 3.3.1 Show physically occupied agents even after logical cancellation; link to owning views without introducing new mutations.
  - [ ] 3.3.2 Show freshness, last check, unknown/partial coverage and meaningful text equivalents for segments.
- [ ] 3.4 Refactor duplicate activity presentation, keep page-level diagnostics, and run affected query/navigation regressions without widening scope.
- [ ] 3.5 Verify owning frontend checks and record actual outcomes before committing completed work.

## 4. Qualify responsive and adverse behavior

- Type / PR: Integration, browser evidence and documentation; PR-B.
- Outcome: Evidence that the real composed header meets the mockup-inspired UX and failure contracts.
- Scope and approach: Owned synthetic preview/fakes, integrated header and affected architecture/handover; no live provider or real-inventory qualification.
- Prerequisites: Task 3 integrated candidate; all work remains within PR-B.
- Acceptance: Keyboard/focus/zoom/narrow scenarios, preserved drafts, correct link isolation and no false connectivity/progress.
- TDD approach: UI layout uses an explicit compare/adjust/verify loop; behavioral defects found during that loop receive focused regressions before fixes.
- Verification: Desktop, 360px, 390px and 200% browser zoom; keyboard and screen-reader semantics; required formatting/readability/build/generated checks.
- Risks: jsdom cannot prove clipping, browser focus or actual responsive behavior; screenshots alone cannot prove health or mutation containment.

- [ ] 4.1 Run owned preview journeys for connected/unavailable/stale/idle/concurrent/partial work and occupied-agent states; retain only synthetic evidence.
- [ ] 4.2 Verify keyboard open/escape/focus return, labelled controls, polite announcements and reachable actions at desktop/narrow/zoom sizes.
- [ ] 4.3 Compare original Processing in progress header hierarchy and confirm Open InvenTree is to the connection control's right; keep responsive wrapping usable.
- [ ] 4.4 Run relevant full owning checks and formatting/readability checks; update frontend/server/shared architecture where boundaries changed and the maintained handover with actual limits.
- [ ] 4.5 Reconcile acceptance and index status truthfully; do not mark BI-002 Done before accepted merged implementation exists.

## Delivery evidence and lifecycle follow-up

For each bundle, update the maintained handover and obtain independent exact-head read-only review, fix/re-review until no new issues, publish through the normal PR workflow, and verify selected CI before an authorized merge. Record actual references/SHAs/checks after those events occur. Publication and merge are gates, not implementation checkboxes to pre-check. Preserve any user hold. A merged proposal alone leaves BI-002 Proposed; later implementation status follows evidence. Sync/archive only when authorized and update index paths if moved.
