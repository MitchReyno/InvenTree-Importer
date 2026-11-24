# Implementation and delivery tasks

## Plan context

- **Plan:** the [proposal](proposal.md) and [design](design.md), with deltas in `specs/` for `ui-design-system` and `live-updates`.
- **Reuse:** TanStack Query's own state for freshness; a small snapshot module for reloads; the existing `Skeleton` and `Spinner`; a new `PageStack` primitive. No other dependency.
- **Change name:** `polish-ui-styling-and-loading`. Branches are `fix/…` or `feat/polish-ui-styling-and-loading-<suffix>`, and subjects `type(polish-ui-styling-and-loading): …`.
- **Items:** BI-020. The follow-up `trust-live-confirmed-reads` is BI-021.

## Completion and commit ordering

- Check an action in the same commit as its verified work.
- Review, publication, CI and merge stay unchecked until they happen.
- Never commit in a worktree while a test run uses it.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Selected rows keep their whole border | Frontend fix | None | ui-design-system "Selected rows show their whole border" |
| 2. Page sections evenly spaced | Frontend fix and sweep | None | ui-design-system "Page sections are evenly spaced" |
| 3. Remove Batch context and the profile notices | Frontend removal | None | Proposal items 3 and 4 (no spec requirement covers them) |
| 4. Freshness layer and persisted reads | Frontend behavior | None | ui-design-system "Reads load without shifting the page", "Refresh progress takes no space"; live-updates "Commands wait quietly for a verified read", "The wait is quiet", "Background refreshes keep commands available", "Commands without a revision wait for a settled read", "Cached reads survive a reload in the same session", "Only allowlisted reads are stored" |
| 5. Every screen on the freshness layer | Frontend migration | 2, 4 | The same requirements on every screen; live-updates "Live unverifiable workspace state" kept |
| 6. One state vocabulary and one time format | Frontend behavior | None | ui-design-system "One set of state words", "Times say which day"; header-workflow-status "The summary names what needs attention", "An idle summary needs proof", "Outside a batch the summary claims no idle state" |
| 7. Overview and step page counts | Frontend behavior | 6 | processing-workspace "Processing overview" (Needs you, the bar, the lot table), "Step pages count their own step", "Step pages can focus one lot" |
| 8. Help buttons and popover placement | Frontend fix and sweep | None | ui-design-system "Explanations behind help buttons", "Popovers open at their control" |
| 9. Several files at once from any source | Frontend behavior | None | capture-grouped-evidence "Several photos from a phone in one go", "Drop or paste files to add evidence" |
| 10. Electronics animation switch | Frontend behavior | None | app-settings "Electronics animation switch"; ui-design-system "Masthead and electronics current in both themes" (modified) |
| 11. Agent settings autosave | Frontend behavior, with intake server and contracts (save receipts) | None | app-settings "Agent settings save as they change", "Agent settings text keeps an explicit Save", and these "Agent settings section" (modified) scenarios: Change sessions at once, Stale settings revision, Mixing providers across steps, Turning a provider off, No provider on, Other settings before any provider, Instructions copied once, Description style too long, Turning public web pages off, Profile without web access |
| 12. Read-only provider status | Intake server, VM guest and contracts | None | shared-vm-execution "Read-only provider sign-in status", "Status reads never change the guest", "Codex status answered from the last check", "Codex checks stop and are forgotten" |
| 13. Provider cards, switches, model picker and sign-in dialogs | Frontend behavior | 6, 11, 12 | app-settings "Agent settings section" (modified) scenarios Removing the credential updates the card, Sign-in status before a check, Collapsing clears the card, Editing the key while signing in, Sign-in completes and Check fails; shared-vm-execution "Personal Claude subscription token" and "ChatGPT sign-in for the runner" (modified); "Provider sign-in status is read automatically", "Each provider's status stands alone", "Sign-in failures shown apart from the status", "Agent settings controls match the design", "Subscription sign-in in a dialog", "Closing a sign-in dialog drops its work", "One searchable model picker", "Model picker limits and exact IDs" |
| 14. Dropdowns follow the guideline | Frontend sweep | 13 | ui-design-system "Searchable picker for records and growing lists", "Short fixed choices follow a guideline" |
| 15. A replaced read is not a failure | Frontend behavior | 4 and 5 (merged) | live-updates "A replaced read is not a failure", "Unavailable saved values are reported calmly"; "Live unverifiable workspace state" still passes |

## PR delivery map

