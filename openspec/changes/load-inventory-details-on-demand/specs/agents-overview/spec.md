## ADDED Requirements

### Requirement: Session pages supply their display labels

The global Agents list SHALL render group titles, subject names and eligible lot links from its scoped session-list pages without requesting individual Capture snapshots.

#### Scenario: Cold list and pagination

- **GIVEN** multiple authorized batches including a group with zero matches and rows for a live lot, retired lot and shared Part
- **WHEN** the operator opens Agents, changes its filter or loads another page
- **THEN** the groups retain their batch titles, returned rows show their available labels, only eligible lots receive lot links and the browser sends zero per-batch Capture reads
- **AND** a missing subject uses the existing fallback without broadening the lookup scope
