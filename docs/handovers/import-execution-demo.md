# Follow-on demo handover — real CLI and persistent loopback HTTP

## Base, scope and ownership

Exact reviewed/published Stage 7 base:
`d591d717ce424b1a63e5b321b66851deac88d7c4`, PR #19, branch
`feat/import-digikey-durable-orders`; its independently approved runtime is
`b27badf80a03c3b753a5293010054514c4a064c8`. The separate demo owner uses
`feat/import-demo-server` in an isolated worktree. Required main
`c22b7a15aca7d338733aaf820bbd19e4fadac414` and current conventions are inherited.
Parent checkout/other stages were not edited. Root owns fresh independent review
and publication. No push, PR creation, merge, further delegation, live inventory
request or vendor account request was performed by this implementation owner.

Read actual AGENTS.md, CONVENTIONS.md, updated architecture, maintained execution
design/contracts/plan, operator guide, preceding stage handovers and final Stage 7
independent review. That review cleared the original Company/contribution/decimal/
date findings plus late receipt-total/status and aggregate-certainty corrections;
none was reopened or bypassed by this demo. A lightweight prior-context search
provided no additional implementation authority. The demo owner first completed
read-only discovery and an external plan while Stage 7 review was still pending;
implementation began only after root supplied the exact final approved base.

The user requested a separate implementation owner for a usable self-contained
fake-server demonstration. The approved interface is `demo serve/run/inspect`,
with happy and one-shot attachment rejection scenarios. This is a bounded stock
workflow demonstration, not a web app/TUI, package/framework migration, production
engine change, broader API emulator, DigiKey demo or lost-response scenario.

## Actual implementation and evidence

1. Created the isolated branch/worktree at the exact base. Git ref creation was
   initially sandbox-denied; scoped escalation created the authorized tree.
   Existing pinned Python/uv environment was reused; no dependency or lockfile
   changed. Actual loopback binds required scoped execution permission in this
   environment. An initial bind-denied synthetic workspace was retained, not
   silently recreated or deleted.
2. Audited `tests/support.py` real HTTP `InvenTreeStub` handshake/auth/CRUD/multipart
   routes, `tests/execution/stock_server.py` persistence/fault/bytes behavior,
   `digikey_server.py` default PO-line merging/repricing and full-stock CLI tests.
   Test fakes are test-owned and either too broad or SDK-like Python boundaries;
   importing them would not provide an application-owned installed demonstration.
   Implemented only the narrow useful behavior under `src/invimport/demo/`.
3. Added `DemoState`: persistent SQLite records, request receipts, exclusive barcode
   ownership, exact attachment bytes and consumed one-shot faults. Stock POST
   returns a singleton list. PO-line merging defaults on unless explicitly disabled;
   source quantity/reference/price/currency survive, and auto-pricing is a distinct
   control. Real prepared stock sends both opt-outs. No reference uniqueness or
   live server capability is inferred.
4. Added actual standard-library HTTP endpoints bound exclusively to `127.0.0.1`.
   The real pinned SDK constructor/testServer/token authentication, OPTIONS,
   collections/details, JSON CRUD, barcode lookup/link, multipart attachment upload
   and media downloads all traverse HTTP. Unsupported endpoints return errors.
   API/media routes require an obvious fake token; root metadata/identity probe
   expose only synthetic service identity. Request receipts exclude auth headers.
5. Added owned workspace creation: new private directory, generated category/
   parameter YAML, v2 shared-Part/two-lot input, synthetic label, private home,
   env file, outputs, real state root and fake DB. No hand-authored JSON, credentials
   or external downloads are needed. Existing directories and symlink roots are
   refused. Manifest/database instance identity must agree, required members must
   exist, and SQLite connections use existing-file mode after initialization.
   Missing state is never reseeded. Initial OS-selected port is retained for restart;
   occupied ports fail rather than change the target of an existing journal.
6. Added strict real CLI subprocess runner. It passes explicit demo source/config/
   output/environment/state paths and fake loopback credentials. It filters inherited
   credentials/proxies/state/user-home settings, pins the running package location
   by runtime discovery, and uses Python `-P` to prevent cwd shadow imports. `demo`
   skips the ordinary global `.env` load; the child receives its own explicit file.
   The runner verifies the instance nonce before network work, disables identity
   proxy use and refuses redirects before dispatch. Local status/preview remain
   connection-free. Each child has a five-minute bound; ordinary SDK request and
   journal/cancellation policies remain in control within that bound.
