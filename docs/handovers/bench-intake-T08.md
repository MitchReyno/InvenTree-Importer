# T08 — operator evidence and review workspace

Owner: Claude Code (Opus 5.5), assigned by Mitch on 2026-11-02. Branch `feat/intake-operator-review`, based on `interactive-app` at `be3be4c`. T07 is owned separately by Codex in its own worktree; this task does not edit T07 files.

Status: prospective plan, written before implementation. Later sections record decisions, adjustments, results and review fixes as they happen.

## Prospective implementation plan

### Scope

T08 turns the existing manual Review stage into an evidence and review workspace without adding a second truth model. Every new view reads retained server state, and every change goes through a server command with revision checks.

In scope:

- **Evidence workspace.** Grouped lot queue with URL-persistent filters, an evidence panel (notes, linked retained media, predecessor evidence after a split) and a decision panel of fact rows. Each fact row shows the chosen value, its provenance (human set, inherited default, override, unknown, explicitly cleared), the available candidates and an edit control.
- **Candidates versus chosen facts.** Candidates are the batch's observed existing Parts/locations and fixture-labelled Processing proposals for that subject. A compare dialog sets observed Part candidates side by side. Choosing one is a separate human command; nothing is auto-selected.
- **Shared Part links.** Each lot shows the Part proposal it shares and the other lots that share it. Any shared edit states "affects N lots" before saving.
- **Table and bulk editing.** A second projection of the same facts with URL filters, explicit row selection, and bulk quantity/location/Part-proposal edits. Bulk edits preview the exact selected lots, affected shared Parts and excluded rows, then apply atomically or not at all.
- **Reasoned warning resolution.** Deterministic warnings with a recorded dismissal reason bound to the current subject dependency. Blocking issues can never be dismissed.
- **Scoped review invalidation.** A "changed after review" state when a subject's latest review digest no longer matches. Shared edits invalidate every dependent lot; lot-only edits invalidate only that lot.
- **Unapproved lot/Part restructuring.** Split one lot into new lots, merge confirmed same-contribution lots, and move lots between Part proposals. Each has a server dry-run impact preview, lineage links and retirement of the original unapproved lot.
- **Capture groups and instructions.** Batch instructions and evidence-group instructions retained as versioned human text and shown in Capture, Review and Processing.
- **Incremental Processing views.** Overview "needs you" summary and per-stage lot links on the existing Overview / Reading / Identifying / Research / Images / Inventory views, using retained fixture-only data.
- **Mobile and keyboard.** Narrow list → focused lot with explicit back; table scrolls inside a labelled region. Keyboard J/K move, R mark reviewed, E edit quantity, V focus evidence, without colliding with form fields.

Non-goals: no provider inference or T07 provider/read-broker/runner changes; no historical stock split/merge, quantity correction or overwrite; no approved-lot restructuring; no new inventory effects (T09); no SSE (T10); no login (T11); no prototype dark palette, PO controls or simulated research.

### Relevant code and contracts

- Capture: `contracts/src/capture.ts`, `intake-server/src/capture/repository.ts` (locked edit, selections, notes, observations), migration `0002_capture.sql`.
- Review: `intake-server/src/review/model.ts` (`materialize` builds per-subject dependency bytes; the lot digest embeds the Part digest), `review/preparations.ts` (`markReviewed`, preparation), `review/repository.ts` (manual workspace projection), `contracts/src/manual.ts`, migration `0004_manual_review.sql`.
- Media groups/links and Processing proposals/questions are read through their existing public client snapshots in the browser. The server does not query media or Processing SQL internals.
- Frontend: `components/review/*`, `components/capture/*`, `components/processing/*`, `capture/display.ts`, `queries/*`, `navigation/useNavigationGuard.ts`.

### Proposed public interfaces

A new contracts module, `contracts/src/operator-review.ts`, adds these schemas. Existing capture/manual/media/processing contracts stay unchanged.

| Route | Schema | Behaviour |
| --- | --- | --- |
| `GET /api/v1/batches/:id/operator-review` | `OperatorReview` | Repeatable-read projection: per active lot review state (`unreviewed`, `reviewed`, `changed_after_review`), typed issues with `severity` and current disposition, lineage, retired lots and instructions, plus the capture cursor |
| `POST /api/v1/batches/:id/issue-dispositions` | `IssueDisposition` → `OperatorReview` | Dismiss one current warning with a 1–1024 character reason, bound to its subject dependency digest and batch revision. Blocking codes are rejected |
| `POST /api/v1/batches/:id/bulk-edits` | `BulkEdit` → `BulkEditResult` | `preview: true` returns the exact impact without committing; `preview: false` applies one revision atomically to 1–100 lots |
| `POST /api/v1/batches/:id/restructures` | `Restructure` → `RestructureResult` | `split_lot`, `merge_lots` (explicit same-contribution confirmation) and `move_lots`; dry-run preview or atomic apply |
| `POST /api/v1/batches/:id/instructions` | `InstructionEdit` → `OperatorReview` | Append a batch or evidence-group instruction version |

All mutations require `Idempotency-Key`, CSRF and the expected batch revision, and return the existing safe error DTO. A 412/`revision_conflict` keeps the browser draft.

