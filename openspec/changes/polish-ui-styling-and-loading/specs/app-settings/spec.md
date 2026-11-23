## MODIFIED Requirements

### Requirement: Agent settings section

Settings › Agents SHALL hold every setting that shapes agent behaviour, in subsections. Switches, choices, selects, pickers and the stepper SHALL save as they change; text fields SHALL keep an explicit Save; every save SHALL use the existing revision check. Running turns SHALL finish with the settings they started with. Values saved here SHALL apply only to sessions queued, or batches created, after the save.

**Providers.** SHALL show one card for Claude and one for Codex, each set up on its own. Each card holds:

- an On switch;
- authentication (subscription or API key; keys are never shown), as a segmented control;
- a default model, chosen with the searchable model picker;
- its sign-in status, read automatically, and a button that opens its sign-in dialog.

Below the cards, "Default provider" SHALL choose one provider that is on, as a segmented control. At least one provider SHALL stay on; turning off the last one is refused at its switch.

The cards SHALL keep the existing personal Claude credential (save, replace, remove) and ChatGPT sign-in, in their dialogs.

**Sessions.** SHALL hold sessions at once, as a stepper from 1 to 8 with the current slot use, shared by both providers. It SHALL offer Pause all agents through the existing pause command used by the Agents page, and read slot use from the existing agent sessions read.

