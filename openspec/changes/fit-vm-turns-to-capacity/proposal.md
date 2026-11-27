# Change proposal

## Problem and intended outcome

On Mitch's dev Mac (2026-11-27, Sessions at once 2+), 6 of 10 Research and Images sessions on Claude failed 20–80 s in with `agent_turn_failed`, category `provider_network` ("The provider connection or protocol failed."), cause `agent_admission_timeout`, stage `startup`. A read-only check of the Lima VM `bench-agent-m1-local` (2 CPUs, 2 GiB) showed load average 172, 34 MB free of 1969 MB, no swap and the kernel OOM killer killing processes. Four tool turns were up, three containers each, one of them up 41 minutes: the relay's ready connection, launched before any turn claimed it.

The intended outcome, approved by Mitch:

- VM turns never run beyond what the agent VM's memory can hold. Turns past that wait in the queue; they never fail for it.
- One provider CLI starts at a time on the VM, so concurrent turns don't all cold-start together on few CPUs. Turns still run in parallel once started.
- An idle relay holds no guest containers.
- A turn whose CLI admission times out goes back to the queue a bounded number of times, then fails with a diagnostic that says the CLI didn't start in time, not that the connection failed.
- The Mac dev VM defaults to 4 CPUs / 4 GiB, the Pi 5 (8 GB) sizing is documented, and `pnpm vm:setup` can resize an existing VM when that is safe.

## Change identity and linked items

Change name: `fit-vm-turns-to-capacity`. Branch `fix/fit-vm-turns-to-capacity`, subjects `fix(fit-vm-turns-to-capacity): …` (or `feat`/`docs`).

Linked item: [BI-027](../../../docs/PLANNED_FUNCTIONALITY.md#bi-027--fit-vm-agent-turns-to-the-vms-capacity). It follows [BI-026](../../../docs/PLANNED_FUNCTIONALITY.md#bi-026--run-several-vm-turns-per-provider-at-once) (`concurrent-vm-relay-turns`, merged in #298).

## Current behavior and evidence

- `session/slots.ts` `claimSessionSlot` bounds running sessions by Sessions at once (1–8) only. Nothing knows the VM's size.
- `tooling/deployment/bridge/relay.mjs` keeps one *ready* lane per relay: it connects to the coordinator and at once runs `tool-turn.sh`, which starts the egress, tool worker and paired supervisor containers. The guest is the TLS client, so the coordinator can't admit or route a connection before the guest runs. Two relays (Claude and Codex) therefore hold two idle three-container turns, and each claim opens another.
- `coordinator.ts` `driver` takes any idle connection of the route and sends the command at once, so turns started together cold-start together.
- `claude-session-admission.ts` gives the CLI start and MCP connect 15 s (`ADMISSION_TIMEOUT_MS`). In the VM the tool worker reports it as `agent_turn_failed` with cause `agent_admission_timeout`; `failure-model.ts` maps `agent_turn_failed` to `provider_network`, and the runner settles it `failed`.
- The guest journal (`journal.ts`) keys each turn by attempt and turn number; replaying the same command returns its recorded outcome, so a retry must be a new turn.
- `tooling/deployment/lima/agent.yaml` sets `cpus: 2`, `memory: 2GiB`. `vm-provision.cjs` `ensureVm` creates from it or starts an existing VM; nothing changes an existing VM's size. The deployment README records each tool turn's ceilings (640 MiB worker, 256 MiB supervisor, 64 MiB tunnel).

## Scope and non-goals

In scope:

- The paired guest reports the VM's memory in its turn greeting; the coordinator derives a turn capacity from it; the slot claim bounds sessions by the smaller of Sessions at once and that capacity.
- A per-VM startup gate in the coordinator: one turn from lane request to its provider's admission at a time.
- Lanes on demand: a relay offers a lane to the coordinator without starting a guest, and starts one only when the coordinator asks for it. An unclaimed launched lane is closed after a short idle bound.
- An admission timeout requeues as a new turn up to twice, then fails with `agent_admission_timeout` and its own summary. The admission limit becomes 45 s.
- The Lima template moves to 4 CPUs / 4 GiB; `pnpm vm:setup` resizes a stopped VM to the template and tells the operator how to stop a running one first. The README gains a sizing table for the Mac and the Pi 5 (8 GB).

Non-goals:

- A Settings field for the VM's capacity, or showing the effective cap in the UI (open item).
- Measuring actual per-turn memory; the cap uses the configured container ceilings.
- Resizing the real VM, or a live run (Mitch does both after merge).
- Host profiles (`native-agent/2`): they get the admission-timeout requeue, since it is the runner's rule, but no memory cap.

## Reuse and dependency assessment

No external package applies: capacity, gating and the lane protocol are the coordinator's, relay's and runner's own policies, and the VM size is Lima's (`limactl edit --cpus --memory`, Lima 2.3.0, checked 2026-11-27 with `limactl edit --help`).

| Option | Goal fit and strengths | Limitations and cost | Evidence | Decision |
| --- | --- | --- | --- | --- |
| **Cap from the guest's reported memory, at the slot claim** | One source of truth (the coordinator's latest greeting); sessions past it stay queued without a slot; follows a resize automatically | Unknown until a guest greets, so the cap starts at 1; trusts the paired supervisor's `/proc/meminfo` | `guest-turn.ts` greeting, `slots.ts` claim | Chosen |
| Cap configured per installation (env or Settings) | No guest change | A second value to keep in step with the VM; wrong after a resize | — | Rejected |
| Cap in the coordinator only (requeue when full) | No DB change | Sessions claim slots and requeue every minute, holding slots up to 45 s | `coordinator.ts` requeue path | Rejected |
| **Lanes on demand: plaintext lane offer, coordinator says `go`** | No idle containers; route known before launch; older relays still work (TLS sniffed) | Protocol change: relay and coordinator deploy together; pre-TLS bytes on a loopback port | `relay.mjs`, `coordinator.ts` | Chosen |
| Ready lane starts only the paired supervisor | Keeps routing by greeting | Still one idle container per relay; reorders `tool-turn.sh` and the supervisor's worker connect | `tool-turn.sh` | Rejected |
| Close a ready lane after an idle bound | Small change | Next turn finds no relay and fails `agent_vm_unavailable`; relaunch churn | — | Rejected |
| **Retry counter in a new `agent_session.startup_timeouts` column** | Survives restarts; bounded | A migration | `0042` pattern | Chosen |
| Count in worker memory | No migration | Lost on restart, so not a real bound | — | Rejected |

