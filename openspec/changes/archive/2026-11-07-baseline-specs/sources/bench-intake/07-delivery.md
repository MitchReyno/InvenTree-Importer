# 7. Reuse, scope and delivery

[Design index](README.md) · Documentation-only TypeScript proposal, duplicated from the preserved Python design at Mitch's request. Design PR publication is authorized, not production implementation.

**Scheduling update:** [chapter 8](08-implementation-plan.md) supersedes the coarse increments and old dependency/publication workflow below with substantial non-stacked task PRs into `interactive-app`, ready-PR-before-local-review and deferred application login using restricted development-key mode. It awaits Mitch's approval before implementation. The spike/design consolidation is merged and its old dependency branch deleted. Retain this chapter's supported scope, product traceability and fault matrix as acceptance requirements; initial login scenarios apply when final identity lands, not as blockers for the manual development slice.

## Narrow rebuild, not full legacy parity

Implement the new TypeScript backend and executor for the supported application slice, with the [data-model proposal](../typescript-data-model/README.md) as schema/transaction authority. Keep the durable Python engine/tests unchanged as behavioral references and adversarial scenarios, not runtime dependencies or automatic proof of a port. Do not copy fixture-specific spike models/runners wholesale into production, invent a general scheduler or recreate all historical CLI features. Scope reduction saves time; source identity, approval and uncertainty are not optional simplifications.

| Responsibility                                           | Reuse or new work                                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Original lot/Part/source identities, exact units/amounts | Preserve behavioral contracts; new typed model and byte/number vectors                                           |
| Preparation/execution/adoption/repair                    | New TypeScript commands around retained plans and original PostgreSQL run; independent fault proof               |
| Source guards, journal, pre-send requests                | New PostgreSQL authority; no migration/rewriting of Python SQLite state                                          |
| Matching/target/media behavior                           | New allowlisted API adapter; qualify endpoint behavior rather than assume SDK parity                             |
| Domain facts/evidence/defaults/reviews/approvals         | New TypeScript domain commands, SQL constraints and authorization                                                |
| Dispatch/question lifecycle                              | Carry reviewed outbox patterns into qualified TypeScript durable runtime; prove payload/version/restart behavior |
| Browser/API/cursors                                      | Retain React tooling; new strict runtime schemas, generated clients and commit-ordered projections/SSE           |
| Media editing                                            | App-owned versioned recipes around qualified tools; prove browser/server parity and freeze bytes                 |
| Legacy CLI/TUI/scanner/CSV/YAML compatibility            | Preserve existing implementation; not mandatory new app features                                                 |
| Full DigiKey PO booking/issue/receipt                    | Defer application integration; receipts/order refs remain useful evidence                                        |
| Active plans and local data                              | Leave in original canonical namespaces; no automatic migration/reset                                             |

## Supported effect scope

The first complete path uses mapped category/parameters/location, explicit Part matching or creation, separate original stock lots/barcodes and selected photo/document attachments. Add supported manufacturer/supplier relationships, parameters/tags and media destinations in small slices with visible exact effects. Each new UI control needs its own TypeScript preparation, approval, authorization, request/effect journal and recovery presentation; Python capability does not establish new implementation support. Maintain the complete required-permission/scope manifest for the enabled release slice; no silent partial-access mode.

Explicitly defer arbitrary existing-record overwrites, historical quantity/location corrections, stock split/merge, PO allocation/receipt workflows, distributed writers and broad taxonomy/global-config learning. Capability-gate any future category/template/location creation, company logo or primary-image replacement rather than silently exposing prototype buttons. A requested unsupported effect is a typed issue; never silently omit it and claim full completion.

## Delivery increments

