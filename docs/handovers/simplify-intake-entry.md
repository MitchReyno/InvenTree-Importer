# Agent-led intake (`simplify-intake-entry`): engineering handover

## Scope and state

This change delivers [BI-006](../PLANNED_FUNCTIONALITY.md#bi-006--agent-led-intake) from the OpenSpec change [`simplify-intake-entry`](../../openspec/changes/simplify-intake-entry/proposal.md). Mitch owns the decisions. Implementation was requested on 2026-11-06 through the OpenSpec apply workflow. The [task plan](../../openspec/changes/simplify-intake-entry/tasks.md) splits the work into four PRs:

| Bundle | Tasks | Branch | State |
| --- | --- | --- | --- |
| PR-A resumable sessions | 1–6 | `feat/simplify-intake-entry-sessions` | Task 1 done; tasks 2–6 pending |
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

v2 adds `zod` 4 to the intake server, which has no zod today. Task 2 or 3 must add the Apache-2.0 notice to `THIRD-PARTY-NOTICES.md` when it installs the packages.

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

## Validation

- `pnpm spikes:check`: 35 passed (the existing shared-contract suite; the new spike adds no test there).
- Prettier and the configured remark lint pass on the spike.
- `openspec validate simplify-intake-entry --strict` passes after the plan updates.
