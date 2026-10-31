# Import architecture

This describes implemented behavior through Stage 1 (reviewed Stage 0 baseline
`bfaefd1`, main `c22b7a1`, SDK `inventree==0.13.5`). This includes PR #9 fixes
and PR #11 code-organization conventions; the latter changes guidance, not
runtime behavior. Future contracts are explicitly separated below. Keep this
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
model `list` still unwraps only one page. Importer collection consumers now use
`inventree/collections.py:list_rows/list_models` explicitly instead of SDK `list`.
They enumerate list or `results`/`next` responses completely, preserving narrow
filters, with 1,000-page / 100,000-row bounds, repeated-request/page detection,
model identity validation and final count checks when supplied. Invalid, partial,
late-failed or unsafe-target collections raise `DiscoveryError` (an
`InvenTreeError`); callers cannot use a partial prefix as absence.

Pagination accepts same-origin links strictly beneath the configured API root,
rejects scheme/host/root escapes, credentials, fragments, encoded traversal,
ambiguous query fields and SDK scheme-like endpoint tricks before dispatch. Query
strings are passed separately because SDK URL construction appends a slash.
This validates application pagination targets, not general SDK redirects or live
server completeness guarantees. `limit=1000` remains a page hint. Complete reads
cover categories/templates/units, companies, part/manufacturer/supplier matching,
locations/orders, parameters, attachment discovery and report stock collections.
Known MPN part identity uses a detail read; supplier-part caches load per supplier,
and specification matching reads each candidate part's parameters rather than
all server parameters. Shared helper consumers in DigiKey commands gain these read
fixes too; their execution/recovery migration remains Stage 7.

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
Attachment deduplication is based on complete listings/names and metadata, not
general verified byte identity. A failed list blocks the upload. The structured
`AttachmentOutcome` distinguishes uploaded, already_satisfied, failed and unknown;
`attach_file` still returns True only for a confirmed new upload. Datasheet and
photo/document count APIs retain new-upload counts. Datasheet backfill, provenance
and archives consume structured satisfaction; archive/provenance expose unknown
outcomes. A lost upload is unknown, and a retry cannot assume a historical upload
is content-verified. No durable evidence retry policy exists yet.

Barcode lookup recognizes only the exact supported HTTP 400 no-match error as
absence; auth, validation, transient, transport and invalid responses fail closed.
Ownership responses must contain exactly one recognized model with a positive
integer PK; malformed mixed-model payloads cannot fall through to absence.
Localized/changed no-match text needs explicit support rather than guessing.
Linking reads ownership back even after a successful POST. Confirmed intended
ownership succeeds; confirmed different stock ownership raises `BarcodeInUse`.
Only that latter case permits deletion of the duplicate created by the current
call. Uncertain link/read-back or deletion retains a structured `BarcodeError`
with known stock PK and does not claim registration success. The importer reuses
that confirmed conflict owner rather than performing an uncertain second lookup.
These diagnostics are in memory only; an ambiguous stock create still lacks a
durable identity or recovery guard.
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

Future implementation follows CONVENTIONS.md: keep orchestration as named domain
operations with explicit inputs/options, let classes own coherent per-run state or
resources, and introduce module/package boundaries only where responsibilities
justify them. Dependencies flow from commands to reusable workflows to lower-level
operations; lower-level code must not import commands. Keep behavior tests and
scenario fixtures near their integration package instead of exposing implementation
stages as test APIs. These constraints refine organization without changing recovery
or compatibility contracts.
