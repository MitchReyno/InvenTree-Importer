# Design assessment

## Context and grounding

Four owners meet at a VM turn: the relay (`tooling/deployment/bridge/relay.mjs`) moves bytes between the coordinator and one guest per lane; the coordinator (`intake-server/src/agents/shared-vm/coordinator.ts`) admits guest connections and runs each turn's driver; the session runner (`session/session-runner.ts`) claims a slot (`session/slots.ts`), calls the driver and settles; the guest (`guest-main.ts`, `guest-turn.ts`, `tool-turn.sh`) runs the turn's containers. The proposal's evidence shows three faults that compound in a small VM: nothing bounds turns by the VM's memory, all claimed turns cold-start at once, and each relay keeps a launched three-container turn idle. A fourth turns the resulting admission timeout into a permanent `provider_network` failure.

Complexity: moderate to high. One migration, one runner image change, a relay/coordinator protocol change and a setup step; no new dependency.

## Goals and constraints

- The deltas in [shared-vm-execution](specs/shared-vm-execution/spec.md) and [processing-agent-sessions](specs/processing-agent-sessions/spec.md).
- Keep #298's guarantees: the claim marker and the unclaimed-lane delay, bounded guest teardown, the requeue's settlement under the fence, `agent_vm_unavailable` for an absent relay, and older relays and images working.
- Keep the held-capacity check (#281) and the fence (#286) correct, including probes that now need a lane started on demand.
- One source of truth for the cap.

## Decisions and alternatives

### D1. The cap: the guest reports memory, the coordinator computes, the slot claim applies

`guest-main.ts` reads `MemTotal` from `/proc/meminfo` (`guest-memory.ts`) and `serveGuestTurn` sends it as `memoryBytes` in its greeting. The paired supervisor reads it; the provider runs in another container and can't touch the greeting, and the kernel's `MemTotal` inside a container is the VM's, not the container's limit. The coordinator keeps the latest valid report (an integer between 256 MiB and 1 TiB; anything else is ignored) and exposes `turnCapacity()`, computed by `vmTurnCapacity` in `turn-capacity.ts`:

`capacity = max(1, floor((memory − 768 MiB) / 960 MiB))`

- `ALWAYS_ON_MIB = 768`: Docker and containerd, the Claude egress, management and catalogue containers, the Codex egress and management containers and the kernel's own use (an estimated 0.5–0.8 GB).
- `TURN_MIB = 960`: a tool turn's container ceilings (640 MiB worker, 256 MiB supervisor, 64 MiB tunnel). A plain `/1` turn (384 MiB) is counted the same, conservatively.
- Before any report, and for a guest that reports none (an older image), the capacity is 1.

A 2 GiB VM (`MemTotal` about 1878 MiB) holds 1 turn, a 4 GiB VM (about 3930 MiB) 3.

The session worker passes `bridge.turnCapacity` into the runner's dependencies, and `claimSessionSlot` takes the smaller of Sessions at once and that capacity as its limit. The claim is where Sessions at once already applies, under the actor's slot lock, so a session past the cap stays queued with no slot, no requeue churn and no failure; its workflow's 30 s slot wait and the wake sweep retry it as for a full limit. The coordinator logs `vm_turn_capacity` with the memory and turns when the capacity changes.

Alternatives: a configured per-installation cap (a second value to keep in step with Lima, wrong after a resize), and a cap in the coordinator that requeues (sessions claim and release slots every minute, each holding one for up to 45 s). Both rejected. Reading the size from `limactl list` on the host was rejected too: the packaged deployment's worker has no `limactl`, and the guest's `MemTotal` is what the turns actually share.

### D2. One start at a time: a gate in the coordinator

`startup-gate.ts` is a FIFO gate the driver takes before it asks for a connection. It is released when the guest first reports the turn admitted (a `provider`, `sentEffort` or synthetic `started` frame), when the turn ends, or after `STARTUP_HOLD_MS` (120 s: the 45 s connection wait, the 45 s admission and margin), whichever is first. MCP and progress frames arrive during admission and don't release it. A turn that waits longer than `STARTUP_GATE_WAIT_MS` (180 s) throws `SessionCapacityUnavailable` and is requeued unchanged by #298's path. Cancellation aborts the wait. The coordinator serves one agent VM, so the gate is per VM. Terminal probes don't take it: they are rare, short and must answer within their own bounds.

Admitted turns run in parallel as before. The gate also covers the guest's container start (D3), so the containers and the CLI of one turn start before the next's.

### D3. Lanes on demand

A lane connects to the coordinator and writes `bench-lane/1 <claude|codex|none> <tools|plain>\n`, then waits. The coordinator now listens with a plain TCP server: a connection whose first byte is `0x16` (a TLS handshake record) is handed to the TLS server unchanged, which is how an older relay's connections and every status and catalogue connection arrive. Anything else must be a valid offer line within 64 bytes and 5 s, or it is closed. `lane-offers.ts` keeps open offers by route.

The coordinator asks for a guest by writing `go\n` on an offer, then hands the socket to the TLS server; the relay starts its guest on that connection, whose greeting is admitted as before. A route's waiters (turn drivers and probes) register with the offers; on each 100 ms tick the coordinator asks one more offer of the route only while the route's starting connections are fewer than its waiters with no idle connection, so a probe that polls doesn't launch a guest per tick. A connection the coordinator asked for that sits idle for `LAUNCHED_IDLE_MS` (30 s) is closed, so a guest started for a waiter that gave up doesn't stay. A route with an open offer counts as connected, so a full relay still gives the requeue and a missing one `agent_vm_unavailable`.

The relay opens its next offer when `go` arrives, not on the guest's claim marker: an offer costs no containers. The marker is still read, kept out of the log, and decides the unclaimed-lane delay (500 ms). Capacity (`INTAKE_VM_RELAY_TURNS`) bounds offers plus launched lanes.

Security: the offer line is unauthenticated, on the coordinator's loopback port. A local process could hold offers, which only makes the coordinator start a TLS handshake that still needs the paired guest identity; its worst effect is a turn that waits and is requeued, like holding the port's connections open today. Offers are capped at 8.

Compatibility: an older relay launches guests at once and speaks TLS first, so it is served as before (with its idle ready lane). A new relay against an older coordinator fails the handshake and retries every 500 ms, so they deploy together, as `pnpm dev` does.

Startup reap check: a held slot's proof now needs a cold lane, which starts three containers. `STARTUP_REAP_CHECK_MS` rises from 20 s to 45 s, the tool lane's own connection wait, and held turns are asked about one at a time. A waiter that leaves stops any starting guest of its route that no remaining waiter needs. The journal probe after a lost connection gets 45 s instead of 15 s. A guest that closes before greeting holds back every route's next start for 30 s (a time bound; the relay reports no teardown), and a turn whose wait ends with its route's started guests failed or still starting, none admitted and none busy, fails as `agent_vm_unavailable`. `pnpm dev` waits up to 390 s for the worker's ready line, which follows the serial checks.

Alternatives: a ready lane that starts only the paired supervisor (still an idle container per relay, and a reordered `tool-turn.sh`), and closing ready lanes after an idle bound (an absent relay then reads as `agent_vm_unavailable`). Rejected.

### D4. Admission timeouts requeue as new turns, then fail accurately

Claude's `ADMISSION_TIMEOUT_MS` becomes 45 s (Codex's start has no such deadline): with starts serialized, a slow start no longer delays other starts' admission, and a Pi under load needs more than 15 s for the CLI and MCP connect. The admission precedes any user text, so no inference has run.

