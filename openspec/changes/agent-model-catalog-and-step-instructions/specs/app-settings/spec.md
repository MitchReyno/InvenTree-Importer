## ADDED Requirements

### Requirement: Instructions for each step

Each agent step in "Provider and model per step" (Examine, Research and Images) SHALL have optional instructions of at most 1,000 characters, counted as typed characters, saved with Save and Discard like the other text settings. The count SHALL turn amber from 900. Typing SHALL stop at 1,000, and a paste SHALL be cut there with a message. Saving an empty box SHALL remove them. "Instructions for every new batch" SHALL stay as it is.

#### Scenario: Empty step

- **GIVEN** Examine has no instructions
- **WHEN** the step rows render
- **THEN** Examine shows one quiet "Instructions for Examine" button, which opens an empty box with focus in it.

#### Scenario: Save instructions for one step

- **GIVEN** the operator types "Open the manufacturer's own datasheet before any distributor page." into Research's box
- **WHEN** they choose Save
- **THEN** the text is saved with the settings revision check, the box shows it with "Read by new Research sessions, after the app's own rules." and a count of 67 / 1,000, and Save and Discard go away until it is edited again.

#### Scenario: Paste past the limit

- **GIVEN** Images' box holding 950 characters
- **WHEN** the operator pastes 200 more
- **THEN** the box holds the first 1,000, the count reads 1,000 / 1,000 in amber, and "1,000 characters is the most a step can hold. The pasted text was cut at 1,000." is announced.

#### Scenario: Too long from another client

- **GIVEN** a settings save carrying 1,001 characters for Research
- **WHEN** it reaches the server
- **THEN** it is refused as invalid agent settings, and nothing is saved.

#### Scenario: Clear the instructions

- **GIVEN** Research has saved instructions
- **WHEN** the operator empties the box and saves
- **THEN** Research has no instructions, and its row shows the "Instructions for Research" button again.

### Requirement: Models listed from each provider

Each model picker SHALL list the exact models the provider offers for its current sign-in, read from that provider and kept with the time and CLI version of the read, each shown by its name with the exact ID beside it and found by either. Aliases SHALL be folded into the model they stand for, and hidden models left out. Claude models of major version 4 or lower, or below Claude's newest listed major version, SHALL sit in a collapsed "Older models" group.

#### Scenario: Claude's models by name

- **GIVEN** Claude signed in with a subscription and a catalogue read at 09:12
- **WHEN** the operator opens Research's picker and types "son"
- **THEN** Claude lists "Sonnet 5.5" with `claude-sonnet-5-5` and "Sonnet 5" with `claude-sonnet-5`, the collapsed Older models group holds "Sonnet 4.6", and the card says "13 models · read from Claude Code in the agent VM today 09:12".

#### Scenario: Only older models listed

- **GIVEN** a Claude list holding only 4.x models
- **WHEN** a Claude picker opens
- **THEN** they all sit in the collapsed Older models group.

#### Scenario: Codex with an API key

- **GIVEN** Codex signed in with an API key whose models list includes only some of the catalogue built into the Codex version
- **WHEN** a Codex picker opens
- **THEN** it lists the built-in catalogue, and each model the key can't use says so and can still be chosen.

#### Scenario: An exact ID still works

- **GIVEN** a model the list doesn't include
- **WHEN** the operator types its exact ID
- **THEN** the picker still offers "Use “…” with Claude" after the model ID check, as before.

### Requirement: Model list states

Before a provider's first read lands, its picker SHALL show "Reading <provider>'s models…" and keep the saved choice by its ID. A failed read SHALL keep the last list with its time, an amber note in the list and "Try again". After a sign-in change, until a list read under it lands, the earlier list SHALL be marked as from an earlier sign-in and raise no warnings. With no read stored, the built-in list SHALL show, marked "Built-in list, may be out of date", with Effort only Default.

#### Scenario: First read

- **GIVEN** Codex signed in just now and no list stored
- **WHEN** a Codex picker opens
- **THEN** it says "Reading Codex's models…", shows the saved model by its ID, Effort keeps its saved value and waits for the list, and a typed exact ID is still accepted.

