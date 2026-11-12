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

## Task 2: desktop masthead and server menu

### Changes to the plan

- **2026-11-10T02:32+11:00, task 2 (PR-B):** `AppMasthead` no longer reads the open batch at all. With "Batches" alone inside a batch (D14) it has no title to show, so the `readBatch` prop and its capture query are gone rather than narrowed to a `settings` prefix. The prefix now lives in `navigation/app-route.ts` (`appPage`, `routeBatchId`), used by `App.tsx` for its route match and `currentBatch` and by `AppMasthead` for the page name. The planned "spy on `readBatch`" case is an `App` test that opens `#settings/inventree` and checks that no `/batches/settings` request is sent.
- **2026-11-10T02:32+11:00, task 2 (PR-B):** The server menu stays the connection pill's labelled dialog ("Connection details"), with its actions in a `nav` named "Server", rather than an ARIA `menu` as drawn on the canvas. A `menu` role would need arrow-key menu semantics for three items, while the dialog keeps the tested Escape, focus-return and viewport rules.

### Decisions made during implementation

- **2026-11-10T02:32+11:00, task 2:** The server menu shows the Dev mode badge whenever the masthead does. The app has no production build flag; the masthead's badge is always shown in this development-only app.
- **2026-11-10T03:26+11:00, task 2 (review round 1):** The server menu says where approvals write for a configured target too ("Approvals write to this InvenTree, your live inventory."), as `header-connection-status` › Safe target details asks, not only for the test target.
- **2026-11-10T02:32+11:00, task 2:** Check connection now is a `DisabledFeature` button, so it shows the same dashed "Coming later" frame and explanation as other deferred controls.
- **2026-11-10T02:32+11:00, task 2:** The activity pill's `AiMark` appears only on fresh Processing work, so it is absent from the idle pill, an unavailable or stale read and an import run, which is not agent work.
- **2026-11-10T02:32+11:00, task 2:** Outside a batch the pill names the batch it shows from that batch's cached capture read, falling back to "Application-wide" when the batch has not been opened in this session. It still never fetches.
- **2026-11-10T02:32+11:00, task 2:** The theme choice moved from the retired "⋯" menu into the server menu as `masthead/ThemeChoice.tsx`, below the server actions, for Task 5 to move to Settings › Appearance. The Dev badge moved into `masthead/DevBadge.tsx` so the bar and the menu share it.

## Task 3: batch header layout and counts

### Changes to the plan

- **2026-11-10T02:41+11:00, task 3 (PR-B):** Processing and its steps now count questions only, as the design D3 table says. Failed attempts no longer raise a tab badge; they stay in the need-you list and on the step pages.
- **2026-11-10T02:41+11:00, task 3 (PR-B):** A finished step shows ✓ with no "12/12", as on the phone canvas, unless it has questions ("✓ Examine 1").
- **2026-11-10T02:41+11:00, task 3 (PR-B):** The short summary drops "(N retired)": the count stays active lots only. `BatchHeader` loses `retiredLotCount` and the Capture file count, so it now takes only `unusedFiles` from the media read.
- **2026-11-10T02:41+11:00, task 3 (PR-B):** Removing the "Elsewhere in this batch" card left `ProcessingOverview` without a use for `attention` and `unusedFiles`, so those props are gone from `ProcessingStage`, `ProcessingWorkspace` and the Overview. With no sessions the Overview no longer draws an empty aside.

### Decisions made during implementation

