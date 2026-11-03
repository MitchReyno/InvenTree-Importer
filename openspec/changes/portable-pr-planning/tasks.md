# Implementation and delivery tasks

## Plan context

Canonical change: `portable-pr-planning`. This workflow maintenance has no BI index item. Scope and reuse rationale are in the proposal; design records repository-only boundaries and the pending PR-policy clarification. This change declares native spec skipping because application behavior is unchanged.

## PR delivery plan

Provisional single coherent documentation PR on `docs/portable-pr-planning`, titled `docs(portable-pr-planning): define portable PR delivery planning`. It delivers the repository planning ownership, identity, completion ordering and clarified PR policy together so active instructions do not contradict one another. It has no code/runtime deployment dependency. Final task coverage and the task-splitting constraint remain pending clarification; do not publish an incomplete policy as final.

## 1. Retire duplicate and external planning records

- Outcome: Planning records live in the repository with direct OpenSpec detail links and no retired service/resource references.

- Scope: Index, planning skill, active schema/docs, removed per-item directory and retired guide, sanitized historical records.

- Prerequisites: Existing tracked files and the user's explicit repository-only cleanup request.

- Acceptance: No retired product/resource references or identifying links in tracked content/filenames; no per-item detail directory; no external access or changes.

- Verification strategy: Documentation/reference checks instead of RED/GREEN application tests; no executable behavior changes.

- [x] 1.1 Remove the requested per-item directory and guide; preserve meaningful historical facts without retired identifiers.

- [x] 1.2 Make the repository index own current metadata and link directly to OpenSpec changes.

- [x] 1.3 Mirror the planning skill and audit all tracked content/filenames and active links.

## 2. Define stable change identity and commit bookkeeping

- Outcome: Branches and subjects carry the canonical slug, and completed actions are checked before their work is committed.

- Scope: Schema, templates, shared practices, active guide and this change's own branch/plan.

- Prerequisites: Repository planning ownership from Task 1.

- Acceptance: Exact change name in active path/branches/subjects; completed-item task updates staged with corresponding work, without pre-checking future events.

- Verification strategy: CLI/schema/instruction checks, nested-progress fixture and staged-diff inspection; no new runtime tests for prose.

- [x] 2.1 Use `portable-pr-planning` for this change and `docs/portable-pr-planning` for its branch; require the convention for future changes.

- [x] 2.2 Specify completion-before-commit ordering and preserve honest pending review/publication/merge state.

- [x] 2.3 Validate schema, native progress, Markdown, links, mirrored skill copies and workflow synchronization.

## 3. Finalize reasoned PR bundles

- Outcome: Every task plan defines concrete PR scopes and boundaries without an arbitrary one-to-one mapping.

- Scope: Task schema/template and shared delivery guidance.

- Prerequisites: Clarification of the top-level-task splitting constraint.

- Acceptance: Explicit scope/coverage, rationale, dependencies/order, branch names and gates; the task-splitting rule matches the user's actual instruction.

- Verification strategy: Review realistic small, multi-task and multi-PR examples against the clarified rule.

- [ ] 3.1 Resolve the ambiguous task-splitting statement with the user.

- [ ] 3.2 Finalize the task template's PR delivery map with the clarified rule.
  - [x] 3.2.1 Add the generic bundle scope, coverage, rationale, dependencies, names and gates.
  - [ ] 3.2.2 Apply the confirmed top-level-task split constraint.

- [ ] 3.3 Independently review the exact candidate, fix/re-review findings, publish the PR, and verify selected CI before an authorized merge.

## Delivery gates

Completed implementation checkboxes must be checked before their corresponding work is committed, with this file staged in that commit. Do not mark the remaining clarification or publication checks early. Merge and archive are separate lifecycle decisions governed by actual evidence and applicable user authorization.
