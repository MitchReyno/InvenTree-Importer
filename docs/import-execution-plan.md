# Staged implementation plan — observable, resumable stock imports

Status: maintained implementation plan. Stage 0 establishes contracts; Stages
1–7 remain unimplemented at this baseline. Companion documents:
[design](import-execution-design.md), [contracts](import-execution-contracts.md),
[architecture](../ARCHITECTURE.md). Baseline main `c22b7a1` includes PR #11
code-organization guidance and PR #9;
preserve its DigiKey request-error, configuration-replacement and report-plan-read
fixes. Installed SDK audited in Stage 0: `inventree==0.13.5`.

## Status and change control

| Stage | Status | Acceptance evidence |
|---|---|---|
| 0 | Contracts complete; upstream incorporation awaiting independent recheck | [Stage 0 handover](handovers/import-execution-stage-0.md) |
| 1 | Pending | Error taxonomy and complete-read gates below |
| 2 | Pending | Whole-command request coverage and worker correlation gates below |
| 3 | Pending | Real-store ownership/restart gates below |
| 4 | Pending | Durable reference-slice fault matrix below |
| 5 | Pending | Full workflow and immutable artifact gates below |
| 6 | Pending | Compatibility/default rollout gates below |
| 7 | Pending | DigiKey adaptation and measured concurrency gates below |

Deliver all stages as sequential stacked PRs. Each stage has a separate owner
and independent review before its PR opens. Keep this plan flexible: record
justified scope/contract changes, acceptance evidence and remaining work instead
of treating illustrative module names or an obsolete plan as requirements.
Each stage updates ARCHITECTURE.md, this status table and a comprehensive tracked
`docs/handovers/import-execution-stage-N.md` before review. Handovers record work,
commands, findings, decisions/rationale/tradeoffs, plan adjustments, changed
contracts, validations (including failures/skips), review fixes, limitations and
next-stage integration instructions.

## Delivery strategy

Use reviewable incremental PRs with working compatibility adapters, rather than
replacing the importer in one release. Stages are acceptance gates, not promises
that each fits one commit. Do not advertise durable resume until Stage 4's failure
matrix passes. Observation alone is not a recovery guarantee.

```text
Stage 0: contracts and baseline
    ├── Stage 1: safe errors and complete reads
    └── Stage 2: observations (delivered after Stage 1 in this stack)
             ↓ both required
Stage 3: operation model, planner and durable store
Stage 4: representative recovery slice
Stage 5: full import-stock migration and artifact finalization
Stage 6: CLI/default rollout; optional TUI integration
Stage 7: DigiKey adaptation and measured concurrency (separate decisions)
```

Source paths below are ownership/responsibility suggestions, not a requirement to
create every named module. Follow CONVENTIONS.md, including its merged PR #11
organization guidance: focused named orchestration, explicit inputs/options,
coherent class-owned state, meaningful module/package boundaries, dependencies
from commands to workflows to lower-level operations, and behavior-grouped tests.
Do not create a class or package merely to provide a namespace. Keep helpers at
the narrowest responsibility that owns their contract until actual shared callers
justify extraction. Avoid unrelated formatting,
new workflow frameworks or speculative generic plugin APIs.

## Invariants across all stages

1. Dry-run/preparation never mutates the server or source configuration. Local
   cache/report/journal writes must be identified honestly; validation remains
   usable without contacting the server.
2. Keep version 1/2 stock files and the existing barcode identity unchanged.
   Missing line IDs remain rejected. Run/request IDs never become inventory keys.
3. Maintain import_stock's library boundary: no prompts/process exits in core;
   callbacks or explicit decisions belong at application boundaries.
4. Preserve matching/review, notes preservation, confidence thresholds, company
   creation/logo eligibility and --no-* behavior unless a documented intentional
   change is approved. --yes does not authorize identity guesses.
5. No failed or incomplete lookup is evidence of absence. Unknown writes do not
   justify another create or compensating delete without reconciliation.
6. Checkpoint confirmed record identity and source attribution before dependent
   mutations; stop new mutations if the journal cannot record outcomes.
7. Reports must distinguish registered inventory, incomplete metadata/evidence,
   blocked/failed work and uncertainty. Selected work cannot silently disappear.
