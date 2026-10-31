# Import architecture

This is the current implementation through Stage 7 (independent review pending),
based on main `c22b7a1`
(including the code-organization conventions) and SDK `inventree==0.13.5`.
The ordinary stock CLI still uses the legacy workflow. The durable workflow is
an explicit library and `import-run` CLI opt-in; the legacy default is gated. See the maintained
[design](docs/import-execution-design.md), [contracts](docs/import-execution-contracts.md),
[plan](docs/import-execution-plan.md) and [stage handovers](docs/handovers/).

## Entry points and input

`__main__.py` initializes configuration and dispatches `commands/` adapters.
`commands/import_stock.py` owns arguments, prompts, progress and exit status.
`--validate`, `--schema` and `--vocabulary` remain offline. Existing `--plan` is
an InvenTree montage/review projection, distinct from an executable execution plan.

`stockfile.py` parses JSON/YAML/CSV into `StockFile` and `StockLine`. Version 2
expands shared parts/manufacturer parts while preserving logical source references.
Line IDs and `StockFile.key_for` retain `invimport:<file_id>:<line.id>` identity.
`source.reference` supplies file identity; otherwise content contributes its hash.
`part_of` must reference an earlier line. Reusing a key never authorizes restoring
historical quantity, batch, location, part assignment or consumed stock.

## Two workflow boundaries

The unchanged public `inventree.stockimport.import_stock` supports current CLI
callers and `ImportOptions`. It discovers and mutates sequentially, returns
`StockImportResult`, and uses an in-memory ledger. Discovery, matching, stock,
enrichment and finalization are interleaved. A line exception can stop subsequent
work; whole-line reruns are not durable recovery. Its existing-barcode branch
repairs selected enrichment, preserving manual fields. It may resolve a missing
location to unlocated stock. These are legacy-path limits.

The durable library lives in `execution.stock_workflow`:

```text
prepare_full_stock(document, categories, parameters, options, target, api)
    → read-only decisions and source-byte snapshots
    → immutable plan schema 2 with all approved domain/local/finalization rows
execute_stock(plan, current_target, api, run_directory)
    → canonical ownership → journal → guarded serial domain operations
repair_stock(plan, run_id, journal, operation_id, current_target, api)
    → explicit selected reconciliation → eligible dependent work
    → immutable finalization revision if the effect set changed
resume_stock(plan, run_id, journal, current_target, api)
    → interrupted-effect classification → pending work; no blind failed-write retry
```

`stock_preparation.prepare_stock` remains the bounded spec/type compatibility mode
when no options are supplied. Both entry points use the same planner and handlers;
there is no fallback to the legacy importer during execution. The full entry adds
selected enrichment and finalization. All callbacks run during preparation and
only their resolved choices become executable inputs. `ImportOptions.write` never
causes preparation to mutate inventory; `execute_stock` is the explicit execution
boundary. `commands/import_run.py` binds it to explicit CLI `--write` approval.

## Domain responsibilities

| Module | Responsibility |
|---|---|
| `stock_preparation` | Shared Part/spec/type/IPN planning, identity gates, lots, SKU/PO relationships and shared-input conflict detection |
| `stock_choices` | Read-only MPN/name/partial-spec/company decisions; selected manufacturer scopes MPN matching |
| `inventree.part_policy` | Pure manufacturer-number and parameter-ownership policies shared with legacy resolution |
| `stock_enrichment` | Manufacturer relationships, per-model parameter operations, notes, requested media and originating-company logo scope |
| `stock_taxonomy` | Explicit category/template/location creation with symbolic parent outputs |
| `stock_assets` | Stable source reads, immutable bytes and pure PDF extraction contracts |
| `stock_api` | SDK-compatible request adapter with actual endpoint checks and mandatory dispatch composition |
| `stock_handlers` / `stock_metadata` | Strict raw create/checkpoint, record revalidation and conditional empty-field/tag/link repair |
| `stock_evidence` | Attachment/primary-image transfer and remote byte verification; filename alone is insufficient |
| `stock_finalization` | Effect-derived provenance, immutable archives/revisions, retained artifact uploads and visible local report writing |
| `stock_result` | Legacy result adapter; operation state remains the authoritative detailed account |

Spec Parts carry identity parameters; manufacturer/SKU models carry their complete
selected values. Type/MPN Part ownership uses the shared legacy policy. Each
parameter has its own checkpoint and repair boundary. Identity gates can block
stock while independent enrichment/lines proceed. `part_of` needs a usable Part
output, not success of the earlier line's stock, photograph or complete group.

