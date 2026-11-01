# T04 — exact manual approval and supervised fake results

## Prospective plan

Recorded before implementation on 2026-11-01. This owner starts at merged `interactive-app` commit `e9f5e12af012e19f89060a45af50f266928ef81d` after T02 capture, T03 executor and both readability tasks. The coordinator owns independent review and merge; this owner may publish a ready non-stacked PR only.

### Outcome and boundaries

Deliver the first complete manual browser journey: capture two distinct lots sharing an existing Part, select and review only A, approve exact server-retained effects, dispatch through a separately started supervised fake-only runner, restart and read truthful results, then approve B without duplicating A.

Only `owned-fake-stock/1` is supported. The actual InvenTree profile remains unsupported and the original repository environment's inventory is strictly read-only. No test loads that environment, copies inventory/provider credentials, or sends the real server any request. No uploads, inference, login, broader effects, SSE, production deployment or Python execution is included.

### Sources, existing seams and ownership

Read the complete approved implementation plan, T01/T02/T03 records, current guidelines/architectures/testing, review/execution/identity/transaction models and original design references. Existing qualified seams are strict TypeBox/AJV contracts, canonical bytes, payload-bound `idempotent`, commit-ordered `appendEvent`, capture repositories, executor reservation/history/snapshot/recovery, DBOS delivery and `startApply`.

Own migration `0004_manual_review.sql`, `intake-server/src/review/`, review tests/fixtures, additive capture/executor public seams, contracts/generation, explicit runner setup/entrypoints, frontend Review/Approve/Results components and owning architecture/plan updates. Shared contracts/root manifests/lock/CI integration is assigned to this owner. Preserve migrations 0001–0003, original HTML/15 PNGs and canonical vectors byte-for-byte.

### Public interfaces and authority

- Export a capture-owned transaction-bound snapshot/materialization seam scoped to server actor/target/context. Consumers do not reach into capture SQL.
- Add executor-owned source locking/history inspection. Commands acquire idempotency → target → source guard → batch/selected dependencies → run → stream locks; no network runs under those locks.
- Retain immutable per-subject review fingerprints, successful preparations, selected lot/review bindings, exact plan bytes/digest and approval-to-original-run links. Selected Part dependencies never pull in unselected lot stock.
- Preparation publishes only after complete semantic target reads and a second dependency/history check. Approval validates exact digest/review/target binding, then commits domain approval, executor reservation, original command/outbox and event together.
- Native source enrollment is a migration-owned constrained trigger. It derives the original key only from retained `capture_source.id`, exact `native_batch:<id>` namespace, creator and batch binding. Fixed safe search path, schema-qualified references and revoked public execution prevent a general privileged enrollment API. Existing mappings are checked, never silently replaced; backfill validates every retained native binding.
- Keep source-owner, API approval, scheduler and apply grants distinct. API commands record bounded durable dispatch/cancellation/recovery requests. Only the separately launched runner/supervised child receives an owned fake mutation profile; web imports/startup never fork apply.
- Poll snapshots use one repeatable-read view of journal-derived outcomes and stream cursor. Journal changes append their projection event in the same PostgreSQL transaction. Unknown effects and original-output identities remain visible; no replacement-stock or broad retry action exists.

### Alternatives and package rationale

Retain pinned Fastify/TypeBox/AJV, pg/Drizzle, DBOS and styled-components. No new framework or dependency is needed for this slice. Existing public package APIs and actual versioned declarations/tests govern integration; do not infer current web-documentation parity.

A generic idempotency plugin cannot atomically bind these domain/executor rows. A generic retry wrapper cannot resolve uncertain COMMIT or remote effects. Reuse the qualified executor transaction behavior for shared transactions, retaining error propagation and no automatic retry.

Manual source enrollment after every browser-created batch would make the basic journey incomplete. Giving approval/apply raw enrollment grants would erase the source-owner boundary. The constrained capture trigger derives only already-retained native lineage and is narrower than another privileged runtime credential or generic enrollment endpoint.

Use DBOS's public workflow registration/enqueue/inspection for durable delivery, while existing non-expiring host claims and dedicated writer connection remain physical authority. No scheduler table internals, expiring physical leases or automatic stranded-claim removal are introduced.

React keeps native explicit forms and polling with cleanup; no routing/state framework is justified. Each new component has its own TSX file under `frontend/src/components/`, with module-scoped styled-components and transient styling props. Preserve the current light/neutral/blue palette and original Review/Approve/Results hierarchy within the deliberately small supported slice.

### Implementation sequence