8. All development tests use isolated mocks/local test servers. Live server writes
   require separate explicit authorization; target capability assumptions remain
   unproven until checked in a permitted environment.

## Stage 0 — establish contracts, policies and baseline

**Purpose:** avoid moving current implicit decisions into a new engine unnoticed.

**Work:**

- Review current main including merged PR #9, preserve its fixes, and identify which focused
  safety fixes remain necessary. Read AGENTS.md and CONVENTIONS.md.
- Inventory API call sites, SDK startup/reload/download paths, existing callbacks,
  effects, caches, file mutations and flags. Record data ownership, identity keys,
  reconciliation evidence and error behavior for each domain operation family.
  Explicitly inventory existing parameter-write and datasheet-prefetch thread pools;
  later serial scheduling does not make current worker requests single-threaded.
- Add characterization tests for input versions, repeat imports, partial specs,
  company/notes behavior, optional assets, part_of and existing --plan consumers.
  Prefer assertions about behavior over text or implementation layout.
- Define domain/result/request/event contracts and a redacted error vocabulary:
  absent, validation, conflict, denied/auth, transient, transport, invalid response,
  uncertain write, programmer error and local-journal failure.
- Choose explicit policies for requested-but-unresolved locations and barcode
  confirmation as a prerequisite. Initial recommendation: preserve legacy mode;
  in the new resumable mode, an explicitly requested unresolved location needs
  review, and stock registration is complete only with confirmed barcode ownership.
  Surface this intentional difference in preview/docs; do not silently apply it
  to all existing library callers.
- Define field repair policy: new-run plans record baseline/desired fields; resume
  repairs only pending approved work. Missing parameters may be added to confirmed
  owned records; changed nonempty/manual values require review. Do not enable broad
  update_parameters. On importer-created stock, tag repair preserves concurrent
  added tags observed by the reconciliation read while ensuring approved desired
  tags; conflicting PO links require review. A later external GET/PATCH race remains
  possible without verified conditional/atomic field support; do not promise
  preservation of unobserved concurrent edits. No automatic historical
  quantity/batch/location/part rewrites.
- Select one storage backend after defining required state and queries. SQLite is
  selected for transactional outputs/attempts/events; JSON is an export format,
  not a second backend. See the contracts for canonical ownership discovery.
- Define staged CLI contracts separately from current --plan. The selected
  `import-run` subcommands are recorded in the Stage 0 contracts. Keep a
  conditional outline before discovery, an approved mutation preview,
  explicit --write for remote effects, and machine output separate from progress.
- Completion policy for the new mode: 0 only when selected applicable work is
  satisfied; 1 for failures, uncertainty, review or blocked selected work; 2 for
  invalid CLI usage; 130 for interruption. Disabled/inapplicable work is not a
  failure. Optional means it does not gate inventory, not that failure is hidden.

**Deliverables:** a short decision record, operation/policy matrix, compatibility
matrix and baseline fixtures. Put durable project decisions in appropriate repo
documentation when implementation starts; the maintained design/plan and contracts describe the agreed target.

**Gate:** each proposed operation has inputs, output identity, effect boundary,
reconciliation evidence, requiredness and a defined uncertain case. No assumed
server uniqueness/idempotency capability is presented as established.

## Stage 1 — fix error classification and discovery completeness

**Likely files:** inventree/stock.py, purchase_orders.py, parts.py,
stockimport.py, importplan.py, archive.py and focused tests. Add a shared read
helper only if multiple callers genuinely share its contract.

### 1A. Barcode failures and cleanup

- Verify the SDK/server response shapes represented by existing tests and classify
  known unknown-barcode responses specifically. Do not catch all 400s as absence.
- Distinguish conflict, denied lookup, transient failure, malformed response and
  uncertain link. Preserve safe diagnostic context and exception causes.
- Remove deletion on uncertain link/transport failure. Any retained cleanup for a
  confirmed conflict must establish ownership and that only a new duplicate is
  being removed; otherwise report review/uncertainty.
- Return/retain a known stock PK in error context without claiming full success.
  This is not yet durable recovery; document that limitation.

### 1B. Complete identity/reconciliation reads

