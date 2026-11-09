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

## Task 8: Records › Locations and Tree view

### Changes to the plan

- **2026-11-10T06:48+11:00, task 8 (PR-E):** Ready to add already kept "Lots to add" beside the Tree: both views render inside the same two-column grid. What changes is the canvas's layout: the lots column is a 320px column beside the Tree (the By type view keeps its wider split), it is renamed "Lots to include", and unticking a lot now updates the Tree at once rather than only after the new preparation is read.
- **2026-11-10T06:48+11:00, task 8 (PR-E):** Change log D3's "same heading row as By type, with the 3 record decisions in Review pill" needs no change: `ManualWorkspace` renders one "Ready to add" heading row above both views, and the app has no record-decisions pill in By type either.
- **2026-11-10T06:48+11:00, task 8 (PR-E):** Records already listed Locations as a type with the projection's location records (batch default, lot overrides and decisions). Task 8 adds the canvas's path, "why it's used" and stock count to the list, and a location detail. Change log D8's Use existing / Create new / Use another choices are not built: Records doesn't store a location mapping, so the detail keeps the existing "Locations are set on lots in Lots, or for the batch in Batch settings" line, as "Unsupported record changes are honest" requires.

### Decisions made during implementation

- **2026-11-10T06:48+11:00, task 8:** A location's path is InvenTree's `pathstring`, which only the existing-values read returns. So the read now also runs while Records › Locations lists a mapped location, not only while a mapped record is open; it is still one bounded read of the batch's mapped records. A new location drafted in Capture shows its parent's label and its own name. The In InvenTree table no longer has a Path row, because the detail shows the path once.
- **2026-11-10T06:48+11:00, task 8:** "Why it's used" compares the record with the batch default (its pk, or the default's new-location draft). Any other location reads "from N lot overrides", whether a lot, its shared Part or its evidence group set it, because each of those lots overrides the default. A location record that needs a decision reads "needs a decision".
- **2026-11-10T06:48+11:00, task 8:** The location type renders as a disabled "Location type" field, because the server doesn't read location types yet (design D7, BI-015). This also covers the location type description Task 6 left to this task.
- **2026-11-10T06:48+11:00, task 8:** The Ask Inventory box reuses `AskControl` and `RecordsStage`'s session lookup, so it appears only when an Inventory session still reading messages works on one of the location's lots, as per-field Ask does.
- **2026-11-10T06:48+11:00, task 8:** A lot row's location is omitted when the stock effect's location is the batch default: the same pk, or, for a default that is a new-location draft, a stock item placed by an operation key, since a plan creates a location only for that draft. With no batch default, every row names its location.
- **2026-11-10T06:48+11:00, task 8:** `PreparationTreeView` now renders `TreeView`, as Task 1 planned, and keeps its toolbar (counts, Expand all or Collapse all through `TreeView`'s controlled collapse, Only changes). The folded summary, a node's detail and change lines, and the Review link of a lot left out are the node's `detail`. `TreeView` has no selected state, so rows lose `aria-selected`; focus still marks the one tab stop. Rows of lots left out use `TreeView`'s `dimmed`.
- **2026-11-10T06:48+11:00, task 8:** Unticking a lot marks its stock item and its attachments Not ticked ("Left for later") through `withTicks` until the new preparation is read; a lot ticked again shows its preparation's own Not ticked row until then, because what it would create is not known yet.

### Open items

- Location types and their descriptions need a server read (BI-015).

## Task 9: Processing › Inventory step page

### Changes to the plan

- **2026-11-10T06:53+11:00, task 9 (PR-E):** The retained question carries only its kind (quantity or clarification), subject, prompt, reason and assumption. It names no existing stock item, holds none of its fields and offers no options. So:
  - **Comparison:** one "Compare before answering" card per open Inventory question about a lot. The "This batch" column shows the lot's Part, location and quantity from the records projection and the capture; the date code and the whole "In InvenTree" column read "Not known". The card isn't titled "Possible duplicate stock", because the app can't tell a duplicate-stock question from a Part or location question. Full data is BI-015.
  - **Drawer:** the open question is answered in the drawer through `QuestionAnswer`, a clarification text or a quantity with Counted or Estimated, rather than the canvas's option cards, which would need options the question doesn't carry.
- **2026-11-10T06:53+11:00, task 9 (PR-E):** The Inventory sub-tab already opened its step page (`#<batch>/processing/inventory`), so "link the sub-tab" needed no change; the sub-tab itself belongs to PR-B's batch header.
- **2026-11-10T06:53+11:00, task 9 (PR-E):** The Part, location and company matches come from Review's records projection, the same records Review › Records edits, rather than from Inventory's proposals, which hold no match fields. The page shows them only while the step has retained work, like the other step pages, and keeps the job cards below them.

### Decisions made during implementation

- **2026-11-10T06:53+11:00, task 9:** Only an Inventory session's drawer answers in place; other steps' drawers keep linking to the question on its step page, so their behaviour is unchanged. A question already pinned on the page keeps its link in the drawer, so one question never has two answer forms. Like the pinned answer, a drawer answer form appears only after this mount's fresh Processing read, so a warm cache never pins its question; until then the drawer shows the link.
- **2026-11-10T06:53+11:00, task 9:** Each drawer answer reports to its own navigation-guard source (`answer:<question>`). The workspace treats any answer source as an answer draft (`answerDirty`), so the batch instructions and Examine corrections still wait while one is unsaved, as they do for the pinned answer.

### Open items

- Closing the drawer discards an unsaved drawer answer, as leaving the pinned question's page does today; keeping it across the drawer closing would need the answer draft stored like unsent chat messages.
- The comparison's InvenTree column and date code need the question to carry the existing record (BI-015).
- The Processing fixture (`tests/fixtures/processing.html`) has no Inventory work, so the step page isn't in the screenshot set yet.