Genuinely omitted locations remain unlocated in full mode. An explicit requested
location cannot silently become unlocated; defaults freeze in the effective line
projection. Shared `location_names` parsing resolves escaped slash names by
name and parent identity, including ambiguous raw pathstrings.
Configured missing categories/templates and approved location paths become visible
create operations. Category callback choices can supply a configured category or
an explicit `CategoryConfig`; the reusable API does not implicitly persist local
category YAML. Existing nonempty notes/links/images remain intact. Parameter and
PO metadata conflicts require review. Tags union observed unrelated additions;
a concurrent edit after GET can still race PATCH because no atomic target update
capability has been established.

Company logos require a confirmed company-create effect from this originating run,
which persists across restart and repair. An existing company with an empty logo
is still ineligible. Full mode freezes confidence/review and partial-skip outcomes.
Creation controls retain stock scope while suppressing unselected companies/orders;
explicit callbacks end before execution. Multiple distinct new PO allocations are
rejected during preparation: OPTIONS is not a reservation, and no arbitrary
reference arithmetic is assumed. Existing/shared orders are supported.

## Ownership, transport and recovery

`ownership.py` owns a canonical runtime-discovered registry plus OS locks. Run
journals can live in custom directories without creating a second same-import
namespace. Reservations and unresolved effects survive process exit. Supported
legacy writes consult the same guard. This is one configured local state scope,
not cross-host exclusion or protection from old binaries/raw external API clients.

`store.py` owns one SQLite connection/writer. FULL-synchronous transactions commit
attempt/request intent, output PKs, effects, source attribution and settlement.
Journal failure poisons the owner and stops new mutations. JSON exports/reports
are projections, never recovery authority. SQLite schema remains 1. Plan schema 2
adds typed immutable `settled_after` dependencies; schema-1 serialization/revisions
remain readable and unchanged. Logical operation IDs retain their v1 construction.

`executor.py` schedules serially by named usable outputs and separate settled
barriers. Failed/uncertain/reviewed and irrecoverably blocked branches can settle
for finalization without becoming successful. Required outputs still gate actual
consumers. Generic retry remains read-only. Selected stock repair retains original
IDs, outputs/effects and attempts; unknown uncorrelated creates never become
payload-matched lots or PO contributions.

Every actual SDK send has a durable intent before dispatch and exactly one child
request identity. `inventree.observed_api` binds the pinned SDK request/startup/
download paths before construction; `stock_api` avoids wrapping them twice. Fake
single-request adapters use the same guards. Every child checks journal health,
owner thread, cancellation and current API endpoint/base target. Saved PK reuse
also needs target continuity evidence; URL/PK equality does not prove instance
continuity. Current PO metadata is checked both on checkpoint recovery and before
new contribution/link consumption.

Raw creates accept exactly one trustworthy object or singleton object list,
validate positive nonboolean PK and identity, and checkpoint before ledger/model/
parameter work. Malformed/multiple responses retain all trustworthy returned PK
attribution and require review. Lost create responses without reliable correlation
remain uncertain. No automatic DELETE/rollback or historical stock recreation
is introduced. Confirmed upload effects make repair verification-only when remote
listing is empty; a removed file is not permission to upload a replacement.

## Immutable evidence and reports

The frozen preview owns source bytes, manifest and logical upload targets before
hashing/ZIP work executes. Relative sources cannot escape their directory.
Canonical state roots and marked custom run directories are excluded by identity,
including nested runs and their DB sidecars. Positively recognized generated
plans/reports/provenance and the downloaded images referenced by those plans are
excluded; generated ZIPs carry an owned format marker. Generic folder names,
filenames, suffixes, vendor ZIPs and plan-like JSON keys do not establish ownership.
The existing hidden-file archive policy remains. ZIPs use deterministic entries.

Visible artifact order is settled inventory/enrichment → confirmed-change
provenance → immutable source archive → target uploads → external outcome report.
Source rows are explicitly labeled source claims. Confirmed fields come from
actual persisted effects, including effects on a line whose later work failed;
uncertain attempts remain separate from confirmed facts. Accepted transfers retain
`sent_content` claims separately; only persisted remote byte-verification receipts
can establish confirmed remote SHA/filename. Image verification confirms SHA
without inventing a remote filename. The durable provenance
format is `invimport-execution-provenance/1`, separate from untouched legacy
`invimport-provenance/1` files. No existing provenance history is rewritten.

