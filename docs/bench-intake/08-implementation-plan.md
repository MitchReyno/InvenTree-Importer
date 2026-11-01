# 8. Incremental implementation plan

[Design index](README.md) · Proposed execution plan, awaiting Mitch's approval. No implementation starts from publication alone.

## Authority and delivery objective

Mitch's latest instructions on 2026-11-01 govern this plan: build the new TypeScript application incrementally, prioritize a useful basic version, defer login in favour of the existing server-side InvenTree API key, use fresh owners and independent reviewers, and merge substantial non-stacked task PRs into `interactive-app`. The shared-contract consolidation and TypeScript designs are now merged into that trunk; the deleted spike branch is no longer a dependency. This chapter supersedes the scheduling, dependency-base and review-before-publication instructions in [delivery](07-delivery.md) and historical spike plans, not their behavioral safety requirements. The [logical model](../typescript-data-model/README.md) and chapters 1–6 remain the end-solution contracts, subject to the explicit temporary development-auth exception below.

**First milestone: a persistent manual browser journey against an owned fake InvenTree server.** Create two physical lots with notes, deliberately link an existing Part, select a location and exact quantities, review and approve only one lot, create its stock, restart and see truthful results, then approve the second without duplicating the first. This is useful application behavior without waiting for AI, image editing, full table UX, login or every catalogue table. It is not permission to use the real inventory as a test fixture.

Reduce feature breadth, never authority quality. Use real TypeScript HTTP, PostgreSQL, immutable approved bytes, a persistent fake and supervised processes from the first apply slice. No in-memory production persistence, prototype approval bypass, Python subprocess executor, fabricated successful research, temporary generic mutation/retry endpoint or promise to add uncertain-write safety later. Build only the tables and public commands needed by each slice; the model catalogue is not a scaffold-all-first checklist.

## Development credentials and eventual identity

Until the final identity task, use an explicit **single-operator development-key mode**. Resolve the existing repository-root `.env` through an operator-supplied server-only configuration reference, preserving caller/worktree path meaning; do not copy it into worktrees, fixtures or browser environment files. Verify the existing credential setting names without displaying values. Do not silently turn username/password into a login flow or create a replacement credential if a key is unavailable. Missing configuration yields a safe setup error. Tests inject fake credentials and always use a separately configured owned fake target; they must never inherit the real `.env` automatically.

Bind a stable server-configured development actor, credential-reference identity and fixed target to actions and background work; never accept an actor, target URL or raw API key from a browser command. Historical development actions retain that attribution after login is added. Do not describe the key as a verified human session or delegated grant. Keep credential use behind the same inventory authority interface that will later resolve acting-user credentials. Only the apply process receives mutation capability; research uses a bounded read broker with no secret disclosure.

Default to loopback-only development access, a configured allowed origin/Host, CSRF protection on mutations and private object-scoped evidence routes. No public/LAN unauthenticated deployment, broad CORS or Vite-exposed secrets. Trusted phone access before login needs a separately reviewed restricted authenticated transport; it is not enabled by changing the bind address. Use a visible development-mode banner. Check configured target capability/access failures honestly and stop new work on denial; do not claim the final complete effective-user permission/scope gate has been proved. The existing key is an authorized development mechanism, not a fallback for a denied delegated user after login exists.

The final product still requires InvenTree identity, initial-load complete permission/scope qualification, later rechecks and no service-account bypass. That work moves to T11 rather than blocking T01–T10. No live mutation is authorized by this sequencing or by access to the key. Read-only deployed-target qualification and a separately authorized selected-write pilot remain T12 gates. Provider subscription login/entitlement is independent of application login and must be resolved before actual inference; never use the InvenTree key or paid model API fallback for research.

## Shared local development services

Mitch explicitly permits local Docker containers for development and requires avoiding unnecessary duplicates. T01 supplies a small documented development-service workflow: inspect existing containers/Compose projects, ports, versions, ownership and health **before starting anything**. Reuse a compatible owned development PostgreSQL service with separate per-task/test databases and restricted roles; never reuse production inventory databases or change another project's configuration. Share the service process, not mutable fixtures or execution namespaces. Incompatible major versions, deliberate crash/restore experiments or demonstrably conflicting service requirements can justify a separate bounded container; record why and its owner rather than starting one stack per worktree automatically.

