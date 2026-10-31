# Import architecture

This is the current implementation through Stage 5, based on main `c22b7a1`
(including the code-organization conventions) and SDK `inventree==0.13.5`.
The ordinary stock CLI still uses the legacy workflow. The durable workflow is
an explicit library opt-in; CLI rollout belongs to Stage 6. See the maintained
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
boundary. Stage 6 must bind this boundary to CLI write approval.

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

Missing explicit locations cannot silently become unlocated in durable mode.
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
including nested runs; DB sidecars, generated plans/reports, old provenance and
report image directories are excluded too. ZIPs use deterministic entries.

Visible artifact order is settled inventory/enrichment → confirmed-change
provenance → immutable source archive → target uploads → external outcome report.
Source rows are explicitly labeled source claims. Confirmed fields come from
actual persisted effects, including effects on a line whose later work failed;
uncertain attempts remain separate from confirmed facts. The durable provenance
format is `invimport-execution-provenance/1`, separate from untouched legacy
`invimport-provenance/1` files. No existing provenance history is rewritten.

Artifact receipts persist relative retained filename, SHA-256, size and effect-set
fingerprint. Upload validates those bytes and remote content; matching filenames
are not satisfaction evidence. Retained pending bytes survive source deletion and
no-new-inventory repair. Missing applicable targets are skipped separately from
failed transfers. No-change runs do not create arbitrary new archives.

An explicit inventory repair can append a new artifact revision under the same
approved operation IDs, frozen manifest and originating target scope. Prior bytes,
receipts and transfer outcomes remain historical evidence. Per-content transfer
history prevents replay of old confirmed or uncertain uploads while processing
new revisions. No uploaded archive is rewritten to include its own upload status.
The detailed `invimport-execution-report/1` includes operation effects/retry/blocking,
prepared revisions and transfer events. `project_stock_result` bridges current
legacy `StockImportResult` and `build_plan` consumers; supplying `run_directory`
allows its provenance outcome to reference an actually retained local file.

Atomic local artifact/report failures stop subsequent mutations. Best-effort
partial reporting never claims a file was saved when writing failed. Active run
state and artifacts must remain local/private; automatic retention/deletion and
portable executable resume exports are not implemented.

## Validation and remaining release gates

Tests use real SQLite plus a persistent fake remote, fresh subprocess interruption
and repair, and the actual observed pinned SDK with fake HTTP multipart/media
boundaries. These establish client behavior, not live uniqueness, exactly-once
remote effects, target identity or cross-client transaction guarantees.

Stage 6 owns CLI prepare/execute/status/resume/retry presentation, write approval,
JSON/exit contracts, operational retention documentation and default rollout after
review/parity gates. Category config-file persistence needs an explicit supplied
configuration target/precondition contract before a future CLI promises it.
DigiKey migration and bounded concurrency remain Stage 7. The library is serial;
legacy thread pools remain confined to legacy parameter/download workflows.
