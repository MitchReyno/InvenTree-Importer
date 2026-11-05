# Design assessment

## Context and grounding

This change crosses Processing, Agents, Capture, Media, contracts and the frontend. **Complexity: XL.** It changes the agent execution model, from one call returning one result to a long-lived session with typed messages in both directions, and that change passes through currentness, capacity and capture authority. Existing patterns are reused wherever their guarantees still hold.

| Area | Today (evidence) | After |
| --- | --- | --- |
| Agent turn | One `claude -p` / one Codex thread+turn, structured output, `--no-session-persistence`, `--tools ""`, empty MCP (`agents/claude.ts`, `agents/codex.ts`) | A resumable session whose only tools come from the app-owned MCP server; results flow through tool calls |
| Result contract | Exactly one proposal **or** question (`agents/prompt.ts`) | An ordered outbox: status, lot, proposal, question, reply |
| Capacity | DBOS `bench-research` queue `workerConcurrency: 1, globalConcurrency: 1` plus an actor lane (`agents/worker-main.ts`, `processing/ARCHITECTURE.md`) | N session slots read from settings (default 3); waiting sessions hold no slot |
| Inputs | Sealed manifest per attempt; a change within the attempt's scoped input closure (its subject, linked Part and their media) makes it noncurrent, while unrelated subjects and agent-default changes do not | Sealed opening manifest plus an append-only session context log; currentness judged per proposal |
| Stages | `reading → identifying → research → images → inventory` (`processing/model.ts`) | `/2` profile: one batch-level `examine` lead session (find observations ⇄ group into lots ⇄ identify); per-lot `{research ∥ images} → inventory` |
| Subjects | Created only by operator capture edits (`add_lot`) | The Examine lead session also creates observations (photo regions, document lines) and draft lots built from them, through the same edit validation, attributed to the session |
| Live UI | `bench-intake-live/1` WebSocket hints, followed by scoped retained reads (`contracts/src/live.ts`) | Same mechanism, with new hint topics for session outbox/inbox and lots |

The proposal's reuse assessment carries forward unchanged: CLI adapters, the official MCP TypeScript SDK, PostgreSQL inbox/outbox, DBOS for waking, and the existing live hints.

## Goals and constraints

- **Goals:** satisfy the requirements in `processing-agent-sessions`, `processing-lot-forming`, `processing-stage-pipeline` and the `header-workflow-status` delta.
- **Constraints:**
  - Keep existing profiles' bytes and behavior.
  - No new agent capability beyond the listed tools.
  - Human values, approval and inventory effects stay human.
  - Every claim about provider behavior stays `native_unverified` until separately authorized live qualification.

## Decisions and alternatives

### D1. New profile `native-agent/2`, not an in-place upgrade

`native-agent/2` adds handler `processing/5`, input `bench-intake-input/6`, command `/5` and a session envelope protocol. `synthetic-session/1` is its deterministic fixture twin; its scripted runner calls the same tools.

- **Rejected: mutating `native-agent/1`.** It would break sealed byte authority and retained display.
- **Accepted trade-off:** two native profiles coexist. The `/1` profile becomes legacy and display-only once `/2` is the default.

### D2. App-owned MCP tool server over loopback Streamable HTTP

The agents worker hosts one MCP endpoint on `127.0.0.1` on an ephemeral port. Each provider run (a start or a resume) gets a fresh random 256-bit capability. The database stores only its SHA-256; the plaintext lives only in worker memory and the child's environment. Tools: `status`, `record_observation`, `propose_lot`, `regroup`, `propose`, `ask`, `reply`, `fetch_evidence`, `read_inbox`. Each session gets only the tools for its stage: the lot-forming tools are given to the Examine lead session alone. Each tool response also carries `pending_inbox: n`, so agents notice queued input without polling.

- **Claude**
  - Runs with `--tools ""`, `--strict-mcp-config` and `--mcp-config <session-dir>/mcp.json`. The file holds no secret: its `Authorization` header uses `${INTAKE_TOOL_CAPABILITY}` environment expansion, and the capability is set only in the allowlisted child environment.
  - Task 1.3 must confirm that `--mcp-config` files expand environment variables. If they don't, the fallback is a 0600 file written just before start and deleted as soon as init is confirmed, and on terminal or interrupted cleanup, recorded as a documented exception.
  - Adds `--allowedTools mcp__intake__*`.
  - The init check changes from "only StructuredOutput" to "only `mcp__intake__*`".
