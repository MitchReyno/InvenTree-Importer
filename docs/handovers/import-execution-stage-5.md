# Stage 5 handover — full stock domains and immutable finalization

## Base, ownership and release status

Exact base: reviewed/published Stage 4
`a916d6775814a61bcd3fd5b627ad3aabe5d624aa`, branch
`feat/import-durable-stock-recovery`, PR #15. This candidate uses the isolated
`feat/import-stock-finalization` branch. Latest-main conventions
`c22b7a15aca7d338733aaf820bbd19e4fadac414` are an ancestor, verified with
`git merge-base --is-ancestor`; CONVENTIONS.md is unchanged from that inherited
version. Parent checkout and other worktrees were not edited. No further agents,
publication, PR creation, merging, live inventory calls or capability probes were
performed. Root owns fresh independent review and publication. This handover is
an implementation-owner record, not independent clearance.

The ordinary CLI/default and legacy public entry points remain unchanged. Stage 5
provides an explicit full-library candidate, not a claim that every legacy
interactive/configuration side effect has passed release parity. The concrete
restrictions and Stage 6 contracts below must accompany review.

## Work performed

1. Read actual AGENTS.md, current CONVENTIONS.md, architecture, maintained execution
   design/plan/contracts, prior stage handovers, Stage 4 review and external stack
   status/proposals. Current maintained contracts governed implementation where
   stage boundaries had moved. The quick memory search supplied no new authority.
2. Created a separate worktree from the exact reviewed base. The initial Git ref
   creation hit filesystem restrictions; scoped permission created the authorized
   branch/worktree. Offline dependency setup used the existing cache and installed
   44 cached packages, including the pinned SDK and scanner extra, in this worktree.
   No dependency or lockfile changes were introduced.
3. Extended the shared stock planner rather than wrapping the legacy importer as
   an opaque task. `prepare_full_stock` supplies options to the same planner used
   by bounded `prepare_stock`, then adds explicit finalization. Execution uses the
   same domain handlers and guarded API boundary. Legacy parameter ownership and
   manufacturer-number choices now share pure `inventree.part_policy` helpers.
   Existing name/value normalization, type answers, candidate scoring, IPNs,
   stock note rendering and marketplace splitting are reused directly.
4. Added read-only manufacturer-scoped MPN/name/partial-spec/company decisions,
   frozen confidence/partial-skip rows, symbolic category/template/location creates,
   manufacturer relationships, SKU links and individual model-owned parameters.
   Configured taxonomy and explicitly requested locations have visible creates;
   missing/disabled location resolution cannot become unlocated stock. Creation
   flags suppress their unselected company/order scope while permitting stock.
5. Added notes/links-on-empty, protected primary images, part/stock documents,
   datasheet/full-PDF/extract, invoice and company-logo operations. Source bytes
   freeze during preview. Local staging/hash checks and PDF extraction have their
   own attempts. Logos require the originating run's persisted company-create
   effect, including when the line later fails and when repair happens later.
6. Added typed owned `OperationSpec.settled_after` dependencies in plan schema 2.
   Missing references, mutable caller inputs and cycles are validated together
   with named-output prerequisites. Schema-1 loading/dumping/revision stays stable
   and rejects the new field; SQLite schema remains 1. Operation IDs retain their
   original v1 construction. The scheduler settles failed/uncertain/reviewed and
   blocked chains for finalization without inventing usable outputs.
7. Persisted confirmed response fields separately from approved intent. A valid
   raw create checkpoints its PK/effect/attribution before subsequent work; a
   separate receipt records fields actually present and equal in that validated
   response. Patch receipts likewise use observed response fields. Malformed
   creates retain trustworthy PK effects without claiming requested facts were
   written. Unknown attempts remain separately attributed. A later line failure
   does not remove confirmed Part/relationship/parameter changes.
