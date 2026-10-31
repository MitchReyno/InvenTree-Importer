# Planned, observable and resumable imports — design

Status: agreed target design; implementation is staged and incomplete. See
[architecture](../ARCHITECTURE.md) for implemented behavior, the
[maintained plan](import-execution-plan.md) for gates/status and
[contracts](import-execution-contracts.md) for concrete Stage 0 decisions.
This document describes intended behavior unless explicitly labeled current.
Stage 2 supplies in-memory observations; Stage 3 adds typed explicit-handler plans,
a serial executor, canonical ownership and SQLite state beneath them. Stable
journal correlation now bridges the observer when executing a durable attempt.
Generic `prepare_import` still marks stock resolution unsupported. Stage 4 adds
a separate genuinely resolved spec/type subset in `prepare_stock` and domain
handlers with selected evidence-backed repair under the original operation IDs.
Stage 5 extends that shared planner through `prepare_full_stock`, with per-domain
enrichment, typed settled barriers and immutable provenance/archive revisions.
See architecture and the Stage 5 handover for exact scope and evidence. Full
library execution and the Stage 6 `import-run` CLI are opt-in. Legacy default
rollout remains gated; Stage 6 independent review approved corrected implementation
`93c5f355da8caffef272c2bfb35f7261e7fb67f2` within its documented release limits.

## Recommendation and scope

Build a small synchronous domain-operation executor for `import-stock`, with
explicit prerequisite outputs, persisted recovery state and visible child request
steps. Every API call should be announced before dispatch and have a correlated
outcome, without making every HTTP request an independently replayable task. A concise
request-start row is displayed/flushed before each dispatch in the plain CLI;
only additional payload/timing detail may be hidden behind expansion.

A domain operation such as “ensure tags on this stock item” may make a PATCH on
its first attempt and a GET followed by no write when reconciling a timeout.
Users must see both sequences. Retrying should invoke the operation's recovery
contract, not replay a recorded HTTP request blindly.

Start with serial execution and a small typed operation vocabulary. Reuse existing
matching/value-normalization rules deliberately, preserve public APIs and import
identities, and keep presentation separate from execution. Do not build a generic
workflow language, distributed scheduler or wholesale async rewrite.

Implementation baseline: main `c22b7a1`, including PR #11 code-organization
conventions and PR #9's DigiKey request-error,
configuration-replacement and report-plan-read fixes; installed SDK
`inventree==0.13.5`. Preserve those fixes. Source line references are baseline
landmarks, not stable future line numbers. No live server capabilities or
production failure rates were measured.

## Goals and non-goals

The desired outcomes are:

- Show a conditional phase/task outline before work begins, then a resolved
  mutation preview before writes.
- Show each actual application-dispatched API request as a step, including its
  method, safe target label, operation/attempt, timing and outcome.
- Continue work whose prerequisite outputs are still valid when another branch
  fails; preserve and explain blocked work.
- Retry or resume selected domain work safely, including after a process restart.
- Produce an honest account of confirmed, incomplete, uncertain and reviewed work.
- Support a future TUI using the same engine, state and events as the CLI.

No local journal can guarantee exactly-once remote effects. Automatic recovery
from an ambiguous create is not a goal unless a verified target-side identity or
idempotency contract makes it safe. Remote rollback, general inventory editing,
and changing existing matching policy are separate features.

## Current execution and reusable foundations

Today `commands/import_stock.py:860-916` validates/runs imports, prints results,
and optionally calls `build_plan` after `import_stock` returns. The existing
`--plan` is a montage/review projection; it also makes reads and image downloads.
It is not the executable work description.

`inventree/stockimport.py:215-287` loads categories/templates/supplier parts,
optionally prefetches datasheets, executes lines, handles company logos, compiles
provenance, archives the import and attaches record provenance. Discovery and
writes are interleaved inside `_import_line` (`:338-553`).

The normal per-line flow is:

```text
Check existing barcode
Resolve category, manufacturer and part
Create missing part parameters and manufacturer part/parameters
Resolve supplier and supplier part
Resolve location and purchase order; create purchase-order line
Resolve datasheets; write notes; attach documents and part images
Create stock; link barcode; set tags
Link stock to purchase order; attach stock images
```

