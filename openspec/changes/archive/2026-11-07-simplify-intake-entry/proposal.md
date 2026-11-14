# Change proposal

## Problem and intended outcome

Capture and Processing still make the operator do two jobs the agent is better placed to do.

- **Lots are typed by hand.** Processing only offers saved lots and shared Part proposals. A batch with only photos has nothing to queue until the operator creates lots on Review.
- **Questions stop the work.** One clarification question ends the agent's attempt, and the rest of that subject's chain waits for the answer.

The outcome the operator asked for:

1. **The agent forms lots from the evidence.** One Examine lead session per batch finds each item in the photos and documents (an observation: a region of a photo or a line of a document), groups observations of the same physical thing into lots, and identifies each lot from all its observations. A photo can feed several lots and a lot can draw on several photos; quantities combine observations without double counting. Proposed lots appear live while it works and are created straight away as editable draft lots. The operator corrects them with direct edits instead of entering them.
2. **Agents never block on a question.**
   - They deliver status lines, proposals and questions as they go, and carry on with recorded assumptions.
   - Answers, chat messages and new evidence are queued for the agent immediately, whether its session is running, paused, waiting or finished.
   - The operator can chat with an agent about its work.
   - Each agent regularly emits a one-line status, so its steps show in order.
3. **Reading, sorting and identifying become one Examine stage,** run once per batch. Sorting cannot happen before reading, and grouping often needs identities, so they loop in one session. Research and Images run in parallel per lot once its identity is stable. Agents that have already started pick up evidence added later.

This change covers Claude and Codex only. Gemini/Antigravity is a separate future item (BI-007).

## Change identity and linked items

