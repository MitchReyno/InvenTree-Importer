# Design assessment

## Context and grounding

This change spans two boundaries. Root tooling (`tooling/dev.cjs`) owns the dev supervisor. The intake server owns the dev PostgreSQL service (`intake-server/scripts/dev-services.cjs`), dev target selection (`src/dev/target.ts`) and app provisioning (`src/dev/setup.ts`, `state.ts`). The [proposal](proposal.md) records current behaviour and the reuse assessment.

Complexity is moderate. The change adds a Docker Compose stack and changes the supervisor's PostgreSQL allocation. It does not touch API, UI, contracts or importer policy. The risks are operational: credential handling, ownership of Docker resources, the move onto a new database server, and readiness timing.

## Goals and constraints

Goals:

- `pnpm inventree:dev up` produces a ready, seeded local InvenTree. It is idempotent.
- `pnpm dev` uses `inventree-db` for the intake databases under every profile.
- `INTAKE_TARGET_PROFILE=local-inventree` starts the full stack and binds the app's reads to it.

Constraints:

- **Loopback only.** Every published port binds to `127.0.0.1`.
- **No secrets in the repo.** Nothing secret goes in tracked files, argv or logs.
- **Owned resources only.** Act only on Docker resources this project created and labelled.
- **Preserve local data.** Never touch the legacy `bench-intake-dev-pg` resources or other local data.
- **Portable paths.** No absolute local paths in tracked files (`AGENTS.md`).
- **Compatible state rules.** Keep the existing role layout, connection budgets and private-state checks.

### Acceptance criteria

These replace spec scenarios, because the change declares `skip_specs: true`.

| ID | Criterion |
| --- | --- |
| AC1 | On a machine with Docker and the base image, `pnpm inventree:dev up` exits 0. Afterwards `GET http://127.0.0.1:4320/api/` returns API version 530. The admin can sign in to the web UI at `http://127.0.0.1:4320`. |
| AC2 | After `up`, the private state file holds an admin password and read and write tokens. `GET /api/user/me/` succeeds with each token. The read token gets 403 on `POST /api/part/`. The write token can create a part. |
| AC3 | After `up`, every category and parameter template defined in `backend/config/` exists. So do the seed fixture's locations, companies, parts and stock. A second `up`, or `seed`, creates no duplicates. |
| AC4 | `pnpm dev` with the default `fake` profile starts only `inventree-db` and provisions the intake app on it. It creates or starts no `bench-intake-dev-pg` container, and leaves an existing one untouched. |
| AC5 | `pnpm dev` with `INTAKE_TARGET_PROFILE=local-inventree` and no other target settings starts the full stack and waits for bootstrap. The app's bootstrap reports a configured target. A Capture existing-Part read for a seeded part PK returns that part. |
| AC6 | No secret appears in tracked files, process argv, Compose files or stdout. Exceptions: the explicit `pnpm inventree:dev credentials` and `env` commands. The tooling never prints `docker inspect` or `docker compose config` output. Failure log tails are redacted. The seeding child never loads the root `.env`. State files are 0600 in a 0700 directory. Malformed or symlinked state is refused. |
| AC7 | The tooling refuses to act on a container or volume that has a reserved name but lacks the project labels. `reset --yes` removes only InvenTree's database, role, volume and state. Only `--database-server` also removes the labelled database volume. Without `--yes`, `reset` refuses. |
| AC8 | `local-inventree` combined with a user-supplied `INTAKE_READ_ORIGIN`, `INTAKE_CREDENTIAL_REF` or `INTAKE_DEV_API_KEY` fails with `conflicting_development_target_settings`. The supervisor passes the setup child only the profile; only the API child receives the fixed origin, reference and the read key from state. |

## Decisions and alternatives

### Owned Compose project with mounted scripts, no derived image

The Compose file is `tooling/inventree-dev/compose.yaml`, project name `bench-inventree-dev`. Every service carries the label `bench-intake.owner=inventree-dev`.