- **2026-11-10T02:41+11:00, task 3:** `TabItem` now takes one `count` (`value`, `label`, `tone`) and a `status` (`running` or `done`) in place of `count`, `countLabel`, `countTone`, `badge` and `progress`, so a tab cannot show two badges or a phrase. The words go only into the accessible name ("Review, 8 to check"); the tab shows "8". Each count carries `data-tone` for tests and inspection.
- **2026-11-10T03:26+11:00, task 3 (review round 1):** The attention projection gains `review.needs_answer`: lots that are not excluded and have an open Processing question on the lot or on its Part, the definition Review's Needs answer filter (`openQuestionsByLot`) uses. Review › Lots shows it in the warning tone, else all lots. It counts an approved lot with an open question, as the filter shows one. The contract, generated API and the projection's tests carry it.
- **2026-11-10T03:43+11:00, task 3 (review round 2):** `processing/steps.ts` `countSteps` counts an active subject's job whatever its state. Each job is one subject's step and carries its current attempt, so an active lot's failed, superseded or cancelled job is a step not done; leaving them out (tried in round 1) ticked a step ✓ over a failed or stale lot. Instead `stepStatus` marks a step with any failed attempt "failed" (× in `bad`, as the step page's disc), and ✓ only when every job is ready with none failed.
- **2026-11-10T06:41+11:00, task 3 (review round 3):** Retired subjects are left out of step counts: a retired lot's job is always superseded and can never run again, so `activeSubjectJobs` keeps only the Examine lead job and active lots' and Parts' jobs before counting. The attention projection (by the operator review's retired lots), the header's `batch_steps` and the inbox (by the capture snapshot) share it, and the Processing source leaves retired lots' jobs out of its step counts while still listing them.
- **2026-11-10T02:41+11:00, task 3:** Each tab row shifts left by its own tab padding (`TAB_INSET`), so the first label lines up with the title, as change log D2 asks. The phone rule that runs the rows into the band's padding is unchanged.

## Task 4: phone header

### Changes to the plan

- **2026-11-10T03:26+11:00, task 4 (PR-B, review round 1):** The condensed row's status button and menu need the masthead's observations, which `BatchHeader` does not hold. App wraps the page in `HeaderObservationsProvider` (`masthead/HeaderObservations.tsx`), which calls `useHeaderObservations` once, and provides the condensed copy through `masthead/CompactStatus.ts` as a second `HeaderStatus` with `variant="condensed"`. Both copies show the provider's reads, so mounting the row sends no reads and it shows the current state at once; there is one clock and one foreground listener. The copy keeps its own open panel and renders no live region, so state changes are not announced twice.
- **2026-11-10T02:51+11:00, task 4 (PR-B):** The condensed row is `position: fixed` rather than sticky, and appears once the whole batch header band has left the viewport. A sticky row that replaced the full header would shrink the band and could flip the observer back and forth; the fixed row never shifts the page. Its sub-tabs are a second copy of the row's links while it shows.
- **2026-11-10T02:51+11:00, task 4 (PR-B):** The phone menu is a `Popover` named "Menu", like the server menu, rather than the canvas's side sheet over an overlay. It keeps the tested Escape, focus-return and viewport bounds; it holds Agents, Settings, the server details (status line, connection details with Open InvenTree) and the theme. It has no Batches link: the brand already links there.

### Unexpected challenges

- **2026-11-10T02:51+11:00, task 4:** Removing the "⋯" menu (Task 2) stopped the header fixtures from applying the stored theme: the menu's `useThemeChoice` was what created the theme controller there. `header-status.html` and `header-disclosure.html` now call `themeController()` as the other fixtures do; the app already does so in `main.tsx`.

### Decisions made during implementation

- **2026-11-10T02:51+11:00, task 4:** `HeaderStatus` picks the phone layout with `useMediaQuery(media.compact)`, so phone and desktop render different controls instead of hiding duplicates with CSS. jsdom has no `matchMedia`, so tests stub it through `test/viewport.ts`, which also drives a fake `IntersectionObserver`.
- **2026-11-10T02:51+11:00, task 4:** The `AiMark` now leads the activity pill at every width, before the spinner, so it stays visible at phone width where the labels are hidden. On phones it is always shown, since that button is the agents status button; on a desktop it marks fresh Processing work.
- **2026-11-10T03:26+11:00, task 4 (review round 1):** At phone width the agents status button keeps its content's width (`min-width: max-content`), its segments narrow to 8px, the bar's lead gap tightens and the brand drops to the canvas's 19px, ellipsising only below 360px, so the button never clips its mark or segments. A visually hidden status beside the bar's menu button announces connection changes; the condensed copy has none.
- **2026-11-10T03:26+11:00, task 4 (review round 1):** While the condensed row shows, the document's `scroll-padding-top` is its height, so focused content is not hidden under it. Its sub-tabs are named "…, condensed" and mark the current one with `data-current` rather than a second `aria-current`. When the full header returns, a control focused in the row hands focus to the same control (by `data-focus-key`, else by address), the full header first, then the masthead.
- **2026-11-10T03:26+11:00, task 4:** The header-status fixture now draws its masthead full width above the page, as the app does, so phone widths measure the real bar.
- **2026-11-10T02:51+11:00, task 4:** At phone width the step segments show beside the spinner, and the pill's description adds the step states ("Examine: done, Research: running, …"). The one-word state (Offline, Stale, Failed, Slot held, Idle) still shows when there is no spinner.

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

