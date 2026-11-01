# Bench Intake — TypeScript whole-application solution design

Status: **proposed, not implemented**. Prepared on 2026-11-01. At Mitch's request, this is a duplicate of the earlier whole-application design, reconciled for a new TypeScript backend and executor. The original Python proposal remains unchanged on `docs/bench-intake-solution-design`. This personal self-hosted product is not a commercial hosted service. Publication of this design is authorized; implementation, provider inference, migrations and live inventory writes are not.

## Read the design

Read the summary here, then the chapters below. Diagrams and wireframes show proposed responsibilities and behavior, not running services. The current application remains the [browser-local scaffold and Python importer](../../ARCHITECTURE.md).

| Chapter | Questions answered |
| --- | --- |
| [1. System and technology](01-system.md) | What runs where, why these components, and what stays out? |
| [2. Domain and persistence](02-domain.md) | What are batches, lots, Parts, evidence, values, reviews and approvals? |
| [3. Workflows and execution](03-workflows.md) | How do research, questions, selected approval, writes and recovery work? |
| [4. Interfaces and contracts](04-contracts.md) | What API, event, runner, preparation and execution contracts connect them? |
| [5. User experience](05-experience.md) | What does each screen do on desktop and phone, including failure states? |
| [6. Security and operations](06-operations.md) | How do we authenticate, deploy, observe, upgrade, back up and restore it? |
| [7. Reuse, scope and delivery](07-delivery.md) | What do we retain as evidence, rebuild narrowly, prove first and deliver in increments? |

## The proposal in one page

Build **one TypeScript modular backend** on maintained Node LTS, with React/TypeScript in the browser, PostgreSQL for product state and a new durable execution journal, and private immutable blobs. Recommend Fastify with strict runtime schemas and reviewed SQL migrations through Drizzle/`pg`; qualify compatible pins before implementation. A durable TypeScript worker handles bounded commands through an application outbox; DBOS TypeScript is the first candidate, not an already proven runtime. A separate personal research runner hosts supported native provider integrations. A serial supervised TypeScript apply process is the only inventory-write authority.

**Reimplement the supported slice, not every legacy importer feature.** Preserve original source/contribution identity, exact human approval, request/effect attribution and conservative uncertainty handling as behavioral contracts. Python code/tests and Stage 1E are reference evidence, not a production subprocess dependency or proof of the new executor. Leave the existing CLI, active runs, SQLite journals and local data untouched; cross-engine live coexistence and automatic migration are not supported.

Host a **separate Bench Intake database and restricted role in the existing InvenTree PostgreSQL instance** on the same host. Within that database, approval, original run reservation, initial journal, outbox and event can commit atomically. Remote InvenTree HTTP effects and filesystem blob publication still cannot join that transaction. Inventory remains API-only; never share InvenTree tables, database credentials or migrations. Use InvenTree identity via a qualified supported integration and block initial workspace load unless the user has every required permission and delegated scope. Recheck authority before privileged actions; no service-account bypass.

