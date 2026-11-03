# Running the local application

Use `pnpm dev` from the repository root to start the complete local Bench Intake app at **<http://127.0.0.1:4330>**. By default the command owns the UI, API, apply worker, decoder, Processing worker and a persistent fake inventory service. An explicitly configured external inventory uses the read-only profile described below, without a fake service or apply worker. Ctrl-C stops those processes and preserves PostgreSQL and app data. The previous preview is not automatically migrated into this separate namespace.

Install the pinned Node 24/pnpm versions and run `pnpm install --frozen-lockfile` first. Docker must be available for the managed PostgreSQL service and bounded image decoder. First startup builds the decoder image; later builds reuse Docker's cache. See the [service ledger](../intake-server/README.md#shared-development-service-ledger) before sharing the local PostgreSQL allocation.

```bash
pnpm dev       # full local app, synthetic Processing by default
pnpm dev:ui    # standalone Vite UI; no API proxy or provisioning
pnpm dev:intake # standalone API with explicit server configuration
```

The full app forwards `/api` HTTP and WebSocket requests from Vite to its private API listener. Browser origin and CSRF checks remain authoritative. Standalone commands do not provision an app or start workers. `dev:intake` serves built frontend assets when present; use `pnpm build` for that standalone mode.

## Environment files and InvenTree targets

`pnpm dev` and `pnpm dev:intake` load the **current checkout's root `.env`** once at startup. Existing shell environment values take precedence, including explicitly empty values. Use `INTAKE_ENV_FILE=.env.local pnpm dev` to select a caller-relative or absolute file; set `INTAKE_ENV_FILE=''` to disable file loading. A missing default `.env` is fine; an explicitly selected missing, symlinked, oversized or invalid UTF-8 file is refused. Inside the checkout, selected files must be root-level `.env` or `.env.*` names, which Vite already denies. Other filenames belong outside the checkout so source/static serving cannot expose their contents. No other checkout’s environment file is discovered.

Start with the documented template in `.env.intake.example`. Create a new file only when the checkout has no `.env`; merge the relevant settings yourself if one already exists, and keep it private. `.env` and `.env.*` variants are gitignored; only the documented example templates are excepted. Values are parsed as dotenv data using Node24's built-in parser, never sourced as shell code. No variable expansion is performed. File changes require restarting the command and do not trigger live reload.

For an external InvenTree target:

```dotenv
INTAKE_TARGET_PROFILE=read-only
INTAKE_READ_ORIGIN=https://inventory.example.invalid
INTAKE_CREDENTIAL_REF=development_inventory
INTAKE_DEV_API_KEY=your-read-only-api-token
```

Use the server origin, without an `/api/` suffix, credentials in the URL, query string or fragment. The credential reference is a nonsecret stable identifier, not the token. A URL/reference also selects read-only mode when no explicit profile is supplied; incomplete or contradictory fake/external settings fail. Each origin/reference receives its own retained namespace and target identity. Changing the key keeps the same namespace; changing origin/reference selects a different default namespace. An explicit `INTAKE_APP_STATE` cannot be rebound to a different target or switched between fake and read-only profiles.

Read-only mode supports connection status, existing-record lookups, local Capture/media and Processing. It creates no executor deployment and starts no fake inventory or apply worker, so inventory preparation/approval cannot authorize a remote write. Its external token is provided only to the API process and is not saved in retained state, sent to Vite/workers or returned in public responses. Native agents remain separately opt-in. Real-server compatibility, authentication and permission qualification are distinct from synthetic test evidence.

The env-file allowlist covers full-stack options `INTAKE_DEV_PORT`, `INTAKE_APP_STATE`, `INTAKE_DEV_STATE`, `INTAKE_DEV_ADMIN_URL`, `INTAKE_MEDIA_DECODER_IMAGE`, `INTAKE_PROCESSING_PROFILE`, `INTAKE_TARGET_PROFILE`, the three target settings above, the native executable overrides and provider API-key names documented below. Standalone `dev:intake` additionally accepts its explicit `INTAKE_ORIGIN`, `INTAKE_DATABASE_URL`, actor/target/context IDs, blob root, deployment ID, Processing channel secret and research URL lists. The full-stack launcher continues to own its local app database/identity settings. File-provided PATH, HOME, Node process flags, Vite variables and unknown keys are ignored; Vite dotenv discovery remains disabled. The standalone API child additionally receives only its required runtime settings and basic host environment, excluding setup-admin URLs, provider keys, native executable overrides and unrelated shell secrets.

## Reload and persistence

Frontend source edits use Vite HMR. Server and shared-contract source edits drain and restart the owned API/workers without replacing the UI server, database or fake inventory state. Migration SQL changes run the existing migration verifier before restart; previously applied migrations remain immutable. Compiler/startup failures during a reload leave the watcher active: fixing code retries startup. An unrelated child failure stops the command for inspection.