The existing code provides useful input/result dataclasses, matching policies,
callbacks for decisions, stable stock barcode keys, attachment deduplication,
local cache/download utilities and mocked SDK/server tests. These should be
adapted rather than replaced by a second unconnected importer.

The ledger (`inventree/ledger.py:77-151`) records some observed successful writes
in memory. It omits barcode linking, tags, compensating deletion and finalization
outside its recording block. It is neither durable nor an exhaustive authoritative
account of effects. `LineAction` already has some notes/datasheet outcomes, but
its principal created/exists/skipped/review status is too coarse for recovery.

DigiKey supplier-part import already catches per-SKU exceptions and has progress
callbacks (`inventree/parts.py:1194-1327`). Stock import lacks that per-line
boundary. The new design should improve failure classification rather than copy
broad “catch everything and skip” behavior.

## Confirmed recovery defects and their implications

### Incomplete identity parameters can duplicate or strand a part

`find_part_by_spec` rejects candidates missing a key parameter
(`inventree/parts.py:320-356`). `resolve_part` creates the part before applying
parameters (`:1000-1033`). A partial failure can leave an incomplete part that the
next specification-based attempt does not recognize, allowing a second creation.
Type matching can instead reuse an incomplete part but skip missing parameters
because stock import does not request `update_parameters=True`.

Persist confirmed part identity before dependent parameter work. Resume missing
approved parameters against that identity; do not rediscover solely through an
incomplete signature. Do not globally enable update_parameters: that can overwrite
drifted values beyond the intended repair permission.

### Barcode lookup and cleanup conflate distinct failures

Stage 1 fixes this baseline defect: exact supported 400 no-match responses alone
mean absence; link ownership is read back before success or duplicate cleanup.
Auth/transport/validation/invalid response and unknown write outcomes remain
errors; known stock PKs are retained in structured error context. Cleanup is
limited to the current call's new duplicate after confirmed different owner.
See architecture/contracts for implemented scope. This is not durable recovery.

### Whole-line reruns do not complete all pending work

The existing-barcode branch (`stockimport.py:349-368`) repairs selected notes,
datasheets and attachments, but not all tags, missing PO links, part parameters,
primary images or PO lines. A stock item can exist while required follow-up work
remains incomplete. Preserve that distinction in results and recovery.

### Purchase-order lines need their own identity/reconciliation contract

`_order_line` (`stockimport.py:1013-1027`) unconditionally creates a line before
subsequent evidence and stock work. Failure before stock registration can cause
another PO line on whole-line retry. Matching only supplier part and quantity
would merge legitimate separate purchases/lots.

Persist a returned PO-line PK immediately and scope its desired contribution to
an import line. For a lost create response without reliable server correlation,
mark it uncertain rather than claiming automatic deduplication. The initial design
must explicitly document which target-supported markers, if any, can identify a
PO-line create safely; do not assume a new unique server field exists.

### First-page-only discovery undermines absence decisions

SDK `InventreeObject.list` still reads one page. Stage 1 routes importer model and
direct collection consumers through explicit complete bounded target-safe helpers.
Narrow supplier/candidate-parameter reads avoid eager server-wide scans. Malformed,
failed, looped, bounded-out or foreign-page reads are unavailable evidence.
This application boundary does not establish target uniqueness, trusted redirects
or saved target continuity for the future durable executor.

### Optional outcome and finalization contracts are incomplete

Stage 1 blocks attachment upload after failed discovery and exposes structured
uploaded/already_satisfied/failed/unknown outcomes while preserving legacy boolean
and count adapters. Archives/provenance and datasheet backfill use satisfaction
correctly. Filename-based legacy satisfaction remains weaker than verified artifact
identity required for future executor reconciliation.

An exception from a stock line prevents later lines and ordinary finalization.
Normal CLI status mostly counts skipped/review lines, not all failed requested
work. A failed optional operation may allow inventory to proceed, but must remain
visible in the report and completion policy.

## Planning before executing

Use two preparation/execution boundaries:

1. Show the conditional outline before connection or discovery: validation,
   connection/capabilities, discovery, decisions, inventory, enrichment and reports.
   Discovery requests are real visible steps. Offline preparation can only produce
   a conditional outline, not claim to know server state.