- Add bounded pagination that supports the SDK/endpoint's list or paginated shape,
  narrow filters, deterministic repeated-page detection and safe same-target links.
  Never forward credentials to an unexpected scheme/host/API root from `next`.
- Reject malformed/incomplete reads rather than returning empty successful lists.
  A pagination bound hit is an explicit incomplete-discovery failure.
- Route all absence-based stock-import matching, parameters, categories/templates,
  locations, orders/supplier parts and attachment checks through complete reads.
  Audit direct api.get lists as well as model .list calls. Keep page size a request
  hint, not a completeness guarantee. Broader DigiKey migration remains Stage 7.
- A failed attachment list must block that upload attempt rather than assume no
  existing files. Distinguish already-present, uploaded, failed and unknown.
- Existing boolean APIs need audited compatibility adapters: callers that mean
  “new upload happened” can still get a boolean; executor-facing outcomes must not
  collapse satisfied and failed. Audit provenance/archive callers specifically.

**Acceptance:**

- Lookup timeout/denial/invalid JSON does not trigger stock creation.
- Barcode-link timeout does not call delete; known absence and confirmed conflict
  remain correctly handled.
- Match/attachment on page 2 is found; loops, foreign next URLs, malformed pages,
  and late-page failure cannot be interpreted as absence.
- Attachment already present is satisfied; failed discovery cannot trigger upload.
- No regressions in existing no-op repeat imports or PR #9 error contracts.

**Release boundary:** can ship independently; do not describe it as resumable.

## Stage 2 — structured observations and complete request visibility

**Likely files:** inventree/api.py; a small execution context/event module;
stockimport.py, parts.py, stock.py, purchase_orders.py, datasheets.py,
commands/import_stock.py and a CLI renderer. Test actual installed SDK boundaries.

### 2A. Events and operation context

- Scope this stage to the entire import-stock invocation, including connection and
  post-import --plan reads/downloads. Other DigiKey CLI commands are not included
  in a claim of complete coverage until their adapters are migrated.
- Retain existing pools with explicit immutable worker correlation, synchronized
  sequence allocation and safe event delivery (Stage 0 decision). Test overlap; do
  not rely on caller context variables propagating into threads automatically.

- Introduce immutable event/result records with schema version, sequence, run,
  operation, attempt and request correlation, safe labels and timing.
- Announce conditional phases/task outline before connection; emit group/operation
  lifecycle and dynamically registered request steps before dispatch.
- Keep source attribution in context for shared resources and failed lines.
- Keep renderer delivery separate from semantic state transition. A callback/UI
  failure cannot classify a confirmed remote write as a failed operation.

### 2B. Transport coverage

- Attach adapters through a client factory before SDK connection. Cover normal
  request, startup testServer, OPTIONS, downloads, raw attachment upload and
  SDK-triggered reloads. Include independent datasheet/image fetch paths.
- Describe application-dispatched requests explicitly; expose redirect history
  without promising per-wire-exchange replay. Every explicit retry is a request
  child. Distinguish HTTP success, decode/model success and effect certainty.
- Redact safe errors and configure SDK logging so tokens, authorization headers,
  passwords, signed URLs/query secrets and unsafe response bodies cannot leak into
  event files, logs or reports. Cover SDK info-level token acquisition as well as
  debug payload/header output before constructing the client, including both
  token and username/password authentication flows. Avoid global patching of the requests module.
- Inventory existing DigiKey retry ownership so later adapters expose attempts
  without multiplying independent retry loops. No hidden InvenTree retry loop
  should be claimed unless demonstrated by the installed version.

### 2C. CLI progress

- Add a plain deterministic renderer with phase/group/request status, elapsed
  time, retry waits, blocked reasons and honest expanding counts. Every request
  gets a concise visible, flushed start row before dispatch and a correlated
  terminal; expansion can hide extra details, never the existence of the call.
- Preserve normal library results and machine-readable stdout contracts; render
  diagnostics to stderr where applicable. Bridge existing on_step/on_sku callbacks
  temporarily without treating them as complete API visibility.