1. Add native lineage bridge and immutable review/preparation/run/dispatch authority, exact-parent constraints, grants and public scoped materialization/history seams.
2. Add strict DTOs/client routes and domain commands: review, read-only preparation, exact approval, start/adopt, polling, cancellation and selected original-run safe recovery.
3. Register a separately started bounded runner using public DBOS delivery and supervised apply. Add same-transaction journal/projection events without exposing mutation credentials to the web process.
4. Extend the five-stage browser workspace with manual Review, Approve and Results, honest fake capability/activity and exact selected/remaining scope. Processing stays unavailable.
5. Qualify actual HTTP/PG/process/browser journeys and adverse boundaries; update architectures, plan and this record, including the inherited architecture wording nit.
6. Commit/push a ready PR directly to `interactive-app` and return its exact head. Independent review and task merge remain coordinator gates.

### Independent verification

Use the existing owned PostgreSQL service with random isolated databases/roles and a persistent fake with independently inspected wire/effect records. No duplicate PG or shared service restart/fault is permitted. The retained 4310 capture preview is another owner's process; request a distinct owned preview namespace before browser checks.

Verify literal selected IDs/quantity/location/barcode bodies and exact stock POST counts, rather than deriving expectations through the implementation encoder. The main journey requires one POST for A, restart/adoption with no additional POST, one later POST for B, then zero replacement POSTs after deletion of A's confirmed stock.

Exercise duplicate/different-key approval adoption, changed-payload conflict, stale selected/shared dependencies, unselected-lot isolation, foreign actor/context/parent bindings, immutable bytes/rows, restricted roles and temporary-schema shadow attempts. A plausible negative mutation of a selected-scope/freshness guard must fail an unchanged regression before restoration.

Exercise approval commit before enqueue, actual COMMIT-ACK loss with stable authority inspection, result publication loss, cancellation, original pending/no-effect selected recovery and unknown A blocking B. Preserve all merged executor HTTP421, surviving-child, no-effect verification and restore-witness tests. Inspect actual desktop/narrow/conflict/results renders and keyboard/overflow behavior through browser-harness with recording disabled.

Run frozen install, generation drift, complete types, frontend lint/tests/build, fast contracts/server, real PG/process, formatter/hooks and changed selector checks. Run the normal workspace suite as required; report skips and historical versus fresh results explicitly. No scanner behavior changes are planned.

## Decisions and evidence

No implementation or qualification is claimed yet. The sections above are prospective. Later entries will record actual package contracts, plan adjustments, observed/fixture-only/not-tested boundaries, commands and independent-review fixes without rewriting chronology.

### Early implementation checkpoints

The first additive migration passed the existing 19 PostgreSQL cases. The new actual HTTP/PG manual journey then passed with 21 cases: selected A made exactly one supervised stock POST, restart recalled its original result, later B made the second POST, and deleting A's fake stock did not permit replenishment. Different-key approval replay after a draft edit recalled the same original approval/run.

The expanded PG tier passed 24 cases, adding unavailable/stale preparation reads, restricted enrollment, temporary-table shadow resistance, exact batch/stream constraints, immutable rows, unknown A blocking B, and original pending recovery. These are controlled fake/PG observations, not browser or real inventory qualification.

The first actual web/DBOS process run passed eight of nine cases. Its failing assertion compared a confirmed result before the supervisor's final dispatch receipt committed: the stock was confirmed at revision 10, then the independently reaped/finished dispatch advanced it to revision 11. The test now waits for both confirmed journal state and the finished dispatch before asserting a stable restart snapshot; no runtime guard or expected effect count was weakened.

Installed DBOS 5.4.0 declarations provide `workflowID`, public registration/client inspection and `runStep` with `retriesAllowed: false`. The explicit runner uses these; an already claimed dispatch is inspection-only on scheduler recovery. An interrupted physical owner remains recovery-required, never a safely retryable create. Full process qualification is still pending the corrected run.

PG/process test files now run serially through the existing Node runner, preserving explicit within-test concurrency cases. This bounds shared connection pressure rather than increasing the sole PG service's 40-connection/256 MiB allocation. The T02 4310 preview remains untouched. The coordinator approved a separate small T04 preview on unused loopback 4330 because its owned fake needs stock behavior and an isolated retained namespace.

## Implemented boundary and decisions

T04 implements the basic manual/fake milestone. It introduces no dependency or broader inventory effect. The coordinator approved ten selected lots as a reversible first-slice limit, the constrained native-source bridge, and a separate small preview namespace on 4330. Mitch’s original HTML/direct screenshots and styled-components/component-file instructions govern the UI; the current light/blue palette remains.

### Public contracts and migration

