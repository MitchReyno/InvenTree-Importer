# Implementation notes

Delivered in PR-A on `docs/retire-handover-documents`. The `redesign-batch-workspace` handover remains until the session editing that change finishes.

## Changes to the plan

- **2026-11-07, scope:** the audit first planned a single change that would also convert requirement documents into baseline specs. Specs must be authored before design and tasks, so carrying them here would have blocked the handover work behind the larger spec effort. That work moved to a separate `baseline-specs` change.
- **2026-11-07, task 2:** `redesign-batch-workspace` was excluded because another session is adding to it. Neither its handover nor its change directory is touched, and it is not synced or archived.

## Unexpected challenges

- **2026-11-07, task 1:** with `notes` in the schema, `isPlanningComplete` stays false until `notes.md` exists, because the CLI counts every artifact. No installed skill branches on the flag, so this was accepted rather than worked around.

## Decisions made during implementation

- **2026-11-07, task 1:** `notes` requires `tasks` but is not in `apply.requires`, so planning never drafts it and archive still warns when it is missing (design D1).
- **2026-11-07, task 2:** entries in migrated notes carry a date only where the handover or Git history gives one. Archived handovers rarely date individual tasks, so most of their entries are keyed by task and PR alone.

## Open items

- Migrate `docs/handovers/redesign-batch-workspace.md` into that change's `notes.md` once the other session lands its work.
- Plan the `baseline-specs` change for the documents listed in the [proposal](proposal.md#requirement-and-plan-documents).
