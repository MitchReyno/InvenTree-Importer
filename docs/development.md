# Running the local application

Use `pnpm dev` from the repository root to start the complete local Bench Intake app at **<http://127.0.0.1:4330>**. The command owns the UI, API, apply worker, decoder, Processing worker and a persistent fake inventory service. Ctrl-C stops those processes and preserves PostgreSQL and app data. The previous preview is not automatically migrated into this separate namespace.

Install the pinned Node 24/pnpm versions and run `pnpm install --frozen-lockfile` first. Docker must be available for the managed PostgreSQL service and bounded image decoder. First startup builds the decoder image; later builds reuse Docker's cache. See the [service ledger](../intake-server/README.md#shared-development-service-ledger) before sharing the local PostgreSQL allocation.

```bash
pnpm dev       # full local app, synthetic Processing by default
pnpm dev:ui    # standalone Vite UI; no API proxy or provisioning
pnpm dev:intake # standalone API with explicit server configuration
```

The full app forwards `/api` HTTP and WebSocket requests from Vite to its private API listener. Browser origin and CSRF checks remain authoritative. Standalone commands do not provision an app or start workers. `dev:intake` serves built frontend assets when present; use `pnpm build` for that standalone mode.

## Reload and persistence

Frontend source edits use Vite HMR. Server and shared-contract source edits drain and restart the owned API/workers without replacing the UI server, database or fake inventory state. Migration SQL changes run the existing migration verifier before restart; previously applied migrations remain immutable. Compiler/startup failures during a reload leave the watcher active: fixing code retries startup. An unrelated child failure stops the command for inspection.

Only changed source bytes trigger application reload. Runtime state, uploads, logs, docs, tests, build output and an unchanged-byte source save do not restart the API/workers. Watch roots are `frontend/src`, `contracts/src`, `intake-server/src` and `intake-server/migrations`. Changing dependency manifests, launcher tooling or reused test-fixture implementations requires restarting the command. Vite handles its configuration and HTML files using its normal development behavior.

Private state defaults to `$HOME/.local/state/bench-intake/app`; set `INTAKE_APP_STATE` to another private directory **outside the repository** to select a separate retained app. Setup creates an `intake_dev_…` database and dedicated runtime roles. Its synthetic credentials and fixed fake-server port remain in private configuration; the shared PostgreSQL administrator credential is used only during setup/migrations. No root `.env` file is loaded. Existing original inventory configuration is not used.

`INTAKE_DEV_PORT` changes the public loopback port (4330 by default). An occupied port causes failure rather than silently choosing a different address. Retained fixture port 4310 and reserved port 4350 are refused by the full-stack launcher. Keep `INTAKE_APP_STATE` stable across starts to retain batches and uploads. `INTAKE_DEV_STATE` selects the existing PostgreSQL helper state directory. CI can explicitly inject an owned loopback `/postgres` connection through `INTAKE_DEV_ADMIN_URL`; that value is not passed to runtime children or saved in app configuration.

An exclusive `supervisor.lock` prevents overlapping owners. If a hard kill leaves a lock, inspect its recorded PID and private `running.json`, confirm every owned child is stopped, and preserve/rename the lock before restarting. A partial first setup without `app.json` fails closed; inspect its retained `initializing` marker and database before recovery. Do not delete retained data to bypass a failure. Normal Ctrl-C releases the owned lock.

## Processing and native agents

Default Processing produces visibly **synthetic** source-bound proposals. It performs no inference, image inspection or inventory research. The fake inventory supports local lookup and supervised apply; this is not a connection to a real inventory server.

To explicitly select the existing native-agent integration for new work:

```bash
INTAKE_PROCESSING_PROFILE=native-agent/1 pnpm dev
```

Then select the global provider, authentication route and model in Settings before starting an agent. Claude subscription authentication uses the signed-in CLI account under the host `HOME`. Codex subscription mode uses the worker's isolated `$INTAKE_APP_STATE/agents/codex` as `CODEX_HOME`; the default host Codex login is not automatically reused.

After the first synthetic startup has created the private app-state directory, establish Codex subscription authentication in that exact namespace (use the same override if you selected another app-state directory):

```bash
export INTAKE_APP_STATE="${INTAKE_APP_STATE:-$HOME/.local/state/bench-intake/app}"
mkdir -p -m 700 "$INTAKE_APP_STATE/agents"
mkdir -p -m 700 "$INTAKE_APP_STATE/agents/codex"
CODEX_HOME="$INTAKE_APP_STATE/agents/codex" codex login
```

Use the CLI login flow; do not copy an authentication store. API keys may be supplied through the existing `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` environment variables; the launcher forwards them only to the explicitly selected native worker and does not save them in app configuration. Existing native-worker restrictions and unqualified live-provider limitations still apply. Development qualification uses only the default synthetic profile.

## Verification

`pnpm test:dev` checks source-byte filtering and owned-child shutdown. The process tier includes the actual `pnpm dev` launcher boundary: public HTTP/WS, decoding, synthetic DBOS Processing, source restart/error recovery, no-op/runtime-state exclusions, retained restart and shutdown. Run the [PG/process tiers](../intake-server/TESTING.md) under the shared service allocation, with any running full-stack app stopped first.
