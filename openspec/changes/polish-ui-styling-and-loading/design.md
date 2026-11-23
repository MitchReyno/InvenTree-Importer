# Design assessment

## Context and grounding

The change is mostly frontend, and large: visual fixes, one shared loading and freshness pattern adopted across about 15 screens, Settings › Agents rework, and a dropdown sweep. Task 12 alone adds server, VM guest and contract work (the read-only provider status). There is no data migration.

| Area | Today | Evidence |
| --- | --- | --- |
| Selected row border | `RecordButton`'s `&:first-of-type { border-top-color: transparent }` ties in specificity with `choice`'s `&[aria-current='true'] { border-color }`, and wins by order | `components/review/records/RecordsStage.tsx` |
| Page spacing | Top-level blocks are fragment siblings with their own `margin-bottom`; some have none | `components/review/ReviewWorkspace.tsx` (`ScopeBar`, `ContextFold`, `Toolbar`; `Banner` and `ReviewFilters` without margins) |
| Profile notice | An info banner keyed on `snapshot.runner_status`, plus a job card tag | `ProcessingWorkspace.tsx`, `ProcessingJobCard.tsx` |
| Reads | TanStack Query 5.105.1, memory cache, `staleTime: Infinity` | `queries/client.ts`, `App.tsx` |
| Command gating | Processing `waitingForRead`, from a successful-read latch set only inside its own `queryFn`, so cache writes don't count (`successfulRead`); Review `waitingForFirstRead` (`isFetchedAfterMount`) and, for acceptance, `processingCurrent` (fetched this mount, success, not fetching, revision matches) | `ProcessingWorkspace.tsx:173–188`, `review/ManualWorkspace.tsx:102`, `review/ReviewWorkspace.tsx` |
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
useFreshRead(query, { current?: (data) => boolean }) →
  { data, phase: 'empty' | 'cached' | 'refreshing' | 'current' | 'failed',
    verified: boolean, reason?: 'Updating…' | 'Status unavailable' }
