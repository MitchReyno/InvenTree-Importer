# Bench Intake server

The T01 foundation now supports T02 retained manual capture: batches, separate lots/shared Part proposals, immutable human notes, exact selections, defaults/overrides and revision-aware edits. T04 adds selected review, frozen exact approval, explicit queueing/cancellation/recovery and original-run results. The [executor module](src/execution/ARCHITECTURE.md) remains qualified only against its owned persistent fake; actual InvenTree mutation is unsupported. See [code guidelines](CODE_GUIDELINES.md), [implemented architecture](ARCHITECTURE.md), [testing guidelines and tiers](TESTING.md), [shared contracts](../contracts/README.md), [T01 evidence](../docs/handovers/bench-intake-T01.md) and [T02 handover](../docs/handovers/bench-intake-T02.md). Python remains disconnected; built React assets use the same-origin capture API.

## Run and check

Use the repository's `.node-version` and `packageManager` pins. No environment file is auto-loaded. All examples below are run from repository root and use no inventory credentials.

```sh
pnpm install --frozen-lockfile
pnpm dev:intake
# In another terminal: bootstrap safely reports setup_required.
curl --fail http://127.0.0.1:4310/api/v1/bootstrap
pnpm typecheck:intake
pnpm contracts:check
pnpm test:intake
pnpm db:intake status
pnpm db:intake start
pnpm db:intake migrate
pnpm db:intake test
pnpm db:intake test:process
```

`dev:intake` starts **only the web API** on `127.0.0.1:4310`; autoreload never starts a worker. Bootstrap health is process liveness, not database readiness or target permission qualification. Missing key/reference is an explicit setup state, not an attempt to log in. Stable development actor/target/context IDs are server configuration, never browser input. `INTAKE_ACTOR_ID`, `INTAKE_TARGET_ID`, `INTAKE_TARGET_CONTEXT_ID`, `INTAKE_CREDENTIAL_REF` and `INTAKE_DEV_API_KEY` are explicit server-only injection points; defaults are stable development placeholders. Keep the reference stable when retaining development attribution. `configured` means only that a nonempty key and reference were supplied, not verified inventory access. **Do not supply the protected real key for T01.** No target URL is resolved or called by web startup/bootstrap. Persisted actor/target rows are infrastructure for later trusted feature setup, not automatically inferred from the browser or a remote request.

`INTAKE_ORIGIN` must be a canonical `http://127.0.0.1` origin, defaulting to port 4310. Exact Host and Origin checks apply; no CORS is enabled. Configured bootstrap returns a per-server-start CSRF token; capture/manual commands require that token in `X-Intake-CSRF`, exact Origin and UUID `Idempotency-Key`. Missing-key bootstrap issues no token. This is development-key attribution, **not** a human login or final permission gate. Capture/manual web commands mutate only the application database; the web process receives no inventory-write capability.

Direct `pnpm --filter @invimport/intake-server migrate` requires an explicit `INTAKE_DATABASE_URL` for a separate app database using a trusted migration role. It verifies SQL checksums and serializes migrations under a transaction advisory lock; it never runs schema push or workers. `pnpm db:intake migrate` supplies the owned local migration credential privately, then grants the separate runtime role only the implemented table/column privileges. Neither command touches Python state. Direct PG/process tests require `INTAKE_TEST_ADMIN_URL` naming a loopback disposable PostgreSQL admin database `/postgres` plus `INTAKE_TEST_ALLOW_CREATE_DATABASE=owned-sandbox`. They fail rather than silently skip or inherit another database. Every test owns and drops only a randomly named `intake_test_*` database; the grant test also creates/removes one isolated restricted role. The wrappers supply these settings without printing passwords. CI should use its own ephemeral PG service, not Docker discovery.

## Explicit manual capture setup

Capture routes register only when `INTAKE_DATABASE_URL` is explicitly injected. Missing database/key/reference is an unavailable/setup state; health/bootstrap do not provision or verify a database. Build with `pnpm build` before running the integrated UI on 4310. `@fastify/static` serves only the built frontend directory, not repository files or environment data. Standalone `dev:ui` has no API proxy. Root `pnpm dev` starts the [complete retained local development app](../docs/development.md), including a same-origin Vite HTTP/WebSocket proxy and synthetic workers.

