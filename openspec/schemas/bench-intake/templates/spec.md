# Capability delta

<!-- For NEW capabilities only, retain Purpose and replace its paragraph with a meaningful explanation of at least 50 characters. Remove Purpose for existing-capability deltas. Keep only applicable native delta sections below; repeat complete requirements/scenarios as needed. A skip_specs change must not create this file. -->

## Purpose

Describe the durable behavior this new capability provides and why its consumers need it.

## ADDED Requirements

### Requirement: Observable capability outcome

The system SHALL deliver the stated observable outcome within the explicitly defined authority and input constraints.

#### Scenario: Intended outcome

- **GIVEN** the relevant initial state and authorized actor
- **WHEN** the actor performs the specified action with valid inputs
- **THEN** the system produces the stated observable result

#### Scenario: Relevant failure or stale input

- **GIVEN** the change-specific invalid, stale or unavailable precondition
- **WHEN** the action reaches the relevant boundary
- **THEN** the system returns the defined outcome and preserves the stated invariants

<!-- For MODIFIED Requirements, copy the full existing requirement block and all scenarios before editing. REMOVED Requirements need Reason and Migration. RENAMED Requirements use native FROM/TO entries. Do not leave illustrative requirements or placeholder scenarios in a real delta. -->
