## ADDED Requirements

### Requirement: Shutdown settles in-flight turns

When a session worker is asked to stop, it SHALL stop each in-flight turn and wait a bounded time for the turn to settle before closing its scheduler, VM bridge, tool server or database connections. A turn whose child's reap is confirmed within that wait SHALL settle through the normal path: its slot released, its capability revoked and its session interrupted. A turn whose reap is not confirmed SHALL keep its slot.

#### Scenario: Reap confirmed during shutdown

- **GIVEN** a running VM tool turn whose guest confirms the worker's removal 12 seconds after the turn is stopped
- **WHEN** the session worker receives SIGTERM
- **THEN** the worker waits for that confirmation before exiting, the slot is free, the session is `interrupted` with an `agent_worker_interrupted` failure, and its capability is revoked

#### Scenario: Reap not confirmed during shutdown

- **GIVEN** a running VM tool turn whose guest never confirms the worker's removal
- **WHEN** the session worker receives SIGTERM
- **THEN** the worker exits after its bounded wait and the slot stays held by that attempt

### Requirement: Startup confirms held capacity before releasing it

After taking the per-actor supervisor lock, a starting agent worker SHALL check each held slot and the Processing lane. It SHALL release a slot only once confirmed: its turn started nothing outside the worker, or the VM guest confirms removal for the turn's exact command. A released slot's session SHALL then become interrupted through the existing startup recovery. The worker SHALL NOT stop or kill a process to do this.

#### Scenario: VM turn confirmed gone

- **GIVEN** a held slot whose turn dispatched a VM tool command, and a guest whose removal receipt matches that command
- **WHEN** the session worker starts
- **THEN** the slot is released, the session becomes `interrupted`, and the worker serves queued work. The turn keeps its first diagnostic: `agent_reap_pending` when the stopped worker recorded its unconfirmed reap, otherwise `agent_worker_interrupted`

#### Scenario: Turn started nothing outside its worker

- **GIVEN** a held slot whose turn was claimed but started no host process and dispatched no VM command
- **WHEN** a worker starts
- **THEN** the slot is released and the session becomes `interrupted`

### Requirement: Unconfirmed held capacity keeps refusing

When a held slot or the lane cannot be confirmed, because its turn's child is unrecorded or a host process, the VM is unreachable or the guest gives no proof, the worker SHALL keep that capacity held and refuse to start with `agent_reap_confirmation_required`. It SHALL log each refused attempt with whether it holds a slot or the lane and a fixed reason.

#### Scenario: VM turn not confirmed

- **GIVEN** a held slot whose turn dispatched a VM command, and a guest that is unreachable or has no matching removal receipt within the check's bound
- **WHEN** the session worker starts
- **THEN** the slot stays held, the session keeps its state, the worker exits with `agent_reap_confirmation_required`, and the log names the attempt and the reason

#### Scenario: Unverifiable holder

- **GIVEN** a held slot whose turn started a host process, or a held slot claimed before turns were recorded, or an occupied Processing lane
- **WHEN** a worker starts
- **THEN** that capacity stays held and the worker refuses with `agent_reap_confirmation_required`, naming the attempt and why it couldn't be confirmed, while any other slot it did confirm is released

#### Scenario: Held by another target or context

- **GIVEN** a held slot whose attempt belongs to another target or context of the same actor
- **WHEN** a worker starts
- **THEN** it keeps that slot for a worker of that scope, which can interrupt its session

#### Scenario: Lock lost during the check

- **GIVEN** a starting worker checking held slots
- **WHEN** its supervisor lock's connection ends before a release
- **THEN** no slot is released and the worker stops

#### Scenario: Another worker holds the actor

- **GIVEN** a running worker holds the actor's supervisor lock
- **WHEN** a second worker starts
- **THEN** it refuses with `agent_supervisor_already_running` and checks or releases nothing