- **2026-11-10T07:40+11:00, task 11 (review round 1):** Earlier full PostgreSQL tier runs each had one or two child-process startup or decoder deadline failures, and the failing test changed between runs. The last of them was `media-startup-authority.test.ts` › "actual main reopens its bound store…" (`manual_checkpoint_timeout`), which failed twice and passed once when rerun alone. Review found the change adds no startup work and timed that test at 8.3 s under load, so these were load timeouts. After review round 1, a serial run of the full tier on `786bde3c` passed 316 of 316, so 11.5 is ticked.
- **2026-11-12T20:02+11:00, task 11 (review round 2):** 11.5 rests on runs at `4b3310e1`, the merge of `interactive-app` at `a95b2818`; later commits touch only these notes. The full gate passed. The full PostgreSQL tier passed 316 of 316, run serially. `test:intake:process` passed with 0 failures: 85 of 96 tests ran, and 11 were skipped by environment. The 7 paired-VM tests need a VM pairing, and the 4 sandbox probe tests need `INTAKE_MEDIA_PROBE_IMAGE`.
- **2026-11-12T20:02+11:00, task 11 (review round 2):** Two earlier full runs at `ffecd767` failed:
  - **`capture-process.test.ts` › "actual capture web process restart…":** failed once each, with `capture_child_start_timeout`. Its readiness poll waits about 5 seconds for the restarted web process. The test passes alone in 6.4–6.7 s, and passed within the full tier at `4b3310e1`.
  - **Backend demo test `test_timeout_after_applied_stock_recovers_original_locator_without_replay`:** failed once, while the backend suite took 11 minutes instead of the usual 4–5 under load. It passed in the next run.

  This branch changes neither the capture start-up path nor the backend.

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

## Task 12: evidence removal UI

### Changes to the plan

- **2026-11-12T20:20+11:00, task 12 (PR-G):** The tile menu has Open and Delete…, not "Move to group…" (design D6). Moving stays with dragging and the selection's Move control; a menu item that only selected the file and sent focus to that control added little.
- **2026-11-12T20:20+11:00, task 12 (PR-G):** The design canvas working copy named in the brief wasn't on disk, so the UI follows the change log's D31 entry, design D6 and the delta specs. It needs a check against the canvas's "Capture › delete evidence" artboard before the PR merges.
- **2026-11-12T20:20+11:00, task 12 (PR-G):** The confirmation doesn't show the file's image; it names the file in its title. D31's dialog "shows the file".

### Decisions made during implementation

