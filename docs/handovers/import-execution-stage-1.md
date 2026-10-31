# Stage 1 handover — safe errors and complete discovery

## Baseline, ownership and release boundary

Initial base: reviewed Stage 0 head `bdef68b4d1e1ac5eacd2213e08494216279c4a1c`,
branch `docs/import-execution-contracts`, PR #10. Subsequently normal-merged its
reviewed latest-main incorporation `bfaefd13c2cf730a4f1374131a774b07451ae91f`;
see integration evidence below. Stage 1 is isolated on
`fix/import-discovery-and-barcode-errors`, with Stage 0 as its PR target. The
parent checkout and other worktrees were left unchanged. PR #9's DigiKey errors,
atomic configuration replacement and contextual report-read failures are preserved.

This stage implements runtime read/error safety only. It adds no durable journal,
registry, executor, executable preview, automatic replay, restart or resume claim.
Independent review is pending; the owner has not pushed, opened or merged a PR.
Operational worktree paths and suggested PR metadata are in the external handoff,
not embedded in repository files.

## Actual work and investigations

1. Created the requested isolated branch/worktree from the exact reviewed head.
   Read AGENTS.md, CONVENTIONS.md, ARCHITECTURE.md, the maintained execution
   plan/design/contracts and Stage 0 handover. A lightweight memory lookup found
   no new implementation authority; current source and tests governed changes.
2. Audited model `.list` and direct `api.get` consumers in all InvenTree modules,
   stock-command setup and report finalization, including shared DigiKey callers.
   Inspected installed SDK 0.13.5 `InventreeObject.list`, `InvenTreeAPI.get`,
   `request`, `constructApiUrl`, `InventreeObject.delete` and `InvenTreeAPI.delete`.
   Confirmed one-page list behavior, JSON decode returning None, HTTPError detail
   dictionaries without Response (which can contain credentials), query-bearing
   URL slash mangling, and DELETE returning a response even for non-204 success.
3. Inspected local `tests/support.py` barcode 400 no-match / existing-item bodies,
   successful link responses and stock-delete behavior. Verified the public
   upstream source and tests without contacting an inventory server. See pinned
   evidence below; no HTTP 400 status alone establishes absence.
4. Added explicit `inventree/collections.py` helpers and routed every importer
   InvenTree model list through them, including shared category/unit/company,
   parameter/part/order/datasheet utilities. Routed direct attachment, scanner
   stock/parameter/location and post-import report stock collections through the
   same complete-read contract. Existing `discovery.py` remains unchanged.
5. Narrowed MPN-derived part resolution to its known detail PK, supplier-part
   discovery to lazily cached supplier collections, and specification matching
   parameters to candidate part IDs. Preserved category, supplier, MPN/IPN and
   model filters; all relevant pages are collected before absence decisions.
6. Added barcode error categories/PK context and read-back after every link POST,
   including success and lost-response cases. Only confirmed different ownership
   permits deleting the new duplicate. DELETE must confirm 204; unsettled cleanup
   remains uncertain. Stock import reuses the confirmed owner from the exception,
   rather than performing another lookup that could fail after cleanup.
7. Added structured attachment outcomes and retained boolean/count compatibility.
   Audited archive preflight/upload, record provenance, stock/part photographs,
   local documents, invoices, company-logo evidence and datasheets. Fixed archive
   and provenance existing-file accounting and datasheet backfill's unconditional
   uploaded report. Added CLI visibility for provenance/archive unknown outcomes.
8. Added focused transport/pagination/identity/upload fault tests, ran focused and
   full suites, fixed identified regressions, then updated architecture, plan,
   design/contracts and this tracked handover. No skills/custom agents changed.

### Pinned response evidence