- **Codex**
  - Gets `config` overrides `mcp_servers.intake.url` and `bearer_token_env_var`, with the capability in an allowlisted child environment variable.
  - The dedicated `CODEX_HOME` preflight is unchanged. The effective config read after `thread/start` must list only `intake`.
- **SDK line:** task 1.1 decides it. Prefer v2 `@modelcontextprotocol/server` with the Node transport if it supports Node 24 and Streamable HTTP without Express. Otherwise pin v1 1.32.1. Either way, pin an exact version.
- **Rejected:** Codex `dynamicTools` (experimental in 0.166.0, Codex-only); the Claude Agent SDK (replaces the qualified CLI boundary); stdio MCP subprocesses (one more child per session to reap, and the capability would sit in its environment).

### D3. Session lifecycle state machine

```text
queued ──slot──▶ running ──turn ends, inbox empty──▶ finished
   ▲               │  ▲                                  │
   │        ask+   │  └──────inbox item / resume─────────┤
   │   nothing     ▼                                     │
   │   to do ─▶ waiting_input ──inbox item──▶ queued ◀───┘
   │
running ──cancel──▶ cancelling ──reaped──▶ cancelled
running ──crash/restart──▶ interrupted ──resume/inbox──▶ queued
```

- `running` and `cancelling` hold a slot. `cancelling` keeps its slot until the reap is confirmed, which preserves the existing unconfirmed-reap rule.
- **Resume**
  - Claude: `--resume <provider_session_id>` with persistence enabled. The cwd is the session directory, so transcripts land under the host user's Claude project store, keyed by that directory.
  - Codex: `thread/resume` in the dedicated `CODEX_HOME`, with `ephemeral` false.
  - A resume failure keeps the inbox pending and records `resume_unavailable` or `waiting_for_login`. The operator may start a fresh session that receives the pending items plus a summary built from retained outbox items.
- **In-turn delivery**
  - Codex: `turn/steer` with `expectedTurnId` for chat and answers while a turn is active.
  - Claude: the stream-JSON user message is written to stdin. Whether it is processed mid-turn or queued is unverified, so `read_inbox` is the guaranteed path for both providers.
  - **Delivery is at least once, acknowledged by cursor.** Inbox items carry a per-lineage sequence and a stable ID.
    - `read_inbox(after_seq)` returns the items after the cursor. Passing a cursor acknowledges everything up to it.
    - Items delivered by steer or resume are acknowledged when the next tool call carries their sequence, or when the turn completes.
    - Unacknowledged items are redelivered after a crash or lost response. Agents are instructed to ignore item IDs they have already seen, and proposals cite item IDs, so a repeat cannot create a second distinct answer.

### D4. Inbox and outbox are Processing-owned tables

- `agent_session_outbox(session_id, seq, kind, payload, created_at)` is append-only, with sequences checked by compare-and-set (CAS).
- `agent_session_inbox(id, session_lineage_id, seq, kind, payload, idempotency_key, created_at)`, plus `agent_session_cursor(session_lineage_id, acked_seq, acked_at)`. Acknowledgements only move the cursor forward (CAS).
- Writes reuse the existing transaction, lock order (capture → media → lane/slot → job → attempt → question) and publish-last rules. Hints go out after commit.
- DBOS delivers wake-ups only: a resume workflow keyed `resume:<session_lineage>:<inbox_high_water>` makes duplicate wake-ups harmless.
- **Rejected: DBOS `send`/`recv` as the inbox.** Those messages belong to one workflow ID and cannot be listed or queried for the UI or history.

### D5. Session context log replaces whole-attempt sealing for `/2`

- The opening manifest is sealed as today: subject, linked Part, defaults, notes, and the media pins at queue time.
- Later inputs are appended as context events, each with its own pins and digests:
  - evidence added or removed
  - answers
  - chat messages
  - operator corrections
