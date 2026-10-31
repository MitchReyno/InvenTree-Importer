# Stage 0 handover — execution contracts and baseline

## Baseline and scope

Base: main `b2e4a1285bf7ad6e09798a7b753833feaa158ec0`, merged PR #9.
Stage 0 adds maintained architecture/design/contracts and focused characterization
coverage. No executor, runtime safety fix, server capability probe or live inventory
call/write is included. Future interfaces are explicitly not implemented.

## Work and investigation

1. Created an isolated `docs/import-execution-contracts` branch/worktree from
   `origin/main`; parent checkout and other worktrees remain untouched.
2. Read project AGENTS.md/CONVENTIONS.md, the supplied revised design and staged
   plan, and final independent-review follow-up. Adapted the supplied proposals
   into maintained repository docs, removed temporary artifact references/review
   chatter and distinguished current behavior from agreed target contracts.
3. Inspected `stockimport`, `stock`, `parts`, `api`, `datasheets`, `purchase_orders`,
   `archive`, `importplan`, command/config/cache boundaries and relevant tests.
   Audited installed SDK with `uv run python` and `inspect.getsource` for model
   `list`, `testServer` and `downloadFile`; version reported `0.13.5`.
4. Added ARCHITECTURE.md and README/AGENTS links. Established architecture/plan
   updates and comprehensive tracked per-stage handovers as required deliverables.
5. Added two missing observable baseline tests, reusing local InvenTree fixtures:
   explicit unresolved location still creates unlocated legacy stock; same import
   key preserves stored part/quantity/batch/location when input fields change.
   Existing tests already cover input v1/v2, repeat imports, partial specs,
   company/notes/assets, part_of and --plan; duplicating them adds little evidence.
6. Ran focused and normal suites, changed-file Ruff and whitespace validation.

Material findings: current stock flow interleaves discovery/writes and exits early
for existing barcode; a line exception bypasses later lines/finalization. Parameter
writes and stock datasheet prefetch already run in pools. SDK list reads one page;
startup/download bypass ordinary request. Ledger recording is global/incomplete,
not durable. Barcode error translation can treat lookup failure as absence and
link uncertainty as conflict/cleanup. Source archive hashing/ZIP and combined
provenance have distinct durability boundaries. These are documented baseline
limits, not newly implemented guarantees. SDK source inspection is client evidence;
no mock asserts live server uniqueness, absence taxonomy or conditional writes.

## Decisions, rationale and tradeoffs

The authoritative detailed matrices and record fields are in
[contracts](../import-execution-contracts.md). Decisions made here:

- SQLite current state plus audit events, JSON exports only: transactional outputs,
  attempts and attribution justify a single relational store; avoid two backends
  and full event sourcing.
- Canonical runtime-discovered registry plus run DBs: claims must survive exit,
  journal relocation and missing run files. Reservation-before-mutation blocks
  safely across crashes without claiming cross-DB atomicity. Scope is one local
  configured user state root, not cross-host/old-binary exclusion.
- Conservative target continuity and reviewed aliases: PK existence/URL similarity
  cannot prove identity after restore. Unverified instance identity requires
  reviewed continuity evidence before saved PK reuse, accepting review friction.
- Retain existing pools for Stage 2 with explicit immutable correlation, synchronized
  sequences and safe delivery; avoid unmeasured performance regression. The durable
  first executor is serial with one checkpoint per parameter.
- Logical semantic operation IDs precede PKs: preview/restart task identity stays
  stable; resolved PKs remain outputs/conflict keys.
- Separate `import-run prepare/execute/status/resume/retry-operation/abandon` CLI
  namespace and explicit execution library APIs: preserve existing --plan/library
  contracts while making recovery boundaries unambiguous. Abandonment keeps unsafe
  uncertainty dispositions; it cannot silently unlock unresolved remote effects.
- New-mode unresolved requested location requires review; registration requires
  intended barcode ownership. Metadata/evidence can fail without gating inventory,
  but selected incomplete work yields exit 1. Preserve legacy behavior initially.
- Resume adds missing approved data and preserves observed unrelated tags; manual
  nonempty conflicts need review. Never restore historical quantity/batch/location/
  part. GET/PATCH cannot protect a later external race without verified support.
- Freeze provenance/archive bytes and targets, report upload outcomes externally:
  avoids self-reference and allows evidence-only recovery without inventory writes.

## Plan adjustments