| Service | Image | Role |
| --- | --- | --- |
| `inventree-db` | `postgres:17` | Container `bench-inventree-dev-db`. Publishes `127.0.0.1:55433:5432`. Volume `bench-inventree-dev-db`. Health check `pg_isready`. Runs with `max_connections=120` and `shared_buffers=64MB`. Limited to 1 CPU, 512 MiB and 256 PIDs. The drift check also covers the PID limit. These server limits are deliberately higher than the legacy 40 connections, 32 MiB, 0.5 CPU, 256 MiB and 128 PIDs, because the server now also hosts InvenTree. |
| `inventree-init` | base image, pinned by digest | One-shot, `restart: "no"`. Runs `invoke migrate`, `invoke static`, then `bootstrap.py` through the Django shell. Exits 0 when the instance is ready. The CLI runs it explicitly with `compose up --no-deps --exit-code-from inventree-init`, so no service depends on it. |
| `inventree-server` | base image | Gunicorn with 2 workers. Publishes `127.0.0.1:4320:8000`. Started with `--no-deps` only after `inventree-init` has exited 0, so starting it can never recreate the shared `inventree-db`. |
| `inventree-worker` | base image | `invoke worker` with 1 background worker. |

The base image is `inventree/inventree@sha256:36027b18ac12e428d0adeda1428325a79c915d571f9c22e2efa0d736f68a3d53`. That is the repository digest of the named image ID `sha256:49b5d7a6…`.

`inventree-db` is shared by every worktree, as `bench-intake-dev-pg` is today. `dev-services` may start it from any checkout with `compose up --no-recreate --wait inventree-db`. Before that, it checks the existing container's image, published port, limits, command and labels against its own definition. On drift it refuses with the existing `owned_service_allocation_changed_request_coordinator` code and never recreates the shared server.

The InvenTree services are different: one checkout drives them, because the mounted scripts resolve to the checkout that runs `up`. The CLI compares the `com.docker.compose.project.working_dir` label on the existing `inventree-server`, `inventree-worker` or `inventree-init` container, never on `inventree-db`, with its own checkout. It refuses with `inventree_dev_owned_by_other_checkout`, naming the other path only in its message. `down` stops only those InvenTree services and leaves `inventree-db` running. Moving the stack to a new checkout is an explicit `down` there, then `up` here. The docs say this.

The project uses Compose's default bridge network. An internal network cannot publish the loopback ports. The stack makes no outbound calls of its own, because plugins are disabled, and none are needed. This replaces the internal-network suggestion in the `intake-server/README.md` image notes.

The service keeps upstream's name, `inventree-db`. The container gets a distinct name so it cannot collide with another InvenTree stack on the machine. That container name is also the `docker exec` target for the PG17 tools. Both volumes declare an explicit `name:` and the owner label, so Compose does not prefix them with the project name and reset can find them by label.

The InvenTree services:

- share the volume `bench-inventree-dev-data` mounted at `/home/inventree/data`;
- get `tooling/inventree-dev/scripts/` mounted read-only;
- receive secrets through private env files the CLI generates in the state directory, never through the repository. `inventree.env` holds what the server and worker need: the database password and the Django secret key. `inventree-init.env`, used only by the one-shot `inventree-init`, adds the admin password and the stored tokens, so long-running containers never hold them. The Compose file names env files by interpolation from `BENCH_INVENTREE_DEV_STATE`, which the tooling sets from the resolved state directory, honouring `INTAKE_DEV_STATE`. Every generated env file (`inventree-db.env`, `inventree.env` and `inventree-init.env`) is declared `required: false`, which needs Compose 2.24 or later. Compose loads the whole project model even for `up inventree-db`, so this lets that command work under the fake profile before the InvenTree files exist;
- set `INVENTREE_SITE_URL=http://127.0.0.1:4320`, `INVENTREE_DB_HOST=inventree-db`, cache disabled and plugins disabled;
- never set `INVENTREE_PY_ENV`, which would trigger a dependency install (see the `intake-server/README.md` image notes).

