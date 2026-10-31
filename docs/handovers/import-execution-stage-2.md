# Stage 2 handover — visible correlated import requests

## Baseline, scope and work

Base: reviewed Stage 1 `bf2e3ac6816bc3cb0d38bdec055d606eef74a328`
(PR #12), branch `fix/import-discovery-and-barcode-errors`. Owner branch:
`feat/import-request-progress`. Created a separate isolated worktree from that
head; did not change the parent checkout, main, Stage 0 or Stage 1. This is the
second implementation stage in the authorized sequential stack. Root owns
independent review, publication and PR creation. No live inventory API calls,
capability probes or writes were made; tests use fake transports/local stubs.

Read AGENTS.md, full CONVENTIONS.md (including merged PR #11 organization guidance),
ARCHITECTURE.md, maintained design/plan/contracts and Stage 0/1 handovers. Audited
stock command startup/plan, library workflow, shared API/model adapter, parameter
pool, PDF prefetch/backfill, product image download, SDK reload and attachment
paths. The SDK installed in the isolated environment is `inventree==0.13.5`.

Implemented actions:

1. Added a focused `execution` package: immutable event/correlation and scoped
   observation ownership in `observation.py`; safe HTTP/log adapters in
   `transport.py`. No executor, generic workflow DSL or persistence layer.
2. Added a per-client SDK factory in `inventree/observed_api.py`, bound before
   constructor connection. Routed existing `connect()` through it. Preserved the
   existing parameter model URLs, list-create compatibility, ledger and Stage 1
   error/complete-read behavior.
3. Added explicit worker context capture and child attempts to the existing
   parameter write, PDF prefetch and datasheet backfill pools. Preserved sizes,
   caching and concurrency. Added wait events for shared PDF download waiters.
4. Added document/discovery/line/prefetch/finalization operations with hashed
   source keys and honest line positions. Added separate HTTP/decode/model events.
5. Installed default flushed stderr rendering before connection, a conditional
   phase outline and dynamic dispatched/settled counts. Kept the scope through
   post-import `--plan`; offline machine commands remain unchanged.
6. Added boundary regressions and updated architecture, contracts/design, plan
   status and this handover. Owner has not opened/pushed/merged a PR.

## SDK and retry investigation evidence

Inspected actual installed `inventree/api.py`: constructor immediately connects;
`connect()` calls `testServer`, `testAuth`, optionally `requestToken`. Normal
`request` dispatches through a local dictionary of module-level requests methods;
it does not use an injectable Session and has no demonstrated retry loop.
`testServer` and `downloadFile` independently call requests.get. `get/post/put/patch`
decode JSON outside `request`; malformed JSON can return None. Model create/save
may reload separately. HTTP 2xx receipt therefore precedes decode/model success.
SDK request debug logs include headers/auth/JSON/files, and requestToken logs its
actual token at INFO. Suppressing only debug logs would leave a credential leak.

The adapter binds the actual installed method code using `FunctionType` with
copied globals replacing only requests and logger, then binds each method to its
owned client before invoking its constructor. This is a compatibility seam for
0.13.5, not a general transport plugin contract. Static methods retain their
ordinary class implementation. No SDK module/class/global requests object is
modified. Independent clients retain separate observers; standard requests.get
is unchanged. Actual SDK entrypoints are tested, with fake HTTP transport only.

DigiKey `digikey/api.py:_request` owns its own bounded attempts: reads or explicitly
retry-safe requests use MAX_RETRIES, unsafe writes get one attempt; connection/
timeout and transient status paths wait with bounded exponential sleeps. Token
acquisition is separate. Stage 2 adds no retries, sleeps or nested budgets and
does not claim observation of those API commands. Stage 7 must expose every
explicit attempt/wait and choose one retry owner before adopting these loops.

## Decisions, alternatives and tradeoffs

| Decision | Rationale / alternative / limit |
|---|---|
| Per-client SDK globals binding | SDK has no injection point. A Session hook misses all three module-level dispatch families. A subclass overriding request/testServer/downloadFile would copy long upstream bodies or still miss the actual send boundary. Vendoring adds maintenance duplication; global patching crosses client/thread boundaries. Binding real function code retains upstream implementation and scoped ownership, at the cost of an explicit pinned-SDK compatibility seam requiring upgrade audit. |
| Bind all SDK instance methods, not only request | Token acquisition and ancillary SDK methods have unsafe logger output. Every bound method gets a silent SDK logger before construction. Ordinary SDK clients/class/module remain untouched. |
| Immutable invocation-local UUID correlation | Provides explicit attempt/request identity now without inventing stable domain replay identities before Stage 3 planning. Document/line source digests derive from existing keys; shared prefetch is document-attributed. Digests are labels, not durable identity or a source-document lookup database. |
| Keep pools and explicitly capture context | ContextVar alone does not propagate into executor threads. Submission captures immutable context; child workers allocate their own attempt and retain source. Removing concurrency would be an unmeasured regression. No new concurrency is introduced. |
| Lock plus delivery queue and retained event tuple | Sequence allocation/state append and delivery order stay synchronized across pools. Starts reach the renderer before HTTP dispatch. Observer failure is counted/swallowed, so it cannot reclassify a write or cause replay. Slow observers backpressure producers; asynchronous UI delivery is future work. |
| Safe labels omit arbitrary URLs/bodies | Known inventory route nouns/numeric PKs are useful; unfamiliar paths become a generic label. External downloads use a separate generic service label. Query secrets/userinfo/payloads never enter events; redirect history is only a count. More detailed safe label taxonomies can be added later. |
| Suppress unsafe free-form logs during observed imports | Existing helpers interpolate arbitrary exception strings and URLs, SDK logs credentials, and urllib3 DEBUG can log query strings. Filtering every possible secret value is unreliable. Structured method/route/status/outcome events replace that channel during the explicit scope. Outside it, importer logs retain behavior. Loss of legacy free-form diagnostics during observed runs is a deliberate compatibility tradeoff. |
| Safe CLI exception boundary | Arbitrary SDK HTTPError args include auth/payload/body. CLI exposes exception type, with the established safe PR #9 plan-read diagnostic allowlisted. Library exceptions/causes remain unchanged for classification and advanced callers. Unexpected exceptions stop the invocation, not a misleading skipped line. |
| Separate HTTP, decode and model observations | 201 receipt survives later constructor failure; HTTP received is not a confirmed domain effect. Decode events can report no decoded result without rewriting HTTP history. Streaming HTTP receipt is not full-file delivery confirmation. No automatic replay is added. |
| Retain existing semantic results/exit policy | This stage observes legacy control flow. It does not add dependency scheduling, broad field repair, selected-evidence completion semantics or durable partial reports ahead of their planned gates. |
| Cooperative cancellation only | A shared cancellation flag checked immediately before dispatch blocks subsequent sends; interruption marks the observation cancelled. Already-dispatched calls settle normally/unknown. No undo, restart or crash guarantee is claimed. |

## Plan adjustments and corrections

- Introduced only two coherent lower-level execution modules and one integration
  factory. Commands depend on workflows/observation, never the reverse. No giant
  coordinator, new policy implementation or speculative planner/store is present.
- The proposed future operation IDs/state snapshots remain future contracts.
  Stage 2 operations are observation scopes, with UUIDs and retained immutable
  event tuples. Persisted blocked/dependency/retry state is not simulated. There
  is no backoff event because this stock adapter adds no retry/backoff loop.
- Added SDK response decode and compatibility model-construction events after the
  HTTP seam so failure after POST cannot erase the received response.
- CLI free-form exceptions are restricted for security. The first focused suite
  exposed two PR #9 plan-read diagnostic regressions caused by over-restrictive
  error presentation. Restored only the safe known route/message pattern; did
  not expose arbitrary exception args to satisfy the regression.
- Added log protection for urllib3/request diagnostics after investigating DEBUG
  URL leakage. The factory installs filters before SDK construction; worker
  context capture ensures scope filters apply inside existing pools too.
- Source labels use digests rather than raw document filenames/line content to
  avoid carrying paths, unsafe source strings or secrets into exports.
- Existing DigiKey product-image helper is shared by stock imports, so its
  external GET is adapted. This does not migrate DigiKey API retry/auth paths.

## Changed files and contracts

- `execution/{__init__,observation,transport}.py`: in-memory opt-in events,
  snapshots/export, sequence/queue ownership, context capture, cancellation and
  safe request/log adapters.
- `inventree/observed_api.py`, `inventree/api.py`: preconnection SDK binding,
  safe SDK logger, HTTP/decode/model observations; existing public connect/create
  results and Stage 1 barcode/attachment classifiers preserved.
- `inventree/{stockimport,parts,datasheets}.py`: focused workflow operations,
  immutable worker capture, retained pools, shared wait events, safe PDF fallback.
- `digikey/products.py`: shared external image GET adapter.
- `commands/{import_stock,import_progress}.py`: whole-invocation scope, outline,
  flushed plain stderr renderer, safe boundary failure reporting and post-plan.
- `tests/inventree/test_request_observation.py`: real SDK fake-HTTP boundaries,
  pool overlap/sibling failure, safe events, cancellation/client separation.
- `tests/test_cli.py`: actual CLI dispatch-time non-TTY visibility through --plan.
- Architecture, design, contracts, plan and this handover: implemented/future split.

## Validation, failed attempts and fixes

Commands ran in the isolated worktree; all referenced source/test paths below
are repository-relative. UV_CACHE_DIR was task-local when invoking uv. Scoped
escalation was needed for Git refs and local loopback sockets/cache setup. No
automatic approval review rejected an action and no live inventory was contacted.

- `git worktree add -b feat/import-request-progress "$STAGE2_WORKTREE" bf2e3ac6816bc3cb0d38bdec055d606eef74a328`:
  initial sandbox ref-lock failure; scoped escalation succeeded.
- `uv sync --offline --extra scanner`: succeeded from cached dependencies; created
  isolated environment (44 packages). No inventory connection.
- Initial `uv run --no-sync pytest ...` failed before running because default uv
  cache access was sandbox-restricted. Used isolated environment binaries and
  task-local UV_CACHE_DIR thereafter.
- Two exploratory pytest commands named nonexistent `tests/test_import_stock.py`
  and `tests/test_commands.py`; no tests ran for those invocations. Corrected to
  existing `tests/test_cli.py` and integration test files.
- First un-escalated stock/parts/datasheets run: 53 passed, 167 setup errors, all
  loopback socket bind PermissionError in the local stub fixture. Scoped socket
  permission resolved this environmental failure.
- Focused stock/parts/datasheets/CLI run: 320 passed, 2 failed (safe plan diagnostic
  regressions described above), corrected. Follow-up request/plan selection:
  11 passed, 100 deselected. Initial new SDK fake-transport set: 5 passed; expanded
  set including pools/pagination/model/client isolation: 8 passed.
- First full `UV_NO_SYNC=1 make test`: 1518 passed, 1 skipped, 43 deselected in
  42.32s. This preceded the final two additional regressions/source refinements.
- Final full `UV_NO_SYNC=1 make test`: 1520 passed, 1 skipped, 43 deselected in
  36.17s. Existing skip unchanged. Normal selection excludes scanner/TUI.
- `UV_NO_SYNC=1 make test-scanner`: 43 passed, 1521 deselected in 44.40s. Ran in
  a separate pytest process concurrently with normal tests, with environment
  sync disabled so neither process mutates the shared isolated environment.
- Final cancellation audit added a second check after request_started delivery:
  an observer can cancel before HTTP, producing a correlated not_dispatched
  terminal. New regression and final SDK fake-boundary selection: 10 passed.
- Final full repetition after that guard: `UV_NO_SYNC=1 make test`, **1521 passed,
  1 skipped, 43 deselected in 35.62s**. Final import grouping cleanup was then
  verified by the focused matrix below; it changes no behavior.
- Final focused command:

  ```sh
  .venv/bin/pytest tests/inventree/test_request_observation.py tests/test_cli.py tests/inventree/test_collection_safety.py tests/inventree/test_barcode_safety.py tests/inventree/test_attachment_safety.py
  ```

  **211 passed in 4.86s**. This includes existing Stage 1 fault contracts and the
  PR #9 plan-read failures, plus the new boundary regressions.
- Final changed-Python Ruff command:

  ```sh
  .venv/bin/ruff check src/invimport/execution src/invimport/inventree/{api,observed_api,stockimport,parts,datasheets}.py src/invimport/commands/{import_stock,import_progress}.py src/invimport/digikey/products.py tests/inventree/test_request_observation.py tests/test_cli.py
  ```

  Passed, as did `git diff --check`. New tracked files were included explicitly
  in Ruff. Portable-path audit found no local absolute paths in new source/docs.
- No skill/agent changes, so no separate workflow-sync command was needed; its
  ordinary tests run in the normal suite. No live network integration check,
  target uniqueness test, persistent restart test or TUI implementation is claimed.

## Independent review

Independent review found one P1 and two P2 issues. All were corrected in
`007f527ac6d2a14c8b2324eb87e92f9540720112` and independently rechecked:
**Stage 2 is approved for its stacked PR, with no further blocking findings.**
This clearance covers the implemented observation stage, not live inventory
calls or future durable recovery. Root owns publication; owner did not push or
open a PR.

- **P1, caught exception result leak:** a real SDK Company.uploadImage/save/PATCH
  403 raised an HTTPError dictionary containing response body and Authorization.
  `set_logos` stored `str(exc)` in LogoAction.reason; report_logos printed it to
  stdout despite logging suppression. Added scoped `exception_reason`: observed
  runs store a safe failure type, while unobserved library callers
  retain legacy detailed reasons. Added a regression through the real SDK upload
  and CLI report, asserting body/token/header canaries absent from results, logs,
  stdout/stderr and event export. Audited other exception-to-result paths: archive
  ZIP and PDF parsing also used raw exception args and now apply the same policy.
  Stock's remaining str(exc) is a locally generated SupplierPartConflict containing
  source SKU/part identities, with no caught network exception/body. DigiKey SKU
  and sales-order catch/result paths are outside import-stock scope; they remain
  migration work. Existing structured attachment errors already use safe reasons.
- The first new real-403 regression exposed a fake-transport seam defect: injected
  HTTP send-only transports did not provide requests.exceptions, turning the SDK
  HTTPError into AttributeError. The facade now deliberately provides the genuine
  requests exception namespace and injects only HTTP dispatch methods. Corrected
  test now proves the actual HTTPError result path. Initial expanded run: 11
  passed/1 failed; corrected run: 12 passed.
- **P2, exact origin correlation:** decode/model events previously had only their
  operation/attempt, insufficient for repeated reads or POST then constructor
  reload. A call-chain ContextVar carries the request identity set at dispatch;
  decode events reference that ID, and create saves its POST ID before constructing
  a model that may reload. The marker is cleared at SDK decode/create entry, so a
  custom unobserved transport cannot borrow an earlier request ID. A real SDK
  constructor-reload regression distinguishes the POST model origin, reload GET
  decode and later same-attempt GET decode as three exact identities. This marker
  contains no source state; immutable source/attempt context still uses explicit
  worker capture.
- **P2, report source:** post-import plan operations previously used empty source.
  They now retain the same document digest as the imported document. The actual
  CLI dispatch-time test now imports two documents and proves report request source
  membership and document/report source-set equality.
- Focused review-fix SDK/CLI selection: **16 passed, 100 deselected in 0.49s**.
  Final full normal suite: **1524 passed, 1 skipped, 43 deselected in 35.88s**.
  Final scanner suite: **43 passed, 1525 deselected in 43.68s**. The final marker
  reset at create entry and safer per-operation reason wording were checked by
  the focused selection after those full runs.
- Final expanded review-fix command adds `tests/inventree/test_companies.py` and
  `tests/inventree/test_datasheets.py` to the prior final SDK/CLI/Stage 1 selection:
  **262 passed in 5.95s**. Final new boundary suite: **13 passed in 0.24s**.
  Changed-Python Ruff (including companies/archive) and `git diff --check` pass.
  No new skip, live request or inventory write.

### Independent clearance evidence

The reviewer inspected the complete incremental implementation and SDK seam,
then independently reproduced and rechecked the corrected boundaries on clean
fix head `007f527ac6d2a14c8b2324eb87e92f9540720112`:

- Reran the original real SDK Company.uploadImage/save/PATCH fake-403 exploit:
  result/report/event output contains neither body nor token canary; safe
  `operation failed (HTTPError)` reason retains the failed upload outcome.
- Independently exercised simultaneous SDK POST/decode calls through a barrier
  and explicit workers for two source contexts. Decode request IDs are nonempty,
  unique and match their originating starts' full correlation. Constructor reload
  GET identity does not replace the saved create-model POST origin.
- Ran the actual two-document CLI/local-stub attribution regression: distinct
  document source digests remain on report operations and requests.
- Expanded SDK/CLI/Stage 1/company/PDF matrix: **262 passed in 6.03s** with scoped
  local-loopback permission. Initial reviewer invocation accidentally named
  nonexistent `tests/inventree/test_archive.py`; no tests ran until corrected.
- Changed-Python Ruff and `git diff --check` passed; worktree was clean. Reviewed
  updated architecture/contracts/handover. No implementation edits, live service
  calls, inventory writes, push, PR or merge were performed by the reviewer.

The reviewer did not redundantly repeat the full normal/scanner suites; their
results above are owner evidence. Independent verification targeted the actual
reported defects, concurrent request correlation and changed integration boundary.
This final status-only documentation update changes no runtime code and requires
whitespace/documentation checks, not another runtime test repetition.

## Limitations and Stage 3 handoff

Observation is not authoritative execution state. Events reside in memory and
are lost on crash; export is a caller-owned projection. Operation UUIDs must not
be repurposed as stable planned domain IDs. The global legacy ledger remains
incomplete and not isolated between simultaneous imports. Existing line failure
still aborts subsequent work/finalization; coarse exit semantics are unchanged.

HTTP receipt/decode/model events are evidence about those boundaries only. A
lost response remains unknown and model failure after POST remains potentially
applied. No retry permission follows from an exception. Streaming HTTP completion
is distinct from destination file persistence. No transfer-byte metrics, automatic
rate waits, durable reports, independent continuation or full selected-work
completion policy is implemented yet. Custom API clients supplied by library
callers need their own HTTP adapter for request visibility; workflow observations
alone cannot observe arbitrary third-party transports.

Stage 3 should add stable typed operation specs, source maps, conservative target
continuity, canonical ownership and durable state below these opt-in observation
interfaces. Durable snapshots replace retained-event authority; journal failure
must stop mutations, unlike best-effort renderer failure. Stage 4 must checkpoint
individual parameter operations instead of treating the retained legacy pool as
one recoverable unit. Preserve Stage 1 complete-read/error/attachment boundaries,
existing stock barcode keys and all PR #9 report/error contracts. Re-audit this
binding seam when changing the SDK pin. Stage 7 must expose/eliminate stacked
DigiKey retry budgets before claiming that command family's complete visibility.