Artifact receipts persist relative retained filename, SHA-256, size and effect-set
fingerprint. Upload validates those bytes and remote content; matching filenames
are not satisfaction evidence. Retained pending bytes survive source deletion and
no-new-inventory repair. Per-line archive routing freezes PO-preferred/supplier-fallback alternatives.
Fallback is permitted only without a checkpointed preferred output; known
identity/metadata/role drift requires review. The first validated recipient locks
in the journal across later repairs/revisions. Truly inapplicable/disabled lines
are explicitly unattached; an applicable route with no usable recipient requires
review separately from failed/unknown transfers. Finalization uses the same parent
identity and approved-metadata validator as ordinary domain consumers. No-change runs do not create arbitrary new archives.

An explicit inventory repair can append a new artifact revision under the same
approved operation IDs, frozen manifest and originating target scope. Prior bytes,
receipts and transfer outcomes remain historical evidence. Per-content transfer
history prevents replay of old confirmed or uncertain uploads while processing
new revisions. No uploaded archive is rewritten to include its own upload status.
The detailed `invimport-execution-report/1` includes operation effects/retry/blocking,
prepared revisions and transfer events. `project_stock_result` bridges current
legacy `StockImportResult` and `build_plan` consumers; supplying `run_directory`
allows its provenance outcome to reference a local file only after receipt
size/SHA validation. Completed status/resume reports current missing/corrupt local
retention separately from historical inventory/remote completion, without replaying
or reopening completed writes.

Atomic local artifact/report failures stop subsequent mutations. Best-effort
partial reporting never claims a file was saved when writing failed. Active run
state and artifacts must remain local/private; automatic retention/deletion and
portable executable resume exports are not implemented.

## Validation and remaining release gates

Tests use real SQLite plus a persistent fake remote, fresh subprocess interruption
and repair, and the actual observed pinned SDK with fake HTTP multipart/media
boundaries. These establish client behavior, not live uniqueness, exactly-once
remote effects, target identity or cross-client transaction guarantees.

Stage 6 exposes opt-in CLI prepare/execute/status/resume/retry/abandon, write
approval, JSON/exit contracts and [operational guidance](docs/import-run.md).
The default switch remains gated on parity/fault review. Category config-file persistence needs an explicit supplied
configuration target/precondition contract before a future CLI promises it.
DigiKey adds an explicit bounded order-domain opt-in described below. The library is serial;
legacy thread pools remain confined to legacy parameter/download workflows.

## Durable CLI boundary

`commands/import_run` owns parsing and presentation; `execution.run_control` owns
local discovery, consistent status/attempt/request projection and blocking audit
disposition. `repair_stock` recovers missing usable prerequisites under their
original operation IDs; settlement dependencies do not become blanket failed-line
retries. The CLI uses the existing observation/actual SDK seam throughout setup,
authentication, discovery and execution. Public SDK errors are safe class labels;
`InvocationFailure` preserves their cause for embedding callers. Library callers
remain quiet unless they opt into observation.

CLI status never connects. Resume/retry explicitly record reviewed same-database
continuity reasons; SDK server details are never promoted to immutable identity.
Abandon retains a blocking tombstone. Plan bytes and journal operations remain the
approved scope after source deletion. Invocation events and durable SQLite journal
sequences are distinct streams; status reconstructs state after renderer/event loss.
The new command has no TUI dependency, implicit local YAML writes or fallback to
legacy. Existing `import-stock` flags and montage schema remain untouched.

`execution.output_paths.GeneratedOutputs` validates generated destinations against
resolved canonical/registered/marked/new run roots and invocation source/config
identities before work and each write. Registry enumeration is read-only. Export
paths cannot replace held lock inodes or retained artifacts; unrelated equal
basenames outside owned roots remain valid. `execution.journal_validation` checks
operation projections against checkpoint/attempt/settlement history and request
bindings before store use, status and completion. Legitimate RUNNING checkpoints
and BLOCKED retry-wait projections remain readable; UNKNOWN cannot be promoted to
success through row-only corruption. Event persistence failure remains separate
from cancellation's exit 130.


## DigiKey durable order boundary

`import-run prepare-digikey` reads complete flattened order JSON exported by
`orders --order ID --json FILE`. Optional `product --json FILE` rows supply
missing model inputs. Authentication and vendor fetching stay in the existing
read commands; their complete invocation outline precedes connection/auth, with
per-send observations and cancellation-aware bounded DigiKey retry/backoff.
Token errors never export response bodies or credentials. Search POST retries
require an exact endpoint semantic-read scope. The existing request_json loop
remains the only transient retry owner; token grants make one observed attempt.
Cache/locale/account/sandbox/refresh options retain their existing interfaces.

