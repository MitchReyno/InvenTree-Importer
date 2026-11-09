# Implementation notes

The design refresh is delivered in bundles PR-A to PR-G. This file records departures, decisions and open items as each task is implemented.

## Task 1: design-system foundation

### Changes to the plan

- **2026-11-10T00:53+11:00, task 1 (PR-A):** Task 1 named the icons `AiSparkle`, `Help`, `Info`, `Settings`, `Menu` and `Back`. They are exported as `AiSparkleIcon`, `HelpIcon`, `InfoIcon`, `SettingsIcon`, `MenuIcon` and `BackIcon`, so they don't collide with components such as the Settings page (Task 5) and read as icons at call sites.
- **2026-11-10T00:53+11:00, task 1 (PR-A):** `Pill` loses the `ai-proposed` status and its ✦ glyph, but screens that pass "AI-proposed" as text on a `tone="acc"` pill (`ProposedLotsGlance`, `LotObservations`, `ReviewQueue`) and `ExamineView`'s explicit `glyph="✦"` are untouched: they are screen changes for Task 7 (D22–D23), which places `AiMark` there instead.
- **2026-11-10T00:53+11:00, task 1 (PR-A):** D29 needs no `KeyValue` code of its own: its value chips follow from the short `SourceChip`, and an edited value's chip now reads "✎ You". For `Breadcrumb`, an item with an address is now always a link, so the batch screens' "Batches" alone (D14) links back. Choosing that trail is `AppMasthead`'s job in Task 2, and the masthead already hides the trail below `bp-compact`, so the component adds no phone rule.

### Unexpected challenges

- **2026-11-10T00:53+11:00, task 1:** The design system gives `ai` on `ai-weak` as 5.2:1 in light. The contrast script measures 4.8:1 (7.2:1 dark). Both pass; the app's `tokens.json` usage text states the measured ratios, and the design system's figure should be corrected there.
- **2026-11-10T01:03+11:00, task 1:** `pnpm screenshots:frontend` refuses to capture in this worktree because the web fonts don't load: `node_modules` is a symlink to the main checkout, outside the Vite root. Gallery screenshots for the PR need a run from a checkout with its own `node_modules`.

### Decisions made during implementation

