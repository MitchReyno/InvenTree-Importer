## ADDED Requirements

### Requirement: The summary names what needs attention

The masthead's workflow summary SHALL name the step and how many lots or sessions need attention when something failed or waits for the operator, such as "Research failed · 1 lot", and SHALL say "All done" with the batch name when nothing remains. It SHALL NOT use internal terms such as "Retained work".

#### Scenario: A failed step

- **GIVEN** Research failed on one lot and nothing else is running
- **WHEN** the masthead summary renders
- **THEN** it reads "Research failed · 1 lot", using the Failed glyph.

#### Scenario: Everything done

- **GIVEN** a batch whose steps are all Done
- **WHEN** the masthead summary renders
- **THEN** it reads the batch name with "all done", not "Retained work · ready".
