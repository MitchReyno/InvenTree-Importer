# Change proposal

## Problem and intended outcome

Mitch found these while using the app on 2026-11-23:

1. **A selected record loses its top border.** In Review › Records, the selected row of the record list ("GE S2CN1 axial diode") shows its accent border on three sides only.
2. **Blocks touch each other.**
   - On Review › Lots, the "Adding stock isn't available for this target…" banner sits directly on the Workspace/Table row.
   - The filter chips sit directly on the columns below them.
   - Other pages may have the same problem.
3. **"Batch context"** is a disclosure at the top of Review › Lots that isn't in the design. It should go.
4. **The agent profile notice is outdated.**
   - Processing opens with "Native agent profile · requires a saved default and supervised worker. Live provider access has not been qualified." (or "Synthetic processing fixture · …").
   - Each job card says "native agent · live provider not qualified".
   - VM agent sessions on the `shared-vm-agent/3` profile passed live requalification for Claude and Codex in #237.
5. **Brief, unreadable messages shift the page.**
   - Each time Review or Processing opens, a "Verifying current retained state; commands are disabled." or "Verifying current processing state. Cached results cannot authorize commands." banner pushes the page down for a fraction of a second, then disappears.
   - A full reload shows "Reading retained…" text instead.
   - About 20 screens each have their own one-off loading line.
