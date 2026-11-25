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

Expanding the workflow indicator SHALL show authorized work identities, current state, known steps and relevant navigation actions. The system SHALL derive steps from retained processing/manual-run state, never timer-based progress or invented percentages. Bounded or truncated lists SHALL disclose partial coverage and link to the owning full view. The header MUST NOT add mutation authority, except Resume for a paused batch, which SHALL use the existing pause route and its server authorization and SHALL be unavailable while the work read is loading, failed or stale.

#### Scenario: Concurrent and partially loaded work

- **GIVEN** multiple jobs and a truncated global result
- **WHEN** the workflow details open
- **THEN** they show available jobs and actual step states, visibly identify incomplete coverage, and offer navigation to the appropriate Processing, Results or agent-session view.

#### Scenario: Unknown step detail

- **GIVEN** a job lacks known fine-grained progress
- **WHEN** its details render
- **THEN** the UI shows the known stage/state and an unknown detail label rather than fabricated counts or progress.

#### Scenario: Resume while the work read is stale

- **GIVEN** a paused batch in the workflow details whose work read has failed or holds only old data
- **WHEN** the details render
- **THEN** Resume is unavailable with the read's stale or unavailable state shown, and no command is sent.

### Requirement: Active-agent occupancy and scoped freshness

Workflow details SHALL show retained active-agent sessions using authorized actor/target/context scope.

- Physical lane occupancy SHALL remain active even if a session has logically been cancelled or superseded.
- No-active-agents SHALL be asserted only from a fresh complete active-session read.
- Target/context changes SHALL invalidate previous observations, and WebSocket hints SHALL trigger scoped retained reads with existing polling fallback.
- Each listed session SHALL show its latest retained status line with its time, and whether it is running, queued, or waiting for input.
- Waiting sessions SHALL be distinguishable from sessions that occupy a concurrency slot.

#### Scenario: Cancelled session still occupies a lane

- **GIVEN** a cancelled session with `occupies_lane` true
- **WHEN** workflow details show agents
- **THEN** that session remains visibly active with its logical state and a link to its owning view; it is not reported as released.

#### Scenario: Active session beyond history page one

- **GIVEN** an occupied session outside the first history page
- **WHEN** the header obtains its bounded active-session projection
- **THEN** the session is included or coverage is explicitly partial; an empty first history page never becomes proof of no active agents.

#### Scenario: Latest status line

- **GIVEN** a running Examine session whose latest status line is "Comparing markings with datasheet candidates"
- **WHEN** workflow details open
- **THEN** that line and its time are shown for the session, and a waiting session is labelled waiting for input without counting as occupying a slot.

### Requirement: Accessible workflow disclosure and layout

The workflow control SHALL provide text equivalent to visual step segments, expanded state, keyboard operation, labelled details, Escape dismissal and predictable focus return. The masthead SHALL be one bar holding, in order: the wordmark, the Dev mode badge in development builds, the breadcrumb, the workflow activity control, connection status (whose menu holds Open InvenTree) and the Settings button. Connection status and workflow activity SHALL stay distinguishable. At phone width the bar SHALL stay one row of brand, the Dev mode badge shortened to "Dev" (still announced in full), the activity control as an agents status button and a menu button carrying a connection status dot. It hides the breadcrumb and activity labels, and the menu holds Agents, Settings, the connection details with Open InvenTree, and theme, so no essential information is lost. The decorative electronics current SHALL be masked so that no part overlaps the wordmark, breadcrumb or status controls.

#### Scenario: Expanded workflow on a narrow screen

- **GIVEN** a 390px viewport or 200% zoom and several active jobs
- **WHEN** the workflow disclosure opens and closes by keyboard
- **THEN** all text/actions are reachable, focus returns predictably and no header content is clipped or causes document horizontal overflow.

#### Scenario: Parts never cross header text

- **GIVEN** a desktop masthead with a breadcrumb and the electronics current running
- **WHEN** parts drift across the bar
- **THEN** they are fully transparent behind the wordmark and breadcrumb and behind the status controls, and visible only in the band between them.

### Requirement: Stage rows in workflow details

On desktop the workflow details SHALL be wide enough for one row per Processing stage of a batch, and on a phone a full-width sheet. Each row SHALL link to that stage's step page and show its state, a count where the stage has one (lots ready of the batch's lots; Examine shows lots formed and open questions), and a short status line: the newest status line from that stage's current, uncancelled attempts in the header's bounded active-session list, with its time, or else a plain reason.

#### Scenario: Stage rows for a working batch

- **GIVEN** Examine waiting on two questions, Research running on 7 of 12 lots, Images on 9 of 12 and Inventory queued
- **WHEN** the operator opens the workflow details
- **THEN** four rows read "Examine · 12 lots formed · 2 questions · Waiting for you", "Research · 7 of 12 lots · 2 working", "Images · 9 of 12 lots · 1 working" and "Inventory · 0 of 12 lots · Queued", each with its status line, and choosing a row opens that step's page.

#### Scenario: Stage with no listed session

- **GIVEN** Inventory has no session in the header's active-session list and waits on Research and Images
- **WHEN** its row renders
- **THEN** its status line reads a plain reason such as "Starts when Research and Images finish a lot", not an older agent line.

#### Scenario: Cancelled attempt still holding a slot

- **GIVEN** Research has finished every lot, and a cancelled Research attempt is still holding its slot until its worker is reaped
- **WHEN** its row renders
- **THEN** its status line gives a plain reason, not the cancelled attempt's last line, and the slot still shows as in use.

#### Scenario: No count for a stage

- **GIVEN** a stage whose step counts are not in the read
- **WHEN** its row renders
- **THEN** it shows its known state and status line with no invented count.

### Requirement: Stage bar states

Each stage's bar SHALL show one of: done, working, waiting for you, paused, queued, not started or failed, each distinguishable without colour alone. A counted stage SHALL fill to its ready share; one in progress without a count SHALL tint its whole bar rather than show an invented share. A stage that has made progress but waits for the operator SHALL NOT look unstarted. A paused batch SHALL say Paused and offer Resume.

#### Scenario: Examine waiting on questions

- **GIVEN** the Examine lead session formed lots and is waiting on two open questions, with no stage running
- **WHEN** the masthead chip and the workflow details render
- **THEN** Examine's bar is amber and still, labelled waiting for you, and no bar animates.

#### Scenario: Paused batch

- **GIVEN** a batch paused while Research and Images were part-way, with Research's turn still running and no Images turn running
- **WHEN** the workflow details render
- **THEN** Images shows the paused hatching filled to its ready share without animation and its row says Paused, Research stays working until its turn finishes, and the batch offers Resume.

### Requirement: Only working stages animate

A stage's bar SHALL animate only while an agent is working on that stage now; waiting, paused, queued, done and failed bars SHALL be still. The animation SHALL stop under reduced motion.

#### Scenario: Reduced motion

- **GIVEN** an operating system set to reduce motion and a stage being worked on
- **WHEN** the bars render
- **THEN** the working bar is still and remains distinguishable as working.