7. Preserved explicit `--write` and `--continuity-reason`; never supplied a continuity
   acknowledgement, edited claims, cleared authority or reset faults. One workspace
   permits one write execution, checked before any child/network work using existing
   run locator/registry. Resume/selected retry retain the original plan, run/operation
   IDs, attempts, results and known PKs. The convenience locator and JSON/event
   projections do not become journal authority.
8. Ran a real manual happy workflow: server bound an ephemeral loopback port,
   prepare resolved the hierarchy, explicit execution completed every selected
   operation with 421 emitted progress events, and separate-process local status
   completed. Both synthetic lots, distinct PO lines, barcode owners, source label,
   provenance/archive and byte verification persisted. Stopped only the owned
   manual server afterward; its workspace remains for inspection.
9. Added real subprocess/HTTP regressions for happy/partial execution, no-write
   preview, ignored real env-file/credential/proxy canaries, occupied-port refusal,
   stopped-server local status, stable restart, wrong instance, original-ID selected
   retry, preserved failed history/known effects, no duplicate label/inventory,
   completed no-op resume, source/package/cwd isolation and pre-follow redirect
   rejection. No custom FakeAPI, monkeypatched SDK transport or test-module import
   is used by the runnable demonstration.
10. Added the user guide and links in README/operator/architecture/maintained plan.
    Source/config/plan/journal/fake DB paths, explicit approvals, expected exits,
    selecting the exact failed operation, checking PK/count equality, shutdown,
    stable restart, retention and positively owned manual cleanup are documented.

## Decisions and plan adjustments

| Decision | Rationale and alternatives |
|---|---|
| Foreground serve plus separate real CLI processes | Makes actual status/restart/recovery visible without a daemon/PID file or pytest invocation. Ctrl-C closes the listener; no process-kill endpoint or PID reuse risk is introduced. |
| Generated private workspace instead of sourced environment | An exported real target/token can override a sourced `.env`. Explicit child environment/target/config/state and package pinning make the demonstrated boundary reviewable and avoid inherited live settings. |
| Port 0 only at first creation, same port thereafter | Avoids fixed-port assumptions while retaining exact endpoint identity for the recovery journal. A restart cannot silently allocate another endpoint. |
| One write execution per workspace | Avoids a second run/claim being created before a convenience locator notices the change. Recovery remains under the original run; another demonstration uses another new directory. |
| Attachment 403 before application | Identity parameters correctly gate dependent stock. Rejected selected evidence shows registered lots with incomplete evidence while independent work proceeds, then targeted repair without stock duplication. Fault consumption persists across restart; no reset is needed. |
| Small application-owned fake | Existing HTTP test stub is broad/in-memory and persistent test fake is a Python SDK-shaped boundary. Narrow production-package code keeps installed runtime free of tests/pytest/path hacks; no general emulator extraction was justified. |
| Keep ordinary engine policies | Real immutable plans, dispatch intents, SQLite claims/results, continuity reasons, semantic validation, generated-output protection and artifact revisions run unchanged. Demo-only reset/replay would conceal the very contracts being demonstrated. |
| Defer DigiKey/lost-response extras | Primary honest HTTP/isolation/persistence/recovery proof is independently useful. Broader receipt and uncertainty scenarios would expand fake contracts and review scope; they remain covered by inherited execution tests, not claimed as user-run demo modes. |
| Manual owned-directory cleanup | Avoids recursive deletion of arbitrary existing paths. Server never erases workspaces; user checks the exact marker/directory after shutdown and retains it if recovery/history matters. |

## Development corrections and review feedback

- Initial command registration edit duplicated `demo` in the command list; parser
  construction caught it immediately and the duplicate was removed before any
  demo request. Required checks exercise the final registered command.
- First generated input used unsupported `source.description` and `order.currency`.
  Normal parser validation stopped before HTTP. The fixture now uses allowed
  source.reference and line-default currency. No input-validation bypass was added.
