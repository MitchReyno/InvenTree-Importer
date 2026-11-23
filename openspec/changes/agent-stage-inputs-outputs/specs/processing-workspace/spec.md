## MODIFIED Requirements

### Requirement: Step page pattern

Each step page SHALL show the step's outputs: readings, sources, crops or matches. Corrections on the page apply to every lot that used that output. The page SHALL also show the step's questions and its sessions, with a session drawer that holds the status timeline, the open question and chat. A step without sessions, such as Match, SHALL show its questions on the page instead of a session drawer. Step pages SHALL link values to Review and evidence to Capture rather than editing lots themselves.

#### Scenario: Correct a reading

- **GIVEN** Examine shows a handwriting reading used by one lot
- **WHEN** the operator corrects it
- **THEN** the correction shows as “Your edit”, the affected lot is marked for re-examination, and other lots are unchanged.

#### Scenario: Session drawer

- **GIVEN** a running session on a step page or the Overview
- **WHEN** the operator opens it
- **THEN** a drawer shows its status timeline, its open question and a chat, and closing it returns to the page.

## REMOVED Requirements

### Requirement: Inventory step page

**Reason**: The Inventory agent session is replaced by the app's Match step (processing-match).

**Migration**: Processing › Match replaces Processing › Inventory; retained Inventory jobs stay readable from the session list.

### Requirement: Inventory session drawer

**Reason**: No Inventory sessions are queued for new work.

**Migration**: Retained Inventory sessions open in the ordinary session drawer.

## ADDED Requirements

### Requirement: Processing › Match

Processing SHALL have a Match step listing each lot with what it matched by, its result (exact, possible, already imported, identifying, decided, new) and what runs in which mode, with an Answer for open match questions and Check InvenTree again. Match has no sessions, so its step page SHALL show the match question and candidates where other steps show a session drawer.

#### Scenario: A batch mid-way

- **GIVEN** a batch with one exact match awaiting an answer, one reel identifying and one lot decided as add stock
- **WHEN** the operator opens Processing › Match
- **THEN** the three rows read "Research and Images wait for you", "Research identifying · Images waits" and "Research skipped · stock photo".

### Requirement: Images step shows proposed crops

Processing › Images SHALL show each lot's proposed crops as the app's renderings of the Images recipes, each with its role (Part image, stock image, extra), source, region, adjustments and flags, and SHALL offer confirming them, asking Images to redo one, and cropping in Capture. Nothing SHALL be attached until confirmed.

#### Scenario: Confirm images

- **GIVEN** an Images proposal with a Part image, a stock image and an extra flagged soft
- **WHEN** the operator confirms the Part image and the stock image
- **THEN** both become derived versions selected for the Part and the stock, and the extra stays unselected.

### Requirement: The brief on the session page

A session's page SHALL show the brief it started from as the first, collapsible item of its conversation, with the operator's corrections marked as theirs.

#### Scenario: See what Research started from

- **GIVEN** a Research session that started after a reading correction and an answered question
- **WHEN** the operator opens its page
- **THEN** the first item summarises Examine's findings, the operator's facts and the questions already asked, and expanding it shows the correction.
