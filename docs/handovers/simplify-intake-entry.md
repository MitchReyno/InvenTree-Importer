# Agent-led intake (`simplify-intake-entry`): engineering handover

## Scope and state

This change delivers [BI-006](../PLANNED_FUNCTIONALITY.md#bi-006--agent-led-intake) from the OpenSpec change [`simplify-intake-entry`](../../openspec/changes/simplify-intake-entry/proposal.md). Mitch owns the decisions. Implementation was requested on 2026-11-06 through the OpenSpec apply workflow. The [task plan](../../openspec/changes/simplify-intake-entry/tasks.md) splits the work into four PRs:

| Bundle | Tasks | Branch | State |
| --- | --- | --- | --- |
| PR-A resumable sessions | 1–6 | `feat/simplify-intake-entry-sessions` | Tasks 1–6 done; independent review, publication and CI pending (D.1) |
| PR-B lot forming | 7–9 | `feat/simplify-intake-entry-lot-forming` | Not started; needs PR-A merged |
| PR-C per-lot pipeline | 10–12 | `feat/simplify-intake-entry-examine-pipeline` | Not started; needs PR-B merged |
| PR-D live qualification | 13 | `feat/simplify-intake-entry-live-qualification` | Held until live provider use is authorized |

No provider usage is authorized. Every check so far is offline.

## Task 1: proof-of-fit spike

The spike lives in [`spikes/mcp-session-tools/`](../../spikes/mcp-session-tools/README.md), with its own `package.json` outside the pnpm workspace. Its recorded output is in `evidence/`. Both CLI harnesses run the real binary against a loopback stub of the provider API, with a fake API key and a throwaway home directory. Nothing reached a provider, and no real credential was read.

Toolchain: Node 24.22.2, Fastify 5.12.7, Claude Code 2.1.318, codex-cli 0.166.0.

### MCP SDK (task 1.1, 1.2)

| Candidate | Licence | Engines | Runtime dependencies | Result |
| --- | --- | --- | --- | --- |
| `@modelcontextprotocol/server` 2.4.0 + `@modelcontextprotocol/node` 2.1.2 | Apache-2.0 | Node ≥ 20 | `zod` ^4.2, `@modelcontextprotocol/core`, `hono` and `@hono/node-server` | **Chosen.** All checks pass. |
| `@modelcontextprotocol/sdk` 1.32.2 | MIT | Node ≥ 18 | Includes Express 5, `cors`, `express-rate-limit`, `hono` and `ajv` | All checks pass; heavier. |

All candidates were published at least 14 days before installation. On Fastify, the endpoint uses `reply.hijack()` and passes the pre-parsed body to `NodeStreamableHTTPServerTransport`. A stateless `McpServer` per request takes its tools from the session the capability belongs to. The endpoint checks the following on both lines:

- It binds to `127.0.0.1` on an ephemeral port.
- A missing or wrong capability gets 401; a foreign `Host` header gets 403.
- Only the Examine lead session lists the lot-forming tools; a lot session calling `propose_lot` gets "tool not found".
- A status line over 120 characters is refused, every response carries `pending_inbox`, and every call is attributed to its session.

v2 adds `zod` 4 to the intake server, which had no zod. Task 3 installs the pinned packages. `THIRD-PARTY-NOTICES.md` covers vendored material and the Python runtime dependencies only, and lists no installed npm package, so the Apache-2.0 packages add no entry there.

### Claude CLI (task 1.3)

- **`${INTAKE_TOOL_CAPABILITY}` expands** in `--mcp-config` headers. With the variable unset, the server reports `failed` and the session has no tools. The 0600-file fallback in design D2 is not needed.
- **`--safe-mode` drops `--mcp-config` servers**, so `/2` must not use it. The `/1` adapter keeps it, since `/1` has no MCP server. Without safe mode, `--setting-sources ""` and `--strict-mcp-config` still kept out a planted user `CLAUDE.md`, a settings `SessionStart` hook and a settings MCP server.
- `--tools ""` with `--strict-mcp-config` offers the model exactly the `mcp__intake__*` tools.
- **`--allowedTools mcp__intake__*` is required.** Without it, `-p` reports every MCP call in `permission_denials`.
- **Resume works** with `--session-id` on the first run, no `--no-session-persistence`, and `--resume <id>` on the next. The resumed request carries the earlier turn and its tool results.
- **In-turn stdin delivery works at the CLI layer.** A stream-JSON user message written during a turn reaches the model after the next tool result, as a "new message while you were working" notice.

Needs live confirmation (task 13): whether models act on that notice promptly, whether they call the tools reliably, and the subscription login path. The harness used the API-key route with a fake key.

### Codex app-server (task 1.4)

Shapes from `codex app-server generate-json-schema` (0.166.0):

- `thread/start` takes a free-form `config` object and `ephemeral`.
- `thread/resume` requires `threadId` and takes `config`, `excludeTurns` and the same policy fields.
- `turn/steer` requires `threadId`, `expectedTurnId` and `input`, and returns `{turnId}`.

Behaviour against the stub:

- `-c mcp_servers.intake={url, bearer_token_env_var}` connects. `config/read` lists only `intake`, and `mcpServerStatus/list` reports its nine tools.
- **`default_tools_approval_mode = "approve"` is required.** Under `approval_policy = "never"`, an MCP call without it is refused with "MCP tool call requires approval". With it, the call reaches the server with the session's capability.
- **`features.goals = false` is required** to remove `create_goal`, `get_goal` and `update_goal`.
- **Four built-in tools remain, with no config key found to remove them:** `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` and `request_user_input`. The resource tools read only configured servers, and the intake server declares no resources. Codex answers `request_user_input` itself ("unavailable in Default mode") without sending the client a request. Design D2 records this as an accepted exception; the adapter still refuses every server-initiated request.
- `turn/steer` during a turn puts the text into the very next provider request of the same turn. A mismatched `expectedTurnId` is refused with `-32600`.
- `thread/resume` from a new app-server process on the same `CODEX_HOME` restores history and continues, once the thread was started with `ephemeral: false`.

**`/1` observation, not changed here:** `features.goals` defaults to on in 0.166.0, so a `/1` Codex turn is also offered the goal tools and `request_user_input` alongside its structured output. `/1` bytes and behaviour are out of scope for this change; raise it separately if wanted.

### Plan updates (task 1.5)

The decisions above are written into design D2 (SDK pin, Claude flags without safe mode, Codex approval mode, goals switch and built-in-tool exception, init checks) and D3 (resume and in-turn delivery shapes). The Secrets and Limits text, the risks list, the proposal's MCP SDK reuse row and its resolved-decision line, and the task 4 adapter scope were updated to match.

## Task 2: session contracts and migration

### Baseline (task 2.1)

Before any change, on `8f4a81c` plus the task 1 commit: `pnpm contracts:check` clean; `pnpm test:intake` 61 contract and 178 intake-server tests passed; `pnpm db:intake test` 163 PostgreSQL tests passed (about 7.5 minutes). The PostgreSQL run used the shared `bench-intake-dev-pg` container under the coordination `pg-docker` lease, with decoder and probe images rebuilt from this branch's source.

### Contracts

- `contracts/src/sessions.ts` adds the session tool arguments (`status`, `ask`, `reply`, `read_inbox`, `fetch_evidence`, `propose`), the tool result with `pending_inbox` and typed errors, the seven outbox kinds, the four inbox kinds, the chat submission and receipt, and `SessionState`. The lot-forming tool schemas belong to task 7.
- `contracts/src/processing.ts` adds `ProcessingStageV2` (with `examine`), `ProcessingField`, `ProcessingReliance`, `CatalogueProposal`, `ProcessingProposalV5`, `ProcessingInputV6` and `ProcessingCommandV5`.
  - `ProcessingStage` is unchanged, so `/1`–`/5` inputs still refuse `examine`.
  - `ProcessingInputV6` is four exact shapes: each profile (`native-agent/2` with an agent selection, `synthetic-session/1` without one) crossed with each scope (the Examine lead with a null subject, or a lot stage with a subject). It is not added to the shared `ProcessingInput` union, because existing `/1` handlers decode that union and rely on `dependencies` and a subject. Only the session handler will decode `/6`.
  - `ProcessingCommand` and `ProcessingProposal` gain `/5`.
- `ProcessingJob`, `AgentSessionList` and `HeaderWork` take `ProcessingStageV2`, and the first two allow a null `subject_id`.
- `contracts/generated` was regenerated. Every versioned component (`ProcessingInputV1`–`V5`, `ProposalV1`–`V4`, `CommandV1`–`V4` and all envelopes) is byte-identical to `HEAD`; only those read models and the two unions changed.
- `live.ts` needs no change: live streams are per batch, so session changes publish on the batch stream with the existing frame.

### Migration and grants

`intake-server/migrations/0018_agent_session_runtime.sql`:

- adds the `native-agent/2` and `synthetic-session/1` profiles on handler `processing/5` and tool profile `native-session-tools/1`, with their instruction bytes and digests;
- adds the `examine` stage, makes `processing_job.subject_id` nullable with `CHECK ((subject_id IS NULL) = (stage = 'examine'))`, and adds the partial unique index `processing_job_examine_once`;
- adds `processing_proposal.relies_on` and the append-only `processing_proposal_stale` table;
- adds `session_state`, `session_lineage_id` and `capability_sha256` to `agent_session` (the provider session or thread ID reuses `native_session_id`), with the lineage immutable once set;
- adds `agent_session_outbox` and `agent_session_inbox` (append-only, gap-free sequences), `agent_session_cursor` (forward only), `agent_slot` and `agent_settings.session_concurrency` (1–8, default 3).

`grantProcessing` gives the runner the outbox, inbox notices, stale marks, cursor and slot writes, and the new `agent_session` columns. The API gets inbox and stale inserts and `UPDATE(session_concurrency)`. Both get `SELECT` on the new tables.

### Server and frontend follow-on

- `processing/schema.ts` keeps the job row type on the legacy stage and a non-null subject. Lead jobs exist only once task 8 creates them, and task 8 owns their null-subject reads (D8).
- `inboxProcessing`, `LotEvidence` and `ProcessingWorkspace` skip jobs without a subject. Including the lead job in the inbox projection is task 8.
- `processing/catalogue.ts` adds `assessCatalogue`, which applies `validatePartSpec`'s reference checks and the D13 rules to each catalogue value. The task text asked for PostgreSQL tests; the assessment is a pure function over observations, so its tests run in the fast tier, and task 10.4 covers it with observations read from the database.

### Tests

- `contracts/tests/sessions.test.ts` (11 tests): status line bounds, question fields and assumption, the outbox and inbox kinds, `/5` catalogue choices, the `/6` lead and lot shapes, `examine` refused by `ProcessingStage`, command `/5`, null-subject jobs and sessions, and tool results. All 11 failed before the schemas existed, with valid controls in each.
- `intake-server/tests/processing-catalogue.test.ts` (3 tests): applicable references, every unsupported reason, and references that fail Part spec checks.
- `intake-server/tests/pg/session-schema.test.ts` (8 tests): profile digests, the lead-job CHECK and per-batch index (a second batch as control), gap-free append-only outbox and inbox, cursor and lineage rules, stale marks, concurrency and slot bounds, the runtime roles' grants, and upgrading a database already at `0017`. Before the grants were added, the five tests that write as `runner` or `api` failed with `42501`.

### Results (task 2.4, 2.5)

- `pnpm contracts:check` clean after regeneration.
- `pnpm test:intake`: 72 contract and 181 intake-server tests passed.
- `pnpm test:frontend`: 310 passed. `pnpm typecheck`, `pnpm lint:readability`, `pnpm lint:frontend` and Prettier pass.
- `pnpm db:intake test`: 171 passed (163 baseline plus 8 new), including the retained-fixture and compatibility suites, so `/1`–`/5` bytes still decode unchanged.

## Task 3: session tool server

### Baseline (task 3.1)

- PostgreSQL: the task 2 run (171 passed) is the baseline for the agents and Processing suites.
- Process tier, before any task 3 change: 44 tests, 40 passed, 1 failed, 3 skipped. The failure predates this branch: `tests/process/media-resources.test.ts:124` expects the decoder container's 512 MiB memory limit, but #93 raised `MEDIA_LIMITS.memoryMiB` to 1024 without updating the test. The 3 skipped tests depend on that sandbox check. Not fixed here; it belongs with the media change.

### Dependencies

`intake-server` adds `@modelcontextprotocol/server` 2.4.0 and `@modelcontextprotocol/node` 2.1.2, and `@modelcontextprotocol/client` 2.4.0 as a dev dependency, all pinned exactly. The lockfile changes, so this worktree has its own `pnpm install` rather than a linked `node_modules`. The server takes no direct `zod` dependency: tool schemas come from the contracts (below).

### What it does

- `agents/tools/capability.ts` issues a random 256-bit capability per provider run and stores only its SHA-256 on `agent_session`. A capability resolves only for a `running` session of a session profile; revoking clears it.
- `agents/tools/outbox.ts` appends outbox items under the session row lock, so sequences stay gap-free.
- `agents/tools/inbox.ts` accepts items with per-lineage idempotency (a repeated key returns the original receipt, a changed payload is `idempotency_conflict`), counts pending items, and reads after a cursor. Reading acknowledges up to the cursor, never past the newest item and never backwards, and returns the next unacknowledged items with their stable IDs.
- `agents/tools/handlers.ts` implements `status` (rate-limited, default one per 2 seconds), `propose`, `ask`, `reply`, `fetch_evidence` and `read_inbox`. Each call runs in one transaction and resolves its capability again inside it, so a revoke before the write refuses the call with no change. Refusals are typed results the agent can correct. `propose` and `ask` lock capture, then the job and attempt, retain a `bench-intake-session/1` envelope in `processing_message`, write the proposal (with `relies_on`) or question, and append the outbox item; the batch hint is appended last. A question leaves the attempt running.
- `agents/tools/server.ts` serves the MCP endpoint on `127.0.0.1` with an ephemeral port, the SDK's localhost `Host` guard and 401 for any capability that does not resolve. Each request builds a stateless `McpServer` with that session's tools. Tool input schemas are the contract JSON Schemas; validation stays in the handlers so invalid calls get typed results rather than protocol errors.
- `processing/provenance.ts` now has `deliveredSourceCheck`, shared by `validateProposalSources` and the session tools (task 3.4). Behaviour for earlier profiles is unchanged.
- `processing/session-input.ts` builds a lot session's `/6` opening manifest from the `/2` media manifest checks, and `decodeJobInput` decodes any job input.
- Answers to session questions (`processing/session-answers.ts`, called from `answerQuestion`) apply the same human capture edit as before, mark the question answered, record the answer against the same attempt, and queue an `answer` inbox item. There is no continuation attempt.
- `POST /api/v1/batches/:id/processing/:jobId/inbox` accepts operator chat as a `SessionInboxSubmission`.

### Read paths

Whatever the tools write must stay readable, so this task also teaches the read paths about sessions:

- The Processing snapshot reads session proposals and questions through their envelopes (`retainedSessionProposal`, `retainedSessionQuestion`). Questions add `fields` and `assumption` to the read model.
- A session job's input currency is its current attempt, a live batch and available media. Per-proposal staleness is task 11.
- Qualification follows the profile: both native profiles are `native_unverified`.
- `AgentSessionList` and `HeaderWork` list `/6` sessions. Their `selection` is null for `synthetic-session/1`, and the Agents page and masthead show it as a synthetic session.

### Deferred, by task

- Starting the tool server in the agents worker, and a process test with a scripted client through it: task 4, which wires the adapters to it. Task 3's tests drive the real endpoint over loopback HTTP with the SDK client.
- `/2` command authority (`loadProcessingAuthority` and the `bench-sessions` queue): task 5.
- Lot-forming tools, lead sessions with a null subject, and observation citations: tasks 7 and 8. Until then those citations are refused as `source_not_delivered`.
- Decoded previews, pages and region crops in `fetch_evidence`: task 8. Until then it returns verified originals of delivered JPEG, PNG or WebP versions within the 8 MiB per-run budget, as `/1` does.
- Citing evidence that arrived through the inbox after start: task 11.

### Tests

`tests/pg/session-tools.test.ts` (5 tests) runs the real endpoint with the SDK client against two seeded `synthetic-session/1` research sessions:

- capability: unknown, missing, revoked and other-session capabilities are refused with no rows written, and calls are attributed to their own session (3.2.1);
- typed errors: an overlong status line, a status inside the rate window, an undelivered citation and a proposal for another lot publish nothing; an accepted proposal and question are ordered in the outbox, and the attempt keeps running (3.2.2);
- inbox: a duplicate key returns the original receipt, a changed payload conflicts, unacknowledged items are redelivered with the same IDs, acknowledged ones are not, and the cursor never moves back (3.2.3);
- the Processing snapshot and the session list read session proposals and questions;
- an answer and a chat message each reach the inbox once, with the same receipt on resubmission, and the answer applies the human quantity edit.

The tests failed before the modules existed. As a negative control, the delivered-source check was temporarily made to accept everything: the unchanged test failed on the undelivered citation, and the file was restored byte for byte from a backup (same SHA-256).

### Results (task 3.5)

- `pnpm contracts:check` clean; `pnpm typecheck`, `pnpm lint:readability`, `pnpm lint:frontend` and Prettier pass.
- `pnpm test:intake`: 72 contract and 181 intake-server tests passed. `pnpm test:frontend`: 310 passed.
- `pnpm db:intake test`: 176 passed (171 plus the 5 tool-server tests).

## Task 4: session adapters, state machine and worker

### Baseline (task 4.1)

The task 3.1 process baseline applies: 44 tests, 40 passed, the pre-existing media memory failure and its 3 dependent skips. The `/1` adapter tests (`tests/process/agents.test.ts`) were among the passes.

### Adapters

`agents/session-adapters.ts` adds `runClaudeSession` and `runCodexSession`. The `/1` adapters are unchanged; Codex reuses the exported `/1` hardening keys plus `features.goals = false`.

- **Claude:** writes `mcp.json` (mode 0600) naming `${INTAKE_TOOL_CAPABILITY}`, never the value; passes `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, `--allowedTools mcp__intake__*` and no `--safe-mode`; starts with `--session-id` and resumes with `--resume`. The init check requires exactly the session's `mcp__intake__*` tools and one connected `intake` server, and only those tools may appear as `tool_use`. Operator items are written to stdin as stream-JSON while the turn runs. A resume that exits before init (for example, a missing transcript) is `resume_unavailable`.
- **Codex:** passes `mcp_servers.intake={url, bearer_token_env_var, default_tools_approval_mode="approve"}`; starts non-ephemeral threads and resumes with `thread/resume`. After start, `config/read` must list only `intake` and `mcpServerStatus/list` must report exactly the session's tools. Operator items are sent with `turn/steer` and the active `expectedTurnId`; a refused steer leaves the item for `read_inbox` or a resume. A refused `thread/resume` is `resume_unavailable`. Server-initiated requests are still refused.

Both put the capability only in the child environment, and both poll the inbox during a turn (every 500 ms) so delivery happens in turn where the CLI supports it. `read_inbox` stays the guaranteed path.

### State machine

`agents/session-runner.ts`:

- `runSessionTurn` claims a `queued` session (a guarded `queued → running` change, so two claims cannot both win), checks the profile instructions against the manifest digest, issues a fresh capability, and resumes the provider conversation when one exists. It then settles: the capability is revoked and the next state is `queued` (more inbox items), `waiting_input` (an open question), or `finished`. `resume_unavailable`, `waiting_for_login`, `interrupted` (shutdown or provider crash) and `failed` (refusals) come from the error. The attempt and job follow: `running`, `waiting_for_user`, `ready`, `interrupted`, `failed` and so on.
- `interruptRunningSessions` runs at worker start: running sessions become `interrupted` with their capability revoked, and no turn continues.
- `queueSessionResume` re-queues a lineage's latest session when it is waiting, finished or interrupted.
- Locks follow the tool handlers' order (job, attempt, then session row).
- `syntheticSessionDriver` is the deterministic `synthetic-session/1` runner. It calls the same tools: a status line, a proposal from the first delivered note, replies to chat, and one quantity question when nothing has been answered, so the answer arrives through a resume.
- `failed` was added to the session states in migration `0018` and `SessionState`, and the session lineage foreign key is deferred, because `queueJob` writes the attempt before its job.

### Worker and creation

- `createAttempt` hands the session profiles to `processing/session-attempts.ts`. That builds the `/6` manifest (with the saved agent selection for `native-agent/2`), a `/5` command on `bench-sessions` and a `queued` session whose lineage is the job. Reading and identifying are refused for session profiles; the Examine stage replaces them in task 8.
- `INTAKE_PROCESSING_PROFILE` accepts `native-agent/2` and `synthetic-session/1`.
- `agents/session-worker-main.ts` is the supervised session worker. It takes the same per-actor supervisor lock as the `/1` worker, interrupts running sessions, starts the tool server, registers `intakeCommand` and `sessionResume` on `bench-sessions` (`processing/5`, worker and global concurrency 8), dispatches commands and wakes sessions with pending inbox items. A wake's workflow ID is `resume:<lineage>:<inbox high-water>`, so a repeated wake is a no-op.
- Session commands are authorized by `executeSessionCommand` from the retained command row (queue, handler, account binding, workflow ID, exact payload bytes), not by `loadProcessingAuthority`, which keeps accepting only `bench-research`. Design D9 records this.

### Tests

- `tests/process/sessions.test.ts` (12 tests: six cases, each for Claude and Codex) runs the real adapters against `tests/fixtures/session-agent.cjs`, a fake CLI that speaks each protocol and calls the real tool server: an extra tool at start is refused and the session fails with its capability revoked; chat reaches the running turn (stdin or `turn/steer`) and is acknowledged; `mcp.json` holds no capability; a finished session resumes with queued chat and its old capability is refused; a resume without a transcript is `resume_unavailable` with the item still pending; a crash interrupts, a worker restart interrupts a running session and no turn starts on its own; a child that ignores SIGTERM is reaped and the session interrupted.
- `tests/process/session-worker.test.ts` runs `session-worker-main` through the real DBOS boundary: a synthetic session started from the Processing route publishes a status line, a proposal and a question and waits; the HTTP answer reaches the inbox, the sweep resumes the session, and it proposes again relying on the answer and finishes.
- The adapter environment is an allowlist, so the fake reads its mode from the private session directory instead of the environment.

For this task the adapters and runner were written before the fake-CLI tests, not test first. To compensate, two negative controls were run with backups: with the init tool check disabled, the extra-tool test failed; with in-turn delivery disabled, the delivery test never completed. Both files were restored with identical SHA-256.

### Left for later tasks

- Slots and the configured limit, including "a child that ignores SIGTERM keeps its slot until reaped": task 5. The worker already registers `bench-sessions`.
- The browser view of sessions: task 6.
- Live provider behaviour, including whether models act on in-turn input: task 13.

### Results (task 4.4, 4.5)

- `pnpm contracts:check` clean; `pnpm typecheck`, `pnpm lint:readability`, `pnpm lint:frontend` and Prettier pass.
- `pnpm test:intake`: 72 contract and 181 intake-server tests passed. `pnpm test:frontend`: 310 passed.
- `pnpm db:intake test`: 176 passed.
- `pnpm db:intake test:process`: 57 tests, 53 passed, 1 failed, 3 skipped. The failure and skips are the pre-existing media sandbox memory check from task 3.1. The `/1` adapter tests and the duplicate-supervisor fence pass unchanged; the 13 new tests pass.
- Remaining live unknowns, for task 13: whether real models call the tools reliably, act on in-turn input, and resume with full context; the subscription login paths.

## Task 5: session slots and concurrency

### Baseline (task 5.1)

The task 4 runs are the baseline for the lane and settings tests: PostgreSQL 176 passed; process 57 tests with only the pre-existing media failure and its skips.

### What changed

- `AgentSettings` returns `session_concurrency` (1–8; 3 when no default is saved), and `AgentSettingsUpdate` takes it optionally, saved with the same expected-revision write. The Agent settings form has a "Sessions running at once" select.
- `agents/slots.ts` claims and releases slots. Claims for one actor are serialized with a transaction-scoped advisory lock; the limit is read on each claim; a `/1` lane holder counts as one slot; queued sessions without a slot start oldest first; the slot row is taken with `FOR UPDATE SKIP LOCKED`. Lowering the limit only stops new claims.
- `runSessionTurn` claims a slot in the same transaction as the `queued → running` change. Without one the session stays queued and the workflow re-checks every 500 ms; DBOS's cap of 8 sits above any limit. Settlement releases the slot; an unconfirmed reap rethrows before settlement, so its slot stays occupied.
- The supervisor fence (`acquireAgentSupervisor`) also refuses to start while any session slot is occupied (`agent_reap_confirmation_required`), as it already did for an occupied lane: session children run in their own process group and can outlive the worker. As for `/1`, confirming termination and clearing the slot is an explicit maintenance step, not a browser action.
- `bench-sessions` is registered by the session worker (task 4). Session commands are authorized from the retained command row; `loadProcessingAuthority` keeps rejecting `bench-sessions`, and task 5's text was aligned with design D9.

### Tests

- `tests/pg/session-slots.test.ts` (6 tests): with a limit of 3 the fourth session waits and starts when a slot frees, and a held claim is not doubled; queued sessions start oldest first; lowering the limit leaves holders alone and only stops new claims; a `/1` lane holder counts as one slot, and an occupied slot blocks a new supervisor until released; the settings API saves and returns the limit; two concurrent claims cannot both take the last slot.
- `tests/process/session-worker.test.ts` adds a run of the session worker with the `hold` fake: four lots started with a limit of 3 give three running sessions and one queued, three slots held; releasing one starts the fourth; all four finish and no slot stays held.
- The Agent settings form test covers saving the limit with the loaded revision.

### Results (task 5.4, 5.5)

- `pnpm contracts:check` clean; `pnpm typecheck`, `pnpm lint:readability`, `pnpm lint:frontend` and Prettier pass.
- `pnpm test:intake`: 72 contract and 181 intake-server tests passed. `pnpm test:frontend`: 311 passed.
- `pnpm db:intake test`: 182 passed. The first run had one failure, the `/1` native settings test expecting the old settings shape without `session_concurrency`; its expectations were updated and the file passed (4 tests).
- `pnpm db:intake test:process`: 58 tests, 54 passed, with only the pre-existing media failure and its 3 skips. The `/1` lane occupancy and fence tests pass unchanged.

## Task 6: session UI and header

### Baseline (task 6.1)

`pnpm test:frontend` before task 6: 311 passed (the task 5 run).

### Reads

- `GET /api/v1/batches/:id/processing/:jobId/session` returns `SessionTimeline`: the latest session's state, the newest 500 outbox items across the job's attempts and the newest 500 inbox items, each oldest first, and `truncated` when older items exist (review round 1). It is scoped to the batch and the caller's account; an unknown job is 404.
- `ProcessingJob` carries `session_state` for session jobs, so the UI shows a session panel only where one exists.
- `AgentSessionList` and `HeaderWork` rows carry `session_state` and `latest_status` (text and time). The header also lists sessions waiting for input; `occupies_lane` there means holding the `/1` lane or a session slot, so a waiting session shows `false`.
- The processing client adds `session` and `chat`. `configuredRunnerStatus` reports `native_unverified` for `native-agent/2`.

### UI

- `SessionTimeline` shows the steps (status lines and results) in order with times, the current activity in a polite live region that announces only the newest status line, and the chat (operator messages, answers and agent replies).
- `SessionChat` is a labelled composer, enabled in every state except cancelled. A cancelled session offers "Start a fresh session", which queues a new attempt for that lot and stage. One idempotency key is kept per draft until a send is confirmed.
- `SessionPanel` loads the timeline under the batch's Processing query key, so live hints refresh it like every retained read, and sits inside each session job card.
- Session questions show the assumption in use on the job card, in Needs you and in the answer form, whose action is "Send answer to the session".
- The masthead's workflow details show each session's latest status line and time, and "Waiting for your input · holds no slot" for a waiting session.
- A Processing start for a session profile queues only Research and Images (task 4 noted the reading and identifying refusal; task 6 found the start button always asked for all five stages).

### Tests

- Vitest: `SessionTimeline.test.tsx` (order and current activity, chat order, the composer in a finished session with a stable key on retry, the cancelled-session offer), `QuestionAnswer.test.tsx` (the assumption and the session action label, and the unchanged earlier-profile label), and a header test for the latest line and the waiting label. The component tests failed before the components existed.
- PostgreSQL: a session-tools test for the timeline (order, waiting state, 404), the session list's latest status, and the header listing a waiting session as holding no slot.

### Browser check (task 6.5)

`tests/fixtures/session-browser.ts` serves the built UI with `synthetic-session/1` and a real session worker on reserved port 4360. Run headless in a separate Chrome under the coordination `browser` lease, against a fresh batch:

1. Queuing Packet A from the Processing view started Research and Images sessions. Each showed "Current activity", ordered steps with times, its proposal, and its question with "Continuing on: Treating the lot as one item until answered"; Needs you listed both with their assumptions.
2. Answering the Images question through the answer form ("Send answer to the session") resumed that session: a new status line and proposal appeared, the chat showed the answer, and it finished.
3. Two chat messages to the waiting Research session each resumed it and got a reply.
4. A chat message to the finished Images session resumed it, got a reply, and it finished again.

The app's own reads confirmed each step's session state and inbox. Screenshots are kept outside the repository in the coordination pack (`artefacts/simplify-intake-entry-6.5/`). Limits: the preview, like the existing processing preview, does not register the header routes, so the masthead line was checked by the component and PostgreSQL tests, not in the browser; "One research lane per account" in the Processing panel is stale copy for session profiles, left for task 12's labels.

### Results (task 6.4)

- `pnpm contracts:check` clean; `pnpm typecheck`, `pnpm lint:readability`, `pnpm lint:frontend`, `pnpm lint:markdown`, Prettier and `pnpm build` pass.
- `pnpm test:intake`: 72 contract and 181 intake-server tests passed. `pnpm test:frontend`: 318 passed.
- `pnpm db:intake test`: 183 passed. `pnpm db:intake test:process`: 58 tests, 54 passed, with only the pre-existing media failure and its 3 skips.
- `agents/ARCHITECTURE.md` and `processing/ARCHITECTURE.md` describe the session profiles, tool server, adapters, state machine, slots and worker.

## PR-A review round 1

Independent review by Codex (`gpt-6.1-sol`, read-only) of `8f4a81c..e70bd69` (head `e70bd693f0137dc663f8447e5b8826fbe46813a4`) reported 15 findings: 12 important, 3 minor. Each was checked against the code and all were confirmed. Fixes:

1. **Cancellation reached no provider.** The runner now watches the attempt and aborts the turn when it leaves `running`. Settlement keeps `cancelled`, and a claim of a cancelled queued session settles it `cancelled` without running.
2. **Settlement locked in the reverse order.** Claims, settlement, interruption and tool calls now all lock job and attempt before the session row; publication locks capture first.
3. **Chat ignored the account scope.** Inbox submissions take the caller's binding and refuse a job whose batch belongs to another actor, target or context.
4. **A capability could outlive its revocation.** Each tool call locks job, attempt and the session row and checks the capability digest, the running session and the running, current attempt under those locks.
5. **A turn that settled to `queued` could stay there.** The wake sweep now makes sure every queued session has a live workflow.
6. **Resume scheduling had a commit/enqueue gap, and a crashed resume reused its workflow ID.** `agent_session.turn_count` counts claimed turns, and wake workflow IDs are `resume:<attempt>:<turn>:<generation>`: a live workflow is left alone, a finished one gets the next generation.
7. **The Codex dedicated-home preflight was dropped.** `runCodexSession` calls the shared `rejectHostCustomizations` before starting the child.
8. **Citations were not limited to delivered sources.** Media must have been returned by `fetch_evidence` in the lineage (tracked in the worker, so a restart means fetching again before citing); a relied-on proposal must be pinned or the lineage's own; nested catalogue sources are checked on publication and on retained reads (`catalogueSources`).
9. **The runner could forge operator inbox entries.** The runner's insert grant excludes `actor_id`; a CHECK requires chat and answers to name an operator and notices not to; a trigger requires an answer item to match a retained answer for the same job, question and operator. Runner notices, when tasks 8 and 11 add them, must list their columns explicitly.
10. **Replies were not idempotent.** A reply to an inbox item that already has one in the lineage adopts it and writes nothing.
11. **The header could drop an occupied slot.** Slot holders are included and ordered first, like the `/1` lane.
12. **Session history had no polling fallback.** The session panel uses the retained-read poll interval and says when a refresh failed.
13. **The image budget was per attempt and racy.** It is now per provider run (capability digest) and reserved before fetching.
14. **The timeline stopped at 500 entries.** It returns the newest 500 of each, oldest first, with `truncated`.
15. **Editing could abandon an unconfirmed chat send.** An unconfirmed send is kept with its key until retried or discarded; drafting is separate and cannot send until then.

Results after the fixes: contracts 72, intake server 181 and frontend 320 passed; `pnpm db:intake test` 187 passed; `pnpm db:intake test:process` 62 tests, 58 passed, with only the pre-existing media failure and its 3 skips; typecheck, lint, Prettier and build pass.

Regression tests: `tests/pg/session-schema.test.ts` (forged or anonymous inbox entries, unbound answers), `tests/pg/session-tools.test.ts` (cancelled attempt, other-scope chat, duplicate reply, undelivered nested and proposal citations, the header slot holder, the wake sweep with a recording scheduler), `tests/process/sessions.test.ts` (cancelling a running session for both CLIs, a cancelled queued session, a customized Codex home), and the chat composer tests.

## Validation

- `pnpm spikes:check`: 35 passed (the existing shared-contract suite; the new spike adds no test there).
- Prettier and the configured remark lint pass on the spike.
- `openspec validate simplify-intake-entry --strict` passes after the plan updates.
