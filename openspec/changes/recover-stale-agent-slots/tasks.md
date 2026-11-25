# Implementation and delivery tasks

## Plan context

- **Plan:** the [proposal](proposal.md) and [design](design.md), with deltas for [processing-agent-sessions](specs/processing-agent-sessions/spec.md) and [development-launcher](specs/development-launcher/spec.md).
- **Reuse:** the guest's existing removal probe (`inspectTerminal` with `requireReap`) and `releaseSessionSlot`; no new dependency.
- **Change name:** `recover-stale-agent-slots`. Branch `fix/recover-stale-agent-slots`; subjects `type(recover-stale-agent-slots): …`.
- **Item:** BI-024.

## Completion and commit ordering

- Complete and verify a checkbox action, then check it in the same commit as its work.
- Review, publication, CI and merge actions stay unchecked until they happen.
- Never commit in the worktree while an intake test tier runs there.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Record each held slot's turn child | Migration + behavior | None | Design D2; "Startup confirms held capacity before releasing it" |
| 2. Startup check and release | Behavior | 1 | "Startup confirms held capacity before releasing it" |
| 3. Shutdown settles in-flight turns | Behavior | None | "Shutdown settles in-flight turns" |
| 4. Launcher stop order and `pnpm agents:reap` | Tooling behavior | 2 | "Launcher stops what it started", "Operator reap check" |
| 5. Process-tier qualification | Test | 1–3 | Both processing-agent-sessions requirements |
| 6. Docs, notes and review | Documentation + review | 1–5 | All |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Plan, migration, startup check, shutdown wait, launcher order, operator command, tests and docs | Tasks 1–6 | One recovery path: the record, the check that reads it and the shutdown that avoids needing it only make sense together, and the migration must ship with the code that writes it | None | `interactive-app` ← `fix/recover-stale-agent-slots`, `fix(recover-stale-agent-slots): recover stale agent slots after a confirmed reap` | typecheck, lint, readability, unused, fast intake and tooling tests, PG and process tiers, OpenSpec validation, three read-only review rounds |

## 1. Record each held slot's turn child

- PR delivery: PR-A.
- Outcome: every slot this build claims says which turn holds it and what that turn started outside the worker, so a restarted worker can check it.
- Scope and approach: migration `0040_agent_slot_turn_child.sql` and `agents/schema.ts`; `session/slots.ts` records the turn at claim and clears it on release; `SessionDriverContext.recordChild` in `session-runner.ts`; the native driver records `host` and `shared-vm/coordinator.ts` records `vm` with the exact command before it sends it (design D2).
- Prerequisites: None.
- Verification: PG tests in `tests/pg/session-slots.test.ts`; schema catalogue test.
- Risks: a driver that starts a child without recording it would read as `none`; only the native and VM drivers start children.

- [x] 1.1 RED: PG tests that a claim records the turn with `none`, that `recordChild` records `vm` with its command, that settlement clears every column, and that the checks refuse a record on a free slot. They fail for the missing columns.
- [x] 1.2 GREEN: migration, schema, slot helpers, driver callback, native and VM drivers. The tests pass.
- [x] 1.3 Schema catalogue and existing slot tests pass.

## 2. Startup check and release

- PR delivery: PR-A.
- Outcome: a starting worker releases held slots it has confirmed gone and refuses, naming the attempt and reason, for the rest (design D3).
- Scope and approach: a recovery module beside `session/slots.ts` with the pure decision and `recoverHeldCapacity`; `agents/worker.ts` split into the lock and the check; `confirmReaped` on the bridge; both worker entrypoints check after the lock (the session worker after starting its bridge); recover-only mode (`INTAKE_AGENT_RECOVER_ONLY=1`) in both.
- Prerequisites: Task 1.
- Verification: unit tests for the decision; PG tests for release and refusal against real tables and the runner role.
- Risks: releasing a slot that changed after the decision; covered by the exact conditional release on the supervisor lock's connection.

