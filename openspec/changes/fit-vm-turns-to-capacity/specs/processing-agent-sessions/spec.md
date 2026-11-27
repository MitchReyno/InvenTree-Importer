## ADDED Requirements

### Requirement: A startup timeout goes back to the queue a bounded number of times

A turn whose provider CLI's admission (limit 45 s) times out, directly or as the cause a VM guest reports, SHALL go back to the queue as a turn that ran: turn count kept, no diagnostic, slot and capability released. This SHALL happen at most twice in a row; the next such timeout SHALL fail the session with code `agent_admission_timeout` and a summary naming the CLI start. Any other settled turn SHALL reset the count.

#### Scenario: One startup timeout

- **GIVEN** a running session whose turn's admission times out for the first time
- **WHEN** the turn settles
- **THEN** the session is `queued`, its turn count includes the turn, it holds no slot and has no failure diagnostic

#### Scenario: Repeated startup timeouts

- **GIVEN** a session whose two previous turns were requeued after admission timeouts
- **WHEN** its next turn's admission also times out
- **THEN** the session fails with code `agent_admission_timeout` and category `timeout`, and its summary names the CLI start rather than the provider connection

#### Scenario: A turn that started resets the count

- **GIVEN** a session requeued once after an admission timeout
- **WHEN** its next turn finishes
- **THEN** a later admission timeout is again requeued