The [system diagram](01-system.md#context-and-authority) shows the process and trust boundaries; the [workflow diagrams](03-workflows.md) explain execution and recovery.

## The user journey

```diagram
Capture ──► Processing graph ──► Review ──► Exact approval ──► Results
   ▲           │    │               │            │               │
   │           │    └─ question ─► human answer ─┘               │
   │           └─ ready lot ───────►│                            │
   └─ add evidence / correct facts ┘                            │
                    next reviewed subset ◄──────────────────────┘
```

These are persistent views, not batch-wide wizard gates. One lot can wait for an answer while another reaches review. Capture remains available. A later correction invalidates only dependent work, but editing shared Part data or media can invalidate several lots' reviews. Changes never mutate an already approved plan.

The organizing acceptance story is: **capture two physical packets → identify one shared Part → answer the opened packet's count question → review both → approve only the first → execute against the fake → restart → repair only its attachment → approve the second without duplicating the Part or either lot**. The broader fault matrix prevents a happy-path demo from concealing uncertainty.

The [screen wireframes](05-experience.md) follow this journey through capture, processing, review, approval and results, including phone use.

## Decisions and their status

| Decision | Proposed resolution | Why / gate |
| --- | --- | --- |
| Application language | TypeScript backend/executor and React/TypeScript browser | Latest user request explicitly adapts the preserved whole-app proposal |
| Architecture | Modular monolith with separate process entry points | Coherent transactions without a microservice platform |
| Persistence | Separate app database in existing PostgreSQL instance; product plus new journal, private blobs | Local approval/reservation atomicity; remote uncertainty remains |
| Durable scheduling | Explicit outbox; DBOS TypeScript candidate | Must independently prove payload/version/restart behavior; scheduling is not write authority |
| HTTP and SQL | Fastify + runtime schemas, Drizzle/`pg` + reviewed SQL recommended | Express composite/deferred constraints explicitly; final pins/library behavior need qualification |
| Browser | React/Vite, query cache, route-based persistent workspaces | Continue current tooling; server remains authoritative |
| Authentication | InvenTree verified identity, local revocable server sessions, complete permission gate | Experimental/opt-in provider route must be qualified; no password copying or privileged bypass |
| Research | Own-computer supported subscription runner first | Login, entitlement, tool isolation and native restart remain gates |
| Writes | New PostgreSQL-journaled TypeScript executor, one supervised apply process | No generic retry, payload-match adoption or automatic rollback; new fault proof required |
| Existing Python | Preserved CLI/history and reference scenarios | No automatic migration or concurrent same-source writers |
| UI | Evidence-first review plus table and focused phone modes | Concepts to review, not a selected pixel-perfect implementation |

Exact package versions, first supported host/provider and target compatibility remain implementation selection gates. Candidate libraries are not installed by this design.

## Evidence versus proposal

| Item | What is known | What is not established |
| --- | --- | --- |
| Existing Python executor | Independently reviewed bounded ownership/recovery behavior and real SDK/fake-target tests | General live-target compatibility or distributed writers |
| Provider spike | Retained personal local observations, with asymmetric media/continuation coverage | New inference after hardening, arbitrary remote deployment, billing guarantees or provider parity |
| Coordinator/adapter spikes | Separate real database/process and persistent-fake evidence | Browser authentication or production transport |
| Stage 1E | Clean bounded independent review; reviewer reproduced 44 combined/shared cases with real owned PostgreSQL/process state | New inference, production authentication, durable SSE, restore or live-target compatibility |
| This design | Product traceability, proposed interfaces and reviewable diagrams | Any implemented API, schema migration, performance result or operational guarantee |

The prior [reconciled design](../intake-design.md) and [plan](../intake-plan.md) retain their historical Python/spike evidence and safety gates. For this proposed TypeScript application, this package supersedes their Python/Django/SQLite-reuse recommendations, not their evidence or safety requirements. The companion [TypeScript data model](../typescript-data-model/README.md) is the logical schema authority; this package owns product, process, API, UX and delivery design. Resolve disagreements explicitly before implementation. Nothing relaxes the [existing execution contracts](../import-execution-contracts.md). Stage 1E [PR #33](https://github.com/MitchReyno/InvenTree-Importer/pull/33) merged into the shared-contract dependency, not proof of a TypeScript implementation. Application implementation remains paused.

## Design principles

1. Start with whatever evidence exists, including a manual description; do not require an upload to begin.
2. Preserve originals, physical lots and human decisions; share Part information deliberately.
3. Agents propose; humans select and approve; only the apply worker mutates inventory.
4. Freeze selected effects before approval; a shared prerequisite is not permission for unselected stock or media.
5. Distinguish remote truth, durable execution knowledge and browser projections.
6. Prefer an honest unresolved outcome to an unsafe retry or invented success.
7. Build only the supported product slice; grow from observed requirements rather than copying legacy breadth.

The [owner handover](../handovers/bench-intake-typescript-design.md) records design provenance, alternatives, validation, limitations and continuation instructions. Data-model PR #35 has already merged into `feat/spike-shared-contracts`, so publish this package directly above that refreshed branch while consolidation #29 remains open toward `interactive-app`; never merge automatically.
