# Capability delta

## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Launcher-managed VM agents are opt-in by naming the VM

**Reason**: Management is now on by default for real VM agents, and `INTAKE_VM_NAME` only names the instance, with a default.

**Migration**: Remove nothing; an `.env` that sets `INTAKE_VM_NAME`, `INTAKE_VM_GUEST_DIR` and `INTAKE_VM_RUNNER_IMAGE` keeps working. To keep running the VM side by hand, set `INTAKE_VM_MANAGED=false`.
