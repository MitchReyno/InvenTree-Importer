# development-launcher Specification

## Purpose
`pnpm dev` turns a small set of independently named switches into the processing profile, inventory target and optional services of the local app, so a developer can tell from the setting names alone what the app will run, and retired profile names fail with a pointer to their replacements.

## Requirements

### Requirement: Processing switches select the profile

The development launcher SHALL select the processing profile from `INTAKE_USE_MOCK_AI_AGENTS` (default true), `INTAKE_USE_AGENT_SESSIONS` (default true), `INTAKE_RUN_AGENTS_IN_VM` (default false) and `INTAKE_VM_AGENT_TOOLS` (default true), and SHALL pass only the resulting existing profile ID to its child processes.

#### Scenario: Profile table

- **GIVEN** each combination below, with other switches at their defaults
- **WHEN** the launcher resolves the profile
- **THEN** it selects:

| Mock agents | Sessions | VM | Other | Profile |
|---|---|---|---|---|
| true | false | false | | `synthetic-research/2` |
| true | true | false | | `synthetic-session/1` on the host |
| true | true | true | | `synthetic-session/1` through the VM bridge |
| false | false | false | | `native-agent/1` |
| false | true | false | | `native-agent/2` |
| false | true | true | tools false | `shared-vm-agent/1` |
| false | true | true | tools true | `shared-vm-agent/2` |

#### Scenario: Defaults

- **GIVEN** no processing switches
- **WHEN** `pnpm dev` starts
- **THEN** the profile is `synthetic-session/1` on the host, and the startup output names it.

#### Scenario: Unsupported combination

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true` with `INTAKE_USE_AGENT_SESSIONS=false`
- **WHEN** the launcher resolves the profile
- **THEN** it refuses with `unsupported_agent_settings` before any setup.

#### Scenario: VM pairing required

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true` with an explicit `INTAKE_VM_PORT` that is not a port from 1 to 65535
- **WHEN** the launcher resolves the profile
- **THEN** it refuses with `invalid_vm_launch_setting` before any setup, naming `INTAKE_VM_PORT`.

#### Scenario: VM pairing defaults

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true` without `INTAKE_VM_PAIR` and `INTAKE_VM_PORT`
- **WHEN** the launcher resolves the profile
- **THEN** it uses the default pairing directory and port 14313 instead of refusing.

#### Scenario: VM credential management

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true`
- **WHEN** the UI process starts
- **THEN** it serves the personal credential management proxy; with the VM switch off it does not.

### Requirement: Switch values and retired names

Each switch SHALL accept `true`, `false`, `1` or `0` in any letter case, and treat an empty value as unset. The launcher and `pnpm codex:login` SHALL refuse the retired names `INTAKE_TARGET_PROFILE`, `INTAKE_PROCESSING_PROFILE`, `INTAKE_READ_ORIGIN`, `INTAKE_DEV_API_KEY` and `INTAKE_PERSONAL_MANAGEMENT` in their settings.

#### Scenario: Invalid switch value

- **GIVEN** a switch set to a value such as `yes`
- **WHEN** the launcher reads its settings
- **THEN** it refuses with `invalid_development_setting` and names the variable without echoing its value.

#### Scenario: Retired name

- **GIVEN** an env file or shell setting containing `INTAKE_PROCESSING_PROFILE` or another retired name
- **WHEN** `pnpm dev` or `pnpm codex:login` starts
- **THEN** it refuses with `retired_development_setting` and names each retired variable with its replacement, without echoing values.

### Requirement: VM launch settings are validated

The launcher SHALL accept an instance name matching `^[a-z0-9][a-z0-9-]*$`, an absolute guest directory matching `^/[a-zA-Z0-9_./-]+$`, an image reference matching `^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$` and an `INTAKE_VM_PORT` from 1 to 65535, the forms the relay accepts, whether each value is explicit or a default. It SHALL accept `INTAKE_VM_KEEP_RUNNING` and `INTAKE_VM_MANAGED` only as true, false, 1 or 0, whether or not the VM is managed.

#### Scenario: Missing or malformed VM setting

- **GIVEN** `INTAKE_VM_RUNNER_IMAGE` contains a space, or `INTAKE_VM_GUEST_DIR` is relative, or a VM setting is missing
- **WHEN** `pnpm dev` resolves its settings
- **THEN** a malformed value is refused with `invalid_vm_launch_setting`, naming that setting without its value, and a missing one takes its default

#### Scenario: Invalid keep-running switch

