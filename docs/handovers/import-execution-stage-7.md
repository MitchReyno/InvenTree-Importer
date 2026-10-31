# Stage 7 handover — bounded DigiKey orders and measured concurrency

## Baseline, ownership and release boundary

Exact reviewed/published Stage 6 base:
`7bf771e58e4c01470a6ed9b09623936d5f885182` (PR #18), branch
`feat/import-digikey-durable-orders`, isolated Stage 7 worktree. Latest required
main `c22b7a15aca7d338733aaf820bbd19e4fadac414` remains an ancestor. The parent
checkout and other stage worktrees were not edited. Root owns publication and
fresh independent review; the stage owner made no push, PR, merge, live DigiKey
account request, live inventory request or dependency migration.

Read actual AGENTS.md, CONVENTIONS.md, ARCHITECTURE.md, maintained execution
plan/design/contracts, operator guide, Stage 3–6 handovers and Stage 6 temporary
handoff/independent review. The inherited code-organization guidance and architecture
references remain present. No shared skill/custom agent changed. No further agents
were created by this stage owner. Exploratory deployable-app/workflow-package/plugin
questions did not change course or introduce a new product/dependency boundary.

**Implementation scope:** explicit `import-run prepare-digikey` and library opt-in,
exactly one complete sales order per preparation, shared component model creation,
distinct contributions, separate issue and one multi-line receipt, durable selected
repair/recovery. Existing ordinary command defaults remain legacy. Product media,
downloaded datasheet attachments and per-order evidence archives are not included
in this bounded DigiKey preview. Existing taxonomy/templates must be mapped first.
This is not a default-rollout/parity or arbitrary multi-order allocator clearance.
Independent exact-head review remains pending at this owner handover milestone.

## Actual work and integration steps

1. Created the isolated branch/worktree at the exact Stage 6 base. The initial
   Git ref write hit the sandbox; scoped escalation created the authorized local
   tree. A direct uv invocation then hit its ordinary home-cache permission;
   development used the existing pinned interpreter with explicit source paths.
   No installation or network/dependency update was needed.
2. Traced public commands through `digikey.api`, orders/products fetching,
   `inventree.purchase_orders` and existing shared stock preparation/handlers.
   Legacy order processing combined issue/receive and reused lines by supplier
   part; wrapping that whole importer could not provide contribution recovery.
3. Added observation around supported DigiKey CLI invocations before setup/auth,
   and around every actual token/GET/search exchange. Existing request_json owns
   its four-attempt safe-read budget; no additional retry loop was layered above
   it. Token grants are one observed attempt. Semantic search POST is declared
   with an exact endpoint scope; arbitrary POSTs stay nonretryable mutations.
   Retry/pacing waits check cancellation at bounded intervals. Token and request
   public errors exclude bodies, headers, credentials and signed URLs.
4. Added `digikey.identity` source-order namespaces and retained source line IDs
   when present. Absent IDs use original position scoped by the immutable complete
   original line-array digest. Repeated identical SKUs/quantities remain separate.
   Changing an array without explicit IDs cannot guess onto an old order.
5. Added read-only `digikey_preparation`: freezes complete source, original
   contribution identities, selected supplier/SKU/price/currency, explicit location,
   partial choices and optional approved remaining amounts before any mutation.
   A selected multi-order batch is rejected as a whole. OPTIONS yields a single
   proposed new PO reference; no arithmetic/reservation/uniqueness is inferred.
6. Exposed the existing model planner as `DomainPreview`, and added
   `component_preparation` selecting shared Part/manufacturer/SKU/parameter builders
   from supplied normalized product inputs. It does not create a dummy StockFile
   or direct stock/barcode operations. Matching, manufacturer scoping, category
   parameter ownership and per-record recovery remain shared with stock imports.
7. Extracted purpose-owned `records` policies for raw creates, strict cardinality/
   PK identity, known record reads, effect attribution and checkpoint-before-model/
   dependent-work handling. Both domains consume these policies. Extracted
   `domain_repair` for typed selected prerequisite repair; DigiKey does not import
   a command or opaque whole-stock workflow as its lower execution interface.
8. Added distinct `dk_order`, `dk_line`, `dk_issue`, `dk_receive` handlers and
   `digikey_workflow`. Rejected no-effect line creation permits explicit repair
   under its original operation ID. Known created PO/line PKs survive interruption.
   Unknown uncorrelated creates remain uncertain even when a payload/reference
   match appears; no create replay or new-ID workaround is allowed.
9. Issue reconciliation reads current order status before any further action.
   Receipt is one endpoint exchange with multiple line effects, accepted effects
   checkpoint before read-back, and exact current totals can establish satisfied
   intent. Original unknown attempts remain in history. Totals do not establish
   actor attribution or StockItem identity; no stock PK is guessed. Partial/manual
   totals require review. Accepted/unknown requests are never blindly repeated.
   Existing consumed quantities/deleted stock are preserved.
10. Bound explicit public CLI prepare/execute/status/resume/retry/abandon to the
    correct domain. Preparation consumes exported order/product JSON and resolved
    numeric PKs. Existing generated-output protection, clean machine stdout,
    incomplete=1/usage=2/Ctrl-C=130, continuity review, local-only status, blocking
    abandonment and no fallback contracts remain. Frozen source values allow
    recovery after external source JSON deletion.
11. Guarded legacy `import_orders` and direct `import_sales_order` writes in the
    same canonical source-order namespace. A multi-order legacy invocation acquires
    all selected claims before remote work under one serial process owner. Nested
    supported sales-order calls reuse their held claim. Known acquisition failure
    may close only newly acquired no-dispatch reservations; exceptions after work
    starts preserve unresolved claims. Other source orders can proceed once an
    incomplete run has stopped, without clearing the original claim.
12. Added reproducible synthetic read/download evaluation and committed JSON
    samples. No production executor workers, SDK client sharing or write pools
    were enabled. Updated architecture, maintained plan/design/contracts and
    operator guidance with the actual supported boundary and remaining gates.

## Decisions and plan adjustments

| Decision / adjustment | Engineering rationale and rejected alternative |
|---|---|
| One complete sales order per durable invocation | No supported server allocator/reservation capability has been established. Explicit whole-batch rejection is reviewable; silent truncation or planning later orders after earlier mutations is not. Existing legacy batch options remain available under canonical exclusion. |
| Original contribution references, never SKU/quantity identity | Duplicate-looking lines can represent distinct source contributions. Explicit IDs or frozen array identity preserve them; existing uncorrelated legacy orders require review rather than guessed repair. Reference is correlation, not uniqueness. |
| Shared model-only preparation | Reuses existing Part/manufacturer/SKU/parameter policies without double-creating stock through a StockFile conversion followed by receipt. Missing mappings/choices fail before execution. |
| Separate issue and one multi-effect receipt | Matches actual endpoint semantics. Synthetic per-line receive requests would invent recovery/atomicity boundaries the server does not expose. |
| Observed totals can satisfy intent without stock ownership | Full exact line totals avoid duplicate receipt after lost response and preserve consumed/deleted stock. They cannot identify the actor or individual StockItems. Partial/manual totals remain review-only. |
| Explicit initial remaining-amount choice | Existing partially received lines freeze only an approved remainder. A changed/partial unknown receipt never auto-receives the rest; approval is not inferred from the old baseline. |
| Keep one safe-read retry owner | DigiKey request_json already owns bounded retries. Observing each actual attempt and interruptible waits avoids hidden multiplied budgets. OAuth grants retain a one-attempt bound. |
| Retain serial production execution | Synthetic overlap is not proof of SDK thread safety, live rate budgets, isolated global ledger ownership or shared allocation/field/artifact safety. No pool was added to the executor simply to complete Stage 7. |
| Bounded model/receipt release, legacy default retained | Full DigiKey media/archive/interactive category-learning parity is not claimed. Supplied products and pre-mapped taxonomy keep preparation honest and reviewable; existing commands preserve their options. |

### PO-line capability correction during integration

Root identified a concrete API contract during implementation: the
[current official PO-line schema](https://docs.inventree.org/en/stable/api/schema/order/#post-apiorderpo-line)
defaults `merge_items` to true; `reference` is not unique. It also exposes
`auto_pricing`. The owner verified this public documentation without calling any
live inventory/account. The initial fake always inserted lines and therefore did
not expose the server's default merging behavior.

The correction adds focused shared `order_line_policy`: read-only target OPTIONS
must advertise writable boolean `merge_items` and `auto_pricing`, and DigiKey also
requires a writable reference with sufficient capacity. New previews freeze the
capability evidence plus `merge_items=false` and `auto_pricing=false`. Execution
rechecks support before POST. Both domains check approved financial fields before
consumers. The persistent fake now actually merges same-part lines by default and
can auto-reprice; regressions prove explicit opt-outs preserve distinct lines and
source prices. A target overriding approved price/currency blocks issue/receipt.

This also corrects the inherited stock contribution assumption, without changing
logical IDs, schema serialization or known output identity. Older schema-1/2 plans
remain readable and roundtrip unchanged. Starting a fresh old-policy stock plan is
rejected before mutation and requires reprepare. Existing stored runs keep their
revision/claims/history/outputs; known records remain inspectable/repairable, but
pending old-policy line creation requires review and cannot silently acquire new
flags/reference/financial intent. Active-run semantic migration and claim clearing
are not supplied. Older/modified servers without advertised controls are outside
this supported creation slice. OPTIONS is advertised metadata, not live uniqueness
or atomicity proof.

### Development corrections and failed checks

- First public CLI wrapping hid controlled missing-account/supplier diagnostics.
  Expected domain/configuration error types now keep their controlled messages;
  unknown SDK exceptions still surface only safe class labels with cause retained.
- Initial legacy batch guarding nested independent process-writer scopes, causing
  two multi-order regressions. The multi-claim guard now acquires one process owner
  and all order claims before work, preserving direct-call nesting and exclusion.
- A first actual-SDK test compared an unordered SQLite PK scan with dispatch order;
  it now deliberately orders by rowid. Every actual send still asserts its matching
  request is already INTENT immediately before dispatch.
- The initial component fixture omitted its required category alias. The test was
  corrected to supply the same explicit mapping required by the real policy.
- Initial Ruff found extraction leftovers/fixture import aliases; these were fixed.
  Final staged whitespace inspection also caught a new-file trailing blank line
  omitted by the earlier unstaged/untracked check; it was removed and rechecked.
- A developmental broad run (not final evidence) reported 34 failed, 1766 passed,
  1 existing skip, 43 deselected in147.97s. Twenty-nine failures were fresh-child
  import-path errors, two were legacy multi-claim nesting, and three were the
  controlled-CLI diagnostic issues above. The test
  environment reused the parent installed editable project without inherited
  worktree PYTHONPATH. Corrected runs explicitly set `PYTHONPATH=.:src`, as required
  by inherited fresh-process fixtures. No application fallback or test skipping
  was introduced to hide these failures. Exact grouping is shown by the recorded
  failure list; final corrected results follow below.
- Root also identified stale future-stage wording in the operator rollout gates;
  it now states the bounded implemented scope and remaining live/parity limits.
- The first uv cache access was sandbox-denied. Existing pinned interpreter plus
  task-local cache avoided installation. Scoped escalation permits only local
  loopback test stubs. A read-only `ps` diagnostic was sandbox-denied; no process
  control workaround or live-service action followed it.

## Validation evidence

All inventory effects below use persistent local fake state/SQLite or actual
pinned SDK methods with fake HTTP. No live API uniqueness, allocator, immutable
server identity, conditional update, cross-client atomicity or exactly-once remote
effect claim follows from these tests.

Development focused results:

- Initial inherited DigiKey + stock/full-domain selection:179 passed in43.86s.
- Initial dedicated durable order fault selection:12 passed, then expanded16,
  21 and25 passing cases as described above. These counts are historical checks,
  not added together as independent final coverage.
- Dedicated DigiKey + inherited stock selection after capability changes:
  **100 passed in43.51s**. Shared old-plan/no-merge selection: **2 passed in0.78s**.
- Dedicated tests exercise persistent fake remote with fresh processes for lost
  issue/receipt responses and actual process termination; known PO/line checkpoints
  survive a process exit before dependent reads; unknown creates remain review.
- Actual pinned observed SDK test checks every send's persisted INTENT before
  dispatch, counts exactly one durable child per send and tests lost issue/receipt
  composition. Auth/search tests inspect every retry, explicit semantic POST read
  permission, cancellation during backoff and credential/body/signed-URL canaries.
- Public fresh-process CLI test prepares read-only, previews without writes,
  executes an incomplete rejected-line run, deletes external source/plan, resumes,
  repairs its original ID and obtains complete local status with clean JSON and
  sequenced safe event export.

Final required focused/normal/scanner/Ruff/whitespace results are recorded after
completion below. Independent review has not yet been requested/cleared by owner
checks alone. No workflow-sync test is required because no skill/agent changed.

## Synthetic concurrency evaluation

Reproduce using the existing environment:

```sh
uv run python scripts/evaluate-import-concurrency.py --tasks 24 --latency-seconds 0.01 --repeats 3
```

Committed evidence: `docs/evidence/import-concurrency-synthetic.json`.
Three repetitions of24 independent alternating read/download-shaped fake calls
at10ms simulated latency produce median elapsed seconds:

| Candidate workers | Median seconds | Requests/completions per sample |
|---|---:|---:|
| 1 | 0.295979 | 24 /24 |
| 2 | 0.149988 | 24 /24 |
| 4 | 0.075688 | 24 /24 |

These are synthetic scheduling/observation measurements: zero network calls, no
real CDN/auth/throttle, connection pool, filesystem cache or remote service. Each
task owns its fake transport. Values vary with local scheduler/load. They show
possible overlap under assumed latency, not production gains. Production executor
workers stay one. Future read/download pools require explicit client ownership,
total rate/backoff/cancellation budgets and artifact conflict handling; parallel
writes additionally require allocator/record ownership and global ledger isolation.

## Operational guidance and remaining gates

Use the full commands and recovery guidance in `docs/import-run.md`. Read commands
produce flattened complete order/product JSON; prepare with resolved supplier and
location PKs and optional supplied missing-model inputs. Review all operations and
partial/remaining choices before explicit `execute --write`. Status is local;
resume/retry use reviewed same-database continuity and never force/rebase/reset.
Keep the canonical registry plus entire run directory/SQLite history together.
Changing state roots/hosts, old binaries and raw clients bypass local coordination.
Abandon remains a blocking tombstone.

Retain these limits in publication:

- Exactly one complete sales order per durable preparation; no arbitrary allocator.
- Explicit opt-in/default parity gate; pre-mapped taxonomy/templates/manufacturer
  choices; no new DigiKey media/archive workflow in this bounded release.
- Uncorrelated legacy contributions/unknown creates and partial/manual receipt
  outcomes require review. No automatic StockItem actor/PK attribution or recreation.
- Advertised PO-line capabilities required; no implicit active-plan migration.
- Serial local owner/SQLite/SDK dispatch; synthetic evidence is not live performance.
- Inherited immutable artifact/history, safe outputs, continuity, semantic journal
  validation, local retention and stock behavior remain regression requirements.

Independent exact-head review corrections and final disposition will be appended
without rewriting the development/review history. Root alone publishes after a
fresh reviewer clears the exact committed candidate; no merge is authorized here.


## Final owner validation and candidate disposition

Final runtime checks, with explicit worktree `PYTHONPATH=.:src`, existing pinned
environment and task-local uv cache:

- `make test`: **1804 passed, 1 existing skip, 43 deselected in159.58s**.
  The preceding corrected broad run also passed1804/1skip/43deselected in155.63s;
  it preceded the final generic repair extraction, so the159.58s run is final
  runtime evidence. Normal runs used scoped local-loopback permission.
- `pytest tests/execution tests/inventree/test_request_observation.py tests/digikey/test_api.py -q -x -o addopts=''`:
  **320 passed in124.15s** on final runtime.
- `make test-scanner`: **43 passed, 1805 deselected in46.17s**. Required because
  observation/control and shared dispatch/ownership boundaries changed. No actual
  scanner hardware or live services were used.
- Changed Python Ruff and complete `git diff --check`: pass. README/AGENTS retain
  architecture references, new repository content has no embedded checkout/home/
  temporary absolute paths, and latest required main ancestry is verified.
- A final README/operator/handbook status update and command-help wording correction
  followed the suites; these change documentation/presentation only. Command help
  and final Ruff/whitespace were checked separately. No effect/recovery code changed
  after the final suites above.

Portable equivalent commands (the owner selected the existing environment through
`UV_PROJECT_ENVIRONMENT` and a task-local `UV_CACHE_DIR`, with `UV_NO_SYNC=1`):

```sh
PYTHONPATH=.:src UV_NO_SYNC=1 make test
PYTHONPATH=.:src pytest tests/execution tests/inventree/test_request_observation.py tests/digikey/test_api.py -q -x -o addopts=''
PYTHONPATH=.:src UV_NO_SYNC=1 make test-scanner
ruff check src/invimport scripts/evaluate-import-concurrency.py tests/execution/digikey_server.py tests/execution/test_digikey_workflow.py tests/execution/test_order_line_policy.py tests/digikey/test_api.py tests/support.py tests/execution/stock_server.py
git diff --check
```

Owner validation is complete for this bounded candidate. Root must assign a fresh
independent reviewer to its exact committed hash before publication. No independent
approval or all-release-gates-passed claim is implied by these owner results. The
one-order, media/parity, advertised-capability, old-plan, local/serial and live-server
limits above remain. Publication/PR opening/merge were not performed by the owner.
