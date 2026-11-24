## ADDED Requirements

### Requirement: Commands wait quietly for a verified read

A workspace showing cached or restored data SHALL keep its commands disabled until a successful HTTP read for that resource and scope, whose request started after it opened, has been adopted into the cache. A manual cache write (even of equal data), a restored entry, or a failed, cancelled or paused read SHALL NOT count.

#### Scenario: A cache write is not a verified read

- **GIVEN** Processing reopened while another view wrote its snapshot into the cache
- **WHEN** no HTTP read of its own has been adopted since it opened
- **THEN** its commands stay disabled until its own read lands.

### Requirement: The wait is quiet

While a workspace waits for a verified read, its disabled commands SHALL give the reason "Updating…" on hover, on keyboard focus and to assistive technology, its inputs SHALL keep their values, and no banner SHALL show unless the wait passes 3 s or the read fails.

#### Scenario: A draft open during a refresh

- **GIVEN** Review reopened from cache with a lot edit still open, and its first read still running
- **WHEN** the operator hovers or tabs to "Mark selected reviewed"
- **THEN** the command is announced as unavailable with "Updating…", stays focusable and does nothing when pressed; when the read lands, the draft is kept and the command stays unavailable because the lot edit is unsaved.

#### Scenario: A clean selection during a refresh

- **GIVEN** Review reopened from cache with lots selected, no edit open, and its first read still running
- **WHEN** that read is adopted
- **THEN** "Mark selected reviewed" becomes available.

#### Scenario: Read fails

- **GIVEN** a cached workspace whose read fails
- **WHEN** it renders
- **THEN** the existing "Status unavailable…" banner shows and the commands stay disabled, as "Live unverifiable workspace state" requires.

### Requirement: Background refreshes keep commands available

Once a workspace has a verified read, later background refreshes SHALL NOT disable its commands beyond each command's own conditions; for example, Review's acceptance still waits for its read to settle at the current capture revision. Each command SHALL keep its own expected revision and draft checks.

#### Scenario: Background refresh after verification

- **GIVEN** Review verified by a read since it opened
- **WHEN** a later live hint starts a background refresh
- **THEN** its manual-workflow commands stay available and each still sends its own expected revision, while acceptance waits for the read to settle at the current capture revision.

### Requirement: Commands without a revision wait for a settled read

A command that sends no expected revision (Pause, Resume, delivering instructions, and any other the audit finds) SHALL be available only with a settled verified read whose request started after the last relevant live hint was received, and SHALL be checked again when pressed.

#### Scenario: Instructions saved during a hint

- **GIVEN** Processing, where the operator saves an instruction edit and its live hint arrives before the save returns
- **WHEN** the automatic delivery is due
- **THEN** it waits as "Delivery pending" until a read started after the hint settles, then sends once, and Retry sends through the same gate.

#### Scenario: Commands without a revision

- **GIVEN** Processing, the Agents page or Settings › Agents showing Pause or Resume
- **WHEN** a read hasn't landed yet, or a relevant live hint has arrived, including during the reconciliation delay or while reconciliation waits behind a read already running
- **THEN** Pause and Resume, which send no expected revision, are unavailable until a read started after that hint settles, and are checked again when pressed.

### Requirement: Cached reads survive a reload in the same session

The app SHALL keep display-only snapshots of allowlisted reads in the browser tab's session storage, so a reload shows the last data at once while it refreshes. A snapshot SHALL be shown only after a fresh bootstrap confirms the same actor, target and target context, SHALL never count as a verified read, and SHALL expire after 12 hours or when the app build changes.

#### Scenario: Reload on Review

- **GIVEN** Review was read in this tab
- **WHEN** the operator reloads the page
- **THEN** the last Review data shows at once with commands disabled, and the page refreshes as on a return visit.

#### Scenario: New build or another target

- **GIVEN** reads persisted under one app build and target
- **WHEN** the app loads with a new build, or bootstrap reports another target
- **THEN** none of the persisted reads are shown.

### Requirement: Only allowlisted reads are stored

Only allowlisted resources, through display projections, SHALL be stored, under the app's own keys. Bootstrap and its CSRF token, credentials and sign-in payloads, the Agents list and session identifiers, media bytes and previews, URLs or keys carrying credentials, drafts, mutations, command intent and debug reads SHALL NOT be.

#### Scenario: What is stored

- **GIVEN** a session with Review, Processing and Agents read, and a credential dialog used
- **WHEN** session storage is inspected
- **THEN** it holds only the allowlisted display reads, with no CSRF token, credential, session identifier, draft or pending mutation.

### Requirement: A replaced read is not a failure

A read cancelled because a live update replaced it SHALL wait for the replacing read, for at most 10 seconds, and SHALL show nothing while it waits. Only a replacing read that fails, pauses or doesn't settle in time SHALL count as unavailable. A cancelled read SHALL still never verify a command.

#### Scenario: Live update during the reload after an answer

- **GIVEN** the operator answers a question, and the reload of saved values that follows is in flight
- **WHEN** the answer's live update cancels that read and a replacing read succeeds
- **THEN** no banner or message shows on any tab, and the new saved values show.

#### Scenario: Replacing read fails

- **GIVEN** a reload of saved values cancelled by a live update
- **WHEN** the replacing read fails
- **THEN** the batch reports the saved values as unavailable.

### Requirement: Unavailable saved values are reported calmly

When saved values can't be read, the batch SHALL show an amber notice saying when the values shown were loaded, with Try now, SHALL keep trying, and SHALL clear the notice once a read succeeds. Only when there are unsaved changes SHALL it name them, say they are kept and offer "Discard my changes". After a confirmed command whose status can't be read, Processing SHALL say "Saved. Showing the last status from HH:MM until it can be read again."

#### Scenario: Nothing edited

- **GIVEN** no unsaved changes, and the server can't be read after a save
- **WHEN** the reload fails
- **THEN** an amber notice reads "Couldn't load the latest values. Showing what was loaded at 13:12. Trying again…" with Try now and no Discard, and it clears itself once a read works.

#### Scenario: Unsaved changes

- **GIVEN** unsaved changes to Lot 3's quantity and Lot 5's location, and the server can't be read
- **WHEN** the reload fails
- **THEN** the notice says "Your unsaved changes to Lot 3 · quantity and Lot 5 · location are kept." with Try now and "Discard my changes", which drops only those changes.

#### Scenario: Saved command, status unavailable

- **GIVEN** an answer the server confirmed, and the Processing read after it fails
- **WHEN** Processing shows the outcome
- **THEN** it reads "Saved. Showing the last status from 13:12 until it can be read again.", and its commands stay disabled until a read succeeds.
