# Implementation notes

PR-A (debug mode and the Dev mode popover) merged in #225, PR-B (the Settings structure) in #226 and PR-C (server storage, sealing, batch defaults and the connection check) in #227. PR-D (the Settings forms) is in progress; PR-E (Replace token) remains.

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

- **2026-11-19, task 9 (PR-D):** Providers and "Provider and model per step" are one form with one Save, but Sessions sits between them on the page. `ProvidersAndSteps` renders both subsections around the Sessions subsection it is given, and shows the same Save under the default provider and under the steps. The sessions stepper moved from the provider form to Sessions, with its own Save.
- **2026-11-19, task 9 (PR-D):** The provider On control, "Suggest tags for new batches" and the step choices are a checkbox and selects, not a `Switch`: the design system keeps `Switch` for settings that apply at once, and these wait for Save. A step's model is a text field with the provider's presets as suggestions, so a model outside them can be typed.

- **2026-11-19, task 11 (PR-E):** Connection status reports the token in use as `target.credential_source` and `target.credential_saved_at`, not a bare `saved_at`, so the name says what was saved. The commands answer with the same two fields.
- **2026-11-19, task 11 (PR-E):** The plan asked for request-log redaction. Fastify's request logging is off and no handler logs a body, so there is nothing to redact. The tests plant a token and check the command responses and errors, bootstrap, readiness, connection status and its check, a not-found response, the server's output after a restart (a Postgres process test) and a refused startup for it instead. Copy debug info is built only from data already in the browser, which never holds the token after a save.
- **2026-11-19, task 11 (PR-E):** Startup loads the saved token before the database and media setup, so a file other users can read stops the server with `secret_file_permissions` whether or not a database is configured.

## Unexpected challenges

- **2026-11-19, task 9 (PR-D):** React Hook Form 7.91's `reset()` drops its field refs, so an uncontrolled textarea kept showing the old text after Reload until it re-registered. `useSubsectionForm` sets each field after the reset.

- **2026-11-19T14:40+11:00, task 2:** pnpm refuses nested workspace scripts (`pnpm typecheck`) when `node_modules` is a symlink to the main checkout (`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`). The worktree uses its own `pnpm install --frozen-lockfile` instead; the lockfile is unchanged.

- **2026-11-19, task 11 (PR-E):** `inventoryTransport` deep-copies its profile with `structuredClone`, which can't copy a function, so the `CredentialHolder` can't sit in the profile. The transport takes an optional third argument that supplies the token per request.

## Decisions made during implementation

- **2026-11-19, task 9 (PR-D):** Every agent subsection's form goes through `useSubsectionForm`: it follows a newer load while untouched, keeps an edit through another subsection's save, and sends the loaded value for every field it doesn't own. An edit remembers the settings it started from, and a change to its own fields from elsewhere is a conflict found before sending, since the revision is shared across subsections. `useDirtyForms` holds the one navigation guard while any form is edited.

- **2026-11-19, task 6 (PR-C):** The model suggestion lists moved to contracts (`AGENT_MODEL_SUGGESTIONS`), because the server needs each provider's first suggestion for unsaved settings and the migration backfill.
- **2026-11-19, task 6 (PR-C):** An over-long description style or instruction text is refused by the contract (400) before the settings checks run. `invalid_agent_settings` (422) covers the provider and step rules, any model over 128 characters, and text PostgreSQL can't store unchanged (NUL or an unpaired surrogate).
- **2026-11-19, task 6 (PR-C):** The style is sealed as an optional `part_description_style` on the session input, so inputs sealed before it still decode; it is left out when no style is saved.
- **2026-11-19, task 8 (PR-C):** The connection reader stays callable and gains `check()`, so existing reads and tests are unchanged. The check mutation lives in the shared header observations, so the server menu and Settings share one pending state.

- **2026-11-19, task 11 (PR-E):** `saved_at` is the saved file's modification time, which the rename keeps. The file holds the token as JSON with the InvenTree origin and target context it was checked against, and a load for another origin or context ignores it, so a token is never sent to a different InvenTree. The secrets directory must be a real, owner-only directory owned by the server's user, and must not overlap the served `frontend/dist`.
- **2026-11-19, review round 2 (PR-E):** The static-file handler checks each request's real path against the secrets directory, and the Vite dev server denies the token file names, since an `INTAKE_SECRETS_DIR` inside the workspace could otherwise be served through `/@fs`. A confirmed command shows its token source at once, before the next read arrives. A status request retries once after a reset and then answers unobserved.
- **2026-11-19, review round 1 (PR-E):** A rename or unlink is the commit point, and the directory flush after it is best effort, so the file and the holder can't disagree after a late failure. A second command while one runs is refused with `credential_change_in_progress` rather than queued past its caller's deadline. Both commands check the current target context. The browser sends token commands as plain calls instead of TanStack mutations, which would keep the token as mutation variables in the shared cache.
- **2026-11-19, task 11 (PR-E):** Replacing the token needs a configured read target. Without `INTAKE_DEV_API_KEY` the app is in setup mode, bootstrap keeps depending only on that key, and the commands answer `setup_required`.
- **2026-11-19, task 11 (PR-E):** A reset of the connection reader counts generations, so a probe still running with the old token can't become the observation after a replace or revert; a read or check waiting on it probes again.

## Open items

- Successors a stable identity couldn't queue while no provider was on stay unqueued after a provider is turned on, until the lot's identity is published again or the operator starts the stages.

- `simplify-vm-agent-web-and-setup` (BI-017, #223) modifies app-settings › "Agent settings section" and "Deferred settings are disabled and explained", written against this change's versions. Sync this change first; that change rebases onto it, so `pnpm openspec:overlap` reports those requirements until then.

- The import reference is sent as the stock item's `barcode`, which `intake-server/src/execution/ARCHITECTURE.md` says InvenTree 1.5.0 doesn't store. The Settings row describes the reference as the server sets it, not whether a given InvenTree keeps it.

- The canvas's "Settings › Appearance" artboard predates the Masthead choice from #222 and doesn't show it.