- Initial identity probe checked redirect URL after urllib followed it. Root's
  preliminary audit correctly required pre-follow refusal; a dedicated handler
  now raises before any redirected request, and a real HTTP redirect regression
  proves only `/demo/identity` was visited.
- Root also identified arbitrary/relative inherited PYTHONPATH across changed cwd
  and after-the-fact run-locator checking. The runner now derives its package root,
  uses `-P`, and refuses existing execution history before connection. Real child
  shadow-import and unchanged-request-count tests cover these corrections.
- Real no-write preview/status use the original CLI connection-free behavior.
  Nonce checks apply only to preparation/actual writes, avoiding a server health
  dependency for local status while stopped.
- No production execution defect was discovered that required changing the engine.
  Final independent review remains a separate gate; owner checks alone do not
  constitute clearance.

## Validation and remaining constraints

Final focused/normal/Ruff/whitespace results are appended after completion below.
All tests use only synthetic local files/SQLite and loopback HTTP. No external
inventory/vendor service or account credential was exercised. No skill/custom
agent changed; workflow-sync is therefore unnecessary. Scanner/TUI tests are not
required because scanner behavior, shared transport/executor and UI code did not
change; only demo registration and demo-specific env-file dispatch changed.

The fake is intentionally limited to the seeded stock path: no arbitrary API
compatibility, image endpoint, DigiKey receive workflow, lost-response injection,
concurrent external actor, live rate/allocator/uniqueness or immutable database
identity capability is promised. Instance nonce validates this demo's listener;
it does not override real `import-run` continuity requirements or establish a
production server identity mechanism. Real effect/finalization rules can add
immutable provenance/archive revisions after recovery while known inventory PKs
stay unchanged; attachment total count alone is not an idempotence criterion.

Maintain tests when SDK constructor/auth/request/media contracts change. Fixtures
are generated without installed-data-file assumptions. Keep the server bounded
and refuse unsupported operations rather than silently return success. Retain
entire stopped workspace for reproducibility; never reset registry/journal/faults
to make a scenario succeed. Delete only the positively identified created demo
directory after server/import shutdown. Removing the command/package and its
registration/docs/tests reverts this follow-on; production engine and original
user inventory/state need no migration. Root should review the exact committed
candidate, append independent corrections/disposition, then publish its stacked PR
against `feat/import-digikey-durable-orders`; no merge is authorized by this handover.

## Final owner validation and review disposition

Final frozen runtime and strengthened original-failed-attempt/retry assertions:

- Required `make test`: **1887 passed, 1 existing skip, 43 deselected in
  194.92 seconds**. The preceding broad milestone also passed1887/1skip/43deselected
  in199.66seconds; these are repeat runs, not additive coverage.
- Dedicated `tests/demo`: **8 passed in28.97seconds** after redirect/package/one-run/
  occupied-port checks. The final normal run above additionally includes explicit
  original failed attempt1 + successful retry attempt2 preservation assertions;
  no runtime bytes changed afterward.
- Required `uv run ruff check` over all changed Python files: **pass**.
- Full staged and base-to-head `git diff --check`: **pass**; required main ancestry
  verified. New repository files contain no developer checkout/home/temp absolute
  references. Command help and the guide's actual serve/run/inspect path were
  exercised through real subprocesses in the focused/normal cases.
- No scanner/TUI/shared transport/executor behavior, skill or custom agent changed;
  scanner/workflow-sync checks are inapplicable rather than unreported failures.
- No live inventory/vendor request, dependency update, push, PR or merge occurred.

Portable check commands (the owner selected the already pinned environment with
`UV_PROJECT_ENVIRONMENT`, task-local `UV_CACHE_DIR` and `UV_NO_SYNC=1`):

```sh
PYTHONPATH=.:src uv run pytest tests/demo -q -x -o addopts=''
PYTHONPATH=.:src make test
uv run ruff check src/invimport/demo src/invimport/commands/demo.py src/invimport/__main__.py src/invimport/commands/__init__.py tests/demo
git diff --check
```

Owner implementation is complete, with fresh independent exact-head review still
required before publication. The source/runtime, guide and test files are frozen;
only final validation/handoff bookkeeping follows. Root should publish the reviewed
candidate as a stacked PR against the Stage 7 branch after clearance. Nothing here
supersedes its live/parity/serial/unknown-effect limits or authorizes merging.