| Bundle | Outcome and included work | Task coverage | Why this boundary | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-0 | This plan, the `trust-live-confirmed-reads` follow-up proposal, BI-020 and BI-021 | Planning | Review the plan before code | None; first | `interactive-app` ← `docs/polish-ui-styling-and-loading`; `docs(polish-ui-styling-and-loading): plan UI polish and calm loading` | `openspec validate --strict` for this change (the follow-up has only its proposal, so it isn't validated yet); read-only review; CI |
| PR-A | The border fix, page rhythm across every page, the removals, help buttons, popover placement and the animation switch | 1, 2, 3, 8, 10 | Small visual fixes, immediately useful, independent of the loading work | PR-0 | `fix/polish-ui-styling-and-loading-layout`; `fix(polish-ui-styling-and-loading): even page spacing and whole selected borders` | Frontend typecheck, lint, tests and build; before and after captures at 1440 and 390 px; demo video; review; CI |
| PR-B | The freshness hook, refresh signal, quiet disabled reasons and persistence, with Processing and Review moved onto them | 4 | The core pattern, proven on the two screens with the reported banners | PR-0 | `feat/polish-ui-styling-and-loading-fresh-reads`; `feat(polish-ui-styling-and-loading): calm loading and cached reads for Processing and Review` | Frontend checks, including persistence tests; demo video; review; CI |
| PR-C | The remaining screens moved onto the layer, with skeletons and the one-off lines removed | 5 | Broad but mechanical once PR-B's pattern is merged | PR-A and PR-B merged | `feat/polish-ui-styling-and-loading-every-screen`; `feat(polish-ui-styling-and-loading): one loading pattern on every screen` | Frontend checks; captures; demo video; review; CI |
| PR-E | Several files at once: phone library multi-select, drop and paste | 9 | A small, self-contained Capture change | PR-0 | `feat/polish-ui-styling-and-loading-multi-file`; `feat(polish-ui-styling-and-loading): add several evidence files at once` | Frontend checks; phone and desktop checks recorded; demo video; review; CI |
| PR-F | Debounced autosave for non-text agent settings, with save receipts in the intake server | 11 | One settings behaviour change, reviewed with its save-ordering tests | PR-0 | `feat/polish-ui-styling-and-loading-settings-autosave`; `feat(polish-ui-styling-and-loading): agent settings save as they change` | Frontend checks; contracts tests; intake unit and PG tiers; demo video; review; CI |
| PR-G | The read-only provider status: per-provider status endpoints and relay routes, the `credential_meta` side table, the intake API and contract | 12 | Server and VM work, reviewed on its own with the process tier | PR-0 | `feat/polish-ui-styling-and-loading-provider-status`; `feat(polish-ui-styling-and-loading): read provider sign-in status without the key` | Contracts tests, intake unit, PG and process tiers with the decoder and probe images; a live status-route check on the VM (reads only, no provider turn) with Mitch's go-ahead; review; CI |
| PR-H | Provider cards with status pills, switches, the segmented default provider and the sign-in dialogs | 13 | The UI over PR-G, after PR-F's autosave changes to the same forms | PR-D, PR-F and PR-G merged | `feat/polish-ui-styling-and-loading-provider-cards`; `feat(polish-ui-styling-and-loading): provider cards and sign-in dialogs like the design` | Frontend checks; Settings on the real VM showing the statuses with no key; demo video; review; CI |
| PR-I | Every dropdown on the guideline: searchable pickers for records and growing lists, segmented or native for short fixed lists | 14 | A broad but mechanical sweep, reviewed with captures | PR-H merged (the `SearchablePicker` base) | `feat/polish-ui-styling-and-loading-dropdowns`; `feat(polish-ui-styling-and-loading): one dropdown guideline across the app` | Frontend checks; captures of each changed field; demo video; review; CI |
| PR-D | One state vocabulary and time format, the masthead summary, the Overview's Needs you and lot table, and step page counts | 6, 7 | One coherent "status reads the same everywhere" change; independent of the loading work | PR-0; rebase on PR-A if it merged first | `feat/polish-ui-styling-and-loading-status`; `feat(polish-ui-styling-and-loading): one way to show status and time` | Frontend checks; captures of Overview, step pages, Agents and the masthead; demo video; review; CI |
| PR-J | Awaited reads wait for the read that replaced a cancelled one, and the batch and Processing report real failures calmly, naming unsaved changes only when there are some | 15 | One small fix to the freshness layer and its two messages, reviewed with the cancel race reproduced | PR-B and PR-C merged (both are); independent of `improve-agent-interaction` PR-J, which fixes the answered question's card | `interactive-app` ← `fix/polish-ui-styling-and-loading-replaced-reads`; `fix(polish-ui-styling-and-loading): a replaced read is not a failure` | Frontend checks with the real `QueryClient` race tests; demo video; review; CI |

## 1. Selected rows keep their whole border

- **PR delivery:** PR-A.
- **Outcome:** the first row of a shared-divider list keeps its full accent border when selected. Every similar list is checked.
- **Scope and approach:** `components/review/records/RecordsStage.tsx` (`RecordButton`), then a search of lists using `:first-of-type`, `& + &` or negative-margin dividers (design: "Fix the border at the row").
- **Prerequisites:** none.
- **Acceptance:** "Selected rows show their whole border".
- **TDD approach:** a component test reading the generated rule for a selected first row fails first; the capture confirms it.
- **Verification:** frontend tests; a before and after capture of Review › Records.
- **Risks and decisions:** none.

- [x] 1.1 Read the shared and frontend code guidelines and the frontend architecture. List every shared-divider list with a selected state.
- [x] 1.2 RED: a `RecordsStage` test showing that the selected first row's top border is cleared.
- [x] 1.3 GREEN: guard the divider rule with `:not([aria-current='true'])` in `RecordButton` and every list found in 1.1.
- [x] 1.4 Run the frontend tests, and capture the lists before and after for the PR.

## 2. Page sections evenly spaced

- **PR delivery:** PR-A.
- **Outcome:** a `PageStack` primitive gives every page's top-level sections the design system's page gap. Outer margins on page sections are removed. Every page is checked at two widths.
- **Scope and approach:**
  - `components/ui/primitives.tsx` (`PageStack`);
  - each page root: Batches, Capture, Processing and its step pages, Review (Lots, Map, Records), Changes, Agents, the Settings sections;
  - removal of `margin-bottom` from their top-level sections (`ScopeBar`, `ContextFold`, `Toolbar` and the like).
- **Prerequisites:** none.
- **Acceptance:** "Page sections are evenly spaced", both scenarios.
- **TDD approach:** this is layout. A `PageStack` unit test checks the gap token and that no gap is left for an absent child. The main evidence is before and after captures of every page at 1440 and 390 px.
- **Verification:** frontend checks; a Playwright capture script over the fixture pages and the dev app (kept outside the repository, or under `frontend/scripts/` if it proves reusable), with the captures attached to the PR.
- **Risks and decisions:** pages with their own grid rhythm (the Review grid) keep it inside the stack.

- [x] 2.1 Map the canvas page gap (14 px) to its frontend space token. Read every page root, and list the top-level sections with outer margins.
- [x] 2.2 Capture every page at 1440 and 390 px as the baseline, and note each touching pair, starting with Review's banner and toolbar, and the filters and grid.
- [x] 2.3 Add `PageStack`, with its unit test.
- [x] 2.4 Move each page root onto `PageStack` and remove the outer margins.
- [x] 2.5 Capture again, compare with 2.2 and fix any remaining touching sections. Run the frontend checks.

## 3. Remove Batch context and the profile notices

- **PR delivery:** PR-A.
- **Outcome:**
  - Review no longer shows Batch context;
  - Processing no longer shows the native or synthetic profile banner, and job cards no longer carry the "native agent · live provider not qualified" tag;
  - the profile shows as a debug panel row;
  - "Closing this browser does not cancel saved work" moves into the Processing page's help.
- **Scope and approach:** `review/ReviewWorkspace.tsx` (`ContextFold`; `CaptureContextSummary` stays for Capture), `processing/ProcessingWorkspace.tsx`, `ProcessingJobCard.tsx`, the page debug rows, and the fixtures and tests that assert the old text.
- **Prerequisites:** none.
- **Acceptance:** proposal items 3 and 4.
- **TDD approach:** update the tests that assert the removed text so they assert its absence, plus the debug row in debug mode. Those tests fail before the change.
- **Verification:** frontend tests; captures of Review and Processing.
- **Risks and decisions:** none.

- [x] 3.1 Find every test, fixture and doc that mentions Batch context, `native_unverified` text or "live provider not qualified".
- [x] 3.2 RED: assert their absence, and assert the debug row.
- [x] 3.3 GREEN: remove them, add the debug row and move the help sentence.
- [x] 3.4 Update `frontend/ARCHITECTURE.md` where it describes them. Run the frontend checks.

## 4. Freshness layer and persisted reads

- **PR delivery:** PR-B.
- **Outcome:**
  - `useFreshRead` with its phases and `commandsReady`;
  - `ReadState` with page skeletons;
  - `RefreshSignal` with the 400 ms progress line and the 3 s "Updating…" status;
  - `Button`'s quiet disabled reason;
  - display-only snapshots of allowlisted reads in session storage, restored only after a matching bootstrap and never into the query cache, with build and 12-hour expiry, scope clearing, the 1 MB cap and quota handling;
  - Processing and Review moved onto these, with their "Verifying…" banners removed.
- **Scope and approach:**
  - `frontend/src/queries/` (the hook, the verified-reads registry, the snapshot module);
  - `components/ui/` (`ReadState`, `RefreshLine`, the `Button` option);
  - `App.tsx` (`RefreshSignal`, the restore wait) and `batches/Batch.tsx` (the display-only path while Capture is in flight);
  - `vite.config.ts` (the build constant);
  - `processing/ProcessingWorkspace.tsx`, `review/ManualWorkspace.tsx`, `review/ReviewWorkspace.tsx`, `review/records/RecordsStage.tsx` and `review/TellExamine.tsx`, the other callers of the Processing key, so every caller moves together.
- **Prerequisites:** none.
- **Acceptance:** "Reads load without shifting the page" (all scenarios), "Refresh progress takes no space", "Commands wait quietly for a verified read", "The wait is quiet", "Background refreshes keep commands available", "Commands without a revision wait for a settled read", "Cached reads survive a reload in the same session", "Only allowlisted reads are stored"; "Live unverifiable workspace state" still passes.
- **TDD approach:** hook, signal, button and persistence tests fail first. The existing Processing and Review gate tests are rewritten against the hook and must keep their guarantees.
- **Verification:**
  - `pnpm --filter frontend typecheck`, `lint`, `test` and `build`;
  - the persisted sizes of the Processing and Review projections, measured and reported in the PR description (a `notes.md` entry only if they change the design);
  - a demo video of returning to Review and Processing (no banner), a slow refresh throttled in DevTools, and a reload.
- **Risks and decisions:** keep the gate's guarantees exactly; review each replaced condition against the old one.

- [x] 4.1 Read the guidelines and the frontend architecture's query and live-update sections. Write down the exact current gate conditions in Processing and Review, every `cancelQueries` call, every command that writes its receipt with `setQueryData`, and every command that sends no expected revision (Pause, Resume, instruction delivery and `TellExamine`'s chat send at least).
- [x] 4.2 Define the first snapshot allowlist and its display projections (Processing, the Review workspace, the batch header, Records), with the contracts' validators.
- [x] 4.3 RED: hook and component tests:
  - [x] 4.3.1 `useFreshRead` phases and `commandsReady`, including the scope change and the `current` predicate.
  - [x] 4.3.2 `RefreshSignal` at 400 ms and 3 s, reduced motion, and the announced status.
  - [x] 4.3.3 `Button`'s quiet disabled reason, which adds no layout.
  - [x] 4.3.4 Snapshots: a hard reload with bootstrap complete and Capture held in flight showing the open tab's snapshot read-only with commands and edits fenced; sentinel values in excluded fields, keys and nested DTOs never stored; validation on read; restore only after a matching bootstrap and never into the query cache; expiry by age and build; scope change dropping pending writes; the size cap and quota failure.
  - [x] 4.3.5 Verification, with the real `QueryClient`: a `setQueryData` write before and after verification (including equal data), a successful read of equal data still verifying, a silent cancel and replace through `cancelVerified`, the real reconciliation path with one settled query (staying verified) and one in-flight background refresh (cancelled, never verifying), an observer joining a fetch mid-flight with polling off and no further hints (the first observer verified at once, the second only after the single follow-up fetch), an older request completing late, a removed query, a shared in-flight fetch, failed and paused reads, and a receipt writer's reread; separate refresh cases for Processing commands, Pause, Resume and instruction delivery (a settled read started after the last hint, rechecked at dispatch, including a dispatch during the 100 ms debounce and while reconciliation is queued behind a running read; and an instruction save whose hint arrives before it returns, holding the automatic delivery as pending across the reload and sending it once), Review's manual workflow and acceptance.
