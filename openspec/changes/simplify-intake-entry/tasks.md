# Implementation and delivery tasks

## Plan context

- **Planning artifacts:** [proposal](proposal.md), [design assessment](design.md), and specs [processing-agent-sessions](specs/processing-agent-sessions/spec.md), [processing-lot-forming](specs/processing-lot-forming/spec.md), [processing-stage-pipeline](specs/processing-stage-pipeline/spec.md) and the [header-workflow-status delta](specs/header-workflow-status/spec.md).
- **Reuse recommendation:** extend the Claude CLI and Codex app-server adapters; add one app-owned MCP server (official TypeScript SDK); keep the inbox/outbox in Processing-owned PostgreSQL tables; use DBOS for waking only; reuse the `bench-intake-live/1` hints.
- **Change name:** `simplify-intake-entry`. It delivers [BI-006](../../../docs/PLANNED_FUNCTIONALITY.md#bi-006--agent-led-intake). BI-007 (Antigravity) is out of scope.
- **Branches and subjects:** branches are `feat/simplify-intake-entry-<bundle>`, targeting `interactive-app`. Subjects are `feat(simplify-intake-entry): …`.
- **Provider usage:** none is authorized by this plan. Automated evidence uses deterministic fake CLIs and `synthetic-session/1`. Task 13 is held until the operator explicitly authorizes live qualification.

## Completion and commit ordering

1. Complete and verify a checkbox action.
2. Mark it checked in this file.
3. Commit the work and this file together.

Keep a parent unchecked while any of its required subtasks are open. Review, publication, CI and merge actions are checked only after the event has happened.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1 Proof-of-fit spike | Investigation | None | Design D2/D3 decisions confirmed |
| 2 Session contracts and migrations | Enabling/migration | 1 | Sessions: all requirements (data shape) |
| 3 Tool server and session runtime | Behavior | 2 | Session-scoped tool capability; Streamed status and outbox delivery; Bounded status lines and delivered citations; Queued inbox in every session state; Inbox delivery to running sessions |
| 4 Provider session adapters | Behavior | 3 | Session tool boundary; Inbox delivery to running sessions (in-turn); Resume idle sessions for pending input; Cancellation and recovery |
| 5 Session slots and concurrency setting | Behavior | 2 | Waiting does not hold capacity |
| 6 Session UI and header status | Behavior/UI | 3, 5 | Streamed status and outbox delivery (timeline); Queued inbox in every session state (chat); header delta |
| 7 Observations and agent-attributed draft lots | Enabling/migration/behavior | 3 | Observations with regions; Lots group observations; Agent-attributed lot writes stay within draft authority; Human edits take precedence; Lot-forming tools only for the lead session |
| 8 Examine lead session, trigger and new evidence | Behavior | 4, 7 | One Examine lead session per batch; Quantity without double counting; New evidence wakes the lead session (placement only; notifying lot sessions is task 11); Examine stage (per-lot proposals) |
| 9 Live lots on Capture and Review | Behavior/UI | 8 | Live AI-proposed draft lots |
| 10 Per-lot successors on a stable identity | Behavior | 4, 8 | Successors start on a stable identity; Examine stage and parallel successors (Inventory gate, legacy display); Structured catalogue proposals; Unsupported catalogue values are retained |
| 11 Proposal currentness, selective rework and observation pickup | Behavior | 10 | Non-blocking questions; Selective rework; Superseded values invalidate relying proposals immediately; Evidence-based currentness; Lot sessions pick up observation changes |
| 12 Pipeline UI, docs and browser qualification | Behavior/UI/docs | 10, 11 | Pipeline scenarios incl. legacy display; Needs you |
| 13 Authorized live qualification | Manual qualification | 12 merged, explicit authorization | `native_unverified` label decision |

Tasks 5 and 7 can proceed in parallel with tasks 3 and 4 once task 2 is done.

## PR delivery map

| Bundle | Outcome and included work | Task coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Resumable agent sessions: tool server, outbox/inbox, status lines, chat, slots, header status. Questions become non-blocking at protocol level. | 1–6 | One protocol foundation that the other bundles build on, reviewable on its own with the synthetic profile. The `/1` flow is unchanged. | None. Merges first. | `interactive-app` ← `feat/simplify-intake-entry-sessions`; `feat(simplify-intake-entry): add resumable agent sessions` | `pnpm contracts:check`, `pnpm typecheck`, `pnpm test:intake`, `test:intake:pg`, `test:intake:process`, frontend typecheck/lint/test/build; independent exact-head review; selected CI green |
| PR-B | Examine lead session: observations with regions, live draft lots and per-lot identity proposals | 7–9 | Observation and lot authority plus the session that writes them form one coherent capture-boundary change, visible end to end. | PR-A merged | `interactive-app` ← `feat/simplify-intake-entry-lot-forming`; `feat(simplify-intake-entry): form lots from observations` | Same checks plus a browser check of live lots formed from regions (one photo, three lots; one lot, two photos), with Research/Images queued through the existing Processing controls (automatic queueing on a stable identity arrives in PR-C); independent review; CI green |
| PR-C | Per-lot Research ∥ Images on a stable identity, selective rework, observation pickup | 10–12 | Changes successor triggering and currentness together; it needs lead-session lots for its end-to-end check. | PR-B merged | `interactive-app` ← `feat/simplify-intake-entry-examine-pipeline`; `feat(simplify-intake-entry): run research and images per lot in parallel` | Same checks plus a browser qualification of the full flow; handover updated; independent review; CI green |
| PR-D | Live provider qualification evidence (docs/handover only) | 13 | Kept separate because it needs explicit live-usage authorization and may stay on hold. | PR-C merged and authorization given | `interactive-app` ← `feat/simplify-intake-entry-live-qualification`; `docs(simplify-intake-entry): record live session qualification` | Recorded evidence; review; held without authorization |

## 1. Proof-of-fit spike for tools, resume and in-turn input

- **PR delivery:** PR-A
- **Outcome:** confirmed choices for the MCP SDK line and the CLI flags, so later tasks build on evidence and not on assumptions.
- **Scope and approach:**
  - Evaluate MCP TypeScript SDK v2 (`@modelcontextprotocol/server` with the Node transport) against v1 1.32.1 on Node 24 with Fastify 5.12.7.
  - Using a deterministic fake CLI and offline help/schema only, confirm:
    - Claude: `--mcp-config` file + `--allowedTools mcp__intake__*` + `--tools ""`, and how `--resume` behaves with persistence enabled.
    - Codex: `mcp_servers` config override plus effective-config readback, and `thread/resume`/`turn/steer` request shapes from the generated schema.
  - Keep spike code out of production paths: `intake-server/spikes/` or the repository `spikes:check` area.
- **Prerequisites:** none.
- **Acceptance:** design D2/D3 updated with the chosen versions and flags. Any contradiction found is written back into the design before task 2.
- **TDD approach:** investigation, not test-first. Evidence is a runnable spike script and its recorded output.
- **Verification:** `pnpm spikes:check`. The spike notes in `docs/handovers/simplify-intake-entry.md` record CLI versions and outputs.
- **Risks and decisions:**
  - Claude's mid-turn stream-JSON behavior cannot be proven offline. Record it as unverified, and keep `read_inbox` as the guaranteed path.

- [x] 1.1 Install candidate MCP SDK packages in a spike workspace only, and record versions, licences and Node/Fastify compatibility.
- [x] 1.2 Build a minimal Streamable HTTP MCP endpoint with bearer auth on loopback, and call it from a scripted client.
- [x] 1.3 Confirm the Claude flag combination for a tool-only allowlist and resume using `claude --help` and a fake executable harness. Check whether `--mcp-config` files expand `${VAR}` in headers (decides design D2's secret delivery or its 0600-file fallback). Record anything that needs live confirmation.
- [x] 1.4 Confirm the Codex `mcp_servers` override, `thread/resume` and `turn/steer` shapes from `codex app-server generate-json-schema`.
- [x] 1.5 Update design D2/D3 with the decisions and pinned versions, and start the handover with the spike evidence.

## 2. Session contracts and migrations

- **PR delivery:** PR-A
- **Outcome:** versioned contracts and additive schema for `native-agent/2` and `synthetic-session/1`:
  - sessions, outbox, inbox, cursors, slots and the concurrency setting column
  - a nullable `processing_job.subject_id` for the `examine` lead stage, with its CHECK and the partial unique index (design D8)
  - proposal `relies_on`, the append-only `processing_proposal_stale` table (design D5), and proposal `/5` with the structured catalogue block (design D13)
  - `runner` and `api` grants as listed in the design's Migration section, including the extended `agent_session` column grants
  - the `examine` stage value
- **Scope and approach:**
  - `contracts/src/processing.ts`, `agents.ts` and `live.ts`: input `/6`, command `/5`, session envelope, the session tool argument/result schemas, the outbox kind union `status | observation | lot | regroup | proposal | question | reply`, inbox kinds, proposal `/5`, and `subject_id: Id | null` on `ProcessingJob`, `/6` input and `AgentSessionList`. The evidence-observation and lot-forming capture schemas are task 7.
  - `intake-server/migrations/00NN_*.sql` and grants for the API, runner and scheduler roles, as listed in the design's Migration section (PR-A part), including `agent_slot` and the `agent_settings` concurrency column. The `agent_writer` role and capture tables are task 7.
  - Existing versions stay byte-identical.
- **Prerequisites:** task 1.
- **Acceptance:** the schema bounds in all three new specs; `/1`–`/5` compatibility.
- **TDD approach:**
  - RED: contract tests for a status line over 120 characters, a question without fields or an assumption, and an unknown outbox kind. Also PG tests that the CHECK allows a null subject only for the `examine` lead stage, that a second `examine` job for the same batch is refused by the partial unique index, and that `/5` validation flags unsupported catalogue values.
  - GREEN: add the schemas and migrations.
- **Verification:** `pnpm contracts:check`, `pnpm test:intake`, `pnpm test:intake:pg` (the migration applies on a fresh DB and on one migrated to the latest existing migration).
- **Risks and decisions:** keep migrations additive so that rolling back means only switching the profile.

- [x] 2.1 Baseline: run the contract and PG suites, and record the counts.
- [x] 2.2 RED: add the failing contract/bounds tests and the migration constraint tests.
- [x] 2.3 GREEN: add the contracts, migration and grants; regenerate client contracts.
- [x] 2.4 Verify that retained `/1`–`/5` fixtures still decode byte-identically.
- [x] 2.5 Record the results in the handover.

## 3. App-owned tool server and session runtime

- **PR delivery:** PR-A
- **Outcome:** the worker serves the session MCP endpoint, and tool calls create ordered outbox items, read and mark inbox items, and fetch pinned evidence. Each step publishes hints after commit.
- **Scope and approach:**
  - New `intake-server/src/agents/tools/` covering capability issue/verify (stored hashed), the handlers for status/propose/ask/reply/fetch_evidence/read_inbox, the `pending_inbox` counter and status-line rate limiting.
  - The session context log (design D5) and a generic `propose` that records `relies_on`.
  - Processing transactions and lock order are reused.
- **Prerequisites:** task 2.
- **Acceptance:** Session-scoped tool capability "Capability replay from another session"; Streamed status and outbox delivery "Status lines while working"; Bounded status lines and delivered citations "Invalid outbox item"; Queued inbox in every session state "Duplicate answer submission"; Inbox delivery to running sessions "Crash after delivery, before acknowledgement".
- **TDD approach:**
  - RED (PG and process tests): a wrong-session capability is refused with no rows written; an undelivered-source citation is refused; inbox submissions with a duplicate key return the original receipt; inbox delivery is at least once with cursor acknowledgement, and a redelivered item after a simulated crash keeps its ID and creates no duplicate answer.
  - GREEN: implement the handlers.
- **Verification:** `pnpm test:intake:pg`, `pnpm test:intake:process` (scripted MCP client).
- **Risks and decisions:** the tool server runs inside the worker only. The web process gets no tool endpoint.

- [x] 3.1 Baseline the agents/processing PG and process suites.
- [x] 3.2 RED: capability, validation, ordering and idempotency regressions.
  - [x] 3.2.1 Wrong-session or expired capability refused, with no state change.
  - [x] 3.2.2 Status line over 120 characters, rate-limit breach, and undelivered citation each return a typed error.
  - [x] 3.2.3 Duplicate inbox key returns the original receipt; an unacknowledged item is redelivered with the same ID after a crash; an acknowledged one is not.
- [x] 3.3 GREEN: MCP endpoint, handlers, context log, outbox/inbox persistence and live hints.
- [x] 3.4 Refactor shared validation with the existing provenance checks, and rerun the Processing suites.
- [x] 3.5 Record the results.

## 4. Claude and Codex session adapters

- **PR delivery:** PR-A
- **Outcome:** both adapters run `/2` sessions that use only app tools, resume finished conversations, deliver in-turn input where supported, and keep the cancel, reap and crash guarantees.
- **Scope and approach:**
  - `agents/claude.ts`:
    - Write `mcp.json` with no secret, using `${INTAKE_TOOL_CAPABILITY}` expansion (confirmed in task 1.3). Pass the allowlist flags, without `--safe-mode` (design D2).
    - Remove `--no-session-persistence` for `/2` only, and add `--resume` support.
    - Change the init tool check to app tools only.
    - Write stdin stream-JSON for queued messages.
  - `agents/codex.ts`: `mcp_servers` override with `default_tools_approval_mode = "approve"`, `features.goals = false`, effective-config and MCP-status tool checks, non-ephemeral threads, `thread/resume`, `turn/steer` with `expectedTurnId` (design D2/D3).
  - The session state machine (design D3) and the DBOS resume workflow keyed by attempt, turn count and minute bucket.
  - Fake `claude`/`codex` executables that drive real tool calls, and a `synthetic-session/1` runner.
- **Prerequisites:** task 3.
- **Acceptance:**
  - Session tool boundary "Session starts with only app tools".
  - Inbox delivery to running sessions "Answer while the agent is running".
  - Resume idle sessions for pending input "Chat with a finished session" and "Resume fails".
  - Cancellation and recovery "Worker restarts mid-turn".
- **TDD approach:**
  - RED (process tests with fake CLIs):
    - an extra built-in tool reported at init causes refusal
    - an answer is delivered via `turn/steer` (Codex) or `read_inbox` (Claude)
    - resume after finish carries the queued chat
    - a missing transcript gives `resume_unavailable`
    - the Claude `mcp.json` never contains the capability value (task 1 removed the fallback file)
    - a crash gives interrupted with no automatic turn
    - a capability is refused after finish, after resume (the old one) and after worker restart
    - a child that ignores SIGTERM keeps its slot until reaped
  - GREEN: implement the adapters.
- **Verification:** `pnpm test:intake:process`, `pnpm test:intake`; the existing `/1` adapter tests unchanged.
- **Risks and decisions:** real provider behavior stays unverified (task 13).

- [x] 4.1 Baseline the existing adapter process tests.
- [x] 4.2 RED: fake-CLI regressions for allowlist refusal, in-turn delivery, resume, resume failure, crash, stubborn child and capability revocation.
- [x] 4.3 GREEN: Claude and Codex `/2` adapters, the state machine and the resume workflow.
- [x] 4.4 Refactor shared child supervision. Verify the `/1` adapter tests and the duplicate-supervisor fence.
- [x] 4.5 Record results and remaining live unknowns.

## 5. Session slots and concurrency setting

- **PR delivery:** PR-A
- **Outcome:** a configurable limit on running sessions (1–8, default 3). Waiting, paused and finished sessions hold no slot, and `/1` lane holders consume one slot.
- **Scope and approach:**
  - `agent_slot` claim with `SKIP LOCKED`, reading the limit from Agent settings with expected-revision writes.
  - A new `bench-sessions` DBOS queue in the session worker (`agents/session-worker-main.ts`, `workerConcurrency: 8`, `globalConcurrency: 8`, shared Processing application name). `bench-research` keeps its single-lane caps for `/1`. Session commands are authorized by the session worker from the retained command row; `loadProcessingAuthority` keeps rejecting `bench-sessions` (design D9).
  - Settings contract and settings form field.
- **Prerequisites:** task 2.
- **Acceptance:** "Fourth session queues"; lowering the limit never aborts a running session; an unconfirmed reap keeps its slot.
- **TDD approach:**
  - RED (PG): with a limit of 3, the fourth session stays queued; waiting frees a slot; `/1` and `/2` together never exceed the limit; an occupied slot blocks a second supervisor, as an occupied lane does; the API role can update the concurrency column.
  - GREEN: implement slots.
- **Verification:** `pnpm test:intake:pg`, frontend settings test.
- **Risks and decisions:** none.

- [x] 5.1 Baseline the lane and settings tests.
- [x] 5.2 RED: slot-limit, waiting-release, limit-change and mixed-profile regressions, plus a process test showing that three sessions run concurrently through the real DBOS queue.
- [x] 5.3 GREEN: slots, settings field and worker queue configuration.
- [x] 5.4 Verify the lane occupancy rules for `/1` are unchanged.
- [x] 5.5 Record the results.

## 6. Session timeline, chat, Needs you and header status

- **PR delivery:** PR-A
- **Outcome:** each session shows a step timeline and a chat composer that queues in any state. A batch-wide Needs you list answers questions while agents keep running. The header shows each session's latest status line and its waiting state.
- **Scope and approach:**
  - `frontend/src/components/agents/*` and `processing/*`, plus the header workflow details.
  - Retained reads are triggered by live hints.
  - Docs: `agents/ARCHITECTURE.md` and `processing/ARCHITECTURE.md` sections on sessions, tools and slots.
- **Prerequisites:** tasks 3 and 5.
- **Acceptance:** Streamed status "Status lines while working"; chat scenarios; header delta "Latest status line"; existing header scenarios unchanged.
- **TDD approach:**
  - RED (vitest): the timeline orders status lines; the composer is enabled for a finished session and offers a fresh session when cancelled; Needs you submits while a session is running; the header shows the latest line and the waiting label.
  - GREEN: implement the UI.
- **Verification:** `pnpm test:frontend`, `pnpm lint:frontend`, frontend typecheck and build; headless browser check with `synthetic-session/1`; markdown lint for docs.
- **Risks and decisions:** keep it accessible: labelled composer, live region for new status lines without excessive announcements.

- [x] 6.1 Baseline the frontend suite.
- [x] 6.2 RED: component tests for the timeline, composer states, Needs you and the header line.
- [x] 6.3 GREEN: components wired to the retained reads and hints.
- [x] 6.4 Update the architecture docs and handover for PR-A; run the markdown and reference checks.
- [x] 6.5 Headless browser check of a synthetic session (status, mid-run answer, chat after finish); record evidence.

## 7. Observations and agent-attributed draft lots

- **PR delivery:** PR-B
- **Outcome:** observations with regions and lot membership by observation exist in capture state. `record_observation`, `propose_lot` and `regroup` write them through the existing capture edit validation, attributed to the session, and lots and observations the operator has edited are protected.
- **Scope and approach:**
  - Migration (PR-B part of the design's Migration section): `capture_evidence_observation` (with `status` and `supersedes_observation_id`), `capture_lot_evidence_observation` (with `status` active/suggested), the `capture_identity_immutable()` allowlist update, the `api` observation grants, lot `origin`, `operator_edited`, `estimated_quantity`, `quantity_basis` and `observation_set_version`, and nullable `agent_session_id` attribution columns. `actor_id` stays the batch's server operator.
  - The `agent_writer` role with its capture grants and lead-session Processing grants (design D10); in PR-A those session writes ran under `runner`, plus `SELECT` on the new tables for the roles granted by `grantCaptureRead` and `grantMedia`.
  - `readMediaRows` projects `linked_subject_ids` as the union of `media_subject_link` and lots reached through active membership rows (design D12).
  - Regions use the documentary-crop pixel geometry, validated with `validateLegacyMediaRecipeGeometry`; document line ranges validate page and line order only. Region crops render from `media_preview` into a private cache outside `BlobStore`.
  - Handlers lock the rows they touch, refuse with a typed `stale` result (current state and new batch revision) when those rows changed after `base_revision` or are operator-edited, record suggestions for edited lots, and return the new batch revision on every call (design D8).
  - Observation edits on two surfaces: `CaptureEdit` gains create region, adjust region, move observation, and accept/dismiss suggestion; `Restructure` `split_lot` gains per-child `observation_ids` and `merge_lots` unions observations. `move_lots` is unchanged.
  - The lot-forming tool schemas and the lead-session-only check.
- **Prerequisites:** task 3.
- **Acceptance:** Observations with regions ("One photo, three items", "Region outside the image"); Lots group observations ("Front and back of one packet", "Same MPN, different date codes"); Live AI-proposed draft lots ("Stale revision while forming", "Unrelated edit does not block forming", "Operator save after an agent write"); Agent-attributed lot writes stay within draft authority "Estimated count only"; Human edits take precedence ("Operator split is kept", "Suggestion for an edited lot", "Operator adjusts a region", "Operator moves a region"); Lot-forming tools only for the lead session "Lot-forming tool from a lot session".
- **TDD approach:**
  - RED (PG):
    - out-of-bounds regions are refused
    - `linked_subject_ids` is the union of `media_subject_link` and observation-derived lot links; a `/1` batch and Part links are unchanged; media roles can read it
    - an unrelated batch edit does not make a lot-forming call stale, and every response carries the new batch revision
    - agent writes keep `actor_id` an operator ID and set `agent_session_id`
    - a lot-forming call from a non-lead session is refused
    - a stale revision creates no observation or lot
    - a counted quantity from the agent is refused
    - `regroup` or `propose_lot` against an edited lot or observation changes nothing and records a suggested membership row that does not change `observation_set_version`; accepting it is an operator edit
    - region create/adjust, observation moves and `Restructure` merge/split set `operator_edited`, succeeding through the updated immutability trigger and the `api` grants
    - `record_observation` with `observation_id` revises a non-edited AI observation, and on an edited one records a suggested superseding row; `propose_lot` with `lot_id` extends an AI lot
    - staleness is recorded by inserting into `processing_proposal_stale`; updating a `processing_proposal` row is still refused
  - GREEN: implement the schema and handlers.
- **Verification:** `pnpm test:intake:pg`, capture and media unit tests.
- **Risks and decisions:** this deliberately relaxes "suggestions never write capture" for draft lots and observations only. Update the Processing and Capture architecture docs to match.

- [x] 7.1 Baseline the capture/edit and media crop PG tests.
- [x] 7.2 RED: region validation, derived links, stale revision, human-only values, edit protection and the suggestion path, run as the real `agent_writer` and runner roles (the runner role is refused capture writes).
- [x] 7.3 GREEN: migration, attribution columns, the `agent_writer` role and pool, the `linked_subject_ids` union, region validation and crop cache, handlers, suggestions, and observation-level `CaptureEdit` and `Restructure` forms.
- [x] 7.4 Verify the existing review/approval and media-plan tests are unchanged.
- [x] 7.5 Record the results.

## 8. Examine lead session, debounce trigger and new evidence

- **PR delivery:** PR-B
- **Outcome:** each batch gets one Examine lead session after a quiet period of 20 seconds. It reads previews, records observations, groups them into lots, and publishes per-lot markings, identity and quantity (with its basis) proposals. Later evidence wakes the same session, resuming it if finished, and only the new evidence is examined.
- **Scope and approach:**
  - A batch-scoped `examine` lead job (design D8), with `reserveProcessingMedia` gaining a batch-scoped pinning mode for it, and a DBOS debounce workflow keyed per batch.
  - Null-subject handling for the lead job: per-lot proposal and question binding checks in `messages.ts`, `provenance.ts` and `retained.ts`; batch-scoped media in `processingSnapshot`/`processingActivity`; the lead job included in the inbox projection.
  - Preview staging: long edge 768 px, 48 per turn; `fetch_evidence` with optional region.
  - Lead-session instructions for both providers and the synthetic runner: find, group and identify in a loop; state quantity basis; never add up the same items twice.
  - The synthetic runner scripts a batch with one photo holding three items and one item spanning two photos.
  - Notifying and resuming lot sessions is part of task 11.
- **Prerequisites:** tasks 4 and 7.
- **Acceptance:**
  - One Examine lead session per batch: "Photos finish preparing" and "More photos arrive during the quiet period"; resume rather than replace.
  - Quantity without double counting: "Bag seen in two photos".
  - New evidence wakes the lead session: the observation is added to the existing AI lot and no other lot changes. The session-notice half of "Back of an existing tape" is accepted in task 11.
  - Archived batch and no-default cases.
- **TDD approach:**
  - RED (PG and process tests): one lead job per batch under concurrent readiness events (the partial unique index holds); the lead job publishes a per-lot proposal and a batch-level question without a subject-mismatch error, and appears in Processing, activity and the inbox; the lead job pins every ready evidence version without lot links; the quiet period restarts; a finished session is resumed; no session for an archived batch or without a default; new evidence produces observations only for the new files; quantity basis is recorded and duplicates are not summed.
  - GREEN: implement the job, trigger and instructions.
- **Verification:** `pnpm test:intake:pg`, `pnpm test:intake:process` with `synthetic-session/1`.
- **Risks and decisions:** the quiet period is a constant that can be tuned. Large batches beyond 48 previews depend on `fetch_evidence` paging, and run serially in one session (design D8).

- [x] 8.1 Baseline the media readiness and processing trigger tests.
- [x] 8.2 RED: single-flight, debounce restart, resume, eligibility, new-evidence-only examination and quantity-basis regressions.
- [x] 8.3 GREEN: lead job, quiet-period trigger (a session worker sweep; design D8), preview staging, instructions and evidence notices.
- [ ] 8.4 Verify that media decoding and the existing processing queue are unaffected.
- [ ] 8.5 Record the results.

## 9. Live lots on Capture and Review

- **PR delivery:** PR-B
- **Outcome:** Capture and Review show draft lots appearing while the lead session runs, with an AI-proposed badge, their observations as crops and the lead session's status line. Operator edits use the existing controls (and the observation-level move) and mark the lot or observation as edited.
- **Scope and approach:**
  - `frontend/src/components/review/*` and capture components, driven by live hints and retained reads. If the planned redesign (BI-008) has landed on `interactive-app` by then, target its components instead (design D11).
  - Docs: Capture/Processing architecture sections on agent-created lots; PR-B handover.
- **Prerequisites:** task 8.
- **Acceptance:** "Watching lots appear"; editing an AI lot removes its AI-only badge state and shows it as edited.
- **TDD approach:**
  - RED (vitest): a hint adds a lot card without disturbing unsaved drafts; the AI-proposed badge shows; edited state shows.
  - GREEN: implement the UI.
- **Verification:** frontend test/lint/typecheck/build; headless browser check on a photo-only synthetic batch; markdown checks.
- **Risks and decisions:** live inserts must not reset dirty Review drafts. Reuse the existing dirty-guard pattern.

- [x] 9.1 Baseline the Review/Capture component tests.
- [x] 9.2 RED: live insert, badge, edited state and dirty-draft preservation.
- [x] 9.3 GREEN: UI.
- [ ] 9.4 Update the docs and handover for PR-B; run the markdown checks.
- [ ] 9.5 Headless browser check: lots appear while the lead session runs, with the right observations, and can be queued with the existing Processing controls; record evidence.

## 10. Per-lot Research and Images on a stable identity

- **PR delivery:** PR-C
- **Outcome:** for `/2` work, each lot's Research and Images start in parallel as soon as its identity is stable, and Inventory waits for both to be current.
- **Scope and approach:**
  - `processing/model.ts` gets a profile-specific stage order with a batch-level `examine` lead stage.
  - Dependency triggering moves to stable identity (design D6): `propose` locks the lot rows, re-checks stability and queues Research and Images through `createAttempt`/`queueJob` in the same transaction. A membership change supersedes queued successors (`lot_regrouped`); the next stable identity creates fresh attempts and command rows. Slot claim re-checks under the same lock. `/2` jobs record no `processing_dependency` rows.
  - `agent_writer`'s Processing queueing grants (PR-C part of the design's Migration section).
  - Examine and Research publish `/5` catalogue values.
  - `/1` keeps exact-predecessor lineage.
- **Prerequisites:** tasks 4 and 8.
- **Acceptance:** Successors start on a stable identity ("Parallel start", "Lot regrouped before successors start"); Examine stage and parallel successors "Legacy batch display"; Structured catalogue proposals "Existing manufacturer"; Unsupported catalogue values are retained "New sub-category proposed".
- **TDD approach:**
  - RED (PG and process tests): publishing a stable identity queues Research and Images in the same transaction, proven end to end using only the `agent_writer` role; both run concurrently with the lead session when slots are free; a regrouped lot holds its queued jobs; Inventory waits; `/1` reading/identifying jobs are unchanged.
  - GREEN: implement the pipeline.
- **Verification:** `pnpm test:intake:pg`, `pnpm test:intake:process`.
- **Risks and decisions:** none beyond the design's notes on token cost.

- [ ] 10.1 Baseline the dependency and stage tests.
- [ ] 10.2 RED: stable-identity queueing under `agent_writer`; concurrent `regroup` and `propose` (only one wins under the lot lock); a regrouped lot supersedes its queued successors and the next identity creates fresh deliverable attempts; parallelism; Inventory gate; `require_processing_dependency_order` untouched; legacy invariance.
- [ ] 10.3 GREEN: stage order, stable-identity triggers and claim-time re-check.
- [ ] 10.4 Research and Examine publish `/5` catalogue values with sources. Tests: an observed manufacturer company with MPN applies cleanly through `validatePartSpec` ("Existing manufacturer"); a parameter carries both `template` and `category_mapping`; new categories, templates, companies, unmapped parameters and prices stay unsupported and never reach a Part spec ("New sub-category proposed").
- [ ] 10.5 Verify the exact-predecessor suites for `/1`.
- [ ] 10.6 Record the results.

## 11. Proposal currentness, selective rework and new evidence pickup

- **PR delivery:** PR-C
- **Outcome:**
  - Proposals become stale only when a source they rely on changes.
  - Answers and corrections reach the asking session and every relying session; proposals that don't rely on them stay current.
  - Observations added to or removed from a lot notify that lot's Research and Images sessions and resume finished ones.
- **Scope and approach:**
  - Processing read models gain a per-proposal stale/provisional projection.
  - Fan-out of answers and corrections uses the `relies_on` fields (design D7).
  - Lot-membership change hooks queue `evidence` items to the lot's sessions.
- **Prerequisites:** task 10.
- **Acceptance:** "Back of an existing tape" (the lot's Research and Images sessions receive the notice); "Unclear quantity"; "Agent asks without an assumption"; "Corrected part number"; "Correction before the first downstream output"; "Photo added mid-run"; "Evidence removed".
- **TDD approach:**
  - RED (PG): a quantity answer leaves the identity proposal current; an identity answer reaches Research and Images without cancelling them, including a Research session that has published nothing yet; proposals relying on the old identity are stale in the same transaction, and a queued Inventory stays waiting; an observation moved out of a lot marks its citing proposals stale; a finished Research session is resumed when an observation is added to its lot.
  - GREEN: implement the projection and fan-out.
- **Verification:** `pnpm test:intake:pg`, `pnpm test:intake:process`.
- **Risks and decisions:** the projection must stay bounded per batch. Reuse the existing bounded closure queries.

- [ ] 11.1 Baseline the currentness/answer suites.
- [ ] 11.2 RED: selective-currentness, fan-out, evidence-removal and resume-on-evidence regressions.
- [ ] 11.3 GREEN: projection, fan-out and evidence hooks.
- [ ] 11.4 Verify `/1` answer closure and supersession behavior is unchanged.
- [ ] 11.5 Record the results.

## 12. Pipeline UI, documentation and browser qualification

- **PR delivery:** PR-C
- **Outcome:**
  - Processing shows the batch's Examine lead session, then per-lot Research ∥ Images → Inventory rows.
  - A single Examine view shows photo regions with their readings and lot, and each lot's observations, candidates and quantity basis.
  - Provisional and stale labels, plus Needs you entries with their assumptions.
  - Legacy Reading/Identifying views remain for old jobs.
  - Architecture docs and the handover describe the final behavior.
- **Scope and approach:**
  - `frontend/src/components/processing/*`, or the redesigned Processing pages if BI-008 has landed on `interactive-app` by then (design D11).
  - `processing/ARCHITECTURE.md`, `agents/ARCHITECTURE.md` and `docs/handovers/simplify-intake-entry.md`.
- **Prerequisites:** tasks 10 and 11.
- **Acceptance:** pipeline UI parts of all three new specs; legacy display.
- **TDD approach:**
  - RED (vitest): parallel chips render; provisional/stale labels show; the Examine view cites sources; the legacy view still renders the `/1` fixtures.
  - GREEN: implement the UI.
- **Verification:** `pnpm test`, frontend typecheck/lint/build, `pnpm lint:markdown`, `pnpm workflow-sync` if skills changed (none planned). Headless browser qualification of the full synthetic flow (photo-only batch with a three-item photo and a two-photo item → live lots with correct observations and no double counting → mid-run answer → parallel Research/Images → added photo examined by the lead session and picked up by the lot's sessions) at desktop and 390 px widths.
- **Risks and decisions:** none.

- [ ] 12.1 Baseline the Processing component tests.
- [ ] 12.2 RED: pipeline row, Examine view, label and legacy-view tests.
- [ ] 12.3 GREEN: UI.
- [ ] 12.4 Update the architecture docs and the complete handover; check that every doc claim matches the code.
- [ ] 12.5 Run the full browser qualification and record screenshots/evidence and limits.

## 13. Authorized live provider qualification

- **PR delivery:** PR-D
- **Outcome:** evidence on whether real Claude and Codex sessions call the app tools reliably, accept in-turn input and resume. This decides whether `/2` may drop the `native_unverified` label.
- **Scope and approach:** a manual run against the operator's own accounts, only after explicit authorization. Record the results in the handover, with no code changes unless separately scoped.
- **Prerequisites:** PR-C merged; explicit operator authorization for live provider usage.
- **Acceptance:** the documented qualification outcome for each provider.
- **TDD approach:** not applicable (manual qualification). Evidence is a recorded session log summary without secrets or private reasoning.
- **Verification:** handover review.
- **Risks and decisions:** billable usage. Held until authorized.

- [ ] 13.1 Obtain explicit live-usage authorization, and record its scope.
- [ ] 13.2 Run the scripted qualification for Claude and Codex: tool-only allowlist, status cadence, in-turn answer, resume after finish.
- [ ] 13.3 Record the outcomes and the label decision in the handover.

## Delivery evidence and lifecycle follow-up

CI no longer runs the PostgreSQL and process tiers (disabled for Actions usage). For PR-B onward, "selected CI green" covers the jobs CI still runs, and the local `pnpm db:intake test` and `pnpm db:intake test:process` results recorded in the handover stand in for the skipped job.

- [x] D.1 PR-A: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization. Review clear at `114589a` (docs-only head `cbad77d`); CI green apart from the base-inherited media-limit failure fixed by #98; merged on Mitch's instruction as `10f9e7d`. See the handover.
- [ ] D.2 PR-B: same gates.
- [ ] D.3 PR-C: same gates; BI-006 is updated to Done only after acceptance and merge are evidenced.
- [ ] D.4 PR-D: held until live authorization; same gates once run.

After delivery, sync and archive only when authorized, and update the index link if the change moves.
