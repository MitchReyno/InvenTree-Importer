# Change proposal

## Problem and intended outcome

On 2026-11-25 `pnpm dev` refused to start with `agent_reap_confirmation_required`. Slot 1 was still held by a Codex `shared-vm-agent/3` turn whose `pnpm dev` had been stopped mid-turn, although nothing of that turn was left in the VM or on the host. There was no command to confirm the reap, so the slot was released by hand with the same update `releaseSessionSlot` makes. Mitch asked for this to be handled automatically from now on, on shutdown, on startup or both.

The outcome:

- A worker that is asked to stop settles each in-flight turn through the normal path when its child's reap is confirmed within a bounded wait, so the slot is released and the session interrupted. Only an unconfirmed reap keeps the slot.
- A worker that starts with held capacity checks each held slot itself. It releases a slot only once it has confirmed the turn's child is gone, and lets the existing startup recovery mark the session interrupted. When it cannot confirm, it refuses as today and says which attempt and why.
- An operator command runs the same check without starting the app and prints what it found.

It never releases a slot on a guess, and it never stops a process at startup.

## Change identity and linked items

Canonical change name: `recover-stale-agent-slots`. Branch `fix/recover-stale-agent-slots`; subjects `type(recover-stale-agent-slots): …`.

Linked item: BI-024 in [the functionality index](../../../docs/PLANNED_FUNCTIONALITY.md). No existing change covers this: `improve-agent-interaction` and `agent-stage-inputs-outputs` only refer to the fence as it is (`agent-stage-inputs-outputs` design, Crash after a decision is acknowledged).

## Current behavior and evidence

- **The fence.** `acquireAgentSupervisor` (`intake-server/src/agents/worker.ts`) takes the per-actor advisory lock and then refuses while any `processing_lane` or `agent_slot` row holds an attempt. Both workers call it before anything else (`session/session-worker-main.ts`, `worker-main.ts`).
- **Startup recovery after a release.** `interruptRunningSessions` (`session/session-runner.ts`) marks `running` and `cancelling` sessions `interrupted`, records `agent_worker_interrupted`, revokes the capability and publishes. It assumes the fence already cleared their slots.
- **Shutdown.** On SIGTERM or SIGINT the session worker aborts its signal, and `runSessionTurn` aborts the turn. For a VM tool turn the coordinator destroys the turn connection and then waits up to 45 s for a removal proof: a probe on a new paired connection (`inspectTerminal` with `requireReap`), which the guest answers `worker_removed` only once the VM launcher (`tooling/deployment/bridge/tool-turn.sh`) has removed the worker container and written the `.reaped` receipt for the exact command digest. Without the proof the turn throws `ResearchReapPendingError` and keeps its slot (`shared-vm/coordinator.ts`, `session-runner.ts`).
- **Why the slot stayed held (inferred from the code; the original logs were not kept).**
  1. The proof needs the relay's next connection: each relay serves one connection at a time and reconnects only after its turn's guest exits (`relay.mjs`). `pnpm dev` stops every owned child at once, relays and tunnel included (`tooling/dev.cjs` `shutdown`, `tooling/dev/process.cjs` `stop`). On SIGTERM a relay breaks its loop instead of reconnecting, so no probe connection ever arrives. If the relay's close reaches the coordinator before the worker's own signal, the turn isn't treated as cancelled at all, and the shorter journal probe fails the same way.
  2. The worker's `finally` gives DBOS 10 s (`workflowCompletionTimeoutMS: 10000`) and then closes the bridge, tool server and database under any turn still waiting for its proof, which can take up to 45 s.
- **No child identity.** Nothing records what a held slot's turn started. The exact VM command the probe needs includes the turn's opening text, which is not stored, so a restarted worker cannot ask the guest about it. Host-native turns record no process group.
- **Specs.** `processing-agent-sessions` "Cancellation and recovery" keeps an unconfirmed reap's slot. `shared-vm-execution` "Fenced execution lifecycle" says missing termination evidence keeps the interruption workflow. `development-launcher` "Launcher stops what it started" stops relays and tunnel with the other owned processes.

## Scope and non-goals

In scope:

