# Design assessment

## Context and grounding

The change spans three owners:

- **The agent workers** (`intake-server/src/agents/session/session-worker-main.ts`, `agents/worker-main.ts`) and their fence (`agents/worker.ts`). The fence takes the per-actor advisory lock (`agent-supervisor:<actor>`) and refuses while any slot or the lane is held.
- **The session runner and drivers** (`session/session-runner.ts`, `shared-vm/coordinator.ts`). The runner claims a slot, runs the driver and releases the slot only on settlement. The VM driver's cancellation waits for the guest's removal proof (`inspectTerminal` with `requireReap`), which the guest gives only after the VM launcher has removed the worker container and written `<lineage>/<attempt>-<turn>.reaped` holding the exact command's digest (`shared-vm/guest-turn.ts`, `tooling/deployment/bridge/tool-turn.sh`).
- **The development launcher** (`tooling/dev.cjs`, `tooling/dev/process.cjs`, `tooling/dev/session.cjs`), which starts and stops the tunnel, relays and app processes.

Complexity: moderate. One small migration, a startup recovery step reusing an existing proof, a shutdown wait and a launcher ordering change.

## Goals and constraints

Goals come from the [proposal](proposal.md) and the deltas in [processing-agent-sessions](specs/processing-agent-sessions/spec.md) and [development-launcher](specs/development-launcher/spec.md).

Constraints:

- Never release on a guess. An unconfirmed reap keeps the slot, as `processing-agent-sessions` "Cancellation and recovery" and `shared-vm-execution` "Fenced execution lifecycle" require.
- Keep the per-actor advisory lock: a second worker still refuses with `agent_supervisor_already_running` before checking anything.
- No guest protocol or runner image change, so the paired guest needs no refresh.
- Exact-schema compatibility: the migration ships with the build that uses it.

## Decisions and alternatives

### D1. Root cause: the proof needed relays that were already stopping, and the worker stopped waiting

