# Bench Intake TypeScript whole-application design handover

## Scope and latest decision

Snapshot: 2026-11-01. Decision owner: Mitch Reynolds. Start with the [design index](../bench-intake/README.md), all seven chapters and the [companion data model](../typescript-data-model/README.md). These are proposed responsibilities, contracts, diagrams and wireframes, not implementation or operational guarantees.

Mitch first preserved a quick Python whole-app proposal, then reopened the TypeScript option and requested its logical data model. His latest instruction explicitly authorizes duplicating the whole-app branch, adapting it for TypeScript and raising separate whole-app/data-model PRs. The Python proposal, its uncommitted documents and concept image remain unchanged in their original worktree. This branch copies that complete product/UX package and changes only the new copy. Publication is authorized; implementation, live cutover/migration, provider inference and inventory mutation are not.

## Locations and delivery state

| Item | State |
| --- | --- |
| Design branch | `docs/bench-intake-typescript-design`, new isolated worktree discoverable with `git worktree list` |
| Design base | Duplicated original branch at `b48c099a3a05f256dfcab51cde434cbc8f6415a1`, then refreshed onto shared-contract/data-model dependency for publication |
| Design package | `docs/bench-intake/README.md`, chapters `01-system.md` through `07-delivery.md`, and `assets/review-layouts.png` |
| Changes | New TypeScript-adapted documents, this handover and unchanged copied concept asset; independently reviewed and cleared for authorized design publication |
| Original Python proposal | `docs/bench-intake-solution-design`, untouched branch/worktree with local uncommitted docs and original handover retained |
| Data-model PR | [#35](https://github.com/MitchReyno/InvenTree-Importer/pull/35) merged into `feat/spike-shared-contracts` at `2026-11-01T07:13:52Z`, merge commit [b3ebe96](https://github.com/MitchReyno/InvenTree-Importer/commit/b3ebe96f21e5ccb9a561b2e7aced23814ea183fd) |
| Stage 1E | [#33](https://github.com/MitchReyno/InvenTree-Importer/pull/33) merged into the shared-contract branch; no automatic TypeScript acceptance |
| Initiative trunk/dependency | `interactive-app`; consolidation [#29](https://github.com/MitchReyno/InvenTree-Importer/pull/29) remains open/draft, so this PR bases on `feat/spike-shared-contracts` until it lands |

Run `git status --short --branch`, `git rev-parse HEAD` and `git worktree list` to refresh local state. Do not assume a branch name transfers uncommitted files into another checkout. No worktree, canonical state, local data or unrelated skill was moved or removed.

## Design in one page

Use a Node LTS TypeScript modular backend and React/TypeScript browser. Recommend Fastify/runtime schemas, Drizzle/`pg` with reviewed SQL and DBOS TypeScript as a durable-runtime candidate, all subject to compatible-pin and behavior qualification. One separate Bench Intake database/role in the existing InvenTree PostgreSQL instance owns product records and a new TypeScript request/effect journal. Private immutable blobs retain originals/selected derivatives. One serial supervised TypeScript apply process holds host exclusion plus a dedicated advisory-lock connection. Research has no write authority. InvenTree integration is supported-protocol/API-only, never SQL access to inventory/auth tables.

Approval/original run reservation/initial journal/outbox/event share a PostgreSQL transaction, unlike the earlier Python filesystem seam. Actual remote HTTP sends and blob publication still have non-atomic boundaries. Each actual request has a committed intent; result/effect/projection/event checkpoint together. Lost commit ACKs require stable-key inspection, never blind send. Unknown creates cannot be settled through matching-looking records or absence. Cumulative original-contribution history prevents a later preparation from replenishing confirmed stock, and earlier approved pending/no-effect work remains under original-run recovery. Source guards do not expire; a surviving writer/unknown effect blocks replacement.

Build the smallest supported slice: forgiving capture, dependency-aware processing, evidence/table review, exact selected approval, truthful results and selected recovery. Preserve human corrections, defaults, provenance and shared-media invalidation. Defer legacy UI breadth, arbitrary overwrites, PO receiving and distributed writers. Qualify InvenTree identity and complete effective-user permissions plus delegated scopes before workspace access; no partial privileged mode or service-account bypass. Provider native entitlement is a different gate and must not block manual/fake-target development. The [delivery chapter](../bench-intake/07-delivery.md) owns increments and adverse acceptance requirements.

## Decisions, alternatives and provenance

1. **TypeScript adaptation — Mitch, latest explicit instruction in this thread.** Duplicate/preserve the Python design, update the copy and publish both new TypeScript design PRs. Earlier Python-under-TS reuse remains an alternative, not this new runtime. Porting every CLI feature was rejected as unnecessary breadth.
2. **Shared instance, separate authority — Mitch's accepted deployment decision.** Separate app DB/role on the InvenTree host, new PostgreSQL journal; no InvenTree SQL/credential reuse. This removes the local PostgreSQL-to-SQLite reservation seam, not remote-write uncertainty. Leave Python history untouched.
3. **InvenTree auth and complete gate — Mitch's explicit requirement.** Supported verified identity, own revocable session, all required rights/scopes at initial load or blocking error. Unknown verification fails closed; recheck approval/dispatch/privileged sends and preserve actor. Experimental protocol/installed-version support remains unqualified. No service-account bypass.
4. **Modular processes and qualified libraries — recommendation.** Fastify/Drizzle/`pg` and DBOS TypeScript are candidates subject to tests, not user-mandated or installed dependencies. Prefer reviewed SQL/runtime schemas and narrow commands over opaque JSON, generic EAV or a custom workflow platform. Scheduler identity is not physical-write ownership.
5. **Keep evidence truthful.** Existing Python [design](../intake-design.md), [plan](../intake-plan.md), [shared contracts](../../spikes/shared/README.md) and [backend architecture](../../backend/ARCHITECTURE.md) retain historical evidence/safety requirements. This proposal explicitly supersedes Python/Django/SQLite-reuse recommendations for the new app, not implemented boundaries. The companion model is the logical schema authority. New TypeScript fault proof is required.
6. **Illustration is not UI acceptance.** The copied Painter review comparison has fictional/inconsistent values and incomplete navigation. The UX chapter's wireframes/contracts remain authoritative and retain Approve. No app rendering or interaction proof is claimed; no new image exploration was needed for this architecture adaptation.

## Validation and independent review

The earlier Python proposal's consistency review does not clear this adaptation. A fresh independent reviewer read all eight TypeScript design chapters/index, this handover, the complete companion model and original Python product chapters. It found no material product omissions or other design blockers, but identified one misleading deployment-diagram connector appearing to link the coordinator to InvenTree's database. The owner replaced that ambiguous diagram with explicit process-to-database/API connections: coordinator and apply use only Bench Intake DB, and only InvenTree API accesses InvenTree DB. The reviewer re-read that correction and nearby contracts, confirmed the finding resolved and reported clean bounded design clearance with no material new inconsistency. It did not rerun checks or access runtime/credentials/providers/inventory. Only factual review/publication-record prose changed afterward. The data model separately received a fresh clean bounded review including authentication and shared-instance decisions before PR #35.

Local validation passed: configured Markdown lint on all nine new documents; 56 local file/heading links; balanced fences for 24 diagrams; whitespace/portable-path checks including untracked content; original Python package SHA-256 preservation and byte-identical copied concept image. The unchanged asset was inspected as a legible exploratory three-layout comparison, not app verification. No runtime code changes are part of this package; normal application suites, DDL, provider login/inference, process/HTTP execution and production authentication were not exercised or claimed by these checks. Recheck the final publication candidate after review corrections.

Stage 1E's separate reviewer independently reproduced **44 combined/shared cases, zero skips**, using fresh owned PostgreSQL/process/fake-target state. Its owner record is retained under `docs/handovers/spike-combined-seams.md` in the dependency. That evidence is Python retained-provider replay plus authored controls, not TypeScript, fresh inference, native permission/restart parity, production HTTP/session authentication, durable SSE, restore or live-target proof. Do not confuse design review with execution evidence.

## Continuation and gates

1. Independent review/correction/re-review and local document checks are complete. Publish this cleared design PR under Mitch's existing authorization, based directly on refreshed shared contracts because data-model #35 has already merged there. The PR description is the current publication/CI entrypoint; refresh it before relying on this snapshot. Never merge automatically.
2. Refresh live PRs/branches and preserve all original worktrees/files. If consolidation #29 lands, update the remaining dependent base appropriately; do not blindly restack or rewrite others' work.
3. Before implementation, obtain scoped authorization and qualify first host/provider, SQL/runtime/library pins, identity/rights/refresh, review/effect scope and retention. Follow P0 onward in delivery, then a minimal manual/fake-target path. New TypeScript semantics require independent runtime proof.
4. If design changes are requested, update owning chapters, diagrams/contracts and model together. The preserved Python proposal is not an edit target without explicit request.
5. Before any live pilot, independently qualify the real application seams and read-only target compatibility, then obtain explicit selected-write authorization. Fake-target and conceptual evidence are insufficient.

## Constraints, gotchas and skills

Preserve all worktrees, untracked skills, local evidence and canonical run state. Never copy personal provider credentials, silently fall back to paid APIs, infer permission for unsupported provider deployment, mutate live inventory or clear uncertain claims. Authentication/entitlement gates precede inference; a blocked provider does not block manual/fake-target work. Do not weaken approval, original source identity or uncertain-write protections for delivery speed.

Repository documentation uses portable paths and one physical line per prose paragraph. Tool binaries located in another worktree may still fail to resolve Markdown plugins from this worktree; supply the locked dependencies locally without changing package declarations. Re-read after formatter changes. Concept art is a discussion aid, not verification of working interactions.

Relevant skills for continuation: **handover** for cross-session transfer; **github-pr-tools** for PR operations; **gh-stack** for dependent branches; **openai-docs** tools for Codex research; **browser-harness** for later real browser checks; **pr-review-loop** only when explicitly requested. This tracked owner record accompanies the authorized PR; no extra cloud document or external transfer pack is needed.
