# Capture inference preferences delta

## Purpose

Separate requested automation from reviewed values so quantities, order context and shared tags remain attributable and correctable.

## ADDED Requirements

### Requirement: Evidence-derived quantity proposals

Removing Batch settings Quantity mode SHALL NOT remove exact per-lot review/correction or overwrite an existing human count. Agent quantities SHALL be evidence-grounded proposals carrying supporting evidence and estimated/inferred provenance. No defensible estimate SHALL produce an operator question. Proposed quantities MUST NOT become executable stock counts without explicit human review and the existing approval path; provider unavailability SHALL be shown honestly.

#### Scenario: Reasonable estimate for review

- **GIVEN** evidence sufficient for a defensible estimate and no chosen exact human count
- **WHEN** processing returns a quantity suggestion
- **THEN** Review labels its source/estimated status, allows correction or acceptance per physical lot and requires approval before any stock effect.

#### Scenario: Evidence cannot establish current count

- **GIVEN** an opened packet with only an ordered quantity or no defensible estimate
- **WHEN** processing considers current stock quantity
- **THEN** it asks for a count instead of inventing a usable quantity, and unresolved stock remains blocked without discarding other work.

#### Scenario: Older suggestion after a human correction

- **GIVEN** an exact human count or newer evidence revision
- **WHEN** an older attempt publishes an estimate
- **THEN** it remains stale history and cannot replace the human value or satisfy current review.

### Requirement: Auto None and Manual order context

Prepared order/receipt number and purchase date SHALL each represent Auto, None and Manual as distinct intent. New fields default to Auto; manual numbers remain exact text and manual dates remain valid calendar dates. Auto SHALL mean evidence-derived proposal, not invented numbering or today's date; unresolved Auto SHALL remain unknown for review. Hidden fields SHALL preserve retained values and no preview value SHALL authorize a PO.

#### Scenario: New batch preview

- **GIVEN** a new batch with no explicit order context
- **WHEN** the disabled PO preview opens
- **THEN** number and date initially show Auto, None and manual entry are represented by the reusable components, and no active PO intent is persisted.

#### Scenario: Retained manual date and number

- **GIVEN** an imported or previously retained manual order reference and calendar date
- **WHEN** the panel loads or new evidence arrives
- **THEN** those values remain manual and unchanged; Auto extraction cannot overwrite them and date display introduces no timezone shift.

### Requirement: Shared manual and automatic Part tags

Shared part tags SHALL support explicit manual tags and an independent Auto checkbox, allowing manual-only, automatic-only, both or neither. Manual tags SHALL remain attributable and suggestions SHALL be reviewable, deduplicated under a declared policy and scoped to shared Part proposals rather than duplicated physical lots. Existing-Part reuse MUST NOT silently authorize replacement of its tags. Removing a manual tag SHALL NOT be undone by replaying older automatic output.

#### Scenario: Manual plus Auto

- **GIVEN** manual tags and Auto enabled
- **WHEN** processing proposes additional tags
- **THEN** Review distinguishes human tags from suggestions, deduplicates accepted values and applies only approved supported new-Part effects once per shared Part.

#### Scenario: Auto disabled or existing Part reused

- **GIVEN** Auto disabled or an existing inventory Part selected
- **WHEN** capture context is processed
- **THEN** no automatic tags are added while disabled and no existing-Part tag collection is changed; unsupported requested effects are explained rather than implied saved to inventory.

#### Scenario: Migrate capture-only tags

- **GIVEN** existing human capture tags and exact quantities
- **WHEN** the new schema is read
- **THEN** tags map to manual intent with Auto off, old values and provenance remain readable and neither tags nor quantities become newly approved effects.
