## MODIFIED Requirements

### Requirement: Session tool boundary

A `native-agent/2` session SHALL reach the application only through an app-owned tool server scoped to that session. The tool server SHALL offer exactly these tools:

- status
- read_batch, record_observation, propose_lot and regroup (the Examine lead session only)
- propose
- ask
- reply
- fetch_evidence
- read_inbox
- read_lot (lot sessions only: Research, Images and Inventory)

The session SHALL have no shell, filesystem, web, arbitrary code execution, collaboration, image generation, arbitrary MCP, inventory-write or approval tools. Codex MAY expose only the previously accepted inert exceptions list_mcp_resources, list_mcp_resource_templates, read_mcp_resource and request_user_input: the intake server SHALL expose no resources and server-initiated requests SHALL be refused. User skill catalogues and deferred callable tools outside this boundary MUST NOT be available.

#### Scenario: Session starts with only app tools

- **GIVEN** a queued `native-agent/2` attempt for Claude or Codex
- **WHEN** the adapter starts the provider session
- **THEN** the adapter admits only a provider version covered by offline full-surface qualification, verifies the required effective configuration and scoped MCP tools before each fresh or resumed turn, and refuses unknown versions or configuration drift. Runtime checks reject forbidden tool events. Offline qualification does not attest the exact tool list of each subscription request.

#### Scenario: Wrapped or deferred tools

- **GIVEN** a provider exposes exec-wrapped intake tools or a deferred advisor tool
- **WHEN** a fresh or resumed turn is admitted
- **THEN** that configuration fails offline qualification or is refused by admission/runtime checks; a runtime refusal does not undo an already executed action. An incomplete init list alone is not qualification evidence.

## ADDED Requirements

### Requirement: Lot sessions start from a hand-off brief

A lot session SHALL start from a brief of its lot, sealed into its input. The brief SHALL contain Examine's current identity proposal with its ID, the lot's observations (region, readings with source type and confidence, visible count, description), the human-provided facts about the lot, its Part or the batch, the questions already asked about them with their answers, and the lot's evidence with the regions Examine used. Human-provided facts SHALL be marked as human.

#### Scenario: Research starts with Examine's findings

- **GIVEN** Examine identified a lot as ECS-160-20-4X from a photo region read as "16.000 ECS 2338" and slip line 4
- **WHEN** the lot's Research session starts
- **THEN** its opening holds the identity with its proposal ID, both observations with their readings and regions, and the evidence list, and Research can rely on the identity and cite each observation.

#### Scenario: A corrected transcription

- **GIVEN** the operator corrected the region's reading to "16.000 ECS 2348" before Research started
- **WHEN** Research starts
- **THEN** the brief shows the corrected reading marked as the operator's correction, with Examine's reading when it is retained.

#### Scenario: Brief over budget

- **GIVEN** a lot whose observations exceed the brief's size budget
- **WHEN** the session starts
- **THEN** the opening holds a summary of the observations and says that read_lot returns the rest, and nothing is silently dropped.

### Requirement: Human facts take precedence

A lot session's instructions SHALL weigh human-provided facts above the evidence as the agent reads it, that evidence above Examine's readings, and those above web sources. When the evidence or a source contradicts a human fact, the session SHALL ask once, citing the conflict, and SHALL NOT replace the human value in a proposal while the question is open.

#### Scenario: Doubting a correction

- **GIVEN** an operator-corrected reading that a datasheet appears to contradict
- **WHEN** Research proposes
- **THEN** its proposal uses the operator's value or asks one question naming the reading, the datasheet and the conflict, and it does not propose the datasheet's value as if the correction did not exist.

### Requirement: Questions are not asked twice

`ask` SHALL return the existing question, without storing a new one, when an open or answered question already covers the same subject and an overlapping set of fields, unless the new question names evidence or a conflict the earlier one did not cite. The brief's "already asked" list and the instructions SHALL tell the agent not to re-ask.

#### Scenario: Examine already asked

- **GIVEN** Examine asked "Is the crystal on the slip the one in the bag?" about identity and quantity, and the operator answered "Yes"
- **WHEN** Research asks whether the slip line matches the bagged crystal
- **THEN** ask returns the answered question and its answer, and Needs you shows no new question.

#### Scenario: New evidence justifies asking

- **GIVEN** the same answered question, and a new photo showing a second crystal
- **WHEN** Research asks again naming that photo as new evidence
- **THEN** the question is stored and shown.

### Requirement: Lot sessions can re-read their brief

`read_lot` SHALL return the current brief of the session's own lot, in pages when it exceeds the budget, reflecting corrections, answers and revisions since the session started. It SHALL refuse any other lot.

#### Scenario: Resumed after a correction

- **GIVEN** a Research session resumed after the operator corrected a reading
- **WHEN** it calls read_lot
- **THEN** the result shows the corrected reading marked as the operator's, with the brief's current revision.
