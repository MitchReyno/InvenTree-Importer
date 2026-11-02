# Drizzle phase 2 and retained small follow-ups

Status: plan written before source changes on `refactor/intake-drizzle-phase-two`, based on `interactive-app` at `e3647dc` after PR 59. Mitch requested this work in a separate PR and asked the root agent to implement directly. Mitch explicitly ACKed the linked 21-table declaration proposal in the conversation before source implementation.

## Scope, ownership and decisions

The root agent owns implementation, tests, architecture/task records and qualification. A fresh read-only reviewer checks each new commit; it never edits or implements. One PR targets `interactive-app`. Mitch subsequently authorized merging this PR once its local review and CI are green, then starting T10 in a new PR without another kickoff question. Keep the preferred WebSocket agent-interaction direction; no actual provider or protected-target authorization is implied.

- Extend the existing owning Drizzle schema modules only with the declarations in the [schema proposal](intake-drizzle-phase-two-schema-proposal.md), after ACK.
- Convert ordinary reads/inserts/plain keyed updates on the caller's existing Pool or checked-out client in the deferred executor modules, operator-review reads and media-preparation seams. Add capture-observation mappings and deployment readers needed by those paths. Reconcile the older phase 1 inventory against current T09 code rather than promising its historical count of 27.
- Keep row/advisory locks, guarded/CAS/increment updates, lock-establishing upserts, aggregate/recursive/multi-table existence probes, `public.`-qualified authority reads, transaction commands, grants and migration SQL explicit. Preserve ordering, bytes, errors and refusal behavior. `executeDatabaseQuery` preserves original pg failures.
- Close the phase 1 test gap by driving a real merge through `applyRestructure` above 2^53 and verifying both lineage and retirement inserts as exact decimal text.
- Add actual process-tier and owned-browser coverage for selected Part attachments using the media decoder, existing fake and original approval/run. No provider or protected-server access.
- Fix pre-queue Results wording: distinguish planned/unstarted Part/effect operations from uncertain attempted effects. Preserve server-advertised original-run recovery and every uncertainty fence.
- The narrow Capture back bug is already fixed and regression/browser-qualified in merged PR 59; retain those tests, do not duplicate or reimplement the fix.

No new dependencies, migration, generated/public HTTP contract or feature flags. No broad rewrite of all legacy manual/capture SQL: the phase 1 deferred boundaries and explicit necessary observation/deployment seams define this task. Existing T09 schema declarations stay in place. New modules own their declarations without cross-owner SQL access.

## Hard boundaries

Never invoke actual provider/agent runtimes or paid APIs. Never load/copy the original root `.env`, copy credentials or send the real InvenTree any requests; use only separately injected synthetic credentials and owned fakes. Preserve every worktree/branch/untracked file and retained data, especially the superseded tags investigation. No deployment, force push, reset, clean, merging main/PR 32 or restarting/faulting shared PostgreSQL. Retained 4310 and user port 4350 stay untouched. Take the pg-docker/browser leases before shared fixtures; release only owned leases after cleanup.

## Files and interfaces

Expected production paths: `intake-server/src/{db,capture,execution,review}/schema.ts`, deferred query sites under `execution/{authority,source,apply,verification,delivery,attachment-index,media-source,effects-source}.ts`, `operator-review/{review-state,impact}.ts`, `review/media-preparation.ts` and the observation-only statements in `capture/repository.ts`. Existing public return shapes and borrowed-connection ownership stay fixed. Ordinary selected query output may use explicit projections to preserve established boundary shapes; any bigint becomes BigInt internally and exact decimal text at existing interfaces.

Follow-up paths: existing PG operator-review/Drizzle tests, process manual tests/support, explicit browser fixture, Results components/tests, owning architecture docs and this record. No production transport/approval widening. Allocation of migrations: none.

## Alternatives and rationale