**Acceptance:** fake transport sees request_started before every outbound call;
starts/terminals correlate across pagination/reloads/downloads/failure; unexpected
model decode errors remain distinct from unissued writes; renderer exceptions do
not replay writes; secret canaries do not appear in logs/events/exports. Exercise
overlapping parameter requests and downloads with sibling failure, correct worker
attribution and unique sequences. Inspect captured non-TTY stderr from dispatch
to prove the request row was flushed before the call, including --plan calls.

**Gate:** user can watch each application request, but resume is still not promised.

## Stage 3 — typed planner, serial executor and durable state foundation

**Dependencies:** Stages 0, 1 and 2. Keep this foundation small; it is exercised by
Stage 4 rather than treated as a reusable framework product.

### 3A. Domain model and scheduler

- Define typed operation kinds, prerequisite output references, resource conflict
  keys, desired inputs, baseline/preconditions, attribution, optionality and
  reconciliation handlers. Persist data, never closures/SDK objects/callbacks.
- Define pending/ready/running/already_satisfied/succeeded/retry_wait/failed/uncertain/
  needs_review/blocked/skipped states and effect certainty separately. Specify
  legal transitions and how repaired outputs reactivate blocked descendants.
- Run one operation at a time. A small explicit dependency map is enough; retain
  deterministic presentation order even where execution order could vary. Check
  cancellation and journal health before each child mutation dispatch, not just
  before each top-level operation; cancellation during GET/retry wait must prevent
  a subsequent PATCH. Record requests already in flight rather than assume they
  can be killed or rolled back.
- Depend on confirmed usable outputs, not entire parent-line success. Validate
  cycles, missing outputs and shared-key input conflicts before dispatch.
- Classify service-wide outages only on demonstrated scope. Local per-operation
  denied/validation failures do not automatically pause all other resources.

### 3B. Planning and compatibility

- Build a read-only discovery plan, then a resolved mutation preview with symbolic
  outputs. Store chosen company/part PKs and decision reasons, not callbacks.
- Freeze normalized inputs/config semantics/file content hashes and separate
  import identity, run, revision, operation, attempt and request identities. Use
  stable logical output references
  in semantic operation IDs before records have PKs. Resolved PKs belong in
  inputs/results and resource conflict keys; they must not rename previewed tasks.
- Preserve stockfile.key_for and existing input validation/expansion. Handle
  reference-free content-derived identities explicitly in preview/resume checks.
- Changes to input, target, identity choice or permissions cannot silently rebind
  an approved plan. Explain new revisions versus pending-work repair; ignore only
  documented irrelevant changes, not semantic config changes.
- Keep existing --plan projection/schema intact. Add explicit serialization/version
  for executable plans with local path portability and safe artifact references.
- Define canonical persistent local ownership/discovery keyed by verified
  target/import identity, with a deterministic journal location or a registry
  pointer. A caller-selected different journal path must still discover an
  unresolved prior run after its process exits. Define conservative handling of
  target aliases, missing/moved/corrupt journals and completed/no-pending runs.
- Guard new and supported legacy paths using that ownership record as well as a
  process lock. Uncertain/blocked pending state requires reconciliation or an
  explicit reviewed abandonment before a fresh conflicting run. Document that
  old binaries/other hosts cannot be controlled; do not promise cross-host exclusion.

### 3C. Persistence and ownership

- Implement the selected backend only. A proposed SQLite schema holds run/plan,
  operations, attempts/requests, confirmed outputs/effects, attribution, immutable
  artifacts/targets and audit events; current state is authoritative, not replay
  of an arbitrary event-sourced language.
- Commit output PK + effect certainty + attribution + state transition together.
  Persist a write-intent/attempt start before dispatch; incomplete attempts recover
  into reconciliation/uncertainty, never automatic create replay.
- One journal owner and one writer; explicit schema compatibility/migrations,
  lock lifecycle and atomic portable export. Hold or prohibit process-global
  ledger recording overlap until explicit per-run context replaces it.
- Journal/disk failure stops new mutations. Handle startup corruption and a crash
  after remote success before local commit honestly; do not replace a damaged
  journal with a fresh run and create again.
- Store run files outside the archive input set; export completed snapshots only.
  Define the local artifact directory, ownership/permissions and opt-in operator
  recovery instructions here, before Stage 4 persists paths; fuller retention and
  export documentation can follow at Stage 6.