## Capabilities

### New capabilities

None.

### Modified capabilities

- `shared-vm-execution`: adds "VM turns fit the agent VM's memory", "One provider start at a time per VM" and "Relays start guests only on demand"; adds "Agent VM size".
- `processing-agent-sessions`: adds "A startup timeout goes back to the queue a bounded number of times".

## Impact and dependencies

- Intake server: `shared-vm/coordinator.ts`, new `shared-vm/turn-capacity.ts`, `shared-vm/startup-gate.ts` and `shared-vm/lane-offers.ts`, `guest-main.ts`/`guest-turn.ts` (memory in the greeting), `session/slots.ts`, `session/session-runner.ts`, `session/session-worker-main.ts`, `session/claude-session-admission.ts`, `failure-model.ts`, `held-capacity.ts` (a cold lane needs longer to answer a probe); migration `0048`, `schema.ts`, `grants.ts`.
- Tooling: `relay.mjs`, `lima/agent.yaml`, `vm-provision.cjs`/`vm-setup.cjs` (resize step), tooling tests.
- Runner image: the guest reports memory and the 45 s admission limit (managed `pnpm dev` refreshes it).
- Docs: agents architecture, `docs/agent-sessions.md`, `docs/development.md`, deployment README.
- Prerequisites: BI-026 (#298), merged.

## Open decisions and assumptions

- Assumption: the always-on guest services and Docker take about 768 MiB, and a tool turn its ceilings, 960 MiB. A plain `/1` turn (384 MiB ceiling) is counted as a tool turn, conservatively.
- Assumption: a guest that reports no memory (older image) counts as capacity 1 until a newer guest greets.
