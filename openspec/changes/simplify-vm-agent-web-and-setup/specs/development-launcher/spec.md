# Capability delta

## MODIFIED Requirements

### Requirement: A missing pairing is refused before the VM starts

When the launcher manages the VM, it SHALL check before booting that the pairing directory holds `ca.pem`, `cert.pem` and `key.pem`, and SHALL otherwise refuse with `vm_pairing_missing`, naming `INTAKE_VM_PAIR` and telling the developer to run `pnpm vm:setup`, without booting the VM.

#### Scenario: Fresh clone without pairing

- **GIVEN** real agents in the VM, the default pairing directory, and no pairing made yet
- **WHEN** `pnpm dev` starts
- **THEN** it refuses with `vm_pairing_missing`, says to run `pnpm vm:setup`, and doesn't boot the VM or start any service

## ADDED Requirements

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

`pnpm vm:setup` SHALL skip each step whose result is already in place. It SHALL NOT replace an existing pairing, operator key, provider sign-in or VM disk. A pairing present on only one side SHALL stop the run with `vm_pairing_mismatch`, naming both directories and removing neither.

#### Scenario: Rerun on a working setup

- **GIVEN** a VM that `pnpm vm:setup` already prepared, with a saved Claude token and a ChatGPT sign-in
- **WHEN** the developer runs `pnpm vm:setup` again
- **THEN** it reports each step as already done, and the pairing, operator key and both sign-ins are unchanged

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

Each runner image SHALL carry a digest of the source inputs it was built from. When the launcher manages the VM, it SHALL compare that digest with the checkout before starting the relays. A missing or stale guest image SHALL be rebuilt and loaded, and the guest services that run from it restarted, with the startup output saying so.

#### Scenario: Guest code changed

- **GIVEN** a managed VM whose runner image was built before a change to `intake-server/src/agents/shared-vm/`
- **WHEN** `pnpm dev` starts
- **THEN** it rebuilds and reloads the runner image, restarts the guest services, then starts the relays, and the summary says the image was refreshed

#### Scenario: Image current

- **GIVEN** a runner image whose digest matches the checkout
- **WHEN** `pnpm dev` starts
- **THEN** it doesn't build anything

### Requirement: A failed image refresh stops startup

If the rebuild or load fails, startup SHALL fail with `vm_runner_image_refresh_failed` before any relay starts, and shutdown SHALL follow the existing stop rules. With VM management off, a stale image SHALL produce a warning naming `pnpm vm:setup`, and nothing is rebuilt.

#### Scenario: Rebuild fails

- **GIVEN** a stale runner image and a failing build
- **WHEN** `pnpm dev` starts with VM management
- **THEN** startup fails with `vm_runner_image_refresh_failed`, no relay starts, and the VM is stopped only if this run booted it and `INTAKE_VM_KEEP_RUNNING` is not true

#### Scenario: Unmanaged VM with a stale image

- **GIVEN** `INTAKE_VM_MANAGED=false` and a stale runner image
- **WHEN** `pnpm dev` starts
- **THEN** it warns that the image is stale, names `pnpm vm:setup`, and starts as before
