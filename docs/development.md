# Running the local application

Use `pnpm dev` from the repository root to start the complete local Bench Intake app at **<http://127.0.0.1:4330>**. By default the command owns the UI, API, apply worker, decoder, Processing worker and a persistent fake inventory service. An explicitly configured external inventory uses the read-only profile described below, without a fake service or apply worker. The `local-inventree` profile reads from a [local development InvenTree](#local-development-inventree) instead. Ctrl-C stops those processes and preserves PostgreSQL and app data. The previous preview is not automatically migrated into this separate namespace.

Install the pinned Node 24/pnpm versions and run `pnpm install --frozen-lockfile` first. Docker with Compose 2.24 or later must be available for the shared `inventree-db` PostgreSQL and bounded image decoder. First startup builds the decoder image; later builds reuse Docker's cache. See the [service ledger](../intake-server/README.md#shared-development-service-ledger) before sharing the local PostgreSQL allocation.

```bash
pnpm dev       # full local app, synthetic Processing by default
pnpm dev --tailscale # also serve it over HTTPS on your tailnet
pnpm dev:ui    # standalone Vite UI; no API proxy or provisioning
pnpm dev:intake # standalone API with explicit server configuration
pnpm codex:login # Codex subscription login for this app's private Codex home
```

The full app forwards `/api` HTTP and WebSocket requests from Vite to its private API listener. Browser origin and CSRF checks remain authoritative. Standalone commands do not provision an app or start workers. `dev:intake` serves built frontend assets when present; use `pnpm build` for that standalone mode.

## Tailnet access

`pnpm dev --tailscale`, or `INTAKE_DEV_TAILSCALE=1` in the environment file, also serves the app at `https://<this machine's MagicDNS name>/` so a phone or another computer on your tailnet can use it. The ready message prints the address. The local `http://127.0.0.1:4330` address keeps working.

The app needs HTTPS off-machine because browsers expose `crypto.randomUUID()` only in a secure context, so plain `http://` on the tailnet address would not work. The launcher runs a foreground `tailscale serve --https=443` in front of a loopback gateway. The gateway admits only requests whose Host and Origin are the MagicDNS origin and that Tailscale identifies as this node's owner (`Tailscale-User-Login`). It then presents them to Vite as the loopback origin, so the API's exact Host/Origin and CSRF checks are unchanged. Requests from other tailnet users, tagged devices or other origins get `403`. Stopping the command, or a failed startup, stops the serve process and Tailscale removes its configuration. `tailscale serve status --json` lists these foreground entries; plain `tailscale serve status` does not. If the launcher itself is killed hard, the Tailscale serve process can keep running and keep serving: stop it with `pkill -f 'Tailscale serve'` (macOS app) or `pkill -f 'tailscale serve'`, then check the JSON status is empty.

Requirements:

- Tailscale is running and logged in, and the `tailscale` CLI is on `PATH`. Otherwise startup stops with `tailscale_unavailable` or `tailscale_not_running` before any setup.
- Serve and HTTPS certificates are enabled for the tailnet. The first time, startup stops with `tailscale_serve_not_enabled` after printing the admin link that enables them; open it once, then start again. The first request after enabling can take a few seconds while Tailscale issues the certificate.
- Nothing else is configured on the serve port. `INTAKE_DEV_TAILSCALE_PORT` selects another HTTPS port (for example `8443`); the address then includes it.

Source reloads keep the gateway and serve process running, like the UI.

## Environment files and InvenTree targets

`pnpm dev`, `pnpm dev:intake` and `pnpm codex:login` load the **current checkout's root `.env`** once at startup. Existing shell environment values take precedence, including explicitly empty values. Use `INTAKE_ENV_FILE=.env.local pnpm dev` to select a caller-relative or absolute file; set `INTAKE_ENV_FILE=''` to disable file loading. A missing default `.env` is fine; an explicitly selected missing, symlinked, oversized or invalid UTF-8 file is refused. Inside the checkout, selected files must be root-level `.env` or `.env.*` names, which Vite already denies. Other filenames belong outside the checkout so source/static serving cannot expose their contents. No other checkout’s environment file is discovered.

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

