# Agent-led intake (`simplify-intake-entry`): engineering handover

## Scope and state

This change delivers [BI-006](../PLANNED_FUNCTIONALITY.md#bi-006--agent-led-intake) from the OpenSpec change [`simplify-intake-entry`](../../openspec/changes/simplify-intake-entry/proposal.md). Mitch owns the decisions. Implementation was requested on 2026-11-06 through the OpenSpec apply workflow. The [task plan](../../openspec/changes/simplify-intake-entry/tasks.md) splits the work into four PRs:

| Bundle | Tasks | Branch | State |
| --- | --- | --- | --- |
| PR-A resumable sessions | 1–6 | `feat/simplify-intake-entry-sessions` | Tasks 1–3 done; tasks 4–6 pending |
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

## Validation

- `pnpm spikes:check`: 35 passed (the existing shared-contract suite; the new spike adds no test there).
- Prettier and the configured remark lint pass on the spike.
- `openspec validate simplify-intake-entry --strict` passes after the plan updates.
