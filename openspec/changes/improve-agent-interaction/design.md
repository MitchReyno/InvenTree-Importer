# Design assessment

## Context and grounding

The change touches three layers that already exist. No new service, table or dependency is needed.

| Layer | Today | Evidence |
| --- | --- | --- |
| Dialog | A native `<dialog>` opened with `showModal()`. It closes on `cancel` (Esc) or Close through the owner's `onClose`, and has no backdrop handling | `frontend/src/components/ui/Dialog.tsx`; owners guard unsaved work in `onClose` (`ProcessingWorkspace.tsx`, the drawer) |
| Question contract | `SessionAskArgs` holds one `kind` (`quantity` or `clarification`) and one `prompt`. The retained envelope is `bench-intake-session/1` with the question payload | `contracts/src/sessions.ts`, `intake-server/src/agents/tools/handlers.ts` (`ask`) |
| Answer | `bench-intake-answer/1` holds one value. A session answer becomes one capture edit (a lot quantity or a note), plus an `answer` inbox item and relying-session notices, in one transaction | `intake-server/src/processing/session-answers.ts`, `contracts/src/sessions.ts` (`SessionInboxItem`) |
| UI | `QuestionAnswer` is a single field, validated on submit with a generic message. `DrawerAnswers` pins drafts per question and shows disabled option placeholders | `frontend/src/components/processing/QuestionAnswer.tsx`, `DrawerAnswers.tsx` |

Admission does not pin tool input schemas. Only `agents/tools/server.ts` publishes `inputSchema` from the contract. So the `ask` schema can change for `native-agent/2`, `shared-vm-agent/2` and `shared-vm-agent/3` sessions without a profile bump.

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
- **Not covered:** `RemovalDialog` and `EvidenceGroupPanel` use `DialogSurface` directly with their own lifecycle. They are checked during task 1 and either moved onto the shared handler or left as listed exceptions in notes.

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
- **Rejected:**
  - Separate questions linked by a group ID. They would arrive and be answered piecemeal, which is what made the current flow feel clunky.
  - Free-text prompts with options parsed from them. That can't be validated.
  - A multi-select kind. It isn't requested; it can be added as a new step kind later.

### One transaction, at most two capture edits

`answerSessionQuestion` gains a `/2` branch that does the following:

1. Validates the answer against the stored `/2` spec: one value per step, kinds matching, option IDs known, and "other" only where allowed.
2. Applies a quantity edit for the number step if there is one. At most one number step is allowed per question, because a question has one subject, and the handler enforces it.
3. Applies one note edit, chained on the revision from step 2, joining `prompt — answer` lines for the choice and text steps.
4. Records the answer, marks the question answered, and appends one `answer` inbox item. Its payload is `{question_id, answer_id, steps: [{step_id, value}]}`, a new variant of the inbox payload union, and it carries the option ID and label.
5. Tells relying sessions, as today.

Any refusal rolls back everything. Answers stay idempotent through the existing `answer:<question_id>` key.

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

- **Read:** `readSessionTimeline` becomes `readSessionHistory(batchId, jobId, {before?, limit})`. It returns `SessionHistoryEntry[]` newest first, with a `before` cursor (outbox and inbox sequences merged by time) and `truncated`. The 500-entry read is replaced by pages of 200.
- **Entry:** each `SessionHistoryEntry` holds:
  - `kind` (status, observation, lot, regroup, proposal, question, answer, instruction, evidence, revision, photo_view, web_read, failure);
  - `who` (agent or you);
  - `attempt` (its number);
  - `at`;
  - `summary`, one line;
  - optional `details`, a small typed union per kind (fields with source chips, observations with crop references, step answers, effects);
  - `links`, typed targets (`lot`, `map`, `capture_evidence`, `record`, `question`, `failure`, `external_url`).
- **Resolution:** the server resolves IDs to labels and current or stale state from the same snapshot it already reads, so neither the drawer nor the page needs the whole Processing snapshot. A link to something retired becomes `{kind: 'gone', label: 'Lot retired'}`.
- **Attempts:** each attempt gets a header entry, with why it started (fresh, answer, new evidence, instruction, revise) and how it ended. The page shows these headers; the drawer hides them.
- **Grouping:** this is presentation, done in one shared frontend function. Consecutive entries of the same kind and subject (or photo) are grouped. In the drawer, `photo_view` and `web_read` runs always collapse into one summary line linking to the page.
- **Rendering:** each entry is native `<details>`/`<summary>`. Links are built with the existing `batchHref` helpers, and external URLs open in a new tab with `rel="noreferrer"`.
- **Rejected:** building entries in the frontend from the Processing snapshot. That duplicates resolution in two places, and the page would need snapshots of other batches when reached from the Agents page.

### Photo views are outbox items

- `fetchEvidenceImage` already charges the budget and records delivery in a final transaction. In that transaction it appends an outbox item `photo_view` holding `{evidence_id, version_id, page, region?, delivered: {width, height, media_type, sha256}}`. That is metadata only, never image bytes.
- **Showing the crop:** the only crop route today serves observations (`/api/v1/batches/:batchId/media/observations/:resourceId/crop`). A new route, `GET /api/v1/batches/:batchId/processing/sessions/:jobId/photo-views/:seq/crop`, recuts the recorded region from the same page preview with `media/region-crops.ts`. It returns 404 when the version was removed, and its scope is the same as the history read.
- A refused or budget-exceeded fetch appends nothing.
- **Rejected:** a separate table. The outbox already orders, binds and retains session output.

### Agent-reported web page sources

