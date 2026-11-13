# Capability delta

## ADDED Requirements

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

The launcher SHALL accept an instance name matching `^[a-z0-9-]+$`, an absolute guest directory matching `^/[a-zA-Z0-9_./-]+$`, an image reference matching `^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$` and an `INTAKE_VM_PORT` from 1 to 65535, the forms the relay accepts. It SHALL accept `INTAKE_VM_KEEP_RUNNING` only as true, false, 1 or 0, whether or not a VM is named.

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
