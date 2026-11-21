# 5. Transactions, queries and operations

[Model index](README.md)

## Atomic command boundaries

Stateful commands use expected revisions, authenticated authority and a payload-bound idempotency key. Parsing/validation and preparing immutable blob bytes can happen before a transaction; the transaction must revalidate all dependencies before publishing references. Use bounded transaction retries only for side-effect-free database work. Remote reads can be repeated under their read budget; remote writes must never be inside a retried database transaction.

| Command | Lock/recheck | Atomic writes | Outside transaction |
| --- | --- | --- | --- |
| Capture file/note | Batch authorization/revision; blob publication lock | Blob/evidence version/current pointer, audit/event, dedup response | Receive/decode/verify/publish bytes before retained receipt |
| Edit field/default/media/link | Batch/affected subjects/current selection heads; compute shared impact | Immutable revision/candidate if needed, current pointer/revision, supersede affected work/issues, audit/event | UI refetch and queued recomputation |
| Accept proposal | Job/selected attempt/input dependencies/message identity | Accepted message/proposal/candidates or stale disposition, job state, questions/events | Native runtime already completed bounded command |
| Answer question | Question/current input, producer job/preparation, actor and typed value | Answer/new selections/new input/next attempt or preparation command/outbox, close question, audit/event, dedup response | Dispatch continuation; never hold worker while waiting |
| Mark reviewed | Exact subjects/dependency fingerprints/issues | One review per named subject plus issue bindings/events; all requested scope or none | UI can show rejected blocked scope without pretending it was reviewed |
| Prepare | Validate original input and complete target reads; recheck dependency set on publish | Immutable plan/index/selected lots/artifact refs or durable question instead | Read-only target work and hashing; no inventory mutation |
| Approve | Source guard, current target/config, batch/dependency/review rows, plan digest | Approval/run/operations/guard/command/outbox/audit/event/dedup result | Supervised apply starts only after commit |
| Authorize request | Source guard/run/operation/current epoch/cancel/preconditions | Unique exact request intent; operation transition | One actual HTTP send after successful known commit |
| Checkpoint result | Same original run/request/operation | Result/effects/receipts/summary/event in one commit | Next send waits for this commit |
| Cancel/recover | Source guard/run/current revision and supported policy | Durable cancellation or selected action/command/outbox/event/dedup | Signal/check worker; inspect/settle original effect, no rollback |

Use one consistent lock order when a command touches several domains: idempotency key, target configuration head, source guard, batch, subjects/current heads sorted by ID, job/attempt/question, run/operation/request, then event-stream heads sorted by ID. Skip nonexistent domains rather than reverse order. Approval/recovery never acquires a source guard after locking its run. New rows whose FKs form cycles use preassigned IDs and deferred FKs within the transaction; no committed half-binding. Avoid network calls while holding these locks. Actual DDL tests must prove deadlock/retry handling, not merely repeat this list.

Preparations and reviews are optimistic snapshots. Remote inventory can change after preparation; execution repeats the approved preconditions and rejects changed effects/identity, returning to review. PostgreSQL locks cannot stop another InvenTree client. A failed request is not necessarily a no-effect request.

## Events and audit tables

| Table | Columns beyond shared conventions | Constraints and meaning |
| --- | --- | --- |
| `ui_stream` | `stream_key text UNIQUE`, `batch_id?`, `head bigint`, `retained_after bigint` | One stream per batch plus one owner-global notification stream. Nonnegative counters; global stream contains redacted notifications, not duplicate authoritative facts |
| `ui_event` | `stream_id`, `sequence bigint`, `batch_id?`, `kind text`, `public_payload jsonb`, `created_at` | PK `(stream_id,sequence)`; bounded versioned DTO, no provider secrets/raw runtime/source HTML. Same transaction as represented domain/projection change |
| `audit_event` | `actor_id?`, `command_id?`, `batch_id?`, `run_id?`, `action text`, `safe_details jsonb`, `created_at` | Append-only human/system action attribution, distinct access/retention from public events. System producer must be attributable; no chain-of-thought or token dumps |
| `backup_manifest` | `deployment_epoch_id`, `database_boundary text`, `blob_manifest_digest`, `version_document jsonb`, `completed_at?`, `verification_state text` | Operator diagnostic record with external retained manifest counterpart. Not proof that a restored snapshot contains all later remote effects |

