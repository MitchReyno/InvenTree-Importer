# Capability delta

## MODIFIED Requirements

### Requirement: Active-agent occupancy and scoped freshness

Workflow details SHALL show retained active-agent sessions using authorized actor/target/context scope.

- Physical lane occupancy SHALL remain active even if a session has logically been cancelled or superseded.
- No-active-agents SHALL be asserted only from a fresh complete active-session read.
- Target/context changes SHALL invalidate previous observations, and WebSocket hints SHALL trigger scoped retained reads with existing polling fallback.
- Each listed session SHALL show its latest retained status line with its time, and whether it is running, queued, or waiting for input.
- Waiting sessions SHALL be distinguishable from sessions that occupy a concurrency slot.

#### Scenario: Cancelled session still occupies a lane

- **GIVEN** a cancelled session with `occupies_lane` true
- **WHEN** workflow details show agents
- **THEN** that session remains visibly active with its logical state and a link to its owning view; it is not reported as released.

#### Scenario: Active session beyond history page one

- **GIVEN** an occupied session outside the first history page
- **WHEN** the header obtains its bounded active-session projection
- **THEN** the session is included or coverage is explicitly partial; an empty first history page never becomes proof of no active agents.

#### Scenario: Latest status line

- **GIVEN** a running Examine session whose latest status line is "Comparing markings with datasheet candidates"
- **WHEN** workflow details open
- **THEN** that line and its time are shown for the session, and a waiting session is labelled waiting for input without counting as occupying a slot.
