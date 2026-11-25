# Design assessment

## Context and grounding

The change is in the intake server's agent workers:

- **The lock** (`agents/worker.ts`). `lockAgentSupervisor` takes `pg_try_advisory_lock(hashtextextended('agent-supervisor:<actor>', 7318))` on one pooled connection that the worker keeps for its life. `acquireAgentSupervisor` adds the held-capacity check on that connection.
- **The check** (`agents/held-capacity.ts`, from `recover-stale-agent-slots`). It reads and releases on the lock's connection, with an exact conditional release.
- **The writes that establish or extend ownership**, all on pooled connections:
  - the claim transaction in `runSessionTurn` (`session/session-runner.ts`): `claimSessionSlot`, `recordSlotTurn` and `issueSessionCapability`;
  - `recordTurnChild` (`session/slots.ts`), called through the driver context's `recordChild`;
  - the `/1` worker's lane claim in `claimProcessingCommand` (`processing/runner.ts`), reached through `executeProcessingCommand` (`processing/delivery.ts`).
- **Settlement** in `runSessionTurn`, which releases the slot after checking it still holds the settled turn.

Complexity: small to moderate. One new module, a changed lock result and a check at the start of four transactions. No migration.

## Goals and constraints

Goals come from the [proposal](proposal.md) and the [processing-agent-sessions delta](specs/processing-agent-sessions/spec.md).

- No ownership write from a worker that lost its lock commits after a replacement's held-capacity check.
- Claims stay serialized per actor (`agent-slots:<actor>` transaction lock); no long-held transaction is added.
- The startup check's decisions and its use of the lock's connection are unchanged.
- No schema change if one can be avoided, so no coordinated restart.

## Decisions and alternatives

### D1. Check lock ownership inside each write's transaction, with a barrier on the new supervisor

A check inside the write's transaction alone is not enough: a transaction can pass it, the lock can go, a replacement can check, and the transaction can commit afterwards. So the check comes with a barrier that orders it against a replacement's check.

**Fence key.** A second advisory key per actor, `agent-supervisor-fence:<actor>` with seed 7320 (7318 is the supervisor lock, 7319 the slot claims).

**In each fenced transaction, first** (`requireSupervisorFence`, `agents/supervisor-fence.ts`):

1. `pg_advisory_xact_lock_shared` on the fence key. Fenced transactions share it, so they never wait for each other.
2. Read the supervisor lock's current holder from `pg_locks` (advisory, granted, this database, the key's `classid`/`objid`, `objsubid = 1`), joined to `pg_stat_activity` for its backend start time.
3. Decide (`fencePermits`, a pure function) and refuse with `agent_supervisor_lock_lost` when the write isn't permitted. The transaction rolls back.

**In a new supervisor, after taking the lock and before its check** (`awaitFencedWrites`): a short transaction on the lock's connection that takes `pg_advisory_xact_lock` (exclusive) on the fence key under `lock_timeout` 30 s (`SUPERVISOR_FENCE_WAIT_MS`), then commits. The worker pools' 5 s `statement_timeout` would end the wait first, so the transaction raises its own `statement_timeout` above the lock timeout. It waits for every fenced transaction already holding the shared lock to end. A fenced transaction that asks for the shared lock afterwards finds the new holder in `pg_locks` and is refused. Past the bound the start refuses with `agent_supervisor_writes_in_flight`.

Ordering, for a write W of old worker A and replacement B:

```text
W takes shared fence, sees A holds the lock   ->  B's barrier waits for W  ->  B's check sees W's effect
W takes shared fence after B took the lock    ->  W sees B as holder         ->  W refused
```

**Identity.** The worker reads its lock connection's `pg_backend_pid()` and `backend_start` (as integer microseconds, so no precision is lost in JavaScript) once, right after taking the lock, into a `SupervisorFence`. Matching both makes a reused PID harmless. Both workers' lock connection and pooled connections use the same role, so `backend_start` is visible; a holder whose start time is hidden reads as another holder, which refuses.

