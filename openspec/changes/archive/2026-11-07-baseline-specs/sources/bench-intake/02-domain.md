# 2. Domain and persistence

[Design index](README.md) · Logical model and constraints; not applied migrations.

## Physical things, descriptions and sources

A **batch** is a persistent intake workspace. A **lot** is a physical contribution, not an image or a supplier SKU. A **Part proposal** describes a type of component and can be shared by multiple lots. A single photograph may support several lots; several photographs or receipt lines may support one lot. **Evidence groups** organize sources and instructions but do not establish stock identity.

```diagram
Batch ──1:N── Lot ──N:1── Part proposal
  │            │              │
  │            └─────┬────────┘
  │                  │ subject
  ├─ Evidence ──► Assertion candidates ──► Selected values
  │      │                  │                  │
  │      └─ page / region / retained source ────┘
  ├─ Defaults ──► effective lot fields / explicit overrides
  ├─ Job ──► Attempts ──► Questions / proposal revisions
  └─ Approval rounds ──► exact plans ──► Runs / effects
```

Manual notes and known values are also evidence: a no-photo start is valid. A transcription of a label and a user's counted quantity remain separate assertions. The operator can select the count without erasing the observed label. Manufacturer/MPN unknown is not an empty invented value; it is an explicit state that matching and review policy understand.

The relationships above are application concepts. The [companion logical data model](../typescript-data-model/README.md) owns the complete keys, exact-parent composite FKs, deferred cycles and transaction invariants. PostgreSQL owns both product records and the **new TypeScript executor's canonical journal**; Python's existing registry/journals remain separate and untouched. The summary below is not a competing schema.

## Logical records

| Record | Important fields and relationships |
| --- | --- |
| `batch` | ID, title, operator, source identity, draft revision, target binding, instructions, created/archived timestamps; readiness/completion counts are derived |
| `lot` | Stable UUID, batch, original contribution key, Part proposal ID, revision, excluded/deferred flag; no mutable array-position identity |
| `part_proposal` | Stable logical ID, field selections, revision; lot links are explicit and revisable before approval |
| `evidence` | Batch-scoped ID, kind, immutable blob or typed manual content, provenance, retention state; original name is metadata only |
| `evidence_link` | Evidence to lot/Part/assertion, optional page or source-pixel region, relation, revision |
| `evidence_group` | Label, instructions, linked evidence; an organizational hint, not an execution unit |
| `fact_candidate` | Subject/field, typed value, producer, exact evidence-version references, observation/interpretation kind, input fingerprint, supersession |
| `field_selection` | Subject/field, chosen assertion or explicit human value, selection mode, revision, actor, reason |
| `batch_default` | Field/value and revision; provenance retained when materialized into approval |
| `media_recipe` / `derivative` | Original hash, orientation frame, crop/rotation/tool version, output hash, explicit intended destination |
| `job` / `job_attempt` | Logical job, stage, subject/dependency fingerprint; attempt provider/runtime/input identity and lifecycle |
| `question` / `answer` | Typed question, scope, input/attempt/question revision; answer actor, value, validation and immutable continuation |
| `issue` / `issue_resolution` | Blocking/warning, affected scope, producing revision, resolution or reasoned dismissal |
| `review` | Exact dependency fingerprint, selected scope, actor/time, reviewed changes and warning dispositions |
| `preparation` / `plan_operation` | Immutable exact plan bytes plus validated relational index; selected values/effects, source/target/config/build identity, artifact hashes and digest |
| `approval` | Plan digest and selected scope, authenticated actor/time, review fingerprint, immutable approved bytes |
| `command` / `outbox` | Stable command ID, kind, exact payload digest, runtime version, delivery state/conflict disposition |
| `source_guard` / `run` | Non-expiring target/source guard; exact approval/command/source/target/run binding reserved atomically at approval, retained across later rounds |
| `operation_execution` / `operation_attempt` / `request_intent` | New PostgreSQL journal owns selected operation history, original-run recovery and one pre-send intent per actual request |
| `request_result` / `effect` / `verification_receipt` / `request_assessment` | Append-only known identities, uncertainty and subsequent settlement evidence; status/cache is a derived projection, never replay authority |
| `ui_event` / `audit_event` | Durable public cursor/projection change versus security/domain audit; distinct retention and payload rules |

