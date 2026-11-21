# capture-records Specification

## Purpose

Retain each intake batch as durable server-side records: one original source, stable physical lots, shared Part proposals, immutable human notes and versioned selections with exact values. Capture records are human draft state; they never create inventory effects or execution ownership.

## Requirements

### Requirement: Capture batch and source identity

Creating a batch SHALL assign one immutable original source namespace, a title and an optional initial human note, bound to the configured actor, target and target context. Batch and source identity MUST NOT change after creation, and a batch SHALL be visible only within the target and context it was created under.

#### Scenario: Create a batch with a note

- **GIVEN** a configured development actor and target context
- **WHEN** a batch is created with a title and an initial note
- **THEN** the response holds a new batch ID and source ID, and the note is retained verbatim with human producer and the configured actor.

#### Scenario: Exact create replay

- **GIVEN** a batch created with an idempotency key
- **WHEN** the same create is sent again with the same key and payload
- **THEN** the original batch is returned, and the same key with a changed title is refused with 409.

#### Scenario: Different target binding

- **GIVEN** a batch created under one target context
- **WHEN** the server is rebound to another target and the batch or a retained edit is requested
- **THEN** the batch reads as not found (404) and the retained edit discloses nothing from the old scope.

### Requirement: Capture physical lots and shared Part proposals

A lot SHALL be a physical contribution of exactly one batch with a stable lot ID and an original contribution key assigned once, and several lots MAY link to one shared Part proposal. Lot identity and contribution key MUST remain unchanged by edits, reordering, archive, restart or later approval rounds.

#### Scenario: Two packets of one Part

- **GIVEN** a batch with one Part proposal
- **WHEN** two lots are added that link to it
- **THEN** each lot has its own ID and contribution key, and both reference the same Part subject.

#### Scenario: Identity survives restart

- **GIVEN** retained lots with contribution keys
- **WHEN** the server restarts and the batch is read again
- **THEN** every lot keeps its original ID and contribution key, and a direct update of a contribution key is refused by the database.

#### Scenario: Cross-batch or naked subject

- **GIVEN** two batches
- **WHEN** an edit in one batch references a Part from the other, or a subject is inserted without its lot or Part extension
- **THEN** the edit is refused as not found and the subject insert fails, with no partial change.

### Requirement: Capture immutable human notes

Human notes SHALL be retained verbatim, up to 8,192 characters, with batch or subject scope, actor and time. A note MUST NOT be edited or deleted, so a correction SHALL be a new note beside the earlier ones.

#### Scenario: Correct a count by note

- **GIVEN** a lot whose original note gives a label count
- **WHEN** a new note says the corrected count is unknown
- **THEN** both notes are listed in order and the original command bytes still contain the first note.

#### Scenario: Note on an archived batch

- **GIVEN** an archived batch
- **WHEN** a note is added
- **THEN** the edit is refused with 409 `batch_archived`.

### Requirement: Capture exact values

Quantities SHALL be canonical positive decimal strings with at most 13 integer and 6 fractional digits, and inventory PKs and revisions SHALL be positive integer strings within signed 64-bit range. Values SHALL cross the API as exact strings, and non-canonical values SHALL be refused before storage.

#### Scenario: Boundary quantities

- **GIVEN** a lot
- **WHEN** its quantity is set to `0.000001` or `9999999999999.999999`
- **THEN** the exact string is retained and read back unchanged.

#### Scenario: Non-canonical values

- **GIVEN** a lot and an observation request
- **WHEN** a quantity such as `0`, `1e2`, `2.0`, `01` or a JSON number, or a PK such as `093`, `0` or `9223372036854775808`, is submitted
- **THEN** the request is refused with 400 and the batch revision is unchanged.

### Requirement: Capture selection modes and history

Quantity, location and Part choice selections SHALL distinguish `unset`, `unknown`, `clear`, `inherit` and `set`, and each explicit selection SHALL be retained as a new immutable version with its actor. An edit that omits a field SHALL insert no selection for it, and every accepted edit SHALL be retained as exact canonical command bytes with their digest.

#### Scenario: Omitted field keeps an explicit clear

- **GIVEN** a lot whose quantity was explicitly cleared
- **WHEN** only its label is edited
- **THEN** its quantity still reads `clear`.

#### Scenario: Inherit follows the default, explicit values do not

- **GIVEN** lot A inheriting location and lot B with an explicit location
- **WHEN** the batch default location changes
- **THEN** A still reads `inherit`, B keeps its explicit location, and the default reads the new value.

#### Scenario: A default cannot inherit

- **GIVEN** a batch
- **WHEN** a default is set to `inherit`
- **THEN** the edit is refused with `default_cannot_inherit`.

#### Scenario: History retained

- **GIVEN** five successive quantity selections on one lot
- **WHEN** the selection table is read
- **THEN** all five versions remain, and update or delete of notes, selections, observations, revisions or sources is refused as immutable authority.

### Requirement: Capture revision checks and idempotency

Every capture edit SHALL carry the expected batch revision, and a stale revision SHALL be refused with 412 rather than merged. Every capture command SHALL carry a payload-bound idempotency key whose replay returns the original outcome, while the same key with a different payload SHALL be refused as a conflict.

