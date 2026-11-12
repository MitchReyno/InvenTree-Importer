# Implementation and delivery tasks

## Plan context

- Change: `split-dev-profile-settings`. [Proposal](proposal.md), [design](design.md), specs: [development-launcher](specs/development-launcher/spec.md) (new) and [inventory-target-protection](specs/inventory-target-protection/spec.md) (modified).
- Reuse decision: extend the existing launcher policy modules with one pure resolver; no new dependency.
- Linked BI items: None (developer-tooling request, not indexed).

## Completion and commit ordering

Check an action only after it is done and verified, and stage the `tasks.md` update in the same commit as the work. Review, publication, CI and merge actions stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
|---|---|---|---|
| 1. Settings resolver | behavior | None | development-launcher: profile table, defaults, unsupported combination, VM pairing, switch values, retired names; target spec: precedence, derived reference, refusals |
| 2. Launcher and login wiring | behavior | 1 | target spec: read-only mock, owned label; development-launcher: VM credential management, defaults output |
| 3. Process-tier coverage | test | 2 | target spec: external read-only target; retired name refusal end to end |
| 4. Documentation and hints | docs | 1 | proposal outcome: names explain the configuration |
| 5. Delivery | lifecycle | 1–4 | review, CI and merge gates |

### PR delivery map

One PR carries tasks 1–5: the resolver, its wiring and the docs describe one renamed configuration surface. Splitting them would publish docs for settings that do not exist yet, or settings with stale docs.

- Branch `refactor/split-dev-profile-settings`, base `interactive-app`.
- Subject `refactor(split-dev-profile-settings): split dev profiles into independent settings`.
- Gates: `pnpm test:dev`, `pnpm test:intake`, intake typecheck, frontend checks for the hint change, local PG/process tiers for the dev environment tests, independent exact-head review, green selected CI.

## 1. Settings resolver

- PR delivery: the single PR.
- Outcome: a pure `resolveDevelopmentSettings` that turns user settings into internal target settings, read-only flag, profile and VM flag, or refuses with fixed codes.
- Scope and approach: new `tooling/dev/settings.cjs`; `tooling/dev/profile.cjs` keeps `processingWorker` (adding `synthetic-session/1`) and loses `developmentProfile`. Design: "One pure resolver", "Credential reference derivation".
- Prerequisites: None.
- Acceptance: the development-launcher scenarios and the target spec's precedence, derivation and refusal scenarios.
- TDD approach: write `tooling/tests/dev-settings.test.cjs` first; it fails because the module does not exist. Update `dev-profile.test.cjs` so `synthetic-session/1` expects the session worker (fails on the current `null`).
- Verification: `pnpm test:dev`.
- Risks and decisions: None.

- [x] 1.1 Baseline `pnpm test:dev` on the branch base.
- [x] 1.2 RED: add the resolver tests and the updated profile-worker test; confirm they fail for the missing module and the missing worker.
  - [x] 1.2.1 Profile table, defaults and the VM-without-sessions refusal.
  - [x] 1.2.2 Inventory precedence, `ignored`, read-only defaults and `inventree_writes_not_supported`, `inventree_server_required`, local plus URL conflict.
  - [x] 1.2.3 Boolean parsing, empty-as-unset, `invalid_development_setting`, retired names with replacements and no values.
  - [x] 1.2.4 Derived and explicit credential reference; VM pairing required.
- [x] 1.3 GREEN: implement the resolver and the worker mapping; tests pass.
- [x] 1.4 Refactor and run `pnpm format` and the readability checks on the touched files.

## 2. Launcher and login wiring

