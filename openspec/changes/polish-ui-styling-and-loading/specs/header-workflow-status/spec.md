## ADDED Requirements

### Requirement: The summary names what needs attention

The masthead's workflow summary SHALL name the step and how many lots or sessions need attention when something failed or waits for the operator, such as "Research failed · 1 lot". It SHALL say "All done" with the batch name only from a fresh, complete read showing every applicable step of that batch done. It SHALL NOT use internal terms such as "Retained work".

#### Scenario: A failed step

- **GIVEN** Research failed on one lot and nothing else is running
- **WHEN** the masthead summary renders
- **THEN** it reads "Research failed · 1 lot", using the Failed glyph.

#### Scenario: Everything done

- **GIVEN** a fresh, complete read in which every applicable step of the batch is done
- **WHEN** the masthead summary renders
- **THEN** it reads the batch name with "all done", not "Retained work · ready".

#### Scenario: Not enough evidence for "All done"

- **GIVEN** a batch that hasn't started processing, a truncated or stale work read, or an unavailable read
- **WHEN** the masthead summary renders
- **THEN** it says what is known ("Not started", "Updating…" or "Status unavailable") and never "All done".

#### Scenario: Waiting and failed at once

- **GIVEN** Examine waiting for the operator and Research failed
- **WHEN** the masthead summary renders
- **THEN** it names the failure first ("Research failed · 1 lot") and still shows the waiting count.