- **2026-11-10T00:53+11:00, task 1:** `DisabledFeature` takes the control as a render prop (`{(disabled) => <input {...disabled} />}`) rather than cloning its child. The control often sits inside a `label`, and a stepper has two buttons, so the caller places `aria-disabled` and `aria-describedby` on the real controls. The wrapper stops clicks, presses, key presses, change, paste, cut and drop in the capture phase, and cancels every native `beforeinput` through its own capture listener, because React's `onBeforeInput` misses deletions and other editing commands, including chords the key filter lets through (macOS Ctrl+H, Ctrl+K) and the context menu's Delete, so the control's own handlers never run and nothing is sent. A press still focuses the control, so its explanation is announced. Cloning the child was rejected because it would put the attributes on the label. A wrapped text field or textarea must also be `readOnly`, because IME composition (`insertCompositionText`) and autofill can't be cancelled; `DescriptionField`'s disabled state already is.
- **2026-11-10T00:53+11:00, task 1:** `AiMark` with a label renders its own `inline-flex` wrapper centred on that label, as change log D25 suggests for the app. A global `:has(> .bi-ai)` rule like the design system's was rejected because `GlobalStyle` keeps only reset and root concerns.
- **2026-11-10T00:53+11:00, task 1:** `SourceChip` keeps its old props (`source`, `certainty`, `tone`, `onOpen`) and adds optional `field`, `value`, `why`, `evidence` and `onEdit` for its popover. It is now always a button, including the operator's own "You" chip, and `onOpen` moves from the chip to the popover's Open evidence action. The popover shows no `V` key hint: the shortcut belongs to Review and doesn't work from the popover. Task 7 fills in the details at each call site.
- **2026-11-10T00:53+11:00, task 1:** `DescriptionField` marks an over-limit count as "263 / 250 · over the limit" in `bad`, not the design system's "· shorten to approve". Design D7 says an existing over-limit description doesn't block approval and a proposed one is never written, so "shorten to approve" would be untrue. It counts characters by code point, as InvenTree does.
- **2026-11-10T00:53+11:00, task 1:** `CompareTable` also marks a differing field with "≠" and the hidden word "differs" in its field column, so the `warn-weak` tint isn't the only sign. `TreeView` follows `PreparationTreeView`'s keyboard model (one tab stop, arrows move and fold, Home and End jump) so Task 8 can move that view onto it.
- **2026-11-10T01:20+11:00, task 1 (review rounds 1–2):** Inside `DisabledFeature`, Tab, Escape, function keys and modifier keys always pass, except F4 on a select. Caret keys pass only in a text-like field (text, search, email, URL, phone, password or a textarea), because they change a select, number, date or range control. Ctrl and Cmd chords pass, so browser and app shortcuts still work, except Z and Y. A single printable key passes on a control that takes no typing, such as a button or checkbox, so Review's one-key shortcuts keep working. Space, Enter, Backspace and Delete are always refused.
- **2026-11-10T01:20+11:00, task 1 (review round 1):** `NumberStepper` marks a button at its limit with `aria-disabled` and ignores it, instead of `disabled`, so a keyboard user who reaches the limit keeps focus. `SettingRow`'s render prop receives `{ named, disabled }`: `named` lets the row's label name a control without its own, and a control with its own label, such as a `Switch`, leaves it out. `TreeView` takes optional `collapsed` and `onCollapsedChange` plus `parentIds()`, for Expand all and Collapse all in Task 8, and leaves keys and clicks on links or buttons inside a row to them. `SettingsNav`'s heading defaults to `h2` so the Settings page keeps one `h1`.

### Open items