## Independent rejection and corrections

Independent reviewer rejected initial exact candidate
`227a8409e9c7f3628270281856cd80316d4c2191` with two material findings. The
passing owner suites above did not cover these boundaries and do not clear that
candidate retroactively:

1. **P1 cancellation/recovery locator:** actual wrapper+child group SIGINT after
   the first applied StockItem left a durable run/claim but no `output/run.json`.
   The wrapper's subprocess.run raised before result/locator saving, so wrapper
   status/resume/retry could not reach the valid original history. The five-minute
   timeout had the same missing-projection problem. Fresh execute correctly stayed
   blocked; the defect stranded supported recovery rather than permitting replay.
2. **P2 fake schema readiness:** dropping `media` from a retained fake DB still let
   restart announce ready under its old nonce/port. Identity-table checking alone
   did not establish the endpoint could serve required byte-verification behavior.

Corrections stay entirely within the demo boundary:

- Added `demo.process` with a separately grouped child on POSIX, one forwarded
  SIGINT, bounded settle/terminate/kill escalation and reaping. Ctrl-C returns130;
  timeout retains its controlled exit1. Independent locator/result projection
  errors cannot override a settled cancellation's130. Hard process death is still
  not proof that a remote request did not apply; ordinary journal uncertainty rules
  remain authoritative.
- Added `demo.recovery`: read-only existing-file registry inspection verifies
  schema/integrity, exactly one canonical run and matching claim/location/revision;
  the exact registered journal under the owned run root must validate its schema,
  original plan revision/endpoint and all semantic history through the existing
  journal validator. Missing or contradictory authority fails closed. Only the
  disposable run/revision JSON locator is written. No registry/journal/claim/result
  or operation is created, edited or reset. Fresh local status/resume/retry uses
  this discovery even after a prior wrapper died before saving any JSON result.
- Execute's finally path reconstructs the locator after child settlement, including
  timeout; a fresh invocation can do the same if the wrapper was hard-killed.
  Existing-locator mismatch remains an error and fresh execute remains forbidden.
- Added complete required fake table/column/type/nullability/PK checks, explicit
  supported schema version and SQLite integrity checking before listener binding/
  readiness. New fake DBs mark schema1; original candidate schema0 has the identical
  required layout and is accepted read-only without migration. Missing tables,
  renamed columns, unsupported version and corrupt bytes are refused without
  reseeding or changing the damaged DB bytes. Production execution schema is
  unchanged.
- Regression tests use actual group SIGINT after persisted stock and fresh-process
  status/resume/selected retry, retaining the original run/revision/attempt IDs and
  known stock PK while refusing duplicate creation. A real delayed HTTP response
  holds an applied stock create across an injected short child deadline, exercising
  the real subprocess timeout path: exit1, original locator/status reachable,
  uncertain outcome retained and no new write execution allowed. The injection
  changes only the embedding wait duration in the test; production remains five
  minutes. No API/SDK fake replaces the HTTP boundary.

Development corrections during review fixes: the first canonical-locator helper
incorrectly assumed the run-directory UUID equals the run ID. A real happy test
caught that before correction was committed; it now uses the registered exact
location, constrained to the owned canonical runs root and validated against the
journal's actual ID/revision. The delayed-timeout test initially captured progress into an undrained pipe, so
its stderr was moved to a file to avoid blocking dispatch. The hook still did not
delay the request because it compared the raw URL with a query-free path; actual
SDK URLs carry a query string. Matching the parsed path now deterministically
holds the applied stock response across the real timeout. Neither correction changes engine policy.

The independent original cancellation reproduction ran unchanged against corrected
runtime in a new synthetic workspace: wrapper exit130, locator present, fresh local
status reached the original incomplete run instead of FileNotFoundError. Existing
reviewer evidence workspaces were not overwritten. Corrected focused/normal checks
and exact candidate disposition follow after completion. The initial rejection
remains historical evidence; root must request an exact-head independent recheck.


