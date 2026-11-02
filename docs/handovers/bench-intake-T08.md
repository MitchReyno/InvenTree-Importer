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

| Route                                         | Schema                                | Behaviour                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/batches/:id/operator-review`     | `OperatorReview`                      | Repeatable-read projection: per active lot review state (`unreviewed`, `reviewed`, `changed_after_review`), typed issues with `severity` and current disposition, lineage, retired lots and instructions, plus the capture cursor |
| `POST /api/v1/batches/:id/issue-dispositions` | `IssueDisposition` → `OperatorReview` | Dismiss one current warning with a 1–1024 character reason, bound to its subject dependency digest and batch revision. Blocking codes are rejected                                                                                |
| `POST /api/v1/batches/:id/bulk-edits`         | `BulkEdit` → `BulkEditResult`         | `preview: true` returns the exact impact without committing; `preview: false` applies one revision atomically to 1–100 lots                                                                                                       |
| `POST /api/v1/batches/:id/restructures`       | `Restructure` → `RestructureResult`   | `split_lot`, `merge_lots` (explicit same-contribution confirmation) and `move_lots`; dry-run preview or atomic apply                                                                                                              |
| `POST /api/v1/batches/:id/instructions`       | `InstructionEdit` → `OperatorReview`  | Append a batch or evidence-group instruction version                                                                                                                                                                              |

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

## Server stream results

Implemented by the T08 server-stream subagent in the shared T08 worktree, on top of baseline `fe00229`. No contract or generated file changed in this stream.

### Implementation and adjustments

- `intake-server/src/operator-review/` adds the projection, review states, impact measurement, repository and routes. `registerManual` registers the routes, so `api/server.ts` and `main.ts` are unchanged.
- Previews lock the batch, run the command inside a savepoint, measure exact before/after dependency digests, then roll back. They keep no idempotency record and return no new identities. Applied commands use the ordinary `idempotent()` scope with `operator_*` action names.
- Retired lots stay in `CaptureSnapshot`, as recorded in the coordinator status. Capture edits and notes on a retired lot return `lot_retired` (409). Review, preparation and approval treat it as a blocking issue.
- Restructuring takes the batch lock before reading source history, then refuses any lot with an approved original contribution (`lot_already_approved`, 409). A concurrent approval needs the same batch lock, so the check cannot race it.
- Unresolved warnings block review, preparation and approval (`warning_unresolved`). Preparation and approval need the check too: a sibling Part's change can raise `possible_duplicate_part` without changing this Part's reviewed facts.
- Dismissal rules: only warning codes can be dismissed (`issue_not_dismissible`), the warning must currently exist (`issue_not_found`), and its fact digest must match (`stale_issue`).
- An instruction for an unknown or foreign evidence group is refused through the composite FK (`group_not_found`), so capture never reads media tables.

### Checks run

| Command                                                                                                                                    | Result                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `pnpm --filter @invimport/intake-server test`                                                                                              | 64/64 passed, including 6 new model tests              |
| `pnpm db:intake test` with the retained decoder/probe image digests and Docker's CLI on the command `PATH`                                 | 70/70 passed, including 6 new operator-review PG tests |
| `pnpm db:intake test:process`                                                                                                              | 25/25 passed                                           |
| `tsc --noEmit` (intake-server), ESLint readability on `intake-server/src` and `contracts/src`, Prettier check, `contracts check:generated` | Clean                                                  |

Two earlier full-tier runs were environment failures, not code regressions:

- **Run 1:** no decoder image variable was set, so one test failed and five were skipped.
- **Run 2:** the decoder could not find `docker` on `PATH`, so six media tests ended `interrupted`.

Every PG/process window held the exclusive `pg-docker` lease, which was released after each run. No new containers, root `.env`, real InvenTree requests or model calls were used.

### Observed versus not tested

- **Observed** over real HTTP and PG:
  - A shared Part choice invalidates A and B; a lot-only edit invalidates only B; a default change spares an explicit override.
  - Bulk edits are atomic (a bad ID applies nothing), keep exact decimal strings and keep unnamed fields. A stale revision returns 412.
  - Previews commit nothing and report `stale_preparation_ids`.
  - Split, merge and move record lineage and retirement, and refuse retired, approved, duplicate, unconfirmed and cross-batch lots.
  - Dismissals survive a server restart and go stale after an edit. Instruction versions are retained.
- **Not tested:**
  - A Processing answer that targets a retired lot. It reaches the same capture guard but has no dedicated test.
  - Concurrent operator commands racing each other. The shared batch row lock serializes them, but no competing-transaction test exists.
  - Upgrade from a populated 0007 database.
- **Known cost:** impact and projection materialize each active lot separately, including one media read each. That is acceptable at the 100-lot capacity but is unmeasured.

## Frontend stream results

Implemented by the T08 frontend-stream subagent in the shared T08 worktree, on top of baseline `fe00229`. Only `frontend/**` and this section changed; contracts were consumed as published.

### Implementation and adjustments

- `App` creates `operatorReviewClient`; `Batch` polls the `OperatorReview` projection and shows it only when its revision matches the accepted batch revision. Capture and new Processing attempts hide retired lots; Processing job history for them stays visible.
- Review evolves in place rather than becoming a parallel path. `ReviewWorkspace` adds Evidence/Table modes and URL filters, and keeps the existing labels and scope bar, so the T04 journey tests run unchanged.
- New components live in `frontend/src/components/operator/`: evidence, decision panel, fact rows, issue panel and dismissal, compare matches, quick lot edit, table, bulk edit, restructure dialog, impact summary, retired history, instructions and the modal. Pure rules live in `frontend/src/operator/`.
- `useRetainedCommand` binds each apply to one payload and key. Previews use a fresh key because the server retains no preview record.
- The table selection is separate from the evidence view's approval scope (at most 10 lots). This keeps bulk edits up to 100 lots without changing the preparation limit.
- Group instructions read the evidence groups through the shared `media` query key; there is no new media endpoint.

### Checks run

| Command                                                                                       | Result                                                                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm exec vitest run` (frontend)                                                             | 18 files, 99/99 passed: 86 existing plus 13 new in `OperatorReview.test.tsx` and `OperatorSurfaces.test.tsx` |
| `tsc --noEmit` (frontend), `pnpm lint:frontend`, `pnpm lint:readability`, `pnpm format:check` | Clean                                                                                                        |
| `pnpm build`                                                                                  | Succeeded; Vite reported a chunk-size warning, not compared against the baseline build                       |

### Observed versus not tested

- **Observed** in jsdom with injected fakes:
  - Filters persist in the URL. Retired lots show only as history and cannot be selected.
  - Predecessor notes appear on successor lots.
  - A dismissal requires a reason and sends the exact digest.
  - Mark reviewed is disabled while a selected lot has an open warning.
  - A shared Part choice lists every affected lot before saving.
  - A bulk preview and its apply send the same change. An uncertain apply retries with the identical key, and a 412 keeps local input without reapplying.
  - J/K/R/E do nothing while typing.
  - Split sends exact decimal strings. Merge refuses to preview without the same-contribution confirmation.
  - Instructions save against the loaded revision.
- **Not tested (left for the coordinator's native pass):**
  - Real browser layout at 360/390 px.
  - Native `<dialog>` focus trapping (jsdom has no `showModal`; the component falls back to `open`).
  - Visual comparison against the original screenshots.
  - The full Batch → Review → reload flow against the live server routes.