#### Scenario: Read failed

- **GIVEN** Claude's list read yesterday at 16:40 and today's read failed
- **WHEN** a Claude picker opens
- **THEN** it lists yesterday's models with "Couldn't read Claude's models just now. Showing the list from yesterday 16:40." and Try again, and no page banner shows.

#### Scenario: After a sign-in change

- **GIVEN** Claude's list read under one token, and a new token saved in the app's dialog
- **WHEN** a Claude picker or a Processing step page is open, or opens, before a read under the new token lands, or after that read failed
- **THEN** it marks the earlier list as from an earlier sign-in with its time, shows no "Not offered" or "Not accepted" warning, a reply read under the old token is never stored as current, and the views update without a reload once the new list lands.

#### Scenario: Sign-in changed outside the app

- **GIVEN** the Codex sign-in changed in the guest without the app's dialog
- **WHEN** 60 seconds pass
- **THEN** Codex's list is marked as from an earlier sign-in, and a new read is requested.

#### Scenario: Check again

- **GIVEN** Claude's list read this morning
- **WHEN** the operator chooses Check again on the Claude card
- **THEN** Claude's list is read again and the card's read time updates when it lands.

#### Scenario: Never read

- **GIVEN** no list ever stored for Claude and the read failing
- **WHEN** a Claude picker opens
- **THEN** it lists the built-in models marked "Built-in list, may be out of date", and Effort offers only Default.

### Requirement: A saved model no longer offered

A saved model the provider's current list doesn't offer SHALL stay selected and never be changed by the app. It SHALL be listed first in a "Saved, not offered" group, with a warning under its row that new sessions will try it and fail if the provider refuses it. A saved effort the chosen model doesn't accept SHALL stay saved, with its own warning.

#### Scenario: Model dropped by the provider

- **GIVEN** Images saved with `claude-opus-4-6` and a new read that no longer lists it
- **WHEN** Settings › Agents opens
- **THEN** Images still shows Opus 4.6 with "Not offered: Claude no longer lists claude-opus-4-6. New Images sessions will try it and fail if Claude refuses it. Pick another model.", and the setting is unchanged.

#### Scenario: Effort no longer accepted

- **GIVEN** Images saved with Opus 4.6 at Extra high, which the new list says Opus 4.6 doesn't accept
- **WHEN** the row renders
- **THEN** Effort still shows Extra high, with "Not accepted: Opus 4.6 takes no “Extra high”."

### Requirement: Effort beside every model picker

Every model picker in Settings › Agents SHALL have an Effort select beside it, listing Default and the levels the chosen model accepts in the provider's order. Default SHALL send no effort; where the provider names its default level, Default SHALL name it ("Default · Low"). A model with no levels SHALL show a disabled "No effort levels". Picking a model that lacks the chosen level SHALL set Effort to Default and say so under the row.

#### Scenario: Pick a level

- **GIVEN** Research on Codex GPT-6.2-Sol, whose levels are Low, Medium, High, Extra high, Max and Ultra and whose default is Low
- **WHEN** the operator opens Research's Effort
- **THEN** it lists "Default · Low" and those six levels, and choosing High saves at once with the other choices.

#### Scenario: Claude's default

- **GIVEN** a Claude model with levels
- **WHEN** its Effort opens
- **THEN** its first entry reads "Default", since Claude doesn't name its default level.

#### Scenario: New model lacks the level

- **GIVEN** Images at Max on a model that accepts Max
- **WHEN** the operator picks a model whose levels stop at High
- **THEN** Effort becomes Default, "Effort set to Default: <model> has no Max." shows under the row, and both are saved together.

#### Scenario: Model without levels

- **GIVEN** a model the list says has no effort levels
- **WHEN** it is chosen
- **THEN** Effort is disabled, reads "No effort levels" and is saved as Default.

#### Scenario: A provider's default model and effort

- **GIVEN** the Claude provider card
- **WHEN** the operator picks Opus 5.5 and High under "Default model and effort"
- **THEN** both are saved, and steps on Default run Claude's default model at High.
