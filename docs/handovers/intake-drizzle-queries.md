# Intake server Drizzle query conversion

## Status and authority

Phase 1 plan, recorded before source edits on 2026-11-02 (UTC+11). Base: `interactive-app` at `e1a9686c80d8024ce946c893e2948cc9a59c7cc2`. Branch `refactor/intake-drizzle-queries`. Decisions owner: Mitch.

This applies the approved package refinement in the [implementation plan](../bench-intake/08-implementation-plan.md#approved-package-and-crop-refinements): use the existing Drizzle package for ordinary domain queries on the caller's checked-out connection, and keep explicit SQL where it makes locking or atomic operations clearer. It extends the [typed query uplift](bench-intake-query-uplift.md), which introduced `queryDatabase` and `executeDatabaseQuery`.

The real inventory server referenced by the root environment stays strictly read-only. This task makes no inventory or provider requests and never loads that environment.

## Scope

Phase 1 converts raw `client.query`/`pool.query` SQL already on `interactive-app` in files the parallel T09 owner (supported inventory effects) is not editing. Changed paths:

- `src/db/schema.ts`: add the migration defaults that inserts rely on (`command.created_at`, `outbox.available_at`, `outbox.delivery_attempts`).
- `src/processing/schema.ts`: complete the existing declarations to match migrations 0006/0007/0009 exactly, and add `processing_profile` and `processing_answer`.
- `src/capture/schema.ts` (new): the four migration 0008 review tables `capture_lot_lineage`, `capture_lot_retirement`, `capture_issue_disposition` and `capture_instruction`.
- Converted call sites in `src/capture/{operator-commands,review-context}.ts` and `src/processing/*`.
- Regression tests under `tests/pg/`, this handover and the owning architecture documents.

## Non-goals

- No change to which statements run, their order, their transaction or their lock scope. No retry, no connection checkout, no transaction helper change.
- No migration, contract, generated artifact, manifest or lockfile change.
- No edits to T09's dirty files (listed in the task brief), nor to `src/media/schema.ts`, nor to T09's new `src/execution/schema.ts`.
- No Drizzle declarations for `executor_*`, `capture_observation` or `manual_*` tables. Those need an interface proposal and coordinator/Mitch ACK, and default to phase 2.
- No behaviour fixes. A latent defect found by the conversion gets a regression test and an explicit note here and in the PR.

## Classification rule

Convert ordinary reads, inserts and plain keyed updates (`SET column=value WHERE id=...`). Keep explicit:

- Row locks (`FOR UPDATE`, `FOR SHARE`, `SKIP LOCKED`), advisory locks and `pg_locks` probes.
- Compare-and-set or state-guarded updates, and in-place increments such as `revision=revision+1` or `head=head+1 RETURNING`.
- Lock-establishing upserts (`INSERT ... ON CONFLICT DO NOTHING` immediately followed by a row lock).
- Aggregates, recursive CTEs and multi-table `EXISTS` reference probes.
- `GRANT`, DDL, migration bookkeeping, `SET`/`SET LOCAL`, `BEGIN`/`COMMIT`/`ROLLBACK` and savepoints.
- `public.`-qualified relations. Drizzle 0.45.4 rejects `pgSchema('public')`, so it cannot emit the qualification that prevents a `pg_temp` relation from shadowing a table on a pool connection without the restricted media `search_path`.

## Query inventory (phase 1 files)

Counts are statements, not call sites of helpers.

| Module                       | Convert | Keep | Phase 2 | Notes                                                                                               |
| ---------------------------- | ------- | ---- | ------- | --------------------------------------------------------------------------------------------------- |
| `db/database.ts`             | 0       | 3    | 0       | `BEGIN`/`COMMIT`/`ROLLBACK`                                                                         |
| `db/authority.ts`            | 0       | 2    | 0       | Advisory scope lock; atomic `ui_stream` head increment                                              |
| `operations/migrate.ts`      | 0       | 5    | 0       | Migration lock, DDL, `schema_migration` bookkeeping in the DDL transaction                          |
| `*/grants.ts` (5 files)      | 0       | 18   | 0       | `GRANT` statements                                                                                  |
| `media/*` (8 files)          | 0       | 19   | 0       | Advisory locks, `FOR UPDATE`, `SKIP LOCKED`, increments, `SET`, `pg_locks`, `public.` pin authority |
| `research/receipts.ts`       | 0       | 1    | 0       | Advisory budget lock                                                                                |
| `capture/operator-commands`  | 4       | 0    | 0       | Lineage, retirement, disposition and instruction inserts                                            |
| `capture/review-context`     | 4       | 0    | 0       | Review-context reads, including `DISTINCT ON` latest instructions                                   |
| `processing/answers.ts`      | 5       | 3    | 0       | Keeps question `FOR UPDATE` and two revision increments                                             |
| `processing/attempts.ts`     | 5       | 0    | 0       | Input, command, attempt, dependency and outbox inserts, same order                                  |
| `processing/authority.ts`    | 1       | 0    | 0       | Five-table authority join                                                                           |
| `processing/commands.ts`     | 1       | 2    | 0       | Keeps job `FOR UPDATE` and revision increment                                                       |
| `processing/continuations`   | 2       | 2    | 0       | Keeps recursive closure CTE and revision increment                                                  |
| `processing/delivery.ts`     | 1       | 2    | 0       | Dispatch read converts; `public.`-qualified pool reads stay                                         |
| `processing/jobs.ts`         | 3       | 4    | 0       | Keeps guarded supersession, job `FOR UPDATE`, increment                                             |
| `processing/messages.ts`     | 5       | 0    | 0       | Message, proposal, question inserts; last-sequence update                                           |
| `processing/runner.ts`       | 3       | 0    | 0       | Command/attempt lookups and lane claim under the lane lock                                          |
| `processing/scope.ts`        | 0       | 2    | 0       | Lane upsert plus `FOR UPDATE`                                                                       |
| `processing/state.ts`        | 1       | 4    | 0       | Keeps two `FOR UPDATE`, increment and exact-attempt lane release                                    |
| `processing/repository`      | 0       | 2    | 0       | `SET TRANSACTION`                                                                                   |
| `processing/research.ts`     | 0       | 1    | 0       | `SET TRANSACTION`                                                                                   |
| `operator-review/*`          | 0       | 3    | 3       | `SET TRANSACTION`/savepoints stay; `manual_*` reads wait for phase 2                                |
| `review/media-preparation`   | 0       | 0    | 2       | `manual_preparation_media`                                                                          |
| `execution/*` (6 files)      | 0       | 0    | 22      | Executor tables; T09 owns the new `execution/schema.ts`                                             |

The inventory is reconciled against the final diff in [Results](#results).

## Bigint and nullability audit approach

- Raw pg returns `bigint` as decimal strings; Drizzle `{ mode: 'bigint' }` returns `BigInt`. For each converted bigint column, trace every consumer: string comparisons, truthiness, `String(...)`, DTO fields and inserted parameters (pass `BigInt(...)`). Projected strings use `.toString()`, which matches pg's decimal text for bigint.
- Rows change from snake_case to camelCase. Rewrite every field access, including callbacks, spreads and types derived through `ReturnType`.
- Left joins and nullable columns: keep existing refusal behaviour explicit and treat any new type error as a possible real bug.
- `inArray([])` compiles to `false` in 0.45.4; check each site against the old `= ANY($1)` result.
- `timestamptz` reads change from pg's parser to Drizzle's `new Date(string)`. Both truncate to milliseconds and agree for whole-minute offsets; they differ only for historical offsets with seconds, which `now()` defaults cannot produce. Recorded as a limit, not tested against real historical zones.

## Verification

In order: `pnpm typecheck`, `pnpm lint:readability`, `pnpm format:readability`, `pnpm format`, `pnpm format:check`, `pnpm test:intake`, `pnpm contracts:check`, then the full PG tier (`pnpm db:intake test`) and process tier (`pnpm db:intake test:process`) under the shared `pg-docker` lease.

New regression cases (real PostgreSQL):

- Capture review context with revisions and instruction versions above `Number.MAX_SAFE_INTEGER`, exact string projection, ordering, `DISTINCT ON` latest instruction with a null batch group and a group, and the existing `capture_retirement_without_lineage` refusal.
- Processing records retaining bigint attempt number, capture revision and message sequence above the safe integer range through the converted reads and inserts.
- Existing processing, operator-review, compatibility, dependency, media and research PG/process suites cover lock order, stale refusal, replay and dedup behaviour.

Adverse cases: a duplicate message-sequence insert through `executeDatabaseQuery` still fails with the original pg SQLSTATE (`23505`) rather than a Drizzle wrapper (adapter evidence; `acceptEnvelope` dedups a duplicate before inserting); the instruction foreign-key violation still maps to `group_not_found` 404 through the preserved SQLSTATE `23503`.

## Phase 2 (not implemented)

After T09 merges, convert the listed T09 files and the execution/operator-review/manual reads in this inventory, declaring `executor_*`, `capture_observation` and `manual_*` tables in their owning schema modules. That requires the owning module's schema file from T09.

## Results

Verified `processing/schema.ts` against migrations 0006, 0007 and 0009 before converting call sites. 0006 column lists match, including defaults the inserts omit (`processing_job.revision` 1, `processing_attempt.last_sequence` 0, `processing_question.revision` 1, `processing_answer.created_at` `now()`). 0007 and 0009 change profile checks and seed rows only. `research_receipt` stays in the research schema. `processing_transition` stays undeclared because only its trigger writes it.

`processing_question.batch_id` was missing from the previous declaration. Adding it makes `getTableColumns(processingQuestions)` in `retained.ts` and `read.ts` select that column too. The joined projections do not alias-clash, and both consumers ignore the extra field. No DTO change.

Drizzle reads that already existed in `processing/read.ts`, `processing/retained.ts` and `verifyDependencyBinding` now also run through `executeDatabaseQuery`, so their pg failures surface without the SQL-bearing wrapper. Lineage and retirement inserts stay private to `operator-commands.ts`; the existing operator-review and retirement PG suites drive them through `applyRestructure` with small revisions. Their above-`Number.MAX_SAFE_INTEGER` revision coverage was dropped to keep `recordLineage` private; disposition and instruction inserts still cover that range with the same `BigInt(scope.nextRevision)` binding.

Phase 1 statement counts, reconciled with the diff: **35 converted**, **73 kept** explicit in the phase 1 modules (locks, compare-and-set, increments, recursive closure, `SET TRANSACTION`, grants, migration bookkeeping, advisory locks and `public.`-qualified reads). Phase 2's 27 statements stay unimplemented. No `executor_*`, `capture_observation` or `manual_*` declarations, and no edits under T09's dirty paths or `src/media/schema.ts`.

No product behaviour defect. `executeDatabaseQuery` kept SQLSTATE `23505` on a duplicate message sequence and `23503` on an unknown instruction group (`group_not_found` 404). Bigint attempt number, capture revision and message sequence above `Number.MAX_SAFE_INTEGER` round-trip as exact decimal strings. Review context keeps that exact revision text, `DISTINCT ON` latest instructions for a null group and a group (`NULLS FIRST`), disposition order including the id tiebreak for equal timestamps, and `capture_retirement_without_lineage`.

Timestamptz reads still agree with pg for whole-minute offsets and can differ only for historical offsets that include seconds. `now()` defaults cannot produce those. `inArray([])` was not introduced.

Verification on 2026-11-02: `pnpm typecheck`, `pnpm lint:readability`, `pnpm format:readability`, `pnpm format`, `pnpm format:check`, `pnpm test:intake` (28 contract + 103 server, no skips) and `pnpm contracts:check` passed. PostgreSQL tier: 89 passed, 0 skipped, 0 failed. Process tier: 32 passed, 0 skipped, 0 failed. Both ran under the `pg-docker` lease on the shared PostgreSQL 17 service with decoder `sha256:cd6772022cc1cfc038630e2af31f9c0b557b3c847795653ee4604b0f5dcc0cb7` and probe `sha256:a5632d160ea49a5f8c284a5cd9f1660d7df46d1e91b6e0c5d103adb2b373aa6c`, built from this branch. The lease was released after the tiers; the shared service was not restarted.
