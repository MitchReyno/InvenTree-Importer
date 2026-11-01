# 4. Review, approval and execution

[Model index](README.md) · This chapter specifies a **new TypeScript/PostgreSQL execution authority**, not Python's existing SQLite tables. None of its fault/recovery guarantees is implemented by writing this design.

## Review and frozen preparation

| Table | Columns beyond shared conventions | Keys, relationships and rules |
| --- | --- | --- |
| `review` | `batch_id`, `subject_id`, `dependency_digest`, `snapshot_id`, `actor_id`, `reviewed_at` | `UNIQUE(batch_id,subject_id,id)`; immutable review of one subject's exact facts/media/choices/issues. Several lot reviews may depend on the same Part. Currentness is derived by matching dependencies, not a permanent reviewed boolean |
| `review_issue` | `batch_id`, `review_id`, `issue_id`, `resolution_id?` | PK `(review_id,issue_id)`; bind exact relevant issue and accepted disposition. Unresolved blocking issue prevents review/approval |
| `preparation` | `batch_id`, `command_id UNIQUE`, `input_snapshot_id`, `target_id`, `target_context_id`, `configuration_id`, `plan_blob_id`, `plan_digest`, `schema_version`, `executor_build`, `effects_digest`, `created_at` | Immutable **successful** preparation. Incomplete read/choice work lives in preparation command/questions, not a falsely executable partial plan. A new choice or changed effect requires another preparation |
| `preparation_review` | `batch_id`, `preparation_id`, `subject_id`, `review_id` | PK `(preparation_id,subject_id)`, unique `(preparation_id,subject_id,review_id)`; composite FK to review `(batch_id,subject_id,id)`. Complete reviewed dependency scope includes selected lots and any affected shared Part; actual plan bytes bind this exact set |
| `preparation_lot` | `batch_id`, `preparation_id`, `lot_id`, `review_id`, `contribution_key`, `effective_values jsonb` | PK `(preparation_id,lot_id)`; typed lot/source links and matching preparation_review `(preparation_id,subject_id,review_id)` composite FK. Exactly selected stock scope; include effective defaults, units, warning dispositions and original IDs |
| `plan_operation` | `batch_id`, `preparation_id`, `operation_key text`, `kind text`, `subject_id?`, `spec jsonb`, `spec_digest` | PK `(preparation_id,operation_key)`; immutable typed specification with exact logical inputs/preconditions/output contract and capability requirements. Key derives from logical identity, not current target PK or topological order |
| `operation_dependency` | `batch_id`, `preparation_id`, `consumer_key`, `producer_key`, `requirement text`, `output_name?` | UUID PK, composite operation FKs in same preparation; no self-edge; unique edge constraint uses `NULLS NOT DISTINCT` on preparation/consumer/producer/requirement/output. Requirement usable_output or settled. Output name required only for usable_output. Plan validation proves acyclicity and named output compatibility |
| `operation_lot` | `batch_id`, `preparation_id`, `operation_key`, `lot_id`, `role text` | Explicit attribution to selected lots: primary/shared_prerequisite. Every lot is in `preparation_lot`; no dependency closure can pull in unselected stock/media |
| `plan_artifact` | `batch_id`, `preparation_id`, `artifact_key text`, `blob_id`, `role text`, `destination_spec jsonb` | PK `(preparation_id,artifact_key)`; frozen original/derivative/supporting evidence bytes and destination. All planned transfers must reference these approved keys or explicitly authorized derived-artifact policy |

Preparation validates current source/selection/default/media/review/config state, complete read-only target observations and supported effects. It never creates inventory. Retain plan bytes as the sole executable specification; relational operation rows are its validated index. Insert plan/operations/edges/artifacts in one transaction, verify they reproduce the exact canonical bytes/digest and reject any later mismatch at execution. Never maintain independently editable plan JSON and operation SQL.

Canonical application documents use a versioned encoding: UTF-8, schema-defined sorted object keys, decimal/integer domain values as strings, set-like ID arrays sorted explicitly, ordered arrays preserved and no non-finite values. Normalize only schema-authorized representations; never normalize arbitrary human text silently. Retain byte-level cross-language test vectors. Approval binds the retained bytes, not a digest recomputed from whatever the ORM currently returns.

```diagram
selected lot A review ─┐
shared Part review ────┼─► preparation ─► exact bytes + indexed operations
selected media ────────┘                         │
                                           approval round

Part prerequisite ──► stock A ──► attachment A
                └─► stock B       (NOT in round A's plan)
```

## Approval and run reservation