| Owner      | Implemented seam                                                                                                                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture    | `captureInTransaction(client, binding, batchId, lock)` returns its scoped retained snapshot, original native source and stream. No caller-selected alias is accepted.                                                                                                                                                                              |
| Executor   | `lockStockSource`, `stockSourceHistory` and `stockDeployment` expose source guards, cumulative history and qualified deployment lookup. `loadRun.planDigest` exposes the verified retained digest; `grantExecutor` owns the read-only delivery grant. `reserveApprovedStock` still receives exact retained bytes/digest in the caller transaction. |
| Manual API | GET activity/workspace/original run; POST review/preparation/approval/start/cancel/recover. All use strict runtime DTOs, fixed server actor/target/context, existing Origin/CSRF and payload-bound idempotency.                                                                                                                                    |
| Runner     | Explicit `apply:manual` process, private config, public DBOS workflow/client, original command binding and supervised physical apply. No web import or autoreload starts it.                                                                                                                                                                       |
| Browser    | Generated `manualClient`; separate Review/Approve/Results components, actual polling/certainty, exact included/excluded lot scope and original-round links. Processing remains unavailable.                                                                                                                                                        |

Migration 0004 is additive; 0001–0003 are unchanged. Exact composite parents bind batch/actor/selected lot/source/contribution/review/preparation/approval/run/stream. Immutable authority rows retain bytes/digests. Journal/dispatch projection events update the original run revision and owning stream in the same transaction. Snapshot and cursor use one repeatable-read view.

The source bridge is narrow source-owner authority, not generic approval enrollment. A migrator-owned trigger derives only the retained native ID/namespace/creator; all relations are schema-qualified with fixed `pg_catalog` search path and revoked PUBLIC execution. Runtime API/apply cannot enroll sources, alter the function or obtain owner privileges. Upgrade tests replay pre-0004 capture and prove valid identity preservation plus namespace/actor/original-key conflict refusal.

Approval first checks the exact retained preparation and payload. A previously committed approval recalls its original run even after a draft edit or fake deletion. A genuinely new approval locks target → source guard → batch/dependencies → executor run → stream, rechecks selected/shared facts, current reviews, deployment and cumulative history, then atomically commits domain approval, executor reservation/run, original command/outbox, event and idempotency result. Network never runs while those locks are held.

Preparation separately commits each actual read intent before sending and a bounded result afterwards. Up to twenty distinct Part/location reads run three at a time within thirty seconds overall; per-read ceiling is ten seconds, while the transport/body adapter is stricter. Missing/denied/incomplete reads block preparation. Replays of an incomplete command never pretend absence or a successful plan.

The shared transaction helper now retains the qualified executor borrowed-client socket-error listener and discards broken connections. It propagates uncertain COMMIT without retry. The old `executorTransaction` public export delegates to this same helper. Actual TCP ACK-loss tests discriminate committed original authority from a failed request; no generic retry wrapper was added.

A claimed dispatch is inspection-only after scheduler recovery, because its physical owner may remain alive. An interrupted dispatch is recovery-required even if no effect is yet confirmed. Safe selected recovery requires the original run and server-advertised eligibility. Unknown creates block later contributions; there is no create-again, replacement-stock, retry-all, expiring host claim or stranded-owner clearing command.

### Deliberate limits

- Only `owned-fake-stock/1`; actual InvenTree 1.5/API530 mutation remains unsupported and the protected server is strictly read-only.
- Existing Parts and new stock only; no uploads, providers, login, SSE, broad inventory search, attachments or Python integration.
- Ten selected lots per command, at most twenty recent unapproved preparation candidates, at most one hundred activity candidates with explicit truncation, and complete workspace capacity errors instead of partial success.
- Development attribution is not a verified human session. Final authentication/access, deployment provisioning, broader backup/restore operations and complete accessibility/release qualification remain later tasks.

## Final qualification

### Observed actual boundaries

The real PG tier passes **27/27**, zero skips. It includes original A/B scalar wire bodies, no replenishment after deletion, stale shared versus unrelated lot edits, unavailable/in-flight stale reads, missing retained indexes/receipts, restricted grants/temp shadows, exact batch/stream parents, upgrade/backfill conflicts, cancellation, unknown A blocking B and scheduler no-relaunch.

The actual process tier passes **9/9**, zero skips. It includes public DBOS delivery, approval-before-enqueue, web/fake/runner restart, original IDs, TCP domain/intent COMMIT-ACK loss, physical intent/result checkpoint loss, surviving physical child/host exclusion, and original no-effect recovery through the manual API with exactly one create. Existing T03 HTTP421 single-send and external restore-witness tests remain green in their owning fast/PG tiers.

