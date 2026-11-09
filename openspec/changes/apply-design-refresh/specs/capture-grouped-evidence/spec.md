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
- **THEN** the affected file shows "Not added" with the reason, or "Upload not confirmed" with a Retry that resends the same request; other files continue, and nothing claims the file was retained.

### Requirement: Preserve editing and approval boundaries

Grouped actions SHALL preserve existing archived/frozen restrictions and app dirty-navigation protections; notes and settings keep their explicit save/discard. Live refresh/reflow MUST NOT overwrite drafts. An upload in progress or awaiting retry SHALL count as unsaved work for navigation protection. Grouping, uploading, deleting and note entry SHALL never approve or execute inventory effects.

#### Scenario: Dirty inputs during refresh or navigation

- **GIVEN** an unsaved group note, settings edit, upload in progress or upload awaiting retry
- **WHEN** polling refreshes data, the viewport reflows or navigation is attempted
- **THEN** the draft/request identity remains intact and existing save/discard protection applies without remounting away the edit.

## ADDED Requirements

### Requirement: Delete evidence with undo

Each evidence item (photo, document or written note) SHALL offer Delete from its actions menu, and a multi-selection SHALL offer "Delete N files". Delete SHALL ask first. The confirmation SHALL name the lots that use the item and any lot left without other evidence. A confirmed delete SHALL record an append-only removal under the media revision and an idempotency key. After it, the item and its notes SHALL leave Capture, Review, the viewer and every new processing input. Each affected lot SHALL be marked for re-examination, and a lot left without evidence SHALL show a blocking problem rather than being excluded. Original bytes and history SHALL be kept. Undo SHALL restore the item, also as an append-only event, while no approved import run uses it.

#### Scenario: Delete a photo used by three lots

- **GIVEN** a photo whose observations feed three lots, one of which has no other evidence
- **WHEN** the operator deletes it and confirms
- **THEN** the photo disappears from Capture, all three lots are queued for re-examination, the lot without other evidence shows "No evidence" as a blocking problem, and a toast offers Undo

#### Scenario: Undo a delete

- **GIVEN** a deleted photo that no approved run uses
- **WHEN** the operator chooses Undo
- **THEN** the photo returns with its group, notes and links, and the affected lots are re-examined again

#### Scenario: Stale or repeated delete

- **GIVEN** a delete request whose media revision is stale, or a replay of an acknowledged delete
- **WHEN** it reaches the server
- **THEN** the stale request is refused with nothing removed, and the replay returns the original result without a second removal

### Requirement: Delete refused where history must stay

Delete SHALL be refused when an approved import run pinned the item, or the batch is frozen or archived. The menu item SHALL be disabled with the reason ("Added to InvenTree in run 1. It stays as the record of what was added."). A refusal SHALL leave the evidence unchanged.

#### Scenario: Evidence used by an approved run

- **GIVEN** a packet photo attached to a Part in approved run 1
- **WHEN** the operator opens its actions menu
- **THEN** Delete is disabled with that reason, and a delete request sent anyway is refused by the server with the item unchanged
