# Bench Intake OpenSpec planning

The project uses the custom [`bench-intake` schema](../openspec/schemas/bench-intake/README.md) with standard OpenSpec lifecycle skills. Planning is repository-owned: the [functionality index](PLANNED_FUNCTIONALITY.md) owns current item metadata and links directly to OpenSpec changes for detail. No external ticket-service integration is required.

## Capture and change identity

BI item identifiers such as `BI-001` identify index entries. Each OpenSpec change has a separate canonical short descriptive kebab-case name, such as `add-bulk-lot-editing`. Choose a name that conveys the outcome, check active and archived changes for collisions, and keep it stable once referenced.

Use the exact change name in its directory, every delivering Git branch and every commit/PR subject. Branches may add a meaningful bundle suffix, for example `feat/add-bulk-lot-editing-validation`; subjects use `feat(add-bulk-lot-editing): validate bulk edits`. Put additional BI references in the body when useful. All PRs delivering one change retain its canonical name.

The `planned-functionality` project-level skill maintains the index, allocates BI IDs from repository history and creates or reuses change scaffolds when capture is requested. A brief capture does not require completing all planning artifacts or authorize implementation. Several related index items may link to one cohesive change; unregistered work can state None with a reason.

## Schema workflow

The schema produces proposal, behavior specs, design assessment and detailed tasks. It includes source-grounded discovery, proposal-stage reuse/dependency research, testable scenarios, meaningful alternatives, task checklists and flexible task-level TDD. Proposals compare relevant packages/frameworks, existing-stack reuse and custom implementation using primary evidence and adoption trade-offs; design carries that assessment forward.

Design is an explicit assessment for every schema-driven change and can be brief when existing architecture suffices. Pure documentation, tooling or behavior-preserving refactors can declare `skip_specs: true` in change metadata; no behavioral requirements are invented. Existing changes retain their declared schema rather than being migrated by a new project default.

Planning-only requests stop with a reviewable plan. Existing plan-and-implement authorization can continue through apply without requesting the same permission again. Batch material unresolved questions and record routine assumptions. Follow the schema's [shared practices](../openspec/schemas/bench-intake/README.md#shared-working-practices), governing engineering instructions and existing project-level Git/PR skills.

## Tasks, commits and delivery

Nontrivial changes have multiple substantive tasks, each with outcome, scope, approach, prerequisites, acceptance references, verification and checkbox actions. Nested subtasks may express meaningful substeps. Behavioral tasks default to baseline, RED, GREEN and refactor/verification steps; justified alternatives retain appropriate checks for documentation and behavior-preserving work.

Before committing completed work, check off the corresponding completed actions in `tasks.md` and stage that update with the work. Keep unrelated or incomplete actions unchecked. Do not claim a review, published PR, passing CI or merge before the event actually occurs; record those events only after they are evidenced. Completion tracking and commit ordering do not relax verification or exact-head review requirements.

The task plan also supplies an explicit PR delivery map with scope, included tasks/checklist work, rationale, real dependencies, branch names and gates. Each top-level task belongs wholly to exactly one PR; never split its subtasks or checklist work across PRs. A PR may include one or several whole top-level tasks. If a task is too broad for a sensible PR, refine it into meaningful top-level tasks before assigning bundles. PR grouping is a reasoned delivery decision; do not infer a fixed one-task/one-PR mapping. Implementation completion, independent review, publication, merge, current item Done and archival remain separate facts. The index's Done status requires accepted and merged implementation, and its OpenSpec links are updated when an authorized archive moves the change.

## Agent and CLI entry points

Use project-level `openspec-explore`, `openspec-propose`, `openspec-apply-change`, `openspec-update-change`, `openspec-sync-specs` and `openspec-archive-change` skills. Codex uses skill invocation such as `$openspec-propose`; native Claude commands include `/opsx:propose`, `/opsx:apply` and `/opsx:archive`. The CLI is installed separately from the repository; the integration was qualified with OpenSpec 1.16.0.

```bash
openspec schema validate bench-intake --json
openspec new change change-name --description "Brief intent"
openspec status --change change-name --json
openspec instructions proposal --change change-name --json
```

Before syncing or archiving a change, run `pnpm openspec:overlap --change change-name`. It parses specs and deltas with the installed CLI's own parser (found from `openspec` on `PATH`, or `OPENSPEC_CLI_DIR`), mirrors the CLI's pre-validation (duplicate names, contradictory sections, unpaired renames), and simulates each delta in the CLI's apply order. Operations whose result is already in the main specs are reported as applied, comparing blocks exactly apart from line endings. It fails when an added requirement's name exists with different text, when a modified or renamed requirement is missing, when a rename's destination already exists, or when another active change has a pending operation on the same requirement. It warns when another active change has pending operations in the same capability, because the sync order then decides which change wins. Add `--new-capabilities-only` for a change that must not touch existing capabilities, such as `baseline-specs`.

Use the correct repository root and preserve CLI-resolved output paths and artifact scope. Structural validation does not establish artifact quality, approval, provider behavior or inventory-write authority.

## Maintenance and qualification

Custom instructions/templates live under `openspec/schemas/bench-intake/`; keep them separate from standard integration regeneration. After updating the CLI, inspect the output of `openspec update`, reapply the existing invocation/authorization adaptations to standard skills and native commands, and mirror skill copies exactly. The root generator target marker remains excluded from authored-resource comparisons; same-name files inside skills remain compared.

After changes, run applicable schema/instruction/progress checks in disposable projects, Markdown/link/reference checks and `pnpm workflow-sync` for skill edits. Record unexpected outcomes and limits in the change's `notes.md`, and routine verification in the PR description. Attach evidence to the PR, never to the change directory ([evidence goes on the PR](../CODE_GUIDELINES.md#evidence-goes-on-the-pr)). Follow independent exact-head review and selected CI before any authorized merge into `interactive-app`.
