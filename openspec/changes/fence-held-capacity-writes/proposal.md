# Change proposal

## Problem and intended outcome

`recover-stale-agent-slots` (BI-024, #281) lets a starting agent worker release a held slot once it has confirmed the slot's turn is gone. Its review left one race open. A worker holds the actor's supervisor lock on one dedicated connection, and the startup check runs on that connection, but slot claims, turn child records, settlement and the `/1` worker's lane claim run on pooled connections. When a worker loses its lock (its connection ends, `agent_supervisor_lock_lost`), a write already in flight on a pooled connection can still commit after a replacement worker has taken the lock and run its check:

- a slot claim the replacement never saw, so the old worker starts a turn under the new supervisor;
- a turn child record that lands during the replacement's check, so the conditional release finds the record changed and the replacement refuses to start, while the old worker goes on to start the child it recorded;
- a lane claim after the replacement found the lane free, so the old worker starts a native child under the new supervisor.

The outcome: every write that establishes or extends ownership of held capacity is checked, in its own transaction before it writes, to come from the worker holding the supervisor lock, and a settlement to come from a worker while no other worker holds the lock. A replacement waits for writes already past that check before it reads held capacity, so no such write from the old worker commits after the replacement's check.

## Change identity and linked items

Canonical change name: `fence-held-capacity-writes`. Branch `fix/fence-held-capacity-writes`; subjects `type(fence-held-capacity-writes): …`.

Linked item: BI-025 in [the functionality index](../../../docs/PLANNED_FUNCTIONALITY.md), with BI-024 (`recover-stale-agent-slots`) as its prerequisite. That change's `notes.md` records this race as its open item.

## Current behavior and evidence

- **The lock.** `lockAgentSupervisor` (`intake-server/src/agents/worker.ts`) takes `pg_try_advisory_lock` on `agent-supervisor:<actor>` on one pooled connection and keeps that connection for the worker's life. Both workers watch it with `owner.on('error')` and stop with `agent_supervisor_lock_lost`.
- **The check.** `recoverHeldCapacity` (`agents/held-capacity.ts`) reads and releases on the lock's connection, so a worker without the lock releases nothing. Its release matches the exact slot record, so a record committed meanwhile keeps the slot.
- **The unfenced writes.**
  - The claim transaction in `runSessionTurn` (`session/session-runner.ts`) calls `claimSessionSlot` and `recordSlotTurn` (`session/slots.ts`) on a pooled connection.
  - `recordTurnChild` is one autocommit `UPDATE` on the pool.
  - Settlement in `runSessionTurn` releases the slot on a pooled connection after checking the slot still holds its turn.
  - `claimProcessingCommand` (`processing/runner.ts`) sets `processing_lane.attempt_id` on a pooled connection, for the `/1` worker as for the media and research workers.
- None of them checks the lock, so a worker whose lock has gone can commit any of them. Nothing makes a replacement wait for them either.

## Scope and non-goals

In scope:

- A fence check, run inside the same transaction as each of these writes, that refuses with `agent_supervisor_lock_lost` unless the writer's own supervisor connection still holds the actor's lock.
- A barrier on a new supervisor, after it takes the lock and before its check, that waits (bounded) for fenced transactions already past their check to finish. A transaction already past its check commits before the replacement's check reads, and any later one is refused.
- Session claims, turn child records, settlement, the startup interruption sweep and the `/1` worker's lane claim pass the worker's fence.
- Tests reproducing each race in PostgreSQL, and docs (`intake-server/src/agents/ARCHITECTURE.md`, `docs/agent-sessions.md`).

Non-goals:

- No schema change or migration. The fence reads PostgreSQL's own lock table.
- The media and research workers' lane claims stay unfenced: they hold no supervisor lock, and the `/1` worker is the only lane claimer the startup check fences.
- The `/1` lane release and `interruptProcessing` are not fenced: they end ownership, and a startup check keeps the lane anyway. Session settlement, which releases a slot, is fenced (it must not change anything under another supervisor).
- The startup check, its decision table and the claim serialization are unchanged.

## Reuse and dependency assessment

The guarantee is about PostgreSQL's own session advisory locks and the application's transactions, so no external package applies. The options are ways of using PostgreSQL.

| Option | Goal fit and strengths | Limitations, risks and adoption cost | Evidence (checked 2026-11-25) | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| Check lock ownership in each write's transaction through `pg_locks`, with a shared/exclusive advisory barrier | No schema change, no migration, no new grants (`pg_locks` and advisory functions are open to every role). Claims stay serialized as today, and writes still run concurrently on the pool | A catalogue read per fenced transaction; relies on the backend PID and start time to identify the lock's connection | PostgreSQL 17 docs: `pg_locks` advisory rows (`classid`/`objid`/`objsubid`), `pg_advisory_xact_lock_shared`, `lock_timeout`; existing `lockAgentSupervisor` | Visibility of `pg_stat_activity.backend_start` to the runtime role, and the barrier ordering, proved in PG tests |
| Fencing epoch stored in a table, bumped by each new supervisor and checked with `FOR SHARE` | Standard fencing-token pattern, independent of connection identity | Needs migration `0041`, a new table, grants and a coordinated restart; the bump still needs the same wait for in-flight holders | Exact-schema compatibility rule (`operations/compatibility.ts`) | Equivalent guarantee at higher rollout cost |
| Route every fenced write through the lock's own connection | A lost connection fails every write with it | One connection for up to 8 concurrent turns: claims, records and settlements serialize behind each other and behind long transactions, and the call sites (including `processing/runner.ts`) need a shared client with a mutex | `session-worker-main.ts` workflow concurrency 8 | Throughput and lock-wait costs not acceptable for the turn path |

Recommended: the `pg_locks` check with a barrier. It gives the same guarantee as an epoch with no schema change and no throughput cost, which is why this change is not a material schema decision.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `processing-agent-sessions`: two added requirements, "Held capacity writes need the supervisor lock" and "A new supervisor waits for fenced writes in flight".

## Impact and dependencies

- Intake server only: `agents/worker.ts`, a new `agents/supervisor-fence.ts`, `session/session-runner.ts`, `session/slots.ts`, `processing/runner.ts`, `processing/delivery.ts` and both worker entrypoints.
- A new startup refusal, `agent_supervisor_writes_in_flight`, when the barrier's bound passes.
- Depends on `recover-stale-agent-slots` (merged in #281).
- No database, contract, frontend or guest change.

## Open decisions and assumptions

- Assumption: a fenced transaction of a worker that lost its lock can only be finishing work it had started; a 10 s barrier bound covers it, and a start refused past it is retried by restarting the worker.
- None open.
