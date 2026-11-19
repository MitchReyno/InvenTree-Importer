# Implementation notes

Implementation started with PR-A (debug mode and the Dev mode popover). PR-B to PR-E remain.

## Changes to the plan

- **2026-11-19T14:29+11:00, task 2 (PR-A):** `masthead-appearance-options` (#222) merged after this plan and added a shared device-preference helper (`frontend/src/theme/device-preference.ts`). Debug mode uses that helper instead of copying the theme controller. design.md's debug-mode decision is updated to match.
- **2026-11-19T14:29+11:00, specs (PR-A):** #222's change also modifies app-settings › "InvenTree and appearance sections" to add the Masthead choice. This change's MODIFIED block now includes that text and its three scenarios, so it is a superset and syncs correctly after `masthead-appearance-options` is archived. Until then `pnpm openspec:overlap` reports the shared requirement as an error; archive `masthead-appearance-options` first.

## Unexpected challenges

None yet.

## Decisions made during implementation

None yet.

## Open items

- The canvas's "Settings › Appearance" artboard predates the Masthead choice from #222 and doesn't show it.
