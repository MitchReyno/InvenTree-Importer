# Capability delta

## MODIFIED Requirements

### Requirement: Provenance on demand

Screens SHALL use bench language and InvenTree nouns. These internal values SHALL appear only when debug mode is on, in a marked debug block or the screen's Debug panel, and never inline in normal content: IDs, digests, revisions, versions, actor identities and raw state codes. InvenTree record numbers and links are operator-facing and are not internal values. Uncertainty SHALL be described in words ("Likely — check", "Sources disagree"), never as a percentage.

#### Scenario: No internal identifiers inline

- **GIVEN** a Capture evidence tile and a Review lot with debug mode off
- **WHEN** they render normally, and when the evidence viewer is opened
- **THEN** no evidence ID, original digest, revision number or actor UUID is shown

#### Scenario: Identifiers in debug mode

- **GIVEN** the same tile and lot with debug mode on
- **WHEN** they render
- **THEN** the evidence ID, digest, revision and actor appear in marked debug blocks, set apart from the operator content
