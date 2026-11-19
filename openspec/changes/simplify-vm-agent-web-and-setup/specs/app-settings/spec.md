# Capability delta

<!-- Written against settings-debug-mode's version of this spec (docs/settings-debug-mode at f44736ef). Rebase it after that change syncs. -->

## MODIFIED Requirements

### Requirement: Agent settings section

Settings › Agents SHALL hold every setting that shapes agent behaviour, in subsections. Each subsection SHALL save through one explicit Save with the existing revision check. Running turns SHALL finish with the settings they started with. Values saved here SHALL apply only to sessions queued, or batches created, after the save.

**Providers.** SHALL show one card for Claude and one for Codex, each set up on its own. Each card holds:

- an On switch;
- authentication (subscription or API key; keys are never shown), as a segmented control;
- a default model;
- its credential panel.

Below the cards, "Default provider" SHALL choose one provider that is on. At least one provider SHALL be on to save.

A provider card SHALL show the same status as its credential panel at all times:

- "Not checked" while the panel holds no result and no error: before a check, after the panel collapses, and after its key is edited unless the Claude panel still shows its error;
- for Claude, "Configured" or "Unconfigured";
- for Codex, "Connected", "Signing in", "Not connected" or "Declined";
- "Check failed" while the panel shows its error.

The cards SHALL keep the existing personal Claude credential (save, replace, remove) and ChatGPT sign-in controls.

**Sessions.** SHALL hold sessions at once, as a stepper from 1 to 8 with the current slot use, shared by both providers. It SHALL offer Pause all agents through the existing pause command used by the Agents page, and read slot use from the existing agent sessions read.

**Provider and model per step.** For each of Examine, Research, Images and Inventory, a step SHALL offer "Default" (the default provider's default model) or a provider that is on with a model for it, suggested from that provider's presets or typed. Turning a provider off SHALL show its steps as "Default", with a note that their choice was reset, before saving.

**Instructions.** SHALL hold "Instructions for every new batch", up to the batch instruction length limit, copied into each batch created after saving.

**Descriptions and naming.** SHALL hold the Part description style, plain text up to 500 characters, which agents follow when proposing Part descriptions. It SHALL also show the per-record "Fill descriptions for" switches and the supplier part description source as deferred.

**Tag suggestions.** SHALL hold "Suggest tags for new batches", the initial Auto tags value of each batch created after saving.

**Web research.** SHALL hold "Allow public web pages" and "Prefer manufacturer datasheets", both on until the operator saves otherwise. "Allow public web pages" SHALL say that it applies to sessions in the VM, that it controls reading pages, and that provider web search stays on either way, sending queries to the session's provider. Both SHALL be disabled with a one-line explanation when the processing profile gives sessions no web access.

#### Scenario: Change sessions at once

- **GIVEN** sessions at once is 3 with 3 slots in use and 1 queued
- **WHEN** the operator lowers it to 2
- **THEN** the setting saves with its revision, running turns continue, and the queued session waits until fewer than 2 slots are in use

#### Scenario: Stale settings revision

- **GIVEN** settings were changed in another tab
- **WHEN** this tab saves a change
- **THEN** the save is refused as a conflict, the operator's edit stays in the form, and a Reload action is offered

#### Scenario: Sign-in status before a check

- **GIVEN** personal management is on and no check has run this visit
- **WHEN** Settings › Agents opens
- **THEN** each provider card reads "Not checked", and running the check in its panel updates the card

#### Scenario: Removing the credential updates the card

- **GIVEN** the Claude card reads "Configured"
- **WHEN** the operator removes the personal Claude credential in its panel and the server confirms
- **THEN** the card reads "Unconfigured"

#### Scenario: Collapsing clears the card

- **GIVEN** the Codex card reads "Signing in" or "Connected"
- **WHEN** the operator collapses the ChatGPT sign-in panel
- **THEN** the card reads "Not checked", as the panel shows no status

#### Scenario: Editing the key while signing in

- **GIVEN** the Codex card reads "Signing in"
- **WHEN** the operator edits the management key in the ChatGPT sign-in panel
- **THEN** the card reads "Not checked", and a late poll result for the old sign-in doesn't change it

#### Scenario: Sign-in completes

- **GIVEN** the Codex card reads "Signing in"
- **WHEN** the panel's sign-in poll returns connected
- **THEN** the card reads "Connected"

#### Scenario: Check fails

- **GIVEN** a check that fails (personal management off, a refused key or a network error)
- **WHEN** the operator runs it in a provider's credential panel
- **THEN** that provider card reads "Check failed" and the panel shows its existing error message

#### Scenario: Mixing providers across steps

- **GIVEN** both providers are on, the default provider is Claude with Opus 5.5, Research is set to Codex GPT 6 and Images to Claude Sonnet 5.5
- **WHEN** the settings are saved and a batch is processed
- **THEN** new Research sessions run on Codex with GPT 6 and Codex's sign-in method, Images on Claude Sonnet, Examine and Inventory on Claude Opus, and sessions already queued keep what they were sealed with

#### Scenario: Turning a provider off

- **GIVEN** Research is set to a Codex model
- **WHEN** the operator turns Codex off
- **THEN** Research shows "Default" with a note that its choice was reset, Codex can't be the default provider, and nothing is saved until Save

#### Scenario: No provider on

- **GIVEN** Codex is off
- **WHEN** the operator turns Claude off too and presses Save
- **THEN** the form says at least one provider must be on, and nothing is sent

#### Scenario: Instructions copied once

- **GIVEN** saved new-batch instructions
- **WHEN** a batch is created, and the instructions are later changed in Settings
- **THEN** the batch's Custom instructions hold the text saved at creation, and the later change affects only batches created after it

#### Scenario: Description style too long

- **GIVEN** a Part description style over 500 characters
- **WHEN** the operator tries to save
- **THEN** the field shows the limit, Save sends nothing, and the text stays in the field

#### Scenario: Turning public web pages off

- **GIVEN** VM tool sessions and "Allow public web pages" on
- **WHEN** the operator turns it off and saves
- **THEN** sessions queued after the save run without public web access, and sessions already queued or running keep the value they were sealed with

#### Scenario: Profile without web access

- **GIVEN** a profile other than `shared-vm-agent/3`
- **WHEN** Settings › Agents opens
- **THEN** both Web research switches are disabled with an explanation that this profile's sessions have no web access, and their saved values are unchanged

### Requirement: Deferred settings are disabled and explained

These controls SHALL render disabled, each with a one-line `DisabledFeature` explanation of what happens instead, and SHALL save nothing:

- the "Fill descriptions for" switches for records other than Parts (the Parts switch shows on and can't be changed);
- the supplier part description source;
- "Tag every Part with its batch name".

#### Scenario: Disabled control is honest

- **GIVEN** Settings › Agents
- **WHEN** the operator focuses "Tag every Part with its batch name"
- **THEN** it is not operable, the explanation is announced, and no request is sent
