# Implementation notes

Splits the `pnpm dev` profile variables into independent switches. Delivered in one PR against `interactive-app`; in progress.

## Changes to the plan

None.

## Unexpected challenges

None yet.

## Decisions made during implementation

- **2026-11-12T13:05+11:00, planning:** A switch for the research stub (`restricted-research-stub/1`) was dropped from the agreed switch set. Only a test fixture runs that profile and the dev processing worker is fixed to `synthetic-research/2`, so it would need a new development worker; `pnpm dev` could not run it before this change either.

## Open items

- `restricted-research-stub/1` remains unavailable in `pnpm dev`.
- Writes to a local or external InvenTree remain unsupported; `INTAKE_INVENTREE_READ_ONLY=false` refuses them.