| Table | Columns beyond shared conventions | Keys, relationships and rules |
| --- | --- | --- |
| `approval` | `batch_id`, `round_number integer`, `preparation_id UNIQUE`, `plan_digest`, `review_binding_digest`, `actor_id`, `approved_at`, `command_id UNIQUE` | `UNIQUE(batch_id,round_number)`; exact target/config/build/scope retained through preparation. Authenticated actor from server session, never body-supplied. Same preparation cannot create a second approval even under a different HTTP key |
| `source_guard` | `target_id`, `source_id`, `active_run_id?`, `state text`, `revision`, `blocked_reason?` | PK `(target_id,source_id)`, retained forever with history in runs/effects. State idle/reserved/running/blocked. Does not expire on heartbeat, timeout or workflow completion; unknown/missing authority blocks reuse |
| `run` | `batch_id`, `approval_id UNIQUE`, `apply_command_id UNIQUE`, `target_id`, `target_context_id`, `source_id`, `deployment_epoch_id`, `state text`, `revision`, `cancel_requested_at?`, `started_at?`, `settled_at?`, `executor_build` | Canonical immutable binding plus mutable journal summary; composite links prove batch/source/target/approval agree. Run ID assigned in approval transaction. No replacement run for redelivery |
| `operation_execution` | `batch_id`, `run_id`, `preparation_id`, `operation_key`, `state text`, `effect_certainty text`, `revision`, `blocked_reason?` | PK `(run_id,operation_key)` and same-run/preparation FKs. State pending/running/succeeded/failed/blocked/review_required/cancelled; certainty none/confirmed/unknown/mixed. Derived from retained attempts/effects, never a retry permission |

Approval locks current selected dependencies/reviews and the source guard; validates no conflicting unresolved run, then commits approval, canonical run binding, initial operation rows, apply command/outbox and event **together**. Here, unlike the Python filesystem seam, there is no separate reservation-before-journal store: run and initial journal rows share PostgreSQL. Execution still cannot atomically include remote InvenTree effects. A guard pointing to a missing/incompatible run is corruption/recovery-required, not permission to allocate another one.

Both preparation publication and approval inspect **all cumulative contribution history** for the original target/source/lot keys under the source guard, not only its active/unresolved run. Join retained run, operation attribution, request/effect and assessment history. If stock was ever confirmed for that contribution, a new plan may bind its original attributable identity and supported enrichment, but may not authorize another stock create. Missing/consumed/deleted/drifted stock stays review-required, not replenished. Unknown history blocks; incomplete or missing history is not proof of absence. An already-approved pending/failed/proven-no-effect stock operation must use explicit recovery under its original run/approval; this first release does not supersede it with a new round. A new stock operation is allowed only for a contribution with no prior approved stock operation. Request authorization then validates that it is still this same original authorized operation, with no confirmed/unknown earlier create attempt; a further attempt requires original-run recovery policy. This is a guarded command invariant, not a claim that a run-scoped operation key or deterministic barcode alone deduplicates stock.

Run states are queued/running/stopping/settled_complete/settled_incomplete/recovery_required. They summarize the journal rather than grant replay permission. `recovery_required` can include unknown remote effects or missing authority; `settled_incomplete` is only safe where the settlement policy proves no unresolved effect blocks continuation. All terminal/history records remain inspectable after later rounds.

One source guard serializes a batch's rounds. Keep target identity stable across continuity changes; changing endpoint/context/credential cannot bypass blocked same-source history. First release forbids duplicate target aliases to the same server as an escape mechanism, but does not claim global exclusion against arbitrary external users/clients. Do not delete settled runs to release their identity history.

## Attempts, actual requests and effects

| Table | Columns beyond shared conventions | Keys, relationships and rules |
| --- | --- | --- |
| `operation_attempt` | `batch_id`, `run_id`, `operation_key`, `attempt_number integer`, `recovery_action_id?`, `state text`, `started_at`, `finished_at?` | `UNIQUE(run_id,operation_key,attempt_number)`; every attempt stays under original approved operation. New attempt only through a validated safe continuation/recovery command |
| `request_intent` | `batch_id`, `command_id`, `run_id?`, `operation_attempt_id?`, `target_context_id`, `request_number integer`, `semantic_kind text`, `method text`, `endpoint_key text`, `request_spec_digest`, `safe_request_spec jsonb`, `state text`, `authorized_at` | `UNIQUE(command_id,request_number)`; write committed before **each actual send**, including preparation/pagination/verification/transfers. Mutation requires run and attempt; read-only preparation may have neither. Composite links bind command/run/attempt/target context where present. Intent alone means potentially sent; no timestamp proves absence of effect |
| `request_result` | `batch_id`, `run_id?`, `request_intent_id UNIQUE`, `transport_outcome text`, `http_status integer?`, `safe_error_code?`, `response_evidence_blob_id?`, `received_at` | Immutable received result. Outcome response/transport_loss/cancelled_before_dispatch/proven_not_sent. Run scope agrees with intent. No result after crash means unknown for mutations unless independent no-send evidence exists |
| `effect` | `batch_id`, `run_id`, `operation_key`, `request_intent_id`, `kind text`, `remote_model text`, `remote_pk text?`, `logical_output_name?`, `attribution jsonb`, `certainty text` | Append-only attribution: confirmed/unknown. Keep **all** trustworthy returned IDs on malformed/multiple responses; not one lossy `created_pk` column. A response can have confirmed output plus unresolved effects |
| `verification_receipt` | `batch_id`, `run_id`, `effect_id`, `request_intent_id`, `result_id`, `verification_kind text`, `evidence jsonb`, `verified_at` | Append-only observed identity/byte-hash/domain verification. File name match alone is insufficient; content/hash and target-specific route must agree. Failed verification does not erase an earlier accepted effect |
| `request_assessment` | `batch_id`, `run_id`, `request_intent_id`, `assessment text`, `basis jsonb`, `verification_receipt_id?`, `recovery_action_id?`, `created_by?` | Append-only subsequent settlement evidence. Assessment remains_unknown/confirmed/no_effect_proven/needs_review; validated policy decides whether evidence can resolve the uncertainty. Original lost-response record is never rewritten |

