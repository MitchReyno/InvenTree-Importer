# Design assessment

## Context and grounding

The change is frontend only, at moderate complexity: three small visual fixes and one shared loading pattern adopted across about 15 screens. No server, contract or data change.

| Area | Today | Evidence |
| --- | --- | --- |
| Selected row border | `RecordButton`'s `&:first-of-type { border-top-color: transparent }` ties in specificity with `choice`'s `&[aria-current='true'] { border-color }`, and wins by order | `components/review/records/RecordsStage.tsx` |
| Page spacing | Top-level blocks are fragment siblings with their own `margin-bottom`; some have none | `components/review/ReviewWorkspace.tsx` (`ScopeBar`, `ContextFold`, `Toolbar`; `Banner` and `ReviewFilters` without margins) |
| Profile notice | An info banner keyed on `snapshot.runner_status`, plus a job card tag | `ProcessingWorkspace.tsx`, `ProcessingJobCard.tsx` |
| Reads | TanStack Query 5.105.1, memory cache, `staleTime: Infinity` | `queries/client.ts`, `App.tsx` |
| Command gating | Processing `waitingForRead`; Review `waitingForFirstRead` and `processingCurrent` (fetched this mount, success, not fetching, revision matches) | `ProcessingWorkspace.tsx`, `review/ManualWorkspace.tsx` |
| Loading lines | 22 bespoke "Reading…/Loading…" lines; `Skeleton` and `Spinner` unused | `components/**`, `components/ui/Loading.tsx` |

## Goals and constraints

- Goals: the [proposal](proposal.md) outcomes and the `ui-design-system` and `live-updates` deltas.
- **Constraints:**
  - Keep the rule that only a read made since the page opened can enable commands; the `trust-live-confirmed-reads` follow-up revisits it.
  - Keep "Live unverifiable workspace state".
  - Keep unsaved input across refreshes.
  - Use tokens only (the literal-value lint).
  - Respect reduced motion.

## Decisions and alternatives

### A `PageStack` primitive owns page rhythm

- **The primitive:** `components/ui/primitives.tsx` gains `PageStack`, a flex column with the design system's page gap (the canvas `main` uses 14 px; task 2.1 maps it to the frontend space token). Every page's top level becomes a `PageStack`, and its children lose their outer `margin-bottom`. Sections inside cards keep their own spacing.
- **Absent sections:** conditional sections render nothing when absent, so no empty gap is left.
- **Checking it:** the review checklist names it, and the visual pass in task 2 checks each page.
- **Rejected:**
  - Adding the missing margins one by one. That is the pattern that drifted.
  - A lint rule against `margin-bottom` on page sections. It is too broad to state reliably; the primitive plus the pass is enough.

### Fix the border at the row, then sweep the pattern

- **The fix:** `RecordButton`'s first-row rule becomes `&:first-of-type:not([aria-current='true'])`, so the divider rule never applies to a selected row.
- **The sweep:** task 1 searches every list that shares dividers through `:first-of-type`, `& + &` or negative margins, and applies the same guard where a row can be selected.
- **Rejected:** raising the selected rule's specificity with `&&`. It works, but hides the ordering trap rather than removing it.

### Remove the outdated notices; keep the profile in debug

- **Removed:** the info banner and the job card tag go.
- **Kept:** the processing profile (`runner_status`) becomes a row in the page's debug panel.
- **Moved:** "Closing this browser does not cancel saved work" moves into the Processing page's help, beside its heading.
- **Batch context:** `ContextFold` and its `CaptureContextSummary` use in Review go. The component stays, because Capture's `CaptureEditor` also uses it.

### One freshness hook over TanStack Query

```text
useFreshRead(query, { current?: (data) => boolean }) →
  { data, phase: 'empty' | 'cached' | 'refreshing' | 'current' | 'failed',
    commandsReady: boolean, reason?: 'Updating…' | 'Status unavailable' }
```

- **Phases:**
  - `empty`: no data.
  - `cached`: data, not yet read since mount.
  - `refreshing`: a read since mount is in flight over data.
  - `current`: read since mount, success, not fetching, scope unchanged, and `current(data)` holds (Review passes its capture-revision check).
  - `failed`: `isError`, or fetch paused.