Two defects combined (see the proposal's evidence):

1. `pnpm dev` signals every owned child at once. A relay serves one connection at a time and only reconnects after its turn's guest exits, and on SIGTERM it breaks its loop instead. The coordinator's removal probe needs that next connection, so it can never arrive.
2. The session worker's `finally` gives DBOS 10 s and then closes the bridge, the tool server and the pool, while a cancelled VM turn may wait up to 45 s for its proof.

Fixes:

- **Launcher order.** `shutdown()` signals only the application processes; the VM tunnel and relays are stopped after the application processes have exited. `stopInOrder` (`tooling/dev/process.cjs`) stops the two groups one after the other, each within the existing grace, and `finishOwnedRun` still forces every child down when a group outlives it. Reloads already keep the VM children.
- **Worker wait.** The session worker tracks each turn its workflows run. On shutdown it aborts them as today, then waits up to `SHUTDOWN_TURN_SETTLE_MS` (30 s) for them to settle before closing anything. 30 s sits inside the launcher's 45 s stop grace with room for DBOS's own shutdown. A turn still unsettled after the wait keeps its slot and is left to the startup check. Closing the bridge also ends any wait for a removal proof, so an unconfirmed turn doesn't keep the process alive for the rest of the coordinator's 45 s.
- **Deployment.** The packaged coordinator service gets `stop_grace_period: 60s`, and the deployment guide says to stop the coordinator before the relays.

Rejected: lengthening only DBOS's `workflowCompletionTimeoutMS`. DBOS's timeout bounds its own wait, but the worker would still close the bridge and pool in the order it does now, and nothing would keep the relays up.

### D2. Record what each held slot's turn started, on the slot row

Migration `0039_agent_slot_turn_child.sql` adds to `agent_slot`:

| Column | Meaning |
| --- | --- |
| `turn` | The turn number the claim started (`turn_count` after the claim). |
| `turn_child` | `none` (nothing outside the worker yet), `host` (a host process may have started) or `vm` (a VM command may have been dispatched). |
| `vm_command` | For `vm`, the exact command JSON sent to the guest. |

Checks keep all three null while the slot is free and `vm_command` set only for `vm`. `releaseSessionSlot` clears them with the attempt, so the record lives exactly as long as the occupancy and needs no new grants: the runner role already updates `agent_slot`.

Ordering is intent before effect:

- The claim transaction that takes the slot sets `turn` and `turn_child='none'`, so every slot this build claims has a record.
- A driver that is about to start something outside the worker records it first, in its own committed write, through a new `recordChild` callback on the driver context: the native driver records `host` before it starts a provider process, and the VM driver records `vm` with the command just before sending it. A failed record stops the turn before the effect. Drivers that start nothing (the in-process synthetic driver, test drivers) record nothing.
- A slot claimed before this migration has a null `turn_child` and is unverifiable.

The stored command is what the coordinator already sends to the guest: the sealed manifest, instructions, opening text, tool names and protected hosts. It carries no capability, key or credential; the capability stays on the host. It is kept only while the slot is held.

Rejected:

- A separate child table: its lifetime would have to be kept in step with the slot by hand, and it needs new grants.
- Storing only the command digest: the guest's probe validates and digests the full command itself, so a digest alone cannot ask it.
- A guest probe keyed by identity alone: a protocol and image change for every guest, with deploy-order constraints.

### D3. Startup check, then the existing interruption

Both workers start the same way:

1. Take the advisory lock, as today. Failure is still `agent_supervisor_already_running`.
2. The session worker starts its VM bridge, if configured, as it already does before recovery.
3. `recoverHeldCapacity` reads each held slot and the lane, decides each, and releases the confirmed slots.
4. If anything is still held, it logs one `agent_reap_unconfirmed` line per attempt and the worker refuses with `agent_reap_confirmation_required`.
5. The session worker then runs `interruptRunningSessions` as today.

The decision is a pure function of the slot record and, for a VM record, the guest's answer:

| Held capacity | Decision |
| --- | --- |
| Slot, `turn_child='none'` | Release: nothing started outside a worker that no longer holds the lock (`no_child`). |
| Slot, `turn_child='vm'`, guest answers `worker_removed` for the stored command | Release (`vm_worker_removed`). |
| Slot, `turn_child='vm'`, no bridge in this worker | Keep (`vm_bridge_unavailable`). |
| Slot, `turn_child='vm'`, no proof within `STARTUP_REAP_CHECK_MS` (20 s), unreachable guest or a probe error | Keep (`vm_reap_unconfirmed`). |
| Slot, `turn_child='host'` | Keep (`host_child_unverifiable`). |
| Slot claimed before turns were recorded (`turn_child` null) | Keep (`turn_child_unrecorded`). |
| Lane | Keep (`lane_child_unverifiable`): the lane's holders record nothing. |

VM checks for different slots run at once, each with its own bound. The bridge gains `confirmReaped(command, signal)`, which picks an idle peer of the command's route that offers both the terminal probe and the reap proof, the same filter cancellation uses, and sends the existing `{inspectTerminal, requireReap: true}` probe. Only a `worker_removed` answer counts.

A release takes the actor's slot-claim lock (`agent-slots:<actor>`, the lock `claimSessionSlot` takes), checks the slot still holds the same attempt and turn it decided on, and calls `releaseSessionSlot`. The session itself is left to `interruptRunningSessions`, which records `agent_worker_interrupted`, revokes the capability and publishes, exactly as after the manual release.

Rejected: stopping a live orphan at startup. Turn containers are named by relay run ID, not attempt, and the host has no engine access, so the worker could not target one safely. The design only confirms absence.

### D4. Host-native children stay unverifiable

The native driver records `host` but no process group, so its slots keep refusing as today, now with a reason. Recording process groups would mean threading a recorder through each adapter's spawn site (`agents/child.ts` callers) for profiles that are expected to be removed. It is an open item.

### D5. `pnpm agents:reap` reuses the launcher

`pnpm agents:reap` runs `tooling/dev.cjs --reap-agents`. It takes the development supervisor lock (refusing while `pnpm dev` runs), prepares the database and VM side exactly as `pnpm dev` does, skips the media decoder image build, and starts only the configured agent worker with `INTAKE_AGENT_RECOVER_ONLY=1`. In that mode the worker takes the advisory lock, starts its bridge, runs `recoverHeldCapacity`, logs a `held_capacity_released` line for each release and `agent_reap_unconfirmed` for each kept slot or lane, and exits: 0 with a `held_capacity_checked` line when nothing remains held, 1 with `agent_reap_confirmation_required` otherwise. It doesn't interrupt sessions; the next worker start does. The launcher then stops what it started, VM included when it booted it.

Rejected: a standalone script with its own database and VM configuration. It would duplicate the launcher's environment resolution and could not reach the guest without starting the relays anyway.

## State, authority and failure behavior

```text
claim (txn)   slot.attempt=A, turn=N, turn_child='none'
driver        recordChild(host|vm+command)  -- committed before the process or send
settle (txn)  session state, capability revoked, slot cleared (all columns)
unconfirmed   slot kept with its record
next start    lock -> bridge -> decide each held slot -> release confirmed -> interruptRunningSessions
```

- **Authority.** Only the worker holding the actor's supervisor lock checks or releases. The release compares attempt and turn under the slot-claim lock, so it can't clear a slot that changed.
- **Uncertainty.** Every unknown keeps the slot: an unrecorded child, a host process, no bridge, no peer, a probe error or a non-`worker_removed` answer. A probe never creates a journal or runs a turn (`journal.ts`).
- **A turn whose guest never journalled** (dispatch interrupted before the guest's journal) has no receipt, so it can't be confirmed and keeps refusing. The log names it.
- **Logs.** Lines carry the attempt ID, whether it holds a slot or the lane, and a fixed reason code; no command text, path or provider data.
- **Compatibility.** An older worker against the new schema is refused by exact-schema compatibility. Slots claimed by an older build read as `turn_child_unrecorded`.

## Verification strategy

| Check | Boundary it establishes |
| --- | --- |
| Unit: the decision table | Each record and guest answer maps to release or keep with the stated reason. |
| Unit (tooling): the launcher stops application processes before the VM group, and forces both down after a timeout | Shutdown order and the existing forced stop. |
| PG: claim records `turn` and `none`; a driver's `recordChild` records `vm` with the command; settlement clears all columns; the migration's checks refuse a record on a free slot | The record's lifecycle and constraints in real PostgreSQL. |
| PG: `recoverHeldCapacity` with a fake VM confirmation releases `none` and confirmed `vm` slots, then `interruptRunningSessions` leaves the session `interrupted` with `agent_worker_interrupted`; keeps `host`, unrecorded, unconfirmed `vm` and the lane with reasons; a slot that changed after the decision is not released | Release and refusal at the real tables, lock and grants (runner role). |
| Process: a session worker on `shared-vm-agent/3` with a paired fake guest; SIGTERM mid-turn; the guest answers the removal probe after 12 s | Shutdown waits past DBOS's 10 s and releases through settlement. Fails before the fix. |
| Process: SIGTERM with no proof; the worker exits holding the slot; recover-only mode with the fake guest answering releases it; the next start serves with the session interrupted | Bounded shutdown, the startup check and the operator mode over real TLS. |
| Schema catalogue and grant tests | The migration matches `schema.ts`. |

Limits: the fake guest speaks the real paired protocol over TLS but is not the VM launcher, so the receipt's write order is covered by the existing `tool-turn.sh` tests, not this change. `pnpm agents:reap` end to end needs a real VM and is not run; its pieces (worker recover-only mode, launcher argument and phases) are tested.

## Migration, rollout and recovery

- Migration `0039` only adds nullable columns and checks; existing held rows keep null records and stay refused until released by settlement or by hand.
- Rollout: deploy the build with its migration, as for any migration. The guest is unchanged.
- Rollback: an older build refuses the migrated database (exact-schema compatibility), which needs the usual backup restore, as for any migration.
- If a slot is still refused after the startup check, the log names the attempt and the reason. Inspect the guest's journal and receipt for that attempt; the manual release remains `releaseSessionSlot`'s update.

## Risks and open decisions

- A guest that wrote no journal for a dispatched command can never be confirmed. Mitigation: the log line, and the manual inspection already documented.
- The stored command duplicates sealed data for the life of the occupancy. Accepted: it holds no secret and is cleared on release.
- Open: record host process groups if native profiles stay (D4).
