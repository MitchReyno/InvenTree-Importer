# Design assessment

## Context and grounding

The change touches three layers that already exist. No new service or table is needed; the only new dependency is `@radix-ui/react-dialog`, for task 1.

| Layer | Before this change | Evidence |
| --- | --- | --- |
| Dialog | A native `<dialog>` opened with `showModal()`. It closed on `cancel` (Esc) or Close through the owner's `onClose`, and had no backdrop handling. Task 1 replaced it with Radix Dialog (see below) | `frontend/src/components/ui/Dialog.tsx`; owners guard unsaved work in `onClose` (`ProcessingWorkspace.tsx`, the drawer) |
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

### Backdrop click through Radix Dialog

- **Decision:** `Dialog` is rebuilt on `@radix-ui/react-dialog` 1.3.1 (Portal, Overlay, Content and Title). Mitch made this decision on 2026-11-23, replacing the earlier plan of a hand-rolled backdrop handler on the native `<dialog>`.
- **Why:** the hand-rolled handler went through four review rounds of pointer and click edge cases (interleaved pointers, rounded click coordinates, exact edges, delayed clicks) and still had one open. Radix's dismissable layer already owns outside-press, Escape, focus trapping and nested layers. The frontend already uses Radix primitives through `@radix-ui/react-popover` 1.3.1, and Dialog 1.3.1 pins the same shared primitive versions, so it adds one package.
- **Guards:** `onEscapeKeyDown` and `onInteractOutside` call `preventDefault()` while `closeDisabled` is set; otherwise Radix's `onOpenChange(false)` calls the owner's `onClose`, so the drawer's unsaved-answer banner applies to Esc, Close and the backdrop alike. Radix dismisses on the click that follows a press outside the content, and a press that starts inside the dialog's React tree never counts.
- **Focus:** the dialog records its opener before Radix moves focus: the control clicked to open it, since Safari does not focus a clicked button, or else the focused element. Focus returns there, or to `returnFocus`, from `onCloseAutoFocus`, unless the owner already moved focus elsewhere. Initial focus is placed as the surface mounts, before its content's Effects run, as `showModal()` did, so the drawer's move to its next question is not mistaken for the operator moving focus.
- **Layering:** the native modal sat in the browser's top layer; the Radix overlay and content take a new `z-dialog` token above `z-toast`, so an open modal covers the inert page and its toasts. A popover opened inside a dialog portals into the dialog's surface, so it stacks above the dialog and stays in its focus scope.
- **Why not `closedby`:** `closedby="any"` is not in Safari ([caniuse](https://caniuse.com/wf-dialog-closedby), checked 2026-11-23).
- **Scope:** this applies to every `Dialog`, including centred editors. Their owners already treat Esc as a close request with their own guards, so a backdrop click follows that.
- **Rejected:** a drawer-only option. It would leave centred dialogs inconsistent, and the spec makes it a design-system rule. The hand-rolled handler, for the reasons above.
- **Direct surface users:** `MediaCropDialog` was the one component with its own native `<dialog>` lifecycle. It moves onto the same Radix layer (`ModalFrame`), so there is one modal system: a native modal and Radix layers don't stack. The crop editor ignores Esc, and its Discard and close button drops even an unconfirmed request, so the backdrop click follows neither: an unsent or confirmed view closes, including after a retry is confirmed, a sending request stays open until it settles, and an unconfirmed one stays open with its retry and discard controls.

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

A number step accepts either a `number` value or, answered in words, a `text` value; every other step takes the value of its own kind.

- **Validation:** step IDs and option IDs are unique, which the handler checks because TypeBox can't. A step prompt is at most 500 characters, so prompts stay one question long. A question title (up to 120 characters) labels a stepped question in Needs you; a one-step question uses its prompt.
- **The tool's schema:** `ask` takes `SessionAskArgsV2`. The handler stores it in the envelope under a new `kind: 'question'` payload variant, so the envelope union reads both `/1` and `/2` payloads. Four steps of multibyte or escaped text can pass the field limits yet exceed the 32,768-byte limit on a stored envelope (`processing_message`, migration 0006), so the shared envelope writer in `agents/tools/handlers.ts` measures every sealed envelope before inserting it and refuses an oversized one as a correctable tool error, which covers `/6` proposals with long web URLs too.
- **The read model:** the question DTO's `spec` today requires one `quantity` or `clarification` kind and one prompt, which a `/2` question can't fill. The DTO becomes a union discriminated by version: both variants share the ID, job, attempt, revision, state, `subject_id` and `fields`; only the `/1` variant keeps `spec`, and the `/2` variant carries its title, reason and stored steps. Each question's content is sent once, so the snapshot stays within `requireRoom`'s per-question budget (`agents/tools/handlers.ts`), which counts the retained bytes once plus a fixed projection allowance. A pure contracts function, `questionView`, derives the normalised view `{version, title, reason, steps[]}` from either variant where it is read: a `/1` question's view is one step (`quantity`→number, `clarification`→text) carrying its original kind, so the frontend has one renderer, and Review, Inventory and the attention projection read the view; `subject_id` moves out of `spec`, so its readers (`frontend/src/operator/review-model.ts` and `attention/projection.ts` among them) read the shared field. A question from an earlier runner profile has no assumption or `fields`, and its view says so rather than inventing them. A `/1` question is still answered with `bench-intake-answer/1`.
- **Delivery:** today's form reads `question.spec.kind` and `prompt` and always sends `/1`, so it can't answer a `/2` question. The contracts, the server path and the new form therefore ship in one PR (PR-B), and no build asks `/2` questions without the form that answers them.
- **Rejected:**
  - Separate questions linked by a group ID. They would arrive and be answered piecemeal, which is what made the current flow feel clunky.
  - Free-text prompts with options parsed from them. That can't be validated.
  - A multi-select kind. It isn't requested; it can be added as a new step kind later.

### One transaction, at most two capture edits

`answerSessionQuestion` gains a `/2` branch that does the following:

1. Validates the answer against the stored `/2` spec: one value per step, each value of its step's kind or, for a number step, text in words; option IDs known; and "other" only where allowed.
2. Applies a quantity edit for the number step if there is one. At most one number step is allowed per question, because a question has one subject, and the handler enforces it. A question with a number step must list `quantity` in its `fields`, so the existing `fieldsSuperseded` path marks proposals relying on the quantity stale. As in `/1`, the edit sets the lot's quantity value; the counted or estimated basis is kept in the stored answer and the inbox item.
3. Applies one note edit, chained on the revision from step 2, joining `prompt — answer` lines for the choice and text steps, and for a number step answered in words.
4. Records the answer, marks the question answered, and appends one `answer` inbox item. Its payload is `{question_id, answer_id, steps: [{step_id, value}]}`, a new variant of the inbox payload union, and it carries the option ID and label.
5. Tells relying sessions, as today.

The locked capture edit handle (`lockCaptureForEdit` in `capture/repository.ts`) allows one `apply` today and checks it against the revision it locked. It gains an ordered form that applies each edit under the same lock, checks each against the revision the previous one produced, and publishes once. The note must fit the 8192-character capture note limit, and the `answer` inbox payload the 32,768-byte limit of migration 0030, which escaped characters can exceed while the note fits. The limit is checked as the constraint measures it, `octet_length($payload::jsonb::text)` in PostgreSQL inside the transaction, before either edit. Either overrun is refused as `invalid_answer`, naming the step for the note.

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

- **Read:** `readSessionTimeline` becomes `readSessionHistory(batchId, jobId, {before?, limit})`. Without `before` it returns the newest page; with it, the next older page. Each page holds up to 200 stored inbox and outbox rows as `SessionHistoryEntry[]`, newest first, with one opaque `before` cursor when older rows exist. There is no forward read.
- **One snapshot:** the page, its cursor and the session metadata come from one repeatable-read transaction, so they agree with each other.
- **Session metadata:** the same scoped read returns the session's header data: each attempt's number, state, queue time and, once the attempt has ended, its end time, plus the agent selection and model, where it ran, its sealed web setting from the attempt's input manifest, the attempts' failures and the inbox acknowledgement cursor. Every read returns it whole, so it is current after any read. The page header doesn't wait for the Agents read. The per-stream 500-entry read is replaced by merged pages of 200.
- **Attempt times:** `started_at` and `finished_at` on the session row change with every turn (`recordSessionProgress` sets them at each `starting` and `settled`), so neither is an attempt's first start. An attempt's span runs from its `queued_at` to its end, and a live attempt shows no end. Idle cancellation, supersession by Start fresh and the retirement of `shared-vm-agent/2` attempts end an attempt without writing `finished_at`. An attempt's end therefore comes from `processing_transition` (the trigger in migration 0006 records every attempt state change), not the session row: while the attempt's current state is ended, its end is the latest transition into that state. A finished attempt can be resumed and end again, so an earlier turn's end is never used, and a live attempt shows no end. That is its logical end; a worker still holding its slot is shown by the slot, not by the span. An attempt with no terminal transition retained shows its last recorded activity, labelled as such.
- **Identity and order:** outbox sequences restart with each attempt and inbox sequences run per job, so a sequence alone is ambiguous. Each entry's ID is its stream, owning attempt (outbox only) and sequence. Entries have one total order: `created_at`, then stream, attempt and sequence. The `before` cursor encodes the oldest row on the page in that order, so equal timestamps and repeated sequences across retries page without gaps or duplicates within one chain of Load older reads.
- **Entry:** each `SessionHistoryEntry` holds:
  - `kind` (status, observation, lot, regroup, proposal, question, answer, instruction, evidence, revision, chat, reply, photo_view, web_read, failure);
  - `who`, per inbox kind and append path rather than by `actor_id` alone, because the database requires a null actor on every inbox kind except `answer` and `chat` (migration 0030): an answer or chat is yours, from its actor; an instruction is yours, relayed from the saved batch instruction it carries; like every entry it is placed by its inbox row's time, the one timestamp the cursor orders by, and its details show when the instruction was saved and say it was relayed when sent again to a later attempt; an `evidence` or `revision` notice is the app's, describing the change it reports (new photos from Capture, a correction, or a lot's identity revised by another session, `processing/stable-identity.ts`);
  - `attempt`, the owning attempt's number for an outbox entry, or absent for an inbox entry, which belongs to the job;
  - `at`;
  - `summary`, one line;
  - optional `details`, a small typed union per kind (fields with source chips, observations with crop references, step answers, effects);
  - `links`, typed targets (`lot`, `map`, `capture_evidence`, `record`, `question`, `failure`, `external_url`).
- **Resolution:** the server resolves IDs to labels and current or stale state from the same snapshot it already reads, so neither the drawer nor the page needs the whole Processing snapshot. A link to something retired becomes `{kind: 'gone', label: 'Lot retired'}`. A proposal's provisional links use the same predicate as `proposalCurrentness` in `processing/read.ts` (open questions of current attempts on the same subject sharing a field, with stale taking precedence).
- **Refreshing:** the browser does not see event types: `LiveUpdates` turns every `changed` frame into an invalidation of the scoped reads. On each invalidation or poll, the drawer and the page re-read the newest page. Its entries replace held entries with the same ID, which refreshes their resolved details (for example a proposal's provisional links after a question in another job is answered), and the session metadata is replaced. Held entries older than the new page's cursor are kept, including those that dropped off the end of the previous newest page, so one new entry never pushes an entry out of view. If the new page's oldest entry is newer than the newest held entry, because more than a page arrived between reads, the held entries are dropped and Load older continues from the new page's cursor, so a burst of new entries never leaves a gap. Held entries outside the newest page are not re-resolved until they are loaded again.
- **Detail sources:** the outbox keeps IDs, so details come from the records they name:
  - an observation from its observation row, labelled as its current values, since an agent's revision of an observation can overwrite its region, readings and count under the same ID (`capture/evidence-observations.ts`); a revision that supersedes it with a new row keeps the old row, which is shown;
  - a lot from its capture record (observations, the separation note, the selected quantity and, separately, the agent's estimate with its basis), labelled as its current values, since the outbox keeps no snapshot of the lot as formed. An operator's quantity edit changes the selected quantity without touching the agent's estimate, so a basis is shown only beside the estimate it describes;
  - a regroup from its moves: `regroup` in `capture/evidence-observations.ts` applies some moves and only suggests others (onto an edited lot or observation) in the same call, so it returns each move's outcome, and the outbox payload gains `moves` (observation, from lot, to lot, applied or suggested) for new entries, while older entries kept only the destination lots (`lot_ids` from each move's `to_lot_id`) and list those;
  - a proposal or question from its retained row. A proposal always has its summary and proposal-level sources; its structured catalogue block, and so field-level chips, a package or a Part to link, is optional and shown only when retained;
  - a failure from the attempt's retained failure, for every attempt, not only the latest;
  - where a detail isn't retained, the entry says so rather than showing current values as history.
- **Attempts and turns:** each attempt gets a header entry with how it ended. Attempts record no reason for starting, so the header derives one only where the retained input can be attributed to that attempt (a revise request, a retry after a failure, or the first attempt) and otherwise says only "Attempt N". A failure or resume can change an attempt without any new inbox or outbox item, so attempt headers and failures are built from the session metadata, which every read returns whole, keyed by attempt ID, rather than paged with the entries. Further turns within one attempt, started by an answer, chat or new evidence, are not attempts and get no divider; the history does not claim which input started a turn. The page shows the attempt headers; the drawer hides them.
- **Grouping:** this is presentation, done in one shared frontend function. Consecutive action entries of the same kind about the same subject or photo are grouped; observations from different photos stay separate. In the drawer, a run of `photo_view` and `web_read` entries, mixed or not, collapses into one summary line linking to the page.
- **Inputs and attempts:** the inbox keeps one acknowledgement cursor per job, so which attempt read an input isn't retained. Inputs are placed by submission time, and an attempt divider by the attempt's queue time, without claiming which attempt consumed an input queued before a Start fresh. An input above the job's acknowledgement cursor shows as "Not read yet", and one at or below it as read by the session; the cursor records that the session acknowledged the item, not what the provider did with it. `read_inbox` today advances the cursor without a batch event, so task 6 makes it publish `session_changed` in the same transaction whenever the cursor moves, and an open drawer or page re-reads.
- **Rendering:** each entry is native `<details>`/`<summary>`. Links are built with the existing `batchHref` helpers, and external URLs open in a new tab with `rel="noreferrer"`.
- **Simplified on 2026-11-23:** an earlier draft kept the page live by reading forward from per-stream sequence watermarks, re-resolving held entries by ID and splicing new entries into time order. Six review rounds kept finding ways it could skip or repeat entries, so Mitch chose this snapshot-plus-older-pages read instead. The accepted trade-off is a brief re-read of the newest page on each change rather than an incremental merge, older pages whose details aren't refreshed until reloaded, and a slow write that can sort behind rows already shown until the page is next opened.
- **Rejected:**
  - building entries in the frontend from the Processing snapshot. That duplicates resolution in two places, and the page would need snapshots of other batches when reached from the Agents page;
  - the earlier forward, watermark-based live merge, for the reasons in the previous point.

### Photo views are outbox items

- **Recording:** `fetchEvidenceImage` ends with a final transaction that reads removal and the capability without locks, then charges the in-memory image budget after it. The budget check and reservation move before that transaction. The transaction takes the batch lock and then the job, attempt and session rows in the global lock order (`intake-server/ARCHITECTURE.md`), and re-checks removal and the full predicate the other tools use through `withSession` in `handlers.ts` (a valid capability, the attempt running and still the job's current attempt), not `resolveSessionCapability` alone, since cancellation or supersession can change the attempt before the worker revokes the token. A removal, revocation, cancellation or supersession therefore either commits first and refuses the fetch or waits until the view is recorded. The transaction then appends an outbox item `photo_view` holding `{evidence_id, version_id, page, region?, delivered: {width, height, media_type, sha256}}`: metadata only, never image bytes. The same transaction publishes `session_changed`, as status and reply items do, so a photo-only fetch reaches open drawers and pages. If the transaction returns a refusal, or fails before its commit is sent, the reservation is released and no image is returned. If the commit's outcome is unknown, the reservation is kept and no image is returned, and the tool returns a distinct result saying the outcome is uncertain, rather than the MCP wrapper's generic "changed nothing" error (`agents/tools/server.ts`). To tell the two apart, the handler notes when the transaction's work has returned: a throw before that is a known rollback, and a throw after it, from `COMMIT`, is an unknown outcome. A view therefore records a fetch that was authorized and prepared for the tool response. The response can still be lost, an unknown commit can leave a view for an image that was withheld, and a view never claims the provider read the image.
- **Migration:** the outbox `kind` check (migration 0018) doesn't allow `photo_view`, so a migration extends it.
- **Showing the crop:** the only crop route today serves observations (`/api/v1/batches/:batchId/media/observations/:resourceId/crop`). A new route, `GET /api/v1/batches/:batchId/processing/sessions/:jobId/photo-views/:attemptId/:seq/crop`, recuts the recorded region from the same page preview with `media/region-crops.ts` and bounds it as the handler did. The delivered image was re-encoded once more, so the result is a reconstruction: the page shows the recorded delivered size and digest beside it and doesn't claim the bytes match. It returns 404 when the version was removed, and its scope is the same as the history read.
- A refused or budget-exceeded fetch appends nothing.
- **Rejected:** a separate table. The outbox already orders, binds and retains session output.

### Agent-reported web page sources

- A new proposal source kind, `{kind: 'web_page', url, title?, read_at?}`, is accepted in a `/6` session proposal's top-level `sources` only, beside the `ProcessingSource` kinds that `/5` uses, so `/5` stays exact. It can't appear in `relies_on` or catalogue sources.
- **Delivery check:** the handler's delivered-citation check skips `web_page` sources, the one kind not delivered by the app. The retained decoder (`retainedSessionProposal` in `processing/retained.ts`), which the Processing snapshot uses and which validates `/5` and rechecks delivery, accepts `/5` and `/6` and applies the same exception only to `/6` top-level `web_page` sources. "Bounded status lines and delivered citations" is modified to state this exception. BI-017's delta already tells VM agents to cite web facts by URL; this gives that a place.
- **Validation:** the URL must be absolute `http(s)`, at most 2048 characters, with no credentials in the URL.
- **Display:** the history derives a `web_read` entry from each cited URL, deduplicated per attempt and linked to the first proposal in that attempt that cites it. Its ID is the citing proposal entry's ID plus the URL's position in that proposal's sources. A derived entry travels with its proposal and doesn't count toward the 200-entry page, which counts stored inbox and outbox rows. Source chips show "Web page" with the warn style and "agent-reported".
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
- **Command context:** answering in place needs the current question revision, attempt, digest and capture revision. The page mounts the batch's scoped Processing read for them and reuses the workspace's command guard (`commandReadAvailable` in `ProcessingWorkspace.tsx`), extracted into a shared hook: commands wait for a successful read by this mounted page, not cached data, and stay disabled while the batch is archived, a command is in flight, its refresh is pending, or the query is paused. A paused query (offline) is distinct from a paused batch, which still accepts answers.
- **Message box:** at the bottom; it posts to the existing inbox submission route with an idempotency key. The drawer and the page share the draft-pinning rules, so an answer saved in one shows the other's draft as superseded.
- **Rejected:** option A, a timeline by attempt with chat and answering only in the drawer. These agents mostly act, but Mitch preferred one story in one place; A's filters and attempt dividers are kept.
- The route is `/batches/:id/processing/:step/sessions/:jobId`: a new `{tab: 'processing', step, sessionJobId}` route variant, parsed and built by `batch-route.ts`. The drawer's `?session=` query stays for the drawer.
- **Reuse:** the page uses the batch header, the history renderer, `QuestionAnswer`, `SessionFailureDetails` and the debug panel. It updates through the same scoped live invalidation as the drawer, with polling as the fallback, by re-reading the newest page as described under Refreshing. The photos and sources panels are built from the loaded entries, not a separate read, and say when older entries remain to load.
- **Scope:** a job outside the batch or the caller's account gets the existing `session_not_found`.

### Stage counts and bar states

- **The fourth stage will change.** BI-022 (`agent-stage-inputs-outputs`, planned) replaces the Inventory agent session with an app-side Match step: a deterministic InvenTree search, a match question, and validation before approval. This change builds the popover's Inventory row on the step counts, not on agent sessions, so the row needs no Inventory agent. Today the step key and route are fixed to `inventory` and its count comes from ready Processing jobs; BI-022 supplies the Match step's key, route and count projection (matched, waiting for you, new), which the row then shows. The Inventory session drawer requirement in this change still applies while the Inventory agent exists.

- **Counts:**
  - The header read's `stepJobs` gains `waiting` (jobs waiting for the operator), `queued`, `questions` and `failed`. The work projection lists only active jobs for batches other than the open one, so the popover can't see a failure without this count.
  - The attention read's `stepWork` gains `waiting` and `queued`.
  - Both gain the batch's live `lots` and, per step, `ready_lots`: distinct live lots with a ready job at that step. Part jobs, which `countSteps` also counts, don't add to `ready_lots`. `lots` is Examine's "lots formed"; Research, Images and Inventory read "`ready_lots` of `lots` lots".
  - Each batch step entry gains `paused`, from `agents/pause.ts`. `batch_steps` holds at most five batches, chosen from the open batch and those with active work, so the header read also gains `paused_batches`: the scoped paused batches, the open one first, up to 20 with a `truncated` flag, each with its name, whether or not it has jobs.
  - All are counted in the same queries as the existing counts, in `header/processing.ts` and the attention read.
- **States:** `SegmentState` becomes `done | working | waiting_for_you | paused | queued | not_started | failed`. `processingSegments` derives it in this order:
  1. failed;
  2. working, when `running > 0`, even in a paused batch, because a turn already started finishes;
  3. paused, when the batch is paused and the step isn't done;
  4. waiting for you;
  5. queued;
  6. done, when `ready_lots >= lots` with `lots > 0` for Research, Images and Inventory, or the lead job ready for Examine. A stage with no jobs yet is never done;
  7. otherwise not started.

  A stage the read doesn't count keeps today's fallback to its retained jobs' states, which `retainedState` maps to the new states (running to working, waiting for the operator to waiting for you, queued to queued), so an uncounted stage isn't drawn as not started.
- **Fill:**
  - The fill is `ready_lots / lots` for Research, Images and Inventory, and Examine's lead job's state for Examine. A step in progress without counts tints the whole segment.
  - `RUNNING_WITHOUT_FRACTION` is removed, so no share is invented (the "Expand work steps" requirement).
  - Each state also has a glyph or pattern, so colour isn't the only cue.
- **Motion:** only `working` animates, with a moving sheen built from the motion tokens, and only while the read it comes from is fresh and available. Rows kept from a failed or stale read, and an open batch whose state comes from cached attention counts that aren't current, are drawn still. It is still under `media.reducedMotion`.
- **Popover:**
  - 520 px on desktop (`media` above compact), a full-width sheet on a phone.
  - Each stage row is a `Link` to `batchHref(batch, {tab: 'processing', step})`.
  - The status line is the newest `latest_status` among that stage's `active_sessions` whose attempt is the job's current one (a `current` flag task 8 adds) and not cancelled or superseded, else a reason derived from the counts (done, queued behind earlier steps, paused at, not started). `active_sessions` holds only queued, running, waiting or slot-holding sessions, up to 50, so a finished stage or one whose sessions fall outside that list shows the reason, not an older agent line. A cancelled or superseded attempt still holding a slot stays in the occupancy details but never supplies a stage's status line.
  - Resume uses the existing pause route. Pause all can pause a batch with no jobs, which today's popover, grouping by work items and sessions, wouldn't show; every batch in `paused_batches` gets a group with Resume, the open batch included; when the list is truncated, the popover says so and links to the Agents page, where Pause all and Resume all already live.
- **Rejected:** a timer-based progress estimate. The header spec forbids invented progress.

### Session rows, failures and the Agents page (Fixes page S1–S3, S6)

- **One row per session.** The Agents read pages by attempt, so a job and its retries can fall on different pages, and it carries no archive flag. It becomes a session-level read: it pages by job, ordered by the latest attempt's queue time, and returns each job's current attempt with its earlier attempts (time, state and failure summary), the batch's archived flag, where it ran and its sealed web setting. The read takes the selected filter and applies it before paging, and returns scoped counts per chip and per batch across every matching job, so a session that needs attention is found and counted even when it is older than the first page of all sessions. Today the page compares `finished_at` with the browser's calendar day, so the browser sends its local day's start and end instants with every request, since every chip shows a count, and the server uses them both to count Done today and to filter by it. A session is done today when its current attempt is in an ended state (ready, failed, cancelled, superseded or interrupted, the states today's filter treats as finished) and that attempt's logical end, from `processing_transition` as described under Attempt times, falls within those bounds; `finished_at` isn't used, because idle cancellation and supersession leave it stale or unset. A transition's `created_at` defaults to `now()`, the ending transaction's start, so an end whose transaction waited on a lock across midnight is dated to the earlier day; that limit is accepted. Working holds sessions whose current attempt is running; a stopped attempt still holding a slot, which today's Running chip includes through `occupies_lane`, counts only in the slot total. Slot use, the queued and waiting totals, and each batch's first start (the earliest retained `processing_transition` to `running` among its attempts, since `started_at` is rewritten on every turn) are counted across every session in scope regardless of the filter and page, because Settings' `SlotMeter` and the Processing overview's start time read them from this list today, and a batch summary lists every batch in scope with its matching count, so a batch with none collapses to one line. The read also takes an optional batch scope: Processing's session list reads it for its batch under All, with Load more past one page, so its rows have their earlier attempts even outside the Agents page's first page. A step card, which renders from the snapshot and may be beyond any loaded page of that list, expands its earlier attempts from task 6's job-scoped history metadata, which already carries each attempt and its failure.
- **Needs attention:** a session whose current attempt failed, was interrupted (including one that can't resume) or waits for sign-in, which today's UI already treats as needing recovery, or which is waiting for the operator's answer. The server applies this filter. A failure followed by a success on the same job doesn't count. Counts are sessions. Batches with nothing needing attention collapse to one line, and archived batches appear only under All.
- **Failures in plain words:**
  - Today the summary (`latestSessionFailures`) carries only category, summary and recovery; the provider error and cause load with the details, in debug mode. The summary gains a sanitized `cause` built on the server from the recorded `provider_error` (#239: kind, result type, HTTP status) and the cause code (#240), so it shows without debug mode under the same read scope. The summary also carries the failed attempt's last status line and its time, so the row, drawer and page show them when that status is beyond the newest history page. One mapping turns it into a sentence, for example Claude's `overloaded` with HTTP status 529 → "Couldn't reach Claude: the API was overloaded (HTTP 529)"; the status is added only when it was recorded.
  - The category's advice moves behind a help button. Codes show only in debug mode.
  - Failures recorded before causes existed say the cause wasn't recorded.
- **Rows and actions:** the title links to the drawer on Processing and to the session page from Agents. Failed rows offer Start fresh, Open session, Failure details and Open lot in Review.
- **Start fresh eligibility:** `replaceSession` (`processing/session-replacement.ts`) refuses a state that isn't replaceable, a slot held by any attempt of the job, a stale pinned identity and, for Inventory, stale predecessors; an archived batch or retired lot is refused too, and so is media that can't be reserved (`MediaInputUnavailableError`, `media/inputs.ts`: linked evidence still preparing, or more versions than one input holds), an unsupported or retired profile, a step with no enabled agent selection in today's settings (`agent_settings_required`) a new input over its size limit (`processing_input_capacity`), both in `processing/session-attempts.ts`, and an unconfigured processing channel (`processing_channel_unconfigured`, `channelToken` in `processing/attempts.ts`), which the command meets only after its first insert and today rolls back. Neither the Agents read nor the Processing snapshot carries these, and today's Processing button doesn't check them. A read-only preflight extracted from the command, which makes every refusal check the command makes before its first write, including resolving media and settings and sizing the new input, gives a `start_fresh` eligibility (allowed, or the refusal code) on the session-level read's rows, the history metadata and each job of the batch-scoped Processing snapshot, since Processing's step cards render from the snapshot's jobs, which may be on neither of the other reads. Rows, the drawer's existing Start fresh button and the session page show Start fresh disabled with the reason where it isn't allowed. The command stays authoritative and rechecks in its transaction. Saving agent settings in this tab invalidates the scoped reads that carry eligibility. Settings are not on a batch's event stream, so another tab keeps its eligibility until its next refresh; there a stale Start fresh is refused with its reason, and the refusal refreshes the reads (accepted trade-off: adding settings to every batch stream is wider than this change). It needs the job and capture revisions, so on the Agents page Start fresh opens the session page, which runs it under its mounted Processing read and the shared command guard. Opening failure details never starts a retry.

### Drawer header, activity feed and message box (S4, S8, O6)

- **Header:** built from task 6's job-scoped history metadata, not the filtered and paged Agents read, so a drawer opened from Processing has it for any session: the attempt and agent selection, where it ran, its sealed web setting, its time span and its retry count. The earlier failures' plain-words causes come from task 10's failure summary. It uses the shared time format from `polish-ui-styling-and-loading`.
- **Activity feed:** today it takes the six newest status lines across the batch from the Processing snapshot, while task 6's history read covers one job. Task 11 adds a bounded batch read, `readBatchActivity(batchId, limit)`, returning the newest action entries across every job in the batch with the same resolver as task 6, in one query per entry kind, so the feed needs no per-session fan-out. Each entry leads with the event and links to its target from the same resolver: its lot or record, or Capture and the map for an observation made before any lot exists; the job's latest status line, from its current attempt as `latestStatuses` selects it today, follows as a muted "Agent: …" note, and none follows when the current attempt has none yet, as after a Start fresh.
- **Status lines:** the opening's `instructions` gain one sentence asking for plain status lines without internal IDs. That text isn't digest-bound, so no profile change is needed. Only sessions opened after the change get it: a resumed session continues its earlier conversation, and retained status lines are shown as written. The ID-free promise therefore covers the app's own event text; the muted agent note is the agent's words.
- **Message box:** labelled "Message <step>", with the placeholder and an Enter / Shift+Enter hint. Send is disabled while the box is empty. It is shared by the drawer and the session page.

## State, authority and failure behavior

| Case | Outcome |
| --- | --- |
| Question superseded or capture changed while drafting | The existing stale banner. The draft is kept with every step; it can't be applied to another question |
| Answer validation fails on the server | 422 `invalid_answer`; nothing recorded. The error body gains an optional `step_id`, which the client keeps on `IntakeRequestError`. A confirmed refusal clears the pinned submission, so the draft stays editable, and the form marks the named step, or shows a general message. An uncertain failure keeps the original payload and key, as today |
| Lost response after commit | Retry with the same key returns the first answer, as today |
| `/1` question open when the change deploys | It keeps answering through `/1`; no migration |
| An agent sends the `/1` shape after deploy | Refused as `validation_failed`, with issues showing the `/2` shape, which the agent can correct (correctable validation already exists) |
| Backdrop click while saving (`closeDisabled`) | Ignored |
| History entry about a retired lot or removed evidence | Details kept from the retained output; the link becomes "Lot retired" / "Photo removed" |
| Live update while older pages are loaded | The page re-reads the newest page and replaces it, keeping loaded older pages de-duplicated by entry ID; if the new page doesn't reach them, they are dropped and Load older starts again from the new page |
| A row committed after a page that should hold it by time was read | `created_at` is the transaction's start time, so a slow write can sort behind rows already shown. It appears when the newest page is next re-read if it falls within it, and otherwise when the page is next opened |
| A cited URL that no longer resolves | The link opens it anyway; the app makes no claim about it |

Authority is unchanged. Only the operator's answer route applies capture edits from a question's answer; agents create the questions.

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
  - a `photo_view` appended only for a delivered fetch, with the budget released when the final transaction refuses, including a removal or revocation racing the final transaction;
  - entry IDs and the `before` cursor across retries with repeated sequences and equal timestamps, and the page, cursor and metadata taken from one snapshot;
  - attempt headers updated by a failure or resume with no new inbox or outbox item;
  - a proposal's provisional links when two open questions match it;
  - the batch activity read returning the newest entries across several jobs;
  - `web_page` source validation (scheme, length, credentials).
- **History and page (frontend unit):** expand and links per kind; grouping; drawer summary lines; the session page's filters, Load older, the newest-page refresh keeping older pages without duplicates, dropping them when the new page doesn't reach them, and the not-found state; route parsing and building.
- **Frontend unit:** `Dialog` backdrop (closes; ignored while disabled; a drag from inside doesn't close; the guarded `onClose` path) and `QuestionAnswer` steps (Back and Next, the summary, inline number errors, answer in words, one-step choice, the `/1` fallback, draft pinning across a supersede).
- **Manual:** a demo film of the drawer closing by backdrop and of a stepped question answered with options, one of expanding entries and opening a session page, and one of the activity popover with a working, a waiting and a paused stage. A live agent asking `/2` questions is optional evidence, with Mitch's go-ahead for a live run.

## Migration, rollout and recovery

The only migration is PR-D1's, which lets the outbox accept `photo_view`. `/1` rows stay readable and `/2` rows are new.

The session worker is a separately supervised process: it hosts the tool server that publishes the `ask` schema and reads retained inbox and outbox items, and it refuses to start when the applied migrations differ from its build's (`compatibleSchema` in `operations/compatibility.ts`). Deploying PR-B, PR-D1 or PR-D2 therefore stops the session worker first, applies any migration, and then starts the API, the worker and the frontend from the same build, so no old worker serves the old `ask` schema or reads `/2` answers and photo views it can't decode. Each PR body states these steps.

A browser tab opened before the deploy still runs the old frontend, which can't decode `/2` questions, `/6` proposals, photo views or regroups with `moves`. The app has no build-version check, so its contract validation fails and the read shows the existing unavailable state rather than a wrong form. The rollout steps end with reloading open tabs, and each PR records a manual check with a tab opened before the deploy.

Rollback is forward-only once new formats are written. A build before PR-B can't decode retained `/2` question and answer items, a build before PR-D1 can't decode `/6` proposals or `photo_view` items, and a build before PR-D2 can't decode regroup items that carry `moves`, even after every question is closed. Recovery is a fix forward, not a rollback; each PR body says so. PR-B's, PR-D1's and PR-D2's tests read a database that already holds the new formats with the new build.

## Risks and open decisions

- **Agent-reported URLs could be wrong or invented.** Mitigation: they are always labelled agent-reported, never count as receipts, and Mitch can open them.
- **Photo views add outbox rows.** The image budget bounds them per run; the drawer collapses them.
- **Agents may still pack several questions into one step prompt.** Mitigation: the 500-character prompt limit, the guidance, and steps that make splitting easy. A question-mark heuristic was rejected for false positives.
- **The "Something else" text on a choice reaches the agent but changes no field.** This matches the design note on the canvas.