Rejected alternatives, from the proposal: a derived image adds a build without any baked-in readiness, and upstream Compose unchanged publishes on all interfaces with placeholder secrets. Caddy and Redis are omitted because whitenoise serves static files and the dev stack needs no cache. If whitenoise turns out not to serve the UI, adding Caddy is the fallback and is recorded in the handover.

### Bootstrap inside the init container

`bootstrap.py` runs in the Django shell and makes the instance ready. Each run:

- creates or updates the admin superuser from `INVENTREE_ADMIN_*`;
- creates `intake-reader`, with view-only group permissions, and `intake-writer`, with full staff permissions;
- checks the stored tokens the CLI passes in, through a private env file, against the `ApiToken` rows in the Django shell. 1.5.0 stores the key, so no server is needed. It reuses tokens that match, and otherwise issues or replaces only the token named `bench-intake-dev`;
- writes the resulting token values to `/tmp/bench-intake-tokens.json` in the init container's own filesystem, never the shared volume.

After `inventree-init` exits 0, the CLI copies the file with `docker compose cp inventree-init:/tmp/bench-intake-tokens.json` into a fresh 0700 directory inside the state directory. Copying to a path avoids the tar stream that `-` produces. It reads the file, writes the tokens into `inventree-dev.json`, and deletes the copy and directory. It then always removes the exited container with `compose rm -f inventree-init`, including after a failure, once a redacted log tail has been captured. No container keeps the admin password or tokens.

Rejected: the `GET /api/user/me/token/` Basic-auth flow. It would put the user passwords on the wire and still needs those users to exist first. The Django model route is stable on the pinned 1.5.0. From InvenTree 1.6, token secrets are not stored, so the image upgrade note says to re-issue tokens.

### Seeding

`pnpm inventree:dev seed` (also run at the end of `up`) does two steps, both with the write token:

1. Runs `uv run --project backend invimport --env-file /dev/null parameters --write` and then `categories --write` the same way. `INVENTREE_URL` and `INVENTREE_TOKEN` come through the child environment, and `INVENTREE_USER`/`INVENTREE_PASSWORD` are removed from it. This reuses the importer's own config sync, so the local instance always matches `backend/config/`.
   Both commands exit 0 even when they report problems, so `seed` then checks over REST that every category and parameter template defined in `backend/config/` exists, and fails with `inventree_dev_seed_incomplete` otherwise.
2. Loads `tooling/inventree-dev/seed/fixtures.json` over REST: stock locations, a manufacturer and a supplier, a few parts in configured categories with supplier parts, and stock items.

Each fixture record has a stable seed key in `metadata.bench_intake_seed`. The loader looks records up by that key before creating them, so it is idempotent and never updates or deletes records it did not seed. API 530 cannot set metadata in the create call (task 3.1), so the loader creates the record, then tags it through `/api/metadata/<model>/<pk>/` (the old `/api/<model>/<pk>/metadata/` path redirects there), and on lookup also matches untagged records by the fixture's natural key (name, or IPN for parts). That match tags them instead of duplicating, so an interrupted create-then-tag does not duplicate on re-run.

Rejected: Django `loaddata` fixtures, which are coupled to model internals and fixed primary keys. Also rejected: the upstream demo dataset; see the proposal.

### `inventree-db` hosts the intake databases for every profile

`dev-services.cjs` stops creating `bench-intake-dev-pg`. Instead `start` runs `docker compose -p bench-inventree-dev up -d --no-recreate --wait inventree-db`, after the drift check described below, then provisions roles and databases exactly as today, against `127.0.0.1:55433`:

- `intake_dev_migrator` and `intake_dev_app` with connection limit 8;
- the `intake_dev` database;
- per-app `intake_dev_<hex>` databases.

Secrets for the shared server live in a new state file, `inventree-db.json`, which holds the superuser and intake role secrets. `dev-services` generates it and a private `inventree-db.env` holding only `POSTGRES_PASSWORD`, which Compose passes to `inventree-db`. The legacy `postgres.json` is never read, rewritten or deleted, so a rollback still finds the legacy container's secret intact.

