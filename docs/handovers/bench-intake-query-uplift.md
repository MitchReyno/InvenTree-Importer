# Existing typed database query uplift

## Status and authority

Implemented and locally qualified; awaiting fresh independent review. The prospective implementation plan below was recorded before source edits on 2026-11-02 (Australia/Melbourne). The user requested a separate owner to improve existing database queries outside the active media/processing owners. Base: merged `interactive-app` at `10bd6c85c81d02a0a5970b002c79f55f9d41fe87`.

Follow the [approved implementation plan](../bench-intake/08-implementation-plan.md), T01–T04 handovers and intake architecture/testing guidance. The real inventory server referenced by the original root environment is strictly read-only. This task makes no inventory/provider requests, copies no credentials, and never loads that environment.

## Scope and interfaces

Own `intake-server/src/db/schema.ts`, `db/database.ts`, `db/authority.ts`, `workers/delivery.ts` and narrow regression tests. Preserve existing domain APIs and behavior. Media, processing, capture, review, execution, grants, contracts, migrations, manifests and lockfile remain outside this task. Shared code-guideline updates belong to the coordinator.

Expose `queryDatabase(connection)` for an existing `Pool` or checked-out `PoolClient`. It supplies typed access without checking out another connection, opening a transaction or retrying. Existing caller-owned transaction lifecycle, borrowed-client error handling and uncertain-COMMIT propagation remain unchanged.

Add the existing idempotency table's typed declaration. Use named domain reads/writes for idempotency retention and bounded delivery. Keep retained bytes opaque and runtime JSON parsing/validation at current boundaries. Preserve exact canonical bytes, full payload comparisons, bigint/string sequences, conflict guards, attempts and ACK semantics.

## Research and alternatives

Use installed pinned Drizzle 0.45.4 and pg 8.16.3 public declarations, then confirm them through compilation and actual PostgreSQL behavior. No new dependency or upgrade. Current online Drizzle documentation may describe 1.0 release-candidate APIs, so installed versioned APIs are authoritative for this change.

A replacement ORM or generic CRUD framework would add cost without helping these narrow domain operations. Keep reviewed SQL migrations as DDL authority, with no schema push or autosync. Drizzle declarations describe access mappings, not all database constraints or runtime JSON validity.

Retain explicit parameterized PostgreSQL for advisory transaction locking of absent idempotency keys and the atomic `UPDATE ui_stream ... RETURNING head` operation. Those statements directly express the locking contract. Ordinary table reads/inserts/guarded updates use typed Drizzle builders; domain helpers make their meaning visible.

## Implementation steps

1. Add the checked-out connection adapter and missing idempotency mapping without changing transaction handling.
2. Separate idempotency scope locking, typed lookup and immutable retention. Keep domain work between lookup and retention in the same caller transaction.
3. Separate delivery lookup, enqueue/retained-state inspection, conflict classification and guarded outbox updates. Preserve separate command/outbox lookups and their existing errors.
4. Exercise actual connection affinity, exact retained bytes, concurrent idempotency, rollback and event lock/order behavior. Reuse existing DBOS collision/redelivery and uncertain-COMMIT process cases.
5. Format only owned files; run types, fast tests and allocated serial PG/process tiers. Record evidence/limits and publish a ready nonstacked PR to `interactive-app` for a fresh coordinator-assigned independent reviewer. Do not merge or self-review.

## Versioned API finding and adjustment

Installed Drizzle 0.45.4 `node-postgres/driver.d.ts` accepts both `Pool` and `PoolClient`, and its public `DrizzleQueryError` wraps SQL and bound parameters in the message while retaining the original driver error as `cause`. Newly converted operations therefore use `executeDatabaseQuery`: unwrap only that actual Drizzle error when it has a cause. Other errors pass through unchanged. This preserves prior pg error identity/SQLSTATE without adding a SQL/parameter-bearing wrapper to failure messages; pg's own diagnostics still require the existing safe response boundary. The coordinator agreed this bounded compatibility seam. A real checked-out-client duplicate-key test verifies SQLSTATE and constraint name.

Pinned Node 24.22.2 and pnpm 12.16.1 offline frozen installation succeeds with zero manifest/lockfile changes. Installed declarations and compilation confirm supported builders; no current-release web API was assumed.

## Coordinated compatible error seam

The coordinator requested `CommandPayloadConflict extends Error` for media's later typed HTTP boundary. Export it from authority and throw it for changed semantic payload, preserving the exact existing `payload_conflict` message and all current callers. Add a regression checking both constructor and message. Media will consume only after this independent PR merges; no sibling feature code is imported.

