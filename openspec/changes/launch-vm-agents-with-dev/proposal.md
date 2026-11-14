# Change proposal

## Problem and intended outcome

Running real agents in the shared VM during development takes four manual steps beside `pnpm dev`: start the Lima VM, open the SSH tunnels that the Settings › Agents credential panels use, start one relay per provider, and stop it all afterwards. Forgetting a relay leaves agent turns queued with no visible cause; forgetting the VM leaves 2 GiB of memory in use.

The developer asked for `pnpm dev` to own this: when agents run in the VM, starting the app starts the VM, tunnels and relays, and stopping the app stops them, and the VM too.

While qualifying the manual flow on 2026-11-13, two defects surfaced that this change also fixes because the launcher depends on them:

- `tooling/deployment/bridge/personal-claude.sh` caps the Claude credential service at 128 MB. Current code settles at about 149 MiB, so after a VM boot the service is OOM-killed in a restart loop and Settings › Agents → Claude cannot reach it.
- The tunnel commands in `tooling/deployment/README.md` exit immediately: Lima's `ssh.config` enables connection sharing, so `ssh -NT -L …` hands its forwards to the shared master and returns. The forwards keep working, but nothing in the foreground owns them.

## Change identity and linked items

Change name: `launch-vm-agents-with-dev`. Branch `feat/launch-vm-agents-with-dev`; subjects `type(launch-vm-agents-with-dev): …`.

Linked BI items: none. This is a development-tooling convenience requested directly; it does not deliver or change an index item. The shared-VM runner it drives was delivered by the archived `shared-vm-agent-runner` change.

## Current behavior and evidence

- `INTAKE_RUN_AGENTS_IN_VM=true` requires `INTAKE_VM_PAIR` and `INTAKE_VM_PORT` (`tooling/dev/settings.cjs` `resolveProcessing`). The session worker listens on that loopback port; `pnpm dev` starts nothing on the VM side (`tooling/dev.cjs`).
- Relays are started by hand with `node tooling/deployment/bridge/relay.mjs VM PORT GUEST_DIR IMAGE`, with `INTAKE_VM_CLAUDE_SUBSCRIPTION=1` or `INTAKE_VM_CODEX_SUBSCRIPTION=1` and, for tools, `INTAKE_VM_BUILTIN_TOOLS=1` (`tooling/deployment/README.md`). A relay retries the coordinator port every 500 ms and exits on SIGTERM.
- The dev UI proxies `/personal-runner/claude` and `/personal-runner/codex` to loopback ports 14315 and 14317 when agents run in the VM (`tooling/dev/ui.cjs`); something else must forward those ports into the VM.
- Observed 2026-11-13 on an M1 with Lima 2.3.0: a VM boot takes about 36 s; `limactl stop` about 5 s; the five long-running guest services restart with the VM (`--restart=unless-stopped`).

## Scope and non-goals

In scope:

- New `.env` settings naming the Lima instance, the paired guest directory and the runner image. When the instance is named and real agents run in the VM, `pnpm dev` boots the VM if it is stopped, opens the credential tunnels, runs one relay per provider (with tools when `INTAKE_VM_AGENT_TOOLS` allows), keeps them through source reloads, and stops the app if one dies.
- On exit, `pnpm dev` stops the relays and tunnels, then stops the VM if this run booted it, unless a keep-running switch is set.
- Fix the Claude credential service's memory cap and the README tunnel commands.
- Document the settings in `docs/development.md` and `.env.intake.example`.

Non-goals:

- Creating, pairing or provisioning a VM, building or loading runner images, or linking provider accounts. Those stay one-off operator steps in `tooling/deployment/README.md`.
- Scripted (mock) agents in the VM. Their relay uses a controlled-provider image chosen by the test harness; the launcher refuses a VM name with scripted agents rather than guess.
- Packaged deployments. They keep their Compose-managed coordinator and operator-run relays.
- Stopping a VM that was already running before `pnpm dev` started; another tool or session may be using it.

