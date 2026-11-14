# Implementation notes

All three tasks were delivered in one PR, PR-A ([#69](https://github.com/MitchReyno/InvenTree-Importer/pull/69)), on `docs/portable-pr-planning`. The PR changed planning instructions only: no application code, dependencies or external resources. The change was archived on 2026-11-07.

## Changes to the plan

- **Task 2 (PR-A):** the PR delivery-map rule was tightened after the first draft. Each top-level task, with all of its checklist work, belongs to exactly one PR, and a PR may bundle several whole tasks. A task too broad for one PR is refined into further top-level tasks before bundling.
- **Task 1 (PR-A):** retiring the external ticket-service integration also meant removing its links and identifiers from tracked historical records. They were sanitised in place without rewriting Git history.

## Unexpected challenges

None.

## Decisions made during implementation

- **Task 1 (PR-A):** BI item IDs stay in the index, separate from the canonical change name. The change name is the stable key for directories, branches and commit/PR subjects.
- **Task 3 (PR-A):** completed checkboxes are staged with the work they describe. Review, publication and merge items stay unchecked until those events happen, rather than being checked early to satisfy the commit rule.

## Open items

None.