#### Scenario: Concurrent edits

- **GIVEN** two clients holding the same batch revision
- **WHEN** both submit a title edit
- **THEN** one succeeds and the other is refused with 412.

### Requirement: Capture atomic bulk lot edits

A bulk edit SHALL change every named lot or none in one revision-checked command, leaving unnamed lots' selections and exact strings unchanged. A preview SHALL report which preparations would go stale and SHALL write nothing.

#### Scenario: Unknown lot in the set

- **GIVEN** a bulk quantity edit naming two lots and one unknown subject
- **WHEN** it is submitted
- **THEN** it is refused with `subject_not_found` and no selection or revision is written.

#### Scenario: Stale revision

- **GIVEN** a bulk edit at an old batch revision
- **WHEN** it is submitted
- **THEN** it is refused with 412 and nothing changes.

#### Scenario: Preview an unrelated lot

- **GIVEN** a preparation for lot A
- **WHEN** a bulk edit of lot B is previewed
- **THEN** the preview names no stale preparation and nothing is written.

### Requirement: Capture inventory observations

An inventory observation SHALL record the PK and label of an allowlisted target record (Part, location, category, parameter template, category parameter or company) read after the batch scope is authorized, bound to the batch and target context, and an unavailable or invalid read SHALL be reported as unavailable (503), never as absence. Creating an observation MUST NOT change any selection, and a choice SHALL reference an observation of the matching model in the same batch and context.

#### Scenario: Unauthorized scope

- **GIVEN** a batch ID that does not exist for this actor
- **WHEN** an observation is requested for it
- **THEN** the request is refused with 404 and no target read is made.

#### Scenario: Wrong observation for a choice

- **GIVEN** a location observation, or a Part observation with a changed observation ID or target context
- **WHEN** it is used as a Part choice
- **THEN** the edit is refused with 422.

### Requirement: Capture archive and resume

Archiving a batch SHALL be reversible, SHALL NOT delete evidence, notes, selections or identities, and SHALL refuse edits until the batch is unarchived. Batch lists SHALL return at most the 100 most recent batches with explicit truncation, and any retained batch SHALL remain readable by its direct URL.

#### Scenario: Archived batches in the list

- **GIVEN** an archived batch and an active batch
- **WHEN** the list is read with archived batches excluded, then included
- **THEN** the first read lists only the active batch and the second lists both, with title search and bounded offsets applied before the page limit.

#### Scenario: Archive, restart and resume

- **GIVEN** an archived batch
- **WHEN** the server restarts, the batch is read and then unarchived
- **THEN** its source, lot identities, choices, overrides and notes are unchanged, and edits are accepted again.

### Requirement: Capture batch capacity

A batch SHALL hold at most 100 subjects, including retired lots, and its complete snapshot SHALL stay within 240 KiB. An edit that would exceed either bound SHALL be refused with 409 `capture_capacity` and roll back entirely.

#### Scenario: Subject limit

- **GIVEN** a batch with 100 subjects
- **WHEN** another lot is added
- **THEN** the edit is refused with `capture_capacity` and the batch is unchanged.

### Requirement: Capture lot split, merge and move with lineage

Before approval, split, merge and move between Part proposals SHALL each run as one revision-checked command, and a split or merge SHALL retire its predecessor lots and create new lot identities linked to them by lineage. A merge SHALL require explicit confirmation that the lots are one physical contribution, and a preview SHALL report the impact, including stale preparations, and then roll back.

#### Scenario: Split a packet

- **GIVEN** an unapproved lot with an explicit location and lot context
- **WHEN** it is split into two children with quantities 10 and 13
- **THEN** the original is retired, each child has a new ID, the Part link and explicit location and context are copied, and lineage links the original to both children.

#### Scenario: Merge needs confirmation

- **GIVEN** two active lots of the same batch
- **WHEN** a merge is sent without `confirm_same_physical_contribution`, with a duplicated lot or with a lot from another batch
- **THEN** it is refused (400, 400 and 404) and nothing changes.

#### Scenario: Merge with conflicting context

- **GIVEN** two lots whose supplier context differs
- **WHEN** they are merged with confirmation
- **THEN** the merged lot's supplier context is `unknown` rather than either value.

#### Scenario: Restructure an approved lot

- **GIVEN** a lot whose original contribution is approved
- **WHEN** it is split or moved
- **THEN** the command is refused with 409 `lot_already_approved`.

#### Scenario: Preview without effect

- **GIVEN** a prepared lot A
- **WHEN** a move of A is previewed
- **THEN** the response names A's preparation as stale, returns no new IDs, keeps no idempotency record and changes nothing.

### Requirement: Capture retired lots

A retired lot SHALL remain in the batch snapshot marked `retired`, with its history readable. Edits, notes, media links and attachment selections on it SHALL be refused with `lot_retired`, and selecting it for review or preparation SHALL be blocking.

#### Scenario: Edit a retired lot

- **GIVEN** a lot retired by a split
- **WHEN** it is renamed, noted, reviewed, prepared or split again
- **THEN** each is refused or blocked with `lot_retired`, and its successors are listed against it.
