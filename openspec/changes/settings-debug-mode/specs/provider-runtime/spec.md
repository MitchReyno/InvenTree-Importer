# Capability delta

## MODIFIED Requirements

### Requirement: Provider default sealed at queue time

No provider or model SHALL be selected implicitly: queuing a `native-agent/1` attempt without a saved Agent settings default MUST fail with `agent_default_required`. The saved default is a default provider that is on.

**Resolution.** Each attempt SHALL seal the provider, authentication mode and model resolved for its stage, plus the settings revision it read:

- **The step's own choice.** Used when the step names a provider that is on and one of that provider's models. The authentication mode is the one saved for that provider.
- **Otherwise the default.** The default provider, with its authentication mode and default model.

Later settings changes SHALL neither rewrite nor invalidate a sealed attempt.

**Settings writes.** Writes SHALL compare the expected revision and fail with `revision_conflict` (412) when it moved on. A write SHALL fail with `invalid_agent_settings` (422) and change nothing when any of these holds:

- no provider is on;
- the default provider is off;
- a provider's default model isn't one of its models;
- a step names a provider that is off, or a model that provider doesn't offer.

#### Scenario: No default saved

- **GIVEN** the `native-agent/1` profile and no saved Agent settings
- **WHEN** the operator starts Processing
- **THEN** the start fails with `agent_default_required` and nothing is queued.

#### Scenario: Default changed after queuing

- **GIVEN** a queued attempt sealed with Codex and model M
- **WHEN** the default changes to Claude
- **THEN** the queued attempt still runs with Codex and model M, and only new attempts use Claude.

#### Scenario: Steps on different providers

- **GIVEN** Claude on with subscription sign-in and default model M, Codex on with API-key sign-in, the default provider Claude, and Research set to Codex model G
- **WHEN** a Research attempt and an Images attempt are queued
- **THEN** the Research attempt is sealed with Codex, API key and G, the Images attempt with Claude, subscription and M, and both with the same settings revision

#### Scenario: Invalid settings refused

- **GIVEN** a settings write with Codex off and Examine set to a Codex model
- **WHEN** it reaches the server
- **THEN** it fails with `invalid_agent_settings`, and the saved settings and revision are unchanged

#### Scenario: Existing settings carried over

- **GIVEN** settings saved before this change with provider Claude, subscription and model M
- **WHEN** the migration runs
- **THEN** Claude is on with subscription and default model M, Codex is off, Claude is the default provider, every step is "Default", and the revision is unchanged