- PR delivery: the single PR.
- Outcome: `pnpm dev` and `pnpm codex:login` use the resolver; read-only mock skips the apply runner and deployment ID; the VM switch forwards pairing and enables the credential proxy; startup output names inventory, read-only state, profile and ignored settings; retired-name refusals print their replacements.
- Scope and approach: `tooling/dev.cjs`, `tooling/dev/stack.cjs` (`apiTargetEnv` read-only), `tooling/dev/environment.cjs` (allowlist new names, keep retired ones), `tooling/codex-login.cjs`. Design: "Read-only mock reuses the fake namespace", "Retired names stay readable", "Scripted sessions use the session worker".
- Prerequisites: Task 1.
- Acceptance: read-only mock and owned-label scenarios; VM credential management; defaults output.
- TDD approach: extend `dev-stack.test.cjs` (read-only `apiTargetEnv` omits the deployment ID), `dev-environment.test.cjs` (new names load from a file), and `codex-login.test.cjs` (new names select the same roots as the old internal values); they fail before wiring.
- Verification: `pnpm test:dev`; manual `pnpm dev` runs recorded in the PR.
- Risks and decisions: None.

- [x] 2.1 RED: add the stack, environment and login regressions; confirm the expected failures.
- [x] 2.2 GREEN: wire the resolver into `dev.cjs` and `codex-login.cjs`, add the read-only path, VM forwarding and proxy, startup line and refusal output.
- [x] 2.3 Refactor; `pnpm test:dev` and formatting/readability pass.
- [x] 2.4 Manual: default start runs scripted sessions; read-only mock starts without the apply runner; the local switch resolves to the existing local namespace (state-root resolution only, see notes).

## 3. Process-tier coverage

- PR delivery: the single PR.
- Outcome: the end-to-end dev environment test uses the new external settings, and a retired name is refused before any setup.
- Scope and approach: `intake-server/tests/process/serial/dev-environment.test.ts`.
- Prerequisites: Task 2.
- Acceptance: external read-only target scenario; retired-name scenario.
- TDD approach: update the test to the new names first; it fails against the old launcher (verified on the base) and passes with Task 2.
- Verification: `pnpm --filter @invimport/intake-server test:process` for the dev-environment file, with the running app stopped; result recorded in the PR.
- Risks and decisions: the process tier needs Docker and the shared database server.

- [x] 3.1 Update the external-target test to the new settings and add the retired-name refusal check.
- [x] 3.2 Run the dev-environment process tests locally and record the result.

## 4. Documentation and hints

- PR delivery: the single PR.
- Outcome: every user-facing mention of the old dev variables shows the new switches.
- Scope and approach: `.env.intake.example`, `docs/development.md`, `README.md`, `intake-server/ARCHITECTURE.md`, `intake-server/src/agents/ARCHITECTURE.md`, `intake-server/scripts/native-session-qualification/README.md`, `tooling/deployment/README.md` (dev-only paragraphs), `frontend/src/components/agents/AgentSettingsForm.tsx` hint, `docs/PLANNED_FUNCTIONALITY.md` BI-009 wording.
- Prerequisites: Task 1 names.
- Acceptance: proposal outcome.
- TDD approach: documentation; verify with a repository search for the retired names outside archives, deployment-only sections and server-internal code, plus link checks.
- Verification: `git grep` for retired names; frontend typecheck, lint, tests and build.
- Risks and decisions: None.

- [ ] 4.1 Update the env template, development guide and README.
- [ ] 4.2 Update architecture notes, the qualification README, dev paragraphs of the deployment README and the BI-009 wording.
- [ ] 4.3 Update the Agent settings hint and run the frontend checks.
- [ ] 4.4 Search for remaining retired names and confirm each hit is internal, deployment or archived.

## 5. Delivery

- [ ] 5.1 Independent read-only review of the exact candidate commit; fix and re-review until clear.
- [ ] 5.2 Open the PR against `interactive-app` with evidence attached.
- [ ] 5.3 Selected CI green.
- [ ] 5.4 Merge.

## Delivery evidence and lifecycle follow-up

Record the reviewed SHA, check results and PR state here once they exist. No BI item is linked. Sync and archive only when authorized, after `pnpm openspec:overlap --change split-dev-profile-settings`.