```

- **Verified read:** the hook owns a successful-read latch, as Processing has today. It wraps the query function and sets `verified` only when its own HTTP request succeeds for the mounted resource and scope identity. A `setQueryData` write, a restored or hydrated entry, a scope change, a failed read or a paused fetch never sets it, and a failure clears it.
- **Phases:**
  - `empty`: no data;
  - `cached`: data, not yet verified;
  - `refreshing`: a fetch in flight (before or after verification);
  - `current`: verified, scope unchanged, and `current(data)` holds;
  - `failed`: `isError`, or a paused fetch.
- **Gating:** each screen keeps its own command conditions and builds them on `verified`, never on `isFetchedAfterMount`.
  - Processing's commands and Review's manual workflow need `verified` once, and stay available through later background refreshes, as today.
  - Review's acceptance keeps its stricter check (not fetching, capture revision matches) through the `current` predicate.
  - Every command keeps sending its own expected revision and keeps its draft checks.
- **`ReadState`:** renders the page's skeleton in `empty`, the children otherwise, and the existing failure banner in `failed`. It reports unverified and refreshing reads to a page-level `RefreshSignal` context.
- **`RefreshSignal`:** mounted by `App`, it starts a 400 ms timer when any registered read begins refreshing. When the timer fires it shows `RefreshLine`: a 2 px fixed bar under the masthead using the motion tokens, still under reduced motion, with a visually hidden "Updating" status. At 3 s it shows "Updating…" in the page header's status slot, which is absolutely positioned so nothing moves. Both clear when no registered read is refreshing.
- **Disabled reasons:** `Button` already takes a `disabledReason`, which it shows beside the disabled button; that would itself shift the layout during a refresh. A `reasonDisplay: 'quiet'` option keeps the reason as the button's description and tooltip only (`aria-describedby` to a visually hidden element, plus `title`). Screens pass the hook's `reason` quietly; persistent reasons keep the visible form.
- **Skeletons:** each page gets one, built from `Skeleton` blocks in its grid. They live next to the page component.
- **Rejected:**
  - React Suspense with `useSuspenseQuery`. It would restructure every screen's error and draft handling, and doesn't solve the command gate.
  - A whole-page overlay spinner. It hides cached data that is useful to read while refreshing.

### Persist allowlisted reads to session storage

- **Mounting:** `queries/client.ts` wraps the client with `PersistQueryClientProvider` and `createSyncStoragePersister({ storage: sessionStorage })` from `@tanstack/react-query-persist-client` and `@tanstack/query-sync-storage-persister` 5.105.1, pinned to the installed `@tanstack/react-query`.
- **What persists:** an explicit endpoint-and-field allowlist of display reads. Each allowlisted query declares a `persist` projection in `meta` that keeps only display fields. `shouldDehydrateQuery` persists only successful allowlisted queries, through their projection. `shouldDehydrateMutation` returns `false`, because TanStack dehydrates paused mutations by default.
- **Never persisted:**
  - bootstrap and its CSRF token (it already sits outside the private cache);
  - credentials and sign-in payloads;
  - session identifiers (for example the Agents list's `native_session_id`);
  - media bytes and previews;
  - drafts and command intent;
  - debug reads.
  
  A test reads `sessionStorage` directly after a representative session to prove this.
- **Restore:** restoring waits for a fresh bootstrap. Persisted entries are restored only when the stored actor, target and target context match it; otherwise they are dropped unread. Restored data is never `verified` (see the hook), so restore can't enable a command. While restoring (`useIsRestoring`), pages show their skeleton.
- **Scope change:** a scope change clears the persisted cache after cancelling in-flight reads for the old scope. Commands for the old scope are already refused by their own scope checks.
- **Expiry:**
  - `maxAge` is 12 hours;
  - `buster` is a build identifier injected at build time (a Vite `define` of the commit and build time), so a new build discards the cache.
- **Size:** projections over 1 MB serialised are not persisted. A `QuotaExceededError` empties the persisted cache and is logged in debug info, never shown as an error.
- **Rejected:**
  - Persisting whole screen reads with an exclusion list. It's too easy to leak a new field.
  - `localStorage`. It outlives the tab, so stale inventory data could linger across days.
  - IndexedDB. Async restore adds complexity for no benefit at these sizes.

### One state vocabulary and one time format

- **States:**
  - `components/ui` gains a `WorkState` type (`working | waiting_for_you | queued | paused | done | failed | not_started`) and a `StatePill` that draws its word and glyph.
  - `header/workSegments.ts` maps retained job, step and session states onto it in one function, replacing `stateWords` and the local maps in Processing, the step pages, the session list and the masthead.
  - Lot review states ("Ready for review") keep their own `RecordStatePill`.
  - `improve-agent-interaction`'s activity popover bar uses the same type.
- **Masthead summary:** it reads failed and waiting steps from the header work read (already loaded). Failures lead: "‹Step› failed · N lots", then "‹Step› waiting for you · N". "‹Batch› · all done" needs a fresh, untruncated work read with step counts showing every applicable step done; an unstarted batch says "Not started", and a stale, truncated or unavailable read says "Updating…" or "Status unavailable". It never says "Retained work".
- **Times:**
  - A new `EventTime` component formats with `Intl.DateTimeFormat`: "Today HH:MM", "Yesterday HH:MM", "Fri 20 Nov · HH:MM", and the year outside the current one.
  - It respects the locale's hour cycle, and gives the full date and seconds in `title` and in the `<time dateTime>`.
  - `RelativeTime` stays for relative ages.
  - Every event time (session lists, drawer timelines, Recent activity, Agents) uses `EventTime`.
- **Rejected:** keeping per-screen words with a glossary. The inconsistency is the problem.

### Overview and step page counts

- **Needs you:** the Overview's card renders the batch attention read (`BatchAttentionDto`, already read for the header), using `NeedsYouPanel`'s list (shared, not copied), including its truncation disclosure (`NeedsYouPanel.tsx:135–137`). Agent questions come first and oldest first, then the other tabs' items tagged with their tab.
- **Lot table:** Pipeline becomes a table with one row per live lot, and Research, Images and Inventory columns of `StatePill`s from that lot's jobs.
  - **Rows:** jobs whose subject is a Part rather than a lot appear under their Part's lots. Batch-level Examine lives only in the bar.
  - **Links:** each pill links to its step page with that lot in focus. That needs a new `lot` query parameter on Processing step routes (`navigation/batch-route.ts`, whose trailing segment is a question ID today), which the step page reads on a direct load to scroll to and highlight the lot.
  - **Bar labels:** they show counts ("Research · 1 of 1") and link to the step pages.
- **Step counts:** the summary uses the same filtering as the step's own section (`StepPage.tsx:22–47`). It counts distinct lots covered by that step's jobs, and its sessions, not the attention read's job counts. Examine counts lots formed. The duplicate outer summary in `ProcessingWorkspace.tsx` is removed.
- **No server change:** every count and list comes from reads the page already makes.

### Help buttons and popover placement

- **Help buttons:** standing explanations ("One research lane per account…", "Waiting sessions hold no slot.", "Candidate assertions do not replace your selections." and others the task 8 sweep finds) move behind the existing `HelpButton`, reworded plainly. Developer-only facts move into `DebugDetails`.
- **Popover placement:** the batch header's "need you" popover already uses the shared `Popover` (`NeedsYouPanel.tsx:72–92`, `ui/Popover.tsx:40–52`), but opens against the window's left edge. Task 8 reproduces the geometry (the trigger's position inside the header, and the popover's alignment and clamping) and corrects it in `Popover`, so every popover opens aligned to its trigger and stays in the window. Rows with a leading pill use a grid with the pill in its own column.

### Several files from any source

- **Phone picker:**
  - The photos input drops `capture="environment"`. Without it, iOS and Android show their own sheet (take a photo, the photo library, files), and the library allows multi-select. The input keeps `multiple`.
  - **Rejected:** a separate "Use camera" control beside it. It adds a button for what the system sheet already offers; it can be added later if the camera shortcut is missed.
- **Drop and paste:**
  - The evidence panel and each group become drop targets: `dragover`/`drop` with `dataTransfer.files`, highlighting the target while files hover. A drop on a group is handled there once and doesn't also reach the panel.
  - Paste is a `paste` listener on Capture that ignores events from text fields and note editors, and takes `clipboardData.files`.
- **One operation:**
  - `useUploadQueue` gains a mixed-kind `addMixed(files, groupId)`. It types each file (image to photos, PDF to document, anything else to a "Not added" tile) under one shared pick identity and count, so a mixed drop shows "Uploading 2 of 4" as one operation.
  - Today `add` creates one pick per call (`useUploadQueue.ts:74–85,286–306`), so calling it per kind would split the progress.
- **Refusals:** drop and paste use the picker's full gate (`MediaWorkspace.tsx:189–194,445–449`): media disabled, the batch archived, media state not current, a command pending, or a conflicting draft open. Each refuses with the same reason as the disabled actions.
- **Rejected:** a drag-and-drop library (react-dropzone). Native events cover the need in about 50 lines, with no extra dependency.

### The electronics animation switch

- **The preference:** a new device preference, `bench-intake.masthead-motion` (`on` or `off`, default `on`), with a controller like `masthead-style.ts`. It reads and writes through `theme/device-preference.ts`, and sets `data-masthead-motion` on the root before first paint from the same inline script.
- **The scene:** the scene controller gains `pause()` and `resume()`. Turning the switch off pauses the existing controller, which stops the loop and keeps the parts where they are; turning it on resumes from there. Restarting would reset time and re-randomise the parts (`electronics-current/scene.ts`), so the scene is not recreated. When the page loads with the switch off, the scene starts in its existing still mode (`reducedMotion: prefersReducedMotion() || motion === 'off'`).
- **Pointer:** pointer reactions are skipped when still.
- **What stays the same:** the masthead style, its ground and masks are untouched.
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
- **Path to the guest:** the paired bridge and its pairing material belong to the session worker (`agents/session/session-worker-main.ts:81–97`, `tooling/deployment/host-runner.compose.yaml`). They don't move.
  - The intake API asks the worker through a new bounded, read-only local request with a 2 s timeout. Task 12.1 chooses the transport from what the API and worker processes already share (they share the database today; a direct local socket is the alternative).
  - The worker asks the guest through a new negotiated `provider_status` capability frame on the coordinator (`agents/shared-vm/coordinator.ts`, `frames.ts`, `guest-main.ts`). It is answered between turns without disturbing them, and reports busy if the guest can't answer now.
  - An older guest without the capability, a busy guest, a stopped or unpaired VM and a timeout all read as unknown, with the reason. None of them reads as signed out.
- **Guest answer, read only:**
  - **Claude:** `configured` and `revision`, read directly from `claude-credential.ts`'s store. Its save time comes from a new nullable `saved_at` column, written on future saves and unknown for existing tokens.
  - **Codex:** `signed_in` and `signing_in`. The guest calls only the app server's `account/read` (without refreshing a token) and reports its in-memory sign-in state. It never runs `CodexAccount`'s `status` action, which can cancel an expired login or complete one (`codex-login.ts:145–187`). Task 12.1 confirms `account/read` has no side effects.
  - The answer carries no token, account email, key or pairing material. No management endpoint changes.
- **Intake server:**
  - `GET /api/v1/agents/provider-status` (read authority, short cache) returns that answer.
  - Separately, it returns each provider's latest subscription-session sign-in failure (`agent_login_required` or an authentication-category failure) with its time. The card shows this as "Last session couldn't sign in". It makes no claim that the current token is the one that failed, because sessions don't yet record which credential revision they used.
  - A contract `ProviderStatus` sits in `contracts/src/agents.ts`.
- **Token save:**
  - The dialog first checks the token's shape in the browser: Claude setup tokens start `sk-ant-oat01-`, and API keys (`sk-ant-api…`) are named as such.
  - Save then sends the existing `save` action with the management key and the last acknowledged revision, unchanged. The dialog closes when storage is confirmed; a refusal keeps it open with the reason, and the stored token is unchanged.
  - Whether the guest can also confirm with Claude that a token works, before storing it, is investigated in task 12.1. If it can, that becomes its own follow-up requirement and isn't promised here.
- **Cards and dialogs:**
  - `ProviderCard` shows `StatePill` with the status, a "Check again" action, and the last-session line when there is one.
  - `PersonalClaudeCredential` and `ChatGPTSignIn` move into `Dialog`s opened from "Subscription token…" and "Sign in to ChatGPT…". The management key is a field in each dialog, held only while it's open.
  - **Dialog generations:** each opening is a generation. Closing the dialog or editing its key ends the generation:
    - it clears the key, and cancels queued but unsent requests, including those `useChatGPTSignIn`'s serial queue holds (`useChatGPTSignIn.ts:145–166`);
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

- **Provider status (intake PG and process tiers):** the guest capability with a fake guest (Claude saved with and without `saved_at`, Codex signed in, signing in and expired-but-uncancelled left untouched); an older guest, a busy guest and a timeout reading as unknown; the API-to-worker request and its timeout; the last-session sign-in failure alongside; no secret in any response; the management endpoints unchanged.
- **Dropdowns:** each converted field keeps its value, validation and form wiring (its existing tests, updated for the control); a picker per kind is tested for search and keyboard; captures at 1440 and 390 px for every changed field.
- **Unit (frontend), provider cards and dialogs:** the model picker (search by name and ID, grouping, a provider that's off disabled with its reason, exact IDs per provider and their validation, a pick setting both provider and model and autosaving, the record picker unchanged on the shared base); the pill states, Check again, the switches, the segmented default provider, the dialog shape checks, Save staying disabled while checking, failures keeping the dialog open, and the Codex dialog closing on confirmation.
- **Manual (provider status):** on the real VM, Settings shows the status with no key typed, and a failed sign-in shows as the last-session line.
- **Unit (frontend), agent settings autosave:** under fake timers:
  - debounce coalescing;
  - the payload built at dispatch from the newest confirmed settings with only owned fields;
  - same-page saves overlapping through the queue, and edits during a save saving again after it;
  - an external conflict with Reload, and a lost acknowledgement;
  - flush before in-app navigation, success and failure, and the leave prompt on reload;
  - the last-provider refusal and the provider-off reset;
  - text fields keeping Save, including the interim model fields in PR-F.
- **Unit (frontend), animation switch:** the default, storage failure and an unknown stored value; the scene started still when off or under reduced motion; pause and resume on change without recreating the scene; each masthead style kept. The motion itself is checked in the running app, because the fixture runner freezes animation and hides the masthead scene (`frontend/README.md`).
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
  - `useFreshRead` phases and `verified` under fake timers and a fake query client: hydration, a `setQueryData` write, a restored entry, a scope change, and failed or paused reads never verifying; background refreshes after verification keeping commands; the `current` predicate;
  - `RefreshSignal` delays (400 ms, 3 s), reduced motion and the announced status;
  - `Button`'s `disabledReason`;
  - persistence round-trip with jsdom `sessionStorage`: the allowlist projections, the serialised contents holding no CSRF token, credential, session identifier, draft or mutation, restore only after a matching bootstrap, the buster, `maxAge`, the size cap and quota failure;
  - `RecordsStage`'s first-row border, by reading the generated rule for a selected first row from the injected style sheet (there is no `jest-styled-components`), with the visual capture as the main check;
  - Processing and Review gate tests carried over to the hook.
- **Visual:** Playwright captures of the fixture pages (`tests/fixtures/*.html`) for layout comparisons, and of the running dev app for anything involving motion, live data or the masthead scene, at 1440 px and 390 px, before and after each PR, attached to the PR. There is no committed screenshot baseline, because evidence goes on the PR.
- **Manual:** a demo video of returning to Review and Processing with no banner, a throttled slow refresh, a reload, and the record border.

## Migration, rollout and recovery

- **Rollout:** no data migration. A new build busts any persisted cache. Rollback removes the persister, and sessions restart with a memory cache.
- **Lockfile:** the two packages change the lockfile, so worktrees install rather than symlink `node_modules`.
- **Build identifier:** the Vite `define` adds one build constant; the Dev mode popover's build summary can show it too.

## Risks and open decisions

- **Skeletons can drift from the page layout.** Mitigation: each skeleton sits beside its page and is part of the visual pass.
- **Persisted cache size.** Mitigation: the 1 MB cap per projection and quota handling; actual sizes are measured in task 4 and reported in the PR description.
- **Conflicts with `improve-agent-interaction`'s Processing and drawer edits.** Mitigation: whichever merges second rebases. Its activity popover and session rows take `WorkState` and `EventTime` from here, so whichever lands first defines them and the other adopts them.
- **Renaming states touches many tests.** Mitigation: one mapping function, with the old words removed in one PR.
- **Open: provider token verification.** Whether the guest can confirm a Claude token works before storing it (task 12.1). Until decided, Save promises shape and storage only.
- **Open: credential attribution.** Sessions don't record which credential revision they used, so failures are shown as "last session" diagnostics, not as the token's status. Recording it is a possible follow-up.