Keep a coordinator service ledger with container/project name, image/version, purpose, owner, loopback ports, database/state namespaces, CPU/memory/connection budgets and active consumers. Owners request allocation through that ledger. Serialize destructive fault/restart tests or use explicitly isolated disposable services so one owner's test cannot kill another's database. Persistent fake servers follow the same rule: reuse only when independent state/fault controls are available, otherwise isolate the smallest required test process rather than duplicating the full stack. Provider native runtimes are not presumed supported in Docker.

Use explicit named volumes and owned directories; never mount the personal credential store, real inventory volumes or root `.env` into broad test stacks. No global prune, volume deletion, stopping unrelated containers or removing retained evidence. Stop an owned disposable service only after all consumers have released it, preserving requested data/worktrees. This plan creates no containers itself; the workflow is implementation work after approval. Docker executable/context discovery is a local setup detail, not reason to install another daemon or launch a duplicate engine.

## Work packages and ownership

Each row is one substantial independently mergeable task PR, not one PR per table, endpoint or test. Dependencies mean **merged into `interactive-app`**, not merely available on another branch. An owner can discover a necessary split and propose it to the coordinator with evidence; do not split into tiny infrastructure-only PRs by default. Sizes are relative review/engineering breadth, not elapsed-time promises: M is a cohesive vertical feature; L spans consequential process/security/transaction boundaries and needs fault evidence. Measure actual cycle time after T04 before forecasting dates.

| ID | Work package and outcome | Required merged tasks | Size | Primary ownership |
| --- | --- | --- | --- | --- |
| T01 | Executable foundation and frozen first-slice contracts | Plan approval | L | `intake-server` bootstrap/SQL infrastructure, `contracts`, root workspace/CI |
| T02 | Persistent manual capture and edit UI | T01 | L | Intake domain/migrations, capture routes/client/screens |
| T03 | Narrow safe executor with persistent fake proof | T01 | L | Execution/inventory modules, owned fake/process tests |
| T04 | Exact manual review → approval → apply → results | T02, T03 | L | Review domain, approval routes/screens, apply integration |
| T05 | Retained uploads and deterministic media/attachments | T04 | L | Blob/media modules, upload/media UI and attachment handler |
| T06 | Durable research coordination and persisted questions | T04 | L | Processing domain/worker, question routes and processing UI |
| T07 | First supported native subscription provider | T06 | L | Restricted runner, read broker, provider integration/tests |
| T08 | Rich evidence/table review and capture refinements | T05, T06 | L | Evidence/review/capture browser work and scoped domain commands |
| T09 | Complete supported inventory effects and selected recovery | T05 | L | Inventory/execution handlers, recovery routes/results UI |
| T10 | Live projections, deployment and operational recovery | T07, T08, T09 | L | Events/SSE, operations tooling, supervision/restore/integration tests |
| T11 | InvenTree identity and complete access gate | T10 | L | Auth broker/session, authority resolver, bootstrap and rechecks |
| T12 | Release qualification and separately authorized pilot | T11 | L | Integrated acceptance, read-only compatibility and release record |
| T13 | Second provider parity and measured improvements | T12 qualification; pilot need not have run | M–L | Separate qualified provider plus evidence-driven improvements |

Tests, owning architecture updates and a comprehensive `docs/handovers/bench-intake-TNN.md` belong to **every** owner. Shared contracts/root lockfile/CI have one coordinator-designated integrator; feature owners propose changes through the coordinator rather than editing competing versions. Primary ownership is not exclusive permission to touch arbitrary files: each kickoff records concrete paths, migration IDs and interfaces, and reserves shared browser entry points when needed. Consumers use module/public contracts, never another owner's SQL internals.

### T01 — executable foundation, not an empty platform