Event position is allocated under a `ui_stream` row lock **held until the domain transaction commits**. A normal `bigserial` is not sufficient because a later allocated value can commit first. Write represented facts and event together; `NOTIFY` only wakes readers after commit. Cross-stream transactions acquire stream heads in a stable order. No per-token progress events: coalesce transient progress; durable domain/result transitions must be retained before delivery.

```diagram
product/journal transaction → update projection + stream head + ui_event → COMMIT
                                                                           │
                                                                    wake SSE reader
                                                                           │
                                                         browser receives after cursor
                                                                           │ gap/expired
                                                         snapshot state + matching head
```

Snapshot reads use one repeatable-read view for state and stream head. Replay is strictly after that cursor; cursor format includes stream identity, not a global number ambiguous across batches. On expired history or wrong stream, send explicit reset and a fresh snapshot. Session revocation is checked on connect and periodically during long streams. Browser/SSE disconnection never cancels or retries a run. Event deletion cannot remove journal/audit/approval records.

## Query-driven indexes and projections

In addition to PKs, unique keys and FK indexes, plan the following indexes. Add only measured JSONB indexes later; do not GIN-index every snapshot. Cursor pagination always includes a deterministic tie-breaker.

| Query | Index / projection |
| --- | --- |
| Recent active batches | `batch(owner_id, updated_at DESC, id)` partial where `archived_at IS NULL` |
| Lot review queue | `subject(batch_id, kind, retired_at, id)`, `lot(batch_id, disposition, part_subject_id)`; join effective selections/current dependency readiness |
| Evidence and exact citations | `evidence(batch_id, removed_at, id)`, `evidence_version(evidence_id, version DESC)`, `candidate_source(evidence_version_id)` and `evidence_link(subject_id)` |
| Fact inspector | Unique current `field_selection(subject_id,field_key)`; `fact_candidate(subject_id,field_key,created_at DESC,id)` |
| Waiting work/questions | Partial `job(batch_id,state,id)`; `question(batch_id,state,created_at,id)` for open questions |
| Attempt history/messages | `job_attempt(job_id,attempt_number DESC)`, unique `attempt_message(attempt_id,sequence)` |
| Eligible outbox | Partial `outbox(available_at,command_id)` where no ACK/conflict; claim expiry filter included in dispatch query |
| Approval/result history | `approval(batch_id,round_number DESC)`, `run(approval_id)`, `operation_execution(run_id,state,operation_key)` |
| Same-source safety lookup | PK `source_guard(target_id,source_id)`, `run(target_id,source_id,created_at DESC,id)` |
| Actual requests and unknown outcomes | `request_intent(run_id,authorized_at,id)`, `effect(run_id,certainty)`, `request_assessment(request_intent_id,created_at,id)` |
| SSE catch-up | PK `ui_event(stream_id,sequence)`; bounded owner-global notification reads |
| GC/pinning | Index every blob FK and `snapshot_blob(blob_id)`, `plan_artifact(blob_id)`; never infer reachability from a UI list |

Start with SQL joins/views for batch counts, review readiness and cumulative lot outcomes. If expensive, materialize a rebuildable `batch_summary`/`lot_outcome` projection with a source revision watermark; rebuilding must not run inventory mutations. Operation/request/effect tables are authoritative for execution; UI cache and search indexes are not. Do not use client localStorage as business persistence.

## Security and ownership of writes