The env-file allowlist covers full-stack options `INTAKE_DEV_PORT`, `INTAKE_DEV_TAILSCALE`, `INTAKE_DEV_TAILSCALE_PORT`, `INTAKE_APP_STATE`, `INTAKE_DEV_STATE`, `INTAKE_DEV_ADMIN_URL`, `INTAKE_MEDIA_DECODER_IMAGE`, `INTAKE_PROCESSING_PROFILE`, `INTAKE_TARGET_PROFILE`, the three target settings above, the session-worker pairing directory and port (`INTAKE_VM_PAIR` and `INTAKE_VM_PORT`), the native executable overrides and provider API-key names documented below. Standalone `dev:intake` additionally accepts its explicit `INTAKE_ORIGIN`, `INTAKE_DATABASE_URL`, actor/target/context IDs, blob root, deployment ID, Processing channel secret and research URL lists. The full-stack launcher continues to own its local app database/identity settings. File-provided PATH, HOME, Node process flags, Vite variables and unknown keys are ignored; Vite dotenv discovery remains disabled. The standalone API child additionally receives only its required runtime settings and basic host environment, excluding setup-admin URLs, provider keys, native executable overrides and unrelated shell secrets.

## Local development InvenTree

`pnpm inventree:dev up` starts a full InvenTree 1.5.0 (API 530) at **<http://127.0.0.1:4320>**, ready and seeded. It is the Docker Compose project `bench-inventree-dev` in `tooling/inventree-dev/`, pinned to the `inventree/inventree:stable` image by digest. A one-shot `inventree-init` migrates the database and collects static files. It then runs `scripts/bootstrap.py`, which creates the `admin` superuser and the `intake-reader` (view-only) and `intake-writer` users, each with an API token. The `inventree-server` and `inventree-worker` containers start only after init succeeds. Every port binds to loopback only.

```bash
pnpm inventree:dev up           # start, make ready and seed (idempotent)
pnpm inventree:dev seed         # re-run seeding
pnpm inventree:dev credentials  # admin password and API tokens
pnpm inventree:dev env          # INVENTREE_URL / INVENTREE_TOKEN for the importer
pnpm inventree:dev status
pnpm inventree:dev down         # stop InvenTree; inventree-db keeps running
pnpm inventree:dev reset --yes  # wipe InvenTree; intake dev databases are kept
```

To read from it in the app, set `INTAKE_TARGET_PROFILE=local-inventree` and run `pnpm dev`. The launcher runs `inventree:dev up` first, then reads with the reader token from private state. Do not also set `INTAKE_READ_ORIGIN`, `INTAKE_CREDENTIAL_REF`, `INTAKE_DEV_API_KEY` or `INTAKE_DEV_ADMIN_URL`; with this profile they are refused. The app only reads from the instance, as with the read-only profile. For importer testing, `eval "$(pnpm --silent inventree:dev env)"` points `invimport` at the instance with the writer token.

Seeding first runs `invimport parameters --write` and `categories --write` with `--env-file /dev/null`, so the instance matches `backend/config/` and the root `.env` is never read. A dry-run check then fails seeding if anything is still pending. Finally it loads `tooling/inventree-dev/seed/fixtures.json` over REST: locations, companies, parts, manufacturer and supplier parts, and stock. Each seeded record carries `metadata.bench_intake_seed`, so re-runs create nothing and records seeded under another key are left alone. An untagged record that matches a fixture's natural key (name, IPN, MPN, SKU, or part and location) is adopted and tagged, which recovers from a run interrupted between create and tag.

Secrets are generated per machine and kept in the private state directory (`INTAKE_DEV_STATE`, default `~/.local/state/bench-intake`). `inventree-dev.json` holds the instance's secrets and tokens. `inventree.env` and `inventree-init.env` are the Compose env files; only the one-shot init container receives the admin password and tokens. Nothing secret is committed or passed on a command line.

One checkout drives the InvenTree services, because they mount that checkout's scripts. `up` refuses with `inventree_dev_owned_by_other_checkout` while another checkout's containers exist; run `pnpm inventree:dev down` there first. A reset gives the instance a new ID, so the next `local-inventree` app starts in a fresh namespace. `reset --yes` refuses, naming the namespace, while a `local-inventree` app is running, because its read token would no longer exist; stop `pnpm dev` first. `reset --yes --database-server` also wipes the shared database server and every intake dev database. It refuses, naming the namespace, while a live supervisor lock is held under `~/.local/state/bench-intake`, and when `INTAKE_APP_STATE` is set. Neither reset can see app namespaces at other explicit `INTAKE_APP_STATE` paths, so stop those apps yourself first.

