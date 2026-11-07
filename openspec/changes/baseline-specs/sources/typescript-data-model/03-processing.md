# 3. Processing and durable coordination

[Model index](README.md)

## Provider setup and immutable inputs

| Table | Columns beyond shared conventions | Constraints and meaning |
| --- | --- | --- |
| `runtime_profile` | `provider text`, `runtime_version text`, `tool_profile jsonb`, `instruction_blob_id`, `instruction_digest`, `capabilities jsonb`, `qualification text`, `created_by` | Immutable allowed route/tools/instructions; qualification observed/fixture_only/untested/blocked. Capability assertions are not entitlement or permission evidence |
| `runner` | `name text`, `identity_ref text`, `runtime_profile_id`, `last_seen_at?`, `state text`, `revision` | Private local-channel identity, no native login tokens. State available/offline/login_required/capacity_wait/blocked is diagnostic and can expire; a heartbeat is not an execution lease |
| `input_snapshot` | `batch_id`, `manifest_blob_id`, `digest`, `schema_version text`, `dependencies jsonb`, `created_by?`, `parent_input_id?` | Immutable exact manifest bytes; bound source revisions, answers, values, source hashes, instruction/profile/config versions. Parent must be same batch and acyclic. Manifest schema bounds dependency count/size |

Use an explicit discriminated dependency list in the immutable manifest: subject field-selection revision, batch-default revision, evidence version/link revision, group instruction revision, inventory choice, media selection/derivative, policy/config revision or accepted answer. Resolve and verify every reference at snapshot creation. The manifest retains exact values and referenced blob hashes; it never depends solely on a mutable row or a top-level batch revision. Each typed reference is checked by the service; there is no fake generic FK to arbitrary tables. First release archives referenced rows rather than physically deleting them, so manifests do not become unresolvable. Blob-bearing manifests also populate `snapshot_blob` pins.

| Table | Columns beyond shared conventions | Constraints |
| --- | --- | --- |
| `snapshot_blob` | `batch_id`, `input_snapshot_id`, `blob_id`, `role text` | PK `(input_snapshot_id,blob_id,role)`; same-batch snapshot FK, blob FK; set must exactly cover manifest's retained byte dependencies at acceptance |

This is dependency-aware invalidation, not a general workflow DAG editor. The server knows the handful of stage functions and compares their explicit dependency fingerprints. A shared image edit invalidates all its dependent reviews, not every unrelated job. A model never decides whether its own output is still current.

## Jobs, attempts and received messages

| Table | Columns beyond shared conventions | Keys and rules |
| --- | --- | --- |
| `job` | `batch_id`, `stage text`, `subject_id?`, `logical_key text`, `selected_attempt_id?`, `state text`, `revision` | `UNIQUE(batch_id,logical_key)`; deferred FK `(batch_id,id,selected_attempt_id)` to attempt `(batch_id,job_id,id)` proves the selected attempt belongs to this job. Stage reading/identifying/research/images/inventory. Subject nullable for batch/document-wide work |
| `job_attempt` | `batch_id`, `job_id`, `attempt_number integer`, `input_snapshot_id`, `runtime_profile_id?`, `runner_id?`, `command_id UNIQUE`, `state text`, `started_at?`, `finished_at?`, `safe_failure_code?` | `UNIQUE(job_id,attempt_number)` and `(batch_id,job_id,id)`; exact job/input/profile/version binding. Deterministic media/lookup work need not have a provider profile. Terminal attempts cannot emit current results |
| `attempt_message` | `batch_id`, `attempt_id`, `sequence bigint`, `message_kind text`, `payload_blob_id`, `payload_digest`, `disposition text`, `received_at` | `UNIQUE(attempt_id,sequence)` and `(batch_id,attempt_id,id)`; compare existing digest and bytes before adopting duplicate. Disposition accepted/stale/rejected; retain safe diagnostic reason. Schema-valid is not authorization |
| `proposal` | `batch_id`, `attempt_id`, `message_id UNIQUE`, `proposal_blob_id`, `digest`, `schema_version`, `acceptance text` | Composite FK `(batch_id,attempt_id,message_id)` to message `(batch_id,attempt_id,id)`. Immutable structured proposal, accepted/stale/rejected. Acceptance records validation outcome; accepted candidates never grant selection/approval |

Job states queued/running/waiting_for_user/waiting_for_login/waiting_for_capacity/ready/failed/cancelled/superseded are current product projections. Attempt states queued/running/succeeded/question/interrupted/failed/cancelled/superseded are execution history. An old attempt cannot become selected again merely because its result arrives last. State transitions are conditional updates under the job/attempt locks, not unconstrained arbitrary status setters.