The runner recognises the timeout by `failureCauseCode(error) === 'agent_admission_timeout'` (the guest's cause, or a host adapter's own code). Unless the turn was cancelled, interrupted or expired, it settles as a startup timeout: under the same fenced settlement, the session goes `queued` at the back of the queue, keeps the counted turn (the guest journalled it, so the same turn number would replay its outcome), its capability and slot are released, the `agent_session_resume` row is kept, nothing is acknowledged and no diagnostic is retained. `agent_session.startup_timeouts` (migration `0048`) counts consecutive ones; at `MAX_STARTUP_RETRIES` (2) the next one fails the session with `agent_admission_timeout` itself, and every other settlement resets the count to 0. The code gets its own description: summary "The provider CLI didn't start in time." and recovery "The agent VM may be short of memory or CPU. Lower Sessions at once or give the VM more memory, then run the step again." A turn count above 0 with no provider session means a republished identity reaches the session as an inbox notice, as for any session that has run.

Alternatives: restoring the turn count as a capacity miss does (the journal replays the failure), and counting in worker memory (lost on restart). Rejected.

### D5. VM sizes

`lima/agent.yaml` becomes `cpus: 4`, `memory: 4GiB`. A new setup step, "VM size", reads the template's CPUs and memory and the VM's (`limactl list --format '{{.Name}} {{.Status}} {{.CPUs}} {{.Memory}}'`). A stopped VM that differs is resized with `limactl edit --tty=false --cpus=N --memory=M <name>` before the VM step starts it; a running one is left running, with a line saying to stop `pnpm dev`, run `limactl stop <name>` and run setup again. A new VM is created from the template at its size. `pnpm dev` doesn't resize: it never stops a running VM.