## Verification allocation and limits

Reuse the sole owned PG17 service, loopback 55432, 40 connections and 256 MiB. Request the heavy PG/process window after the processing owner. Tests create only randomized disposable databases/roles; no shared restart, fault injection into shared PG, `intake_dev` migration or duplicate container. Existing retained previews remain untouched.

Completed: pinned installation, installed-API inspection, implementation and all qualification below. The first offline install used the wrong PATH-default toolchain; the pinned offline install succeeded without changes to manifests or lockfile.

## Qualification progress

The first full PostgreSQL run passed 29/30, including all existing tests and the new connection/SQLSTATE case. The new scope fixture returned a JavaScript numeric `saved` index, correctly rejected by the existing exact-string canonical policy. Correct the fixture to retain string indices; no production policy is relaxed. Rerun the full tier after this test-data correction.

## Additional package assessment

The coordinator relayed the user's request to assess other bespoke mechanisms while qualifying this task. No additional installation or rewrite is proposed for the owned paths:

- `db/database.ts:transaction`: Drizzle's transaction API could remove explicit BEGIN/COMMIT boilerplate. It would not establish equivalence for the qualified borrowed-client error listener, destructive release, uncertain COMMIT acknowledgement and no-retry policy. Retain the existing helper.
- `workers/delivery.ts:enqueueOrInspectExisting` and `workflowConflict`: DBOS's transaction enqueue option requires its system-database transaction. It would change authority coupling and still cannot replace full payload/function/class/config/queue/version equivalence or confer physical writer authority. Retain the bounded public-client adapter.
- `db/authority.ts:idempotent`: generic HTTP idempotency middleware could remove request-key plumbing. The actual contract is atomic retention with domain writes on the same connection, absent-key advisory locking and exact canonical payload comparison. A middleware cache would not remove those requirements.

Native Node crypto already supplies SHA-256 and constant-time digest comparison; no custom hash implementation or extra hash package is needed. This audit is bounded to assigned code, not an assessment of the other owners' modules.

## Final local validation and transfer

Snapshot: 2026-11-01 13:15 UTC. The coordinator allocated PostgreSQL after processing/media and received release immediately after process qualification. All test databases/roles and children were owned randomized fixtures; retained namespaces/services were neither restarted nor reset.

| Check                                         | Result                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Pinned offline frozen installation            | Passed; no new package, manifest or lockfile change.                                                                               |
| `pnpm typecheck:intake`                       | Passed contracts and server.                                                                                                       |
| `pnpm contracts:check`                        | Passed generated-byte drift check.                                                                                                 |
| `pnpm test`                                   | Frontend 11, contracts 3, server 41 and backend 2,038 passed. Existing backend opt-in/external skips: 4; scanner deselections: 43. |
| `pnpm db:intake test`                         | Final 30/30 passed, zero skips.                                                                                                    |
| `pnpm db:intake test:process`                 | 9/9 passed, zero skips.                                                                                                            |
| Changed-file Prettier / Markdown / whitespace | Passed, including configured changed-file pre-commit hooks.                                                                             |

The new actual-PG cases detect accidental pool switching through rollback visibility, retain bigint values above safe integer range, preserve driver SQLSTATE/constraint, and distinguish all four idempotency scope fields. Domain work deliberately mutates its scope object; retained identity stays the pre-work snapshot as in the original implementation. Literal Unicode semantic bytes and retained response bytes remain independently asserted. Existing concurrent same-payload/conflicting-payload tests now check the typed conflict constructor and unchanged message; existing capture/manual HTTP tests preserve public conflict responses.

Existing PG/process coverage passed for stream lock timeout/order/rollback, canonical vectors, restricted roles, full DBOS payload/metadata collision and redelivery, actual TCP lost approval/intent COMMIT ACK, no automatic retry, original-run recovery and persistent fake effects. The DBOS wrong-queue diagnostic in the process output is expected collision evidence, not a failed test. No real inventory/provider endpoint was called.

Changed paths are limited to the four assigned source files, foundation PG tests, this handover and the coordinator-approved PostgreSQL architecture paragraph. Immutable migrations, canonical vectors, original design references, contracts, manifests and lockfile have no diff. No UI/layout change means no new browser screenshot claim. Other owners consume the adapter/error seam only after reviewed merge into `interactive-app`.

The coordinator assigns a fresh independent reviewer to the ready nonstacked PR and owns merge after exact-head review/checks. This owner does not merge, launch nested reviewers or invoke pr-review-loop. Use github-pr-tools for live PR/check reads and handover for transfer. No human decision is needed; repository-wide readability guidelines remain coordinator-owned.
