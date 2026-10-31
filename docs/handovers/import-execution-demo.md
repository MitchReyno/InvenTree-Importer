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
