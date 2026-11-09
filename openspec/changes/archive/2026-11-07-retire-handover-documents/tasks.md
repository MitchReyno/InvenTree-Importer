# Implementation and delivery tasks

## Plan context

Canonical change: `retire-handover-documents`; no linked BI item (see the [proposal](proposal.md)). The [design](design.md) records decisions D1–D6. The change declares `skip_specs: true`. Branch `docs/retire-handover-documents`; subjects `docs(retire-handover-documents): …`.

## Completion and commit ordering

Check each action after it is done and verified, and commit the `tasks.md` update with its work. Review, publication, CI and merge actions stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Notes artifact and rules | Tooling/documentation | None | Design D1–D4 |
| 2. Migrate change-linked handovers | Documentation | 1 (template) | Proposal audit, first table row |
| 3. Retire handovers and repoint links | Documentation | 2 | Proposal audit; design D5–D6 |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Notes replace handovers; the retired handovers are gone and no live document cites them | Tasks 1–3 in full | The rule change, the migration and the deletion only make sense together: deleting without migrating loses history, and changing the rule without migrating leaves two conventions | None | `interactive-app`, `docs/retire-handover-documents`, `docs(retire-handover-documents): replace handovers with implementation notes` | Markdown/format checks, `workflow-sync`, schema qualification, independent exact-head review, selected CI |

## 1. Notes artifact and rules

- PR delivery: PR-A.
- Outcome: the schema defines `notes`, and every instruction that required a handover points at `notes.md` or the PR description.
- Scope and approach: `openspec/schemas/bench-intake/` (schema, README, `templates/notes.md`, `templates/tasks.md`), `openspec/config.yaml`, `docs/openspec.md`, `AGENTS.md`, `CODE_GUIDELINES.md`, `intake-server/CODE_GUIDELINES.md`, `intake-server/TESTING.md`, and the apply skill in both mirrors plus `/opsx:apply`.
- Prerequisites: None.
- Acceptance: design D1–D4.
- TDD approach: not behavioral. Verified by schema validation and a disposable-project lifecycle exercise.
- Verification: `openspec schema validate bench-intake --json`; temp project status before and after tasks and notes; `pnpm workflow-sync`.

- [x] 1.1 Add the `notes` artifact, its template and the apply instruction.
- [x] 1.2 Replace handover wording in the schema README, tasks template, config, `docs/openspec.md`, `AGENTS.md` and the guidelines.
- [x] 1.3 Add the notes step to the apply skill mirrors and native command.
- [x] 1.4 Qualify the schema in a disposable project.

## 2. Migrate change-linked handovers

- PR delivery: PR-A.
- Outcome: each change with a handover has a `notes.md` holding what is worth keeping, with nothing invented.
- Scope and approach: `simplify-intake-entry`, `local-inventree-dev`, `portable-pr-planning`, and the archived `capture-tab-uplift`, `status-signalling-uplift` and `batch-settings-overhaul`. Repoint task and README references to the notes. `redesign-batch-workspace` is excluded while another session edits it.
- Prerequisites: task 1.
- Acceptance: proposal audit, first row.
- TDD approach: documentation; checked against the source handover.
- Verification: remark and prettier on each file; spot-check entries against the handover.

- [x] 2.1 Write the six `notes.md` files.
- [x] 2.2 Repoint change artifacts that named a handover path.

## 3. Retire handovers and repoint links

- PR delivery: PR-A.
- Outcome: `docs/handovers/` contains only `redesign-batch-workspace.md`, and no live document cites a handover.
- Scope and approach: delete 72 files; remove evidence-pointer sentences from architecture documents, READMEs and spike READMEs (design D5).
- Prerequisites: task 2.
- Acceptance: proposal audit; design D5–D6.
- TDD approach: documentation; reference checks.
- Verification: no relative link points at a deleted handover (docs due for retirement use `2d852e2` permalinks), and no live document cites a handover as evidence; `pnpm lint:markdown`; `pnpm format:check`.

- [x] 3.1 Remove handover links and pointer sentences from live documents.
- [x] 3.2 Delete the retired handovers.
- [x] 3.3 Run the reference, Markdown and format checks.

## Delivery evidence and lifecycle follow-up

- [ ] D.1 PR-A: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization.

Follow-ups outside this change: the `redesign-batch-workspace` handover was migrated into that change's [notes](../2026-11-09-redesign-batch-workspace/notes.md), and `baseline-specs` was implemented and archived as `2026-11-07-baseline-specs`.
