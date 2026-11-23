# Design assessment

## Context and grounding

The change touches three layers that already exist. No new service, table or dependency is needed.

| Layer | Today | Evidence |
| --- | --- | --- |
| Dialog | A native `<dialog>` opened with `showModal()`. It closes on `cancel` (Esc) or Close through the owner's `onClose`, and has no backdrop handling | `frontend/src/components/ui/Dialog.tsx`; owners guard unsaved work in `onClose` (`ProcessingWorkspace.tsx`, the drawer) |
| Question contract | `SessionAskArgs` holds one `kind` (`quantity` or `clarification`) and one `prompt`. The retained envelope is `bench-intake-session/1` with the question payload | `contracts/src/sessions.ts`, `intake-server/src/agents/tools/handlers.ts` (`ask`) |
| Answer | `bench-intake-answer/1` holds one value. A session answer becomes one capture edit (a lot quantity or a note), plus an `answer` inbox item and relying-session notices, in one transaction | `intake-server/src/processing/session-answers.ts`, `contracts/src/sessions.ts` (`SessionInboxItem`) |
| UI | `QuestionAnswer` is a single field, validated on submit with a generic message. `DrawerAnswers` pins drafts per question and shows disabled option placeholders | `frontend/src/components/processing/QuestionAnswer.tsx`, `DrawerAnswers.tsx` |

Admission does not pin tool input schemas. Only `agents/tools/server.ts` publishes `inputSchema` from the contract. So the `ask` schema can change for `native-agent/2` and `shared-vm-agent/3` sessions without a profile bump. `shared-vm-agent/2` is retired: the runner settles its attempts as failed before any worker starts, so only its retained history needs to stay readable.

The complexity is moderate. It is a versioned contract with backward-compatible reads, one transactional server path, and a reworked form.

## Goals and constraints

- The goals are the [proposal](proposal.md) outcomes and the deltas under `specs/`.
- **Constraints:**
  - Retained `/1` questions and answers stay decodable and answerable.
  - Earlier runner questions (`ProcessingQuestionSpec`, `processing/answers.ts`) are untouched.
  - Every answer effect stays a human capture edit through the existing edit path.
  - Answers stay idempotent by key.
  - The frontend validates with the same TypeBox contract the server uses.

## Decisions and alternatives

### Backdrop click in `Dialog`, not `closedby`