**Acceptance:** deterministic serialize/load; same-import lock exclusion; safe
schema mismatch; target/input revision mismatch; interrupted read versus write
classification; journal write failure prevents subsequent mutation; confirmed PK
survives restart; rendering can rebuild from snapshot after missing events. A fresh invocation
through either supported path with an alternate journal directory must find and
block unresolved prior work; missing registry targets require review. A completed
run permits intentional later enrichment. Test real local store transactions/files
and restart behavior, not mocked commit calls alone.

**Gate:** foundation ready for one real domain slice, not general release.

## Stage 4 — representative durable recovery slice

**Purpose:** validate correctness across the actual hard boundaries before migrating
all stock behavior. Use a feature-gated execution path and common domain policies.
Do not execute legacy mutations as a fallback after uncertain new-engine work.

**Reference fixture:** two stock lines share a specification-identity part, identity
parameters, supplier and PO; retain distinct quantities/batches. Include one PO
line per import contribution, tags, a PO link and one evidence file. Add a type-
identity variant. This exercises shared outputs, genuine duplicate-looking lots,
field repair, effect attribution and finalization.

### 4A. Part and parameter operations

- Resolve/reuse/create part with immediate PK checkpoint before parameter calls.
- Each independently repairable parameter has a stable domain identity including
  logical planned target/model and template. Resolve the target reference to a
  persisted PK without changing the operation ID or its approved inputs. Re-read
  on uncertain results, add missing approved
  data, and review conflicting/manual values. Required identity completion gates
  stock; unrelated part resolution and optional evidence can continue.
- Retain manufacturer/MPN relationships and matching choices; do not rediscover
  a partially created spec part solely by its incomplete parameter signature.

### 4B. Stock identity, tags and links

- Resolve existing barcode using verified classification and complete reads.
- Create stock once per approved logical lot when absence is established; commit
  returned PK before barcode/tag/PO-link work. Validate model and identity on resume.
- Reconcile uncertain barcode linking against the intended stock and key owner.
  A lost stock-create response with no safe correlation becomes uncertain/review;
  leave independent lines runnable. Do not match lots just by identical payload.
- Ensure approved tags without removing unrelated additions observed during
  reconciliation on owned new stock. Document the unguarded external race unless
  target conditional/atomic updates are verified; do not imply compare-and-swap.
  Set PO link only when absent or already intended; divergent links need review.
- Never recreate consumed/deleted stock or restore old quantity/batch/location on
  resume merely because desired baseline differs from current server state.

### 4C. Purchase-order line and evidence contribution

- Resolve shared supplier/order with conflict detection for order metadata/invoices.
- Ensure each planned PO-line contribution independently. A known returned PK is
  reused; an uncertain create requires verified identity or review, not a guessed
  match by supplier part/quantity. Do not invent unsupported unique metadata.
- Freeze one evidence artifact and target. Record already-satisfied versus uploaded
  and retain pending upload state independent of later inventory writes.
- Persist source/line attribution even if a containing operation/line later fails;
  produce a local partial final report from the slice's settled outcomes.

**Required failure matrix:**

| Injection point | Required result |
|---|---|
| Before create reaches server | Known failure; retry only after established absence/preconditions |
| Create applied, response lost | Uncertain unless verified correlation resolves it; no blind duplicate |
| Create PK saved, process stops | Resume against same confirmed record; stable preview operation IDs persist |
| Successful create has malformed/multiple objects | Validate expected one-object contract; retain trustworthy returned identities and require uncertainty/review without replay |
| One identity parameter fails | Repair known part; no duplicate spec part or stranded type parameters |
| Barcode link applied, response lost | Read-back resolves owner; no automatic stock delete |
| Tags/PO link fail after stock exists | Retry only pending field operation; preserve unrelated/manual fields |
| PO-line response lost | Reconcile reliable identity or stop that operation uncertain |
| Evidence upload applied, response lost | Verify artifact/target or remain uncertain; no blind duplicate upload |
| Journal commit fails after remote write | Stop new mutations and report potentially unrecorded effect |
| One branch fails | Unrelated eligible work continues; blocked children explain prerequisite |
| Cancellation during read/backoff/decision wait | No subsequent mutation dispatch; in-flight calls settle explicitly |
| Source line fails after usable part output | part_of dependent can use that output; identity-incomplete work stays blocked |

