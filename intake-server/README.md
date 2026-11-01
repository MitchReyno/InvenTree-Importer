# Bench Intake server

The T01 foundation now supports T02 retained manual capture: batches, separate lots/shared Part proposals, immutable human notes, exact selections, defaults/overrides and revision-aware edits. It is **not** approval or an inventory executor. See [implemented architecture](ARCHITECTURE.md), [testing guidelines and tiers](TESTING.md), [shared contracts](../contracts/README.md), [T01 evidence](../docs/handovers/bench-intake-T01.md) and [T02 handover](../docs/handovers/bench-intake-T02.md). Python remains disconnected; built React assets use the same-origin capture API.

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

`INTAKE_ORIGIN` must be a canonical `http://127.0.0.1` origin, defaulting to port 4310. Exact Host and Origin checks apply; no CORS is enabled. Configured bootstrap returns a per-server-start CSRF token; capture commands require that token in `X-Intake-CSRF`, exact Origin and UUID `Idempotency-Key`. Missing-key bootstrap issues no token. This is development-key attribution, **not** a human login or final permission gate. Capture mutates only its own application database; no inventory-write capability is installed.

Direct `pnpm --filter @invimport/intake-server migrate` requires an explicit `INTAKE_DATABASE_URL` for a separate app database using a trusted migration role. It verifies SQL checksums and serializes migrations under a transaction advisory lock; it never runs schema push or workers. `pnpm db:intake migrate` supplies the owned local migration credential privately, then grants the separate runtime role only the implemented table/column privileges. Neither command touches Python state. Direct PG/process tests require `INTAKE_TEST_ADMIN_URL` naming a loopback disposable PostgreSQL admin database `/postgres` plus `INTAKE_TEST_ALLOW_CREATE_DATABASE=owned-sandbox`. They fail rather than silently skip or inherit another database. Every test owns and drops only a randomly named `intake_test_*` database; the grant test also creates/removes one isolated restricted role. The wrappers supply these settings without printing passwords. CI should use its own ephemeral PG service, not Docker discovery.

## Explicit manual capture setup

Capture routes register only when `INTAKE_DATABASE_URL` is explicitly injected. Missing database/key/reference is an unavailable/setup state; health/bootstrap do not provision or verify a database. Build with `pnpm build` before running the integrated UI on 4310. `@fastify/static` serves only the built frontend directory, not repository files or environment data. Standalone Vite has no API proxy.

For an allocated feature database only: run reviewed migrations under its trusted migration role; explicitly set the stable actor/target/context configuration and `INTAKE_CAPTURE_ROLE`, then run `node intake-server/scripts/capture-setup.cjs` with the trusted database URL. This command creates development attribution if absent, verifies existing bindings and grants foundation/capture privileges to the named restricted runtime role. Restart the web entry point with that restricted role's URL, not the migration credential. It performs no inventory discovery or requests. The `.cjs` utility deliberately consumes erasable runtime TS via pinned Node's native type stripping. No feature database is automatically allocated, and T02 never migrated the shared `intake_dev`; do not run the shared migration command without coordinator allocation/approval.

Optional `INTAKE_READ_ORIGIN` is an explicit fixed server-only target origin. Together with the injected fake/development key it enables only semantic existing `get_part` / `get_location` reads through the protected-read-only transport. Browser requests accept model plus exact positive PK, never origin/actor/key. The capture read adapter enforces status/JSON/model-PK agreement, 64 KiB body and five-second total read-body deadlines. Read errors remain unavailable, not absent. No real target is needed for development/tests; do not load or copy root `.env`. A read observation and a human choice are different retained records. The current UI does ID lookup/observed-name confirmation, not broad inventory search.

## Shared development service ledger

Inspected before creation on 2026-11-01: no containers, no Compose projects, loopback 55432 unoccupied; local `postgres:17`, `inventree/inventree:stable`, Redis and Caddy images already present. Only PostgreSQL was needed; Redis/Caddy/full stacks were not started.

