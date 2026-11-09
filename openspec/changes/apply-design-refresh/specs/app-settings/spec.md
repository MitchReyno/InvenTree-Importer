# Capability delta

## Purpose

Give the operator one Settings page, opened from the masthead, for agent, InvenTree, batch-default, description and appearance settings. It shows what the app stores today as working controls and what it doesn't yet support as honest disabled controls.

## ADDED Requirements

### Requirement: Settings page and navigation

The masthead SHALL end with an icon-only Settings button (`aria-label` "Settings") that opens Settings. Settings SHALL show a section nav: Agents, InvenTree, Batch defaults, Descriptions and naming, Appearance. The nav SHALL start with a back link that names the screen Settings was opened from and returns to it, falling back to "Back to Batches" when there is no earlier screen. The existing `#settings` route SHALL open Settings › Agents. The Agents page's "Agent settings" action SHALL open the same section.

#### Scenario: Open and leave Settings

- **GIVEN** the operator is on Review › Records in a batch
- **WHEN** they open Settings from the masthead and then use the back link
- **THEN** the back link read "Back to <batch> › Review" and returns to Review › Records with any unsaved drafts still protected by the existing navigation guard

#### Scenario: Direct link

- **GIVEN** a bookmarked `#settings` link
- **WHEN** it is opened in a new tab
- **THEN** Settings › Agents opens and the back link reads "Back to Batches"

### Requirement: Agent settings section

Settings › Agents SHALL edit the stored agent settings: provider (Claude or Codex, with sign-in state), authentication (subscription or API key; keys are never shown), model, and sessions at once as a stepper from 1 to 8 with the current slot use. It SHALL keep Pause all agents. Saves SHALL use the existing revision check and show one autosave status. Running turns SHALL finish with the settings they started with.

#### Scenario: Change sessions at once

- **GIVEN** sessions at once is 3 with 3 slots in use and 1 queued
- **WHEN** the operator lowers it to 2
- **THEN** the setting saves with its revision, running turns continue, and the queued session waits until fewer than 2 slots are in use

#### Scenario: Stale settings revision

- **GIVEN** settings were changed in another tab
- **WHEN** this tab saves a change
- **THEN** the save is refused as a conflict, the operator's edit stays in the form, and a Reload action is offered

### Requirement: Deferred settings are disabled and explained

These controls SHALL render disabled, each with a one-line explanation that the feature is coming later and what happens instead, and SHALL save nothing:

- model per step;
- instructions copied into every new batch;
- web research switches;
- app-level batch defaults;
- the description rules (which records get agent-written descriptions, the Part description style, supplier part description source).

#### Scenario: Disabled control is honest

- **GIVEN** Settings › Agents
- **WHEN** the operator focuses "Model per step"
- **THEN** it is not operable, the explanation is announced, and no request is sent

### Requirement: InvenTree and appearance sections

Settings › InvenTree SHALL show the existing server label, connection state, last check time, an Open InvenTree link and the import reference prefix, without showing credentials. Settings › Appearance SHALL hold the System, Light and Dark theme choice that the retired masthead menu held, with the same stored preference.

#### Scenario: Theme moves without loss

- **GIVEN** the operator had chosen Dark in the old masthead menu
- **WHEN** they open Settings › Appearance after this change
- **THEN** Dark is selected, and changing it updates the theme immediately
