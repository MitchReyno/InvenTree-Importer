# Capability delta

## MODIFIED Requirements

### Requirement: Provider default sealed at queue time

No provider or model SHALL be selected implicitly: queuing a `native-agent/1` attempt without a saved Agent settings default MUST fail with `agent_default_required`.

**Sealing.** Each attempt SHALL seal what it read: the provider, the authentication mode, the model resolved for its stage and the settings revision. The resolved model is the stage's own model when Models per step sets one, and otherwise the default model. Later settings changes SHALL neither rewrite nor invalidate a sealed attempt.

**Settings writes.** Settings writes SHALL compare the expected revision and fail with `revision_conflict` (412) when it moved on. A saved per-step model SHALL be one offered for the saved provider. A write that pairs a per-step model with a provider that doesn't offer it SHALL fail with `invalid_stage_model` (422).

#### Scenario: No default saved

- **GIVEN** the `native-agent/1` profile and no saved Agent settings
- **WHEN** the operator starts Processing
- **THEN** the start fails with `agent_default_required` and nothing is queued.

#### Scenario: Default changed after queuing

- **GIVEN** a queued attempt sealed with Codex and model M
- **WHEN** the default changes to Claude
- **THEN** the queued attempt still runs with Codex and model M, and only new attempts use Claude.

#### Scenario: Per-step model sealed

- **GIVEN** the default model M and Images set to model S
- **WHEN** an Images attempt and a Research attempt are queued
- **THEN** the Images attempt is sealed with S and the Research attempt with M, each with the same settings revision

#### Scenario: Mismatched per-step model

- **GIVEN** a settings write with provider Codex and a Claude model for Examine
- **WHEN** it reaches the server
- **THEN** it fails with `invalid_stage_model`, and the saved settings and revision are unchanged