**Where the check runs.** First in each transaction, so a fenced transaction takes the fence before any row lock:

| Transaction | Write it fences | Permitted when |
| --- | --- | --- |
| Session claim (`runSessionTurn`'s `claim`) | Slot claim, turn record, capability | This worker holds the lock |
| `recordTurnChild` (now its own transaction) | `host` or `vm` record, before the child starts | This worker holds the lock |
| `claimProcessingCommand` with a fence | `/1` lane claim | This worker holds the lock |
| Settlement in `runSessionTurn` | Session state, capability revocation, slot release | No other worker holds the lock |
| Each interruption of `interruptRunningSessions` | A running session left without a slot becomes `interrupted` | This worker holds the lock |

Rejected:

- **A fencing epoch table** (`agent_supervisor_epoch`, bumped by each new supervisor, checked with `FOR SHARE` in each write). The same guarantee, but it needs migration `0041`, grants, a schema catalogue entry and a coordinated restart, and the bump has to wait for in-flight holders exactly as the barrier does.
- **Routing the writes through the lock's connection.** One connection would carry up to 8 concurrent turns' claims, records and settlements, serialized behind each other and behind any long transaction, and `processing/runner.ts` would need a shared client with a mutex. The guarantee would be the same.
- **A `pg_locks` check without the barrier.** It leaves the original race between the check and the commit.

### D2. Settlement is permitted while no other worker holds the lock

Settlement ends ownership. When the lock is lost and no replacement has it yet, a stopping worker's turns still settle once their drivers confirm the reap, as `recover-stale-agent-slots` intends; otherwise every slot of a lost connection would wait for the next start, and a `host` turn's slot could never be released by it. A replacement that takes the lock afterwards waits at the barrier for any settlement in flight and then sees the slot free.

When another worker holds the lock, settlement is refused. That worker passed its check, so it either released the slot (the existing turn and slot guard already makes settlement change nothing) or saw no slot; refusing keeps a lost worker from changing anything under a running supervisor.

A refusal comes before any write, so settlement retries it every 500 ms for up to 20 s (`SETTLEMENT_FENCE_RETRY_MS`, inside the session worker's 30 s shutdown wait). A replacement that took the lock and then refused to start, for example on this worker's own `host` slot, releases it within that time, and the retried settlement then releases the slot instead of leaving a record no start can confirm. Past the bound the settlement gives up and the slot keeps its record. The retry matches the typed `SupervisorLockLostError`, not a message.

Claims, records and the lane claim require this worker to hold the lock, because they start work outside the worker.

### D3. The startup interruption sweep is fenced too

`interruptRunningSessions` reads running sessions without a slot, then interrupts each in its own transaction. If the worker lost its lock between them, a replacement could interrupt, requeue and claim one of those sessions, and the old sweep would then interrupt the replacement's turn. Each interruption transaction therefore starts with the ownership fence, then locks the job, attempt and session rows in the usual order and interrupts only while the session's turn count is the one it read and it still holds no slot.

### D4. The fence is passed explicitly

- `lockAgentSupervisor` and `acquireAgentSupervisor` return `{ owner, fence }`. Both workers keep `owner` as before.
- `SessionRunnerDeps.fence` carries it into the claim, `recordChild` and settlement. It is optional so tests that run turns without a supervisor keep working; the session worker always passes it.
- `executeProcessingCommand` and `claimProcessingCommand` take an optional fence. The `/1` worker passes it. The media and research workers have no supervisor lock and pass none, so their lane claims are unchanged.

Rejected: putting the fence on `ProcessingConfig`. The config is a static scope read from the environment, and the fence is a runtime identity of one connection.

## State, authority and failure behavior

- **Authority.** Only the lock's holder can claim, record or claim the lane. Settlement needs no other holder. The startup check already runs on the lock's connection and is not fenced again.
- **Refusal.** A refused write throws `agent_supervisor_lock_lost` inside its transaction, which rolls back. The session stays queued (claim), the slot keeps its previous record and the driver starts nothing (record), the attempt stays queued (lane claim), or the session keeps its state and slot (settlement), for the next start to decide.
- **Deadlock.** Fenced transactions take the shared fence first. The barrier transaction takes nothing else. PostgreSQL's deadlock detector reorders a shared request queued behind the barrier when needed.
- **Bounded wait.** The barrier waits at most 30 s. A start refused with `agent_supervisor_writes_in_flight` releases its lock; restarting the worker retries.
- **Cost.** One shared advisory lock and one `pg_locks` read per fenced transaction. Claims retry every `SLOT_WAIT_MS` while waiting for a slot, so the read repeats at that rate.
- **Logs.** `agent_supervisor_writes_in_flight` joins the safe stop codes of both workers.
- **Compatibility.** No schema change, so the exact-schema check does not separate this build from the previous one. An older worker's writes take no fence, so a new worker's barrier can't wait for them: stop every old worker of an actor before starting this build, as the deployment guide says for any rollout. The lock still admits one worker at a time.

## Verification strategy

| Check | Boundary it establishes |
| --- | --- |
| Unit: `fencePermits` for ownership and settlement with this holder, another holder, a reused PID and no holder | The decision. |
| PG: A loses its lock, B acquires; A's session claim is refused, the session stays queued and no driver runs | Claim fence, real `pg_locks` and runtime role. Fails on today's code (the claim commits and the driver runs). |
| PG: during B's check (inside the VM confirmation), A records a VM command for its `none` slot; the record is refused and B releases the slot and starts | Record fence. Fails today: the record commits and B refuses with `held_capacity_changed`. |
| PG: A loses its lock, B acquires with the lane free; A's `/1` claim is refused and the lane stays free | Lane fence. Fails today: the lane is claimed after B's check. |
| PG: A's claim transaction passes the fence, A loses its lock, B's acquire waits until A commits, then B's check releases the claimed slot | Barrier ordering. Fails today: B's check finishes first and the slot stays held. |
| PG: a fenced transaction held open past a short bound makes B refuse with `agent_supervisor_writes_in_flight` and leaves the lock free | Bounded barrier. |
| PG: A settles after losing its lock: refused while B holds the lock, committed while no one does, and committed on retry once B releases the lock | Settlement rule and retry. |
| PG: the production claim blocks on a row lock after its fence; A loses its lock; B's barrier waits on that claim; B's check then sees the committed claim | Barrier ordering through the real claim transaction. |
| PG: a barrier blocked for longer than the pool's 5 s statement timeout still succeeds | The barrier's own timeouts. |
| PG: A's interruption sweep after B took the lock is refused | Sweep fence. |
| Existing `tests/held-capacity.test.ts`, `tests/pg/held-capacity.test.ts`, `tests/pg/agents.test.ts`, `tests/pg/session-slots.test.ts`, `tests/process/stale-slots.test.ts` and the session process tests | No change to the check, claims and worker start. |

Limits: the tests drive two supervisors' connections in one process against real PostgreSQL. A real network partition, where the server keeps the old session alive until TCP times out, is not simulated: until then the old worker still holds the lock and its writes are legitimately permitted.

## Migration, rollout and recovery

- No migration. Stop every worker of the previous build before starting this one (`tooling/deployment/README.md`); an old worker's writes are not fenced.
- Rollback: the previous build, with the race back.
- A start refused with `agent_supervisor_writes_in_flight` means a transaction of a lost worker stayed open for 30 s. Find it in `pg_stat_activity`; restarting the worker once it ends is enough.

## Risks and open decisions

- `pg_locks` reads take the lock manager's partition locks briefly. Accepted: one read per fenced transaction at the existing claim rate.
- None open.