Compatibility: with no VM name set, `pnpm dev` behaves exactly as today, including manually run relays.

## Reuse and dependency assessment

No external package is relevant: the work is orchestration of two existing tools (Lima's `limactl` and the repository's `relay.mjs`) by the repository's existing launcher, which already owns child-process supervision (`tooling/dev/process.cjs`), shutdown ordering (`tooling/dev/session.cjs`) and settings refusal (`tooling/dev/settings.cjs`).

| Option | Goal fit and strengths | Limitations, risks and adoption cost | Evidence (checked 2026-11-13) | Unknowns |
| --- | --- | --- | --- | --- |
| Extend `tooling/dev.cjs` with a VM lifecycle step and owned relay/tunnel children | Exactly what was asked: one command. Reuses `launch`/`stop`, startup groups, session-end binding and the settings refusal pattern; relays inherit the app's shutdown and failure handling. | Adds `limactl` and `ssh` as optional runtime commands of the launcher; more launcher code to test. | `tooling/dev.cjs`, `tooling/dev/process.cjs`, `tooling/dev/session.cjs`; Lima CLI `limactl start/stop/list` (Lima 2.3.0 installed) | Behavior when the VM is stopped externally mid-session; covered by treating a dead tunnel or relay as a stopped child. |
| Personal wrapper script around `pnpm dev` (in use since 2026-11-13, outside the repo) | Works today; no repo change. | Not what was asked (`pnpm dev` itself); duplicates settings parsing; bash 3.2 quirks on macOS; invisible to other developers. | Script qualified manually 2026-11-13 | — |
| Lima provisioning or `limactl` start hooks to run relays inside the VM | Ties relays to VM lifetime. | Relays need host-side Lima management access and the host coordinator port by design (`relay.mjs`: "Byte transport only"); moving them into the guest breaks the isolation model. | `tooling/deployment/bridge/relay.mjs`, README "App-to-guest dispatch" | — |
| launchd/systemd user services | Survives terminal closes. | Platform-specific, outlives the app, and does not stop with it. | — | — |

Recommendation: extend the launcher. It is the only option that makes `pnpm dev` the single control point while keeping the app's ownership, shutdown and failure semantics for the new children. The wrapper script is retired once this ships.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `development-launcher`: adds requirements for launcher-managed VM agents (settings, startup, reload survival, failure and shutdown). The capability is introduced by the merged but unarchived `split-dev-profile-settings` change; this change adds requirements under different names.

## Impact and dependencies

- Tooling only: `tooling/dev.cjs`, `tooling/dev/settings.cjs`, `tooling/dev/environment.cjs` (allowlist), `tooling/dev/process.cjs` (printed failure codes), `tooling/dev/ui.cjs` (shared credential ports), a new `tooling/dev/vm.cjs`, and `tooling/tests/`. No application, contract or database change.
- Deployment assets: `tooling/deployment/bridge/personal-claude.sh` memory cap, the instance-name form in `relay.mjs` and the other bridge scripts, and the `tooling/deployment/README.md` tunnel commands.
- Docs: `docs/development.md`, `.env.intake.example`, and the root `README.md` (hand-run tunnel commands and a pointer to this route).
- Prerequisites at run time: Lima installed, a paired VM with loaded runner image and linked providers (existing one-off setup).

## Open decisions and assumptions

- Assumption: the VM is stopped on exit only when this run booted it; `INTAKE_VM_KEEP_RUNNING=true` keeps it running even then. Recorded as the safe default because another session may share the VM.
- Assumption: both providers' relays always start with real agents. A relay is idle until a turn arrives, so an unused provider costs one idle Node process and, with tools, one set of waiting guest containers.
- Assumption: tunnels start whenever the launcher manages the VM, because the Settings › Agents panels need them and they are cheap.
