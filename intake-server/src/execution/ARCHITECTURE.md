# Narrow stock executor

This module implements T03, with T04 consuming its public seams from the manual approval API. The [owning handover](../../../docs/handovers/bench-intake-T03.md) records evidence and limitations. The [server architecture](../../ARCHITECTURE.md) describes the integrated manual boundary. No import, web startup, migration or scheduler acknowledgment launches physical apply.

## Scope and capability

Only existing Part references and new stock are supported, with exact positive canonical decimal quantity, an explicit existing location or null, and the frozen `bi1:<originalSourceKey>:<contributionKey>` barcode. There is no Part creation, mutable plan, arbitrary URL/action, attachment, provider, credential lookup or Python dependency. `plan.ts` reuses the shared TypeBox scalar patterns and strict canonical-byte helpers; it rejects unknown fields, changed build, invalid scalars and unsupported capabilities before reservation or transport.

The sole qualified capability is **`owned-fake-stock/1`**, not an InvenTree version alias. The inspected InvenTree 1.5.0/API530 stock serializer lacks writable `barcode`; `barcode_hash` is read-only. This executor does not claim that posting its fake payload to that API assigns a barcode or provides attribution. Unsupported real profiles are rejected, not optimistically retried. Qualification of a real profile requires a separately reviewed endpoint/effect policy and observed disposable HTTP evidence. Deterministic barcodes are original-contribution attribution, never server-side create idempotency.

## Authority and server-internal integration

Migration `0003_executor.sql` depends only on `0001_foundation.sql`. There is no dependency on capture SQL, shared browser DTO changes or migration 0002. Executor tables retain deployment, original-source mappings, approval bytes/digest, run, operations, cancellation/recovery selections and request/result/effect/verification authority. Composite FKs bind exact parents. Immutable triggers and narrow runtime grants prevent rewriting/deleting history. The retained source guard has a mutable active-run pointer but immutable identity; contribution uniqueness also spans all original-source aliases for a target. DBA/migrator DDL remains trusted, not a tenant security boundary.

T04 supplies original source/contribution authority from retained server-owned lineage through its constrained native-source bridge. New browser IDs are not evidence of new contributions. `retainOriginalSource(client, { targetId, sourceId, originalSourceKey })` is an immutable source-owner enrollment seam, provisioned separately from approval/apply roles. Reenrollment with a changed original key conflicts. It is not an approval shortcut, source inference algorithm or HTTP route.

After its own current review/dependency/access checks, T04 calls `reserveApprovedStock(client, reservation)` inside its caller-owned transaction. A reservation includes `approvalId`, stable `preparationId`, proposed `runId`/`commandId`, authenticated `actorId`, and **the exact retained** canonical `bytes`/SHA-256 `digest`. The bytes decode as `StockPlan` in `plan.ts`. Do not regenerate an approved plan from a mutable projection or use `encodePlan` to hide changed retained bytes. Caller commit atomically includes its domain approval/events/idempotency and this module's approval/run/operation/command/outbox/source reservation. Changed bytes or actor under the same preparation conflict; exact replay adopts the original run/command/approval, never a new run. `executorTransaction` is the qualified no-retry pg transaction wrapper, including borrowed-client socket-error handling and uncertain COMMIT propagation. `loadRun` additionally returns the verified retained `planDigest`; consumers do not read executor approval SQL for it. `source.ts` owns source locking/history and qualified deployment lookup. The delivery grant is read-only over executor authority, with only shared outbox acknowledgment updates; approval/apply grants stay separate.

Original approved contributions stay pinned even after cancellation, safe partial settlement, a later round, stock consumption or deletion. Safe new contributions may proceed only after no unresolved source history remains. Original pending/proven-not-sent work uses `selectRecovery`, not a fresh preparation/run. Unknown creates block siblings, old recovery selections and later source rounds. No barcode/payload search, broad retry or replacement-stock action exists.

`deliverStockCommand(pool, dbosClient, commandId)` validates retained original run/command authority before one bounded delivery through the foundation's public DBOS adapter. Scheduler identity/full arguments/version/queue must agree before outbox ACK. This does not start apply or grant a write. T04’s separately started scheduler handler independently binds the retained command and invokes `startApply` with trusted owned-fake deployment settings. The executor module itself installs no scheduler daemon or HTTP route.

## Physical ownership and restore boundary

`startApply` in `supervisor.ts` is the explicit process-launch seam. Deployment supplies private `databaseUrl`, `gateRoot`, target-bound `profile`, original `runId`, and optional selected `recoveryIds`. These are trusted server settings, never browser URLs/raw keys. The supervisor acquires an atomic, non-expiring host claim before forking `worker-main.ts`; only this physical child creates the writable transport closure. Secrets travel over private IPC, not command arguments or inherited root environment. It is serial, single-host execution, not distributed failover.

`ownership.ts` combines that host claim with a **dedicated, never-reconnected** advisory PG connection keyed by immutable deployment. Connection loss stops new sends even though the OS child may still survive. Another advisory client acquiring the now-free PG lock is not physical exclusion: the retained host claim still blocks a replacement. Only the supervisor that has observed its own child's exit releases its claim. Supervisor SIGKILL, failed claim publication or ambiguous child startup retains the claim indefinitely. There is deliberately no heartbeat timeout, stale PID test or automatic lock stealing. No automated stranded-claim recovery command is provided; trusted operational quiescence/reaping and reconciliation are prerequisites for a future procedure.