2. Execute read-only discovery, validate inputs/files, resolve decisions, then
   present the resolved mutation plan before dispatching mutations.

References to future outputs are symbolic: “manufacturer PK returned by operation
X,” not arbitrary temporary server IDs. Conditional/dynamic child requests are
announced before dispatch. Expansion within an approved semantic scope may occur;
new identity choices or material extra effects require a revised review decision.

Revalidation is a bounded check on plan assumptions, not a promise to freeze the
server. Recheck relevant record identity/preconditions before mutations. Do not
silently rebind a user-approved part/company to another fuzzy candidate on resume.
A stale plan blocks/reviews only the affected work unless the problem is global.

Keep the existing `--plan` report contract. Define a separate versioned execution
plan and project results back into existing reports while migrating.

## Operations, request steps and dependency outputs

Use a domain operation as the recoverable work unit. Within an attempt, record
each actual request as a child step. A one-request operation is valid where it is
the natural reconciliation boundary, but is not a universal requirement.

```text
Phase: Inventory
  Operation: line l07 / ensure stock tags / attempt 1
    PATCH stock/812/        outcome uncertain: response timed out
  Operation: line l07 / ensure stock tags / attempt 2
    GET stock/812/          succeeded
    Reconcile desired tags already present
    Operation satisfied without another PATCH
```

Suggested contracts:

| Concept | Required meaning |
|---|---|
| Plan | Semantic desired work, scope, decisions, target/input identities and version |
| OperationSpec | Stable ID, typed inputs, required output references, grouping, conflict keys, handler/reconciliation kind |
| OperationResult | Confirmed outputs/effects, certainty, source attribution and structured outcome/error |
| Attempt | One execution/reconciliation of an operation with correlated child requests |
| Request record | Dispatch identity, safe label/method, timing and HTTP/transport/decode outcome |
| Event/snapshot | Presentation/audit projection with sequence identity and recoverable current state |

Separate dependency, failure policy, resource conflict and visual grouping. For
example, line B's `part_of` dependency needs A's confirmed usable part identity,
not success of A's photograph or even all A's stock work. Preserve the current
input rule that part_of names an earlier line unless a separate format change is
approved. A simple dependency map and serial ready-task scheduler suffice initially;
`graphlib` is optional, not an architectural requirement. Stable operation IDs use
logical part/model/template references from the approved plan. Server PKs resolve
those references and identify resource conflicts; they do not rename operations
between preview, execution and resume.

Required identity parameters can gate stock under the selected identity policy.
Optional images should not. Main currently permits stock without a resolved
location; deciding whether an explicitly requested location failure blocks stock
is a product policy, not an existing invariant. The initial rollout must document
and test that choice rather than silently change it. Likewise, requiring barcode
confirmation before enrichment can be a chosen safety boundary even though a
confirmed stock PK can technically support those requests earlier.

Shared operations use domain keys, not just labels. Detect contradictory inputs:

- Preserve explicit/fuzzy manufacturer choices and their record PKs.
- Supplier-part identity includes supplier and normalized SKU; differing Part
  assignments are conflicts, not deduplication opportunities.
- Shared PO resolution includes supplier/reference and must reconcile conflicting
  dates, currency, notes, tags or invoices rather than take whichever line runs first.
- Preserve current category/MPN/type/spec matching policies; ambiguous manufacturer
  relationships must not be silently resolved by an executor cache key.
- Allocation locks, if later concurrent, include shared IPN prefixes and PO
  reference allocation, not merely individual lines/categories.

## Request observation and transport boundary

Define “every API call” as every application-dispatched request, including every
explicit retry and pagination request. Redirect wire exchanges may be represented
as response history; they are not independently replayable business steps. Keep
external datasheet/image downloads visibly distinct from inventory API calls.

Install correlation and observation before connecting. The pinned SDK constructor
connects immediately; startup testServer and downloadFile use requests directly,
while normal REST requests use InvenTreeAPI.request. SDK constructors/save may
also trigger reload GETs. Decorating only a requests.Session, or attaching hooks
after connect, does not cover those paths. The installed InvenTree request path
has no demonstrated internal transient retry loop; DigiKey does have its own.

