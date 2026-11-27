## ADDED Requirements

### Requirement: VM turns fit the agent VM's memory

The paired guest SHALL report the agent VM's total memory in each turn greeting, and the coordinator SHALL derive the VM's turn capacity from the latest report: memory less the always-on allowance, divided by one tool turn's ceilings, at least 1, and 1 before any report. A session SHALL claim a slot only below both Sessions at once and that capacity; past it, it SHALL stay queued and SHALL NOT fail.

#### Scenario: A 2 GiB VM with Sessions at once 2

- **GIVEN** a guest that reports 2 GiB of memory, Sessions at once 2 and one VM turn running
- **WHEN** a second queued VM session tries to start
- **THEN** it claims no slot and stays queued, with no failure, and runs once the first turn has settled

#### Scenario: A 4 GiB VM

- **GIVEN** a guest that reports 4 GiB of memory and Sessions at once 8
- **WHEN** several VM sessions are queued
- **THEN** at most 3 hold slots at once

#### Scenario: No report yet

- **GIVEN** a worker whose coordinator has had no turn greeting
- **WHEN** two VM sessions are queued
- **THEN** one claims a slot, and the other waits until a guest has reported its memory

### Requirement: One provider start at a time per VM

The coordinator SHALL let one VM turn at a time start: from asking for its guest connection until the guest reports the provider admitted the turn (its provider session or sent effort), the turn ended, or a bounded hold passed. Other turns SHALL wait for it in order, within a bound, and SHALL then go back to the queue unchanged. Admitted turns SHALL keep running in parallel. Terminal probes SHALL NOT wait for the gate.

#### Scenario: Two turns started together

- **GIVEN** a VM with capacity for two turns and two sessions that claim slots at the same time
- **WHEN** both turns start
- **THEN** the second turn's command reaches its guest only after the first turn's provider has been admitted, and both turns then run at the same time

#### Scenario: A start that never finishes

- **GIVEN** a turn whose guest never reports its provider admitted
- **WHEN** the hold bound passes
- **THEN** the next waiting turn starts

### Requirement: Relays start guests only on demand

A relay lane SHALL offer itself to the coordinator with a plaintext line naming its route, without starting a guest, and the relay SHALL keep one offer open while below its turn capacity. The coordinator SHALL ask an offer for a guest only while a turn or terminal probe of its route waits with no idle or starting connection; the relay SHALL then start the guest and open its next offer. A connection that starts with TLS (an older relay) SHALL be admitted as before.

#### Scenario: Unclaimed started guest

- **GIVEN** a guest the coordinator asked for whose waiter has gone
- **WHEN** no turn or probe takes its connection within 30 s
- **THEN** the coordinator closes it and the guest's containers are removed

#### Scenario: Full relay

- **GIVEN** a relay at its turn capacity with every lane busy
- **WHEN** a turn of its route waits out its connection wait
- **THEN** the turn goes back to the queue, as for busy connections

#### Scenario: Idle relay

- **GIVEN** a relay with no turns
- **WHEN** it has connected to the coordinator
- **THEN** it holds one open offer and no guest containers

#### Scenario: A turn needs a connection

- **GIVEN** an idle relay with one open offer
- **WHEN** a turn of its route starts
- **THEN** the coordinator asks that offer for a guest, the relay starts one and opens another offer, and the turn runs on the new guest

#### Scenario: Startup reap check

- **GIVEN** a worker starting with a held slot whose VM turn needs a removal proof
- **WHEN** it checks held capacity
- **THEN** it asks a relay of the turn's route for a guest and asks that guest for the proof

### Requirement: Agent VM size

The Lima template SHALL size the development agent VM at 4 CPUs and 4 GiB. `pnpm vm:setup` SHALL change a stopped existing VM's CPUs and memory to the template's, then start it. It SHALL NOT stop a running VM to resize it: it SHALL report the size it found and how to apply the template's, and continue. A rerun on a VM already at the template's size SHALL change nothing.

#### Scenario: Stopped VM at the old size

- **GIVEN** a stopped agent VM with 2 CPUs and 2 GiB
- **WHEN** `pnpm vm:setup` runs
- **THEN** it edits the VM to 4 CPUs and 4 GiB, starts it and reports the change

#### Scenario: Running VM at the old size

- **GIVEN** a running agent VM with 2 CPUs and 2 GiB
- **WHEN** `pnpm vm:setup` runs
- **THEN** it leaves the VM running at its size, says to stop it and run setup again to resize, and completes the other steps