- [x] 4.4 GREEN: implement the hook with the verified-reads registry and request generations, `cancelVerified` (used by `LiveUpdates`), the hint times for Pause and Resume, the rereads after receipt writes on Processing and Review, `ReadState`, `RefreshSignal`, the focusable quiet button option, the build constant, and the snapshot module.
- [x] 4.5 Move Processing, Review, Records' and `TellExamine`'s Processing queries onto them, with a Review Map regression where `TellExamine` starts the shared fetch. Remove the two "Verifying…" banners and "Reading retained processing state…", and add their skeletons. Rerun their gate and draft tests.
- [x] 4.6 Measure the persisted sizes, update `frontend/ARCHITECTURE.md` (reads, freshness, persistence), and run the frontend checks.

## 5. Every screen on the freshness layer

- **PR delivery:** PR-C.
- **Outcome:** every remaining screen loads through `ReadState`, with a skeleton, cached-first rendering and quiet refresh, and adds snapshot projections where the allowlist allows. The 22 one-off loading lines are gone.
- **Scope and approach:** Batches, Capture, the Processing step pages (Images, Inventory, the session panel), Review Map, Records and record detail, Changes (including "Reading every record…"), Agents, the Settings sections, Local setup and the masthead activity's "Reading…". Debug reads and dialogs reading on demand (`RemovalDialog`) keep a local spinner instead of a skeleton.
- **Prerequisites:** tasks 2 and 4 merged.
- **Acceptance:** the task 4 requirements on every screen.
- **TDD approach:** each screen's loading test changes from asserting its text to asserting the skeleton or cached content, and fails first.
- **Verification:** frontend checks; captures of each screen's first load and return; a demo video.
- **Risks and decisions:** screens with deliberate one-off states (the token check's "Checking…") keep them where they describe an action the operator started, not a read.

- [x] 5.1 List each of the 22 loading lines and classify it: a read (migrate) or an operator action (keep).
- [x] 5.2 RED: update each migrated screen's loading test. Add Pause and Resume cases on the Agents page and Settings › Agents for a dispatch during the hint debounce and while reconciliation is queued; and two consecutive Review Map edits with live hints on and polling off, the second available after the first's reread.
- [x] 5.3 GREEN: gate the Agents page's batch and global Pause/Resume and Settings › Agents' Pause all on a settled verified read started after the last hint; add the reread after each remaining receipt write, including Review Map's; migrate the screens, add their skeletons, and add snapshot projections for any newly allowlisted reads.
- [x] 5.4 Capture the first load and the return for each screen. Run the frontend checks, and record the demo video.

## 6. One state vocabulary and one time format

- **PR delivery:** PR-D.
- **Outcome:**
  - `WorkState` and `StatePill` with seven states and glyphs, mapped in one function from retained states, and used by the session lists, step tabs, the Overview, the step pages and the masthead;
  - the masthead summary names what failed or waits, or says "no agents working" (never "all done");
  - `EventTime` used for every event time.
- **Scope and approach:**
  - `components/ui` (`StatePill`, `EventTime`);
  - `header/workSegments.ts` (the mapping, replacing `stateWords`);
  - `masthead/ActivityIndicator.tsx`;
  - the session list, step tabs, Processing cards, the step pages, the Agents page rows and the drawer timeline.
- **Prerequisites:** none.
- **Acceptance:** "One set of state words", "Times say which day" (both scenarios), "The summary names what needs attention" (all scenarios).
- **TDD approach:** mapping, `EventTime` and summary tests fail first. Existing tests asserting Finished, Ready or Retained work are updated to the new words.
- **Verification:** frontend checks; captures of each place a state or time shows.
- **Risks and decisions:** agree the shared types with `improve-agent-interaction` (see design).

- [x] 6.1 Read the guidelines and the frontend architecture. List every place a work state or event time renders, and every word it uses today.
- [x] 6.2 RED: tests for "no agents working" needing a complete active-session read with no held lane (a cancelled session still holding one; `lane_occupied: true` with no visible holder); the precedence of stale, failed and truncated reads (a truncated work list naming visible steps without counts, or "Status incomplete"), with work and session truncation tested separately; the summary outside a batch never claiming no failures; the state mapping, `StatePill` glyphs, `EventTime` formats and hover text, and the masthead summary: a failure first, then waiting; "no agents working" only from a fresh, complete read; a truncated, stale or unavailable read saying "Updating…" or "Status unavailable"; "all done" never shown.
- [x] 6.3 GREEN: implement them, and replace the per-screen words and time formats.
- [x] 6.4 Update affected tests and `frontend/ARCHITECTURE.md`. Run the frontend checks.

## 7. Overview and step page counts

- **PR delivery:** PR-D.
- **Outcome:**
  - the Overview's Needs you lists everything the header counts, tagged with its tab, through the same component as the header popover;
  - the bar's step labels show counts and link to the step pages;
  - a per-lot table of state pills replaces Pipeline;
  - step page summaries count their own step.
- **Scope and approach:** `processing/ProcessingOverview.tsx`, `batches/NeedsYouPanel.tsx` (shared list), the step page summaries (`processing/StepPage.tsx` and the step views), using the attention read.
- **Prerequisites:** task 6.
- **Acceptance:** "Processing overview" (all scenarios), "Step pages count their own step", "Step pages can focus one lot".
- **TDD approach:** Overview and step page tests for Needs you with Review items, the lot table and the counts fail first.
- **Verification:** frontend checks; captures of the Overview and each step page; demo video.
- **Risks and decisions:** none.

- [x] 7.1 Read the Overview, step page and `NeedsYouPanel` code and the attention read's shape.
- [x] 7.2 RED: tests for:
  - [x] 7.2.1 Needs you agreeing with the header, including its truncation note.
  - [x] 7.2.2 The bar's linked counts.
  - [x] 7.2.3 The lot table, including Part-subject jobs.
  - [x] 7.2.4 The step `lot` parameter on a direct load.
  - [x] 7.2.5 The Research page's own counts, using the step section's filtering.
- [x] 7.3 GREEN: share `NeedsYouPanel`'s list, replace Pipeline with the lot table, add the `lot` route parameter and focus, link the bar, scope the step counts, and remove the duplicate outer summary.
- [x] 7.4 Capture the Overview and step pages. Run the frontend checks, and record the demo video.

## 8. Help buttons and popover placement

- **PR delivery:** PR-A.
- **Outcome:**
  - standing explanations sit behind help buttons in plain words;
  - developer-only text shows only in debug mode;
  - popovers open at their control, and pills keep their own column.
- **Scope and approach:** a sweep of helper sentences under headings and controls (Processing, the step pages, Agents, Review, Settings), `HelpButton`, `DebugDetails`, the shared `Popover`, and the batch header's need-you popover.
- **Prerequisites:** none.
- **Acceptance:** "Explanations behind help buttons", "Popovers open at their control".
- **TDD approach:** tests that the named sentences are gone and reachable through their help buttons, and a popover placement test, fail first.
- **Verification:** frontend checks; captures.
- **Risks and decisions:** keep each sentence's meaning while rewording; list each move in the PR.

- [x] 8.1 List every standing explanation and developer-facing sentence, and classify each: help, debug or delete.
- [x] 8.2 RED: tests for the three named sentences and the popover placement.
- [x] 8.3 GREEN: move them, and fix the need-you popover's anchoring and row layout.
- [x] 8.4 Capture the affected screens. Run the frontend checks.

## 9. Several files at once from any source

- **PR delivery:** PR-E.
- **Outcome:**
  - on a phone, Take photos offers the camera and the library, with multi-select;
  - files dropped onto the evidence panel or a group, or pasted outside text fields, upload as if picked.
- **Scope and approach:** `components/media/MediaUpload.tsx` (drop `capture`), `MediaWorkspace.tsx` and `EvidenceGroupPanel.tsx` (drop targets, the highlight, paste), using the existing upload queue (design: "Several files from any source").
- **Prerequisites:** none.
- **Acceptance:** "Several photos from a phone in one go" and "Drop or paste files to add evidence", all scenarios.
- **TDD approach:** tests fail first for the input attributes, a drop on a group, paste inside and outside a note, and refusal when media is disabled.
- **Verification:**
  - frontend checks;
  - manual checks on an iPhone and an Android phone (library multi-select) and desktop Chrome and Safari (drop and paste), recorded in the PR;
  - a demo video.
- **Risks and decisions:** if a tested phone's sheet lacks the camera or the library, Take photos opens a Camera / Photo library choice (design), and both inputs are tested on that platform.

- [x] 9.1 Read the guidelines, the media upload code and the capture-grouped-evidence spec.
- [x] 9.2 RED: tests for the photos input attributes (`multiple`, JPEG and PNG, no `capture`), and, if 9.4 needs the fallback, the library input without `capture` and the camera input with it; validator typing of dropped and pasted files, including an unsupported one; a mixed drop as one operation with one count; a nested group drop handled once; paste outside and inside a note; and every picker refusal (disabled, archived, stale, pending command, conflicting draft) refusing drop and paste.
- [x] 9.3 GREEN: remove `capture`, add `addMixed` to the upload queue, extract the shared start gate (returning its reason, and keeping the picker-return behaviour), and add the drop targets with their highlight and the paste listener behind it.
- [ ] 9.4 Check on iOS Safari and Android Chrome (library multi-select and the camera option) and desktop Chrome and Safari (drop and paste). If a phone's sheet lacks the camera or the library, add the Camera / Photo library choice inside Take photos, and test both flows on that platform. Run the frontend checks, and record the demo video.

## 10. Electronics animation switch

- **PR delivery:** PR-A.
- **Outcome:** Settings › Appearance has "Animate the electronics" under Masthead, on by default and stored on the device. Off stills the current in whichever masthead style is chosen; reduced motion still stills it whatever the switch says.
- **Scope and approach:** a motion preference controller beside `theme/masthead-style.ts`, `settings/MastheadChoice.tsx` (the switch), `masthead/ElectronicsCurrent.tsx` and the scene controller (`pause()` and `resume()` on the same scene, keeping the OS reduced-motion flag separate), the `index.html` inline script, and `frontend/ARCHITECTURE.md` (design: "The electronics animation switch").
- **Prerequisites:** none.
- **Acceptance:** "Electronics animation switch", all scenarios.
- **TDD approach:** the controller, switch and scene-option tests fail first.
- **Verification:** frontend checks; a capture of the switch; a manual check of all three styles with the switch off.
- **Risks and decisions:** none.

- [x] 10.1 Read the guidelines, `theme/masthead-style.ts`, `device-preference.ts` and how `ElectronicsCurrent` starts the scene.
- [x] 10.2 RED: tests for the preference (default, bad storage, unknown value), the switch, the scene paused when off, turning it on after an off-state reload, a theme change while paused, OS reduced motion still winning, and switching off, scrolling the masthead out of view and back (still paused), then switching on (the same scene resumes); and resizing the window while paused redrawing the still frame at the new size with the same parts, which then resume.
- [x] 10.3 GREEN: implement the preference, the switch, and the controller's `pause()` and `resume()`, keeping the OS reduced-motion flag separate.
- [x] 10.4 Check the three styles with the switch off in the running app (the fixture runner freezes the scene). Update `frontend/ARCHITECTURE.md`, and run the frontend checks.

## 11. Agent settings autosave

- **PR delivery:** PR-F.
- **Outcome:**
  - switches, choices, selects and the stepper on Settings › Agents save about 600 ms after the last change, with no Save button, and show `AutosaveStatus`;
  - text fields keep Save and Discard, shown only while they hold an edit;
  - pending saves flush on leave;
  - refusals show at the control.
- **Scope and approach:** `intake-server/src/agents/settings.ts`, a migration and the runtime grants for the receipt table, and `contracts/src/agents.ts` (`save_id`); `components/settings/agents/` (`useSubsectionForm`, `useSettingsSave`, `useDirtyForms`, `SaveBar` and each subsection: `ProvidersAndSteps`, `ProviderCard`, `StepChoices`, `SessionsForm`, `TagSuggestionsForm`, `WebResearchForm`, `InstructionsForm`, `DescriptionStyleRow`), reusing `components/ui/AutosaveStatus` (design: "Agent settings autosave").
- **Prerequisites:** none.
- **Acceptance:** "Agent settings save as they change" (all scenarios), "Agent settings text keeps an explicit Save", and the "Agent settings section" scenarios the task map assigns to task 11, verified in PR-F as a release on its own.
- **TDD approach:** fake-timer tests for each scenario fail first. The existing save, conflict and guard tests are kept, and adjusted where Save disappears.
- **Verification:** frontend checks; contracts tests; intake unit and PG tiers; a demo video of a stepper, a switch, a conflict and an instruction edit.
- **Risks and decisions:** keep the revision and page-lock guarantees exactly; review each changed save path against the old one.

- [x] 11.1 Read the guidelines, `frontend/ARCHITECTURE.md`'s Settings › Agents section and the subsection forms. List each control as text or non-text. Read the intake server's migration and compatibility docs, and record in `notes.md` the rollout and recovery procedure for the receipt migration (one build for every intake process).
- [x] 11.2 RED: fake-timer tests:
  - [x] 11.2.1 Debounce coalescing, and the payload built at dispatch from the newest confirmed settings with only owned fields.
  - [x] 11.2.2 Same-page saves overlapping through the serial queue, and edits during a save saving again after it.
  - [x] 11.2.3 An external conflict and a lost acknowledgement (with and without a committed save) pausing the queue, reading again, and resolving through Reload or Try again.
  - [x] 11.2.7 Validation at dispatch: a provider-off save superseding a queued step choice for that provider.
  - [x] 11.2.8 Save identity: a timed-out save that commits after the recovery read, resolved as confirmed by resending its `save_id`; a lost acknowledgement followed by another tab's save, still confirmed; a conflict told apart from both; queued edits kept until the outcome is known.
  - [x] 11.2.10 The terminal unknown: Reload only, discarding the unresolved and later queued edits, keeping text drafts, and the navigation guard before and after Reload; a confirmed replay followed by a newer read from another tab, with queued edits still meeting the conflict path.
  - [x] 11.2.9 Intake PG tier: the receipt written in the settings transaction; a resend returning the minimal receipt, also after another tab saved; a resend with other fields, or equal fields over another base revision, refused; the replay receipt and `save_outcome_unknown` through the route, the generated client and `useSettingsSave`; a duplicate racing the original applying once; two concurrent first saves with one ID; pruning by count and by age, then a resend below the watermark answering `save_outcome_unknown`; the API role's grant.
  - [x] 11.2.4 Flush before in-app navigation (success continues, failure stays), and the leave prompt on reload.
  - [x] 11.2.5 The last-provider refusal, and the provider-off reset.
  - [x] 11.2.6 Text fields, including the interim model fields, keeping Save, shown only while edited.
- [x] 11.3 GREEN: add `save_id` to the agent settings contract, and the receipt table with its migration, grant, scope lock, pruning watermark and lookup before the revision check; the PUT's replay response and typed unknown error in the route, the generated client and `useSettingsSave`; add the autosave mode with field ownership and payloads built at dispatch, turn `PageSave` into a serial queue, add `AutosaveStatus` per subsection, the pre-navigation flush in `useNavigationGuard`, and the refusals. Remove the non-text Save bars; the interim model fields keep their own Save.
- [x] 11.4 Update `frontend/ARCHITECTURE.md` (the Settings › Agents save model). Run the frontend checks, and record the demo video.

## 12. Read-only provider status

- **PR delivery:** PR-G.
- **Outcome:**
  - the server reads each provider's sign-in status from the guest without the management key;
  - `GET /api/v1/agents/provider-status` reports Claude token saved or not (with its save time where recorded), Codex signed in, signing in or not, or unknown with a reason (VM unreachable, an older guest, busy, timeout), plus each provider's latest subscription-session sign-in failure, with no secrets;
- **Scope and approach:**
  - `intake-server/src/agents/shared-vm/` (`credential-main.ts`, `credential-http.ts` and `claude-credential.ts` for the status endpoints and `credential_meta`; `codex-login.ts` for the pending-login state; the session worker for the API request);
  - the deployment bridge (`tooling/deployment/bridge/personal-claude.sh`, `personal-codex.sh`, `relay.mjs`) for the private per-provider status routes;
  - an intake route beside the Agents routes;
  - `contracts/src/agents.ts`;
  - the deployment README's Settings › Agents steps.
- **Prerequisites:** none.
- **Acceptance:** "Read-only provider sign-in status", "Status reads never change the guest", "Codex status answered from the last check" and "Codex checks stop and are forgotten", all scenarios. The last two came from the live check and ship in a follow-up PR (PR-G2; see `notes.md`).
- **TDD approach:** frame, route and contract tests fail first, using a fake guest. A test proves that no response carries a token, account or key.
- **Verification:**
  - contracts tests; intake unit, PG and process tiers;
  - a live check on the real VM: an authorized call to the status route, before and after a turn, starting no provider turn. It still touches the real VM, so it needs Mitch's go-ahead.
- **Risks and decisions:**
  - Provider token verification is out of scope here (12.1.3 only investigates it). Save confirms shape and storage, and failures show as the last-session line.
  - A guest image change needs the runner image refreshed: managed `pnpm dev` rebuilds it, and unmanaged mode only warns that it's stale and points to `pnpm vm:setup` (`tooling/dev.cjs:190–195,633–646`). The provider management containers run the credential entry point from that image (`personal-claude.sh:22–25`, `personal-codex.sh:20–24`), so they restart on it too. The deployment README covers both modes.

- [x] 12.1 Investigate and decide, recording each decision and its reason in `notes.md`:
  - [x] 12.1.1 The transport for the API-to-worker status request, and a new worker-to-guest path to each credential process's status-only endpoint (the relay has none today): how the endpoint authenticates the paired worker, how both providers are reached in one deployment, and how a timed-out call is abandoned and its guest work released.
  - [x] 12.1.2 That Codex `account/read` without refresh has no side effects.
  - [x] 12.1.3 Whether the Claude CLI in the guest can confirm a setup token cheaply without starting a session. If it can, propose it as a follow-up requirement; it is not part of this task.
- [x] 12.2 RED: tests for:
  - [x] 12.2.1 The status-only endpoint: Claude saved with and without `credential_meta`; Codex signed in, signing in (before any turn), and an expired login left untouched; a read overlapping an active turn; no secrets.
  - [x] 12.2.6 `credential_meta` through upgrade, rollback, a replace or remove on the older image, and re-upgrade, showing no stale save time.
  - [x] 12.2.2 Older, busy and timed-out guests reading as unknown.
  - [x] 12.2.3 The API-to-worker request and its timeout.
  - [x] 12.2.7 Each provider answering independently, one timing out while the other answers; direct requests from the browser-facing management listener and from other namespaces refused; the deployed two-provider topology read before any turn.
  - [x] 12.2.4 The route, with the last-session line (shown only for the provider's latest queued session in either mode, a VM subscription failure produced through the real session runner, when it used the subscription and its provider error is `authentication_failed`, `unauthorized` or HTTP 401, read from the scoped diagnostic projection; a tie with an API-key session hiding it; not for a missing token, an unreachable guest or unavailable credentials; hidden after a newer session that didn't fail sign-in), and an unreachable VM.
  - [x] 12.2.5 The contract.
- [x] 12.3 GREEN: implement the status-only endpoint, the `credential_meta` side table, the worker request, the route and the contract.
- [ ] 12.4 Update the deployment README and `intake-server/src/agents/ARCHITECTURE.md`. Run the tiers, and ask Mitch before the live VM check.

## 13. Provider cards, switches, model picker and sign-in dialogs

- **PR delivery:** PR-H.
- **Outcome:**
  - provider cards with a status pill read from task 12, and "Check again";
  - switches for every on/off setting, and a segmented default provider;
  - one searchable `ModelPicker` per step and for each card's Default model, on a `SearchablePicker` base shared with `SearchableReferencePicker`;
  - "Subscription token…" and "Sign in to ChatGPT…" open dialogs. The Claude dialog checks the token's shape, then saves and closes only on confirmation; the Codex dialog closes once the account is confirmed.
- **Scope and approach:** `components/settings/agents/` (`ProviderCard`, `ProvidersAndSteps`, `TagSuggestionsForm`, `WebResearchForm`, `DescriptionsCard`), `components/agents/` (`PersonalClaudeCredential`, `ChatGPTSignIn` and their hooks, now in dialogs), a provider-status query, and `components/ui` (`Switch`, `SegmentedControl`, `Dialog`, `StatePill` from task 6).
- **Prerequisites:** task 6 (`StatePill`, owned by PR-D), task 11 (the same forms) and task 12 (the status read).
- **Acceptance:** "Agent settings section" (the modified scenarios), "Provider sign-in status is read automatically", "Each provider's status stands alone", "Sign-in failures shown apart from the status", "Agent settings controls match the design", "Subscription sign-in in a dialog", "Closing a sign-in dialog drops its work", "One searchable model picker", "Model picker limits and exact IDs", all scenarios.
- **TDD approach:** card, control and dialog tests for each scenario fail first. The existing credential panel tests move with the dialogs.
- **Verification:** frontend checks; a demo video of the cards, a refused save and the Codex sign-in, using fixtures.
- **Risks and decisions:** the management key must never be kept after a dialog closes. A test checks this.

- [x] 13.1 Read the guidelines, `frontend/ARCHITECTURE.md`'s Settings › Agents section and the credential hooks.
- [x] 13.2 RED: tests for the model picker (search, groups, a provider that's off, exact IDs, both fields set by one pick), the pill states and Check again, the switches, the segmented default provider, the dialogs' shape checks, Save disabled while checking, failures keeping the dialog open, the fresh key-protected status read enabling Save and Remove, a stale revision after a replacement elsewhere, the Codex dialog closing on confirmation, and dialog generations (closing with a queued call, then reopening with a different key: the old call is not sent, one final poll runs and a pending login is cancelled, late answers are ignored).
- [x] 13.3 GREEN: extract `SearchablePicker` from `SearchableReferencePicker` (its tests must pass unchanged), add `ModelPicker`, and implement the cards, the controls and the dialogs.
- [x] 13.4 Update `frontend/ARCHITECTURE.md`. Run the frontend checks, and record the demo video.

## 14. Dropdowns follow the guideline

- **PR delivery:** PR-I.
- **Outcome:** every native select in the app follows the dropdown guideline:
  - records, growing lists and exact-value fields use the searchable picker;
  - short fixed lists become a segmented control or stay a styled native select, chosen per screen;
  - the design system documents the guideline.
- **Scope and approach:** the 46 native select JSX sites in 28 components (Capture, Review, the Review Map, Records, the operator panels, media, Changes and the bulk bar), counted as in the design and refreshed after PR-H removes `StepChoices`, using `forms/SearchablePicker` (task 13), `SearchableReferencePicker`, a `ChoicePicker` for lists the batch already holds, and `SegmentedControl` (design: "Choosing a dropdown control").
- **Prerequisites:** task 13 merged.
- **Acceptance:** "Searchable picker for records and growing lists", "Short fixed choices follow a guideline".
- **TDD approach:** each converted field's existing tests are updated for the new control first, and fail until it's converted. A new test for a record field checks search.
- **Verification:**
  - frontend checks;
  - before and after captures of each changed field at 1440 and 390 px;
  - a demo video;
  - the audit table in the PR description.
- **Risks and decisions:** it's broad, so convert by screen in separate commits. Keep each field's value and validation unchanged.

- [x] 14.1 Audit all native selects: their screen, option count, kind (record, growing, fixed) and proposed control. Put the table in the PR description.
- [x] 14.2 RED: update each converted field's tests to the new control, and add search tests for the record fields.
- [x] 14.3 GREEN: convert the fields, screen by screen.
- [x] 14.4 Capture each changed field. Run the frontend checks, and record the demo video.

## 15. A replaced read is not a failure

- **PR delivery:** PR-J.
- **Outcome:**
  - a read cancelled by live reconciliation waits up to 10 s for the read that replaced it and shows nothing meanwhile;
  - a real failure with nothing edited shows an amber notice with the time of the values shown, Try now and an automatic retry, and clears itself once a read works;
  - only real unsaved changes are named, kept and offered "Discard my changes";
  - Processing's saved-but-unreadable case says "Saved. Showing the last status from HH:MM until it can be read again.";
  - a cancelled read still never verifies a command.
- **Scope and approach:** `frontend/src/queries/` (`readReplacingCancels`, `ReadUnavailable`, `ReadAbandoned`, and `readAgain` in `fresh-reads.ts`), `components/batches/Batch.tsx` (the reload state and notice replacing the error string and its banner, the displayed snapshot's read time, adoption only when clean, and named discard), `operator/useDirtySources.ts` (labels and discard callbacks on dirty reports) and the editors that report them, `review/ManualWorkspace.tsx`, `processing/ProcessingWorkspace.tsx` (`refresh()` and `perform()`'s messages, and the answer handler's), and `processing/instruction-delivery.ts`. The design is "A replaced read is not a failure".
- **Prerequisites:** tasks 4 and 5, merged in PR-B (#254) and PR-C (#259).
- **Acceptance:** live-updates "A replaced read is not a failure" and "Unavailable saved values are reported calmly", all scenarios; "Live unverifiable workspace state" and "Commands wait quietly for a verified read" still pass.
- **TDD approach:** with the real `QueryClient`, as task 4.3.5 does, a reload in flight while `refreshRetainedReads` runs rejects with `CancelledError` today, so the test fails first with the banner showing.
- **Verification:**
  - the frontend typecheck, lint, tests and build;
  - a demo video: answering a question while an agent works, with no banner; a throttled offline read showing the amber notice and clearing itself; the notice naming an unsaved quantity.
- **Risks and decisions:** the canvas board FixReloadBanner is the reference. `improve-agent-interaction` task 13 fixes the answered question's card separately; each is correct without the other.

- [x] 15.1 Read the shared and frontend code guidelines, the frontend architecture's query and live-update sections and the board. List every awaited `refetch({ throwOnError: true })` and `fetchQuery` caller and what each shows on failure.
- [x] 15.2 RED: tests with the real `QueryClient`:
  - [x] 15.2.1 A capture reload in flight while `refreshRetainedReads` cancels the scope resolves with the replacing read's data and sets no notice, on every tab.
  - [x] 15.2.2 The same race after a Processing answer: no "current status is unavailable" message.
  - [x] 15.2.3 A replacing read that fails, and one that doesn't settle within 10 s, report unavailable; a second cancel inside the window keeps the first deadline; a cancel from removal or a scope change, and a caller unmounting while another observer keeps the query cached, reject as abandoned and start no fallback read; the cancelled generation never verifies a command; Manual Review's awaited refetch under the same race shows nothing.
  - [x] 15.2.4 The notice with nothing edited (the displayed snapshot's time, Try now, the retry, clearing on an adopted network read and not on a `setQueryData` write); a successful automatic retry with a dirty editor clearing the notice while the draft and its revision stay; named unsaved changes, with Discard dropping only those while an unlisted mounted draft stays and no newer snapshot is adopted under it; Capture's read adopted through the registry (a background network read clears the notice, a `setQueryData` acknowledgement doesn't); and Processing's "Saved. Showing the last status from…" as the only banner after a confirmed command, clearing on a fresh read.
- [x] 15.3 GREEN: implement the helper, the reload state and notice, the labels and Processing's messages.
- [ ] 15.4 Update `frontend/ARCHITECTURE.md` (awaited reads and cancellation). Run the frontend checks, and record the demo video for the PR description.

## Delivery evidence and lifecycle follow-up

- [x] PR-0: review both plans read-only (`codex exec -m gpt-6.2-sol -s read-only`; Mitch's standing rule: at most three rounds, with the last round's fixes noted on the PR; material issues left after round three are fixed and listed on the PR for Mitch), fix, publish, CI green, merge (#247).
- [x] PR-0 follow-up: review the merged plan again (rounds 4–6, same rule), fix, publish, CI green, merge (#248).
- [x] PR-A: implement tasks 1–3, 8 and 10, review the exact head, publish with captures and the demo, CI green, merge.
- [x] PR-B: implement task 4, review the exact head, publish with the demo, CI green, merge. Merged as #254 at `8b0d08a1`.
- [x] PR-C: implement task 5, review the exact head, publish with captures and the demo, CI green, merge. Merged as #259 at `30f75b9d`.
- [x] PR-D: implement tasks 6 and 7, review the exact head, publish with captures and the demo, CI green, merge. Merged as #255 at `5adffa9a`.
- [ ] PR-E: implement task 9, review the exact head, publish with the phone and desktop checks and the demo, CI green, merge. Merged as #253 at `9e0891ed`; task 9.4's real-device checks stay open.
- [x] PR-F: implement task 11, review the exact head, publish with the demo, CI green, merge. Merged as #256 at `ec974af1`.
- [ ] PR-G: implement task 12, review the exact head, publish, CI green, run the live VM check with Mitch's go-ahead, merge. Merged as #264 at `dcc10495`; the live VM check stays open.
- [x] PR-H: implement task 13, review the exact head, publish with the demo, CI green, merge. Merged as #267 at `3000b14d`; its real-VM Settings check stays open (see `notes.md`).
- [x] PR-I: implement task 14, review the exact head, publish with the audit, captures and the demo, CI green, merge. Merged as #270 at `2636a105`.
- [ ] PR-J: implement task 15, review the exact head, publish with the demo, CI green, merge.
- [ ] Update BI-020 as PRs merge. It is Done only after every implementation PR (PR-A to PR-J) merges and its acceptance is evidenced.
- [ ] Mark this change's "Fixes: before and after" entries (S5, S7, O1–O5, O7–O11) in the design log as Built, with their PRs.
- [ ] Before syncing: re-run strict validation and `pnpm openspec:overlap --change polish-ui-styling-and-loading`. If another change has synced an edit to "Agent settings section" or "Masthead and electronics current in both themes" first, rebase this change's MODIFIED block onto the synced text, in full.
- [ ] Before archiving, run `pnpm openspec:overlap --change polish-ui-styling-and-loading`, sync the specs and record open items in `notes.md`.
