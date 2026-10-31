# Stage 4 handover — durable stock reference slice

## Baseline, scope and release boundary

Base: exact reviewed Stage 3 `4aed93c67bc61ece4b5e7291f93e9d4d323c2658`,
branch `feat/import-execution-foundation` (PR #14). Owner branch:
`feat/import-durable-stock-recovery`. Work uses its own isolated worktree;
parent/other-stage checkouts were not edited. Root owns independent review,
publication and PR creation. No push, PR, merge, live API capability probe or
inventory write was performed by this owner. Every remote boundary in validation
is a local persistent fake or fake HTTP transport.

The Stage 4 opt-in library implements a real, bounded StockFile workflow. It does
not enable a new CLI, replace legacy `import_stock`, claim whole-import recovery,
or claim exactly-once remote effects. Full enrichment/provenance/archive migration
is Stage 5; release/default/CLI work is Stage 6. Independent review is pending.

Read AGENTS.md, current CONVENTIONS.md, ARCHITECTURE.md, maintained execution
contracts/plan/design, Stage 3 comprehensive handover and independent review
findings/rechecks, plus relevant Stage 1/2 handover evidence. A lightweight memory
search found no task-specific implementation authority. Current source governed
all decisions. Inspected actual models/preparation/store/ownership/dispatch/
executor/observation/transport APIs and legacy matching, values, stock/barcode,
parameter, supplier, order and attachment boundaries before implementing.

## Actual implementation work

1. Created the isolated branch from the exact reviewed base. Initial git ref lock
   creation was sandbox-blocked; a scoped authorized escalation created it.
2. Added read-only `prepare_stock` integration for validated v1/v2 input expansion.
   It resolves complete spec/type Parts, existing taxonomy/templates/locations,
   suppliers, existing SKU assignments, shared orders and barcode ownership.
   It freezes chosen identities, normalized desired values, PO allocation,
   parameter policies, sources and stable logical operation IDs into an executable
   preview. Unsupported scope raises `PreparationReview` before any mutation.
3. Added distinct create/reuse Part, each parameter, supplier/SKU/order, each
   stock lot, barcode, tags, each PO contribution and stock-to-PO link operations.
   Shared effects aggregate source lines; lot/contribution identity retains each
   original line even when all payload values are identical. No legacy whole-line
   or whole-parameter-batch helper is registered as a durable task.
4. Added strict raw JSON create handling. A dict or singleton dict list must
   contain one positive nonboolean PK and expected identity. Empty, invalid,
   multiple or contradictory successful responses remain uncertain and retain
   every trustworthy returned model/PK as effects. No first-element selection,
   model constructor or automatic reload runs before checkpoint.
5. Added immediate in-attempt `RunStore.checkpoint`, atomically persisting PK,
   model, identity, confirmed effects and source attribution before dependent
   requests. An interruption keeps the attempt unresolved and preserves those
   outputs/effects during recovery/settlement. Parameters have independent commits.
6. Added explicit selected `repair_stock`: a new audited domain attempt under
   the same operation ID. It records prior result/policy, reads current identity
   and field preconditions, and records conditional-write evidence before guarded
   metadata mutations. It never resets an uncertain operation to READY or erases
   results to force original mutation replay. Generic read-only retry is unchanged.
7. Added a guarded API adapter. The marked project observed SDK relies on its
   mandatory actual-send guard; custom test/library boundaries use one dispatch
   per method. Actual client `api_url` must agree with current/planned endpoint.
   Existing target continuity evidence/review remains required before saved PK use.
8. Added explicit frozen byte evidence with one logical target, retained pending
   bytes, SHA-256 download verification and separate uploaded/verified/rejected/
   unknown results/events. No filename-only success. Added local partial reports
   containing every selected line, usable outputs, failures and named unmet
   prerequisites; journal failure triggers best-effort reporting without new sends.
9. Updated architecture, maintained contracts/design/plan and this handover.
   No skills/agents changed. Existing legacy CLI/library/`--plan` behavior remains
   on its old path, protected by the same canonical unresolved-import claim.

## Decisions, rationale and alternatives

| Decision | Engineering rationale, alternatives and limits |
|---|---|
| Separate bounded stock library | A meaningful v1/v2 slice can prove domain recovery without silently enabling unsupported enrichment. Registering legacy `_import_line`/`resolve_part` as one task would retain the original unsafe replay boundary. |
| Reuse low-level domain policies | `from_supplier`, `part_name`, `ipn_prefix`, `answers_to`, `values_match`, category aliases, supplier normalization/marketplace parsing and strict barcode classification remain the shared policy. One complete matching helper serves preparation and pre-create revalidation, including quantity equivalence. |
| Complete spec/type identity first | Incomplete/missing-key candidates never identify an existing spec Part. Type/name/keywords and explicit IPN can establish a Part independently of parameter completion. Manufacturer/MPN handling is rejected in this subset rather than inventing a second ambiguous resolver. |
| Missing parameter additions are explicit preview work | In this new mode, established Part identity plus approved per-parameter scope permits missing additions to matched Parts. This is an intentional narrow policy shift from legacy no-update matching, not permission to overwrite nonempty/manual values or broaden a global update flag. Legacy behavior is unchanged. |
| Validate raw JSON; avoid SDK model construction | The existing generic adapter takes the first returned list element and model construction/reloads can fail after a successful POST. The new path validates cardinality/identity and checkpoints raw trustworthy outputs first. Avoiding construction removes that failure window instead of trying to make an unsafe constructor transaction atomic. |
| Same-operation explicit domain repair | The generic original-mutation guard stays conservative. A domain attempt retains IDs/attribution/history, establishes current record/precondition evidence, then conditionally patches only approved fields. Clearing uncertainty or minting replacement operation IDs would hide the original effect. |
| Known rejected/no-send effects differ from lost responses | Explicit supported create 4xx rejection, or a settled pre-send failure, carries no confirmed mutation and may proceed only after current absence/preconditions. An applied/lost response without trustworthy PK is uncertain, including a conservative fake failure before server application when the client cannot prove that fact. |
| Unknown creates never match lots/contributions by payload | Identical lots and PO lines are legitimate distinct records. Saved trustworthy PK plus current model/identity is usable; no returned ID/correlation remains uncertain. No invented server metadata, uniqueness capability or automatic DELETE closes the remote/local gap. |
| Parameter readback can satisfy a lost response | Complete reads at intended model/template/value can confirm an observed parameter. More than one candidate or a differing/manual value requires review; absence after unknown creation never authorizes another create. |
| Stock ownership and field repair are separate | Part/stock PKs commit before parameters/barcode/tags/PO-link. Tag repair is limited to owned new stock and unions observed unrelated tags. Links may be absent/already intended; conflicting/manual links need review. No historical quantity/batch/location/part is restored and deleted/consumed stock is never recreated. |
| Require an existing explicit location | The reference subset has no approved location-creation workflow. Missing and unresolved locations require review before writes. This is a documented new-mode boundary; legacy unlocated-stock behavior is unchanged. |
| Shared supplier/SKU/PO decisions freeze | Existing identities and PO metadata/currency are discovered before execution, shared contradictory inputs reject, and allocated PO reference freezes. Execution detects drift. Historical stock cannot infer new PO contributions without original run ownership. |
| Freeze evidence bytes/target in the plan | Plan persistence retains pending bytes even without new inventory writes. Local staged bytes aid inspection. Filename-only matching cannot establish identity; remote byte verification is required or the outcome remains review/uncertain. Full archives and source/provenance migration remain Stage 5. |
| Distinguish registration from completion | Only confirmed barcode ownership registers stock. Metadata/evidence failure makes requested work incomplete while independent lines continue. Named output dependencies avoid gating `part_of` on a source line's entire stock/image result. |
| Conservative current target continuity | Actual client endpoint agreement supplements, rather than replaces, the foundation's current target/instance comparison and revision-bound continuity review. SDK server details or PK existence alone are not immutable target proof. |
| Small responsibility-based modules | Preparation/matching, guarded external API, domain handlers, evidence bytes and workflow/reporting have separate reasons to change. Classes own preview caches or API lifetime; no generalized workflow framework or catch-all utility module was added. |

## Plan adjustments and compatibility limits

- Stage 3 deferred resolved stock mutation preview planning. Stage 4 supplies it
  in `prepare_stock` while leaving generic `prepare_import` honestly unsupported.
- The supported subset requires complete spec/type input, existing category and
  templates, explicit existing location, optional supplier/SKU/PO, lot attributes,
  tags/barcode/PO links and explicit `FrozenEvidence`. Manufacturer/MPN, approximate
  lots, notes/media/datasheets/company images, invoice and provenance requests,
  automatic taxonomy/location creation reject before writes and remain Stage 5.
  These fields are not silently discarded or advertised as fully imported.
- Source metadata and per-line keys freeze with the plan; comprehensive source
  facts, established provenance artifacts and archive packaging remain Stage 5.
  Artifact bytes are explicit caller input; this stage does not automatically
  discover source files or build immutable source archives.
- A Part's explicit per-parameter missing additions are approved operations in
  new mode. Nonempty values never change. Full legacy matching/update/flags and
  `--plan` schema are unaffected. There is no unsafe legacy fallback during an
  unresolved durable run; canonical ownership excludes it.
- A settled completed run can return committed status without replay. Further
  enrichment needs a separately approved later plan; old stock quantities and PO
  contributions are never inferred from an edited source or matching payload.
- Tags use GET-plus-PATCH union with currently observed additions. No verified
  conditional write/atomic set-add capability exists here; another client's
  edit racing after the GET can still be overwritten. This is not cross-client
  compare-and-swap or server-side exactly once.
- Raw creates deliberately avoid SDK constructors/reloads. Tests make the StockItem
  constructor fail if invoked and prove the slice still checkpoints/executes;
  actual malformed/multiple JSON response tests use the observed SDK transport.
- No live uniqueness, server instance identity, PO-line correlation or attachment
  verification capabilities were probed. Fake contracts prove client behavior,
  not guarantees from an arbitrary production instance. Unsupported byte URLs or
  unavailable byte verification require review.
- Generic read retry/reconciliation contracts remain restricted. The new domain
  authorization additionally refuses semantic read specs. Original uncertainty
  survives in immutable prior attempt/event records, and known effects/outputs
  survive current settlement; a successful repair records current evidence.

## Files and contracts

- `execution/stock_preparation.py`: true read-only preview, shared matching,
  conflicts, rejection scope and source maps.
- `execution/stock_api.py`: typed SDK-compatible boundary and mandatory dispatch
  composition. Untrusted response typing is deliberately `Any` at this boundary.
- `execution/stock_handlers.py`: semantic operations, strict creates, current
  identity validation and conditional field repair.
- `execution/stock_evidence.py`: immutable explicit bytes/target, staging, upload
  and remote byte verification.
- `execution/stock_workflow.py`: canonical library entry points, selected repair,
  completed status and named report projections.
- `execution/store.py`: immediate output checkpoint, retained confirmed effects
  and explicit stock-domain attempt authorization, preserving generic retry rules.
- `inventree/observed_api.py`: marks factory-bound clients so domain adapters do
  not double-wrap mandatory transport guards.
- `tests/execution/stock_server.py`: persistent fake remote SQLite and fault
  injection; `test_stock_workflow.py`: representative domain/fresh-process/SDK tests.
- `ARCHITECTURE.md` and maintained design/contracts/plan: current/future status,
  decisions, supported scope and remaining Stage 5/6 gates.

## Validation, failures and corrections

All commands ran in the isolated worktree. Paths below are repository-relative or
runtime variables. The external operational handoff records worktree/base/head.
No automatic approval reviewer rejected an action and no live service was called.

- Offline dependency setup `uv sync --offline --extra scanner` initially failed
  because the sandbox could not open the existing uv cache. Scoped existing-cache
  access succeeded, installing 44 cached packages with SDK `inventree==0.13.5`.
- Initial focused fixture exposed that `match_path` matches aliases rather than
  canonical category keys; preparation now checks the canonical config key first,
  preserving the existing explicit-category policy.
- Initial successful completed-run test exposed the foundation's intentionally
  unresolved-only resume claim. The stock wrapper now retrieves committed status
  for already completed runs, with no mutations; incomplete runs retain canonical
  resume/reconciliation ownership.
- A conventions audit extracted the API adapter, annotated new interfaces,
  normalized import groups and replaced deeply nested report scans/comprehensions
  with preindexed operations and named operation/line report projections.
  Current CONVENTIONS.md matches latest origin/main; no guidance edit was needed.
- Audit caught Part keywords defaulting to empty string on real responses.
  The create preview now explicitly freezes `keywords=""` rather than comparing
  an ordinary server default against absent/None. This prevents false identity
  uncertainty while retaining strict response checks.
- First normal-suite sandbox run encountered many existing loopback fixture
  setup errors and slow follow-on failures; interrupted it rather than treating
  those as runtime evidence. A focused first-error rerun confirmed
  `PermissionError: [Errno 1] Operation not permitted` at the InvenTreeStub
  `127.0.0.1` socket bind. Scoped local-test permission resolved the issue.
- Focused foundation + stock slice + SDK observation command:
  `.venv/bin/pytest tests/execution tests/inventree/test_request_observation.py -q -x`:
  **144 passed** before the final three journal/guard/cancellation additions.
- Normal `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE4_UV_CACHE" make test` with local
  loopback permission: **1655 passed, 1 existing skip, 43 deselected in 60.77s**.
- Scanner `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE4_UV_CACHE" make test-scanner`:
  **43 passed, 1656 deselected in 43.91s**. No hardware was contacted.
- A new after-remote-write journal regression initially failed because its
  monkeypatch recreated the SQLite failure trigger during the subsequent resume.
  This was a fixture teardown error: restoring the original checkpoint method
  before resume fixed it. That intermediate normal run recorded **1 failed,
  1657 passed, 1 skipped, 43 deselected in 56.07s**. The corrected run passed
  **1658 passed, 1 existing skip, 43 deselected in 57.32s**.
- Final API binding audit added a per-child endpoint/base-target check, including
  evidence download, and a regression where the client URL changes after a read.
  It prevents the next mutation before dispatch. Error paths in execute/resume/
  selected repair all attempt the same best-effort local report.
- Final focused command with explicit summary:
  `.venv/bin/pytest tests/execution tests/inventree/test_request_observation.py -q -o addopts=''`:
  **148 passed in 20.29s** (80 foundation, 55 stock-domain, 13 SDK observation).
- Changed-Python Ruff and portable-path audit passed. Staging exposed one extra
  trailing blank line in the new API adapter, missed by an unstaged-only diff
  check; removed it and reran the complete base-to-head whitespace check.
- Final `UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE4_UV_CACHE" make test` with local
  loopback permission: **1659 passed, 1 existing skip, 43 deselected in 56.52s**.
  Scanner results above precede the final stock-only target/report/error tests;
  no scanner/UI code or behavior changed, so the scanner suite was not repeated.

The fault matrix uses real SQLite journals and a separate persistent fake remote:
pre-send cancellation/journal failure; known rejected create; conservative unknown
before-application failure; applied response loss; malformed/empty/multiple create;
per-parameter repair on spec/type Parts; barcode lost response; tag/PO-link failures;
manual quantity/batch/tags/PO drift; deleted stock; uncertain PO contribution;
unknown/rejected upload, verified recovery, mismatching/unavailable content;
independent branch continuation and named blocking; legitimate identical lots;
actual API endpoint/target mismatch; immutable planned inputs; `part_of` usable
output dependency; caller-ledger nesting; and no generic retry/legacy bypass.
Fresh subprocesses exit after applied stock create or immediately after committed
Part/Stock/PO-line PK checkpoints; resumed record counts/identities prove no replay
of known effects. A real SQLite trigger failure after remote creation proves the
failed checkpoint stops subsequent mutations and leaves the effect uncertain.

The actual observed SDK test exercises the complete slice, singleton list stock,
multiple/invalid/empty JSON responses and a forbidden SDK StockItem constructor.
Before each actual HTTP send, the corresponding durable request intent exists.
Every send has exactly one request ID and observer row; all mutations are guarded,
operation/attempt correlation matches the journal, and renderer exceptions do not
cause duplicate effects. No raw SDK/log canary is emitted by the new library.

## Independent review and next stage

Independent review of `c872660d1132da351ec3ac4173281c4975ade885` found two
P1 safety defects and one P2 preparation scope defect. Clearance is withheld
pending fixes/recheck; root owns publication. No live calls or publication occurred.

- **P1, checkpointed and consumed PO metadata:** the saved-output shortcut
  validated supplier/reference identity but skipped frozen description/currency/
  metadata validation. A checkpointed order could therefore settle after manual
  drift, and an already-succeeded order could be consumed by a pending/repaired
  contribution despite drift. Saved-order repair now validates the frozen payload,
  and every dependent consumption rechecks that same metadata before dispatch.
  Manual conflicts require review and remain unchanged; retained PK/effect/history
  do not become permission to write contributions to a drifted order. Sixteen
  fresh-process regressions cover checkpointed versus already-settled orders and
  description, currency, tags, notes, start/target dates, link and reference drift.
- **P1, confirmed upload replay:** a successful upload checkpoint could have
  CONFIRMED transfer certainty but remain unverified when later listing omitted
  its row. The previous guard checked only UNKNOWN, so selected repair could
  upload a second copy. Any retained confirmed upload effect now makes repair
  verification-only even when listing is empty or the attachment was deleted.
  A regression repeats repair three times against an omitted listing and proves
  one total upload, retained exact bytes/target and review status. No automatic
  replacement/reupload contract is introduced.
- **P2, multiple new PO reference allocations:** repeated read-only OPTIONS calls
  are not reservations; two distinct new orders could freeze the same next
  reference, then predictably fail allocation checks after unrelated stock writes.
  The bounded slice now rejects more than one distinct new PO allocation during
  read-only preparation. Shared new order and already-existing orders remain
  supported. A realistic fake advances its OPTIONS default only after creation;
  the regression proves rejection before any inventory/company/order mutation.
  Stage 5 may expand allocation only with a supported verified policy, never
  generic arithmetic on an arbitrary server's reference pattern.

The first new regression selection passed **72 stock-domain tests in 28.47s**.
After the allocation regression, the focused foundation/domain/SDK selection passed
**166 tests in 28.98s** (80 foundation, 73 stock-domain, 13 SDK observation).
Changed-Python Ruff and whitespace passed. The independent reviewer reproduced
all three fixes against the working tree and found no additional material issue.
The reviewer also exercised actual observed SDK multipart upload plus guarded media
download: **68 distinct sends matched 68 durable intents**, reports were complete,
and no guard/correlation duplication occurred. Their focused command passed
**165 tests in 30.11s**, collected before the final allocation test was added;
the owner selection above includes that additional regression. Final review-fix normal command
`UV_NO_SYNC=1 UV_CACHE_DIR="$STAGE4_UV_CACHE" make test` passed **1677 tests,
1 existing skip, 43 deselected in 66.48s**. Changed-Python Ruff and complete
base-to-head whitespace checks passed. Scanner was not repeated for these
stock-domain-only fixes; no scanner/UI or shared transport/store behavior changed.
Exact committed approval recheck remains pending. No generic retry guard was weakened.

Stage 5 should consume this bounded library, retain its invariants and add full
manufacturer/MPN relationships, enrichment/media/notes, source/provenance staging,
invoice/archive bytes and complete legacy report projection. Keep unsupported
requests explicit until their domains are implemented. Stage 6 owns CLI flags,
review presentation, write authorization/default rollout and optional TUI.
Preserve existing location/manual-field/target/input/ownership boundaries and
never make uncertain uncorrelated creates replayable to obtain an apparent
complete report.
