# agents-overview Specification

## Purpose

An app-level Agents page shows every agent session across batches. The operator sees capacity, what is waiting for them and what each agent is doing, without opening each batch.

## Requirements

### Requirement: Agents page

The Agents page SHALL list every agent session in authorised scope, grouped by batch, as one row per session (see "Session rows"). Each row SHALL show its step, subject, latest status line, state and when that state started, and its title SHALL open that session's page. A summary SHALL show slots in use against the limit, the model in use, and how many sessions need attention. Filter chips SHALL be Needs attention, Working, Waiting for you, Queued, Done today and All, opening on Needs attention; counts are sessions, not attempts. Each batch group SHALL link to that batch's Processing.

#### Scenario: Waiting sessions do not count as running

- **GIVEN** three running sessions and two waiting for answers, with a limit of three
- **WHEN** the page opens
- **THEN** it shows 3 of 3 slots in use and 2 waiting for you, and the waiting sessions are labelled as holding no slot.

#### Scenario: No session support yet

- **GIVEN** a profile without native sessions
- **WHEN** the page opens
- **THEN** it says agent sessions are not available for this setup because the server's processing profile runs none, without showing an empty list as “nothing running”.

#### Scenario: Open a session's page

- **GIVEN** the Agents page lists the Research session for the ATmega328P lot
- **WHEN** the operator opens its row
- **THEN** that session's page opens inside its batch's Processing.

#### Scenario: Opens on what needs attention

- **GIVEN** batch Heyyy with one session whose latest attempt failed, one waiting for an answer and one whose failed attempt was followed by a successful one, and batch Spill with one session that can't resume, and another batch with nothing needing attention
- **WHEN** the Agents page opens
- **THEN** the Needs attention chip is selected and counts 3, Heyyy shows those two sessions, Spill shows its session, the recovered session is not listed, and the other batch collapses to one line saying nothing needs attention.

#### Scenario: Archived batches only under All

- **GIVEN** an archived batch with finished sessions
- **WHEN** the operator views any chip other than All
- **THEN** the archived batch is not listed, and under All it is.

### Requirement: Agents filter rules

Needs attention SHALL list the sessions whose current attempt failed, was interrupted, can't resume, waits for sign-in or waits for an answer. Working SHALL list the sessions whose current attempt is running. Done today SHALL list the sessions whose current attempt ended within the operator's local day, by its recorded end rather than when it last ran. A held slot SHALL count only in the slot total. The server SHALL apply each filter's rule to both its rows and its chip count.

#### Scenario: Waiting for sign-in needs attention

- **GIVEN** a Research session whose current attempt waits for the provider's sign-in
- **WHEN** the Agents page opens
- **THEN** it is listed and counted under Needs attention.

#### Scenario: Stopped attempt still holding a slot

- **GIVEN** a session whose current attempt was cancelled and still holds its slot until its worker is reaped
- **WHEN** the operator views the chips
- **THEN** Working neither lists nor counts it, Done today lists and counts it when it was cancelled today, and the slot total still counts the slot.

#### Scenario: Cancelled today after settling yesterday

- **GIVEN** a session whose current attempt last settled a turn yesterday and was cancelled this morning
- **WHEN** the operator views the chips
- **THEN** Done today counts and lists it, and a session that ended yesterday is not counted.

### Requirement: Session rows

The Agents page and Processing's session list SHALL show one row per session (job), not per attempt, with its current attempt's state first. Earlier attempts SHALL fold under "N earlier attempts failed ▸" (or ended), each with its time and cause. State words SHALL be the shared set defined by `polish-ui-styling-and-loading`.

#### Scenario: Retries fold into one row

- **GIVEN** batch Heyyy with eight attempts across three sessions, five of them failed retries
- **WHEN** Processing's session list or the Agents page shows the batch
- **THEN** it shows three rows, each with its current state, and a row with retries shows "2 earlier attempts failed ▸" that expands to each attempt's time and cause.

### Requirement: Failed rows offer recovery

A session row whose current attempt failed SHALL offer Start fresh, Open session, Failure details and, for a lot session, Open lot in Review. Start fresh SHALL run only under a current read of the batch and SHALL show as unavailable, with the reason, where the batch can't start the session again, such as an archived batch or a retired lot. Opening failure details SHALL NOT start a retry.

#### Scenario: Failed row recovery

- **GIVEN** a Research session whose latest attempt failed
- **WHEN** its row is shown
- **THEN** it offers Start fresh, Open session, Failure details and Open lot in Review, and its title opens the session.