InvenTree's own role and database (`inventree`) belong to `inventree:dev up`. `up` first runs `dev-services start`, so it works on a fresh machine without a prior `pnpm dev`. Before running `inventree-init`, it connects as the superuser and idempotently creates role `inventree`, with its generated password and connection limit 20, and database `inventree`, owned by that role. It runs `REVOKE CONNECT ON DATABASE inventree FROM PUBLIC` and grants CONNECT to `inventree` only, so intake roles cannot connect to it. The postgres image's first-boot `POSTGRES_USER`/`POSTGRES_DB` are not relied on, because `inventree-db` may already have been created under the fake profile.

Connection budget for `max_connections=120`, using the existing role limits:

| Consumer | Connections |
| --- | --- |
| InvenTree (`inventree` role) | up to 20 |
| Intake `intake_dev_migrator` and `intake_dev_app` | up to 8 each |
| One fake namespace | up to 42: api, runner and apply 6 each; scheduler 12 (`setup.ts`); processing, media and fake 4 each |
| One read-only or `local-inventree` namespace | up to 24: four roles at 6 each (`readonly-setup.ts`) |
| `superuser_reserved_connections` | 3 |
| Superuser test databases, admin and PG17 tools | the remaining 15 |

One fake namespace and one local namespace can therefore run at the same time. Two concurrent fake namespaces would exceed the budget, and the docs say so.

Port and container identity live in one module, `intake-server/src/dev/pg-identity.ts` (erasable TypeScript, so the `.cjs` scripts load it through Node type stripping), which exports the host, port, Compose project, service and container names. `setup.ts`, `run-media-pg.cjs` and `tests/support/pg-tools.ts` read it, and tests can still override it through `INTAKE_TEST_PG_CONTAINER`. `setup.ts` and `run-media-pg.cjs` also switch their admin secret source from `postgres.json` to `inventree-db.json`.

App state gets a server identity. `inventree-db.json` carries a generated `server_id`, and every app state binding records it. The default namespaces move to new roots, `app-<server_id prefix>` for fake and the target digest including the server ID for the others. So the first `pnpm dev` after the move starts a fresh namespace instead of migrating a database that does not exist, and the old `app` directory is left untouched. An explicit `INTAKE_APP_STATE` bound to another server, or to none, is refused with `development_state_server_changed`.

The supervisor resolves the server identity before it computes the state root and takes `supervisor.lock`. `dev-services start` creates `inventree-db.json`, after checking for the labelled database volume, and the supervisor runs it before resolving the root. A docker-free `dev-services identity` only reads the file and never creates it; it is used where the server is already provisioned. When `INTAKE_DEV_ADMIN_URL` is set and dev-services is skipped, the identity is a digest of that URL's host and port, never its secret. `local-inventree` with `INTAKE_DEV_ADMIN_URL` is refused with `conflicting_development_target_settings`, because the local stack must own its database server.

The CLI and `dev-services` load the same allowlisted root env file as `pnpm dev`, so `INTAKE_DEV_STATE` agrees between them. If `inventree-db.json` exists but neither the server's container nor its volume does, `start` writes a new `server_id` and keeps the secrets, so apps bound to the old server get fresh namespaces instead of missing databases. If the labelled database volume exists but `inventree-db.json` is missing, they refuse with `inventree_db_state_missing_for_existing_volume` instead of generating secrets that cannot authenticate. `POSTGRES_PASSWORD` applies only when a volume is first initialised.

The old guard rejected any other PostgreSQL container. The new guard rejects reserved names or ports held by resources without our labels. The legacy container is reported but ignored.

Rejected: keeping a separate intake PostgreSQL, which contradicts the request, and moving InvenTree onto `bench-intake-dev-pg`, which is the earlier README idea and the opposite of what was asked.

Accepted trade-off: intake dev data in the legacy container is not carried over. Dev databases are already generated per app and disposable, and `AGENTS.md` forbids migrating real local data as part of tooling work.

### `local-inventree` target profile

`developmentTarget` gains `{ kind: 'local-inventree' }`. Its origin is the fixed `http://127.0.0.1:4320` and its credential reference is the fixed `local_inventree_dev`. The namespace digest also covers the `instance_id` generated in `inventree-dev.json`. A reset regenerates that ID, so captures that refer to Part PKs of a wiped instance never carry over. The read key comes from `inventree-dev.json` instead of `INTAKE_DEV_API_KEY`.