| Resource              | Allocation and observed state                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner / consumers     | T01 service; T02 reuses only randomized test databases/restricted roles and an owned browser fixture. Coordinator owns other allocations; no persistent T02 feature DB allocated                          |
| Container / volume    | `bench-intake-dev-pg` / `bench-intake-dev-pg-data`, label `bench-intake.owner=T01`; no Compose project                                                                                                   |
| Image / actual server | Existing `postgres:17`, image ID `b9982e1879d4`; PostgreSQL 17.10 Debian observed via `postgres --version`                                                                                               |
| Loopback / namespace  | `127.0.0.1:55432` → 5432; `intake_dev`; isolated random `intake_test_*` databases                                                                                                                        |
| Roles                 | `intake_dev_migrator` owns app DDL; `intake_dev_app` cannot create DB/roles/schema or rewrite retained authority. Each has connection limit 8; tests use sandbox admin only for disposable DB/role setup |
| Budgets               | 0.5 CPU, 256 MiB, 128 PIDs, 40 server connections, 32 MiB shared buffers; ordinary app pool max 4, DBOS qualification pool 3 + client 2                                                                  |
| State                 | Fresh generated local-only passwords in `${HOME}/.local/state/bench-intake/postgres.json`, directory 0700/file 0600; override with `INTAKE_DEV_STATE`, preserving caller-cwd-relative meaning            |
| Restart / cleanup     | Restart policy `no`; no automatic stop/delete/prune command. Reuse the owned service; serialize destructive PG fault/restart experiments through the coordinator                                         |
| Web / test HTTP       | T02 capture web reserves 4310; one generated-client test briefly reserves loopback 4319; controlled read fixtures use ephemeral loopback ports and release them                                           |

`db:intake` discovers Docker on PATH, through `DOCKER_BIN`, or by macOS bundle-ID discovery. It inventories containers/Compose before actions, verifies ownership, image, loopback port, volume and budgets before reusing its service and refuses to start another PG if a different PostgreSQL container already exists. That refusal means request a compatible allocation, not stop/delete the other service. Malformed, symlinked or non-private state is refused, never silently regenerated. Additional task databases/roles require coordinator allocation; do not share mutable fixtures or kill the service while another owner consumes it. Keep the volume and private state for subsequent worktrees.

The development-service command and contracts generator are non-runtime `.cjs` tools run directly by pinned Node; their declared dependencies are still required. They deliberately reuse the runtime TypeScript grant/schema source via Node 24's native erasable-type support, without tsx or a bundler loader. Runtime migration, web and qualified worker entry points stay TypeScript; typed application test modules exercise those interfaces through the declared test runner.

## Optional local InvenTree image

Observed in a transient **network-disabled**, no-mount inspection container: local image ID `49b5d7a6988e`, source revision label `6a6736b`, software `1.5.0`, API `530`. The empty image-version label alone was insufficient; constants in the image were inspected. The inspection container was removed by its own `--rm` lifecycle; no inventory service was started, no database/media volume was mounted, and no HTTP/version/stock capability was qualified. This does not identify the protected server's version.

A future T03/T04 allocation can use this image with a fresh dedicated `intake_sandbox_*` database/role on the shared PG, a named `bench-intake-sandbox-data` volume, fresh server secret/admin credentials, no root `.env` or personal credential-store mounts, an internal Docker network with no outbound inventory integrations, and a loopback-only reserved HTTP port (proposed 4320, **not allocated/running**). Entrypoint `init.sh` creates static/media/backup directories and copies the default config; setting `INVENTREE_PY_ENV` triggers first-run dependency installation, so use the image's existing environment rather than an unqualified new venv. Migrate and explicitly create the sandbox operator using the image's supported setup commands before starting Gunicorn. Startup, permissions and mutation/read-back behavior remain **not tested**, not blockers for this fake-only foundation. Reinspect resources/health and reserve ledger ownership before starting it; do not launch a redundant stack merely for a version observation.