Runtime never creates/enables deployment activation. Missing, disabled, corrupt, nonprivate or mismatched external state blocks apply, including the first writer. Trusted deployment provisioning must create private external `activation.json` and `witnesses/`, outside the app database/backup, binding deployment/epoch/target/context/origin/continuity/build/capability. Before each mutation, an exclusive durable witness file is written and file/directory synced after PG intent COMMIT, before HTTP dispatch. Every retained witness must match surviving PG intent/approval digests before any apply request. Restoring PG before a remote create therefore cannot become a clean source under fresh run/source IDs. Restoring or deleting external evidence alongside PG defeats that independent anchor and is outside the supported protocol; host move/restore must disable activation and reconcile continuity first. No code silently enables a new epoch. Broader coherent backup/restore tooling belongs to T10.

## Intent, cancellation, certainty and verification

`apply.ts` revalidates bytes, command/build/deployment, source ownership, cancellation version and selected recovery under ordered target → source → run locks. Each Part/location precondition read and stock create has an immutable committed request intent. Failed/lost COMMIT ACK propagates without a send. After intent, health/witness checks precede a single physical HTTP call. A known local refusal before dispatch may commit `proven_not_sent`/`none`; a crash with only an intent is unknown. Already authorized/in-flight work can finish after cancellation/connection loss; no subsequent request is authorized. T04 owns command-level semantic idempotency around cancellation/recovery selection; a later distinct cancellation version revokes older recovery selections.

The transport uses core Node HTTP with no proxy discovery, pooling, retry or redirect following. Native Fetch was rejected because an observed HTTP421 implicitly replayed a POST despite `redirect: manual`. The reviewed loopback alias protection is unchanged. Requests have a five-second transport deadline, and `response.ts` caps response bytes at 64 KiB with a separate five-second body deadline. Only complete HTTP201 stock identity, Part, exact quantity, location and barcode confirmation yields `confirmed`. A valid returned PK is retained even when other response fields are incomplete. Lost/malformed/redirected create outcomes remain unknown; error status alone is not a no-effect proof.

`snapshot` reports original run, per-operation certainty, `confirmedStockIds` and all trustworthy `attributedStockIds`. It is a journal summary, never retry permission. `verifyKnownStock` is an explicit original confirmed-output GET, retaining a committed intent/result/receipt and using only a read closure. Matching, consumed/changed, missing or unavailable receipts never authorize replacement and never rewrite the original effect. Unknown creates cannot be adopted merely by finding matching-looking stock. T04 owns actor/object access before calling these internal seams and public safe DTO/error mapping; no browser API is added by T03.

## Reproducible checks

From the repository root, pinned `pnpm test:intake`, `pnpm db:intake test`, `pnpm db:intake test:process`, `pnpm typecheck` and `pnpm contracts:check` exercise the public module seams, PG constraints/permissions, real TCP COMMIT-ACK loss, actual killed/surviving processes and owned HTTP. Follow the service ledger before running database tiers. `tests/fixtures/inventory-fake.ts` persists wire requests, stock and fault controls in owned PG, retains them across listener restart and does not stand in for production persistence. Independent literal request bodies/counts/PKs distinguish duplicate creation from a merely successful status. These are real PG/process/HTTP with a deliberately controlled inventory fake, not real InvenTree or a T04 end-to-end browser flow.

## Additive retained attachment children

`media-plan.ts` adds `bench-media-plan/1` and `owned-fake-media/1` without reinterpreting
stock-v1 bytes. Its supporting evidence and explicit attachment destinations are sealed
and pinned inside original approval reservation. No current media pointer can reconstruct
missing approved scope. Before any stock request, apply checks every supporting blob.

`attachment-apply.ts` and its journal/state/recovery helpers use the same physical supervisor,
external witness and source guard as stock. Each attachment read/write has its own committed
intent. Confirmation requires exact downloaded bytes and stock/artifact identity. A lost ACK
is unknown until explicit supported verification. A positive no-effect receipt permits only
selected original-run attachment repair; the stock loop is skipped. Historical confirmation
survives later removal and never grants replacement authority. The qualified protocol is an
owned persistent fake, not an InvenTree API compatibility claim.

## Additive supported effects

`effects-plan.ts` adds `bench-effects-plan/1` and `owned-fake-effects/1` beside the stock and
media plans. Migration `0010_supported_effects.sql` adds the effects journal, Part identity
and transfer tables, and the immutable triggers and projection events those rows use. Legacy
stock and media bytes stay on their own versions. `applySupportedEffects` only orchestrates:
`effects-journal` commits one intent, result, effect or assessment; `effects-request` sends
at most once and checkpoints; `effects-body` builds the create payload; `effects-preconditions`
completes catalogue reads; `effects-evidence` attributes every trustworthy PK. Part
attachments go through `applyPartAttachmentEffect`. Guard reads, cancel-version aggregates
and the source-hold release stay explicit SQL.

A new Part is one `POST /api/part/?tags=true` whose body is name, category, the approved tag
names and `copy_category_parameters: false`. Extra observed tags still confirm. Missing
requested tags, blank names, control characters, names over 100 characters, more than 32
names and ASCII case duplicates do not. Non-ASCII names compare exactly. An existing Part is
read, not patched. A lost Part acknowledgement stays unknown and blocks another create.
Consumed or deleted stock can be verified and cannot authorize a replacement. Unconfigured
media cannot carry evidence, lot attachments or Part attachments.

These checks use the owned inventory fake. They do not prove a live InvenTree mutation.