Use narrow client/factory/download adapters through an explicit execution context,
compatible with the pinned SDK. Avoid globally monkeypatching all requests calls.
Cover the complete import-stock invocation: startup, normal CRUD, OPTIONS, barcode
POST lookup, attachment requests, SDK-generated reloads, pagination, external
downloads and post-import --plan reads/downloads. This initial coverage promise
is stock-command-specific; do not claim all DigiKey commands are already covered.
Test these paths at actual SDK/adapter entry points with a fake HTTP boundary.

Existing parameter writes and datasheet prefetch already use thread pools. Stage 2 retains them with explicit immutable correlation propagated into each
worker, synchronized sequence allocation and a safe delivery queue. Do not assume
caller-local context automatically reaches worker threads. The durable serial
path must use individually checkpointed parameter operations rather than the
legacy batch helper. Later concurrency work concerns new executor concurrency.

A request step starts before dispatch. Separate a successful HTTP exchange from
successful JSON/model decoding and a confirmed domain effect. If a create's response
cannot be decoded or its model construction fails, the remote write can still have
happened. Do not classify it as safely repeatable from the Python exception alone.
Redact request/error context before storage and configure logging before SDK
construction. The installed SDK logs payload/header data at debug level and token
retrieval at info level; test both token and username/password flows rather than
assuming event redaction alone protects logs.

Renderer callbacks are best-effort consumers; their failure must not turn a
confirmed write into an operation failure. Journal failures are different: if a
remote effect cannot be durably recorded, stop new mutations and retain uncertainty.

## States, continuation and cancellation

Keep three facts distinct: operation state, remote-effect certainty and retry policy.
An interrupted operation with no writes may be ready to retry; an interrupted
create with unknown effect needs reconciliation.

```text
pending → ready → running → succeeded | already_satisfied
                         → retry_wait | failed | uncertain | needs_review
Dependencies may leave an operation blocked; policy may mark it skipped.
```

Blocked work names its unmet output/reason. Retrying a repaired dependency can
reactivate descendants, but selecting a step must never bypass its preconditions.
Continue independent branches after a classified local failure. Pause affected
service work on demonstrated credential/outage scope; a 403 for one upload is
not automatically invalid credentials for all endpoints. Unexpected programming
errors stop new work and preserve diagnostics rather than masquerade as a skipped row.

Bound attempts, backoff and total budgets. Use semantics, not HTTP verbs alone:
barcode lookup is a read-only POST. One layer owns retry policy; transport attempts
inside DigiKey/SDK adapters cannot be invisible nested retry loops. Respect relevant
server backoff hints when available.

Cancellation is cooperative: check cancellation and journal health immediately
before every child mutation dispatch, including inside read/reconcile/write
operations and after retry waits. It stops new mutations, waits within bounded
request timeouts, and records already-dispatched outcomes/uncertainty. It does not undo confirmed work. Always
attempt a local partial report, even when remote evidence upload cannot run.

## Durable identity and restart contract

Keep distinct identifiers for import, run, plan revision, domain operation,
operation attempt and individual request. None replaces the stock identity
`invimport:<file_id>:<line.id>` (`stockfile.py:300-302`). Main rejects missing
line IDs. file_id uses source.reference where provided, otherwise a content-derived
hash (`stockfile.py:1381-1397`); editing a reference-free file can change its identity.
Do not renumber user line IDs or derive operation identity from execution-list order.

Freeze approved normalized desired values and resolved decisions. Editing input
under the same line key is not permission to rewrite historic quantity, batch,
location or part. Separate pending-work repair, new enrichment and inventory
correction. Detect accidental reuse of an import identity with incompatible inputs.

Checkpoint confirmed output PKs, effect identity and line/source attribution before
starting dependent work. Validate a single-create response as one trustworthy
object or a one-element object list with the expected model/identity. Empty,
invalid-PK or multi-object successful responses require explicit effect capture
and uncertainty/review; retain all trustworthy returned identities and do not
silently take the first row or repeat the create. Validate target/server identity, model type and record
identity before reusing PKs; existence alone is insufficient after restore or target
changes. Do not recreate consumed/deleted stock simply to restore an old quantity.

Fingerprint relevant input contents, normalization/config semantics, referenced
files, schema/executor version and capabilities; exclude secrets and irrelevant
mtime-only changes. Unknown/unsupported journal schema or uncertain target identity
must not trigger a best-guess resume.

