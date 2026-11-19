# Capability delta

## ADDED Requirements

### Requirement: New batches start from app-level defaults

Creating a batch SHALL copy the app-level values saved at that moment into the new batch's first settings revision:

- the default location, when it still exists in InvenTree;
- the default supplier, when it still exists;
- the Auto tags value;
- the new-batch instructions, as its first whole-batch Custom instructions, attributed to the creating actor.

The copy SHALL happen in the same transaction as the creation. Later changes to the app-level values SHALL NOT change existing batches. A default that can't be resolved SHALL be left out, and the batch SHALL record why, so Capture can say so.

#### Scenario: Defaults applied at creation

- **GIVEN** a saved default location, no default supplier, Auto tags on and new-batch instructions
- **WHEN** a batch is created
- **THEN** its Batch settings show that location as inherited, no supplier, Auto tags on and the instructions as Custom instructions, all at its first revision

#### Scenario: Missing default location

- **GIVEN** a saved default location that no longer exists in InvenTree
- **WHEN** a batch is created
- **THEN** the batch has no default location, and Capture says the saved default wasn't found

#### Scenario: Settings changed after creation

- **GIVEN** a batch created with default location A
- **WHEN** the app-level default changes to B
- **THEN** the existing batch still inherits A, and only newer batches start with B