- Each proposal records `relies_on`: its sources (observation IDs and versions, the lot's observation-set version, note/media version digests, answer IDs and context event IDs) and its fields (`markings`, `identity`, `quantity`, `research`, `images`).
- A proposal is current while every source in `relies_on` is still current. The batch-level noncurrent rule for `/1` stays as it is.
- **Accepted trade-off:** currentness for `/2` is computed over proposals rather than attempts, so the read model gains a per-proposal stale flag. Retained display still verifies the complete accepted payload against the session's log.

### D6. Dependencies trigger on proposal availability

- Research and Images jobs for a lot are queued when the lot's identity is **stable**: the Examine lead session has published a current `identity` proposal for the lot, and the lot's observation-set version equals the one that proposal relies on. A queued job re-checks this when it claims a slot; if the lot was regrouped meanwhile, it stays queued until a new identity is published.
- Inventory waits for current Research and Images proposals, plus Review acceptance as today.
- A revised identity arrives at Research and Images as an inbox `revision` item. It does not supersede their attempts.
- The exact-predecessor rule for `/1` stays as it is. For `/2`, a consumer's opening manifest pins the proposal IDs it started from, and later revisions arrive as context events.

### D7. Selective rework

- An `ask` declares `fields` and an `assumption`; validation refuses a question without them.
- Proposals that rely on a field with an open question show `provisional`.
- When an answer or operator correction arrives, the system finds every relying session and queues a `revision` inbox item for each. Relying sessions are:
  - those whose proposals rely on the affected fields
  - those whose opening manifest pinned a proposal for those fields, even if they have published nothing yet
  - the session that asked
- In the same transaction, every downstream proposal relying on the superseded value becomes stale, so Inventory cannot consume it while a revision is pending.
- Proposals that don't rely on those fields stay current.

### D8. The Examine lead session as a batch-scoped job

Sorting and identifying cannot run as separate steps. A photo can hold several lots and a lot can span several photos, so deciding which observations belong together needs their identities, and identities often need several observations combined. One lead session per batch therefore loops over finding observations, grouping them and identifying lots.

- A job's subject becomes nullable only for the `examine` lead stage (enforced by a CHECK constraint). There is at most one non-terminal lead job per batch. A finished lead session is resumed, never replaced, by new evidence, answers or chat.
- **Trigger:** media readiness publishes a hint. A debounce workflow keyed `examine-trigger:<batch>` sleeps for the quiet period (20 s). It then queues the lead session if there is ready evidence with no observation and none is active; otherwise it sends an `evidence` inbox item to the existing session, resuming it if finished.
- **Input:** previews downscaled to a long edge of 768 px, up to 48 per turn. `fetch_evidence(evidence_id, region?)` returns more, full resolution, or a region crop, within the 8 MiB per-turn image budget.
- **Tools** (all run the existing capture edit path as principal `agent:<session_id>`, with expected-revision CAS and a typed stale result):
  - `record_observation(expected_revision, evidence_version_id, region, readings, visible_count?)`.
  - `propose_lot(expected_revision, label, observation_ids, part?, estimated_quantity?, quantity_basis?)` creates or extends a draft lot (`origin = 'agent'`, `operator_edited = false`).
  - `regroup(expected_revision, moves[])` moves observations between AI lots, and merges or splits AI lots.
  - `propose(lot_id, fields…)` publishes markings, identity and quantity proposals for a lot.
- Any operator edit sets `operator_edited` on the lot or observation it touches. Tools aimed at an edited lot or observation never modify it; they record a suggestion for the operator to accept on Review.
- Publishing a stable identity queues the lot's Research and Images jobs in the same transaction (D6). Until PR-C, draft lots are ordinary saved lots that the operator queues through the existing Processing controls.
- **Large batches:** the lead session works through photos serially. If that proves too slow, a later optimisation can have helper sessions record observations in parallel while the lead keeps grouping and identification. It is not part of this change.
- **Rejected:** a separate Sort job followed by per-lot Examine sessions. Sort would need to read every photo to group them, and each Examine would then read them again. The two readings could disagree, and per-lot sessions cannot reason across lots (two date codes on one slip line, three items in one photo).

### D9. Slots replace the single lane for `/2`

- `agent_slot(actor, slot_index)` rows are claimed with `FOR UPDATE SKIP LOCKED`. The limit comes from Agent settings (1–8, default 3) and is read on claim.
- `/2` sessions use a separate DBOS queue, `bench-sessions`, registered under the shared Processing application name with `workerConcurrency: 8` and `globalConcurrency: 8`. Slot claims enforce the configured limit below that.
- `bench-research` keeps `workerConcurrency: 1, globalConcurrency: 1` for `/1`, so retained queue rows and the dev launcher's application re-own are unaffected. A process test proves that sessions run concurrently through the real DBOS boundary.
- **Lowering the limit** does not abort running sessions; it only stops new claims.
- **Occupancy truth** stays as today: only terminal settlement or a confirmed reap frees a slot.
- `/1` attempts continue to use the actor lane, and a `/1` attempt holding the lane also consumes one slot, so the two cannot oversubscribe.

### D10. Trusted write boundary for agent capture writes

- Tool handlers that write capture state or create commands run under a dedicated `agent_writer` role on their own pool in the worker. These are `record_observation`, `propose_lot`, `regroup`, and Research/Images queueing.
- `agent_writer` inherits no other role. Its complete write set covers exactly what the reused capture-edit and `createAttempt` paths touch:
  - **Capture:** insert on `capture_subject`, `capture_lot`, `capture_part`, `capture_evidence_observation`, `capture_lot_evidence_observation`, evidence and Part link rows, `capture_revision` and lot provenance; update and delete on `capture_lot_evidence_observation` rows of non-edited AI lots only (for `regroup`). Column-limited update on `capture_batch` revision/counter columns only, for the expected-revision CAS.
  - **Processing (`/2` stages only):** insert on `processing_job`, `processing_attempt`, `processing_input`, the command and outbox rows, and `agent_session`.
  - **Supporting lock, pin and publication tables:**
    - `media_command_binding` and `media_command_pin` insert (`media.pinCommand`)
    - `capture_edit_publication` insert/delete
    - `UPDATE(id)` on `capture_subject` for `FOR UPDATE` locks
    - `media_batch` insert and `UPDATE(revision)` for evidence links
    - `ui_stream` `UPDATE(head)` and `ui_event` insert (`appendEvent`)
    - `agent_session_outbox` insert
  - These mirror the existing `grantCaptureInputLocks`, `grantMedia(..., 'processing')` and `grantProjection` grants.
  - **Reads:** select on the rows those paths read for validation and locking.
  - No update or delete on human-owned columns, and no access to approval, execution or inventory tables.
- Task 2 derives the final list from the reused code paths and records it in the migration. Task 10 proves it with an end-to-end test that records observations, forms a lot and queues its Research and Images jobs using only `agent_writer`.
- Column grants and a database CHECK (or trigger) refuse writes from an agent principal that set counted quantities, approval, location or other human-only values, or that touch a lot with `operator_edited`.
- **Rejected: widening the existing runner role.** That would weaken its deliberate denial of capture and command writes for every profile.
- **Rejected: routing through the web API.** It adds a network hop and needs its own authentication for the worker, without adding authority checks the database cannot enforce.
- Tests run as the real restricted roles and show that permitted draft writes succeed, while the runner role and human-only mutations are refused.

### D11. UI

- **Capture and Review:** live draft-lot cards with an AI-proposed badge, their observations shown as crops, and the lead session's status line.
- **Processing:**
  - The batch's Examine lead session, then per-lot rows showing Research ∥ Images → Inventory with state chips.
  - Needs you lists open questions batch-wide, with the assumption in use.
  - The Examine view shows each photo's regions with their readings and lot, and each lot's observations, identity candidates and quantity basis.
- **Agent sessions:** a step timeline from status lines, plus a chat composer. Chat stays enabled in every state except cancelled; when a session is cancelled, the composer offers to start a fresh session.
- **Header:** the latest status line, and the waiting state.
- All views refresh from retained reads triggered by live hints. No token streaming is shown.
- **Coordination with BI-008 (`redesign-batch-workspace`):** that change redesigns these screens (Processing Overview and step pages, Review › Map, the Agents page) and reads them through its `ProcessingView` adapter. This change supplies the data and contracts: sessions, outbox and inbox, observations with regions, lot membership. Whichever lands second wires the adapter to these contracts; region-level Map links arrive with this change. The UI tasks here build only what each bundle needs to be verified end to end, using the redesigned components where they already exist.

### D12. Observations and lot membership

- **Naming:** `capture_observation` already exists. It is the immutable record of a read from the target InvenTree (`intake-server/migrations/0002_capture.sql`), used across capture, review and execution. These evidence observations therefore live in new `capture_evidence_observation` and `capture_lot_evidence_observation` tables, and code and contracts call them evidence observations to keep the two apart.
- `capture_evidence_observation(id, batch_id, evidence_version_id, page, region, readings, visible_count, origin, operator_edited, revision)`:
  - `region` is either a normalised rectangle `{x, y, w, h}` in exact rationals over the evidence version's oriented dimensions, or a document line range `{page, from_line, to_line}`. It is validated against the version's dimensions with the same rational rules as crop recipes.
  - `readings` holds markings and label text with citations; `visible_count` is optional.
- `capture_lot_evidence_observation(lot_id, evidence_observation_id)` is the membership. Each lot has an observation-set version that increases on every membership change.
- A lot's existing evidence links (`linked_subject_ids`) are derived from its observations, so current readers (Review, approval media plans) keep working unchanged.
- Operator edits (move, adjust, create region, merge, split) use capture edits with `operator_edited` set. The existing operator-review split, merge and move commands gain observation-level forms.
- Region crops are served by the media boundary on demand from the pinned version, cached by recipe digest. They are never new evidence versions.
- **Rejected:** linking whole files to lots. It cannot represent one photo with three lots, nor show which part of a photo supports which lot, and it pushes double-counting decisions out of the data.

### D13. Structured catalogue proposals

- `/2` proposals use a new `bench-intake-proposal/5` contract that extends `/4` with a `catalogue` block: `category`, `parameters[]` (template and value), `manufacturer` (company and MPN), `supplier` (company, SKU, price) and `description`.
- Each value is a discriminated choice: `existing` (an observed mapped reference, as `InventoryPartSpec` requires) or `proposed_new` (name, plus a reason), with sources.
- Values the executor cannot apply are flagged `unsupported`: a new category, a new parameter template, a new manufacturer company (the executor creates companies only as suppliers, `is_supplier: true` in `execution/effects-plan.ts`), and a supplier price. They stay in the proposal, are never copied into a Part spec, and are shown with their reason. BI-008's Review › Records reads them from here.
- `description` is applicable once BI-008 adds the optional `InventoryPartSpec.description` (its design D6). Until that field exists in the contracts, the validator treats description as `unsupported`; the `/5` schema carries it either way, so no further contract version is needed.
- Accepting a proposal into a Part spec still goes through the existing capture edit and `validatePartSpec`. Agents never write a Part spec directly.
- **Rejected:** keeping catalogue values only in `summary` text. Review could not show or map them, and unsupported values would be lost.

## State, authority and failure behavior

| Concern | Rule |
| --- | --- |
| Authority | The tool capability gives one session access to its own batch and subject scope only. Agent capture writes are limited to draft lot creation, evidence/Part links on non-operator-edited AI lots, and estimated quantities. Counted values, approval and effects stay human-only (existing Review/Execution boundaries). |
| Identity and idempotency | Outbox `(session_id, seq)` is unique. Inbox submissions are keyed by the operator's idempotency key, with full payload comparison (the existing pattern). `propose_lot` carries a tool-call ID and replays the original result. |
| Revisions | Capture edits keep expected-revision CAS. A stale revision is a typed tool result, not an error that kills the session. |
| Cancellation and supersession | Cancelling a lot or retiring a subject sends `cancel` to that subject's sessions. Sessions reap before releasing their slots. Retired subjects' proposals become stale. |
| Crash | On restart, running sessions become `interrupted` and keep their slot until the reap is confirmed. No turn is silently continued (agents architecture rule retained). |
| Provider failure | Login, capacity or rate-limit failures map to existing typed outcomes. The session goes to `waiting_for_login` or `waiting_for_capacity` without a slot; its inbox stays pending. |
| Media | `fetch_evidence` reads through the owning media boundary, verifying the version and pin. The per-turn image budget is enforced, and excess items are reported as unavailable. |
| Secrets | The database holds only capability hashes. Plaintext exists only in worker memory and the child's environment (both providers). A capability is revoked at turn end, cancellation, interruption and worker start, and a resume issues a new one. Tests prove that an old capability is refused after finish, resume and restart. The 0600-file fallback, if needed, is deleted when init is confirmed and on cleanup. |
| Observability | Status lines and outbox kinds are retained. Provider streams, stderr and private reasoning stay unretained, as today. |

## Verification strategy

- **Contracts:** typebox schemas for tool arguments and results, outbox/inbox items, and `/6` input. Unit tests cover bounds: a status line over 120 characters, a question missing its fields or assumption, a citation to an undelivered source.
- **PostgreSQL tier (`tests/pg`):**
  - session state machine transitions
  - slot claims and limit changes
  - inbox idempotency, cursor acknowledgement, and stable-ID redelivery without duplicate answers
  - per-proposal currentness
  - selective rework fan-out
  - lead-session single-flight per batch, and resume rather than replace
  - `operator_edited` protection
  - stale-revision `record_observation`, `propose_lot` and `regroup`
  - region validation, derived evidence links, and quantity basis without double counting
  - successors waiting on a regrouped lot
  - `/1` and `/2` sharing capacity
- **Process tier (`tests/process`):**
  - Deterministic fake `claude` and `codex` executables speak the stream-JSON / app-server protocol and call the real MCP server. They cover tool-only allowlist refusal, streamed outbox, `read_inbox`, `turn/steer`, resume after finish, crash → interrupted, cancel/reap, and a child that ignores SIGTERM.
  - The DBOS debounce trigger is tested end to end with `synthetic-session/1`.
- **Frontend (vitest):**
  - live lot cards
  - Needs you ordering and answer submission while a session is running
  - chat composer in each session state
  - status timeline
  - header latest line
  - legacy Reading/Identifying display
- **Browser check (browser-harness, headless):** synthetic profile on a photo-only batch with one photo holding three items and one item spanning two photos. Lots appear while the lead session runs, each with the right observations and no double counting; an answer is queued mid-run; Research and Images run concurrently.
- **Limits:** fake CLIs prove only our protocol handling. Real Claude/Codex MCP tool use, mid-turn behavior and resume fidelity need a separately authorized live qualification (task 13), and remain `native_unverified` until then.

## Migration, rollout and recovery

- **Migrations (additive):** session columns (state, provider session/thread ID, lineage), outbox, inbox, slots, lot `origin`/`operator_edited`, `capture_evidence_observation` and `capture_lot_evidence_observation` with the lot observation-set version, nullable job subject for the `examine` lead stage with a CHECK constraint, `processing_proposal` `relies_on`/stale columns, and a new stage enum value. No historical rows are rewritten.
- **Grants:**
  - The runner role gets insert on the outbox and on inbox notices it generates, plus update on cursors.
  - The API role gets inbox insert.
  - The scheduler role is unchanged.
  - The runner role keeps its existing denial of capture and command-creation writes. See D10 for agent capture writes.
- **Rollout:**
  - `INTAKE_PROCESSING_PROFILE=native-agent/2` (and `synthetic-session/1` in dev/tests) selects the new flow.
  - `/1` remains selectable.
  - The dev launcher's queue re-own logic keeps the shared application name.
- **Rollback:** switch the profile back to `/1`. Retained `/2` sessions stay readable, and their pending inbox items stay undelivered and visible. Agent-created lots remain ordinary draft lots.

## Risks and open decisions

- **Providers may not call tools reliably or promptly.** Mitigations: instructions require a status call at each step, the server tracks time since the last status line, and the Examine lead session falls back to a final-turn summary check. Live qualification decides whether this is good enough.
- **Claude mid-turn input is unverified.** Mitigated by `read_inbox` and `pending_inbox` hints.
- **Token cost.** Long sessions, resumes and parallel Research/Images raise usage. Mitigations: the concurrency limit, waiting sessions holding no slot, and the 48-thumbnail Examine input.
- **Transcript retention** under the host Claude project store and `CODEX_HOME` grows without bound. Retention cleanup is a follow-up; the design records session directories for later cleanup.
- **Large batches run serially in the lead session.** Mitigation: preview paging, and parallel observation helpers as a follow-up if timing shows a need.
- **Lead-session context grows with the batch.** Mitigation: photos are fetched on demand within the image budget, observations are retained as tool results the agent can re-read, and resume starts from a summary of retained observations.
- **Open:** MCP SDK v1 versus v2, decided in task 1.1. No user decision is needed.