Use the existing pinned Node/pnpm workspace and add `intake-server`, maintained Fastify/runtime schemas, Drizzle/`pg` with reviewed SQL and public contract generation. Qualify compatible supported versions rather than replacing the root toolchain speculatively. Establish one separate app database/role, real test database isolation, migration commands, strict JSON handling, exact decimal/revision strings, safe error DTOs, development actor/target configuration and a minimal health/bootstrap API. Provide server/frontend/process test commands and CI coverage without changing Python behavior. No workers start on import, migration or web autoreload.

Freeze tested examples for manual batch/lot/Part selection, selected preparation/approval, run snapshot/cancellation and worker envelopes. Implement only needed infrastructure rows; feature migrations land with their owners. Prove composite/deferred FK support, same-batch wrong-parent rejection, semantic idempotency conflicts and retained-byte hash vectors using real PostgreSQL and actual HTTP parsing/serialization. Define stream-lock/transaction ordering and module boundaries before T02/T03 diverge.

Qualify DBOS TypeScript through public interfaces for exact full payload/version duplicate comparison, crash/redelivery and worker-version rejection, with a minimal outbox fixture. If incompatible, record an explicit revised durable-runtime choice and equivalent public-boundary proof before dependent work proceeds; do not query undocumented tables or quietly weaken the model. This is a bounded foundation decision, not a custom workflow framework project. Acceptance includes a clean owned checkout/database boot, migrations, safe missing-key state and fake-only test configuration that cannot accidentally address the live target. T01 does not need full OAuth or provider inference.

### T02 — useful capture with no required files or provider

Implement batches, stable original source/contribution identity, separate lots/shared Part proposals, manual note evidence, typed human selections, inherited defaults/overrides and revision-aware editing. Add create/list/resume/archive, basic existing-Part/location selection through allowlisted read-only inventory calls and a responsive form/list. Preserve unknown versus omitted versus explicitly cleared values and exact quantities. Keep observations separate from chosen values and preserve the revision/provenance needed by future research; no parallel disposable draft model.

Acceptance: two lots of the same Part remain distinct across API/browser restart; one overridden location survives a default change while the inherited one changes; two clients cannot silently overwrite revisions; malformed numeric/string/object references fail at the public boundary. Browser refresh resumes retained drafts. Manual data is visibly human-entered, not inferred. File upload, broad bulk editing and lot restructuring can wait. Update frontend architecture and inspect rendered desktop/narrow states; do not replace the whole eventual design with a wizard that prevents later incremental work.

### T03 — narrow executor, complete safety

Implement existing-Part reuse and new stock creation only, with exact mapped quantity/location and the supported original-contribution barcode policy. If an endpoint/version cannot provide the required attribution, reject the unsupported profile rather than inventing a safe retry. Add a persistent owned fake HTTP server with request/effect recording and controlled faults. Tests create retained approval/run fixtures via trusted setup; there is no production test-approval endpoint. T04 will own real preparation/approval commands.

Implement canonical PostgreSQL operation/request/effect authority, stable source guards, cumulative contribution-history checks, immutable command/run adoption, bounded outbox dispatch, per-request committed intents, no implicit mutation retry/redirect, serial supervised apply with host exclusion plus dedicated advisory connection, cancellation and truthful partial/unknown outcomes. Enforce fixed target/continuity/build binding and an external apply-disabled epoch/restore gate from the outset. New source IDs or fresh state cannot bypass history. Include enough known-output verification and original-run safe pending/no-effect recovery for the supported stock slice; unknown creates remain blocked, never “retry all”.

Acceptance uses real PG/process/HTTP: lost intent/approval commit acknowledgements; remote accepted stock with lost response; process killed after intent and after result checkpoint; surviving original child after worker/DB connection loss; cancellation racing authorization; changed-payload duplicate command; missing/corrupt approved authority. Confirmed stock later deleted/consumed cannot be recreated by another preparation/run. Demonstrate exact request counts and retained output identities, not merely passing status codes. Minimal startup/shutdown/restore guards are not postponed to T10. Broader effect handlers and attachment recovery wait for T05/T09.

### T04 — first complete working milestone