- [x] 2.1 RED: unit tests for every row of the decision table, and PG tests: `none` and confirmed `vm` slots released and then interrupted by `interruptRunningSessions`; `host`, unrecorded, unconfirmed `vm` and the lane kept with `agent_reap_confirmation_required`; a slot changed after the decision not released; a second worker still refused with `agent_supervisor_already_running`. They fail because no check exists.
- [x] 2.2 GREEN: the decision, `recoverHeldCapacity`, the fence split, `confirmReaped`, both entrypoints and recover-only mode. The tests pass.
- [x] 2.3 Existing `tests/pg/agents.test.ts` fence tests still pass, updated where the fence's behaviour changed.

## 3. Shutdown settles in-flight turns

- PR delivery: PR-A.
- Outcome: a stopping session worker waits up to 30 s for its turns to settle before closing anything, so a confirmed reap releases the slot (design D1).
- Scope and approach: `session/session-worker-main.ts` tracks the turns its workflows run and waits for them in `finally` before the status channel, scheduler, DBOS, bridge, tool server and pools close.
- Prerequisites: None.
- Verification: the process test in task 5 that answers the removal probe after 12 s, past DBOS's 10 s.
- Risks: a slow shutdown; bounded by the wait and the launcher's grace.

- [x] 3.1 RED: the task 5 shutdown test fails on the base worker (the slot stays held).
- [x] 3.2 GREEN: track and wait for turns. The test passes.

## 4. Launcher stop order and `pnpm agents:reap`

- PR delivery: PR-A.
- Outcome: `pnpm dev` stops the app before the relays and tunnel, and `pnpm agents:reap` runs the startup check without the app (design D1, D5).
- Scope and approach: `tooling/dev/session.cjs` stops children in phases; `tooling/dev.cjs` signals only application processes in `shutdown()`, stops the VM group after them, and handles `--reap-agents`; root `package.json` script; `--help` text; deployment compose stop grace.
- Prerequisites: Task 2 (recover-only mode).
- Verification: `tooling/tests/dev-supervisor.test.cjs` for the phases and forced stop; `pnpm test:dev`.
- Risks: `pnpm agents:reap` end to end needs the real VM and is not run here.

- [x] 4.1 RED: a tooling test that the first phase has exited before the second phase is signalled, and that a phase over its grace forces every child down. It fails on the single-phase stop.
- [x] 4.2 GREEN: phased stop in the launcher, `--reap-agents`, the script, help text and compose grace. `pnpm test:dev` passes.

## 5. Process-tier qualification

- PR delivery: PR-A.
- Outcome: real worker processes, a paired fake guest over TLS and real PostgreSQL show both requirements.
- Scope and approach: a new `tests/process/stale-slots.test.ts`: (a) SIGTERM mid-turn, the fake guest answers the removal probe after 12 s, the slot is released and the session interrupted; (b) SIGTERM with no proof, the worker exits holding the slot, recover-only mode with the guest answering releases it, and a normal start serves with the session interrupted.
- Prerequisites: Tasks 1–3.
- Verification: `pnpm db:intake test:process` with the decoder and probe images built.

- [x] 5.1 Both process cases pass; (a) fails on the base worker.

## 6. Docs, notes and review

- PR delivery: PR-A.
- Outcome: the docs describe the recovery, and the change passes review.
- Scope and approach: `intake-server/src/agents/ARCHITECTURE.md` (supervision, slots, worker), `docs/agent-sessions.md`, `docs/development.md` (`pnpm agents:reap`), `tooling/deployment/README.md` (stop order, coordinator grace, interrupted-turn recovery); BI-024 in the index; `notes.md`.
- Prerequisites: Tasks 1–5.

- [x] 6.1 Docs updated and checked against the code.
- [x] 6.2 Checks: `pnpm -s typecheck`, `pnpm -s lint:readability`, `pnpm -s lint:unused`, `pnpm format:check`, fast intake tests, `pnpm test:dev`, PG and process tiers, `openspec validate recover-stale-agent-slots --strict`.
- [ ] 6.3 Three read-only review rounds on the exact head, findings fixed between rounds.
- [ ] 6.4 PR opened against `interactive-app`.
- [ ] 6.5 CI green and merged.
