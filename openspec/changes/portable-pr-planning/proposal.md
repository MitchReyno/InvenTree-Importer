# Repository-owned PR planning

## Problem and intended outcome

Planning currently carries an external tracking integration and a separate per-item detail directory. Task plans describe work but do not yet provide sufficiently explicit PR bundles or require completion marks to accompany the commits that deliver completed checkbox actions. Keep planning self-contained in the repository and make delivery identity and commit bookkeeping unambiguous.

## Change identity and linked items

Canonical change name: `portable-pr-planning`.

Branch: `docs/portable-pr-planning`. Commit and PR subjects use `docs(portable-pr-planning): description`. No BI index item is allocated for this workflow-maintenance change.

## Current behavior and evidence

The current schema and planning skill use a service-backed item workflow, the index links to per-item files, and task templates leave PR grouping largely implicit. Relevant files are `openspec/schemas/bench-intake/schema.yaml`, its templates/README, `docs/openspec.md`, `docs/PLANNED_FUNCTIONALITY.md` and the mirrored `planned-functionality` skill.

## Scope and non-goals

Remove retired integration references and specific resource identifiers from current tracked files, remove the per-item directory/guide, link index entries directly to OpenSpec changes, require descriptive kebab-case change identity in Git naming/messages, define reasoned PR delivery bundles and stage completed-item checkbox changes with their corresponding work. Preserve package research, detailed task checklists, flexible TDD, native spec lifecycle and review gates.

No external resource access or modification, Git history rewriting, application/runtime changes, dependency additions, provider calls or inventory operations are included. The top-level-task split constraint is awaiting clarification and must not be guessed.

## Reuse and dependency assessment

Use the existing OpenSpec 1.16.0 schema/templates, native change scaffolding and checkbox tracking, Git, the existing PR skill, and existing Markdown/workflow-sync tooling. These already support the required document shapes and naming conventions. A package or framework would not improve this instruction-only change; no new runtime or synchronization capability is being implemented, so further ecosystem selection is not relevant.

Custom work is limited to the project's policy and templates. Trade-off: the policy is prompt-level guidance, with structural validation and independent review supplying separate evidence; this change does not introduce an enforceable commit hook or repository service. Existing project references and the installed CLI's `schema`, `new change`, `status` and `instructions` interfaces were inspected during this session.

## Capabilities

No application behavior contract changes. Change metadata declares `skip_specs: true`; no delta spec files are created.

## Impact and dependencies

Affected areas are the planning index, schema/templates, mirrored planning skill and documentation/historical records. No deployment, migration or live service prerequisite exists. Final PR delivery policy depends on the user's response to the ambiguous task-splitting statement.

## Open decisions and assumptions

Clarify whether a single top-level task must stay within one PR or is intended to span several PRs. The PR map will otherwise group work by coherent review, verification, compatibility and delivery boundaries rather than a one-task/one-PR formula.
