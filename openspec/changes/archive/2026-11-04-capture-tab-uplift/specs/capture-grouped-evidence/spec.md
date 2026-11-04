# Capture grouped evidence

## Purpose

Give operators clear evidence entry actions and durable grouping context while preserving original evidence and physical-lot identity.

## ADDED Requirements

### Requirement: Three prominent evidence actions

The main evidence panel SHALL show Take photos, Add document and Write a note as three prominent actions at the top, before the evidence groups. Camera/library and document choices SHALL reuse retained upload limits and receipts; unsupported/unavailable media SHALL be explained without fabricated success. Write a note SHALL support typed or pasted text with human provenance.

#### Scenario: Add a supported original or note

- **GIVEN** an editable batch with media enabled
- **WHEN** a photo/document is chosen or a human note is written
- **THEN** the existing explicit retention/save flow is used and its receipt/state is shown before success is claimed; original bytes and note provenance remain intact.

#### Scenario: Media unavailable or retention uncertain

- **GIVEN** media is disabled, a file is unsupported or upload acknowledgement is lost
- **WHEN** the operator uses an evidence action
- **THEN** the limitation is visible, any selected file/request identity is preserved as appropriate, and other evidence or note actions do not pretend the file was retained.

### Requirement: Durable groups and contextual notes

Capture SHALL display named evidence groups and an ungrouped area, with group/evidence counts, create/rename, group notes, per-evidence notes and add-to-group controls. Notes SHALL retain human provenance/version history and be readable with their evidence in Review/viewer and in subsequent processing input. Group membership SHALL not replace evidence-to-subject links or merge physical lots; one evidence item may still support several subjects.

#### Scenario: Reopen a grouped packet

- **GIVEN** front/back evidence in one named group with group and individual notes
- **WHEN** the page reloads and the evidence opens in Review/viewer
- **THEN** the same evidence IDs, group membership and human notes appear, and each linked physical lot remains distinct.

#### Scenario: Edit group context after preparation

- **GIVEN** retained processing/review input using a group note or membership
- **WHEN** that context changes
- **THEN** subsequent inputs include the new context and affected older inputs/preparations are visibly stale until refreshed rather than silently relabelled current.

### Requirement: Equivalent, atomic evidence movement

Operators SHALL move selected evidence between groups or to ungrouped using explicit selection/move controls and drag interactions with keyboard/touch equivalents. One multi-selection move or ungroup action SHALL commit atomically under revision/idempotency checks. Ungroup SHALL retain every original and note; group history SHALL remain attributable. Invalid/foreign groups or conflicts MUST NOT cause partial movement, duplicate retention or cross-batch access.

#### Scenario: Move several related files

- **GIVEN** selected evidence belonging to the same batch
- **WHEN** it is moved to another valid group by either input method
- **THEN** one acknowledged command changes all requested memberships together and equivalent controls produce the same retained result.

#### Scenario: Revision conflict or foreign destination

- **GIVEN** a stale revision or destination group from another batch
- **WHEN** a multi-file move is submitted
- **THEN** the whole move is refused, originals/membership remain unchanged, and the local selection is preserved for reconciliation.

#### Scenario: Ungroup without deleting evidence

- **GIVEN** a group containing evidence and historical human instructions
- **WHEN** it is ungrouped
- **THEN** current membership moves to ungrouped while original bytes, per-evidence notes and attributable historical group instructions remain retained.

### Requirement: Preserve editing and approval boundaries

Grouped actions SHALL preserve existing archived/frozen restrictions, explicit save/discard and app dirty-navigation protections. Live refresh/reflow MUST NOT overwrite drafts. Grouping/uploading/note entry SHALL never approve or execute inventory effects.

#### Scenario: Dirty inputs during refresh or navigation

- **GIVEN** an unsaved group note, settings edit or pending upload
- **WHEN** polling refreshes data, the viewport reflows or navigation is attempted
- **THEN** the draft/request identity remains intact and existing save/discard protection applies without remounting away the edit.