- **Change name:** `simplify-intake-entry`. Branches use `feat/simplify-intake-entry-<bundle>`; subjects use `feat(simplify-intake-entry): …`.
- **Linked items:**
  - [BI-006 — Agent-led intake](../../../../docs/PLANNED_FUNCTIONALITY.md#bi-006--agent-led-intake), which this change delivers.
  - [BI-007 — Antigravity agent provider](../../../../docs/PLANNED_FUNCTIONALITY.md#bi-007--antigravity-agent-provider), which is out of scope and should target the provider interface defined here.

## Current behavior and evidence

**Subjects are human-created.**
- Processing jobs belong to a lot or Part subject that the operator adds through Review. The add controls are `frontend/src/components/review/ReviewWorkspace.tsx` "Add physical lot" and "Add shared Part proposal"; these produce `add_lot`/`add_part` capture edits (`contracts/src/capture.ts`).
- `ProcessingWorkspace.tsx` lists only saved, non-retired subjects. Evidence links to subjects through `linked_subject_ids` (`contracts/src/media.ts`).
- `batch-settings-overhaul` removed the Capture lot panes. A fresh photo-only batch therefore shows "0 physical lots · 0 shared Part proposals" and cannot be processed.

**There are five sequential stages.**
- `stageOrder` is `reading → identifying → research → images → inventory` (`intake-server/src/processing/model.ts`).
- A job is unique by batch, subject and stage. Consumers need *ready* exact predecessors (`processing/ARCHITECTURE.md`, "Exact predecessor lineage").

**Each attempt returns one proposal or one question.**
- The native prompt requires "exactly one non-null proposal or question" (`intake-server/src/agents/prompt.ts`).
- A question ends the attempt and releases the lane. An accepted answer creates fresh attempts and replaces every attempt downstream of it ("Questions and human edits").

**Native sessions are single-shot and have no tools.**
- `claude.ts` runs `claude -p` with `--tools ""`, a strict empty MCP config and `--no-session-persistence`. It refuses any tool except `StructuredOutput`.
- `codex.ts` starts one thread and one turn over app-server.
- The agents architecture says no native session is ever revived automatically. Progress is "one bounded progress phase".

**One lane runs one attempt at a time per actor.** "A durable lane serializes research for the server actor."

**Inputs are sealed.** Evidence added to the attempt's scoped closure (its subject, linked Part and their media) after it is queued makes that input noncurrent, and it does not reach the running attempt. Evidence for unrelated subjects does not affect it.

**What the installed CLIs offer** (checked 2026-11-05, from local help and generated schemas; no inference run):
- **Claude Code 2.1.318:** `--resume`, `--fork-session`, `--session-id`, `--input-format stream-json`, `--mcp-config` and `--strict-mcp-config`.
- **Codex 0.166.0 app-server:** stable `thread/resume`, `turn/start` and `turn/steer` (adds input to an in-flight turn), and a `config` override that can supply MCP servers. Client-supplied `dynamicTools` on `thread/start` exist only behind `--experimental`.

**Not yet verified:**
- Live provider behavior.
- How Claude handles stream-JSON user messages that arrive mid-turn.
- Whether either provider calls MCP tools reliably enough for streamed proposals.

All three need a qualification spike. Native agent support is still labelled `native_unverified`.

## Scope and non-goals

**In scope**
- **Agent session protocol.**
  - Long-lived, resumable native sessions for Claude and Codex.
  - An app-owned tool server scoped to one session, with tools for status, proposals, lot proposals, questions, chat replies, evidence fetch and inbox read.
  - A durable outbox (agent → operator) and inbox (operator → agent).
  - A concurrency limit with a default of 3 and a setting in Agent settings. Sessions waiting for input do not use a slot.
- **Lot forming.**
  - A batch-level Examine lead session runs automatically once previews are ready, after a short quiet period, and is resumed (not replaced) for later work.
  - It records observations with regions, groups them into lots and identifies each lot, proposing lots and shared Parts live as editable AI-proposed draft lots.
  - Lot quantities state their basis and never add up the same items seen twice.
  - New evidence wakes the lead session, which places its observations into existing or new lots.
  - Lots and observations the operator has edited are never reshuffled.
- **Stage pipeline.**
  - A batch-level `examine` lead session, then per-lot `(research ∥ images) → inventory`, for new attempts. Successors start when a lot's identity is stable.
  - Non-blocking questions, each with a recorded assumption.
  - An answer redoes only the proposals it affects.
  - Currentness is judged per proposal, against the evidence versions each one cites.
  - Running sessions pick up new evidence.
- **UI.**
  - Live proposed lots on Capture and Review, with their observations.
  - A batch-wide "Needs you" inbox.
  - A chat panel and status timeline for each session.
  - The latest status line in header workflow details.
  - A single Examine view (photo regions and per-lot observations) replaces the Reading and Identifying views.
- **Settings and copy.** Concurrency in Agent settings, and updated architecture docs.

**Non-goals**
- Gemini/Antigravity (BI-007).
- Direct API SDK agents that bypass the CLIs.
- Web, shell, filesystem or inventory-write tools for agents.
- Approval or inventory apply by agents. Inventory still requires Review approval and supervised execution.
- Automatic termination assertions after host crashes.
- Rewriting historical sealed inputs or migrating old jobs to the new stages.

**Compatibility**
- Existing profiles, inputs `/1`–`/5`, commands and envelopes keep their bytes and stay displayable.
- The new behavior is a new profile, `native-agent/2`, plus a matching deterministic fixture profile for tests.
- Old batches keep their Reading and Identifying history.

**Authority changes the operator has approved**
- Agents get the narrow app-owned tool server.
- Session transcripts persist in the private agent state root.
- The agent may create draft lots and evidence links, labelled AI-proposed. This relaxes "suggestions never write capture" for draft lots only. Human values, approval and inventory effects stay human.
- No live provider usage is authorized by this plan. Qualification with real accounts needs separate explicit authorization.

## Reuse and dependency assessment

Existing stack:
- Claude CLI and Codex app-server adapters (`intake-server/src/agents/*`).
- DBOS 5.4.0 queues and workflows.
- PostgreSQL with Drizzle and explicit locking SQL.
- `@fastify/websocket` 11.3.6 live hints.
- typebox contracts.
- No MCP, Claude Agent SDK or Codex SDK package is installed (`intake-server/package.json`).

| Option and relevant version | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence and date checked | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| **Extend the existing CLI adapters** (Claude Code 2.1.318, Codex 0.166.0) with resume and mid-turn input | Keeps the qualified subscription/API-key auth boundary, environment allowlist and process-group reaping. Both CLIs resume. Codex `turn/steer` delivers mid-turn input. | Claude has no documented mid-turn injection beyond stream-JSON queuing. The adapters grow session state, and resume adds transcript retention. | Local `claude --help`, `codex app-server generate-json-schema [--experimental]`, 2026-11-05 | Mid-turn behavior and resume after a worker restart need a deterministic-CLI test plus a later authorized live check. |
| **App-owned MCP tool server** using the official MCP TypeScript SDK (v1 `@modelcontextprotocol/sdk` 1.32.1 maintenance line; v2 split `@modelcontextprotocol/server`/`node` packages) | One tool contract serves Claude (`--mcp-config`, tool allowlist), Codex (`config` MCP servers) and later Antigravity (MCP/ACP). Streamable HTTP on loopback with a per-session capability fits the worker. Reference implementation: v1 is MIT, and v2 (chosen in the design spike) is Apache-2.0. | New runtime dependency. v1/v2 transition means choosing a line now. Agents gain a tool surface that must stay narrow. | [typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk), [Socket 1.32.1](https://socket.dev/npm/package/@modelcontextprotocol/sdk), 2026-11-05 | The exact v2 version and its Fastify/Node 24 fit need a spike. A tool-only allowlist must be proven on both CLIs. |
| **Codex `dynamicTools`** (app-server experimental) | Tools are handled in-protocol over the existing JSON-RPC, with no extra server. | Experimental API in 0.166.0. Codex-only, so Claude still needs MCP and there would be two tool paths. | Generated experimental schema, 2026-11-05 | Stability. Rejected for now; revisit if it becomes stable. |
| **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | In-process `createSdkMcpServer`, async-iterable streaming input, `resume` and `forkSession`. | Replaces the qualified CLI boundary and environment controls. Claude-only. Distributed under Anthropic's commercial terms rather than an OSI licence. | [Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript), 2026-11-05 | Not adopted. Reconsider only if CLI stream-JSON cannot deliver mid-turn input acceptably. |
| **DBOS messaging** (`DBOS.send`/`recv`/`setEvent`, 5.4.0) | Durable exactly-once delivery to a workflow, already a dependency. | Messages belong to a workflow ID, while a session's inbox must outlive a worker restart and a new resume workflow. Operator-visible history and the UI need queryable rows anyway. | [Workflow communication](https://docs.dbos.dev/typescript/tutorials/workflow-communication), 2026-11-05 | Used for waking and resume scheduling only. The inbox and outbox are Processing-owned PostgreSQL tables. |
| **ACP bridge adapters** (community `acp-adapter`, `adapter-acp`) | One protocol across Claude, Codex and Antigravity. | Community projects. The Claude path rides the Agent SDK. They add a layer between us and the containment flags we rely on. | [acp-adapter](https://awesome.ecosyste.ms/projects/github.com%2Fbeyond5959%2Facp-adapter), 2026-11-05 | Rejected here. Antigravity's native `agy acp` is assessed under BI-007. |
| **Custom tool protocol** (structured tags in model text) | No dependency. | Fragile parsing, no schema enforcement by the provider, and no reuse for future providers. | — | Rejected. |

**Recommendation**
- Extend the existing CLI adapters with resumable sessions.
- Expose session tools through one app-owned MCP server built on the official TypeScript SDK. Pick v1 or v2 in the design spike, preferring v2 if it runs on Node 24.
- Keep the inbox and outbox as Processing-owned PostgreSQL state, with DBOS used for waking and resume scheduling.
- Reuse the existing WebSocket hints for live UI.

This keeps one provider-neutral tool contract and the existing containment boundary. Custom work is limited to the session state machine, tool handlers, Examine lead-session logic (observations, grouping, quantity basis) and UI.

## Capabilities

### New capabilities

- `processing-agent-sessions` covers:
  - long-lived resumable sessions and their tool boundary
  - status lines
  - streamed outbox items
  - the queued inbox (answers, chat, evidence notices)
  - concurrency
  - recovery
- `processing-lot-forming` covers:
  - the batch-level Examine lead session
  - observations with regions, and lots grouped from them
  - quantity without double counting
  - live AI-proposed draft lots and shared Parts
  - new evidence waking the lead session
  - protection of lots and observations the operator has edited
- `processing-stage-pipeline` covers:
  - the batch-level Examine stage
  - per-lot Research and Images in parallel, starting on a stable identity
  - non-blocking questions with assumptions
  - selective rework
  - currentness judged per proposal
  - legacy display

### Modified capabilities

- `header-workflow-status`: active-agent details show each session's latest status line and waiting-for-input state.

## Impact and dependencies

**Applications**
- `intake-server`: processing, agents, capture and media input boundaries; migrations; grants.
- `contracts`: new input, command, envelope and session versions, and tool schemas.
- `frontend`: Capture, Review and Processing views; Agent sessions; the header.

**State**
- New tables:
  - session state and transcript reference
  - outbox items, with typed kinds status/observation/lot/regroup/proposal/question/reply
  - observations with regions, and lot membership by observation
  - inbox items
  - assumption and question links to proposals
- New lot provenance (AI-proposed versus edited by the operator).
- A configurable concurrency limit replaces the single-lane rule for `native-agent/2`.

**Prerequisites and evidence**
- The merged `native-agent/1` integration is the base.
- Live provider qualification is pending and needs separate authorization. Deterministic CLI fixtures and the synthetic profile carry automated evidence.
- The shared Processing application name and large-preview limits are merged (#93), so the `bench-sessions` queue in design D9 registers under `bench-intake-processing`.
- **BI-008 (`redesign-batch-workspace`)** is a planned redesign of the screens this change feeds (Processing, Review › Map, the Agents page), not yet on `interactive-app`. This change does not depend on it: it builds its UI on the current components and supplies the data and contracts either way.

## Open decisions and assumptions

- **Decided by the operator:**
  - auto-created draft lots, shown live
  - non-blocking questions with queued inbox delivery in every session state
  - chat
  - status lines
  - one batch-level Examine lead session that finds observations, groups them into lots and identifies them (replacing a separate Sort step)
  - lots linked to observation regions rather than whole files
  - parallel Research and Images per lot
  - new evidence picked up by running sessions
  - an app-owned tool server
  - concurrency 3, configurable
  - automatic Examine after previews
  - one change delivered in three phased PR bundles
- **Assumption:** the Examine quiet period is about 20 seconds after the last preview becomes ready, and can be tuned without changing the spec.
- **Assumption:** status lines are limited to 120 characters, with a minimum interval enforced by the server. The agent is instructed to emit one at each step.
- **Assumption:** retained transcripts follow the existing session-directory retention, and adding retention cleanup is a follow-up.
- **Resolved in the design spike:** the MCP SDK line is v2 (`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/node` 2.1.2); see design D2.
