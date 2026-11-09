# Capability delta

## ADDED Requirements

### Requirement: Tree view keeps the lot list

Changes › Ready to add SHALL keep "Lots to include" beside "What will change" in both the By type and Tree views, stacking them at narrow widths. Unticking a lot SHALL update the tree beside it. Ready-to-add lot rows SHALL show a location only when it differs from the batch default.

#### Scenario: Untick a lot in Tree view

- **GIVEN** the Tree view with five lots ticked
- **WHEN** the operator unticks packet A
- **THEN** the lot list stays visible on the left, and packet A's stock item in the tree shows "Not ticked"
