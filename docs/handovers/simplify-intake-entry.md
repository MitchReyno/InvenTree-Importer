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
- `agents/session-worker-main.ts` is the supervised session worker. It takes the same per-actor supervisor lock as the `/1` worker, interrupts running sessions, starts the tool server, registers `intakeCommand` and `sessionResume` on `bench-sessions` (`processing/5`, worker and global concurrency 8), dispatches commands and wakes sessions with pending inbox items. A wake's workflow ID is `resume:<attempt>:<turn_count>:<minute_bucket>`, so a repeated wake within a minute is a no-op and a later turn gets a fresh workflow.
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

## PR-A review round 2

Codex (`gpt-6.1-sol`, read-only) reviewed `8f4a81c..62f4d0c`: 7 findings (6 important, 1 minor), all confirmed. It found no issues in the earlier-profile paths, migration `0018` and grants, the answer and settings forms, or round 1 fixes 2–4 and 7–14 beyond these. Fixes:

1. **Resume order could stall the queue, and slot waits were unbounded.** `agent_session.queued_since` is set whenever a session becomes queued; slot claims and the wake sweep both go oldest first by it. A workflow waits at most 30 seconds for a slot, then gives its DBOS worker back and the sweep starts another. Wake workflow IDs are `resume:<attempt>:<turn>:<minute bucket>`; the sweep skips a session whose current or previous bucket workflow is still live.
2. **A session cancelled before dispatch blocked the queue.** The sweep settles queued sessions whose attempt is cancelled or superseded, and slot ranking ignores them.
3. **Image fetches could exhaust the pool.** `fetch_evidence` authorizes and reserves the budget under the session locks, reads the bytes after that transaction ends, and checks the capability again before returning them; failures refund the reservation.
4. **Recovery interrupted other accounts' sessions.** `interruptRunningSessions` takes the worker's binding and touches only its sessions.
5. **Delivery failures could become unhandled rejections.** The delivery loop hands any failure to the adapter, which aborts the turn through a local signal so the child is reaped first, then reports `agent_delivery_failed` (settled `interrupted`). A failed `turn/steer` write does the same.
6. **The Codex boundary checked only MCP tools.** The adapter again checks the effective policy (`approvalPolicy` never, read-only sandbox, the selected provider), and refuses any item other than user and agent messages, reasoning, context compaction and `mcpToolCall` to `intake` with a session tool.
7. **Navigating away lost an unconfirmed chat send.** Unconfirmed sends are kept per batch and job outside the composer for as long as the page is open.

Results after the fixes: contracts 72, intake server 181 and frontend 321 passed; `pnpm db:intake test` 187 passed; `pnpm db:intake test:process` 64 tests, 60 passed, with only the pre-existing media failure and its 3 skips; typecheck, lint, Prettier and build pass.

Regression tests: the wake sweep with a recording scheduler (oldest first, cancelled-before-dispatch settled, live workflows left alone), Codex refusal of a wider policy and of a command item, and the composer keeping an unconfirmed send across unmount.

## PR-A review round 3

Codex (`gpt-6.1-sol`, read-only) reviewed `8f4a81c..92e2c7d`: 7 important findings, all confirmed. It found the earlier-profile paths, migration `0018` and grants, tool-endpoint isolation, the adapter policy and delivery fixes, and the answer, header and settings components sound. Fixes:

1. **A resume claim did not check its account.** The claim reads the retained command and refuses, before any change, a session whose actor, target or context differs from the worker's (`session_command_binding_invalid`). Routing a resume to the matching worker is not solved: like `/1`, one actor's worker per DBOS application is the supported deployment, and a mis-routed claim now changes nothing.
2. **Archived batches could start or resume work.** The claim leaves an archived batch's session queued without running; the wake sweep skips archived batches; new chat for an archived batch is refused (`batch_archived`), while an idempotent replay still returns its receipt.
3. **Unbounded proposals could break the Processing snapshot.** `propose` and `ask` refuse with `capacity_reached` once an attempt has 100 proposals or a job has 100 questions, the limits the snapshot reads.
4. **Older work in another context could block all claims.** Queue ranking covers the worker's own target and context, the same queue it schedules; occupancy still counts every slot the actor holds.
5. **Historical sessions could crowd out resume candidates.** The sweep considers only each lineage's latest session, in a fixed order.
6. **A failure between claim and adapter could leak the slot.** The cursor read now happens lazily inside the turn, so every failure after a claim is settled, freeing the slot and revoking the capability.
7. **Chat recovery still lost an in-flight send on navigation.** The pending send is stored before the request starts, with its status (`sending` or `unconfirmed`) shared through a small store read with `useSyncExternalStore`; a remounted composer shows the send and cannot start another until it is confirmed, retried or discarded.

Results after the fixes: contracts 72, intake server 181 and frontend 322 passed; `pnpm db:intake test` 189 passed; `pnpm db:intake test:process` 64 tests, 60 passed, with only the pre-existing media failure and its 3 skips; typecheck, lint, Prettier and build pass.

Regression tests: a claim under another account changes nothing; an archived batch's session stays queued, its new chat is refused and an earlier chat's replay returns the original receipt; the 101st question is refused; and a composer remounted during an unresolved send cannot send again. Not separately tested: ranking across contexts and the latest-session sweep filter, which need a second target context fixture.

## PR-A review round 4

Codex (`gpt-6.1-sol`, read-only) reviewed `8f4a81c..a9f3303`: 6 important findings, all confirmed, and no minor observations. It found the earlier-profile paths, migration and grants, endpoint isolation, adapter policy checks and all frontend changes sound. Fixes:

