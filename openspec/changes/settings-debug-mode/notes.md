# Implementation notes

PR-A (debug mode and the Dev mode popover) merged in #225. PR-B (the Settings structure) is in progress; PR-C to PR-E remain.

## Changes to the plan

- **2026-11-19T14:29+11:00, task 2 (PR-A):** `masthead-appearance-options` (#222) merged after this plan and added a shared device-preference helper (`frontend/src/theme/device-preference.ts`). Debug mode uses that helper instead of copying the theme controller. design.md's debug-mode decision is updated to match.
- **2026-11-19T14:29+11:00, specs (PR-A):** #222's change also modifies app-settings › "InvenTree and appearance sections" to add the Masthead choice. This change's MODIFIED block now includes that text and its three scenarios, so it is a superset and syncs correctly after `masthead-appearance-options` is archived. Until then `pnpm openspec:overlap` reports the shared requirement as an error; archive `masthead-appearance-options` first.
- **2026-11-19T14:48+11:00, task 3 (PR-A):** The plan put a Debug panel in each screen, built from that screen's own `useQuery` results. One page-level panel in `App`, listing the reads mounted on the current screen through a query-cache subscription, covers every screen without threading rows through each one, and still starts no request. design.md is updated.

- **2026-11-19T15:59+11:00, task 5 (PR-B):** The sessions-at-once stepper stays inside the current `AgentSettingsForm`, under Providers, because it shares that form's one Save with provider, sign-in and model. Sessions holds Pause all for now; the stepper moves to Sessions when task 9 rebuilds the forms in PR-D.

## Unexpected challenges

- **2026-11-19T14:40+11:00, task 2:** pnpm refuses nested workspace scripts (`pnpm typecheck`) when `node_modules` is a symlink to the main checkout (`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`). The worktree uses its own `pnpm install --frozen-lockfile` instead; the lockfile is unchanged.

## Decisions made during implementation

None yet.

## Open items

- `simplify-vm-agent-web-and-setup` (BI-017, #223) modifies app-settings › "Agent settings section" and "Deferred settings are disabled and explained", written against this change's versions. Sync this change first; that change rebases onto it, so `pnpm openspec:overlap` reports those requirements until then.

- The canvas's "Settings › Appearance" artboard predates the Masthead choice from #222 and doesn't show it.