- Resolved by Task 7: every `SourceChip` call site passes its field, value and reason, and evidence where the app has it.
- Resolved: gallery screenshots of the components fixture in light and dark at 1440 and 390 px were captured for the PR-A description.
- Resolved by Task 7: an action that moves focus keeps it (see Task 7's decisions).

## Task 10: direct upload

### Changes to the plan

- **2026-11-10T01:19+11:00, task 10 (PR-F):** D5 named four per-file states. Two more were needed, and the `capture-grouped-evidence` delta spec now lists them:
  - **"Added. The current evidence could not be read" with Read again.** The server kept the file but the follow-up read failed. Read again is queued in turn, so it never runs alongside an upload and never sends the file again.
  - **"Added to Ungrouped. Moving it into its group was not confirmed" with Dismiss.** The move into the chosen group was refused or left unconfirmed.
- **2026-11-10T01:19+11:00, task 10 (PR-F):** An earlier move left unconfirmed or refused still owns the media command and the selection. A later file in the queue then stays in Ungrouped, with the same notice, rather than replacing that selection or attempting a move the command would refuse.
- **2026-11-10T01:19+11:00, task 10 (PR-F):** The "Original retained · N bytes" status line went with the Retain step; the file now appears in its group.
- **2026-11-10T01:19+11:00, task 10 (PR-F):** The `@invimport/contracts` media module now exports `isMediaLabel` and `isMediaSourceSize`, used by the contracts upload client and the browser queue.
  - **Why the queue needs them:** the client throws a plain error for a bad name, which the queue would classify as uncertain, leaving the file "Upload not confirmed" for good. The queue now refuses the file locally as "Not added".
  - **Server unchanged:** the server keeps its own route check.

### Decisions made during implementation

- **2026-11-10T01:19+11:00, task 10:** The queue is a hook (`media/useUploadQueue.ts`) owned by `MediaWorkspace`, not by `MediaUpload`, so group panels read tiles and "Uploading N of M" from the same state without a child-to-parent Effect. `MediaUpload` keeps only the pickers.
- **2026-11-10T01:19+11:00, task 10:** Each queued file is a tile in its target group's evidence grid, as the canvas shows. The tile moves to the ungrouped grid if its group has gone. Focus handling:
  - Retry and Read again keep focus on the tile.
  - Dismiss moves focus to a neighbouring tile, else the group region.
  - Refusals are `role="alert"`; other states are `role="status"`.
- **2026-11-10T01:19+11:00, task 10:** Revision refusals and failed reads:
  - **First 412:** the queue re-reads the revision and sends once more with a new key. A second 412 means "Not added".
  - **Revision read fails before sending:** the file is "Not added", because nothing was sent.
  - **Retry after a lost response:** resends the identical request first.
- **2026-11-10T01:19+11:00, task 10 (coordinator):** "Upload not confirmed" offers Retry only, with no Discard. The upload may not be on the server, so navigation protection stays on until a Retry settles it.
- **2026-11-10T01:19+11:00, task 10 (coordinator):** The "Added to Ungrouped" tile stays in its target group, where the operator expected the file, while the file itself appears in Ungrouped.
- **2026-11-10T01:36+11:00, task 10:** That notice is dropped from the queue once a Refresh or a later file's read shows the file in any group, and hidden as soon as the latest read does. It is not kept for a later move, so it cannot reappear with a false claim.
- **2026-11-10T01:36+11:00, task 10:** Retry and Read again are gated on frozen media and drafts other than uploads and the selection, because they never touch the selection. Clearing or reloading a selection is allowed while uploads are unsaved. Without this, a selection held after a refused move and an unconfirmed later file disabled each other.
- **2026-11-10T01:36+11:00, task 10:** `isMediaLabel` also requires well-formed UTF-16. The upload header URI-encodes the label, and a lone surrogate would make that encoding throw, which the queue would read as an unconfirmed upload.
- **2026-11-10T01:44+11:00, task 10:** The queue's move into a group runs in the same handler as its fresh read. A poll that failed during the upload left that handler's render reporting media unavailable, so the move was skipped without being sent. `move` and `edit` now take a flag for a read just confirmed; a disabled batch still refuses before any selection is made.
- **2026-11-10T01:44+11:00, task 10:** A focused upload tile that leaves on its own, because its file was added or a read overtook its notice, hands focus to its group region. If the group region itself goes, focus is not recovered.
- **2026-11-10T01:49+11:00, task 10:** When the receipt's fresh read already shows the file in any group, the queue neither selects nor moves it. That group is either the target or one the operator chose, and a late Read again or Retry must not move the file back.

### Open items

None for task 10.

## Task 6: descriptions

### Changes to the plan

- **2026-11-10T02:55+11:00, task 6 (PR-D):** Task 6 named `CompanyEditor`, `ProposedCompanyEditor`, `SourcingEditor` and `TemplateEditor` as the places for `DescriptionField`. Each record's description renders once instead, through `RecordDescription` in `RecordDetail`, after the In InvenTree table. Those editors render only for some records (a company with no edit target has no `CompanyEditor`), they would each need the existing-values query passed down, and the description belongs to the record rather than to the edit each editor makes. A new Part's description stays in `PartEditor`, because it is editable there.
- **2026-11-10T02:39+11:00, task 6 (PR-D):** `ParameterMatrix` gets no `DescriptionField`. The app's matrix shows only existing templates, which open their own record, where the description shows; it has no "Create template" decision for a proposed description to sit under.
- **2026-11-10T02:39+11:00, task 6 (PR-D):** A Part's category description isn't shown under its category picker (change log D1). The existing-values read runs only while a mapped record is open, and a new Part isn't mapped, so showing it there would add a target read on every Part. The category's own record shows it.
- **2026-11-10T02:39+11:00, task 6 (PR-D):** New suppliers created in Capture have no record in Records: the projection lists only companies a Part spec uses. Only a new location's description shows, on its `location:draft:` record.
- **2026-11-10T02:39+11:00, task 6 (PR-D):** The location type description is left to Task 8, which adds location types to the Locations view; Records shows no location type today.

### Decisions made during implementation

- **2026-11-10T02:39+11:00, task 6:** The In InvenTree table no longer has a Description row. The description shows once, as its own read-only field with the InvenTree chip and its count.
- **2026-11-10T02:55+11:00, task 6 (review round 1):** Once the existing-values read settles without the record's description (the read failed, InvenTree has no such record, the read was truncated, or no read is configured), a disabled description field says which, as `review-records` › Descriptions on records requires. While the read is in flight, no field shows. An InvenTree record whose description is empty shows "No description".
- **2026-11-10T02:39+11:00, task 6:** A proposed description that doesn't fit moves from the Description row's source column to "Not supported yet", as a read-only "Proposed description" field. The projection clips the value to 256 characters, so a longer proposal counts as "256 / 250"; the count is a floor.
- **2026-11-10T02:39+11:00, task 6:** A new Part's description Save waits while the text is over 250 characters, because the contract refuses it. The field no longer stops typing at 250, so the count can show the over-limit state. The count and the Save check both measure the text as it will be saved (one line, trimmed), so a trailing space doesn't hold a 250-character description.

## Task 7: screen clean-up and agent marks

### Changes to the plan

- **2026-11-10T02:39+11:00, task 7 (PR-D):** Several change-log removals have nothing to remove in the app, so they need no change: the Review "ready to add" banner, the Tree footnote, "Your edits are kept when the agent rechecks", the Batches footer note, and "· Test InvenTree" on the Added run line (the app has only the chip).
- **2026-11-10T02:39+11:00, task 7 (PR-D):** D22's Ask boxes for a lot, a Part, a company match, a location and Tell Research don't exist in the app. The mark goes on the instruction boxes that do: the batch instructions, each group's instructions and Tell Examine. Per-field `AskControl` stays unmarked, as the spec says.
- **2026-11-10T02:39+11:00, task 7 (PR-D):** The masthead activity chip, the Settings › Agents heading and its nav item belong to Tasks 2 and 5, so this bundle doesn't mark them.
- **2026-11-10T02:39+11:00, task 7 (PR-D):** Task 1's notes asked for `AiMark` in place of the "AI-proposed" pills. The spec forbids the mark on pills, so agent lots now carry `＋ New` (Proposed lots, Review queue, Observations, Examine's Lots formed), and Edited stays.