- **Gating:** `commandsReady` is true only in `current`. That is today's rule in one place, replacing `waitingForRead`, `waitingForFirstRead` and `processingCurrent`.
- **`ReadState`:** renders the page's skeleton in `empty`, the children otherwise, and the existing failure banner in `failed`. It also reports `cached` and `refreshing` to a page-level `RefreshSignal` context.
- **`RefreshSignal`:** mounted by `App`, it starts a 400 ms timer when any registered read begins refreshing. When the timer fires it shows `RefreshLine`: a 2 px fixed bar under the masthead using the motion tokens, still under reduced motion, with a visually hidden "Updating" status. At 3 s it shows "Updating…" in the page header's status slot, which is absolutely positioned so nothing moves. Both clear when no registered read is refreshing.
- **Disabled reasons:** `Button` already takes a `disabledReason`, which it shows beside the disabled button; that would itself shift the layout during a refresh. A `reasonDisplay: 'quiet'` option keeps the reason as the button's description and tooltip only (`aria-describedby` to a visually hidden element, plus `title`). Screens pass the hook's `reason` quietly; persistent reasons keep the visible form.
- **Skeletons:** each page gets one, built from `Skeleton` blocks in its grid. They live next to the page component.
- **Rejected:**
  - React Suspense with `useSuspenseQuery`. It would restructure every screen's error and draft handling, and doesn't solve the command gate.
  - A whole-page overlay spinner. It hides cached data that is useful to read while refreshing.

### Persist allowed reads to session storage

- **Mounting:** `queries/client.ts` wraps the client with `PersistQueryClientProvider` and `createSyncStoragePersister({ storage: sessionStorage })` from `@tanstack/react-query-persist-client` and `@tanstack/query-sync-storage-persister` 5.105.1, pinned to the installed `@tanstack/react-query`.
- **What persists:** `shouldDehydrateQuery` keeps only successful queries whose `meta.persist` is true. The batch, Processing, Review, Records, Changes, Agents and settings reads opt in. Debug reads, credentials (token commands aren't queries) and media blobs don't.
- **Expiry:**
  - `maxAge` is 12 hours;
  - `buster` is a build identifier injected at build time (a Vite `define` of the commit and build time), so a new build discards the cache;
  - query keys already include the scope (`serverQueryKey(scope, …)`), and a scope change also clears the persisted cache.
- **Restore:** while restoring (`useIsRestoring`), pages show their skeleton. Restored data counts as `cached`, never `current`, because `isFetchedAfterMount` is false, so the gate is unchanged.
- **Size:** reads over 1 MB serialised are not persisted. A `QuotaExceededError` empties the persisted cache and is logged in debug info, never shown as an error.
- **Rejected:**
  - `localStorage`. It outlives the tab, so stale inventory data could linger across days.
  - IndexedDB. Async restore adds complexity for no benefit at these sizes.

### One state vocabulary and one time format

- **States:**
  - `components/ui` gains a `WorkState` type (`working | waiting_for_you | queued | paused | done | failed | not_started`) and a `StatePill` that draws its word and glyph.
  - `header/workSegments.ts` maps retained job, step and session states onto it in one function, replacing `stateWords` and the local maps in Processing, the step pages, the session list and the masthead.
  - Lot review states ("Ready for review") keep their own `RecordStatePill`.
  - `improve-agent-interaction`'s activity popover bar uses the same type.
- **Masthead summary:** it reads failed and waiting steps from the header work read (already loaded). It says "‹Step› failed · N lots", "‹Step› waiting for you · N", or "‹Batch› · all done", and never "Retained work".
- **Times:**
  - A new `EventTime` component formats with `Intl.DateTimeFormat`: "Today HH:MM", "Yesterday HH:MM", "Fri 20 Nov · HH:MM", and the year outside the current one.
  - It respects the locale's hour cycle, and gives the full date and seconds in `title` and in the `<time dateTime>`.
  - `RelativeTime` stays for relative ages.
  - Every event time (session lists, drawer timelines, Recent activity, Agents) uses `EventTime`.
- **Rejected:** keeping per-screen words with a glossary. The inconsistency is the problem.

### Overview and step page counts

- **Needs you:** the Overview's card renders the batch attention read (`BatchAttentionDto`, already read for the header). Agent questions come first and oldest first, then the other tabs' items tagged with their tab, each linking where the header popover links. It is the same list as the popover, through one shared component.
- **Lot table:** Pipeline becomes a table with one row per lot and Research, Images and Inventory columns of `StatePill`s, each linking to the step page with that lot selected. Examine is batch-wide, so it lives only in the bar. The bar's step labels show counts ("Research · 1 of 1") and link to the step pages.
- **Step counts:** the step page summary uses that step's own counts (`attention.processing.steps[step]`), so the Research page says "Research · 1 lot · 1 done".
- **No server change:** every count and list comes from reads the page already makes.

### Help buttons and popover placement

- **Help buttons:** standing explanations ("One research lane per account…", "Waiting sessions hold no slot.", "Candidate assertions do not replace your selections." and others the task 8 sweep finds) move behind the existing `HelpButton`, reworded plainly. Developer-only facts move into `DebugDetails`.
- **Popover placement:** popovers open anchored to their trigger. The batch header's "need you" popover uses the shared `Popover` placement (aligned to the trigger's edge, flipped or shifted to stay in the window), not a fixed left position. Rows with a leading pill use a grid with the pill in its own column.

