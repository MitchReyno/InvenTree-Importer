# Drizzle locking-query conversion

## Status and authorization

In progress on `refactor/intake-drizzle-locks`, starting from merged `interactive-app` at `7cac60e2b75b2f70a3fac34d9461095b3584fa3f`. Mitch asked to convert locking queries after reviewing the before/after capture example and its tradeoffs. This record was written before source changes. Root is the sole implementation owner; fresh independent reviewers are read-only. No external ticket applies.

## Scope and contract

Use the existing pinned Drizzle 0.45.4 and `queryDatabase`/`executeDatabaseQuery` on the exact borrowed connection. Preserve `transaction(pool, work)`, executor transaction handling, isolation, statement/lock order, scope predicates, missing-row behavior, no retries, grants, migration bytes and domain/API string boundaries. Ordinary row locks use `.for('update')`; the media claim uses command-only `{ of, skipLocked }` and the specialized manual-dispatch join retains its exact PostgreSQL clause through Drizzle parameterized `sql` execution. Transaction advisory locks retain the same hash functions, namespaces, keys and lifetime. Dedicated writer session ownership and migration machinery stay unchanged. No optimistic-concurrency redesign or replacement of advisory locks with row locks.

Add internal mappings for the existing `capture_batch` and `capture_subject` tables in capture/schema.ts, required by the capture example Mitch approved. All columns/defaults mirror migration 0002, bigint remains bigint internally and decimal text at existing boundaries, and kind unions mirror existing checks. SQL still owns all constraints/grants/triggers and composite relationships; no generated migration or new database table. No public/shared HTTP contract or runtime capability changes. Other existing schema mappings are reused; no new dependency or lockfile change.

Owned source paths: capture/schema.ts and repository.ts; execution/source.ts and authority.ts; processing/state.ts, jobs.ts, commands.ts, answers.ts and scope.ts; media/commands.ts, worker.ts, blob-store.ts and locked-inputs.ts; db/authority.ts; research/receipts.ts; review/runner.ts. Owning architectures and server TESTING.md describe the changed mapping boundary. Specialized query results keep existing driver representation and runtime guards rather than claiming runtime validation from SQL generics.

## Research and alternatives

