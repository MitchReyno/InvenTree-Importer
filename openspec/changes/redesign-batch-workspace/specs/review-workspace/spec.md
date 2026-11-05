# Capability delta

## Purpose

Review is where the operator checks and corrects lots. Each lot is shown beside its own evidence, its problems are routed to the screen that can fix them, and a map shows how the evidence became lots.

## ADDED Requirements

### Requirement: Lots workspace and table

Review › Lots SHALL offer a Workspace view and a Table view of the same list, sharing selection and filters. Filters SHALL cover needs review, needs answer, blocking, warnings, changed since review, reviewed and excluded. Table bulk edits SHALL name their scope.

#### Scenario: Switch lens keeps place

- **GIVEN** three lots selected in the Workspace with the Warnings filter on
- **WHEN** the operator switches to Table
- **THEN** the same three lots are selected under the same filter.

### Requirement: Lot details

The Workspace SHALL have three panes: a lot list grouped by state, the lot's evidence, and details. Details SHALL show the record chain, problems, values with source chips, the lot's agent line, Exclude, and Mark reviewed, which is disabled with a stated reason while blocking problems remain.

#### Scenario: Blocked lot

- **GIVEN** a lot with two blocking problems
- **WHEN** it is selected
- **THEN** Mark reviewed is disabled with “Fix 2 blocking problems first”, and each problem shows its fix actions.

### Requirement: Evidence pane shows the lot's own evidence

The evidence pane SHALL show the evidence that supports the selected lot. Where observations with regions exist, it SHALL show the lot's crops from each file. Otherwise it SHALL show the lot's linked files. Group and photo notes SHALL appear beside the evidence.

#### Scenario: Lot drawn from two files

- **GIVEN** a lot supported by a close-up photo and a packing-slip line
- **WHEN** it is selected
- **THEN** both are shown with labels saying what each shows, without the operator pressing Inspect first.

### Requirement: Problems route to their owner

Each problem SHALL carry fix actions that go to the screen owning the fix:

- an inline answer for the lot's open question;
- a value edit on the lot itself;
- a record decision in Review › Records;
- a reading in Processing › Examine;
- a crop in Processing › Images.

#### Scenario: Part not chosen

- **GIVEN** a lot blocked by “Part not chosen”
- **WHEN** the operator chooses “Answer here”
- **THEN** the answer is queued to the asking session and the problem updates when the answer is accepted.

### Requirement: Review map

Review › Map SHALL show how evidence became lots:

- evidence on one side and lots on the other, with links between them;
- flags for evidence used by no lot and for lots resting on a single piece of evidence;
- direct edits: merge, split, move evidence to a lot, and create a lot from evidence;
- a free-text instruction sent to the lot-forming agent, shown only when agent sessions exist.

Links SHALL be drawn at region level when observations exist, and at file level until then.

#### Scenario: Unused evidence

- **GIVEN** a photo that supports no lot
- **WHEN** the Map opens
- **THEN** that photo is flagged, and “New lot from this” creates a draft lot attributed to the operator.

#### Scenario: Map before agent sessions

- **GIVEN** a profile without agent sessions or observations
- **WHEN** the Map opens
- **THEN** it shows file-level links and the direct edits, and no instruction field appears.
