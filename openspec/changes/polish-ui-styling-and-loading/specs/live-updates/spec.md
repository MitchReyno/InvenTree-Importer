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