### Several files from any source

- **Phone picker:**
  - The photos input drops `capture="environment"`. Without it, iOS and Android show their own sheet (take a photo, the photo library, files), and the library allows multi-select. The input keeps `multiple`.
  - **Rejected:** a separate "Use camera" control beside it. It adds a button for what the system sheet already offers; it can be added later if the camera shortcut is missed.
- **Drop and paste:**
  - The evidence panel and each group become drop targets: `dragover`/`drop` with `dataTransfer.files`, highlighting the target while files hover.
  - Paste is a `paste` listener on Capture that ignores events from text fields and note editors, and takes `clipboardData.files`.
  - Each file goes to the existing `queue.add(files, kind, groupId)`, with its kind from its type (image to photos, PDF to document). Unsupported types become "Not added" tiles, as picked files do.
  - When media is disabled or the batch is archived, drop and paste refuse with the same reason as the disabled actions. `DisabledFeature` already stops drops on wrapped controls.
- **Rejected:** a drag-and-drop library (react-dropzone). Native events cover the need in about 50 lines, with no extra dependency.

### The electronics animation switch

- **The preference:** a new device preference, `bench-intake.masthead-motion` (`on` or `off`, default `on`), with a controller like `masthead-style.ts`. It reads and writes through `theme/device-preference.ts`, and sets `data-masthead-motion` on the root before first paint from the same inline script.
- **The scene:** `ElectronicsCurrent` passes `reducedMotion: prefersReducedMotion() || motion === 'off'` to the scene. That mode already renders a single still frame with no loop. Changing the switch restarts the scene, keyed by the value as the masthead style already is, so it takes effect at once.
- **Pointer:** pointer reactions are skipped when still.
- **What stays the same:** the masthead style, its ground and masks are untouched.
- **Rejected:** hiding the parts when off. Mitch asked to keep the chosen appearance and only stop the movement.

### Agent settings autosave

- **What autosaves, what doesn't:** `useSubsectionForm` gains an `autosave` mode for non-text fields. Text fields keep the current Save and Discard flow (`SaveBar`), shown only while that field holds an edit.
  - **Mixed subsections:** none remain once task 13 replaces the step model text fields with `ModelPicker`, whose picks autosave. Until then, the step model fields keep their Save.
- **Debounce and saving:**
  - A change starts a 600 ms debounce; further changes restart it, so stepper clicks coalesce.
  - The save sends the loaded values of every field the form doesn't own, under the loaded revision, through the existing `useSettingsSave`.
  - The page's one-save-at-a-time lock (`PageSave`) queues an autosave behind a running save.
  - An autosave never includes another field's unsaved text draft.
- **Status:** each subsection heading shows `AutosaveStatus` (Saving…, Saved, a failure with Try again, a conflict with Reload). A failure keeps the control's value.
- **Leaving:** a pending debounce is flushed at once when the section unmounts or navigation is requested. The navigation guard holds while a save is pending or failed (`useDirtyForms`).
- **Invalid changes:** refusals move to the control. Turning off the last provider is refused at its switch ("At least one provider stays on") and nothing is sent. Turning a provider off saves at once, together with the reset of its steps to Default, and the existing note says which steps moved.
- **Unchanged:** credentials stay write-only, in their own panels and commands.
- **Rejected:**
  - Autosaving text on a debounce. It would save half-typed instructions mid-thought.
  - A single page-level Save. It's the pattern being removed.

### Read-only provider status and sign-in dialogs

- **Why the status needs new plumbing:** today the browser calls the guest's management server (`agents/shared-vm/credential-http.ts`), and every action, even `status`, requires the management key. That key authorises credential changes and stays browser-held, so it can't back an automatic check.
- **Guest:** the guest answers a new `provider_status` question on the coordinator's existing paired channel (`agents/shared-vm/coordinator.ts`, `frames.ts`, `guest-main.ts`):
  - Claude: `configured` and `revision`, from `claude-credential.ts`'s store, plus the save time;
  - Codex: `signed_in`, from `CodexAccount`'s `account/read` without refreshing.
  - It returns no token, account email or key. No management-key endpoint changes.