**Gate:** the durable path uses individually checkpointed parameter operations,
not the legacy thread-batched helper as an opaque task. Test dict, singleton list,
empty list, multiple objects, invalid PK and post-POST constructor/reload failure
through the real compatibility adapter with a fake transport. Then stop/restart
in a fresh process against retained fake server state,
compare record counts/identities and final report. No duplicate known effects;
legitimate identical lots remain separate; unavoidable ambiguity is explicit.

## Stage 5 — full stock workflow and evidence finalization

**Likely files:** stockimport.py, parts.py, companies.py, purchase_orders.py,
archive.py, provenance.py, datasheets.py, ledger.py, commands/import_stock.py.

### 5A. Complete domain coverage

- Adapt remaining company/manufacturer/supplier/location/parameter/note/image/
  datasheet/invoice operations using the slice contracts. Local PDF extraction,
  hashing/ZIP work and output writing are visible operations too.
- Preserve notes-on-empty behavior, model-specific parameter ownership, confidence
  and ambiguous-match handling, image defaults and all --no-* flags.
- part_of uses confirmed usable part outputs; preserve earlier-line validation.
- Keep logo eligibility tied to companies created by the originating import/run
  and persist it across resume; do not broaden edits to existing company logos.
- Bridge existing StockImportResult and --plan reports from complete operation
  state. Add a versioned detailed run report without breaking existing consumers.

### 5B. Provenance and artifacts

- Record successful and uncertain effects with attribution at the effect boundary;
  derive record provenance from confirmed changes, not all requested facts.
- Preserve existing provenance schema where practical; any migration is versioned
  and tested. Include confirmed compensating deletion when relevant so a prior
  create is not misrepresented as a currently existing record.
- Generate combined provenance atomically, preserve historical runs, and make
  regeneration/upload retry idempotent for the same prepared artifact revision.
- Retain pending provenance upload artifacts even if resume makes no inventory
  writes. Classify missing applicable upload targets separately from failed ones.
- Freeze source manifest/content before archive hashing and ZIP construction.
  Explicitly exclude journals, WAL/SHM, generated reports/plans and downloaded
  report images. Include approved evidence/source content, not recursive live
  run state. Verify staged bytes against manifest before upload.
- Define artifact order: settled inventory → confirmed-change provenance snapshot
  → immutable evidence archive → target uploads → external execution-outcome report.
  Per-record documents may reference prepared archive identity, but must distinguish
  prepared from confirmed attached. Never rewrite the archive to include its own
  upload status or recursively include newly generated run artifacts.
- Finalization waits for relevant branches to settle, not all to succeed. On disk
  failure, best-effort diagnostics may replace local report persistence; do not
  claim a durable partial report was saved if it could not be written.

**Acceptance:** failed logos/provenance/archive uploads resume with original
eligibility/content/targets; failed lines retain record/source relationships;
files changing during staging fail the affected artifact instead of changing its
identity silently; repeated no-op runs do not generate arbitrary new archives;
prepared/attached/failed outcomes remain distinct; finalization cannot self-loop.
A same-name attachment with different or unverifiable content is not automatically
satisfied: verify trustworthy content identity or retain conflict/review. Include
missing retained artifacts and source deletion/mutation during staging.

**Gate:** complete import-stock behavior is covered through new engine behind an
explicit opt-in; existing entry points/flags/projections continue to work.

## Stage 6 — CLI release, operational contracts and optional TUI

- Expose prepare/preview, execute, status, resume, retry-operation and cancellation
  through the Stage 0 interface. Clearly mark new flags versus existing --plan.
- Retry selection includes unmet prerequisites/reconciliation, never an unchecked
  mutation replay. Report why a request itself is not a safe resume boundary.
- Provide stable JSON run reports and sequenced events, plain stderr progress and
  consistent exit codes. Display counts by meaningful inventory/metadata/evidence
  outcomes; expanding request totals must be honest about discovery.
