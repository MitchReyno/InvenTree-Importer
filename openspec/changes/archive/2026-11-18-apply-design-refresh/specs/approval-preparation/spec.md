# Capability delta

## ADDED Requirements

### Requirement: Removed evidence blocks approval

Preparation SHALL skip removed evidence. Approval SHALL refuse a preparation that cites or attaches a removed version with `approval_evidence_removed` (409), and SHALL NOT pin it.

#### Scenario: Preparation made before a delete

- **GIVEN** a preparation that attaches a photo, which is then removed
- **WHEN** the operator approves that preparation
- **THEN** approval is refused with `approval_evidence_removed`, nothing is pinned, and the preparation shows as stale

### Requirement: Removed evidence doesn't support a lot

The review and preparation gates SHALL NOT count a removed item as a lot's supporting evidence. A lot left with no present evidence SHALL raise the existing `no_supporting_evidence` warning.

#### Scenario: Sole evidence removed

- **GIVEN** a lot whose only evidence is one photo
- **WHEN** the photo is removed
- **THEN** the lot shows `no_supporting_evidence`, which the operator resolves by adding evidence, excluding the lot or accepting the warning
