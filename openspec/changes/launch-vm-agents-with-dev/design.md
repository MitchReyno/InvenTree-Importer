# Design assessment

## Context and grounding

The change is confined to the development launcher and two deployment assets. Existing patterns cover almost all of it:

- `tooling/dev/settings.cjs` resolves every switch before setup and refuses with `DevelopmentSettingsError` codes that name settings, never values. `startupSummary` prints what will run.
- `tooling/dev/environment.cjs` allowlists the names `pnpm dev` reads from `.env`.
- `tooling/dev.cjs` claims the supervisor lock inside `startSupervision`, starts application services with `launch` (`tooling/dev/process.cjs`), keeps "front door" children (`ui`, `tailnet`, `tailscale-serve`) through source reloads, stops the app when one of them exits, and in its `finally` stops owned children before releasing the lock.
- `tooling/deployment/bridge/relay.mjs` validates its arguments with the regexes this change reuses, retries the coordinator port every 500 ms, and exits on SIGTERM after stopping its guest turn.

Complexity: moderate. One new effectful module and a small insertion into the launcher's existing startup and shutdown order; no new dependency, contract or persistent state.

## Goals and constraints

Deliver the proposal's outcome and the `development-launcher` requirements in `specs/development-launcher/spec.md`:

- `pnpm dev` alone brings up and tears down the VM side when `INTAKE_VM_NAME` is set.
- Nothing changes without `INTAKE_VM_NAME`.
- Settings are refused before any effect; secrets and values never appear in refusals.
- A VM this run did not boot is never stopped.
- Shutdown always reaches the lock release, even when the VM stop fails.

## Decisions and alternatives

### Validation in `settings.cjs`, effects in a new `tooling/dev/vm.cjs`

`resolveDevelopmentSettings` gains a `vm` result: `null`, or a plan `{ name, guestDir, image, port, tools, keepRunning }`. The new module owns the commands: reading the instance status, booting, stopping, and launching the tunnel and relays. It takes its command runner and `launch` as parameters so tests can substitute fakes.

Rejected: putting the effects in `dev.cjs` directly. It is already long, and the commands would be untestable without a VM.

### Boot after the supervisor lock, before the application services

The VM boots after `startSupervision` has claimed the lock and prepared the database, and before `start()` launches the API and agent worker. The tunnel and relays start straight after the boot. The relays retry until the session worker listens, so their order relative to the worker does not matter.

Rejected: booting before the lock. Two concurrent `pnpm dev` runs would both try to own the VM, and a refused second run would have booted a VM it then has to stop. Booting in parallel with the database setup would save up to about 36 s but would complicate cancellation; it can be revisited if startup time matters.

### Tunnel and relays as reload-surviving owned children

They are started with `launch` and named `vm-tunnel`, `vm-relay-claude` and `vm-relay-codex`. The set of children kept through a source reload grows from the front-door names to include these. Their `exited` promise stops the app, as the tailnet children already do.

They print nothing when healthy, so readiness is checked as "still running one second after launch". `ssh -o ExitOnForwardFailure=yes` exits within that time when a port is taken, and a relay exits immediately on bad arguments.

The tunnel passes `-o ControlPath=none`. Lima's `ssh.config` enables connection sharing, and without its own connection `ssh` hands the forwards to the shared master and exits, which the launcher would read as a failed tunnel.

### Stop only what this run booted

`ensureVmRunning` in `vm.cjs` reads the status, calls the launcher's `onBoot` before booting, and resolves whether it booted the VM. A VM that was already running may be used by another session or a manual relay, so it is left running.

`INTAKE_VM_KEEP_RUNNING` (default false) keeps a VM this run booted, for quick restarts. It is a switch with the same parsing as the others.

### Real agents only

Scripted agents in the VM use a controlled-provider runner chosen by the test harness. Real agents use the personal image with subscription relays. Guessing for the scripted case could start the wrong relays, so the launcher refuses `INTAKE_VM_NAME` with scripted agents (`vm_launch_requires_real_vm_agents`) and leaves that case to manual relays.

## State, authority and failure behavior

| Phase | Effect | On failure |
| --- | --- | --- |
| Settings | none | refusal code plus setting names; exit 1 |
| Status read (`limactl list`) | none | `vm_start_failed`; nothing started |
| Boot (`limactl start --tty=false NAME`, bounded at 180 s, abortable by Ctrl-C) | VM running; `booted` recorded **before** the command runs, so a cancelled boot is still stopped | `vm_start_failed`; the `finally` block stops the VM |
| Tunnel and relays | three owned children | `<name>_stopped_during_startup`; startup aborts and `finally` cleans up |
| Running | — | a child's exit writes `<name> stopped; stopping the app.` and shuts down |
| Shutdown | children stopped with the app's others, then `limactl stop NAME` (in its own process group; while it is pending, a second Ctrl-C is held and a third quits and leaves the VM running) if booted and not kept, then the lock release | a stop failure writes `vm_stop_failed: run limactl stop NAME` and the release still happens |

Authority: the launcher already has the developer's local permissions. It uses `limactl` and `ssh` with the developer's Lima configuration and passes the relays only `PATH`, `HOME`, the other base variables, `LIMA_HOME` when set, and the provider and tool flags. No pairing key, operator key or token is read or passed by the launcher.

Compatibility: unset `INTAKE_VM_NAME` leaves every code path as before. Manual relays keep working alongside a launcher that does not manage the VM.

## Verification strategy

- **Settings (unit, `tooling/tests/dev-settings.test.cjs`):** the accepted plan, each refusal code, value-free refusal lines, and the summary line.
- **VM module (unit, new `tooling/tests/dev-vm.test.cjs`):** with fake runners and `launch`, check the boot decision, the `booted` flag, the stop decision for each combination of booted and keep-running, the relay arguments and environment with and without tools, the tunnel arguments including `ControlPath=none`, early-exit detection, and stop-failure reporting.
- **Launcher wiring:** `dev.cjs` has no unit harness for its main path. The insertion is checked by review and by manual qualification against the real VM, recorded in the PR: cold start, Ctrl-C stops the VM, an already-running VM is kept, `INTAKE_VM_KEEP_RUNNING`, a killed relay stops the app, a source reload keeps the relays, a missing instance fails before services start, and a startup failure after a boot (the tunnel port held) stops the VM and releases the lock.
- **Deployment assets:** `bash -n` on the edited script, and a manual check that the Claude credential service stays up after a VM boot with the new cap.
- **Gate:** `pnpm test:dev`, `pnpm lint`, `pnpm format:check`, plus the repository gate (`pnpm lint && pnpm build && pnpm test`).

Limits: the qualification uses one developer machine (an M1 with Lima 2.3.0). Provider turns are not exercised, because a turn spends subscription quota and the relay path itself is unchanged.

## Migration, rollout and recovery

No migration. Developers opt in by adding three settings. Rolling back means removing them, or reverting the change, after which manual relays work as before. The personal `dev-vm.sh` wrapper used during qualification lives outside the repository and is retired by the developer.

## Risks and open decisions

- **Memory:** with tools on, two idle relays keep two sets of waiting guest containers in a 2 GiB VM. This was observed to be stable on 2026-11-13. The VM size remains an operator choice.
- **External VM stop:** if the VM is stopped behind the launcher's back, the tunnel exits and the app stops, which is the intended loud failure.

No open decisions.
