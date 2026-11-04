# header-workflow-status Specification

## Purpose

Provide persistent, truthful access to retained workflow progress and active-agent details across application navigation.

## Requirements

### Requirement: Persistent workflow summary

The application SHALL render a separate workflow status/actions indicator on the masthead row, inspired by the original Processing in progress state. It SHALL prioritize current-batch work when present, identify application-wide scope, distinguish idle/loading/unavailable/attention states, and preserve status across tab navigation.

#### Scenario: Navigate during processing

- **GIVEN** retained processing work for the current batch
- **WHEN** the operator navigates from Processing to Capture or Review
- **THEN** the header still identifies that work and its current step without starting another job or resetting an unsaved draft.

#### Scenario: No successful activity read

- **GIVEN** an activity query fails or has not completed
- **WHEN** the indicator renders
- **THEN** it reports unavailable or loading, not idle/completed, and any retained old data is explicitly marked stale.

### Requirement: Expand work steps and existing actions

Expanding the workflow indicator SHALL show authorized work identities, current state, known steps and relevant navigation actions. The system SHALL derive steps from retained processing/manual-run state, never timer-based progress or invented percentages. Bounded or truncated lists SHALL disclose partial coverage and link to the owning full view. The header MUST NOT add mutation authority.

#### Scenario: Concurrent and partially loaded work

- **GIVEN** multiple jobs and a truncated global result
- **WHEN** the workflow details open
- **THEN** they show available jobs and actual step states, visibly identify incomplete coverage, and offer navigation to the appropriate Processing, Results or agent-session view.

#### Scenario: Unknown step detail

- **GIVEN** a job lacks known fine-grained progress
- **WHEN** its details render
- **THEN** the UI shows the known stage/state and an unknown detail label rather than fabricated counts or progress.

### Requirement: Active-agent occupancy and scoped freshness

Workflow details SHALL show retained active-agent sessions using authorized actor/target/context scope. Physical lane occupancy SHALL remain active even if a session has logically been cancelled or superseded. No-active-agents SHALL be asserted only from a fresh complete active-session read. Target/context changes SHALL invalidate previous observations, and WebSocket hints SHALL trigger scoped retained reads with existing polling fallback.

#### Scenario: Cancelled session still occupies a lane

- **GIVEN** a cancelled session with `occupies_lane` true
- **WHEN** workflow details show agents
- **THEN** that session remains visibly active with its logical state and a link to its owning view; it is not reported as released.

#### Scenario: Active session beyond history page one

- **GIVEN** an occupied session outside the first history page
- **WHEN** the header obtains its bounded active-session projection
- **THEN** the session is included or coverage is explicitly partial; an empty first history page never becomes proof of no active agents.

### Requirement: Accessible workflow disclosure and layout

The workflow control SHALL provide text equivalent to visual step segments, expanded state, keyboard operation, labelled details, Escape dismissal and predictable focus return. The header SHALL keep connection status, workflow activity and Open InvenTree distinguishable, using responsive wrapping when necessary instead of hiding essential information.

#### Scenario: Expanded workflow on a narrow screen

- **GIVEN** a 390px viewport or 200% zoom and several active jobs
- **WHEN** the workflow disclosure opens and closes by keyboard
- **THEN** all text/actions are reachable, focus returns predictably and no header content is clipped or causes document horizontal overflow.