For an allocated feature database only: run reviewed migrations under its trusted migration role; explicitly set the stable actor/target/context configuration and `INTAKE_CAPTURE_ROLE`, then run `node intake-server/scripts/capture-setup.cjs` with the trusted database URL. This command creates development attribution if absent, verifies existing bindings and grants foundation/capture privileges to the named restricted runtime role. Restart the web entry point with that restricted role's URL, not the migration credential. It performs no inventory discovery or requests. The `.cjs` utility deliberately consumes erasable runtime TS via pinned Node's native type stripping. No feature database is automatically allocated, and T02 never migrated the shared `intake_dev`; do not run the shared migration command without coordinator allocation/approval.

Optional `INTAKE_READ_ORIGIN` is an explicit fixed server-only target origin. Together with the injected fake/development key it enables only semantic existing `get_part` / `get_location` reads through the protected-read-only transport. Browser requests accept model plus exact positive PK, never origin/actor/key. The capture read adapter enforces status/JSON/model-PK agreement, 64 KiB body and five-second total read-body deadlines. Read errors remain unavailable, not absent. No real target is needed for development/tests; tests never load the original inventory `.env` or copy real credentials. Explicit `dev`/`dev:intake` launchers now accept the current checkout’s selected env file through the [development configuration](../docs/development.md#environment-files-and-inventree-targets) boundary; direct runtime entrypoints still use injection only. A read observation and a human choice are different retained records. Bounded location and supplier catalogue search/candidate routes use the same fixed origin and read-only transport; the current UI still does ID lookup/observed-name confirmation until the searchable pickers land.

## Shared development service ledger

Inspected before creation on 2026-11-01: no containers, no Compose projects, loopback 55432 unoccupied; local `postgres:17`, `inventree/inventree:stable`, Redis and Caddy images already present. Only PostgreSQL was needed; Redis/Caddy/full stacks were not started.

| Resource              | Allocation and observed state                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner / consumers     | T01 service; T02 and T04 reuse isolated DBs/roles and separate owned browser fixtures. The coordinator owns allocations; never migrate or reset another namespace                                                                             |
| Container / volume    | `bench-intake-dev-pg` / `bench-intake-dev-pg-data`, label `bench-intake.owner=T01`; no Compose project                                                                                                                                        |
| Image / actual server | Existing `postgres:17`, image ID `b9982e1879d4`; PostgreSQL 17.10 Debian observed via `postgres --version`                                                                                                                                    |
| Loopback / namespace  | `127.0.0.1:55432` → 5432; `intake_dev`; isolated random `intake_test_*` databases                                                                                                                                                             |
| Roles                 | `intake_dev_migrator` owns app DDL; `intake_dev_app` cannot create DB/roles/schema or rewrite retained authority. Each has connection limit 8; tests use sandbox admin only for disposable DB/role setup                                      |
| Budgets               | 0.5 CPU, 256 MiB, 128 PIDs, 40 server connections, 32 MiB shared buffers; ordinary app pool max 4, DBOS qualification pool 3 + client 2                                                                                                       |
| State                 | Fresh generated local-only passwords in `${HOME}/.local/state/bench-intake/postgres.json`, directory 0700/file 0600; override with `INTAKE_DEV_STATE`, preserving caller-cwd-relative meaning                                                 |
| Restart / cleanup     | Restart policy `no`; no automatic stop/delete/prune command. Reuse the owned service; serialize destructive PG fault/restart experiments through the coordinator                                                                              |
| Web / test HTTP       | Retained T02 capture web reserves 4310; T04 manual preview reserves 4330 with a separate persistent fake/DB; one generated-client test briefly reserves loopback 4319; controlled read fixtures use ephemeral loopback ports and release them |

`db:intake` discovers Docker on PATH, through `DOCKER_BIN`, or by macOS bundle-ID discovery. It inventories containers/Compose before actions, verifies ownership, image, loopback port, volume and budgets before reusing its service and refuses to start another PG if a different PostgreSQL container already exists. That refusal means request a compatible allocation, not stop/delete the other service. Malformed, symlinked or non-private state is refused, never silently regenerated. Additional task databases/roles require coordinator allocation; do not share mutable fixtures or kill the service while another owner consumes it. Keep the volume and private state for subsequent worktrees.

The development-service command and contracts generator are non-runtime `.cjs` tools run directly by pinned Node; their declared dependencies are still required. They deliberately reuse the runtime TypeScript grant/schema source via Node 24's native erasable-type support, without tsx or a bundler loader. Runtime migration, web and qualified worker entry points stay TypeScript; typed application test modules exercise those interfaces through the declared test runner.

## Optional local InvenTree image

Observed in a transient **network-disabled**, no-mount inspection container: local image ID `49b5d7a6988e`, source revision label `6a6736b`, software `1.5.0`, API `530`. The empty image-version label alone was insufficient; constants in the image were inspected. The inspection container was removed by its own `--rm` lifecycle; no inventory service was started, no database/media volume was mounted, and no HTTP/version/stock capability was qualified. This does not identify the protected server's version.

A future T03/T04 allocation can use this image with a fresh dedicated `intake_sandbox_*` database/role on the shared PG, a named `bench-intake-sandbox-data` volume, fresh server secret/admin credentials, no root `.env` or personal credential-store mounts, an internal Docker network with no outbound inventory integrations, and a loopback-only reserved HTTP port (proposed 4320, **not allocated/running**). Entrypoint `init.sh` creates static/media/backup directories and copies the default config; setting `INVENTREE_PY_ENV` triggers first-run dependency installation, so use the image's existing environment rather than an unqualified new venv. Migrate and explicitly create the sandbox operator using the image's supported setup commands before starting Gunicorn. Startup, permissions and mutation/read-back behavior remain **not tested**, not blockers for this fake-only foundation. Reinspect resources/health and reserve ledger ownership before starting it; do not launch a redundant stack merely for a version observation.

## Explicit owned-fake manual journey

`INTAKE_DEPLOYMENT_ID` plus the fixed `INTAKE_READ_ORIGIN` bind preparation to trusted retained deployment authority. Browser requests cannot choose a target, actor, credential or deployment. `registerManual` installs the strict manual API only alongside the explicitly configured DB. Review accepts at most ten unique physical lots; approval binds the exact retained digest, review fingerprint and target revision. A second explicit queue command starts delivery. Polling reads retained journal outcomes; closing the page does not cancel a run.

Only a separately launched runner receives mutation capability:

```sh
INTAKE_RUNNER_CONFIG="$OWNED_RUNNER_CONFIG" pnpm --filter @invimport/intake-server apply:manual
```

The private owner-only JSON config names `runnerDatabaseUrl`, `schedulerDatabaseUrl`, `applyDatabaseUrl`, `gateRoot`, `deploymentId` and an owned-loopback `profile`. Provision distinct approval/delivery/apply roles using the reviewed grant functions, plus explicit external activation/witness state. Never give the web/API role the apply config, source enrollment or migration credential. Startup does not provision this authority. Restricted local setup and coherent archive/restore instructions follow below. Final identity and normal authenticated deployment remain T11 work; the fixture is not production onboarding.

For a newly allocated, unused 4330 preview only:

```sh
pnpm build
pnpm db:intake preview:manual
```

The explicit fixture creates one random owned DB, synthetic restricted roles, persistent fake, actual web and separate DBOS/apply runner. It reserves 4330 before allocation and fails if occupied. Reuse the current owner’s preview instead of invoking it again. Safe live ownership metadata is written to ignored `.amp/in/artifacts/T04-preview.json`; no secret is emitted. The [T04 handover](../docs/handovers/bench-intake-T04.md) records current PIDs, namespace, baseline and reviewed screenshots.

`SIGUSR2` to that metadata’s `parent_pid` restarts only its web child, retaining fake/DB/runs. `SIGTERM` reaps its owned children/fake and drops only its allocated DB/roles; it is cleanup, not a persistence restart. Do not send either signal to shared PG or the T02 fixture. Full web/fake/runner persistence restart is exercised by the actual process test through explicit fixture methods.

Budget the sole shared PG’s 40 connections/256 MiB across retained previews and tests. Ordinary app pools cap at four, DBOS runner at three plus client two, and manual DB roles at six each. PG/process files run serially; within-test concurrency remains explicit. Run heavy tiers serially with no preview apply in flight and inspect active usage before adding another consumer. Never fix contention by increasing shared limits or starting duplicate PG/full-stack containers.

## Live updates and restricted operational setup

The web process serves a versioned WebSocket at `/api/v1/live`. One actor/target/context-scoped channel carries retained cursor hints; it never dispatches a command. Same-origin/Host checks run before upgrade, then the browser sends the existing development authorization in a bounded first frame. Tokens never appear in URLs. Heartbeats, five-minute connection refresh, an eight-connection cap, 16KiB input and 64KiB send-queue bounds keep failed/slow peers bounded. Stream heads are exact decimal text. Catch-up beyond 128 events or missing history requires a snapshot reset. Up to 100 scoped streams are tracked, prioritizing the selected batch; truncated subscriptions retain a 15-second safety poll.

The browser pauses routine two-second reads while live updates are healthy, invalidates retained queries on changes and reconciles after reconnect/focus. Disconnection restores polling with capped reconnect delay. Drafts, pinned identities and command keys remain in their existing owners; reconnect never submits an approval, answer, cancellation or edit. A protocol mismatch requires a reload after saving/discarding unsaved work. Future autosave/agent dialogue still needs its own reviewed command semantics; this channel is a projection service.

A frozen local setup uses the pinned Node/pnpm versions, `pnpm install --frozen-lockfile`, `pnpm contracts:check`, `pnpm typecheck` and `pnpm build`. Provision explicit restricted roles through the owning grant functions; the API foundation role now needs read-only `schema_migration` access. Do not run migrations or grant provisioning from web startup. Use separately injected configuration for the web, manual runner and decoder, with only the manual runner receiving owned-fake mutation capability. Never load the repository environment file, copy inventory/provider credentials or silently select a native research runner. Native research remains unqualified and disabled for operational release claims.

`GET /api/v1/health` is liveness. `GET /api/v1/readiness` checks current target context and exact migration hashes without inventory requests and returns redacted local-mode diagnostics or 503. Web startup quarantines an unknown/missing/changed migration set before registering application routes. Deploy compatible code only after draining old processes. A stale DBOS handler/plan remains refused by the existing version/digest authority; no automatic plan upgrade exists. SIGTERM drains the web, terminates its projection sockets and closes its own pool. The separately launched runner stops new delivery and waits for its existing workflow shutdown; do not replace a surviving physical child or steal its retained claim. Structured startup/drain/refusal records contain fixed event codes, never raw errors, SQL, paths, keys or connection strings.

This is still single-host restricted development setup. No remote deployment, production identity, native inference, service-account bypass or release-ready qualification is provided.

## Coherent archive and quarantined restore

The explicit maintenance entry point is `pnpm --filter @invimport/intake-server operations backup` or `operations restore`. Native PostgreSQL17-compatible `pg_dump` and `pg_restore` must be on PATH. Use only a separately allocated owned database for qualification. Tests use the existing owned PostgreSQL17 container's binaries under the service lease; they do not install another stack.

Provide `INTAKE_OP_DATABASE_URL`, `INTAKE_OP_SCHEDULER_DATABASE_URL`, `INTAKE_OP_GATE_ROOT`, `INTAKE_OP_ARCHIVE` and, for media/restore, `INTAKE_OP_BLOB_ROOT` through trusted private environment injection. No defaults, environment-file discovery or credential export is supported. App and scheduler URLs must explicitly identify the same local `intake_*` database with injected credentials; separate scheduler topology is refused. Never put connection settings on command arguments or commit them. The archive contains a custom database dump, exact retained blobs and a versioned manifest bound to the non-secret external deployment identity; credentials, runtime config files, activation, witnesses and physical claims are excluded.

Before maintenance, stop the owned runner/decoder/GC and web processes, reap every physical child and externally disable apply. The tool checks the private disabled activation and absence of a physical writer claim. It never disables/enables activation itself, removes a claim, reconciles a witness or restarts a shared service. Preserve external witnesses independently across every archive/restore.

Backup acquires share locks over application and scheduler tables, uses an exported PostgreSQL snapshot and verifies every retained blob before exclusively finalizing the manifest. Referenced immutable versions and approval/command pins remain retained; no retention deletion or unpinning command is added. The manifest uses an explicit 2MiB strict JSON budget; HTTP and worker parsing retain the default 256KiB limit. Limits are 10,000 blobs, 8GiB total retained blob bytes, an 8GiB dump, a 120-second native-tool deadline and bounded stderr. A failed attempt leaves its incomplete destination for inspection; it never overwrites an existing archive or automatically cleans evidence.

Restore requires a newly provisioned empty local database named `intake_restore_*` and a new private canonical blob-root path. It verifies manifest/version/dump/blob hashes before restore, restores app and scheduler together, rechecks database/store identity and returns `restored-quarantined`. Paths with symlink parents, active/stranded writer claims, incompatible versions, corrupt bytes and existing destinations are refused. Original archive and external evidence remain unchanged. Reprovision restricted role grants and credentials separately; the archive does not contain them. Restore never activates apply. An older archive missing a later remote-create intent remains blocked by the preserved external witness, even if an operator later tries to enable the old deployment. Lost attribution may remain permanently blocked; do not delete witnesses or replace sources/epochs to bypass it.

Rollback of this code uses a normal reviewed revert and compatible process drain; there is no database migration in this change. Preserve database/blobs/external evidence. Once unknown/new schema is present, older code quarantines rather than rewriting it. The [T10 task record](../docs/handovers/bench-intake-T10.md) distinguishes observed fixture evidence from unresolved provider/identity/release gates.
