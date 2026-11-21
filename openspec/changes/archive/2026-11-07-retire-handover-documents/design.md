# Design assessment

## Context and grounding

See the [proposal](proposal.md) for the audit. The `bench-intake` schema defines proposal, specs, design and tasks; apply tracks `tasks.md`. OpenSpec 1.16.0 artifacts have no optional flag, but a status of `ready` or `blocked` does not block apply, and the archive skill already warns about any artifact that is neither `done` nor `skipped`.

## Goals and constraints

- One short, durable record per change, written as work happens, that a later reader can trust as history.
- Tooling enforces where the record lives; it isn't only described in prose.
- No planning artifact is created early: notes describe implementation, so they must not be drafted during propose.
- Skill mirrors stay identical, and the OpenSpec-generated skills keep only small local adaptations, so `openspec update` stays easy to reapply.

## Decisions and alternatives

- **D1 — `notes` is a schema artifact that requires `tasks`.** It generates `notes.md` from `templates/notes.md`. It is not in `apply.requires`, so the propose skill, which builds only the apply-required closure, never writes it. `openspec instructions notes` serves the template and rules during apply, and archive warns when it is missing. Rejected: a prose-only convention (archive cannot check it) and adding `notes` to `apply.requires` (it would have to exist before implementation starts).
- **D2 — four fixed sections.** Changes to the plan, Unexpected challenges, Decisions made during implementation, and Open items. Each entry is dated and tied to its task or PR. Verification goes in the PR description, so review rounds, test output and CI results are excluded.
- **D3 — the plan stays current and notes keep the history.** When a departure changes the plan, the affected artifact is updated as well. The note records that it happened and why.
- **D4 — small work outside OpenSpec has no separate record.** Its plan and verification go in the PR description.
- **D5 — architecture documents stop citing evidence records.** Sentences that only point at a handover are removed. Facts stay.
- **D6 — retired handovers are deleted, not archived in the tree.** Git history at `2d852e2` keeps them. Keeping a `docs/archive/` copy would leave 10,000 lines for search and agents to keep tripping over.

## State, authority and failure behavior

Documentation and instructions only. No runtime, provider or inventory behavior changes. A change without `notes.md` still applies normally; archive warns and asks for confirmation.

## Verification strategy

- `openspec schema validate bench-intake`, then a disposable project exercising `notes` through blocked → ready → done, `openspec instructions notes`, and `isComplete`.
- Every migrated `notes.md` is checked against its source handover for invented content and against the template's sections.
- After deletion, no relative link points at a deleted handover. Docs due for retirement under `baseline-specs` link to the `2d852e2` permalinks instead, and no live document cites a handover as evidence.
- `pnpm lint:markdown`, `pnpm format:check`, `pnpm workflow-sync`, and an exact mirror comparison of the edited skill.

## Migration, rollout and recovery

Existing changes keep their schema. They show `notes` as `ready` until they gain a `notes.md`; the six with handovers get one in this change. `redesign-batch-workspace` is migrated in a follow-up once the session editing it finishes. To recover a deleted handover, run `git show 2d852e2:docs/handovers/<name>.md`.

## Risks and open decisions

- `isPlanningComplete` now stays false until `notes.md` exists. No installed skill branches on it. OpenSpec's `continue` workflow would offer `notes` as the next artifact; it is not installed here.
- The update-change skill lists every `ready` artifact without a file, so during planning it may offer to create `notes`. Its instruction says to create notes only when implementation starts, so decline it until then. The generated skill is not adapted, to keep `openspec update` easy to reapply.
- Detail dropped in distillation (review-round fixes that hardened code without changing the design) is still in Git history.
