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

- Task 7 migrates the `SourceChip` call sites to pass field, value, reason and evidence; until then their popovers show only the certainty and Open evidence.
- Resolved: gallery screenshots of the components fixture in light and dark at 1440 and 390 px were captured for the PR-A description.
- Task 7 should check focus when a `SourceChip`'s Edit value opens an inline editor: `SourceChipPopover` closes the popover before running the action, and the popover's close returns focus to the chip, which may pull focus away from the editor.

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