- Stage 2 follows Stage 1 in a sequential PR stack rather than parallel delivery,
  matching the accepted delivery instruction; technical acceptance dependencies
  remain unchanged. Stage 7 is authorized follow-on work with concurrency enabled
  only after evidence, rather than an automatically optional omitted stage.
- Replaced temporary proposal-only status with maintained stage status, concrete
  contracts and decision/change control. Source investigations remain baseline
  limitations, not claims that recovery gates passed.
- Limited new characterization to two meaningful gaps because the requested other
  baseline categories already have coverage. No premature runtime changes or
  duplicate tests were introduced.
- Added comprehensive tracked handover requirements for all stages as requested.
  None of these adjustments weakens the target recovery/ownership guarantees.

## Changed files/contracts

- ARCHITECTURE.md: implemented data flow, API/filesystem effects, boundaries,
  concurrency, provenance/idempotence/error limitations and separate future design.
- README.md / AGENTS.md: discover architecture and require ongoing maintenance.
- `docs/import-execution-design.md`: portable maintained semantic design.
- `docs/import-execution-plan.md`: stage statuses, acceptance gates, flexible change
  control, sequential delivery and handover/review requirements.
- `docs/import-execution-contracts.md`: operation/policy/compatibility matrices,
  CLI/library namespace, record/state/error vocabulary, storage/ownership protocol,
  target validation and artifact boundary.
- `tests/inventree/test_stockimport.py`: two legacy baseline characterization cases.

## Validation and limitations

- Initial `git worktree add` failed because the sandbox could not create Git refs;
  authorized escalated execution created the isolated worktree successfully.
- Initial `uv run python` failed opening the existing user uv cache in the sandbox;
  reran with authorized cache access. SDK inspection completed without server calls.
- `uv run pytest tests/inventree/test_stockimport.py tests/inventree/test_importplan.py tests/test_stockfile.py -q`
  passed (252 focused cases; no failures).
- `make test` passed: **1412 passed, 1 skipped, 43 deselected**, 38.81 seconds.
  The normal command excludes scanner/TUI tests. Existing skip remains; no new
  scanner/TUI behavior changed, so scanner tests were not run.
- `uv run ruff check tests/inventree/test_stockimport.py`: passed.
- `git diff --check`: passed.
- Skills/custom agents were unchanged, so no separate workflow-sync invocation
  was required (the normal suite includes its non-TUI tests).
- No live API/integration writes or capability checks were attempted. SDK/server
  transport logging, malformed-create safety, registry persistence and restart
  guarantees are future-stage gates, not validated by this documentation stage.

## Independent review

Independent pre-PR review approved Stage 0 for PR opening with no P0/P1/P2
findings and no missing Stage 0 gate. The reviewer inspected the complete eight-file
change at `837d903`, project guidance, architecture/design/plan/contracts/handover,
current importer/identity/config/cache/pool behavior and installed SDK list/startup/
download paths. This is independent implementation review, not reliance on the
prior proposal review.

One P3 consistency correction was requested: Stage 3's plan named the state
`satisfied`; the contract/design name is `already_satisfied`. The owner aligned
the plan and the reviewer independently rechecked that one-line working diff.
The follow-up also marks Stage 0 complete in the maintained plan. No runtime
contract or acceptance gate changed.

The reviewer independently ran the two added tests: **2 passed** through the local
HTTP stub; changed-test Ruff, base-to-head whitespace and portability checks also
passed. Initial reviewer uv cache access and localhost socket binding were denied
by sandbox restrictions; the existing interpreter plus narrowly scoped escalation
for the local stub resolved these. The full 1412-case normal-suite and 252-case
focused outcomes above remain owner evidence; the reviewer did not rerun them.
No live calls, capability probes or inventory writes occurred. Approval covers
baseline documentation/contracts and characterization, not durable runtime,
automatic reconciliation, target capabilities or default rollout. The final
documentation-only review incorporation was checked with `git diff --check`.

## Next-stage integration

Stage 1 branches from this reviewed head, preserves PR #9 and implements specific
barcode error classification/no uncertain cleanup and complete bounded safe reads.
Audit both SDK model lists and direct API list consumers; attachment structured
outcomes need compatibility adapters for archive/provenance callers. Do not claim
resume yet. Update ARCHITECTURE.md and plan status, record any justified contract
shift, add fault-focused tests and a Stage 1 handover. All later stages preserve
logical identities/source attribution, explicit ownership discovery, immutable
artifacts and no legacy mutation fallback after uncertain durable work.