8. Implemented visible finalization ordering: settled inventory/enrichment,
   effect-derived provenance, immutable source ZIP, approved target uploads,
   external outcome report. Source manifest/content and logical target scope
   freeze in the preview. Canonical and marked custom run roots, journals and
   sidecars, generated plans/reports, old provenance, ZIPs and report-image roots
   are excluded. Generated JSON plans are also excluded by content. Relative
   asset paths and symlinks cannot escape the source directory. Source mutation
   during reads, or inconsistent requested versus archived bytes, is rejected.
9. Added immutable artifact receipts with relative filename, SHA-256, size and
   precise effect-set fingerprint. Uploads verify retained bytes and remote
   content; same filename alone is insufficient. Missing targets are skipped
   separately from failed transfers. Retained bytes survive source deletion and
   no-new-inventory repair. No-change runs do not mint arbitrary source archives.
10. Added audited `start_finalization_revision` for genuinely changed effect sets
    after explicit inventory repair. It keeps original operation IDs, results,
    outputs/effects, source/target scope, historical bytes and transfer receipts.
    New immutable revisions have separate filenames/hashes. Per-content upload
    history keeps confirmed or uncertain old transfers verification-only; a new
    artifact revision cannot replay old bytes or rewrite an uploaded archive.
11. Added `invimport-execution-report/1`, prepared/transfer history projections,
    and `project_stock_result` for existing `StockImportResult` / `build_plan`
    consumers, including archive/logo/provenance outcomes. A local provenance
    path is supplied only with an explicit run directory and actual file presence.
    Existing legacy provenance files and format are untouched; durable provenance
    has the separate `invimport-execution-provenance/1` identifier.
12. Rewrote ARCHITECTURE.md as a current guide, explicitly distinguishing legacy,
    bounded durable and full-library behavior. Updated maintained design/plan/
    contracts. README and AGENTS architecture/workflow references already existed
    and remain valid. Grouped new tests into full-domain and immutable-finalization
    scenarios rather than growing an undifferentiated test file.

## Decisions and plan adjustments

| Decision | Rationale and alternative |
|---|---|
| Extend the shared planner/handlers | Preserves established transport/recovery semantics and avoids a second opaque importer. Separate modules own choices, enrichment, taxonomy, bytes, finalization and result projection. |
| Scope MPN by the frozen manufacturer before Part selection | Different makers can use the same number. Global first-match selection or requiring IPN despite a known maker would be incorrect. Explicit IPN still has priority. |
| Typed settled barriers, plan schema 2 | Named usable outputs and settlement have different meanings. An untyped payload convention was drafted, then replaced following root feedback. Schema-1 byte compatibility avoids migrating historical journal revisions. |
| Preserve actual response fields, not whole desired inputs | Part intent includes later parameter/relationship work. Serializing that intent as confirmed fields would overclaim after a partial failure. Validated field receipts distinguish actual observations from source claims. |
| Separate durable provenance format | Existing legacy provenance compilation depends on a coarse in-memory ledger. Reusing its identifier for differently scoped effect evidence would be misleading. Existing files/history remain intact; the legacy result adapter bridges consumers. |
| Immutable effect-set revisions inside approved operations | Repair may add real inventory effects after an earlier partial snapshot. Rewriting the earlier archive loses history, while never finalizing repaired effects omits evidence. New receipts/bytes remain within approved source/target scope, with content-specific transfer history. |
| Reconcile old artifact transfers before newer versions | An uncertain or confirmed earlier transfer cannot be cleared merely by changing the current effect-set fingerprint. All retained versions retain verification-only protections. |
| Keep one distinct new PO allocation | Repeated OPTIONS calls are not reservations. No live allocation contract was verified; arithmetic on arbitrary reference strings would weaken the reviewed Stage 4 fix. |
| Explicit category configuration, no inferred YAML write | The reusable API accepts mappings/CategoryConfig, not a durable configuration-file destination. Implicitly choosing a local config path would hide an additional filesystem effect. Stage 6 needs a frozen destination/content precondition if it promises this legacy interactive side effect. |
| Keep CLI default unchanged | Full-library fixtures and faults are implementation evidence, not complete CLI/interactive release parity. Stage 6 still owns approval, presentation, exit codes and default rollout. |

