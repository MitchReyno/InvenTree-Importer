## ADDED Requirements

### Requirement: Agent values are proposed until confirmed

Values from Examine's identity and Research's output SHALL fill an agent-made Part's spec as proposed values, each showing its stage and source, until the operator confirms them. They SHALL NOT overwrite operator values. Each field SHALL come from the stage that owns it.

#### Scenario: Confirm a proposed parameter

- **GIVEN** Research proposed a 16 MHz frequency from the datasheet for an agent-made crystal Part
- **WHEN** the operator opens the Part in Review › Records
- **THEN** the frequency shows as proposed by Research with its source, and confirming it makes it the Part's value.