Only changed source bytes trigger application reload. Runtime state, uploads, logs, docs, tests, build output and an unchanged-byte source save do not restart the API/workers. Watch roots are `frontend/src`, `contracts/src`, `intake-server/src` and `intake-server/migrations`. Changing dependency manifests, launcher tooling (including the pure `intake-server/src/dev/target.ts` policy) or reused test-fixture implementations requires restarting the command. Vite handles its configuration and HTML files using its normal development behavior.

Private state defaults to `$HOME/.local/state/bench-intake/app`; set `INTAKE_APP_STATE` to another private directory **outside the repository** to select a separate retained app. Setup creates an `intake_dev_…` database and dedicated runtime roles. Its synthetic credentials and fixed fake-server port remain in private configuration; the shared PostgreSQL administrator credential is used only during setup/migrations. The development launchers load only the documented server settings from their selected environment file. Existing Python importer variables are not translated into target configuration.

`INTAKE_DEV_PORT` changes the public loopback port (4330 by default). An occupied port causes failure rather than silently choosing a different address. Retained fixture port 4310 and reserved port 4350 are refused by the full-stack launcher. Keep `INTAKE_APP_STATE` stable across starts to retain batches and uploads. `INTAKE_DEV_STATE` selects the existing PostgreSQL helper state directory. CI can explicitly inject an owned loopback `/postgres` connection through `INTAKE_DEV_ADMIN_URL`; that value is not passed to runtime children or saved in app configuration.

An exclusive `supervisor.lock` prevents overlapping owners. If a hard kill leaves a lock, inspect its recorded PID and private `running.json`, confirm every owned child is stopped, and preserve/rename the lock before restarting. A partial first setup without `app.json` fails closed; inspect its retained `initializing` marker and database before recovery. Do not delete retained data to bypass a failure. Normal Ctrl-C releases the owned lock.

## Processing and native agents

Default Processing produces visibly **synthetic** source-bound proposals in either target profile. It performs no inference, image inspection or inventory research. The fake inventory supports local lookup and supervised apply; this is not a connection to a real inventory server.

To explicitly select the existing native-agent integration for new work:

```bash
INTAKE_PROCESSING_PROFILE=native-agent/1 pnpm dev
```

Then select the global provider, authentication route and model in Settings before starting an agent. Claude subscription authentication uses the signed-in CLI account under the host `HOME`. Codex subscription mode uses the worker's isolated `$INTAKE_APP_STATE/agents/codex` as `CODEX_HOME`; the default host Codex login is not automatically reused.

Use the exact private app-state directory belonging to your target. A value loaded from `.env` is not exported back into the shell: export the same resolved `INTAKE_APP_STATE` path before logging in. Automatic read-only namespaces use `read-only-<hash>` directories, so the fake profile's `app` directory is not a substitute. If your app already has retained data, use its existing directory.

For a new namespace, select an explicit private path before first startup, and keep the same exported value for login and later launches:

```bash
export INTAKE_APP_STATE="$HOME/.local/state/bench-intake/my-development-target"
INTAKE_PROCESSING_PROFILE=synthetic-research/2 pnpm dev
# Once ready, stop with Ctrl-C before continuing in the same shell.
mkdir -p -m 700 "$INTAKE_APP_STATE/agents"
mkdir -p -m 700 "$INTAKE_APP_STATE/agents/codex"
CODEX_HOME="$INTAKE_APP_STATE/agents/codex" codex login
```

Use the CLI login flow; do not copy an authentication store. API keys may be supplied through the existing `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` environment variables; the launcher forwards them only to the explicitly selected native worker and does not save them in app configuration. Existing native-worker restrictions and unqualified live-provider limitations still apply. Development qualification uses only the default synthetic profile.

## Verification

`pnpm test:dev` checks source-byte filtering and owned-child shutdown. The process tier includes the actual `pnpm dev` launcher boundary: public HTTP/WS, decoding, synthetic DBOS Processing, source restart/error recovery, no-op/runtime-state exclusions, retained restart and shutdown. Run the [PG/process tiers](../intake-server/TESTING.md) under the shared service allocation, with any running full-stack app stopped first.

## Connection status and Capture uploads

The fake inventory serves the same bounded Part-list GET used by the header connection probe, so a healthy fake reports reachable. Reachability does not prove write permission or real-server compatibility.

On startup and source reload, dev setup migrates its owned database and reapplies the complete current API Capture/media permissions, plus the Processing/decoder grants. Retained namespaces upgraded through new Capture/evidence tables therefore receive the required read and upload/group/note privileges without reseeding data. JPEG/PNG originals are retained before preview decoding; a failed save keeps the original selected file and request key for an exact retry. After updating this launcher, restart `pnpm dev` to reconcile an older dev namespace. This does not alter a real InvenTree server.
