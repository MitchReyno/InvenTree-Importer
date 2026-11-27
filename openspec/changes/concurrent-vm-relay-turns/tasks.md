# Implementation and delivery tasks

## Plan context

Plan: [proposal](proposal.md), [design](design.md), and deltas for [shared-vm-execution](specs/shared-vm-execution/spec.md) and [processing-agent-sessions](specs/processing-agent-sessions/spec.md). No dependency is added (proposal, reuse assessment). Change name `concurrent-vm-relay-turns`; linked item [BI-026](../../../docs/PLANNED_FUNCTIONALITY.md#bi-026--run-several-vm-turns-per-provider-at-once).

## Completion and commit ordering

Complete and verify a checkbox action, then check it in the same commit as its work. Review, publication, CI and merge items stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Requeue a turn without a free connection | Behaviour (server, contracts) | None | processing-agent-sessions: all scenarios |
| 2. Relay lanes and the guest's claim report | Behaviour (tooling, guest, coordinator) | None | shared-vm-execution: all scenarios |
| 3. End-to-end process proof | Test | 1, 2 | Both deltas' first scenarios |
| 4. Documentation | Docs | 1, 2 | Design D1–D5 described where operators and developers read |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Several VM turns per provider at once; capacity shortfalls requeue; accurate diagnostic for an absent relay; plan and docs | Tasks 1–4 | One fault with one fix: capacity without the requeue still fails sessions on older images, and the requeue without capacity leaves the limit unusable | None | `interactive-app`, `fix/concurrent-vm-relay-turns`, `fix(concurrent-vm-relay-turns): run several VM turns per provider at once` | Typecheck, lint (readability, tooling, unused), contracts tests, intake unit/PG/process tiers, `pnpm test:dev`, `openspec validate --strict`, three read-only review rounds |

## 1. Requeue a turn without a free connection

- PR delivery: PR-A.
- Outcome: a VM turn whose route is busy goes back to the queue unchanged; a tool turn whose relay is absent fails with `agent_vm_unavailable`.
- Scope and approach: `session/session-adapters.ts` (`SessionCapacityUnavailable`), `session/session-runner.ts` (requeue settlement restoring the turn count), `shared-vm/coordinator.ts` (admitted-connection tracking, busy/absent decision), `failure-model.ts` and `contracts/src/session-failures.ts`, `session-failure-text.ts`, regenerated contracts (design D4, D5).
- Prerequisites: None.
- Acceptance: processing-agent-sessions "A turn without a free VM connection goes back to the queue".
- TDD approach: RED: a coordinator test where a busy route's turn waits out and expects the requeue error (today `agent_process_unavailable`), a runner test expecting `queued` with turn count, slot, child and diagnostics unchanged (today `failed` with a diagnostic), and an absent-route test expecting `agent_vm_unavailable`.
- Verification: `pnpm --filter @invimport/contracts test`, the touched PG/process tests, typecheck.
- Risks and decisions: none beyond design.

- [x] 1.1 RED: coordinator and runner regressions for the busy, absent and fenced cases fail for the expected reasons.
- [x] 1.2 GREEN: add `agent_vm_unavailable` to the contracts with its sentence and description, and regenerate the contracts.
- [x] 1.3 GREEN: the coordinator tells busy from absent and throws `SessionCapacityUnavailable` or `agent_vm_unavailable`.
- [x] 1.4 GREEN: the runner settles `SessionCapacityUnavailable` as a requeue: no diagnostic, turn count restored and the session at the back of the queue, slot and capability released, resume row and progress untouched, under the settlement fence.
- [x] 1.5 Verify the existing held-capacity, fence and stale-slot tests still pass.

## 2. Relay lanes and the guest's claim report

- PR delivery: PR-A.
- Outcome: a relay carries up to `INTAKE_VM_RELAY_TURNS` turns with one ready connection; the guest reports its claim; the coordinator admits 16 turn connections.
- Scope and approach: `tooling/deployment/bridge/relay.mjs` lanes (design D1), `shared-vm/turn-claimed.ts`, `guest-turn.ts` `onClaimed`, `guest-main.ts` (D2), `coordinator.ts` allowance (D3), a relay test in `tooling/tests/` added to `pnpm test:dev`.
- Prerequisites: None.
- Acceptance: shared-vm-execution "Relays carry concurrent turns".
- TDD approach: RED: a relay test with a fake coordinator and `limactl` expects a second connection after the first is claimed (today none until the first guest exits), plus the capacity, older-guest, refused-lane and SIGTERM rules; a guest-turn test expects `onClaimed` after the first packet.
- Verification: `node --test tooling/tests/relay-turns.test.cjs`, intake unit tests, `pnpm lint:tooling`.
- Risks and decisions: requires a runner image refresh (managed `pnpm dev` does it).

- [x] 2.1 RED: relay lane tests and the guest `onClaimed` test fail for the expected reasons.
- [x] 2.2 GREEN: guest claim report through `onClaimed` and the shared marker constant.
- [x] 2.3 GREEN: relay lanes with capacity, one ready lane, marker parsing, stderr forwarding, refused-lane delay and SIGTERM for every lane.
- [x] 2.4 GREEN: coordinator turn allowance from `MAX_SESSION_SLOTS` and matching `maxConnections`.
- [x] 2.5 Verify `provider-status.test.ts`, `model-catalog.test.ts` and `tooling/tests/dev-vm*.test.cjs` still pass.

## 3. End-to-end process proof

- PR delivery: PR-A.
- Outcome: two overlapping Claude tool turns with session limit 2 both run through the real relay; with relay capacity 1 the second requeues and later runs.
- Scope and approach: a new `intake-server/tests/process/concurrent-relay-turns.test.ts` with a paired fake guest in `tests/support/` started by a stand-in `limactl`, as `provider-status.test.ts` does.
- Prerequisites: Tasks 1 and 2 (RED is recorded against trunk code first).
- Acceptance: both deltas' first scenarios.
- TDD approach: RED on trunk: the second turn returns `failed` with `agent_process_unavailable` after about 45 s. GREEN after tasks 1–2.
- Verification: the new process test alone, then the process tier.
- Risks and decisions: none.

- [x] 3.1 RED: the process test fails on trunk code with the second turn `failed` / `agent_process_unavailable`.
- [x] 3.2 GREEN: both turns run concurrently; with capacity 1 the second is requeued (`queued`, turn count 0, no slot, child `none`, no diagnostic) and runs on the next attempt.

## 4. Documentation

- PR delivery: PR-A.
- Outcome: the agents architecture, `docs/agent-sessions.md`, `docs/development.md` and the deployment README describe several turns per relay, the claim report, `INTAKE_VM_RELAY_TURNS`, the requeue and `agent_vm_unavailable`.
- Scope and approach: replace "one turn at a time" and "one relay per simultaneous turn" text; add the requeue to the session states.
- Prerequisites: Tasks 1 and 2.
- Acceptance: design D1–D5 as documented behaviour.
- TDD approach: documentation; checked by re-reading each claim against the code and `pnpm lint:markdown`.
- Verification: `pnpm lint:markdown` (or the repository's Markdown check), link check by reading.
- Risks and decisions: none.

- [x] 4.1 Update the four documents and check each claim against the code.

## Delivery evidence and lifecycle follow-up

- [ ] Independent read-only review rounds on the exact head (up to three), findings fixed.
- [ ] PR opened against `interactive-app` with evidence in its description.
- [ ] Selected CI green.
- [ ] Merged; BI-026 updated to Done only after a live run confirms it.
