# Capability delta

## MODIFIED Requirements

### Requirement: Categorized failures with diagnostic disclosure

Processing and session history SHALL display a failure category, an actionable summary and its recovery guidance. The failure summary read SHALL carry the recovery guidance, so showing it needs no details read.

**Show details.** When debug mode is on, they SHALL also offer an accessible Show details button. It reads the details on demand and shows them as a debug-marked panel. With debug mode off, the button and the diagnostic panel SHALL NOT render, and no details read is made.

**Retained details.** Details SHALL retain safe technical context across reloads, obey session read scope and exclude sensitive data before persistence, whatever the debug mode.

**Legacy and unknown failures.** These SHALL identify unavailable information without inventing a cause or retry guarantee.

#### Scenario: Operator inspects a failed session

- **GIVEN** a failed provider turn and debug mode on
- **WHEN** the operator opens its Processing view or session-history entry and activates Show details
- **THEN** a readable diagnostic panel opens with category, stage, stable error code, timestamp, session/attempt and correlation IDs, bounded safe causes, provider/model/version when known, and recovery guidance; closing it preserves the current selection and drafts, and disclosure never starts a retry.

#### Scenario: Failed session with debug mode off

- **GIVEN** a failed provider turn and debug mode off
- **WHEN** the operator opens its Processing view or session-history entry
- **THEN** the category, summary and recovery guidance are shown, no Show details button, error code or ID is present, and no failure details request is sent

#### Scenario: Legacy and unknown failures

- **GIVEN** an older failed session with no retained diagnostics, or an unclassified failure
- **WHEN** its details are opened
- **THEN** the UI shows unavailable legacy details or an Unknown category with the available correlation context, without claiming the failure is retryable.

#### Scenario: Sensitive or cross-session diagnostics

- **GIVEN** an exception containing a secret or a details request outside the caller's scope
- **WHEN** diagnostics are retained or read
- **THEN** credentials, capabilities, connection strings, private paths, raw prompts and evidence payloads are excluded before persistence; debug text and stacks are sanitized and bounded, raw exceptions are never exposed, and unauthorized reads reveal no diagnostic record.

## ADDED Requirements

### Requirement: Part description style delivered to sessions

Each attempt queued after a Part description style is saved SHALL seal the style text itself in its input, and the session SHALL receive it as operator guidance in its opening message. The style SHALL NOT change the profile's digest-verified instruction bytes or relax the existing description validation (one line, at most 250 characters). A later save SHALL NOT change what a queued or running attempt received.

#### Scenario: Style reaches a new session

- **GIVEN** a saved style "Type, key values, package, then variant"
- **WHEN** a Research session for a lot is queued and starts
- **THEN** its opening message contains the style, its sealed input holds the same text, and a proposed description over 250 characters is still rejected with the existing correctable error

#### Scenario: Style changed while queued

- **GIVEN** an attempt queued with style A and waiting for a slot
- **WHEN** the operator saves style B and the attempt then starts
- **THEN** the session receives style A, and only attempts queued after the save receive B

#### Scenario: No style saved

- **GIVEN** no saved style
- **WHEN** a session is queued
- **THEN** its instructions are as they are today
