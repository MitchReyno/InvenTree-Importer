# Import execution contracts

Status: agreed target contracts with Stage 1–3 implemented boundaries recorded
below. The future CLI and complete stock-domain execution/recovery remain
**not implemented**; Stage 3 exposes foundation APIs with explicit handlers.
Current behavior is in [ARCHITECTURE.md](../ARCHITECTURE.md). The
[plan](import-execution-plan.md) owns stage status and acceptance gates.

## Decisions and rationale

| Decision | Rationale, alternatives and limits |
|---|---|
| SQLite is authoritative; JSON snapshots/events are exports | Transactions must bind outputs, attempts, attribution and state. One backend avoids divergent recovery semantics; atomic JSON remains an abandoned alternative, not another implementation. Use stdlib sqlite3, explicit schema versions and one writer. |
| Canonical registry plus per-run SQLite | Ownership cannot depend on cwd, input directory or caller-selected journal path. The registry retains unresolved claims even if a run DB disappears. Process locks alone lose that evidence at exit. |
| Retain legacy parameter/download pools during observation | Avoid an unmeasured performance regression. Stage 2 passes immutable operation/attempt/source context explicitly into workers, synchronizes sequences and queues delivery safely; renderer consumption cannot own semantic outcomes. Durable Stage 4 parameter operations are separately checkpointed and sequential. |
| Logical IDs precede server identities | A preview cannot know future PKs. Stable semantic references prevent task renaming on restart. PKs are outputs and conflict keys, never order-dependent operation names. |
| Conservative target identity and reviewed aliases | URL/PK existence alone cannot detect server restore/replacement. Reject uncertain saved-identity reuse; do not infer equivalence from hostname similarity, redirects, credentials or matching payloads. |
| New-mode location/barcode policies | Explicit requested unresolved location needs review. Registration requires confirmed barcode ownership of the intended stock. Legacy location behavior remains until documented rollout; strict registration avoids reporting orphan stock as complete. |
| Selected metadata/evidence failures yield incomplete exit 1 | Optional work may not gate inventory, but requesting it implies an accountable result. Disabled/inapplicable work is not failure. |
| Preserve manual/historical fields | Resume repairs approved pending work, not inventory correction. Missing approved parameters can be added; changed nonempty values or PO links need review. Tags merge observed additions, with an explicit external GET/PATCH race limit. |
| Immutable artifacts, external execution report | Frozen bytes/targets can be retried without new inventory effects. Recording upload outcome inside the same archive would change the artifact being uploaded. |
| Small execution package, synchronous handlers | Proposed `src/invimport/execution/` separates models, planning, store, executor and observation by responsibility as needed. No workflow DSL, generic plugin engine, async rewrite or second importer policy implementation. Follow CONVENTIONS.md: classes own coherent state/resources, orchestration calls focused named operations with explicit inputs/options, and dependencies flow commands → workflows → lower-level operations. Create modules/packages only for demonstrated cohesive responsibilities. |

## Concrete future CLI/library contracts

Reserve a new top-level `invimport import-run` command with subcommands below;
existing `import-stock FILE ... --plan FILE` keeps its meaning and schema. Names
are selected here to avoid overloading file positional arguments or `--plan`.
They are not available until implemented behind the staged feature gate.

| Future invocation | Contract |
|---|---|
| `invimport import-run prepare FILE --output PLAN.json` | Validate locally, display conditional outline before connection, perform read-only discovery, collect explicit decisions and emit versioned resolved mutation preview. Never claim offline outline is server-resolved. Carries existing applicable stock config/selection flags. |
| `invimport import-run execute PLAN.json --write` | Validate frozen input/config/target/decisions, claim ownership, show approved preview and execute only approved semantic scope. Without --write, validation/preview only; no mutations. |
| `invimport import-run status RUN_ID --json` | Read committed local snapshot without connecting; expose pending/blocked/uncertain work and artifact locations. `--json` keeps stdout machine-readable; progress/diagnostics go to stderr. |
| `invimport import-run resume RUN_ID --write` | Revalidate identity/preconditions, reconcile interrupted effects and execute pending approved operations; never rebind choices or restore historical quantities. |
| `invimport import-run retry-operation RUN_ID OPERATION_ID --write` | Select domain recovery including unmet prerequisites and reconciliation. Never blindly replay a request or bypass approval. |
| `invimport import-run abandon RUN_ID --reason TEXT --write` | Reviewed ownership disposition, not deletion/rollback. Reject unresolved remote effects until explicit evidence/review accounts for them; preserve audit history and a persistent safety disposition for unsafe same-import work. No force flag that silently clears uncertainty. |

