# Stage 6 — durable CLI integration and operational release

## Scope and base

Implementation owner: Stage 6, separate from the Stage 5 owner and independent
reviewer. Branch: `feat/import-run-cli`, based exactly on reviewed/published Stage 5
`dfc4cbfe089164094fb0d0b224c8f48cbecb86c4` (`feat/import-stock-finalization`, PR #17).
The inherited main/conventions ancestor is `c22b7a15aca7d338733aaf820bbd19e4fadac414`.
Work used a new isolated worktree; the parent checkout was not changed. No live
API calls, pushes, PR creation, merges or additional agents were used by this owner.
Independent Stage 6 review is still required at the final committed candidate.

Read actual `AGENTS.md`, `CONVENTIONS.md`, `ARCHITECTURE.md`, maintained design,
plan/contracts, Stage 5 tracked handover and its external owner/reviewer evidence.
The maintained documents supersede the original proposal where explicit shifts
are recorded. New Python boundaries follow commands → reusable execution logic;
no UI/hardware dependencies or global SDK/request patches were added.

## Result and actual implementation steps

1. Registered `commands/import_run.py` as an explicit top-level opt-in with
   prepare, execute, status, resume, retry-operation and abandon. All actions accept
   `--json`, `--events` and explicit-choice `--yes`; mutation/disposition actions
   require `--write`. Without it, they only validate/project the approved plan and
   never connect. Preparation/status have their own read-only contracts.
2. Preparation validates stock/configuration locally, uses existing observed SDK
   setup/authentication and full-domain planner, then writes a private atomic plan.
   The conditional outline precedes connection and the hierarchy precedes writes.
   Source bytes/configuration semantics/options/choices remain frozen. Execution
   does not require deleted source files or reload permissions/configuration.
3. Added `execution.run_control` for local canonical discovery, versioned inspection
   including attempts/requests, retention-aware completion and blocking audited
   abandonment. Local inspection validates journal schema/integrity, plan revision,
   operation identities, states/results and source attribution. Status uses one
   committed transaction for operation/attempt/request projection and never calls
   the remote API. SQLite remains authority, not the export.
4. Required explicit `--continuity-reason` for CLI resume/retry and retained that
   reviewed same-database acknowledgement in registry audit. It is separate from
   `--yes`/`--write`, and cannot override endpoint/known-instance/record drift.
   Actual API endpoint binding is retained; mutable SDK `server_details` is not
   promoted to immutable database identity.
5. Extracted focused selected-prerequisite repair in `stock_workflow`. It traverses
   missing required usable outputs under existing stable IDs; readiness/settlement
   barriers remain distinct. Failed inventory can settle for artifact processing
   without becoming a blanket retry. It never resets stored results/unknown effects,
   blindly repeats creates or invents replacement IDs. Existing pending execution
   and immutable finalization refresh remain responsible for approved descendants.
6. Added per-operation observation and run-start correlation so exceptional exits
   retain an operator-visible run ID. Child requests retain the actual SDK transport
   seam and guards. Added cancellation checks after read responses as well as the
   existing before-every-child-dispatch guards. In-flight confirmed/unknown outcomes
   remain honest. Programming exceptions stop dispatch and preserve their Python
   cause through `InvocationFailure`; SDK failures expose only safe exception classes.
   Locally composed preparation-review messages identify the inventory ambiguity
   needing correction without exposing raw SDK exception bodies.
7. Exported redacted invocation observations as versioned sequenced JSONL. Stream
   identity distinguishes invocation sequence from durable SQLite journal sequence.
   Export reconstructs the retained observation snapshot despite renderer delivery
   failures. Status rebuilds authoritative state after dropped events. JSON stdout
   is one result; progress/diagnostics use flushed non-TTY stderr.
8. Froze explicit generated-output identities into archive discovery exclusions.
   Exact output/event destinations are excluded before reading partial old output
   bytes; unrelated vendor JSONL remains source evidence. Output destinations cannot
   replace input or execution authority. The review correction below replaces the
   original incomplete filename guard with actual root/identity protection. No generic extension/name bans
   were added to archive selection.
9. Updated current architecture, README, maintained design/plan/contracts and added
   `docs/import-run.md` covering commands, recovery, storage, sensitivity, retention,
   schemas, crash/disk-full/corruption/lost-response handling and rollout limits.
   Existing README/AGENTS architecture references remain intact.

## Decisions and plan adjustments

- **Release explicit `import-run`; preserve the legacy default.** Default switching
  would claim parity beyond reviewed bounds. The usable command exposes full stock
  workflow/recovery now while keeping all `import-stock` flags and montage `--plan`
  schema unchanged. There is no fallback to legacy after new-engine failure.
- **Noninteractive preparation with explicit input/options.** Ambiguous choices fail
  review safely and produce a single JSON result. Reusing legacy prompts would leak
  presentation into machine stdout and imply configuration persistence that has no
  frozen destination/precondition contract. Library preparation callbacks remain
  available; no hidden local category YAML writes were added.
- **Operator continuity acknowledgement, never SDK identity inference.** A reason
  records reviewed same-database continuity where immutable identity is unavailable.
  It is not a force flag and does not weaken the engine's known-drift checks.
- **No active semantic revision migration.** Repair uses original frozen intent.
  Corrected input/configuration is a different revision and cannot silently rebase
  a run; journal revision validation and canonical claims block it. There is no
  arbitrary reviewed revision migration command in this release. Keep unresolved
  effects/IDs and blocking disposition for operator investigation.
- **Blocking abandon disposition.** A reason is not proof of absent remote effects.
  Abandon records a tombstone and keeps uncertainty/claims; no unlock/clear operation
  was introduced. New and legacy same-import writes remain blocked.
- **Prerequisite repair versus settlement.** Required output recovery is necessary
  to make a selected barcode/stock/evidence operation usable. Traversing every
  settled dependency would incorrectly repair unrelated failed inventory when the
  operator selected only evidence. The adapter explicitly preserves this distinction.
- **Snapshot-based event export.** `--events` is a completed invocation observation
  export, not a crash-durable journal/tail protocol. Rendering is best effort and the
  retained observation snapshot rebuilds delivery gaps. A future TUI can subscribe
  to live Observation and resync from status; no speculative TUI dependency or
  durable HTTP replay mechanism was added.
- **Exact generated-output exclusions.** Explicit resolved path identities prevent
  packaging partial own outputs without suppressing legitimate generic evidence.
- **No full legacy parity claim.** One distinct new PO allocation, conservative
  differing-basename rejection and no inferred category-YAML persistence remain.
  The durable CLI does not currently generate legacy montage `--plan`; the existing
  library result projection remains usable by report integrations. Stage 7 and a
  future default-switch gate own the remaining work.

## Validation, failures and fixes

All tests used fake boundaries/local SQLite; the actual SDK tests use a fake HTTP
transport and persistent fake remote, including real auth/token/construction paths.
No live server behavior, target uniqueness, allocator guarantees or exactly-once
remote effects are inferred.

Reproducible commands (activate the existing pinned project environment, or set
`BASE_ENV` to its runtime-discovered location; `UV_NO_SYNC=1` avoids changing it):

```sh
PYTHONPATH=src "$BASE_ENV/bin/pytest" tests/execution tests/inventree/test_request_observation.py -q -x -o addopts=''
UV_CACHE_DIR="$REVIEW_CACHE" UV_NO_SYNC=1 UV_PROJECT_ENVIRONMENT="$BASE_ENV" PYTHONPATH=src make test
UV_CACHE_DIR="$REVIEW_CACHE" UV_NO_SYNC=1 UV_PROJECT_ENVIRONMENT="$BASE_ENV" PYTHONPATH=src make test-scanner
PYTHONPATH=src "$BASE_ENV/bin/ruff" check src/invimport/__main__.py src/invimport/commands/__init__.py src/invimport/commands/import_run.py src/invimport/execution/run_control.py src/invimport/execution/executor.py src/invimport/execution/store.py src/invimport/execution/stock_workflow.py src/invimport/execution/stock_finalization.py src/invimport/execution/stock_api.py src/invimport/execution/transport.py tests/execution/test_run_cli.py
git diff --check
```

Initial candidate validation results (historical, before independent-review fixes):

- Required normal `make test` (scoped permission for loopback fake servers):
  **1750 passed, 1 existing skip, 43 deselected**, 134.00 seconds. It includes the
  first 18 CLI cases. Subsequent helper extraction/repair observation and the final
  auth-error cases were verified by the fresh combined focused suite below.
- Final combined execution/actual-SDK suite: **243 passed**, 82.90 seconds,
  including all 22 CLI cases and Stage 3–5 recovery/finalization regressions. This
  final run includes every runtime change, including useful safe preparation-review
  messages and selected-repair observation. The preceding 241-case run also passed.
- Required scanner regression suite: **43 passed, 1749 deselected**, 44.49 seconds.
  No scanner behavior or hardware was changed/contacted.
- Changed-Python Ruff and `git diff --check`: pass.
- Two additional CLI-only cases (full frozen archive/attachment after deleting the
  entire source folder; event-export persistence failure without write replay)
  both pass in the CLI-only run: **22 passed**, 16.99 seconds, and in the final
  combined 243-case run above.

Observed setup/test failures and corrections:

- Initial worktree creation needed scoped Git metadata permission; retried with the
  authorized isolated branch/worktree and exact base, leaving parent untouched.
- Initial `uv run` could not access the default cache. Used an isolated review cache
  and existing pinned environment without dependency synchronization.
- First CLI test import incorrectly referenced `validate` from `stockfile`; corrected
  to the established `validate` module before continuing.
- First fresh-process test shim deferred removing its fake-server argument until
  connection, so argparse saw it as a command. Corrected the test harness to parse
  that argument before invoking the actual CLI.
- SDK fake OPTIONS response initially lacked `.json()`; corrected the fake response
  interface. This was a harness failure, not transport bypass/pass evidence.
- Generated-output test initially used a directory outside the recognized import
  folder contract, yielding an empty manifest. Repeated under the proper named
  import folder, proving own-path exclusion plus preservation of vendor JSONL.
- First normal suite ran inside the filesystem sandbox: loopback fake-server binds
  were denied and caused fixture errors/timeouts. Stopped that obsolete run and
  reran with scoped loopback-test permission. Its failures are not code pass evidence.
- Ruff required explicit strict zip matching in exported SQLite projection rows;
  fixed with `strict=True`. No runtime failure or unrelated formatting sweep.

The CLI scenarios cover fresh subprocess execution/status/retry; deleted prepared
source; custom journal discovery; no-write preview; non-TTY progress; exact JSON;
renderer failure and snapshot rebuild; canonical tombstone exclusion; target and
continuity preflight; missing/corrupt registry and semantic journal corruption;
selected optional failure versus disabled work; completed local retention damage
with unchanged remote-call counts; evidence-only retry preserving failed inventory;
Ctrl-C and programming error after an applied write; actual SDK token and password
startup plus per-send durable INTENT assertions; auth/token error canaries; explicit
partial generated outputs versus genuine evidence; and ambiguity without prompts.

## Independent review and remaining limits

Independent initial review of `1acda3eaca27fc5e117b1cfb3e85a7b5c41fed45` found three
material defects. That candidate is not approved. The independent reviewer reran
243 focused cases and separately exercised fresh-process status during an active
writer/real SIGINT, 150 guarded actual SDK sends/intents and historical unknown
artifact revision behavior; those passed but did not negate these new findings.
The report is retained externally as `stage6-review.md`. Final clearance below
names the independently approved corrected implementation; initial rejection is
preserved separately from that approval.

### Review findings, corrections and regression evidence

1. **P1 — Generated output can replace held locks/retained artifacts.** The original
   filename-only guard allowed `--events` inside a custom run. The review probe
   replaced `run.lock` while held, allowing a second exclusive lock on a new inode;
   another export overwrote retained bytes after reporting complete. Replaced the
   denylist with reusable `execution.output_paths.GeneratedOutputs`. It checks
   resolved canonical state, every registered custom run root (even without a
   marker), marked roots, an explicitly supplied future run directory, selected
   config/env/input/plan identities and explicitly referenced local sources before
   work and before each generated write. Canonical registry enumeration is SQLite
   read-only and fails closed when required authority is missing; it cannot create
   a new registry during status/resume. Unsafe destinations are never used in the
   finally export. Unrelated equal basenames and genuine vendor JSONL remain valid;
   explicit partial generated destinations remain excluded from source manifests.
   Regressions hold the original lock across a fresh CLI subprocess, require inode
   stability and second-lock refusal, verify immutable artifact bytes/retention,
   cover registry locks/sidecars/custom roots without markers/unregistered marked
   roots/future roots, protect source/provenance/config/env/input files and allow an
   unrelated `run.lock` output elsewhere.
2. **P1 — Row-only semantic corruption can certify UNKNOWN as success.** Changing
   `operations.state` from uncertain to succeeded while its result remained
   UNCERTAIN/UNKNOWN was accepted by local status and the completed resume shortcut.
   Added shared `execution.journal_validation` for writer open/snapshot, committed
   status and run inspection. It validates plan/operation/attribution, row/result
   agreement, declared/non-rebound output history, attempt intents/settlements and
   request-to-attempt/event bindings. Result certainty policy still uses typed
   `OperationResult`. Completion also refuses an untrusted success projection over
   a non-success result. The explicit valid exceptions are preserved: RUNNING can
   retain a newly checkpointed or prior result under its unique latest open attempt;
   BLOCKED can retain prior RETRY_WAIT; audited semantic reads can be requeued or
   blocked without erasing their failed result. Regressions corrupt state, certainty,
   output PK, attempt owner and request owner and require status/resume/store refusal
   with zero remote calls. Valid running-checkpoint/repair, blocked retry-wait and
   safe-read-requeue histories remain usable. The review's original semantic probe
   now returns exit 1 / JournalError for both status and resume.
3. **P2 — Event export failure overrides cancellation exit.** The original finally
   handler set exit 1 after an applied-write Ctrl-C when event persistence failed.
   Preserve exit 130 while separately returning `events_saved: false`. The regression
   applies one stock write then interrupts, fails event persistence, requires exit
   130, retained run ID/unknown result and exactly one stock. The original review
   cancellation probe now reports exit 130 with the independent export failure.

Corrected-runtime validation:

- Final `make test`, with scoped permission for local loopback fake servers:
  **1772 passed, 1 existing skip, 43 deselected**, 137.11 seconds. All corrected
  runtime files and all 40 Stage 6 cases are included. The earlier 1750 normal result
  above is historical first-candidate evidence, not the corrected candidate count.
- Final combined execution/actual-SDK suite: **261 passed**, 103.84 seconds.
- New output/cancellation CLI coverage: **31 passed**, 23.54 seconds; new shared
  semantic journal coverage: **9 passed**, 8.16 seconds (also included in both broad
  corrected runs). No live APIs/hardware were used.
- Changed-Python Ruff and `git diff --check`: pass. The corrected run adds
  `execution/output_paths.py`, `execution/journal_validation.py` and
  `tests/execution/test_journal_validation.py` to the Python check list above.
- Corrected-runtime scanner rerun: **43 passed, 1773 deselected**, 42.32 seconds.
- Adapted original output probe now returns 1 for both unsafe destinations,
  preserves the held lock inode, refuses a second exclusive lock and leaves all
  retained receipts verified. The probe's original success-only `complete` lookup
  and second-lock assumption were adapted to observe the expected refusal; the
  production CLI was exercised unchanged. Original semantic and cancellation probes
  return the corrected outcomes recorded above.

 A source-protection test initially
used invalid provenance fact syntax; corrected its fixture to a valid field-name
fact before counting its pass. No production failure was hidden by that harness fix.

### Final independent clearance

**Approved for the Stage 6 explicit opt-in durable stock CLI stacked PR at exact
corrected implementation hash `93c5f355da8caffef272c2bfb35f7261e7fb67f2`.**

All three initial material findings are independently cleared; no material
unresolved finding remains. The rejection above applies to initial `1acda3e` only.
The independent reviewer checked clean exact HEAD/latest-main ancestry, reran the
corrected focused suite (**261 passed in 96.68 seconds**, including all 31 CLI and
9 shared journal-validation cases), and passed correction Python Ruff plus
base-to-head `git diff --check`. The original adverse probes and independent
active-writer/real SIGINT, full SDK150-send/intent and historical unknown-revision
probes passed as recorded in the external final report. The reviewer made no
source edits, commits, publication, live API calls or additional-agent delegation.

Owner normal **1772 passed, 1 existing skip, 43 deselected** and scanner **43 passed,
1773 deselected** remain owner evidence; the reviewer did not repeat those broad
suites. The initial 1750/243 results are historical first-candidate evidence and
are not inflated into corrected verification.

This clearance documentation commit changes no runtime/test behavior. Only
whitespace validation is repeated for these documentation edits. Approval covers
the exact implementation hash above and its explicit opt-in/local/serial release
limits. Root handles publication; Stage 7 has a separate implementation owner and
independent review. No deployable-app/dependency changes are part of this stage.

Current limits are documented in `docs/import-run.md`. Local locks/registry exclude
supported writers only within one configured user-state scope. Different roots,
hosts/users, downgraded binaries and raw clients can bypass that scope and are not
safe recovery techniques. No network-filesystem, cross-client atomicity or live
server exactly-once guarantee is claimed. Prepared plans/status/provenance contain
sensitive inventory facts; event redaction is not permission to put credentials in
inventory fields or audit reasons. There is no automatic cleanup/migration or safe
portable executable resume export. Completed local retention damage is reported,
not used to recreate historical writes.

## Stage 7 guidance

Start from independently cleared Stage 6 only. Keep DigiKey adaptation separate
from stockfile identity assumptions. Preserve actual startup/auth/download/request
observation and local canonical ownership; do not wrap whole legacy work or replay
HTTP requests. Model issue/receive multi-effect outcomes and unknown contributions
explicitly. Keep concurrency off until measured benefit and independent per-domain
fault gates establish safe ownership/settlement. A future TUI consumes Observation
and versioned status, resyncs after stream loss, and collects choices before frozen
execution; it must not own retry/cancel semantics or mutate SQLite directly.

Suggested PR Decisions/Plan adjustments: explicit opt-in release; deferred default
switch/montage/interactive YAML parity; reviewed continuity reason separate from
approval; blocking abandon tombstone; usable prerequisites versus settled barriers;
versioned snapshot/event stream distinction; exact generated-output exclusion;
local operational/schema/retention limits and no TUI dependency.
