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

With debug mode off, the app SHALL NOT render these:

- internal identifiers and technical details: session failure codes and IDs, attempt and question revision IDs, processing source receipt IDs, region strings, retained source identity, note attribution and provenance, capture record IDs, versions and actors;
- the saved-revision JSON dump, approval binding hashes, round run and approval IDs, attachment version IDs, byte counts and hashes;
- the raw connection failure code;
- the page-footer local setup diagnostics.

Operator-facing content SHALL stay: summaries, categories, recovery actions, InvenTree record numbers and links. With debug mode on, each of those details SHALL render as a visibly marked debug block in the place it belongs.

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

### Requirement: Debug panel per screen

With debug mode on, Batches, each batch tab (Capture, Processing, Review, Changes), Agents and Settings SHALL show a collapsible Debug panel. It lists:

- the current route;
- the batch ID and revision where there is one;
- the agent and batch-default settings revisions on Processing and Settings;
- the live-update transport state, with the last event time;
- the age of each read the screen uses, marking stale or failed reads.

The panel SHALL use only data the screen already holds, start no request and contain no credentials. With debug mode off it SHALL NOT render.

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

The masthead's Dev mode pill SHALL be a button that opens a labelled dialog popover. It holds:

- a one-line build summary;
- the debug mode switch;
- a short readiness summary;
- Check setup again, Reload app data and Copy debug info;
- a link to Settings › Developer.

Readiness SHALL load only when the popover opens. The popover SHALL be keyboard operable, close on Escape and on outside click, return focus to the pill, and stay within the viewport at 360px. At phone width the pill keeps its shortened label and opens the same popover.

#### Scenario: Open and close by keyboard

- **GIVEN** focus on the Dev mode pill
- **WHEN** the operator presses Enter, turns debug mode on and presses Escape
- **THEN** the popover opened with `aria-expanded="true"`, debug mode is on, the popover is closed and focus is back on the pill

#### Scenario: Readiness unavailable

- **GIVEN** the readiness read fails
- **WHEN** the popover opens
- **THEN** it says local setup checks are unavailable, and the switch and other tools still work