Root's development feedback also prompted the current-architecture rewrite,
manufacturer-scoped matching regression, precise confirmed-field receipts and
privileged finalization-transition audit. These are implementation corrections,
not an independent review or clearance. No generic mutation retry was weakened.

## Files and contracts

- Shared boundaries: `execution/models.py`, `executor.py`, `store.py`,
  `artifacts.py`, `stock_preparation.py`, `stock_handlers.py`, `stock_evidence.py`,
  `stock_workflow.py`; existing SDK guards remain composed through `stock_api.py`.
- Focused additions: `stock_choices.py`, `stock_enrichment.py`, `stock_taxonomy.py`,
  `stock_assets.py`, `stock_metadata.py`, `stock_finalization.py`, `stock_result.py`.
- Shared pure policy: `inventree/part_policy.py`, consumed by `inventree/parts.py`
  and durable preparation; legacy callable interfaces remain unchanged.
- Tests: persistent fake media support in `tests/execution/stock_server.py`;
  full-domain/checkpoint/SDK coverage in `test_full_stock.py`; immutable artifact,
  source and field-attribution coverage in `test_stock_finalization.py`;
  foundation unknown-schema test now treats version 2 as supported and 3 as unknown.

## Validation and observed failures

Commands below ran in this isolated worktree, with no live API calls.

- `uv sync --offline --extra scanner` with scoped existing-cache access succeeded.
- Intermediate focused execution suite: 153 passed before new full fixtures.
  First full fixture milestone: 6 passed, later 18, 24 and 28 as faults expanded.
- The schema-1 unknown-version regression initially expected version 2 to fail;
  updated its unknown case to 3 after introducing tested version-2 support.
- Early fixture failures found and fixed: archive/provenance upload IDs omitted
  role and collided; a shared Part omitted its symbolic category dependency on
  subsequent lines; fake image handling wrote a call log inside a separate open
  SQLite write transaction and locked; an MPN revalidation path consumed a maker
  output for a spec identity that did not require it. The final MPN-only identity
  check and fixtures cover the corrected dependencies and matching scope.
- A field-receipt draft passed `kind` twice to `_event`; the focused fixture failed
  immediately. Renamed the payload field to `effect_kind`, then reran the suite.
- The first broad sandbox run accumulated local fixture setup errors and was
  interrupted (exit 130). A first-error command
  `.venv/bin/pytest tests/inventree/test_stockimport.py -q -x -o addopts=''`
  confirmed `PermissionError: [Errno 1] Operation not permitted` at the
  `InvenTreeStub` bind to `127.0.0.1`. Scoped loopback permission resolved it.
  This environmental failure is not counted as runtime success.
- First permitted normal `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE5_UV_CACHE" make test`:
  **1705 passed, 1 existing skip, 43 deselected in 90.51s**.
- Intermediate focused foundation/domain/actual-SDK command:
  `.venv/bin/pytest tests/execution tests/inventree/test_request_observation.py -q -x -o addopts=''`:
  **194 passed in 50.44s**.
- Scanner `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE5_UV_CACHE" make test-scanner` with
  loopback permission: **43 passed, 1706 deselected in 45.04s**. No hardware was
  contacted. This precedes final stock-only field receipts/source/projection
  refinements; no scanner/UI or shared transport implementation changed afterward.
- Final focused foundation/domain/actual-SDK command above:
  **196 passed in 53.36s**.
- Final permitted normal command above:
  **1707 passed, 1 existing skip, 43 deselected in 88.66s**.
- Changed Python Ruff and whitespace checks passed. Imports/docstrings were
  subsequently cleaned without changing runtime policy. Tests were grouped by
  behavior; the post-grouping focused result is recorded below before commit.
