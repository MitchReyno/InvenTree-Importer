## ADDED Requirements

### Requirement: The brief on the session page

A lot session's page SHALL show the brief the session started from as the first item of its conversation, collapsible, with sections for Examine's identity, the observations, the operator's facts, the questions already asked and the evidence. Operator corrections SHALL show the corrected value marked as theirs, with the earlier reading struck through where retained.

#### Scenario: See what Research started from

- **GIVEN** a Research session that started after a reading correction and an answered question
- **WHEN** the operator opens its page
- **THEN** the first item reads "Started from Examine's findings · 2 observations · 2 of your facts · 1 question already asked", and expanding it shows the correction and the answered question.
