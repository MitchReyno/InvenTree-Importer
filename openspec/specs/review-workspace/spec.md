# review-workspace Specification

## Purpose

Review is where the operator checks and corrects lots. Each lot is shown beside its own evidence, its problems are routed to the screen that can fix them, and a map shows how the evidence became lots.

## Requirements

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

#### Scenario: Lot details with the agent line

- **GIVEN** a lot that a Research session is working on
- **WHEN** it is selected
- **THEN** details show “Research ·” with the session's latest status line and state, and a link to Research in Processing; a lot no session works on shows no agent line.

### Requirement: Evidence pane shows the lot's own evidence

The evidence pane SHALL show the evidence that supports the selected lot. Where observations with regions exist, it SHALL show the lot's crops from each file. Otherwise it SHALL show the lot's linked files. Group and photo notes SHALL appear beside the evidence.

#### Scenario: Lot drawn from two files

- **GIVEN** a lot supported by a close-up photo and a packing-slip line
- **WHEN** it is selected
- **THEN** both are shown with labels saying what each shows, without the operator pressing Inspect first.

#### Scenario: Evidence pane with region crops

- **GIVEN** a lot formed from two regions of one photo and one region of another
- **WHEN** it is selected
- **THEN** the pane shows its three crops, each with its reading, without opening the files.

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

#### Scenario: Map at region level with its instruction field

- **GIVEN** observations on the batch's photos and a running Examine lead session
- **WHEN** the Map opens
- **THEN** each file lists its regions with the lot each supports, a file that supports a lot only through a region is not flagged as unused, and an instruction field sends free text to the Examine lead session.

#### Scenario: Map before agent sessions

- **GIVEN** a profile without agent sessions or observations
- **WHEN** the Map opens
- **THEN** it shows file-level links and the direct edits, and no instruction field appears.

### Requirement: Map drawing and region edits

The Map SHALL draw its links as connectors between evidence and lot cards: solid where a region or file shows the lot, dotted where a document line or an inherited link supports it, and highlighted for the selected photo. Each link SHALL also be available as text. At region level, moving evidence and creating a lot from it SHALL act on a region, and the operator SHALL be able to adjust or add a region on the selected photo.

#### Scenario: Links drawn between evidence and lots

- **GIVEN** a photo with three regions supporting three lots, and a packing-slip line supporting one of them
- **WHEN** the operator selects that photo on the Map
- **THEN** a solid connector joins each region to its lot and a dotted one joins the slip line to its lot, the photo's three connectors and lot cards are highlighted, and a caption explains the line styles.

#### Scenario: Move a region to another lot

- **GIVEN** a region linked to the wrong lot
- **WHEN** the operator moves that region to another lot
- **THEN** only that region's link changes, the photo's other regions keep their lots, and both lots show the change.

### Requirement: Same physical item

On the Map, the operator SHALL be able to mark an observation as the same physical item as another, such as one bag photographed twice. The two observations SHALL then count once towards their lot's quantity, both SHALL stay linked as evidence, and the mark SHALL be removable. Marking observations of different lots SHALL be refused with the reason.

#### Scenario: One bag seen twice

- **GIVEN** a lot whose quantity counts two observations that show the same bag of 200
- **WHEN** the operator marks the second as the same item as the first
- **THEN** the lot's quantity counts the bag once, both photos stay linked to the lot, and removing the mark restores the earlier count.

### Requirement: Exclude a lot

The operator SHALL be able to exclude a lot from the batch with a reason, and include it again. An excluded lot SHALL show the Excluded state and its reason in Lots and the Table, SHALL appear under the Excluded filter, SHALL NOT be offered in Ready to add, and SHALL be listed under Not included in Changes with its reason. Excluding SHALL keep the lot's evidence and values unchanged.

#### Scenario: Exclude and include again

- **GIVEN** a lot of salvaged resistors the operator does not want in InvenTree
- **WHEN** the operator excludes it with the reason "Salvage, not stocked"
- **THEN** it shows Excluded with that reason, is not offered in Ready to add and is listed under Not included; including it again restores its earlier state, values and evidence.