- The first test-grouping script used the system Python AST, which lacked
  `end_lineno`; it stopped before changing files. Re-running it through the
  project's `.venv/bin/python` succeeded. A pytest invocation before the new file
  existed exited 4/no tests; it is not counted as a check pass. Ruff removed only
  now-unused test imports after grouping.

New tests exercise real SQLite journals plus a persistent fake remote: v1/v2 and
spec/MPN/type compatibility inherited from Stage 4; scoped same-MPN different makers;
model-owned values, notes/manual names, flags and frozen callbacks; taxonomy and
explicit locations; PNG/image/logo eligibility and PDF transforms; partial failures
and settled blocked chains; actual pinned-SDK multipart/media sends with exactly
one preexisting durable intent per observed request; source deletion/mutation/
containment; nested custom and canonical state exclusions; missing/modified retained
bytes; no-op archive suppression; content-specific confirmed-upload no-replay;
precise failed-line attribution; immutable artifact revisions after repair; and
local disk failure stopping later mutations. Subprocesses stop after committed
manufacturer-part/location checkpoints or repair retained archive uploads against
the same fake SQLite remote; known records and inventory are not recreated.

## Limits and next-stage contracts

- No live uniqueness, immutable target identity, atomic tag update, allocation or
  media behavior was inferred from fakes. No exactly-once remote effect guarantee.
- More than one distinct new PO allocation still rejects before execution.
  Historical stock cannot infer a new PO contribution from payload similarity.
- Existing nonempty/manual parameters, PO metadata, links, names and images retain
  their protective policies. Explicit missing locations review rather than silently
  adopting the legacy unlocated-stock behavior.
- Category choices can supply configured/explicit CategoryConfig; implicit local
  YAML persistence has no destination contract here. Ambiguous unsafe choices
  require explicit preview decisions rather than a legacy fallback. This is an
  actual remaining interactive/configuration parity boundary, not hidden support.
- Sources/assets are retained as immutable bytes in the approved JSON plan; large
  inputs therefore increase memory/journal size. No new external object store,
  automatic cleanup or distributed execution is introduced.
- Source basename collisions with differing requested/archive content conservatively
  reject preparation. A future refinement can retain full source-relative identity
  rather than relaxing the consistency check.
- Source evidence and upload state are separate. A confirmed transfer whose bytes
  cannot be verified stays incomplete and verification-only, even with an empty
  listing. Missing retained artifacts need review; no silent replacement contract.
- New schema-2 plans are intentionally unreadable by older binaries. Historical
  schema-1 plans/revisions remain readable; state ownership still prevents unsafe
  supported legacy fallback. Operators must not downgrade around unresolved runs.
- Stage 6 must wire CLI write approval and explicit `ImportOptions` scope, plain/JSON
  status, selected repair, cancellation and exit policy, retain `--plan` meanings,
  provide retention/export/corruption guidance, and run interactive/flag parity
  gates before making this engine default. Reports expose prepared revisions and
  transfer histories; they must not flatten uncertain uploads into successful
  line counts. DigiKey/concurrency remain Stage 7.

### Final compatibility correction and post-grouping verification

The last payload audit compared durable stock fields with legacy `add_stock`.
An intermediate draft invented `quantity_is_estimated`; this was removed before
review. Approximate quantity uses the shared `notes.stock_notes` policy, including
its explicit approximate-count text, without assuming a target serializer field.
The regression asserts the exact planned and actually sent supported create-field
sets and quantity, in addition to checking the shared note output. It passes
**1 test, 17 deselected in 0.81s**. This is an API-payload contract check against the
existing client policy, not an assertion inferred from permissive fake acceptance.