- **Intake server:**
  - `GET /api/v1/agents/provider-status` (read authority, short cache) combines the guest answer with the latest session failure per provider. An `agent_login_required` or authentication failure after the token's save time reads as "Token refused".
  - An unpaired or stopped VM reads as "Can't reach the agent VM", never "Not signed in".
  - A contract `ProviderStatus` sits in `contracts/src/agents.ts`.
- **Token check before saving:**
  - The dialog first checks the token's shape in the browser: Claude setup tokens start `sk-ant-oat01-`, and API keys (`sk-ant-api…`) are named as such.
  - Save then sends the existing `save` action with the management key. If the CLI in the guest can confirm a token cheaply, the guest checks the candidate before storing it, so a refused token leaves the saved one in place. Task 12.1 settles whether such a check exists.
  - Without one, Save confirms only that the token was stored, and the status pill reports a refusal after the first session.
- **Cards and dialogs:**
  - `ProviderCard` shows `StatePill` with the status, and a "Check again" action.
  - `PersonalClaudeCredential` and `ChatGPTSignIn` move into `Dialog`s opened from "Subscription token…" and "Sign in to ChatGPT…". The management key is a field in each dialog, held only while it's open.
  - The Claude dialog's Save stays disabled while a check runs, and closes only on a confirmed save. Close and Cancel discard. The Codex dialog closes itself once the account is confirmed.
- **Model picker:**
  - `forms/SearchableReferencePicker.tsx` is specialised to InvenTree records (ranking, catalogue coverage, `#pk` labels). Its react-select base (styles, input handling, keyboard and accessible labelling) moves into a shared `SearchablePicker`. `SearchableReferencePicker` keeps its record logic on top, and a new `ModelPicker` uses the same base.
  - **Options:** Default ("Default · ‹model›"), then one group per provider from `AGENT_MODEL_SUGGESTIONS`, with the labels and IDs searchable. A provider that's off shows its models disabled, with the reason.
  - **Exact IDs:** a typed value that isn't listed adds "Use “…” as a ‹Provider› model ID" once per provider that's on, checked with the existing `validModel`.
  - **Saving:** picking an option sets both `provider` and `model` for the step, and autosaves as a non-text control (task 11). The cards' Default model uses `ModelPicker` limited to their provider.
  - **Rejected:** a native `<select>` with optgroups. It has no search and no exact IDs.
- **Controls:** every on/off checkbox in Settings › Agents becomes the UI kit's `Switch`, and the default provider becomes a `SegmentedControl`.
- **Rejected options:**
  - Remembering the management key on the device: it would hand credential-change authority to anyone using the browser.
  - Inferring status only from the last session: it's stale, and says nothing before the first session.

### Choosing a dropdown control

- **Searchable picker:** records (category, location, company, Part, parameter template, supplier), lists that grow with the batch (lots, groups, observations as move targets), and anything taking a typed exact value. Built on task 13's `SearchablePicker`, with record fields keeping `SearchableReferencePicker`.
- **Short fixed lists, case by case:**
  - A `SegmentedControl` usually suits two to four short options that fit one line at phone width. Every option stays visible, one tap switches, and it matches Sign-in and Default provider.
  - A styled native `Select` usually suits longer fixed lists, or tight spaces such as table cells and bulk bars. On a phone it opens the system picker, and it's accessible by default.
  - This is guidance, not a rule (Mitch, 2026-11-23); the screen decides.
- **The audit:** task 14 lists all 43 selects with their option count and kind, proposes each one's control in the PR, and changes them. The candidates for the searchable picker include `PartCreationFields`, `TemplateEditor`, `ParameterEditor`, `CompanyEditor`, `ProposedCompanyEditor`, `SourcingEditor`, `LocationDetail`, `AssignedLocationField`, `PartDecision`, `ObservationMove`, `RestructureDialog` and `MediaWorkspace`'s group choice. The final list comes from the audit.
- **Design system:** the Bench Intake Design System gains a "Choosing a dropdown" guide with the three controls and examples, plus the `SearchablePicker` component. The canvas board O11 shows it.
- **Rejected:** converting every select to the searchable picker. It's weaker on phones and slower for two or three options.

## State, authority and failure behavior