6. **Status reads differently everywhere, and some of it contradicts itself** (Mitch's review of the running app, 2026-11-23; canvas page "Fixes: before and after", boards S5, S7 and O1–O5):
   - Times have no day ("23:56" on a days-old failure), and the drawer and the Agents page use different formats.
   - One finished session is "Finished", "Ready", "Done", "Ready for human review" or "Retained work · ready", depending on where it's shown. The masthead says "Needs attention · research" without saying what.
   - The batch header says "2 need you" while Processing's Needs you says "No open questions", because the card counts only agent questions.
   - The "need you" popover opens against the window's left edge, and its text wraps under its pill.
   - The Overview shows each step's state three times: the bar, its labels and Pipeline.
   - The Research step page says "3 ready" while its section says "1 ready", because its summary counts every step.
   - Developer-facing sentences ("One research lane per account…", "Waiting sessions hold no slot.", "Candidate assertions do not replace your selections.") stand under headings.

7. **Adding several files at once is hard** (Mitch, 2026-11-23). On a phone, Take photos opens the camera, one photo at a time, with no way to pick several from the library: the input sets `capture="environment"` (`components/media/MediaUpload.tsx`), which makes phones skip their picker sheet. Files can't be dropped or pasted onto Capture at all. The capture-grouped-evidence spec already says "A picker SHALL accept several files".

8. **The electronics animation can't be turned off** (Mitch, 2026-11-23) without also giving up the masthead style. Only the operating system's reduced-motion setting stills it.

9. **Settings › Agents asks for Save on every switch** (Mitch, 2026-11-23). Each subsection has its own Save bar (`components/settings/agents/SaveBar.tsx`), even Tag suggestions' single switch or the sessions stepper. The canvas design for this page shows none, only a page-level "✓ Saved". Capture's batch settings already autosave with `AutosaveStatus`.

10. **The provider settings don't match the design** (Mitch, 2026-11-23; canvas boards O9 "Provider cards…" and "Subscription sign-in in a dialog…"):
    - Each card's status is plain text that stays "Not checked" until a panel is opened and the management key pasted. The status needs the key because the browser asks the VM's management server directly (`components/agents/usePersonalClaudeCredential.ts`, `useChatGPTSignIn.ts`).
    - On/off settings are checkboxes, and the default provider is a pair of radio buttons, where the design has switches and a segmented control.
    - The Claude token is entered in an inline fieldset, and is saved without any check that Claude accepts it.
    - Each step's model is a provider select plus a hand-typed model ID, and each card's default model is a text field with suggestions.
    - Mitch asked for one dropdown with optional search listing both providers' models, using the same component as Capture's batch settings (`forms/SearchableReferencePicker.tsx`, built on react-select).

11. **Dropdowns are mixed** (Mitch, 2026-11-23). The app has 46 native select JSX sites across 28 components (excluding tests, fixtures and the generic `TextField` wrapper), including long InvenTree record lists (categories, locations, companies, templates) and lot or group pickers that grow with the batch. Only three fields use the searchable batch-settings picker.
12. **A false "unsaved edits" alarm follows every tab** (Mitch, 2026-11-24; canvas board FixReloadBanner). After answering a question or saving anything, the batch often shows a red "Saved values still unavailable. Local inputs remain unchanged." with "Discard local edits and load saved values", though nothing was edited and the next read succeeded. A live update cancels the reload's read in flight, and the reload counts the cancellation as a failure. Processing's "The command was saved, but current status is unavailable…" has the same cause.

The outcome:

- **Borders:** selected rows show their whole border.
- **Spacing:** pages space their sections evenly through one shared layout rule rather than per-component margins, checked on every page.
- **Removed:** Batch context and the outdated profile notices. The processing profile shows only in debug mode.
- **One loading and freshness pattern across the app** (option 2, chosen by Mitch):
  - a skeleton in the page's shape on a first visit;
  - cached data shown at once on a return, refreshed quietly in the background, with commands disabled and explained until the read lands;
  - a progress line that appears only if the refresh is noticeable, and a short status only if it is slow;
  - the existing "Status unavailable" banner only when a read fails;
  - cached reads kept across a page reload, for the browser tab's session.
- **Times:** every event time says which day, in one format, with the full time on hover.
- **States:** one set of state words with glyphs (Working, Waiting for you, Queued, Paused, Done, Failed, Not started), used by sessions, steps and the masthead. The masthead names what failed, and with nothing running says "no agents working" (it can't prove "all done").
- **Overview:** Needs you lists everything the header counts, tagged with its tab. A per-lot table with state pills replaces Pipeline, and the bar's step counts link to the step pages.
- **Step pages** count only their own step.
- **Capture:** several files at once from any source. On a phone, Take photos offers the camera and the library, with multi-select. On the phones tested (iOS Safari, Android Chrome), the system's own sheet is expected to offer both once `capture` is dropped; task 9.4 confirms it. On desktop, files can be dropped onto the evidence panel or a group, or pasted.
- **Appearance:** an "Animate the electronics" switch under the Masthead choice, on by default and stored on the device. Off shows a still frame in whichever masthead style is chosen.
- **Agent settings autosave:** switches, choices, selects and the stepper save on their own about 600 ms after the last change, with a quiet Saving… / Saved status. Text fields (Instructions, Part description style) keep a Save and Discard that appear only while they hold an edit.
- **Provider settings like the design:**
  - a status pill read automatically from a new read-only VM status that needs no key (option 1, chosen by Mitch);
  - switches for every on/off setting, and a segmented default provider;
  - one searchable model picker per step, listing Default and both providers' models; picking a model picks its provider. The cards' Default model uses the same picker, limited to that provider;
  - sign-in in a dialog. The Claude token dialog checks the token's shape and closes only once the VM confirms it is stored; the Codex dialog runs the ChatGPT device sign-in and closes when it's confirmed. A failed sign-in in a later session shows as a separate "Last session couldn't sign in" line.
- **Dropdowns:** records and growing lists use the searchable picker. Short fixed lists follow a soft guideline, chosen case by case: usually a segmented control for two to four short options, and a styled native select otherwise. The guideline is documented in the design system with examples.
- **Popovers** open at their control. **Explanations** move behind help buttons; developer-only text moves to debug mode.
- **Replaced reads:** a read a live update cancelled and replaced is not a failure, so nothing shows. A real failure with nothing edited shows an amber notice that clears itself; only real unsaved changes are named, kept and offered for discard.

The session-specific fixes from the same review (S1–S4, S6, S8 and O6: session rows, failure causes, links, the drawer header, the Agents filter, the activity feed and the message box) belong to `improve-agent-interaction`. They use this change's state words and times.

Option 3 is to let reads confirmed current by the live-update stream enable commands at once. Mitch asked for it as a separate follow-up change: [`trust-live-confirmed-reads`](../trust-live-confirmed-reads/).

## Change identity and linked items

- Change: `polish-ui-styling-and-loading`. Branches are `fix/polish-ui-styling-and-loading-<suffix>` or `feat/…`, with subjects `type(polish-ui-styling-and-loading): …`.
- **BI-020** (new): UI polish and calm loading.
- **BI-021** (new) is the option 3 follow-up, `trust-live-confirmed-reads`.
- BI-019 is the `improve-agent-interaction` plan, merged in #243.

## Current behavior and evidence

- **Border:**
  - `frontend/src/components/review/records/RecordsStage.tsx`: `RecordButton` sets `border-top-color: line`, then `&:first-of-type { border-top-color: transparent }`, so the list has no divider above its first row.
  - The shared `choice` style draws a selected row's border with `&[aria-current='true'] { border-color: accent }`.
  - The two selectors have equal specificity, and the `:first-of-type` rule comes later, so the first row loses its top border when selected.
- **Spacing:**
  - `ReviewWorkspace.tsx` renders its top blocks as siblings in a fragment.
  - `ScopeBar`, `ContextFold` and `Toolbar` each add their own `margin-bottom`. The stock `Banner` and `ReviewFilters` add none, so the banner touches the toolbar and the chips touch the grid.
  - `components/ui` has no layout primitive for page sections. The canvas lays pages out as a column with a 14 px gap.
- **Batch context:** `ReviewWorkspace.tsx` (`ContextFold` with `CaptureContextSummary`).
- **Profile notices:**
  - `ProcessingWorkspace.tsx` shows an info `Banner` driven by `snapshot.runner_status` (`native_unverified` or the synthetic fixture), plus "Closing this browser does not cancel saved work."
  - `ProcessingJobCard.tsx` has the "native agent · live provider not qualified" tag.
- **Loading and freshness:**
  - `queries/client.ts` creates the TanStack Query client (`@tanstack/react-query` 5.105.1); `App.tsx` reads bootstrap with `staleTime: Infinity`. The cache is memory-only.
  - Processing's commands need `waitingForRead`, which combines the observer's flags with a successful-read latch set inside its own query function (`ProcessingWorkspace.tsx:173,239`), but batch Pause and Resume bypass it and send no revision (`:218`). Review's manual workflow uses `waitingForFirstRead`, and acceptance needs `processingCurrent` (`isFetchedAfterMount`, no refetch error, not fetching, and a matching capture revision).
  - Those commands are disabled until then. The rule is deliberate, because cached data must never authorise a command, and it stays; this change also extends it to Pause and Resume.
  - `components/ui/Loading.tsx` has `Spinner` and `Skeleton`, used by a few components (`ProposedLotsGlance`, `StepPage`, `Tabs`, upload tiles) but by no page-level loading state.
  - 22 one-off status lines exist, such as "Loading saved settings…", "Reading records…", "Reading retained processing state…" and "Loading retained batches…".
- **Spec:** live-updates "Live unverifiable workspace state" covers failed reads, and stays.

## Scope and non-goals

In scope:

- The selected-row border fix, and a check of every list that collapses borders for the same pattern.
- A page-section stack primitive, used by every page's top level in place of ad hoc margins, then a visual pass over every page at desktop and phone width.
- Removing Batch context, the profile banner and the job card tag. Showing the processing profile in the debug panel.
- **A shared freshness layer:**
  - a `useFreshRead` hook, and a `ReadState` for skeleton, cached, refreshing, slow and failed;
  - a delayed page progress line;
  - command gating with a disabled reason;
  - skeletons per page;
  - display-only snapshots of allowlisted reads in session storage;
  - migration of Processing, Review, Changes, Records, Agents, Settings, Batches and the other one-off loading lines to it.
- Awaited reads that wait for the read replacing a cancelled one, and calm failure notices in the batch and Processing (item 12).

Non-goals:

- **Enabling commands from cached data** (option 3, `trust-live-confirmed-reads`).
- **New page designs.** Skeletons follow each page's existing layout.
- **Persisting** credentials, token commands or debug reads, and persistence in `localStorage` across browser sessions.

## Reuse and dependency assessment

| Option and relevant version | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence and date checked | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| TanStack Query's own state (`isFetchedAfterMount`, `isFetching`, `isPlaceholderData`), already installed at 5.105.1 | Already the source of every read. Its flags give cached, refreshing and failed with no new code | Each screen combines the flags differently today; that drift is the problem | `frontend/package.json`; [TanStack Query docs, useQuery](https://tanstack.com/query/v5/docs/framework/react/reference/useQuery), checked 2026-11-23 | None |
| `@tanstack/react-query-persist-client` with `createSyncStoragePersister` or `createAsyncStoragePersister` 5.105.1 (MIT) | Official persistence | Dehydrates whole queries (keys, hashes, metadata, payloads), so a query filter can't strip fields; restore holds queries until it finishes, while bootstrap itself is a query; the synchronous persister is deprecated upstream in favour of the async one | [persistQueryClient](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient), [createSyncStoragePersister deprecation](https://tanstack.com/query/latest/docs/framework/react/plugins/createSyncStoragePersister), `@tanstack/query-core` `hydration.ts`, checked 2026-11-23 | — |
| A small snapshot module over `sessionStorage` (recommended) | Stores only validated display projections under the app's own keys; restores as display-only content, never into the query cache; no dependency | Its own expiry, scope and quota handling (about 150 lines), and a projection per allowlisted read | `queries/` and the contracts' validators | Snapshot sizes, measured in task 4 |
| A loading-bar library (such as nprogress) | A ready bar | The bar is a few lines with the existing motion tokens; one more dependency and its CSS | — | — |
| A page stack primitive in `components/ui` (custom) | Matches the design system's page gap, and is one place to fix rhythm | Must be adopted by every page | `components/ui/primitives.tsx`; the canvas pages (`gap: 14px`) | None |

Two later additions need the same assessment:

| Option | Goal fit and strengths | Limitations and risks | Primary evidence | Still to prove |
| --- | --- | --- | --- | --- |
| **Save receipts.** Reuse the inbox's unique `idempotency_key` pattern (`agent_session_inbox`, `processing/grants.ts:32`) as a receipt table with an advisory scope lock (as `research/receipts.ts:198`) (recommended) | Proven in this codebase; atomic with the settings update; no dependency | Needs pruning with a watermark and a migration that every intake process must match | `processing/routes.ts:142`, `processing/currentness.ts` | The watermark's correctness under concurrent pruning (PG tier) |
| **Save receipts.** An HTTP idempotency middleware or library | Generic | Stores responses outside the settings transaction, so it can't prove a save didn't apply; another dependency | — | — |
| **Status path.** The existing pairing relay, extended with a worker-to-guest request (recommended, decided in task 12.1.1) | Reuses the paired, authenticated channel and its lifecycle | Carries guest-initiated connections today, one provider per turn (`relay.mjs:10–88`) | `tooling/deployment/bridge/relay.mjs` | Worker authentication, two-provider routing and timeout release |
| **Status path.** A new forwarded port or socket per provider | Simple to reach | A new listener outside the pairing's trust, and more deployment surface | `personal-claude.sh`, `personal-codex.sh` | Rejected unless 12.1.1 shows the relay can't carry it |

**Recommendation:**

- Build the freshness layer on TanStack Query's own state, with verification bound to the adopted result, and keep reload snapshots in a small module of the app's own. No new dependency.
- Use the existing `Skeleton` and `Spinner`, and add a `PageStack` primitive.
- Use no loading-bar or layout library.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `ui-design-system`: page sections are spaced by one rule; selected rows show their whole border; reads load without shifting the page; times say which day; one set of state words; explanations behind help buttons; popovers open at their control.
- `processing-workspace`: the Overview's Needs you, step bar and lot table ("Processing overview"); step pages count their own step.
- `header-workflow-status`: the masthead summary names what needs attention.
- `capture-grouped-evidence`: several photos from a phone in one go; drop or paste files to add evidence.
- `app-settings`: "Agent settings section" is modified (save as you change, provider status read automatically, dialogs, switches, segmented default provider, model picker). It is written on the synced requirement from `settings-debug-mode` and `simplify-vm-agent-web-and-setup`. Added: the electronics animation switch; saving as you change and text keeping an explicit Save; the read-only status and the separate sign-in failure line; controls matching the design; sign-in dialogs and dropping their work on close; the searchable model picker with its limits and exact IDs.
- `ui-design-system` (also): the searchable picker for records and growing lists, and short fixed choices following a guideline. "Masthead and electronics current in both themes" is modified so the animation switch can still the current.
- `shared-vm-execution`: a read-only provider sign-in status the server can read without the management key. It is added as its own requirements. "Personal Claude subscription token" is modified for the "Token saved" wording, and "ChatGPT sign-in for the runner" so closing the dialog completes or cancels a pending login.
- `live-updates`: commands wait quietly for a current read; cached reads survive a reload within the session; a replaced read is not a failure, and unavailable saved values are reported calmly. "Live unverifiable workspace state" is unchanged.

## Impact and dependencies

- **Frontend:** it touches:
  - `components/ui` (`PageStack`, `ReadState`, the progress line);
  - `queries/` (`useFreshRead`, the snapshot module);
  - every page's top-level layout and loading states;
  - `review/ReviewWorkspace.tsx` and `review/records/RecordsStage.tsx`;
  - `processing/ProcessingWorkspace.tsx` and `ProcessingJobCard.tsx`;
  - the debug panel;
  - a new `EventTime` component (the existing `RelativeTime` gives relative ages such as "5 minutes ago", not day labels) and one state vocabulary in `components/ui` and `header/workSegments.ts`;
  - `processing/ProcessingOverview.tsx`, the step pages, `batches/NeedsYouPanel.tsx` and the batch header's popover;
  - the masthead activity summary (`masthead/ActivityIndicator.tsx`);
  - `media/MediaUpload.tsx`, `media/MediaWorkspace.tsx` and `media/EvidenceGroupPanel.tsx` (drop and paste targets);
  - `settings/MastheadChoice.tsx`, a new device preference beside `theme/masthead-style.ts`, and `masthead/ElectronicsCurrent.tsx`;
  - `settings/agents/` (`SaveBar`, `useSubsectionForm`, `useSettingsSave`, `useDirtyForms` and each subsection form).
- **Dependencies:** none new.
- **Server, VM and contracts:** two PRs need them.
  - PR-F (task 11): agent settings saves gain a `save_id` and a bounded receipt table in the intake database, with its migration, runtime grants and contract change.
  - PR-G (task 12): per-provider status-only endpoints in the guest's credential processes, a worker-to-guest status path, a `credential_meta` side table, an intake read API and a contract.
  - Everything else is frontend only.
- **Coordination:**
  - `improve-agent-interaction` also edits `ProcessingWorkspace.tsx`, `ActivityPopover` and the session drawer. The first to merge rebases the other.
  - `trust-live-confirmed-reads` builds on this change's `useFreshRead`.
  - `improve-agent-interaction` uses this change's state words (its activity popover bar states match them) and `EventTime`. Its session fixes were handed to that change's session on 2026-11-23.

## Open decisions and assumptions

Decided by Mitch on 2026-11-23:

- Option 2 for loading.
- Option 3 as a separate follow-up.
- Remove Batch context and the profile notice.
- All 15 "Fixes: before and after" proposals approved, with the pipeline table using state pills and the skeleton animated (canvas v78). This change takes S5, S7, O1–O5 and O7.
- Evidence capture accepts several files at once from any source (added 2026-11-23).
- Provider status read automatically from a new read-only VM status (option 1 of 3, 2026-11-23); provider cards, switches, a segmented default provider and sign-in dialogs to match the design.
- Every dropdown audited against the dropdown guideline, which is a soft guideline for short fixed lists, not a rule. The design system documents it.
- One searchable model dropdown, in the batch settings' picker style (canvas v85, board O10). The step pickers list both providers. Reading "the default model field" as the step choices and the cards' default model is my interpretation, flagged to Mitch.
- Debounced autosave for non-text controls in Settings › Agents, with text fields keeping Save (added 2026-11-23; canvas board O8 "Agent settings save as they change").
- An on/off switch for the electronics animation that keeps the chosen masthead style (added 2026-11-23; canvas v80, Settings › Appearance).

Decided by Mitch on 2026-11-24 (board FixReloadBanner): a cancelled and replaced read waits up to 10 s for its replacement and shows nothing; a real failure is amber, with the time of the values shown; Discard appears only with real unsaved changes and names them; #254's rule that a cancelled read never verifies stays.

Assumptions:

- The progress line appears after 400 ms of refreshing, and the slow status after 3 s. Both are constants, tuned during the visual pass.
- Snapshots expire after 12 hours or when the app build changes, using a build identifier injected at build time.
- "Closing this browser does not cancel saved work" moves into the Processing page's help button rather than being dropped.