### Decisions made during implementation

- **2026-11-10T02:39+11:00, task 7:** Review's shortcuts use a new `ShortcutsButton` in `components/ui`: a ghost "Shortcuts" button with the 20px help disc, the one-line list as its tooltip and the keys in its popover, as the design system's HelpButton guide describes.
- **2026-11-10T02:39+11:00, task 7:** `operator/ProvenancePill.tsx` becomes `ProvenanceChip.tsx`. Each provenance has a short source ("Batch default", "Not set", "Evidence groups"), its existing label as the certainty, and one sentence on why. Human and override values keep "You · Your edit"; unknown and unset read "Not known" and "Needs a value", so the chip doesn't repeat its source.
- **2026-11-10T02:39+11:00, task 7:** `Dialog` takes a node title so the session drawer can carry the mark; the accessible name is unchanged.
- **2026-11-10T02:39+11:00, task 7:** Task 1's focus question checked: Radix's non-modal popover returns focus to its trigger only when nothing outside it took focus. Open evidence focuses the evidence panel before the popover unmounts, so focus stays there; an action that moves no focus returns it to the chip. `SourceChip.test.tsx` covers both.

### Open items

- No call site passes `onEdit` yet, so no chip offers Edit value on a screen.

## Task 11: evidence removal backend

### Changes to the plan

