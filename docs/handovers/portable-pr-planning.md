# PR bundles and repository planning

## Plan recorded before implementation

The user requested explicit PR delivery boundaries in task plans, completion checkboxes updated before corresponding completed work is committed, removal of `docs/planned-functionality/`, and index links to OpenSpec changes. They subsequently retired the external ticket-service integration, prohibited references to its resources in tracked files, and required short descriptive kebab-case change names in branch and commit/PR message conventions. Do not access, read, edit or delete any external service resource as part of this work.

One statement about splitting a top-level task across PRs is ambiguous. A concise clarification is pending; do not encode that constraint until answered. Independently proceed with repository cleanup, change naming and completion ordering. PR bundles will be explicit and justified by coherent review/delivery boundaries rather than a prescribed one-task/one-PR mapping.

Scope: active register and planning skill, OpenSpec config/schema/templates/guide, removal of the per-item detail directory and retired integration guide, plus cleanup of service references in current tracked historical records. Preserve meaningful historical verification facts while removing identifying links and obsolete integration instructions; do not rewrite Git history. There are no existing item detail records to migrate. The BI item prefix remains available in the index, separate from the canonical OpenSpec change slug.

Use a separate conventional branch from current `interactive-app`; retain package research, detailed tasks, flexible TDD, native lifecycle behavior and independent review. No application code, dependency, provider, inventory or external resource changes are needed.

## Implementation and validation plan

1. Audit all tracked content and filenames for retired integration references and per-item directory links. Remove the requested directory and guide; replace runtime ticket allocation/metadata ownership with repository planning conventions. Index entries point directly to OpenSpec changes or their archived location.
2. Require one canonical short descriptive kebab-case change name, the matching change directory, and that exact slug in branches and conventional commit/PR subjects. Add an explicit per-change PR delivery map describing bundle scope, task/checklist coverage, prerequisites, rationale, verification and merge boundaries after resolving the task-splitting rule.
3. Require completed checklist actions to be checked before their corresponding work is committed, staging task updates with that work. Leave genuinely incomplete review/publication/merge actions unchecked; do not fake completion to satisfy a commit rule.
4. Mirror skill changes. Validate schema and enriched instructions in disposable fixtures, native nested-checkbox progress and lifecycle behavior, active links, Markdown, reference audits, skill frontmatter and workflow synchronization. These are documentation/instruction changes; do not add prose-pinning tests or rerun unrelated application suites without cause.
5. Commit, obtain independent read-only exact-head review, fix and re-review findings, publish a focused PR to `interactive-app`, and merge only after selected CI and review are clear under standing authorization.

## Current result

The per-item directory and retired guide are removed; no real detail records existed to migrate. Active index, skill, schema and guides now use repository-owned metadata and direct OpenSpec links. All current tracked/new file content and filenames were audited for retired product/resource references; no matches remain. Historical records were sanitized or renamed without rewriting Git history. No external resource access or mutation occurred.

Created the actual `portable-pr-planning` change with native spec skipping and a brief/proposal/design/tasks plan. Its branch is `docs/portable-pr-planning` and commit/PR subjects use the canonical slug. Completion-order guidance requires task updates staged with corresponding completed work while preserving genuinely pending events. This change's completed Task 1/2 actions are checked before their work is committed. Generic PR-map fields are implemented; the top-level-task split constraint is still awaiting clarification and is not guessed.

Validation passed: OpenSpec 1.16.0 schema and strict current-change validation, 12 disposable CLI lifecycle/progress observations, workflow-sync 8, both skill validators, active link checks, mirrored skill equality, Markdown and whitespace. No prose-pinning tests or unrelated application suite were run for instruction-only changes. Independent review/publication and the final bundle constraint remain pending.
