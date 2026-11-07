# Implementation and delivery tasks

## Plan context

Link the proposal, design assessment, reuse/dependency recommendation and relevant specs or declared spec opt-out. Record the canonical short descriptive kebab-case change name and link applicable BI index entries. All delivering branches and commit/PR subjects include that exact name; the repository index owns current item metadata.

## Completion and commit ordering

Complete and verify a checkbox action, then mark it checked before committing its corresponding completed work. Stage the `tasks.md` update in the same commit as that work; do not defer it to a later bookkeeping commit. Keep incomplete actions and parents with unfinished required subtasks unchecked. Review, publication, CI and merge actions remain pending until the actual event occurs; record them only afterward, before committing their evidence updates.

## Task map and dependencies

Break the change into multiple coherent tasks with meaningful verifiable outcomes. List each task's type, actual prerequisites and acceptance references, and choose reviewable PR boundaries. Independent tasks need no artificial predecessor. A genuinely trivial change may explain why one implementation task is enough. Include necessary technical, investigation, migration, configuration, documentation or test-only work explicitly.

## PR delivery map

A change may deliver one or several PRs. Define the actual bundles and explain their boundaries; a PR can bundle multiple top-level tasks. Decide based on coherent outcomes, compatibility, dependencies, rollout/migration risk, verification and reviewer context rather than a fixed task count or line quota.

Each top-level task belongs wholly to exactly one PR; never split its subtasks or checklist work across PRs. A PR may include one or several whole top-level tasks. If a task is too broad for a sensible PR, refine it into meaningful top-level tasks before assigning bundles.

| Bundle | Outcome and included work                      | Task/checklist coverage                | Why this boundary is sensible          | Prerequisites and merge order      | Base, branch and subject                                | Verification and merge gates                |
| ------ | ---------------------------------------------- | -------------------------------------- | -------------------------------------- | ---------------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| PR-A   | Replace with a concrete reviewable deliverable | Identify the covered task IDs and work | Explain why this work belongs together | State actual prerequisites or None | Include the canonical change name in branch and subject | Define the required evidence and conditions |

Map all planned work without unexplained gaps or duplicate ownership. Update the map if discoveries change a boundary. Use stable bundle keys before PR numbers exist; add the actual GitHub reference when published. Do not invent multiple bundles merely to populate this table.

## 1. First scoped outcome

- PR delivery: Identify the delivery-map entry for this task.

- Outcome: Describe what this task delivers and why it is needed.

- Scope and approach: Identify affected areas/files, existing patterns and the relevant design or reuse decision. Explain the work without prescribing line-by-line code.

- Prerequisites: Name actual dependencies, None after assessment, or the specific unresolved blocker.

- Acceptance: Link observable outcomes or requirement scenarios, including relevant adverse cases.

- TDD approach: For behavioral work, define the baseline and regression expected to fail before implementation. For a justified alternative, state why and how verification establishes the contract.

- Verification: Give concrete owning commands, expected evidence and any manual/environment limitations.

- Risks and decisions: Identify relevant uncertainty or state None.

- [ ] 1.1 Confirm the current source/contracts, prerequisites and selected approach for this task.

- [ ] 1.2 RED: add/run the scoped failing regression and verify the intended failure, or record the task's justified alternative verification approach.
  - [ ] 1.2.1 Replace with a meaningful case or substep only when it benefits from separate tracking; remove illustrative subtasks that do not apply.

- [ ] 1.3 GREEN: implement the scoped outcome and run its checks; for documentation or test-only work, complete the corresponding deliverable without inventing production changes.

- [ ] 1.4 Refactor within scope where useful, preserve behavior, and verify the affected surrounding contracts.

- [ ] 1.5 Verify acceptance, relevant failure cases and required owning checks; record actual results and limitations before marking this task complete.

## 2. Next distinct outcome

- PR delivery: Identify the delivery-map entry for this task.

- Outcome: Describe a further meaningful deliverable rather than a duplicate of Task 1.

- Scope and approach: Identify affected areas/files and the applicable design/reuse decisions.

- Prerequisites: State actual dependencies, including what earlier work must provide.

- Acceptance: Link this task's distinct outcomes and relevant scenarios.

- TDD approach: State the behavioral regression and expected RED/GREEN evidence, or justify a different strategy for this work type.

- Verification: Give concrete checks and required evidence.

- Risks and decisions: State unresolved material issues or None.

- [ ] 2.1 Confirm prerequisites and establish the relevant baseline.

- [ ] 2.2 RED: write/run the meaningful failing regression, or perform the documented alternative strategy.

- [ ] 2.3 GREEN: deliver the scoped behavior or nonbehavioral result and verify it.

- [ ] 2.4 Refactor where useful and run affected contract/regression checks.

- [ ] 2.5 Record acceptance evidence, documentation effects and remaining limitations.

<!-- Replace all illustrative descriptions with this change's actual plan. Repeat, split or remove task sections according to real outcomes; do not manufacture a second implementation task for a trivial change. Every retained task has a substantive checkbox list and enough context to execute. Use nested checkbox numbers for meaningful substeps, not one checkbox per function or test. Documentation needs reference/consistency checks; refactors may use existing/characterization coverage. Test-first exceptions need a reason and equivalent verification, not another permission ceremony. -->

## Delivery evidence and lifecycle follow-up

For each PR bundle, record the actual reviewed commit, check results and published/merged state after they exist. These are delivery gates, not a substitute for the implementation tasks or permission to check future events early. Any corresponding evidence commit follows the same completion-before-commit rule and canonical change-name convention.

Before publication, update affected documentation and the change's `notes.md`, obtain independent read-only review of the exact candidate, fix/re-review findings until clear, and use the project's normal PR workflow. Merge only after the applicable authorization and selected green CI; preserve any hold. If follow-up repository work is needed after merge, describe its delivery boundary rather than silently writing to trunk.

Update linked BI entries to their actual current status as evidence changes. Done requires accepted and merged implementation; completed checkboxes alone are insufficient. If there are no indexed items, say so. Check direct OpenSpec links and current metadata whenever the index is updated.

After tracked work and the relevant delivery conditions are complete, synchronize/archive only when authorized. Update index links if artifact paths move. Archival is a lifecycle action, not a checkbox that must be completed before archival can start.
