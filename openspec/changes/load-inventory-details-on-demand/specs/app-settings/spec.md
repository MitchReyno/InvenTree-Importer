## ADDED Requirements

### Requirement: Agent settings read subsection data on demand

Agent Settings SHALL read session totals for the visible Sessions controls and readiness for visible Web research controls, including direct navigation to either subsection. Other settings SHALL remain usable independently.

#### Scenario: Edit instructions then scroll to sessions

- **GIVEN** only Instructions is visible
- **WHEN** the operator edits instructions through multiple poll intervals
- **THEN** Agent Settings requests neither the session list nor readiness for those offscreen controls
- **WHEN** Sessions becomes visible and subsequently leaves the viewport
- **THEN** its totals refresh on entry and its polling stops on exit, preserving drafts and the requirement for a current read before Pause all

#### Scenario: Open Web research directly

- **WHEN** the operator follows the Web research subsection link
- **THEN** readiness is requested for that subsection and its loading or failure leaves unrelated settings usable