### Shared database server

Every profile keeps its intake databases on the stack's `inventree-db` service: PostgreSQL 17, container `bench-inventree-dev-db`, `127.0.0.1:55433`. `pnpm dev` and `pnpm db:intake start` start that service alone when InvenTree is not needed. Its secrets are in `inventree-db.json` and `inventree-db.env`. InvenTree's own `inventree` database is closed to every other role. The server allows 120 connections, enough for InvenTree, one fake namespace and one read-only or local namespace at the same time; two fake namespaces at once would exceed it.

The earlier `bench-intake-dev-pg` container (port 55432), its `bench-intake-dev-pg-data` volume, `postgres.json` and the old `app` namespace are no longer used, and the tooling never touches them. Once you no longer need their data, remove them by hand:

```bash
docker rm -f bench-intake-dev-pg && docker volume rm bench-intake-dev-pg-data
rm ~/.local/state/bench-intake/postgres.json   # and, if unwanted, ~/.local/state/bench-intake/app
```

An explicit `INTAKE_APP_STATE` created on the old server is refused with `development_state_server_changed`; choose a new directory.

## Reload and persistence

Frontend source edits use Vite HMR. Server and shared-contract source edits drain and restart the owned API/workers without replacing the UI server, database or fake inventory state. Migration SQL changes run the existing migration verifier before restart; previously applied migrations remain immutable. Compiler/startup failures during a reload leave the watcher active: fixing code retries startup. An unrelated child failure stops the command for inspection.

Only changed source bytes trigger application reload. Runtime state, uploads, logs, docs, tests, build output and an unchanged-byte source save do not restart the API/workers. Watch roots are `frontend/src`, `contracts/src`, `intake-server/src` and `intake-server/migrations`. Changing dependency manifests, launcher tooling (including the pure `intake-server/src/dev/target.ts` policy) or reused test-fixture implementations requires restarting the command. Vite handles its configuration and HTML files using its normal development behavior.

Private state defaults to `$HOME/.local/state/bench-intake/app-<server id>`, a namespace scoped to the database server; set `INTAKE_APP_STATE` to another private directory **outside the repository** to select a separate retained app. Setup creates an `intake_dev_…` database and dedicated runtime roles. Its synthetic credentials and fixed fake-server port remain in private configuration; the shared PostgreSQL administrator credential is used only during setup/migrations. The development launchers load only the documented server settings from their selected environment file. Existing Python importer variables are not translated into target configuration.

`INTAKE_DEV_PORT` changes the public loopback port (4330 by default). An occupied port causes failure rather than silently choosing a different address. Retained fixture port 4310 and reserved port 4350 are refused by the full-stack launcher. Keep `INTAKE_APP_STATE` stable across starts to retain batches and uploads. `INTAKE_DEV_STATE` selects the existing PostgreSQL helper state directory. CI can explicitly inject an owned loopback `/postgres` connection through `INTAKE_DEV_ADMIN_URL`; that value is not passed to runtime children or saved in app configuration.

An exclusive `supervisor.lock` prevents overlapping owners. If a hard kill leaves a lock, inspect its recorded PID and private `running.json`, confirm every owned child is stopped, and preserve/rename the lock before restarting. A partial first setup without `app.json` fails closed; inspect its retained `initializing` marker and database before recovery. Do not delete retained data to bypass a failure. Normal Ctrl-C releases the owned lock.

## Processing and native agents

Default Processing produces visibly **synthetic** source-bound proposals in either target profile. It performs no inference, image inspection or inventory research. The fake inventory supports local lookup and supervised apply; this is not a connection to a real inventory server.

To explicitly select a native-agent profile for new work:

```bash
INTAKE_PROCESSING_PROFILE=native-agent/2 pnpm dev   # sessions; Examine proposes lots from photos
INTAKE_PROCESSING_PROFILE=native-agent/1 pnpm dev   # one queued result for a saved lot or part
```

