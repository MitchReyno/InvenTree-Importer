# Implementation and delivery tasks

## Plan context

- Change: `launch-vm-agents-with-dev`. [Proposal](proposal.md), [design](design.md), spec: [development-launcher](specs/development-launcher/spec.md) (added requirements).
- Reuse decision: extend the existing launcher and its settings resolver; drive `limactl`, `ssh` and the repository's `relay.mjs`; no new dependency.
- Linked BI items: None (developer-tooling request, not indexed).

## Completion and commit ordering

Check an action only after it is done and verified, and stage the `tasks.md` update in the same commit as the work. Review, publication, CI and merge actions stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
|---|---|---|---|
| 1. VM launch settings | behavior | None | opt-in, validation and summary scenarios |
| 2. VM lifecycle module and launcher wiring | behavior | 1 | bring-up, reload, failure and shutdown scenarios |
| 3. Deployment fixes and documentation | docs and config | None | proposal: Claude credential service survives a boot; tunnel commands stay open; settings documented |
| 4. Qualification and delivery | lifecycle | 1–3 | manual qualification, review, CI and merge gates |

### PR delivery map

One PR carries tasks 1–4. The settings, the module that acts on them and their documentation describe one opt-in feature; the deployment fixes are what the launcher relies on.

- Branch `feat/launch-vm-agents-with-dev`, base `interactive-app`.
- Subject `feat(launch-vm-agents-with-dev): start and stop the agent VM with pnpm dev`.
- Gates: `pnpm test:dev`, `pnpm lint && pnpm build && pnpm test`, `pnpm format:check`, manual qualification against a real VM, independent exact-head review, green selected CI.

## 1. VM launch settings

- PR delivery: the single PR.
- Outcome: `resolveDevelopmentSettings` returns a `vm` plan or `null`, and refuses invalid VM settings before setup; the startup summary names the VM.
- Scope and approach: `tooling/dev/settings.cjs`, `tooling/dev/environment.cjs` allowlist. Design: "Validation in settings.cjs", "Real agents only".
- Prerequisites: None.
- Acceptance: "Launcher-managed VM agents are opt-in by naming the VM", "VM launch settings are validated".
- TDD approach: extend `tooling/tests/dev-settings.test.cjs` and `dev-environment.test.cjs` first; they fail because `vm` is undefined and the names are not allowlisted.
- Verification: `pnpm test:dev`.
- Risks and decisions: None.

- [x] 1.1 Baseline `pnpm test:dev` on the branch base.
- [x] 1.2 RED: add tests for the accepted plan, `vm_launch_requires_real_vm_agents`, `vm_launch_setting_required`, `invalid_vm_launch_setting`, the keep-running switch, value-free refusal lines, the summary line and the allowlisted names; confirm they fail for the intended reasons.
- [x] 1.3 GREEN: implement the plan, refusals, summary line and allowlist; tests pass.
- [x] 1.4 Refactor; run `pnpm format` and the readability checks on the touched files.

## 2. VM lifecycle module and launcher wiring

- PR delivery: the single PR.
- Outcome: `pnpm dev` boots the VM when needed, runs the tunnel and both relays as reload-surviving owned children, stops the app if one dies, and stops a VM it booted on exit unless kept.
- Scope and approach: new `tooling/dev/vm.cjs` with injected command runner and `launch`; `tooling/dev.cjs` startup and `finally` insertion; `package.json` `test:dev` list. Design: "Boot after the supervisor lock", "Tunnel and relays as reload-surviving owned children", "Stop only what this run booted".
- Prerequisites: 1.
- Acceptance: "Launcher brings up the VM, tunnels and relays", "VM children outlive reloads and fail loudly", "Launcher stops what it started".
- TDD approach: write `tooling/tests/dev-vm.test.cjs` first against fakes; it fails because the module does not exist. The `dev.cjs` wiring has no unit harness and is covered by task 4's qualification.
- Verification: `pnpm test:dev`; task 4.
- Risks and decisions: readiness is "alive after one second" because the children print nothing when healthy.

- [x] 2.1 RED: module tests for the boot decision and `booted` flag, the stop decision for booted and keep-running combinations, relay arguments and environment with and without tools, tunnel arguments, early-exit detection and stop-failure reporting; confirm they fail for the missing module.
- [x] 2.2 GREEN: implement `tooling/dev/vm.cjs`; tests pass.
- [x] 2.3 Wire `tooling/dev.cjs`: boot and children after `startSupervision`, reload survival, exit handling, and the shutdown order (children, then VM stop, then lock release, with stop failures reported).
- [x] 2.4 Add the new test file to `test:dev`; refactor; run `pnpm format` and the readability checks.

## 3. Deployment fixes and documentation

- PR delivery: the single PR.
- Outcome: the Claude credential service no longer OOM-loops; the documented tunnel commands stay in the foreground; the new settings are documented.
- Scope and approach: `tooling/deployment/bridge/personal-claude.sh` (management service 384 MB, matching Codex; egress keeps 128 MB), `tooling/deployment/README.md` tunnel commands with `-o ControlPath=none`, `docs/development.md`, `.env.intake.example`.
- Prerequisites: None.
- Acceptance: proposal problem statement; the documented settings match task 1.
- Verification: `bash -n` on the script; manual boot check in task 4; Markdown reference check against the code.
- Risks and decisions: None.

- [ ] 3.1 Split the memory cap in `personal-claude.sh`.
- [ ] 3.2 Fix the tunnel commands in `tooling/deployment/README.md`.
- [ ] 3.3 Document the settings and lifecycle in `docs/development.md` and `.env.intake.example`, and check every claim against the code.

## 4. Qualification and delivery

- PR delivery: the single PR.
- Outcome: the launcher behavior is shown against a real paired VM, reviewed and merged.
- Prerequisites: 1–3.
- Acceptance: all scenarios in the spec delta; evidence goes on the PR.
- Verification: manual runs with a paired VM: cold start; Ctrl-C stops the VM; an already-running VM is kept; `INTAKE_VM_KEEP_RUNNING`; a killed relay stops the app; a source reload keeps the relays; a missing instance fails before services start.
- Risks and decisions: no provider turn is run.

- [ ] 4.1 Run the manual qualification and record the outcomes for the PR.
- [ ] 4.2 Run the full gate.
- [ ] 4.3 Independent review rounds until one is clean, at the reviewed head.
- [ ] 4.4 Open the PR against `interactive-app` with the evidence.
- [ ] 4.5 Selected CI green.
- [ ] 4.6 Merge.