- Document local journal location, sensitive-data handling, retention/export,
  corruption/disk-full behavior, schema compatibility and portability. Active
  SQLite must stay local; portable exports are not automatically safe executable
  credentials-free resume files without verified target/input context.
- Ensure unresolved new-engine ownership/uncertainty cannot be bypassed by falling
  back to legacy within this version. Downgrading requires explicit reconciliation
  guidance; never automatically fall back after partially completed writes.
- Make new engine default only after parity/fault gates; keep compatibility wrappers
  for supported library consumers. Retire duplicated business logic deliberately.
- Optional TUI: run synchronous engine in a worker, consume snapshots/events,
  collect decisions outside handlers, reconnect/resync after event loss, and keep
  retry/cancel policy in the engine. A TUI is independently deliverable once this
  interface is stable; it need not wait for Stage 7.

**Acceptance:** library remains quiet/noninteractive; machine stdout is clean;
UI callback failure cannot duplicate operations; status survives process restart;
interrupt exits predictably and in-flight writes become confirmed or uncertain;
state can be reconstructed from committed snapshot without every UI event.

## Stage 7 — separate DigiKey adaptation and bounded concurrency

This authorized stage follows the stock CLI gates. DigiKey adaptation and measured
concurrency remain separate implementation decisions; do not enable unproven write
concurrency merely to complete the stage.

### DigiKey

- Reuse domain/execution contracts, not stockfile-specific identity assumptions.
  Observe token/fetch/search retries and eliminate stacked retry budgets.
- Preserve partial-order policy, currency/pricing and supplier SKU semantics.
- Correct existing-order repair: current path reads existing PO lines only and
  can leave missing lines absent after initial partial creation. Compare desired
  contributions against confirmed identities before adding missing approved work.
- Give issue/receive operations their own reconciliation contracts; reconcile
  quantities/received state without double receipt after lost response. A single
  receive request can affect several lines: model one multi-effect domain result,
  not an invented independent per-line HTTP operation.

### Concurrency

- Measure request/download latency before enabling more workers.
- Use bounded independent reads/downloads first; allow writes only with proven
  identity/resource ownership. Explicitly serialize IPN-prefix and PO-reference
  allocations plus conflicting same-record fields and shared artifacts.
- Remove/isolate global ledger run state with explicit context before parallel
  runs. Verify actual SDK/client thread ownership rather than assume thread safety.
- Define total rate/backoff budgets per relevant service, cancellation and operator
  reporting for running/waiting/blocked work. No distributed queue is required.

**Acceptance:** failed initial PO-line creation repairs without duplicate receipt;
issue/receive uncertainty is not reported as known failure; independent tasks
continue; conflicting identity/field/allocation operations cannot race in the
supported single-process concurrency model. Cross-host safety is not claimed.

## Validation and review requirements for implementation PRs

- Add meaningful regression tests at changed behavior boundaries. Reuse the local
  InvenTreeStub/transport fixtures and isolate all files, credentials and journals.
- For resume guarantees, restart a fresh executor/process against persistent fake
  server state; an in-memory retry in one context is insufficient evidence.
- Run focused tests during development, `make test` for normal required coverage,
  `uv run ruff check` on changed Python files, and `git diff --check` before each PR.
- If skills/agents change, mirror shared copies and run workflow-sync tests.
  If scanner/TUI behavior changes, run `make test-scanner` (or `make test-all`).
- Record skipped/unavailable integration checks honestly. Mocks do not establish
  live server uniqueness, transaction atomicity or behavior beyond fixture contracts.
- Each PR explains concrete trigger/before/after, compatibility, fault scenarios,
  tests, limitations and rollout/recovery behavior. Conventional Commits apply.
- Review gates include uncertain writes, credential redaction, source attribution,
  schema/input identity, active ownership and preventing unsafe old-path fallback.

## Next gate

Stage 0 decisions are recorded in [contracts](import-execution-contracts.md).
Stage 1 implements focused safety/read fixes; it must not advertise durable
resume. Complete each stage's independent review and acceptance gates before
opening its stacked PR. No stage authorizes live inventory calls or writes.
Target uniqueness, absence response taxonomy, conditional writes, PO-line
correlation and attachment-content verification remain capabilities to establish
with supported evidence, or handle conservatively as uncertainty/review.