- **Handler:** `Dialog` records the `pointerdown` target. On `click`, when both the press and the release hit the `<dialog>` element itself outside its content box, it calls the same path as Esc: `onClose()` unless `closeDisabled`. With `showModal()`, a click on `::backdrop` is reported with the dialog as its target.
- **Content box:** the surface has padding, so the handler compares the click point with `getBoundingClientRect()` rather than the target alone.
- **Why not `closedby`:** `closedby="any"` is not in Safari ([caniuse](https://caniuse.com/wf-dialog-closedby), checked 2026-11-23). A polyfill adds a dependency for about 15 lines.
- **Scope:** this applies to every `Dialog`, including centred editors. Their owners already treat Esc as a close request with their own guards, so a backdrop click follows that.
- **Rejected:** a drawer-only option. It would leave centred dialogs inconsistent, and the spec makes it a design-system rule.
- **Direct surface users:** `MediaCropDialog` is the one component that uses `DialogSurface` directly, with its own lifecycle. Task 1 gives it the same backdrop handling through its own close guard, so the rule holds for every modal. `RemovalDialog` and `EvidenceGroupPanel` already use `Dialog`.

### A `/2` question with steps, read beside `/1`

New contract shapes:

```text
SessionAskArgsV2  = { schema_version: 'bench-intake-question/2', subject_id, reason, fields,
                      title?, steps: Step[1..4] }
Step              = { id, prompt, assumption, answer: Choice | Number | Text }
Choice            = { kind: 'choice', options: {id, label≤80, detail?≤160}[2..6], other: boolean }
Number            = { kind: 'number' }        // the subject must be a live lot
Text              = { kind: 'text' }
ProcessingAnswerV2 = { schema_version: 'bench-intake-answer/2', expected_question_revision,
                       expected_capture_revision, attempt_id, input_sha256,
                       steps: { step_id, value: StepValue }[] }
StepValue         = { kind: 'choice', option_id } | { kind: 'choice', other: text }
                  | { kind: 'number', value, basis } | { kind: 'text', text }
```

- **Validation:** step IDs and option IDs are unique, which the handler checks because TypeBox can't. A step prompt is at most 500 characters, so prompts stay one question long. A question title (up to 120 characters) labels a stepped question in Needs you; a one-step question uses its prompt.
- **The tool's schema:** `ask` takes `SessionAskArgsV2`. The handler stores it in the envelope under a new `kind: 'question'` payload variant, so the envelope union reads both `/1` and `/2` payloads.
- **The read model:** it returns questions as a normalised view, `{version, title, steps[]}`. A `/1` question becomes one step (`quantity`→number, `clarification`→text) carrying its original kind, so the frontend has one renderer. A `/1` question is still answered with `bench-intake-answer/1`.
- **Delivery:** today's form reads `question.spec.kind` and `prompt` and always sends `/1`, so it can't answer a `/2` question. The contracts, the server path and the new form therefore ship in one PR (PR-B), and no build asks `/2` questions without the form that answers them.
- **Rejected:**
  - Separate questions linked by a group ID. They would arrive and be answered piecemeal, which is what made the current flow feel clunky.
  - Free-text prompts with options parsed from them. That can't be validated.
  - A multi-select kind. It isn't requested; it can be added as a new step kind later.

### One transaction, at most two capture edits

`answerSessionQuestion` gains a `/2` branch that does the following:

1. Validates the answer against the stored `/2` spec: one value per step, kinds matching, option IDs known, and "other" only where allowed.
2. Applies a quantity edit for the number step if there is one. At most one number step is allowed per question, because a question has one subject, and the handler enforces it. As in `/1`, the edit sets the lot's quantity value; the counted or estimated basis is kept in the stored answer and the inbox item.
3. Applies one note edit, chained on the revision from step 2, joining `prompt — answer` lines for the choice and text steps, and for a number step answered in words.
4. Records the answer, marks the question answered, and appends one `answer` inbox item. Its payload is `{question_id, answer_id, steps: [{step_id, value}]}`, a new variant of the inbox payload union, and it carries the option ID and label.
5. Tells relying sessions, as today.

The locked capture edit handle (`lockCaptureForEdit` in `capture/repository.ts`) allows one `apply` today and checks it against the revision it locked. It gains an ordered form that applies each edit under the same lock, checks each against the revision the previous one produced, and publishes once. The note must fit the 8192-character capture note limit; a combined note over it is refused as `invalid_answer` naming the step, before any edit.

Any refusal rolls back everything. Because the capture lock is held throughout, the capture can't change between the two edits; the rollback test injects a refusal of the second edit.

Replay keeps today's behavior. The answer command binds the caller's idempotency key to the canonical request payload, so a same-key replay returns the first receipt and a different payload under that key is refused. A submission under a new key adopts an existing answer to the question when its canonical payload matches, and is refused as `payload_conflict` when it differs, so the drawer and the page can't record two answers. Separately, `answer:<question_id>` deduplicates the inbox item.

Rejected: changing `CaptureEdit` to carry several changes. That is a wider contract change for no gain, since sequential edits in one transaction are already atomic.

### The form: one pinned draft per question, with steps

- **`QuestionAnswer`** keeps its mount-pinned identity and draft rules. Its fields become `steps: Record<stepId, StepDraft>` plus `current`, the index or `'review'`. The `/1` path keeps the single-field form.
- **Number validation:** it runs on change against the same `Quantity` schema. It shows "Enter just the number, like 380…" and blocks Next until the value is valid or the step has been switched to words.
- **Choice options:** they use the design system's option tiles (`bi-opt` / `OptionRow`) as radios.
- **Submit:** "Send answer" on a one-step question; "Send N answers" after the summary.
- **`DrawerAnswers`:** the disabled `OPTIONS` placeholder and `OPTIONS_NOT_CARRIED` are removed.
- **Needs you and Overview rows:** they show the title, "· N steps" / "· choose one of N" / "· a number", and the assumptions.
- **Rejected:** sending on the click of an option. Answers have immediate effects; Mitch chose click, then Send, on 2026-11-23.

### Agent guidance

- The `ask` description becomes: "Ask the operator one question. Use steps only for parts that belong together; split unrelated questions. Offer 2–6 options when the answer is one of a few. Give the assumption you keep working on for each step."
- The session runner's opening instructions get the same sentence.
- The fake CLI and synthetic session learn stepped asks, for process tests and the demo.

### A server-built history view, shared by the drawer and the page

- **Read:** `readSessionTimeline` becomes `readSessionHistory(batchId, jobId, {before?, after?, limit})`. It returns `SessionHistoryEntry[]` newest first, with `before` and `after` cursors and `truncated`.
- **Session metadata:** the same scoped read returns the session's header data: each attempt's number, state and start and end times, the agent selection and model, where it ran and its sealed web setting from the attempt's input manifest. The page header doesn't wait for the Agents read. The per-stream 500-entry read is replaced by merged pages of 200.
- **Identity and order:** outbox sequences restart with each attempt and inbox sequences run per job, so a sequence alone is ambiguous. Each entry's ID is its stream, owning attempt (outbox only) and sequence. The cursor orders by `created_at`, then stream, attempt and sequence, so equal timestamps and repeated sequences across retries page without gaps or duplicates.
- **Entry:** each `SessionHistoryEntry` holds:
  - `kind` (status, observation, lot, regroup, proposal, question, answer, instruction, evidence, revision, photo_view, web_read, failure);
  - `who` (agent or you);
  - `attempt` (its number);
  - `at`;
  - `summary`, one line;
  - optional `details`, a small typed union per kind (fields with source chips, observations with crop references, step answers, effects);
  - `links`, typed targets (`lot`, `map`, `capture_evidence`, `record`, `question`, `failure`, `external_url`).
- **Resolution:** the server resolves IDs to labels and current or stale state from the same snapshot it already reads, so neither the drawer nor the page needs the whole Processing snapshot. A link to something retired becomes `{kind: 'gone', label: 'Lot retired'}`.
- **Detail sources:** the outbox keeps IDs, so details come from the records they name:
  - an observation from its retained observation row;
  - a lot from its capture record (observations, quantity and basis, the separation note), labelled as its current values, since the outbox keeps no snapshot of the lot as formed;
  - a regroup from its moves: the outbox payload gains `moves` (observation, from lot, to lot) for new entries, while older entries list only the affected lots;
  - a proposal or question from its retained row;
  - a failure from the attempt's retained failure, for every attempt, not only the latest;
  - where a detail isn't retained, the entry says so rather than showing current values as history.
- **Attempts and turns:** each attempt gets a header entry with how it ended. Attempts record no reason for starting, so the header derives one from the retained input that preceded it (a revise request, a retry after a failure, or the first attempt) and otherwise says only "Attempt N". Further turns within one attempt, started by an answer, chat or new evidence, are not attempts: the inbox entry that woke the session marks them. The page shows these headers; the drawer hides them.
- **Grouping:** this is presentation, done in one shared frontend function. Consecutive action entries of the same kind about the same subject or photo are grouped; observations from different photos stay separate. In the drawer, a run of `photo_view` and `web_read` entries, mixed or not, collapses into one summary line linking to the page.
- **Inputs and attempts:** the inbox keeps one acknowledgement cursor per job, so which attempt read an input isn't retained. Inputs are placed by submission time, and an attempt divider by the attempt's start, without claiming which attempt consumed an input queued before a Start fresh.
- **Rendering:** each entry is native `<details>`/`<summary>`. Links are built with the existing `batchHref` helpers, and external URLs open in a new tab with `rel="noreferrer"`.
- **Rejected:** building entries in the frontend from the Processing snapshot. That duplicates resolution in two places, and the page would need snapshots of other batches when reached from the Agents page.

### Photo views are outbox items

- **Recording:** `fetchEvidenceImage` ends with a final transaction that checks removal and the capability, then charges the in-memory image budget after it. The budget check and reservation move before that transaction, and the transaction appends an outbox item `photo_view` holding `{evidence_id, version_id, page, region?, delivered: {width, height, media_type, sha256}}`: metadata only, never image bytes. The same transaction publishes `session_changed`, as status and reply items do, so a photo-only fetch reaches open drawers and pages. If the transaction refuses or fails, the reservation is released and no image is returned. A view therefore attests that the image was handed to the tool response, not that the provider read it.
- **Migration:** the outbox `kind` check (migration 0018) doesn't allow `photo_view`, so a migration extends it.
- **Showing the crop:** the only crop route today serves observations (`/api/v1/batches/:batchId/media/observations/:resourceId/crop`). A new route, `GET /api/v1/batches/:batchId/processing/sessions/:jobId/photo-views/:attemptId/:seq/crop`, recuts the recorded region from the same page preview with `media/region-crops.ts` and bounds it as the handler did. The delivered image was re-encoded once more, so the result is a reconstruction: the page shows the recorded delivered size and digest beside it and doesn't claim the bytes match. It returns 404 when the version was removed, and its scope is the same as the history read.
- A refused or budget-exceeded fetch appends nothing.
- **Rejected:** a separate table. The outbox already orders, binds and retains session output.

### Agent-reported web page sources

- A new proposal source kind, `{kind: 'web_page', url, title?, read_at?}`, is accepted in a `/6` session proposal's top-level `sources` only, beside the `ProcessingSource` kinds that `/5` uses, so `/5` stays exact. It can't appear in `relies_on` or catalogue sources.
- **Delivery check:** the handler's delivered-citation check skips `web_page` sources, the one kind not delivered by the app. The retained decoder (`retainedSessionProposal` in `processing/retained.ts`), which the Processing snapshot uses and which validates `/5` and rechecks delivery, accepts `/5` and `/6` and applies the same exception only to `/6` top-level `web_page` sources. "Bounded status lines and delivered citations" is modified to state this exception. BI-017's delta already tells VM agents to cite web facts by URL; this gives that a place.
- **Validation:** the URL must be absolute `http(s)`, at most 2048 characters, with no credentials in the URL.
- **Display:** the history derives a `web_read` entry from each cited URL (deduplicated per attempt), linked to the citing proposal. Source chips show "Web page" with the warn style and "agent-reported".
- **Not verified:** Review and Inventory treat these sources as unverified. They can't stand in for a receipt anywhere a receipt is required today.
- **Rejected:**
  - Taking URLs from the egress proxy. It sees hosts only, for HTTPS.
  - An app-side fetch with receipts. That is out of scope (the BI-017 provenance follow-up).

### The session page as a conversation, and its route

- **Layout (option B, chosen 2026-11-23):** the page renders the same `SessionHistoryEntry` stream oldest first, as one conversation:
  - action entries as compact expandable rows (the shared renderer, grouped);
  - chat as bubbles, from the inbox `chat` items and outbox `reply` items, which the history read now includes;
  - questions as their cards, with the same `QuestionAnswer` form as the drawer;
  - the operator's inputs right-aligned;
  - attempt headers as dividers.
- **Filters:** chips (All · Messages · Your inputs · Photos · Web) and Load older at the top.
- **Command context:** answering in place needs the current question revision, attempt, digest and capture revision. The page mounts the batch's scoped Processing read for them, as the workspace does, and disables commands while that read is loading, failed or paused.
- **Message box:** at the bottom; it posts to the existing inbox submission route with an idempotency key. The drawer and the page share the draft-pinning rules, so an answer saved in one shows the other's draft as superseded.
- **Rejected:** option A, a timeline by attempt with chat and answering only in the drawer. These agents mostly act, but Mitch preferred one story in one place; A's filters and attempt dividers are kept.
- The route is `/batches/:id/processing/:step/sessions/:jobId`: a new `{tab: 'processing', step, sessionJobId}` route variant, parsed and built by `batch-route.ts`. The drawer's `?session=` query stays for the drawer.
- **Reuse:** the page uses the batch header, the history renderer, `QuestionAnswer`, `SessionFailureDetails` and the debug panel. It updates through the same scoped live invalidation as the drawer, which reacts to `session_changed` and `processing_changed`, with polling as the fallback. A refresh reads forward with an `after` cursor of per-stream sequence watermarks (the inbox sequence, and the outbox sequence of each attempt), which are gap-free under their locks and so unaffected by commit order, page by page until it catches up, so no entries are skipped when more than one page arrives between reads; older pages already loaded are kept.
- **Scope:** a job outside the batch or the caller's account gets the existing `session_not_found`.

### Stage counts and bar states

- **The fourth stage will change.** BI-022 (`agent-stage-inputs-outputs`, planned) replaces the Inventory agent session with an app-side Match step: a deterministic InvenTree search, a match question, and validation before approval. This change builds the Inventory row on the step counts, not on agent sessions, so the same row shows Match's counts (matched, waiting for you, new) once BI-022 lands. Nothing in this change depends on an Inventory agent.

- **Counts:**
  - The header read's `stepJobs` gains `waiting` (jobs waiting for the operator), `queued` and `questions`.
  - The attention read's `stepWork` gains `waiting` and `queued`.
  - Both gain the batch's live `lots` and, per step, `ready_lots`: distinct live lots with a ready job at that step. Part jobs, which `countSteps` also counts, don't add to `ready_lots`. `lots` is Examine's "lots formed"; Research, Images and Inventory read "`ready_lots` of `lots` lots".
  - Each batch step entry gains `paused`, from `agents/pause.ts`.
  - All are counted in the same queries as the existing counts, in `header/processing.ts` and the attention read.
- **States:** `SegmentState` becomes `done | working | waiting_for_you | paused | queued | not_started | failed`. `processingSegments` derives it in this order:
  1. failed;
  2. working, when `running > 0`, even in a paused batch, because a turn already started finishes;
  3. paused, when the batch is paused and the step isn't done;
  4. waiting for you;
  5. queued;
  6. done, when `ready_lots >= lots` with `lots > 0` for Research, Images and Inventory, or the lead job ready for Examine. A stage with no jobs yet is never done;
  7. otherwise not started.
- **Fill:**
  - The fill is `ready_lots / lots` for Research, Images and Inventory, and Examine's lead job's state for Examine. A step in progress without counts tints the whole segment.
  - `RUNNING_WITHOUT_FRACTION` is removed, so no share is invented (the "Expand work steps" requirement).
  - Each state also has a glyph or pattern, so colour isn't the only cue.
- **Motion:** only `working` animates, with a moving sheen built from the motion tokens. It is still under `media.reducedMotion`.
- **Popover:**
  - 520 px on desktop (`media` above compact), a full-width sheet on a phone.
  - Each stage row is a `Link` to `batchHref(batch, {tab: 'processing', step})`.
  - The status line is the newest `latest_status` among that stage's `active_sessions`, else a reason derived from the counts (queued behind earlier steps, paused at, not started).
  - Resume uses the existing pause route.
- **Rejected:** a timer-based progress estimate. The header spec forbids invented progress.

### Session rows, failures and the Agents page (Fixes page S1–S3, S6)

- **One row per session.** The Agents read pages by attempt, so a job and its retries can fall on different pages, and it carries no archive flag. It becomes a session-level read: it pages by job, ordered by the latest attempt's queue time, and returns each job's current attempt with its earlier attempts (time, state and failure summary), the batch's archived flag, where it ran and its sealed web setting. Needs attention counts come from the same read.
- **Needs attention:** a session whose latest attempt failed, or which is waiting for the operator. A failure followed by a success on the same job doesn't count. Counts are sessions. Batches with nothing needing attention collapse to one line, and archived batches appear only under All.
- **Failures in plain words:**
  - Today the summary (`latestSessionFailures`) carries only category, summary and recovery; the provider error and cause load with the details, in debug mode. The summary gains a sanitized `cause` built on the server from the recorded `provider_error` (#239: kind, result type, HTTP status) and the cause code (#240), so it shows without debug mode under the same read scope. One mapping turns it into a sentence, for example `overloaded_error` + 529 → "Couldn't reach Claude: the API was overloaded (HTTP 529)".
  - The category's advice moves behind a help button. Codes show only in debug mode.
  - Failures recorded before causes existed say the cause wasn't recorded.
- **Rows and actions:** the title links to the drawer on Processing and to the session page from Agents. Failed rows offer Start fresh, Open session, Failure details and Open lot in Review.

### Drawer header, activity feed and message box (S4, S8, O6)

- **Header:** built from the session-level read (task 10): the attempt and agent selection, where it ran, its sealed web setting, its time span and its retry count. It uses the shared time format from `polish-ui-styling-and-loading`.
- **Activity feed:** built from the history entries' app-side summaries (task 6), which already resolve lots and records. Each entry leads with the event and links to its lot; the agent's status line follows as a muted "Agent: …".
- **Status lines:** the opening's `instructions` gain one sentence asking for plain status lines without internal IDs. That text isn't digest-bound, so no profile change is needed.
- **Message box:** labelled "Message <step>", with the placeholder and an Enter / Shift+Enter hint. Send is disabled while the box is empty. It is shared by the drawer and the session page.

## State, authority and failure behavior

| Case | Outcome |
| --- | --- |
| Question superseded or capture changed while drafting | The existing stale banner. The draft is kept with every step; it can't be applied to another question |
| Answer validation fails on the server | 422 `invalid_answer`; nothing recorded. The form shows which step is wrong when the response names it, and otherwise a general message |
| Lost response after commit | Retry with the same key returns the first answer, as today |
| `/1` question open when the change deploys | It keeps answering through `/1`; no migration |
| An agent sends the `/1` shape after deploy | Refused as `validation_failed`, with issues showing the `/2` shape, which the agent can correct (correctable validation already exists) |
| Backdrop click while saving (`closeDisabled`) | Ignored |
| History entry about a retired lot or removed evidence | Details kept from the retained output; the link becomes "Lot retired" / "Photo removed" |
| Live update while older pages are loaded | The page reads forward from its newest entry until caught up and merges by entry ID; older entries prepend at the top and new ones append at the bottom, with no gaps or duplicates |
| A cited URL that no longer resolves | The link opens it anyway; the app makes no claim about it |

Authority is unchanged. Only the operator's answer route writes capture edits. Agents only create questions.

## Verification strategy

- **Contracts unit:** `/2` ask and answer shapes, the limits (steps, options, lengths) and the envelope union decoding both versions.
- **Intake PG tier:**
  - the `ask` handler refusals: duplicate IDs, a number step without a lot, two number steps, a missing assumption;
  - `answerSessionQuestion` `/2`: quantity plus note in one transaction, rollback when the second edit is refused, a combined note over the limit, idempotent retry, and the inbox payload with option IDs and the basis;
  - a `/1` answer still works.
- **Process tier:** the fake CLI asks a three-step question; the operator answers through the API; the session reads the inbox item.
- **Counts (intake PG tier):** `waiting`, `queued`, `questions`, `lots` and `paused` in both reads, including a paused batch, a retired lot and a stage with no jobs yet.
- **Bars and popover (frontend unit):** every state from counts, no fill without counts, only `working` animated, reduced motion, stage rows with links and status lines, Resume.
- **History (intake PG tier):**
  - entry resolution for each kind, including retired lots;
  - pagination with a `before` cursor and no duplicates;
  - scope refusal;
  - a `photo_view` appended only for a delivered fetch, with the budget released when the final transaction refuses;
  - entry IDs and the cursor across retries with repeated sequences and equal timestamps;
  - `web_page` source validation (scheme, length, credentials).
- **History and page (frontend unit):** expand and links per kind; grouping; drawer summary lines; the session page's filters, Load older, the live merge and the not-found state; route parsing and building.
- **Frontend unit:** `Dialog` backdrop (closes; ignored while disabled; a drag from inside doesn't close; the guarded `onClose` path) and `QuestionAnswer` steps (Back and Next, the summary, inline number errors, answer in words, one-step choice, the `/1` fallback, draft pinning across a supersede).
- **Manual:** a demo film of the drawer closing by backdrop and of a stepped question answered with options, one of expanding entries and opening a session page, and one of the activity popover with a working, a waiting and a paused stage. A live agent asking `/2` questions is optional evidence, with Mitch's go-ahead for a live run.

## Migration, rollout and recovery

The only migration is PR-D's, which lets the outbox accept `photo_view`. `/1` rows stay readable and `/2` rows are new. Deploying the server and the frontend together is enough.

Rollback is forward-only once new formats are written. A build before PR-B can't decode retained `/2` question and answer items, and a build before PR-D can't decode `/6` proposals or `photo_view` items, even after every question is closed. Recovery is a fix forward, not a rollback; each PR body says so. PR-B's and PR-D's tests read a database that already holds the new formats with the new build.

## Risks and open decisions

- **Agent-reported URLs could be wrong or invented.** Mitigation: they are always labelled agent-reported, never count as receipts, and Mitch can open them.
- **Photo views add outbox rows.** The image budget bounds them per run; the drawer collapses them.
- **Agents may still pack several questions into one step prompt.** Mitigation: the 500-character prompt limit, the guidance, and steps that make splitting easy. A question-mark heuristic was rejected for false positives.
- **The "Something else" text on a choice reaches the agent but changes no field.** This matches the design note on the canvas.
