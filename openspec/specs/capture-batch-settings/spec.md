# capture-batch-settings Specification

## Purpose

Make batch settings and human capture context visible together without compromising retained defaults, overrides or safe editing.

## Requirements

### Requirement: One visible Batch settings panel

Capture SHALL replace the Shared details navigation buttons with a single Batch settings section containing their current title, default quantity/location and human-note functionality, together with the original mockup's supplier, purchase date, storage location, tags, inheritance explanation and visible per-item overrides. No settings navigation button SHALL be needed to reveal a separate settings panel.

#### Scenario: Open Capture

- **GIVEN** a retained batch with defaults and a lot-specific override
- **WHEN** Capture opens
- **THEN** one Batch settings panel exposes the settings, labels the inherited values and identifies the lot override without merging lots or hiding current quantity controls.

### Requirement: Explicit retained settings and context

Enabled settings SHALL save to retained server state with explicit save/discard, loaded-revision comparison and truthful confirmation. New supplier/date/tag context SHALL preserve human provenance and per-lot inherit/override/unset/unknown/clear semantics where applicable. Human capture context MUST NOT silently become approved stock, Part or PO effects. Dates SHALL preserve calendar dates without timezone conversion and exact quantities/PKs SHALL remain strings.

#### Scenario: Reload after acknowledged save

- **GIVEN** settings with a supplier observation, date, tags, exact quantity and explicit lot overrides
- **WHEN** the settings are acknowledged and the page reloads
- **THEN** the same values, identities and inheritance modes appear, and Review distinguishes capture context from approved inventory effects.

#### Scenario: Conflict or unconfirmed save

- **GIVEN** a dirty settings panel and a newer server revision or a lost acknowledgement
- **WHEN** saving is refused or cannot be confirmed
- **THEN** local inputs remain intact, saved state/conflict is explained, and no automatic rebase, partial-success claim or newly keyed retry occurs.

#### Scenario: Change a default with existing explicit overrides

- **GIVEN** one inheriting lot and one explicit override
- **WHEN** a batch default changes
- **THEN** only the inheriting effective context changes, the override remains visible, and affected review/processing freshness is reconciled before use.

### Requirement: Disabled purchase-order controls

The Batch settings panel SHALL contain the mockup's purchase-order controls and applicable related fields/components, visibly disabled and greyed out with a readable explanation that PO creation is not yet available. They MUST NOT be editable, submitted as active PO intent or cause any purchase-order operation.

#### Scenario: PO controls visible but inactive

- **GIVEN** a batch with or without a supplier
- **WHEN** the operator examines Batch settings and saves other fields
- **THEN** the PO controls remain visibly disabled with an explanation, and neither keyboard/pointer interaction nor the settings payload can request PO creation.

### Requirement: Evidence-based responsive placement

Implementation SHALL compare a right-side settings panel against an above-content panel before choosing the layout. The comparison SHALL record evidence visibility, settings discoverability, reading/focus order and draft continuity using desktop, 360px/390px and 200% zoom. The selected layout SHALL preserve the approved light palette and usable controls without document horizontal overflow.

#### Scenario: Select a layout after comparison

- **GIVEN** both candidate placements using representative synthetic Capture content
- **WHEN** the implementer compares them at desktop/narrow/zoom sizes
- **THEN** retained comparison evidence explains the chosen placement, settings and evidence remain reachable, and responsive reflow does not reset a dirty form.
