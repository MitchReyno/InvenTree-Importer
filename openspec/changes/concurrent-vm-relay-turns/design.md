# Design assessment

## Context and grounding

Three owners meet at a VM turn: the relay (`tooling/deployment/bridge/relay.mjs`) moves TLS bytes between the coordinator and one guest per connection; the coordinator (`intake-server/src/agents/shared-vm/coordinator.ts`) keeps admitted guest connections idle until a turn's driver takes one; the session runner (`session/session-runner.ts`) claims a slot, calls the driver and settles. The proposal's evidence shows the relay is the bottleneck (one turn connection at a time) while the guest, the coordinator's accounting (`MAX_TURN_PEERS = 8`) and the slots (up to 8) already allow more. The second fault is that a capacity shortfall became a permanent `configuration` failure.

Complexity: moderate. No migration, no new dependency, one runner image change and one new contract code.

## Goals and constraints

- [Relays carry concurrent turns](specs/shared-vm-execution/spec.md) and [A turn without a free VM connection goes back to the queue](specs/processing-agent-sessions/spec.md).
- Keep the relay a byte transport: it never reads the TLS stream.
- Keep the status and catalogue connections (`bench-provider-status/1`, `bench-model-catalog/1`) apart from turns, with their own per-provider allowance.
- Keep the turn child record (`0040`) and the settlement fence (#286) correct for a turn that sends nothing.
- Fit the 2 GiB default VM when idle.

## Decisions and alternatives

### D1. Lanes in one relay, one ready connection at a time

The relay runs up to `INTAKE_VM_RELAY_TURNS` lanes (default 8, `MAX_SESSION_SLOTS`). A lane is today's loop body: connect to the coordinator, start a guest, pipe bytes, wait for the guest to exit. The relay keeps exactly one lane *ready* (connected, not yet claimed) while it has fewer lanes than its capacity. When the ready lane's guest reports a claim, that lane becomes busy and the relay starts the next ready lane; when any lane's guest exits, the relay starts a ready lane if none is ready. A lane whose guest exits before it was claimed (a refused or broken connection) is replaced after 500 ms, as a failed coordinator connection is today, so a refusing coordinator can't make the relay spin.

Alternatives rejected (proposal table): all lanes warm (eight idle tool turns per provider, three containers each, in a 2 GiB VM), several relays per provider (their status and catalogue connections exceed the coordinator's allowance of two each and retry forever), and inferring the claim from TLS traffic (unreliable).

Trade-off accepted: a second concurrent turn waits for a fresh guest to start (a few seconds; `tool-turn.sh` starts three containers) instead of finding one warm. The driver's 45 s wait covers a cold start, which is why it is that long.

### D2. The guest reports its claim on standard error

`serveGuestTurn` gains an `onClaimed` callback, run once the first packet (a turn command or a terminal probe) has been read. `guest-main.ts` writes the line `bench-turn-claimed` to its standard error there (`TURN_CLAIMED_MARKER` in `shared-vm/turn-claimed.ts`). For a tool turn the paired supervisor's container runs attached (`docker run --rm -i`), so its standard error reaches `limactl` and the relay; the ordinary path's `docker run -i` does the same. The relay reads each lane's standard error by line, treats an exact marker line as the claim and forwards every other line to its own standard error, as `inherit` did. `relay.mjs` cannot import TypeScript, so it repeats the literal; the process test runs a fake guest that uses the TypeScript constant against the real relay, so a mismatch fails it.

Security: the marker only lets a lane open one more bounded connection. The provider runs in a different container from the paired supervisor and can't write to its standard error; a forged marker could at most open lanes up to the relay's capacity, each of which still needs the paired TLS identity to be admitted.

Compatibility: an older image never prints the marker, so its relay carries one turn at a time (today's behaviour), and D4 keeps the extra sessions queued instead of failing. An older relay with a new image prints the marker into its log, harmlessly.

### D3. Coordinator turn allowance

`MAX_TURN_PEERS` becomes `2 * MAX_SESSION_SLOTS` (16), imported from `session/slots.ts`, and `server.maxConnections` becomes the sum of the turn, status and catalogue allowances (24). Busy turn connections never exceed the slots (8): a cancellation or startup probe takes a connection only while its turn still holds its slot. Ready connections add one per relay. Sixteen leaves room for the two managed relays at full capacity and for a deployment's extra relays. A per-route allowance was considered and not needed: no route can hold more busy connections than there are slots.

### D4. Telling "busy" from "absent" and requeuing

The coordinator records admitted turn connections (those that reached the idle pool) in `admittedTurns`, removed on close. During its wait the driver notes whether any admitted connection of the turn's route existed at any tick. When the wait ends without an idle one:

| Seen a connection for the route during the wait | Route | Outcome |
| --- | --- | --- |
| Yes | any | `SessionCapacityUnavailable` (requeue) |
| No | tool worker | `NativeSessionError('agent_vm_unavailable')` |
| No | subscription, no tools | `NativeSessionError('agent_login_required')` (unchanged) |
| No | general | untyped `paired_guest_unavailable` (unchanged) |

`SessionCapacityUnavailable` lives in `session/session-adapters.ts` beside `SessionResumeUnavailable` and is not a `NativeSessionError`, so it can never be retained as a diagnostic. It is thrown before `recordChild`, so the slot's turn child stays `none`.

The runner treats it as "this turn never happened": settlement (same fenced transaction, same lock order) puts the session back to `queued` with the turn count and `queued_since` it had before the claim, revokes the capability and releases the slot. It skips what only a turn that ran does: deleting the `agent_session_resume` row (a wake's earlier state still applies), acknowledging inbox items, the `settled` progress and `finished_at`. Restoring the turn count matters: a turn count of 0 still means the session never ran, which the pinned-identity check and the wake sweep rely on. Restoring `queued_since` keeps its place in queue order.

The wake sweep then gives it a new workflow. Its ID is keyed by attempt, turn count and minute bucket, and the count is unchanged, so a session requeued twice in one minute waits for the next bucket: at most one capacity wait per session per minute.

Alternative rejected: settling into the existing `waiting_for_capacity` state. The frontend already shows it as queued, but the claim, the wake sweep, pause, cancellation and archive paths all select `queued` only, so every one would need it; the requeue reaches the same visible "Queued" state through the normal path.

Alternative rejected: waiting for capacity without holding a slot. The slot is claimed before the driver can know the route's connections, and moving that check into the claim would put VM knowledge in the slots module. The slot is held for at most the 45 s wait.

### D5. An accurate failure for an absent relay

`agent_vm_unavailable` joins `SESSION_FAILURE_CODES` with the sentence "<Provider>'s agent VM connection wasn't available". Its category is `provider_network`, with a code description that overrides the category text: summary "The agent VM had no connection for this provider." and recovery "Check that the VM and its relays are running (pnpm dev starts them), then run the step again." The session settles `failed`, as before. `agent_process_unavailable` keeps its meaning (a CLI that couldn't be started) for the host and guest adapters.

## State, authority and failure behavior

- **Turn child.** The requeue throws before `recordChild`, so the slot keeps `none`; a worker that stops during the wait leaves a `none` slot, which the next start's held-capacity check releases.
- **Fence.** The requeue is a settlement: `requireSupervisorFence(…, 'settlement')` first, retried as settlements are; a replacement holding the lock refuses it, and its own held-capacity check releases the `none` slot.
- **Cancellation.** A cancelled attempt aborts the driver's wait (`delay` with the turn signal), so the existing cancelled/interrupted path settles it; nothing is sent.
- **Concurrency on the guest.** Each lane's guest uses its own run ID, temporary directory, egress proxy and Unix sockets. Concurrent Claude turns read the store read-only; concurrent Codex turns share the managed home under the shared lock, as host Codex sessions do. Sign-in changes still take the exclusive lock.
- **Shutdown.** SIGTERM to the relay closes every lane's coordinator connection and stops opening lanes; the relay exits once their guests have exited and the status carriers have stopped, as today for one turn. `pnpm dev` already stops the relays after the worker.
- **Resources.** More concurrent turns use more VM memory (each tool turn has ceilings of 640 + 256 + 64 MiB). The session limit is the operator's control; the README's sizing advice stands.

## Verification strategy

| Outcome | Check | Boundary established |
| --- | --- | --- |
| Two overlapping tool turns for one provider both run (RED: second fails `agent_process_unavailable` after 45 s) | Process test: real `relay.mjs`, stand-in `limactl`, paired fake guest that prints the marker, real coordinator and runner, session limit 2 | Relay lanes, marker, coordinator admission and runner end to end, without Lima or Docker |
| Capacity 1: the second turn is requeued and runs later | Same harness with `INTAKE_VM_RELAY_TURNS=1` | Requeue state, slot, turn child, turn count, no diagnostic |
| Ready/claimed/capacity/older-guest/SIGTERM lane rules | Tooling test: relay against a plain TCP fake coordinator and a fake `limactl` | Relay policy alone |
| Busy vs absent classification, admission allowance | Coordinator unit tests with fake guests | Coordinator decision |
| Requeue settlement under a lost fence | PG test beside `supervisor-fence.test.ts` | Fence still applies |
| `onClaimed` after the first packet | Guest-turn unit test | Guest marker |
| Diagnostic text | Contracts and failure-model tests | `agent_vm_unavailable` summary/recovery |

Not exercised: a live run on the real Lima VM with real containers (Mitch will run one after merge), and memory behaviour of several concurrent provider CLIs in the VM.

## Migration, rollout and recovery

No migration. Deploy the coordinator, relay and runner image together, as the README asks for guest changes. Managed `pnpm dev` refreshes the runner image on start, so Mitch restarts `pnpm dev` once. Rollback: the previous relay with the new image prints the marker into its log and carries one turn; the previous coordinator with the new relay refuses turn connections beyond eight, which the relay retries every 500 ms.

## Risks and open decisions

- Memory pressure in the 2 GiB VM with session limits above 2: mitigated by the operator's session limit and the README's sizing advice; not changed here.
- None open.
