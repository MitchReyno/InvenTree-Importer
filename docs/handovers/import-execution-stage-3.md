# Stage 3 handover — typed execution and durable local foundation

## Baseline, ownership and release boundary

Exact reviewed Stage 2 base: `cf550b52a9a65d050790bc75a3eb4d1bce6bc852`
(PR #13). Branch: `feat/import-execution-foundation`, isolated worktree. The
parent checkout and other worktrees remain untouched. Full latest CONVENTIONS.md
from incorporated main `c22b7a1`, AGENTS.md, architecture, design/contracts/plan
and Stage 0–2 handovers were read before implementation. No live API/inventory
request/write, push, PR opening or merge was performed by the stage owner.

This is an explicit-handler library foundation. Stock-domain preparation declares
unsupported resolution/handlers and is not executable. The existing stock flow
continues, with canonical exclusion around writes, without a durable stock resume
claim or a new CLI. Root owns fresh independent review and publication.

## Actual work

1. Created the branch/worktree from the exact reviewed base. The first Git ref
   operation hit sandbox permissions; scoped escalation created the authorized
   worktree. No source was changed in the parent checkout.
2. Added cohesive modules for JSON-only typed models, read-only preparation,
   canonical ownership/locks, SQLite run state, mandatory dispatch, serial execution
   and initial retained artifact policy. No persisted callback, SDK model or raw
   remote response is used as a durable operation specification.
3. Implemented immutable canonical desired/baseline inputs, stable logical IDs
   before PK allocation, versioned plans/revisions, named output dependencies,
   attribution, conflict resources, separate states/certainty/retry and safe errors.
   Validation rejects dependency cycles/missing outputs and conflicting shared
   assignments before dispatch. Unknown schema/normalization versions are refused.
4. Implemented a serial scheduler with deterministic plan order, independent
   continuation on classified local failures, named usable outputs from failed
   parents, blocked descendants and explicit reconciliation/reactivation. Unexpected
   programmer errors stop new work. There is no general workflow DSL or plugin
   system, default domain handler, concurrency or whole-import automatic retry.
5. Added the canonical registry and durable claim protocol: bind endpoint identity
   under the registry lock, persist reservation, initialize the run, activate the
   claim, then permit dispatch. Custom run directories do not relocate ownership.
   Per-import/journal OS locks and a process import/ledger owner exclude overlap.
   Nested caller ledgers are preserved. Unresolved reservations survive exit;
   abandonment leaves blocking tombstones rather than silently clearing effects.
6. Added one-owner per-run SQLite with schema checks, FULL synchronous transactions,
   attempt/request pre-dispatch intents and atomic output/certainty/source/state/
   event settlement. Interrupted creates become uncertain, reads retryable, and
   interrupted reconciliation retains prior uncertainty. Confirmed output PKs
   survive restart and cannot silently rebind to different identities.
7. Connected mandatory durability/cancellation checks directly to every observed
   SDK child send, independently of best-effort Observation callbacks. Explicit
   fake/non-SDK dispatch uses the same guard. Guards recheck after request-start
   rendering, so renderer-side cancellation/journal loss cannot permit a later
   write. The supported barcode POST has an explicit semantic-read scope.
8. Bridged stable run/operation/attempt/request identities into Stage 2 rendering
   and decode/model correlation. Nested visual scopes retain stable operation
   identity. Existing worker context capture also carries the mandatory guard;
   the serial executor rejects worker-thread sends before HTTP rather than losing
   the guard inside a pool. Legacy unguarded observation pools retain behavior.
9. Added canonical committed status discovery (including earlier completed runs),
   portable atomic snapshot export, marked private run/artifact directories and
   evidence exclusions for canonical state, custom runs and reserved SQLite
   DB/WAL/SHM/journal names. No automatic deletion or artifact upload migration.
10. Guarded supported current-version legacy `import_stock` writes before stock
    discovery/mutation. Dry runs/offline validation do not initialize state.
    Updated architecture and maintained contracts/plan/design to distinguish this
    foundation from the remaining real domain/CLI work.

## Decisions, rationale and alternatives

| Decision | Engineering rationale, alternative and limit |
|---|---|
| Immutable canonical JSON inside typed dataclasses | Deep copies prevent later caller dict mutation from altering approved desired inputs; callbacks/SDK objects cannot serialize. This avoids a generic persistence DSL. |
| Logical subject/kind/discriminator IDs, PK outputs | IDs survive server allocation and restart. Resource conflicts can mention resolved PKs without renaming work. Input/revision drift changes the approved revision rather than rewriting a run. |
| Output dependencies independent of grouping | A failed photo/parent stock outcome must not hide a confirmed usable part. Required identity gates belong in named outputs rather than whole-line completion. |
| Serial explicit handlers | Exercises real scheduling/checkpoint contracts without claiming a second stock implementation. No default handler can accidentally mutate inventory. Domain code owns policy and identity revalidation. |
| Explicit unsupported stock preparation | A genuine resolved mutation preview requires existing matching policy and real effects/reconciliation. Freezing discovery choices/digests/source identities is useful now; inventing successful fake stock previews would hide that missing integration. |
| Registry plus per-run DB | Registry discovers unresolved work after exit or alternate run paths. A lock alone forgets effects at process exit; a caller-selected journal namespace alone permits duplicate work. These stores have distinct responsibilities and no claimed cross-DB transaction. |
| Reservation before run creation; activation before send | Crashes between databases leave a blocking reservation. Prefer operator recovery to forgotten effects. Failed setup never frees a potentially unresolved claim automatically. |
| Durable initialized marker and file identity checks | Distinguishes first use from a missing registry file in a retained root. Replacement/loss during execution blocks subsequent sends. Whole-root deletion/relocation remains an operator migration outside local exclusion guarantees. |
| Conservative endpoint identity, explicit alias review | Normalize scheme/host/default port/API root, reject unsafe URLs, and bind before selecting a claim key. Unknown aliases cannot be inferred; verified instance IDs/evidence must come from a caller capability check. SDK server_details or PK existence is insufficient. |
| Revision-bound continuity review before saved PK reuse | Same URL can point to a restore/replacement. Without trustworthy instance evidence, require explicit reviewed evidence. Stage 4 must still re-read model/record identity; this foundation does not invent an immutable server UUID. |
| Mandatory guard separated from observers | Stage 2 intentionally swallows renderer exceptions. Durability failures must propagate before the next send, so journaling cannot be an ordinary observer callback. Starts share durable request IDs for exact correlation. |
| Semantic barcode read scope | HTTP POST does not always mean a mutation. Explicitly declaring the supported lookup preserves safe read recovery while other POST/PATCH calls remain writes. |
| Intent before child dispatch; unknown remote/local gap | A local database cannot guarantee exactly once. A crash just before dispatch may conservatively require review; a crash after remote success before commit cannot authorize replay. |
| Read-only reconciliation and retained confirmed outputs | Reconciliation can establish existing identity without repeating creates. Interrupted/cancelled reconciliation preserves the original unknown effect and saved PKs; outputs cannot rebind. Domain handlers must supply actual verified evidence. |
| Exclusive imports with compatible nested ledger recording | Existing callers wrap import_stock in ledger.recording. An RLock allows that owning-thread nesting; a separate active-import invariant blocks nested/simultaneous imports and foreign-thread recording. |
| Legacy guard is exclusion only | Normal return releases a legacy claim; exception/interruption retains a reservation. The legacy result/ledger is not a durable replay state. Recovery requires operator review rather than treating a whole legacy rerun as safe. Optional caught enrichment outcomes retain legacy completion semantics. |
| Marked private retained runs and conservative evidence exclusion | Run DBs/sidecars and live execution state must never become recursively attached evidence. Full immutable artifact/source/upload handling remains Stage 5. No automatic destructive retention. |
| Temporary canonical state fixture for all tests | Legacy write tests now consult the registry; tests must never initialize or mutate real user app data. Each test owns an isolated state scope. |

## Plan adjustments and implementation limits

- Stage 3's complete stock resolved-mutation preview moves to Stage 4 alongside
  the representative real handler slice. `prepare_import` instead performs real
  bounded read discovery through an explicit read interface, freezes chosen
  identities/reasons, semantic input/config digests, supplied file hashes and
  v1/v2 logical source maps, and declares unsupported stock work. This is not a
  fake approved preview. Existing `stockfile` parsing, missing-ID rejection,
  expansion, key_for and legacy post-import --plan schema remain unchanged.
- The preparation callback/config values are explicit trusted library inputs.
  It receives bounded read methods; callbacks are never persisted. Callers must
  exclude credentials from semantic configuration and pass all selected local
  file references. Complete automatic source staging/freezing is Stage 5; Stage 4
  must not approve domain effects before relevant input/file revalidation.
- The library functions live in focused execution modules, with a quiet package
  initializer. No import-run CLI, user prompts, whole-stock recovery claim or
  default durable handler rollout is added before the Stage 6 gate.
- `RunStore`/`execute_serial` are low-level primitives exercised with fake handlers;
  their caller must own canonical registry exclusion. The supported high-level
  `execute_plan`, `resume_run` and `retry_operation` boundaries acquire that claim.
  They operate on explicitly supplied handlers; arbitrary third-party SDK clients
  require a transport adapter before their child sends can be guarded/observed.
- Registry schema 1/run schema 1 are the first implemented schema versions.
  Unknown versions are refused, with no best-guess migration or forced clearing.
  Completed runs retain status discovery and allow intentional later enrichment;
  no historical inventory correction is performed by these primitives.
- Reviewed abandonment records a tombstone and keeps same-import work blocked.
  No general registry/journal relocation or destructive repair command exists;
  operator recovery must preserve unresolved evidence. Changing state roots is a
  migration, not a per-invocation bypass. Old binaries/hosts/user roots and unknown
  unregistered aliases cannot be excluded by this local authority.
- Real domain preconditions, create-response cardinality, historical-field
  preservation, model identity checks, identity parameter gates, barcode-confirmed
  stock registration and selected metadata/evidence completion remain Stage 4/5
  handler responsibilities. The foundation does not claim to prove live server
  uniqueness, byte verification or immutable target identity.

## Changed files and contracts

- `execution/models.py`: immutable operation/plan/result/effect/output/attribution,
  logical IDs, deterministic serialization and graph/shared-resource validation.
- `execution/preparation.py`: read-only discovery, chosen identity decisions,
  v1/v2 source maps, semantic/file hashing and drift validation.
- `execution/ownership.py`: canonical root, schema/marker checks, OS locks,
  target bindings/aliases, claims/run history, active health and tombstones.
- `execution/store.py`: run/attempt/request/event state, atomic settlement,
  interruption recovery, explicit reconciliation, status and portable export.
- `execution/executor.py`, `dispatch.py`: explicit-handler serial scheduling,
  owner/cancellation/journal checks, safe failures, stable correlation, read-only
  reconciliation and semantic barcode lookup reads.
- `execution/artifacts.py`, `inventree/archive.py`: initial retained-directory
  policy and exclusion of execution state from evidence enumeration.
- `execution/observation.py`, `transport.py`: direct mandatory guard integration,
  exact durable IDs and guarded captured workers, preserving best-effort rendering.
- `inventree/stockimport.py`, `ledger.py`: legacy exclusion and compatible owning
  ledger lifetime. `tests/conftest.py`: isolated canonical state root per test.
- `tests/execution/test_foundation.py`: meaningful fake-handler, real SQLite,
  subprocess restart/ownership/loss, cancellation, observer, drift and policy tests.
- Architecture, contracts, plan/design and this handover: current/future boundaries.

## Validation, failures and corrections

All commands ran in the isolated worktree. Runtime paths in this document use
repository-relative paths or environment variables. No automatic approval review
rejected an operation and no live inventory service was contacted.

- `git worktree add -b feat/import-execution-foundation "$STAGE3_WORKTREE" cf550b52a9a65d050790bc75a3eb4d1bce6bc852`:
  first ref-lock operation was sandbox-blocked; scoped escalation succeeded.
- `UV_CACHE_DIR="$STAGE3_UV_CACHE" uv sync --offline --extra scanner` initially
  could not find cached requests in that fresh cache. `uv sync --offline --extra
  scanner` with scoped existing-cache access installed 44 cached packages into
  the isolated environment (SDK 0.13.5). No public download/live integration test.
- Initial request observation/library focused selection passed (25 tests). The
  first foundation set passed 31 scenarios; later expanded sets passed 38, then
  44, then 46 foundation scenarios as fault/continuity/worker checks were added.
- First full normal suite: **1 failed, 1561 passed, 1 skipped, 43 deselected in
  44.82s**. The failure was an existing caller wrapping import_stock in
  ledger.recording: the first exclusive lock rejected its own outer ledger.
  Corrected ownership to preserve owning-thread nested recording while retaining
  an independent exclusive import invariant. Added overlap/nesting coverage.
  Pytest also printed a closed logging-stream diagnostic while showing that
  failure; no new free-form logging behavior was introduced.
- Following full normal suite: **1568 passed, 1 skipped, 43 deselected in 38.46s**.
  Scanner: **43 passed, 1569 deselected in 44.06s**. Subsequent guarded-worker and
  fresh-process missing-registry regressions added two tests and a small runtime
  tightening, so the final normal/scanner commands were repeated below.
- Latest focused foundation + existing request-observation selection:
  `.venv/bin/pytest tests/execution tests/inventree/test_request_observation.py -q`:
  **60 passed** (47 foundation plus 13 existing transport/SDK observations).
  The final added test uses a real SQLite settlement-event trigger failure and
  proves output/state/attempt/event rollback together; it changes no runtime code.
- Real SQLite tests include durable attempt/request records, atomic result/output/
  source settlement, unknown schema, confirmed PK restart and a query-only database
  write failure that prevents the next PATCH. They do not mock away commit logic.
- A fresh subprocess commits to a persistent fake remote SQLite, exits abruptly
  before local confirmation, and is then discovered from an alternate run path:
  creates are not replayed and the real remote row count remains one. Another
  subprocess proves deletion of a previously initialized canonical registry is
  refused without reinitialization, even with a custom run directory.
- Canonical claim tests cover current public legacy import_stock, aliases,
  missing/replaced DBs, unresolved abandonment, independent owner locks and old
  completed-run status after later revisions. Tests use no real app-data state.
- Changed-Python Ruff passed during development and is repeated before commit:

  ```sh
  .venv/bin/ruff check src/invimport/execution src/invimport/inventree/{stockimport,ledger,archive}.py tests/execution tests/conftest.py
  ```

- `git diff --check` and portable-path audit are repeated before commit. No skill
  or custom agent changes; the workflow synchronization tests run in normal suite.

Final full-suite commands after the final runtime changes:

- `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE3_UV_CACHE" make test`:
  **1570 passed, 1 skipped, 43 deselected in 39.40s**. Existing skip unchanged.
- `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE3_UV_CACHE" make test-scanner`:
  **43 passed, 1571 deselected in 43.10s**.
- Normal/scanner processes used the same isolated environment with sync disabled
  and independent test temporary directories. The final additional rollback test
  was added afterwards and passed in the 60-test focused command; it changes no
  runtime behavior and did not justify another full-suite repetition.
- Final changed-Python Ruff and `git diff --check` passed. Portable-path audit
  found no local absolute paths in added source/tests/documentation.

## Independent review and next-stage integration

Fresh independent review passed the original 60-test focused selection, then
found two initial P1 and three P2 runtime issues plus a stale plan-opening status
line. The deep-immutability and strict-schema findings below share one model
implementation theme but are two distinct P2 findings.
Clearance remains pending recheck. Owner has not pushed/opened a PR.

- **P2, deep immutability and schema:** frozen dataclasses accepted caller-owned
  lists; mutating operations/provides/attribution after validation changed the
  approved revision/scope. Constructors now defensively own tuple sequences across
  plans/specs/attribution/results/discovery decisions, validate primitive/enum/
  output identities, and reject malformed records. Plan reload uses exact nested
  schema fields instead of dropping unknown attribution keys, and rejects duplicate
  JSON keys. Regression tests mutate every original sequence after approval and
  prove stable serialization/revision/reload, and reject invalid enums, outputs,
  nested structures and unknown fields. Successful results cannot retain recovery
  permission or unknown effects.
- **P2, platform state root:** relative XDG_STATE_HOME/LOCALAPPDATA could move the
  canonical authority with cwd. Both are now rejected before creating state.
  Tests establish a claim under an absolute platform root, change cwd and prove
  exclusion, then substitute a relative root and prove failure without creating
  a second registry. The maintained plan opening now accurately describes the
  implemented Stage 3 foundation rather than saying Stages 3–7 are unimplemented.
- **P1, target mismatch without saved outputs:** resume previously only applied
  full instance checks when choices/outputs existed; known instance A→B drift at
  the same URL could dispatch an independent pending mutation. All execute/resume/
  reconcile paths now reject known target conflicts independently of PK presence.
  `execute_plan` requires an explicit current target observation, avoiding an
  inferred fresh observation from the persisted plan. The exact no-output
  classified-failure/cancellation/pending-write scenario proves no wrong-target
  mutation, with direct execute and unknown-effect reconciliation checks too.
- **P1, retry state bypass:** RETRY_WAIT was eligible without consulting stored
  certainty/retry. A handler could catch a lost create response and return
  RETRY_WAIT/UNKNOWN/RECONCILE; another execute_serial then repeated the create.
  Both scheduler and RunStore.start now enforce separate eligibility: original
  mutation handlers cannot replay unknown/reconcile/review outcomes. Tests cover
  unknown+reconcile, unknown+review and none+review; saved outputs remain intact.
  A real owned run resumes without replay and settles through a read-only
  reconciliation attempt instead.
- **Follow-up P1, retry authorization variants:** recheck confirmed the initial
  five reproductions were fixed and independently passed 87 focused tests, Ruff
  and whitespace, then found two remaining authorize_retry paths. First, a result
  could report aggregate NONE/READ while an individual create effect was UNKNOWN;
  clearing only aggregate flags discarded uncertainty. Constructors now reject
  unknown effects without unknown aggregate certainty (and confirmed effects with
  aggregate NONE); scheduler/store-start/authorization explicitly inspect unknown
  effects too. Persisted contradictory pre-fix records fail closed as JournalError
  and retain their raw effect/output evidence rather than being reset. A real
  SQLite regression exercises authorize_retry, store.start, execute_serial and
  resume against that persisted record, with no replayed mutation and saved PK
  retained. Second, a mutation spec mislabeled NONE/READ could use authorize_retry
  to clear its result and become READY, bypassing scheduler's semantic-read gate.
  Reset now also requires the actual OperationSpec to be a semantic read. Evidence-
  backed reconciliation remains separate. Read requeue preserves prior confirmed
  outputs rather than deleting the result. Tests cover the exact invalid result
  constructor, mutation-spec reset refusal and retained read-output identity.
- An attempted AST-based test-call update lacked end-position metadata in the
  shell Python and stopped after the execute signature changed. The immediately
  following focused command reported eight missing-current_target failures (one
  worker warning). Updated every test call explicitly; corrected focused suite
  passed **87 tests** (74 foundation plus 13 SDK/request observation). This was a
  temporary test adaptation failure, not a failing final behavior.
- Review-fix `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE3_UV_CACHE" make test`:
  **1598 passed, 1 existing skip, 43 deselected in 39.48s**.
- Review-fix `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE3_UV_CACHE" make test-scanner`:
  **43 passed, 1599 deselected in 43.59s**.
- Changed-Python Ruff and `git diff --check` passed after the review changes.
  No live service requests or inventory writes. Independent clearance remains
  pending reviewer recheck of the corrected commit. These counts preceded the
  follow-up retry-authorization corrections; latest evidence appears below.


Final follow-up retry-authorization validation:

- Focused `.venv/bin/pytest tests/execution tests/inventree/test_request_observation.py -q`:
  **93 passed** (80 foundation plus 13 SDK/request tests).
- `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE3_UV_CACHE" make test`:
  **1604 passed, 1 existing skip, 43 deselected in 39.35s**.
- `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE3_UV_CACHE" make test-scanner`:
  **43 passed, 1605 deselected in 43.13s**.
- Changed-Python Ruff and whitespace passed. No additional failed check, live
  request or inventory write. Independent re-clearance remains pending.

Stage 4 must consume this foundation with one real durable slice: preserve
existing matching and field policies, generate genuinely resolved mutation specs,
revalidate the frozen input/files/target and each chosen record identity, checkpoint
one parameter at a time, reconcile unknown creates without replay, and bridge
confirmed-change attribution to existing reports. Do not register the old whole
stock importer as one recoverable handler or treat a legacy reservation as a
resumable operation journal. Preserve Stage 1 complete-read/barcode boundaries and
Stage 2 real SDK safe logging/correlation. Later full provenance/immutable evidence
and CLI/default-release work remain Stage 5/6 gates.
