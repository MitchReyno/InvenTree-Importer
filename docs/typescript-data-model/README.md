# Bench Intake: proposed TypeScript backend data model

Status: **design only, not implemented**. Prepared 2026-11-01 following Mitch's request for a new TypeScript backend data model. This is a separate proposal, not a migration or a declaration that the Python backend has been replaced. The earlier Python solution design remains unchanged in its own worktree. No database, runtime, credential, inventory or provider is changed by these documents.

**Implementation scheduling:** the [incremental application plan](../bench-intake/08-implementation-plan.md) records Mitch's later instruction to defer login and use a restricted server-side development API key while building the product. That explicit temporary actor/credential mode supersedes early session/delegated-access prerequisites for development only; it does not remove this model's final identity/complete-permission gate, exact approval, ownership or uncertainty contracts. The design/spike PRs are now merged into `interactive-app`; historical dependency-state prose below is not the current PR base. Implementation awaits plan approval.

## Recommendation

Use **one PostgreSQL database for application records and the new TypeScript executor's durable journal**, plus private immutable blob storage. Separate product editing, research proposals, human approval and execution by authority, even though they share a database. Use relational identity/constraints for things that must agree, and small versioned JSON documents for heterogeneous facts and frozen specifications. Do not mirror all of InvenTree or build a general-purpose workflow/event-sourcing platform.

Deploy that database in the existing PostgreSQL instance on the InvenTree host, with a separate Bench Intake database, restricted application role and independent migrations. Do not read/write InvenTree tables or reuse its database credentials; inventory and identity integration use supported APIs/protocols. Sharing an instance shares operational resources and failure/maintenance windows, not application schema authority. Leave existing Python SQLite journals untouched.

This is a clean implementation of a narrow product, **not a direct port of Python tables or all legacy functionality**. Preserve the behavioral requirements for source identity, exact approval, partial outcomes and unknown writes. The new TypeScript journal needs its own fault evidence; the Python spikes do not prove it. HTTP framework, ORM, authentication library and durable job runtime are separate implementation choices. An ORM must be able to express the constraints and transactions here, with reviewed SQL migrations where necessary.

## Read in order

| Document | Contents |
| --- | --- |
| [1. Identity and inventory context](01-identity.md) | Scalar conventions, ownership, targets/continuity, batches, physical lots and shared Parts |
| [2. Evidence, facts and media](02-evidence.md) | Originals, retained sources, assertions, selections, defaults, mappings and images |
| [3. Processing and coordination](03-processing.md) | Inputs, dependencies, jobs, attempts, questions, issues, dispatch and idempotency |
| [4. Review, approval and execution](04-execution.md) | Immutable plans, selected scope, operation graph, run ownership, requests/effects and recovery |
| [5. Transactions and operations](05-transactions.md) | Atomic commands, lock order, event cursors, queries/indexes, retention, backup and rollout |
| [6. Worked example and acceptance](06-example.md) | Concrete two-lot journey, TypeScript value contracts and regression matrix |

Each table catalogue names its keys, domain-specific columns, relationships and important constraints. Cross-row rules that require a command transaction are explicitly separate from SQL `CHECK` constraints. This is a logical/relational schema specification, **not executable DDL, a generated ORM model or a production migration**. Naming/type examples are intended to be settled into tested migrations, not inferred as existing endpoints.

## Model map

```diagram
Owner ──► Batch ──► Subject ──────┬─► Physical lot ──► original contribution
             │                  └─► Shared Part proposal
             ├─► Evidence versions ──► assertions ──► selected facts
             │         └─► originals / sources / media recipes
             ├─► Jobs ──► attempts ──► proposals / questions
             ├─► Reviews ──► immutable preparation ──► approval round
             │                                           │
             └─► events / history                        run
                                                         │
                    source guard ◄──► operation execution ──► requests/effects
                                                         │
                                       fixed target/continuity binding
```

Five user views—Capture, Processing, Review, Approve, Results—are projections of these records, not a single batch status machine. Processing has Overview, Reading, Identifying, Research, Images and Inventory views. A question on one lot does not prevent independent work. Stock confirmation and supporting-media completion are separate outcomes.

## Decisions that matter

| Decision | Resolution and reason |
| --- | --- |
| PostgreSQL versus SQLite execution journal | New TypeScript proposal uses PostgreSQL to avoid two local authorities; losing PostgreSQL stops new sends, not remote uncertainty |
| Single operator and access | InvenTree-verified owner with library-owned local sessions; mandatory initial-load check for every required user permission and delegated scope, blocking error otherwise; no service-account bypass or tenant/team platform |
| Original identity | Persist source namespace and contribution keys; never derive them from current array position or mutable labels |
| Draft versus history | Mutable current pointers with immutable revisions; an approval never points only at mutable facts |
| Evidence versus selection | Observed label, model interpretation and human count remain separate records |
| Part versus lot | Shared component identity does not merge packets or stock creates |
| Target references | Typed model/PK observations scoped to explicit target continuity; no local authoritative inventory clone |
| Research versus writes | Research can propose and ask; only a separately authorized apply process sends approved inventory mutations |
| Execution ownership | One persistent host, supervised serial writer, non-expiring source guards and process exclusion; no lease-based failover |
| Job runtime | Owns scheduling only; its private tables are not approval, source ownership or remote-effect authority |
| Safety versus simplification | Defer breadth, not provenance, exact approval, uncertain-write handling or restore gating |

## Scope and evidence

First release supports persistent capture/manual starts, separate lots/shared Parts, factual provenance, bounded research, review, selected Part/stock/media effects, multiple approval rounds and selected recovery. Existing-record overwrites, stock adjustments/split/merge, PO receiving, arbitrary taxonomy creation, distributed writers, native offline sync and enterprise accounts are out of scope. Tables below can describe a rejected/unsupported request without authorizing its execution.

Use the existing [intake design](../intake-design.md), [intake plan](../intake-plan.md), [execution contracts](../import-execution-contracts.md) and [shared spike guide](../../spikes/shared/README.md) as behavioral inputs. The [backend architecture](../../backend/ARCHITECTURE.md) describes **Python's implemented** journal and ownership; this proposal deliberately does not change it or adopt its internal schema as a TypeScript implementation.

Stage 1E is independently cleared within its bounded Python/local-fake scope: 44 combined/shared tests reproduced, retained provider output plus authored adverse controls. At Mitch's explicit request it was published as [PR #33](https://github.com/MitchReyno/InvenTree-Importer/pull/33), with reviewed implementation/test fingerprints unchanged. GitHub and Mitch confirm it merged into `feat/spike-shared-contracts` on 2026-11-01, with all six CI checks successful; consolidation PR #29 remains open/draft toward `interactive-app`. This establishes useful scenarios, not production TypeScript acceptance, fresh inference, native runtime parity, browser auth or backup/restore proof. Refresh publication/dependency state before relying on this snapshot. The coordinator did not perform the merge.

The [owner handover](https://github.com/MitchReyno/InvenTree-Importer/blob/2d852e2/docs/handovers/typescript-data-model.md) records validation, alternatives, limits and continuation. Mitch subsequently authorized a design PR, with this model below the adapted whole-application design and the shared-contract consolidation below both until it lands in `interactive-app`. Publication does not authorize implementation, migration or live writes.
