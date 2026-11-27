## ADDED Requirements

### Requirement: Preserve connection status across batch navigation

Opening a batch SHALL preserve the shared connection reader and its scope. A live-ready refresh SHALL use that reader while batch editing observes the result under its existing freshness rules.

#### Scenario: Healthy inbox to batch navigation

- **GIVEN** a healthy scoped connection on the Batches page
- **WHEN** the operator opens a batch and the new live subscription announces ready
- **THEN** the scoped connection refresh succeeds and the masthead continues to report the observed status without displaying “Intake service degraded”

#### Scenario: Scoped connection read actually fails

- **GIVEN** Intake is reachable and a batch is open
- **WHEN** the scoped connection refresh fails
- **THEN** the masthead reports degraded service and editing uses the existing failure and freshness checks until recovery