The deployment README's sizing table: Mac dev 4 CPUs / 4 GiB (3 turns); Pi 5 8 GB with the VM at 3 CPUs / 4 GiB (3 turns), leaving about 4 GB and one core for InvenTree, PostgreSQL, the intake server and the media decoder; a 4 GB Pi runs no parallel VM agents (a 2 GiB VM holds one turn).

## State, authority and failure behavior

- **Slot and fence.** The cap only refuses claims; settlement, release and the held-capacity check are unchanged. A startup-timeout requeue is a fenced settlement like every other.
- **Cancellation.** The gate wait and the connection wait both abort on the turn's signal; a cancelled turn settles as cancelled.
- **Shutdown.** Closing the bridge closes offers and ends gate and connection waits.
- **Guest teardown.** Unchanged once a guest starts: the relay's overdue removal and bounds still apply.

## Verification strategy

| Outcome | Check | Boundary |
| --- | --- | --- |
| A turn past the cap stays queued (RED on trunk: both run) | Process test, real relay and coordinator, fake guest reporting 2 GiB, limit 2 | Greeting, capacity, slot claim end to end |
| Starts are serialized (RED: second command before first admitted) | Process test, fake guest with a start delay, 8 GiB | Gate in the real coordinator |
| An idle relay starts no guest (RED: one launched) | Process test and relay tooling test | Lane offers |
| An admission timeout requeues, then fails accurately (RED: `failed`, `provider_network`) | PG test with a driver reporting the guest's cause | Runner settlement, migration, counter |
| Capacity math, memory parsing, gate rules, offer parsing | Unit tests | Pure policy |
| Resize step | `dev-vm-setup` tooling test with a stand-in `limactl` | Setup flow |

Not exercised: the real Lima VM, real containers' memory and a Pi.

## Migration, rollout and recovery

Migration `0048` adds `agent_session.startup_timeouts integer NOT NULL DEFAULT 0` and the runner's update grant. Deploy the coordinator, relay and runner image together; managed `pnpm dev` refreshes the image. Mitch stops `pnpm dev`, runs `limactl stop bench-agent-m1-local`, runs `pnpm vm:setup` to resize to 4/4 GiB and restarts `pnpm dev`. Rollback: the previous relay still works against the new coordinator (TLS first); the previous coordinator refuses the new relay's offers.

## Risks and open decisions

- The 768 MiB allowance is an estimate; if the always-on services grow, the cap may be one too high. It is a named constant, documented in the README.
- The effective cap isn't shown in Settings (open item).
