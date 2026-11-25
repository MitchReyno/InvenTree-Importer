## MODIFIED Requirements

### Requirement: Launcher stops what it started

When the app stops for any reason after VM management began, the launcher SHALL first stop the application processes it owns and wait for them to exit, and only then stop the relays and tunnel, so a stopping agent worker can still confirm its VM turns were reaped. It SHALL then stop the VM if, and only if, this run booted it and `INTAKE_VM_KEEP_RUNNING` is not true. A VM stop failure SHALL be reported with the command to retry and SHALL NOT prevent the rest of shutdown, including the supervisor lock release.

#### Scenario: VM booted by this run

- **GIVEN** `pnpm dev` booted the VM
- **WHEN** the developer presses Ctrl-C
- **THEN** the app stops, then the relays and tunnel stop, then the VM stops

#### Scenario: VM already running

- **GIVEN** the VM was running before `pnpm dev` started
- **WHEN** the app stops
- **THEN** the relays and tunnel stop after the app and the VM keeps running

#### Scenario: Relays outlive the stopping worker

- **GIVEN** a running VM tool turn
- **WHEN** the developer presses Ctrl-C
- **THEN** the relays are still running while the agent worker waits for the turn's removal proof, and are stopped once the worker has exited

#### Scenario: Keep running

- **GIVEN** `pnpm dev` booted the VM and `INTAKE_VM_KEEP_RUNNING=true`
- **WHEN** the app stops
- **THEN** the VM keeps running

#### Scenario: Startup fails after booting the VM

- **GIVEN** `pnpm dev` booted the VM and a later startup step fails
- **WHEN** the launcher exits
- **THEN** it stops the VM it booted

## ADDED Requirements

### Requirement: Operator reap check

`pnpm agents:reap` SHALL run the same held-capacity check the agent worker runs at startup, for the configured development database and with the same VM side `pnpm dev` would start, without starting the app. It SHALL print each slot or lane it released and each it kept with its reason, exit successfully only when nothing remains held, and stop what it started. It SHALL refuse while another `pnpm dev` is running.

#### Scenario: A stale slot is confirmed gone

- **GIVEN** `pnpm dev` is stopped and a slot is held by a VM turn whose removal the guest confirms
- **WHEN** the developer runs `pnpm agents:reap`
- **THEN** it prints that the attempt's slot was released, exits 0, and the next `pnpm dev` starts

#### Scenario: A slot cannot be confirmed

- **GIVEN** a slot held by a turn the check cannot confirm
- **WHEN** the developer runs `pnpm agents:reap`
- **THEN** it prints the attempt and the reason, leaves the slot held, and exits non-zero with `agent_reap_confirmation_required`
