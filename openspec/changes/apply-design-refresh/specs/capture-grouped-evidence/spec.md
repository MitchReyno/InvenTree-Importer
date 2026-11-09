# Capability delta

## MODIFIED Requirements

### Requirement: Three prominent evidence actions

The main evidence panel SHALL show Take photos, Add document and Write a note as three prominent actions at the top, before the evidence groups. Camera/library and document choices SHALL reuse retained upload limits and receipts. Picking files SHALL start uploading them straight away, with no separate retain or discard step. A picker SHALL accept several files, uploaded one after another, each with its own request identity and the media revision current when it starts. Each file SHALL show its own state (uploading, preparing, not added with the reason, or unconfirmed with Retry). Unsupported/unavailable media SHALL be explained without fabricated success. Write a note SHALL support typed or pasted text with human provenance.

#### Scenario: Add a supported original or note

- **GIVEN** an editable batch with media enabled
- **WHEN** a photo/document is chosen or a human note is written
- **THEN** the upload or save starts at once and its receipt/state is shown before success is claimed; original bytes and note provenance remain intact.

#### Scenario: Several files at once

- **GIVEN** an editable batch with media enabled
- **WHEN** three photos are picked together into a group
- **THEN** they upload one after another, the group shows "Uploading 2 of 3" while they run, and each retained file joins the chosen group

#### Scenario: Media unavailable or retention uncertain

- **GIVEN** media is disabled, a file is unsupported or too large, the batch is at capacity, or an upload acknowledgement is lost
- **WHEN** the operator uses an evidence action
- **THEN** the affected file shows "Not added" with the reason and a Dismiss action, or "Upload not confirmed" with a Retry; other files continue, and nothing claims the file was retained.

#### Scenario: Retry an unconfirmed upload

- **GIVEN** an upload whose response was lost while later files kept uploading
- **WHEN** the operator chooses Retry
- **THEN** the identical request (same key, revision, label and bytes) is resent; a returned receipt is adopted, and a revision refusal, which proves the file was not kept, sends it once more as a new upload at the current revision

### Requirement: Preserve editing and approval boundaries

Grouped actions SHALL preserve existing archived/frozen restrictions and app dirty-navigation protections; notes and settings keep their explicit save/discard. Live refresh/reflow MUST NOT overwrite drafts. An upload in progress or awaiting retry SHALL count as unsaved work for navigation protection. Grouping, uploading, deleting and note entry SHALL never approve or execute inventory effects.

#### Scenario: Dirty inputs during refresh or navigation

- **GIVEN** an unsaved group note, settings edit, upload in progress or upload awaiting retry
- **WHEN** polling refreshes data, the viewport reflows or navigation is attempted
- **THEN** the draft/request identity remains intact and existing save/discard protection applies without remounting away the edit.

## ADDED Requirements

### Requirement: Delete evidence

Each photo or document SHALL offer Delete from its actions menu, and a multi-selection SHALL offer "Delete N files". Delete SHALL ask first, naming the lots that use the file, any lot left with no other evidence, and any attachment selection the delete will clear. A confirmed delete SHALL record an append-only removal under the media revision and an idempotency key, and the file and its notes SHALL leave Capture, Review and the viewer. The same command SHALL clear any attachment selection on the file. Original bytes and history SHALL be kept.

#### Scenario: Delete a photo used by three lots

- **GIVEN** a photo whose observations feed three lots, one of which has no other evidence
- **WHEN** the operator deletes it and confirms
- **THEN** the photo disappears from Capture, proposals citing it become stale, the Examine lead and the three lots' Research and Images sessions are told, and the lot without other evidence shows the existing "no supporting evidence" warning rather than being excluded

#### Scenario: Delete a selected attachment

- **GIVEN** a photo selected as a Part's attachment
- **WHEN** the operator deletes it and confirms
- **THEN** the confirmation named the selection, the selection is cleared in the same command, and the Part shows no attachment until another is chosen

#### Scenario: Stale or repeated delete

- **GIVEN** a delete request whose media revision is stale, or a replay of an acknowledged delete
- **WHEN** it reaches the server
- **THEN** the stale request is refused with nothing removed, and the replay returns the original result without a second removal

### Requirement: Restore deleted evidence

After a delete, a toast SHALL offer Undo, and Capture SHALL keep a "Deleted files" list from which any deleted file can be restored. Restoring SHALL record an append-only event and bring the file back with its notes and links, into its group if that group is still active and otherwise into "Not in a group". Restore SHALL be disabled with the reason and refused by the server when the batch is at its upload capacity or archived. A cleared attachment selection SHALL stay cleared. The Examine lead SHALL receive the restored file as new evidence. Proposals made stale by the delete SHALL stay stale until their sessions revise them.

#### Scenario: Restore from the list

- **GIVEN** a photo deleted yesterday, whose deletion made two proposals stale
- **WHEN** the operator opens "Deleted files" and chooses Restore
- **THEN** the photo returns to its group, the Examine lead receives it as new evidence, and the two proposals stay stale until revised

#### Scenario: Restore after the group was ungrouped

- **GIVEN** a deleted photo whose group has since been ungrouped
- **WHEN** the operator restores it
- **THEN** it returns to "Not in a group"

#### Scenario: Restore when the batch is full

- **GIVEN** a deleted photo and a batch that has since reached 200 present files
- **WHEN** the operator looks at "Deleted files"
- **THEN** Restore is disabled with "This batch is full", and a restore request sent anyway is refused with `media_capacity`

### Requirement: Delete refused where history must stay

Delete SHALL be refused when an approval used the file (as an attachment or supporting evidence), or the batch is archived. The menu item SHALL be disabled with the reason ("Used by the approval on 14 Oct. It stays as the record of what was added."). A refusal SHALL leave the evidence unchanged.

#### Scenario: Evidence used by an approval

- **GIVEN** a packet photo attached to a Part by an approval on 14 Oct
- **WHEN** the operator opens its actions menu
- **THEN** Delete is disabled with that reason, and a delete request sent anyway is refused by the server with the file unchanged

### Requirement: Written notes can't be deleted yet

Written batch notes SHALL show Delete disabled with an explanation that deleting notes comes later; an evidence note can still be cleared by saving it empty.

#### Scenario: Note delete is honest

- **GIVEN** a written batch note
- **WHEN** the operator opens its actions
- **THEN** Delete is disabled with the explanation and no request is sent
