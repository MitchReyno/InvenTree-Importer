# Implementation notes

PR-A (debug mode and the Dev mode popover) merged in #225 and PR-B (the Settings structure) in #226. PR-C (server storage, sealing, batch defaults and the connection check) is in progress; PR-D and PR-E remain.

## Changes to the plan

- **2026-11-19T14:29+11:00, task 2 (PR-A):** `masthead-appearance-options` (#222) merged after this plan and added a shared device-preference helper (`frontend/src/theme/device-preference.ts`). Debug mode uses that helper instead of copying the theme controller. design.md's debug-mode decision is updated to match.
- **2026-11-19T14:29+11:00, specs (PR-A):** #222's change also modifies app-settings › "InvenTree and appearance sections" to add the Masthead choice. This change's MODIFIED block now includes that text and its three scenarios, so it is a superset and syncs correctly after `masthead-appearance-options` is archived. Until then `pnpm openspec:overlap` reports the shared requirement as an error; archive `masthead-appearance-options` first.
- **2026-11-19T14:48+11:00, task 3 (PR-A):** The plan put a Debug panel in each screen, built from that screen's own `useQuery` results. One page-level panel in `App`, listing the reads mounted on the current screen through a query-cache subscription, covers every screen without threading rows through each one, and still starts no request. design.md is updated.

- **2026-11-19T15:59+11:00, task 5 (PR-B):** The sessions-at-once stepper stays inside the current `AgentSettingsForm`, under Providers, because it shares that form's one Save with provider, sign-in and model. Sessions holds Pause all for now; the stepper moves to Sessions when task 9 rebuilds the forms in PR-D.

- **2026-11-19, task 6 (PR-C):** Until task 9 adds the provider cards, the current form still edits one provider. Saving it turns the chosen provider on as the default and keeps the other provider's saved values, so switching from Claude to Codex leaves Claude on.
- **2026-11-19, task 7 (PR-C):** design.md listed an `UPDATE` grant on `capture_batch.creation_notices`; it isn't needed, and design.md is updated: the notices are known before the creation transaction and written with the batch row, which the batch identity trigger then keeps unchanged. Dismissing Capture's banner is held in the Capture tab, so it shows again when Capture is opened again.
- **2026-11-19, task 8 (PR-C):** The import reference shown read-only in Settings › InvenTree is `bi1:‹batch source›:‹lot›`, built by `contributionBarcode()` in `intake-server/src/execution/plan.ts`. It isn't configurable, so the row is text, not a field.

- **2026-11-19, review round 1 (PR-C):** design.md said rolling back the code was enough. Startup requires the exact migration list, so older code refuses a database with `0032`; rollback is restoring the pre-upgrade archive, and design.md now says so.
- **2026-11-19, review round 1 (PR-C):** Settings › Batch defaults refuses a newly chosen record that InvenTree doesn't have (`batch_default_not_found`, 422) or that can't be checked (`catalogue_unavailable`, 503). A saved record deleted later can still be kept or cleared.

- **2026-11-19, review round 2 (PR-C):** Batch defaults and batch creation check the current target context before and after their catalogue lookups and again inside the write transaction, like the existing Capture catalogue routes. They don't lock `target`: a rotation committing between that last check and the write's commit can still land the write in the retired context. Closing that window would need the Capture role to hold `UPDATE` on `target` (as the executor does for its `FOR UPDATE`), which widens its authority, so it is accepted as for every other Capture write.

- **2026-11-19, review round 3 (PR-C):** Turning both providers off is now a valid save, so a stable identity published by a running Examine lead could no longer queue its Research and Images successors. Queuing them threw and rolled back the proposal with it. `onLeadIdentity` now keeps the proposal and queues only the stages a provider resolves for (`waiting` when none). Successors left unqueued that way aren't queued automatically once a provider is turned back on.

## Unexpected challenges

- **2026-11-19T14:40+11:00, task 2:** pnpm refuses nested workspace scripts (`pnpm typecheck`) when `node_modules` is a symlink to the main checkout (`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`). The worktree uses its own `pnpm install --frozen-lockfile` instead; the lockfile is unchanged.

## Decisions made during implementation

- **2026-11-19, task 6 (PR-C):** The model suggestion lists moved to contracts (`AGENT_MODEL_SUGGESTIONS`), because the server needs each provider's first suggestion for unsaved settings and the migration backfill.
- **2026-11-19, task 6 (PR-C):** An over-long description style or instruction text is refused by the contract (400) before the settings checks run; `invalid_agent_settings` (422) covers the provider and step rules only.
- **2026-11-19, task 6 (PR-C):** The style is sealed as an optional `part_description_style` on the session input, so inputs sealed before it still decode; it is left out when no style is saved.
- **2026-11-19, task 8 (PR-C):** The connection reader stays callable and gains `check()`, so existing reads and tests are unchanged. The check mutation lives in the shared header observations, so the server menu and Settings share one pending state.

## Open items

- Successors a stable identity couldn't queue while no provider was on stay unqueued after a provider is turned on, until the lot's identity is published again or the operator starts the stages.

- `simplify-vm-agent-web-and-setup` (BI-017, #223) modifies app-settings › "Agent settings section" and "Deferred settings are disabled and explained", written against this change's versions. Sync this change first; that change rebases onto it, so `pnpm openspec:overlap` reports those requirements until then.

- The import reference is sent as the stock item's `barcode`, which `intake-server/src/execution/ARCHITECTURE.md` says InvenTree 1.5.0 doesn't store. The Settings row describes the reference as the server sets it, not whether a given InvenTree keeps it.

- The canvas's "Settings › Appearance" artboard predates the Masthead choice from #222 and doesn't show it.
