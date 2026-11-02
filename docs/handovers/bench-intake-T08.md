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

- **Warnings gate review, not preparation.** *(Superseded during implementation: warnings gate review, preparation and approval, and the wrapper is `manual-subject-review/3`; see the coordinator adjustments below.)* "Mark reviewed" rejects a scope with an undismissed warning, and preparation already requires current reviews. Dispositions enter the lot dependency bytes under a new `manual-lot-review/3` version only when one exists, so retained `/1` and `/2` preparations keep their exact bytes. The alternative of a separate preparation gate would duplicate review authority.
- **Deterministic warnings only.** `possible_duplicate_part` (two Part proposals choose the same existing Part), `no_supporting_evidence` (no nonempty note or linked media on the lot, its Part or its predecessors) and `location_cleared` (stock would have no location). Each has a reason a human can judge. No warning comes from simulated research.
- **Retired lots leave the active list instead of adding a field to `CaptureSnapshot`.** *(Superseded: retired lots stay in the snapshot as history; see the coordinator adjustments below.)* The capture repository filters them, so Review, Approve, Processing starts and media attachment cannot select them. Lineage and retired history appear in `OperatorReview`. Changing the shared snapshot contract was rejected because it touches every consumer.
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

## Coordinator integration and native evidence

### Chronology and plan adjustments

The plan above was committed before implementation (`b6fa810`). Codex acknowledged the contracts registration, generator paths and migration `0008` in the shared proposal files before those edits; T07 reserves `0009`.

One planned decision was reversed during implementation. The plan said retired lots would leave `CaptureSnapshot.lots`. Processing's read path validates every historical job subject against that list, so hiding a lot that ever had a job would turn the whole Processing read into an error. Retired lots therefore stay in the capture snapshot as history. Capture edits and notes refuse them with `lot_retired`, review/preparation/approval treat them as blocking, and the browser hides them from every selectable list. Codex's conditions (history inspectable, no Processing 500, lanes untouched) hold. Refusing new Processing starts on a retired lot is proposed to Codex as a Processing-owned follow-up.

Warnings gate preparation and approval as well as review. A sibling Part proposal changing can raise `possible_duplicate_part` without changing this Part's reviewed facts, so a review-only gate would let an unresolved warning reach approval. The planned `location_cleared` warning was dropped: an explicit "no location" is already a deliberate human choice.

At Mitch's request, implementation then ran as two parallel streams in this worktree with disjoint paths: server (`intake-server/**`) and frontend (`frontend/**`). The coordinator committed each stream after rerunning its checks: `fe00229` (contracts and review context), `68d34f4` (server), `e9f1ccd` (frontend).

### Native browser pass

Owned fixture `pnpm db:intake preview:manual` on 127.0.0.1:4330, under the exclusive `pg-docker` lease, with the T04 two-lot seed. Browser-harness with recordings off; real clicks and typing.

| Case | Result |
| --- | --- |
| Desktop evidence workspace renders live operator-review data | Observed: [review](../bench-intake/evidence/T08/review-desktop.png), [focused lot](../bench-intake/evidence/T08/review-focused-desktop.png) |
| Mark A and B reviewed, then a lot-only quantity edit on B (23 → 24) | Observed: B became "Changed after review", A stayed Reviewed (revision 9) |
| 390 px table | Observed: no page overflow (scroll width 390); table scrolls inside its labelled region ([screenshot](../bench-intake/evidence/T08/table-390.png)) |
| Split B into B1 (10) and B2 (14) | Observed: server preview listed exact retired/created lots, no shared Part affected and no invalidated reviews; apply produced revision 10 |
| Web child restart and full reload | Observed: revision 10, B retired with lineage to B1/B2 ([screenshot](../bench-intake/evidence/T08/retired-after-restart.png)) |

The pass found one defect: the batch header counted retired lots. It now counts active lots and states retired ones separately, with a regression test.

Full-page screenshots leave elements below the viewport inside scroll layers blank; viewport captures after native scrolling show them correctly. The fixture was stopped with SIGTERM to its exact process, its database was dropped, port 4330 was released and the lease removed. Two older `intake_test_*` databases from 2026-11-01 predate this task and were left untouched. The retained 4310 service was not touched, and the user preview stayed stopped.