`native-agent/2` starts the session supervisor. Setup provisions a dedicated, namespace-bound writer for intake capture changes and stores its credentials privately in `agent-writer.json`. Reuse verifies the server endpoint, role binding and login before reapplying grants; an unbound legacy or misplaced credential file is refused rather than upgrading another role. This grants no inventory-target write access. After a provider, authentication route and model are saved, ready photos queue one Examine session for the batch. `native-agent/1` starts the single-result supervisor and waits for a queued attempt.

Then select the global provider, authentication route and model in Settings before starting an agent. Claude subscription authentication uses the signed-in CLI account under the host `HOME`. Codex subscription mode uses the worker's isolated `$INTAKE_APP_STATE/agents/codex` as `CODEX_HOME`; the default host Codex login is not automatically reused.

Sign in with the checkout's own login command. It reads the same environment file as `pnpm dev` (shell values still win), resolves that app's private state, creates `agents/codex` so only your user can read it, and runs `codex login` with `CODEX_HOME` pointed there:

```bash
pnpm codex:login
```

You can run it while `pnpm dev` is already up. Automatic read-only and local namespaces use `read-only-<hash>` and `local-inventree-<hash>` directories, so the fake profile's `app-<server id>` directory is not a substitute. A default namespace needs the shared database identity (`pnpm dev` or `pnpm db:intake start` creates it). A local InvenTree namespace also needs `pnpm inventree:dev up`, which records the instance id. An explicit `INTAKE_APP_STATE` is used as given and does not need those files; choose it before the first launch and keep it for later launches. `INTAKE_CODEX_EXECUTABLE` selects the binary when `codex` is not on `PATH`.

Use the CLI login flow; do not copy an authentication store. The dedicated directory must contain no `config.toml`, hooks, plugins or skills. API keys may be supplied through the existing `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` environment variables; the launcher forwards them only to the explicitly selected native worker and does not save them in app configuration. Existing native-worker restrictions and unqualified live-provider limitations still apply. Development qualification uses only the default synthetic profile.

The authorized live qualification flow is reproducible with [the qualification driver](../intake-server/scripts/native-session-qualification/README.md). It sends real provider requests on your subscription, so run it only with explicit authorization, against an isolated app on its own port and state directory.

## Verification

`pnpm test:dev` checks source-byte filtering and owned-child shutdown. The process tier includes the actual `pnpm dev` launcher boundary: public HTTP/WS, decoding, synthetic DBOS Processing, source restart/error recovery, no-op/runtime-state exclusions, retained restart and shutdown. Run the [PG/process tiers](../intake-server/TESTING.md) under the shared service allocation, with any running full-stack app stopped first.

## Connection status and Capture uploads

The fake inventory serves the same bounded Part-list GET used by the header connection probe, so a healthy fake reports reachable. Reachability does not prove write permission or real-server compatibility.

On startup and source reload, dev setup migrates its owned database and reapplies the complete current API Capture/media permissions, plus the Processing/decoder grants. Retained namespaces upgraded through new Capture/evidence tables therefore receive the required read and upload/group/note privileges without reseeding data. JPEG/PNG originals are retained before preview decoding; a failed save keeps the original selected file and request key for an exact retry. After updating this launcher, restart `pnpm dev` to reconcile an older dev namespace. This does not alter a real InvenTree server.

Migrations `0020_media_preview_renditions` and `0021_media_rendition_backfill` add display renditions of decoded pages. Media decoded before them is upgraded in the background after `pnpm dev` restarts: when no upload is waiting, the media worker renders one retained page at a time from its stored PNG, logging `renditions_backfilled` or `renditions_skipped_mismatch`. Until a page is upgraded, the app shows its full-resolution image. Both migrations are forward-only, and older code refuses an upgraded database at its schema compatibility gate. To be able to go back, take an archive **with the pre-change build** before starting the new one (`pnpm --filter @invimport/intake-server operations backup`; see the [intake-server README](../intake-server/README.md#coherent-archive-and-quarantined-restore)). To roll back, use the pre-change build to restore that archive into a fresh `intake_restore_*` database and point that build at it. Work done after the upgrade is not carried back.

For a personal shared-VM deployment, `INTAKE_PERSONAL_MANAGEMENT=1` enables the dev UI proxy for credential management. Establish the loopback SSH tunnel before opening **Agent settings → Personal Claude subscription**. The provider token and operator key are entered explicitly and do not belong in the development env file. See [personal Claude setup](../tooling/deployment/README.md#personal-claude-subscription).