1. **Archived queued sessions still counted in slot ranking.** Ranking excludes archived batches, as the claim and sweep do.
2. **Cancelled-session cleanup could deadlock against a claim.** Each cancelled session is settled in its own transaction, so the stream lock is always taken last.
3. **A count cap did not bound size.** Session proposals and questions are also refused (`capacity_reached`) when the batch's retained proposal and question bytes plus the new item would exceed half the Processing snapshot budget (120 KiB of 240 KiB).
4. **In-turn delivery was never acknowledged.** Each item the CLI accepted (stdin written, or a steer that was not refused) is recorded, and a successful turn moves the cursor up to it before deciding whether input is still pending. Failed, refused or interrupted turns leave items pending. A steer reply that never comes counts as not delivered.
5. **Archive checks could race a concurrent archive.** The claim and inbox submission share-lock the batch row before any job lock (capture first, as elsewhere) and check `archived` under it.
6. **A shutdown during the claim could be missed.** A turn whose shutdown signal has already fired is aborted before any child starts, so the claim settles `interrupted` and frees its slot.

Settlement now also locks job and attempt before acknowledging the cursor, keeping one lock order.

Results after the fixes: contracts 72, intake server 181 and frontend 322 passed; `pnpm db:intake test` 190 passed; `pnpm db:intake test:process` 67 tests, 63 passed, with only the pre-existing media failure and its 3 skips; typecheck, lint, Prettier and build pass.

Regression tests: in-turn chat acknowledged without `read_inbox` for both CLIs; a pre-aborted shutdown settles without a child; large proposals stop at the size budget with the snapshot still readable. Not separately tested: archived ranking and the cleanup interleaving.

## PR-A review round 5

Codex (`gpt-6.1-sol`, read-only) reviewed `8f4a81c..2f34cd1`: 5 important findings, all confirmed, and one minor. It found capability enforcement, citation checks, endpoint isolation, `/1` paths, migration and grants, adapter boundaries and the frontend sound. Fixes:

1. **The size cap ignored projection overhead.** Each retained proposal or question also counts a 512-byte allowance for the read-model fields around it, so many small results across jobs stop before the snapshot overflows.
2. **Resume could revive a replaced attempt.** Every session state change, under the job and attempt locks, treats an attempt that is no longer the job's current one as cancelled, so neither resume nor claim can run it.
3. **Settlement acknowledged input for a superseded attempt.** The cursor moves only when, under the locks, the attempt is still running and current; otherwise delivered input stays pending for the replacement.
4. **Startup recovery could deadlock.** Each running session is interrupted in its own transaction, as cancelled-session cleanup already is.
5. **Answer replay returned the opening revision.** `processing_answer.capture_revision` (migration `0018`, null for earlier profiles) retains the revision a session answer returned, and adoption replays it.

Minor: the answer form now says a session answer reaches the agent session rather than queuing a new attempt.

Results after the fixes: contracts 72, intake server 181 and frontend 322 passed; `pnpm db:intake test` 191 passed; `pnpm db:intake test:process` 68 tests, 64 passed, with only the pre-existing media failure and its 3 skips; typecheck, lint, Prettier and build pass.

Regression tests: an answer adopted under a fresh delivery key returns the original receipt; small questions across two jobs stop with the snapshot readable and each projected question within the allowance; a superseded turn leaves delivered chat pending. Not separately tested: resume racing a fresh start, and the recovery interleaving.

## PR-A review round 6

Codex (`gpt-6.1-sol`, read-only) reviewed `8f4a81c..b7800c1`: 1 important finding, confirmed, and one minor. It confirmed the five round 5 fixes and found no other blocking issue in authority, citations, endpoint isolation, lock order, `/1` compatibility, migration and grants, inbox idempotency and wake-ups, adapter checks or the frontend.

1. **Provider turns had no deadline.** A CLI that stayed alive without finishing held its slot indefinitely. Each turn now has a 15-minute deadline (`SESSION_TURN_DEADLINE_MS`; design D3). On expiry the child is aborted through the existing reap path and the session settles `failed`, which the wake sweep never resumes, so a stalled CLI is not restarted in a loop. An unconfirmed reap still throws and keeps the slot held.

Minor: design D3, task 5 and this handover described inbox-high-water workflow IDs; they now describe `resume:<attempt>:<turn_count>:<minute_bucket>`.

Results after the fix: contracts 72, intake server 181 and frontend passed; `pnpm db:intake test` 191 passed; `pnpm db:intake test:process` 70 tests, 66 passed, with only the pre-existing media failure and its 3 skips; typecheck, lint, Prettier and build pass.

Regression test: for both CLIs, a turn held past a 1.5-second test deadline is reaped and settles `failed`, with its capability revoked and slot freed.

## PR-A review round 7

Codex (`gpt-6.1-sol`, read-only) reviewed `8f4a81c..144c652`: 1 important finding, confirmed, and one minor. It confirmed the round 6 deadline fix and found no other blocking issue.

1. **Cancelling an idle session left it active.** Cancellation changes the job and attempt, and the cleanup sweep only handled `queued` sessions, so a cancelled `waiting_input` or `waiting_for_login` session stayed listed as waiting and kept its composer. The sweep (`settleCancelledIdleSessions`) now settles every idle state (queued, waiting for input or login, finished, interrupted, failed, resume unavailable) of a cancelled attempt, and queued sessions of a superseded one. Running and cancelling sessions still settle through their own turn, so the reap requirement is unchanged.

Minor: after a send, `failed`, `resume_unavailable` and `waiting_for_login` sessions now say to start a fresh session instead of promising a resume.

Results after the fix: contracts 72, intake server 181 and frontend 323 passed; `pnpm db:intake test` 192 passed; `pnpm db:intake test:process` 70 tests, 66 passed, with only the pre-existing media failure and its 3 skips; typecheck, lint, Prettier and build pass.

Regression tests: a cancelled `waiting_input` session with no inbox and a cancelled `waiting_for_login` session with pending chat both settle `cancelled` on the next sweep; a failed session's send shows the fresh-session guidance.

## PR-A review round 8

Codex (`gpt-6.1-sol`, read-only) reviewed `8f4a81c..114589a` and found no critical or important defects across authority and citations, concurrency and slots, earlier-profile compatibility (all 16 versioned schemas unchanged), migration and grants, inbox delivery and wake-ups, adapters and the frontend. Its one minor observation, the agents architecture still describing queued-only cancellation cleanup, is fixed in a documentation-only commit after the reviewed head.

## PR-A delivery (D.1)