Verified the installed PostgreSQL builder exposes `.for(strength, { of, noWait, skipLocked })`; official Drizzle [select implementation](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.ts), [SQL API](https://orm.drizzle.team/docs/sql) and [transactions](https://orm.drizzle.team/docs/transactions) support this composition. `sql<T>` supplies static typing only, not runtime decoding/validation. Keep the existing error-unwrapping adapter so SQLSTATE and sanitized error handling retain their original owner. Changing transaction ownership or replacing lock semantics would increase risk without aiding this conversion and is out of scope. Code intelligence is unavailable; its checks are skipped, not passed.

## Implementation and verification plan

1. Inventory row/advisory locks, map capture columns and convert without reordering statements or widening predicates/lock targets. Keep conditional capture locks conditional. Preserve sorted subject locks and skip-locked claim scope.
2. Add real PG concurrency regressions through production entrypoints: competing updates block until commit, rollback releases locks, unauthorized scope never locks another batch, exact revisions above 2^53 survive, and worker selection retains its claim-only lock semantics. Reuse existing fixtures and assertions for original-run, Processing lane and media pin/GC exclusion; do not replace physical/process evidence with generated-SQL assertions.
3. Run types, readability lint, formatting, generated-contract checks, fast server/contracts tests and complete PG/process tiers under the atomic pg-docker lease. Rebuild immutable decoder/probe images because media source changes. No UI behavior changes; browser journeys from the merged T10 remain historical rather than new browser evidence.
4. Record actual outcomes and review fixes here before each new commit. Fresh read-only review of each new commit until clean, then push/verify and raise a focused PR targeting interactive-app with exact-head CI. Follow existing explicit merge authorization only after clean review and green selected checks; never merge main or PR32.

## Safety and retained work

No actual model/provider calls, paid fallback, original environment loading/copying, real inventory requests, deployment, force push, reset/clean, or deletion of branches/worktrees/retained data. Preserve the tags investigation's three uncommitted entries, retained 4310 and user 4350. Only owned synthetic fixtures may be created/disposed by their existing harness. Acquire pg-docker before any shared Docker/PG/process work; never restart/fault shared PG. Append external coordination status only; the other status file stays read-only.

## Actual evidence

The initial conversion typechecked; a static manual-dispatch row description was necessary because Drizzle SQL returns unknown fields by default. Existing byte/digest and authority checks remain unchanged; no runtime validation is inferred from that row description. Capture/Processing revisions use explicit PostgreSQL text casts in their domain projections, and the executor target revision uses exact bigint-to-string conversion. Media's existing decimal-string custom type remains unchanged.

Focused real PG qualification passed **7 tests**: four new concurrency/scope cases, mapping/catalog and target-bigint checks, and the existing Processing exact-bigint regression. The two capture mappings match all migrated columns, types, defaults and primary keys. Complete tiers are running under the owned pg-docker lease with decoder `sha256:3190f6d45aa33c9965aed48fb1c285dfcffbaf2a80e1770880355c3e84cfc94e` and probe `sha256:0f4a347fd2b3a263dd6c6fbb014755bb27c3c9d761308248710eb5594580e5ba`. The focused media case was subsequently strengthened to require a false/no-claim result when both commands are held; its rerun is recorded separately below. No final completion or independent clearance is claimed yet.

The initial main-checkout dependency symlink was preserved under the ignored task directory before a local frozen install, because pnpm 12 requires a real worktree dependency directory. No package or lockfile change occurred. No UI behavior changed or new browser acceptance is claimed.

## Full-tier checkpoint

Complete PostgreSQL qualification passed **112 tests, zero failures and zero skips**, with the immutable images above. The process tier is running serially after PG. The four new cases ran in the full tier; a later test-only strengthening also asserts no claim when both media commands are held and receives its focused rerun below. No production source changed after the frozen image build.

Contracts **33** passed. The first concurrent fast server run had 124 pass/1 failure: the existing media-startup test's five-second child deadline expired while the heavier work was active (the child exit code was still null). This is recorded as a failure, not clearance. Run the entire fast tier serially after the process tier, without changing deadlines or suppressing the test. Types, readability lint, formatting, generated contracts and Markdown checks passed; original tags changes remain preserved.

## Final local qualification

- Full PostgreSQL **112** and full process **35** passed, zero failures and zero skips, serially under the pg-docker lease.
- The final strengthened locking file passed all **4** tests, including all-held commands returning no work; its assertions were the only test changes after the full-tier pass. No runtime source changed.
- The complete fast tier rerun, after the heavier work ended, passed contracts **33** and server **125**, zero skips. The unchanged media-startup deadline passed. The earlier concurrent failure is retained above rather than relabelled as a pass.
- Full workspace typecheck, readability lint, formatting, generated-contract and Markdown checks passed. Frontend/Python/scanner source and contracts are unchanged; no additional UI or provider qualification is claimed.

Exactly **17** row-lock statements use Drizzle's builder; **6** transaction advisory statements and **1** manual dispatch join use parameterized Drizzle SQL. `transaction`, executor transaction ownership, dedicated session writer lock, migration/maintenance locks, grants, all migration files and dependencies remain unchanged. Only the two existing capture table mappings were added. Existing schema-catalog checks include them.

All owned fixtures have disposed through their existing harness. The pg-docker lease is released after final checks; no browser lease or preview was started. The tags investigation remains at three original uncommitted entries and retained4310 stays untouched. A fresh read-only reviewer must check the exact commit before push/publication; final SHA, verdict, hosted CI and merge result live with the PR/external coordination record to avoid a self-referential unreviewed commit.
