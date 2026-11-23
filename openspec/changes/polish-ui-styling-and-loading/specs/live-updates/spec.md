## ADDED Requirements

### Requirement: Commands wait quietly for a current read

A workspace showing cached data SHALL keep its commands disabled until a read made since it opened succeeds, as today. While it waits, each disabled command SHALL give the reason "Updating…" on hover and to assistive technology, and inputs SHALL keep their typed values. No banner SHALL announce the wait unless it lasts over 3 s or the read fails.

#### Scenario: Answer typed during a refresh

- **GIVEN** Processing reopened from cache, with its refresh still running
- **WHEN** the operator types an answer and hovers Send
- **THEN** Send is disabled with "Updating…", the typed answer is kept, and Send becomes available when the read lands.

#### Scenario: Read fails

- **GIVEN** a cached workspace whose refresh fails
- **WHEN** it renders
- **THEN** the existing "Status unavailable…" banner shows and the commands stay disabled, as "Live unverifiable workspace state" requires.

### Requirement: Cached reads survive a reload in the same session

The app SHALL keep allowed reads in the browser tab's session storage, so a reload shows the last data at once as cached data while it refreshes. Persisted reads SHALL expire after 12 hours or when the app build changes, and SHALL be dropped when the actor, target or target context changes. Credentials, token commands and debug reads SHALL NOT be persisted.

#### Scenario: Reload on Review

- **GIVEN** Review was read in this tab
- **WHEN** the operator reloads the page
- **THEN** the last Review data shows at once with commands disabled, and the page refreshes as on a return visit.

#### Scenario: New build or another target

- **GIVEN** reads persisted under one app build and target
- **WHEN** the app loads with a new build, or connects to another target
- **THEN** none of the persisted reads are shown.
