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
| false | true | true | tools true | `shared-vm-agent/3` |

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

When the launcher manages the VM, it SHALL check before booting that the pairing directory holds `ca.pem`, `cert.pem` and `key.pem`, and SHALL otherwise refuse with `vm_pairing_missing`, naming `INTAKE_VM_PAIR` and telling the developer to run `pnpm vm:setup`, without booting the VM.

#### Scenario: Fresh clone without pairing

- **GIVEN** real agents in the VM, the default pairing directory, and no pairing made yet
- **WHEN** `pnpm dev` starts
- **THEN** it refuses with `vm_pairing_missing`, says to run `pnpm vm:setup`, and doesn't boot the VM or start any service

### Requirement: One-command VM setup

`pnpm vm:setup` SHALL prepare everything VM agents need, using the same VM settings and defaults as `pnpm dev`. It builds the app, guest and runner images, creates or starts the named Lima instance from the repository's template, loads the runner image, pairs, creates the operator key file, and provisions both providers' guest services for the browser origin `pnpm dev` will serve. It SHALL end by printing the remaining steps.

#### Scenario: Fresh clone

- **GIVEN** Lima and Docker installed, no VM, no pairing and no runner image
- **WHEN** the developer runs `pnpm vm:setup`, then sets `INTAKE_USE_MOCK_AI_AGENTS=false` and `INTAKE_RUN_AGENTS_IN_VM=true`, and runs `pnpm dev`
- **THEN** the VM exists, is paired and provisioned with the current runner image, `pnpm dev` starts without `vm_pairing_missing`, and the only remaining step is signing in

#### Scenario: Tailnet origin

- **GIVEN** guest services provisioned for `http://127.0.0.1:4330`, and `INTAKE_DEV_TAILSCALE` now on
- **WHEN** the developer runs `pnpm vm:setup`
- **THEN** both guest management services are replaced for the tailnet origin, and the pairing, store and sign-in directories are kept

### Requirement: VM setup is safe to rerun

`pnpm vm:setup` SHALL skip each step whose result is already in place. It SHALL NOT replace an existing pairing, operator key, provider sign-in or VM disk, and SHALL create an operator key only when neither side has one. A pairing present on only one side SHALL stop the run with `vm_pairing_mismatch`, naming both directories and removing neither.

#### Scenario: Rerun on a working setup

- **GIVEN** a VM that `pnpm vm:setup` already prepared, with a saved Claude token and a ChatGPT sign-in
- **WHEN** the developer runs `pnpm vm:setup` again
- **THEN** it reports each step as already done, and the pairing, operator key and both sign-ins are unchanged

#### Scenario: Operator key on one side only

- **GIVEN** an existing pairing whose guest operator key is present but whose host key file is missing, or whose two keys differ
- **WHEN** `pnpm vm:setup` reaches the operator key step
- **THEN** it stops with `vm_operator_key_mismatch`, generates nothing and overwrites neither key

#### Scenario: Guest service stopped

- **GIVEN** a prepared VM whose Claude management container is stopped
- **WHEN** the developer runs `pnpm vm:setup`, or `pnpm dev` starts with VM management
- **THEN** the container is started and confirmed running before setup reports done or the relays start, and a failed start stops the run naming that service

#### Scenario: Pairing only half present

- **GIVEN** a host pairing directory whose guest side is missing, or the reverse
- **WHEN** `pnpm vm:setup` reaches pairing
- **THEN** it stops with `vm_pairing_mismatch`, naming both directories, and removes neither

### Requirement: VM setup checks prerequisites and stops on failure

`pnpm vm:setup` SHALL check for `limactl` and `docker` before changing anything, and refuse with `vm_setup_prerequisite_missing` naming the missing tool. A failed step SHALL stop the run, naming the step. A VM this run started SHALL be stopped at the end unless `INTAKE_VM_KEEP_RUNNING` is true.

#### Scenario: Lima missing

- **GIVEN** `limactl` is not on `PATH`
- **WHEN** the developer runs `pnpm vm:setup`
- **THEN** it refuses with `vm_setup_prerequisite_missing` naming `limactl`, before building or changing anything

#### Scenario: A step fails

- **GIVEN** the guest services fail to provision
- **WHEN** `pnpm vm:setup` runs
- **THEN** it stops naming that step, runs no later step, and stops the VM if this run started it

### Requirement: The runner image is kept current

Each runner image SHALL carry a digest of the source inputs it was built from. When the launcher manages the VM, it SHALL check before starting the relays that the guest image digest matches the checkout, that each guest service runs that image for the current origin, and that the browser policy matches the checkout. A missing or stale guest image SHALL be rebuilt and loaded, and the guest services that run from it restarted, with the startup output saying so.

#### Scenario: Guest code changed

- **GIVEN** a managed VM whose runner image was built before a change to `intake-server/src/agents/shared-vm/`
- **WHEN** `pnpm dev` starts
- **THEN** it rebuilds and reloads the runner image, restarts the guest services, then starts the relays, and the summary says the image was refreshed

#### Scenario: Refresh failed part-way

- **GIVEN** a previous start loaded the current runner image but failed while reprovisioning the guest services
- **WHEN** `pnpm dev` starts again
- **THEN** it sees the services still on the old image and reprovisions them before starting the relays, without rebuilding

#### Scenario: Image current

- **GIVEN** a runner image whose digest matches the checkout
- **WHEN** `pnpm dev` starts
- **THEN** it doesn't build anything

### Requirement: A failed image refresh stops startup

If the rebuild or load fails, startup SHALL fail with `vm_runner_image_refresh_failed` before any relay starts, and shutdown SHALL follow the existing stop rules. A refresh SHALL check the operator key as `pnpm vm:setup` does before reprovisioning. With VM management off, a stale image SHALL produce a warning naming `pnpm vm:setup`, and nothing is rebuilt.

#### Scenario: Rebuild fails

- **GIVEN** a stale runner image and a failing build
- **WHEN** `pnpm dev` starts with VM management
- **THEN** startup fails with `vm_runner_image_refresh_failed`, no relay starts, and the VM is stopped only if this run booted it and `INTAKE_VM_KEEP_RUNNING` is not true

#### Scenario: Refresh with a missing or mismatched operator key

- **GIVEN** a stale runner image, and a host operator key file that is missing or differs from the guest's key
- **WHEN** `pnpm dev` starts with VM management
- **THEN** startup fails with `vm_operator_key_mismatch` before any guest service is reprovisioned, no relay starts, and neither key changes

#### Scenario: Unmanaged VM with a stale image

- **GIVEN** `INTAKE_VM_MANAGED=false` and a stale runner image
- **WHEN** `pnpm dev` starts
- **THEN** it warns that the image is stale, names `pnpm vm:setup`, and starts as before
