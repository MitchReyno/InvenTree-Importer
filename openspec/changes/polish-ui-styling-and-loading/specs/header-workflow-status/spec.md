## ADDED Requirements

### Requirement: The summary names what needs attention

The masthead's workflow summary SHALL name the step that failed or waits for the operator, with a count, such as "Research failed · 1" or "Examine waiting for you · 2", failures first. With nothing working, waiting or failed, it SHALL say the batch name with "no agents working". It SHALL NOT claim that all work is done, and SHALL NOT use internal terms such as "Retained work".

#### Scenario: A failed step

- **GIVEN** Research failed on one job and nothing else is running
- **WHEN** the masthead summary renders
- **THEN** it reads "Research failed · 1", using the Failed glyph.

#### Scenario: Nothing running

- **GIVEN** a batch with no step working, waiting or failed
- **WHEN** the masthead summary renders
- **THEN** it reads the batch name with "no agents working", not "Retained work · ready" or "all done".

#### Scenario: An incomplete read

- **GIVEN** a truncated, stale or unavailable work read
- **WHEN** the masthead summary renders
- **THEN** it says "Updating…" or "Status unavailable" rather than "no agents working".

#### Scenario: Waiting and failed at once

- **GIVEN** Examine waiting for the operator and Research failed
- **WHEN** the masthead summary renders
- **THEN** it names the failure first ("Research failed · 1") and still shows the waiting count.