Public upstream revision: `d96174cddbc2566fea53b3fe39b5d4aa5d30fbf1`.
Inspected [barcode API source](https://github.com/inventree/InvenTree/blob/d96174cddbc2566fea53b3fe39b5d4aa5d30fbf1/src/backend/InvenTree/plugin/base/barcodes/api.py),
[serializers](https://github.com/inventree/InvenTree/blob/d96174cddbc2566fea53b3fe39b5d4aa5d30fbf1/src/backend/InvenTree/plugin/base/barcodes/serializers.py)
and [upstream barcode tests](https://github.com/inventree/InvenTree/blob/d96174cddbc2566fea53b3fe39b5d4aa5d30fbf1/src/backend/InvenTree/plugin/base/barcodes/test_barcode.py).
Public GitHub metadata located the current module under `plugin/base/barcodes`,
not the guessed old `barcode` directory. Downloaded the pinned API source and
compared it byte-for-byte with the inspected source; matched. Local source blob
hashes also matched the public tree metadata. No upstream server tests were run.

`BarcodeScan.handle_barcode` raises DRF ValidationError with the exact translated
error `No match found for barcode data` when no plugin matched. Other validation
paths have different error bodies. Upstream tests include distinct blank,
invalid-location and unknown-value HTTP 400 cases. The link handler separately
rejects an existing match and returns assigned model PK on success. Existing local
stub/tests model the English error strings and status 400. SDK 0.13.5 wraps status
and serialized body in `HTTPError.args[0]`, rather than necessarily providing a
Response. The implementation extracts only status/body for classification and
keeps secret-bearing detail dictionaries out of its own error message.

This source evidence supports the specific English response contract, not every
release/plugin/locale or a deployed target capability. Localized/changed error
text, unsupported successful model shapes and malformed bodies fail closed.
There were no live inventory requests, capability probes or inventory writes.

## Decisions, rationale and alternatives

| Decision | Rationale / tradeoff / alternative |
|---|---|
| Explicit shared collection helpers, no global SDK list patch | Multiple identity/attachment/report consumers need one complete-read contract. Explicit calls make scope auditable and avoid silently changing arbitrary third-party SDK use. Shared DigiKey utilities inherit safe reads; a second legacy implementation would preserve unsafe absence decisions. |
| Complete result or exception | Neither a late-page failure nor a malformed page can be a successful empty/prefix result. Hard limits of 1,000 pages and 100,000 rows bound work; reaching either is explicit failure, not truncation. Count is validated when supplied; no count is invented for bare lists. |
| Same origin and configured API root for `next` | Reject unexpected scheme/host/credentials/root, fragments, encoded traversal/backslashes, ambiguous duplicate query keys and scheme-like relative endpoints before SDK dispatch. URLs are resolved then query fields passed separately to avoid SDK slash mangling. Conservative rejection is preferable to credential forwarding or silently broadening discovery. This does not replace the SDK transport/redirect policy. |
| Canonical repeated-page and request detection | Sorted JSON page signatures detect equivalent repeats despite dictionary key order; request keys detect loops even if data changes. Bounds remain the fallback for endlessly changing pagination. No partial return is usable after any failure. |
| Narrow relevant queries | Per-supplier lazy caches avoid listing every supplier part. Candidate model_id parameter reads avoid scanning all server parameters; known MPN part PK uses a detail read. More per-candidate requests are an accepted tradeoff for relevant bounded discovery; no concurrency or unmeasured performance claim was introduced. |
| Exact verified absence only | Only the specific supported HTTP 400 no-match body is absent. Validation, denied/auth, transient, transport and invalid-response errors retain distinct lookup categories and causes. A broad status-based rule would recreate the original duplicate-stock hazard. Localized responses deliberately fail closed until supported. |
| Always reconcile barcode owner after linking | HTTP success and a lost response alone do not establish ownership. Intended owner confirms success, another stock owner confirms conflict, and unavailable/invalid/absent read-back remains uncertain. A non-stock match cannot authorize creating another stock item. |
| Retain narrowly justified duplicate cleanup | A confirmed different owner plus the current call's newly created stock object permits removing that duplicate, preserving existing duplicate behavior. A failed/unknown DELETE does not report exists. Removing all cleanup was safer to implement but would regress the confirmed duplicate path; deleting on exceptions was unsafe. |
| Structured file outcomes with compatibility adapters | `AttachmentOutcome` separates uploaded/already_satisfied/failed/unknown with target and filename context. List failure blocks POST. Explicit client rejection is failed; lost/unsettled POST is unknown. `attach_file` True and photo/document/datasheet counts still mean new confirmed uploads. Existing filenames remain name satisfaction, not verified content identity. |
| Audit consumers instead of changing public count meanings | Archive/provenance and datasheet backfill need satisfaction semantics; stock documents/photos/invoices and company-logo callers retain their existing new-upload count/action semantics. The new structured single-file and datasheet APIs are available to later handlers. Persisting outcomes or making all legacy selected-evidence failures change exit codes belongs to later stages. |

## Plan adjustments and implementation corrections

- Expanded the complete-read helper's callsite scope to shared InvenTree utilities
  (including standalone categories/templates/units/company/datasheet and DigiKey
  part/order reads). This avoids inconsistent safety when stock code calls shared
  modules. No unrelated SDK API was globally rewritten and Stage 7 remains the
  DigiKey execution/recovery migration gate.
- Query narrowing was added explicitly rather than simply raising page limits:
  lazy supplier caches, known part detail resolution and per-candidate parameter
  reads. This directly implements the plan's relevant-query requirement.
- The new helper was briefly written under the already-existing `discovery.py`
  name. The first import check exposed the collision; the existing file was
  restored exactly and the helper moved to `collections.py` before tests continued.
  No discovery-policy replacement remains in the diff.
- The initial focused run exposed three PR #9 contextual-report regressions when
  direct stock-list reads bypassed `PlanBuilder._get`. Shared collection transport
  errors now translate to contextual `DiscoveryError`/`InvenTreeError` with cause,
  preserving the earlier error contract for part/stock reads.
- A trial generic duplicate-PK collection rejection exposed an existing test helper
  that reseeds the same company PK on repeat import. That extra strictness was
  outside the complete-read gate and was removed rather than rewriting unrelated
  fixture behavior. Positive integer model PK validation, page/request loops and
  count/bound failure remain enforced. This does not assume server uniqueness.
- SDK DELETE inspection added an explicit 204 confirmation gate after confirmed
  duplicate cleanup; a null/non-confirming response now retains uncertainty.
- Shared barcode/stock-detail reads are consumed by the scanner. Although its code
  was unchanged, the scanner/TUI suite was included because failure behavior changed.
- No later-stage storage, ownership, replay or resume work was pulled into Stage 1.

## Changed files and contracts

- `src/invimport/inventree/collections.py`: bounded complete collection and model
  helpers; `DiscoveryError` preserves incomplete discovery as failure.
- `stock.py`: barcode taxonomy and safe PK context, exact no-match contract,
  ownership reconciliation/cleanup confirmation, complete direct stock/location/
  parameter/template collections. Optional detail-enrichment behavior is retained.
- `parts.py`: complete matching/allocation/model-parameter reads, known MPN detail
  lookup, relevant candidate parameter queries and malformed parameter-identity
  rejection before absent-value creation; public matching policies retained.
- `stockimport.py`: complete category/template/manufacturer/order reads, supplier
  scoped lazy cache, confirmed duplicate owner reuse and structured provenance.
- `purchase_orders.py`: complete supplier/SKU/location/order/stock/PO-line reads,
  complete attachment lists, `AttachmentState`, `AttachmentOutcome`,
  `attach_file_outcome`, and legacy boolean adapter.
- `archive.py`, `datasheets.py`: complete listing and existing/failed/unknown
  accounting; `attach_datasheet_outcomes` plus preserved new-upload count adapter.
- `categories.py`, `companies.py`, `parameters.py`, `units.py`: complete shared model
  reads. `importplan.py`: complete stock collections, preserving PR #9 errors.
- `commands/import_stock.py`: provenance existing/unknown and archive unknown display.
- `tests/inventree/test_collection_safety.py`, `test_barcode_safety.py`,
  `test_attachment_safety.py`: new isolated fault regression coverage.
- ARCHITECTURE.md, maintained plan/design/contracts and this handover: distinguish
  implemented Stage 1 primitives from future executor guarantees and record shifts.

## Validation commands, failures and outcomes

Commands were run from the isolated Stage 1 worktree. `UV_CACHE_DIR` was assigned
a task-local temporary cache directory when invoking uv; source/test paths below
are repository-relative. The initial Git ref operation and local socket/cache
operations needed scoped sandbox escalation. No automatic review rejected an
operation; no inventory service was contacted.

- `git worktree add -b fix/import-discovery-and-barcode-errors "$STAGE1_WORKTREE" bdef68b4d1e1ac5eacd2213e08494216279c4a1c`:
  initial sandbox ref-lock denial; scoped escalation succeeded.
- Initial `uv run ruff ... --fix` attempted isolated environment dependency setup
  with a new cache; public dependency download failed DNS. `uv sync --offline`
  with authorized access to the existing cache installed the isolated environment
  successfully (30 packages, SDK 0.13.5). Subsequent commands used that environment.
- An initial fallback pytest invocation used a nonexistent `tests/inventree/test_archive.py`
  path and collected no tests. Archive regressions actually live in
  `test_stockimport.py`; subsequent focused commands used the correct files.
- First stock/stockimport/importplan/purchase-order focused run: **215 passed,
  3 failed** (the three stock-list contextual error cases described above); fixed.
- Initial new safety/report focused pass: **87 passed**. Extended evidence/report
  regressions then passed **96** cases. Initial full normal suite before later
  narrowing/edge additions passed **1479 passed, 1 skipped, 43 deselected** (38.31s).
- A subsequent `make test` after additional edge checks: **1 failed, 1487 passed,
  1 skipped, 43 deselected** (33.98s). The failure was the extra duplicate-PK guard
  against repeat fixture reseeding; corrected as documented above. Pytest's output
  also included a closed logging-stream diagnostic while showing that failure;
  it did not recur in the passing run and no logging behavior was changed.
- An intermediate Ruff invocation found one unnecessary f-string prefix in a new
  test; removed. Final changed-Python Ruff check passed.
- Pre-review focused command:

  ```sh
  uv run --no-sync pytest tests/inventree/test_collection_safety.py tests/inventree/test_barcode_safety.py tests/inventree/test_attachment_safety.py tests/inventree/test_importplan.py tests/inventree/test_parts.py tests/inventree/test_stock.py tests/inventree/test_stockimport.py tests/inventree/test_purchase_orders.py tests/inventree/test_datasheets.py
  ```

  **401 passed in 9.88s**. An immediately preceding focused run before the final
  invalid-JSON category case passed **400 in 10.33s**.
- Pre-review `make test`: **1494 passed, 1 skipped, 43 deselected in 34.89s**.
  Normal selection excludes scanner/TUI tests; the existing skip is unchanged.
- `make test-scanner`: **43 passed, 1495 deselected in 42.50s**. It installed
  14 optional scanner packages into the isolated environment, including a public
  pyobjc-core download. This package installation is not an inventory/network
  integration test.
- `uv run --no-sync ruff check src/invimport/commands/import_stock.py src/invimport/inventree tests/inventree/test_collection_safety.py tests/inventree/test_barcode_safety.py tests/inventree/test_attachment_safety.py`:
  passed. This includes all changed Python files and the existing InvenTree modules.
- `git diff --check`: passed before final handover; repeated before commit.
- `rg` audit found no remaining model `.list(api, ...)` or direct attachment-list
  `api.get` in the importer InvenTree modules. Remaining direct GETs are detail
  reads or the shared helper. Skills/agents unchanged, so workflow-sync was not
  separately required; its ordinary cases run in the normal suite.

## Independent review and fixes

Fresh independent review is in progress; approval remains pending for the updated
head and latest-main integration. Passing owner tests do not count as clearance.

The reviewer found a P1 malformed mixed-owner bypass: the permissive UI parser
could select a valid part/location around an invalid stockitem value, while
`find_by_barcode` checked only key presence and `already_imported` returned the
raw value. Examples with stockitem empty/None/string plus a valid part could
therefore return absence or a non-PK value. Fixed the strict `_scan` boundary to
require exactly one recognized owner model and validate its raw positive integer
PK. Multiple valid model owners are also rejected as ambiguous. The standalone
UI `barcode_hit` parser retains its characterized priority behavior; it no longer
establishes identity for absence/registration decisions.

Added 14 regression cases for mixed malformed stock owners, multiple valid model
owners and uncertain mixed link read-back that cannot delete stock. Follow-up
owner audit also rejects contradictory owner/plugin evidence in an otherwise
matching no-match HTTP 400 body (two additional regressions): exact text must not
bypass conflicting evidence. Owner check:
`uv run --no-sync pytest tests/inventree/test_barcode_safety.py tests/inventree/test_stock.py`
initially passed **80 tests in 0.68s**; with the contradictory-body regressions,
**82 passed in 0.77s**. Changed-file Ruff and whitespace passed. Further
review findings and final recheck evidence will be added before PR opening.

### Latest conventions integration and audit

The user added a requirement to pull latest main CONVENTIONS.md into every stacked
PR. Read the full `origin/main:CONVENTIONS.md` at `c22b7a1`, including its new
function/orchestration, explicit-helper-input, meaningful-state-lifetime,
purposeful-module, lower-level-dependency and scenario-local-test guidance.
Stage 0 incorporated main by normal merge and was independently rechecked. Stage 1
committed the owner-validation review correction as `f3b25cc`, then normally merged
reviewed Stage 0 head `bfaefd13c2cf730a4f1374131a774b07451ae91f` with
`git merge --no-ff ...`, producing merge `a60c83e`. No rebase or force push occurred.

Two documentation conflicts required resolution: ARCHITECTURE.md's baseline header
now retains implemented Stage 1 behavior together with the reviewed Stage 0/main
baseline and PR #11 conventions; the plan table retains Stage 0's upstream-approved
status and Stage 1's implemented/pending-review status. Contracts/design and Stage
0 review history merged cleanly. Source/test runtime changes did not conflict.
`git diff origin/main -- CONVENTIONS.md` is empty, and `git merge-base --is-ancestor`
confirms both reviewed Stage 0 and main `c22b7a1` are ancestors. An initial comparison
to the deliberately untouched parent checkout showed its older conventions differ;
the authoritative origin/main comparison passes. No parent files were changed.

Audited the new Stage 1 code against that full guidance: collection paging,
next-target validation, barcode classification/reconciliation and one-file upload
remain focused operations with explicit client/target/file inputs and useful typed
results. The upload's small local outcome closure shares only its target/file
context. Immutable attachment outcome state has a clear per-attempt lifetime;
no namespace-only coordinator or new cross-run mutable singleton was introduced.
The shared collection module is justified by actual model/direct-list consumers;
no lower-level code imports command modules. New scenario fixtures stay in their
behavior-specific test files. Kept the strict barcode ownership boundary separate
from permissive UI parsing and added the constructor return annotation. No
unrelated file-size refactor or new execution package was needed for this stage.

Final validation on integrated code (`a60c83e`, including the P1 correction):

- `UV_NO_SYNC=1 make test`: **1510 passed, 1 skipped, 43 deselected in 35.53s**.
- `UV_NO_SYNC=1 make test-scanner`: **43 passed, 1511 deselected in 43.05s**.
- These independent pytest processes ran concurrently with environment sync disabled
  to avoid either process changing the shared isolated virtual environment. Each
  uses its own scenario-local temporary data and local HTTP stub sockets.
- The full changed-Python Ruff command listed above passed again, as did working
  whitespace and the integrated-base-to-head whitespace/ancestry/conventions checks.
- The handover-only final evidence update introduces no further runtime changes;
  independent reviewer recheck of the final head remains required before PR opening.

## Limits and next-stage integration

- A known stock PK is retained only in the raised in-memory error. A lost stock
  create response still has no durable correlation. Do not retry an entire failed
  import as if every create definitely failed; no registry currently guards it.
- English exact no-match text is the supported absence taxonomy. Changed/localized
  or plugin-specific responses require explicit evidence/support and currently
  block, even if they may mean absence to a human.
- Pagination validates application `next` links; it does not establish target
  identity across restore/replacement, snapshot isolation, general redirects or
  atomic server uniqueness. Collection/count consistency can fail closed under
  concurrent server changes. Bare list endpoints assert their own completeness.
- Legacy attachment name/comment satisfaction is not verified byte identity.
  Upload uncertainty is exposed, not automatically retried. Archive/provenance
  bytes are still built/rewritten by legacy finalization; immutable artifact and
  durable per-target delivery remain Stage 5 work.
- Lines still interleave discovery/mutations; arbitrary exceptions can abort later
  lines and ordinary finalization. Existing selected-metadata exit semantics and
  creation/parameter response durability limitations remain. No default rollout,
  resume, historical repair, cross-process ownership or exactly-once claim.
- Stage 2 should observe these explicit helpers and every underlying SDK request,
  including link reconciliation, pagination and DELETE, while retaining worker
  correlation. Preserve PR #9 error causes/context and quiet library behavior.
- Later planning/execution must consume structured attachment/barcode context,
  strengthen artifact identity and persist usable outputs before dependent effects.
  Do not turn failed discovery into a retry permission or treat a legacy filename
  match as executor-grade verified evidence.