| Case | Outcome |
| --- | --- |
| Return to a tab, refresh under 400 ms | Cached page, no visible indicator; commands disabled until current |
| Refresh 400 ms–3 s | Progress line only |
| Refresh over 3 s | Progress line, plus "Updating…" in the page header |
| Refresh fails | Existing "Status unavailable…" banner (unchanged requirement) |
| Reload | Persisted data as `cached`, refreshed; commands gated |
| Scope or build change | Persisted cache dropped; skeleton |
| Typed input during refresh | Kept; the command explains why it is disabled |

Authority is unchanged: no command is enabled by cached or persisted data.

## Verification strategy

- **Provider status (intake PG and process tiers):** the guest status frame with a fake guest; the read API's combinations (saved and working, saved then refused, signed out, VM unreachable); no secret in any response; the management-key endpoints unchanged.
- **Dropdowns:** each converted field keeps its value, validation and form wiring (its existing tests, updated for the control); a picker per kind is tested for search and keyboard; captures at 1440 and 390 px for every changed field.
- **Unit (frontend), provider cards and dialogs:** the model picker (search by name and ID, grouping, a provider that's off disabled with its reason, exact IDs per provider and their validation, a pick setting both provider and model and autosaving, the record picker unchanged on the shared base); the pill states, Check again, the switches, the segmented default provider, the dialog shape checks, Save staying disabled while checking, failures keeping the dialog open, and the Codex dialog closing on confirmation.
- **Manual (provider status):** on the real VM, Settings shows Signed in with no key typed; a revoked token shows Token refused after a session.
- **Unit (frontend), agent settings autosave:** under fake timers, debounce coalescing, the revision sent, the `PageSave` queueing, flush on leave, a failure keeping the value with Try again, a conflict with Reload, the last-provider refusal, the provider-off reset, and text fields keeping Save without autosaving.
- **Unit (frontend), animation switch:** the default, storage failure and an unknown stored value; the scene started still when off or under reduced motion; a restart on change; each masthead style kept.
- **Unit (frontend), capture:** the photos input has `multiple` and no `capture`; a drop on a group queues every file into that group with the right kinds; a paste outside text fields queues images, and inside a note it doesn't; disabled media refuses both.
- **Manual (capture):** picking several photos from the library on an iPhone and an Android phone, and dropping files on desktop Chrome and Safari, recorded in the PR.
- **Unit (frontend), the review fixes:**
  - `EventTime` for today, yesterday, this year and an earlier year, under 12- and 24-hour locales, with the `title`;
  - the state mapping for every retained state;
  - the masthead summary wording;
  - the Overview's Needs you list against the attention read;
  - the lot table's pills and links, and the step page's own counts;
  - popover placement near the window's edges.
- **Unit (frontend):**
  - `useFreshRead` phases and `commandsReady` under fake timers and a fake query client, including scope change and the `current` predicate;
  - `RefreshSignal` delays (400 ms, 3 s), reduced motion and the announced status;
  - `Button`'s `disabledReason`;
  - persistence round-trip with jsdom `sessionStorage`, covering `meta.persist`, the buster, `maxAge`, the size cap and quota failure;
  - `RecordsStage`'s first-row border, by reading the generated rule for a selected first row from the injected style sheet (there is no `jest-styled-components`), with the visual capture as the main check;
  - Processing and Review gate tests carried over to the hook.
- **Visual:** Playwright captures of the fixture pages (`tests/fixtures/*.html`) and the dev app at 1440 px and 390 px, before and after each PR, attached to the PR. There is no committed screenshot baseline, because evidence goes on the PR.
- **Manual:** a demo video of returning to Review and Processing with no banner, a throttled slow refresh, a reload, and the record border.

## Migration, rollout and recovery

- **Rollout:** no data migration. A new build busts any persisted cache. Rollback removes the persister, and sessions restart with a memory cache.
- **Lockfile:** the two packages change the lockfile, so worktrees install rather than symlink `node_modules`.
- **Build identifier:** the Vite `define` adds one build constant; the Dev mode popover's build summary can show it too.

## Risks and open decisions

- **Skeletons can drift from the page layout.** Mitigation: each skeleton sits beside its page and is part of the visual pass.
- **Persisted cache size.** Mitigation: the 1 MB cap per read and quota handling; actual sizes are measured in task 4.
- **Conflicts with `improve-agent-interaction`'s Processing and drawer edits.** Mitigation: whichever merges second rebases. Its activity popover and session rows take `WorkState` and `EventTime` from here, so whichever lands first defines them and the other adopts them.
- **Renaming states touches many tests.** Mitigation: one mapping function, with the old words removed in one PR.
- Open decisions: none.