**Provider and model per step.** For each of Examine, Research, Images and Inventory, a step SHALL offer "Default" (the default provider's default model) or a model of a provider that is on, chosen with the searchable model picker. Turning a provider off SHALL show its steps as "Default", with a note that their choice was reset.

**Instructions.** SHALL hold "Instructions for every new batch", up to the batch instruction length limit, copied into each batch created after saving.

**Descriptions and naming.** SHALL hold the Part description style, plain text up to 500 characters, which agents follow when proposing Part descriptions. It SHALL also show the per-record "Fill descriptions for" switches and the supplier part description source as deferred.

**Tag suggestions.** SHALL hold "Suggest tags for new batches", the initial Auto tags value of each batch created after saving.

**Web research.** SHALL hold "Allow public web pages" and "Prefer manufacturer datasheets", both on until the operator changes them. "Allow public web pages" SHALL say that it applies to sessions in the VM, that it controls reading pages, and that provider web search stays on either way, sending queries to the session's provider. Both SHALL be disabled with a one-line explanation when the processing profile gives sessions no web access.

#### Scenario: Change sessions at once

- **GIVEN** sessions at once is 3 with 3 slots in use and 1 queued
- **WHEN** the operator lowers it to 2
- **THEN** the setting saves on its own with its revision, running turns continue, and the queued session waits until fewer than 2 slots are in use

#### Scenario: Stale settings revision

- **GIVEN** settings were changed in another tab
- **WHEN** this tab saves a change
- **THEN** the save is refused as a conflict, the operator's value stays in the control or field, and a Reload action is offered

#### Scenario: Removing the credential updates the card

- **GIVEN** the Claude card shows a saved token
- **WHEN** the operator removes the personal Claude credential in its dialog and the server confirms
- **THEN** the card shows no token

#### Scenario: Sign-in status before a check

- **GIVEN** personal management is on and no check has run this visit
- **WHEN** Settings › Agents opens
- **THEN** each provider card shows its status read from the agent VM, with no key asked for and no "Not checked" state

#### Scenario: Collapsing clears the card

- **GIVEN** the Codex sign-in dialog is open and signing in
- **WHEN** the operator closes it
- **THEN** its polling stops and the card shows the VM's current status, "Signing in" or "Not signed in", rather than the dialog's last result

#### Scenario: Editing the key while signing in

- **GIVEN** the Codex dialog is signing in
- **WHEN** the operator edits the management key in it
- **THEN** the old sign-in's polling stops, a late poll result for it is ignored, and the card's status still comes from the VM

#### Scenario: Sign-in completes

- **GIVEN** the Codex card reads "Signing in"
- **WHEN** the VM confirms the ChatGPT account
- **THEN** the card reads "Signed in"

#### Scenario: Check fails

- **GIVEN** a status read that fails (the VM stopped, unpaired or not answering)
- **WHEN** the card reads its status, or the operator chooses Check again
- **THEN** the pill reads "Can't reach the agent VM", and no provider is shown as signed out

#### Scenario: Mixing providers across steps

- **GIVEN** both providers are on, the default provider is Claude with Opus 5.5, Research is set to Codex GPT 6 and Images to Claude Sonnet 5.5
- **WHEN** those choices have saved and a batch is processed
- **THEN** new Research sessions run on Codex with GPT 6 and Codex's sign-in method, Images on Claude Sonnet, Examine and Inventory on Claude Opus, and sessions already queued keep what they were sealed with

#### Scenario: Turning a provider off

- **GIVEN** Research is set to a Codex model and Claude is also on
- **WHEN** the operator turns Codex off
- **THEN** Research shows "Default" with a note that its choice was reset, Codex can't be the default provider, and both changes save together

#### Scenario: The last provider

- **GIVEN** Codex is off
- **WHEN** the operator tries to turn Claude off too
- **THEN** the switch is refused with "At least one provider stays on", and nothing is sent

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

#### Scenario: Turning public web pages off

- **GIVEN** VM tool sessions and "Allow public web pages" on
- **WHEN** the operator turns it off and it saves
- **THEN** sessions queued after the save run without public web access, and sessions already queued or running keep the value they were sealed with

#### Scenario: Profile without web access

- **GIVEN** a profile other than `shared-vm-agent/3`
- **WHEN** Settings › Agents opens
- **THEN** both Web research switches are disabled with an explanation that this profile's sessions have no web access, and their saved values are unchanged

## ADDED Requirements

### Requirement: Electronics animation switch

Settings › Appearance SHALL offer an "Animate the electronics" switch under the Masthead choice, on by default and stored on the device like the theme and masthead choice. Turned off, the electronics current SHALL show a still frame in whichever masthead style is chosen (In the bar, Behind the whole window or Fading down), with no movement and no pointer reaction. The masthead style itself SHALL be unchanged. Reduced motion SHALL keep the current still whatever the switch says.

#### Scenario: Turn the animation off

- **GIVEN** the masthead set to Behind the whole window, with the animation on
- **WHEN** the operator turns "Animate the electronics" off
- **THEN** the parts stop where they are, behind the whole window, the page keeps its window styling, and the choice survives a reload on that device.

#### Scenario: Each masthead style

- **GIVEN** the switch off
- **WHEN** the masthead choice is changed to In the bar, then Fading down
- **THEN** each style shows its usual ground and parts, still.

#### Scenario: Reduced motion

- **GIVEN** an operating system set to reduce motion and the switch on
- **WHEN** the masthead renders
- **THEN** the current is still, as today.

### Requirement: Agent settings save as they change

On Settings › Agents, switches, choices, selects and the sessions stepper SHALL save on their own about 600 ms after the last change, with no Save button, coalescing rapid changes into one save under the loaded revision. A quiet status beside the subsection SHALL show Saving…, Saved, or a failure with Try again, and a revision conflict with Reload. A change that can't be saved as made SHALL be refused at the control with its reason and not sent.

#### Scenario: Stepper clicks

- **GIVEN** sessions at once is 3
- **WHEN** the operator clicks + twice within half a second
- **THEN** one save of 5 is sent about 600 ms after the second click, and the status shows Saving… then Saved.

#### Scenario: Leaving before the save

- **GIVEN** a switch changed 200 ms ago with its save not yet sent
- **WHEN** the operator follows a link elsewhere in the app
- **THEN** the save is sent at once and the navigation continues once it is confirmed; if it fails, the page stays with the failure shown and Try again.

#### Scenario: Reload with a save pending

- **GIVEN** a save that hasn't been confirmed
- **WHEN** the operator reloads or closes the tab
- **THEN** the browser's leave prompt shows, as for any unsaved change.

#### Scenario: Conflict

- **GIVEN** settings changed in another tab
- **WHEN** a switch's autosave is refused as a revision conflict
- **THEN** the switch keeps the operator's value, the status says "Not saved: changed in another tab" with Reload and Try again, and nothing else is overwritten.

#### Scenario: The last provider

- **GIVEN** Claude is the only provider turned on
- **WHEN** the operator tries to turn it off
- **THEN** the switch is refused with "At least one provider stays on", and no save is sent.

### Requirement: Agent settings text keeps an explicit Save

On Settings › Agents, text fields (Instructions and the Part description style) SHALL keep an explicit Save and Discard that appear only while the field holds an edit.

#### Scenario: Text keeps its Save

- **GIVEN** the Instructions field
- **WHEN** the operator types a change
- **THEN** Save and Discard appear beside it, nothing saves until Save, and the switches elsewhere on the page keep saving on their own.

### Requirement: Provider sign-in status is read automatically

Each provider card SHALL show its sign-in status as a state pill read from the agent VM when the section opens, after a sign-in change and on "Check again", with no key needed. The pill SHALL say only what the VM can report: for Claude "Token saved" or "No token"; for Codex "Signed in", "Signing in" or "Not signed in"; for either "Checking…" or "Can't reach the agent VM".

#### Scenario: Opening Settings

- **GIVEN** a saved Claude token and Codex signed out
- **WHEN** Settings › Agents opens
- **THEN** Claude's pill says "Token saved", Codex's says "Not signed in", no key is asked for, and no "Not checked" state shows.

#### Scenario: VM unreachable

- **GIVEN** the agent VM is stopped
- **WHEN** the card renders
- **THEN** the pill says "Can't reach the agent VM", not "No token" or "Not signed in".

### Requirement: Sign-in failures shown apart from the status

When a provider's latest session, in either sign-in mode, used its subscription and failed with retained evidence that the provider refused sign-in, its card SHALL say so on a separate line, "Last session couldn't sign in" with its time, without changing the status pill. Missing credentials or an unreachable guest SHALL NOT show it, and a newer session that didn't fail sign-in hides it.

#### Scenario: A session that couldn't sign in

- **GIVEN** a saved Claude token, and the latest Claude subscription session failed with a sign-in failure
- **WHEN** the card renders
- **THEN** the pill still says "Token saved", and a separate line says "Last session couldn't sign in" with its time.


#### Scenario: Missing token or unreachable guest

- **GIVEN** the latest Claude session failed because no token was stored, or the guest couldn't be reached
- **WHEN** the card renders
- **THEN** no "Last session couldn't sign in" line shows.

#### Scenario: A newer API-key session

- **GIVEN** a Claude subscription session refused sign-in, followed by a Claude API-key session that succeeded
- **WHEN** the card renders
- **THEN** no "Last session couldn't sign in" line shows.

### Requirement: Agent settings controls match the design

On Settings › Agents, every on/off setting SHALL be a switch, and the default provider SHALL be a segmented control like the sign-in choice, not radio buttons.

#### Scenario: Controls

- **GIVEN** Settings › Agents
- **WHEN** it renders
- **THEN** provider On, Tag suggestions, Web research and the deferred description settings are switches, and Default provider is a two-option segmented control.

### Requirement: Subscription sign-in in a dialog

Each provider card SHALL open its subscription sign-in in a dialog that asks for the management key, holds it only while open, and enables Save and Remove only after a fresh key-protected status read. Claude's dialog SHALL take the token, and Save SHALL close it only after a shape check passes and the agent VM confirms the token is stored; otherwise it stays open with the reason. Codex's dialog SHALL run the ChatGPT device sign-in and close once the VM confirms the account.

#### Scenario: An API key pasted as a token

- **GIVEN** the Claude dialog
- **WHEN** the operator pastes an API key and chooses Save
- **THEN** the dialog stays open with "That looks like an API key, not a subscription token", and nothing is sent.

#### Scenario: Wrong management key

- **GIVEN** the Claude dialog
- **WHEN** the operator enters a wrong management key
- **THEN** the protected status read is refused with the reason, Save and Remove stay disabled, and the saved token is kept.

#### Scenario: Token replaced elsewhere

- **GIVEN** the Claude dialog open, and the token replaced from another tab since its status read
- **WHEN** the operator chooses Save
- **THEN** the VM refuses the stale revision, the dialog stays open saying the token changed, and reads the status again.

#### Scenario: Codex sign-in

- **GIVEN** the Codex dialog with a code shown
- **WHEN** the operator approves the code at OpenAI
- **THEN** the dialog closes by itself once the VM confirms the account, and the card's pill says "Signed in".

### Requirement: Closing a sign-in dialog drops its work

Closing a sign-in dialog, or editing its key, SHALL drop the key, stop its polling, cancel queued requests that haven't been sent and ignore any late response.

#### Scenario: Closing during a request

- **GIVEN** the Codex dialog polling a sign-in
- **WHEN** the operator closes it and reopens it with a different key
- **THEN** the old poll stops, its late answer is ignored, and the new dialog holds only the new key.

### Requirement: One searchable model picker

Each step's provider and model SHALL be chosen with one searchable dropdown, the same component as Capture's batch settings pickers, listing Default and every model of both providers grouped by provider and searchable by name or ID. Picking a model picks its provider. Each provider card's Default model SHALL use the same picker, listing only that provider's models.

#### Scenario: Search and pick

- **GIVEN** Claude and Codex both on
- **WHEN** the operator opens Research's picker and types "son"
- **THEN** Claude's Sonnet is offered under Claude, and picking it sets Research to Claude with that model and saves it.

#### Scenario: A provider's default model

- **GIVEN** the Codex card
- **WHEN** the operator opens its Default model
- **THEN** the same searchable picker as Capture's batch settings opens, listing only Codex's models plus an exact-ID option, and picking one saves it.

### Requirement: Model picker limits and exact IDs

Models of a provider that is off SHALL show in the picker but not be selectable, with the reason. A typed model ID that isn't listed SHALL be offered at the end of the list once per provider that is on ("Use “…” with Claude"), and SHALL be validated as a model ID before it is saved.

#### Scenario: Provider off

- **GIVEN** Codex turned off
- **WHEN** a step's picker opens
- **THEN** Codex's models show greyed with "Turn Codex on to use its models", and can't be picked.

#### Scenario: Exact model ID

- **GIVEN** a new Claude model not in the list
- **WHEN** the operator types its exact ID and chooses "Use “…” with Claude"
- **THEN** the step uses that ID with Claude, after it passes the model ID check.
