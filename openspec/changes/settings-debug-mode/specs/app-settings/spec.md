# Capability delta

## MODIFIED Requirements

### Requirement: Settings page and navigation

The masthead SHALL end with an icon-only Settings button (`aria-label` "Settings") that opens Settings.

**Section nav.** Settings SHALL show a section nav: Agents, InvenTree, Batch defaults, Appearance, Developer. Under the Agents link it SHALL list sub-nav links to the Agents subsections:

- Sessions and sign-in
- Models per step
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

**Sessions and sign-in.** SHALL edit the stored agent settings:

- provider (Claude or Codex), as option cards showing each provider's sign-in status;
- authentication (subscription or API key; keys are never shown), as a segmented control;
- model;
- sessions at once, as a stepper from 1 to 8 with the current slot use.

A provider card SHALL show the same status as its credential panel at all times:

- "Not checked" while the panel holds no result and no error: before a check, after the panel collapses, and after its key is edited unless the Claude panel still shows its error;
- for Claude, "Configured" or "Unconfigured";
- for Codex, "Connected", "Signing in", "Not connected" or "Declined";
- "Check failed" while the panel shows its error.

It SHALL keep the existing personal Claude credential (save, replace, remove) and ChatGPT sign-in controls. It SHALL offer Pause all agents through the existing pause command used by the Agents page, and read slot use from the existing agent sessions read.

**Models per step.** SHALL offer, for Examine, Research, Images and Inventory, "Same as Model" or a model offered for the selected provider. Changing the provider SHALL reset any per-step choice the new provider doesn't offer to "Same as Model", and say so before saving.

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

#### Scenario: Model per step

- **GIVEN** Model is Claude Opus 5.5 and Images is set to Claude Sonnet 5.5
- **WHEN** the settings are saved and a batch is processed
- **THEN** new Images sessions run with Sonnet, every other step runs with Opus, and sessions already queued keep the models they were sealed with

#### Scenario: Provider change drops a per-step model

- **GIVEN** Images is set to a Claude model
- **WHEN** the operator switches the provider to Codex
- **THEN** Images shows "Same as Model" with a note that its choice was reset, and nothing is saved until Save

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
- "Tag every Part with its batch name";
- Replace token.

#### Scenario: Disabled control is honest

- **GIVEN** Settings › Agents
- **WHEN** the operator focuses "Allow public web pages"
- **THEN** it is not operable, the explanation is announced, and no request is sent

### Requirement: InvenTree and appearance sections

**Settings › InvenTree** SHALL:

- show the existing server label, connection state, last check time and an Open InvenTree link, without showing credentials;
- show the API token's last known status (Accepted, Refused or Unavailable) and its check time, with a working Check now;
- show the import reference format read-only, with an example, and no edit control.

**Settings › Batch defaults** SHALL edit, with one explicit Save and a revision check:

- **Default location:** an existing InvenTree location;
- **Default supplier:** an existing InvenTree company, or none.

Each batch created after a save SHALL start with them.

**Settings › Appearance** SHALL hold the System, Light and Dark theme choice that the retired masthead menu held, with the same stored preference.

#### Scenario: Theme moves without loss

- **GIVEN** the operator had chosen Dark in the old masthead menu
- **WHEN** they open Settings › Appearance after this change
- **THEN** Dark is selected, and changing it updates the theme immediately

#### Scenario: Check now with a refused token

- **GIVEN** the server's InvenTree token is no longer accepted by the target
- **WHEN** the operator presses Check now
- **THEN** the row reads Refused with the check time and says to check the token in the server's environment, and no credential is shown

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