| Increment                 | Deliverable                                                                                                       | Exit evidence                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0: qualify foundation    | Review this design/model, choose compatible TS/SQL/runtime pins, qualify InvenTree identity/rights and first host | Public schema parsing, deferred/composite constraints, durable payload/version/restart and fail-closed auth probes on owned/read-only qualified state; no pilot inferred |
| P1: persistent capture    | TS API/Postgres/auth gate, batches/lots/Parts/evidence/defaults, desktop/phone capture                            | Retained originals survive restart, no-photo start, two-device revision conflicts, upload/auth/security tests; no workspace for insufficient/unverifiable rights         |
| P2: manual review path    | Typed selections, explicit candidate choices, evidence workspace/table/media recipes                              | Human values survive reprocess; scoped shared invalidation; true mobile/keyboard checks                                                                                  |
| P3: exact fake apply      | New immutable preparation/approval/run/journal/outbox, serial TS executor, cumulative results/recovery            | Two-lot round1/restart/attachment-repair/round2 through real TS API/PG/HTTP/process; lost commit ACK, effect ACK and surviving-writer fault matrix                       |
| P4: first provider        | Supported runner/tools/questions, five processing views, incremental ready scopes                                 | Actual supported media/continuation/cancel/permission behavior; no API fallback; stale-result checks                                                                     |
| P5: operations and polish | Durable WebSocket projections, settings/diagnostics, backup/restore, compatible version drain                     | Clean-host install, old-backup remote-effect test, phone/accessibility, read-only target compatibility                                                                   |
| P6: separate pilot        | Explicit target and selected live effects, only after authorization                                               | Read-back fields/media/identities and documented recovery                                                                                                                |

Provider entitlement must not block capture/manual review or fake-target apply work. Clearly labeled fixtures/manual inputs can exercise the product while native provider gates remain open. Add second-provider parity only after its own tests; do not delay the first complete supported path merely to offer two providers.