These are logical entity groups; use the companion catalogue rather than inferring missing columns from this summary. Keep typed columns/constraints for identity, revisions, states and relationships; use bounded JSONB for typed assertion values, immutable snapshots and safe diagnostic context. Do not put all domain state in an opaque JSON document or an unbounded event stream. Auth issuer/subject pairs identify the allowed InvenTree owner; sessions and target authority remain server-private, with the complete initial permission gate in [operations](06-operations.md#authentication-and-authorization).

## Identity and revision rules

| Identity | Rule |
| --- | --- |
| Batch/lot/Part | Opaque UUIDs assigned once; moving rows in a table never changes them |
| Source namespace | Persist original batch/source identity once; retain contribution keys across rounds. A new namespace cannot bypass assessed legacy uncertainty |
| Import barcode | Versioned deterministic encoding of original source and contribution, mapped explicitly for legacy imports; never supplier barcode |
| Input revision | SHA-256 of exact immutable manifest bytes, including evidence hashes and recorded answers |
| Draft revision | Monotonic database revision for conflict detection, not a substitute for a manifest hash |
| Approval/run/operation | Stable explicit IDs; operation ID derives from logical subject/kind, not execution order or unknown target PK |
| Target | Configured target identity, endpoint and continuity evidence; matching URL or PK alone is insufficient |
| Executor build | Frozen importer build/plan schema binding; never switch implementation or namespace to escape a blocked prior claim |
| UI cursor | Durable application stream position; never provider token sequence, job attempt sequence or workflow ID |

Use exact decimal strings with declared units and field-specific ranges. SQL stores quantities/amounts as constrained numeric values alongside original lexical source where relevant. JSON never round-trips approved numbers through binary floating point. Dates without times are ISO calendar dates, timestamps are UTC instants, and display timezone does not change historical purchase dates. Unknown, omitted, invalid and explicitly cleared values are distinct tagged states; “0” is a valid value only where the field's domain permits it.

## Defaults versus human decisions

```diagram
Batch default: location = Drawer 4 (revision 3)
          │
          ├─ Lot A: inherit ───────────────► Drawer 4
          └─ Lot B: explicit Drawer 8 ────► Drawer 8

Change default to Drawer 5:
          ├─ Lot A changes; dependent review becomes stale
          └─ Lot B stays Drawer 8; unrelated work stays valid
```

Selection modes are `inherit`, `human`, `accepted_candidate` and `unset`; explicit clearing is a tagged human value with field-authorized cleared semantics, not an instruction to inherit. “Use batch default again” is an explicit command. Rerunning research adds candidates; it never replaces a human selection. A revised candidate accepted earlier needs review if its exact dependency fingerprint changes; accepting “future automatic updates” is not an approval option.

## Revisions and scoped invalidation

Persist dependency fingerprints for a small set of stage functions, not a user-programmable workflow engine. A job input names exactly the source revisions, selected fields, instruction/tool versions and upstream artifacts it used. Accept a result only if its job/attempt remains selected and those dependencies match current state. Retain stale output as history, never as a current selected fact.

```diagram
packet marking ─► identification ─► Part research ─► matching
                                         │             │
shared Part image recipe ──────────────────┼─────────────┼─► review A
                                         └─────────────┴─► review B
lot B counted quantity ───────────────────────────────────► review B
```

A shared Part field/media edit invalidates both reviews; changing only B's count leaves A's review intact. A global batch revision still prevents conflicting writes, but it must not be the sole invalidation key. Final approval revalidates all selected dependencies in a transaction. An approved round's bytes and historical review are immutable; later edits affect future proposals/rounds, not the meaning of earlier effects.

## Reassign, split and merge

Before approval, reassigning evidence or splitting/merging Part proposals is allowed with impact preview. Keep audit history and recompute affected dependencies. Splitting a physical lot creates new lot identities with an explicit lineage link and retires the original unapproved lot; merging unapproved lots creates a new lot only after explicit confirmation that they represent one physical contribution. Do not merge lots merely because their Part/SKU matches.

Once a lot participates in an approved run, preserve its contribution identity. Corrections create a new draft/proposed relationship or a separate explicitly supported inventory-adjustment feature; they cannot relabel the historic write. First release does not split/merge already imported stock or edit historical quantities. A later remaining packet can link to the existing known Part while retaining its original lot identity.

## Blob lifecycle without a distributed transaction

```diagram
selected locally → uploading → staged + hash verified → ready original
                         │                 │                 │
                    retry transfer    crash before DB    derivative jobs
                                      ready commit        can now start
                                           │
                                  orphan staging cleanup
```

For a local store: stream into a private staging path with size limits, verify digest and type, durably write/close bytes, atomically publish to a content-addressed location and sync the relevant directory where supported. Then commit the evidence version and current pointer. Publication and GC take the same digest-level exclusion and check live references so a pending publisher cannot commit a reference to collected bytes. A crash before that commit may leave an unreferenced blob; a reconciliation job can later collect only aged, positively unreferenced staging/orphan data. Never mark an original retained before bytes are durable. On platforms/storage where these guarantees differ, implement and test an equivalent commit/verification contract before claiming retention.

Blob deduplication is storage-only: two evidence records can share bytes without merging their lots, provenance or access scope. Client filename/MIME/hash is untrusted. The server computes the hash, inspects the format and rejects unsupported/encrypted PDFs with an actionable state. A failed file does not remove other retained evidence. Start with bounded whole-file retry, not a bespoke resumable-upload protocol; large-file support can add one later.

## Database invariants and transactions

- Unique source/contribution within the appropriate original namespace, unique command ID with immutable digest/version, unique approval-to-command and command-to-run binding.
- Composite foreign keys tie question answers, reviews, approvals, operations and artifacts to their exact parents. Same-batch alone is insufficient: selected attempts belong to their job; proposal/question messages belong to their attempt. Do not allow cross-batch artifact lookup by hash alone.
- Conditional updates/row locks enforce expected revision and the [shared lock order](../typescript-data-model/05-transactions.md#atomic-command-boundaries). Approval checks source guard, cumulative contribution history, current reviews/issues/target and actor rights, then writes immutable approval/run/initial journal/command/outbox/event together.
- Source guards survive process-lock release. Unresolved effects or missing canonical authority block a new writer; application completion flags cannot release ownership. Preparation/approval inspect cumulative contribution history: confirmed stock is never replenished if later consumed/deleted, and approved pending/no-effect creates remain under original-run recovery, not a new approval round.
- A caller repeating the same idempotency key receives the original outcome only if actor/action and exact semantic payload agree. A mismatch is a conflict, not adoption.
- Side-effect-free transactions can retry serialization failures with bounded retries. Do not perform remote writes inside a retried SQL transaction.
- Event cursors require commit-order discipline: a transaction takes the stream-head row lock before allocating its next cursor, writes projection/event and commits before the next writer. A plain SQL sequence is not sufficient because sequence allocation order need not equal commit order. Partition by batch plus an operator-global notification stream; avoid one lock for every request.

## Retention and deletion

Archive hides completed batches without deleting evidence. Unapproved unreferenced evidence can be removed under a documented retention policy; removing a source used by a selected assertion first invalidates/requires replacement of that assertion. Approved evidence, immutable plans, request history and unresolved claims are pinned. “Remove from workspace” is not a promise of physical deletion. An eventual permanent-delete/export feature must explain retained audit/recovery obligations and execute only under explicit operator action. Do not garbage-collect live journals or shared blobs based solely on UI visibility.
