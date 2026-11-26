## ADDED Requirements

### Requirement: Relays carry concurrent turns

A provider's relay SHALL carry up to its turn capacity (`INTAKE_VM_RELAY_TURNS`, 1–8, default 8) of turn connections at once. It SHALL keep one unclaimed connection ready and open another only after the guest on the ready one reports its claim. A guest that reports no claim SHALL leave the relay carrying one turn at a time. The coordinator SHALL admit every relay's turns at full capacity, apart from status and catalogue connections.

#### Scenario: Two turns for one provider

- **GIVEN** a session limit of 2 and one tool-capable Claude relay
- **WHEN** two Claude sessions start turns at about the same time
- **THEN** both turns run at once on separate guest connections, and neither fails

#### Scenario: Idle relay

- **GIVEN** a relay with no turns running
- **WHEN** it has connected
- **THEN** it holds exactly one ready guest connection

#### Scenario: Capacity reached

- **GIVEN** a relay with turn capacity 1 carrying a running turn
- **WHEN** another turn for the same route needs a connection
- **THEN** the relay opens no second connection until the running turn's guest exits

#### Scenario: Older guest image

- **GIVEN** a runner image whose guest prints no claim report
- **WHEN** a turn claims the relay's ready connection
- **THEN** the relay opens the next connection only once that turn's guest exits, as before

#### Scenario: Relay stopped

- **GIVEN** a relay carrying turns and a ready connection
- **WHEN** it receives SIGTERM
- **THEN** it closes every connection, opens no new one and exits once their guests have exited
