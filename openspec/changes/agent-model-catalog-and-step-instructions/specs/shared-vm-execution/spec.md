## ADDED Requirements

### Requirement: Model lists read without a provider turn

For a shared-VM profile, the session worker SHALL read each signed-in provider's model list in the guest, from the pinned CLI with the credentials turns use, sending only the CLI's catalogue requests and no user message, or from the provider's models API with an API key, never with a subscription token. The read SHALL be bounded in time and size, and SHALL change no sign-in state.

#### Scenario: Codex with a ChatGPT sign-in

- **GIVEN** Codex signed in with ChatGPT in the guest
- **WHEN** the worker reads Codex's models
- **THEN** the guest answers from app-server `model/list` with each model's name, hidden flag, default effort and accepted efforts, no turn starts and the sign-in is unchanged.

#### Scenario: Claude with a subscription

- **GIVEN** a Claude subscription token saved in the guest
- **WHEN** the worker reads Claude's models
- **THEN** the guest starts the pinned Claude CLI, sends only `initialize`, reads `models[]` with each model's accepted effort levels, and stops it; no user message is sent.

#### Scenario: Claude with an API key

- **GIVEN** Claude set to an API key
- **WHEN** the worker reads Claude's models
- **THEN** the read calls Anthropic's models API with the key, and the subscription token is never sent there.

#### Scenario: Guest without the catalogue read

- **GIVEN** a guest image older than this change
- **WHEN** the worker asks it for a model list
- **THEN** the read is recorded as unavailable from an outdated guest, and Settings shows the last stored or built-in list.

#### Scenario: Oversized or slow answer

- **GIVEN** a guest answer over the catalogue frame limit, or none within the read's time limit
- **WHEN** the worker reads it
- **THEN** the read fails, the reader process is stopped, and the last good list is kept.
