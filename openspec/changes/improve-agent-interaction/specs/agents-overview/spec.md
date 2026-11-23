## MODIFIED Requirements

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

- **GIVEN** batch Heyyy with one session whose latest attempt failed, one waiting for an answer and one whose failed attempt was followed by a successful one, and another batch with nothing needing attention
- **WHEN** the Agents page opens
- **THEN** the Needs attention chip is selected and counts 2, Heyyy shows those two sessions, the recovered session is not listed, and the other batch collapses to one line saying nothing needs attention.

#### Scenario: Archived batches only under All

- **GIVEN** an archived batch with finished sessions
- **WHEN** the operator views any chip other than All
- **THEN** the archived batch is not listed, and under All it is.

## ADDED Requirements

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