### Proposed schema (migration number allocated by the integrator)

- `capture_lot_lineage(batch_id, predecessor_lot_id, successor_lot_id, action split|merge, actor_id, revision, created_at)`, immutable, same-batch composite FKs, no self edges.
- `capture_lot_retirement(batch_id, lot_id, revision, actor_id, created_at)`, immutable. A retired lot keeps its identity and history and leaves the active lot list.
- `capture_issue_disposition(id, batch_id, subject_id, code, dependency_digest, reason, actor_id, created_at)`, immutable and append-only. It is current only while the digest still matches.
- `capture_instruction(id, batch_id, group_id null, version, text, actor_id, created_at)`, immutable versions; `group_id` references the retained media group in the same batch.

Existing migrations 0001–0007 stay immutable.

### Design decisions and alternatives

- **Warnings gate review, not preparation.** "Mark reviewed" rejects a scope with an undismissed warning, and preparation already requires current reviews. Dispositions enter the lot dependency bytes under a new `manual-lot-review/3` version only when one exists, so retained `/1` and `/2` preparations keep their exact bytes. The alternative of a separate preparation gate would duplicate review authority.
- **Deterministic warnings only.** `possible_duplicate_part` (two Part proposals choose the same existing Part), `no_supporting_evidence` (no nonempty note or linked media on the lot, its Part or its predecessors) and `location_cleared` (stock would have no location). Each has a reason a human can judge. No warning comes from simulated research.
- **Retired lots leave the active list instead of adding a field to `CaptureSnapshot`.** The capture repository filters them, so Review, Approve, Processing starts and media attachment cannot select them. Lineage and retired history appear in `OperatorReview`. Changing the shared snapshot contract was rejected because it touches every consumer.
- **Server dry run for impact previews.** The command runs in a transaction that is rolled back, then reports exact invalidated subjects, retired/created lots and stale preparations. A browser-side diff would guess at server dependency rules.
- **Split children start from explicit human values.** Each child gets a new contribution key, the predecessor's Part proposal, a copied location selection and an explicit quantity. Predecessor notes and media links stay on the predecessor and are shown through lineage; media links are not silently copied.
- **Instructions are retained human context.** Processing remains fixture-only, so the UI says instructions are retained for research and not yet consumed. Feeding them into Processing inputs is a T07 interface proposal.
- **Packages.** No new runtime dependency is planned. Existing React Hook Form, TanStack Query, styled-components and generated clients cover forms, reads and styling. A table library was considered; at ≤100 lots a plain semantic `<table>` with explicit selection stays more accessible and readable than adding TanStack Table.

### Implementation sequence

1. Contracts module and interface proposal to the integrator; register and regenerate only after acknowledgement.
2. Migration and server domain: lineage/retirement, dispositions and warnings in `materialize`, review-state projection, bulk edit, restructure, instructions and dry-run previews.
3. Server tests: pure model tests for warnings/digests, HTTP tests, and leased PG tests for invalidation scope, atomic bulk, restructure guards (approved lot refused, cyclic or cross-batch lineage refused) and conflicts.
4. Frontend: evidence workspace, fact rows and compare dialog, table and bulk bar, warnings and dismissal, restructure dialogs, instructions, Processing summaries, keyboard and narrow layouts. Each is a separate coherent TSX component in the current palette.
5. Frontend component tests, then a leased native browser pass (recordings off) on an isolated owned fixture at desktop and 390 px widths.
6. Architecture and handover updates, local review rounds, ready PR to `interactive-app`, fresh independent exact-head review, then the approved squash protocol.

### Verification and adverse cases

- Shared Part choice edit invalidates both lots A and B; a lot B quantity edit invalidates only B; a default change does not invalidate an explicit override.
- Explicit unset/unknown/clear/inherit values survive bulk edits, which change only the named fields; exact decimal strings are preserved.
- Selected review with deferred rows: reviewing A leaves B unreviewed and outside preparation.
- A warning dismissal goes stale after a relevant edit; blocking issues cannot be dismissed.
- Bulk edit with one invalid row applies nothing. A stale revision returns a conflict and keeps the draft.
- Split/merge refuse approved or retired lots, cross-batch IDs and duplicates. Merge needs explicit confirmation. Retired lots cannot be selected for review, preparation or edits. A pinned preparation that includes a restructured lot becomes stale.
- Restart keeps lineage, dispositions and instructions.
- Browser: keyboard flow, narrow layout without page overflow, a conflict that keeps local edits, and representative nondefault states (warning dismissed, changed after review, retired lineage).

### Ownership, services and safety

Claude owns the frontend, capture/review domain and the new contracts module. Codex integrates `contracts/src/index.ts`, generated artifacts, migrations numbering, root manifests/lock/CI and main wiring; requests go through the shared proposal files. New routes register inside the existing capture/review registration functions, so `api/server.ts` wiring is unchanged.

PG/browser work runs only under the exclusive `pg-docker` lease on the sole owned PostgreSQL service, using random isolated databases. Tests use owned fakes and never load the root `.env`. The real InvenTree stays strictly read-only and receives no requests. No application model or provider is called. The user preview stays stopped and the retained 4310 service is untouched. This initiative is exempt from feature flags by Mitch's decision.