Local checkpoints cannot close the remote-commit/local-record gap. If creation
returns no trustworthy PK and no verified unique correlation mechanism exists,
stop that operation as uncertain and require reconciliation/review. Payload
similarity alone cannot distinguish legitimate identical lots or PO lines.
Target-side atomic create+import-key support or an extension could improve this,
but is an optional separately verified capability, not an assumed prerequisite.

## Provenance, logos and evidence finalization

The current ledger is useful input, not the recovery database. Persist attribution
at each effect boundary, including when the surrounding line fails before producing
LineAction. Add explicit context rather than relying on process-global _active for
concurrent runs. Initially allow one executor per import and one active
recording path per process; the lock on ledger.events is not run isolation.

Record create/update/delete observations and certainty accurately. A compensated
create remains historical, with a corresponding confirmed delete; it must not be
reported as a surviving record solely because an earlier create event exists.

Preserve which companies this import created: logo eligibility currently depends
on this run's ledger, so ordinary reruns miss failed logos. A resumed logo operation
may retain original eligibility, but must not broaden permission to unrelated
existing companies.

Persist prepared per-record provenance artifacts and pending upload targets even
when there are no new inventory writes on resume. Regenerate neither source facts
nor run history simply because an upload is retried. The current write_combined
read/append/rewrite sequence also needs atomic local replacement for recovery use.

Finalize when relevant inventory branches are settled, not only when all succeed.
Always create a best-effort local partial report. Distinguish prepared artifact
identity, confirmed upload location and failed upload; an archive name in provenance
is not proof that it was attached.

Freeze a manifest and artifact bytes for upload retries. Filename presence alone
is not proof of matching content: verify a trustworthy content identity or retain
an unverifiable/conflict outcome for review rather than claiming artifact recovery. Current archive hashing
and ZIP construction read inputs separately, so validate/stage bytes consistently.
Exclude active journal files, SQLite WAL/SHM, generated execution outputs and report
image directories from the evidence input manifest. Record archive upload outcomes
outside the immutable archive instead of rebuilding it to include its own outcome.
Document the one-way artifact/provenance boundary to avoid self-reference.

No-write/no-pending runs should avoid unnecessary evidence churn. Selected pending
artifact retries may proceed without new inventory writes, with explicit write
permission. Already-present/verified content is satisfied, not an upload failure.

## Storage and design alternatives

| Option | Strength | Limitation | Recommendation |
|---|---|---|---|
| More callbacks only | Fast progress improvement | No durable recovery or semantic operation boundaries | Transitional observation layer |
| Fixed domain tasks with small dependency map | Explicit ordering, recovery and independent continuation with limited machinery | Needs per-kind handlers and contracts | Initial executor shape |
| General request-level persistent graph | Very detailed scheduling representation | Conflates visibility with replay, increases dynamic graph/identity complexity | Do not require it |
| Durable workflow platform | Established service-oriented persistence/recovery features | Infrastructure and integration cost; still needs remote reconciliation | Revisit only for separate hosted-service needs |

For storage, compare actual checkpoint/query needs:

| Store | Suitable use | Maintenance cost |
|---|---|---|
| Atomic versioned JSON snapshot | One writer, modest state, simple resume | Rewrites; explicit history/coordination rules |
| SQLite | Structured attempts, outputs, artifact state and event queries | Schema/migrations, ownership and local file lifecycle |
| JSONL event log alone | Append audit stream | Partial-tail recovery, replay/compaction and state reconstruction |

Stage 0 selects SQLite for authoritative durable run state, with one writer,
versioned schemas and portable JSON snapshot exports. The alternatives above
explain the tradeoff; they are not additional backends to implement. Avoid full event sourcing: persisted
current state plus audit events is enough. Do not share an actively written DB via
cloud/sync filesystems. Persist ownership/discovery in a canonical local namespace keyed by verified
target/import identity, pointing to the authoritative run even if a caller requests
a different journal directory. A process lock alone is not enough: unresolved
work survives process exit. New and supported legacy entry points must detect it;
a missing/moved/corrupt referenced journal requires review rather than a fresh
mutation run. Only a documented reconciliation/abandonment action releases an
unresolved claim. Define conservative target-alias handling and completed-run
release separately. Local ownership cannot lock another host, an old binary or
the server; revalidation and server constraints remain necessary.

