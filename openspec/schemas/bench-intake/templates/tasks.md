# Implementation and delivery tasks

## Plan context

Link the proposal, design assessment and relevant specs or the declared spec opt-out. Link BI detail files when applicable; do not duplicate register status, priority or size.

## Slice map

List each slice's verifiable outcome, task type, real prerequisites and acceptance references. Prefer vertical behavior slices; identify justified technical, investigation, migration, configuration, documentation or test-only slices explicitly. Independent slices need no artificial predecessor. Choose reviewable PR boundaries without forcing one PR per checkbox.

## 1. First verifiable outcome

- Type: Choose the applicable work type.

- Prerequisites: Name actual dependencies, None after assessment, or an explicit unresolved blocker.

- Acceptance: Link the relevant outcomes or requirement scenarios.

- Verification: State concrete owning checks and any manual evidence or environment limitations.

- [ ] 1.1 Deliver the scoped outcome, including the regression or characterization coverage appropriate to this task type.

- [ ] 1.2 Verify the acceptance criteria and affected boundaries with the declared checks; record actual results and limitations.

<!-- Replace illustrative tasks with this change's real slices. Repeat numbered sections as needed. Do not retain a test task that merely asserts prose, or require tests for documentation-only edits. -->

## 2. Review and publication

- [ ] 2.1 Update affected documentation and the maintained handover with decisions, validation, recovery guidance and limits.
- [ ] 2.2 Obtain independent read-only review of the exact candidate commit, address findings and repeat review until clear.
- [ ] 2.3 Publish or update the PR through the existing project workflow and verify selected CI at the reviewed head.
- [ ] 2.4 Resolve the merge decision within the user's authorization; leave this task pending while merging is held.

## 3. Product status and spec reconciliation

- [ ] 3.1 Once acceptance and merged implementation are evidenced, update linked BI items to their actual current status; do not mark unmerged functionality Done.
  After the tracked delivery tasks are complete, synchronize/archive only when authorized and the relevant lifecycle conditions are met. Update item links if artifact paths move. Archival is a lifecycle action, not a checkbox that must be completed before archival can start.

<!-- Remove genuinely inapplicable delivery tasks with a reason. Keep implementation, publication, merged product status and archival distinct. A held merge or archive must not be checked off as complete. -->