`execution.digikey_preparation` accepts exactly one complete sales order per
invocation. It rejects a selected batch before mutations rather than importing a
subset. This preserves the inherited allocator restriction: OPTIONS offers one
reference candidate, not a reservation. No reference arithmetic or server-side
uniqueness is inferred. The import namespace is supplier PK plus original sales
order ID (`digikey.identity`), shared with supported legacy `import_orders` and
direct `import_sales_order` writers. Legacy multi-order claims are acquired under
one serial process owner before work; unresolved durable claims cannot be bypassed
by selecting the legacy writer. Canonical exclusion remains local to this state
root/user. Different source orders can progress after a run settles incomplete.

Each original source line becomes a distinct contribution; repeated SKUs are not
merged. Original explicit line IDs are retained. When absent, the immutable
original array digest plus original position is the identity; changed arrays on
an existing order require review. A line `reference` records this correlation.
Existing uncorrelated legacy lines require review, never guessed SKU/quantity
matching. Known PO/line output checkpoints survive restart. Unknown creates remain
review-only without a trustworthy saved output, even when a matching reference
appears. Existing correlated orders can add missing approved contributions after
a rejected initial create. Supported amounts use exact decimal strings within13 integer and6 fractional
digits, and currency remains frozen. Unsupported precision/range requires review. Existing quantity/price/relationship/order metadata drift blocks consumers.

`component_preparation` selects only shared Part/manufacturer/SKU/parameter builders
from `DomainPreview`; it uses normalized model inputs without creating a StockFile
or planning direct stock/barcode operations. Existing category/template mappings
and explicit manufacturer decisions are required. `records` owns shared guarded
raw-create cardinality/PK checks, identity reads and checkpoint-before-dependent-work
policies for both domains. There is no second divergent matching importer.

`digikey_handlers` separates PO creation, contribution creation, issue and receipt.
Issue reconciles observed current order status. One receipt operation dispatches
one request for multiple line amounts and records multiple line effects. Accepted
effects checkpoint before read-back. Unknown/accepted receipt requests are never
replayed. Exact approved current received totals can satisfy intent while the old
unknown attempt remains in history. This observation does not identify who created
stock and never produces guessed StockItem outputs. Partial/manual totals require
review. Preparation of a partially received existing line requires explicit
`--receive-remaining`; it freezes only the approved remainder. Consumption, manual
stock quantity changes and deleted stock are preserved. Receiving requires an
explicit resolved location, frozen by identity. `--no-receive` books only.

`digikey_workflow` uses the shared journal, ownership, semantic validation, actual
SDK dispatch guards and selected prerequisite-repair scheduler. CLI execute/status/
resume/retry/abandon keep the existing JSON, write, continuity and cancellation
contracts. Stock plans remain compatible; no default workflow changes or raw
legacy fallback follow new-engine failure. DigiKey model media/archives, interactive
category learning inside durable preparation and arbitrary multi-order allocation
remain outside this opt-in scope. Obtain and map those inputs before preparation.

The reproducible [synthetic evaluation](docs/evidence/import-concurrency-synthetic.json)
and `scripts/evaluate-import-concurrency.py` show only simulated independent I/O
latency, not live performance. Production executor workers remain one: the SQLite
writer/SDK dispatch owner, process-global legacy ledger, shared allocation/fields/
artifacts and unverified live total rate budgets do not justify parallel writes or
shared clients. Candidate synthetic pools are isolated benchmark code only.


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


DigiKey consumer preconditions reread the frozen supplier Company identity/role
and current approved PO metadata at operation entry and immediately before each
mutation, including shared model handlers. Order-wide issue/receipt and read-only
reconciliation also enumerate the complete current contribution set and require
exact approved known PK/reference/parent/part/financial identities. Unexpected,
duplicate or substituted rows require review; partial policy never approves
manual extra contributions. These are guarded observations, not a server-side
atomic conditional transaction. Known/unknown historical results remain intact.

Durable JSON input retains decimal lexemes as JSON-safe strings. Library Decimal
inputs retain their exact text; context-independent canonicalization rejects amounts
outside the declared13 integer/6 fractional digit slice instead of rounding. Receipt
subtraction owns an explicit sufficiently precise local Decimal context, independent
of an embedding caller's context. Vendor/cache decoding rejects numeric values
whose decimal value would change on legacy numeric export; safe existing numeric
interfaces remain. Previously rounded external data cannot be reconstructed.

Historical order dates use the shared `purchase_orders.as_date` order-first/sales-
fallback policy. A supplied valid date requires advertised writable creation_date
support, freezes its capability/date, and is checked on create read-back and every
consumer. Invalid, unsupported, read-only, overridden or changed dates require
review. Omitted dates remain omitted. Older DigiKey plans that omit supplied dates
or disagree with exact supported source amounts stay readable but cannot execute
under a silent semantic migration. Stock plan compatibility remains as documented.
