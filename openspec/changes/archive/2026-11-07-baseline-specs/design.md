# Design assessment

## Context and grounding

See the [proposal](proposal.md). Five groups converted the [sources](sources/) section by section. Each checked candidate requirements against `backend/src`, `intake-server/src`, `contracts/src`, `frontend/src`, the migrations and the tests before writing them. The [coverage ledger](coverage.md) maps all 259 source headings. The second half of this document is the source design record: the rationale, alternatives, superseded statements, unbuilt intent and differences from the code, organised by group and source.

## Goals and constraints

- Specs state only behavior the code enforces now, with proof cited in the ledger.
- Nothing in the sources is lost. The originals stay in `sources/`; everything not turned into a requirement is recorded below or ledgered with a reason.
- Syncing must not overwrite or overrule later work. Later changes win every disagreement.
- Active changes owned by other sessions (`redesign-batch-workspace`, `simplify-intake-entry`) are not touched.

## Decisions and alternatives

- **D1 — sources move verbatim; specs are derived.** `git mv` keeps history and makes the no-loss claim checkable. Rejected: rewriting the sources into specs and deleting them, which loses rationale and is unverifiable.
- **D2 — new capabilities only.** All 15 capabilities are new. None of the six main specs, and no capability claimed by an active change, is touched. `pnpm openspec:overlap --change baseline-specs --new-capabilities-only` enforces this and runs immediately before sync. Rejected: `MODIFIED` deltas on existing specs, which would rewrite requirements that later changes own.
- **D3 — supersession is recorded, never synced.** Where a source disagrees with a later spec or change, the ledger marks it `superseded`, and the old statement appears in this document with what replaced it. Typical cases:
  - five views became four tabs (redesign);
  - stage graph and blocking questions became agent sessions (simplify);
  - SSE became a WebSocket.
- **D4 — unbuilt intent stays design.** The final InvenTree identity and permission gate (T11), release qualification (T12), Inventory-stage duplicate detection, lot exclusion, enriching previously confirmed stock, and the deployment baseline are recorded below, not specified. Registering them as BI items is a separate decision.
- **D5 — `processing-coordination` covers only `/1`.** The single-result profiles still run alongside the session model. The session behavior is left to `simplify-intake-entry`'s capabilities.
- **D6 — `research-broker` is kept although only fixtures compose it.** Its access, SSRF and receipt controls are real and tested. Its Purpose says it is fixture-only today, so the guarantees stay specified before a worker uses it. Rejected: dropping it into the design, which would leave tested security controls with no requirement.
- **D7 — spikes are preserved, not maintained.** The Stage 1 spikes and their former backend tests move to `spikes/` unchanged and leave the normal suite. They run from the `history/pre-openspec-cleanup` tag. The one production API they alone exercised, `execution.adoption.inspect_binding`, now has 13 standalone backend tests (`backend/tests/execution/test_adoption.py`).
- **D8 — a reusable overlap check.** `tooling/openspec/overlap.mjs` (`pnpm openspec:overlap`) checks any change before sync or archive. It is wired into the sync and archive skills, `docs/openspec.md` and CI. On its first run it reported that `redesign-batch-workspace` and `simplify-intake-entry` both modify `header-workflow-status`, so their relative sync order matters.

## State, authority and failure behavior

Documentation, tooling and one test file. No runtime behavior changes. The overlap check only reads files.

## Verification strategy

- `openspec validate baseline-specs --strict`.
- The overlap check in new-capabilities-only mode, rerun against the latest trunk before sync.
- Heading-coverage check of `sources/` against the ledger.
- The `inspect_binding` tests, with a mutation check, and the backend suite.
- The overlap-check unit tests and the CI path tests.
- Markdown lint, format check, broken-link scan and `workflow-sync`.

## Migration, rollout and recovery

Sync adds 15 new files under `openspec/specs/`. Live documents that cited the sources are repointed to the synced specs and current guides. Before sync, revert the specs to undo; after sync, remove the 15 new capability directories, since no existing spec changes.

## Risks and open decisions

- A future change that touches one of these capabilities must use `MODIFIED` deltas against the synced text. The overlap check reports any stale assumption.
- The specs reflect the code at the conversion date. Behavior added later belongs to that later change.

# Source design record

## Python durable import (import-execution sources)

Sources: [design](sources/import-execution/design.md), [contracts](sources/import-execution/contracts.md) and [plan](sources/import-execution/plan.md). Specs written: `durable-import-execution`, `import-request-observation`, `digikey-durable-import` and `import-demo`. No capability was dropped: all four have verified current behavior.

