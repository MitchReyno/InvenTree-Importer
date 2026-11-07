# approval-preparation Specification

## Purpose

Turn reviewed capture records into a frozen, read-only preparation for exactly the selected lots, and approve that exact plan in one atomic commit. Preparation never mutates inventory, approval never widens scope, and original contributions are never approved twice.

## Requirements

### Requirement: Preparation selected lot scope

Review, preparation and approval SHALL take an explicit list of 1 to 10 unique lot IDs from one batch, with the expected batch revision. Duplicate, foreign or over-limit scope SHALL be refused before any target read or partial plan, and a retired lot in the scope SHALL block with `lot_retired`.

#### Scenario: Malformed scope

- **GIVEN** a batch with lots A and B
- **WHEN** a preparation names A twice, a lot from another batch, or more than ten lots
- **THEN** it is refused before any read, and no preparation is retained.

### Requirement: Preparation review binding

Marking lots reviewed SHALL record, for the whole named scope or none of it, one immutable review per subject that binds its exact effective facts: lot and shared Part values, inherited defaults, relevant human notes and selected media. A review SHALL be current only while those facts are byte-identical, so a shared Part edit stales every dependent lot while a lot edit stales only that lot.

#### Scenario: Lot-only edit

- **GIVEN** reviewed lots A and B sharing one Part
- **WHEN** only B's quantity changes
- **THEN** A's review and preparation stay current, and B needs review again.

#### Scenario: Shared Part edit

- **GIVEN** reviewed lots A and B sharing one Part
- **WHEN** the Part changes
- **THEN** both reviews are stale and A's existing preparation can no longer be approved.

### Requirement: Preparation warning and blocking-issue gate

Blocking issues SHALL prevent review, preparation and approval and SHALL NOT be dismissible. Warnings (`no_supporting_evidence`, `possible_duplicate_part`) SHALL also block until dismissed with a reason, and a dismissal SHALL apply only while the subject's fact digest is unchanged.

#### Scenario: Dismissal survives restart, not an edit

- **GIVEN** a lot with no supporting evidence
- **WHEN** the warning is dismissed with a reason, the server restarts, and the lot is then edited
- **THEN** the dismissal still applies after restart, and after the edit the warning blocks review again.

#### Scenario: Dismissal refusals

- **GIVEN** a lot with a `no_supporting_evidence` warning
- **WHEN** review is requested before dismissal, or a dismissal names an old fact digest or a blocking code such as `quantity_required`
- **THEN** they are refused with `warning_unresolved`, `stale_issue` and `issue_not_dismissible` respectively.

#### Scenario: Older preparation after the gate

- **GIVEN** an unapproved preparation made before the warning gate for a lot with no supporting evidence
- **WHEN** it is approved
- **THEN** approval is refused until the warning is resolved.

### Requirement: Preparation read-only target reads

Preparation SHALL make only bounded target reads, retaining a committed intent before and a result after each one, and MUST NOT send any inventory mutation. An unavailable, incomplete or invalid read SHALL block the preparation and SHALL never count as absence.

#### Scenario: Target unavailable

- **GIVEN** reviewed lot A and a target that fails reads
- **WHEN** A is prepared
- **THEN** the result is `blocked` with read-unavailable issues, the read intents and results are retained, and no executable plan exists.

#### Scenario: Read bounds

- **GIVEN** a preparation needing several Part and location reads
- **WHEN** it reads the target
- **THEN** at most three reads run at once, all within a 30-second overall budget, outside the dependency locks.

#### Scenario: Facts change during reads

- **GIVEN** a preparation whose target reads are in progress
- **WHEN** the lot's facts change before publication
- **THEN** the second locked dependency check blocks publication.

### Requirement: Preparation selected dependency closure

A preparation SHALL contain only the selected lots' effects and their prerequisites, with a shared Part prerequisite once, and MUST NOT pull in another lot's stock, attachments or records. Unselected lots SHALL be reported as remaining and SHALL be unaffected.

#### Scenario: Approve A only

- **GIVEN** lots A and B sharing a Part that must be created
- **WHEN** only A is prepared and approved
- **THEN** the plan holds one Part create and A's stock and attachment, B's stock and media are absent, and B is listed as remaining.

### Requirement: Preparation frozen plan

A successful preparation SHALL be immutable, holding server-encoded canonical plan bytes with their SHA-256 digest, the review fingerprint, target revision, capability and a sealed effects preview that includes labels and remaining lots. Every later read or approval SHALL verify that sealed outcome, and a missing or corrupt preview, index or read receipt SHALL refuse approval.

#### Scenario: Corrupt sealed outcome

- **GIVEN** a retained preparation whose preview labels or excluded scope were altered
- **WHEN** it is read or approved
- **THEN** the read or approval is refused before display or reservation.

### Requirement: Exact approval command

Approval SHALL accept only the preparation ID, expected plan SHA-256, review fingerprint, selected lot IDs and target revision, take the actor from the server, and refuse any mismatch with `approval_binding_mismatch`. After rechecking reviews, issues, source history and target, and requiring the re-derived plan to equal the retained bytes, it SHALL commit approval, run, operations, command, outbox and event together, meaning only that approval was accepted.

#### Scenario: Stale preparation

- **GIVEN** a preparation for lot A
- **WHEN** A's facts change and the old preparation is approved
- **THEN** approval is refused with `stale_preparation` and no approval or run exists.

#### Scenario: Replay after a later edit

- **GIVEN** an accepted approval
- **WHEN** the same approval request is replayed after the draft changed or fake stock was deleted
- **THEN** the original approval and run are returned, and no new run is allocated.

#### Scenario: Lost commit acknowledgement

- **GIVEN** an approval whose database COMMIT acknowledgement is lost
- **WHEN** the client repeats the request
- **THEN** the original approval and run are recalled, and no replacement authority is created.

#### Scenario: Body tries to widen authority

- **GIVEN** a preparation
- **WHEN** an approval body adds an effect list, actor, filename or target URL
- **THEN** the request is refused by schema validation.

### Requirement: Preparation cumulative contribution history

Review, preparation and approval SHALL be blocked with `source_history_unsettled` while an earlier run holds the source or is queued or recovery-required, and with `original_contribution_already_approved` for a lot whose original contribution already has an approval. Each accepted approval SHALL be a new numbered round, and earlier rounds SHALL remain unchanged.

#### Scenario: Later round

- **GIVEN** round 1 approved lot A and settled
- **WHEN** lot B is prepared and approved
- **THEN** round 2 contains only B, reuses A's confirmed Part output, and round 1 is unchanged.

#### Scenario: Deleted stock is not replenished

- **GIVEN** A's confirmed stock was later deleted from the target
- **WHEN** A is selected for a new preparation
- **THEN** it is blocked with `original_contribution_already_approved` and no stock create is planned.

#### Scenario: Unknown earlier result

- **GIVEN** round 1 left A's stock create unknown
- **WHEN** B is prepared
- **THEN** it is blocked by the unsettled earlier run, which is named.