```diagram
job ─► attempt 1 / input A ─► persisted question ─► terminal attempt; slot released
                                      │
                                accepted answer
                                      ▼
              same job ─► attempt 2 / input B ─► structured proposal

late result from attempt 1 ─► retained stale message, no current replacement
```

Start with one active personal inference lane; ordinary bounded image/lookup jobs can run separately. Scheduler/workflow tables remain library-private; do not persist a blocked human wait in that lane. Provider changes create a new attempt/profile binding. Native permission handles are ephemeral runtime capabilities and **not** `question` rows; a restart must not replay an old native allow response. Unsupported entitlement/tool boundaries block inference with no paid API fallback.

## Questions, issues and decisions

| Table | Columns beyond shared conventions | Keys and rules |
| --- | --- | --- |
| `question` | `batch_id`, `attempt_id?`, `preparation_command_id?`, `input_snapshot_id`, `message_id? UNIQUE`, `question_key text`, `answer_schema jsonb`, `prompt text`, `state text`, `revision`, `superseded_by_id?` | Exactly one attempt/preparation producer; partial unique indexes on producer/key. Attempt questions require message ID and composite attempt/message FK as for proposal; preparation questions require null message ID. Typed bounded schema; open/answered/superseded/cancelled. Input must agree with producer; exact current question revision required to answer |
| `question_subject` | `batch_id`, `question_id`, `subject_id` | PK `(question_id,subject_id)`; same-batch FKs support a question affecting several lots/shared Parts |
| `answer` | `batch_id`, `question_id UNIQUE`, `question_revision bigint`, `actor_id`, `value jsonb`, `command_id UNIQUE`, `continuation_input_id`, `continuation_attempt_id?` | Immutable accepted answer; one answer per question instance, not an overwritten conversational transcript. Subsequent correction creates superseding question/input/work as needed |
| `issue` | `batch_id`, `subject_id?`, `evidence_version_id?`, `producer_attempt_id?`, `code text`, `severity text`, `dependency_digest`, `details jsonb`, `state text`, `revision` | Blocking/warning, open/resolved/superseded. Shared Part issue affects dependent lots; batch-level issue can block selected scope globally. Precise scope is part of typed details, validated by service |
| `issue_resolution` | `batch_id`, `issue_id`, `issue_revision`, `actor_id`, `action text`, `reason text`, `replacement_ref jsonb?` | Immutable correction/accept_known_unknown/dismiss_warning; nonempty reason for dismissal. Blocking integrity/unknown-write issue cannot be dismissed into success |

Only the answer transaction creates its immutable continuation. Verify authenticated actor, question currentness, job selection, input dependencies and answer domain. Duplicate command returns the original answer only for the same semantic payload. Correcting a prior count updates selected facts and invalidates dependent work; it does not edit the accepted old answer or approved plan. Application questions also represent preparation choices; their producer is the preparation command, not a provider attempt. `answer.command_id` is the new continuation command for either producer; `continuation_attempt_id` is populated only for a job continuation. Preassign IDs and use deferred FKs for the answer/new-input cycle, inserting the complete binding in the same transaction.

## Command, idempotency and outbox

| Table | Columns beyond shared conventions | Keys and rules |
| --- | --- | --- |
| `command` | `batch_id?`, `kind text`, `actor_id?`, `parent_command_id?`, `payload_blob_id`, `payload_digest`, `handler_version text`, `workflow_id text UNIQUE`, `state text`, `created_at` | Immutable authority payload; kind allowlist includes process/continue/prepare/apply/cancel/recover. State is delivery/handling projection only. User commands have actor; system-derived commands require a validated parent |
| `idempotency_record` | `actor_id`, `action text`, `resource_key text`, `key text`, `semantic_digest`, `command_id?`, `response jsonb`, `completed_at` | Composite unique actor/action/resource/key; created atomically with domain result. Same key/different semantic payload conflicts. Long-lived approval/recovery bindings remain unique even if ordinary HTTP dedup windows expire |
| `outbox` | `command_id UNIQUE`, `available_at`, `claim_token uuid?`, `claim_expires_at?`, `delivery_attempts integer`, `acked_at?`, `conflict_code?`, `last_safe_error?` | Mutable bounded delivery, claim uses `FOR UPDATE SKIP LOCKED`. Lease authorizes redelivery of same immutable command, **not another writer or accepted job attempt** |

```diagram
domain transaction: answer/approval + command + outbox + event
                                       │
                           dispatcher enqueues stable ID
                                       │
                      inspect full existing payload/version
                               │                    │
                              ACK            durable conflict
```

Before acknowledging a duplicate workflow ID, compare actual function/queue/version/arguments with the authorized command, not only the ID/hash. The executing worker independently checks its actual version, command/input binding and current attempt. Conflicts are persisted and removed from the hot eligible set, allowing unrelated work to progress. No schema choice assumes a particular TypeScript DBOS adapter has already passed these gates.
