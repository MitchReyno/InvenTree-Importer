# Capability delta

## Purpose

A batch-level agent sorts captured evidence into proposed physical lots and shared Parts. The operator no longer has to enter lots by hand. Proposed lots appear live, and the operator keeps control through the existing merge, split and edit controls.

## ADDED Requirements

### Requirement: Automatic batch sorting

When a batch has ready evidence not yet assigned to any lot, and no evidence has become ready for a quiet period, the system SHALL queue one Sort session for that batch. The default quiet period is 20 seconds. At most one Sort session per batch SHALL be active or queued. Sort SHALL NOT start for an archived batch, or when no agent default is saved.

#### Scenario: Photos finish preparing

- **GIVEN** a batch with six ready photos and no lots
- **WHEN** the quiet period passes after the last preview is ready
- **THEN** exactly one Sort session is queued for the batch, and the Processing and Capture views show it.

#### Scenario: More photos arrive during the quiet period

- **GIVEN** a pending quiet period
- **WHEN** another photo becomes ready
- **THEN** the quiet period restarts, and a second Sort session is not queued.

### Requirement: Live AI-proposed draft lots

Each lot proposal from Sort SHALL be created at once as a draft lot labelled AI-proposed. A lot proposal carries a label, evidence links, an optional estimated count and an optional shared Part. Draft lots SHALL appear on Capture and Review while Sort is still running, and each SHALL queue its own Examine work.

#### Scenario: Watching lots appear

- **GIVEN** a running Sort session
- **WHEN** it proposes its first two lots
- **THEN** both appear on Review, marked AI-proposed with their linked photos, before Sort finishes.

#### Scenario: Stale revision while proposing

- **GIVEN** the operator saved a capture edit after Sort read the batch
- **WHEN** Sort proposes a lot touching the edited evidence
- **THEN** the tool call returns a stale-revision result with current state. The agent re-plans, and no lot is created from the stale view.

### Requirement: Agent-attributed lot writes stay within draft authority

The system SHALL record each agent-created lot, evidence link and Part link as a capture revision attributed to the agent session. AI-proposed lots MUST NOT set counted quantities or other human-only values, approve anything, or bypass Review before inventory effects.

#### Scenario: Estimated count only

- **GIVEN** Sort proposes a lot with a count of 50
- **WHEN** the lot is created
- **THEN** its quantity is an estimated suggestion attributed to the session, and Review still requires the operator to accept or replace it before approval.

### Requirement: Human edits take precedence

A lot SHALL be marked as edited by the operator once they change its label, links, Part, quantity or context, or merge, split or retire it. Sort MUST NOT change, relink or retire a lot edited by the operator. Sort MAY propose adding new evidence to such a lot only as a suggestion that the operator accepts. Retired or merged AI lots SHALL follow the existing retirement rules.

#### Scenario: Operator split is kept

- **GIVEN** the operator split an AI-proposed lot into two
- **WHEN** Sort later runs again for new evidence
- **THEN** both resulting lots keep their links, and Sort places the new evidence elsewhere or suggests it for them.

### Requirement: Incremental placement of new evidence

When evidence becomes ready in a batch that already has lots, the system SHALL notify the active Sort session, or queue a Sort session if none is active, to place only the new evidence. Sort places it into an existing AI-proposed lot or a new draft lot, or leaves it unassigned with a question. Placing evidence into a lot SHALL notify that lot's active sessions, as defined by the stage pipeline.

#### Scenario: Extra photo of an existing lot

- **GIVEN** an AI-proposed lot whose Examine session has finished
- **WHEN** the operator adds another photo of the same bag
- **THEN** Sort links it to that lot, and the lot's Examine session receives a new-evidence notice without other lots changing.
