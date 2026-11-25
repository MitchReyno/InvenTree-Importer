# Implementation notes

Delivered in one PR (PR-A): the supervisor fence, fenced claims, turn child records, `/1` lane claims and settlement, and the barrier before a new supervisor's check. Review and merge remain.

## Changes to the plan

- **2026-11-25T19:21+1100, tasks 2–4 (PR-A):** Review round 1 extended the plan: the startup interruption sweep is fenced too (design D3, a lost worker could otherwise interrupt a session a replacement had claimed); a refused settlement is retried for up to 20 s, so a replacement that refused to start on this worker's `host` slot doesn't strand it (D2); and the barrier raises its own statement timeout, since the pools' 5 s one would otherwise end the 30 s wait (D1). The spec gained scenarios for the sweep and the retry, and states the check, not the commit, as the authority point.

- **2026-11-25T19:33+1100, tasks 1–4 (PR-A):** Review round 2: the fence's shared lock no longer waits (a settlement queued behind a replacement's barrier hit the pools' 5 s statement timeout and lost its retry), a settlement's first refusal is logged as `settlement_fence_refused`, and the lock connection gets its error listener at checkout so a connection lost at the barrier refuses with `agent_supervisor_lock_lost` instead of an unhandled error. Design D1 and D2 updated.
- **2026-11-25T19:40+1100, tasks 3–4 (PR-A):** Review round 3, fixed without a further round: the barrier's bound dropped from 30 s to 10 s so it ends well inside the 20 s settlement retry (a replacement that waited its whole barrier and then refused on a `host` slot could otherwise outlast the retry); the retry uses a monotonic clock and starts no attempt past its bound; the PG tests look only at their own database's exact advisory keys and end only the replacement's connection. Spec, design and docs updated.

## Unexpected challenges

- **2026-11-25T19:02+1100, task 2:** The first RED runs hung instead of failing: a failed assertion left a supervisor connection checked out, and the fixture's dispose waits for every checked-out connection. The race tests now run their cleanups newest first, before the fixture is disposed, and release a lock that started when it shouldn't have.

## Decisions made during implementation

- **2026-11-25T19:02+1100, task 1:** The lock connection is identified by its backend PID and `backend_start` in integer microseconds, read once after the lock is taken. A `Date` would lose the microseconds. Matching the PID alone was rejected because PIDs are reused.
- **2026-11-25T19:02+1100, task 2:** `SessionRunnerDeps.fence` and the `fence` arguments are optional, so the media and research workers and the many turn tests without a supervisor stay unfenced. A required argument was rejected: those callers have no lock to pass. Only the two worker entrypoints construct fenced deps in production.

## Open items

- Mixing builds: this change has no migration, so the exact-schema check doesn't keep a previous-build worker away; its writes take no fence. Stop every old worker before starting this build (deployment guide).

- A lost worker's `interruptProcessing` and lane releases are not fenced; they end ownership, and a startup check keeps the lane anyway.
- A real network partition, where PostgreSQL keeps the old session alive until TCP times out, is not simulated; until then the old worker still holds the lock and its writes are legitimately permitted.
