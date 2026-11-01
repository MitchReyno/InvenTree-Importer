# 1. System and technology

[Design index](README.md) · Proposed TypeScript application. No new backend is implemented by this document.

## Context and authority

The first release serves one operator, using phone and desktop browsers, one configured InvenTree target and a supported personal research runner. It is a separate self-hosted application, not an InvenTree plugin, commercial service or multi-tenant platform. TypeScript owns the new application and supported executor slice; the earlier Python/reuse proposal is preserved separately, not silently mixed into this architecture.

```diagram
                    ┌──────────────────────────┐
                    │ Phone / desktop browser  │
                    │ React + TypeScript       │
                    └────────────┬─────────────┘
                              HTTPS
                    ┌────────────▼─────────────┐
                    │ Proxy + TypeScript API  │
                    │ facts/review/approvals   │
                    └─────┬──────────────┬──────┘
                          │              │
                 ┌────────▼─────┐  ┌─────▼──────────────┐
                 │ PostgreSQL   │  │ Private blobs     │
                 │ product state│  │ immutable originals│
                 │ journal/outbox│ │ recipes/derivatives│
                 └─────┬────────┘  └────────────────────┘
                       │ durable commands
                 ┌─────▼─────────────────────┐
                 │ Explicit durable TS worker│
                 └──────┬────────────┬───────┘
                        │            │
       ┌────────────────▼───┐  ┌─────▼──────────────────────┐
       │ Personal runner    │  │ Serial supervised apply   │
       │ no write authority │  │ new TypeScript executor   │
       └─────┬──────────────┘  └──────┬──────────────┬──────┘
             │                       │              │
       provider service       same app PostgreSQL  InvenTree API
       native supported auth  request/effect rows  delegated user rights
```

Phone access over HTTPS does not change where subscription execution is permitted. Start with a supported own-computer personal runner on the operator-controlled persistent host. A remote application/local-runner split is a later authenticated delivery/ownership design; native login is not permission for arbitrary remote hosting.

## Keep responsibilities separate, not services numerous

| Entry point | Owns | Does not own |
| --- | --- | --- |
| TypeScript API | InvenTree login integration, local sessions/access gate, object authorization, uploads, edits, review, immutable approval/run reservation, queries/SSE | Inventory mutation dispatch, raw provider RPC |
| Explicit durable worker | Outbox delivery, versioned bounded commands, result acceptance and projections | Human approval authority or canonical remote-effect authority |
| Research runner | Staged immutable inputs, supported provider gates/tools, typed proposals/questions | Target write secrets, selection/approval |
| Apply supervisor/process | One serial writer, cancellation, original-run adoption, PostgreSQL request/effect journal and selected recovery | Mutable draft interpretation, self-approval or Python journal migration |
| Media job | Bounded decode/PDF extraction and deterministic recipes | Original overwrite, document scripts or arbitrary network access |
| Operator commands | Trusted issuer/owner/target configuration, diagnostics, backup/restore, compatible version deployment | Granting InvenTree rights, clearing uncertainty or silently migrating active plans |

These are explicit process entry points/modules, not a microservice platform. No Redis, Kafka, Kubernetes, user workflow editor, enterprise role engine or mandatory telemetry cluster. Do not launch workers from web imports/autoreload or migrations. Apply is isolated from API/research authority and serial even if the rest of the application handles concurrent requests. Scheduling capacity/leases do not grant physical-write ownership.

## Proposed repository shape

```text
frontend/                           existing React/Vite application
backend/                            existing Python CLI/tests, unchanged
intake-server/                      proposed new pnpm application
  src/
    intake/                         lots, Parts, evidence, defaults
    processing/                     jobs, questions, freshness/invalidation
    review/                         exact reviews, plans and approvals
    execution/                      source guards, requests/effects, recovery
    inventory/                      bounded InvenTree API contract adapter
    api/                            auth, public DTOs, routes and SSE
    workers/                        durable/research/media/apply entry points
    operations/                     diagnostics, backup/restore, migrations
  migrations/                       reviewed SQL, generated row types
  tests/                            public boundaries, PG/process/fake tests
contracts/                          runtime schemas, generated client, vectors
```

