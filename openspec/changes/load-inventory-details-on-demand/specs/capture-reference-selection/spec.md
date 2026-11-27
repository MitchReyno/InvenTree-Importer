## ADDED Requirements

### Requirement: Load reference candidates on menu open

Capture and Settings batch defaults SHALL fetch a supplier or location candidate list on demand when an enabled menu for that model opens. Saved choices SHALL remain legible and clearable wherever clearing is supported, independently of candidate availability.

#### Scenario: Cold visit and independent first opens

- **GIVEN** an empty cache and saved choices in Capture or Settings batch defaults
- **WHEN** the operator visits, reads the labels, focuses a closed field or clears a saved default
- **THEN** neither candidate endpoint is called
- **WHEN** the operator opens Supplier by keyboard or pointer
- **THEN** one supplier candidate request starts and no location candidates are requested

#### Scenario: Shared location candidates

- **GIVEN** a batch with an editable default location and parent location picker
- **WHEN** either menu opens and the other opens while the request is pending or the result is fresh
- **THEN** both use a single location request within that batch and target scope

#### Scenario: Unavailable candidates or changed target

- **GIVEN** a disabled picker, a failed candidate read, or a change of target while a read is pending
- **WHEN** the operator views the field and later opens it in an eligible scope
- **THEN** a disabled field makes no request, an unavailable list preserves the saved choice and permits retry on reopen, and results from the former scope cannot appear in the current menu
