# Local development InvenTree planning

## Scope and current state

This PR is planning only. It adds the `local-inventree-dev` OpenSpec change (proposal, design and tasks, with `skip_specs: true`) and index entry [BI-009](../PLANNED_FUNCTIONALITY.md#bi-009--local-development-inventree). It changes no code, Docker resource or local data.

The user asked for implementation to follow in a separate PR after this one merges. That is bundle PR-B in [tasks.md](../../openspec/changes/local-inventree-dev/tasks.md).

## User request

- **Ready local InvenTree.** One way to start a full local InvenTree for development and testing, extending or configuring the local base image `sha256:49b5d7a6…`. It should come up ready, with credentials and API tokens the app can use.
- **Preseeding.** A way to preseed it with test data.
- **Shared database.** The app uses the InvenTree stack's own PostgreSQL (`inventree-db`) instead of the dedicated database container.
- **`pnpm dev`.** It starts the stack when the env profile points at the local instance.

## Decisions and assumptions

Each is recorded in the proposal and design.

- **Configured stack, no derived image.** An owned Compose project adapted from upstream, with scripts mounted read-only into the pinned image. Nothing can be baked into an image safely, since secrets and migrations are per machine.
- **Database moves for every profile.** `inventree-db` hosts the intake databases under every profile, on new port 55433. The legacy `bench-intake-dev-pg` container, volume and state are left untouched, as `AGENTS.md` requires.
- **Read-only profile.** `INTAKE_TARGET_PROFILE=local-inventree` is read-only from the app's side. Intake mutations against InvenTree stay unsupported. The importer gets a write token.
- **Config-driven seeding.** Seeding reuses `invimport parameters --write` and `categories --write`, plus a seed-keyed REST fixture. InvenTree's demo dataset is not the default.

## Evidence gathered

All checked on 2026-11-06.

- **Base image.** Inspected with throwaway `docker run --rm` containers: `inventree/inventree:stable`, repository digest `sha256:36027b18…`, arm64, InvenTree 1.5.0, API 530, commit `6a6736b`, whitenoise, PostgreSQL 17.10 client, and the env admin creation in `InvenTree/apps.py`.
- **Upstream Compose.** The `inventree-db` service runs `postgres:17`. Also read: the env conventions, first-run steps and the token endpoint, from the upstream Compose file, `.env` and docs linked in the proposal.
- **Local Docker state.** Only `bench-intake-dev-pg` is running, on 55432. There are no Compose projects.

## Review

- **Round 1** (fresh read-only Claude reviewer, `5fc3c7c`) found five Important, five Minor and one Nitpick issue. All were fixed:
  - a separate `inventree-db.json`, leaving the legacy `postgres.json` untouched;
  - AC8 scoped to user-supplied settings, with the setup child deriving the target and a v3 state binding;
  - seeding isolated from the root `.env`;
  - an explicit owner for the `inventree` role and database;
  - the task 3 → 4 dependency for AC5;
  - volume names and labels, and a distinct container name;
  - a connection budget;
  - no `docker inspect` or `compose config` output;
  - the docs list aligned;
  - the `config.ts` change dropped;
  - the identity module renamed.
- **Round 2** (fresh reviewer, `79d6790`) found four Important, six Minor and one Nitpick issue. All were fixed:
  - server-scoped app state namespaces, with `development_state_server_changed`;
  - the connection budget recomputed from the real role limits, with `max_connections=120` and the server-level increase stated;
  - `reset` scoped to InvenTree, with `--database-server` for wiping the database volume;
  - optional, interpolated Compose env files;
  - `setup.ts` and `run-media-pg.cjs` reading `inventree-db.json`;
  - Django-shell token checks, and a handoff through the init container's `/tmp`;
  - the key read after the stack starts;
  - `REVOKE CONNECT` on the `inventree` database;
  - new tests added to `test:dev`;
  - ruff over the tooling scripts.
- **Round 3** (fresh reviewer, `b930096`) found two Important and six Minor issues. All were fixed:
  - the server identity resolved before the state root and lock, including on the `INTAKE_DEV_ADMIN_URL` path;
  - the API child env for `local-inventree` stated explicitly;
  - a reset `instance_id` in the local namespace;
  - a separate init-only env file for the admin password and tokens;
  - `up --wait` with a one-shot service, and `compose cp` to a path, added to proof of fit;
  - a stable refusal for a volume without state, with shared env loading;
  - reset stopping services before a forced drop;
  - metadata on create confirmed, with a natural-key fallback.
- **Round 4** (fresh reviewer, `5a26e02`) found one Important and four Minor issues. All were fixed:
  - only the docker-aware `start` creates the server identity, after its volume check;
  - `up` runs `dev-services start` first, and `local-inventree` with `INTAKE_DEV_ADMIN_URL` is refused;
  - a live check of the `inventree` role's connection peak;
  - `inventree-init` always removed;
  - the full reset file scope.
- **Round 5** (fresh reviewer, `2c1559a`) found one Important and four Minor issues. All were fixed:
  - CI path selection for the new tooling paths;
  - `local-inventree` running `up` before the state root and lock;
  - `--database-server` reset refusing while a lock is held and stopping `inventree-db` before removing its volume;
  - all generated env files optional;
  - single-checkout ownership of the stack.
- **Round 6** (fresh reviewer, `4adc768`) found one Important and three Minor issues. All were fixed:
  - `inventree-db` shared across worktrees with a drift refusal, and checkout ownership limited to the InvenTree services;
  - an `inventree-dev.lock` for `up`, `seed` and `reset`;
  - named directories for the database-server reset lock scan;
  - this validation record.
- **Round 7** (fresh reviewer, `0995330`) found no Critical or Important issues and two Minor ones. Both were fixed:
  - the CI ruff step in `lint.yml` now covers the new scripts;
  - AC8's wording on child environments now matches the design.
- **Round 8** (fresh reviewer, `46c9ded`) found no Critical or Important issues and three Minor ones. All were fixed:
  - a PID limit of 256, checked for drift;
  - Compose 2.24 or later in the BI-009 prerequisites;
  - a separate, measured timeout for `inventree-init`.
- **Round 9** (fresh reviewer, `dc8b877`) found no Critical or Important issues, three Minor ones and an optional point. All were addressed:
  - a post-sync seeding completeness check;
  - `backend/config/` changes selecting the intake CI job;
  - `setup.ts` and `readonly-setup.ts` named in task 4;
  - a bridge-network decision replacing the README's internal-network suggestion.
- **Round 10** (fresh reviewer, `e4e7e88`) reported no findings. It flagged one optional Minor: the proposal's impact list omits a few files that also reference port 55432. That needed no action, because task 1.1's `rg` sweep and task 4 cover them. Since then the planning commit has changed only to add this review record.

## Validation

- `openspec validate local-inventree-dev --strict` reports the change valid, with `skip_specs` and zero deltas.
- `openspec status --change local-inventree-dev` reports every planning artifact complete, with specs skipped.
- `pnpm lint`, including the Markdown lint, passes on each amended planning commit.