- **GIVEN** `INTAKE_VM_KEEP_RUNNING=yes`
- **WHEN** `pnpm dev` resolves its settings
- **THEN** it refuses with `invalid_development_setting`, naming `INTAKE_VM_KEEP_RUNNING`

#### Scenario: Invalid managed switch

- **GIVEN** `INTAKE_VM_MANAGED=maybe`
- **WHEN** `pnpm dev` resolves its settings
- **THEN** it refuses with `invalid_development_setting`, naming `INTAKE_VM_MANAGED`

### Requirement: Launcher brings up the VM, tunnels and relays

When it manages the VM, the launcher SHALL, before the agent worker starts, boot the named Lima instance if it is not running (recording that this run booted it), forward loopback ports 14315 and 14317 into the VM on its own SSH connection for the credential panels, and start one Claude and one Codex subscription relay on `INTAKE_VM_PORT`, with built-in tools exactly when `INTAKE_VM_AGENT_TOOLS` is true.

#### Scenario: Stopped VM

- **GIVEN** the named VM is stopped
- **WHEN** `pnpm dev` starts with VM management
- **THEN** it boots the VM, then starts the tunnel and both relays, and the app reports ready

#### Scenario: Relays without tools

- **GIVEN** `INTAKE_VM_AGENT_TOOLS=false`
- **WHEN** the launcher starts the relays
- **THEN** each relay runs with its provider's subscription flag and without the built-in tools flag

#### Scenario: VM fails to boot

- **GIVEN** the named instance does not exist or `limactl start` fails
- **WHEN** `pnpm dev` starts with VM management
- **THEN** startup fails with `vm_start_failed` and no application service is started

### Requirement: VM children outlive reloads and fail loudly

The tunnel and relays SHALL survive source-code reloads of the application services. If either exits while the app is running, the launcher SHALL report it by name and stop the app.

#### Scenario: Source reload

- **GIVEN** the app is running with launcher-managed relays
- **WHEN** source code changes and the application services restart
- **THEN** the tunnel and relays keep running and reconnect to the restarted session worker

#### Scenario: Relay dies

- **GIVEN** the app is running with launcher-managed relays
- **WHEN** a relay or the tunnel exits
- **THEN** the launcher writes that it stopped and stops the app

### Requirement: Launcher stops what it started

When the app stops for any reason after VM management began, the launcher SHALL stop the relays and tunnel with the other owned processes, and then SHALL stop the VM if, and only if, this run booted it and `INTAKE_VM_KEEP_RUNNING` is not true. A VM stop failure SHALL be reported with the command to retry and SHALL NOT prevent the rest of shutdown, including the supervisor lock release.

#### Scenario: VM booted by this run

- **GIVEN** `pnpm dev` booted the VM
- **WHEN** the developer presses Ctrl-C
- **THEN** the app, relays and tunnel stop, then the VM stops

#### Scenario: VM already running

- **GIVEN** the VM was running before `pnpm dev` started
- **WHEN** the app stops
- **THEN** the relays and tunnel stop and the VM keeps running

#### Scenario: Keep running

- **GIVEN** `pnpm dev` booted the VM and `INTAKE_VM_KEEP_RUNNING=true`
- **WHEN** the app stops
- **THEN** the VM keeps running

#### Scenario: Startup fails after booting the VM

- **GIVEN** `pnpm dev` booted the VM and a later startup step fails
- **WHEN** the launcher exits
- **THEN** it stops the VM it booted

### Requirement: VM settings have defaults

With agents in the VM, the development launcher SHALL default `INTAKE_VM_PORT` to 14313, `INTAKE_VM_PAIR` to `vm-pair` in the development state directory, `INTAKE_VM_NAME` to `bench-agent`, `INTAKE_VM_GUEST_DIR` to `bench-intake-guest` in the guest user's home directory, and `INTAKE_VM_RUNNER_IMAGE` to `bench-intake-runner:personal`. An explicit value SHALL always win. The startup summary SHALL mark each value it filled in as a default.

#### Scenario: Nothing but the switches

- **GIVEN** `INTAKE_USE_MOCK_AI_AGENTS=false` and `INTAKE_RUN_AGENTS_IN_VM=true`, no other VM setting, and a paired VM at the defaults
- **WHEN** `pnpm dev` starts
- **THEN** it uses port 14313, the default pairing directory, the instance `bench-agent`, the guest's `bench-intake-guest` directory and the image `bench-intake-runner:personal`, and the summary marks them as defaults

