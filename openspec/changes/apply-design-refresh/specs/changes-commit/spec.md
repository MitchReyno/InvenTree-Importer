# Capability delta

## MODIFIED Requirements

### Requirement: Tree view

"What will change" SHALL offer a Tree view of the same preparation: Category › Part, with the Part's parameters, manufacturer part, supplier part, stock items (with location) and images under it, grouped by category or by location. Every node SHALL show New, Update, Exists or Choose, and the tree SHALL follow the WAI-ARIA tree keyboard pattern. "Lots to include" SHALL stay beside the tree, as in the By type view, stacking above it at narrow widths, and unticking a lot SHALL update the tree.

#### Scenario: Keyboard through the tree

- **GIVEN** the Tree view grouped by category
- **WHEN** the operator uses the arrow keys, Home and End
- **THEN** focus moves between nodes and expands or collapses them, and each node's state is announced as text.

#### Scenario: Untick a lot in Tree view

- **GIVEN** the Tree view with five lots ticked
- **WHEN** the operator unticks packet A
- **THEN** the lot list stays visible beside the tree, and packet A's stock item shows "Not ticked"

## ADDED Requirements

### Requirement: Lot rows name only an overriding location

Ready-to-add lot rows SHALL show a location only when it differs from the batch default.

#### Scenario: Default location omitted

- **GIVEN** four lots going to the batch default and one to Bench bin B3
- **WHEN** "Lots to include" renders
- **THEN** only the Bench bin B3 lot names a location