## Progress, reports and future TUI

The engine owns planning, transitions, cancellation and retry. Renderers consume
sequenced snapshots/events and can resynchronize if messages are dropped. Emit
phase/operation/request starts, finishes, retries, waiting decisions and blocked
reasons; show timings, safe resource labels and attempts. Never parse log strings
as the machine interface.

Show phases/operations and an immediately visible row for every request by
default; expand only additional details. Flush starts before dispatch and show
correlated terminal outcomes, shared attribution and honest counts. Discovery can expand work; settled is not identical to successful. Use
bytes for transfers where supported rather than pretending one upload equals one
lookup in elapsed work. Group shared nodes without duplicating their effects.

Reports separately count inventory identity/registration, incomplete requested
metadata, pending evidence, failed/blocked work and uncertainty. Exit policy must
reflect selected requested work, even when optional work does not gate inventory.
Disabled work is not a failure. Preserve established usage/error/interruption codes
unless an explicit CLI contract change is documented.

Keep the engine synchronous initially and run it in a TUI worker when needed.
Prompts become preparation/review decisions, not blocking UI calls buried inside
handlers. A minimal TUI may follow a stable event interface before DigiKey migration;
it need not wait for every import path.

## Staged adoption and proof obligations

First correct error classification and complete discovery. Then add observation
without broad behavior changes, define typed execution/identity contracts, and
implement a durable vertical slice. That slice must include a shared spec/type part,
identity parameters, stock/barcode/tags, one PO line and evidence finalization.
Only then migrate remaining enrichment and full stock execution, add a TUI, and
assess DigiKey order issue/receive semantics and measured concurrency separately.

Retain public import_stock entry points, version 1/2 input expansion, current
matching/review and notes-preservation policy, stable barcode keys, --yes behavior,
--no-orders/--no-archive/--no-provenance, dry-run guarantees and existing --plan output.
Tolerant continuation and explicit incomplete completion status are intentional
changes requiring documentation and regression coverage. Do not silently change
location, metadata overwrite, ambiguity or historical inventory-edit policy. Tag
repair can preserve unrelated additions observed at reconciliation time, but
cannot guarantee preservation of a later external race without verified conditional
updates/atomic set-add support. State that limit; do not advertise cross-client
field atomicity from a GET-plus-PATCH sequence.

Preserve legacy re-import/enrichment behavior during transition, but do not permit
an older execution path to bypass an active resumable run's uncertain work. Engine
selection and same-import ownership need an explicit compatibility rule.

Acceptance tests should inject known failure and applied-but-response-lost failure
at each meaningful write boundary. Verify retained PK recovery, no duplicate known
effects, uncertain handling where correlation is unavailable, complete pagination,
manual-change preservation, immutable artifact retries, partial attribution,
independent continuation, target/input mismatch handling, cancellation and disk
failure. Mocks establish client contracts; live uniqueness and atomicity require a
separate read-only capability check or approved integration environment.

## References and supporting evidence