### Not tested natively

Warning dismissal, compare matches, bulk edit preview/apply, merge/move dialogs, keyboard shortcuts, conflict-retained drafts and native `<dialog>` focus trapping were not driven in the browser. They are covered by component tests (jsdom) and PG tests only. No real InvenTree request, provider or model call was made.

## Local review round 1 fixes

A fresh read-only reviewer checked head `88ff863`. It found no critical issues and confirmed byte stability, invalidation scope, lock order, preview rollback and retired-lot blocking. Fixes:

- **Predecessor media counts as evidence.** Linked media on any subject, including retired predecessors, now satisfies `no_supporting_evidence`. This is a presence check only, so it never enters sealed bytes.
- **Lot dismissals bind to Part facts, not Part dismissals.** Dismissing a Part warning still invalidates the dependent lot reviews, as review binds dispositions. It no longer silently brings back lot warnings that were already dismissed. Part warnings now state the affected lots and that their reviews need renewing.
- **Retries are exact and finish properly.** Bulk, restructure, dismissal and instruction intents freeze the revision they were first sent with. Dismissal and instruction retries now close and reload on success.
- **Server-side checks.** Dismissal reasons must contain a non-whitespace character (contract pattern, regenerated). Operator command outcomes are validated before they are returned.
- **Tests.** `tests/review-vectors.test.ts` freezes the selection and subject digests produced by the pre-T08 `materialize` at `be3be4c` for `/1` and `/2` fixtures; the current code reproduces them exactly. The PG preview test now asserts that a preview leaves no capture revision, selection, stream event or idempotency record, and that the same key then applies.

### Existing data under the warning gate

The warning gate also applies to lots created before T08. A lot with no nonempty note and no linked media on itself, its Part proposal or its predecessors now needs evidence or a reasoned dismissal before review. An unapproved preparation retained from before T08 for such a lot will refuse approval with `warning_unresolved`, even though its bytes are unchanged. The fix is to add evidence or dismiss the warning, then review and prepare again. Already approved runs and their recovery are unaffected.

Not yet tested: concurrent approval racing a restructure (the batch row lock serializes them by design), and upgrading a populated 0007 database.

## Retirement qualification

`intake-server/tests/pg/operator-retirement.test.ts` provides the evidence promised to Codex in the shared `claude-T08-retirement-semantics.md` proposal. It retires lots through the real operator split command (trusted owner pool) and drives Processing through its public HTTP routes plus the existing direct runner seams (`claimProcessingCommand`, `acceptEnvelope`). It uses deterministic synthetic envelopes only, with no provider or model.

| Case | Result |
| --- | --- |
| Retired subject start, alone or mixed with an active lot | 409 `subject_retired`, no job created; the active lot alone still starts and claims |
| Queued attempt for a lot retired before claim | Claim returns nothing, attempt `superseded`, lane not occupied, job reads `superseded` |
| Open question on a lot retired afterwards | Answer 412 `stale_question` with no capture write; job and question read `superseded`; the retained proposal stays listed |
| Start and answer committed before retirement, redelivered with the same key and body | Original receipts returned; attempt count unchanged |
| Running attempt with a held lane | Still `running`, `occupies_lane: true`, `input_current: false` after retirement; released only by its exact terminal envelope (accepted as `stale`) |

Mutation checks showed which code the tests depend on, and restored the files from backups:

- **Explicit check disabled:** with the retired check in `processingInputIsCurrent` disabled, all five still pass. The snapshot's `retired: true` already changes that lot's recomputed input manifest, so the explicit check is a defensive duplicate.
- **Snapshot flag removed:** with the projected `retired` flag removed (and the helper's own assertion bypassed), cases 1, 2, 3 and 5 fail. Case 4 passes either way, as it guards adoption rather than retirement.

All runs held the exclusive `pg-docker` lease, used decoder `sha256:877516742f7b760d12937fdaebe7086edc1b9e227c875bc68b9b24fa910c10cb` and probe `sha256:2d13d4364b84e22bdeb7aee36ebafc6fc15d80a5111aeecc9fac5c1466f61c70`, and had Docker's CLI on the command `PATH`.

| Command | Result |
| --- | --- |
| `NODE_OPTIONS=--test-name-pattern=retire pnpm db:intake test` | 20/20 passed, including the 5 new cases |
| `pnpm db:intake test` (full PG tier) | 75/75 passed, 0 skipped |
| `pnpm db:intake test:process` | 25/25 passed, 0 skipped |

Afterwards no test databases, processes or containers from these runs remained; only the two pre-existing 2026-11-01 test databases are present. Five `intake_<hex>` roles exist in the cluster; fixture disposal drops its own roles, but no baseline was taken, so their origin is not attributed and they were left alone.

## Local review round 2 fixes

A second fresh reviewer checked `7e3c0db`. It verified all round-1 fixes and the Processing retirement paths (start, claim, message acceptance, answer, read and continuations) and found no critical or important issues. Fixes for its minor findings:

- Media links and attachment selections now refuse retired lots with `lot_retired`, so retired history stays frozen and cannot clear a successor's evidence warning. PG test `tests/pg/operator-media-retirement.test.ts`.
- The browser derives retired lots from the snapshot flag as well as the operator projection, so they stay hidden if the projection is unavailable. A Processing start refused with `subject_retired` shows a specific message.
- Architecture docs now describe the implemented retirement contract instead of a proposed follow-up, including a Processing section.
- The explicit retired check in `processingInputIsCurrent` is labelled defensive.

Checks: focused `NODE_OPTIONS=--test-name-pattern=retire pnpm db:intake test` 21/21 under the lease; frontend 103/103; fast tier and static checks clean.

## Local review round 3 and recorded nits

A third fresh reviewer checked `d9cd6ae` (delta from `7e3c0db`) and found no new material issues. Local review is complete. These non-correctness items are recorded for the next owner touching media or retirement (T09 kickoff, or a T08 follow-up if T09 does not touch these files):

- `frontend/src/components/media/MediaWorkspace.tsx`: a `lot_retired` refusal from a stale view shows the generic "Media change was not confirmed" text; map it through `operator/command-failure.ts`.
- `intake-server/tests/pg/operator-media-retirement.test.ts`: also assert status 409, an unchanged media revision after the refusals, and an unlink (`linked: false`) case.
- `frontend/src/components/batches/Batch.tsx`: the `useMemo` comment should say the retired set comes from `batch` and `operatorReview`.

## Continuation plan — warning gates and independent review

Mitch assigned continuation to Codex GPT-6 on 2026-11-02. Before changes: add warningIssues to the publication transaction and filter unresolved warnings from workspace preparations. Extend operator-review PG coverage with an initially valid selected scope and a separate active Part whose later choice creates a duplicate warning without changing selected dependency bytes. Assert held-read publication blocks without a preparation, existing preparations disappear, and dismissal restores eligibility. Reuse the owned fake and existing transaction seams; no dependency or interface change is needed. Qualify fast/frontend/types/generation/lint/format/build, then focused and full PG under the shared lease. Push before a fresh independent read-only exact-head review covering the previously unreviewed frontend, HTTP/contracts/generator, immutable vectors, docs and these fixes; merge only into interactive-app with green selected CI and reviewed SHA pinned.

### Continuation implementation and qualification

Both partial-review Minor findings are corrected. The final preparation transaction rechecks `warningIssues(material)` after target reads; workspace preparations also require no unresolved warnings. No contracts, migrations or shared currentness predicates changed.

Two actual HTTP/PG regressions create a separate active Part proposal and move deferred B to it before reviewing A. Choosing A's existing Part on B's proposal then creates a duplicate warning without changing A's retained dependency bytes. The held-read case asserts blocked publication, `warning_unresolved`, no `stale_preparation` fallback, no preparation row and zero fake POSTs. The listing case first sees the prepared preview, then sees none after the sibling change; reasoned dismissal, explicit re-review and a new preparation restore a visible valid preview. Removing either gate temporarily made its regression fail at the intended assertion (prepared instead of blocked; visible preview instead of empty list). Exact source bytes were restored in `finally` before final qualification.

Observed on the continuation source, using deterministic fakes only:

| Check | Result |
| --- | --- |
| `pnpm test:intake` | Contracts 28/28 and server 68/68 on isolated rerun; the initial concurrent run had two five-second startup readiness timeouts, recorded rather than hidden |
| `pnpm test:frontend` | 103/103 |
| `pnpm typecheck`, `pnpm contracts:check` | Pass |
| `pnpm lint:readability`, `pnpm lint:frontend`, `pnpm format:check` | Pass |
| `pnpm build` | Pass; existing large-chunk advisory remains |
| `pnpm db:intake test` | 78/78, zero failures/skips, retained decoder/probe image IDs from the earlier evidence |
| `NODE_OPTIONS=--test-name-pattern='retire\|duplicate warnings' pnpm db:intake test` | 23/23, zero failures/skips, after both negative controls were restored |
| `git diff --check` | Pass |

Logs are retained locally under `.temp/t08-continuation/`. The exclusive PG/Docker lease was held for PG and negative controls, with no shared-service restart, preview restart or 4310 changes. Browser-harness reports recordings off and no active recording; no new native UI claim is made for these server-only fixes. Code intelligence is unavailable, so its checks are skipped. Process-tier evidence from the previous head remains historical; new-head selected CI and a fresh independent read-only review are still required before merge. Actual model/provider usage and real inventory requests remain absent and unqualified.

### Independent review continuation — draft lifetime plan

The fresh reviewer reproduced a material draft loss on `2d3f41a`: internal Review lot/view navigation and closing the lot editor unmount local drafts without save or explicit discard. The reviewer is continuing the remaining scope while the owner fixes this connected boundary. Before implementation: introduce source-keyed dirty aggregation for simultaneously mounted operator forms, report dirty synchronously on native change, guard local review navigation and editor closing, add explicit draft discard where needed, and prevent a sibling save/reload from discarding another form's draft. Preserve exact uncertain retry identities and conflict values; no database/contract change is planned. Extend existing frontend tests with real navigation after dirty/conflict/uncertain commands and sibling-dialog lifecycle cases, plus instruction/editor exclusion. Requalify frontend/types/lint/build and request exact-new-head independent re-review before any merge.

### Independent review corrections before trunk integration

The independent reviewer completed the whole baseline delta and reproduced six material groups on `2d3f41a`, with adversarial artifacts retained outside source. Corrections authored by the owner:

- Source-keyed dirty aggregation and synchronous native-change reports protect Review local navigation, closing, archive and sibling commands. Explicit discard controls release the appropriate draft. Capture defaults/media and instructions exclude sibling saves; instruction groups exclude each other. A missing/mismatched operator projection retains accepted draft owners and their exact uncertain intents, fences fresh commands, and leaves pinned retries usable.
- Typed 5xx errors remain uncertain, retaining the original payload/key; in-flight retained intents also protect their lifetime.
- Snapshot `retired: true` filters the queue even without the operator projection.
- Impact preparation currency now uses the same unresolved-warning policy as preparation/listing. An actual HTTP/PG move preview reports the warning-only stale preparation, rolls back all capture changes, and matches applied impact. The missing-filter negative control fails at expected stale ID versus empty list; exact source was restored.
- Bulk and restructure previews freeze fields while pending and ignore late responses after the draft generation changes. Later edits invalidate the displayed preview.
- A failed shared-Part choice through actual `Batch.edit` preserves its dialog and candidate rather than treating a resolved 412 handler as success. The confirmed saved revision owns successful remount.

Pre-integration qualification: frontend 113/113, focused operator surfaces 27/27, types, frontend/readability lint and build pass. The initial lint run caught two test declaration-spacing errors, corrected before commit. Focused PG move set 18/18 passed before its negative control; full combined PG/process qualification follows trunk integration. No actual model/provider or protected inventory requests occurred. T07 has now merged at `ff8d31fefd7e553fe55aebe527f109815e75ffcb`: next integrate that actual trunk without rewriting published history, preserve retirement plus V3 source admission predicates, regenerate combined contracts, build source-current decoder/probe images, requalify all tiers and request exact-head re-review. No clearance or merge is claimed here.