Use `--json` consistently for new command result snapshots, and `--events FILE`
for redacted sequenced JSONL export. `--yes` suppresses confirmations only when
choices are already explicit; it never selects ambiguous identities. Ctrl-C is
cooperative cancellation checked before **every child mutation** and after reads,
waits or decisions. An in-flight request settles confirmed or uncertain.
New-mode exit codes: 0 selected applicable work satisfied; 1 incomplete/failed/
uncertain/review/blocked; 2 usage error; 130 interrupted. Unexpected programming
errors stop new work with diagnostics, rather than reporting a skipped line.

Keep `import_stock`, `ImportOptions`, `StockImportResult` and `LineAction` callable
without UI/process exits. New `prepare_import`, `execute_plan`, `load_run_status`,
`resume_run` and `retry_operation` functions belong to the execution package;
accept explicit dependencies/decisions and return typed results. Existing callbacks
remain compatibility adapters. Public names may be refined with an explicit plan
adjustment before shipping; no closure, SDK object or callback is persisted.

## Storage, target validation and ownership namespace

Resolve a canonical state root at runtime using an absolute
`INVIMPORT_STATE_DIR` override, otherwise the operating-system user state/data
convention (XDG state on Linux, Application Support on macOS, local application
data on Windows), under `inventree-importer`. This configuration defines one
supported local safety scope and must be documented consistently for CLI/library
callers. Changing it is a scope relocation requiring migration; it is not a
per-invocation escape hatch. Arbitrary old binaries/other hosts/alternate user
accounts cannot be excluded by a local registry.

Within that root reserve `execution/registry.sqlite3`, `execution/runs/<run_id>/run.sqlite3`
and `execution/runs/<run_id>/artifacts/`. The registry is authoritative for
ownership, each run DB for execution state: these are two responsibilities, not
two interchangeable state backends. Any optional `--run-directory DIR` relocates
run bytes only; canonical registry discovery remains mandatory. Store canonical
run locations with migration/recovery checks; portable JSON exports use relative
artifact paths and contain no credentials. Active SQLite files must stay local,
not shared/synchronized while open. Create user-only directories/files where
supported; report inability to enforce permissions and redact stored context.
Never recursively include this root in evidence. Retain unresolved runs/artifacts
until reviewed reconciliation; do not implement automatic destructive retention.

Registry claims key on target identity + stock `file_id`, not just filename or
run ID. Normalize scheme/host/default port and API-root path conservatively;
reject userinfo/query/fragment and unsafe target changes. Store chosen endpoint,
observed server identity/capabilities and reviewed alias association. Do not assume
an unverified SDK `server_details` field is an immutable instance UUID. Reuse
saved PKs only after verified target continuity **and** model/record-identity
preconditions; absent a trustworthy instance identity, require explicit reviewed
continuity evidence on restart before saved PK reuse. A mismatch/restored target
needs review, never silent PK reattachment or create. Alias registration requires
an explicit reviewed association, checks existing claims and cannot create a
second ownership namespace for an unresolved target/import.

Claim protocol must favor blocking over forgotten effects: persist canonical
reservation before permitting mutations, link/confirm the durable run, then mark
active. A crash between registry and run DB leaves a reservation requiring review.
Do not claim cross-DB atomicity. Missing/moved/corrupt referenced DBs or schema
mismatch block fresh writes until recovery. Both new entry points and supported
current-version legacy library/CLI write paths consult registry and lock before
mutation; no bypass by another journal directory or process restart. Hold one
active ledger recording per process until explicit context removes its global
state. Completed runs release active ownership only when selected work is settled
with no unresolved effects/pending work; later intentional enrichment makes a new
reviewed revision without changing historical stock. Reviewed abandonment retains
uncertainty tombstones where needed: uncertainty is not made safe by dropping a
lock. Stage 3 must implement and test this before Stage 4 consumes it.

## Data, identity and state contracts

