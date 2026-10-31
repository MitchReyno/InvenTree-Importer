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