- **2026-11-12T20:20+11:00, task 12:** `ActionsMenu` (`components/ui`) is a "⋯" `IconButton` opening the existing Radix `Popover` with `role="menu"`; no menu package was added. A disabled item keeps `aria-disabled` and stays focusable, with its reason as its description.
- **2026-11-12T20:20+11:00, task 12:** One file's dialog uses that file's own `lot_ids`, `sole_evidence_lot_ids` and `selected_attachment_of`. Several files use `mediaClient.removalImpact`, a TanStack Query keyed by revision and ids; Delete stays disabled until that read succeeds, and a failed read offers "Check again". The command carries the revision the dialog opened on.
- **2026-11-12T20:20+11:00, task 12:** Delete and Restore don't wait for a held selection, since they don't touch it; a confirmed delete drops the deleted files from it. Restore is disabled with "Resume the batch to restore files." in an archived batch.
- **2026-11-12T20:20+11:00, task 12:** Focus: Cancel or a refused delete returns focus to the opener (the tile's menu button or "Delete N files…"). After a confirmed delete it goes to the group the first file was in, because the opener leaves in the same commit as the dialog, so the workspace takes focus off the opener when the dialog opens and `returnFocus` decides. Undo and Restore focus the restored file's menu button as it mounts; a refused Undo focuses the Deleted files summary.
- **2026-11-12T20:20+11:00, task 12:** A written batch note's menu shows Delete disabled: "Deleting written notes comes later. A file’s note can be cleared by saving it empty."

## Task 5: Settings page

### Changes to the plan

- **2026-11-10T08:00+11:00, task 5 (PR-C):** The three exact `settings` matches design D4 names were already prefix matches through `navigation/app-route.ts` (Task 2): `App.tsx`'s route match and `currentBatch` use `appPage` and `routeBatchId`, and `AppMasthead` no longer reads the batch at all. Task 5 only renames the breadcrumb page to "Settings" and adds `settingsSection` for the section.
- **2026-11-10T08:00+11:00, task 5 (PR-C):** Model stays a text field with the presets as suggestions (`datalist`), not the canvas's select. The contract takes any exact model ID, and a select would drop custom IDs that work today.
- **2026-11-10T08:00+11:00, task 5 (PR-C):** The design's "✓ Saved" autosave is not built (proposal exclusion); the form keeps Save and Discard and reload. A `revision_conflict` now says the settings changed in another tab, keeps the edit and offers Reload, as `app-settings` › Stale settings revision asks; other failures keep the existing "not confirmed" message.
- **2026-11-10T08:00+11:00, task 5 (PR-C):** The import reference prefix shows an empty read-only field, not the canvas's "BI-". The app has no stored prefix, so showing one would be invented.
- **2026-11-10T08:00+11:00, task 5 (PR-C):** The theme leaves the desktop server menu but stays in the phone menu, which `batch-navigation` › Phone header still lists. `ThemeChoice` moved to `components/settings/` and both use it.
- **2026-11-10T08:00+11:00, task 5 (PR-C):** "Pause all agents" moved from `AgentSessions.tsx` into `agents/PauseAllAgents.tsx`, and slot use into `agents/slot-use.ts`, so the Agents page and Settings › Agents share them. `AgentSettings.tsx` is gone; `components/settings/AgentsSection.tsx` replaces it.

### Decisions made during implementation

- **2026-11-10T08:00+11:00, task 5:** The back link's return route is followed by `useNavigationGuard` (`settingsReturn`), which accepts every route change: entering Settings remembers the previous route, moving between sections keeps it, and it is stored in the history entry's state, so reload and Back restore it. A batch route is named "<batch> › <tab>" from the batch's cached capture read ("the batch" if it was evicted); the link returns to the exact route, query included.
- **2026-11-10T08:00+11:00, task 5:** Only the open section is mounted, so the credential hooks and the Codex poll unmount when another section opens, and coming back starts with a closed panel and "Not checked".
- **2026-11-10T08:00+11:00, task 5:** The sessions stepper is labelled by its row and by itself ("Sessions at once"), so the row and the stepper are two groups with the same name. `NumberStepper` takes only a label; a labelled-by option would be a ui change for one caller.
- **2026-11-10T08:00+11:00, task 5:** The slot meter compares slots in use with the saved limit, not an unsaved stepper value, because the server applies only the saved one.
- **2026-11-10T08:00+11:00, task 5:** `tests/fixtures/settings.html` (`SettingsProof`) renders Settings, opened from a batch's Processing, from in-memory clients for screenshots and the film; the hash picks the section.

- **2026-11-10T08:40+11:00, task 5 (review round 1):** A confirmed save writes the saved settings into the `agent-settings` query, so the slot meter's limit follows it. The form keeps its own state from its first `initial`, so the write doesn't reset a draft.
- **2026-11-10T08:40+11:00, task 5 (review round 1):** While Save or Discard and reload is pending, the sign-in method and the sessions stepper show `aria-disabled`. `SegmentedControl` gained a `disabled` option that marks every segment and ignores choices while focus can still reach them.
- **2026-11-10T08:40+11:00, task 5 (review round 1):** The model field is described by its presets help and, when invalid, its error. Each provider card's status is its radio's description rather than part of its name.
- **2026-11-10T08:40+11:00, task 5 (review round 1):** A refused navigation re-pushes the protected page with its own Settings return route (`withSettingsReturn`), since `history.state` at that point belongs to the destination. Other keys of that state are kept as before.
- **2026-11-10T08:40+11:00, task 5 (review round 1):** The Codex runner's serial queue is now module-scoped (one queue, since `/personal-runner/codex` is one same-origin endpoint; round 2 dropped the server-scope key), so a panel remounted after a section switch waits for a call the earlier mount left running. The Claude credential panel needs no queue: it sends one request at a time behind `busy`, its save and remove carry the last acknowledged revision, which a remounted panel only gets from a fresh status check, and a stale revision is refused by the guest.
- **2026-11-10T08:40+11:00, task 5 (review round 1):** After a reload the batch read is no longer cached, so the back link names the tab only ("Back to the batch › Review"); it still returns to the exact route.

- **2026-11-10T09:10+11:00, task 5 (review round 2):** A confirmed reload (Discard and reload, or the conflict's Reload) also reports the settings it read (`onLoaded`, formerly `onSaved`), so the slot meter follows it.
- **2026-11-10T09:10+11:00, task 5 (review round 2):** Each Codex runner call fails after 90 seconds (round 3: the guest's 20-second limit for each of up to four RPCs in a disconnect, plus a margin), reading the answer included, with the panel's usual failure message, so a hung call can't hold the shared queue. It uses an `AbortController` and `setTimeout` rather than `AbortSignal.timeout`, because the latter doesn't follow Vitest's fake clock and the test couldn't drive it. Tests reset the queue after each test (`resetRunnerQueue`).

- **2026-11-10T09:45+11:00, task 5 (review round 3):** Before writing confirmed settings into the `agent-settings` query, the section cancels any read of it still running, so an older answer can't replace them.

- **2026-11-12T13:50+11:00, task 5 (merge of `interactive-app` 608251fd):** `usePersonalClaudeCredential` now uses the shared `useAsyncAction` (#198) for its busy flag and failure text, as the trunk's panel did; the card still reads "Check failed" from that text. `useChatGPTSignIn` keeps its own busy flag and message, as the trunk left `ChatGPTSignIn`: its guard also waits for a poll still running, and it keeps the last message shown until a call settles. Likewise, `AgentSettingsForm` keeps its own, since it tells a revision conflict apart. Settings imports its contexts from `#/context` (#196). The hooks lint (#197) found nothing in this branch's code.

- **2026-11-12T19:44+11:00, task 5 (demo film):** The hover rule that skips disabled segments outranked the pressed rule, so hovering the selected segment showed the hover ground under its light text. `SegmentedControl` now leaves the pressed segment's fill alone on hover, as `FilterChips` does; a test checks that no hover rule in the injected styles matches the pressed segment.
- **2026-11-12T19:54+11:00, task 5 (merge of `interactive-app` a95b2818):** The form's start hint names the split dev settings (`INTAKE_USE_MOCK_AI_AGENTS`, `INTAKE_USE_AGENT_SESSIONS`, #202). The docs keep the trunk's settings text with the "Settings › Agents" location. The section test types its fetch mock as `fetch`, so the type-aware promise rules (#203) see that its implementations return promises.

### Open items

None for task 5.

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

- **2026-11-10T07:17+11:00, task 8 (review round 1):** Each lot's quantity under a location, and in the Inventory comparison, comes from the projection's stock item record rather than being re-derived from the capture, because the projection never gives an AI lot that inherits its quantity the batch default. An Examine estimate reads "About N pcs · Examine’s estimate, not yet accepted", and a lot with no count reads "Quantity needs a decision".
- **2026-11-10T07:17+11:00, task 8 (review round 1):** A failed or paused existing-values read shows "Path unavailable: InvenTree couldn’t be read" in the list and the detail. A new location's path is its parent's InvenTree path and its name, only when the default's draft parent is valid and the read gives the parent's path; otherwise it reads "Not known". The location type is a disabled select rather than a description field.
- **2026-11-10T07:17+11:00, task 8 (review round 1):** The Ready to add heading, footer and By type use the same ticked nodes as the Tree. A failed preparation leaves the previous one shown, so a status line says the unticked lots aren't prepared without them yet, and approval waits.
- **2026-11-10T07:37+11:00, task 8 (review round 2):** After an untick, a record whose prepared stock is all unticked lots' is also marked Not ticked and left out of the counts: a Part (with its parameters, sourcing and images, through `parent_key`) and a location (through the stock items' `location_key`). A company has no link in the tree to the stock it serves, so it stays counted as prepared. The footer's "Approve N lots" counts the ticked lots.

### Open items

- Location types and their descriptions need a server read (BI-015).

## Task 9: Processing › Inventory step page

### Changes to the plan

- **2026-11-10T06:53+11:00, task 9 (PR-E):** The retained question carries only its kind (quantity or clarification), subject, prompt, reason and assumption. It names no existing stock item, holds none of its fields and offers no options. So:
  - **Comparison:** one "Compare before answering" card per open Inventory question about a lot. The "This batch" column shows the lot's Part, location and quantity from the records projection and the capture; the date code and the whole "In InvenTree" column read "Not known". The card isn't titled "Possible duplicate stock", because the app can't tell a duplicate-stock question from a Part or location question. Full data is BI-015.
  - **Drawer:** the open question is answered in the drawer through `QuestionAnswer`, a clarification text or a quantity with Counted or Estimated. The canvas's option cards are built but disabled above it, because the question carries no options (BI-015); the spec, proposal, design D7 and BI-015's scope now say so.
- **2026-11-10T06:53+11:00, task 9 (PR-E):** The Inventory sub-tab already opened its step page (`#<batch>/processing/inventory`), so "link the sub-tab" needed no change; the sub-tab itself belongs to PR-B's batch header.
- **2026-11-10T06:53+11:00, task 9 (PR-E):** The Part, location and company matches come from Review's records projection, the same records Review › Records edits, rather than from Inventory's proposals, which hold no match fields. The page shows them only while the step has retained work, like the other step pages, and keeps the job cards below them.

### Decisions made during implementation

- **2026-11-10T06:53+11:00, task 9:** Only an Inventory session's drawer answers in place; other steps' drawers keep linking to the question on its step page, so their behaviour is unchanged. A question already pinned on the page keeps its link in the drawer, so one question never has two answer forms. Like the pinned answer, a drawer answer form appears only after this mount's fresh Processing read, so a warm cache never pins its question; until then the drawer shows the link.
- **2026-11-10T06:53+11:00, task 9:** Each drawer answer reports to its own navigation-guard source (`answer:<question>`). The workspace treats any answer source as an answer draft (`answerDirty`), so the batch instructions and Examine corrections still wait while one is unsaved, as they do for the pinned answer.
- **2026-11-10T07:17+11:00, task 9 (review round 1):** `DrawerAnswers` remembers which questions have forms and the capture revision each pinned, so a failed or paused read no longer unmounts a form or clears its guard. A clean form, and the page's pinned form, re-pin when another answer moves the capture revision; a form with a draft keeps its pin. No answer form sends while another answer form, the instructions or a correction has a draft, and it says why. (Corrected in review round 2: the other drawer forms also stayed editable while an answer saved; they are now read-only until it settles.)
- **2026-11-10T07:17+11:00, task 9 (review round 1):** Closing the drawer with an unsaved answer shows "Save or discard your answer before closing this session" with "Discard answer and close", as the navigation guard keeps the route while a draft is open. After an answer saves, focus moves to the next form's field or the drawer title, which `Dialog` now makes focusable by script.
- **2026-11-10T07:17+11:00, task 9 (review round 1):** A quantity question asks for a count, not about an existing record, so it gets no comparison card. Each comparison card is named for its lot, and each drawer form and option group for its question.
- **2026-11-10T07:37+11:00, task 9 (review round 2):** A form now pins the question object with its revision, and stays while its draft is unsaved even after the question is answered elsewhere, superseded or gone; it then shows its superseded notice, and the pin goes once the form is clean. If the session leaves the read while a drawer answer is unsaved, the drawer stays open on the job as last read. The close guard counts every drawer answer source. Other drawer forms are read-only while an answer saves. The disabled option cards read "First option from the session" and "Second option from the session", which are true for any question.
- **2026-11-10T07:52+11:00, task 9 (review round 3):** The drawer's link to the question pinned on the page closes the drawer the way Close does, so it asks first while a drawer answer is unsaved. Any open drawer whose session leaves the read closes once it holds no unsaved answer: at once if it held none, or when its last draft is saved or discarded. Its `?session=` link is cleared from the URL so the drawer doesn't reopen if the session comes back. (Review round 4: the close is a state adjustment during render, and an Effect only syncs the URL.)
- **2026-11-10T08:24+11:00, task 9 (review round 5):** Saving an answer reloads the batch, and `Batch` keys Processing on the batch revision and its reset count, so Processing remounts and the drawer and its focus intent were lost. A small store (`processing/drawer-restore.ts`), owned by `Batch` above that key like the Examine sharper-photo requests, now carries the open drawer's job, its route and whether focus moves to the next question. Processing writes it once an answer is confirmed, and the next mount on the same route takes it once. Writing `?session=` when a drawer opens from the session row was rejected, because the navigation guard refuses a URL change while any draft is open. Not remounting Processing for an answer reload was rejected, because the revision key is what replaces pinned forms and caches after a save. A drawer whose session has left the read now closes from any mount once its fresh read shows the session gone, so a saved last draft also clears `?session=`; each leave is its own event, so a session that leaves again has its link cleared again.
- **2026-11-10T08:39+11:00, task 9 (review round 6):** The drawer-restore store lives for one reload. Processing arms it once an answer is confirmed; `Batch`'s reload carries it only when it re-keys Processing, just before the re-key; and every Processing mount clears it after reading what was carried, on its own route only. A reload that fails or is skipped (an edit pending) never carries it, so a later visit doesn't reopen the drawer. The move to the next question is also given up if the remounted Processing's read fails, so focus the operator places while it is unavailable stays put.
- **2026-11-12T13:42+11:00, task 9 (review round 7):** Processing also disarms the store when it unmounts. Any successful reload carries what is armed, including a later Records save, so without that an answer whose reload failed could reopen the drawer after a reload from another tab. On the re-key path the carry happens before the old Processing unmounts, so disarming only drops what no reload carried. The move to the next question is also skipped if the operator moves focus while it waits, for example into the chat box while the remount's read is still pending: the drawer records where focus was when the move was promised, after its own opening settles focus.
- **2026-11-12T17:57+11:00, task 9 (review round 8):** `Dialog` now opens, and records its opener, in a layout Effect, so its children's Effects see focus where the opening left it; `DrawerAnswers` reads that synchronously rather than in a microtask. `Dialog` also takes an optional `returnFocus` used when the opener was the page itself, or was removed before the dialog closed (a connected opener always takes focus back instead): a drawer restored after a remount had no opener, so Processing returns focus to the session's row. The restore store's `set` only arms; `disarm()` is the one way to drop what is armed.

### Open items

- The comparison's InvenTree column and date code need the question to carry the existing record (BI-015).
- The Processing fixture (`tests/fixtures/processing.html`) has no Inventory work, so the step page isn't in the screenshot set yet.