Plan schema v1 records input v1/v2, `file_id`, normalized semantic digest,
config/normalization version, target/capability evidence, selection policy,
resolved decisions, baseline/desired fields and frozen file hashes. A plan revision
is immutable. A run has a fresh opaque UUID; revision and run IDs never replace
barcode keys. Changed reference-free input can change file_id; same-reference
semantic edits require review/new revision, not permission for stock correction.

Operation ID: versioned kind + canonical logical subject + semantic discriminator,
encoded deterministically (or hashed from canonical representation). Example:
`parameter/part:shared-resistor/template:Resistance` within a plan's import namespace.
Version 2 uses shared part/model keys; version 1 chooses deterministic logical
representatives from stable line IDs and persisted approved sharing decisions.
Do not derive IDs from list index, scheduling order or unknown server PK. Shared
supplier-part keys include chosen supplier logical reference and normalized SKU;
PO keys include supplier/reference; differing assignments/metadata require review.
PO-line operations remain per original line contribution, even for identical lots.
Resolved PKs identify conflicts without changing operation IDs.

| Record | Minimum persisted fields |
|---|---|
| OperationSpec | Schema/kind, logical ID, typed desired inputs, output references, preconditions/baseline, selection/requiredness, group, conflict keys, source/line attribution, reconciliation kind |
| OperationResult | State, usable named outputs with model/PK and validation evidence, confirmed/uncertain effects, attribution, structured safe error, retry eligibility |
| Attempt | Run/operation/attempt ID, durable pre-dispatch intent, start/end, outcome/certainty and bounded retry budget |
| Request | Unique request ID, parent attempt, service, safe method/target label, start/end, HTTP versus decode/model outcome; secrets excluded |
| Event/snapshot | Schema, monotonic synchronized sequence, correlation, safe summary; committed snapshot authoritative even if renderer misses events |
| Artifact | Immutable bytes/hash/media type, relative retained location, original source attribution, approved targets, prepared/uploaded/verified/uncertain status |

Operation states: pending, ready, running, succeeded, already_satisfied,
retry_wait, failed, uncertain, needs_review, blocked, skipped. Persist effect
certainty separately (none, confirmed, unknown); terminal state alone is not retry
permission. Dependencies name usable outputs, not whole-line success. A part_of
child may proceed after usable part identity even if its parent stock/photo fails;
required identity-parameter incompleteness blocks consumers. Stop new mutations
on journal failure or unexpected programmer error. Renderer failures are best
effort and cannot change a confirmed effect into a retryable failure.

## Operation and policy matrix

Every row is a future handler contract. Current implementation locations are
listed in architecture/design; absence of capability evidence means review.

| Family / input | Usable output / effect boundary | Reconciliation and unknown case | Requiredness / sharing |
|---|---|---|---|
| Validate/discover input/config/files/target | Frozen choices, complete query evidence; read/local staging only | Failed/partial/foreign pagination never absence; stale identity needs review | Global invalid input blocks dependent work; narrow bounded reads |
| Category/manufacturer/supplier/location resolution | Chosen model+PK checkpoint per confirmed create | Re-read identity; lost create without reliable correlation uncertain; no fuzzy rebind | Category/part identity required; explicitly requested unresolved location review; companies shared by approved identity |
| Part / manufacturer part / supplier part | Confirmed model+PK before parameter work | Validate single object/singleton list, all trustworthy PKs captured; invalid/multiple/decode/reload failures after POST uncertain/review, no replay | Preserve MPN/type/spec policies; supplier+SKU with different part conflict |
| One model parameter / template / approved value | Confirmed value on known PK; one independent checkpoint | Read current value; add absent approved value, accept desired, review changed nonempty/manual; incomplete read blocks write | Identity templates gate stock; optional templates do not; logical model/template identity |
| PO / supplier + reference + metadata | Confirmed PO PK and approved fields | Compare dates/currency/notes/tags/invoices; conflicting shared requests review | Selected orders, shared explicitly; reference allocation serialized |
| PO-line / original import line contribution | Confirmed returned line PK immediately | Reuse known identity; lost response requires verified target marker or uncertainty; payload/quantity similarity insufficient | One contribution per lot, never collapse identical lots |
| Stock / line lot / quantity,batch,part,location | Known stock PK then barcode ownership, separately checkpointed | Lost create no safe correlation → uncertain; missing/deleted/consumed record review, never recreate to restore baseline | Required inventory; immutable logical barcode key |
| Barcode / intended PK + import key | Confirmed key owner equals intended stock | Specific absence taxonomy only; read-back uncertain link; true conflict review; no delete on unknown | Registration prerequisite; read-only lookup POST remains a read |
| Tags / approved tags + owned stock | Approved tags present on confirmed target | Union observed unrelated additions; conflicting assumptions review; later external race not protected without verified atomic support | Selected metadata, no inventory gate; same-field conflict key |
| Stock PO link / approved order | Intended link confirmed | Set only absent/already intended; divergent/manual link review | Selected order metadata; no historical field overwrite |
| Notes/name / baseline, desired/model | Confirmed missing-field addition; existing names/notes preserved | Read-back desired/empty/manual distinction; unknown PATCH reconcile | Preserve legacy policies; selected enrichment |
| Datasheet/image/document/invoice/logo | Confirmed target+artifact identity or explicit unresolved result | Failed list blocks upload; same filename alone insufficient; lost upload verify trustworthy content or review | Selected evidence does not gate inventory; logos retain originating created-company eligibility |
| Provenance/archive/report | Confirmed-change snapshot, frozen manifest/bytes, per-target outcomes | Atomic local replacement; validate source staging; retain pending original uploads; disk failure stops mutations, best-effort diagnostics | Settle relevant branches, even failed; no recursive outcome-in-archive; no-op avoids churn |