Implementation baseline named by all three sources: main `c22b7a1` (including PR #11 code-organization guidance and PR #9's DigiKey request-error, configuration-replacement and report-plan-read fixes), with the installed SDK `inventree==0.13.5`. No live server capability or production failure rate was measured at any stage.

### design.md

#### Decisions and rationale

- Build a small synchronous domain-operation executor with explicit prerequisite outputs, persisted recovery state and visible child request steps. Do not build a workflow language, distributed scheduler or async rewrite ([source](sources/import-execution/design.md#recommendation-and-scope)).
- The recoverable unit is a domain operation, not an HTTP request. Retrying runs the operation's recovery contract (for example a GET followed by no PATCH), never a blind replay of a recorded request ([source](sources/import-execution/design.md#operations-request-steps-and-dependency-outputs)).
- No local journal can guarantee exactly-once remote effects. Automatic recovery from an ambiguous create is not a goal unless a verified target-side identity or idempotency contract exists. Remote rollback, general inventory editing and changing matching policy are separate features ([source](sources/import-execution/design.md#goals-and-non-goals)).
- Two preparation boundaries: a conditional outline before connection, then read-only discovery and a resolved mutation preview before writes. Future outputs are symbolic references ("PK returned by operation X"), and resume never silently rebinds an approved part or company to another fuzzy candidate ([source](sources/import-execution/design.md#planning-before-executing)).
- Dependency, failure policy, resource conflict and visual grouping are separate concepts. Shared operations use domain keys: supplier part identity is supplier plus normalized SKU, and PO identity is supplier plus reference. Each PO line contribution stays per original line, even for identical lots ([source](sources/import-execution/design.md#operations-request-steps-and-dependency-outputs)).
- Keep three facts distinct: operation state, remote-effect certainty and retry policy ([source](sources/import-execution/design.md#states-continuation-and-cancellation)).
- Keep distinct identifiers for import, run, plan revision, operation, attempt and request. None replaces the stock barcode key `invimport:<file_id>:<line.id>`. Editing a reference-free file can change its `file_id` ([source](sources/import-execution/design.md#durable-identity-and-restart-contract)).
- Renderer failure is best effort, but journal failure stops new mutations and keeps uncertainty ([source](sources/import-execution/design.md#request-observation-and-transport-boundary)).
- Logo eligibility stays tied to companies this originating run created and persists across resume. An existing company with an empty logo stays ineligible ([source](sources/import-execution/design.md#provenance-logos-and-evidence-finalization)).
- Tag repair cannot guarantee preservation against a later external race without verified conditional updates. GET-plus-PATCH is not advertised as cross-client atomic ([source](sources/import-execution/design.md#staged-adoption-and-proof-obligations)).
- Stage 4: the raw JSON create path validates one returned identity and checkpoints it without SDK model constructors or reloads, which removes the constructor failure window instead of inheriting legacy first-list-element selection ([source](sources/import-execution/design.md#stage-4-implementation-decisions)).
- Stage 5: plan schema 2 adds typed `OperationSpec.settled_after`. Schema 1 serializes without it, and SQLite schema stays 1. A repair that changes the inventory effect set may mint a new immutable finalization revision, while a no-op resume does not ([source](sources/import-execution/design.md#implemented-stage-5-artifact-and-compatibility-boundary)).
- Stage 6: `import-run` is the explicit opt-in. The default switch is deferred until parity and fault gates pass ([source](sources/import-execution/design.md#stage-6-release-decision)).
- Stage 7: DigiKey has its own preparation, contribution, issue and receipt handlers rather than wrapping the legacy import in one opaque operation. Serial execution is retained ([source](sources/import-execution/design.md#stage-7-bounded-digikey-integration)).

#### Alternatives considered and rejected

- Callbacks only: a transitional observation layer with no durable recovery. A general request-level persistent graph conflates visibility with replay. A durable workflow platform (Temporal) has infrastructure cost and still needs remote reconciliation; revisit only for hosted-service needs ([source](sources/import-execution/design.md#storage-and-design-alternatives)).
- Storage: atomic versioned JSON snapshots and a JSONL event log alone were rejected. SQLite was selected with one writer and versioned schemas, without full event sourcing. `graphlib` is optional, not required.
- Globally monkeypatching `requests`, or attaching hooks after connect, was rejected because the pinned SDK constructor connects immediately and startup uses `requests` directly ([source](sources/import-execution/design.md#request-observation-and-transport-boundary)).
- Globally enabling `update_parameters` was rejected because it can overwrite drifted values ([source](sources/import-execution/design.md#incomplete-identity-parameters-can-duplicate-or-strand-a-part)).
- Matching PO lines only by supplier part and quantity was rejected because it merges legitimate separate purchases ([source](sources/import-execution/design.md#purchase-order-lines-need-their-own-identityreconciliation-contract)).
- Copying DigiKey's broad catch-and-skip per-SKU behavior was rejected in favor of better failure classification ([source](sources/import-execution/design.md#current-execution-and-reusable-foundations)).
- Deployable-app, workflow-package and plugin migrations were explored and not adopted ([source](sources/import-execution/design.md#stage-7-bounded-digikey-integration)).

#### Pre-implementation baseline (historical)

The "current execution" and "confirmed recovery defects" sections describe main `c22b7a1` before Stages 1 to 7 ([source](sources/import-execution/design.md#current-execution-and-reusable-foundations)). Its source line landmarks are not stable. The defects and their status today:

- Incomplete identity parameters could duplicate or strand a part. Fixed in the durable path: Part identity is checkpointed before parameter operations, and missing approved parameters are separate operations. The legacy path still does not request `update_parameters=True`.
- Barcode lookup and cleanup conflated distinct failures. Fixed in Stage 1 for both paths (`import-request-observation` / Import barcode lookup classification).
- Whole-line reruns did not complete all pending work. This remains a legacy limit. The durable path keeps pending work.
- PO lines had no identity or reconciliation contract. Durable contributions now have per-line identity, `merge_items=false` and `auto_pricing=false`. The legacy `_order_line` still creates a line unconditionally.
- First-page-only discovery undermined absence decisions. Fixed by the Stage 1 `collections` helpers.
- Optional outcome and finalization contracts were incomplete. Attachment outcomes were fixed in Stage 1. A legacy stock-line exception can still stop later lines and ordinary finalization.

#### Superseded statements

- The header "agreed target design; implementation is staged and incomplete" is superseded: Stages 0 to 7 and the demo are complete within their bounded opt-in scope.
- "Build a … executor for `import-stock`" is superseded in delivery: the executor is reached through `import-run` and the library, while `import-stock` keeps the legacy engine.
- "Generic `prepare_import` still marks stock resolution unsupported" is still true of `execution/preparation.py`, but stock work uses `stock_preparation.prepare_stock` and `stock_workflow.prepare_full_stock` instead.

#### Unbuilt intent

- Switching `import-stock` to the durable engine by default. It is gated on parity and fault review.
- A TUI for import execution, run as a worker over snapshots and events. There is no TUI dependency. The `textual` dependency serves the scanner, not imports.
- Byte-based progress for transfers.
- Pausing affected service work on demonstrated credential or outage scope.
- A target-side atomic create-plus-import-key capability, a verified PO-line marker, server uniqueness, conditional writes and byte verification as server capabilities. All are treated conservatively as uncertainty or review.
- Interactive and montage parity in the durable command. `import-run` does not produce the `import-stock --plan` montage; the library `project_stock_result` bridges `build_plan` consumers.

#### Differs from implementation

- "Bound attempts, backoff and total budgets … respect relevant server backoff hints". The durable executor has no automatic retry loop: only an explicitly authorized semantic-read requeue and audited domain repair. The only transient retry owner is the DigiKey `request_json` loop, with `MAX_RETRIES = 4` and backoff `min(60, 2**attempt)`. No `Retry-After` header is consulted.
- "Allow one executor per import and one active recording path per process; the lock on ledger.events is not run isolation". This is built as the `process_writer` lock. The global legacy ledger is still not isolated for parallel runs.
- "Continue independent branches; pause … on demonstrated credential/outage scope". Continuation is built, but there is no service-scope pause.

### contracts.md

#### Decisions and rationale

The decisions table is condensed ([source](sources/import-execution/contracts.md#decisions-and-rationale)):

- SQLite is authoritative and JSON is export only.
- The canonical registry is kept separate from the per-run SQLite file, so ownership does not depend on cwd or journal path.
- The legacy parameter and download pools are kept during observation, to avoid an unmeasured regression.
- Logical IDs precede server PKs.
- Target identity is conservative and aliases need review.
- New-mode location and barcode policies apply.
- Selected optional failures exit 1.
- Manual and historical fields are preserved.
- Artifacts are immutable and the execution report is external.
- The `execution/` package has synchronous handlers, following `CODE_GUIDELINES.md` and `backend/CODE_GUIDELINES.md`.

Operation ID construction is a versioned kind, a canonical logical subject and a semantic discriminator, hashed from the canonical representation. An example is `parameter/part:shared-resistor/template:Resistance`. Version 2 inputs use shared part keys, and version 1 chooses deterministic representatives from stable line IDs ([source](sources/import-execution/contracts.md#data-identity-and-state-contracts)).

The minimum persisted fields for OperationSpec, OperationResult, Attempt, Request, Event/snapshot and Artifact are built as listed, in `execution/models.py` and `execution/store.py`.

The operation and policy matrix rows are each realised by stock handlers ([source](sources/import-execution/contracts.md#operation-and-policy-matrix)). The spec requirements on create responses, stock field policies, locations and order lines, and evidence artifacts carry them.

The claim protocol favours blocking over forgotten effects. It persists the reservation, then links the run DB, then marks it active, and does not claim cross-DB atomicity ([source](sources/import-execution/contracts.md#storage-target-validation-and-ownership-namespace)).

#### Superseded statements

- "Future invocation … not available until implemented behind the staged feature gate" is superseded: all six `import-run` subcommands exist, plus `prepare-digikey` from Stage 7 ([source](sources/import-execution/contracts.md#concrete-clilibrary-contracts)).
- "Plan schema v1 records …" is superseded by schema 2 (`settled_after`) for new plans. Schema 1 is still readable.
- "Proposed `src/invimport/execution/`" is now built.
- "Stage 3 must implement and test this before Stage 4 consumes it" is done.

#### Differs from implementation

- "`--yes` suppresses confirmations only when choices are already explicit". `import-run` has no confirmations: `--yes` is accepted, has no effect and never implies `--write` or continuity.
- "`--events FILE` for redacted sequenced JSONL export". This is built, but the file is written once from the retained snapshot at the end of the invocation and atomically replaced. It is not a crash-durable stream.
- Saved-PK reuse "absent a trustworthy instance identity, require explicit reviewed continuity evidence". This is built. The CLI never supplies verified instance evidence: it always builds `Target(endpoint)`, so resume and retry always need `--continuity-reason`. The library `Target.instance_id` with `identity_evidence` path exists, but only callers can supply it.
- "Use `--json` consistently". This is built for every action. The demo wrapper always passes `--json` itself.
- Exit 2 for usage comes from argparse. An unexpected exception becomes `InvocationFailure` and exits 1 via `cli()`.

#### Unbuilt intent

- Automatic retention and deletion, and full artifact migration. They are explicitly not implemented.
- Migration from an unrecognized schema version, a force-clear or unlock action, and active-plan rebase or migration. They are explicitly absent.
- Cross-host, alternate-user or old-binary exclusion. It is out of local scope.
- Verified PO reference allocation for more than one new PO, and category-YAML persistence with a frozen destination contract.
- DigiKey media and archive parity, and multi-order durable allocation.

### plan.md

#### Decisions and rationale

- Deliver stages as sequential stacked PRs, each with a separate owner and independent review before its PR opens. Do not advertise durable resume until Stage 4's failure matrix passes ([source](sources/import-execution/plan.md#delivery-strategy)).
- The plan's eight invariants hold in the code:
  1. Dry-run and preparation never mutate.
  2. v1/v2 inputs and barcode keys are unchanged, and missing line IDs are rejected.
  3. The library has no prompts or exits.
  4. Matching, notes, confidence, logo and `--no-*` policies are preserved.
  5. A failed lookup is not absence.
  6. Identity is checkpointed before dependants.
  7. Reports distinguish their outcomes.
  8. Tests use isolated fakes only. Live writes need separate authorization.
- Stage 0 policy choices kept legacy location behavior in legacy mode. The new mode requires review for an unresolved requested location and confirmed barcode ownership for registration ([source](sources/import-execution/plan.md#stage-0--establish-contracts-policies-and-baseline)).
- Stage 1: English exact no-match text is the only supported barcode absence, so changed or localized text fails closed. Discovery is narrowed to supplier-scoped lazy caches and candidate-part parameter reads, trading per-candidate reads for no server-wide scans. Common modules therefore also improved DigiKey read completeness.
- Stage 2: the pinned SDK has no transport-injection API, so per-client bound function globals substitute `requests` and the logger without global patching. Operation and attempt IDs are invocation-local UUIDs.
- Stage 3: preparation marked stock resolution unsupported, and full mutation preview generation moved to Stage 4, to avoid an approved preview with no domain effects.
- Stage 4 reference fixture: two lines share a spec part, identity parameters, supplier and PO, with distinct quantities and batches, plus tags, a PO link, one evidence file and a type-identity variant. The required 13-row failure matrix is reflected in `backend/tests/execution/test_stock_workflow.py` ([source](sources/import-execution/plan.md#stage-4--representative-durable-recovery-slice)).
- Stage 7 concurrency: a reproducible synthetic read and download experiment (`backend/scripts/evaluate-import-concurrency.py`, evidence kept at `e3ac646`) showed overlap under fake latency only. Serial execution is retained because live rate, SDK client ownership, global ledger isolation and allocation, shared-field and artifact safety are unestablished ([source](sources/import-execution/plan.md#stage-7-implementation-adjustment)).
- Demo stage: an application-owned persistent HTTP fake and strict private CLI launcher. Happy and before-application attachment-403 scenarios are in scope. DigiKey and lost-response demos are deferred ([source](sources/import-execution/plan.md#follow-on-user-run-loopback-demonstration)).

#### Superseded statements

- "Each stage updates `backend/ARCHITECTURE.md` and this status table … Stages 0–7 recorded their history in handovers". New backend work is planned as an OpenSpec change with `notes.md` (change control text in the source). The handover requirement is superseded by the `retire-handover-documents` change ([source](sources/import-execution/plan.md#status-and-change-control)).
- The plan's validation section ("Run focused tests …, `pnpm test`, `pnpm lint:backend`, `git diff --check`; mirror skills; `pnpm test:scanner`") is now owned by the repository `AGENTS.md` testing rules and is not carried as a spec.
- Stage 6 "Make new engine default only after parity/fault gates" is still pending (unbuilt), and its "Optional TUI" is unbuilt.

#### Unbuilt intent

- Stage 7 concurrency work: bounded independent reads and downloads, writes only with proven ownership, per-service rate and backoff budgets, and removing the global ledger.
- Stage 7 acceptance on the "supported single-process concurrency model" applies only to the serial model that shipped.
- Stage 6 documented downgrade guidance and retiring duplicated legacy business logic.
- Deferred demo scenarios: DigiKey and lost-response.

### Delivery history

The source handover links point at commit `2d852e2`.

| Stage                                             | Outcome                                                                                         | Approved implementation / evidence                                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 contracts and baseline                          | Complete; upstream incorporation independently approved                                         | Stage 0 handover; characterization tests added for unresolved explicit location and unchanged historic fields on same-key rerun                                      |
| 1 safe errors and complete reads                  | Complete; independent review approved                                                           | Error taxonomy and complete-read fault regressions                                                                                                                   |
| 2 observations                                    | Complete; independent review approved                                                           | Whole-command dispatch visibility, worker correlation and secret-canary regressions                                                                                  |
| 3 planner, executor and store foundation          | Complete; independent review approved                                                           | Head `87e7e25960395189db0809e731f9fe4412163583`; real SQLite/restart, canonical claims, serial fake-handler gates                                                    |
| 4 bounded durable stock slice                     | Complete; independent review approved                                                           | Exact head `4c2f127f45d7da93800bd95db8e83a16cb433f5a`; focused recheck 166 tests in 28.81 s                                                                          |
| 5 opt-in full-library stock                       | Initial candidate rejected with eight findings; corrected candidate approved                    | `59f74e5f6095e209e84920a61ca60d6cd7d8b130`; 221 focused tests in 65.03 s; 150 SDK sends matched 150 intents                                                          |
| 6 opt-in `import-run` CLI                         | Initial `1acda3e` rejected with three findings; corrected candidate approved                    | `93c5f355da8caffef272c2bfb35f7261e7fb67f2`; 261 focused tests in 96.68 s (31 CLI, 9 journal validation); owner normal 1772 passed, 1 skip, 43 deselected; scanner 43 |
| 7 bounded DigiKey opt-in and concurrency decision | `343bea9` rejected (four findings), `c5eab95` rejected (two findings); final approved           | `b27badf80a03c3b753a5293010054514c4a064c8`; 395 focused tests in 139.66 s; 154 SDK sends/intents including 11 media GETs; owner normal 1879, 1 skip, 43 deselected   |
| Demo loopback follow-on                           | Initial `227a840` rejected (cancellation/locator and fake-schema readiness); corrected approved | Runtime `8af4cfc449a99d3f720bd1a8669cab3dbd3ceafd`; independent 14-case demo suite plus signal, timeout, recovery and schema probes                                  |

Review corrections that shaped current behavior:

- Stage 4 review added frozen PO metadata and currency checks on every consumption. It made confirmed uploads verification-only, and rejects multiple new PO allocations during preparation.
- Stage 5 review made eight corrections:
  - per-line archive routing with a locked fallback;
  - shared finalization target validation;
  - positive owned-source exclusions;
  - partial-new candidate revalidation;
  - omitted and escaped-name location parity;
  - transfer versus verification receipts;
  - completed local-retention integrity.
- Stage 6 review made three corrections:
  - generated outputs are checked against actual owned roots, including custom registered roots without markers;
  - journal projections are validated against attempt, checkpoint and request history;
  - cancellation keeps exit 130 when event persistence fails.
- Stage 7 review made six corrections:
  - order-wide work requires an exact complete contribution set;
  - Company identity and role are rechecked;
  - numeric source values are kept exact, within 13 integer and 6 fractional digits;
  - the historical order date is frozen behind a writable capability;
  - receipt selection is refreshed and bound by `ReceiptPreconditions`;
  - `records.review` keeps valid aggregate certainty.

Baseline validation at the start of this change: 646 focused backend tests passed (execution, demo, request observation, collection, barcode and attachment safety, DigiKey API, stock import).

## Records, media, approval and apply

Capabilities: `capture-records`, `capture-media`, `approval-preparation`, `apply-execution`. Code references are repository-relative. "Built" means the code and tests named in the ledger enforce it; "unbuilt" means no current code does.

### typescript-data-model/README.md

#### Decisions and rationale

- One PostgreSQL database holds application records and the new TypeScript executor's journal, with private immutable blob storage, so there are not two local authorities. Built: migrations `intake-server/migrations/0001`–`0019`, executor tables in `0003_executor.sql`. Losing PostgreSQL stops new sends but does not resolve remote uncertainty (built, see `apply-execution` / Apply single physical writer). [source](sources/typescript-data-model/README.md#recommendation)
- Separate product editing, research proposals, human approval and execution by authority even though they share a database. Built through per-role grants (capture, decoder, `agent_writer`, apply, delivery roles).
- Relational identity and constraints for things that must agree; small versioned JSON documents for heterogeneous facts and frozen specifications. Built: retained canonical bytes plus SHA-256 are authority, never JSONB reserialization (`intake-server/ARCHITECTURE.md`, "PostgreSQL and exact authority").
- Clean narrow implementation, not a port of Python tables or legacy features. Python SQLite journals stay untouched. Built: no component calls Python.
- The decisions table resolved: PostgreSQL over SQLite for the TS journal; original identity persisted, never derived from array position; mutable current pointers with immutable revisions; observed label, interpretation and human count kept separate; shared Part identity never merges packets; typed target-scoped PK observations, no inventory clone; research proposes and asks, only the apply process sends; one persistent host and a serial writer without lease failover; the job runtime owns scheduling only; defer breadth, not provenance, exact approval, uncertain-write handling or restore gating.
- Rejected: mirroring all of InvenTree; a general workflow or event-sourcing platform; a lease-based failover; reading or writing InvenTree's own tables or credentials.

#### Superseded

- "Status: design only, not implemented" and "Implementation awaits plan approval": superseded by delivery of T01–T08 and later changes (`intake-server/ARCHITECTURE.md`).
- The InvenTree-verified owner with library-owned sessions: superseded for development by the configured development actor and server-side API key (see `access-identity`). The final identity gate remains unbuilt intent there.
- "Five user views—Capture, Processing, Review, Approve, Results": superseded by `redesign-batch-workspace` (four batch tabs; Approve and Results become Changes › Ready to add and Added; `changes-commit`, `batch-navigation`).
- "Processing has Overview, Reading, Identifying, Research, Images and Inventory views": superseded by `simplify-intake-entry` (Examine lead session, Research, Images, Inventory; `processing-stage-pipeline`).

#### Differs from implementation / deployment

- Deploying in the existing PostgreSQL instance on the InvenTree host: the development stack hosts the intake dev databases in the local `inventree-db` PostgreSQL under separate restricted roles (`intake-server/ARCHITECTURE.md`, "Explicit local development stack"). A production deployment on a real InvenTree host is not qualified. Owned by the operations capabilities.

#### Unbuilt intent (first-release scope statement)

- First release out of scope: existing-record overwrites, stock adjustments, split or merge of imported stock, PO receiving, arbitrary taxonomy creation, distributed writers, offline sync and enterprise accounts. Still unbuilt; record edits refuse unsupported changes (`review-records` / Unsupported record changes are honest).

#### History

- 2026-11-01: model prepared at Mitch's request as a separate proposal. Stage 1E was cleared within its Python/local-fake scope (44 combined/shared tests) and published as PR #33, merged into `feat/spike-shared-contracts` on 2026-11-01 with six CI checks green; consolidation PR #29 was then open toward `interactive-app`. Design/spike PRs later merged into `interactive-app`. The owner handover is at commit `2d852e2` (`docs/handovers/typescript-data-model.md`).

### typescript-data-model/01-identity.md

#### Conventions (built parts)

- Application UUID keys, `timestamptz`, `revision bigint CHECK (revision > 0)`, IDs and revisions as JSON strings never JavaScript `number`: built (`0002_capture.sql`, `contracts/src/scalars.ts`, `tests/pg/foundation.test.ts` bigint driver test).
- Digests are 32-byte `bytea` with a length check, 64 lowercase hex in DTOs: built (`capture_revision.command_digest`, `capture_issue_disposition.dependency_digest`).
- Quantities: decimal text at JSON boundaries, at most 13 integer and 6 fractional digits, validated before insertion into `numeric(19,6)`: built (`contracts/src/scalars.ts` `Quantity`; `tests/pg/foundation.test.ts` "numeric(19,6) fidelity"). In `capture-records` / Capture exact values.
- Parsing rejects duplicate keys, non-finite numbers, extra fields and invalid lexemes before normalization: built server-wide by the strict JSON parser and AJV without coercion (`intake-server/ARCHITECTURE.md`, "Public boundaries"). This is an API-boundary property, not owned by these capabilities; it is reflected in the "Body tries to widen authority" scenario.
- Composite same-batch foreign keys, `RESTRICT` defaults, immutability through triggers plus restricted grants (a `CHECK` cannot enforce it): built (`0002_capture.sql`, `0008_operator_review.sql`, `0005_media.sql` immutable trigger loop).

#### Conventions (unbuilt)

- Currency as validated ISO code, versioned unit codes and money values: unbuilt. There is no money field.
- "Zero quantity is not silently accepted as stock": built as a stronger rule, quantity must be positive.

#### Owner, connection and configuration tables

- `operator`, `target` and `target_context` exist in `0001_foundation.sql` (see `access-identity` and `inventory-target-protection`).
- `configuration_revision` (immutable mapping/policy documents with impact detection): unbuilt.
- `deployment_epoch`: differs. The executor keeps deployment rows, and the epoch lives in the external `activation.json` checked before every mutation (`intake-server/src/execution/ARCHITECTURE.md`, "Physical ownership and restore boundary"). Spec: `apply-execution` / Apply external activation gate.

#### Batch and source identity

- `source_namespace` → `capture_source(namespace_key UNIQUE)`. `origin_kind` (`native_batch` / `explicit_legacy_mapping`) and `external_reference` are unbuilt; there is no legacy-mapping import.
- `batch`: differs. The code keeps `archived boolean` rather than `archived_at`, versioned instructions in `capture_instruction` (`0008`) rather than a `batch.instructions` column, and no `configuration_id`. Readiness counts are derived (built).
- `subject`: built with `kind lot|part`, label and revision on the subject, and a deferred constraint trigger rejecting a subject without its extension (the design left trigger-versus-command open; the trigger was chosen). Retirement is the append-only `capture_lot_retirement` table, not `retired_at`.
- `lot.disposition` (`included`, `deferred`, `excluded`, `retired`): only retirement is built. Unselected lots simply remain (`remaining_lot_ids`). Lot exclusion as a persisted disposition is unbuilt server-side.
- `lot_lineage`: built, with `revision` and `actor_id` added, composite same-batch FKs and a no-self-edge check. Acyclicity is enforced by commands only retiring active lots.
- Barcode: built as `bi1:<originalSourceKey>:<contributionKey>` frozen in the plan (`intake-server/src/execution/plan.ts`). It is original-contribution attribution, never server-side idempotency. The inspected InvenTree 1.5.0/API 530 stock serializer has no writable `barcode`, so the attribution is qualified only against the owned fake.
- Cross-language barcode vectors and an engine-exclusion gate before touching a used source: one Unicode byte/hash vector exists under `contracts/vectors`; barcode vectors and the engine-exclusion gate are unbuilt (no cross-engine use is enabled).

#### Inventory observations

- `inventory_observation` → `capture_observation`: built with allowlisted models (`part`, `location`, later `category`, `parameter_template`, `category_parameter`, `company` in `0010`), positive PK strings and target-context binding. `read_outcome` found/absent/incomplete and `expires_at` are unbuilt; an unavailable read simply fails with 503 and records nothing.
- `inventory_choice` (reuse/create/unresolved per purpose): differs. Part choice is a `capture_selection` with field `choice` (and Part specs for new Parts); locations and suppliers are selections or settings intent. Execution revalidates identity at apply (built, precondition reads).
- No automatic import of Python canonical state: built (none exists).

### typescript-data-model/02-evidence.md

#### Evidence catalogue

- `blob`: built as content-addressed private storage keyed by SHA-256, bound to an immutable DB store identity (`intake-server/src/media/blob-store.ts`, `tests/media-blob.test.ts`).
- `upload` mutable transfer bookkeeping (receiving/failed/published/expired): unbuilt. Uploads are one bounded whole-file request (20 MiB, `MEDIA_SOURCE_MAX_BYTES`) with a payload-bound idempotent receipt; the design's "start with bounded whole-file retry, not resumable upload" is what was built.
- `evidence` kinds photo/document/note/order_reference/web_source: differs. Media evidence covers JPEG, PNG and PDF originals; human notes are `capture_note` rows; there is no order-reference or web-source evidence kind in capture (web captures belong to `research-broker` receipts).
- `evidence_version`: built as `media_version` (original or derived, immutable). Note corrections append new notes (capture) or new evidence-note versions (media).
- `source_capture`: owned by `research-broker`.
- `evidence_group` / `evidence_group_member`: covered by `capture-grouped-evidence`.
- `evidence_link` with page/region/text locator: differs. `media_subject_link` links evidence to a subject without a locator; regions arrive with evidence observations (`0019`, `processing-lot-forming` / Observations with regions).
- Orphan collection under one digest lock with positive reference checks: built (`tests/pg/media.test.ts` "digest publication excludes GC…", "SELECT-only GC CLI…").

#### Observations, interpretations and selected values

- `fact_candidate`, `candidate_source`, `field_selection_revision` with modes `unset/inherit/human/accepted_candidate`: differs. The code has one versioned `capture_selection` table with modes `unset`, `unknown`, `clear`, `inherit` and `set`, and fields `quantity`, `location` and `choice`. There is no candidate table or `accepted_candidate` mode. Processing proposals are separate immutable records that cannot select human values (`processing-*` specs; `intake-server/ARCHITECTURE.md`, "Retained research coordination").
- "Rerunning research adds candidates, never replaces a human selection": built in the form that agents cannot write selections at all (`processing-lot-forming` / Agent-attributed lot writes stay within draft authority).
- Batch defaults: built as selections with a null subject; `default_cannot_inherit` refuses inheriting defaults. Preparation materializes effective values (built).
- Field registry as versioned code: built in the narrow form of the selection field check plus settings intent and lot context (`0012`, `0014`). No universal EAV.
- Estimated quantities kept distinct from counted: built for agent lots (`estimated_quantity`, `quantity_basis`, `0019`; covered by `processing-lot-forming`).

#### Media catalogue

- `media_recipe`: built as versioned recipes `documentary-crop/1` (integer pixels in the orientation-normalized source, page, quarter turns 0–3) and the additive `documentary-rotated-region/1` (micro-pixel centre and size, millidegree rotation, optional aspect ratio, output dimensions that must round from the region size; `contracts/src/media.ts`, `contracts/src/media-geometry.ts`). The dimension check runs when the decoder renders the recipe (`intake-server/src/media/rotated-region.ts`). Retained recipe bytes are never reinterpreted.
- `media_derivative` content kinds documentary/enhanced/generated: only documentary output exists.
- `media_selection` slot "Part image" with automatic primary-image replacement: differs. Destinations are `lot_attachment` and `part_attachment`; there is no primary-image destination or replacement. Unsupported Part attachments surface as `unsupported_part_attachment`.
- "Future library versions need not reproduce byte-identical output, so retain selected output bytes": built; derived bytes and the toolchain string `sharp/0.35.5;pdfjs/6.4.299;canvas/1.1.0;png/1` are retained.

### typescript-data-model/04-execution.md

#### Review and frozen preparation

- `review` currentness by dependency match, not a reviewed flag: built (`manual_review.dependency_bytes/digest`; operator review states `unreviewed`, `reviewed`, `changed_after_review`).
- `review_issue`: differs. Warnings bind dispositions to the subject's fact digest (`capture_issue_disposition`); blocking issues are computed, not stored per review.
- `preparation` stores plan bytes, digest, review bytes and dependency bytes; `plan_operation` / `operation_dependency` / `operation_lot` relational index: the effects plan keeps an operation index verified against the bytes (`intake-server/src/execution/effects-index.ts`); the `operation_lot` role vocabulary is not a separate table.
- Canonical encoding: built as UTF-8 with keys sorted by JavaScript code-unit order, ordered arrays preserved, schema set arrays sorted by callers, string/boolean/null scalars; `canonicalRecord` additionally keeps safe integers for retained command and receipt bytes.
- "Plan bytes are the sole executable specification": built; approval re-derives the plan and requires byte equality.

#### Approval and run reservation

- Approval, run, initial operations, command, outbox and event commit together: built (`reserveApprovedStock` inside the approval transaction).
- `approval.round_number`: built as a count of the batch's approvals plus one.
- "Same preparation cannot create a second approval under a different HTTP key": built for the same actor (adoption of the original run).
- Source guard states idle/reserved/running/blocked: differs in vocabulary; the guard holds an `active_run_id` that blocks other rounds (`source_history_unsettled`).
- Cumulative contribution history: built as `original_contribution_already_approved` for any approved contribution, which is stricter than the source's "bind its original attributable identity and supported enrichment". Enrichment of a previously confirmed stock contribution in a new plan is unbuilt.
- Run states `queued`, `running`, `stopping`, `settled_complete`, `settled_incomplete`, `recovery_required`: built (`contracts/src/manual.ts` `ManualRun`).
- Duplicate target aliases forbidden as an escape: contribution uniqueness spans all original-source aliases for a target (`intake-server/src/execution/ARCHITECTURE.md`).

#### Attempts, requests and effects

- `operation_attempt`, `request_intent`, `request_result`, `effect`, `verification_receipt`, `request_assessment`: built in executor-owned journals for stock, attachment and supported effects (`0003`, `0005`, `0010`). Result outcome names include `proven_not_sent`.
- Intent before every actual send, including preparation reads: built (`intake-server/src/review/preparations.ts`, preparation read intents; executor intents).
- Disabled implicit retries and redirects: built. Native Fetch was rejected because an observed HTTP 421 replayed a POST despite `redirect: manual`; core Node HTTP with no pooling is used (`tests/transport-single-send.test.ts`).
- Lost commit acknowledgement inspected read-only by stable key: built for approval and intents (`tests/process/executor.test.ts` "REAL PG TCP lost approval COMMIT ACK…").

#### Ownership and cancellation

- Host-level exclusion plus a dedicated advisory connection: built as a non-expiring atomic host claim and a never-reconnected advisory connection (`intake-server/src/execution/ownership.ts`, `supervisor.ts`).
- No automated stranded-claim recovery: unbuilt by design; a lost supervisor leaves the claim held until trusted operational reaping.
- `cancellation` durable stop, `recovery_action` kinds resume_pending/verify_known_output/verify_attachment/repair_supported_effect: built as recovery commands keyed by `operation_keys`, `attachment_keys`, `effect_keys` or `assessment_keys`.

#### Later rounds

- Settled-incomplete runs can release the guard; unknown blocks later rounds; repair reacquires the guard under the original run and cannot overlap a later round: built (`tests/pg/supported-effects.test.ts` "original selected repair reacquires source guard…").
- Effect-derived provenance/media archives (`run_artifact`): unbuilt, deferred.
- Lot outcome as a derived view, not `lot.imported`: built (runs and results are projected).

### typescript-data-model/05-transactions.md

- Atomic command boundaries: built for capture edits, media uploads, review, prepare, approve, authorize, checkpoint and cancel/recover. The global lock order in code adds media revision, sorted blob digests, a per-handle lifetime sentinel and the actor lane to the design's list (`intake-server/ARCHITECTURE.md`, "PostgreSQL and exact authority").
- Remote writes never inside a retried transaction: built (`executorTransaction` has no retry and propagates uncertain COMMIT).
- "Execution repeats approved preconditions and rejects changed effects": built for Part/location/catalogue precondition reads.
- Events, cursors, `ui_stream`: owned by `live-updates`. `audit_event` as a separate table: unbuilt; command history and journals carry attribution.
- Query-driven indexes: partly built (e.g. `capture_batch_recent(actor_id, updated_at DESC, id)`, `capture_selection_latest`). The full index list is planning guidance, not behavior; not carried into specs.
- Security and ownership of writes: separate roles are built (capture, decoder, `agent_writer`, apply, delivery); session authentication and requalification are `access-identity` intent.
- Retention, backup and restore: owned by `operations-backup-restore`. No general destructive delete exists (built). Backup validation with a fake create after backup is built (`tests/pg/executor.test.ts` "logical PG authority backup predates fake write…").
- Migration and delivery boundary: reviewed SQL migrations with Drizzle row types and hand-written commands (built); checked text states rather than enums (built); initial writes only to owned fake targets (built; `inventory-target-protection`). The incremental order "identity/capture → research → review/preparation → fake-target execution → recovery/events → restore" matches the delivered T01–T08 sequence.

### typescript-data-model/06-example.md

- The two-packet journey is reproduced by real tests: A-only approval with a shared Part, later B, deleted stock never replenished (`tests/pg/manual.test.ts` first test, `tests/pg/executor.test.ts` first test), and the adversarial lost-response branch (`tests/pg/executor.test.ts` "accepted create loses response…").
- Differs: the example's question/answer step uses Processing questions (processing capabilities); an answer creates capture edits and new inputs (built there). "Location A inherits Drawer 4…": built and covered by `capture-batch-settings`.
- TypeScript boundary types: `FactValue`, `FieldSelection` with `accepted_candidate`, `SourceLocator` with text ranges and `Dependency` unions are not the implemented contracts. Implemented contracts are TypeBox schemas in `contracts/src/` (`scalars.ts`, `capture.ts`, `manual.ts`, `media.ts`). `Outcome.state` and `effectCertainty` vocabularies match `ManualRun`. Text-range locators in Unicode code points: the observation region contract uses line ranges for documents (`processing-lot-forming`).
- Invariant matrix: most rows are now real tests (see ledger). Rows still unbuilt: login and permission gates (access-identity), estimated-quantity review policy beyond agent estimates, and cross-engine transition assessment.
- Design choices still to qualify: libraries were chosen (Fastify, Drizzle over reviewed SQL, AJV, DBOS 5.4.0, sharp 0.35.5, pdfjs 6.4.299). The host/provider route, real-target effect scope and retention obligations remain open; no live-write pilot exists.

### bench-intake/02-domain.md

#### Decisions

- Batch, lot (physical contribution), shared Part proposal, many-to-many evidence: built (capture records, media links, evidence observations).
- A no-photo start is valid: built (batch create with a note; capture tests use no media).
- Label transcription and counted quantity stay separate: built as agent observations and estimates versus human selections.
- Identity rules: opaque UUIDs assigned once (built); deterministic import barcode (built); draft revision for conflict detection (built, 412); input revision as SHA-256 of manifest bytes (Processing, built); target identity with continuity evidence (`access-identity`); executor build frozen into the plan (built); UI cursor from the durable stream (`live-updates`).
- Dates without times stay calendar date strings: built for purchase dates (covered by `capture-batch-settings` / `capture-inference-preferences`).

#### Superseded or differs

- Selection modes `inherit`, `human`, `accepted_candidate`, `unset`: differs (see 02-evidence above).
- "Use batch default again" as an explicit command: built as setting a lot field back to `inherit`.
- Reassign before approval "with impact preview": built (restructure and bulk previews).
- Retention and deletion: archive is reversible and nothing is deleted (built). Removing unapproved unreferenced evidence under a retention policy, and a permanent-delete/export feature: unbuilt. "Remove from workspace" is not offered.
- Server-side detection that rejects unsupported or encrypted PDFs: differs. The original is retained and its version reports `unsupported` or `encrypted` rather than the upload being rejected.
- Event cursors by stream-head row lock: built, owned by `live-updates`.

### bench-intake/03-workflows.md (from "Preparation, review and approval")

- Preparation materializes defaults and overrides, exact selected media and recorded choices, with shared Part prerequisites once: built.
- "Unavailable choices create typed questions rather than UI prompts": differs. Preparation returns typed blocking issues; questions are a Processing feature.
- "The browser displays the server's effects projection and submits the expected digest": built.
- Approval rechecks "current user permissions/scopes": differs; development access mode only (`access-identity`).
- Approval commits command and outbox but does not dispatch; dispatch is a separate durable start command (built). The design implied dispatch follows approval directly.
- Operation model with named outputs and settlement barriers: built in the effects plan (`effects-plan.ts`, `effects-step.ts`); a known shared Part supports lot B after A's attachment failure (built).
- Single apply ownership: built. No cross-host failover; host move needs quiescing (operations, procedure unbuilt).
- One actual remote request: built.
- Crash/recovery table: approval-before-enqueue, enqueue-before-ACK adoption, lost approval COMMIT ACK, intent before response, lost delivery, browser close and missing authority are each exercised by tests (ledger). "Old process remains alive → observe, cancel, reap": built as retained host claim; reaping is operational.
- Cancellation and selected recovery: built. No "retry entire item", force-success, automatic DELETE or "I checked, create again" exists. "Repair a specific missing-field effect when safe": partly built as `verify_effect` of an attributed PK; settling a refused create so a corrected value can be sent is unbuilt (`intake-server/ARCHITECTURE.md`, "Record edits and the records read").
- Later approval rounds: built. "The browser explains the blocking earlier run and links to it": the server names the run in the issue; the UI is `changes-commit`.

### bench-intake/04-contracts.md (assigned sections)

- Illustrative approval command: built exactly (`contracts/src/index.ts` `Approval`); the path ID must equal `preparation_id` (`approval_binding_mismatch`). The approval body allows up to 100 lot IDs while preparation scope allows 10, so the effective limit is 10.
- Preparation and execution interface: differs. Preparation accepts selected IDs and the expected batch revision; it reads resolved values from retained capture state rather than accepting a submitted snapshot. Executors accept only an existing run binding (`startApply` with `runId`), built. Effect-derived provenance: unbuilt, deferred.
- Retained Capture context additions: the composite `settings` command was later superseded by complete-state `batch_settings` intent (`0014`); legacy writes are refused with `settings_intent_superseded` once intent exists. Covered by `capture-batch-settings`, `capture-reference-selection`, `capture-inference-preferences` and `capture-grouped-evidence`.

### Candidate requirements from g4

- CR-4, CR-5, CR-9: already covered by the written requirements (Exact approval command, Preparation selected lot scope, Capture lot split, merge and move with lineage).
- CR-6: folded into Preparation warning and blocking-issue gate (refusal codes scenario). The `review-workspace` delta owns only the disabled Mark reviewed control.
- CR-7: shared versus lot-only invalidation is in Preparation review binding; preview impact is in Capture atomic bulk lot edits. Default-edit scoping stays with `capture-batch-settings`.
- CR-8: added as Capture atomic bulk lot edits.
- CR-10: folded into Capture archive and resume (archived exclusion, search and offsets); the browser control is UI.
- CR-11: recipe versions are in Media immutable derived crops; the dimension rule is recorded above because it is enforced at decode time rather than on submission.
- CR-12: decode states and the 20 MiB bound are in capture-media. Browser admission (JPEG/PNG photo, PDF document, rear camera) is frontend behavior, not the server boundary; the server accepts any bytes and reports their decode state.
- CR-15: covered by Apply supported capability scope and the capture-media Part-attachment scenario. The full capability manifest lives in `intake-server/src/execution/effects-capability.ts`.

## Platform: system, operations, identity and live updates

Covers platform identity, target protection, live updates and operations. The current behavior is in `specs/inventory-target-protection`, `specs/access-identity`, `specs/live-updates` and `specs/operations-backup-restore`. Everything below is rationale, unbuilt intent or a recorded difference from the code.

### 01-system: Bench Intake system and technology

#### Status

[Source](sources/bench-intake/01-system.md) dated 2026-11-01 described a proposed application with "no new backend implemented". The `intake-server` and `contracts` packages now implement it in tasks T01–T08 and later changes. The detailed history is in `intake-server/ARCHITECTURE.md`.

#### Context and authority

- Decision: one operator, phone and desktop browsers, one configured InvenTree target and a supported personal research runner, as a separate self-hosted application. It is not an InvenTree plugin, a commercial service or a multi-tenant platform. TypeScript owns the application. The earlier Python reuse proposal is kept separate.
- Differs from implementation: the source puts browsers behind HTTPS and a reverse proxy. The server accepts only a canonical `http://127.0.0.1` origin (`config.ts`), and `pnpm dev` puts it behind a loopback Vite proxy. HTTPS, a proxy and phone access are unbuilt.
- Unbuilt intent: a remote application with a local-runner split, which needs its own authenticated delivery and ownership design. Native login does not permit arbitrary remote hosting.
- [Source diagram](sources/bench-intake/01-system.md#context-and-authority): browser → proxy and API → PostgreSQL and private blobs → durable worker → personal runner (no write authority) and serial supervised apply → InvenTree with delegated user rights. Delegated user rights are unbuilt: apply uses the owned fake's token from the runner config.

#### Responsibilities

- Decision: entry points are explicit process modules (API, durable worker, research runner, apply supervisor, media job, operator commands), not microservices. Rejected: Redis, Kafka, Kubernetes, a user workflow editor, an enterprise role engine and a mandatory telemetry cluster. None are dependencies.
- Built: workers never start from web imports, autoreload or migrations. Apply is isolated and serial. Scheduler leases do not grant write ownership. The web process holds only a read-only transport.
- Unbuilt intent: the TypeScript API owning "InvenTree login integration, local sessions/access gate", and operator commands for "trusted issuer/owner/target configuration". Actor, target and context come from development configuration and setup scripts (`capture-setup.cjs`, `src/dev/setup.ts`).

#### Repository shape

Differs from implementation. The source proposed `src/{intake,processing,review,execution,inventory,api,workers,operations}` and a `migrations/` directory. The actual `src/` holds `agents`, `api` (server only), `attention`, `capture`, `db`, `dev`, `execution`, `header`, `inbox`, `inventory`, `live`, `media`, `operations`, `operator-review`, `processing`, `records`, `research`, `review` and `workers`, plus the `migrations/` SQL. `contracts/` holds the runtime schemas, the generated client and `vectors/`. `backend/` stays unchanged, as the source intended.

#### Technology

| Layer | Source proposal | Implemented |
| --- | --- | --- |
| API | Fastify, strict runtime schemas | Fastify, TypeBox schemas, AJV Draft 2020-12, a custom strict JSON parser, and serializer output validation |
| Persistence | Drizzle and `pg`, PostgreSQL | Same, with reviewed SQL migrations as the DDL authority (no schema push) |
| Authentication | Qualified InvenTree OAuth2/OIDC with maintained protocol and session libraries | **Unbuilt.** A development API key with `permission_gate: deferred_T11` |
| Durable work | DBOS TypeScript candidate plus an application outbox | DBOS SDK 5.4.0, qualified against real PostgreSQL and processes |
| Live updates | SSE | **Differs:** WebSocket `bench-intake-live/1` |
| Inventory | Narrow TypeScript adapter and PostgreSQL executor | Same (`inventory/transport.ts`, `execution/`) |
| Blob storage | Private content-addressed local storage | Same (`media/blob-store.ts`) |

The source said versions would be chosen at implementation time and that the Python spike's pins were observations only. Those pins are now fixed in the lockfile.

#### Storage authority

Decisions, owned by sibling `apply-execution`: approve in one database transaction, and let redelivery that is not atomic with approval adopt the same run. There is no SQLite run-directory reservation, and missing authority is never rebuilt from UI JSON. Neither the ORM nor the scheduler makes remote creates transactional. The adapter exposes typed allowlisted operations and never calls `import_stock`, `execute_stock` or other Python. The Python APIs are used only to understand behavior and write conformance scenarios.

Unbuilt intent: before a real transition, assess existing target and source history and quiesce older writers. A fresh database does not erase old uncertain effects.

#### Scope limits

Decision: native batches, lots and evidence, not every legacy interchange format. The application exposes only supported target operations and a narrow set of recovery actions. It defers PO booking and receiving, scanner and TUI, arbitrary overwrites and automatic global configuration learning. Delivery speed comes from narrower scope, not from removing approval or uncertain-write protection, and the rewrite does not inherit Python's test results.

### 04-contracts: interfaces and contracts (assigned sections)

#### Status

The [source](sources/bench-intake/04-contracts.md) labelled itself "proposed interface examples, not executable endpoints". Many of those endpoints now exist under `/api/v1`, with different shapes in places, as listed below.

#### Contract strategy

- Built: reviewed runtime schemas generate the OpenAPI spec and the typed client. A generation-drift check and tests run the actual server (`contracts:check`, `tests/api.test.ts`). The parser rejects duplicate keys and invalid or unsafe numbers before object parsing. Exact integers, revisions and decimals cross JSON as strings. Database rows and private fields fail output validation instead of leaking. `bench-intake-app/1` is the API version reported by health and readiness. The source's `bench-intake-spike/1` reference schema moved with the spikes into this change.
- Partly built: independent versions exist for the live protocol (`bench-intake-live/1`), processing profiles, plan and input schemas (`bench-stock-plan/1`, `bench-effects-plan/2`, `media-inputs/3` and others), effect capabilities (`owned-fake-effects/1` and `/2`) and the database schema (migration digests). There is no separate versioned "target capability profile" or "trusted instructions" artefact beyond those.
- Unbuilt intent: a schema-valid message still needing authentication and authorization. Today the only authority checks are the development key, CSRF and scope.

#### Browser API shape

- Built: same-origin `/api/v1`. Commands take a UUID `Idempotency-Key`, and an expected revision goes in the body (`expected_revision`), not `If-Match`. Status codes are 201 for created resources, 409 for idempotency or ownership conflicts, 412 for stale revisions (`revision_conflict`) and 400, 403 or 503 for refusals. Incomplete target reads never mean absence: sibling `capture-records` (catalogue and observations) and sibling `approval-preparation`.
- Differs from implementation:
  - Bootstrap returns `configured` or `setup_required`, not ready, sign-in-required, access-denied or access-unverified, and it carries a CSRF token and the scoped IDs.
  - `batches/:id/events` SSE is replaced by `/api/v1/live`.
  - `settings` and `diagnostics` are replaced by `/api/v1/readiness`, `/api/v1/connection-status` and agent settings.
  - The resource layout differs: edits go through `POST /api/v1/batches/:id/edits` with typed kinds, not separate structure, selections and defaults resources.
- Unbuilt intent: login, callback and logout routes, and operator-only issuer, owner and client setup. Approval, dispatch and send rechecks of user rights and delegated scope. Qualifying permission discovery against the deployed server without mutation.

#### Error vocabulary

- Built: `ErrorDto {code, message (≤256), recovery, correlation_id (≤64)}` with `recovery` set to `refresh`, `wait`, `review` or `none`. Codes in use include `revision_conflict`, `payload_conflict`, `setup_required`, `access_denied`, `target_context_changed`, `readiness_unavailable`, `live_unavailable` and `catalogue_unavailable`.
- Differs from implementation: there are no `resource`, `field` or `current_revision` context fields, and no `answer` or `reauthenticate` recovery values.
- Unbuilt intent: `login_required`, `access_unverified`, `capacity_wait`, `restore_blocked` and typed separation of application login from provider sign-in. The source's other codes (`stale_question`, `unsupported_capability`, `target_continuity_required`, `execution_owned`, `uncertain_write`, `retained_blob_missing`) are for the sibling capabilities to verify.

#### Progress and reconnect

- Superseded by implementation: SSE with `LISTEN/NOTIFY` or in-process wakeups became a WebSocket. The server re-reads stream heads in a repeatable-read transaction about once a second for each socket, without NOTIFY.
- Built: frames are cursor hints only, not payloads. Clients refetch snapshots.
- Kept from the source:
  - Events commit in the domain transaction, so commit order equals event order and rollback publishes nothing.
  - A snapshot returns its cursor from the same view as its state.
  - An expired or incomplete history sends a reset instruction instead of a partial tail.
  - Slow peers have bounded buffers.
  - A browser disconnect never cancels a job.
  - Responses are not cached (`cache-control: no-store`).
  - A polling fallback reads the same projections.
- Specifics: 128-event replay window, 100 streams, 8 connections, 16 KiB input, 64 KiB send queue, 10 s heartbeat, 5 min lifetime, client 2 s polling (15 s when truncated), 30 s frame freshness and ≤30 s reconnect backoff.
- Unbuilt intent: a lossy channel for apply progress byte and token counts. Apply progress is projected only from journal commits.

#### Compatibility tests

Built: the retained canonical vector (`contracts/vectors/canonical-v1.json`); malformed, duplicate, unknown-field and number vectors in `tests/api.test.ts` and `contracts/tests/contracts.test.ts`; generated-client tests against the real server; old-tab and protocol-mismatch handling (`LiveUpdates.test.tsx`); duplicate cursor IDs; commit and rollback ordering (`tests/pg/foundation.test.ts`); expired event windows (`tests/pg/live.test.ts`); and cross-scope access (`tests/pg/inbox.test.ts`). The principle that no type assertion or schema generator alone is acceptance evidence still guides testing (`intake-server/TESTING.md`).

### 06-operations: security and operations

#### Status

The [source](sources/bench-intake/06-operations.md) proposed operational controls and release gates. The implemented scope is restricted single-host local development (`intake-server/README.md#live-updates-and-restricted-operational-setup`). Remote deployment, production identity, native inference and release qualification are not provided.

#### Deployment baseline

- Unbuilt intent:
  - Run on the persistent InvenTree host with HTTPS for phone and desktop, built assets and the API behind one reverse proxy, and explicitly supervised workers.
  - Package reproducibly.
  - No serverless or edge apply.
  - Choose the supported operating system, filesystem and runtime as a release decision.
  - Move hosts through an explicit move and restore procedure.
  - Never expose DBOS administration, PostgreSQL, blob directories or native app-server ports publicly.
- Built as development tooling only, since `local-inventree-dev` is `skip_specs`:
  - Intake databases live on the local stack's `inventree-db` PostgreSQL 17 (`127.0.0.1:55433`).
  - InvenTree's own database is closed to other roles.
  - Restricted runtime roles have connection limits, within a 120-connection budget.
- Kept from the source: a research runner that its host cannot support stays unavailable. Credentials are never copied.

#### Authentication and authorization

Unbuilt intent. These requirements become specs only when built:

- Identity setup:
  - A qualified InvenTree identity integration using maintained libraries.
  - A trusted issuer, a dedicated client, an exact redirect URL and one allowed owner.
  - Revocable local sessions, no public signup and no local passwords.
  - Bind the verified issuer and subject, never a username or email.
  - Share no Django sessions or tables, handle no InvenTree passwords and use no superuser.
  - Keep tokens encrypted server-side, never in URLs, browser storage, DTOs or job payloads.
  - Register a dedicated client with only the required scopes; the broad built-in public client is not a shortcut. The InvenTree OAuth2/OIDC provider route is experimental and opt-in.
  - Before deployment, qualify protocol support and claims, identity-to-API-user binding, refresh and revocation, scope coverage and reliable effective-permission introspection. Block on failure, with no guessed permissions or service-account fallback.
- Access checks:
  - On every initial load, read-only introspection against a versioned server-owned manifest of effective permissions and delegated scopes, requesting no unrelated admin or delete rights.
  - Missing rights produce a missing-capabilities page, missing identity requires sign-in, and incomplete checks return retryable `access_unverified`.
  - Recheck at approval, dispatch and resumption, and on each privileged request. Queued work keeps its originating actor.
  - Revocation pauses new effects and keeps approvals, guards and uncertainty. A later login never authorizes replay. Qualify background refresh.
- Sessions and streams:
  - PostgreSQL-backed revocable sessions with HttpOnly, Secure and SameSite cookies, idle and absolute expiry, and rotation at login.
  - Local sign-out is separate from provider logout and token revocation.
  - Rate-limit login, record security events, and validate state, issuer, audience, nonce and PKCE.
  - Streams recheck access within a bounded interval. Today they reauthorize only at connect and close after five minutes.
- Origin and CSRF, built in development form: one configured origin, no CORS, exact Host and Origin, and a CSRF token for every state-changing request. The approval actor comes from server configuration. Unbuilt: login-route CSRF, Fetch Metadata and protocol redirects.
- Differs from implementation: the source requires sessions. Development uses one server-side API key (`INTAKE_DEV_API_KEY`) and a per-start CSRF token, and the bootstrap banner says it is not a verified human session. The local-inventree profile reads with a view-only token.

#### Secret and process boundaries

- Built:
  - The browser receives no database, target or provider secrets.
  - The web API holds a read-only transport.
  - The apply runner alone receives owned-fake mutation capability.
  - Runtime roles are restricted per process (API, Processing, media, scheduler, apply), and migrations use a separate role.
  - Secrets are injected through the environment or private files, not Vite variables or job payloads.
- Unbuilt intent:
  - An operator-managed encryption root secret for at-rest delegated tokens, with backup and rotation. Database encryption without key separation is insufficient.
  - An auth broker that manages tokens without exposing generic target writes.
  - Read-broker semantics, owned by sibling `research-broker`.

#### Threats

- Mapping of the source's threat table to the implemented controls:
  - Decoder bounds and content inspection: sibling `capture-media`.
  - HTML and SVG sources, and SSRF and DNS rebinding: sibling `research-broker`. The transport never resolves DNS for writes, and only literal loopback is writable.
  - Source and prompt injection: siblings `research-broker` and `provider-runtime`.
  - Path traversal: `media` and `qualifiedAttachmentPath`.
  - Cross-batch access: composite foreign keys, sibling `capture-records`, plus `access-identity` scope.
  - Duplicate or forged messages: sibling `processing-coordination`.
  - Hidden HTTP write retry: `inventory-target-protection`. Native Fetch was replaced after an HTTP 421 test observed it replaying a POST.
  - Outage and surviving processes: sibling `apply-execution`.
- Remote target replacement: partly built. Context rotation fences reads, and endpoint or PK equality is not identity proof. Unbuilt: a reviewed continuity-evidence gate.
- Evidence export leaks: unbuilt, because no export feature exists.
- Decision: a "read-only tool" is a semantic allowlist, not "HTTP GET". The target is never redirected, and research fetches never use target cookies.

#### Observability

- Built:
  - `GET /api/v1/health` is liveness.
  - `GET /api/v1/readiness` checks the target context and migration digests without inventory requests.
  - Startup, drain and refusal records are fixed event codes.
  - Probes never log in to a provider, infer or mutate.
  - Worker startup is explicit.
  - Each boundary has its own limits (body 256 KiB, read bodies 64 KiB, catalogue pages 512 KiB, live buffers, maintenance limits).
- Unbuilt intent:
  - Structured redacted logs keyed by batch, job, attempt, command, approval, run, operation and request IDs. The Fastify logger is off.
  - Optional metrics and traces.
  - Monitoring of outbox lag, workflow versions, queue occupancy, runner login, apply child liveness, projection lag, blob verification, storage capacity and last backup-restore test.
  - Readiness covering storage and a restore gate.
- Kept from the source: no numeric performance targets before measurement.

#### Backup and restore

- Built:
  - Coherent backup of application and scheduler state in the same database, with blobs.
  - An externally disabled gate checked outside the restored database.
  - Restore only into a fresh quarantined destination.
  - External witnesses that block replay after an old restore (`restore_history_missing`).
  - Credentials, runtime config, activation, witnesses and claims excluded from archives.
- Limits: 10,000 blobs, 8 GiB of blobs, an 8 GiB dump, a 2 MiB manifest, a 120 s native-tool deadline, 64 KiB of stderr and a 3 s lock timeout. Native `pg_dump` and `pg_restore` must be PostgreSQL 17-compatible.
- Differs from implementation: the source asked the manifest to record application and target identity, the snapshot boundary, executor and contract versions and configuration identities. The manifest records the external-binding digest (deployment, epoch, target, context, origin, continuity, build, capability), the store ID, blob digests and migration digests. A separate scheduler database is refused rather than supported. Incremental blob copy is not implemented; every referenced blob is copied.
- Unbuilt intent:
  - Online coordinated backup, which needs its own proof.
  - Restore tooling that never copies an "apply enabled" marker. Today activation is never in the archive at all.
  - Explicit activation for a reconciled epoch.
  - Retention deletion, witness cleanup and automatic activation (deliberately absent).
  - Reviewed continuity and reconciliation for lost attribution. Until then, sources stay blocked, with no force-clear procedure.
- Unsupported, as the source states: whole-machine rollback by an administrator and arbitrary external writers. Python SQLite journals are not migrated.

#### Deployments and migrations

- Built:
  - Migrations run through an explicit command with a migration role, under an advisory lock, with checksum drift refused.
  - Web startup quarantines an unknown or changed migration set.
  - Stale DBOS handlers and plans are refused by version and digest authority, with no automatic plan upgrade.
  - Scheduler cleanup never deletes approvals, journal or evidence, because no retention deletion exists.
- Unbuilt intent:
  - Pin API, worker, runner and executor versions on immutable commands and plans. Some exist, such as the DBOS application version and plan schema versions.
  - Deploy additive SQL first, then drain old work.
  - Proven rollback and forward compatibility.
  - A dependency bill of materials and clean-host tests.
  - Answers scheduling compatible continuations through tested transformations: sibling `processing-coordination`.

#### Transition from Python

Decision: development and the initial proof use only isolated fake data and owned fake targets. Python CLI namespaces, journals and data stay unchanged. TypeScript does not import or share Python ownership and does not enforce cross-engine exclusion, so the same source running live in both is unsupported. A separately authorized transition must assess history, quiesce old writers and verify the handoff. A new namespace or target alias cannot bypass missing history. Guards cover only the TypeScript scope. Publishing the design authorized no cutover, relocation, journal editing, claim clearing or mutation. Status: no transition has been made, and actual InvenTree mutation remains unsupported.

### 01-identity: identity and target context (assigned sections)

#### Owner, connection and configuration tables

- Differs from implementation:
  - `operator` is `(id, identity_kind = 'development', subject_key)`, with no `auth_issuer` or `auth_subject`, display name or `disabled_at`.
  - `target` is `(id, current_context_id, revision, profile ∈ {protected-read-only, owned-disposable})`, with no name, URL or `credential_ref` column. The origin and credential reference live in server configuration.
  - `target_context` is `(id, target_id, generation, context_digest)`, with `UNIQUE(target_id, generation)` and a deferred composite current-context foreign key. It has no endpoint snapshot, continuity or capability JSON, reviewer or state.
  - There is no `configuration_revision` table in the intake migrations.
  - There is no `deployment_epoch` table. The external private activation file (deployment, epoch, target, context, origin, continuity, build, capability) and `executor_deployment` (migration 0003) carry the epoch and gate roles.
- Unbuilt intent: one active owner bound to a verified InvenTree issuer and subject. Target secret references point to deployment-managed encrypted secrets. Configuration revisions that invalidate affected preparations.

#### Authentication boundary

Unbuilt intent: library-owned protocol and session tables; a supported InvenTree login with revocable sessions and no registration; issuer, client, redirect and replay validation; binding the subject to the target; no Django session sharing, passwords or database reads; and recording secret rotation as an operational change that proves no continuity. Built, sibling `provider-runtime`: provider login tokens stay in the native runtime's credential store.

#### Mandatory access qualification

Unbuilt intent. These requirements become specs only when built:

- Initial load: before any workspace data or action on every load, verify authority for every operation of the release against a versioned requirements manifest. Check both effective user permissions and delegated scopes. Request no admin or delete rights. No partial workspace and no service-account bypass. Background work keeps the acting user's authority.
- Blocking results: an underprivileged user gets `access_denied` with the message "Your InvenTree account does not have the permissions required to use Bench Intake", a safe list of missing capabilities, retry and sign-out. A missing login requires sign-in. Unreachable or unsupported introspection returns retryable `access_unverified`. Every unverified state fails closed. Built in part: pre-access (`setup_required`) responses expose no batch data or credentials.
- Rechecks and evidence: recheck before approval, dispatch and resumption, and on each privileged request. Permission loss stops new sends and keeps approvals, journal and guards. A later successful check does not authorize replay. Qualification records bind actor, target, requirements version, observed permissions and time, as audit evidence and never as a grant. Determine permissions without test mutations. Built in part: every endpoint and the live stream enforce actor, target and context scope.
- The development API key mode is current behavior, specified in `access-identity`. The final InvenTree identity and permission gate is task T11, still pending.

#### Target changes

- Built: a rotated current context makes routes refuse with `target_context_changed` before traffic and discards late results. A reset local InvenTree instance gets a new context and namespace. Approved runs keep their original binding (sibling `apply-execution`).
- Unbuilt intent: explicit draft rebinding before preparation that clears incompatible inventory choices and reviews; blocking restored or replaced targets until qualified; recording a real continuity assessment. A hash of `/server/info` is not a guaranteed instance ID.

## Processing, provider runtime and research

Covers `processing-coordination`, `provider-runtime` and `research-broker`. "`/1`" below means the single-result profiles (`synthetic-research/1`, `synthetic-research/2`, `restricted-research-stub/1`, `native-agent/1`; handlers `processing/1`–`processing/4`; queue `bench-research`). "`/2`" means the session profiles (`native-agent/2`, `synthetic-session/1`; handler `processing/5`; queue `bench-sessions`), which `simplify-intake-entry` (SIE) owns. The default profile is `synthetic-research/2` (`intake-server/src/config.ts`).

### Supersession by simplify-intake-entry

SIE PR-A to PR-D are merged into `interactive-app` (#97, #107, #112, #118). Its specs own sessions, lot forming and the stage pipeline; these baselines restate none of it. For `/2`:

- the stage graph is Examine lead session → Research ∥ Images → Inventory, not `reading → identifying → research → images → inventory` (SIE `processing-stage-pipeline`, `processing-lot-forming`);
- a question does not end the session; agents continue on an assumption and answers arrive as inbox items (SIE `processing-stage-pipeline` / Non-blocking questions with assumptions);
- provider conversations are resumed, so "no native resumption" holds only for `/1` (SIE `processing-agent-sessions` / Resume idle sessions for pending input);
- capacity is 1–8 configurable slots (default 3), not one lane per account; a `/1` lane holder counts as one slot (SIE design D9);
- currentness is per proposal (`relies_on`, `processing_proposal_stale`), while the `/1` batch-level input rule stays (SIE design D5).

PR-D's live qualification (2026-11-07, #118) kept `native-agent/2` labelled `native_unverified`. It found that Codex wrapped intake tools in its `exec` code-mode tool and offered other built-ins, and that Claude was offered a deferred `advisor` tool; those findings concern `/2` adapters and are SIE open items, not baseline requirements. SIE notes also record that in codex-cli 0.166.0 `features.goals` defaults on, so a `/1` Codex turn is offered the goal tools and `request_user_input`; the `/1` adapter still refuses any tool item or server request, which is why `provider-runtime` states refusal of tool use rather than an empty offered tool list.

### 03-workflows

[source](sources/bench-intake/03-workflows.md)

#### Status

The chapter's status line ("new runtime, HTTP/auth and fault behavior remain to prove") is history. The `/1` coordination it describes is built; DBOS TypeScript restart and duplicate checks are demonstrated by `intake-server/tests/process/dbos.test.ts` on DBOS SDK 5.4.0.

#### Capture and processing graph

[source](sources/bench-intake/03-workflows.md#capture-and-processing-graph)

- Decision kept: one logical job per meaningful unit (batch, subject, stage), never a session per URL or field; rationale is cost and bounded state.
- Differs from implementation: "deterministic media/read-only inventory work uses ordinary bounded jobs; only inference consumes the provider lane." Every `/1` attempt, whatever its stage or profile, claims the single actor lane (`processing/runner.ts`). Media decoding runs in a separate media worker outside Processing.
- Differs: "Inventory matching … separately detects possible duplicate stock." No Inventory stage does this; Review computes a `possible_duplicate_part` warning (`intake-server/src/review/model.ts`).
- Differs: "Human edits can satisfy a prerequisite without agent research." `/1` stages require ready predecessor attempts; a capture edit makes inputs noncurrent but never satisfies a stage. For `/2`, Inventory waits for current Research and Images proposals (SIE).
- Stage roles (Reading extracts observations and regions; Identifying proposes lot/Part relationships) are superseded by the SIE Examine lead session; `/1` stages run only deterministic fixtures or the one-turn `native-agent/1` runner.
- "One active research job per account and one apply lane" is built as one actor lane for `/1`; the apply lane is `apply-execution`'s.

#### Job and question lifecycle

[source](sources/bench-intake/03-workflows.md#job-and-question-lifecycle)

- Differs: the source uses attempt states `succeeded` and `question`; code uses one shared vocabulary for jobs and attempts: queued, running, waiting_for_user, waiting_for_login, waiting_for_capacity, ready, failed, cancelled, superseded, interrupted (`contracts/src/processing.ts` `ProcessingState`). A successful attempt is `ready`; a question makes it `waiting_for_user`.
- `waiting_for_capacity` exists in the contract and terminal payload, but the `native-agent/1` runner never emits it (it maps only to interrupted, waiting_for_login or failed: `agents/runner.ts`).
- Decision kept: questions are product state; the command finishes and the lane is released, so no workflow parks waiting for a person.
- Native permission handles are not application questions. Codex's adapter refuses every server-initiated request; the research protocol fails native permission requests closed. "Stop the attempt and create a bounded new one" is built as interruption plus an explicit fresh attempt; there is no automatic replacement.

#### Durable dispatch and duplicate handling

[source](sources/bench-intake/03-workflows.md#durable-dispatch-and-duplicate-handling)

- Differs: there is no outbox claim, claim token or claim expiry. The dispatcher is a polling loop (every 500 ms, up to 10 rows, oldest first) inside the single per-actor supervisor, which holds an advisory lock (`agents/worker-main.ts`, `processing/delivery.ts`). The outbox table has `available_at`, `delivery_attempts`, `acked_at` and `conflict_code` only (`migrations/0001_foundation.sql`). Redelivery comes from the next pass re-selecting unacked rows.
- A transport failure with no existing workflow leaves the row unacked; collisions are classified from DBOS's public `getWorkflow` state, never from error text or private tables (`workers/delivery.ts`). This satisfies the source's "do not query undocumented internal tables".
- Decision kept: DBOS owns scheduling only, not approval or physical-write ownership. The source's fallback ("revise the runtime choice before production") was not needed.

### 04-contracts

[source](sources/bench-intake/04-contracts.md)

#### Runner command/result boundary

[source](sources/bench-intake/04-contracts.md#runner-commandresult-boundary)

- Differs: results are `proposal`, `question` and `terminal` envelopes only; there is no progress envelope. `native-agent/1` progress (starting, responding, settled, native session ID, actual model) is written by the coordinator to `agent_session` (`agents/sessions.ts`), not sent by the runner.
- Differs: the runner channel is not a Unix socket. The coordinator holds an HMAC-SHA-256 capability per attempt (`processing-channel/1:<attempt>` keyed by `INTAKE_PROCESSING_CHANNEL_SECRET`, at least 32 bytes) and hands the runner an emit callback; native CLIs speak over stdio pipes; the research fixture child uses `research/child-transport.ts`. The runner never sees the capability.
- Commands do not name allowed artifact references or a skill profile; they bind job, attempt, input ID and digest, profile, handler and command ID, and the input manifest carries instruction and tool-profile versions and digests.
- Unbuilt intent: remote runner pairing (short-lived credentials, TLS, scoped artifact access, stale-owner rejection). It remains deferred.

#### Tools

[source](sources/bench-intake/04-contracts.md#tools-permission-vocabulary-not-agent-discretion)

- Built (restricted fixture profile only): `read_evidence`, `fetch_source`, `read_source` (not in the source table), `lookup_inventory`, `submit_proposal`, `ask_question`.
- Unbuilt: `search_sources` (discovery is replaced by at most 16 exact server-admitted URLs) and `propose_media_recipe` (crops are operator-driven in Media).
- Differs: `lookup_inventory` is not constrained to "the acting user's delegated authority"; it reads exact Part or location PKs through the server's read transport closure, with no search or stock reads.
- `native-agent/1` has no tools at all; `/2` tools belong to SIE.
- Decision kept: an adapter that cannot enforce the boundary is unsupported, not "safe because the prompt says read-only"; the `/1` adapters refuse unexpected tools at runtime.

### typescript-data-model

[source](sources/typescript-data-model/03-processing.md)

#### Provider setup and immutable inputs

- Differs: no `runtime_profile` table. `processing_profile` holds immutable rows (ID, qualification `fixture_only` or `native_unverified`, handler version, instruction digest, tool-profile version), and the instruction bytes live in code (`processing/policy.ts`). Capability assertions are not stored.
- Differs: no `runner` table; runner availability is not persisted. Supervisor exclusivity is a PostgreSQL advisory lock, and login or capacity show only as attempt outcomes.
- `input_snapshot` is built as `processing_input` (canonical manifest bytes up to 240 KiB, SHA-256, capture revision, `parent_id`), immutable by trigger. Dependencies are typed fields in the manifest (subject, linked Part, notes, media descriptor, dependency attempt IDs, answer ID, admitted source URLs), not a generic discriminated list.
- `snapshot_blob` is not built; command media pins are owned by Media (`media_command_pin`).
- Decision kept: dependency-aware invalidation rather than a workflow DAG editor, and a model never decides whether its own output is current.

#### Jobs, attempts and received messages

- Differs: job uniqueness is `(batch_id, subject_id, stage)`, not a `logical_key`; the current attempt column is `current_attempt_id`.
- Differs: `processing_message.disposition` is `accepted` or `stale`; rejected envelopes are refused and not retained. `processing_proposal` has no `acceptance` column.
- `runtime_profile_id` and `runner_id` on attempts are replaced by `profile_id` and `channel_digest`.
- Differs: "Unsupported entitlement/tool boundaries block inference with no paid API fallback." An explicit API-key route is selectable in Agent settings; it is never a fallback from subscription.

#### Questions, issues and decisions

- Differs: questions are `open`, `answered` or `superseded` (no `cancelled`); cancelling supersedes open questions.
- Unbuilt: `question_subject`, preparation-command questions, `issue` and `issue_resolution` in Processing. Review blocking issues and dispositions belong to `approval-preparation` (`capture_issue_disposition`).
- Built: one immutable answer per question with its continuation attempt; the answer value binds the question ID; a correction makes inputs noncurrent rather than editing the answer.

#### Command, idempotency and outbox

- `command` has a kind allowlist (`process`, `continue`, `prepare`, `apply`, `cancel`, `recover`, `qualification`), unique `workflow_id`, `queue_name`, payload bytes and digest. Differs: no `parent_command_id` and no `state` column.
- `idempotency_record` matches the model (actor, action, resource key, key; semantic bytes and digest; response), created atomically with the domain result.
- Differs: no `claim_token`, `claim_expires_at` or `last_safe_error`, and no `FOR UPDATE SKIP LOCKED` claim on the outbox (SIE uses `SKIP LOCKED` for `agent_slot`).

### intake/design

[source](sources/intake/design.md)

#### Status

Proposed design reconciled on 2026-11-01, written before the TypeScript application.

#### Evidence ledger

History. Spike PRs: shared contract #22 (`20a46a1`), 1A subscription runtime #23 (`c1be7bf`), 1C importer adapter #24 (`e3ce087`), 1B durable coordination #26 (`9cf0b80`). Observed versions: Django 5.2.8, DBOS 2.10.0 (Python), PostgreSQL 17.11, psycopg 3.2.12. The spikes now live under `C/spikes/`. Historical Codex ambient sanitation, billing routing and charges remained unknown.

#### Decision 1

- Superseded: Django/DRF and Python DBOS were replaced by the TypeScript application (`intake-server`, Fastify 5.12.7, PostgreSQL, DBOS SDK 5.4.0). Celery and Temporal were rejected alternatives; neither is used.
- Kept and specified: web startup never launches workers or inference (`provider-runtime`); migrations are an explicit separate step (`operations-backup-restore`).

#### Decision 2

- Kept: application outbox with stable workflow IDs and full argument comparison; durable conflict dispositions; healthy unrelated work stays dispatchable.
- Built as "fence": an incompatible retained command shows `worker_version_conflict` and needs an explicit fresh attempt; it is never reinterpreted.
- Rejected alternative: same-cursor SQL enqueue (untested in the spike).
- Decision kept: no competing application lease scheduler. The actor lane is a capacity record, not a scheduler.

#### Decision 4

- Built: login checks per route; the dedicated application Codex home; no copied credential stores; children never get the raw runtime exposed to the browser.
- Differs: the API-key route exists as an explicit operator choice for both providers.
- Unbuilt or unverifiable: subscription eligibility and effective billing configuration checks before inference; account-side no-overage guarantees; native sandbox and tool-isolation proof against hostile filesystem mutation. `native-agent/1` stays `native_unverified`.
- Built for research input hygiene: strict JSON (duplicate keys and unsafe numbers refused, `contracts/src/json.ts`), private non-symlinked state directories, exact byte and digest checks on staged media.

#### Decisions 5–7

Owned by `approval-preparation`, `apply-execution` and `live-updates`. Processing-specific notes: preparation questions do not exist as Processing questions; attempt envelope sequences are per attempt and are not UI cursors.

#### Deployment, media and release constraints

Owned by `access-identity`, `capture-media`, `operations-backup-restore` and `inventory-target-protection`. Processing-specific: research and provider children never receive apply or inventory secrets.

### Implementation facts worth keeping

- `native-agent/1` limits: 8 images, 8 MiB combined; frames 256 KiB, output 2 MiB, stderr 128 KiB; 5-minute attempt deadline; 500 ms cancellation poll; 2-second reap deadline (`agents/child.ts`, `agents/monitor.ts`, `agents/prompt.ts`).
- Research limits: 32 calls, 1 concurrent, 256 KiB frame, 2 MiB output, 30 s session, 5 s request, 1 MiB source body, 16 receipts and 4 MiB per attempt, 96 KiB chunk, 2 MiB evidence per session, 2048-byte URL, 16 URLs, 16 DNS answers, 8 protected origins (`research/limits.ts`). Source policy uses `ipaddr.js` 2.5.0.
- Processing limits: 32 KiB envelope, 100 jobs per batch, 240 KiB snapshot and input, 1000 human notes per input (`processing/limits.ts`, `processing/model.ts`).
- The restricted research broker is composed only by test fixtures (`tests/fixtures/research-processing-worker.ts`); no shipped worker entry point runs `restricted-research-stub/1`. Interruption after reap is a library seam (`interruptProcessing`) with no browser control or CLI.
- Untested but code-enforced: `processing_channel_unconfigured`, `processing_capacity` and `agent_home_customizations_refused` have no dedicated tests.

## Experience, delivery and plans

Covers the Bench Intake README, chapters 5, 7, 8 and 9, and the post-spike intake plan. These sources hold UI intent, delivery plans and package research. The UI is now specified by the main `capture-*` and `header-*` specs and by the `redesign-batch-workspace` and `simplify-intake-entry` changes, so this group writes no spec. Verified current behavior that no spec covers is listed at the end for the owning groups.

PR facts come from `git log --oneline origin/interactive-app` at `6952c6c`, and the task-to-PR mapping from the handover titles retained at `2d852e2:docs/handovers/bench-intake-T*.md`. Package outcomes come from `package.json`, `frontend/package.json`, `intake-server/package.json`, `contracts/package.json` and `pnpm-lock.yaml`.

### Bench Intake README

[source](sources/bench-intake/README.md)

#### README: decisions and rationale

- One TypeScript modular monolith with separate process entry points: coherent transactions without a microservice platform. Built as `intake-server` with web, worker, executor, media and operations entry points.
- Stack choices and their outcomes: Fastify with strict runtime schemas (Fastify 5.12.7, TypeBox 0.34.52, AJV 8.20.0); Drizzle over `pg` with reviewed SQL (drizzle-orm 0.45.4, pg 8.16.3); DBOS TypeScript as the durable-runtime candidate (`@dbos-inc/dbos-sdk` 5.4.0, adopted); React/Vite (React 19.3.1, Vite 8.3.5); Sharp for media (0.35.5).
- A separate Bench Intake database and restricted role, not shared with InvenTree tables; inventory is API-only. The operations group owns the verified form of this.
- A serial supervised apply process is the only inventory-write authority. Owned by apply-execution.
- Design principles: start without an upload; preserve originals, physical lots and human decisions; agents propose and humans approve; freeze selected effects before approval; distinguish remote truth, journal knowledge and browser projections; prefer an honest unresolved outcome to an unsafe retry; build only the supported slice.
- Acceptance story: capture two packets, one shared Part, answer a count question, review both, approve only the first, execute against the fake, restart, repair only its attachment, approve the second without duplicates. Delivered across T04 (#46), T05 (#53) and T09 (#58).
- Rejected alternatives: the Python/Django/SQLite-reuse design (kept on `docs/bench-intake-solution-design`), a Python subprocess executor, automatic migration of Python journals and cross-engine coexistence.

#### README: superseded statements

- "Status: proposed, not implemented" and "awaiting Mitch's approval": chapter 8 was approved on 2026-11-01 and T00–T10 have merged.
- The five-view journey (Capture, Processing, Review, Approve, Results) is superseded by four tabs. See `redesign-batch-workspace` `batch-navigation` / Four batch tabs.
- The decisions-table choice of SSE for live updates is superseded by WebSockets (T10 design-alignment decision; `@fastify/websocket` 11.3.6).
- "Application implementation remains paused" and "publish this package directly above `feat/spike-shared-contracts`": obsolete. Consolidation #29 and the design PRs #35, #36 and #38 landed in `interactive-app`.

#### README: unbuilt intent

- InvenTree identity through a qualified supported integration, with workspace load blocked until every permission and delegated scope is verified, and rechecks before privileged actions. The current bootstrap reports `permission_gate: 'deferred_T11'` (`intake-server/src/config.ts`).
- A UI table plus focused phone modes as "concepts to review". The redesign specs define the current UI instead.

#### README: history

- Prepared on 2026-11-01 as a TypeScript duplicate of the Python whole-app design. Stage 1E (#33) merged into the shared-contract branch. Data model #35, TypeScript design #36, plan #38.
- The evidence-versus-proposal table recorded what the spikes proved: Python executor review, provider spike observations, coordinator/adapter spikes and Stage 1E's 44 combined/shared cases against real PostgreSQL. None of it proved a TypeScript runtime. It is a snapshot at 2026-11-01.

### Chapter 5: User experience

[source](sources/bench-intake/05-experience.md)

#### 05: decisions and rationale

- Evidence-first review with a table projection and a focused phone mode; no chat-first shell. Chat-like instruction is one input, not the domain model.
- Wireframes are behavior intent. Generated concepts (layouts A, B and C in `assets/review-layouts.png`) are illustrative: A for evidence-heavy desktop review, B as the bulk table and C's focused pattern for narrow screens.
- The original HTML prototype and its fifteen screenshots (`docs/bench-intake/reference/`) are the primary visual reference, overridden by current contracts.
- Use text and icons as well as colour; blue selection, green confirmed, amber attention, red blocking. The redesign's `ui-design-system` / Screens use the shared components carries the glyph-plus-word rule.
- Prototype pitfalls that became tests: originals survive preview disposal, shared-image edits invalidate all affected reviews, old rounds are not overwritten, no localStorage success timer, no CSS-name collisions, true mobile layout.

#### 05: superseded statements

| Source statement | Superseded by |
| --- | --- |
| Batch workspace has Capture, Processing (Overview, Reading, Identifying, Research, Images, Inventory), Review, Approve and Results | `batch-navigation` / Four batch tabs and Second tab row: Processing is Overview · Examine · Research · Images · Inventory; Approve and Results become Changes › Ready to add and Added; old links redirect (Legacy approval and results links redirect, Legacy processing links redirect) |
| T02: preserve the light/neutral palette; do not switch to dark | `ui-design-system` / Token-driven themes (light and dark, OS default with override) |
| "Retain the separate Approve stage" | `changes-commit` / Ready to add |
| "Maintain all five primary views" on phone | Four tabs; `ui-design-system` / Layout follows the design's widths and breakpoints |
| Processing questions block the job until answered | `processing-stage-pipeline` / Non-blocking questions with assumptions |
| Results as a separate view with round history | `changes-commit` / Added |
| Global activity of queued, running and waiting tasks | `header-workflow-status` / Persistent workflow summary; `agents-overview` / Agents page |

#### 05: differs from implementation

- Capture's per-file local/uploading/retained/failed list with per-file retry: the code takes one file at a time. A selected file stays pending with its request key until retained; a lost acknowledgement keeps the file, revision and key for an exact retry (`frontend/src/components/media/MediaUpload.tsx`).
- Empty-state actions "Take photos, Upload receipt, Describe components, Enter known values": Capture offers Take photos, Add document and Write a note (`capture-grouped-evidence` / Three prominent evidence actions).
- Batch list contents: the home shows a continue card and a compact list with search (`frontend/src/components/batches/Batches.tsx`), not ready/needs-answer/blocked counts per batch.
- Media pipeline "recipe v3": the recipes are `documentary-crop/1` (integer bounds, quarter turns) and `documentary-rotated-region/1` (micro-pixel centre and size, millidegree rotation, optional aspect lock) in `contracts/src/media.ts`.

#### 05: unbuilt intent

- Home and setup: "Sign in with InvenTree"; the blocking page "Your InvenTree account does not have the permissions required to use Bench Intake." with missing capabilities, retry, sign-out and account switch; "Unable to verify access" with retry; return to the blocking state on permission loss. All belong to T11.
- Media: labels separating documentary originals, enhanced images and generated illustrations; generated replacement of documentary evidence (explicitly not in the first slice).
- Settings: identity/access status and missing capabilities; versioned category/parameter mapping configuration showing affected reviews; provider/runner instruction versions with observed capability status; storage usage, backup health and retention settings. Diagnostics exist and are owned by operations-backup-restore.
- Accessibility: WCAG 2.2 AA target, 200% zoom, true 360/390 CSS-pixel viewports and translated-length text. There is no automated browser or axe suite; checks are manual browser-harness runs. The 44px target below `bp-compact` is covered by `ui-design-system`.

### Chapter 7: Reuse, scope and delivery

[source](sources/bench-intake/07-delivery.md)

#### 07: decisions and rationale

- A narrow rebuild, not legacy parity: Python engine and tests stay as behavioral references, not runtime dependencies. Legacy CLI, TUI, scanner and CSV/YAML features are not mandatory app features. Full DigiKey PO booking is deferred; active plans and local data stay in their namespaces.
- First supported effect path: mapped category, parameters and location; explicit Part match or create; separate original stock lots and barcodes; selected photo and document attachments. Each new control needs its own preparation, approval, journal and recovery presentation.
- Explicitly deferred: arbitrary overwrites, historical quantity/location corrections, stock split/merge, PO allocation and receipt, distributed writers and global taxonomy learning. Category, template and company creation, company logos and primary-image replacement stay capability-gated. Verified as `primaryImageReplacement: false`, `categoryTemplateCompanyCreation: false` and `arbitraryOverwrite: false` in `intake-server/src/execution/effects-capability.ts` (CR-15).
- Later additions beyond this scope: supervised creation of new locations and supplier companies with a logo on create (`RECORD_EFFECTS_MANIFEST`, `capture-reference-selection` / New location and supplier intents).
- Provider entitlement must not block capture, manual review or fake apply.
- The fault and product acceptance matrix (27 scenarios, from missing permission to stale browser schema) is acceptance intent. Its non-login rows map to tests owned by approval-preparation, apply-execution, live-updates and operations-backup-restore. The three login rows are unbuilt (T11).
- Remaining decisions: qualify identity claims and refresh, host/provider route, review rules for estimates and unknown manufacturers, exact initial effects and retention. Measure correction effort, time to reviewed subset, question and evidence coverage, interventions and recovery outcomes; promise no throughput or dates. The measurements are unbuilt.

#### 07: history and supersession

- The P0–P6 increments and the publication workflow were superseded by chapter 8's T00–T13 plan.
- The existing-only tag decision was superseded by T09: any tag name, creating missing tags through the native API (`tagCreation: true`).
- Stage 1E #33 and data model #35 merged into `feat/spike-shared-contracts`; consolidation #29 later landed in `interactive-app`.

### Chapter 8: Incremental implementation plan

[source](sources/bench-intake/08-implementation-plan.md)

#### 08: decisions and rationale

- First milestone: a persistent manual browser journey against an owned fake InvenTree. Reduce breadth, never authority quality: real HTTP, PostgreSQL, immutable approved bytes, a persistent fake and supervised processes from the first apply slice.
- The protected-target rule: the real InvenTree server identified by the root `.env` is read-only for the initiative. Writes go only to owned fakes or a separately designated disposable server. Enforced in `intake-server/src/inventory/transport.ts` (CR-3).
- Single-operator development-key mode until T11: a server-configured actor, credential reference and fixed target; never accept an actor, target URL or key from the browser. Loopback-only, configured origin and Host, CSRF on mutations and a visible development banner. Verified (CR-1, CR-2).
- Shared local development services: reuse a compatible owned PostgreSQL service with per-task databases and record it in a service ledger (`intake-server/README.md#shared-development-service-ledger`); no global prune or duplicate stacks.
- Roughly 3,500 added lines per PR is a loose guideline, never a reason to delete tests or safety. At most five concurrent implementation owners.
- A merged PR is not proof of native provider support or permission for a live pilot.

#### 08: superseded statements

- "Do not test with actual agent/LLM models or consume provider usage": lifted for `simplify-intake-entry` task 13, run under explicit authorization on 2026-11-07 (#118). Claude passed every check except status cadence (partial); Codex failed the tool-only allowlist and identity proposals. `native-agent/2` keeps `native_unverified`. Stub-only tests remain the default.
- T01's "minimal isolated disposable InvenTree profile": delivered by `local-inventree-dev` (#105, BI-009) as a fixed loopback target (`intake-server/tests/dev-target.test.ts`).
- T06 "one research lane per account": superseded by session slots (`processing-agent-sessions` / Waiting does not hold capacity).
- T07 "choose the first route; do not promise both providers": both Claude and Codex sessions are integrated (#67; `simplify-intake-entry` PR-A #97; `intake-server/src/agents/claude.ts`, `codex.ts`).
- T08 processing views Reading and Identifying: replaced by Examine (`processing-stage-pipeline` / Examine stage and parallel successors).
- T10 SSE: replaced by a versioned WebSocket projection channel with polling fallback.
- The owner, reviewer and merge protocol (fresh owners, `docs/handovers/bench-intake-TNN.md`, ready-PR-before-local-review): replaced by the OpenSpec change workflow and `retire-handover-documents` (#114).
- T02 "update frontend architecture; light palette": the palette was superseded by the redesign themes.

#### 08: unbuilt intent

- T11: qualify the InvenTree identity route, stable subject and API-user binding, complete permission and delegated scope discovery, refresh and revocation; server-side encrypted credential references; distinct sign-in-required, missing-capability and access-unverified pages; rechecks on approval, dispatch, privileged sends, evidence access and long-lived streams; session rotation, expiry and logout tests; never fall back to the development key after delegated denial. No PR exists.
- T12: rerun the chapter 7 fault matrix through TypeScript public interfaces with browser evidence; read-only comparison of the fake contract with the deployed InvenTree version; a release record stating that no production writes occurred. No PR exists.
- T13: independent second-provider qualification and measured improvements. Partly overtaken (both providers are integrated but unqualified); a bounded T13 scope was never agreed.
- Trusted phone access before login through a reviewed restricted authenticated transport. Not built; the server refuses any non-loopback origin.

#### 08: history

| Task | Delivered by | Notes from the plan and the log |
| --- | --- | --- |
| T00 | #39 (`0134e1b`), follow-up #40 (`1ed4d09`) | Optional, path-aware CI. Later #99 stopped running the PostgreSQL and process tiers in CI. |
| T01 | #41 at `b0e1fe7` | Executable foundation; 18 selector tests; root `.env` not read. |
| T02 | #45 | Persistent manual capture workspace. |
| T03 | #42 at `8ae745c` | Narrow safe stock executor; only `owned-fake-stock/1` qualified; InvenTree 1.5/API 530 lacked the writable stock-create barcode profile. |
| T04 | #46 | Exact manual approval and fake results; at most ten selected lots; bounded polling. |
| T05 | #53 | Retained evidence and approved media attachments. |
| T06 | #54 | Durable processing and pinned human questions. |
| T07 | #56 | Restricted evidence and research broker with fixtures (stub only). |
| T08 | #55, then #59 and #64 | Operator review and safe draft recovery; mockup alignment. |
| T09 | #58 | Supported Part effects and original-run recovery. |
| T10 | #61 | Live projections and quarantined recovery. |
| T11–T13 | none | Not started as tasks. |

Waves ran as planned: 0 (T00, T01), 1 (T02, T03), 2 (T04), 3 (T05, T06), 4 (T07, T08, T09), 5 (T10). The approved package refinements landed as separate PRs (see below), as did masthead animation #52 and readable-structure tooling #49.

#### 08: package adoption outcome

- React Hook Form for substantive field editing: adopted (7.91.0, #48).
- Drizzle for ordinary domain queries, keeping explicit SQL for locking: adopted (#47, #57, #60, #62, #63).
- TanStack Query for reads and polling: adopted (`@tanstack/react-query` 5.105.1, #51). OpenAPI-generated typed clients: adopted (`openapi-fetch` 0.17.0, #50).
- Execa for decoder process plumbing: not adopted (absent from every `package.json`).
- Crop interaction: Moveable adopted (`react-moveable` 0.56.0, `frontend/src/components/media/RotatedCropSelection.tsx`): the base image stays fixed, only the frame rotates, with optional aspect lock and numeric fields (`MediaCropFields.tsx`). React Image Crop was approved, then superseded before UI adoption, and is absent. The additive `documentary-rotated-region/1` recipe preserves `documentary-crop/1` (CR-11).

### Chapter 9: Package candidates

[source](sources/bench-intake/09-package-candidates.md)

#### 09: package research outcome

| Phase | Candidate | Outcome (lockfile and `package.json`) |
| --- | --- | --- |
| T07 research tools | `@modelcontextprotocol/server` | Adopted, 2.4.0, with `@modelcontextprotocol/client` 2.4.0 and `@modelcontextprotocol/node` 2.1.2 (session tool server, `simplify-intake-entry` D2) |
| T07 source fetching | `ipaddr.js` | Adopted, 2.5.0 (`intake-server/src/research/source-policy.ts`); DNS pinning and redirect refusal stay app policy (CR-16) |
| T08 navigation | React Router | Not adopted; custom hash routes and guard (`frontend/src/navigation/batch-route.ts`, `useNavigationGuard.ts`, including `beforeunload`) |
| T08 operator tables | TanStack Table | Not adopted; custom `frontend/src/components/ui/DataTable.tsx` with `BulkBar` |
| T08 rich pickers | React Aria Components | Not adopted; custom `SearchableReferencePicker.tsx` and `@radix-ui/react-popover` 1.3.1 |
| T10 live updates | `@fastify/sse` | Not adopted; WebSocket via `@fastify/websocket` 11.3.6 and `ws` 8.22.1 |
| T10 operations | Fastify/Pino plus `@fastify/under-pressure` | Not adopted; the API server runs with `logger: false` (`intake-server/src/api/server.ts`); readiness is app code (`intake-server/src/operations/readiness.ts`) |
| T11 sessions and identity | `@fastify/session`, `openid-client` | Not adopted (T11 unbuilt) |
| T12 browser and accessibility | Playwright Test, `@axe-core/playwright` | Not adopted |
| T12 edge cases | `fast-check` | Not adopted |

- Adoption priority named TanStack Table and React Aria as the clearest wins and React Router as needing a bounded assessment; none were taken up.
- Reuse rather than add: T09 extended Drizzle, DBOS and the executor; no second workflow engine, in-memory queue or generic retry package exists.
- Native-provider integration: choose the Codex route (SDK versus App Server) on product requirements; MCP tools and application questions are different interfaces; native permission handles are transient. The "no usage" rule was later lifted for the authorized run (see 08: superseded statements).
- The source lists the primary documentation links read during the assessment; current docs are not proof of compatibility.

### Intake revised delivery plan

[source](sources/intake/plan.md)

#### intake plan: history and supersession

- The plan (2026-11-01) is superseded by the TypeScript design and chapter 8 for scheduling and stack. Its approval, source-identity and uncertainty requirements carried forward.
- Django, DRF and the reuse of the Python engine behind an adapter (Stages 2 and 5) are superseded by the Fastify server and a new TypeScript executor.
- Delivery history: Stage 0 restructuring #21; shared contracts #22; runtime spike #23; importer adapter #24; durable coordination #26; reconciliation #27; tooling #25 and #28; consolidation #29; Stage 1E combined seams #33. The spikes now live in `C/spikes/`.
- Stage findings kept as evidence: 1B proved an application outbox, full payload/version binding, crash/redelivery and lane release on human waits. 1C proved engine reuse without relaxing unknown-write protection. 1A was partial: Codex used PNG plus PDF text extraction, Claude saw PNG and native PDF without continuation or cancellation parity.
- Stages 2–5 were delivered under other names: Stage 2 as T02 (#45), Stage 3 as T06/T07 then `simplify-intake-entry`, Stage 4 as T04/T05/T08, Stage 5 as T03/T04/T09.
- Stage 6: operations delivered as T10 (#61); second provider integrated but unqualified; the pilot is prohibited by the protected-target rule.
- The fault-matrix "remaining release requirement" column carries into chapter 7's acceptance matrix and T12. "Backup predates remote effects" was unproved here and later exercised in T10 (`intake-server/tests/process/operations.test.ts`, "older coherent restore cannot repeat its later remote create").

### Candidate requirements for other capabilities

Each candidate is verified current behavior that no main spec or active-change spec covers. The owning group should adopt it only if its own sources do not already produce it, and should recheck the requirement name for uniqueness.

#### CR-1 access-identity: Development-mode request admission

- **Draft requirement.** The application SHALL serve only its configured loopback HTTP origin, MUST refuse requests whose Host or Origin differ from it, and MUST refuse every non-GET, HEAD or OPTIONS request that lacks the per-process command token from bootstrap or arrives while the server is not configured.
- **Scenario.** GIVEN a configured server on `http://127.0.0.1:4310`; WHEN a POST arrives with a different Origin or without the `x-intake-csrf` token; THEN it is refused with `access_denied` and nothing is written. Edge: an `INTAKE_ORIGIN` that is not `http://127.0.0.1` fails startup with `loopback_origin_required`.
- **Proof.** `intake-server/src/config.ts` (`devConfig`), `intake-server/src/api/server.ts` (`onRequest` hook), `intake-server/tests/api.test.ts` ("bootstrap stable attribution, safe missing-key state, redaction, Host/Origin and mutation refusal"), `intake-server/tests/pg/live.test.ts` ("WebSocket rejects cross-origin upgrades, bad authorization…").

#### CR-2 access-identity: Server-configured development identity

- **Draft requirement.** Bootstrap SHALL report the single-operator development mode, its banner text, the server-configured actor, target and target context, and `setup_required` when no key or credential reference is configured; it MUST NOT claim a verified human session or a completed permission gate.
- **Scenario.** GIVEN no development key; WHEN the browser reads bootstrap; THEN status is `setup_required`, no command token is issued, `permission_gate` is `deferred_T11`, and the masthead shows "Dev mode".
- **Proof.** `intake-server/src/config.ts` (`bootstrap`), `contracts/src/index.ts` (banner literal), `frontend/src/components/masthead/Masthead.tsx` (`DevBadge`), `intake-server/tests/api.test.ts`.

#### CR-3 inventory-target-protection: Protected origins refuse writes before transport

- **Draft requirement.** The inventory transport MUST refuse, before sending, any write to a protected origin or its aliases, any redirect, any mismatched target binding and any non-allowlisted read operation; owned disposable targets SHALL receive each write exactly once.
- **Scenario.** GIVEN a protected origin configured as a controlled sink; WHEN an approved write or a redirect would reach it; THEN the call is refused before transport and the sink records no request.
- **Proof.** `intake-server/src/inventory/transport.ts`, `intake-server/tests/transport.test.ts` ("protected loopback spellings deny before transport…", "owned disposable writes exactly once; redirects never reach protected controlled sink").

#### CR-4 approval-preparation: Approval binds the exact preparation and adopts duplicates

- **Draft requirement.** Approval SHALL succeed only when the submitted plan digest, review fingerprint, target revision and selected lots match the retained preparation and the current material, reviews and plan still equal it; a repeated approval of the same preparation by the same actor SHALL return the original approval and run.
- **Scenario.** GIVEN an approved preparation; WHEN approval is submitted again; THEN the same `run_id` and `approval_id` are returned and no new round starts. Failure: a shared edit after preview yields `stale_preparation`; a mismatched digest or scope yields `approval_binding_mismatch`.
- **Proof.** `intake-server/src/review/preparations.ts` (approval path, `idempotent` in `intake-server/src/db/authority.ts`), `intake-server/tests/pg/manual.test.ts` ("selected fingerprints exclude B-only changes but reject shared edits…").

#### CR-5 approval-preparation: Selected scope limit

- **Draft requirement.** A preparation scope SHALL name between one and ten unique lots, with the batch revision it was prepared against.
- **Scenario.** GIVEN eleven ready lots; WHEN all eleven are submitted; THEN the request is rejected at the public boundary.
- **Proof.** `contracts/src/manual.ts` (`selected`, `ManualScope`).

#### CR-6 approval-preparation: Warnings need a reasoned dismissal

- **Draft requirement.** Marking a lot reviewed MUST be refused while a warning is unresolved; a warning SHALL be dismissible only with a reason and its current dependency digest, the dismissal SHALL survive restart and go stale when the facts change, and blocking issues MUST NOT be dismissible.
- **Scenario.** GIVEN a lot with a `no_supporting_evidence` warning; WHEN review is requested; THEN it fails with `warning_unresolved`; after a reasoned dismissal it succeeds. Failure: an old digest yields `stale_issue`; `quantity_required` yields `issue_not_dismissible`.
- **Proof.** `intake-server/src/operator-review/routes.ts` (`issue-dispositions`), `intake-server/tests/pg/operator-review.test.ts` ("warnings gate review until a reasoned dismissal…"), `intake-server/tests/operator-review-model.test.ts`.

#### CR-7 capture-records: Review invalidation follows shared scope

- **Draft requirement.** A review SHALL bind the lot's current dependency material; editing shared Part data SHALL invalidate the reviews of every lot sharing it, while lot-only and default edits invalidate only affected lots, and an edit preview SHALL report the impact without writing.
- **Scenario.** GIVEN reviewed lots A and B sharing a Part; WHEN B's quantity is previewed and then saved; THEN the preview names only B, writes nothing, and after saving only B is no longer reviewed; a shared Part edit unreviews both.
- **Proof.** `intake-server/src/operator-review/review-state.ts`, `intake-server/src/operator-review/impact.ts`, `intake-server/tests/pg/operator-review.test.ts` ("shared Part edits invalidate A and B; lot-only and default edits stay scoped").

#### CR-8 capture-records: Atomic bulk lot edits

- **Draft requirement.** A bulk edit SHALL apply to every named lot or none, keep selections of unnamed lots and exact strings, and MUST be refused on a stale batch revision.
- **Scenario.** GIVEN three lots and a stale revision; WHEN a bulk quantity edit is submitted; THEN nothing changes and a revision conflict is returned.
- **Proof.** `intake-server/tests/pg/operator-review.test.ts` ("bulk edits are atomic, keep unnamed selections and exact strings, and reject stale revisions").

#### CR-9 capture-records: Lot restructuring keeps lineage

- **Draft requirement.** Split, merge and move SHALL preserve lineage and retirement revisions, MUST refuse retired lots and lots whose original contribution is approved, and previews SHALL report preparations they make stale.
- **Scenario.** GIVEN a lot whose contribution was approved; WHEN it is split; THEN the command is refused and the lot is unchanged.
- **Proof.** `intake-server/tests/pg/operator-review.test.ts` ("previews report stale preparations; split, merge and move keep lineage…", "restructuring refuses a lot whose original contribution is approved", "merge preserves exact lineage…").

#### CR-10 capture-records: Batch list search and archive

- **Draft requirement.** The batch list SHALL search retained server state by text with offset paging, exclude archived batches unless requested, and archived batches MUST refuse edits other than unarchiving.
- **Scenario.** GIVEN an archived batch; WHEN the list loads without "Show archived"; THEN it is hidden; when an edit is attempted, it fails with `batch_archived`.
- **Proof.** `intake-server/src/capture/routes.ts` (`batch_archived`, search), `frontend/src/components/batches/Batches.tsx`, `frontend/src/components/batches/Batches.test.tsx`, `intake-server/tests/pg/capture.test.ts`.

#### CR-11 capture-media: Versioned crop recipes

- **Draft requirement.** A derived image SHALL record either `documentary-crop/1` (integer source-pixel bounds on the orientation-normalized page, quarter turns) or `documentary-rotated-region/1` (micro-pixel centre and size, millidegree rotation, optional aspect ratio and output dimensions that must match the region), and retained recipes MUST NOT be reinterpreted.
- **Scenario.** GIVEN a rotated region whose output size does not round from its width and height; WHEN it is submitted; THEN it is rejected with `invalid_rotated_region_dimensions`.
- **Proof.** `contracts/src/media.ts`, `contracts/src/media-geometry.ts`, `frontend/src/media/crop-model.ts`, `frontend/src/components/media/MediaCropDialog.test.tsx`, `intake-server/tests/process/media-decoder.test.ts`.

#### CR-12 capture-media: Upload admission and decode states

- **Draft requirement.** Photo upload SHALL accept nonempty JPEG or PNG and document upload nonempty PDF, each up to 20 MiB, with photos opening the rear camera where supported; decoding SHALL report `ready`, `unsupported`, `encrypted`, `malformed`, `limit_exceeded` or `interrupted` distinctly, with at most 30 pages.
- **Scenario.** GIVEN a 21 MiB photo; WHEN it is chosen; THEN the browser refuses it before upload and other evidence is unaffected; an encrypted PDF is retained but shown as encrypted.
- **Proof.** `frontend/src/components/media/MediaUpload.tsx`, `frontend/src/components/media/MediaUpload.test.tsx`, `contracts/src/media.ts` (`MEDIA_SOURCE_MAX_BYTES`, `MediaDecodeState`), `intake-server/tests/process/media-decoder.test.ts`.

#### CR-13 live-updates: Unverifiable status disables commands

- **Draft requirement.** When the application cannot verify current state, the workspace SHALL keep showing the last retained snapshot, say that status is unavailable and disable commands; live hints SHALL suppress idle polling while connected, and polling SHALL resume after disconnect without replacing drafts.
- **Scenario.** GIVEN Changes open and the socket drops; WHEN the next read fails; THEN "Status unavailable. Showing the last retained snapshot" appears, commands are disabled and unsaved input is kept.
- **Proof.** `frontend/src/components/review/ManualWorkspace.tsx`, `frontend/src/components/processing/ProcessingWorkspace.tsx`, `frontend/src/components/operations/LiveUpdates.tsx`, `frontend/src/LiveUpdates.test.tsx`, `intake-server/tests/pg/live.test.ts`.

#### CR-14 processing-coordination: Superseded questions refuse answers

- **Draft requirement.** An answer to a question that is superseded or whose saved context changed MUST be refused, and the UI SHALL keep the unsaved answer without applying it to another question.
- **Scenario.** GIVEN a question superseded by a newer attempt; WHEN its answer is submitted; THEN the server returns `stale_question` (412) and the answer text stays in the form.
- **Proof.** `intake-server/src/processing/answers.ts`, `frontend/src/components/processing/QuestionAnswer.tsx`, `intake-server/tests/pg/processing-dependencies.test.ts` ("a stale predecessor question cannot mutate capture…").

#### CR-15 apply-execution: Supported-effects capability manifest

- **Draft requirement.** Preparation SHALL plan only effects the versioned capability manifest supports (Part create, mapped category and parameters, manufacturer and supplier parts, stock, Part and stock attachments, tags on new Parts including creating missing tags, and under `/2` new locations and supplier companies), and an unsupported requested effect SHALL become a typed issue, never a silent omission.
- **Scenario.** GIVEN a media-only deployment; WHEN a Part attachment is selected; THEN preparation reports a typed issue and plans no attachment.
- **Proof.** `intake-server/src/execution/effects-capability.ts`, `intake-server/tests/pg/supported-effects.test.ts` ("a Part attachment on a media-only deployment is a typed issue, never a silent omission"), `intake-server/tests/effects-plan.test.ts`.

#### CR-16 research-broker: Source fetch admission

- **Draft requirement.** Research source fetching MUST refuse private, mapped, reserved, malformed and protected destinations, refuse mixed DNS answers, pin one public address, and never follow or retry a redirect.
- **Scenario.** GIVEN a URL resolving to both a public and a private address; WHEN it is fetched; THEN it is refused before any request is sent.
- **Proof.** `intake-server/src/research/source-policy.ts`, `intake-server/tests/research-source.test.ts`.
