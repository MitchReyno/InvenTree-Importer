## ADDED Requirements

### Requirement: The summary names what needs attention

Inside a batch, the masthead's workflow summary SHALL name that batch's step that failed or waits for the operator, with a count, such as "Research failed · 1" or "Examine waiting for you · 2", failures first, from the batch's complete step read. It SHALL NOT claim that all work is done, and SHALL NOT use internal terms such as "Retained work".

#### Scenario: A failed step

- **GIVEN** the open batch, where Research failed on one job and nothing else is running
- **WHEN** the masthead summary renders
- **THEN** it reads "Research failed · 1", using the Failed glyph.

#### Scenario: Waiting and failed at once

- **GIVEN** Examine waiting for the operator and Research failed
- **WHEN** the masthead summary renders
- **THEN** it names the failure first ("Research failed · 1") and still shows the waiting count.

### Requirement: An idle summary needs proof

Inside a batch, the summary SHALL say the batch name with "no agents working" only when nothing in it is working, waiting or failed, the active-session read is fresh and complete, its aggregate lane flag is clear and no session holds a lane.

#### Scenario: Nothing running

- **GIVEN** a batch with no step working, waiting or failed
- **WHEN** the masthead summary renders
- **THEN** it reads the batch name with "no agents working", not "Retained work · ready" or "all done".

#### Scenario: An incomplete read

- **GIVEN** a truncated, stale or unavailable work read
- **WHEN** the masthead summary renders
- **THEN** it says "Updating…" or "Status unavailable" rather than "no agents working".

#### Scenario: A cancelled session still holding a lane

- **GIVEN** no step working, waiting or failed, but a cancelled session still occupying a lane
- **WHEN** the masthead summary renders
- **THEN** it shows the session as working, not "no agents working".

#### Scenario: A lane held by an unlisted session

- **GIVEN** no step working, waiting or failed, no listed session holding a lane, and the read's aggregate lane flag set because the holder belongs to another target
- **WHEN** the masthead summary renders
- **THEN** it doesn't say "no agents working", and shows that a lane is in use.

### Requirement: Outside a batch the summary claims no idle state

Outside a batch, the masthead summary SHALL name only active and waiting work across batches, and SHALL NOT say there are no failures or no agents working, because other batches' settled failures aren't in its read.

#### Scenario: Outside a batch

- **GIVEN** the Batches page, with a failed step in one batch and nothing running
- **WHEN** the masthead summary renders
- **THEN** it doesn't claim no failures or "no agents working", and names only active or waiting work.