The negative control changed selected materialization to include all batch lots. The unchanged A-only regression failed at its literal selected-ID assertion (an extra original lot appeared). The original model bytes were restored in `finally`; the restored full tier passed. The first corruption fixture also encountered a valid FK before its intended missing-index check; it now removes only the shared-Part review index, preserving dependent lot parents and proving the application’s retained-index guard separately.

Browser-harness exercised actual built React → API → PG → explicit DBOS runner/supervisor → persistent fake with recordings disabled. At 1440 px and 390 px it inspected Review’s queue/evidence/choices, exact included/excluded approval effects, and original Results rounds. No horizontal overflow was observed at 390 px. On the final build, focused evidence received focus; narrow back navigation returned focus to the queue and Tab reached Inspect Packet B with a visible focus ring. The [keyboard capture](../bench-intake/evidence/T04/keyboard-narrow.png) records that check. A background-tab mouse timeout after web restart was resolved by identifying and activating only the exact T04 target; no other tab or T02 fixture changed.

### Browser counts and retained evidence

| Step                  | Independent observation                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A only                | One reused Part29, A17 at43, B excluded; one POST, stock7101, original run `012415aa-c691-4781-a844-ac883191c78a`.                                                          |
| Web restart           | Browser reloaded the same original run/confirmed stock; no additional POST. Full fake/runner restart is additionally process-qualified.                                     |
| Later B only          | B23 at48, A excluded; cumulative two POSTs, stock7102, original run `b15d5301-246e-43f1-8316-95561cc7c18b`.                                                                 |
| Delete A’s fake stock | Only stock7102 remains; cumulative POST count stays two. Review disables A and links its original run. Historical confirmation is not rewritten as permission to replenish. |

Tracked browser images: [Review desktop](../bench-intake/evidence/T04/review-desktop.png), [Review narrow](../bench-intake/evidence/T04/review-narrow.png), [Approve desktop](../bench-intake/evidence/T04/approve-desktop.png), [Approve narrow](../bench-intake/evidence/T04/approve-narrow.png), [Results desktop](../bench-intake/evidence/T04/results-desktop.png), [Results narrow](../bench-intake/evidence/T04/results-narrow.png), [consumed A blocked](../bench-intake/evidence/T04/consumed-A-blocked.png).

Independent exact POST bodies/scalar stock before and after deliberate fake deletion are [retained before](../bench-intake/evidence/T04/receipts-before-deletion.json) and [after](../bench-intake/evidence/T04/receipts-after-deletion.json). Their original barcodes use source `6b3673de-801d-45e9-bd4e-8830616c71ef`, A contribution `456f2af2-181c-4649-86b9-c0b28b95e385`, B contribution `863a20d4-9b18-464e-a335-c098491ba790`. These are synthetic fixture identities, not inventory credentials.

Unknown/stale/cancelled UI command behavior is component-tested with labeled fixtures; the actual browser happy path/deletion block above is separately observed. No actual InvenTree request or mutation, full accessibility audit, provider support or production deployment is claimed.

## Live review fixture

Snapshot: 2026-11-01 11:26 UTC; refresh ignored `.amp/in/artifacts/T04-preview.json` and listeners before acting. These safe identifiers may change. Preserve the T02 preview on 4310 and every existing worktree/change.

| Resource          | Current ownership/state                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared PG         | Sole `bench-intake-dev-pg`, postgres17, loopback55432; 40 connections/256 MiB. No duplicate container or shared migration/restart.         |
| T04 parent / fake | PID95975, controlled fake listener `127.0.0.1:62282`; holds its own persistent PG-backed receipts/stock.                                   |
| T04 web           | PID67756, `http://127.0.0.1:4330`; restarted through fixture SIGUSR2, with the browser reloaded for its new CSRF token.                    |
| T04 runner        | PID96120, separate DBOS process; no active apply after the two confirmed rounds.                                                           |
| T04 DB            | `intake_test_7d3b47575f8041e9921bfd9eedf93d0a`; synthetic API/runner/apply/scheduler roles and private config only.                        |
| Browser           | Target `9F9B65DA8837C2E2125ED1D31577ACA2`, 1440 px, Review focused on A; batch `914bdc2a-29f0-4f66-9460-2f73f9af70a4`, revision8.          |
| Final baseline    | Two historical POSTs, two original runs; stock7101 intentionally deleted, only stock7102 remains. Do not reset history to simplify review. |