- **Review:** the eighth independent review was clear at `114589ad008f0014c55497c899630efbae5e9d3c`. Its one minor documentation note was fixed in the docs-only head `cbad77d94396f78f2e6a39d5ddd4b75d090e9f9e`.
- **Published:** [#97](https://github.com/MitchReyno/InvenTree-Importer/pull/97) against `interactive-app`, with no reviewers.
- **CI on `cbad77d`:** every selected job passed except `Intake PostgreSQL and process`, whose only failure, `runtime sandbox has enforced kernel, filesystem and network limits`, failed identically on the `interactive-app` PR run at `8f4a81c`. That test was stale after #93 raised the media limits.
- **Merged:** squash-merged at `cbad77d` as `10f9e7d` on Mitch's instruction.
- **Trunk follow-up:** [#98](https://github.com/MitchReyno/InvenTree-Importer/pull/98) (`ded521a`) updated the stale media-resource tests; that job then passed in full on #98's head `761edd6`.
- **CI from PR-B onward:** the follow-up `ci/skip-intake-pg` PR then disabled the PostgreSQL and process job for Actions usage. PR-B onward record local results for those tiers instead.

## Validation

- `pnpm spikes:check`: 35 passed (the existing shared-contract suite; the new spike adds no test there).
- Prettier and the configured remark lint pass on the spike.
- `openspec validate simplify-intake-entry --strict` passes after the plan updates.

## PR-B task 7: observations and agent-attributed draft lots

Branch `feat/simplify-intake-entry-lot-forming`, worktree `.claude/worktrees/simplify-intake-entry-lot-forming`.

- **Baseline (7.1):** the capture, media and operator PostgreSQL files passed 53 of 53 before any change.
- **Schema (7.3):** migration `0019_evidence_observations.sql` as described in `intake-server/ARCHITECTURE.md` (Evidence observations and agent-formed lots).
  - `capture_lot.changed_revision` was added beyond design D12's column list. Lot staleness needs the batch revision of a lot's last change, and the subject `revision` is a per-subject counter.
  - The agent guards identify agent principals by direct membership of the cluster-wide `intake_agent_writer_marker` role. `pg_has_role` is true for superusers, which wrongly refused the migration owner and test setup in the first run.
- **Role and pool:** `grantAgentWriter` (processing grants) with `grantCaptureAgentWrites` (capture grants); the PG fixture creates a real `writer` role.
  - `UPDATE(progress)` on `agent_session` exists only because `appendSessionOutbox` locks the session row `FOR UPDATE`.
  - The session worker reads an optional `INTAKE_AGENT_WRITER_DATABASE_URL`; without it the lot-forming tools refuse with `tool_not_allowed`. Dev setup does not yet create this role, because changing owned dev state is out of scope until the lead session runs in the launcher (task 8).
- **Tools:** `record_observation`, `propose_lot`, `regroup` are registered on the session tool server. They are refused (`tool_not_allowed`) for any session that is not the batch's Examine lead, and each write is appended to the lead session's outbox.
- **Robustness fix found while testing:** an unexpected handler exception left the MCP call hanging until the client's 60-second timeout. The server now returns a typed `tool_failed` result (new `SessionToolError` code). No dedicated regression test yet.
- **Canonical bytes:** observation regions carry integers, which `canonical` rejects. `canonicalRecord` (contracts `json.ts`) is used for capture revisions, idempotent request and response bytes and the snapshot size checks. For documents without numbers it produces the same bytes.
- **Deferred to task 8:** wiring `fetch_evidence` to region crops and lead-session paging; widening the processing stage type for the null-subject lead job (the tool handler compares the stage as a string for now).

Tests (7.2): `tests/pg/evidence-observations.test.ts` (8 tests, run as the real `agent_writer`, `api` and runner roles) and `tests/region-crops.test.ts`.

## PR-B task 8: Examine lead session, trigger and new evidence

- **Lead job:** `processing_job` rows and their TypeScript types now allow the null-subject `examine` job.
  - Paths for earlier profiles call `requireLotJob` and refuse it.
  - Read models treat its media as batch-scoped and bind its proposals and questions to the batch's subjects.
  - Lead questions may have no subject (`ProcessingQuestion.spec.subject_id` is nullable in the projection), and a clarification answer without one becomes a batch note.
- **Media:** `scopeMediaInputs(snapshot, BATCH_MEDIA_SCOPE)` and `lockBatchMediaInputs` pin every ready original, skipping evidence still preparing. `sessionLeadInputManifest` seals all notes plus evidence and group notes, and `createSessionAttempt` builds the lead attempt.
- **Trigger (design adjustment, D8 updated):** `processing/examine-trigger.ts` is a sweep in the session worker loop on the `agent_writer` pool, not a DBOS debounce workflow.
  - The quiet period is measured from the newest decode result.
  - A concurrent sweep's unique violation is skipped.
  - A new-evidence notice is one per new ready original that the lead's attempts did not pin, keyed by the version ID; the existing wake sweep resumes the session.
  - It needs the Processing queueing grants, so those moved forward from task 10 to `agent_writer` (D10 updated).
- **Found while testing:**
  - System inbox notices were inserted through Drizzle, which lists `actor_id` and `created_at` and so needs privileges the system roles deliberately lack. Notices with no actor now use a plain insert of the permitted columns.
  - `readAgentSettings(..., lock=true)` needs `UPDATE` on `agent_settings`, so the trigger reads the saved selection without the lock.
  - The losing side of a concurrent sweep notified the lead about its own pinned photos; pinned versions are now excluded.
- **Lead tools and turns:**
  - The lead session's `fetch_evidence` reaches pinned media and evidence notices. It returns 768 px previews or region crops (`media/region-crops.ts`), each page's preview size, the evidence label and the operator's note.
  - The opening message carries the lead instructions, and the lead's turns allow the three lot-forming tools.
  - `propose` and `ask` from the lead stay on the runner pool and accept any live lot or batch subject; moving `propose` to `agent_writer` comes with queueing in task 10.
- **Synthetic lead:** `agents/synthetic-lead.ts` scripts lots from each photo's note and keeps its marking-to-lot map in its private working directory between turns.
- **Tests:**
  - `tests/pg/examine-trigger.test.ts`: single lead job under concurrent sweeps, quiet-period restart, notices only for new photos, archived and no-default refusals.
  - `tests/pg/examine-lead.test.ts`: one photo holding three items and one item across two photos give four observations and three lots. The shared item is counted once ("label · same item in 2 photos", 500 not 1000). A later photo joins the right lot and leaves the others unchanged.

## PR-B task 9: live lots on Capture and Review

- **What changed:** see `frontend/ARCHITECTURE.md`, section "Lots the Examine lead session forms". Crops are served by `GET /api/v1/batches/:id/media/observations/:observationId/crop`. The web process caches them beside `INTAKE_BLOB_ROOT`, as `<root>-region-crops`.
- **Known limit:** each adopted live revision remounts the Review workspace (its key includes the revision), so an inspected lot's local view state resets when the lead session writes. Drafts are protected because adoption waits while any draft is dirty.
- **Tests:** `ProposedLotsGlance`, `proposed-lots`, `lead-status`, `LotObservations` and an `OperatorReview` integration test. The integration test covers a dirty draft holding off a live lot until discard, after which the lot appears with its chip and Review stays editable.

## PR-B review round 1

A fresh read-only reviewer subagent reviewed `4080ea9..30200dc` and found 5 important and 7 minor findings. It confirmed that the lock order, trigger single-flight, `canonicalRecord` byte identity, legacy operator lot bytes, tool and crop-route authorization, and the guard tests are sound. Fixes:

1. **Operator commands left AI lots unmarked.**
   - `touchSubject` (used by lot, bulk and `move_lots` commands) now marks the lot edited.
   - `recordLineage` marks every split, merged or retired predecessor.
   - Retired lots count as edited, so observations left on them are only suggested elsewhere.
2. **Agent writes had no capacity limit.**
   - Agent writes are capped at 1000 observations per batch (suggestions included) and 100 active observations per lot.
   - A new lot and its new Part count together against the subject limit.
   - `finish()` re-projects and validates the snapshot, including its byte limit, before publishing. Overflow surfaces to the agent as `capacity_reached`.
3. **A trigger failure stopped the session supervisor.** A failing batch (for example over 64 originals) is now logged with a safe code and skipped until its evidence signature changes. Other batches carry on, and the worker keeps the skip map across sweeps.
4. **A real lead session could not see the batch.**
   - The new lead-only `read_batch` tool returns the revision, lots, Parts and observations (with edits and suggestions), and the instructions and opening message point to it.
   - Lot-forming results now return `suggested` and a created `part_subject_id`.
   - Stale conflicts now carry the observation's current lot and edit state, and `operator_edited` as a reason. The synthetic lead reads the batch at the start of each turn.
5. **Estimates could pass as counts.** An AI lot whose quantity is still inherited raises `quantity_required` even when the batch default is set.
6. **Database guards had gaps.** Agent principals may rename only subjects they created and the operator has not edited, must attribute capture revisions to their session under the batch actor, and may queue only `process` commands. Membership changes are also refused for edited observations.
7. **The marker role check was too narrow.** It now uses `pg_has_role` (inherited membership) and excludes superusers.
8. **Crop cache.** Staging names are unique, a trailing slash on `INTAKE_BLOB_ROOT` no longer moves the cache inside the store, and there is no shared temp fallback (no cache directory means no crop image).
9. **Tool failures were silent.** Unexpected failures are logged with the tool name and a safe code, and a regression test covers `tool_failed`.
10. **Undelivered evidence was accepted.** `record_observation` now accepts only evidence delivered to the lead session.
11. **Frontend.** The glance no longer renders a stray `0`. Review offers accept and dismiss for suggested revisions of edited observations. Suggestion and revision buttons and crops have distinguishing labels. The lead status line also refreshes every 15 seconds.
12. **Docs and fixtures.** Task 8.3 and the architecture guard description now match the code. The browser fixture's session worker gets `INTAKE_AGENT_WRITER_DATABASE_URL`. The dev launcher does not start a session worker at all yet, so there is nothing more to wire there.

The full PostgreSQL tier at `30200dc` passed 207 of 207. The process tier passed 66 of 70; its one failure ("owned probe must become observable") was a Docker timing failure while other PG work ran in parallel, with its 3 dependent skips, and is rechecked in the final run.

## PR-B review round 2

A fresh reviewer subagent reviewed `4080ea9..28e7964` and found 3 important and 4 minor findings, plus a nitpick. It confirmed round 1 fixes 1, 3, 5 and 7–11. It found fix 2 incomplete (I1 below), fix 4's conflict state not applied (I3 below; that edit had silently matched nothing), and the guards from fix 6 untested.

1. **I1: extending a lot could create Parts past the subject limit.** Extending a lot with `part: { label }` now checks the subject limit too, as creating a new lot already did.
2. **I2: migration `0019` created a cluster role.**
   - That failed under the dev migrator, which is `NOCREATEROLE`. It was the cause of this round's `dev-stack` and `dev-environment` process failures.
   - Trusted provisioning (`grantCaptureAgentWrites`) now creates the marker instead of the migration.
   - `is_agent_writer()` returns false while the marker is absent, and checks `USAGE` (inherited membership), so an admin-only membership from creating a role does not count. Superusers stay excluded.
3. **I3: stale conflicts lacked the row's current state.** They now carry the observation's current `lot_id` and `operator_edited`, and the reason is `operator_edited` when an operator edit caused the conflict. The stale test asserts the whole conflict.
4. **M1: the trigger skipped batches after transient errors.** Only failures that repeat until the evidence changes (`media_input_capacity`, `processing_input_capacity`) skip a batch; anything else is retried next sweep. Skipped batches are filtered in SQL before the 50-batch limit.
5. **M2: guard coverage and doc accuracy.**
   - New raw-SQL refusals as `agent_writer` cover renaming the operator's lot, a revision without a session or under another actor, a non-`process` command, and relinking an edited observation.
   - The architecture doc now says operator Part renames are not tracked; the application never renames Parts as the agent.
6. **M3: `finish()` reported every error as capacity.** Only an over-limit projection (`invalid_contract` from the snapshot check) becomes `capture_capacity`; other errors stay unexpected (`tool_failed`).
7. **M4: some suggestions could not be resolved in Review.**
   - Review now lists unassigned observations, with their suggested lots and revisions, while no lot is inspected (`operator/UnassignedObservations.tsx`).
   - Split, merge and retirement delete suggested memberships aimed at the retired lot.
8. **Not changed: duplicate batch locking.** It is harmless, and `registerMediaRoutes` keeps its per-process temp default for test callers only; the web process passes its own directory and the tool handler has no fallback.

Results at `28e7964`, before these fixes:

| Tier | Result |
| --- | --- |
| Full PostgreSQL | 212 of 212 passed |
| Process | 64 of 70; fixed: `dev-stack`, `dev-environment` (I2); timing: runtime sandbox probe, plus its 3 dependent skips |

After these fixes, the focused PostgreSQL files (observations, trigger, lead, session tools, operator review) passed 43 of 43, and `dev-stack` and `dev-environment` passed 3 of 3.

## PR-B review round 3

A fresh reviewer subagent reviewed `4080ea9..fdc805e`. It found one important finding and five minor ones, plus two nitpicks. It confirmed round 2 fixes I1–I3 and M2–M4.

1. **I-1: an oversized lead manifest was retried every sweep.** `processing_input_capacity` is raised as a `ProcessingError`, so the trigger never matched it to its permanent codes. The trigger now reads codes from both `CaptureError` and `ProcessingError`, and logs `examine_trigger_retrying` for transient failures. A test overflows the lead manifest with long evidence notes and checks the batch is skipped.
2. **m1: a lead quantity question could never be answered.** The lead session's `quantity` question must now name a live lot. A new end-to-end test covers a batch-level clarification question: it is projected with a null subject, and its answer becomes a batch note. A quantity question with no subject is refused.
3. **m2: the Capture glance listed retired lots.** It now hides lots the snapshot marks `retired`.
4. **m3: missing regression tests.** New tests cover the subject limit on the extend path, and suggestions dropped when a split retires their lot.
5. **m4: subjects inserted by an agent could be unattributed.** Agent-inserted subjects must now carry their session (`capture_agent_subject_insert_guard`).
6. **m5: observations on retired lots were hidden.** Observations left on a split, merged or retired lot are listed with the unassigned ones in Review.
7. **Nitpicks.**
   - Creating the marker role tolerates a concurrent provisioner.
   - A crop whose region no longer matches its preview raises a typed `region_preview_mismatch` (409).

## PR-B review round 4

A fresh reviewer subagent reviewed `4080ea9..80dbf9b` and found one important and three minor findings, plus three nitpicks. It confirmed the round 3 fixes.

1. **Important: a Review split left every observation on the retired lot, with no way to move them.** This is the "Operator split is kept" scenario.
   - The split dialog now lists the lot's observations and assigns each one to a new lot, defaulting to the first, so `split_lot` always carries `observation_ids`.
   - A Move to… control (`operator/ObservationMove.tsx`) on the lot's observations and on the unassigned list sends `observation_move`, so unassigned observations and those left on a retired lot can be placed.
2. **Minor: trimming a note did not retry a skipped batch.** The trigger's skip signature now includes the capture and media batch revisions as well as decode results, so editing an oversized note retries a skipped batch.
3. **Minor: missing frontend tests and a stale comment.** Tests now cover the glance hiding retired lots, an observation left on a retired lot listed as unassigned, the split request's `observation_ids`, and the move control. The Capture comment is corrected.
4. **Minor: the subject insert guard was untested and undocumented.** A refusal test (agent insert without a session) now covers it, and the architecture guard sentence names it.
5. **Nitpicks.**
   - Fixed:
     - `frontend/ARCHITECTURE.md` now covers the unassigned list and split assignment.
     - A crop whose region no longer fits its preview reached the lead session as `validation_failed`. Round 5 removed this branch as unreachable.
   - Accepted: the guards check that `agent_session_id` is present, not that it belongs to the batch. Application code always passes the writing session.

## PR-B review round 5

A fresh reviewer subagent reviewed `4080ea9..528b79d`. It found one important and two minor findings, plus two nitpicks, and confirmed the round 4 fixes.

1. **Important: removing a new lot in the split dialog could send observations to the wrong lot.**
   - Each observation's choice was the new lot's index, which shifted when a lot was removed.
   - Each new lot now carries a stable `key`, and observations store that key. A choice pointing at a removed lot falls back to the first new lot.
   - Options name each lot's current label.
   - A rendered test (`RestructureDialog.test.tsx`) removes a lot, then submits, and checks each observation goes where the screen showed.
2. **Minor: the crop-size refusal was untested and unreachable.**
   - Authorization already refuses a region whose source size differs from the preview row.
   - The branch could only fire if a stored PNG disagreed with its own row, and then only after the success outbox entry was written. It is removed.
   - Such corruption now reaches the session as `tool_failed`, logged as `session_tool_failed`.
3. **Minor: the Move to… select stayed enabled behind the draft fence, and names could repeat.**
   - The select is now disabled with its button.
   - `operator/observation-names.ts` numbers observations that read the same, for example "Reel (2)". The lot list, the unassigned list and the split dialog all use it, so accessible names are distinct.
4. **Nitpicks: fixed.** The trigger's `signature` comment names the batch and media revisions. The move control and the split fieldset use the shared `Select`, `Fieldset` and `Label` primitives.

Checks on the fix: frontend 502/502, typecheck, lint and build clean.

## PR-B qualification (tasks 8.4, 8.5, 9.4, 9.5)

Results at the reviewed head `04c69ae`, plus the job card label fix below.

- **Database tier:** `pnpm db:intake test` passed 216/216.
- **Process tier:** `pnpm db:intake test:process` passed 66/66, with the 4 sandbox tests skipped because the probe image was missing.
  - Those 4 passed in a separate run of `tests/process/media-resources.test.ts` with the rebuilt probe image.
  - Media decoding and the existing processing queue are unaffected.
- **Earlier sandbox failures were environmental.** "Owned probe must become observable" happened because the locally built probe image had been pruned: `build-media-probe.cjs` leaves it untagged.
  - Every probe failed at once with `decoder_interrupted`. The trunk baseline run failed the same way.
  - The build also refuses to overwrite an existing `--output-file`, so rebuild to a new path.
- **Frontend:** all tests pass. Typecheck, lint, build and the markdown checks (`pnpm lint:markdown`) are clean.
- **Headless browser check (9.5).**
  - **Setup:** a local driver, not committed, ran the `session-browser` fixture with a real blob store, two PNG photos and their notes, and the session worker under the `synthetic-session/1` profile.
    - Shelf photo note: "LED 0603 red ×500; 16 MHz crystal".
    - Reel close-up note: "LED 0603 red ×500".
    - The processing fixture has no Review, header or attention routes, so the driver served them as `main.ts` does, adding the manual, research and projection grants for the `api` role.
  - **Result:** Playwright (Chromium, headless) passed all seven checks:
    1. Capture shows no AI-proposed lots before the quiet period.
    2. On the live page, without a reload, the glance gains "led 0603 red" and "16 mhz crystal", marked AI-proposed, while the Examine status line shows.
    3. The LED lot draws crops from both photos (2) and the crystal lot from one.
    4. Review lists the LED lot's observations with "Estimated 500 · label · same item in 2 photos".
    5. Moving one observation to No lot leaves the lot with one observation, marked Edited.
    6. The moved observation is listed under Unassigned observations, shown when no lot is inspected.
    7. Selecting "16 mhz crystal" in Processing's "Queue work for selected saved subjects" and queuing it starts its Research and Images sessions.
- **Fix found by the check.** The lead job's card in Processing was titled "Retained subject · examine", because its subject is null. It now reads "Whole batch · examine", the label the redesigned Processing pages use, with a test (`ProcessingJobCard.test.tsx`).

## PR-B merge of `interactive-app` (#101, #102, #103)

- **The conflict:** #102 replaced `ProcessingNeedsYou.tsx` with the Processing overview. PR-B had added null-subject handling to that file, so the file is dropped in the merge.
- **Typecheck failure:** the overview's `retainedJobsSource` (`frontend/src/processing/source.ts`) failed to typecheck against PR-B's nullable question `spec.subject_id`.
- **The fix:** a whole-batch question from the Examine lead session is now named "Whole batch" and links no lot, with a test in `source.test.ts`.

## PR-B merge of `interactive-app` (#104, #105, #106)

- **Conflicts:** #104 (Review lots and map) conflicted in `ReviewWorkspace.tsx` and `OperatorReview.test.tsx`. Both sides' tests are kept.
- **Unassigned observations moved:** #104 makes Review always open a lot, so the empty state that held the unassigned list was no longer reachable.
  - The list now renders in the evidence panel, under the open lot (or the empty state).
  - A test in `OperatorReview.test.tsx` covers it.
  - `frontend/ARCHITECTURE.md` says so.

## PR-B delivery (D.2)

- **Review:** ten independent review rounds by fresh Claude subagents.
  - Rounds 6–8 were clear. Round 8 covered `2d7dbac070626e22c86d47df16d3f36c98454b71`.
  - Rounds 9 and 10 cleared the two merges of `interactive-app`: `15d97607f1941423a405a3c0ef40ec63c1c43e20` and `09484490c3c180fac8625d4be560fcfcdd8fc8f6`.
- **Published:** [#107](https://github.com/MitchReyno/InvenTree-Importer/pull/107) against `interactive-app`, with no reviewers, and a demo video recorded from the synthetic preview.
- **CI on `0948449`:** every selected job passed. The PostgreSQL and process job is skipped in CI.
- **Local tiers on `0948449`:** `pnpm db:intake test` passed 216/216, and `pnpm db:intake test:process` passed 70/70.
- **Merged:** squash-merged at `0948449` as `776c302`.

## PR-C task 10: per-lot Research and Images on a stable identity

- **Stable identity (`processing/stable-identity.ts`).**
  - The lead session's identity proposal must cite the lot's current observation set in `relies_on` as `{kind: 'observation_set', lot_id, version}`. `read_batch` now returns each lot's `observation_set_version`.
  - The lead session's `propose` runs on the `agent_writer` pool (the `leadWriter` option of `withSession`).
  - In the same transaction, `onLeadIdentity` locks the lot row and compares versions:
    - If the version matches, it queues the lot's Research and Images through `queueJob`, pinned to the identity (`pinned_proposal_ids`).
    - Successors that are already live get a `revision` inbox item instead of a new attempt.
    - An identity relying on an older set is stale at once (`lot_regrouped`) and queues nothing.
  - `/2` successors record no `processing_dependency` rows.
- **Regrouping (`processing/regroup.ts`).** Every observation-set change (`bumpObservationSet`: agent `propose_lot`/`regroup` and the operator's moves, splits and merges) calls `lotRegrouped`.
  - It supersedes the lot's Research and Images attempts that have not started, and marks those jobs `superseded`.
  - It marks identities relying on the lot's set stale (`lot_regrouped`).
  - Running sessions keep running. The next stable identity queues fresh attempts and commands.
- **Claim re-check (`session-runner.ts`).**
  - A superseded or cancelled attempt now settles its session as cancelled instead of failing with `session_not_queued`.
  - A queued successor whose pinned identity went stale is superseded when it is claimed.
- **Queue order (`agents/slots.ts`).** Examine lead sessions go ahead of per-lot sessions. Without this, at the default limit of 3, a lead resumed for new evidence waited behind every successor it had started. Design D9 records the decision.
- **Inventory gate.** Session profiles may now start Inventory, but only once the lot's Research and Images each have a current proposal. Otherwise the start is refused with `inventory_waiting` (409).
- **Stage order.** `sessionStageOrder` (`examine`, `research`, `images`, `inventory`) sits beside the `/1` order (`stageOrderFor`).
- **Observation sources.**
  - `propose` now accepts `observation_set` and `evidence_observation` sources in `relies_on`, which PR-A refused with a placeholder.
  - The lead session may cite any lot or observation of its batch. A lot session may cite only its own lot and its lot's active observations.
- **Catalogue (10.4).**
  - `applicableCatalogueSpec` (`processing/catalogue.ts`) builds the Part spec an operator could accept from a `/5` catalogue block. It copies applicable values only, so the result passes `validatePartSpec`, and it returns null without an applicable category.
  - Tests cover:
    - an existing manufacturer with its MPN;
    - a parameter carrying both its template and the category mapping;
    - new categories, templates and companies, unmapped parameters and prices, which never reach a spec.
  - Session instructions now ask for catalogue values with sources, and ask the lead session to cite the observation set.
  - The synthetic Research session publishes a catalogue block, and lot sessions cite their pinned identity as a `proposal` source.
- **Synthetic lead.**
  - It re-states the identity of every lot it touched in a turn, citing the set version from a fresh `read_batch`.
  - When later evidence's note is not in its opening manifest, it cites a note that is.
- **Tests (`tests/pg/stable-identity.test.ts`):**
  - stable-identity queueing as `agent_writer`;
  - a regroup by new evidence;
  - a revision notice to a running successor;
  - an operator move superseding successors, and settling at claim;
  - a stale pin at claim;
  - an identity relying on an older set;
  - the Inventory gate;
  - parallel slots;
  - lead priority;
  - a regroup and an identity racing under the capture lock.
- **Baseline (10.1):** the Examine, observation, dependency, processing, slot and session-tool suites passed 54/54 before the change.
- **Results (10.5, 10.6):**
  - `pnpm db:intake test` passed 226/226. The `/1` exact-predecessor suites (`processing-dependencies`, `processing`) pass unchanged.
  - `pnpm db:intake test:process` passed 70/70.
  - `pnpm test:intake`: contracts 76/76, intake server 213/213. Frontend 585/585. Typecheck, lint, format and `contracts:check` are clean.
  - An earlier tier run hung for about 2.7 hours in `processing-suggestions.test.ts`. It was started without `INTAKE_MEDIA_DECODER_IMAGE`, so the media fixtures refused to start. Tier runs now get a hard time cap and a stall check.

## PR-C task 11: proposal currentness, selective rework and new evidence pickup

- **Fan-out (`processing/currentness.ts`, `fieldsSuperseded`).**
  - **What goes stale:** an answer or an operator correction supersedes fields of a subject. In the same transaction, these proposals become stale:
    - every current proposal for that subject whose `relies_on.fields` overlaps the answered fields;
    - every proposal relying on one of those through a `proposal` source.
  - **Who is told:** each relying session gets a `revision` inbox item:
    - the owners of those proposals;
    - sessions whose opening manifest pinned one of them, even before they have published anything.
  - The asker already has its `answer` item. Proposals relying on other fields stay current.
- **Answers.** `answerSessionQuestion` calls the fan-out with the question's declared `fields` (`answer_received`). A quantity answer therefore leaves identity proposals current.
- **Corrections.** In `capture.edit`, a `lot` edit of `part_subject_id` corrects `identity` and one of `quantity` corrects `quantity` (`operator_correction`).
  - The answer path applies its value through `capture.apply`, not `edit`, so an answer is not counted twice.
  - Bulk and operator-review edit paths do not fan out yet.
- **Evidence hooks.** `bumpObservationSet` now knows the observation that moved.
  - **Removed:** proposals citing the observation as an `evidence_observation` source become stale (`evidence_removed`) before the regroup, and their sessions get a revision notice.
  - **Added:** the lot's Research and Images sessions get an `evidence` notice for the observation's photo. The wake sweep resumes finished or waiting sessions with unread items.
  - **Lazy loading:** capture loads `currentness.ts` lazily. Processing depends on capture, and an eager import from capture formed a load-time cycle through the media modules. `regroup.ts` imports only the database layer, so it is loaded eagerly.
- **Finished successors are revised, not replaced.** A stable identity now queues a fresh attempt only when the successor is missing, superseded, cancelled or failed. Running, waiting and finished sessions get the revision as an inbox item and are resumed.
- **Lot sessions fetch previews.** A lot session's `fetch_evidence` uses the preview path for pages, region crops and versions outside its manifest (from evidence notices), and it may cite a version it fetched. The path is `previewFetchEvidence`, formerly `leadFetchEvidence`.
- **Read model.**
  - Each session proposal in the Processing snapshot has `currentness`:
    - `stale`, with its reason;
    - `provisional`, while an open question on a current attempt shares one of its fields and its subject;
    - `current` otherwise.
  - It is one bounded query per batch (`proposalCurrentness` in `processing/read.ts`).
- **Inventory waits.** A queued Inventory whose lot's Research and Images are not current stays queued at claim, without taking a slot.
- **Synthetic lead.**
  - It publishes its quantity estimate as a separate proposal relying on `quantity`.
  - It cites each lot's observations as `evidence_observation` sources.
- **Tests (`tests/pg/selective-rework.test.ts`):**
  - "Unclear quantity" (provisional, then stale on answer, with the identity current);
  - an identity correction reaching Research and Images, including Research with nothing published;
  - Inventory waiting;
  - "Evidence removed";
  - "Photo added mid-run".
- **Ask validation.** `session-tools.test.ts` now refuses an `ask` without fields or without an assumption ("Agent asks without an assumption").
- **Shared helpers.** These moved to `tests/support/lot-pipeline.ts`.
- **Deployments without Processing.** On a manual-only deployment the capture `api` role has no Processing grants, so the currentness and regroup hooks do nothing there (`has_table_privilege` check). The first tier run failed 57 manual-execution tests on exactly this.
- **Results (11.4, 11.5):**
  - `pnpm db:intake test` passed 231/231. The `/1` answer, closure and supersession suites (`processing`, `processing-dependencies`) pass unchanged.
  - `pnpm db:intake test:process` passed 70/70.
  - `pnpm test:intake`: contracts 76/76, intake server 213/213. Frontend 585/585. Typecheck, lint, format and `contracts:check` are clean.

## PR-C task 12: pipeline UI, documentation and browser qualification

- **Pipeline (`processing/source.ts`, `PipelineRows`).** The source adapter adds `pipeline`: the lead job's state, then per lot a Research, Images and Inventory cell with its job state and how many proposals are stale or provisional. The Overview's Pipeline card shows Examine · Whole batch, then each lot's Research ∥ Images → Inventory. At phone width the cells wrap and the arrows are hidden.
- **Labels.** Job cards mark a stale candidate with its reason (for example "you corrected what it relied on") and a provisional one while a question is open.
- **Examine view (`ExamineView`).** On the Examine step page:
  - every active observation, grouped by photo, with its crop, readings, region and lot link, or "No lot";
  - each formed lot with its AI-proposed or Edited chip, estimate and basis, observations, and the lead's candidates with their sources.
  - Photos are numbered by their first observation, because the capture snapshot carries no photo labels.
- **Legacy.** Reading and Identifying jobs still render as job cards on Examine, and the existing `/1` fixture tests pass unchanged.
- **Tests (vitest):** `PipelineRows.test.tsx`, `ExamineView.test.tsx`, the pipeline case in `source.test.ts`, and stale/provisional labels in `ProcessingJobCard.test.tsx`.
- **Docs.** `processing/ARCHITECTURE.md` (stable identity, selective rework, Inventory gate), `agents/ARCHITECTURE.md` (lead priority, lot-session evidence, instructions) and `frontend/ARCHITECTURE.md` (pipeline, labels, Examine view) describe the final behaviour.
- **Answering a lot's quantity marks it edited (found in qualification).** An answer applies the same capture `lot` edit as the operator, and PR-B marks any operator change to a lot `operator_edited`. Later evidence the lead session reads for that lot therefore arrives as a suggested membership, not an active one. This follows PR-B's reviewed rule, "Lots and observations the operator edited only accept suggestions". The qualification answers one lot's question and adds a photo of another. Whether an answer should count as an edit that blocks grouping is left open.
- **Browser qualification (12.5).**
  - **Setup:** a local driver, not committed (as for PR-B), served the synthetic preview with the session worker. The batch was photo-only: a shelf photo noting three items ("1N4148 diodes ×100; 16 MHz crystal; LED 0603 red ×500") and a reel close-up ("LED 0603 red ×500"). A third photo ("Reel back") was added mid-run.
  - **Result:** Playwright (Chromium, headless, 1920 px at 2x and 390 px) passed all 14 checks in its evidence file. They cover:
    1. The batch starts with no lots.
    2. Three AI-proposed lots appear live, and the reel in both photos is one lot with two crops.
    3. The Examine view lists the shelf photo's three regions.
    4. The LED estimate reads "Estimated 500 · label · same item in 2 photos", counted once.
    5. Each lot's Research and Images both start, in parallel, from the stable identity (one check per lot).
    6. A mid-run answer to the diodes lot's Research question, through the question form, makes the lead's "Estimated 100" stale ("an answer changed what it relied on").
    7. The diodes identity stays current.
    8. The added photo joins the LED lot (three crops).
    9. The LED Research session resumes and reads the notices ("Reading new inbox items").
    10. At 390 px, the LED pipeline row is shown.
    11. At 390 px, the Overview fits without horizontal scroll.
    12. At 390 px, the Examine page fits without horizontal scroll.
- **Fixes found by the qualification.**
  - A successor's claim checked its pinned identity on every turn. A resumed Research or Images session, woken by a revision, was therefore superseded once its identity went stale. The check now runs only before a session's first turn (`turn_count` 0), with a regression test in `stable-identity.test.ts`.
  - The synthetic lead re-examined every photo when woken by an answer or a revision. Now only its first turn examines every photo; later turns examine evidence sent as notices.
  - Pipeline and Examine-view pills no longer stretch to the full row width.

## PR-C review round 1

A fresh reviewer subagent reviewed `6ca5360` and found one critical, four important and six minor findings, plus two nitpicks.

1. **Critical: on `native-agent/2`, the lead identity's queueing failed on a privilege error.** `createSessionAttempt` read Agent settings `FOR SHARE`, which `agent_writer` has no UPDATE privilege for.
   - `queueJob` and `createAttempt` now pass `lockSettings: false` on this path, as the Examine trigger does.
   - A PG test queues successors for a `native-agent/2` identity with saved settings.
2. **Important: a gated Inventory could hold the slot queue against the Research and Images it waits for.** Per-lot sessions no longer count queued Inventory sessions ahead of them. A test resumes Research at a limit of 1 behind a gated Inventory.
3. **Important: a republished identity lost an unstarted successor.** The successor got only a notice, then was superseded at claim for its stale pin. A successor that is still queued and has never run (`turn_count` 0) is now replaced, pinned to the new identity, with a test.
4. **Important: an operator move left the destination lot stranded.** After an operator regroup, the lead session gets a revision notice for each identity made stale (`lotRegroupedNotices`). Agent regroups are not notified, since the lead itself made them.
5. **Important: staleness did not cascade from a regroup or a removal.**
   - Proposals relying on a stale identity through a `proposal` source are now stale for the same reason, and their sessions are told (`cascadeStale`).
   - A removed observation now also notifies the lot's Research and Images sessions.
   - Tests cover both.
6. **Minor findings, all fixed:**
   - A null-subject answer no longer marks every lot's proposals stale; it affects none.
   - The regroup and removal queries are filtered to the lot's batch.
   - A citation of a notice-delivered version must match that version's evidence ID and digest.
   - Evidence notices are keyed by the lot's set version, so an observation that returns is noticed again.
   - The Pipeline card is built only from session jobs, so legacy `/1` work stays on the step pages.
   - Handover counts and the lazy-loading note are corrected.
   - D6's lot locking stands: `propose` holds the batch lock and the subject heads (`lockCaptureSubjectHeads`), then locks the lot row.
7. **Nitpicks, fixed.** Pipeline steps are `role="group"`, so their labels are announced. `SUCCESSOR_STAGES` lives in `supersede.ts` and is shared.

