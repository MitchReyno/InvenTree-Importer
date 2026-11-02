# Drizzle domain CRUD and atomic updates

## Status and authorization

In progress after the [locking-query PR](https://github.com/MitchReyno/InvenTree-Importer/pull/62), on `refactor/intake-drizzle-domain-queries` from merged `interactive-app` at `ee3aebd8d432275c0db71bd29ebffcff06a55e08`. Mitch asked whether more raw SQL could be converted; after a concrete explanation of CRUD, atomic increments/conditional updates, conflict inserts and specialized exceptions, he explicitly said “Okay, do it.” Root implements personally. Fresh independent reviewers remain read-only; no external ticket applies. This plan is recorded before source changes.

## Scope and ownership

Convert remaining ordinary domain reads, writes, straightforward joins, conflict inserts and atomic updates in capture/repository, Processing state/job/answer/continuation/scope modules, executor source/guard/attachment journal and recovery modules, manual review preparation/run/dispatch modules, foundation stream publication and media revision advancement. Reuse the existing queryDatabase/executeDatabaseQuery adapter with the original Pool or borrowed client at each call. Preserve transaction and lock order, isolation/search-path fences, payload bytes/digests, exact string identifiers/quantities/revisions, nullable joins, no-row/refusal behavior, row counts and no-retry policies. Ordinary cancellation/round aggregates may use explicit exact text SQL expressions within the builder. No protocol, workflow, authority, transport or UI redesign.

Add only driver mappings needed for existing tables in their owning schema modules: captureSources, captureParts, captureLots, captureNotes, captureSelections, captureRevisions, captureEditPublications; manualPrepareCommands, manualReadIntents, manualReadResults, manualPreparationReviews, manualPrepareOutcomes, manualRuns, manualDispatches; executorAttachmentIntents, executorAttachmentResults, executorAttachmentEffects, executorAttachmentVerifications. These 18 mappings describe existing migrations 0002/0004/0005/0006 and their later alterations, including the six inventory read models from 0010 and create selections. Bigints remain bigint internally or explicit decimal text at the original boundaries; JSONB stays unknown until existing runtime validation. SQL retains constraints, indexes, triggers, grants, composite parents and migration ownership. No generated DDL, new database table, relation graph, dependency or lockfile change.

Keep explicit SQL for transaction/savepoint/isolation/search-path commands, grants, migration/maintenance/catalog machinery, dedicated writer-session ownership, recursive closures and specialized pin/GC/authority checks. Public-qualified authority queries retain qualification; do not silently substitute unqualified tables. Retain the query-only checkDeployment seam rather than broadening its connection contract for cosmetic conversion. Do not change physical child, target, original-run, cancellation or recovery policy to simplify a query. A remaining direct query is not necessarily a Drizzle limitation; document scoped exceptions accurately.

## Alternatives and package research

Use existing pinned Drizzle 0.45.4, not another ORM or transaction manager. Official update/insert/select/SQL APIs support SQL expressions, RETURNING, conflict handling, DISTINCT ON, joins and subqueries. SQL fragments remain explicit for database arithmetic and exact aggregate text. Compare-and-set remains one UPDATE with the identical predicate; never implement it as a read followed by an unconditional update. Keep insert-before-lock sequencing. Prefer direct readable builder calls and owned column projections; add shared helpers only for a concrete repeated operation, not generic query frameworks or duplicated runtime validators. Code intelligence is unavailable; its checks remain skipped.

## Implementation and verification

1. Inventory and convert eligible queries without changing statement order or authority. Add mappings from complete current migration/catalog facts, not inferred table names. Preserve defaults, identity generation, bytea and nullability.
2. Expand real catalog/default/key checks for all mappings. Add targeted regressions through production entrypoints for atomic bigint increments/rollback, conditional updates that cannot clear a newer claim, conflict inserts preserving the original binding, and unchanged nullable/exact retained outputs. Reuse full Capture, review, original-run, Processing, media and attachment integration evidence.
3. Frozen local install; types/readability/format/generated/Markdown and fast server/contracts checks. Complete PG/process tiers serially under pg-docker, rebuilding immutable media images after media source changes. Run fast tests separately from heavy tiers after the prior observed five-second startup deadline contention. No browser acceptance claim for this server-only refactor.
4. Record actual checks/failures/fixes before each commit. Fresh read-only exact-head review until clean; push/verify and raise a separate PR into interactive-app. Watch exact-head CI and fresh feedback; merge only with existing explicit authorization and green checks, preserving all branches/worktrees.

## Safety

No actual model/provider calls, paid fallback, original environment loading/copying, real inventory requests, deployment, main/PR32 merge, force push, reset/clean, or deletion of branches/worktrees/retained data. Preserve the tags worktree's three uncommitted entries, retained 4310 and user 4350. Acquire atomic pg-docker before shared Docker/PG/process fixtures; never restart/fault shared PG. Use only isolated synthetic state and the existing fixture lifecycle. No automatic retry, broad grant, new feature flag or credential discovery.

## Actual evidence

Pending implementation. No completion is claimed.

## Implementation checkpoint

Replaced **116** direct node-postgres query call sites with Drizzle builder calls/owned exact SQL expressions. This is a syntax/typing conversion, not a reduction in SQL statement count or a performance claim. Types pass. All 18 proposed mappings are added and the catalog comparison also covers `ui_stream`; its declaration now mirrors the existing SQL DEFAULT 0 for head, enabling omission exactly as the previous INSERT did. No migration or physical default changed.

A small review-owned row-projection module preserves existing snake_case row names and exact text numbers across repeated preparation/run/dispatch consumers. One executor-owned cancellation helper preserves the exact one aggregate at each existing call site. The two internal attachment readers now accept the actual Pool/PoolClient types their existing callers supply; the query-only checkDeployment contract remains unchanged. No new transaction, retry, grant, public DTO or physical writer behavior is added.

Focused real PostgreSQL qualification passed **11 tests, zero failures/skips**: new atomic/stale-lane/source/optional-field cases, all mapping comparisons, target/Processing exact-bigint regressions and existing foundation transaction/stream/error tests. Fresh immutable media images are built; full tiers follow. No final clearance or completion is claimed yet.

With the dispatch table mapped, its prior parameterized SQL join also moves to the typed builder with `of: manualDispatches`. The previous static driver-row description is removed; all original runtime byte/payload/authority/state checks remain. Core transaction wrappers, explicit public qualification and the dedicated writer connection are untouched.

Current residual direct SQL is intentionally scoped to transaction/savepoint/isolation/search-path commands, grants/migrations/catalog/maintenance, dedicated writer-session ownership and the query-only deployment gate, recursive dependency closure, and specialized public-qualified stream/child/pin/GC authority checks. These are retained review boundaries rather than claims that Drizzle cannot execute equivalent SQL. No blanket zero-raw-SQL or fewer-roundtrips claim is made.

## Full PostgreSQL checkpoint

The complete PG tier passed **114 tests, zero failures and zero skips**, including the new domain regressions and all retained source/approval/attachment/media/grant boundaries. The process and fast tiers follow serially under the same owned lease. Images are decoder `sha256:de1e676178f43c00254cddb854bb3c3b1db712d42fb4acb02a4b9fd0bc47b7c3` and probe `sha256:c5982e4f3577885af0ef3dfcc51dc7da9170d3c5c07b8efc6aa5566ad31d49d0`. Types, readability lint, formatting, generated contracts and Markdown checks passed before the full tiers; only documentation changed afterward.

## Final local qualification

Complete tiers passed serially with the immutable images above: PostgreSQL **114**, process **35**, contracts **33** and server **125**, all with zero failures and zero skips. The standalone focused real-PG pass was **11**. The unchanged five-second media-startup deadline passed in the serial fast tier. No runtime source changed after these qualifications; final documentation reconciliation corrected historical architecture wording for locks, atomic updates and the typed dispatch join.

Full workspace typecheck, readability lint, formatting, generated contracts and Markdown checks passed. The complete catalog comparison covers the 18 additional existing-table mappings and stream default correction alongside the previously mapped tables. No migration, grant, dependency, public API, physical writer, UI or protected-target behavior changed. No browser acceptance or actual native-provider/release qualification is claimed.

All owned fixtures disposed through the existing harness; no own preview or browser tab was created. The pg-docker lease is released after qualification, and the original tags worktree still has its original three uncommitted entries. Retained 4310 and user 4350 were untouched. A fresh read-only reviewer checks each exact new commit until clean before publication; exact SHA/verdict, hosted checks and the pinned merge result are recorded with the PR/external coordination log to avoid an unreviewed self-referential evidence commit.