No server uniqueness, conditional write, import-key create, PO marker or byte
verification capability is assumed. Allocation conflict keys also cover IPN
prefix and PO reference generation. Observation covers startup, CRUD/OPTIONS,
barcode POST, attachment transfer, SDK reload, pagination, external download and
post-import --plan requests. Show/flushed start row before every dispatch even
in non-TTY mode; additional detail only may be hidden. SDK logging protection
starts before connection and covers password/token acquisition. Redirect history
is observation, not independent domain replay. One layer owns retry budgets.

## Error vocabulary and compatibility matrix

Errors carry category, safe service/operation/request IDs, code, retry policy,
effect certainty and preserved safe cause. Categories: absent (verified read
contract only), validation, conflict, denied/auth, transient, transport,
invalid_response, uncertain_write, programmer_error, local_journal_failure.
A 403 upload is not automatically global invalid credentials; evidence determines
scope. HTTP success is distinct from decoded model and confirmed domain effect.

| Surface | Preserve | Intentional future difference / gate |
|---|---|---|
| Input schema v1/v2, source rows, barcode keys | Required line IDs, expansion and earlier-line part_of | Separate plan schema, no renumbering; input drift reviewed |
| import_stock / result dataclasses / callbacks | Quiet noninteractive library and existing consumers | Durable APIs explicit; registry guard prevents legacy uncertainty bypass |
| --validate/schema/vocabulary | Offline usable, existing JSON consumers | No journal/network prerequisite for pure validation |
| Existing --plan | Post-import montage projection including reads/images | New executable PLAN.json is distinct and versioned |
| Dry run / --yes / --write / --no-* | No remote effects without write; selected scope, matching and confidence policies | New resolved preview and durable permissions; --yes not ambiguity authorization |
| Existing reimport/notes/company eligibility | Preserve manual data, selected enrichment and created-company logo policy | Durable pending work persists; historic quantity/batch/location/part immutable |
| Missing location / coarse completion | Legacy behavior characterized | New mode unresolved requested location review, barcode-confirmed registration, incomplete selected evidence exit 1 |
| Transport visibility | Library stays UI-independent | Whole stock invocation correlated; unmigrated DigiKey excluded until Stage 7 |

## Baseline evidence and next gate

Existing tests already cover v1/v2 expansion, partial specs, company/notes policy,
optional assets, part_of, repeat imports, --plan consumers and PR #9 failures.
Stage 0 adds only missing observable baselines for unresolved explicit location
and unchanged historic stock fields on same-key rerun. SDK inspection confirmed
0.13.5 list/testServer/downloadFile paths; no live calls/capabilities measured.
See [handover](handovers/import-execution-stage-0.md) for actual validations.
Stage 1 fixes error/absence boundaries without claiming durable recovery. Each
later stage must keep this contract accurate or explicitly record a justified
adjustment with reviewer evidence in its handover and maintained plan.

