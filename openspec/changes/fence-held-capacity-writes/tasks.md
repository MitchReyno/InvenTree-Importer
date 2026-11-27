# Implementation and delivery tasks

## Plan context

- **Plan:** the [proposal](proposal.md) and [design](design.md), with the delta for [processing-agent-sessions](specs/processing-agent-sessions/spec.md).
- **Reuse:** PostgreSQL's advisory locks and `pg_locks`; the existing supervisor lock and held-capacity check. No new dependency or migration.
- **Change name:** `fence-held-capacity-writes`. Branch `fix/fence-held-capacity-writes`; subjects `type(fence-held-capacity-writes): …`.
- **Item:** BI-025, after BI-024.

## Completion and commit ordering

- Complete and verify a checkbox action, then check it in the same commit as its work.
- Review, publication, CI and merge actions stay unchecked until they happen.
- Never commit in the worktree while an intake test tier runs there.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Supervisor fence identity and decision | Behavior | None | Design D1, D4; "Held capacity writes need the supervisor lock" |
| 2. Fence the session claim, turn child record and lane claim | Behavior | 1 | Scenarios: claim after loss, record during the check, lane claim after loss, writes of the lock holder |
| 3. Barrier before the startup check | Behavior | 1 | "A new supervisor waits for fenced writes in flight" |
| 4. Fence settlement | Behavior | 1 | Scenarios: settlement after another worker took the lock, settlement while no worker holds it |
| 5. Docs, notes and review | Documentation + review | 1–4 | All |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Plan, fence module, fenced writes, barrier, tests and docs | Tasks 1–5 | The check and the barrier only give the guarantee together, and the plan is small enough to review with the code | `recover-stale-agent-slots` (merged, #281) | `interactive-app` ← `fix/fence-held-capacity-writes`, `fix(fence-held-capacity-writes): fence held capacity writes against supervisor lock loss` | typecheck, lint, readability, unused, fast intake tests, PG and process tiers, OpenSpec validation, three read-only review rounds |

## 1. Supervisor fence identity and decision

- PR delivery: PR-A.
- Outcome: a worker that takes the supervisor lock knows its lock connection's identity, and a fenced transaction can tell whether its write is permitted.
- Scope and approach: new `agents/supervisor-fence.ts` with `SupervisorFence`, `readSupervisorFence`, `fencePermits` and `requireSupervisorFence`; `lockAgentSupervisor` and `acquireAgentSupervisor` return `{ owner, fence }`; both worker entrypoints and the existing tests use the new result (design D1, D4).
- Prerequisites: None.
- Verification: unit tests for `fencePermits`; existing PG fence tests.
- Risks: `backend_start` hidden from the runtime role would refuse every write; the PG tests run as the runner role.

- [x] 1.1 RED: unit tests for `fencePermits` (this holder, another holder, same PID with another start, no holder; ownership and settlement). They fail because the module doesn't exist.
- [x] 1.2 GREEN: the module, the lock result and its callers. Unit and existing `tests/pg/held-capacity.test.ts`, `tests/pg/agents.test.ts` and `tests/pg/session-slots.test.ts` pass.

## 2. Fence the session claim, turn child record and lane claim

- PR delivery: PR-A.
- Outcome: a worker that lost its lock claims no slot, records no child and claims no lane.
- Scope and approach: `SessionRunnerDeps.fence`; the fence first in `runSessionTurn`'s claim transaction and in each `interruptRunningSessions` transaction; `recordTurnChild` in its own fenced transaction; `claimProcessingCommand` and `executeProcessingCommand` take an optional fence, which `worker-main.ts` passes; `session-worker-main.ts` passes its fence into the deps.
- Prerequisites: Task 1.
- Verification: PG race tests in `tests/pg/supervisor-fence.test.ts`.
- Risks: a missed call site stays unfenced; the session worker and `/1` worker are the only production callers.

- [x] 2.1 RED: PG tests with two supervisors' connections: A loses its lock and B acquires, then A's session claim, A's VM record during B's check, and A's `/1` lane claim. Each commits on today's write paths (the claim's driver runs, B refuses with `held_capacity_changed`, the lane is claimed).
- [x] 2.2 GREEN: the fenced claim, record and lane claim. The race tests pass, with each write refused as `agent_supervisor_lock_lost` and nothing changed, and the lock holder's writes still commit.
- [x] 2.3 RED then GREEN: the startup interruption sweep after a replacement took the lock is refused (design D3); it interrupted the session before.

## 3. Barrier before the startup check

- PR delivery: PR-A.
- Outcome: a new supervisor waits for fenced writes already past their check before it checks held capacity, within a bound.
- Scope and approach: `awaitFencedWrites` in `lockAgentSupervisor`, after the lock and identity, with `SUPERVISOR_FENCE_WAIT_MS` (10 s) and a test override; `agent_supervisor_writes_in_flight` in both workers' safe codes.
- Prerequisites: Task 1.
- Verification: PG tests for the in-flight claim and the bound.
- Risks: a long-open transaction of a lost worker delays a start by up to 10 s, then refuses.

- [x] 3.1 RED: PG test: A's claim transaction passes the fence and claims, A loses its lock, B acquires; B's check must decide the claimed slot. It fails today because B's check finishes before A commits. Plus a test that a transaction open past a short bound refuses B with `agent_supervisor_writes_in_flight`.
- [x] 3.2 GREEN: the barrier and its bound. Both tests pass.
- [x] 3.3 RED then GREEN: a barrier blocked past the pools' 5 s statement timeout still succeeds (it failed with a statement timeout), and the in-flight test drives the real claim transaction, blocked after its fence.

## 4. Fence settlement

- PR delivery: PR-A.
- Outcome: a worker that lost its lock settles a turn only while no other worker holds the lock (design D2).
- Scope and approach: the fence first in `runSessionTurn`'s settlement transaction, permitted when this worker or nobody holds the lock, and a bounded retry of a refused settlement.
- Prerequisites: Task 1.
- Verification: PG tests for both cases.
- Risks: a lost worker's settlement refused under a replacement leaves the slot for the next start; that start already decides it from the record.

- [x] 4.1 RED: PG test: A's turn settles after A lost its lock while B holds it; the settlement must change nothing. It fails today because settlement releases the slot. Plus the case with no holder, which settles as before.
- [x] 4.2 GREEN: the fenced settlement. Both tests pass, and `tests/pg/held-capacity.test.ts` still passes.
- [x] 4.3 RED then GREEN: a settlement refused while a replacement held the lock commits once the replacement lets it go, within `SETTLEMENT_FENCE_RETRY_MS` (it stayed refused before).
- [x] 4.4 RED then GREEN: a settlement refused while the replacement's barrier stays queued past 5 s, followed by that replacement refusing to start on the `host` slot, still releases the slot (it failed with a statement timeout); and a new supervisor whose connection ends at the barrier refuses with `agent_supervisor_lock_lost` (it raised an unhandled connection error).

## 5. Docs, notes and review

- PR delivery: PR-A.
- Outcome: the architecture and session docs describe the fence; the plan records what happened.
- Scope and approach: `intake-server/src/agents/ARCHITECTURE.md` (slots, worker, held capacity), `docs/agent-sessions.md`, `recover-stale-agent-slots/notes.md` (open item points here), this change's `notes.md`, the BI index.
- Prerequisites: Tasks 1–4.
- Verification: link and reference checks; the checks below.

- [x] 5.1 Docs updated and checked against the code.
- [x] 5.2 Checks: `pnpm -s typecheck`, `pnpm -s lint:readability`, `pnpm -s lint:unused`, `pnpm format:check`, fast intake tests, PG tier, process tier, `openspec validate fence-held-capacity-writes --strict`.
- [x] 5.3 Independent read-only review rounds on the exact head, findings fixed (round 3 fixes not re-reviewed).
- [ ] 5.4 PR opened against `interactive-app`.
- [ ] 5.5 Merged.
