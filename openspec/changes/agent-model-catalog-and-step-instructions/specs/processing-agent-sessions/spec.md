## ADDED Requirements

### Requirement: Step instructions sealed into each attempt

Each attempt of a step SHALL seal that step's saved instructions in its input when the input is sealed, and the session SHALL receive them as operator guidance for its step, after the app's own instructions, never as part of the profile or stage instruction bytes or their digests. A later save SHALL NOT change what a sealed attempt received; it SHALL reach that step's attempts sealed after it.

#### Scenario: Instructions reach a new Research session

- **GIVEN** Research's saved instructions "Open the manufacturer's own datasheet first."
- **WHEN** a Research session for a lot is queued and starts
- **THEN** its sealed input holds that text, its opening carries it as operator guidance for Research, and the profile's instruction digest is unchanged.

#### Scenario: Other steps don't receive them

- **GIVEN** instructions saved for Research only
- **WHEN** Examine and Images sessions start
- **THEN** neither input nor opening carries them.

#### Scenario: Edited while a session runs

- **GIVEN** a Research attempt sealed with text A, running or waiting for a slot
- **WHEN** the operator saves text B
- **THEN** that attempt and its resumed turns keep A, no inbox item is sent for the edit, and the next Research attempt sealed after the save receives B.

#### Scenario: A brief from the stage inputs change

- **GIVEN** a `bench-intake-input/7` attempt of Images with saved Images instructions
- **WHEN** its brief is sealed
- **THEN** the brief's operator-sourced material holds the text as "operator guidance for this step", outside the stage instruction pack and its digest.

#### Scenario: Retained inputs

- **GIVEN** an attempt sealed before this change, with no step instructions field
- **WHEN** it is claimed or resumed
- **THEN** it runs as it did, with no step guidance.

### Requirement: Sessions run at the sealed effort

Each attempt SHALL seal the effort resolved for its step with its model: the step's own effort with its own model, or the provider's default effort when the step uses the provider's default model. With an effort, a Claude turn SHALL pass `--effort <level>` and a Codex turn SHALL send it as `effort` on each `turn/start`. With none, nothing SHALL be sent. A later save SHALL NOT change a sealed attempt.

#### Scenario: Claude at High

- **GIVEN** Examine set to Claude Opus 5.5 at High
- **WHEN** an Examine session starts or resumes
- **THEN** the Claude CLI runs with `--model claude-opus-5-5 --effort high`.

#### Scenario: Codex at Default

- **GIVEN** Research set to Codex GPT-6.2-Sol with Effort Default
- **WHEN** its turns start
- **THEN** no `turn/start` carries an `effort` field.

#### Scenario: A step on Default

- **GIVEN** Images on Default and the Codex card's default model and effort set to GPT-6.2-Sol at Medium, with Codex the default provider
- **WHEN** an Images attempt is sealed
- **THEN** its sealed selection is Codex GPT-6.2-Sol at Medium.

#### Scenario: Unaccepted effort is still sent

- **GIVEN** an effort saved that the model's current list doesn't accept
- **WHEN** a session runs
- **THEN** the saved effort is sent as saved, and the provider's answer, accepting or refusing it, is the session's outcome.