Post-grouping full-domain/finalization selection passed **30 tests in 20.24s**.
The correction adds one further regression. Final focused foundation/domain/SDK
selection passed **197 tests in 53.99s**. The final normal rerun is recorded below
before committing. Scanner results above remain applicable evidence; no scanner/UI
or shared transport implementation changed after that run.

Final permitted normal command after the approximate-payload correction:
**1708 passed, 1 existing skip, 43 deselected in 89.70s**. Final changed-Python
Ruff and whitespace checks passed. No runtime changes followed these checks;
remaining edits record validation, handoff and review status only.

The complete staged whitespace check found one extra EOF blank line in the split
finalization test file. Removed it, restaged and rechecked successfully; this
whitespace-only correction does not require repeating runtime tests.

## Independent review — initial rejection and eight corrections

Initial exact candidate `b01b46f8d8741fdc9a0c92974311bfc7612ea3b3` was **not
approved**. The independent reviewer completed a material pass, reproduced eight
findings, and requested exact committed recheck after correction. The initial
implementation/check record above is retained as history, not clearance. The
following corrections supersede its affected source/routing/location/provenance/
retention descriptions. Root owns publication after fresh exact-head clearance.

| Finding | Reproduction and correction |
|---|---|
| P1: escaped slash placed stock in an unapproved hierarchy | `Bag/JM38510\/10103BPC` was split into three names. Full resolution now uses shared `location_names` with actual name/parent identities, supporting existing/new names, whitespace and ambiguous raw pathstrings. Known parent outputs remain validated before create/consumption. |
| P1: generic source names/extensions silently omitted evidence | Real evidence under `downloads`/`artifacts`, vendor ZIPs, ordinary `execution-report.json` and `component-journal` disappeared. Full manifests now identify canonical/marked execution roots and positively recognized generated content. Generic names/extensions and generic JSON plan-like keys are preserved. Actual generated-plan image references and marked generated ZIPs are excluded. The existing hidden-file policy remains. |
| P1: accepted transfer overclaimed unverified remote SHA/filename | A 201 upload with different remote bytes correctly failed verification but provenance certified desired SHA. Accepted transfer attribution now retains explicit `sent_content`; only persisted remote verification receipts populate confirmed remote fields. Images also record verified SHA without inventing a filename. |
| P2: mixed PO/no-PO lines lost standalone supplier archive targets | Global order preference suppressed the second line's supplier. Routing now freezes each line's order-preferred/supplier alternatives and source attribution, deduplicates target reports, and records inapplicable lines. Missing preferred checkpoint output can use the approved supplier; any known target drift reviews immediately. The first validated recipient is journal-locked across repair/revisions. Applicable-but-unusable targets review; disabled/inapplicable scope is distinct. |
| P2: explicit partial-new choice could not execute against its offered candidates | `on_partial=new` and callback `new` accepted preview but treated unchanged declined candidates as drift. Preview now freezes the relevant candidate identities; execute compares that set and honors the approved choice while reviewing genuinely changed discovery. Unknown creates remain nonreplayable. |
| P2: omitted location was rejected in full mode | Full mode now omits the API location field when neither source nor default requests one. Bounded subset restrictions and explicit unresolved-location review remain. Effective defaults freeze in `line_inputs` for legacy projection. |
| P2: finalization bypassed frozen PO metadata/role validation | A manual PO currency/description edit before provenance allowed uploads. `_validated_input` now owns the shared identity/approved-metadata policy for domain and finalization consumers. Every transfer/read-bound repair revalidates it; drift neither overwrites manual values nor falls back to another target. |
| P2: completed resume/projection presented corrupt local evidence as usable | Replacing a retained provenance file still returned it as valid. Completed status/resume separately reports receipt-verified local retention. Projection checks size/SHA before returning a path and reports missing/corrupt state for archives too. Historical inventory and verified remote outcomes remain successful; no API sends, replay, replacement or reopen occur merely because local bytes changed. |

### Review-fix engineering choices and scope

