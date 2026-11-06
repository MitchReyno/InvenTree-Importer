# Implementation and delivery tasks

## Plan context

- **Plan:** the [proposal](proposal.md) and [design assessment](design.md).
- **Reuse:** adapt the upstream Compose stack, mount scripts into the pinned base image, and seed with the existing `invimport` sync commands. No new package dependency.
- **Specs:** none. `.openspec.yaml` declares `skip_specs: true`; acceptance criteria AC1–AC8 live in the design.
- **Change name:** `local-inventree-dev`, indexed as [BI-009](../../../docs/PLANNED_FUNCTIONALITY.md#bi-009--local-development-inventree).

## Completion and commit ordering

- Complete and verify an action, then check it in the same commit as its work.
- Leave incomplete actions, and parents with unfinished children, unchecked.
- Record review, publication, CI and merge outcomes only after they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Shared `inventree-db` service for intake | Configuration and tooling | None | AC4, AC6, AC7 |
| 2. InvenTree stack, bootstrap and lifecycle CLI | Tooling | 1, which provides the Compose file and the identity module | AC1, AC2, AC6, AC7 |
| 3. Deterministic seeding | Tooling | 2, which provides the write token | AC3 |
| 4. `local-inventree` profile in `pnpm dev` | Behaviour (dev target) | 2; 3 for the live AC5 check, which reads a seeded part | AC5, AC8 |
| 5. Documentation, ledger and handover | Documentation | 1–4 | All, through recorded evidence |

Task 4's code and tests can proceed alongside task 3. Only its live AC5 check waits for seeding.

## PR delivery map

The planning artifacts were delivered separately in `docs(local-inventree-dev): plan local development InvenTree` on `docs/local-inventree-dev-plan`.

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-B | A working local InvenTree dev stack, the shared database, seeding, the new profile and docs | Tasks 1–5, all checklist items | The user asked for a single implementation PR. The database move and the profile share the Compose file and identity module, so splitting them would ship an unused stack or a half-moved database. | The planning PR is merged | `interactive-app` ← `feat/local-inventree-dev`; `feat(local-inventree-dev): local development InvenTree stack` | Repository checks green; local PostgreSQL and process tiers plus the live run recorded in the handover; independent review clean on the exact head; CI green; then merge |

## 1. Shared `inventree-db` service for intake

- PR delivery: PR-B.
- Outcome: `pnpm dev` and `db:intake` provision intake roles and databases on the Compose `inventree-db` service at `127.0.0.1:55433` for every profile. They never create `bench-intake-dev-pg` and never touch it.
- Scope and approach:
  - `tooling/inventree-dev/compose.yaml` with the `inventree-db` service, labels, limits and health check.
  - New `intake-server/src/dev/pg-identity.ts` (erasable TypeScript, so the `.cjs` scripts load it through Node type stripping), the single source of the host, port, project, service and container identity.
  - `dev-services.cjs` rewritten to generate private `inventree-db.json` and `inventree-db.env`, run `compose up --wait inventree-db`, then do the existing role and database provisioning. The legacy `postgres.json` is never read or written.
  - Explicit volume `name:` and labels, and container name `bench-inventree-dev-db`.
  - `up --no-recreate --wait inventree-db` from any checkout, after a drift check that refuses with `owned_service_allocation_changed_request_coordinator`.
  - `setup.ts` and `run-media-pg.cjs` take the admin secret from `inventree-db.json`.
  - App state binds a `server_id`, with server-scoped default namespaces and `development_state_server_changed` for a mismatched explicit `INTAKE_APP_STATE` (`src/dev/state.ts`, `target.ts`).
  - The supervisor runs `dev-services start` before it resolves the state root and lock. `start` creates the identity after its volume check. The read-only `dev-services identity` never creates it. With `INTAKE_DEV_ADMIN_URL`, the identity is an admin host and port digest (`tooling/dev.cjs`).
  - `inventree_db_state_missing_for_existing_volume`, and the same allowlisted env file loaded by the tooling.
  - `src/dev/setup.ts`, `scripts/run-media-pg.cjs` and `tests/support/pg-tools.ts` read the identity module. The `docker exec` target becomes the Compose container.
- Prerequisites: None.
- Acceptance: AC4, plus AC6 and AC7 for the database service.
- TDD approach: extend the fake-docker tooling tests first. They must fail on today's `docker run bench-intake-dev-pg` argv, and on the missing ownership refusal and legacy-ignore behaviour.
- Verification:
  - `pnpm test:dev` and `pnpm --filter @invimport/intake-server test`;
  - local `pnpm db:intake test` and `pnpm db:intake test:process` against the new server;
  - `pnpm lint`.
- Risks and decisions: an existing app state namespace bound to the old server; see the design's migration section.

- [x] 1.1 Confirm every reference to 55432 and `bench-intake-dev-pg` (`rg`) and the current tooling-test fakes.
- [x] 1.2 RED: add tooling tests for the Compose `up --wait inventree-db` argv, labelled-ownership refusal, the legacy container ignored, `postgres.json` left byte-for-byte unchanged, new state files created privately, no secrets in argv, `setup.ts` and `run-media-pg.cjs` reading `inventree-db.json`, a fresh server-scoped namespace on first start with old `app` state present, the stale explicit-namespace refusal, identity resolved before the lock on a first run, the `INTAKE_DEV_ADMIN_URL` identity, the volume-without-state refusal on a first `pnpm dev` with the labelled volume present and no `inventree-db.json`, a second checkout starting the existing `inventree-db` without recreating it, and a refusal on drift. Run them and confirm they fail.
- [x] 1.3 GREEN: add the `inventree-db` Compose service and `pg-identity.ts`, move `dev-services.cjs` onto them, and update `setup.ts`, `run-media-pg.cjs` and `pg-tools.ts`.
- [x] 1.4 Refactor: remove the dead `docker run` path and keep the budgets and grant contract unchanged.
- [x] 1.5 Run the suites and the local PostgreSQL and process tiers on the new server, check AC4 manually with the legacy container present, and record the results.

## 2. InvenTree stack, bootstrap and lifecycle CLI

- PR delivery: PR-B.
- Outcome: `pnpm inventree:dev up|down|status|credentials|env|reset --yes` manages a ready InvenTree 1.5.0 at `http://127.0.0.1:4320` with admin, reader and writer accounts and tokens.
- Scope and approach:
  - Compose services `inventree-init`, `inventree-server` and `inventree-worker` on the pinned digest.
  - A private env file generated into state.
  - `tooling/inventree-dev/scripts/bootstrap.py`, run through the Django shell.
  - `tooling/inventree-dev/cli.cjs` with the root script `inventree:dev`.
  - An idempotent admin-connection step that creates role and database `inventree` before `inventree-init`.
  - `REVOKE CONNECT ... FROM PUBLIC` on `inventree`.
  - Token reuse checked in the Django shell; handoff through `/tmp` in the init container, `compose cp` to a private host directory, and `compose rm -f`.
  - Separate `inventree.env` (server and worker) and `inventree-init.env` (init only, with the admin password and tokens).
  - `instance_id` in `inventree-dev.json`, regenerated on reset.
  - CLI tests in `tooling/tests/inventree-dev.test.cjs`, added to `test:dev`. Ruff over `tooling/inventree-dev/scripts/`, added to `lint:backend` and to the ruff path list in `.github/workflows/lint.yml`.
  - CI path selection in `.github/scripts/ci_paths.py`: intake for `tooling/inventree-dev/` and `tooling/tests/inventree-dev`, and backend lint for `.py` under `tooling/inventree-dev/scripts/`, with cases in `test_ci_paths.py`.
  - The single-checkout ownership refusal `inventree_dev_owned_by_other_checkout`, based only on the InvenTree service containers. `down` leaves `inventree-db` running.
  - A private `inventree-dev.lock` taken by `up`, `seed` and `reset`.
  - The Docker discovery that `dev-services.cjs` uses today.
  - Redacted log tails on failure. The tooling never prints `docker inspect` or `compose config` output.
- Prerequisites: Task 1.
- Acceptance: AC1, AC2, AC6, AC7.
- TDD approach:
  - fake-docker CLI tests first, covering command argv, refusals, `reset` without `--yes`, state file modes and redaction;
  - live checks for the actual InvenTree behaviour, because the bootstrap runs only inside the real image.
- Verification:
  - `pnpm test:dev` and the CLI tests;
  - a live `up` run twice, `curl` checks of `/api/`, `/api/user/me/` per token, the reader's 403 on create and the writer's create, and the web UI sign-in;
  - recorded in the handover.
- Risks and decisions: whitenoise serving `/web/` without Caddy. Verify in 2.1 and fall back to adding Caddy if needed.

- [x] 2.1 Proof of fit: in a throwaway Compose run, confirm migrate, static, the env admin, whitenoise UI serving, ApiToken creation and lookup on the pinned image, `env_file` with `required: false` for all three generated files and an interpolated path on the local Compose version, `up --wait` together with a `service_completed_successfully` one-shot service, `compose cp` from an exited container to a host path, and the duration of the first-run `inventree-init` (migrate and static) on a fresh database, to confirm its timeout.
- [x] 2.2 RED: CLI tests for the lifecycle argv, ownership and labels, `reset` confirmation, order and scope (stop server, worker and init before `DROP DATABASE ... WITH (FORCE)`; InvenTree only by default; `--database-server` refused while a supervisor lock is held, otherwise stopping `inventree-db` before removing its volume; never `postgres.json`), the other-checkout refusal (InvenTree services only), the `inventree-dev.lock` contention refusal, `--database-server` refusing on a held lock in the scanned directories or with `INTAKE_APP_STATE` set, no admin password or token in the server or worker env file, `inventree-init` always removed after a failure, `up` running `dev-services start` first, the reset file scope (`inventree-dev.json`, `inventree.env` and `inventree-init.env`; plus `inventree-db.json` and `inventree-db.env` with `--database-server`), idempotent `inventree` role and database creation, private state creation and refusal, and redacted failure output. Run them and confirm they fail.
- [x] 2.3 GREEN: add the remaining Compose services, `bootstrap.py`, the CLI and the root script, and make the tests pass.
  - [x] 2.3.1 Reuse tokens that still validate, and re-issue only the named token otherwise.
  - [x] 2.3.2 Extend `.github/scripts/ci_paths.py` and `test_ci_paths.py` for the new tooling paths, add `../tooling/inventree-dev/scripts` to the ruff step in `.github/workflows/lint.yml`, select the intake job for `backend/config/` changes (which the fixture test depends on), and run `python3 -m unittest discover -s .github/scripts -p 'test_*.py'`.
- [x] 2.4 Refactor: share Docker discovery and state helpers with `dev-services.cjs`.
- [x] 2.5 Run `up` twice live and check AC1, AC2 and AC6. Record the results and the peak `pg_stat_activity` connections for the `inventree` role against its limit of 20.

## 3. Deterministic seeding

- PR delivery: PR-B.
- Outcome: `pnpm inventree:dev seed`, also run at the end of `up`, makes the instance match `backend/config/` and loads the fixture records exactly once.
- Scope and approach:
  - Run `invimport parameters --write` and `categories --write` through `uv run --project backend`, with `--env-file /dev/null`. The URL and write token come through the child environment, with `INVENTREE_USER`/`INVENTREE_PASSWORD` removed.
  - Add `tooling/inventree-dev/seed/fixtures.json` and a REST loader keyed by `metadata.bench_intake_seed`, with tests in `tooling/tests/inventree-dev-seed.test.cjs` added to `test:dev`.
- Prerequisites: Task 2.
- Acceptance: AC3.
- TDD approach: loader tests against a fake REST server first. They should fail with duplicate creates and with records the loader did not seed being modified.
- Verification:
  - loader tests;
  - a live `seed` run twice, with category, template, part and stock counts unchanged on the second run;
  - `pnpm lint`.
- Risks and decisions: the fixture parts must use categories and parameters that exist in `backend/config/`. Check this in a loader test.

- [x] 3.1 Choose the fixture contents from `backend/config/`, confirm the REST endpoints and fields on API 530, and record whether `metadata` can be set in the create call or needs `/metadata/` with the natural-key fallback.
- [x] 3.2 RED: a post-sync completeness check that fails with `inventree_dev_seed_incomplete` when a configured category or template is missing; loader tests for create-once, re-run no-op, records it did not seed untouched, an interrupted create-then-tag adopted without duplicating, and unknown categories rejected. Add a seeding-child test asserting the `--env-file` argument and the scrubbed environment. Run them and confirm they fail.
- [x] 3.3 GREEN: add the fixtures and loader, and wire the `invimport` sync into `seed` and `up`.
- [x] 3.4 Refactor: keep the loader free of InvenTree-model assumptions beyond the endpoints it uses.
- [x] 3.5 Run `seed` twice live and record the counts.

## 4. `local-inventree` profile in `pnpm dev`

- PR delivery: PR-B.
- Outcome: `INTAKE_TARGET_PROFILE=local-inventree pnpm dev` starts and waits for the stack, then serves the app reading from the local instance with the state-sourced read token.
- Scope and approach:
  - `src/dev/target.ts` (the new kind, conflicts and fixed origin and reference) `state.ts` (namespace, and a v3 binding with its check), and `setup.ts` and `readonly-setup.ts` (v3 provisioning instead of the fake `manualFixture` fallthrough, and the binding check for v1, v2 and v3). `config.ts` already maps every non-`fake` profile to `configured`, so it does not change;
  - the `tooling/dev.cjs` branch that calls `inventree:dev up` and passes the origin and key only to the API process environment. The setup child gets only the profile;
  - the environment allowlist and `.env.intake.example`.
- Prerequisites: Task 2. Task 3 is needed for the live AC5 check only.
- Acceptance: AC5, AC8.
- TDD approach: target-selection unit tests and supervisor tests first. They must fail with `unsupported_development_target` and on the missing stack start.
- Verification:
  - `pnpm --filter @invimport/intake-server test` and `pnpm test:dev`;
  - a live `pnpm dev` with the profile, checking bootstrap status and an existing-Part read of a seeded PK;
  - recorded in the handover.
- Risks and decisions: none beyond the design.

- [x] 4.1 Confirm the current target, state and namespace contracts and the supervisor branches.
- [x] 4.2 RED: tests for the profile, its conflict errors, a missing local state error, the setup child deriving the target from the profile alone, the v3 state binding, the supervisor starting the stack before resolving the root and lock on a first run with no `inventree-dev.json`, the key read only after the stack start, `local-inventree` with `INTAKE_DEV_ADMIN_URL` refused, the API child env carrying `INTAKE_CREDENTIAL_REF=local_inventree_dev`, the origin and the key without reading `runnerConfig`, and a reset `instance_id` changing the namespace. Run them and confirm they fail.
- [x] 4.3 GREEN: implement the profile and supervisor integration.
- [x] 4.4 Refactor: share the read-transport wiring with `read-only`.
- [x] 4.5 Run the live AC5 check and record it.

## 5. Documentation, ledger and handover

- PR delivery: PR-B.
- Outcome: the docs describe the stack, its commands, profiles and state, and how to remove the legacy container manually. The handover records decisions, evidence and limits.
- Scope and approach:
  - `docs/development.md`, the `intake-server/README.md` service ledger and local-image section (replacing the internal-network suggestion), `intake-server/TESTING.md`;
  - `.env.intake.example`, `ARCHITECTURE.md`, `intake-server/ARCHITECTURE.md`;
  - a new `docs/handovers/local-inventree-dev.md`.
- Prerequisites: Tasks 1–4.
- Acceptance: every documented command, port, path and state file matches the code.
- TDD approach: not applicable to docs. Verify with a reference check (`rg` for 55432, `bench-intake-dev-pg`, 4320 and command names) and the markdown lint.
- Verification: `pnpm lint`, and a manual read-through against the code.
- Risks and decisions: none.

- [x] 5.1 Update the docs, ledger and env template.
- [x] 5.2 Write the handover, with the live evidence from tasks 1–4.
- [x] 5.3 Check the references and run the markdown lint.

## Delivery evidence and lifecycle follow-up

- [ ] 6.1 An independent read-only review of the exact PR-B head is clean. Record the reviewed SHA.
- [ ] 6.2 PR-B is opened against `interactive-app` and CI is green.
- [ ] 6.3 PR-B is merged, and BI-009 is updated to its evidenced status.

Archive only when authorized, and update the index link if the change moves.
