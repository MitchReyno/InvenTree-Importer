# Capability delta

## ADDED Requirements

### Requirement: Removed evidence blocks approval

Preparation SHALL skip removed evidence. Approval SHALL refuse a preparation that cites or attaches a removed version with `approval_evidence_removed` (409), and SHALL NOT pin it.

#### Scenario: Preparation made before a delete

- **GIVEN** a preparation that attaches a photo, which is then removed
- **WHEN** the operator approves that preparation
- **THEN** approval is refused with `approval_evidence_removed`, nothing is pinned, and the preparation shows as stale
