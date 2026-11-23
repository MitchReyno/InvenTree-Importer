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

A session of `shared-vm-agent/4` or `synthetic-session/1` SHALL additionally offer its stage's tools from "Stage tool sets", and no others.

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

### Requirement: Stage tool sets

For `shared-vm-agent/4` and `synthetic-session/1`, the intake tool server SHALL add these tools to the common set:

- Examine: read_batch with full readings, inspect_region, match_logo and read_guide.
- Research: read_lot, read_vocabulary, match_logo and read_guide.
- Images: read_lot, inspect_region, preview_images, propose_images and read_guide.

This requirement does not change the guest built-in and web tools a shared VM profile adds outside the intake tool server.

#### Scenario: Images has no vocabulary

- **GIVEN** an Images session of `shared-vm-agent/4`
- **WHEN** admission compares its intake tool list
- **THEN** the list holds the common tools plus read_lot, read_guide, inspect_region, preview_images and propose_images, and nothing else.

### Requirement: Sessions start from a sealed brief

A session of `shared-vm-agent/4` or `synthetic-session/1` SHALL start from a brief sealed into its input: the batch and its instructions, the human-provided facts marked as human, the questions already asked about its subject, the evidence it may fetch with the regions earlier stages used, the lot's match state, and its stage's additions (see the stage contract in the design). The opening SHALL render it within its budget and say when `read_lot` or `read_batch` holds the rest.

#### Scenario: Research starts with Examine's findings

- **GIVEN** Examine identified a lot from a photo region read as "16.000 ECS 2338" and slip line 4
- **WHEN** the lot's Research session starts
- **THEN** its opening holds the identity with its id, both observations with their readings and regions, the operator's facts, the asked questions and the evidence list.

### Requirement: Typed stage outputs

For `shared-vm-agent/4` and `synthetic-session/1`, each agent stage SHALL publish only its own output kind: `examine-identity/1` for Examine, `research-identity/1` and `research/1` (each with match notes) for Research, and `images/1` for Images. Earlier profiles keep publishing their existing proposal versions. The server SHALL refuse a proposal of another kind, or one carrying fields the stage or its mode may not propose.

#### Scenario: Images can't research

- **GIVEN** an Images session
- **WHEN** it proposes a category or description
- **THEN** the proposal is refused with a correctable validation result naming the disallowed fields.

### Requirement: Human facts take precedence

Session instructions SHALL weigh human-provided facts above the evidence as the agent reads it, that evidence above earlier stages' readings, and those above web sources. When evidence contradicts a human fact, the session SHALL ask once, citing the conflict, and SHALL NOT replace the human value.

#### Scenario: Doubting a correction

- **GIVEN** an operator-corrected reading that a datasheet appears to contradict
- **WHEN** Research proposes
- **THEN** it uses the operator's value or asks one question naming the reading, the datasheet and the conflict.

### Requirement: Questions are not asked twice

`ask` SHALL return the existing question, storing nothing, when an open or answered question already covers the same subject and overlapping fields, unless the new question names evidence or a conflict the earlier one did not.

#### Scenario: Examine already asked

- **GIVEN** an answered question on the lot about identity and quantity
- **WHEN** Research asks about the same fields with no new evidence
- **THEN** ask returns the answered question and its answer, and nothing new appears in Needs you.

### Requirement: Image and logo tools run in the app

`inspect_region`, `preview_images` and `match_logo` SHALL run in the media decoder on the retained original the session may fetch, and return their images and results to the agent within the frame and image limits. `preview_images` SHALL render a recipe exactly as approval would derive it. `propose_images` SHALL publish only recipes over evidence the session may fetch.

#### Scenario: Preview then propose

- **GIVEN** an Images session with a photo of a single diode
- **WHEN** it previews a recipe with a quarter turn and a 3.5° straightening and then proposes it
- **THEN** the preview and the later derived crop are the same pixels, and the proposal names the source version and recipe.

### Requirement: Stage guides on demand

`read_guide` SHALL return named sections of the stage's guide, sealed with the profile, ported from the repository's skills (cropping rules, logo look-alikes, research sources and traps, transcription rules).

#### Scenario: Look-alike logos

- **GIVEN** an Examine session unsure between two similar maker's marks
- **WHEN** it calls read_guide for the logo look-alikes section
- **THEN** it receives that section's text, the same for every session of the profile.
