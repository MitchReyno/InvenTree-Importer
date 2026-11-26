# Implementation notes

Relay lanes, the guest's claim report, the coordinator's turn allowance and busy/absent decision, the requeue and `agent_vm_unavailable` are delivered in PR-A. A live run on the real VM remains.

## Changes to the plan

- **2026-11-26T15:20+11:00, task 1 (PR-A):** The coordinator's 45 s and 15 s waits became a `TurnTiming` argument of `startSessionBridge`, beside its status and catalogue timings, so the coordinator unit tests needn't sit out 45 s per case. Defaults are unchanged.

- **2026-11-26T16:40+11:00, task 2 (PR-A, review round 1):** The relay now stops a guest launcher that outlives its closed connection by 60 s (`GUEST_EXIT_MS`), treats a launcher that can't be spawned as an unclaimed lane (500 ms retry), and bounds an unfinished standard-error line at 4096 characters. The coordinator also counts admissions per route, so a connection admitted and closed between its 100 ms samples still counts as a running relay. The requeue keeps `queued_since` as read under the session row's lock instead of from the claim's first read.

- **2026-11-26T17:45+11:00, tasks 1–2 (PR-A, review round 2):** Recording a turn's child now also refuses (`TurnAttemptNotRunning`) when the attempt has stopped being its job's current running one, read under share locks on job then attempt, and the runner settles that as the cancellation, so a cancellation committed while a turn waits for a free connection sends nothing. A capacity requeue whose attempt was cancelled before settlement settles as cancelled. The relay removes an overdue guest's containers by name (the plain guest container is now named `bench-turn-<run>`) and logs `guest_teardown_overdue`, removes its readiness listener from the lifetime signal, and treats the rest of an overlong standard-error line as plain output.

## Unexpected challenges

- **2026-11-26T15:20+11:00, task 3:** The process test's fake turn must outlast the 45 s wait; a shorter turn lets trunk's single-connection relay hand the second turn a connection before its wait ends, and RED shows nothing. Each fake turn holds 50 s (65 s in the capacity case).

## Decisions made during implementation

- **2026-11-26T15:20+11:00, task 2:** The relay's default capacity (8) is a literal in `relay.mjs`, which can't import TypeScript; a tooling test checks it equals `MAX_SESSION_SLOTS`. The launcher passes nothing, so `pnpm dev` and the packaged deployment get the same default. Rejected: the launcher passing `INTAKE_VM_RELAY_TURNS`, which would duplicate the constant in a third place.
- **2026-11-26T15:20+11:00, task 1:** The supervisor-fence case for a requeue passed before the runner change, because settlement already takes the fence; it is kept as a regression for the new settlement path rather than as RED evidence.

- **2026-11-26T16:40+11:00, task 4 (review round 1):** `pnpm dev` keeps the relay's default capacity and doesn't forward `INTAKE_VM_RELAY_TURNS` (its host environment is allowlisted); the development guide says so and points to **Sessions at once**, which already bounds concurrent turns. Rejected: a new launcher setting, which would only duplicate the session limit.

## Open items

- A status or catalogue pump that ignores SIGTERM can hold a stopping relay open, because `carryStatusOnce` awaits the pump's exit before its bounded stop. It predates this change (the old relay awaited the same carriers) and is unrelated to turn capacity.
- Concurrent provider CLIs in the 2 GiB default VM: memory is not changed here; the deployment README's sizing advice applies.
- Live run on `bench-agent-m1-local` after merge, with a runner image refresh.
