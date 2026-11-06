# Capability delta

## Purpose

Changes is where the operator commits a batch to InvenTree and sees what happened. It shows everything that will change before approval and every outcome afterwards, using the existing preparation, frozen-plan and results authority.

## ADDED Requirements

### Requirement: Ready to add

Changes › Ready to add SHALL list reviewed lots (ticked by default, each can be unticked), lots left out with links to the matching Review filter, and “What will change in InvenTree”. The approval action SHALL name its scope (“Approve 5 lots and add to InvenTree”) and freeze exactly the shown preparation, as the current approval does. Values SHALL NOT be edited here; each row SHALL link to its record or lot in Review.

#### Scenario: Untick a lot

- **GIVEN** six ready lots
- **WHEN** the operator unticks one
- **THEN** a new preparation is made for five lots, the summary and button update, and approval stays disabled until that preparation is current.

### Requirement: By type view

“What will change” SHALL offer a By type view of the preparation, grouped as stock items, Parts, categories, companies, manufacturer parts, supplier parts, parameters, images and attachments, purchase order, and changes to existing records, each with counts and a New, Update or Exists state per row.

#### Scenario: Counts match the preparation

- **GIVEN** a preparation creating 15 records and updating 1
- **WHEN** By type renders
- **THEN** the group counts total 15 new and 1 update, matching the approve button's summary.

### Requirement: Tree view

“What will change” SHALL offer a Tree view of the same preparation: Category › Part, with the Part's parameters, manufacturer part, supplier part, stock items (with location) and images under it, grouped by category or by location. Every node SHALL show New, Update, Exists or Choose, and the tree SHALL follow the WAI-ARIA tree keyboard pattern.

#### Scenario: Keyboard through the tree

- **GIVEN** the Tree view grouped by category
- **WHEN** the operator uses the arrow keys, Home and End
- **THEN** focus moves between nodes and expands or collapses them, and each node's state is announced as text.

### Requirement: Added

Changes › Added SHALL show:

- an outcome strip;
- each approval run's records, with links into InvenTree;
- failures with their own fix: retry attachment; check by import reference for an uncertain result, never a plain retry that could duplicate stock; a value InvenTree rejected is named and linked to where it is set: its Part record or lot in Review, or its draft in Capture for a new location or supplier (re-sending a corrected value waits until the executor can settle a refused create);
- lots not included;
- new pending changes;
- an activity log.

The test-target note SHALL appear here and in the Ready to add footer only.

#### Scenario: Uncertain stock result

- **GIVEN** a stock item whose create result is unknown
- **WHEN** Added renders
- **THEN** it shows the item as being checked by its import reference, offers no create-again action, and updates when the check resolves.
