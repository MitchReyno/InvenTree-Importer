# Import architecture

This describes implemented behavior at Stage 0 (main baseline `b2e4a12`, SDK
`inventree==0.13.5`). Future contracts are explicitly separated below. Keep this
file current whenever a later stage changes code; update the maintained plan
and stage handover with acceptance evidence and justified changes.

## Implemented boundaries and data flow

`src/invimport/__main__.py` loads environment/configuration and dispatches command
adapters. `src/invimport/commands/import_stock.py` parses flags, validates files,
collects interactive matching decisions, renders results and chooses exit status.
`--schema`, `--vocabulary` and `--validate` do not connect to InvenTree.
A normal dry run connects and discovers remote state; it may download/cache
assets and produce local reports. It does not intentionally mutate inventory.

`src/invimport/stockfile.py` parses JSON/YAML/CSV into `StockFile`/`StockLine`.
Version 1 embeds part facts in lines; version 2 expands shared parts and
manufacturer parts into line inputs while retaining source rows. Required line
IDs identify logical lots. `StockFile.key_for` produces
`invimport:<file_id>:<line.id>`. `source.reference` supplies file identity when
present; otherwise a content-derived hash means edited input can change identity.
`part_of` in version 1 must reference an earlier line. It reuses a resolved part,
including retrieval from existing stock, rather than merging stock quantities.

```text
file + config → parse/validate → CLI decisions → import_stock
                                              ↓
       discovery/caches → line resolution + interleaved writes
                                              ↓
             company logos → provenance → archive → provenance uploads
                                              ↓
                       StockImportResult → CLI output / --plan projection
```

`inventree/stockimport.py:import_stock(document, api=None, *, directory=None,
options=None)` is the reusable, noninteractive library boundary. `ImportOptions`
carries write permissions, creation controls and caller decision callbacks;
the core returns `StockImportResult`/`LineAction` rather than calling process
exit. Callback choices can resolve ambiguity; absent callbacks yield review
outcomes. It connects itself if the caller supplies no API client.

The importer loads local category/parameter configuration and remote categories,
templates and supplier parts, then maintains per-run supplier, location, order
and part-resolution caches. It loops lines sequentially with no per-line exception
boundary. Each new line checks its barcode; resolves category, manufacturer,
part and parameters; resolves supplier/SKU, location, PO and PO contribution;
adds notes/datasheets/documents/images; creates stock; links barcode and tags;
links PO and stock images. Discovery and mutations are interleaved. Missing
location resolution can still yield stock with no location. Shared PO caches
are keyed by supplier/reference; supplier-part caches by supplier/normalized SKU.
Contradictory metadata does not yet have a general pre-execution conflict gate.

An existing barcode returns early after selected datasheet/notes/name/order reads
and attachment repair. It does not generally repair missing identity parameters,
tags, primary images, PO contributions or stock-to-PO links. Existing notes and
names are preserved. Logos apply only to companies created in the current
recording session. Category choice can persist local category configuration;
dry category creation is separately guarded by write permission.

## Implemented effects and transport

`inventree/api.py` centralizes connection/environment credentials, API 530
parameter model compatibility and an SDK-wide `InventreeObject.create` override.
The override accepts dict or list responses, selecting the first list element;
it records the resulting PK in the in-memory ledger. It does not yet validate
single-create response cardinality/identity robustly. Main includes PR #9's
DigiKey error, atomic config replacement and report-plan-read fixes.

Normal CRUD uses SDK `request`; constructor connection and `testServer` happen
before the caller receives a client. SDK `testServer` and `downloadFile` call
`requests` directly. Constructors/saves may reload models. Attachment upload uses
API `request`; notes/tags/order links use saves/PATCH; barcode lookup/link use
POST. External images/datasheets use independent download helpers. SDK 0.13.5
model `list` unwraps one `results` page without following `next`; `limit=1000`
is a page hint. Absence decisions are therefore not generally pagination-safe.

`parts.apply_parameters` issues independent parameter writes through a bounded
thread pool (up to `PARAMETER_WORKERS`); errors propagate after already-issued
siblings may have succeeded. `datasheets.prefetch` concurrently downloads PDFs
before stock lines run, with caching/duplicate URL suppression. The separate
`datasheets` command also uses a pool. Sequential stock lines do not imply all
requests are serial. DigiKey has its own fetch/auth retry behavior and separate
supplier-part/order flows; stock-specific future guarantees do not cover them.

Caches live under the runtime working-directory cache root; configuration defaults
to the package-discovered `config` directory. Local PDF extraction, reports and
plan images are additional filesystem effects. `--plan` runs **after** importing:
`inventree/importplan.py` reads existing part/stock information, downloads optional
images and writes a JSON review/montage projection. It is not an executable plan;
failed record reads now raise contextual errors, while optional image failures
retain record data. Do not repurpose this schema for execution state.

## Implemented provenance, outcomes and limitations

`inventree/ledger.py` has process-global active recording state and a lock around
its event list. It observes selected successful creates/updates and PO links,
not every effect: barcode/tag/deletion and post-recording finalization are
incomplete. It is neither a durable journal nor isolation between simultaneous
runs. Source attribution is compiled from document rows, results and these events;
a line exception can bypass its result and all ordinary finalization.

Write runs compile combined provenance in the import folder, then build a
content-named archive of eligible import-folder files and attach it to orders or
suppliers; per-record provenance follows. Combined provenance is read/append/
rewrite. Archive hashing and ZIP construction read source files separately.
Attachment deduplication is based on listings/names and metadata, not general
verified byte identity. Failed attachment listing can currently become an empty
set; attachment boolean results conflate already present and failed. A retry
cannot assume a historical upload is content-verified.

Barcode lookup currently treats every exception as absence. Barcode linking
translates every exception into `BarcodeInUse`; stock creation then attempts
compensating deletion. A lost link response can therefore trigger unsafe cleanup.
Part creation precedes parameter writes: an incomplete specification part can
fail later rediscovery, whereas an existing type part can skip missing parameters.
PO contributions are unconditional creates with no durable correlation contract.
These defects are baseline limitations to fix, not supported recovery behavior.

Normal completion counts created/exists/skipped/review lines; CLI exit 1 is based
on skipped/review lines and does not represent every selected enrichment failure.
No authoritative run store, cross-process ownership, executable mutation preview,
correlated request stream, resumable operation state or complete partial report
exists yet. Barcode fixture uniqueness is not proof of a live target's atomicity.
No local client can guarantee exactly-once remote effects after a lost response.

## Agreed target, not implemented

The [design](docs/import-execution-design.md),
[contracts and matrices](docs/import-execution-contracts.md) and
[staged plan](docs/import-execution-plan.md) define the next architecture:
small typed domain operations, explicit prerequisite outputs, pre-dispatch request
visibility, one sequential durable executor, SQLite local state and JSON exports.
Preparation is read-only; execution requires approved scope and explicit write
permission. Logical operation IDs survive resolved PKs and restart. Canonical
same-target/import ownership survives process exit and alternate run directories.
Unknown effects require reconciliation/review, never blind mutation replay.

Required identity outputs gate stock; optional enrichment can fail independently
but selected incomplete work makes the new-mode result incomplete. Preserve manual
changes and historical quantity/batch/location/part. Freeze artifact bytes once:
settled inventory → confirmed-change provenance → immutable archive → uploads →
external execution outcome. Journals and execution outputs stay outside archive
inputs. Each stage must update this file and supply a comprehensive tracked
`docs/handovers/import-execution-stage-N.md`, including decisions, plan adjustments,
validation and independent-review fixes. See the plan for gates before any claim
of durable recovery or default rollout.
