# Capability delta

## MODIFIED Requirements

### Requirement: Settings page and navigation

The masthead SHALL end with an icon-only Settings button (`aria-label` "Settings") that opens Settings.

**Section nav.** Settings SHALL show a section nav: Agents, InvenTree, Batch defaults, Appearance, Developer. Under the Agents link it SHALL list sub-nav links to the Agents subsections:

- Providers
- Sessions
- Provider and model per step
- Instructions
- Descriptions and naming
- Tag suggestions
- Web research

Each subsection link SHALL have its own route, `#settings/agents/<subsection>`. It SHALL open Settings › Agents scrolled to that subsection, with the link marked current. The nav SHALL start with a back link that names the screen Settings was opened from and returns to it, falling back to "Back to Batches" when there is no earlier screen.

**Routes.**

- The existing `#settings` route SHALL open Settings › Agents.
- `#settings/descriptions` SHALL open the Descriptions and naming subsection.
- The Agents page's "Agent settings" action SHALL open Settings › Agents.

#### Scenario: Open and leave Settings

- **GIVEN** the operator is on Review › Records in a batch
- **WHEN** they open Settings from the masthead and then use the back link
- **THEN** the back link read "Back to <batch> › Review" and returns to Review › Records with any unsaved drafts still protected by the existing navigation guard

#### Scenario: Direct link

- **GIVEN** a bookmarked `#settings` link
- **WHEN** it is opened in a new tab
- **THEN** Settings › Agents opens and the back link reads "Back to Batches"

#### Scenario: Agents sub-nav

- **GIVEN** Settings › Agents is open
- **WHEN** the operator activates "Descriptions and naming" under the Agents link
- **THEN** the route becomes `#settings/agents/descriptions`, the page scrolls to that subsection, focus moves to its heading and the sub-nav link is marked current

#### Scenario: Old descriptions link

- **GIVEN** a bookmarked `#settings/descriptions` link
- **WHEN** it is opened
- **THEN** Settings › Agents opens at the Descriptions and naming subsection

### Requirement: Agent settings section

Settings › Agents SHALL hold every setting that shapes agent behaviour, in subsections. Each subsection SHALL save through one explicit Save with the existing revision check. Running turns SHALL finish with the settings they started with. Values saved here SHALL apply only to sessions queued, or batches created, after the save.

**Providers.** SHALL show one card for Claude and one for Codex, each set up on its own. Each card holds:

- an On switch;
- authentication (subscription or API key; keys are never shown), as a segmented control;
- a default model;
- its credential panel.

Below the cards, "Default provider" SHALL choose one provider that is on. Providers and "Provider and model per step" SHALL save together with one Save, which needs at least one provider on. The other subsections SHALL save on their own, even while no provider is on.

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

**Web research.** SHALL show the web research switches as deferred.

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

#### Scenario: Other settings before any provider

- **GIVEN** a fresh setup with no saved settings and no provider on
- **WHEN** the operator writes new-batch instructions and saves Instructions
- **THEN** the instructions save, both providers stay off, and Processing still can't start sessions until a provider is on

#### Scenario: Instructions copied once

- **GIVEN** saved new-batch instructions
- **WHEN** a batch is created, and the instructions are later changed in Settings
- **THEN** the batch's Custom instructions hold the text saved at creation, and the later change affects only batches created after it

#### Scenario: Description style too long

- **GIVEN** a Part description style over 500 characters
- **WHEN** the operator tries to save
- **THEN** the field shows the limit, Save sends nothing, and the text stays in the field

### Requirement: Deferred settings are disabled and explained

These controls SHALL render disabled, each with a one-line `DisabledFeature` explanation of what happens instead, and SHALL save nothing:

- web research switches;
- the "Fill descriptions for" switches for records other than Parts (the Parts switch shows on and can't be changed);
- the supplier part description source;
- "Tag every Part with its batch name".

#### Scenario: Disabled control is honest

- **GIVEN** Settings › Agents
- **WHEN** the operator focuses "Allow public web pages"
- **THEN** it is not operable, the explanation is announced, and no request is sent

### Requirement: InvenTree and appearance sections

**Settings › InvenTree** SHALL:

- show the existing server label, connection state, last check time and an Open InvenTree link, without showing credentials;
- show the API token's last known status (Accepted, Refused or Unavailable) and its check time, with a working Check now;
- show whether reads use the environment token or a token saved here, and offer Replace token: a write-only field whose value is checked against InvenTree before it is saved, plus "Use the environment token" when a saved token exists. Approvals keep the runner's own credential, and the row says so;
- show the import reference format read-only, with an example, and no edit control.

**Settings › Batch defaults** SHALL edit, with one explicit Save and a revision check:

- **Default location:** an existing InvenTree location;
- **Default supplier:** an existing InvenTree company, or none.

Each batch created after a save SHALL start with them.

**Settings › Appearance** SHALL hold the System, Light and Dark theme choice that the retired masthead menu held, with the same stored preference. It SHALL also hold a Masthead choice of In the bar, Behind the whole window and Fading down, remembered on the device, defaulting to In the bar and applied immediately. The masthead and theme choices SHALL be independent: either can be changed without changing the other.

#### Scenario: Theme moves without loss

- **GIVEN** the operator had chosen Dark in the old masthead menu
- **WHEN** they open Settings › Appearance after this change
- **THEN** Dark is selected, and changing it updates the theme immediately

#### Scenario: Masthead choice is remembered

- **GIVEN** Settings › Appearance with In the bar selected
- **WHEN** the operator chooses Fading down and reloads the app
- **THEN** the masthead changes as soon as they choose, and after the reload Fading down is still selected and shown

#### Scenario: Masthead and theme stay independent

- **GIVEN** the theme choice Light and the masthead choice In the bar
- **WHEN** the operator chooses Behind the whole window and then the theme Dark
- **THEN** the app shows the whole-window masthead in the dark theme, and both choices are still selected after a reload

#### Scenario: Storage unavailable

- **GIVEN** browser storage that is missing or throws
- **WHEN** the app starts and the operator changes the masthead choice
- **THEN** the app starts with In the bar, the new choice applies for the session, and no error is shown

#### Scenario: Check now with a refused token

- **GIVEN** the server's InvenTree token is no longer accepted by the target
- **WHEN** the operator presses Check now
- **THEN** the row reads Refused with the check time and offers Replace token, and no credential is shown

#### Scenario: Replace the token

- **GIVEN** a working read token from the server's environment
- **WHEN** the operator pastes a new token into Replace token and chooses Check and save
- **THEN** the server checks it against InvenTree, saves it only when it is accepted, and switches reads to it; the field clears, the row reads "Using the token saved here" with the date, and the token is never shown or returned

#### Scenario: Replacement refused

- **GIVEN** a pasted token that InvenTree refuses, or InvenTree unreachable during the check
- **WHEN** Check and save runs
- **THEN** nothing is saved, the current token stays in use, and the row says why

#### Scenario: Go back to the environment token

- **GIVEN** a saved replacement token
- **WHEN** the operator chooses "Use the environment token" and confirms
- **THEN** the saved token is deleted, reads use the environment token again, and the row says so

#### Scenario: Check now while a check is running

- **GIVEN** a check is in flight
- **WHEN** Check now is pressed again
- **THEN** no second check starts, and the row shows the one result when it arrives

#### Scenario: Default location no longer exists

- **GIVEN** a saved default location that was deleted in InvenTree
- **WHEN** Settings › Batch defaults opens, or a batch is created
- **THEN** the row says the location wasn't found, and the new batch starts with no default location rather than a broken one

#### Scenario: Stale batch defaults

- **GIVEN** batch defaults were changed in another tab
- **WHEN** this tab saves
- **THEN** the save is refused as a conflict, the edit stays, and Reload is offered