The module sketch defines ownership, not a demand to scaffold every directory/class immediately. Add a new workspace package rather than replacing/moving `backend/` and its local data. Browser contracts come from reviewed runtime schemas/OpenAPI; shared TypeScript types do not replace validation. No SQL row, target credential or private execution record is exported directly to the browser.

## Technology choices

| Layer | Proposed choice | Why |
| --- | --- | --- |
| Browser | Existing React/TypeScript/Vite; query cache and URL-based navigation | Keep frontend investment; server remains authoritative |
| API/persistence | Fastify, strict runtime schemas, Drizzle/`pg`, PostgreSQL recommended | Small modular backend; explicit SQL for composite/deferred constraints, decimal/bigint fidelity and command transactions |
| Authentication | Qualified InvenTree OAuth2/OIDC integration, maintained protocol/session libraries | Existing identity, local revocable sessions; complete rights/scope gate and no shared Django tables/password handling |
| Public schemas | OpenAPI-compatible runtime schemas and generated TS client | Validate actual input/output; verify generation and parser behavior, not just compile types |
| Runner envelopes | Existing strict JSON Schema rules and explicit versioned production contract | Runtime validation, exact hashes and freshness are separate concerns |
| Durable work | DBOS TypeScript candidate plus application outbox | Prove dispatch payload/version visibility and restart; its tables own scheduling only. If incompatible, revise the choice before implementation rather than weakening the contract |
| Inventory | New narrow TypeScript API adapter and PostgreSQL executor | Port behavioral safety contracts and vectors, not all Python SDK/CLI functionality |
| Media | Bounded maintained image/PDF decoders/tools, isolated and versioned | Tool language is not authority; qualify output/security/coordinate behavior, retain exact bytes. No dependency on the Python importer runtime |
| Blob storage | Private content-addressed local storage initially | Persistent host, simple backup; object storage only when needed |

Choose supported compatible stable versions at implementation time; the Python spike's Django/DBOS/PostgreSQL pins are observations, not proof of TypeScript-library behavior. HTTP/ORM choices above are recommendations, not installed packages or completed evaluations. No lockfiles or dependencies are changed by this design.

## Storage authority and the inventory boundary

```diagram
Bench Intake PostgreSQL database                    InvenTree API
┌──────────────────────────────────────┐             ┌─────────────┐
│ exact approval + run + initial journal│             │ remote      │
│ source guard + outbox + event         │             │ inventory   │
│       one local transaction           │             │ effects     │
│                                      │             └──────▲──────┘
│ pre-send intent → COMMIT → HTTP send ─┼────────────────────┘
│ result/effect + projection + event    │
└──────────────────────────────────────┘
    separate DB/role in existing PostgreSQL instance
    private blobs still have a publication/DB seam
```

The [data model](../typescript-data-model/04-execution.md) owns exact approval/run/operation binding, source guards and actual request/effect rows. Approve in one database transaction; dispatch can be non-atomic and payload-bound redelivery adopts the same run, not a replacement. There is no new deterministic run-directory/SQLite reservation step. Missing/corrupt authority still blocks rather than reconstructing it from UI JSON. Neither an ORM transaction nor the scheduler can make remote creates transactional.

The inventory adapter exposes typed, allowlisted target operations and read-only preparation inputs; the executor accepts only retained approved plans and explicit supported recovery commands. Neither invokes `import_stock`, `execute_stock` or another Python fallback. Use the older public Python APIs to understand expected behavior and create conformance scenarios only. Before a real transition, assess existing target/source history and quiesce older writers; a fresh PostgreSQL database cannot erase old uncertain effects.

## What remains intentionally small

The application model is native batches/lots/evidence, not every legacy interchange format. Expose only supported target operations and a narrow set of recovery actions. Defer PO booking/receiving, scanner/TUI, arbitrary overwrites and automatic global configuration learning. Preserve old CLI/data behavior without requiring it in the UI. Delivery speed comes from narrower scope and shared language/contracts, not removing approval or uncertain-write protections or claiming a rewrite inherits Python's test results.

Read [current backend architecture](../../backend/ARCHITECTURE.md), [shared contracts](../../spikes/shared/README.md), [prior reconciled decisions](../intake-design.md) and [delivery scope](07-delivery.md) for the owning contracts and limits.
