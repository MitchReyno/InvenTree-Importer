# Local development InvenTree implementation

Maintained implementation handover for [`local-inventree-dev`](../../openspec/changes/local-inventree-dev/) ([BI-009](../PLANNED_FUNCTIONALITY.md#bi-009--local-development-inventree)). The planning record is the [planning handover](local-inventree-dev-planning.md).

## Authority and scope

The user asked for the planned change to be implemented with the OpenSpec apply skill in one PR (PR-B), merged once independent review is clean and CI is green. This PR covers tasks 1–5 of [tasks.md](../../openspec/changes/local-inventree-dev/tasks.md). It changes development tooling only. The intake API, UI, contracts and importer policy are unchanged, and the app still never writes to an inventory server.

## What was built

- **Compose stack** in `tooling/inventree-dev/compose.yaml`, project `bench-inventree-dev`:
  - `inventree-db` (`postgres:17`, container `bench-inventree-dev-db`, `127.0.0.1:55433`);
  - a one-shot `inventree-init`;
  - `inventree-server` (`127.0.0.1:4320`) and `inventree-worker`, pinned to `inventree/inventree@sha256:36027b18…` (image ID `49b5d7a6…`).

  Volumes and services carry `bench-intake.owner=inventree-dev`.
- **Bootstrap** (`scripts/bootstrap.py`, run in the Django shell): the admin superuser, `intake-reader` (view on every ruleset) and `intake-writer` (view/add/change/delete except admin, staff). Each user gets a token named `bench-intake-dev`, which is reused while it matches and has not expired.
- **Lifecycle CLI** (`tooling/inventree-dev/cli.cjs` over `lib.cjs`, root `pnpm inventree:dev`): `up`, `seed`, `down`, `status`, `credentials`, `env` and `reset --yes [--database-server]`. Docker, SQL and seeding are injected, so `lib.cjs` is tested without a daemon.
- **Seeding** (`seed.cjs`, `scripts/seed_check.py`, `seed/fixtures.json`):
  - `invimport parameters --write` and `categories --write` run with `--env-file /dev/null` and a scrubbed environment;
  - a dry-run completeness check follows;
  - a REST loader keyed by `metadata.bench_intake_seed` loads 3 locations, 3 companies, 4 parts with manufacturer and supplier parts, and 4 stock items.
- **Shared database for every profile** (`intake-server/src/dev/pg-identity.ts`, `docker-cli.ts`, `scripts/dev-services.cjs`):
  - `dev-services start` creates private `inventree-db.json`/`inventree-db.env`;
  - it refuses unowned names or ports, state missing for an existing volume, and drift;
  - it runs `compose up --no-recreate --wait inventree-db`, then provisions the intake roles as before.

  `setup.ts`, `run-media-pg.cjs` and the PG17 test tools use the same identity. App state records `serverId`, and default namespaces are scoped to it.
- **`local-inventree` profile**:
  - the target is fixed to `http://127.0.0.1:4320` / `local_inventree_dev`, and conflicting settings are refused;
  - version 3 app state is bound to the instance ID;
  - `tooling/dev/stack.cjs` orders server start, identity, instance and state root before the supervisor lock, and builds the API child's target env.
- **CI and lint**: `ci_paths.py` selects the intake job for `tooling/inventree-dev/`, `tooling/tests/inventree-dev*` and `backend/config/`, and backend lint for the tooling Python. Ruff covers `tooling/inventree-dev/scripts` in `lint:backend` and `lint.yml`. `test:dev` runs the new tooling tests.

## Decisions and adjustments during implementation

Routine corrections, reconciled into the design and tasks:

- **Identity module location.** The identity module is `intake-server/src/dev/pg-identity.ts`, not `scripts/dev-pg-identity.cjs`. Erasable TypeScript loads in both the `.cjs` scripts (Node type stripping, as `dev-services.cjs` already did for grants) and the TypeScript setup and tests.
- **Explicit init run.** `inventree-init` runs explicitly with `compose up --no-deps --exit-code-from inventree-init`. The server and worker then start with `--no-deps --wait`, and no service depends on init or the database. This replaces the `service_completed_successfully` dependency the proof of fit was asked to check. The explicit run returns init's exit code directly, and a plain server start can never recreate the shared `inventree-db`.
- **Empty env file.** The importer runs with `--env-file /dev/null` instead of a generated empty private file. It always exists and is always empty, so the root `.env` is never read.
- **Metadata path.** API 530 has no `metadata` create field. Tags go to `/api/metadata/<model>/<pk>/`; the old `/api/<model>/<pk>/metadata/` path redirects there.
- **Stock create response.** A stock create answers with a list of created items, and the loader accepts that. The first live run failed on this exactly. The untagged stock item it left was adopted on the next run, which exercised the interrupted create-then-tag path live.
- **`env` output.** `env` prints `export` lines, so `eval "$(pnpm --silent inventree:dev env)"` sets the importer variables.
- **Missing profiles.** `bootstrap.py` creates each user's `UserProfile` itself. InvenTree skips profile creation under `manage.py shell` (it counts as a read-only command), which made the first proof-of-fit init fail.

## Proof of fit (task 2.1)

Checked on 2026-11-06 with Docker Compose v5.6.1 on arm64, in a throwaway project `bench-pof` on ports 55499/4399, which was removed afterwards:

- **Optional env files:** `env_file` with `required: false` and `${BENCH_INVENTREE_DEV_STATE:?}` interpolation works. The database came up with only `inventree-db.env` present.
- **Init timing:** first init (migrate, static, bootstrap) on a fresh database took 74 s; a re-run took 40 s. The timeouts of 600 s and 120 s keep that margin.
- **Token handoff:** `compose cp` from the exited init container to a host path works and keeps mode 0600. Stored tokens passed back in are reused byte for byte.
- **Server start:** server and worker were healthy 7 s after `up -d --no-deps --wait`.
- **API and permissions:** API 530 / 1.5.0. Reader `POST /api/part/` returns 403 and writer returns 201. Whitenoise serves `/web/` and its assets without a proxy.

## Verification

- **Tests:**
  - `pnpm test:dev`: 38/38 (stack ordering, lifecycle CLI and seeding included);
  - `pnpm --filter @invimport/intake-server test`: 203/203;
  - `python3 -m unittest discover -s .github/scripts -p 'test_*.py'`: 22/22;
  - `pnpm --filter @invimport/intake-server typecheck`, `pnpm lint` and `pnpm lint:backend` are clean.
- **Order of writing.** Tests for each slice were written before the code. For `dev-services`, identity, target, state and stack ordering, the first runs failed for the intended reasons: missing modules, the old `docker run` path, `unsupported_development_target`. The CLI and seed tests were first run only after their modules existed. Mutations were used to show those tests catch real faults; each was restored from a pre-mutation copy:
  - disabled redaction;
  - the admin password in the server env;
  - skipping init removal;
  - always-create instead of lookup;
  - no environment scrub;
  - no up-front category check.

  Each failed at least one test. The category-check mutation initially survived, and the test was tightened to require that nothing is created.
- **Live shared database** (task 1.5):
  - `pnpm db:intake start` created `bench-inventree-dev-db` healthy on 55433;
  - a second start reused the same container ID, so the drift check accepts the real inspected limits;
  - the legacy `bench-intake-dev-pg` kept running, and `postgres.json` kept its checksum.
- **Local tiers on the new server** (task 1.5). Both were run with `INTAKE_MEDIA_DECODER_IMAGE` set from `build-media-image.cjs`:
  - `pnpm db:intake test` passed 193/193 in 678 s;
  - `pnpm db:intake test:process` passed 66/70 with 0 failed. The 4 skipped tests are the media sandbox probes, which need a separate test-only `INTAKE_MEDIA_PROBE_IMAGE` and are environment-gated, not passed.

  A first PostgreSQL-tier attempt was launched without a decoder image. Five tests in `tests/pg/processing-suggestions.test.ts` and one inbox test failed on "Explicit immutable decoder image is required", and that file then stalled until it was stopped. The rerun with the image passed.
- **AC4, `pnpm dev` with the fake profile:**
  - the app became ready and its bootstrap status was `configured`;
  - a fresh `app-65f93d149d99e499` namespace was created with `serverId` and URLs on port 55433, and the old `app` directory was left as it was;
  - the legacy container's ID and start time, and `postgres.json`'s checksum, were unchanged.
- **AC5, `pnpm dev` with `INTAKE_TARGET_PROFILE=local-inventree`:**
  - the supervisor ran `inventree:dev up`, picked `local-inventree-db4aa7af…` and reported target `local-inventree`;
  - bootstrap returned `configured` with `mutation_enabled: false`;
  - a Capture observation of part `"1"` returned 201 with label `SEED358 dual op-amp`, read from the local instance;
  - no token appeared in the supervisor output.
- **Live stack** (tasks 2.5 and 3.5):
  - the first `up` took 115 s and failed at the stock tag, as described above;
  - the next two `up` runs took 52 s and 50 s;
  - seeding found 110 categories, 158 templates and 1 unit complete;
  - fixtures: 3 created, 18 existing, 1 adopted, then 0 created and 22 existing;
  - API 530 / 1.5.0, admin basic auth 200, `/web/` 200;
  - both tokens return 200 on `/api/user/me/`, reader create 403, writer create 201 (the check part was deleted);
  - no token or password appears in any `up` output;
  - state files 0600 and no handoff directory left behind;
  - peak `inventree` role connections during a `seed` run: 5 of 20.

## Limitations

- **One machine.** Live evidence is from one arm64 macOS machine. An x86 pull of the pinned digest is unverified.
- **No intake writes.** Intake mutations against the local instance are not supported. The importer can write with the writer token.
- **Unvalidated tokens.** The token reuse check compares the stored key, expiry and revocation in the database. It does not call the API.
- **Undiscoverable namespaces.** `reset --database-server` cannot discover app namespaces at arbitrary explicit `INTAKE_APP_STATE` paths.

## Review

- **Round 1** (fresh read-only Claude reviewer, `9f11704`) found two Important, five Minor and one Nitpick issue. All were fixed test-first, each new regression failing before its fix:
  - the CLI's superuser connection now always uses the shared server (`sharedServerAdmin`), never `INTAKE_DEV_ADMIN_URL`;
  - state from an older image digest is accepted and upgraded: init gets the first-run timeout, and the new digest is recorded after init succeeds;
  - the lock is created atomically by `link()` with a nonce. An empty or unreadable lock counts as held, a dead holder's lock is renamed aside and checked before it is replaced, and a run releases only its own lock;
  - `dev-services.cjs` and `run-media-pg.cjs` load the allowlisted root `.env` for `INTAKE_DEV_STATE`;
  - `dev-services identity` is implemented: Docker-free and read-only;
  - top-level fixture locations match only unparented locations, and the docs and test name state the adoption rule;
  - a test ties the drift check's `ALLOCATION` to `compose.yaml`;
  - leftover `handoff-*` directories are swept before init.

  After the fixes, `pnpm test:dev` passed 42/42 and the intake-server suite 207/207. A live `dev-services identity` and `up` (0 created, 22 existing) also passed.
- **Round 2** (fresh reviewer, `57f9c3c`) found one Important, four Minor and one Nitpick issue. All were fixed:
  - the stale-lock takeover retries when the lock vanishes instead of renaming, and restores a newer lock with `link()` so it never overwrites. A test hook injects a competing lock before and after the read;
  - `up` checks the data volume's label even when state exists;
  - a re-created server under existing state gets a new `server_id`, with the secrets kept;
  - an image upgrade stops the old server and worker before init migrates;
  - the held-lock test uses a live holder with a nonce. Dropping the liveness check now fails it;
  - the database reset ignores supervisor locks of dead processes and names live ones.
- **Round 3** (fresh reviewer, `8b4e548`) found no Critical or Important issues, two Minor ones and one Nitpick. It confirmed that the round-1 and round-2 fixes caused no regressions. Fixed:
  - a newly created `inventree` database (for example after the server is re-created) gets the first-run init timeout;
  - a plain `reset --yes` refuses while a live `local-inventree` supervisor uses the instance;
  - if a stale-lock takeover cannot restore a newer lock because a third run locked in the gap, the moved lock is kept and the run stops with `inventree_dev_lock_contended`.

  Accepted limit: that three-way race can still leave the original holder's lock moved aside. It needs three simultaneous `up`/`seed`/`reset` runs and is reported, not hidden.
- **Round 4** (fresh reviewer, `05a0529`) found no Critical or Important issues. It confirmed the round-3 fixes, and found two Minor test gaps and one doc overstatement. Fixed:
  - the test harness reports an existing InvenTree database by default, so the upgrade test again proves the upgrade timeout; a new test asserts the 120 s timeout for a later run. The mutations dropping `upgrading` and always passing `fresh: true` now each fail a test;
  - a new `after-rename` race stage tests the contended-lock branch: the moved lock is kept and the newest lock is left alone;
  - the docs say neither reset can see namespaces at other explicit `INTAKE_APP_STATE` paths.
- **Round 5** (fresh reviewer, `c744a47`) found no Critical or Important issues, and two Minor ones. It confirmed the round-4 changes. Fixed:
  - `pnpm dev` passes its resolved `INTAKE_DEV_STATE`, and `INTAKE_ENV_FILE=''`, to every child, so no child can re-read a different env file and use another state directory;
  - under its lock, the supervisor re-reads the local instance and refuses with `local_inventree_changed_during_startup` if a reset changed the instance ID or read token after `up`.

  A live `local-inventree` start with both changes read seeded part 2 (`SEED328 microcontroller`) with 201.
- **Round 6** (fresh reviewer, `74a58d0`) found no Critical or Important issues. It confirmed the round-5 changes, found one Minor test gap and one stale-count nitpick. Fixed:
  - the supervisor's whole startup sequence (shared child env, services, scoped root, lock, instance re-check, release on failure) is one tested `startSupervision` helper that `tooling/dev.cjs` calls, so removing a step fails a test.

  After round 6: `pnpm test:dev` 52/52 and `pnpm --filter @invimport/intake-server test` 208/208. A live `local-inventree` start read seeded part 3 with 201.
- **Round 7** (fresh reviewer, `1cf8518`) found no Critical or Important issues. It confirmed that `startSupervision` keeps the fake and read-only behaviour, and found one Minor test gap. Fixed:
  - a fake-profile `startSupervision` case asserts the shared child env passed to `startServices` and the lock order. Reverting `startServices` to run without that env now fails it.

  Current totals: `pnpm test:dev` 53/53 and `pnpm --filter @invimport/intake-server test` 208/208.
- **Round 8** (fresh reviewer, `9f57ec6`) did a full final pass and reported no findings at any severity. It noted one cosmetic point that is not a finding: the docs write the fake namespace as `app-<server id>`, and the code uses the first 16 hex characters. Its checks: `pnpm test:dev` 53/53, intake-server 208/208, `.github/scripts` 22/22, `lint:backend` and typecheck clean. Since then the branch has changed only to record this outcome here and tick task 6.1.

## Delivery

PR-B was opened as #105 against `interactive-app`. The independent review was clean on `9f57ec6`. CI passed on the final head `bd950b2`, a docs-only commit recording that review: lint for backend, Markdown and TypeScript, and tests for backend, frontend and intake contracts/HTTP. Two jobs were skipped. The PostgreSQL/process tier has been disabled in CI since #99 (`if: ${{ false && inputs.intake }}` in `test.yml`) and was run locally, as recorded above. Shared workflow sync was not selected, because no skills or agents changed. #105 was squash-merged as `21575ca`, and BI-009 is Done. Archiving the change is a separate, authorized step.
