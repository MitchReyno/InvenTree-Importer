# Capability delta

## ADDED Requirements

### Requirement: New batches start from app-level defaults

Creating a batch SHALL copy the app-level default location, default supplier, Auto tags value and new-batch instructions saved at that moment into its first settings revision, in the same transaction as the creation. The instructions SHALL become its first whole-batch Custom instructions, attributed to the creating actor. Later changes to the app-level values SHALL NOT change existing batches.

#### Scenario: Defaults applied at creation

- **GIVEN** a saved default location, no default supplier, Auto tags on and new-batch instructions
- **WHEN** a batch is created
- **THEN** its Batch settings show that location as inherited, no supplier, Auto tags on and the instructions as Custom instructions, all at its first revision

#### Scenario: Settings changed after creation

- **GIVEN** a batch created with default location A
- **WHEN** the app-level default changes to B
- **THEN** the existing batch still inherits A, and only newer batches start with B

### Requirement: Unresolvable defaults are left out

A default location or supplier that no longer exists in InvenTree SHALL be left out of a new batch, and the batch SHALL record why, so Capture can say so.

#### Scenario: Missing default location

- **GIVEN** a saved default location that no longer exists in InvenTree
- **WHEN** a batch is created
- **THEN** the batch has no default location, and Capture says the saved default wasn't found
