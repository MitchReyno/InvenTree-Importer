# Implementation and delivery tasks

## Plan context

Plan: [proposal](proposal.md), [design](design.md), and deltas for [shared-vm-execution](specs/shared-vm-execution/spec.md) and [processing-agent-sessions](specs/processing-agent-sessions/spec.md). No dependency is added. Change name `fit-vm-turns-to-capacity`; linked item [BI-027](../../../docs/PLANNED_FUNCTIONALITY.md#bi-027--fit-vm-agent-turns-to-the-vms-capacity), following BI-026.

## Completion and commit ordering

Complete and verify a checkbox action, then check it in the same commit as its work. Review, publication, CI and merge items stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Turn capacity from the VM's memory | Behaviour (guest, coordinator, slots) | None | VM turns fit the agent VM's memory |
| 2. Lanes on demand | Behaviour (relay, coordinator) | None | Relays start guests only on demand |
| 3. One start at a time | Behaviour (coordinator) | 2 | One provider start at a time per VM |
| 4. Startup timeouts requeue | Behaviour (runner, migration, failure model) | None | A startup timeout goes back to the queue a bounded number of times |
| 5. VM sizes | Behaviour (tooling) | None | Agent VM size |
| 6. Documentation | Docs | 1–5 | Design D1–D5 where operators and developers read |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | VM turns fit the VM: cap, serialized starts, lanes on demand, startup-timeout requeue, VM sizes, plan and docs | Tasks 1–6 | One fault: each part alone still overloads a small VM, and the relay/coordinator protocol and runner image deploy together | None | `interactive-app`, `fix/fit-vm-turns-to-capacity`, `fix(fit-vm-turns-to-capacity): fit VM agent turns to the VM's capacity` | Typecheck, lint (readability, tooling, unused), contracts tests, intake unit/PG/process tiers, `pnpm test:dev`, `openspec validate --strict`, three read-only review rounds |

## 1. Turn capacity from the VM's memory

- PR delivery: PR-A.
- Outcome: the slot claim bounds sessions by the VM's capacity as well as Sessions at once.
- Scope and approach: `shared-vm/guest-memory.ts`, `guest-main.ts`, `guest-turn.ts` (`memoryBytes`), `shared-vm/turn-capacity.ts`, `coordinator.ts` (`turnCapacity`), `session/slots.ts`, `session/session-runner.ts` deps, `session/session-worker-main.ts` (design D1).
- Acceptance: "VM turns fit the agent VM's memory".
- TDD approach: RED: a process test where a guest reporting 2 GiB lets two turns run at once under Sessions at once 2 (trunk: both `finished`, overlapping); unit tests for the formula and parsing.
- Verification: unit tests, the process test, `tests/pg/session-slots.test.ts`.

- [x] 1.1 RED: the capacity process test and unit tests fail for the expected reasons.
- [x] 1.2 GREEN: the guest reports `memoryBytes`; the coordinator computes and exposes the capacity.
- [x] 1.3 GREEN: the slot claim applies the smaller limit; the worker passes the bridge's capacity and logs changes.

## 2. Lanes on demand

- PR delivery: PR-A.
- Outcome: an idle relay holds an offer, no guest; the coordinator starts guests when a turn or probe needs one.
- Scope and approach: `relay.mjs` offers and `go`; `shared-vm/lane-offers.ts`; `coordinator.ts` TCP front with TLS sniffing, demand per route, idle close of launched connections; `held-capacity.ts` probe bound (design D3).
- Acceptance: "Relays start guests only on demand".
- TDD approach: RED: the process test where an idle relay and coordinator launch no guest (trunk: one), and the relay tooling test for an idle relay (trunk: guest started).
- Verification: `node --test tooling/tests/relay-turns.test.cjs`, the coordinator unit tests, the process tests of #264/#281/#298.

- [x] 2.1 RED: idle-relay tests fail for the expected reason.
- [x] 2.2 GREEN: the relay offers lanes, starts a guest on `go` and opens its next offer.
- [x] 2.3 GREEN: the coordinator sniffs TLS, keeps offers, asks for guests on demand for turns and probes, and closes unclaimed launched connections.
- [ ] 2.4 Verify `concurrent-relay-turns`, `stale-slots`, `provider-status`, `shared-vm-*` process tests and `tooling/tests/dev-vm*.test.cjs`.

## 3. One start at a time

- PR delivery: PR-A.
- Outcome: one VM turn starts at a time; admitted turns run in parallel.
- Scope and approach: `shared-vm/startup-gate.ts`, the driver (design D2).
- Prerequisites: Task 2 (the gate covers the lane request).
- Acceptance: "One provider start at a time per VM".
- TDD approach: RED: a process test with a delayed admission where the second command arrives before the first is admitted (trunk). Gate unit tests for order, hold bound, wait bound and abort.
- Verification: unit and process tests.

- [x] 3.1 RED: the serialized-start process test and gate unit tests fail for the expected reasons.
- [x] 3.2 GREEN: the gate, taken by the driver and released on admission, end or hold bound; a wait past its bound requeues.

## 4. Startup timeouts requeue

- PR delivery: PR-A.
- Outcome: an admission timeout requeues as a new turn up to twice, then fails as `agent_admission_timeout` with its own text.
- Scope and approach: migration `0046_startup_timeouts.sql`, `schema.ts`, `grants.ts`, `session-runner.ts`, `failure-model.ts`, `claude-session-admission.ts` (45 s) (design D4).
- Acceptance: "A startup timeout goes back to the queue a bounded number of times".
- TDD approach: RED: a PG test whose driver reports the guest's `agent_turn_failed` with cause `agent_admission_timeout` (trunk: `failed`, `provider_network`).
- Verification: the PG test, `supervisor-fence`, `held-capacity`, `turn-capacity` PG tests, `session-failures` tests.

- [x] 4.1 RED: the startup-timeout PG test fails for the expected reason.
- [x] 4.2 GREEN: migration, grant and the requeue settlement with the counter and its reset.
- [x] 4.3 GREEN: the code's description and the 45 s admission limit.

## 5. VM sizes

- PR delivery: PR-A.
- Outcome: the template is 4 CPUs / 4 GiB and setup resizes a stopped VM.
- Scope and approach: `lima/agent.yaml`, `vm-provision.cjs` (`ensureVmSize`), `vm-setup.cjs` (design D5).
- Acceptance: "Agent VM size".
- TDD approach: RED: `dev-vm-setup` tests for a stopped VM at 2/2 GiB (expects `limactl edit`), a running one (expects no stop and the message) and a matching one (no edit).
- Verification: `pnpm test:dev`.

- [x] 5.1 RED: the resize tests fail for the expected reasons.
- [x] 5.2 GREEN: the template size and the resize step.

## 6. Documentation

- PR delivery: PR-A.
- Outcome: the agents architecture, `docs/agent-sessions.md`, `docs/development.md` and the deployment README describe the cap, the gate, lane offers, the startup-timeout requeue and the sizing table.
- Acceptance: design D1–D5 as documented behaviour.

- [x] 6.1 Update the documents and check their claims against the code.

## 7. Review and publication

- [ ] 7.1 Independent review rounds on the exact head commit.
- [ ] 7.2 PR opened against `interactive-app`.
- [ ] 7.3 CI green and merged.