- A new proposal source kind, `{kind: 'web_page', url, title?, read_at?}`, joins `ProcessingSourceV3`, in a `/6` proposal schema version so `/5` stays exact.
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
- **Message box:** at the bottom; it posts to the existing inbox submission route with an idempotency key. The drawer and the page share the draft-pinning rules, so an answer saved in one shows the other's draft as superseded.
- **Rejected:** option A, a timeline by attempt with chat and answering only in the drawer. These agents mostly act, but Mitch preferred one story in one place; A's filters and attempt dividers are kept.
- The route is `/batches/:id/processing/:step/sessions/:jobId`: a new `{tab: 'processing', step, sessionJobId}` route variant, parsed and built by `batch-route.ts`. The drawer's `?session=` query stays for the drawer.
- **Reuse:** the page uses the batch header, the history renderer, `QuestionAnswer`, `SessionFailureDetails` and the debug panel. It updates live on the same `processing_changed` events as the drawer, re-reading the newest page and keeping older pages already loaded.
- **Scope:** a job outside the batch or the caller's account gets the existing `session_not_found`.

### Stage counts and bar states

- **Counts:**
  - The header read's `stepJobs` gains `waiting` (jobs waiting for the operator), `queued` and `questions`.
  - The attention read's `stepWork` gains `waiting` and `queued`.
  - Both gain `lots` on `examine`: live lots formed.
  - Each batch step entry gains `paused`, from `agents/pause.ts`.
  - All are counted in the same queries as the existing counts, in `header/processing.ts` and the attention read.
- **States:** `SegmentState` becomes `done | working | waiting_for_you | paused | queued | not_started | failed`. `processingSegments` derives it in this order:
  1. failed;
  2. paused, when the batch is paused and the step isn't done;
  3. working, when `running > 0`;
  4. waiting for you;
  5. queued;
  6. done, when `ready >= jobs`;
  7. otherwise not started.
- **Fill:**
  - The fill is `ready / jobs` when counted. A step in progress without counts tints the whole segment.
  - `RUNNING_WITHOUT_FRACTION` is removed, so no share is invented (the "Expand work steps" requirement).
  - Each state also has a glyph or pattern, so colour isn't the only cue.
- **Motion:** only `working` animates, with a moving sheen built from the motion tokens. It is still under `media.reducedMotion`.
- **Popover:**
  - 520 px on desktop (`media` above compact), a full-width sheet on a phone.
  - Each stage row is a `Link` to `batchHref(batch, {tab: 'processing', step})`.
  - The status line is the newest `latest_status` among that stage's `active_sessions`, else a reason derived from the counts (queued behind earlier steps, paused at, not started).
  - Resume uses the existing pause route.
- **Rejected:** a timer-based progress estimate. The header spec forbids invented progress.

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
| Live update while older pages are loaded | The newest page is re-read and merged by sequence; no duplicates |
| A cited URL that no longer resolves | The link opens it anyway; the app makes no claim about it |

Authority is unchanged. Only the operator's answer route writes capture edits. Agents only create questions.

## Verification strategy

- **Contracts unit:** `/2` ask and answer shapes, the limits (steps, options, lengths) and the envelope union decoding both versions.
- **Intake PG tier:**
  - the `ask` handler refusals: duplicate IDs, a number step without a lot, two number steps, a missing assumption;
  - `answerSessionQuestion` `/2`: quantity plus note in one transaction, rollback when the second edit is stale, idempotent retry, and the inbox payload with option IDs;
  - a `/1` answer still works.
- **Process tier:** the fake CLI asks a three-step question; the operator answers through the API; the session reads the inbox item.
- **Counts (intake PG tier):** `waiting`, `queued`, `questions`, `lots` and `paused` in both reads, including a paused batch and a retired lot.
- **Bars and popover (frontend unit):** every state from counts, no fill without counts, only `working` animated, reduced motion, stage rows with links and status lines, Resume.
- **History (intake PG tier):**
  - entry resolution for each kind, including retired lots;
  - pagination with a `before` cursor and no duplicates;
  - scope refusal;
  - a `photo_view` appended only for a delivered fetch;
  - `web_page` source validation (scheme, length, credentials).
- **History and page (frontend unit):** expand and links per kind; grouping; drawer summary lines; the session page's filters, Load older, the live merge and the not-found state; route parsing and building.
- **Frontend unit:** `Dialog` backdrop (closes; ignored while disabled; a drag from inside doesn't close; the guarded `onClose` path) and `QuestionAnswer` steps (Back and Next, the summary, inline number errors, answer in words, one-step choice, the `/1` fallback, draft pinning across a supersede).
- **Manual:** a demo film of the drawer closing by backdrop and of a stepped question answered with options, one of expanding entries and opening a session page, and one of the activity popover with a working, a waiting and a paused stage. A live agent asking `/2` questions is optional evidence, with Mitch's go-ahead for a live run.

## Migration, rollout and recovery

There is no data migration. `/1` rows stay readable and `/2` rows are new. Deploying the server and the frontend together is enough. A rollback to the earlier build would leave open `/2` questions that the old frontend can't render. Before rolling back, answer or close them; this is recorded in the PR body.

## Risks and open decisions

- **Agent-reported URLs could be wrong or invented.** Mitigation: they are always labelled agent-reported, never count as receipts, and Mitch can open them.
- **Photo views add outbox rows.** The image budget bounds them per run; the drawer collapses them.
- **Agents may still pack several questions into one step prompt.** Mitigation: the 500-character prompt limit, the guidance, and steps that make splitting easy. A question-mark heuristic was rejected for false positives.
- **The "Something else" text on a choice reaches the agent but changes no field.** This matches the design note on the canvas.
