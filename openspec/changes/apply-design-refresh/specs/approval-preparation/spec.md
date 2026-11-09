# Capability delta

## ADDED Requirements

### Requirement: Removed evidence blocks approval

Preparation SHALL skip removed evidence. Approval SHALL refuse a preparation that cites or attaches a removed version as stale, and SHALL NOT pin it.

#### Scenario: Preparation made before a delete

- **GIVEN** a preparation that attaches a photo, which is then removed
- **WHEN** the operator approves that preparation
- **THEN** approval is refused as stale and nothing is pinned