## Stage 1 implemented safety primitives

- `collections.list_rows` and `list_models` return complete collections or raise
  `DiscoveryError`; no partial prefix or failed read represents absence. Bounds,
  shape/count/identity validation, loops and same-origin/API-root pagination
  validation are implemented. This is application-link validation, not a new
  transport, redirect policy or target-capability guarantee.
- `stock.BarcodeError` exposes category, operation, stock_item_pk and owner_pk.
  Exact HTTP 400 `error == "No match found for barcode data"` is supported absence;
  other failures remain errors. A response must identify exactly one recognized
  owner model with a positive integer PK; malformed/multiple model keys fail
  closed. Link read-back confirms intended owner or a
  different owner; unknown ownership never authorizes duplicate cleanup.
  `BarcodeInUse` now means a confirmed different stock owner, with both PKs.
- `purchase_orders.attach_file_outcome` returns `AttachmentOutcome` with state,
  model_type/model_id, filename, safe reason and `satisfied`. States are uploaded,
  already_satisfied, failed and unknown. Already satisfied retains the legacy
  filename-based policy; it is not executor-grade verified artifact identity.
  Listing failure is failed with no POST; unsettled POST is unknown; explicit
  client rejection is failed. The existing `attach_file` boolean still means
  a confirmed new upload, and datasheet/photo/document count APIs count uploads.
  `attach_datasheet_outcomes` is the structured multi-target counterpart.
- Archive/provenance retain separate existing/unknown results; failed archive
  preflight never proceeds to upload. These results have no durable retry or
  restart semantics. Later executor handlers must strengthen artifact identity
  before treating legacy name satisfaction as verified selected evidence.

Source/stub evidence, compatibility tradeoffs and validation are recorded in the
[Stage 1 handover](handovers/import-execution-stage-1.md).

## Stage 2 implemented observation contract

- `Observation`, frozen `Correlation` and frozen `Event` provide schema version 1,
  synchronized invocation-local sequences, run/operation/attempt/source/group and
  request identities. `snapshot()` returns an immutable event tuple; `export()`
  returns credential-free dictionaries. Neither API persists or resumes work.
- `observing()` opts library callers in; CLI `import-stock` installs a plain stderr
  observer before connection and retains it through post-import plan generation.
  Offline validation/schema/vocabulary remain outside the observation/network scope.
- Every application dispatch emits request_started before HTTP invocation and a
  correlated request_finished for received/error/unknown exchange. Cancellation
  before dispatch emits request_cancelled/not_dispatched. Redirect history is a
  count on the received response, not independently replayable wire requests.
- SDK decode and create-model outcomes carry the originating request ID and are
  distinct from HTTP exchange. Received
  success is not domain-effect confirmation; model failure after POST does not
  erase the HTTP result. Event identity is not a mutation/idempotency key.
- Existing parameter/prefetch pools explicitly capture immutable source context
  and allocate child operation attempts. Observer delivery is serialized through
  a queue under the sequence lock; failure is counted and never replayed as work.
- Events omit arbitrary strings from network exceptions, headers, payloads and
  URLs. Inventory routes use an allowlist; query strings are never labels. Unsafe
  legacy free-form logging is suppressed only inside observed imports; bound SDK
  credentials/payload logging is disabled before its constructor. CLI reports safe
  failure type and established allowlisted plan-read messages. Caught upload/archive/PDF exception-result reasons are safe before rendering;
  outside observed scopes library diagnostic reasons are preserved. Library
  exception objects/causes and Stage 1 attachment/barcode contracts remain available.
- `Observation.cancelled` stops new request dispatches; interruption sets it.
  Current requests settle according to their transport result. No durable partial
  report, restart semantics, automatic retry or general independent continuation
  is promised by this stage. Future operation/store contracts above remain gates.


## Stage 3 implemented foundation contract

- `models.Plan` schema 1 canonically serializes immutable desired/baseline JSON,
  logical IDs, named output references, source attribution, conflict resources,
  target/decision evidence and semantic digests. Unknown schema/normalization,
  dependency cycles/missing outputs and contradictory shared inputs are rejected.
  Outputs require a positive model PK and record identity evidence, and confirmed
  output identity cannot change on reconciliation. State, certainty and retry
  eligibility remain separate records.
