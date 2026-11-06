# Change proposal

## Problem and intended outcome

Developers have no real InvenTree to run Bench Intake or the `invimport` importer against locally. `pnpm dev` offers only the fake inventory or a read-only external server, so testing against real InvenTree behaviour means pointing at a server that holds real stock. Setting up a local instance by hand means working out compose services, first-run migrations, admin accounts, API tokens and test data each time.

The requested outcome:

- **One command** brings up a full local InvenTree in a ready state, with credentials and API tokens the app can use.
- **Preseeded test data** that matches the importer's configured categories and parameters.
- **One database server.** The intake app keeps its databases on the InvenTree stack's own PostgreSQL (`inventree-db`) instead of the separate `bench-intake-dev-pg` container.
- **Automatic startup.** `pnpm dev` starts that InvenTree when the env profile selects the local instance.

## Change identity and linked items

- Change name: `local-inventree-dev`. Branches and commit/PR subjects use it, for example `feat(local-inventree-dev): ...`.
- Index item: [BI-009 — Local development InvenTree](../../../docs/PLANNED_FUNCTIONALITY.md#bi-009--local-development-inventree). The index owns its current status, priority, size and prerequisites.

## Current behavior and evidence

- **`pnpm dev`** (`tooling/dev.cjs`) runs `intake-server/scripts/dev-services.cjs start`. That creates or reuses a plain `docker run` container, `bench-intake-dev-pg` (`postgres:17`, `127.0.0.1:55432`, volume `bench-intake-dev-pg-data`, label `bench-intake.owner=T01`). Its generated secrets live in `~/.local/state/bench-intake/postgres.json`.
- **Second PostgreSQL refused.** The service refuses to create its container when any other PostgreSQL container exists (`existing_postgres_request_ledger_allocation_before_creating`). An InvenTree database container would therefore block it today.
- **Hard-coded port and container name.** Port `55432` and the container name also appear in `intake-server/src/dev/setup.ts`, `intake-server/scripts/run-media-pg.cjs` and `intake-server/tests/support/pg-tools.ts`. The PostgreSQL and process tiers use `docker exec` into that container for PG17 dump/restore tools.
- **Profiles.** `INTAKE_TARGET_PROFILE` accepts `fake` (the default) or `read-only` (`intake-server/src/dev/target.ts`).
  - `read-only` needs an external origin, a credential reference and a key, all supplied through env.
  - There is no local-instance profile and no Compose project in the repository.
  - `intake-server/README.md` already earmarks loopback port 4320 for a future local InvenTree, but nothing is allocated or running.
- **Local base image.** The image the user named, image ID `sha256:49b5d7a6…`, is `inventree/inventree:stable`, repository digest `sha256:36027b18…`.
  - It is arm64, InvenTree 1.5.0, API 530, commit `6a6736b`.
  - Its entrypoint is `init.sh` followed by gunicorn on port 8000.
  - Whitenoise serves its static files, and it ships PostgreSQL 17.10 client tools.
  - It creates a superuser from `INVENTREE_ADMIN_USER`, `INVENTREE_ADMIN_EMAIL` and `INVENTREE_ADMIN_PASSWORD`.
  - All of this was inspected by running throwaway containers on 2026-11-06.
- **Existing importer commands.** `invimport parameters --write` (which creates custom units first) and `invimport categories --write` (in `backend/src/invimport/commands/`) already make an InvenTree server match `backend/config/`. They are idempotent and never delete.

## Scope and non-goals

In scope:

- **Compose project.** A repository-owned `bench-inventree-dev` Compose project with `inventree-db` (PostgreSQL 17), `inventree-server`, `inventree-worker` and a one-shot `inventree-init`, pinned to the inspected base image digest.
- **Lifecycle command.** A root `pnpm inventree:dev` command that brings the stack up and down, reports status, re-runs bootstrap and seeding, and prints the importer env exports for the local instance. It also has a reset that requires confirmation.
- **Ready state.** Generated, machine-private credentials:
  - a database superuser;
  - an InvenTree database role;
  - the Django secret key and an admin user;
  - a read-only and a read-write API user, each with a token.

  These are stored under the existing private state directory. Nothing secret is committed.
- **Deterministic seeding.**
  - Units, parameter templates and categories come from `backend/config/` through the existing `invimport` commands.
  - A small repository fixture adds stock locations, companies, parts and stock over the REST API.
- **Shared database.** The intake app's dev PostgreSQL moves onto `inventree-db` for every target profile. `pnpm dev` starts at least that service. Intake keeps its existing role and database layout, grants and per-role connection limits. The server-level limits rise to host InvenTree too. Port and container name come from one place, and app state namespaces are scoped to the server.
- **New profile.** `INTAKE_TARGET_PROFILE=local-inventree` makes `pnpm dev` start the full stack, wait until it is healthy and bootstrapped, then bind the API's read transport to `http://127.0.0.1:4320`. The read token comes from private state rather than env.
- **Documentation.** Updates to the service ledger, docs and handover.

Non-goals:

- **Intake mutations against InvenTree.** No mutation from the intake app to the local instance. Apply and effects stay fake-only, as recorded in `ARCHITECTURE.md`. The importer can write to the instance with the read-write token for manual testing.
- **Old local data.** No migration, copying or deletion of the existing `bench-intake-dev-pg` container, volume or state. Per `AGENTS.md`, it is left in place and documented for manual removal.
- **InvenTree's public demo dataset.** It is not loaded by default. It is generic, needs network access, and replaces all data.
- **Production-like stack.** No Caddy proxy, Redis cache, TLS or plugins.
- **CI.** No CI job starts this stack. The PostgreSQL and process tiers stay local-only, as merged in #99.

## Reuse and dependency assessment

The existing repository already provides the shape: dev tooling runs Docker through `execFileSync`, the base image is local, and the `invimport` sync commands seed configuration. No new npm or Python dependency is needed.

| Option and relevant version | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence and date checked | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| Adapt InvenTree's official `contrib/container/docker-compose.yml` (stable) with our own Compose file and bootstrap scripts mounted read-only (**recommended**) | Upstream service names (`inventree-db` is the database service and container), `postgres:17`, and its env conventions (`INVENTREE_DB_*`, `INVENTREE_ADMIN_*`, `INVENTREE_SITE_URL`). Uses the unchanged base image, so no build step. Scripts change without rebuilding. | Our own Compose file must track upstream env conventions when the pinned image is upgraded. Drops Caddy and Redis, which upstream uses in production. | [docker-compose.yml](https://raw.githubusercontent.com/inventree/InvenTree/stable/contrib/container/docker-compose.yml), [.env](https://raw.githubusercontent.com/inventree/InvenTree/stable/contrib/container/.env), [Docker install](https://docs.inventree.org/en/stable/start/docker_install/), checked 2026-11-06. Image inspected locally 2026-11-06. | Whitenoise serving the UI without Caddy, and token creation through the Django shell on 1.5.0, are proven during implementation (task 2). |
| Derived image (`FROM inventree/inventree@sha256:36027b18…` plus scripts) | A self-contained "ready" image | Adds a build and rebuild to `pnpm dev`. Readiness still needs runtime migrations and per-machine secrets, so the image cannot be fully ready. Two images to keep in step. | Same sources | Rejected: no state can be baked in safely, so it adds a build without benefit. |
| Use upstream compose unchanged | Least custom configuration | Publishes ports 80/443 on all interfaces, uses placeholder credentials, and runs services we don't need. Superuser credentials remain in `.env`. | Same sources | Rejected: violates loopback-only and private-secret rules. |
| InvenTree demo dataset (`inventree/demo-dataset`, MIT) loaded with `invoke dev.setup-test -i` | Rich, realistic data | Not aligned with our categories and parameters. Clones over the network. Deletes all existing data. Not versioned per release. | [Demo docs](https://docs.inventree.org/en/stable/demo/), [demo-dataset](https://github.com/inventree/demo-dataset), checked 2026-11-06 | Possible later as an optional seed. Not a default. |
| Keep `bench-intake-dev-pg` separate | No changes to the database tooling | The user explicitly asked to share `inventree-db`. Two PostgreSQL servers double memory use and trip the existing refusal. | `dev-services.cjs` | Rejected by request. |

Recommendation: an owned Compose project adapted from upstream, mounted bootstrap and seed scripts, the existing `invimport` sync commands for configuration seeding, and one repository fixture for sample records. Custom code is limited to lifecycle and ownership checks, credential bootstrap, and fixture loading. Those enforce this repository's loopback, ownership and private-state rules, which no upstream tool covers.

## Capabilities

### New capabilities

None.

### Modified capabilities

None. This is development tooling. The product behaviour of the intake API, UI and importer is unchanged, so `.openspec.yaml` declares `skip_specs: true`. The acceptance criteria live in the design.

## Impact and dependencies

- **Root tooling:**
  - new `tooling/inventree-dev/`: Compose file, bootstrap, seed fixture and lifecycle CLI;
  - `tooling/dev.cjs` and its environment allowlist;
  - root `package.json`.
- **Intake server:**
  - `scripts/dev-services.cjs`, which moves onto the shared service;
  - `src/dev/target.ts`, `setup.ts` and `state.ts`, plus `run-media-pg.cjs` and `tests/support/pg-tools.ts`;
  - the tooling tests for dev services and the supervisor.
- **State:**
  - new private files `~/.local/state/bench-intake/inventree-db.json`, which holds the shared server's secrets, and `inventree-dev.json`, which holds the InvenTree secrets and tokens;
  - new Docker volumes `bench-inventree-dev-db` and `bench-inventree-dev-data`.

  The legacy `postgres.json`, container and volume are never read, rewritten or deleted. Intake dev databases on the new server start empty.
- **Docs:** `docs/development.md`, the `intake-server/README.md` service ledger, `intake-server/TESTING.md`, `.env.intake.example`, `ARCHITECTURE.md`, `intake-server/ARCHITECTURE.md`, and a handover under `docs/handovers/`.
- **External prerequisites:**
  - Docker with Compose v2;
  - the base image present locally or pullable by digest;
  - about 1.5 GiB of memory for the stack;
  - Compose 2.24 or later, for optional env files.

## Open decisions and assumptions

- **Assumption, sharing for every profile:** the intake database moves onto `inventree-db` for every profile, not only `local-inventree`. The request says "instead of the dedicated database image we currently use". For `fake` and `read-only` profiles, `pnpm dev` starts only the `inventree-db` service.
- **Assumption, new port:** the shared server publishes `127.0.0.1:55433`, a new port, so it can run while the legacy container still holds 55432.
- **Assumption, reads only:** the local profile is read-only from the intake app's side. Making the local instance an owned-disposable write target is a follow-up change.
- **Assumption, pinned image:** the stack is pinned to the repository digest of the named image. Upgrading it is a deliberate edit that re-runs bootstrap.
