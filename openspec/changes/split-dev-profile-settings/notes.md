# Implementation notes

Splits the `pnpm dev` profile variables into independent switches. Delivered in one PR against `interactive-app`; in progress.

## Changes to the plan

None.

## Unexpected challenges

- **2026-11-12T13:12+11:00, task 2:** A full local-InvenTree start could not be run from this worktree, because the InvenTree containers belong to the main checkout and the stack refuses a second checkout. The local switch was checked by resolving the app state root, which matched the existing `local-inventree-…` namespace, plus the unit tests.

## Decisions made during implementation

- **2026-11-12T13:12+11:00, task 2:** Scripted agents receive no provider keys or executable overrides; previously no worker ran for the mock profile, so nothing was forwarded. The resolver returns a `mockAgents` flag for this.

- **2026-11-12T13:05+11:00, planning:** A switch for the research stub (`restricted-research-stub/1`) was dropped from the agreed switch set. Only a test fixture runs that profile and the dev processing worker is fixed to `synthetic-research/2`, so it would need a new development worker; `pnpm dev` could not run it before this change either.

## Open items

- `restricted-research-stub/1` remains unavailable in `pnpm dev`.
- Writes to a local or external InvenTree remain unsupported; `INTAKE_INVENTREE_READ_ONLY=false` refuses them.