- `preparation.prepare_import` and `validate_preparation` freeze v1/v2 identity,
  stockfile keys, transitive part_of/shared part subjects, config/input semantics,
  supplied file content hashes and explicit company/part decisions. Discovery
  exposes complete bounded reads only. The stock preparation is intentionally
  marked `stock_domain_resolution_and_handlers` unsupported, so it cannot be
  executed as a resolved mutation preview. Stage 4 must integrate existing matching
  policies and account for all referenced files before approving domain operations.
  No callback, SDK object, raw response or original source path persists.
- `executor.execute_plan`, `resume_run` and `retry_operation` are explicit-handler
  library foundations; no domain handler or CLI is enabled by default.
  `store.load_run_status` reads one committed snapshot through canonical run
  discovery without connecting to inventory. `RunStore.export` atomically writes
  a portable JSON projection. Observation's retained event tuple remains only a
  rendering snapshot, never authoritative execution state.
- All supported execute/resume/reconcile boundaries reject known target/instance
  conflicts independently of whether any PK has been saved. `execute_plan`
  requires an explicit current target observation. Missing saved PKs may relax
  manual continuity review, never authorize a known target mismatch.
- Registry reservations precede DB creation, activation precedes dispatch, and
  every child dispatch checks active canonical ownership plus the journal.
  Lifetime OS locks and a process ledger/import owner exclude simultaneous writes;
  nested caller ledger scopes remain supported. Alternate run directories/cwd and
  fresh invocations find unresolved claims. Missing/moved/corrupt journals and
  unknown schemas fail closed; relative platform state environment roots are
  rejected rather than made cwd-dependent. There is no migration from an unrecognized version exists.
  The initialized marker detects deletion of the registry file in a retained
  state root; deleting/relocating the entire configured root is outside the local
  guarantee and requires operator migration/recovery.
- Supported current-version legacy `import_stock` writes consult the registry and
  hold exclusion before stock discovery/mutations. This guard releases on normal
  return and leaves a blocking reservation on an exception/interruption. It does
  not make legacy results/PKs resumable or change selected-enrichment exit policy.
  Old binaries, other user roots/hosts and unknown unregistered endpoint aliases
  remain outside this local scope.
- Only normalized safe HTTP(S) endpoints are accepted; credentials/query/fragment
  and unsafe paths are rejected. Verified instance evidence comes from the caller,
  never inferred from SDK server_details. Without it, saved PK reuse requires an
  explicit revision-bound continuity review. Even with continuity, actual domain
  handlers must re-read/validate the model and record identity before using a PK.
  Reviewed aliases preserve one namespace; unresolved conflicts require migration.
- SQLite commits attempt/request intent before send and atomically binds outputs,
  effect certainty, attribution, state and audit event after settlement. Interrupted
  writes and interrupted reconciliation retain unknown effects. Unknown outcomes
  cannot be successful/complete and cannot be reset for blind create replay.
  Scheduler and store-start eligibility both inspect certainty/retry independently
  of state; retry_wait with reconcile/review permission never replays the original
  mutation handler. Only safe read policy may requeue original read work.
  Explicit read-only reconciliation preserves prior confirmed identities.
- Mandatory dispatch guards are not observers. Renderer failure is isolated;
  store/ownership failure propagates and stops subsequent child sends, including
  after request-start delivery. `barcode_lookup_request` explicitly marks the
  supported barcode POST as read; verbs alone do not determine effect semantics.
  Journal request IDs and durable run/operation/attempt IDs are used by Stage 2
  rendering and decode/model observations, including nested visual operations.
- User-only marked run directories retain `artifacts/`; custom new run directories
  must be empty. Canonical state, marked runs and reserved DB/WAL/SHM files are
  excluded from recursive evidence enumeration. Snapshots use relative artifact
  references; no automatic destructive retention or full artifact migration is
  included. Reconciliation/abandonment retain audit history and blocking tombstones;
  no forced-clear action is provided.

The [Stage 3 handover](handovers/import-execution-stage-3.md) records acceptance
proof and the preparation/domain-integration adjustment. This is readiness for
Stage 4's representative slice, not a whole-import resume or exactly-once claim.
