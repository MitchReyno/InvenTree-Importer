# Stage 7 handover — bounded DigiKey orders and measured concurrency

Current disposition: **independently approved** at exact implementation hash
`b27badf80a03c3b753a5293010054514c4a064c8`. All six material findings are cleared.
The [final independent clearance](#final-independent-clearance) supersedes the
historical pending milestones below while preserving both rejected candidates.

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
At the initial owner handover milestone, independent review was pending; the
final clearance below records the current approved disposition.

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


## Initial independent rejection and four corrections

Independent review **did not approve** exact initial candidate
`343bea94199b0f9f8847e38599781dbe74752dee`. The temporary independent report
`stage7-review.md` records four confirmed findings and adverse reproductions.
This initial disposition is preserved; no mutable correction or owner test result
constitutes independent approval. Inherited independent stock/CLI adverse probes
passed at the initial head (154 actual SDK sends/intents, original unknown archive
transfer retained across revision2, safe output locks/artifacts, semantic journal
corruption rejection, Ctrl-C/export precedence and active-writer/SIGINT recovery).
Those inherited results do not clear these DigiKey findings.

### P1: observable manual contributions widened an order-wide issue

The reviewer inserted an unapproved quantity900/reference manual-unapproved line
after the approved contribution POST. Initial execution issued the whole expanded
PO, received the approved5 and returned complete=true. Required-record validation
alone did not establish the complete current approved source scope.

Correction: guarded complete enumeration before issue, receipt and their observed-
satisfaction/selected-repair paths requires exactly the approved known output PKs,
source references, parent/Part identities and financial fields. Duplicate-correlated,
unexpected or substituted rows require review. The same policy repeats immediately
before mutation. Manual rows are preserved. Partial-order selection continues to
approve only its explicit source contributions. Tests cover insertion after prepare,
line creation and issue, plus extra rows after unknown receipt in a fresh process.
The original extra-line reproduction now reports incomplete, PO status10 and no
stock; no order-wide issue occurred. No remote conditional/atomicity is claimed
against an actor racing after the last observed read.

### P1: supplier Company identity/role stopped being checked after dk_order

The reviewer renamed the supplier and removed is_supplier immediately after PO
creation. Initial execution still created a line, issued and received stock with
complete=true. Reusing the same supplier PK on the PO/SupplierPart did not prove
the Company remained the approved supplier.

Correction: a shared Company-role record policy participates in every DigiKey
operation/reconciliation and every before-mutation consumption callback, including
shared Part/manufacturer/SKU/parameter handlers. Current approved PO metadata is
checked in the same policy. Validation runs before the actual mutation request
intent and keeps exactly one journal child per actual SDK/fake send. Tests cover
rename, role removal and deletion after PO creation and after issue; fresh-process
repair; and drift during an in-progress shared model lookup before its create.
Earlier confirmed outputs/effects remain. The supplier reproduction's original
reporter assumed every blocked row had a result and now fails on legitimate
blocked/None rows; an owner copy changed only this reporting and caught expected
precision rejection. It reports incomplete, line needs_review, issue/receive
blocked, no stock, and unchanged invalid Company.

### P2: numeric JSON and Decimal normalization rounded source values

The reviewer's public CLI source literal0.10000000000000001 became0.1 before
approval and execution; string0.12345678901234567890123456789012345 also rounded
through Decimal.normalize at default precision28.

Correction: durable JSON decoding retains decimal lexemes as JSON-safe strings.
Library Decimal source values retain exact text before canonical JSON freezing.
Context-independent formatting rejects unsupported values instead of normalizing
with rounding. The declared supported quantity/price/received bound is13 integer
and6 fractional digits, consistent with the documented PO price slice; zero price
is supported. Receipt subtraction owns a sufficiently precise local context so an
embedding caller's lower Decimal precision cannot alter a POST amount. Tests cover
exact bounds, Decimal/string/numeric literals, negative/nonfinite values, huge
exponents, zero price and maximum fractional remaining-quantity arithmetic.

Vendor/cache decoding also rejects numeric literals whose decimal value would
change on legacy numeric export, retaining existing safe numeric interface types.
Exact string input remains supported; previously rounded external data cannot be
reconstructed. Test fake decoding accepts parser kwargs so real JSON lexical
behavior is exercised. The original CLI price probe now has prepare exit1/no plan;
its old attempt to read a non-existent accepted plan fails as expected. No mutation
is performed. A dedicated library regression initially exposed Decimal source
serialization before the amount classifier; copying Decimal values to exact text
now makes it a controlled preparation review. This intermediate failure was fixed
and the source/error boundary was rerun.

This tightens a declared supported bound; it does not silently round broader server
values or alter a saved approval. Old DigiKey plans with unsupported/different exact
source amounts remain readable but cannot execute or resume by implicit migration.
Claims, IDs and historical evidence remain untouched.

### P2: accepted historical source date was omitted from PO metadata

The reviewer supplied date_entered2024-05-06T12:30:00. Initial preparation accepted
it with unsupported=[] but omitted creation_date, unlike the legacy shared as_date
policy, allowing the target's current-date default to replace historical intent.

Correction: use shared as_date with order-first/sales-fallback precedence. Supplied
valid dates require advertised writable creation_date date capability; freeze date/
capability, recheck before create and verify returned/existing/current metadata for
all consumers. Invalid, unsupported/read-only, overridden and later changed dates
require review. Absent dates remain omitted. Tests cover precedence, malformed and
absent values, unsupported/read-only metadata, capability drift, target override,
after-issue date drift and fresh-process repair. The original date reproduction
now freezes/stores2024-05-06 and completes with that historical date. Older DigiKey
plans that omitted a supplied historical date remain readable but are rejected
before execution; no active-plan semantic migration or claim clearing is provided.

### Correction development evidence and status

- First correction regression selection:43 passed in6.93s, then expanded to47
  review cases plus three vendor/cache precision cases. Broader DigiKey/capability/
  API selection:170 passed in19.01s. Counts are historical, not added together.
- Raw original adverse reporters were run; extra-line/date outcomes corrected as
  above, supplier reporter required only null-safe reporting, and price reporter
  now encounters the deliberately absent rejected plan. Dedicated regressions
  verify the intended new outcomes rather than expecting old success reporters
  to exit0. No production fallback or skipped acceptance case was introduced.
- Scanner/control correction run completed43 passed/1856 deselected in42.93s.
  A subsequent numeric-only owned-context regression does not change shared
  observation/control/scanner behavior; final full/focused results follow below.
- A low embedding Decimal precision case was added during owner audit after the
  first corrected broad run started. Receipt subtraction now owns its precision.
  That early broad run is developmental evidence; a final full/focused run after
  this last numeric change is required before the corrected candidate is committed.

All four fixes preserve unknown/confirmed history, original IDs/output PKs, target/
continuity checks, exact generated-output protection, schema1/2 readability, local
canonical ownership, immutable stock artifacts/revisions and explicit opt-in scope.
One-order/model-only/no-media/archive, advertised capabilities, old-plan review,
serial/local and unverified live-server limits remain. Root assigns the independent
exact corrected-head recheck after owner validation/commit; no approval is claimed.


## Corrected owner checks and exact-head recheck request

All four independent findings above are corrected in the next local candidate;
independent corrected-head clearance is still required. Final effect/recovery
runtime results with explicit worktree PYTHONPATH and pinned existing environment:

- `make test`: **1856 passed, 1 existing skip, 43 deselected in170.53s**.
- Focused execution + actual SDK observation + DigiKey API: **372 passed in138.21s**.
  This includes48 independent-review regressions and four added API/cache numeric
  cases, in addition to the initial candidate's coverage.
- `make test-scanner`: **43 passed, 1856 deselected in42.93s** on the final shared
  observation/control changes. Only numeric receipt local-context handling and its
  regression followed that scanner run; scanner/control behavior did not change.
- Prior corrected broad1855/1skip/43deselected158.65s and focused371/124.10s are
  developmental evidence before the final embedding-context case, not substitutes
  for the final1856/372 results.
- Owned numeric-context/new review/API selection: **82 passed in9.17s** during the
  final audit. A final import-order/docstring/error-wording-only cleanup follows
  the broad suites, with targeted regression, Ruff and whitespace recheck. No
  effect/precondition/identity/arithmetic behavior changed in that cleanup.
- Required uv Ruff over changed Python and all src passes; complete base-to-head
  whitespace and clean-status/ancestry checks accompany the committed candidate.
  All test effects remain fake/persistent local SQLite or observed SDK fake HTTP.

The PR Decisions/Plan adjustments must include the four corrections, the13+6
source-amount support bound, supplier/exact-set consumption, historical creation_date
capability and preservation of older plan claims/history without semantic migration.
All initial release limits and the original four-finding rejection remain preserved.
Root alone publishes after fresh independent review of the exact corrected hash.


Final presentation-only cleanup recheck:82 passed in8.64s; uv Ruff passes and
complete staged whitespace passes. Corrected owner validation is complete and the
worktree is committed clean for independent exact-head recheck. Initial343bea9
rejection is retained above. Root publication remains blocked until that independent
recheck approves; the stage owner has not pushed, opened a PR, merged or called a
live account/inventory service.


## Second exact-head recheck rejection and residual receipt corrections

Independent recheck of `c5eab95b1dab46c9f056fdc92018500fc2af9b0a` confirmed
the earlier source/Company/complete-set fixes, but **did not approve** the candidate:

- P1: receipt amount/status selection used cached inputs. The independent
  `stage7-receipt-revalidation-repro.py` manually changed received0→5 during the
  location lookup; a later guarded line collection explicitly saw5, but the
  cached payload still received5 again and made10. This was observable drift,
  not an unavoidable final-read/POST race.
- The same P1 includes `stage7-receipt-status-repro.py`: status20→40 during location
  lookup was later reread as40, but metadata-only checks ignored status and sent
  the cached receipt5, completing over a cancelled order.
- Related P2: accepted receipt/readback conflict called review with confirmed
  effects but aggregate certainty none. OperationResult correctly rejected that
  invalid combination with ValueError, hiding the intended review outcome behind
  an unexpected exception. Accepted effects still existed in the checkpoint.

Reviewer exact-head focused372 passed in119.73s; those passing cases did not cover
these late boundaries. No initial/corrected approval is inferred from owner counts
or from that independent focused pass. Original rejected evidence remains intact.

### Actual corrections and rationale

1. Refresh current order status and line totals after the location lookup, rather
   than selecting amounts from the earlier dependency-read cache. Changed partial
   totals remain review-only against frozen approval; a full current total can
   satisfy intent without a new receive. There is no automatic new remainder.
2. Bind selected receipt state in an immutable ReceiptPreconditions record. The
   final domain callback revalidates location first, Company/PO/current status,
   complete contribution identity/financial scope and exact selected totals. The
   callback then journals checked status/totals/location before mutation intent.
   It replaces the metadata-only callback with its stricter superset; no actual
   SDK send acquires an invented second journal wrapper.
3. Require current pending10 immediately before actual issue and open20 immediately
   before actual receive. Stable full totals may settle read-only on20/30; closed
   status30 with outstanding amounts and cancelled/held/reset states cannot receive.
   Current state is revalidated before no-write satisfaction resolves old uncertainty.
4. If final selected preconditions changed, return valid needs-review without a
   mutation intent or endpoint send. Restore the attempt's ordinary callback after
   the selected call. A fresh selected repair reads current state under the same
   operation/claim; it cannot automatically receive changed partial amounts.
5. Derive shared review aggregate certainty from retained effects. Confirmed-only
   effects produce confirmed needs-review; mixed/explicit unknown effects retain
   uncertain aggregate/state. Receipt readback conflicts, including unsupported
   amounts, preserve accepted effects as review data without constructor failure.
   Accepted or unknown receipt requests remain nonreplayable.

The stronger receipt check is necessary even after complete-set/Company validation:
identity and approved quantity do not establish the current received baseline or
order status. It does not claim atomic multi-record reads/POST against an actor
changing state after the last relevant observation. No broader workflow, concurrency,
allocation, plan migration or release-scope expansion was introduced.

### Regression and reproduction evidence

Added23 meaningful late-boundary tests in
`tests/execution/test_digikey_receipt_preconditions.py`:

- manual received0→partial2/full5 at initial location resolution and final callback;
  no receive POST/mutation intent, no quantity10, no new StockItem; partial stays
  review-only in a fresh process, full intent can settle without replay/ownership guess;
- current status10/30/40/50 at both boundaries, late location rename/deletion, and
  current issue status20/30/40 before dispatch; no stale order transition/receipt;
- accepted normal-response receipt with readback3 or unsupported5.0000001 returns
  valid confirmed/needs-review, retains accepted effect, preserves stock/manual
  counters, and fresh-process repair never sends a second receipt;
- lost receipt reconciliation with completed/cancelled status or a total changing
  during no-write satisfaction; old uncertainty remains when state is unstable,
  exactly one historical receipt/StockItem remains, and no stock PK is guessed;
- direct mixed/confirmed review aggregate validation.

First new selection:23 passed in9.56s; inherited DigiKey + four-finding selection:
75 passed in19.01s. Both independent original residual scripts ran unchanged on
the corrected working tree: manual full received remains5, operation settles
already_satisfied with zero receive sends/new stock; cancelled40 remains40 with
needs_review and no stock. No unexpected constructor ValueError is raised.

Final required normal/focused/scanner/Ruff/whitespace checks are recorded below
after completion. A new clean exact commit is required for another independent
recheck; these owner results do not clear either rejected candidate.


## Final residual-correction owner verification

Final unchanged effect/recovery runtime after both follow-up fixes:

- `make test`: **1879 passed, 1 existing skip, 43 deselected in175.35s**.
- Focused execution/observed SDK/DigiKey API: **395 passed in141.01s**.
- `make test-scanner`: **43 passed, 1880 deselected in44.97s**.
- Required uv Ruff over changed Python/all src and complete staged/base-to-head
  whitespace pass. Existing pinned environment, explicit worktree PYTHONPATH and
  task-local uv cache; normal tests use scoped local-loopback stubs only.
- Original residual totals/status repros pass safely as recorded above; all new
  no-double/fresh-process/certainty cases are included in final broad/focused runs.
- No effect code changed after these runs. Only this validation/handoff status
  documentation is updated before the new local candidate commit.

Owner checks do not supersede the343bea9 orc5eab95 rejections. Root must revive
the independent reviewer against the next exact clean hash before publication.
The one-order/model-only/no-media/archive, exact-source/capability/old-plan, serial/
local and unverified live-server limits remain; no production pool, migration,
force replay or remote rollback was added. No owner push/PR/merge/live-service call.


## Final independent clearance

**APPROVED for the bounded Stage 7 stacked PR at exact implementation hash
`b27badf80a03c3b753a5293010054514c4a064c8`.** All six material findings are independently
cleared; no material unresolved finding remains. The prior rejections of
`343bea94199b0f9f8847e38599781dbe74752dee` and
`c5eab95b1dab46c9f056fdc92018500fc2af9b0a` remain historical evidence and are
not retroactively approved. Earlier pending/recheck/publication-block statements
record their then-current milestones; this disposition supersedes those pending
conditions only, preserving their failure/correction history and every release limit.

Final independent evidence at the approved exact clean head:

- Focused execution/actual SDK observation/DigiKey API: **395 passed in 139.66 seconds**.
- Original/adapted Company, contribution-set, exact-number, historical-date and
  late receipt/status/location probes pass. The final selected-total check stops
  stale receipt; accepted-readback conflict returns confirmed/needs-review and
  fresh-process repair never repeats it. Changing totals during unknown no-write
  satisfaction retains uncertainty, one historical receipt and one stock.
- Actual SDK full-domain probe: **154 actual sends = 154 unique pre-send INTENTs**,
  including 11 guarded media GETs. No double journal wrapper was introduced.
- Unknown original archive remains uncertain across immutable revision 2; its
  upload count stays 1 and total uploads 6→7. Held lock inode/artifact protection,
  semantic journal corruption refusal, Ctrl-C plus export failure 130 and active
  writer local status/actual SIGINT recovery with exactly 1 stock all pass.
- Independent residual-file Ruff, complete base-to-head whitespace and required
  latest-main ancestry pass; reviewed HEAD is exact and worktree clean.

Owner normal **1879 passed/1 existing skip/43 deselected in 175.35 seconds**,
focused **395 passed in 141.01 seconds** and scanner **43 passed in 44.97 seconds**
remain separate owner evidence. Normal/scanner were not redundantly repeated by
the independent reviewer. No live inventory/vendor request, source edit, publication
or further delegation was performed by that reviewer.

Approval covers only the documented explicit opt-in/legacy-default, one complete
sales order, model-only/no DigiKey media/datasheet/archive parity, pre-mapped taxonomy,
exact 13 integer + 6 fractional source bounds, advertised writable capabilities, old-plan
history/claim preservation without semantic migration, conservative unknown/manual
state handling, and serial local ownership with synthetic-only concurrency evidence.
It does not establish live allocator/uniqueness/immutable-instance identity, conditional
updates, cross-client atomicity or exactly-once effects. Changes after the last
relevant observation remain outside the client guarantee.

The final clearance-record commit updates only maintained documentation and this
handover. Whitespace is checked; runtime suites are intentionally not rerun because
no runtime/test/dependency/evidence bytes change. Root owns publication of the
stacked PR from that final documentation head. No owner push/PR/merge/live action.