#### Scenario: Explicit values win

- **GIVEN** `INTAKE_VM_NAME=bench-agent-m1-local` and an explicit `INTAKE_VM_PAIR`
- **WHEN** `pnpm dev` starts
- **THEN** it uses those values, and the summary does not mark them as defaults

#### Scenario: The worker gets the resolved pairing

- **GIVEN** agents in the VM, scripted or real, managed or not, with `INTAKE_VM_PAIR` and `INTAKE_VM_PORT` unset
- **WHEN** the agent worker starts
- **THEN** its environment carries the default pairing directory and port 14313

#### Scenario: Pairing follows the state directory

- **GIVEN** `INTAKE_DEV_STATE` names another private directory and `INTAKE_VM_PAIR` is unset
- **WHEN** the launcher resolves the pairing directory
- **THEN** it uses `vm-pair` inside that directory

### Requirement: VM management is on by default for real VM agents

The launcher SHALL boot and stop the VM, its credential tunnel and its relays whenever real agents run in the VM, unless `INTAKE_VM_MANAGED` is false. `INTAKE_VM_MANAGED=true` with scripted agents or without agents in the VM SHALL be refused with `vm_launch_requires_real_vm_agents`. With management off, the launcher SHALL start nothing on the VM side, as before.

#### Scenario: Default on

- **GIVEN** real agents in the VM and no `INTAKE_VM_MANAGED`
- **WHEN** `pnpm dev` starts
- **THEN** it boots the VM if needed and starts the tunnel and both relays

#### Scenario: Opted out

- **GIVEN** real agents in the VM and `INTAKE_VM_MANAGED=false`
- **WHEN** `pnpm dev` starts
- **THEN** it starts no VM, tunnel or relay, and relays the developer runs keep working

#### Scenario: Scripted agents in the VM

- **GIVEN** scripted agents with `INTAKE_RUN_AGENTS_IN_VM=true` and no `INTAKE_VM_MANAGED`
- **WHEN** `pnpm dev` starts
- **THEN** it starts nothing on the VM side, as before

#### Scenario: Management asked for without real VM agents

- **GIVEN** `INTAKE_VM_MANAGED=true` with scripted agents
- **WHEN** `pnpm dev` resolves its settings
- **THEN** it refuses with `vm_launch_requires_real_vm_agents` before any setup

### Requirement: The default guest directory is found inside the guest

When `INTAKE_VM_GUEST_DIR` is unset and the launcher manages the VM, it SHALL, after the VM is running and before starting the relays, use `bench-intake-guest` in the guest user's home directory, validated as an absolute guest directory. If the lookup fails or returns an unusable path, it SHALL fail startup with `vm_guest_dir_unavailable` before starting any relay, and shutdown SHALL stop the VM only if this run booted it and `INTAKE_VM_KEEP_RUNNING` is not true.

#### Scenario: Default resolved

- **GIVEN** a managed VM, no `INTAKE_VM_GUEST_DIR`, and a guest whose home directory is `/home/dev.guest`
- **WHEN** `pnpm dev` starts
- **THEN** the relays run with `/home/dev.guest/bench-intake-guest`

#### Scenario: Lookup fails after this run booted the VM

- **GIVEN** a managed VM this run booted, no `INTAKE_VM_GUEST_DIR`, and a home-directory lookup that fails or returns a relative or malformed path
- **WHEN** `pnpm dev` starts
- **THEN** startup fails with `vm_guest_dir_unavailable`, no relay starts, and the VM is stopped unless `INTAKE_VM_KEEP_RUNNING=true`

#### Scenario: Lookup fails on a VM that was already running

- **GIVEN** a managed VM that was already running and a failing home-directory lookup
- **WHEN** `pnpm dev` starts
- **THEN** startup fails with `vm_guest_dir_unavailable` and the VM keeps running

### Requirement: A missing pairing is refused before the VM starts

When the launcher manages the VM, it SHALL check before booting that the pairing directory holds `ca.pem`, `cert.pem` and `key.pem`, and SHALL otherwise refuse with `vm_pairing_missing`, naming `INTAKE_VM_PAIR` and pointing at the README's pairing step, without booting the VM.

#### Scenario: Fresh clone without pairing

- **GIVEN** real agents in the VM, the default pairing directory, and no pairing made yet
- **WHEN** `pnpm dev` starts
- **THEN** it refuses with `vm_pairing_missing` before booting the VM or starting any service
