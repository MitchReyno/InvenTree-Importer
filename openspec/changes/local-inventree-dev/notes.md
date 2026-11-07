# Implementation notes

Tasks 1–5 were delivered in one PR, PR-B ([#105](https://github.com/MitchReyno/InvenTree-Importer/pull/105)), after the planning PR ([#103](https://github.com/MitchReyno/InvenTree-Importer/pull/103)), and [BI-009](../../../docs/PLANNED_FUNCTIONALITY.md#bi-009--local-development-inventree) is Done. Archiving the change is a separate step.

## Changes to the plan

- **2026-11-06, planning (#103):** Planning review reshaped the first design before implementation. It added the separate `inventree-db.json` so the legacy `postgres.json` is never touched, server-scoped app namespaces, an InvenTree-only `reset` with `--database-server` for the database volume, a database server shared across worktrees with a drift refusal and single-checkout ownership of the InvenTree services only, `inventree-dev.lock`, a separate init-only env file, and a post-sync seeding completeness check. The [design](design.md) and [tasks](tasks.md) carry the result.
- **2026-11-06, task 1 (PR-B):** The identity module is `intake-server/src/dev/pg-identity.ts`, not `scripts/dev-pg-identity.cjs`. Erasable TypeScript loads in the `.cjs` scripts through Node type stripping and in the TypeScript setup and tests. Design and tasks were updated.
- **2026-11-06, task 2 (PR-B):** `inventree-init` runs explicitly with `compose up --no-deps --exit-code-from inventree-init`, and the server and worker then start with `--no-deps --wait`. This replaces the `service_completed_successfully` dependency the proof of fit was to check: the explicit run returns init's exit code directly, and starting the server can never recreate the shared `inventree-db`. Design updated.
- **2026-11-06, task 3 (PR-B):** The importer runs with `--env-file /dev/null` instead of a generated empty private file, because it always exists and is always empty. Design and tasks updated.
- **2026-11-06, task 3 (PR-B):** API 530 has no `metadata` field on create. The loader creates the record, then tags it through `/api/metadata/<model>/<pk>/` (the old `/api/<model>/<pk>/metadata/` path redirects there), with the natural-key fallback the design allowed for. Design updated.
- **2026-11-06, tasks 2 and 4 (PR-B):** Implementation review changed the design in these places, each now in the design: an image upgrade stops the old server and worker before init migrates and gives init the first-run timeout, as does a newly created `inventree` database; the CLI's superuser connection always uses the shared server, never `INTAKE_DEV_ADMIN_URL`; a re-created server under existing state gets a new `server_id` with the secrets kept; a plain `reset --yes` refuses while a live `local-inventree` supervisor uses the instance; every child of `pnpm dev` gets the resolved `INTAKE_DEV_STATE` and `INTAKE_ENV_FILE=''`; and the supervisor re-checks the instance under its lock, refusing with `local_inventree_changed_during_startup`.

## Unexpected challenges

- **2026-11-06, task 2.1:** The first proof-of-fit init failed because users had no `UserProfile`. InvenTree skips profile creation under `manage.py shell`, which it treats as a read-only command. `bootstrap.py` now creates each user's profile itself.
- **2026-11-06, task 3.5:** The first live `up` failed at tagging a stock item, because a stock create answers with a list of created items. The loader now accepts the list. The untagged item left behind was adopted on the next run, which exercised the interrupted create-then-tag path live.
- **2026-11-06, task 1.5:** The local PostgreSQL tier fails and then stalls in `tests/pg/processing-suggestions.test.ts` when `INTAKE_MEDIA_DECODER_IMAGE` is not set ("Explicit immutable decoder image is required"). Run the tiers with it set from `build-media-image.cjs`.

## Decisions made during implementation

- **2026-11-06, task 2.1:** Whitenoise serves `/web/` and its assets without a proxy, so the Caddy fallback was not needed. First init on a fresh database took 74 s and a re-run 40 s, so the planned 600 s and 120 s timeouts were kept.
- **2026-11-06, task 2:** `intake-reader` gets view permission on every ruleset, and `intake-writer` view, add, change and delete on every ruleset except admin, and is a staff user. Each user's token is named `bench-intake-dev` and is reused while the stored key matches and has not expired or been revoked.
- **2026-11-06, task 2:** The CLI is a thin `cli.cjs` over `lib.cjs`, with Docker, SQL and seeding injected so the lifecycle is tested without a daemon. `env` prints `export` lines, so `eval "$(pnpm --silent inventree:dev env)"` sets the importer variables.
- **2026-11-06, task 2:** `inventree-dev.lock` is created atomically with `link()` and a nonce. An empty or unreadable lock counts as held, a dead holder's lock is renamed aside and re-checked before it is replaced, a newer lock found in the gap is restored with `link()`, and a run releases only its own lock. If a third run locked in the gap, the moved lock is kept and the run stops with `inventree_dev_lock_contended`.
- **2026-11-06, task 3.1:** The fixture holds 3 stock locations, 3 companies, 4 parts with manufacturer and supplier parts, and 4 stock items. Top-level fixture locations match only unparented locations when adopting untagged records.
- **2026-11-06, task 4:** `tooling/dev/stack.cjs` orders server start, identity, instance and state root before the supervisor lock and builds the API child's target env. The whole startup sequence is one tested `startSupervision` helper that `tooling/dev.cjs` calls, so dropping a step fails a test.
- **2026-11-06, task 2.3.2:** `ci_paths.py` also selects the intake job for `backend/config/` changes, because the fixture test depends on that config.

## Open items

- Live evidence comes from one arm64 macOS machine. Pulling the pinned digest on x86 is unverified.
- The intake app does not write to the local instance. Making it an owned, disposable write target is a follow-up change ([proposal](proposal.md)); the importer can write with the writer token meanwhile.
- Token reuse compares the stored key, expiry and revocation in the database and does not call the API. From InvenTree 1.6 token secrets are not stored, so an image upgrade must re-issue tokens.
- Neither reset can discover app namespaces at arbitrary explicit `INTAKE_APP_STATE` paths.
- A three-way race of simultaneous `up`, `seed` or `reset` runs can still leave the original holder's lock moved aside. It is reported, not hidden.
- The docs write the fake namespace as `app-<server id>`, while the code uses the first 16 hex characters of the server ID.
- The four media sandbox probes in the process tier were skipped, because they need a separate `INTAKE_MEDIA_PROBE_IMAGE`; they are untested on the new server.