For reads, it behaves like `read-only`:

- the API process gets `INTAKE_READ_ORIGIN=http://127.0.0.1:4320`, `INTAKE_CREDENTIAL_REF=local_inventree_dev` and the read key in its environment, so `config.ts` reports `configured`. The supervisor builds that environment from the v3 state and never reads `runnerConfig`, which only v1 state has. It sets these values only on the API child. The setup child receives only the profile and derives the origin and reference itself through `developmentTarget`, so AC8 never trips on the supervisor's own values;
- the app state binding accepts the new kind, as version 3 state alongside the existing fake v1 and read-only v2, with its own state check;
- the target uses the protected-read-only transport, with no apply or fake inventory;
- it gets its own state namespace, `local-inventree-<digest>`.

`up`, `seed` and `reset` take a private `inventree-dev.lock` in the state directory, so concurrent runs cannot race the token re-issue or the seed lookup-then-create step. `tooling/dev.cjs` runs `pnpm inventree:dev up` before it resolves the state root and takes the lock when this profile is selected, because the namespace digest needs `instance_id` from `inventree-dev.json`, which `up` creates. It reads the key from state only after that, so today's early `developmentCredential` call moves after the stack start for this profile. Once it holds `supervisor.lock`, it re-reads the instance and refuses with `local_inventree_changed_during_startup` if a reset intervened. Every child gets the supervisor's resolved `INTAKE_DEV_STATE` and `INTAKE_ENV_FILE=''`. Ctrl-C stops the app processes but leaves the stack running, in the same way PostgreSQL is preserved today.

Rejected: reusing `read-only` with a documented `.env` block. That needs manual token copying, cannot start the stack, and conflicts with the requirement that `pnpm dev` spins it up.

## State, authority and failure behavior

```text
pnpm dev ──(any profile)──▶ dev-services start ──▶ compose up --wait inventree-db ──▶ intake roles/DBs
        └─(local-inventree)─▶ inventree:dev up ──▶ init (migrate, static, bootstrap) ─▶ server+worker healthy
                                               └─▶ seed (invimport sync, fixtures) ─▶ state: tokens
```

- **State files.** `~/.local/state/bench-intake/inventree-dev.json` holds the stack version, the image digest, generated secrets and tokens. `inventree-db.json` holds the shared server's superuser and the intake role secrets. The private `.env` files for Compose sit beside them. `INTAKE_DEV_STATE` overrides the directory. The existing private-state checks apply: 0700 directory, 0600 files, and symlinked, oversized or malformed files are refused.
- **Failure handling.** `up` fails with a stable error code if any of these happens:
  - an `inventree-init` exit that isn't 0;
  - an `inventree-init` that has not exited within its own timeout. That timeout is 600 s on the first run on a fresh database and 120 s later, and task 2.1 measures it on this machine;
  - a server or worker health timeout of 60 s, which starts only after init has exited 0;
  - a seeding error.

  When it fails, it prints the last lines of the failing service's log, with secrets redacted. It leaves the database, server and worker containers and the volumes in place for diagnosis, but always removes `inventree-init` (see bootstrap). A re-run is safe because every step is idempotent.
- **Authority.** The intake app only reads. The importer write token is shown only by `credentials` and `env`, both explicit opt-ins. The seeding child runs `invimport` with `--env-file /dev/null`, which always exists and is always empty, so it never loads the root `.env` InvenTree credentials of the protected server. It also never falls back to username and password.
- **Image changes.** A new digest in the Compose file re-runs `inventree-init`, which applies migrations, on the next `up`. The old server and worker are stopped first, and init gets the first-run timeout. Downgrades are unsupported, and `reset --yes` recovers from them.

## Verification strategy

