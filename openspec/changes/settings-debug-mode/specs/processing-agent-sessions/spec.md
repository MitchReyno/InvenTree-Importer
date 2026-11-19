# Capability delta

## MODIFIED Requirements

### Requirement: Categorized failures with diagnostic disclosure

Processing and session history SHALL display a failure category, an actionable summary and its recovery guidance.

**Show details.** When debug mode is on, they SHALL also offer an accessible Show details button. With debug mode off, the button and the diagnostic panel SHALL NOT render.

**Retained details.** Details SHALL retain safe technical context across reloads, obey session read scope and exclude sensitive data before persistence, whatever the debug mode.

**Legacy and unknown failures.** These SHALL identify unavailable information without inventing a cause or retry guarantee.

#### Scenario: Operator inspects a failed session

- **GIVEN** a failed provider turn and debug mode on
- **WHEN** the operator opens its Processing view or session-history entry and activates Show details
- **THEN** a readable diagnostic panel opens with category, stage, stable error code, timestamp, session/attempt and correlation IDs, bounded safe causes, provider/model/version when known, and recovery guidance; closing it preserves the current selection and drafts, and disclosure never starts a retry.

#### Scenario: Failed session with debug mode off

- **GIVEN** a failed provider turn and debug mode off
- **WHEN** the operator opens its Processing view or session-history entry
- **THEN** the category, summary and recovery guidance are shown, and no Show details button, error code or ID is present

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

When a Part description style is saved, each session queued afterwards that may propose a Part description SHALL receive the style as operator guidance, alongside its other instructions. The settings revision it came from SHALL be sealed in the attempt. The style SHALL NOT change the profile's digest-verified instruction bytes. It SHALL NOT relax the existing description validation: one line, at most 250 characters. A session already queued or running SHALL keep the guidance it was sealed with.

#### Scenario: Style reaches a new session

- **GIVEN** a saved style "Type, key values, package, then variant"
- **WHEN** a Research session for a lot is queued
- **THEN** its delivered instructions contain the style, its attempt records the settings revision, and a proposed description over 250 characters is still rejected with the existing correctable error

#### Scenario: No style saved

- **GIVEN** no saved style
- **WHEN** a session is queued
- **THEN** its instructions are as they are today