The source worktree is the conventional `feat/intake-manual-approval` branch. Run commands from its root with pinned Node24.22.2/pnpm12.16.1. Safe metadata is ignored, never a secret store; its private-state pointer locates synthetic owner-only runtime configuration. Never print/copy that config or service state. No personal provider/inventory credentials are involved.

To restart only the owned web, refresh the exact metadata/listener then send `SIGUSR2` to its verified `parent_pid` (currently95975). To stop the fixture, send `SIGTERM` to that same verified parent; this reaps its own children and drops its isolated DB/roles, so **do not use cleanup as a persistence restart or during review**. The currently running parent predates final formatting only; its behavior matches the tracked fixture.

For an allocated fresh preview after the current owner explicitly releases 4330, use `pnpm build` then `pnpm db:intake preview:manual`. Do not start it beside this one. Actual full web/fake/runner restart is reproducible through `tests/process/manual.test.ts`; no shared service signal is needed. Independent UI review should create its own batch in the existing preview and assess POST/stock deltas against the retained two-POST baseline.

Before heavy final tests, actual PG inspection showed six T04 connections and no other database consumers; PG background workers were separate. Ordinary pools cap at four, runner DBOS at three plus client two, synthetic runtime roles at six. PG/process files run serially, and preview apply remained idle. No shared limits were raised or duplicate services started.

## Review transfer and remaining work

Use **github-pr-tools** for fresh exact-head PR/CI operations, **browser-harness** for actual visual checks with recordings off, and **handover** for transfers. Use **openai-docs** only if later Codex/provider research is needed. Do not invoke pr-review-loop, start stacked PRs, launch nested reviewers or merge from this owner.

The coordinator assigns fresh independent server/process and UI reviewers after the ready PR is published directly to `interactive-app`. They must read the approved implementation plan, this record and owning architectures, refresh the exact head and live preview metadata, preserve all state, and keep the protected root-environment server strictly read-only. Material fixes require relevant checks and exact-head re-review. Style-only nits follow the approved next-owner protocol.

No human decision is currently needed. T05/T06 wait for the coordinator’s reviewed/CI-green T04 merge. Operational/authentication/release limits above remain explicit future gates; they are not hidden incomplete stock effects in this milestone.

### Final command results

| Command                                            | Result                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                   | Passed; no dependency or lockfile change.                                                                                                                                             |
| `pnpm contracts:generate` / `pnpm contracts:check` | Passed; runtime-generated client remains authoritative and readable, protected canonical vectors unchanged.                                                                           |
| `pnpm typecheck` / `pnpm lint`                     | Passed for contracts/server/frontend, frontend ESLint, backend Ruff and repository Markdown lint.                                                                                     |
| `pnpm test`                                        | Frontend7, contracts3, server41 passed; backend2038 passed,4 skipped,43 TUI deselected. The backend skips are existing opt-in/external boundary tests, not PG/process success claims. |
| `pnpm db:intake test`                              | Final27 passed, zero skipped.                                                                                                                                                         |
| `pnpm db:intake test:process`                      | Final9 passed, zero skipped.                                                                                                                                                          |
| `pnpm build`                                       | Passed; final bundle about480 kB /145 kB gzip.                                                                                                                                        |
| `pnpm format:check` / `pnpm test:formatting`       | Passed;5 actual formatter/hook tests, including partial staging and protected-byte behavior.                                                                                          |
| Original references / whitespace                   | `git diff --check` passed; original HTML/15 PNGs, migrations0001–0003 and canonical vectors are byte-unchanged against the merged base.                                               |

Use the current root `pnpm test` equivalent: this relocated workspace has no Makefile. A system `python3` selector invocation used an older interpreter and failed on modern type syntax; rerun the selector with the backend’s pinned `uv run ... python`. No selector code changed.

The repository-wide Markdown formatter rewrote unrelated historical tables. Those formatter-only edits were restored byte-for-byte to the clean worktree base; T04 owns no skill/backend/historical-document reformatting. Final hook verification targets changed files so it cannot reformat every unrelated legacy document. No user or other owner changes were reverted.

The final boundary audit removed manual-module SQL reads of executor deployment/approval/run internals. Deployment lookup, verified plan digest and delivery-role provisioning now belong to public executor seams; manual dispatch selects only its own retained preparation/run bindings plus shared command/outbox. The affected full types, fast41, PG27 and process9 checks passed again after this change. Delivery receives no target/source/run mutation grants.

Changed-file commit hooks passed after explicitly staging their first Markdown rewrite; no automatic staging occurred. The pinned Python selector suite passed18/18. Full normal backend tests were not repeated after the later TypeScript-only seam/readability changes; affected TypeScript/PG/process checks were repeated.
