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

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true` without `INTAKE_VM_PAIR` and `INTAKE_VM_PORT`
- **WHEN** the launcher resolves the profile
- **THEN** it refuses with `vm_pairing_required` before any setup.

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

### Requirement: Launcher-managed VM agents are opt-in by naming the VM

The development launcher SHALL manage the agent VM only when `INTAKE_VM_NAME` is set, and SHALL then require real agents in the VM (`INTAKE_RUN_AGENTS_IN_VM` true, `INTAKE_USE_MOCK_AI_AGENTS` false), `INTAKE_VM_GUEST_DIR` and `INTAKE_VM_RUNNER_IMAGE`. Without `INTAKE_VM_NAME` it SHALL start nothing on the VM side. Refusals SHALL happen before any setup and name settings, never values.

#### Scenario: VM named with real agents in the VM

- **GIVEN** real agents in the VM with pairing and port set, and `INTAKE_VM_NAME`, `INTAKE_VM_GUEST_DIR` and `INTAKE_VM_RUNNER_IMAGE` set to valid values
- **WHEN** `pnpm dev` resolves its settings
- **THEN** it accepts them and its startup summary names the VM and states whether it will be stopped on exit

#### Scenario: VM named without real VM agents

- **GIVEN** `INTAKE_VM_NAME` is set and either `INTAKE_RUN_AGENTS_IN_VM` is false or agents are scripted
- **WHEN** `pnpm dev` resolves its settings
- **THEN** it refuses with `vm_launch_requires_real_vm_agents` before starting any service

#### Scenario: No VM named

- **GIVEN** real agents in the VM with pairing and port, and no `INTAKE_VM_NAME`
- **WHEN** `pnpm dev` starts
- **THEN** it starts no VM, tunnel or relay, and operator-run relays keep working

### Requirement: VM launch settings are validated

The launcher SHALL accept an instance name matching `^[a-z0-9][a-z0-9-]*$`, an absolute guest directory matching `^/[a-zA-Z0-9_./-]+$`, an image reference matching `^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$` and an `INTAKE_VM_PORT` from 1 to 65535, the forms the relay accepts. It SHALL accept `INTAKE_VM_KEEP_RUNNING` only as true, false, 1 or 0, whether or not a VM is named.

#### Scenario: Missing or malformed VM setting

- **GIVEN** `INTAKE_VM_NAME` is set and `INTAKE_VM_GUEST_DIR` is missing, or `INTAKE_VM_RUNNER_IMAGE` contains a space
- **WHEN** `pnpm dev` resolves its settings
- **THEN** it refuses with `vm_launch_setting_required` or `invalid_vm_launch_setting`, naming that setting without its value

#### Scenario: Invalid keep-running switch

- **GIVEN** `INTAKE_VM_KEEP_RUNNING=yes`
- **WHEN** `pnpm dev` resolves its settings
- **THEN** it refuses with `invalid_development_setting`, naming `INTAKE_VM_KEEP_RUNNING`

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