`request_intent.state` is a scheduling projection (authorized/observed/settled); request/effect/assessment history is authoritative. Disable HTTP-library automatic mutation retries and redirects. If one logical library call makes three HTTP requests, it needs three intents. Read retries have a single bounded budget and distinct correlated intents. A malformed response retaining a useful PK still checkpoints that evidence before dependent reads/parameters/media.

```diagram
apply process         PostgreSQL journal                  InvenTree
    │ preconditions/cancel/ownership                          │
    ├─ request_intent COMMIT ─►│                              │
    │◄─ commit known ─────────┤                              │
    ├────────────────── one actual HTTP send ────────────────►│
    │◄────────────── response OR transport loss ──────────────┤
    ├─ result/effects/operation + event COMMIT ─►│             │
    │ next send only after durable checkpoint                 │
```

A PostgreSQL commit whose acknowledgement was lost is itself ambiguous: reconnect read-only and inspect the existing intent by stable key, never invent another request identity or blindly send it. If the process may have sent an authorized mutation, retain uncertainty even when a later GET finds nothing. Missing stock may have been consumed/deleted; matching payload/reference/barcode found after an uncorrelated create is not automatic ownership proof. A returned PK with trustworthy attribution can be revalidated, subject to continuity.

## Ownership and cancellation are not expiring leases

Use one dedicated supervised apply process on a persistent host. Before running, hold stable host-level OS exclusion and a dedicated PostgreSQL advisory lock on the configured writer scope, separate from pooled transactions. The database lock alone is insufficient: losing its connection could release it while the old process is still making an HTTP request. No replacement is authorized until the supervisor proves the old process exited/reaped and settles or retains its uncertain request. Source guards survive all process locks. Multi-host failover is unsupported.

Check writer connection health, epoch/external activation, immutable plan/version, guard ownership and cancellation before authorizing each request intent. Hold row locks only for short database transactions, not the network call. PostgreSQL failure halts new authorization/sends; a request already authorized/in flight may finish and must later be reconciled. Process death cannot undo that request. A lost writer-lock connection never silently reconnects into resumed write ownership.

| Table | Columns beyond shared conventions | Rules |
| --- | --- | --- |
| `cancellation` | `batch_id`, `run_id UNIQUE`, `command_id UNIQUE`, `requested_by`, `requested_at`, `observed_at?`, `settled_at?` | Durable stop request, not rollback. Cancel transaction serializes with request authorization on run row; previously authorized request may still be in flight |
| `recovery_action` | `batch_id`, `run_id`, `operation_key?`, `command_id UNIQUE`, `kind text`, `expected_run_revision`, `requested_by`, `policy_version`, `evidence jsonb`, `state text` | Selected resume_pending/verify_known_output/verify_attachment/repair_supported_effect. Exact same approved operation/effect/artifact scope; mismatch returns to separate preparation/approval. No arbitrary handler/URL/force-success |

Resume untouched pending work is different from repeating a failed create. Attachment repair never recreates stock. A confirmed attachment later removed does not authorize another upload automatically. Side-effect-free verification can add receipts without erasing past uncertainty. Unsupported reconciliation stays blocked with retained evidence, even if that is less convenient.

## Later rounds and cumulative output

Run A can settle safely incomplete when a known optional attachment failed before any effect; it need not falsely become successful. If no unresolved/ambiguous dependent effect remains, release the source guard through validated settlement and allow round B. Unknown same-source mutation blocks B. Repairing A later reacquires the same guard under A's original run; it cannot overlap B. History can find any old run even when `active_run_id` points at a newer one.

Round B uses the original lot B contribution and a validated known Part from A. Its plan freezes the prior effect ID/identity and fresh target observation; no new Part create is inferred from a missing browser projection. Lot outcome is a derived view over all its selected operations/rounds, not a mutable `lot.imported = true`. Keep stock registered, supporting work incomplete and unknown separate.

Effect-derived provenance/media archives are deferred from the smallest slice. If introduced, add immutable `run_artifact` rows (`run_id`, approved artifact policy/key, effect-set digest, revision, blob, destination) and per-content transfer history before enabling those effects. Do not quietly attach new bytes or destinations under an old approval.