- **2026-11-10T03:00+11:00, task 11 (PR-G):** The 11.6 claim that an app build without the change still runs with the table unused was false: `operations/compatibility.ts` requires the applied migrations to match the build's set exactly, and startup quarantines on a mismatch, so an older build refuses a database with `0031`. Rollback means keeping this build; there is no down-migration (coordinator decision). Task 11.6 and design "Migration, rollout and recovery" now say so. `tests/pg/media-removal-upgrade.test.ts` proves the rest: `0031` applies over a database migrated to 0030 with existing evidence, which stays present with no removal rows.
- **2026-11-10T03:00+11:00, task 11 (PR-G):** The tests were written after the implementation, not before (11.2). To show they discriminate, three behaviours were disabled together (the snapshot filter, the stale marking, the publication refusal): four of the six Postgres tests then present failed, and all passed once restored. The append-only and Examine-trigger tests don't depend on those behaviours; the upgrade and process tests were written afterwards.
- **2026-11-10T03:00+11:00, task 11 (PR-G), approval deviation:** `pinned_by`, `lot_ids`, `sole_evidence_lot_ids` and `selected_attachment_of` appear only on the operator's snapshot (`operatorMediaSnapshot`, used by GET `/media` and edit responses), not on every media snapshot. `mediaSnapshot` is also read by Processing, preparation and records under roles that can't read `executor_run`, so it keeps its shape apart from leaving removed items out. The new fields and the `removed` list are optional and omitted when empty, so existing snapshots keep their bytes.
- **2026-11-10T03:00+11:00, task 11 (PR-G), approval deviation:** Review's existing `no_supporting_evidence` rule counts any lot-attachment selection row as support, `unset` included. A lot whose only evidence was its selected lot attachment therefore keeps counting as supported after the delete clears the selection to `unset`, and doesn't raise the warning the spec describes. `sole_evidence_lot_ids` mirrors the gate rather than contradicting it. The quirk predates this change.
- **2026-11-10T03:00+11:00, task 11 (PR-G):** No lot-session tool lists observations; only the Examine lead's `read_batch` does. Removal is enforced for lot sessions through the proposal publication check and their media inputs.

- **2026-11-10T07:40+11:00, task 11 (PR-G, review round 1):** Added `GET /api/v1/batches/{batchId}/media/removal-impact?evidence_ids=…` (`MediaRemovalImpact`), which the plan didn't list. A bulk "Delete N files" must name a lot left with no other evidence, and that can depend on the whole set: two photos that each leave the other supporting a lot leave it bare together. The read returns `lot_ids`, `sole_evidence_lot_ids` and `selected_attachment_of` for the set removed together; per-item fields use the same computation.
- **2026-11-10T07:40+11:00, task 11 (PR-G, review round 1):** Native (non-session) prompts staged from an input sealed before a removal now leave out the removed item's versions, evidence notes and media context. Native proposals carry no `relies_on`, so they aren't marked stale individually. Instead, a native proposal citing a removed source fails the inspected-source check, and the attempt reads as superseded because its input no longer matches the batch.

### Unexpected challenges

- **2026-11-10T03:00+11:00, task 11:** Almost every evidence consumer reads through `mediaSnapshot`: Processing inputs and their evidence notes, the lead's manifest, preparation and its supporting-evidence gate, records and operator review. Leaving removed items and their derivations out of its `evidence` covers them at once. Code that reads media rows directly checks removal itself with `versionRemovedSql`: `media/content.ts` (which also serves native prompts, the research broker and session fetches), the session tools, the Examine trigger, `requireEvidenceRegion`, `leadBatchView`, the capture snapshot's observations, `lockApprovedMedia` and the batch list's counts and thumbnail.
- **2026-11-10T03:00+11:00, task 11:** Evidence notes reach sessions as manifest notes whose `note_id` is a `media_evidence_note` id, so the third stale join goes through `media_evidence_note.evidence_id`. Session proposals cite in their value and rely through `relies_on`; both are checked.
- **2026-11-10T03:00+11:00, task 11:** Hiding observations on removed evidence from the capture snapshot reads `media_version` and the new table, so `grantCaptureRead` now grants `SELECT` on `media_evidence_removal` and on `media_version(id,batch_id,evidence_id)`. Existing namespaces need their grants reapplied after migrating, as for any new table.

