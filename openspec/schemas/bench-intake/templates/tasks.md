# Implementation and delivery tasks

## Plan context

Link the proposal, design assessment, reuse/dependency recommendation and relevant specs or declared spec opt-out. Link BI Notion tickets and available repository snapshots; Notion owns current ticket metadata.

## Task map and dependencies

Break the change into multiple coherent tasks with meaningful verifiable outcomes. List each task's type, actual prerequisites and acceptance references, and choose reviewable PR boundaries. Independent tasks need no artificial predecessor. A genuinely trivial change may explain why one implementation task is enough. Include necessary technical, investigation, migration, configuration, documentation or test-only work explicitly.

## 1. First scoped outcome

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

## 3. Independent review and publication

- Outcome: A reviewable, evidenced change published through the project's normal PR workflow.

- Prerequisites: Applicable implementation tasks and their checks are complete.

- Verification: Exact reviewed commit, actual check results and PR state; a held merge remains pending.

- [ ] 3.1 Update affected documentation and the maintained handover with decisions, validation, recovery guidance and limits.

- [ ] 3.2 Obtain independent read-only review of the exact candidate commit, address findings and repeat review until clear.

- [ ] 3.3 Publish or update the PR through the existing project workflow and verify selected CI at the reviewed head.

- [ ] 3.4 Resolve the merge decision within the user's authorization; leave this checkbox pending while merging is held.

## 4. Ticket status and spec reconciliation

- Outcome: Current Notion ticket state reflects actual delivery evidence, with affected repository snapshots refreshed.

- Prerequisites: Evidence for the specific status transition; Done additionally requires accepted and merged implementation.

- Verification: Read-back ticket state and consistent linked snapshots. If there are no linked tickets, remove this task with a reason.

- [ ] 4.1 Update linked BI Notion tickets to their actual current status; do not mark unmerged functionality Done.

- [ ] 4.2 Refresh affected Markdown snapshots from those tickets and check their references and current metadata.

After tracked delivery work is complete, synchronize/archive only when authorized and the relevant lifecycle conditions are met. Update Notion and snapshot links if artifact paths move. Archival is a lifecycle action, not a checkbox that must be completed before archival can start.