Connect T02 and T03 through read-only selected preparation, exact subject/review/plan binding, server-retained canonical bytes and frozen effect preview. Approval rechecks current draft/shared dependencies, issues, cumulative contribution history and target binding, then commits approval/original run/initial journal/command/outbox/event in one transaction. Implement exact digest approval, original-run start-or-adopt, durable cancellation, polling snapshots with a matching consistent cursor and clear confirmed/pending/failed/unknown results. Polling is a supported product path, not a temporary second truth store; SSE arrives later.

Acceptance: the first-milestone journey above through browser → API → PG → supervised executor → persistent fake, including duplicate approval, stale preview/shared edit, approval before enqueue crash and result publication loss. A selected lot sharing a Part must not pull in the unselected lot's stock. Repeat round A → restart → round B, then select A again after fake stock deletion and assert **zero replacement stock POSTs**. Safely failed/no-effect A stays original-run recovery. Show unknown A blocking B. Basic form UX and read-only preparation issues are sufficient; no “success” screen hiding partial effects. Publish inspected desktop/narrow screenshots and an executable journey with independent expected inventory counts. This milestone can ship locally without T05–T13.

### T05 — durable evidence and deterministic media

Add bounded photo/PDF uploads, typed evidence links/groups, private retained originals, server hashes, authorized previews/downloads and explicit upload receipts. Use durable atomic publication plus digest-level GC/publication exclusion; no destructive general cleanup/reset. Pin all approved artifacts. Qualify maintained image/PDF tools with byte/page/pixel/time/memory bounds and no scripts; distinguish encrypted/unsupported/malformed input. Add orientation/crop/rotation recipes, server/browser coordinate agreement and frozen deterministic derivatives. Evidence may support many lots without merging them.

Add explicitly selected original/derivative attachment effects to preparation/execution, with exact bytes/destination and content/domain verification. Unknown attachment ACKs and confirmed-then-removed files require supported assessment, not filename matching or automatic replacement. Acceptance covers crash before retained receipt, concurrent publication/GC, shared media invalidation, PDF/photo bounds, cross-batch access, immutable approved bytes and partial stock-success/attachment-failure. Extend the milestone to repair only an eligible attachment without another stock POST. T05 reserves media UI; it does not redesign review tables.

### T06 — coordination and questions without pretending to infer

Implement immutable inputs, stage dependencies, jobs/attempts/proposals, authenticated versioned envelopes, stale-output rejection, payload-bound dispatch, durable typed questions/answers and continuation. Current-attempt/message exact-parent FKs and input freshness must hold. A waiting question finishes its command and releases the lane; the answer transaction creates the next immutable input/command. Research cannot select human values, approve or reach mutation credentials. Use visibly synthetic/replayed fixtures with retained provenance; no passing fixture is described as provider capability.

Add basic Processing overview/stage status, typed question UI, login/capacity/interrupted states and cancellation; one research lane per account initially. Acceptance uses real worker restarts with duplicate changed payload/version, stale answer/result, human edit during processing and another lot progressing while one waits. Browser close does not cancel work. A selected human quantity survives reprocessing. Supply a provider-neutral restricted runner interface for T07, not a model-specific database schema. Coordinate shared view/navigation work with T05 rather than editing the same shell concurrently.

### T07 — first actual supported subscription route

Investigate the currently supported Claude/Codex personal deployment route, installed compatibility and entitlement before inference. Use official OpenAI documentation tools for Codex research. Choose the first route that can actually meet tool/credential isolation on the supported host; do not promise both providers, headless hosting or native resume parity based on old observations. Keep native login in its supported credential store, never copy it. A blocked route does not stop T08/T09/manual use and is recorded as a gate, not worked around with paid APIs.

Implement bounded staged evidence access, source retention/fetch SSRF controls and semantic inventory-read broker; no unrestricted provider tools or write secrets. Exercise actual photo and PDF processing, structured proposals with provenance, application questions/continuation, cancellation, restart and stale native permission-reply rejection. Preserve human selections. Label independently observed behavior, retained-provider replay, synthetic cases and untested capabilities in handover and UI capability status. Unsupported native continuation must stop/new-attempt safely rather than reusing a dead permission handle. Acceptance requires fresh actual inference only after supported login/tool gates hold; quota/login blocks are honest limitations, not fabricated acceptance.