- Archive fallback alternatives and conditions are frozen before approval, not
  inferred after writes. A preferred operation with a saved output that now drifts
  is a conflict, even if a supplier is available. Target selection commits before
  transfer and remains fixed across later effect-set revisions. Existing unknown/
  confirmed per-content transfer guards were preserved unchanged.
- Canonical/marked root exclusion is separate from the legacy conservative helper
  that also rejects reserved filenames. Full manifests use the ownership-only
  helper. Generated ZIPs have an explicit format comment; generated JSON requires
  actual owned format contracts or a valid executable-plan schema, not a handful
  of generic keys. Report image ownership comes from generated-plan references,
  not a blanket folder ban. Archive metadata uses a reserved hidden namespace,
  so generic legitimate source basenames are not overwritten by packaged metadata.
- Accepted transfer, source/sent bytes and remotely verified content are three
  different facts. The effect-kind audit retained validated create/patch fields
  and read-back-confirmed barcode ownership, while removing desired upload fields
  from confirmed facts. A successful transfer can still be an incomplete operation.
- Local retention is a read-only projection, not a transition that invalidates
  inventory/remote history. Generic foundation snapshots without retained artifacts
  preserve their prior shape; artifact-bearing status adds explicit retention.
- A first focused rerun exposed the intentional generic snapshot compatibility
  assertion after adding unconditional retention. Restricted the additive status
  field to artifact-bearing snapshots, preserving the foundation contract. An
  older fixture also expected generic empty JSON files to be excluded by name;
  replaced that expectation with positively marked generated report/provenance
  fixtures while adding genuine same-name evidence coverage.

### Review-fix evidence before final committed recheck

- Original independent source/routing/partial/location reproduction now retains
  all named source files, sends ZIP to both relevant recipients, executes the
  approved partial-new Part and supports omitted locations.
- Independent PO finalization reproduction now sends **zero** PO attachments
  after manual currency/description drift and reports incomplete selected work.
- Independent upload-provenance reproduction preserves accepted-transfer certainty
  while `confirmed_fields` remains empty for mismatching remote bytes.
- First new review selection: **17 passed in 13.06s**; extended review/finalization
  selection: **37 passed in 25.34s**. The first combined foundation/domain/SDK
  rerun passed **218 tests in 66.64s** before the final three source/location
  boundary cases were added.
- The reviewer independently tested unknown old transfer plus changed effect-set
  revision and found no replay; their actual observed SDK full scenario matched
  **141 sends to 141 durable intents**. Those are reviewer results on the initial
  candidate's unaffected boundaries, not owner claims of corrected-head clearance.

Final required checks and exact committed recheck disposition follow below.

### Corrected-candidate final owner validation

- Review regression coverage now comprises **24 cases**: all eight findings plus
  callback/policy partial-new decisions, changed-candidate detection, effective
  defaults, escaped ambiguous/whitespace paths, source-name/JSON preservation,
  locked supplier fallback after later PO repair, truthful inapplicability,
  image verification receipts and completed missing/corrupt retention without
  remote sends. Existing unknown-transfer/revision guards remain exercised.
- Final focused command:
  `.venv/bin/pytest tests/execution tests/inventree/test_request_observation.py -q -x -o addopts=''`:
  **221 passed in 72.19s**.
- Final required normal command with scoped loopback permission:
  `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE5_UV_CACHE" make test`:
  **1732 passed, 1 existing skip, 43 deselected in 107.29s**.
- Changed Python Ruff and complete whitespace checks passed. Scanner/TUI results
  remain the earlier **43 passed** evidence. These review fixes change stock
  planning, evidence/reporting and read-only local retention; they do not change
  scanner/UI behavior, shared location parser or shared request transport, so no
  additional scanner rerun was justified.
- The corrected exact committed candidate still needs independent recheck of all
  eight findings. Passing owner tests does not supersede the initial rejection.
  No runtime changes followed these final checks; remaining edits record results
  and commit/handoff status only.
