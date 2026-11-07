# Implementation and delivery tasks

## Plan context

Canonical change: `harden-native-agent-sessions`, linked to [BI-010](../../../docs/PLANNED_FUNCTIONALITY.md#bi-010--harden-native-agent-sessions). Follow the [proposal and reuse assessment](proposal.md), [design](design.md) and [acceptance delta](specs/processing-agent-sessions/spec.md). Implementation is in progress; unchecked actions remain pending.

## Completion and commit ordering

Verify each action before checking it; stage completed checklist updates with the corresponding implementation commit. Keep review, publication, CI and merge pending until evidenced. Do not mark BI-010 Done before accepted implementation merges.

## Task map and dependencies

Tasks 1–2 deliver confinement. Tasks 3–4 are independent corrections. Task 5 delivers diagnostics across backend and frontend as one complete outcome. Task 6 requires all behavior work and separate live authorization; task 7 closes delivery after qualification. A blocked confinement probe does not block tasks 3–5.

## PR delivery map

| Bundle | Outcome and whole tasks | Rationale | Dependencies | Base, branch and subject | Gates |
| --- | --- | --- | --- | --- | --- |
| PR-A | Admission proof and confinement, tasks 1–2 | Keep policy claims with executable proof | None | interactive-app; feat/harden-native-agent-sessions-confinement; feat(harden-native-agent-sessions): enforce native tool admission | Process checks and independent exact-head review; no false qualification |
| PR-B | Correctable proposals and evidence, tasks 3–4 | Cohesive model tool-contract usability | None | interactive-app; feat/harden-native-agent-sessions-tools; feat(harden-native-agent-sessions): return actionable tool results | Contracts and PG tests, independent exact-head review |
| PR-C | Retained categorized failures and disclosure, task 5 | Backend and UI deliver one usable outcome | Coordinate error DTOs with PR-B; merge after B | interactive-app; feat/harden-native-agent-sessions-diagnostics; feat(harden-native-agent-sessions): expose session failure details | Migration, scope/redaction and frontend/browser checks, independent exact-head review |
| PR-D | Qualification and final documentation, tasks 6–7 | Claims follow the integrated evidence | A–C merged; live authorization | interactive-app; test/harden-native-agent-sessions-qualification; test(harden-native-agent-sessions): qualify supported native sessions | Full recorded matrix, exact-head review, selected green CI, authorized merge |

Every bundle requires scoped documentation updates, exact-head independent review before opening its PR, selected green CI and authorized merge. Delivery mapping is not publication or merge authorization.

## 1. Prove native admission feasibility

- PR delivery: PR-A; type: Investigation.
- Outcome and scope: session-adapters.ts, native CLI protocol/configuration and process fixtures.
- Prerequisites: None.
- Acceptance: D1; Session tool boundary.
- Approach: Run a no-inference controlled probe for direct MCP tools, built-ins, deferred advisor, skill loading and resume. Record exact executable versions and the reliable pre-turn observation/control mechanism. An incomplete inventory is a failed proof, not a pass.
- TDD or equivalent verification: Investigation uses an explicit pass/fail matrix instead of TDD; do not send a live model request.
- Verification and risks: Produce a reproducible versioned probe and document unsupported configurations; stop dependent confinement claims if no complete mechanism exists.

- [x] 1.0 Probe `features.code_mode.enabled`, `features.code_mode.direct_only_tool_namespaces` and `mcp_servers.intake.omit_tools_from` against the installed CLI. Record supported keys, resolved namespace identifiers and effective configuration. Compare direct intake calls, executor absence and the full remaining tool surface separately on fresh and resumed sessions, using a wrapping-enabled negative control and no live inference.
- [x] 1.1 Confirm the scoped baseline and prerequisites for prove native admission feasibility.
- [x] 1.2 Investigation uses an explicit pass/fail matrix instead of TDD; do not send a live model request.
- [x] 1.3 Run a no-inference controlled probe for direct MCP tools, built-ins, deferred advisor, skill loading and resume. Record exact executable versions and the reliable pre-turn observation/control mechanism. An incomplete inventory is a failed proof, not a pass.
- [x] 1.4 Produce a reproducible versioned probe and document unsupported configurations; stop dependent confinement claims if no complete mechanism exists.

- [x] 1.5 Once a suitable avenue is selected, expand this same change's proposal, behavioral delta specs, design, tasks and PR map with the concrete continuation. Record the decision in notes.md, replace provisional assumptions, add acceptance and verification for newly identified work, and validate the revised artifacts before implementation. Keep all new actions unchecked; do not create a separate follow-up change or close this change after investigation alone.

## 2. Enforce fresh and resumed tool confinement

- PR delivery: PR-A; type: Behavior.
- Outcome and scope: session-adapters.ts, session-runner.ts and tests/process/sessions.test.ts.
- Prerequisites: Task 1 successful proof and expansion of this same change with the selected approach and remaining work.
- Acceptance: D1; Session tool boundary scenarios.
- Approach: Implement version-pinned offline qualification policy, per-turn executable/effective-config and MCP checks, and runtime guards for both providers, with direct intake tools and only the four inert Codex exceptions. Include unknown-version, ignored-setting and resume-drift tests. Bind admission-policy provenance to provider conversations; refuse legacy resume and provide explicit replacement preserving history/pending input without duplicating effects.
- TDD or equivalent verification: Baseline existing process fixtures; RED for exec-wrapped calls, deferred tools, skill injection, unknown surface and resumed-policy drift; GREEN must admit the normal lead tool set including read_batch, refuse unqualified versions/configuration drift before inference, reject forbidden runtime events and preserve reap ordering.
- Verification and risks: Run scoped process tests including cancellation, server-request refusal and unconfirmed reap; update agents architecture.

- [x] 2.1 Confirm the scoped baseline and prerequisites for enforce fresh and resumed tool confinement.
- [x] 2.2 Baseline existing process fixtures; RED for exec-wrapped calls, deferred tools, skill injection, unknown surface and resumed-policy drift; GREEN must admit the normal lead tool set including read_batch, refuse unqualified versions/configuration drift before inference, reject forbidden runtime events and preserve reap ordering.
- [x] 2.3 Implement version-pinned offline qualification policy, per-turn executable/effective-config and MCP checks, and runtime guards for both providers, with direct intake tools and only the four inert Codex exceptions. Include unknown-version, ignored-setting and resume-drift tests. Bind admission-policy provenance to provider conversations; refuse legacy resume and provide explicit replacement preserving history/pending input without duplicating effects.
- [x] 2.4 Run scoped process tests including cancellation, server-request refusal and unconfirmed reap; update agents architecture.

## 3. Return correctable proposal diagnostics

- PR delivery: PR-B; type: Behavior.
- Outcome and scope: contracts/src/index.ts, contracts/src/sessions.ts, generated contracts and agents/tools/handlers.ts.
- Prerequisites: None.
- Acceptance: D2; Correctable proposal validation.
- Approach: Expose sanitized copied Ajv issues without changing existing validate semantics; keep authority and currentness failures distinct.
- TDD or equivalent verification: Baseline contracts/session-tools; RED for nested required fields and generic invalid_contract responses; GREEN returns bounded paths/reasons without echoing values.
- Verification and risks: Run contracts generation/checks and scoped PG session-tools tests, including corrected retry, malformed unions and no publication on rejection.

- [x] 3.1 Confirm the scoped baseline and prerequisites for return correctable proposal diagnostics.
- [x] 3.2 Baseline contracts/session-tools; RED for nested required fields and generic invalid_contract responses; GREEN returns bounded paths/reasons without echoing values.
- [x] 3.3 Expose sanitized copied Ajv issues without changing existing validate semantics; keep authority and currentness failures distinct.
- [x] 3.4 Run contracts generation/checks and scoped PG session-tools tests, including corrected retry, malformed unions and no publication on rejection.

## 4. Deliver authoritative evidence citations

- PR delivery: PR-B; type: Behavior.
- Outcome and scope: contracts session tool output, handlers preview and manifest fetch paths, tests/pg/session-tools.test.ts.
- Prerequisites: None.
- Acceptance: D3; Authoritative citations for fetched evidence.
- Approach: Return the exact proposal source reference with successful content delivery; retain scope, digest semantics, delivery tracking and byte limits.
- TDD or equivalent verification: A baseline negative control must detect the missing mid-session citation digest; characterize the existing wrong-preview-digest refusal. GREEN accepts the returned original-version reference only after successful delivery.
- Verification and risks: Test cross-batch fetch, missing bytes, exhausted budget, crop/page paths, stale references and restart/refetch; run generated-contract and scoped PG checks.

- [x] 4.1 Confirm the scoped baseline and prerequisites for deliver authoritative evidence citations.
- [x] 4.2 A baseline negative control must detect the missing mid-session citation digest; characterize the existing wrong-preview-digest refusal. GREEN accepts the returned original-version reference only after successful delivery.
- [x] 4.3 Return the exact proposal source reference with successful content delivery; retain scope, digest semantics, delivery tracking and byte limits.
- [x] 4.4 Test cross-batch fetch, missing bytes, exhausted budget, crop/page paths, stale references and restart/refetch; run generated-contract and scoped PG checks.

## 5. Retain categorized failures and expose debug details

- PR delivery: PR-C; type: Cross-layer behavior and migration.
- Outcome and scope: agents settlement/repositories, migration, contracts/session reads, frontend AgentSessions and Processing components.
- Prerequisites: Coordinate additive result contracts with task 3.
- Acceptance: D4; Categorized failures with diagnostic disclosure.
- Approach: Add bounded sanitized diagnostic persistence and scoped details reads. Classify stable codes; implement a reusable accessible Show details disclosure with safe technical context, recovery guidance and legacy/unavailable states.
- TDD or equivalent verification: Baseline current failure rendering; RED for missing category/details and lost diagnostics after reload. Add negative redaction/scope fixtures before implementing; GREEN passes persistence and UI behavior together.
- Verification and risks: Run migration/PG recovery and scoped-read tests, frontend component tests and browser walkthrough; verify secrets never reach DB or UI and disclosure never retries work. Preserve drafts and selection; update server/frontend architecture.

- [x] 5.1 Confirm the scoped baseline and prerequisites for retain categorized failures and expose debug details.
- [x] 5.2 Baseline current failure rendering; RED for missing category/details and lost diagnostics after reload. Add negative redaction/scope fixtures before implementing; GREEN passes persistence and UI behavior together.
- [x] 5.3 Add bounded sanitized diagnostic persistence and scoped details reads. Classify stable codes; implement a reusable accessible Show details disclosure with safe technical context, recovery guidance and legacy/unavailable states.
- [x] 5.4 Run migration/PG recovery and scoped-read tests, frontend component tests and browser walkthrough; verify secrets never reach DB or UI and disclosure never retries work. Preserve drafts and selection; update server/frontend architecture.

## 6. Repair and execute qualification matrix

- PR delivery: PR-D; type: Qualification tooling and authorized live validation.
- Outcome and scope: Qualification harness recovered from previous PR evidence or reproducibly recreated from process fixtures.
- Prerequisites: Tasks 1–5; fresh explicit authorization before live calls.
- Acceptance: D5; Evidence-based native qualification.
- Approach: Define supported provider/model/auth/CLI matrix; fix chat detection for causally relevant replies, questions and status. Exercise confinement, proposal correction, new-evidence citations, status cadence, chat, resume, cancellation and operator diagnostics.
- TDD or equivalent verification: RED synthetic chat traces for false negatives and unrelated-activity false positives; GREEN predicate tests. Live behavior needs recorded observations rather than fabricated test-first claims.
- Verification and risks: Run synthetic harness first, then only authorized bounded live runs; retain native_unverified on any incomplete matrix/criterion and attach redacted evidence to PR, never source control.

- [ ] 6.1 Confirm the scoped baseline and prerequisites for repair and execute qualification matrix.
- [ ] 6.2 RED synthetic chat traces for false negatives and unrelated-activity false positives; GREEN predicate tests. Live behavior needs recorded observations rather than fabricated test-first claims.
- [ ] 6.3 Define supported provider/model/auth/CLI matrix; fix chat detection for causally relevant replies, questions and status. Exercise confinement, proposal correction, new-evidence citations, status cadence, chat, resume, cancellation and operator diagnostics.
- [ ] 6.4 Run synthetic harness first, then only authorized bounded live runs; retain native_unverified on any incomplete matrix/criterion and attach redacted evidence to PR, never source control.

## 7. Complete documentation and delivery

- PR delivery: PR-D; type: Documentation and lifecycle.
- Outcome and scope: Architecture/operator guidance, tasks and functionality index.
- Prerequisites: Tasks 1–6 verified.
- Acceptance: All delta requirements and BI-010 acceptance.
- Approach: Reconcile supported-version claims, diagnostic categories and recovery guidance with implementation and actual qualification.
- TDD or equivalent verification: No prose tests: inspect references, behavior claims and qualification evidence; run OpenSpec validation and overlap checks.
- Verification and risks: Obtain fresh exact-head independent review, fix/re-review findings, publish only when authorized, wait for selected green CI and authorized merge to interactive-app. Update index truthfully; archive only when requested.

- [ ] 7.1 Confirm the scoped baseline and prerequisites for complete documentation and delivery.
- [ ] 7.2 No prose tests: inspect references, behavior claims and qualification evidence; run OpenSpec validation and overlap checks.
- [ ] 7.3 Reconcile supported-version claims, diagnostic categories and recovery guidance with implementation and actual qualification.
- [ ] 7.4 Obtain fresh exact-head independent review, fix/re-review findings, publish only when authorized, wait for selected green CI and authorized merge to interactive-app. Update index truthfully; archive only when requested.

## Delivery evidence and lifecycle follow-up

Keep actual checks, reviewed SHA, screenshots and recordings in each PR description. Start notes.md during implementation for departures and unresolved issues, with full timestamps. No implementation or live qualification has occurred during proposal authoring. Preserve native_unverified until all gates pass; keep merge and BI Done separate from code completion. Check overlap before any later authorized synchronization/archive, and update moved index links then.