Reuse pinned Drizzle 0.45.4, its existing adapter and the reviewed patterns from phase 1. Do not add an ORM, schema generator, loader or helper framework. A conversion that changes locking or obscures a SQL authority probe is worse than retaining explicit SQL. SQL migrations continue to own every constraint, cycle, index, trigger, grant and immutable byte rule; declarations are driver mappings, never DDL authority. Preserve public-qualified reads because `pgSchema('public')` is unsupported by the pinned Drizzle version. No package research or installation change beyond the frozen existing lockfile is needed.

## Sequence and verification

1. Obtain the schema proposal ACK; until then do only plan/proposal and independent follow-ups.
2. Add declarations exactly against current migrations, including null/default/type fidelity, then convert each eligible call site without changing transaction/order/lock behavior. Classify retained SQL and report actual counts.
3. Add bigint merge and Part-attachment process/browser regressions plus honest pre-queue Results behavior.
4. Run typecheck, frontend/readability lint, format/readability checks, generated-contract checks, contract/server/frontend tests and build. Run the full PostgreSQL/process tiers under the pg-docker lease with immutable decoder/probe images; rebuild if media/contracts inputs change.
5. Qualify desktop/narrow Results and selected Part attachments against the owned media preview with recordings off. Track inspected screenshots and distinguish observed, fixture-only, blocked and untested claims.
6. Update architecture and this task record with decisions, adverse evidence, actual checks and remaining limits before committing. Fresh read-only review after every commit; fix/review until clean, then push/create the separate PR and verify exact-head CI.

Negative cases: exact bigint revision above 2^53, empty selections, nullable left-join rows, SQLSTATE preservation, stale/conflicting authority, duplicate selected recovery, source guard reacquisition, malformed/unattributed attachment responses, missing approved media, restart with retained output, later round without duplicate Part/stock/upload, and no recovery action before a run is dispatched. Preserve every existing protected-target and unknown-write test.

## Live state and evidence

UI PR 59 merged at `e3647dca89b6db3d0dcfc01c2b53886ea8eb9a8a`, pinned reviewed head `bc7c85f2b098eb44660c674c4189ce160bd9d5c2`, with hosted 4 pass/5 path skips and local frontend129/PG98/process32. Its feature branch remains present. Implementation is complete and qualification is in progress; review and publication remain pending. The schema proposal was ACKed before source changes.

## Implementation decisions

The query-only `checkDeployment` authority port remains explicit SQL: `ExternalGate` intentionally supplies only `query`, not a Pool/client. Converting it would require widening that port or claiming capabilities the object does not guarantee. Ordinary deployment readers with real borrowed clients use the ACKed declarations. Explicit projections preserve established snake_case boundary shapes where appropriate; bigint values are explicitly converted to decimal text at those boundaries. No shared adapter or connection contract was widened.

## Query inventory and retained SQL

52 ordinary statements were converted: authority 21, source 4, apply 10, verification 4, delivery 1, attachment index 2, media source 1, effects source 1, operator review-state 1, impact 2, preparation media 2 and capture observations 3. The executor target files retain 15 explicit statements: ordered target/run/guard locks, lock-establishing source/guard upserts, cancellation/attempt aggregates, compare-and-set guard release and the query-only deployment authority gate. The other 36 capture repository statements are outside the observation-only seam. This reconciles current code rather than repeating phase 1's historical count. Simple keyed existence reads use typed projections; complex authority probes elsewhere remain unchanged.

## Qualification so far

- All 21 mappings match actual migrated PostgreSQL column types, nullability, default presence and primary-key order. Every bigint mapping uses BigInt.
- Full PostgreSQL tier: 101 passed, zero skipped. Includes exact deployment revision and actual merge lineage/retirement above 2^53.
- Frontend: 130 passed. Contracts: 30 passed. Server: 122 passed on full rerun. The first server invocation hit the existing five-second startup-test deadline while frontend workers, build and database qualification competed for CPU; no timeout was widened. The full rerun after frontend/build completed passed.
- Typecheck, frontend/readability lint, generated-contract check and build passed. Build retains the existing large-chunk warning. Final formatting/Markdown checks and process/browser results follow below when complete.

Application model/provider calls and protected-server requests remain unperformed. The tests use explicit synthetic configuration, owned HTTP fakes and immutable decoder/probe images; no root environment file is loaded.

## Completed process and browser evidence