Corrected focused milestone: **14 passed in45.61seconds** (8 original cases,
real after-effect group SIGINT, four schema-damage cases and real after-effect
subprocess timeout). The isolated timeout case also passed1/13deselected in7.75s.
A developmental broad run started before that test-hook correction therefore
contains its known failed timeout-hook assertion; final required broad evidence
is recorded separately below and is not inferred from the passing13-case milestone.


Final strengthened focused run: **14 passed in48.56seconds**. Schema-damage
regressions now first start/stop a real server to establish its persisted nonzero
port, so an unrelated incomplete-startup/port0 guard cannot satisfy the refusal
assertion. Database bytes remain unchanged on each rejected restart. The earlier
developmental broad result was **1 failed, 1892 passed, 1 existing skip,
43 deselected in221.03seconds**; its sole failure was the raw-query URL test hook
already corrected above. Final normal evidence follows separately. POSIX signal
tests run on this host; Windows conservatively terminates an interrupted child
instead of claiming POSIX signal-group behavior, as the guide now states.

## Corrected candidate owner verification

- Final required `make test`: **1893 passed, 1 existing skip, 43 deselected
  in215.88seconds** on the unchanged corrected runtime.
- Final strengthened focused demo suite: **14 passed in48.56seconds**, including
  actual bound-port schema refusal and after-effect signal/timeout cases.
- Required uv Ruff over all changed Python, complete staged/base-to-head whitespace
  and inherited required-main ancestry: **pass**. No runtime change follows these
  checks; only this validation/disposition record is updated.
- Original independent signal repro passes unchanged in a new workspace. No
  reviewer evidence was edited; no live inventory/vendor request, production engine
  change, dependency change, further agent, push, PR or merge occurred.

Both material review corrections are owner-complete. Initial227a840 remains rejected
history. A fresh independent exact-head recheck must approve the next clean local
commit before root publishes; this owner verification is not independent clearance.
The bounded stock/demo, explicit write/continuity, local serial authority, unknown
create, immutable finalization and no live-capability/exactly-once limits remain.

## Final independent exact-head clearance

**APPROVED for the bounded runnable demo stacked PR at exact runtime hash
`8af4cfc449a99d3f720bd1a8669cab3dbd3ceafd`.** Both material findings are
independently cleared; no material unresolved finding remains. Initial
`227a8409e9c7f3628270281856cd80316d4c2191` remains rejected historical evidence.
Earlier pending/recheck statements describe their then-current milestones; this
final disposition supersedes those pending conditions without rewriting history.

Final independent evidence on the approved exact clean runtime:

- Actual wrapper-group and parent-only SIGINT after persisted stock exit130,
  forward/reap the child and retain reachable original run/revision/history.
- Missing convenience locators reconstruct with the server stopped while hashes
  of every canonical SQLite file remain unchanged. New execution remains blocked.
  Separate reviewed resume/retry reaches the original run, retains original attempts
  and known first-lot PK, and registers independent pending work without guessing
  correlation for the original uncertain create or duplicating it.
- Held HTTP response after one applied StockItem plus a short embedding deadline
  exercises actual timeout: exit1, child confirmed reaped, original uncertain run
  reachable, local status sends no HTTP and stock remains exactly1. Production's
  five-minute bound is unchanged.
- Missing table/renamed column/unsupported schema/corrupt bytes refuse restart
  before binding or readiness, with unchanged damaged bytes. A deliberately occupied
  saved port does not replace the schema-specific error. Original fake schema0 is
  readable without modifying its bytes or migrating/resetting retained state.
- Independent committed demo suite: **14 passed in48.13seconds**. Required changed
  Python Ruff, full base-to-head whitespace, required-main ancestry and exact clean
  runtime identity: **pass**. Latest main/conventions remain inherited and matching.

Owner normal **1893 passed/1 existing skip/43 deselected in215.88seconds** and
focused **14 passed in48.56seconds** remain separate owner evidence; the reviewer
intentionally did not redundantly repeat the normal suite. Scanner/skill checks
remain inapplicable. No runtime/test/dependency/evidence bytes change in this final
clearance-record commit, so only whitespace is rechecked.