- Session worker shutdown waits, within a bound, for in-flight turns to settle before it tears down DBOS, the bridge, the tool server and the database.
- `pnpm dev` stops the application processes first and the VM tunnel and relays only after they have exited. The packaged coordinator gets a stop grace period that covers the same wait, and the deployment guide says to stop it before the relays.
- A migration recording, on each held slot, the turn number and what the turn started: nothing outside the worker, a host process, or a VM turn with its exact command.
- Startup verification of held slots and the lane in both workers, releasing only confirmed ones exactly as `releaseSessionSlot` does, under the existing per-actor advisory lock, with a log line for each refused attempt.
- `pnpm agents:reap`, which runs the same check for the configured development database and prints the outcome.
- Docs: `intake-server/src/agents/ARCHITECTURE.md`, `docs/agent-sessions.md`, `docs/development.md` and the deployment guide.

Non-goals:

- Startup never stops or kills a process it finds alive. It only confirms absence.
- Host-native children (`native-agent/1` lane, `native-agent/2` slots) are not verified: no process group is recorded, and those profiles are expected to be removed. Their held capacity keeps refusing as today, with a clear reason.
- No guest protocol or image change. The existing removal probe is reused.
- No UI change, and no change to cancellation, turn deadlines or the 45 s cancel-time proof wait.

## Reuse and dependency assessment

This is policy over the repository's own lock, slot and paired guest protocol, so no external package is relevant: the guarantees (an exact command digest, a launcher receipt written only after `docker rm -f` succeeded, the advisory lock) live in this code and the VM launcher.

| Option | Goal fit and strengths | Limitations, risks and adoption cost | Evidence (checked 2026-11-25) | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| Reuse the guest's `inspectTerminal` + `requireReap` probe with the turn's command recorded on the slot | Same proof cancellation already relies on. No guest or image change, so no `pnpm vm:setup` refresh | Stores the turn's command text on the slot row while it is held; a turn whose guest never journalled can't be confirmed | `guest-turn.ts` probe branch, `tool-turn.sh` cleanup, `coordinator.ts` `probeTerminal` | Startup probe over the real relay is exercised with a paired fake guest only |
| New guest probe keyed by lineage, attempt and turn | Needs no stored command | Changes the paired protocol and the runner image; old guests can't answer; deploy order constraints | `shared-vm-execution` deploy-together rule in the agents architecture | Not pursued |
| Docker labels on turn containers and a host-side `docker ps` | Finds live containers directly | Containers are named by relay run ID, not attempt; the host has no engine access by design | `tool-turn.sh` names `bench-tool-$run_id` | Not pursued |
| Record host process groups | Would cover native profiles | Threads a recorder through four adapter spawn sites; native profiles are expected to go | `agents/child.ts`; BI-010 (native hardening) is Blocked | Left as an open item |

Recommendation: the first option. It reuses an existing, already-qualified proof, keeps the guest unchanged and needs only a small migration.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `processing-agent-sessions`: adds "Shutdown settles in-flight turns", "Startup confirms held capacity before releasing it" and "Unconfirmed held capacity keeps refusing". "Cancellation and recovery" itself is unchanged, since `agent-stage-inputs-outputs` has a pending modification of it.
- `development-launcher`: modifies "Launcher stops what it started" (application processes stop before the relays and tunnel) and adds "Operator reap check".

## Impact and dependencies

- `intake-server`: migration `0039`, `agents/worker.ts`, a new recovery module, `session/slots.ts`, `session/session-runner.ts`, `session/session-worker-main.ts`, `worker-main.ts`, `shared-vm/coordinator.ts`, schema and catalogue tests.
- Root tooling: `tooling/dev.cjs`, `tooling/dev/session.cjs` or `process.cjs`, root `package.json` script, deployment compose file and README.
- Exact-schema compatibility: the API and both agent workers refuse, when they start, a database whose migrations differ from theirs, so this build and its migration go out together, as every migration does. Another branch (`feat/agent-stage-inputs-outputs-briefs`) also numbers its migration `0039`; whichever merges second renumbers.
- No external prerequisites.

## Open decisions and assumptions

- Assumption: holding the per-actor advisory lock means no earlier worker is still running turns in process, as `interruptRunningSessions` already assumes. A turn that started nothing outside its worker is therefore gone once the lock is held.
- Assumption: a bounded wait of 30 s on shutdown, inside `pnpm dev`'s 45 s stop grace, covers a normal removal proof (relay reconnect plus the guest's 12 s receipt wait). Longer cases fall back to the startup check.
- Open: host-native process-group recording, if native profiles stay.