- **2026-11-10T07:40+11:00, task 11 (review round 1):** The first stale query read only a proposal's top-level `sources` and `relies_on`, while publication also checked catalogue values' sources. A proposal citing a removed photo only for one parameter value stayed current. The query now walks every nested `sources` array (`lax $.**.sources[*]`).
- **2026-11-10T07:40+11:00, task 11 (review round 1):** The batch-list counts and thumbnail, and a removal queued behind an approval, already behaved as intended, so their new tests passed on first run. To show they discriminate, the batch-list filter and the pin refusal were disabled from backups; both tests then failed, and passed again once restored.

### Decisions made during implementation

- **2026-11-10T03:00+11:00, task 11:** Restoring an item that isn't removed is refused with `media_evidence_not_removed` (409), and removing one already removed with `media_evidence_removed`.
- **2026-11-10T03:00+11:00, task 11:** Each `removed` entry carries `id`, `label`, `preview_id` (the original's first page, null before decoding), `removed_revision` and `removed_at`. Restore decides the group, so the entry doesn't list one.
- **2026-11-10T03:00+11:00, task 11:** `pinned_by` names the earliest pinning approval, timed by its run's command.
- **2026-11-10T03:00+11:00, task 11:** The lead's batch notice and the lots' notices are `revision` items with fields `["identity"]`, keyed `evidence_removed:<revision>:<session>`, one per session per removal. Owners of directly stale proposals are told the same way, and the cascade sends its existing `cascade:<proposal>` notices. Affected lots are the active lots the removed items feed through links or active observations.
- **2026-11-10T03:00+11:00, task 11:** `media/removal-impact.ts` reimplements Review's supporting-evidence rule rather than importing `review/model.ts` into media. It counts retired ancestors' attachment selections, which the gate may not.
- **2026-11-10T03:00+11:00, task 11:** Native prompts list a removed version sealed in an older input as unavailable instead of failing the attempt.
- **2026-11-10T03:00+11:00, task 11:** The batch list's evidence counts and thumbnail skip removed items, so a deleted file leaves Batches too.
- **2026-11-10T03:00+11:00, task 11:** Company logo drafts (`retainedImageVersion`) still accept a removed version; refusing it would block complete-state settings saves. Preparation already reports such a logo as unavailable, because the snapshot leaves it out.
- **2026-11-10T03:00+11:00, task 11:** `requireEvidenceRegion` takes the media revision lock after the capture lock it already holds, matching `lockMediaBatch`'s order.

- **2026-11-10T07:40+11:00, task 11 (review round 1):** The combined impact is a `GET` with a comma-separated `evidence_ids` query, like the other media reads. It refuses an empty, duplicated or over-200 list (400), an unknown item (404) and a removed one (`media_evidence_removed`, 409).
- **2026-11-10T07:40+11:00, task 11 (review round 1):** `pinned_by` assumes every approval pin has its run, which the approval writes in the same transaction. A pin without one is now an error rather than being skipped.

### Open items

- Review's supporting-evidence rule should stop counting an `unset` lot-attachment selection as evidence (see Changes to the plan).
- 11.5 stays open: no full PostgreSQL tier run has been green. Each run had one or two child-process startup or decoder deadline failures, and every new removal test passed in every run. On a serial rerun, only `media-startup-authority.test.ts` › "actual main reopens its bound store…" failed (`manual_checkpoint_timeout`: its 5-second wait for the web process to report healthy). Run alone, it failed twice and passed once. It needs a run on a quiet machine, or a look at whether that startup is now slower.