Use separate database roles/process credentials where practical. API domain commands can create approvals only with a live authenticated session; research cannot write approvals, run journals or raw target requests. The apply process reads exact approval artifacts and writes its journal but cannot grant itself more approved scope. Outbox dispatcher can mark delivery, not approve. A shared DB does not require every process to have unrestricted table access. Narrow repositories or stored procedures enforce cross-row commands; database admin access remains trusted/outside the threat boundary.

All uploads/downloads/answers/approvals/SSE enforce owner/object authorization and CSRF/origin policy. Private blob hashes are not access tokens. Audit identity is an FK to the stable operator, not a string sent by the browser. Bootstrap enforces the [complete permission gate](01-identity.md#mandatory-access-qualification) before workspace data is returned. Approval, background dispatch/resumption and privileged target sends recheck current acting-user authority; historical qualification is not a grant. Delegated secrets stay server-side with inventory-write access restricted to apply authority; the research broker has a semantic read allowlist. A service credential cannot bypass missing user permissions. Failed requalification blocks new effects without erasing in-flight uncertainty or authorizing replay. Untrusted PDF/image/source parsing runs under bounded resource/file/network permissions. Plaintext provider credentials are never database rows.

## Retention, backup and restore

Archive first; initial release has no general destructive delete/reset endpoint. Unreferenced failed uploads and aged orphan staging bytes may be collected with positive reference checks. Retain evidence/history needed by any selected assertion, input snapshot, review, plan or unresolved/confirmed effect. All approved plans/artifacts, source identities, source guards, request/effect/assessment history and actor attribution remain pinned. Restrict cyclic FKs rather than `ON DELETE CASCADE` through recovery authority. Event retention can be shorter and prompts a snapshot reset.

For a coherent simple backup, stop new approvals/dispatch, settle or explicitly reap apply, quiesce remaining state publishers, then snapshot PostgreSQL (including scheduler state) and all referenced blobs/configuration. Keep encrypted secrets/keys separately with a restore procedure. A backup older than a remote create may have no local trace of it. Therefore every restore/clone starts with apply disabled **outside the restored database**; compare external manifest/epoch and retained later evidence before explicit activation. Lost attribution may require a permanently blocked source, not force-clear.

```diagram
quiesce → PostgreSQL snapshot + referenced immutable blobs + external manifest
                                      │
                  restore isolated, external APPLY DISABLED gate
                                      │
              validate versions/hashes/authority and possible later remote writes
                                      │
                       explicit safe activation OR remain blocked
```

A database epoch row/advisory lock cannot detect a DBA invisibly rolling back the whole machine. Document unsupported rollback/external-writer cases and require the operator restore workflow. Backup validation must include a fake remote create after the backup, then restore and assert **no replay**. A green database restore is not sufficient application recovery evidence.

## Migration and delivery boundary

Use reviewed SQL migrations with generated TypeScript row types, schema validation and hand-written domain commands; do not let ORM defaults coerce decimal values or add unsafe cascades. Prefer checked text states over PostgreSQL enums while vocabulary evolves, with explicit allowed transitions. Add nullable columns/backfill/validate before tightening constraints; quarantine incompatible jobs/plans, never reinterpret them automatically. Keep exact command/plan/executor versions pinned until work drains. Production DDL needs concrete tests for every declared SQL invariant and deferred cycle.

Do not migrate active Python journals or auto-import their results. Initial TypeScript writes are restricted to new owned fake targets/sources. Before any real transition, inventory target/source history must be assessed and old Python/external writers quiesced; reuse original identities where applicable. Neither a fresh namespace nor the new PostgreSQL database authorizes retrying an old uncertain write. Cross-engine live coexistence is **not designed or enabled** by this model.

Build incrementally: identity/capture and manual facts; research/questions; review/preparation; safe fake-target execution; selected recovery/events; restore/operational qualification. Table groups are ownership boundaries, not a requirement to scaffold every future feature before the first vertical slice. No PO, taxonomy-learning, billing or enterprise tenancy tables are required.
