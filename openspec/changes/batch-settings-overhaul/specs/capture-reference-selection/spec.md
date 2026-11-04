# Capture reference selection delta

## Purpose

Provide concise searchable location and supplier choices with attributable defaults and reviewed new-record intents.

## ADDED Requirements

### Requirement: Scoped searchable reference pickers

Default location, supplier and optional parent location SHALL use one labelled searchable single-selection input each. Search SHALL prioritize names, show unambiguous IDs and location hierarchy, support bounded pagination and retain selected IDs independently of query text. Numeric input SHOULD additionally find an exact ID through a supported detail read. Results MUST be scoped to the configured target and current request, and no browser-provided target URL or credential is accepted.

#### Scenario: Search and select by name

- **GIVEN** similarly named locations and suppliers on the configured target
- **WHEN** the operator types a name and selects a result
- **THEN** name matches appear first with distinguishing identity/path labels, the selected exact ID is observed/validated before retention, and no separate ID-entry/read step is needed.

#### Scenario: Older response arrives after a newer query

- **GIVEN** requests for two different search terms or target contexts
- **WHEN** the older response arrives last
- **THEN** it cannot replace current results or selection; unavailable, empty, loading and partially loaded results remain distinct.

#### Scenario: Numeric ID and keyboard interaction

- **GIVEN** numeric search input and a configured detail-read capability
- **WHEN** the matching ID exists and the operator uses arrows, Enter and Escape
- **THEN** the exact match is available without claiming text search covers every ID, selection/dismissal and focus behave predictably, and disabled/empty/error states are announced.

### Requirement: Default location precedence

The batch SHALL have one optional Default location. Explicit lot, shared-Part and applicable group assignments SHALL precede it in that order, with clear suppressing fallback. Conflicting group assignments SHALL require resolution. Resolution MUST preserve physical lots and quantities; a Part assignment is an application default, not an inventory Part field.

#### Scenario: Mixed assignments

- **GIVEN** distinct lots with explicit lot, shared-Part, group and no specific locations
- **WHEN** the batch default changes
- **THEN** only fallback locations change, their source is shown in Review and stock remains assigned once per physical lot with unchanged quantities.

#### Scenario: Evidence supports conflicting groups

- **GIVEN** a lot linked to evidence in groups with different locations and no higher-precedence assignment
- **WHEN** effective location is prepared
- **THEN** the ambiguity is surfaced for review and no arbitrary destination is approved.

### Requirement: New location and supplier intents

Pickers SHALL offer new-record draft forms: location name, optional description/parent; supplier name, optional description/logo and manufacturer flag. Drafts SHALL be attributable application intent, separate from inventory IDs. External creation SHALL require reviewed approved supervised execution with original-operation recovery; autosave MUST NOT create inventory records.

#### Scenario: Prepare a new location or supplier

- **GIVEN** an authorized editable batch and no suitable existing result
- **WHEN** a valid new-record form is saved automatically
- **THEN** an identifiable pending intent appears, parent/supplier role and uploaded logo are retained, and the target has received no create request; execution-unavailable state is truthful until supported.

#### Scenario: Duplicate or uncertain creation

- **GIVEN** an approved new-record operation whose acknowledgement is lost or a same-name existing record is discovered
- **WHEN** the operator returns to it
- **THEN** the original operation remains unresolved or offers explicit reuse/reconciliation; no new create key or name-only assumption duplicates the record.

#### Scenario: Invalid parent or unsupported target

- **GIVEN** a foreign/stale parent, insufficient permission or unsupported write profile
- **WHEN** a location intent is reviewed or dispatched
- **THEN** it is refused before an external create and its draft remains available for correction.

### Requirement: Supplier absence and future logo discovery

No supplier SHALL disable supplier selection, exclude effective supplier intent and preserve its recoverable draft. Unchecking SHALL restore it for review. New supplier SHALL show disabled Find automatically for its optional logo with a focus/hover-accessible coming-soon explanation. This control MUST NOT trigger discovery.

#### Scenario: Toggle supplier absence

- **GIVEN** a selected supplier or new-supplier draft
- **WHEN** No supplier is checked and later unchecked
- **THEN** the picker disables while absent, effective context records explicit absence, and the previous selection/draft can be restored without a remote mutation.

#### Scenario: Inspect future logo discovery

- **GIVEN** the new-supplier form
- **WHEN** keyboard or pointer reaches the Find automatically explanation
- **THEN** coming-soon text is readable and the disabled checkbox cannot request logo discovery; optional manual logo upload remains separate.
