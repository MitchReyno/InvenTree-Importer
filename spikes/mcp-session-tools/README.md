# Session tool server spike

Proof-of-fit for the `simplify-intake-entry` session tool server: [design](../../openspec/changes/simplify-intake-entry/design.md) D2 and D3, task 1. This is investigation code, not a production path. The [change notes](../../openspec/changes/simplify-intake-entry/notes.md) record the decisions taken from it.

Nothing here contacts a model provider or reads a real credential. Both CLI harnesses run the real binary against a loopback stub of the provider API, with a fake API key and a throwaway home directory. The stubs record tool names and message shapes, never request headers.

## What each script checks

- **`run-spike.mjs`** runs a Streamable HTTP MCP endpoint on Fastify 5, bound to `127.0.0.1` on an ephemeral port, against MCP SDK v2 and v1. Each session gets a random 256-bit bearer capability, and only its SHA-256 digest is stored. It checks the following:
  - A missing or wrong capability gets 401.
  - A foreign `Host` header gets 403.
  - Each session's tool set depends on its stage: only the Examine lead session lists `record_observation`, `propose_lot` and `regroup`.
  - A status line over 120 characters is refused.
  - Every tool response carries `pending_inbox`.
  - Every tool call is attributed to its session.
- **`claude-harness.mjs`** runs `claude -p` with stream-JSON. It checks the following:
  - `${VAR}` expansion in `--mcp-config` headers.
  - Which tools `--tools ""` with `--strict-mcp-config` offers the model.
  - Whether `--allowedTools mcp__intake__*` is needed.
  - What `--safe-mode` does to `--mcp-config` servers.
  - Whether a user `CLAUDE.md`, settings hook or settings MCP server leaks into the session when `--setting-sources ""` is used without `--safe-mode`.
  - `--resume` with persistence.
  - A stream-JSON user message sent during a turn.
- **`codex-harness.mjs`** runs `codex app-server` with the `/1` adapter's hardening keys. It checks the following:
  - The `mcp_servers.intake` override with `bearer_token_env_var`.
  - The effective config and MCP server status.
  - The tools offered to the model.
  - MCP calls under `approval_policy = "never"`.
  - `turn/steer` during a turn, and with a wrong `expectedTurnId`.
  - `thread/resume` in a new process.
  - What `request_user_input` does.

The recorded output from the original run, with temporary paths replaced by `<tmp>`, is kept at [`e3ac646`](https://github.com/MitchReyno/InvenTree-Importer/tree/e3ac646/spikes/mcp-session-tools/evidence). A new run prints its output; attach it to the PR description rather than committing it.

## Running it

The spike has its own `package.json` and is not a pnpm workspace member. Use Node 24 (`.node-version`).

```sh
cd spikes/mcp-session-tools
npm ci --ignore-scripts
npm run spike
npm run spike:claude
npm run spike:codex
```

The Claude and Codex harnesses need `claude` and `codex` on `PATH`, or `SPIKE_CLAUDE_EXECUTABLE` and `SPIKE_CODEX_EXECUTABLE` set. The recorded runs used Claude Code 2.1.318 and codex-cli 0.166.0.