### T08 — richer operator throughput without a new truth model

Build evidence/source comparison, candidates versus chosen facts, shared Part links, table/bulk editing, reasoned warning resolution and scoped review invalidation on the established commands. Add unapproved lot/Part restructuring with lineage/impact preview, capture groups/instructions and useful incremental processing views: Overview plus Reading, Identifying, Research, Images and Inventory. Manual mode remains complete if T07 is blocked; use declared fixtures for research states, never simulated live results.

Acceptance covers shared edits invalidating A/B but lot-only edits invalidating only B; preserving explicit defaults; keeping physical lots distinct; exact selected review with deferred rows; mobile and keyboard flows with retained local edits on conflict. Add visual/interaction checks for representative nondefault states. No historical stock split/merge, quantity correction or arbitrary overwrite. Existing manual screens evolve rather than becoming an abandoned duplicate path.

### T09 — complete the supported inventory slice and recovery

Extend preparation/executor with explicit Part create-or-reuse, mapped category/parameters, supported manufacturer/supplier relationships and tags, plus selected media destinations. Maintain a tested capability manifest; unsupported effects yield typed issues, never silent omission. Do not add taxonomy creation, PO booking, arbitrary record overwrites or primary-image replacement without an explicit later scope decision. Show usable known Part outputs even when a dependent parameter/media operation fails.

Implement per-operation selected recovery/assessment presentation bound to original run/approval and current guard, including attachment/known-field verification and safe untouched work. New effects require fresh review/approval, never editing retained plans. Acceptance expands the two-lot story to one newly created shared Part, failed dependent effect, restart, selected repair and later round without duplicate Part/stock. Cover malformed response with trustworthy PK, incomplete reads, unknown original create, same-source guard reacquisition and consumed/deleted historical stock. Extend T03/T04 public fault tests rather than replacing them with mocks. Coordinate schema/handler contracts through the coordinator while T08 owns review UI.

### T10 — operationally usable and observable

Add durable SSE using commit-ordered events, consistent snapshot cursors, bounded buffers, expired-history resets, reconnect and polling fallback. Keep lossy progress IPC separate from journal truth. Finish settings/diagnostics, redacted structured logs, readiness, resource budgets, supervised explicit process entry points, reproducible package/install instructions and compatible version drain/quarantine. No new mandatory distributed infrastructure.

Implement coherent DB/scheduler/blob/config backup and externally disabled restore tooling, including backup older than a subsequent fake remote create. Restored missing history cannot authorize replay; lost attribution can remain permanently blocked. Prove retained blob pinning/GC exclusion and safe retention boundaries. Exercise clean owned installation, worker/process failure, stale browser version, UI reconnect and a full manual/research fake journey. Keep the key-mode deployment local/restricted until T11. T10 integrates earlier evidence; it must not be the first time cancellation, supervision, request journaling or restore activation safety exists.

T07's successful provider proof gates claiming research-ready completion, not development of T10's provider-independent operational work: if blocked, T10 may merge those completed parts with research explicitly disabled and a tracked unresolved gate. Do not report release qualification while that required capability remains unproved; manual-only release scope would require Mitch's explicit plan adjustment.

### T11 — final InvenTree identity/access contract

Qualify the installed InvenTree supported identity route, stable subject/claims and API-user binding, complete permission and delegated scope discovery, refresh/revocation and endpoint coverage without mutation. Use maintained session/protocol libraries and server-side encrypted credential references; no InvenTree SQL/session sharing or password copying. Replace development-key resolution for normal use with actor-bound delegated authority. Retain historical development attribution; do not relabel old approvals or replay them as a newly signed-in user.

