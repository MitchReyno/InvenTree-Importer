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
- **WHEN** the operator leaves Settings
- **THEN** the save is sent at once and the page leaves only when it is confirmed; if it fails, the navigation guard holds and says so.

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

### Requirement: Provider status is checked automatically

Each provider card on Settings › Agents SHALL show its sign-in status as a state pill, read automatically when the section opens, after a sign-in change and on "Check again": Signed in, Checking…, Not signed in, Token refused or Can't reach the agent VM. No key SHALL be needed to see it.

#### Scenario: Opening Settings

- **GIVEN** a saved Claude token that last worked and Codex signed out
- **WHEN** Settings › Agents opens
- **THEN** Claude's pill says Signed in with the save and check times, Codex's says Not signed in, and no "Not checked" state shows.

### Requirement: Agent settings controls match the design

On Settings › Agents, every on/off setting SHALL be a switch, and the default provider SHALL be a segmented control like the sign-in choice, not radio buttons.

#### Scenario: Controls

- **GIVEN** Settings › Agents
- **WHEN** it renders
- **THEN** provider On, Tag suggestions, Web research and the deferred description settings are switches, and Default provider is a two-option segmented control.

### Requirement: Subscription sign-in in a dialog

Each provider card SHALL open its subscription sign-in in a dialog. Claude's dialog SHALL take the subscription token and the management key, and its Save SHALL close it only after the token passes a shape check and the agent VM confirms it is saved and, where the VM can check, accepted by Claude; otherwise the dialog stays open with the reason. Codex's dialog SHALL run the ChatGPT device sign-in and close once the VM confirms the account.

#### Scenario: An API key pasted as a token

- **GIVEN** the Claude dialog
- **WHEN** the operator pastes an API key and chooses Save
- **THEN** the dialog stays open with "That looks like an API key, not a subscription token", and nothing is sent.

#### Scenario: Refused token

- **GIVEN** a well-formed but revoked token
- **WHEN** the operator chooses Save
- **THEN** the dialog shows "Checking the token with Claude…", then stays open with "Claude refused this token", and the previously saved token is kept.

#### Scenario: Codex sign-in

- **GIVEN** the Codex dialog with a code shown
- **WHEN** the operator approves the code at OpenAI
- **THEN** the dialog closes by itself once the VM confirms the account, and the card's pill says Signed in.

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