Stage 1E [PR #33](https://github.com/MitchReyno/InvenTree-Importer/pull/33) merged into `feat/spike-shared-contracts`; its clean bounded independent review reproduced 44 combined/shared cases against real owned PostgreSQL/process/fake-target state. This is Python retained-provider replay plus authored controls, not a TypeScript runtime, fresh inference, production HTTP authentication, SSE or restore proof. Reuse its scenarios, fixtures and observed limitations, not its Python application callers as a second production runtime. Data-model [PR #35](https://github.com/MitchReyno/InvenTree-Importer/pull/35) has also merged into the shared-contract branch; consolidation #29 still targets `interactive-app` and has not landed at this snapshot. Publish this design directly above that refreshed dependency and update bases when it lands.

## Fault and product acceptance matrix

| Scenario                                                      | Required observation                                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Valid login, missing one required permission or scope         | Initial load blocks before workspace data; safe missing-capability explanation; no service-account bypass                         |
| InvenTree inaccessible or incomplete permission introspection | Distinct retryable access-unverified page, no access or false permission diagnosis                                                |
| Rights expire/revoked after approval before next send         | Pause new privileged work; retain original actor, approval/guards and in-flight uncertainty; re-login is not replay authorization |
| Upload retained bytes, API dies before row commit             | No false retained receipt; orphan reconciled safely; other evidence remains                                                       |
| Shared default changes while one lot overrides                | Only inherited values/dependent reviews change                                                                                    |
| Human changes marking while old research completes            | Human/current facts preserved; old result retained as stale                                                                       |
| Human waits on one item                                       | Command releases serial lane; independent work progresses                                                                         |
| Same command ID, changed payload/runtime                      | Explicit durable conflict, no ACK or accepted replacement                                                                         |
| Approval races with shared media edit                         | Consistent exact revision or rejection, never stale approval                                                                      |
| Selected lot shares a Part with unselected lot                | Shared prerequisites once; no unselected stock/media effects                                                                      |
| Approval commit before enqueue / enqueue before ACK           | Original immutable command recovered, no duplicate execution namespace                                                            |
| Approval transaction fails / its commit ACK is lost           | No committed half-run/journal; read stable original authority rather than allocate another run                                    |
| Result/effects/event commit before browser delivery           | Same-run snapshot/cursor, no new execution                                                                                        |
| Intent commit ACK lost before send decision                   | Stable-key inspection and conservative possible-send treatment; no blind send or replacement intent                               |
| Stock POST response lost                                      | Original uncertainty retained; no payload-match retry                                                                             |
| Part checkpoint succeeds, dependent parameter fails           | Known Part retained; required identity outputs still gate consumers                                                               |
| Attachment ACK lost / confirmed attachment later removed      | Supported content/domain reconciliation; no stock recreation or automatic replacement                                             |
| Cancel after target accepted request                          | Accepted/unknown effects retained; supported stop prevents subsequent sends                                                       |
| Old child survives timeout/workflow restart                   | Canonical/process ownership excludes another writer                                                                               |
| Progress dropped / cursor history expires                     | Snapshot restores truth without execution replay                                                                                  |
| Second lot approved in a later round                          | Original identities, known Part reused, separate stock lots                                                                       |
| Confirmed A stock deleted/consumed, new preparation selects A | Retain original attribution or review-required; no second stock POST                                                              |
| Approved A had no effect, new preparation selects A           | Original-run supported recovery, not another approval/run stock operation                                                         |
| Earlier same-source effect unresolved                         | Later round blocked; new path/source/state root cannot bypass it                                                                  |
| Target restored/replaced                                      | Continuity review before saved PK reuse                                                                                           |
| Backup older than remote create                               | Apply gated despite missing local record; no duplicate write                                                                      |
| Incompatible code deployed                                    | Compatible drain or quarantine, never reinterpret approved plan                                                                   |
| Browser stale schema/session/revision                         | Safe rejection, recoverable local edits, no unauthorized answer/approval                                                          |

Translate applicable engine/shared scenarios into new tests of the TypeScript public interfaces; Python tests do not verify a rewrite. Use asymmetric inputs and independently derived expected effect/identity/request counts. Real PostgreSQL, supervised processes and actual HTTP against the persistent owned fake remain necessary; mocks cannot prove those seams. Run rendered mobile/desktop/accessibility checks for implemented UI, not just component tests. The persistent fake is client-contract evidence, not live-server compatibility. This document's matrix is future acceptance work, not tests already passed.

## Product traceability

| Requirement                                                     | Design owner                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Forgiving capture, grouping, no-file start, original retention  | [Domain](02-domain.md), [Capture](05-experience.md#capture)             |
| Lots/shared Parts, defaults, provenance and human choices       | [Domain](02-domain.md)                                                  |
| Five processing views, questions and independent progress       | [Workflows](03-workflows.md), [Processing](05-experience.md#processing) |
| Sources, bounded research tools and deterministic media         | [Contracts](04-contracts.md), [Media](05-experience.md#media-workspace) |
| Review/table/bulk actions and scoped invalidation               | [Review](05-experience.md#evidence-workspace-and-table)                 |
| Exact selected approval, cumulative outcomes, selected recovery | [Workflows](03-workflows.md), [Approve](05-experience.md#approve)       |
| Authentication, settings, phone, deployment/restore             | [Experience](05-experience.md), [Operations](06-operations.md)          |

## Remaining decisions

TypeScript and the new PostgreSQL journal are this proposal's direction; the separate Python design remains a preserved alternative, not another simultaneous runtime. Qualify compatible Fastify/schema/Drizzle/`pg` and durable-runtime pins, supported InvenTree identity/claims/rights/refresh behavior, host/provider route, review rules for estimates/unknown manufacturer/missing sources, exact initial effects and retention/export obligations. No live pilot or legacy transition follows from a documentation PR.

Measure correction effort, time to reviewed subset, questions/evidence coverage, interventions and recovery outcomes on representative batches. Do not promise throughput or dates without evidence. When implementation is authorized, qualify P0 then build the smallest complete manual/fake-target path, not broad legacy parity.
