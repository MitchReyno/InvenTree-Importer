# Capability delta

## Purpose

One batch-level Examine lead session turns captured evidence into proposed lots, so the operator no longer enters lots by hand. It finds observations (items seen in regions of photos, or lines of documents), groups them into lots and identifies each lot from all its observations, looping until the lots are stable. A photo can feed several lots, and a lot can draw on several photos. Proposed lots appear live, and the operator keeps control through direct edits.

## ADDED Requirements

### Requirement: One Examine lead session per batch

When a batch has ready evidence that no observation covers, and no evidence has become ready for a quiet period, the system SHALL queue one Examine lead session for the batch. The default quiet period is 20 seconds. At most one lead session per batch SHALL be active or queued. It SHALL NOT start for an archived batch, or when no agent default is saved. A finished lead session SHALL be resumed, not replaced, when new work arrives for it.

#### Scenario: Photos finish preparing

- **GIVEN** a batch with six ready photos and no lots
- **WHEN** the quiet period passes after the last preview is ready
- **THEN** exactly one Examine lead session is queued for the batch, and Processing and Capture show it.

#### Scenario: More photos arrive during the quiet period

- **GIVEN** a pending quiet period
- **WHEN** another photo becomes ready
- **THEN** the quiet period restarts, and no second lead session is queued.

### Requirement: Observations with regions

The lead session SHALL record each item it sees as an observation. An observation SHALL reference one evidence version and a region: a normalised rectangle on a photo or page, or a line range of a document. It SHALL carry what the region shows: markings and label text with citations, and an optional visible count. Regions SHALL be validated against the evidence version's dimensions, and the region's crop SHALL be retrievable through the media boundary.

#### Scenario: One photo, three items

- **GIVEN** a photo showing a bag of diodes, a crystal and a strip of LEDs
- **WHEN** the lead session examines it
- **THEN** three observations are recorded on that photo, each with its own region and readings.

#### Scenario: Region outside the image

- **GIVEN** a proposed observation whose region extends beyond the evidence version's bounds
- **WHEN** the tool server validates it
- **THEN** it is refused with a validation error, and no observation is recorded.

### Requirement: Lots group observations

A lot SHALL be formed from one or more observations of the same physical thing. The lead session SHALL group observations by identity, physical cues (same bag, same date code) and the operator's group and evidence notes. Evidence notes and groups SHALL be treated as hints, not as lot boundaries. A lot's evidence links SHALL be derived from its observations, so one file may support several lots and one lot several files.

#### Scenario: Front and back of one packet

- **GIVEN** two photos showing the front and the back of one resistor packet
- **WHEN** the lead session groups observations
- **THEN** one lot is formed from both observations, and it links both photos.

#### Scenario: Same MPN, different date codes

- **GIVEN** two packets with the same MPN but different date codes
- **WHEN** the lead session groups observations
- **THEN** two lots are formed, and they share one proposed Part.

### Requirement: Quantity without double counting

A lot's quantity proposal SHALL state its basis: the observations or document lines it counted, and any observations it treated as the same physical items. Observations of the same items SHALL NOT be added together. The proposal SHALL remain an estimate, attributed to the session, until the operator accepts or replaces it.

#### Scenario: Bag seen in two photos

- **GIVEN** a lot with a packet label reading 500 and a second photo of the same bag
- **WHEN** the quantity is proposed
- **THEN** it is 500 with the basis “label · same bag in two photos”, not 1000.

### Requirement: Live AI-proposed draft lots

Each lot the lead session forms SHALL be created at once as a draft lot labelled AI-proposed, with its observations, an optional estimated quantity and an optional shared Part. Draft lots SHALL appear on Capture and Review while the lead session is still running.

#### Scenario: Watching lots appear

- **GIVEN** a running lead session
- **WHEN** it forms its first two lots
- **THEN** both appear on Review, marked AI-proposed with their observations, before the session finishes.

#### Scenario: Stale revision while forming

- **GIVEN** the operator saved a capture edit after the lead session read the batch
- **WHEN** the session proposes a lot touching the edited evidence
- **THEN** the tool call returns a stale-revision result with current state. The agent re-plans, and no lot is created from the stale view.

### Requirement: Agent-attributed lot writes stay within draft authority

The system SHALL record each agent-created observation, lot, observation link and Part link as a capture revision attributed to the agent session. Agent writes MUST NOT set counted quantities or other human-only values, approve anything, or bypass Review before inventory effects.

#### Scenario: Estimated count only

- **GIVEN** the lead session proposes a lot with a count of 50
- **WHEN** the lot is created
- **THEN** its quantity is an estimated suggestion attributed to the session, and Review still requires the operator to accept or replace it before approval.

### Requirement: Human edits take precedence

A lot SHALL be marked as edited by the operator once they change its label, observations, Part, quantity or context, or merge, split or retire it. An observation SHALL be marked as edited once the operator moves, adjusts or creates its region. The lead session MUST NOT change, relink or retire an edited lot or observation. It MAY propose adding observations to an edited lot only as a suggestion that the operator accepts.

#### Scenario: Operator split is kept

- **GIVEN** the operator split an AI-proposed lot into two
- **WHEN** the lead session later handles new evidence
- **THEN** both resulting lots keep their observations, and the session places new observations elsewhere or suggests them for those lots.

#### Scenario: Operator moves a region

- **GIVEN** the operator moved an observation from one AI lot to another
- **WHEN** the lead session revises its grouping
- **THEN** the observation stays where the operator put it.

### Requirement: New evidence wakes the lead session

When evidence becomes ready in a batch that already has a lead session, the system SHALL deliver an evidence item to that session, resuming it if it has finished. The session SHALL examine only the new evidence and then either add observations to an existing AI lot, form a new draft lot, or record the observation unassigned with a question. Adding an observation to a lot SHALL notify that lot's Research and Images sessions, as defined by the stage pipeline.

#### Scenario: Back of an existing tape

- **GIVEN** an AI-proposed LED lot whose Research has finished
- **WHEN** the operator adds a photo of the back of the same tape
- **THEN** the lead session records an observation on it, adds it to the LED lot, and the lot's Research and Images sessions receive a new-evidence notice, without other lots changing.