Full process tier: **33 passed, zero skipped**, using immutable decoder `sha256:df198b4d9d2acd9bb77404333deba19fd8cf058cee210a97a7e7f725254e5cb2` and sandbox probe `sha256:e914a5940a4885b6f1a2fc3092f83058680f13425a370003df41f30b38b7c900`. The new process test sends a selected retained PNG through the actual separately launched web/DBOS runner. It proves zero POSTs before explicit queueing, incomplete remote attachment response with retained ID 13001, restart of web/runner/fake, inspection under the original run, selected untouched-stock resume and a later lot round. Exact cumulative counts: one Part POST, one attachment POST and two stock POSTs; the stored attachment equals the original 93-byte PNG. Existing crash, lost acknowledgement, cancellation, unknown-write and controlled-child tests all remain passing.

Browser qualification used `pnpm db:intake preview:attachments` with the explicit decoder image under both leases and recordings off. Real UI clicks selected only Packet A, marked it reviewed, prepared its exact effects, approved, then explicitly queued the original run. The frozen preview contained the selected Part file and excluded Packet B. Before queueing, Part and effect cards said planned/not queued with no premature resume controls. After a page reload, retained Results showed usable Part 8101, attachment 13001 with matching inspection and stock 7101. Independent synthetic DB reads found exactly one Part, attachment and stock POST; attachment bytes were 93 and SHA-256 `5508408dfab979e10b479c4d64941a1336e6bf445b82290cf3b33ddd213902f8`. No browser restart/recovery claim is made: that adverse journey is process-tier evidence.

Inspected screenshots: [approval desktop](../bench-intake/evidence/drizzle-phase-two/approval-desktop.png), [planned desktop](../bench-intake/evidence/drizzle-phase-two/planned-desktop.png), [planned phone](../bench-intake/evidence/drizzle-phase-two/planned-phone.png), [confirmed desktop](../bench-intake/evidence/drizzle-phase-two/confirmed-desktop.png), [confirmed phone](../bench-intake/evidence/drizzle-phase-two/confirmed-phone.png). Actual phone viewport and document width were both 390px, with no horizontal overflow. Desktop viewport was 1440px. Browser input initially missed because of the retained native zoom; explicit device metrics restored correct CDP coordinates. The disconnected harness was restored through its documented local connection approval. The background tab did not refresh automatically during execution; a real reload showed the durable confirmed result. Live/focus/reconnect projection behavior remains T10 work, not a claim of this PR.

The owned tab was closed after restoring viewport metrics and the owned preview was gracefully stopped. Existing worktrees, retained listeners and protected configuration were left untouched. Final format check passed after formatting the new merge regression. A broad Markdown formatter also touched unrelated documentation; those incidental changes were restored byte-for-byte from the branch base before continuing with scoped formatting.

## Reproduction and limits

Use Node 24 and the frozen pnpm lockfile. Run `pnpm typecheck`, `pnpm lint:readability`, `pnpm lint:frontend`, `pnpm lint:markdown`, `pnpm format:check`, `pnpm contracts:check`, `pnpm test:frontend`, `pnpm test:intake` and `pnpm build`. Under the acquired pg-docker lease, set explicit immutable `INTAKE_MEDIA_DECODER_IMAGE` / `INTAKE_MEDIA_PROBE_IMAGE`, then run `pnpm db:intake test` and `pnpm db:intake test:process`. For the browser also acquire its lease, run `pnpm db:intake preview:attachments` with the decoder image and navigate to the emitted owned URL. Fixture metadata in ignored `.amp/in/artifacts/part-attachment-preview.json` contains only task identifiers and owner PID; the fixture uses synthetic private runtime configuration.

All external effects above are **fixture-only**. PostgreSQL, process separation, decoder sandboxing, exact bytes, UI behavior and the listed request counts are **observed** on those fixtures. Actual providers, protected inventory writes, deployment, release qualification and final identity/access gates are **not tested/unauthorized**. No migrations or constraints changed; rollback is the normal reviewed code revert, with existing database history preserved. Review and exact-head hosted CI are the remaining publication gates.