- Source landmarks: `src/invimport/inventree/{stockimport,stock,parts,purchase_orders,ledger,archive,importplan}.py`, `src/invimport/{stockfile,provenance}.py`, `src/invimport/commands/import_stock.py`.
- Existing tests: `tests/inventree/test_{stockimport,stock,importplan,parts,purchase_orders}.py`, `tests/test_{config,cli}.py` and `tests/support.py`.
- [Python graphlib](https://docs.python.org/3/library/graphlib.html), an optional ordering primitive, not a complete executor.
- [Python sqlite3](https://docs.python.org/3/library/sqlite3.html), one local storage option.
- [Textual workers](https://textual.textualize.io/guide/workers/), a possible renderer integration.
- [Temporal event history](https://docs.temporal.io/encyclopedia/event-history), context for the heavier platform alternative.


## Stage 4 implementation decisions

The bounded stock library now exercises the representative slice against actual
SDK/transport entry points and persistent fake server state. Complete spec/type
matching, shared suppliers/orders, per-template parameters, distinct lot and PO
contribution identities, known-PK reconciliation, conditional barcode/tag/link
repair and one explicit byte artifact are implemented. Full enrichment and
source/provenance/archive migration remain Stage 5; unsupported requested fields
reject during read-only preparation. Existing locations are mandatory in the
slice, an intentional new-mode review boundary rather than a silent unlocated lot.

The raw JSON create boundary validates one returned identity and checkpoints it
without invoking SDK model constructors/reloads. This removes the constructor
failure window from the new path instead of inheriting legacy first-list-element
selection. Immediate checkpoints retain confirmed effects as well as outputs
through interruption. Evidence-backed domain repair records new attempts and
conditional preconditions, preserving prior uncertainty events under the same
logical operation ID; the generic read-only retry guard remains unchanged.

Missing parameter additions to matched Parts are explicit selected operations
after established identity, a narrow new-mode policy adjustment from legacy
no-update behavior. Conflicting nonempty values are never overwritten. Uncertain
creates without trustworthy IDs remain unresolved even if payloads look identical.
The local SQLite authority and read/PATCH repair do not imply exactly-once remote
creates or atomic preservation of external changes after a metadata read.

Independent review tightened three Stage 4 boundaries: frozen PO metadata/currency
must remain valid whenever a saved order is repaired or consumed by new work;
a confirmed upload effect cannot authorize replacement when its row disappears;
and multiple distinct new PO allocations reject before writes because reading
OPTIONS cannot reserve multiple references. These preserve the original no-drift,
no-replay contracts while explicitly bounding new-order scope until Stage 5.


## Implemented Stage 5 artifact and compatibility boundary

Full preparation freezes callbacks/options, company/MPN decisions, byte manifests
and logical targets. Execution retains the same shared policy helpers as the
bounded slice and legacy parameter ownership. Plan schema 2 adds an owned typed
`OperationSpec.settled_after` tuple, validated for missing references and cycles
alongside named-output prerequisites. Plan schema 1 still serializes without the
new field, preserving existing revisions; the SQLite schema is unchanged.

The serial scheduler permits finalization after failed/uncertain/reviewed or
blocked inventory branches settle. Confirmed effects and uncertain attempts stay
attributed independently of line completion. Source claims are distinguished from
confirmed changed fields in `invimport-execution-provenance/1`; legacy provenance
files retain their format/history. Visible local stage/extract/hash/archive/report
operations have persisted attempts. Archive bytes never contain active state or
its own upload outcome.

An explicit repair that changes the inventory effect set may authorize a new
immutable finalization revision, retaining original operation IDs, manifest,
target scope, prior bytes/receipts and transfer history. This is an audited domain
transition, not resetting mutations to READY. No-op resume does not mint arbitrary
archive revisions. Every retained revision must pass its persisted SHA before
transfer; confirmed/uncertain transfers remain verification-only for those bytes.

The library exposes current `StockImportResult` projection and versioned detailed
reports with prepared-artifact and transfer histories. Category callback choices
may supply explicit configuration but do not implicitly write local config YAML;
a future CLI must provide a frozen configuration destination/precondition contract.
More than one distinct new PO allocation still requires a verified allocator
contract. Neither restriction permits a silent fallback to legacy execution.


The independent Stage 5 review required corrections before publication: explicit
per-line archive routing/locked fallback, shared finalization target validation,
positive owned-source exclusions, approved partial-new candidate revalidation,
omitted and escaped-name location parity, transfer-versus-verification field
receipts, and completed local-retention integrity. The current implementation
uses those contracts; the initial candidate remains rejected history in the
Stage 5 handover. Local retention failure does not invalidate prior remote success
or authorize remote replay. Review clearance remains an exact-commit gate.


Independent exact-head review subsequently approved corrected implementation
`59f74e5f6095e209e84920a61ca60d6cd7d8b130`, clearing all eight findings for the
opt-in full-library stage. The handover records 221 independently passing focused tests,
150 SDK sends matching 150 intents and fresh-process recipient/unknown-transfer safeguards.
The documented limits and Stage 6 CLI/default rollout gates remain unchanged.

## Stage 6 release decision

The implemented `import-run` command is the explicit opt-in durable full stock
workflow; `import-stock` keeps its existing default/flags and montage `--plan`
schema. This deliberately defers the default switch until parity/fault gates pass.
See [operator contracts](import-run.md) and [Stage 6 handover](handovers/import-execution-stage-6.md).
Preparation is noninteractive with explicit choices; no implicit category-YAML
persistence, multi-new-PO allocator or basename conflict guessing is introduced.
Status is local and versioned, including attempt/request export. Invocation event
stream IDs/sequences are separate from durable journal sequence; snapshots rebuild
after missed render events. Resume/retry require an audited same-database continuity
reason where immutable identity is unavailable; this never overrides known drift.
Abandon keeps a blocking tombstone, not a reason-only uncertainty clearance.
Required-output prerequisite recovery differs from settlement barriers: selecting
evidence does not arbitrarily retry failed inventory branches. There is no TUI
dependency or legacy fallback after execution failure.

Stage 6 independent review identified and corrected three boundary defects:
generated outputs must be checked against actual owned run/config/input roots
(including custom registered roots without markers), journal projection/result
relationships must be validated against attempt/checkpoint/request history, and
failed event persistence must preserve cancellation exit 130. Read-only output
preflight cannot recreate missing canonical authority. RUNNING checkpoint/prior
results and BLOCKED retry-wait transitions remain valid; neither permits unknown
effects to become successful. See the Stage 6 handover for exact review/retest evidence.


## Stage 7 bounded DigiKey integration

DigiKey uses shared plans/journals/dispatch and component model policies through
its own preparation, contribution, issue and receipt handlers. It does not wrap
the legacy import in a single opaque operation or translate receipt work into
ordinary stockfile lots. The opt-in accepts exactly one complete sales order,
freezes original line identities/partial choices/location/prices, and retains the
existing default commands until broader parity/allocator release gates pass.

The order `reference` and line contribution `reference` are reviewed source
correlation, not a claimed server uniqueness/idempotency capability. Known outputs
survive interruption; unknown creates are never adopted by payload. Issue status
and exact received totals can reconcile satisfied intent without attributing
individual stock to this actor. Partial/manual receipt changes require review;
accepted or unknown receive requests are never blindly repeated.

A committed fake-latency read/download benchmark compares isolated candidate
pools. It supplies no live performance/rate/thread-safety evidence. Retain serial
execution: actual SDK dispatch/SQLite ownership, global legacy ledger, allocation
and shared-record/artifact contracts currently require it. No deployable-app,
workflow-package or plugin migration follows the exploratory discussion. See the
[Stage 7 handover](handovers/import-execution-stage-7.md) for evidence and limits.


PO-line creation additionally requires read-only target OPTIONS to advertise
writable boolean `merge_items` and `auto_pricing` controls; DigiKey also requires
a writable source `reference` of sufficient length. New previews freeze capability
evidence and `merge_items=false`, `auto_pricing=false`. Execution rechecks support
before POST and validates source quantity/price/currency before dependent work.
The [current official PO-line schema](https://docs.inventree.org/en/stable/api/schema/order/#post-apiorderpo-line)
defaults merging on; reference is not a uniqueness constraint. Metadata is an
advertised capability, not proof of server uniqueness or atomicity. Modified/older
servers without the required controls are outside this supported creation slice.

Older schema-1/2 plans remain readable without serialization or ID migration. A
new stock run from an older plan lacking frozen line controls is rejected before
mutation and must be prepared again. Existing stored runs retain their revision,
claims, outputs and history: known-output inspection/repair remains supported, but
a pending old-policy contribution cannot silently acquire new flags/reference or
be created. No active-run migration, claim clearing or generic replay is supplied.


The initial Stage 7 independent review rejected four gaps: observable extra PO
contributions could widen order-wide issue, Company identity/role was not rechecked
after PO creation, numeric source could round at JSON/Decimal boundaries, and
historical source date was omitted. Corrections centralize consumption checks,
require exact complete contribution sets before order-wide work/reconciliation,
retain/reject exact supported numeric source instead of rounding, and freeze the
shared historical date policy behind a writable target capability. Receipt amounts
use an owned Decimal context. Original rejected evidence and current corrected
validation remain recorded in the Stage 7 handover; no semantic reset/migration,
manual record rewrite or live atomicity guarantee follows from these corrections.
