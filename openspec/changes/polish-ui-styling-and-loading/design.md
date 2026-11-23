# Design assessment

## Context and grounding

The change is mostly frontend, and large: visual fixes, one shared loading and freshness pattern adopted across about 15 screens, Settings › Agents rework, and a dropdown sweep. Task 12 alone adds server, VM guest and contract work (the read-only provider status). There is no data migration.

| Area | Today | Evidence |
| --- | --- | --- |
| Selected row border | `RecordButton`'s `&:first-of-type { border-top-color: transparent }` ties in specificity with `choice`'s `&[aria-current='true'] { border-color }`, and wins by order | `components/review/records/RecordsStage.tsx` |
| Page spacing | Top-level blocks are fragment siblings with their own `margin-bottom`; some have none | `components/review/ReviewWorkspace.tsx` (`ScopeBar`, `ContextFold`, `Toolbar`; `Banner` and `ReviewFilters` without margins) |
| Profile notice | An info banner keyed on `snapshot.runner_status`, plus a job card tag | `ProcessingWorkspace.tsx`, `ProcessingJobCard.tsx` |
| Reads | TanStack Query 5.105.1, memory cache, `staleTime: Infinity` | `queries/client.ts`, `App.tsx` |
| Command gating | Processing commands use `waitingForRead`, from a successful-read latch set inside its own `queryFn` (`successfulRead`), but Pause and Resume are built from `liveRead(snapshotQuery)` without it and send no revision (`AgentPauseUpdate`); Review's manual workflow uses `waitingForFirstRead` (`isFetchedAfterMount`); acceptance, computed in `ManualWorkspace`, uses `processingCurrent` (fetched this mount, success, no refetch error, not fetching, capture revision matches). Processing, Manual Review and Records share the Processing query key | `ProcessingWorkspace.tsx:169–243`, `review/ManualWorkspace.tsx:89–102,325–337`, `review/records/RecordsStage.tsx:127–132`, `contracts/src/agents.ts:120–122` |
| Loading lines | 22 bespoke "Reading…/Loading…" lines; `Skeleton` and `Spinner` exist and are used by a few components (`ProposedLotsGlance`, `StepPage`, `Tabs`, upload tiles) but by no page-level loading state | `components/**`, `components/ui/Loading.tsx` |

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
useFreshRead(query, { current?: (data) => boolean, restored?: Snapshot }) →
  { data, phase: 'empty' | 'cached' | 'refreshing' | 'current' | 'failed',
    verified: boolean, reason?: 'Updating…' | 'Status unavailable' }