Approval retains synthetic stock-only scope, generated loopback endpoints, private
child environment, explicit write/reviewed continuity, one canonical run/workspace,
conservative unknown effects, immutable finalization revisions and manual owned
cleanup. It establishes no live capability, arbitrary API compatibility, cross-client
concurrency, unconditional unknown-create recovery, conditional-update atomicity or
exactly-once guarantee. Root owns publication and CI verification of the final
stacked PR against Stage 7. This owner made no push, PR, merge or live request;
publication authorization here does not authorize merging.


## Follow-on: optional request pacing

User feedback after publication: the demo finishes too quickly to watch. This
focused follow-on adds `demo serve --delay-ms INTEGER`, default 0, bounded 0–1000,
with 250 ms recommended. It changes only the fake server's API/media request dispatch
and command adapter. The handler waits before body processing, request receipts,
fault consumption and mutations; it never introduces an artificial lost-outcome
window by sleeping after application. The nonce identity probe has no added wait.
Startup JSON/stderr shows the configured delay. Production CLI progress/verbosity,
executor, registry, source fixtures and manifest identity remain unchanged.

Pacing is runtime-only. Restart with the flag preserves existing port/nonce/data/
run/completed steps and does not reset/replay the scenario. The guide says to let
the current invocation finish, press Ctrl-C in the original server terminal, then
restart with `--restart --delay-ms 250`. A full slower replay requires a new owned
workspace. The user's existing untracked demo directory and running server were
not read, modified, stopped, deleted or staged; tests use independent temporary
workspaces. No broad git add, stack initialization/rebase or publication is needed.

Regression coverage uses real HTTP with an event-controlled sleep hook: stock and
request receipts remain absent while dispatch waits, release allows exactly one
create, media uses the same delay, identity remains unpaced and zero delay does
not call the wait. No elapsed-time threshold is used. Real CLI startup/restart
reports 250 ms while manifest and fake DB bytes/identity remain unchanged. Invalid
CLI bounds/noninteger values fail before workspace creation; the reusable server
also validates bounds before binding, including accepted upper bound 1000.

Focused/required normal/Ruff/whitespace results and exact candidate disposition
follow after completion. No production engine, dependency, scanner, skills or
agent workflow changed. Root owns independent re-review and PR20 update; this
owner makes no push/PR/merge or live inventory call.

Pacing follow-on owner verification on final unchanged runtime:

- Focused demo suite: **21 passed in 50.35 seconds**, including seven pacing cases.
- Required `make test`: **1900 passed, 1 existing skip, 43 deselected in
  216.93 seconds**. No test failure occurred during this follow-on.
- Required changed-Python uv Ruff and staged/full-change whitespace: **pass**.
- No scanner/skills/agent changes; corresponding extra checks are inapplicable.
  The active user demo directory remains untracked and untouched. All test servers
  are isolated and stopped/reaped by their fixtures; the user's server was not
  stopped. No new dependency, source/registry/manifest identity change or live
  inventory request occurred.

Owner implementation is complete. Root must arrange independent re-review of this
optional pacing commit before updating PR20; prior runtime clearance is historical
and does not automatically approve new code. Root alone publishes. No further
runtime/test changes follow these checks, and no merge is authorized here.

## Optional pacing independent clearance

**APPROVED at exact pacing runtime hash
`028214ef4ed0fc6893c8b0ec1567aa727a8413f4`.** Independent review reported no
findings and **21 passing demo tests in 47.50 seconds**, plus separate multipart
pre-effect ordering and actual CLI restart/hash-preservation probes. Those probes
confirm pacing occurs before multipart effects and changing runtime delay preserves
the existing saved target, identity and data. Owner normal **1900 passed/1 existing
skip/43 deselected in 216.93 seconds** and focused **21 passed in 50.35 seconds**
remain separate evidence; they are not added to the independent count.

Default 0, bounded integer 0–1000 ms, recommended 250 ms, unpaced identity probe,
explicit restart, new workspace for full replay, and all existing isolation,
continuity, uncertainty and synthetic-only limits remain. This clearance update
changes only this handover; approved runtime/test bytes are unchanged, so no tests
are rerun and only whitespace is checked. All user untracked workspaces and servers
remain untouched; no workspace inspection, server stop, stack initialization,
rebase, push, PR or merge was performed. Root owns the fast-forward PR20 update
and publication metadata; merging remains outside this owner authorization.
