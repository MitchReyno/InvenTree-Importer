# Change proposal

## Problem and intended outcome

With Settings › Agents › Sessions at once set to 2, a batch of 15 VM sessions on Mitch's dev app (2026-11-26) had 10 fail at startup, about 45 s after each claimed its slot. Each failure read "The native session configuration was not accepted." (`agent_process_unavailable`, category `configuration`, turn 1, no model or CLI version). Only the sessions that got their provider's relay connection ran.

The intended outcome, approved by Mitch as "option 1":

- Each provider's relay carries several turns at once, so as many sessions as the session limit allows can run for one provider.
- A turn that still finds no free connection for its route within the wait goes back to the queue instead of failing.
- A turn whose relay isn't connected at all fails with a diagnostic that says the VM connection was unavailable, not that its configuration was refused.

## Change identity and linked items

Change name: `concurrent-vm-relay-turns`. Branch `fix/concurrent-vm-relay-turns`, subjects `fix(concurrent-vm-relay-turns): …` (or `feat`/`docs` as fits).

Linked item: [BI-026](../../../docs/PLANNED_FUNCTIONALITY.md#bi-026--run-several-vm-turns-per-provider-at-once).

## Current behavior and evidence

- `tooling/dev/vm.cjs` `startVmChildren` launches one relay per provider (`vm-relay-claude`, `vm-relay-codex`).
- `tooling/deployment/bridge/relay.mjs` runs one loop: connect to the coordinator, start one guest (`tool-turn.sh` or `docker run … guest-main.ts`), pipe bytes until the guest exits, repeat. A relay therefore offers exactly one turn connection at a time, beside its status and two catalogue connections. The deployment README says so ("Each relay handles one turn at a time", "Start one relay per simultaneous turn").
- `intake-server/src/agents/shared-vm/coordinator.ts` `driver` polls `idlePeer(manifest)` for 45 s (tool worker) or 15 s, then throws `NativeSessionError('agent_process_unavailable')` for a tool worker, `agent_login_required` for a subscription route, or an untyped `paired_guest_unavailable`. It already admits up to eight turn connections (`MAX_TURN_PEERS`), and `server.maxConnections` is 16.
- `failure-model.ts` maps `agent_process_unavailable` to `configuration`, whose summary is "The native session configuration was not accepted." `session-runner.ts` settles any such error as `failed`.
- `session/slots.ts` allows 1–8 slots (`MAX_SESSION_SLOTS = 8`) across providers, so the session limit can exceed one relay's single connection.
- The guest side is already per turn: `tool-turn.sh` makes a private temporary directory, names its three containers after a fresh run ID and gives the turn its own egress proxy over a Unix socket. No port is shared. Claude turns read the token store read-only with a fresh home; Codex turns share the managed home under a shared `flock`, as concurrent host `native-agent/2` Codex sessions already do. Claude and Codex turns already run side by side in the one guest.
- The slot's turn child (migration `0040`) is `none` from the claim until the driver records `vm` just before sending. Settlement runs under the supervisor fence (#286).

## Scope and non-goals

In scope:

- The relay carries several concurrent turn connections, up to `INTAKE_VM_RELAY_TURNS` (default 8, the most slots a session limit can set), keeping one idle connection ready and opening the next once the guest reports it has been claimed.
- The guest supervisor reports the claim on its standard error (a runner image change).
- The coordinator admits enough turn connections for every relay at full capacity, keeps status and catalogue connections apart as today, and tells "no free connection right now" from "no connection for this route".
- The session runner puts a turn that found no free connection back in the queue without counting a turn, recording a diagnostic or touching the turn child.
- A new failure code `agent_vm_unavailable` for a tool turn whose relay isn't connected, with its own summary and recovery.
- The packaged deployment uses the same relay, so it gains the same capacity; its README, the development guide, the agents architecture and `docs/agent-sessions.md` are updated.

Non-goals:

- Sizing the VM. The Lima template keeps 2 GiB; more concurrent turns need more memory, which the README already tells operators to size for.
- A per-provider limit different from the session limit, or a `waiting_for_capacity` session state (see design).
- Changes to the launcher's relay count or the status and catalogue connections.

## Reuse and dependency assessment

No external package applies: the relay is a byte transport and the capacity policy is the coordinator's and runner's own. The options are about where existing code changes.

| Option | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence (checked 2026-11-26) | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| **Several turns per relay, one ready connection, next opened on the guest's claim report** (recommended) | One relay per provider still; idle cost stays one warm turn per relay; covers any session limit | Needs the guest to print a claim marker (runner image refresh); an older image falls back to one turn at a time | `relay.mjs` loop, `tool-turn.sh` per-turn names and directories, `guest-main.ts` stderr | Live VM run not exercised; a fake guest proves the relay and coordinator |
| Several turns per relay, all connections warm | No image change | Up to 8 warm tool turns per provider (three containers each) in a 2 GiB VM; coordinator must admit 16 idle turns | `lima/agent.yaml` (2 CPU, 2 GiB), `tool-turn.sh` memory ceilings | Rejected: idle memory |
| Launcher starts N relays per provider | No relay code change | Each relay also carries one status and two catalogue connections; the coordinator admits two of each per provider, so the rest retry forever; N warm turns | `relay.mjs` `carryStatus`, `coordinator.ts` `MAX_STATUS_PEERS_PER_PROVIDER` | Rejected |
| Infer the claim from bytes on the wire | No image change | The relay sees only TLS records; session tickets and handshake flights make "first coordinator bytes" unreliable | `relay.mjs` header comment (byte transport only) | Rejected: fragile |

Recommended: several turns per relay with a claim marker. It keeps the relay a byte transport (the marker is out of band on standard error and only ever opens another bounded connection) and costs one runner image refresh, which managed `pnpm dev` already does.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `shared-vm-execution`: adds "Relays carry concurrent turns".
- `processing-agent-sessions`: adds "A turn without a free VM connection goes back to the queue".

## Impact and dependencies

- Tooling: `tooling/deployment/bridge/relay.mjs`, a new relay test in `tooling/tests/`, `pnpm test:dev`.
- Intake server: `shared-vm/coordinator.ts`, `shared-vm/guest-main.ts`, `shared-vm/guest-turn.ts`, `session/session-adapters.ts` (the requeue error), `session/session-runner.ts`, `failure-model.ts`; process and unit tests.
- Contracts: `agent_vm_unavailable` in `SESSION_FAILURE_CODES` and its sentence; regenerated OpenAPI.
- Runner image: the guest prints the claim marker, so the image is refreshed (managed `pnpm dev` does this on start).
- No migration. Prerequisites BI-024 (#281) and BI-025 (#286) are merged.

## Open decisions and assumptions

- Assumption: a turn that finds no free connection but whose route has a busy one is a capacity wait, and one whose route has no connection at all during the whole wait means the relay isn't running.
- Assumption: default relay capacity 8 is safe because idle cost stays one warm connection; the VM's memory bounds real concurrency, which the session limit controls.