Before workspace bootstrap, require every permission/scope needed by enabled features, with distinct sign-in-required, missing-capability and retryable access-unverified pages. Recheck approval, dispatch/resumption, privileged sends, evidence access and long-lived streams; preserve uncertainty if rights disappear. Add origin/CSRF/session rotation/expiry/logout/security tests. Never fall back to the development key after delegated denial. A permanently unsupported protocol or incomplete introspection is a decision gate to discuss with Mitch, not permission for a guessed identity bypass. Acceptance includes one missing right, unverified introspection, expiry after approval, identity substitution and SSE revocation. Only now qualify normal phone/desktop authenticated deployment.

### T12 — release proof and separately gated pilot

Re-run the applicable [delivery fault matrix](07-delivery.md#fault-and-product-acceptance-matrix) through new TypeScript public interfaces with real PG/process/HTTP and browser evidence, including all supported effects, immutable review, exact-parent ownership, later-round identity, unknown writes, restore and actor requalification. Test clean install/upgrade/drain with outstanding questions and approvals, accessible phone/desktop, representative private media and secret redaction. Preserve Python behavior/history; do not claim automatic cross-engine exclusion or migration.

Compare the owned fake contract with the actual deployed InvenTree version through **read-only** authorized calls; never mutate to probe permissions/compatibility. Assess existing target/source history and quiesce legacy/external writers before a live handoff. Record residual limitations and measured time/correction/recovery effort. Once qualified, ask Mitch for the exact pilot target and selected effects. Run no live mutation without that separate approval. If authorized, read back fields/media/identities and record recovery outcomes without unsafe retry; otherwise mark qualification complete/pilot pending and continue permitted non-live work.

### T13 — optional parity and measured improvements

Qualify a second provider independently for supported host/auth/media/questions/cancellation/restart/tool authority; no assumed parity. Improve measured bottlenecks and remaining polish without widening inventory authority. Agree a concrete bounded scope before starting this owner; this task is not an unbounded cleanup bucket. Native offline sync, multi-tenant hosting, distributed writers, PO receiving, historical stock adjustments and legacy CLI feature parity remain out of scope. Do not block the first complete supported release on parity.

## Sequence and parallel work

```diagram
Plan approved → T01 → ┬─ T02 capture ──┐
                      └─ T03 executor ─┴─ T04 MANUAL WORKING MILESTONE
                                             │
                               ┌─────────────┴──────────────┐
                          T05 media                    T06 coordination
                           │     └────────┐          ┌──────┴─────┐
                           ▼              └─────────►T08 review  T07 provider
                      T09 effects                      │           │
                           └───────────────────────────┴───────────┘
                                                       │
                                                   T10 operations
                                                       │
                                                   T11 identity
                                                       │
                                                   T12 qualification
                                                    │          │
                                    explicit approval → pilot  T13 optional
```

The dependency table is authoritative; arrows summarize it. T08 waits for both T05 and T06. T10's full completion waits for T07/T08/T09, with only the explicitly bounded provider-block exception above. No task depends on unmerged code from a sibling branch.

| Wave | Eligible owners | Result / scheduling rule |
| --- | --- | --- |
| 0 | T01 | Freeze tested first-slice seams and qualify foundation |
| 1 | T02 and T03 | Capture and executor proceed independently on T01; coordinator resolves contract changes |
| 2 | T04 | Integrate merged public seams; deliver first functional manual version |
| 3 | T05 and T06 | Media and coordination own different modules/routes/views |
| 4 | T07 after T06; T09 after T05; T08 after both | Up to three substantial owners; don't wait for an entire wave when a dependency has merged |
| 5 | T10, then T11, then T12 | Operational convergence, final access, integrated qualification; no speculative stacked branches |
| Later | T13 after qualification | Independent parity/improvement scope; pilot still needs separate permission |

Use **at most five implementation task owners concurrently**, not a target to fill. Prefer fewer independent owners to conflicting shared-file work. Reserve reviewer capacity as work finishes; pause launching new owners when reviews would otherwise wait. The coordinator owns integration decisions and the live task ledger (task, branch/worktree, merged prerequisites, reviewed head, CI, findings, next owner); a free slot does not justify unnecessary parallelism. Plan approval authorizes the task workflow, not production deployment or arbitrary new scope.

## Owner, reviewer and merge protocol

1. After Mitch approves this plan, refresh `origin/interactive-app` and live PR state. Start a **fresh owner** for each eligible task in its own preserved worktree and conventional `feat/...` or `fix/...` branch based on current trunk. No stacked PRs, cherry-picking sibling work or binding a consumer to an unpublished branch. Brief the owner with this chapter, relevant design/model sections, merged interfaces, exact paths/migration ownership, acceptance cases and exclusions. State that others are working concurrently and changes must be preserved.
2. The coordinator facilitates specific cross-owner questions and decisions: proposed contract changes include examples/version/consumer impact; settle them once, record the decision and notify affected owners. Designate one integrator for `contracts`, workspace lockfile, CI, shared navigation and colliding migrations. Coordinate a merge order instead of asking owners to overwrite one another or duplicating implementation in the coordinator's checkout.
3. Owners validate and supply a comprehensive tracked handover **before review submission**: decisions/alternatives, scope/plan adjustments, public contracts/migrations, commands and actual results, adverse cases, inspected UI evidence, observations versus fixtures, security/operational limits and unresolved nits. Open a **ready-for-review PR directly into `interactive-app`** with those facts; do not hold it as draft for the local review. The latest user workflow supersedes older guidance requiring review before opening the PR.
4. Start a **fresh independent local reviewer** on the exact ready PR head and its merged base, with access to the actual worktree/evidence, no implementation authorship and no nested delegation. It reviews correctness, safety, architecture and contract acceptance rather than merely formatting. Have it reproduce risky seams as appropriate. Communicate concrete findings back to the implementing owner; the owner fixes material issues and runs relevant checks, then the reviewer rechecks the changed head until material findings are resolved. Do not claim a local review is a GitHub approval by another human.
5. A review containing **only minor non-correctness/style nits** counts as locally green/approved per Mitch. Record each nit and its explicitly named following task in the ledger/handover; do not slow the PR with cosmetic iteration. Missing tests for a safety invariant, incorrect behavior, security/uncertainty issues or broken UX are not nits. If the last task has a nit with no successor, record an explicit next follow-up scope rather than silently discarding it.
6. Merge task PRs once material findings are resolved, required CI passes and the actual merge head is covered by review. Refresh trunk and rebase/update a sibling when necessary; rerun relevant integration tests and re-review material conflict resolutions/new changes. GitHub branch-protection rules and required external approvals still apply; local green cannot bypass them. The user's post-plan-approval instruction authorizes these task merges into `interactive-app`, never `main`. Avoid an open-PR backlog or waiting for all tasks in a wave before merging a green task. Do not merge this plan as a substitute for Mitch's approval.
7. After each push, subscribe to exact-head CI; after opening PRs, subscribe to comments/reviews. Fix failures caused by the task and route material external feedback to its owner. Report progress in user outcomes (manual working, media retained, actual research proved), outstanding provider/release gates and changes to sequencing. Preserve every worktree/untracked skill/local dataset; no cleanup or canonical history rewriting. Use `github-pr-tools` for operations and `handover` for transfers; use `pr-review-loop` only when specifically requested. This initiative deliberately does not use dependent stacks.

## Completion and acceptance tracking

The task owner records acceptance as **observed / fixture-only / blocked / not tested**, with reproducible evidence and exact versions. A merged PR is not proof of native provider support or permission for a live pilot. T04 is the first basic manual/fake working version; T05/T06 add evidence and coordination; T07/T08/T09 deliver the supported assisted workflow; T10/T11 make it operationally deployable with final access controls; T12 qualifies release. Carry the full end-solution traceability and unresolved gates forward, not just the happy-path demo.

At every merge checkpoint reconcile the architecture's **implemented** state and remaining plan against evidence. Escalate consequential changes (different provider hosting, unsupported identity route, changed inventory scope or safety guarantees) to Mitch; record reversible engineering decisions within the approved scope without unnecessary blocking. Do not invent dates/throughput guarantees. If a blocked gate changes the first-release scope, propose that adjustment explicitly instead of pretending completion.