| Check | Boundary established |
| --- | --- |
| Unit tests for `developmentTarget` and credentials, covering the profile, conflicts and the state-sourced key (AC8) | Target selection |
| Fake-docker tooling tests for `dev-services` in `intake-server/tests/tooling.test.ts`, run by the intake-server suite, and for the lifecycle CLI in a new `tooling/tests/inventree-dev.test.cjs` added to `test:dev`. Both use the existing fake docker pattern. They cover Compose argv, label and ownership refusals, the legacy container ignored, reset scope and `--yes`, and no secrets in argv (AC4, AC6, AC7) | Docker command contract, without Docker |
| Fixture loader tests in `tooling/tests/inventree-dev-seed.test.cjs`, added to `test:dev`, against a fake REST server: lookup by seed key, no duplicates on re-run, records it did not seed are left alone (AC3) | Seeding idempotency |
| `pnpm test`, `pnpm test:dev`, `pnpm lint`, typecheck, and ruff over `tooling/inventree-dev/scripts/`, added to `lint:backend` and to the ruff path list in `.github/workflows/lint.yml`. `.github/scripts/ci_paths.py` selects the intake job for `tooling/inventree-dev/` and `tooling/tests/inventree-dev`, and backend lint for `.py` files under `tooling/inventree-dev/scripts/`, with cases in `test_ci_paths.py` | Repository suites |
| Local process tier `pnpm db:intake test` and `test:process` on the new server | PG17 tooling on the shared server; these tiers are skipped in CI |
| Manual live run: `up` twice, the API, token and UI checks, seed counts, `pnpm dev` under both profiles, and the peak `pg_stat_activity` count for the `inventree` role against its limit of 20 during seeding and UI use (AC1, AC2, AC3, AC5), recorded in the handover | Real InvenTree 1.5.0 on this machine |

Fake-docker tests show only the command contract. The live run on one arm64 machine is the evidence for real InvenTree behaviour.

## Migration, rollout and recovery

- **Legacy container.** After this change, the first `pnpm dev` creates `inventree-db` and, through the server-scoped default namespace, a fresh intake app. The legacy `bench-intake-dev-pg` container, its volume, `postgres.json` and the old `app` state directory stay as they are. Docs describe how to remove them manually, and the tooling never deletes them. An explicit `INTAKE_APP_STATE` pointing at an old namespace gets `development_state_server_changed`.
- **Rollback.** Revert the commit. The legacy container is untouched and resumes.
- **Reset.** `pnpm inventree:dev reset --yes` resets InvenTree only, and refuses while a live supervisor holds a `local-inventree-*` namespace. It stops and removes `inventree-server`, `inventree-worker` and `inventree-init`, then runs `DROP DATABASE inventree WITH (FORCE)` and drops the role. It removes the `bench-inventree-dev-data` volume and the `inventree-dev.json`, `inventree.env` and `inventree-init.env` files, then brings the stack back up. The intake databases and app namespaces survive. A separate `reset --yes --database-server` scans the state directory (`INTAKE_DEV_STATE` or `~/.local/state/bench-intake`) and the default namespace roots under `~/.local/state/bench-intake` for `supervisor.lock` files whose process is alive or unreadable, names them, and refuses if it finds one. It also refuses when `INTAKE_APP_STATE` is set. Neither reset can discover namespaces at other explicit paths; the docs say so. Otherwise it stops and removes `inventree-db` as well, then removes the `bench-inventree-dev-db` volume and the `inventree-db.json` and `inventree-db.env` files, which wipes every intake dev database. It never touches `postgres.json`.

## Risks and open decisions

- **Whitenoise without Caddy.** It may not serve the React frontend at `/web/`. Mitigation: verify in task 2, with Caddy as the fallback.
- **Memory on small machines.** The stack's memory may squeeze them. Mitigation: two gunicorn workers and one background worker, with limits set in the Compose file.
- **Pinned image is arm64.** A pull by digest on x86 resolves the multi-arch index digest. This has not been verified off this machine.
- **App state on the old server.** Explicit `INTAKE_APP_STATE` namespaces bound to the legacy server are refused with a stable code. The developer chooses a fresh one; nothing is migrated automatically.

No open user decisions remain. The assumptions are listed in the proposal.
