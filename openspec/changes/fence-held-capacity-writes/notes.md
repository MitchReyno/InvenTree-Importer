# Implementation notes

Delivered in one PR (PR-A): the supervisor fence, fenced claims, turn child records, `/1` lane claims and settlement, and the barrier before a new supervisor's check. Review and merge remain.

## Changes to the plan

None.

## Unexpected challenges

- **2026-11-25T19:02+1100, task 2:** The first RED runs hung instead of failing: a failed assertion left a supervisor connection checked out, and the fixture's dispose waits for every checked-out connection. The race tests now run their cleanups newest first, before the fixture is disposed, and release a lock that started when it shouldn't have.

## Decisions made during implementation

- **2026-11-25T19:02+1100, task 1:** The lock connection is identified by its backend PID and `backend_start` in integer microseconds, read once after the lock is taken. A `Date` would lose the microseconds. Matching the PID alone was rejected because PIDs are reused.
- **2026-11-25T19:02+1100, task 2:** `SessionRunnerDeps.fence` and the `fence` arguments are optional, so the media and research workers and the many turn tests without a supervisor stay unfenced. A required argument was rejected: those callers have no lock to pass. Only the two worker entrypoints construct fenced deps in production.

## Open items

- A lost worker's `interruptProcessing` and lane releases are not fenced; they end ownership, and a startup check keeps the lane anyway.
- A real network partition, where PostgreSQL keeps the old session alive until TCP times out, is not simulated; until then the old worker still holds the lock and its writes are legitimately permitted.