```

- **Verification bound to the cache update, not the data object:** object identity can't tell reads apart, because structural sharing can keep the old object for equal data, and an equal `setQueryData` can keep a verified one.
  - A `verifiedReads` registry subscribes to the query cache and records, per query hash, the last update.
    - An `updated` event with a non-manual `success` action, from a fetch whose request started after the observer's mount, marks it verified, with that request's start time. The query function records request start times per query hash.
    - A manual `success` (any `setQueryData`) clears it, whatever the data, and so do an error, a cancelled fetch, a paused fetch and a scope change.
  - Every observer of a shared key reads the same registry entry, so a joined in-flight fetch verifies them all only if its request started after each one's mount.
  - A restored snapshot is never in the cache, so it never verifies.
- **Phases:**
  - `empty`: no data and no restored snapshot;
  - `cached`: data or a restored snapshot, not verified;
  - `refreshing`: a fetch in flight (before or after verification);
  - `current`: verified, and `current(data)` holds;
  - `failed`: `isError`, or a paused fetch.
- **Gating:** each screen keeps its own command conditions, built on `verified` rather than `isFetchedAfterMount`:
  - **Processing:** queue, cancel and answer need `verified` once, and stay available through later background refreshes, as today.
  - **Pause and Resume** send no revision, so they need a settled verified read: verified, and not refreshing after a relevant invalidation. This is rechecked at dispatch. It applies to every surface that sends them: Processing (PR-B), and the Agents page's batch and global controls and Settings › Agents' Pause all (PR-C).
  - **Review's manual workflow:** needs `verified` once, then stays available through refreshes.
  - **Review acceptance:** computed in `ManualWorkspace`, it keeps its stricter check (not fetching, no refetch error, capture revision matches) through the `current` predicate, so it waits during a refresh.
  - Commands that carry an expected revision keep sending it, and draft checks are unchanged.
- **`ReadState`:** renders the page's skeleton in `empty`, the children otherwise, and the existing failure banner in `failed`. It reports unverified and refreshing reads to a page-level `RefreshSignal` context.
- **`RefreshSignal`:** mounted by `App`, it starts a 400 ms timer when any registered read begins refreshing. When the timer fires it shows `RefreshLine`: a 2 px fixed bar under the masthead using the motion tokens, still under reduced motion, with a visually hidden "Updating" status. At 3 s it shows "Updating…" in the page header's status slot, which is absolutely positioned so nothing moves. Both clear when no registered read is refreshing.
- **Disabled reasons:** `Button` already takes a `disabledReason`, which it shows beside the disabled button; that would itself shift the layout during a refresh.
  - A `reasonDisplay: 'quiet'` option renders the command with `aria-disabled="true"` rather than `disabled`, so it stays focusable, and links its reason through `aria-describedby` to a visually hidden element. The same reason shows as a tooltip on hover and on keyboard focus. Clicks and Enter do nothing while it is `aria-disabled`, as `DisabledFeature` already does.
  - Persistent reasons keep the visible form.
- **Skeletons:** each page gets one, built from `Skeleton` blocks in its grid. They live next to the page component.
- **Rejected:**
  - React Suspense with `useSuspenseQuery`. It would restructure every screen's error and draft handling, and doesn't solve the command gate.
  - A whole-page overlay spinner. It hides cached data that is useful to read while refreshing.

### Display snapshots in session storage

- **No persister:** TanStack's persister dehydrates whole queries (keys, hashes, metadata and payloads), and its synchronous storage persister is deprecated upstream. A filter can't strip fields, and its restore would hold queries until bootstrap, which `App` itself reads. The app writes its own small snapshots instead, with no new dependency.
- **What is stored:** a `snapshots` module keeps one entry per allowlisted read, keyed by its own stable name, resource ID and a scope hash (`processing:<batchId>`, `review-workspace:<batchId>`, `batch:<batchId>`, `records:<batchId>`). It never stores TanStack keys or metadata. Each entry holds:
  - a display projection, a typed `…Snapshot` DTO validated with the contracts on write and on read;
  - the app build, the actor, target and target context, and the time it was written.
- **The first allowlist:** Processing, the Review workspace, the batch header and Records, each with an explicit projection that keeps only what its page renders. Never stored:
  - bootstrap and its CSRF token, credentials and sign-in payloads;
  - the Agents list and session identifiers;
  - media bytes, previews, and URLs or keys that carry credentials;
  - drafts, command intent, mutations and debug reads.

  A test writes sentinel values into every excluded field, key and nested DTO and asserts that none reach `sessionStorage`.
- **Writing:** a snapshot is written after each verified read of an allowlisted resource, so query `gcTime` doesn't matter. Writes are throttled to one per resource per second.
- **Restoring:** `useFreshRead` takes a `restored` snapshot and shows it, while the query has no data, as display-only content. It is never put into the query cache, so it can't verify. A page renders a snapshot only after the app's fresh bootstrap confirms the same actor, target and target context, and only for its own resource. Otherwise the snapshot is deleted unread.
- **Lifetime:**
  - entries expire after 12 hours, or when the build identifier (a Vite `define` of the commit and build time) differs;
  - a scope change deletes every snapshot of the old scope before the new scope's pages render;
  - pending throttled writes for the old scope are dropped.
- **Size:** a projection over 1 MB serialised isn't stored. A `QuotaExceededError` deletes all snapshots and is logged in debug info, never shown as an error.
- **Rejected:**
  - `@tanstack/react-query-persist-client` with `createSyncStoragePersister` or `createAsyncStoragePersister`: whole-query dehydration and restore ordering, above.
  - `localStorage`. It outlives the tab, so stale inventory data could linger across days.

### One state vocabulary and one time format

- **States:**
  - `components/ui` gains a `WorkState` type (`working | waiting_for_you | queued | paused | done | failed | not_started`) and a `StatePill` that draws its word and glyph.
  - `header/workSegments.ts` maps retained job, step and session states onto it in one function, replacing `stateWords` and the local maps in Processing, the step pages, the session list and the masthead.
  - Lot review states ("Ready for review") keep their own `RecordStatePill`.
  - `improve-agent-interaction`'s activity popover bar uses the same type.
- **Masthead summary:** it reads failed and waiting steps from the header work read (already loaded).
  - Failures lead: "‹Step› failed" with a count of failed jobs, not lots, because work items don't carry their subject. Then "‹Step› waiting for you · N".
  - With nothing working, waiting or failed, and a fresh, complete active-session read showing no session holding a lane (`occupies_lane`, as the masthead checks today), it says "‹Batch› · no agents working". A cancelled or superseded session still holding a lane keeps it showing as working. The header's counts describe jobs that exist, not which steps or lots still need work, so the app can't prove "all done" and never says it.
  - A stale, truncated or unavailable read says "Updating…" or "Status unavailable". It never says "Retained work".
  - S7's "all done" canvas example is replaced by "no agents working" for this reason.
- **Times:**
  - A new `EventTime` component formats with `Intl.DateTimeFormat`: "Today HH:MM", "Yesterday HH:MM", "Fri 20 Nov · HH:MM", and the year outside the current one.
  - It respects the locale's hour cycle, and gives the full date and seconds in `title` and in the `<time dateTime>`.
  - `RelativeTime` stays for relative ages.
  - Every event time (session lists, drawer timelines, Recent activity, Agents) uses `EventTime`.
- **Rejected:** keeping per-screen words with a glossary. The inconsistency is the problem.

### Overview and step page counts

- **Needs you:** the Overview's card renders the batch attention read (`BatchAttentionDto`, already read for the header), using `NeedsYouPanel`'s list (shared, not copied), including its existing "Showing the first N" disclosure (`NeedsYouPanel.tsx:135–137`). The read has `items_truncated` but no total. Agent questions come first and oldest first, then the other tabs' items tagged with their tab.
- **Lot table:** Pipeline becomes a table with one row per live lot, and Research, Images and Inventory columns of `StatePill`s from that lot's jobs.
  - **Rows:** jobs whose subject is a Part rather than a lot appear under their Part's lots. Batch-level Examine lives only in the bar.
  - **Links:** each pill links to its step page with that lot in focus. That needs a new `lot` query parameter on Processing step routes (`navigation/batch-route.ts`, whose trailing segment is a question ID today), which the step page reads on a direct load to scroll to and highlight the lot. A lot with no output for that step gets a short "No ‹step› output for this lot yet" entry at the top, with its state. Output shared through a Part is shown under the Part with the lot highlighted.
  - **Bar labels:** they show counts ("Research · 1 of 1") and link to the step pages.
- **Step counts:** the summary uses the same filtering as the step's own section (`StepPage.tsx:22–47`). It counts distinct lots covered by that step's jobs, and its sessions, not the attention read's job counts. Examine counts lots formed. The duplicate outer summary in `ProcessingWorkspace.tsx` is removed.
- **No server change:** every count and list comes from reads the page already makes.

### Help buttons and popover placement

- **Help buttons:** standing explanations ("One research lane per account…", "Waiting sessions hold no slot.", "Candidate assertions do not replace your selections." and others the task 8 sweep finds) move behind the existing `HelpButton`, reworded plainly. Developer-only facts move into `DebugDetails`.
- **Popover placement:** the batch header's "need you" popover already uses the shared `Popover` (`NeedsYouPanel.tsx:72–92`, `ui/Popover.tsx:40–52`), but opens against the window's left edge. Task 8 reproduces the geometry (the trigger's position inside the header, and the popover's alignment and clamping) and corrects it in `Popover`, so every popover opens aligned to its trigger and stays in the window. Rows with a leading pill use a grid with the pill in its own column.

### Several files from any source

- **Phone picker:**
  - The photos input drops `capture="environment"`. Without it, iOS Safari and Android Chrome show their own sheet (take a photo, the photo library, files), and the library allows multi-select. The input keeps `multiple` and its `accept` of JPEG and PNG.
  - The promise is bounded to the combinations checked in task 9.4, iOS Safari and Android Chrome. If removing `capture` loses the camera option on either, a separate "Take a photo" control with `capture` is added beside "Choose photos" in the same task.
- **Drop and paste:**
  - The evidence panel and each group become drop targets: `dragover`/`drop` with `dataTransfer.files`, highlighting the target while files hover. A drop on a group is handled there once and doesn't also reach the panel.
  - Paste is a `paste` listener on Capture that ignores events from text fields and note editors, and takes `clipboardData.files`.
- **Formats:** files are typed by the upload queue's existing validator (`useUploadQueue.ts:68–69`). JPEG and PNG become photos and PDF becomes a document; anything else becomes a "Not added" tile with the reason, as a picked file does.
- **One operation:**
  - `useUploadQueue` gains a mixed-kind `addMixed(files, groupId)` that types each file under one shared pick identity and count, so a mixed drop shows "Uploading 2 of 4" as one operation.
  - Today `add` creates one pick per call (`useUploadQueue.ts:74–85,286–306`), so calling it per kind would split the progress.
- **Refusals:**
  - Starting a pick, a drop or a paste shares one gate, extracted from `MediaWorkspace` (`:189–194,442–449`). It returns the refusal reason, not just a boolean: media disabled, the batch archived, media state not current, a command pending, or a conflicting draft open.
  - The existing behaviour on returning from the native picker, which deliberately doesn't re-check that transient gate, is kept unchanged.
- **Rejected:** a drag-and-drop library (react-dropzone). Native events cover the need in about 50 lines, with no extra dependency.

### The electronics animation switch

- **The preference:** a new device preference, `bench-intake.masthead-motion` (`on` or `off`, default `on`), with a controller like `masthead-style.ts`. It reads and writes through `theme/device-preference.ts`, and sets `data-masthead-motion` on the root before first paint from the same inline script.
- **Two separate inputs:** the OS reduced-motion setting and the motion preference stay separate. The scene is still constructed with `reducedMotion` from the OS only. Today `startLoop()` refuses to run on a scene built with `reducedMotion: true` (`electronics-current/scene.ts`), so folding the preference into that flag would stop a later "on" from working.
- **Pause and resume:** the scene controller gains `pause()` and `resume()`.
  - Turning the switch off pauses: the loop stops and the parts stay where they are, with pointer stir, pulses and display cycling stopped.
  - Turning it on resumes from there, unless the OS asks for reduced motion.
  - A page loaded with the switch off builds the scene normally, renders one frame, then pauses, so turning it on later works without recreating the scene. Recreating it would reset time and re-randomise the parts.
  - A theme change while paused redraws the still frame in the new palette.
- **What stays the same:** the masthead style, its ground and masks are untouched.
- **Spec follow-up:** once `masthead-appearance-options` syncs, its masthead requirement (`ui-design-system`, "Masthead and electronics current in both themes") is updated in full so pointer stir, pulses and display cycling are qualified by the switch.
- **Rejected:** hiding the parts when off. Mitch asked to keep the chosen appearance and only stop the movement.

### Agent settings autosave

- **What autosaves, what doesn't:** `useSubsectionForm` gains an `autosave` mode for non-text fields. Text fields (Instructions, Part description style) keep the current Save and Discard flow (`SaveBar`), shown only while the field holds an edit.
- **Field ownership:** each autosave owns only the fields it changed.
  - Providers and steps stays one form until task 13 replaces the free-text step and default models with `ModelPicker`. In the interim, its switches, sign-in choices and default provider autosave as owned fields, and its model text fields keep an explicit Save that sends only themselves.
  - The interim state is a real release (PR-F lands before PR-H), so it is tested as one.
- **Building each save at dispatch:**
  - The payload is built when the save is sent, not when it was queued: the newest confirmed settings, plus only this save's owned fields.
  - It is sent under the newest revision this page has confirmed, and advances only over this page's own confirmed saves. A revision moved by another tab is a conflict.
  - It never includes another field's unsaved text draft.
- **One at a time:** today `PageSave` (`AgentsSection.tsx:75–93`) only acquires or refuses a lock. It becomes a serial queue: an autosave waits behind a running save and is rebuilt at dispatch.
  - A field edited while its own save is in flight saves again after it.
  - Only the draft that was actually sent is acknowledged when its save confirms.
  - A lost acknowledgement leaves the field unconfirmed, with Try again, until a read shows what is saved.
- **Debounce:** a change starts a 600 ms debounce; further changes restart it, so stepper clicks coalesce.
- **Validating at dispatch:** a save is validated when it is sent, against the newest confirmed settings. A queued step choice for a provider that is now off is dropped. Turning a provider off supersedes queued choices for it: its save carries the reset of its steps to Default, and any queued step save naming that provider is discarded with the existing reset note.
- **Save identity:** today settings saves share one revision, with no request receipt (`intake-server/src/agents/settings.ts`), so after a lost response a read can't tell this tab's save from another tab's.
  - Each save carries a client-generated `save_id`. The server stores the last applied `save_id` with the revision, and returns it on reads and on a retried save with the same ID. This is a contract and server change in PR-F.
- **After an unconfirmed result:** the queue distinguishes three outcomes.
  - **Confirmed:** the response, or a read showing this `save_id`.
  - **Conflict:** a 409, or a read showing a newer revision with another `save_id`.
  - **Unknown:** no response, and a read that still shows the old revision; the save may still be running.
- An unknown or conflicting outcome pauses the queue. Queued edits and their revision bases are kept until the outcome is known.
  - **Unknown:** re-reading with backoff, or Try again, which resends the same `save_id` and is therefore safe to repeat.
  - **Conflict:** Reload adopts the saved settings and discards the unconfirmed non-text values, keeping text drafts; Try again re-sends them over the new revision, validated again.
  - The queue resumes once every outcome is known.
- **Status:** each subsection heading shows `AutosaveStatus` (Saving…, Saved, a failure with Try again, a conflict with Reload). A failure keeps the control's value.
- **Leaving:**
  - **In-app navigation:** `useNavigationGuard` (`navigation/useNavigationGuard.ts`) gains a pre-navigation hook. A link or Back first flushes pending debounces, waits for their saves, then continues; on a failure it stays and shows Try again.
  - **Reload and close:** these keep the browser's leave prompt (`beforeunload` can't wait for a save) while any save is pending or unconfirmed.
- **Invalid changes:** refusals move to the control. Turning off the last provider is refused at its switch ("At least one provider stays on") and nothing is sent. Turning a provider off saves at once, together with the reset of its steps to Default, and the existing note says which steps moved.
- **Unchanged:** credentials stay write-only, in their own dialogs and commands.
- **Rejected:**
  - Autosaving text on a debounce. It would save half-typed instructions mid-thought.
  - A single page-level Save. It's the pattern being removed.

### Read-only provider status and sign-in dialogs

- **Why the status needs new plumbing:** today the browser calls the guest's management server (`agents/shared-vm/credential-http.ts`), and every action, even `status`, requires the management key. That key authorises credential changes and stays browser-held, so it can't back an automatic check.
- **Who knows the answer:** each provider has its own credential-management process and container.
  - `credential-main.ts` runs in one mode at a time: Claude, opening the token store, or Codex, holding the `CodexAccount` with any pending login.
  - Deployment starts them separately, with separate mounts (`tooling/deployment/bridge/personal-claude.sh`, `personal-codex.sh`).
  - The turn entry point (`guest-main.ts`) exists only during a turn, so it can't answer between turns.
- **Status-only path, per provider:** each credential process gains a status-only endpoint on its own private listener, separate from the browser-facing management listener.
  - It needs no management key and offers no mutating action.
  - Each is reachable only through a private relay route from the session worker, one per provider. The deployment scripts and relay change in task 12.
  - A test proves the browser-facing management listener can't reach either status endpoint.
  - The session worker owns the pairing and keeps it. The intake API asks the worker through a bounded local request with a 2 s timeout; task 12.1 chooses the transport from what the two processes already share.
  - Each provider answers independently. A missing service, an older image without the endpoint, a busy process, a stopped or unpaired VM, or a timeout makes that provider unknown, with the reason, and never signed out.
- **Guest answer, read only:**
  - **Claude:** `configured` and `revision` from the token store. Its save time comes from a new `credential_meta` side table holding `(revision, saved_at)`, written in the same transaction as each save, replacement or removal. The time is exposed only when the meta revision equals the store's current revision, so a save by an older image (which doesn't write the side table) shows no time rather than a stale one.
    - A side table, not a new column, because the current initializer uses a positional `INSERT … VALUES`, which an older image could no longer run against a changed table.
  - **Codex:** `signed_in` from the app server's `account/read` (without refreshing), and `signing_in` from the `CodexAccount` instance's pending login. It never runs the `status` action, which can cancel an expired login or complete one (`codex-login.ts:145–187`). Task 12.1 confirms `account/read` has no side effects.
  - The answer carries no token, account email, key or pairing material.
- **Intake server:**
  - `GET /api/v1/agents/provider-status` (read authority, short cache) returns that answer. It is display-only: it never carries a credential revision for the browser to save with.
  - **The last-session line:** for each provider, the server selects that provider's latest session in either sign-in mode, ordered by start time.
    - The line shows only if that session used the subscription, and its failure carries retained evidence that the provider refused sign-in: a recorded provider error of the authentication kind or with HTTP 401 (from #239).
    - `agent_login_required` alone doesn't count, because it also covers a missing guest connection and missing credentials before any provider call (`coordinator.ts`, `native-turn.ts`). Neither does `agent_credentials_unavailable`.
    - A newer session of either mode that didn't fail sign-in hides it.
  - A contract `ProviderStatus` sits in `contracts/src/agents.ts`.
- **Token save:**
  - The dialog first checks the token's shape in the browser: Claude setup tokens start `sk-ant-oat01-`, and API keys (`sk-ant-api…`) are named as such.
  - When the key is entered, the dialog makes a fresh protected `status` read through the existing management action, which returns the current revision. Save and Remove stay disabled until it succeeds. Editing the key clears it and reads again.
  - Save sends the existing `save` action with that revision, unchanged. The dialog closes when storage is confirmed; a refusal, including a stale revision, keeps it open with the reason, and the stored token is unchanged.
  - Provider verification (checking with Claude that a token works) isn't part of this change; task 12.1.3 only investigates it.
- **Cards and dialogs:**
  - `ProviderCard` shows `StatePill` with the status, a "Check again" action, and the last-session line when there is one.
  - `PersonalClaudeCredential` and `ChatGPTSignIn` move into `Dialog`s opened from "Subscription token…" and "Sign in to ChatGPT…". The management key is a field in each dialog, held only while it's open.
  - **Dialog generations:** each opening is a generation. Closing the dialog or editing its key ends the generation:
    - it clears the key and the protected revision, and cancels queued but unsent requests, including those `useChatGPTSignIn`'s serial queue holds (`useChatGPTSignIn.ts:145–166`);
    - it stops polling;
    - late responses from an ended generation are ignored.
  - The Claude dialog's Save stays disabled while its request runs, and closes only on confirmed storage. The Codex dialog closes itself once the account is confirmed.
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
  - A "Token refused" pill inferred from the latest failure: without the credential revision a session used, a failure after a replacement could blame the new token.

### Choosing a dropdown control

- **Searchable picker:** records (category, location, company, Part, parameter template, supplier), lists that grow with the batch (lots, groups, observations as move targets), and anything taking a typed exact value. Built on task 13's `SearchablePicker`, with record fields keeping `SearchableReferencePicker`.
- **Short fixed lists, case by case:**
  - A `SegmentedControl` usually suits two to four short options that fit one line at phone width. Every option stays visible, one tap switches, and it matches Sign-in and Default provider.
  - A styled native `Select` usually suits longer fixed lists, or tight spaces such as table cells and bulk bars. On a phone it opens the system picker, and it's accessible by default.
  - This is guidance, not a rule (Mitch, 2026-11-23); the screen decides.
- **The audit:** task 14 lists every native select JSX site (46 in 28 components on this HEAD, counting the Review Map's three `LinkSelect`s and excluding tests, fixtures and the generic `TextField` wrapper; one site can render several fields, such as `StepChoices` for four steps) with its option count and kind, refreshed after PR-H removes `StepChoices`, proposes each one's control in the PR, and changes them. The candidates for the searchable picker include `PartCreationFields`, `TemplateEditor`, `ParameterEditor`, `CompanyEditor`, `ProposedCompanyEditor`, `SourcingEditor`, `LocationDetail`, `AssignedLocationField`, `PartDecision`, `ObservationMove`, `RestructureDialog` and `MediaWorkspace`'s group choice. The final list comes from the audit.
- **Design system:** the Bench Intake Design System gains a "Choosing a dropdown" guide with the three controls and examples, plus the `SearchablePicker` component. The canvas board O11 shows it.
- **Rejected:** converting every select to the searchable picker. It's weaker on phones and slower for two or three options.

## State, authority and failure behavior

| Case | Outcome |
| --- | --- |
| Return to a tab, refresh under 400 ms | Cached page, no visible indicator; commands disabled until a verified read |
| Refresh 400 ms–3 s | Progress line only |
| Refresh over 3 s | Progress line, plus "Updating…" in the page header |
| Refresh fails | Existing "Status unavailable…" banner (unchanged requirement) |
| Reload | Persisted data as `cached`, refreshed; commands gated |
| Scope or build change | Persisted cache dropped; skeleton |
| Typed input during refresh | Kept; the command explains why it is disabled |

Authority is unchanged: no command is enabled by cached, restored or cache-written data, and every command keeps its own revision checks.

## Verification strategy

- **Provider status (intake PG and process tiers):**
  - each provider's status endpoint answering independently, one unknown while the other answers; the browser-facing management listener unable to reach either;
  - the last-session line for a missing token, an unreachable guest, a provider refusal with evidence, and a newer API-key session;
  - `credential_meta` through upgrade, rollback, replace or remove on the older image, and re-upgrade, showing no stale time;
  - the status endpoint with a fake guest: Claude saved with and without `credential_meta`; Codex signed in, signing in, and expired-but-uncancelled left untouched;
  - a paired VM with zero turns and a pending Codex login, and a status read overlapping an active turn;
  - an older guest, a busy guest and a timeout reading as unknown;
  - the API-to-worker request and its timeout;
  - the last-session line: hidden after a newer success or API-key session, not shown for unavailable credentials;
  - the credential store opening on an older image after `credential_meta` exists, and on the new image with an existing token;
  - no secret in any response; the management endpoints unchanged.
- **Dropdowns:** each converted field keeps its value, validation and form wiring (its existing tests, updated for the control); a picker per kind is tested for search and keyboard; captures at 1440 and 390 px for every changed field.
- **Unit (frontend), provider cards and dialogs:** the model picker (search by name and ID, grouping, a provider that's off disabled with its reason, exact IDs per provider and their validation, a pick setting both provider and model and autosaving, the record picker unchanged on the shared base); the pill states, Check again, the switches, the segmented default provider, the dialog shape checks, Save staying disabled while checking, failures keeping the dialog open, and the Codex dialog closing on confirmation.
- **Manual (provider status):** on the real VM, Settings shows the status with no key typed, and a failed sign-in shows as the last-session line.
- **Unit (frontend), agent settings autosave:** under fake timers (also: a timed-out save that commits after the recovery read, resolved by its `save_id`; a provider-off save superseding a queued step choice; a conflict and a lost acknowledgement, with and without a committed save, pausing the queue and resolving through Reload or Try again):
  - debounce coalescing;
  - the payload built at dispatch from the newest confirmed settings with only owned fields;
  - same-page saves overlapping through the queue, and edits during a save saving again after it;
  - an external conflict with Reload, and a lost acknowledgement;
  - flush before in-app navigation, success and failure, and the leave prompt on reload;
  - the last-provider refusal and the provider-off reset;
  - text fields keeping Save, including the interim model fields in PR-F.
- **Unit (frontend), animation switch:** the default, storage failure and an unknown stored value; the scene paused when off, and still under OS reduced motion; turning it on after an off-state reload resuming without recreating the scene; a theme change while paused; each masthead style kept. The motion itself is checked in the running app, because the fixture runner freezes animation and hides the masthead scene (`frontend/README.md`).
- **Unit (frontend), capture:** the photos input has `multiple` and no `capture`; a mixed drop on a group is one operation with the right kinds and count; a drop on a nested group is handled once; a paste outside text fields queues images, and inside a note it doesn't; every picker refusal (disabled, archived, stale, pending command, conflicting draft) refuses drop and paste too.
- **Manual (capture):** picking several photos from the library on an iPhone and an Android phone, and dropping files on desktop Chrome and Safari, recorded in the PR.
- **Unit (frontend), the review fixes:**
  - `EventTime` for today, yesterday, this year and an earlier year, under 12- and 24-hour locales, with the `title`;
  - the state mapping for every retained state;
  - the masthead summary wording;
  - the Overview's Needs you list against the attention read;
  - the lot table's pills and links, and the step page's own counts;
  - popover placement near the window's edges.
- **Unit (frontend):**
  - `useFreshRead` phases and `verified` under fake timers and a fake query client:
    - never verifying: a `setQueryData` write before or after verification, including one with equal data; a successful read returning equal data verifying even though structural sharing keeps the object; a restored snapshot, a cancelled fetch's late response, a scope change, and failed or paused reads;
    - a shared in-flight fetch verifying its observers once;
    - separate refresh tests for Processing commands, Pause and Resume, Review's manual workflow and Review acceptance;
    - the quiet reason reachable by keyboard focus;
  - `RefreshSignal` delays (400 ms, 3 s), reduced motion and the announced status;
  - `Button`'s `disabledReason`;
  - snapshots with jsdom `sessionStorage`: the projections; sentinel values in excluded fields, keys and nested DTOs never reaching storage; validation on read; restore only after a matching bootstrap and never into the query cache; expiry by age and build; scope change dropping pending writes; the size cap and quota failure;
  - `RecordsStage`'s first-row border, by reading the generated rule for a selected first row from the injected style sheet (there is no `jest-styled-components`), with the visual capture as the main check;
  - Processing and Review gate tests carried over to the hook.
- **Visual:** Playwright captures of the fixture pages (`tests/fixtures/*.html`) for layout comparisons, and of the running dev app for anything involving motion, live data or the masthead scene, at 1440 px and 390 px, before and after each PR, attached to the PR. There is no committed screenshot baseline, because evidence goes on the PR.
- **Manual:** a demo video of returning to Review and Processing with no banner, a throttled slow refresh, a reload, and the record border.

## Migration, rollout and recovery

- **Rollout:** a new build invalidates stored snapshots. The only stored-data change is the guest's `credential_meta` side table (task 12), which older images ignore.
- **Rollback:** removing the snapshot module leaves nothing to migrate; sessions start without snapshots.
- **Build identifier:** the Vite `define` adds one build constant; the Dev mode popover's build summary can show it too.

## Risks and open decisions

- **Skeletons can drift from the page layout.** Mitigation: each skeleton sits beside its page and is part of the visual pass.
- **Snapshot size.** Mitigation: the 1 MB cap per projection and quota handling; actual sizes are measured in task 4 and reported in the PR description.
- **Conflicts with `improve-agent-interaction`'s Processing and drawer edits.** Mitigation: whichever merges second rebases. Its activity popover and session rows take `WorkState` and `EventTime` from here, so whichever lands first defines them and the other adopts them.
- **Overlapping spec edits.** `pnpm openspec:overlap` reports errors until `settings-debug-mode` and `simplify-vm-agent-web-and-setup` sync, because all three modify "Agent settings section". This change's MODIFIED block is written on that change's version. Sync order: `settings-debug-mode`, `simplify-vm-agent-web-and-setup`, then this change, rebasing the block in full first (tasks, lifecycle).
- **Renaming states touches many tests.** Mitigation: one mapping function, with the old words removed in one PR.
- **Provider token verification** is out of scope; task 12.1.3 only investigates it.
- **Open: credential attribution.** Sessions don't record which credential revision they used, so failures are shown as "last session" diagnostics, not as the token's status. Recording it is a possible follow-up.
