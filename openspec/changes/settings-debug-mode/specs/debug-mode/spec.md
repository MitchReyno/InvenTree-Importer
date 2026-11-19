# Capability delta

## Purpose

Let a developer switch technical detail on and off. With debug mode off, screens show only what the operator needs to do the work. With it on, the IDs, revisions, hashes, raw states and diagnostics the app already holds are visible on most screens. The Dev mode popover and Settings › Developer give quick access to the switch and to basic developer tools.

## ADDED Requirements

### Requirement: Device-local debug preference

The app SHALL keep a debug mode preference on the device, off by default, read and written with the same failure tolerance as the theme preference. Changing it SHALL take effect immediately on every open screen without a reload. The preference SHALL NOT be sent to the server.

#### Scenario: First visit

- **GIVEN** a device that has never stored the preference
- **WHEN** any screen opens
- **THEN** debug mode is off

#### Scenario: Turn it on

- **GIVEN** debug mode is off and a batch screen is open
- **WHEN** the operator turns it on in the Dev mode popover
- **THEN** the screen shows its debug details at once, and the preference is still on after a reload

#### Scenario: Storage unavailable

- **GIVEN** a browser whose storage throws on read or write
- **WHEN** the app reads or changes the preference
- **THEN** debug mode starts off, the switch still works for the session, and no error is shown

### Requirement: Developer details hidden when debug mode is off

With debug mode off, the app SHALL NOT render internal identifiers, hashes, revisions, raw state codes or the page-footer local setup diagnostics. Operator-facing content SHALL stay: summaries, categories, recovery actions, and InvenTree record numbers and links. The design assessment lists the affected screens.

#### Scenario: Changes and Capture details with debug mode off

- **GIVEN** debug mode off
- **WHEN** Ready to add, an Added round, a Part's attachments, an evidence note and a failed batch save are shown
- **THEN** no approval hash, run or approval ID, attachment version ID, byte count, record ID, actor ID or revision JSON appears, and InvenTree stock and Part numbers with their links still do

#### Scenario: Failed session with debug mode off

- **GIVEN** a failed Research session and debug mode off
- **WHEN** Processing shows it
- **THEN** the category, summary and recovery action are visible, and no error code, correlation ID, attempt ID or provider session appears or can be revealed

#### Scenario: Same session with debug mode on

- **GIVEN** the same session and debug mode on
- **WHEN** Processing shows it
- **THEN** a debug block marked "Debug" lists the code, correlation ID, attempt and turn, model and CLI version and provider session, with the same sanitization as today

#### Scenario: Footer diagnostics

- **GIVEN** debug mode off
- **WHEN** any page renders
- **THEN** no "Local setup and diagnostics" disclosure appears under the content

### Requirement: Developer details marked when debug mode is on

With debug mode on, each detail hidden while it is off SHALL render where it belongs, as a block visibly marked "Debug" and set apart from operator content, with today's sanitization.

#### Scenario: Round details with debug mode on

- **GIVEN** debug mode on
- **WHEN** an Added round is shown
- **THEN** its run and approval IDs, effect certainty and plan hash appear in a block marked "Debug" below the round's operator summary

### Requirement: Debug panel per screen

With debug mode on, Batches, each batch tab, Agents and Settings SHALL show a collapsible Debug panel. It lists the route, the batch ID and revision, settings revisions, the live-update state and the age of each read the screen uses, marking stale or failed reads. It SHALL use only data the screen already holds, start no request and contain no credentials. With debug mode off it SHALL NOT render.

#### Scenario: Panel on a batch tab

- **GIVEN** debug mode on and Processing open for a batch
- **WHEN** the Debug panel is expanded
- **THEN** it lists the route, the batch ID and revision, the agent settings revision, the live-update transport state with its last event time, and each read's age

#### Scenario: Stale read

- **GIVEN** debug mode on, and Review's records read failed after earlier data loaded
- **WHEN** the Debug panel is expanded
- **THEN** it shows the records read as failed with the age of the data shown, and opening it sent no request

### Requirement: Settings › Developer

Settings SHALL have a Developer section holding:

- **Debug mode:** the switch.
- **Local setup:** the readiness check, moved from the page footer, with Check again. It loads only when the section opens.
- **Reload app data:** invalidates every server read. Unsaved drafts and the navigation guard stay as they are.
- **Copy debug info:** copies a plain-text summary of the build, route, readiness and live-update state, with no credentials, tokens or record content.

#### Scenario: Reload keeps drafts

- **GIVEN** an unsaved lot edit in Review
- **WHEN** the operator uses Reload app data from the Dev mode popover
- **THEN** reads refetch, the edit stays in its field and leaving the page is still guarded

#### Scenario: Copy without secrets

- **GIVEN** a configured InvenTree token and agent credentials
- **WHEN** Copy debug info runs
- **THEN** the clipboard text contains the build, route, readiness and transport state, and none of those secrets

#### Scenario: Clipboard refused

- **GIVEN** the browser refuses clipboard access
- **WHEN** Copy debug info runs
- **THEN** a message says it couldn't copy, and nothing else changes

### Requirement: Dev mode popover

The masthead's Dev mode pill SHALL be a button that opens a labelled dialog popover. It holds a one-line build summary, the debug mode switch, a short readiness summary, Check setup again, Reload app data, Copy debug info and a link to Settings › Developer. Readiness SHALL load only when the popover opens.

#### Scenario: Popover contents

- **GIVEN** the masthead
- **WHEN** the operator activates the Dev mode pill
- **THEN** the popover shows the build summary, the debug mode switch, the readiness summary, the three tools and the Developer link, and the readiness read starts only now

#### Scenario: Readiness unavailable

- **GIVEN** the readiness read fails
- **WHEN** the popover opens
- **THEN** it says local setup checks are unavailable, and the switch and other tools still work

### Requirement: Dev mode popover is accessible

The Dev mode popover SHALL be keyboard operable, close on Escape and on an outside click, return focus to the pill, and stay within the viewport at 360px. At phone width the pill keeps its shortened label and opens the same popover.

#### Scenario: Open and close by keyboard

- **GIVEN** focus on the Dev mode pill
- **WHEN** the operator presses Enter, turns debug mode on and presses Escape
- **THEN** the popover opened with `aria-expanded="true"`, debug mode is on, the popover is closed and focus is back on the pill

#### Scenario: Phone width

- **GIVEN** a 360px viewport
- **WHEN** the operator opens the popover from the shortened pill
- **THEN** the whole popover is visible without horizontal scrolling
