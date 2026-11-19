# Implementation and delivery tasks

## Plan context

- **Change:** `settings-debug-mode`. Every branch and subject uses it: `type(settings-debug-mode): …`.
- **Plan documents:** [proposal](proposal.md) and [design assessment](design.md).
- **Delta specs:**
  - `specs/debug-mode` (new);
  - `specs/app-settings`;
  - `specs/provider-runtime`;
  - `specs/capture-batch-settings`;
  - `specs/header-connection-status`;
  - `specs/processing-agent-sessions`;
  - `specs/ui-design-system`;
  - `specs/access-identity`.
- **Reuse:** extend existing storage, delivery and preference patterns, with no new dependency (proposal, "Reuse and dependency assessment").
- **Linked items:** BI-015 (Settings part, narrowed in task 1). A new BI item for debug mode and the Dev mode popover is allocated in task 1.
- **Design:** canvas v67, D32 to D35.

## Completion and commit ordering

- Complete and verify a checkbox action, then check it.
- Commit the `tasks.md` update in the same commit as that work.
- Review, publication, CI and merge actions stay unchecked until they actually happen.
- Read the shared and owning code guidelines (`CODE_GUIDELINES.md`, `frontend/CODE_GUIDELINES.md` and `intake-server/CODE_GUIDELINES.md`) in the session before the first edit of each PR, and name them in any delegated brief.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Planning and index | Docs | None | Proposal, BI index |
| 2. Debug mode foundation and Settings › Developer | Frontend behaviour | None | debug-mode: Device-local debug preference, Settings › Developer |
| 3. Gate developer details and add Debug panels | Frontend behaviour | 2 | debug-mode: Developer details hidden, Debug panel per screen; processing-agent-sessions; ui-design-system; header-connection-status: diagnostics only in debug mode |
| 4. Dev mode popover | Frontend behaviour | 2 | debug-mode: Dev mode popover; access-identity: Masthead mode badge |
| 5. Settings structure and Agents subsections | Frontend behaviour | None | app-settings: Settings page and navigation; Deferred settings |
| 6. Independent providers, agent settings storage, per-step sealing and style delivery | Backend and contracts | None | app-settings: Agent settings section (server side); provider-runtime; processing-agent-sessions: Part description style |
| 7. Batch defaults storage and new-batch snapshot | Backend and contracts | 6 (shared migration) | capture-batch-settings; app-settings: InvenTree and appearance sections (batch defaults) |
| 8. Forced connection check | Backend, contracts and frontend | None | header-connection-status: Connection check on demand; app-settings: Check now scenarios |
| 9. Settings forms for the new rows | Frontend behaviour | 5, 6, 7 | app-settings: Agent settings section, InvenTree and appearance sections |
| 10. Documentation and notes | Docs | Each PR's own tasks | Architecture and README accuracy |
| 11. Replace the read token | Backend, contracts and frontend | 8 | access-identity: Access server-only credentials; app-settings: Replace token scenarios |

## PR delivery map

All PRs target `interactive-app`.

| Bundle | Outcome | Tasks | Why together | Prerequisites and order | Branch and subject | Gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-P | Reviewed plan, design canvas references, BI index | 1 | Planning only | None; first | `docs/settings-debug-mode` · `docs(settings-debug-mode): plan settings, debug mode and dev tools` | `openspec validate --strict`, `pnpm openspec:overlap --change settings-debug-mode`, independent review |
| PR-A | Debug mode, its gating, Debug panels and the Dev mode popover | 2, 3, 4 | One frontend capability with one preference; no server change | After PR-P | `feat/settings-debug-mode-debug` · `feat(settings-debug-mode): add debug mode and dev tools popover` | Frontend checks, demo recording, independent review, green CI |
| PR-B | Settings nav with Agents subsections and Descriptions moved | 5 | Pure frontend restructure, separately reviewable; rows stay deferred | After PR-P; independent of PR-A | `feat/settings-debug-mode-structure` · `feat(settings-debug-mode): group agent settings under Agents` | Frontend checks, demo recording, review, CI |
| PR-C | Server and contracts for new settings, per-step sealing, style delivery, batch defaults, creation snapshot and the forced check | 6, 7, 8 | One migration and one contract regeneration; server tests cover them together | After PR-P | `feat/settings-debug-mode-server` · `feat(settings-debug-mode): store app settings and check the connection on demand` | intake-server suites, contracts generation check, review, CI |
| PR-D | Working Settings rows, including the provider cards and per-step providers, and docs | 9, 10 | Needs PR-B's structure and PR-C's contracts | After PR-B and PR-C | `feat/settings-debug-mode-forms` · `feat(settings-debug-mode): make the deferred settings work` | Full frontend checks, demo recording, review, CI |
| PR-E | Replace the InvenTree read token | 11 | Its own security boundary (secret storage, a credential swap, redaction) deserves a focused review | After PR-C; independent of PR-D | `feat/settings-debug-mode-token` · `feat(settings-debug-mode): replace the InvenTree read token from Settings` | Server and frontend checks, planted-secret test, manual token swap, independent review, CI |

Task 8's frontend part, the Check now and Check connection now buttons, ships in PR-C. It is small and keeps the whole task in one PR. The Settings › InvenTree row's surrounding layout is already in place.

## 1. Planning and index

- PR delivery: PR-P.
- Outcome: The plan is reviewable, and the BI index and BI-015 agree with it.
- Scope:
  - this change's artifacts;
  - `docs/PLANNED_FUNCTIONALITY.md`: a new BI item, and BI-015 narrowed;
  - `openspec/changes/complete-design-refresh-backend/README.md` narrowed.
- Prerequisites: None.
- Acceptance: The proposal's linked items and scope.
- TDD approach: Docs only. Verify with structural validation and an overlap check.
- Verification: `openspec validate settings-debug-mode --strict`, `pnpm openspec:overlap --change settings-debug-mode`, link check.
- Risks: Overlap with BI-015 wording.

- [ ] 1.1 Allocate a BI item for debug mode and the Dev mode popover with the `planned-functionality` skill, linking this change.
- [ ] 1.2 Narrow BI-015 and the `complete-design-refresh-backend` README to the rows this change leaves deferred.
- [ ] 1.3 Resolve the remaining "requirement text very long" validation warnings by moving lists into scenarios where that reads better.
- [ ] 1.4 Run validation and the overlap check, and fix the findings.
- [ ] 1.5 Independent read-only review of the plan, fixing findings until a round finds nothing new.
- [ ] 1.6 Open PR-P with no reviewers and merge once review is clean and CI is green.

## 2. Debug mode foundation and Settings › Developer

- PR delivery: PR-A.
- Outcome:
  - A device-local debug preference with `useDebugMode()`.
  - `DebugDetails` and `DebugPanel` components.
  - Settings › Developer holding the switch, the local setup check (moved out of the page footer), Reload app data and Copy debug info.
- Scope:
  - new `frontend/src/debug/debug-mode.ts`, modelled on `theme/theme.ts`;
  - `components/ui/DebugDetails.tsx` and `DebugPanel.tsx`, exported from the barrel;
  - `components/settings/DeveloperSection.tsx`;
  - `navigation/app-route.ts` gains `developer`;
  - `App.tsx` drops the footer `<Diagnostics/>`;
  - `operations/Diagnostics.tsx` becomes the Developer section's local setup card;
  - a pure `debugInfoText()` builder.
- Prerequisites: None.
- Acceptance: debug-mode › "Device-local debug preference" (all scenarios) and "Settings › Developer" (Reload keeps drafts, Copy without secrets, Clipboard refused); "Footer diagnostics".
- TDD approach:
  - Baseline: the footer disclosure renders today.
  - RED: tests for default off, persistence, throwing storage, footer absent, `#settings/developer` rendering the switch, Copy text excluding a planted token, and clipboard refusal. They fail because none of these exist yet.
- Verification: `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend`, `pnpm build`.
- Risks: Tests asserting the footer `Diagnostics` (`src/Diagnostics.test.tsx`) move to the Developer section.

- [ ] 2.1 Confirm the theme controller pattern and the existing Diagnostics tests as the baseline.
- [ ] 2.2 RED: write the preference, Developer section, footer and Copy debug info tests and see them fail.
- [ ] 2.3 GREEN: build the preference controller, the two components, the Developer section and route, and Reload and Copy.
  - [ ] 2.3.1 Reload app data invalidates queries without touching form drafts or the navigation guard.
  - [ ] 2.3.2 `debugInfoText()` is pure and lists only build, route, readiness and transport fields.
- [ ] 2.4 Refactor, then run the full frontend checks.
- [ ] 2.5 Verify acceptance, including keyboard use of the switch in both themes.

## 3. Gate developer details and add Debug panels

- PR delivery: PR-A.
- Outcome: With debug mode off, every developer detail listed in the proposal is gone. With it on, each shows as a `DebugDetails` block, and each main screen has a `DebugPanel`.
- Scope:
  - `agents/SessionFailureDetails.tsx` (Show details only in debug mode; category, summary and recovery always);
  - `processing/QuestionAnswer.tsx`, `ProcessingSources.tsx` and `ExamineView.tsx`;
  - `capture/EvidencePanel.tsx`, `HumanNote.tsx` and `CaptureContextSummary.tsx`;
  - `media/MediaNoteSummary.tsx` and `operator/InstructionForm.tsx`;
  - `batches/Batch.tsx` (revision JSON);
  - `changes/ReadyToAdd.tsx`, `RoundOutcome.tsx`, `PartAttachments.tsx` and `AttachmentOutcome.tsx`;
  - `masthead/ConnectionDetails.tsx` (the Details disclosure);
  - Debug panels on Batches, the batch tabs, Agents and Settings, built from data already held (route, IDs, revisions, `LiveUpdatesContext`, `getQueryState`).
- Prerequisites: Task 2.
- Acceptance:
  - debug-mode › "Developer details hidden when debug mode is off" and "Debug panel per screen";
  - processing-agent-sessions › "Failed session with debug mode off";
  - ui-design-system › "Provenance on demand";
  - header-connection-status › "Connection diagnostics only in debug mode".
- TDD approach:
  - RED: parameterized tests render each call site off and on and assert the technical text is absent and then present. Also, the Debug panel with a failed read shows "failed" and starts no request.
  - Existing tests that expect these details always visible are updated to turn debug mode on, with a note in the PR.
- Verification: The full frontend checks, and a browser pass on one screen per tab in both modes.
- Risks:
  - A detail some test or flow relies on, such as the approval binding text, could be hidden. Review each one for operator need.
  - InvenTree record numbers stay visible.

- [ ] 3.1 Inventory the call sites against the proposal list, and confirm nothing new was added since planning.
- [ ] 3.2 RED: parameterized off and on tests for the call sites, and Debug panel tests.
- [ ] 3.3 GREEN: wrap each call site in `DebugDetails`, removing its bespoke disclosure.
- [ ] 3.4 GREEN: add `DebugPanel` to Batches, Capture, Processing, Review, Changes, Agents and Settings.
- [ ] 3.5 Refactor shared row-building into a small hook per screen family if it repeats, then run the frontend checks.
- [ ] 3.6 Verify in the browser at desktop and 390px widths in both themes, attaching screenshots to the PR.

## 4. Dev mode popover

- PR delivery: PR-A.
- Outcome: The Dev mode pill opens a dialog popover with the debug switch, readiness summary, tools and Developer link.
- Scope:
  - `masthead/DevBadge.tsx` becomes `DevModeButton.tsx`, used in `Masthead.tsx`;
  - the `ConnectionDetails.tsx` pill stays static;
  - the popover content uses `Popover` with role `dialog` and the readiness query, enabled only while open.
- Prerequisites: Task 2.
- Acceptance: debug-mode › "Dev mode popover" (keyboard; readiness unavailable); access-identity › "Masthead mode badge".
- TDD approach: RED tests for opening by Enter, `aria-expanded`, switching debug mode, Escape returning focus, no readiness request until opened, readiness failure, and phone-width shortened label.
- Verification: The frontend checks, plus a browser check at 360px.
- Risks: The masthead's decorative layer clipping the popover, which `Popover` already portals around.

- [ ] 4.1 Confirm the `Popover` API and the masthead tests as the baseline.
- [ ] 4.2 RED: write the popover tests.
- [ ] 4.3 GREEN: build `DevModeButton` and its content.
- [ ] 4.4 Refactor, then run the frontend checks and the 360px browser check.
- [ ] 4.5 Record a demo with `demo-record` covering the popover, the debug switch and one screen off and on, and attach it to PR-A.

## 5. Settings structure and Agents subsections

- PR delivery: PR-B.
- Outcome:
  - The Settings nav lists Agents (with sub-nav), InvenTree, Batch defaults, Appearance and Developer.
  - Settings › Agents is one page with six subsections.
  - Descriptions and naming and "Suggest tags automatically" have moved in.
  - `#settings/descriptions` redirects.
  - Deferred rows keep their `DisabledFeature` explanations.
- Scope:
  - `navigation/app-route.ts` (`AGENT_SUBSECTIONS`, subsection parsing, redirect);
  - `components/ui/SettingsNav.tsx` (nested links, `aria-current="location"`);
  - `components/settings/Settings.tsx`;
  - split `AgentsSection` into `components/settings/agents/*` subsection components;
  - move `DescriptionsSection` in;
  - remove the tag switch from `BatchDefaultsSection`;
  - a route-keyed scroll-and-focus Effect.
- Prerequisites: None. If PR-A merged first, the Developer section already exists; otherwise this PR adds only its nav entry when present.
- Acceptance: app-settings › "Settings page and navigation" (all scenarios) and "Deferred settings are disabled and explained".
- TDD approach: RED tests for the sub-nav links and routes, the redirect, focus on the subsection heading, the current marking, and the moved rows rendered in Agents and absent elsewhere.
- Verification: The frontend checks, a browser check of scroll and focus, and a demo recording.
- Risks: The scroll Effect running twice under StrictMode, which must be idempotent.

- [ ] 5.1 Confirm the routes and `SettingsNav` tests as the baseline.
- [ ] 5.2 RED: write the navigation, redirect and moved-row tests.
- [ ] 5.3 GREEN: build routes, nested nav, the subsection split and the moves.
- [ ] 5.4 Refactor, then run the frontend checks.
- [ ] 5.5 Record a demo of the sub-nav and attach it to PR-B.

## 6. Independent providers, agent settings storage, per-step sealing and style delivery

- PR delivery: PR-C.
- Outcome:
  - Claude and Codex are stored separately, each with on or off, a sign-in method and a default model, plus a default provider.
  - Each step stores a provider and model, or Default.
  - New fields: `new_batch_instructions`, `part_description_style` and `auto_tags_default`, all under one revision.
  - Attempts seal the resolved provider, sign-in method and model.
  - Sessions receive the description style as guidance.
  - Existing settings migrate to their one provider.
- Scope:
  - migration `0032_settings_debug_mode.sql`:
    - `agent_provider_settings` filled from existing rows;
    - the new `agent_settings` columns, keeping the old selection columns for rollback;
    - `batch_defaults` for task 7;
    - grants in `processing/grants.ts`;
  - `agents/schema.ts` and `agents/settings.ts`, which keep writing the default provider's values into the old columns;
  - `contracts/src/agents.ts` (replace `selection`) and the generated client;
  - every server and frontend reader of `selection`, including the Agents page summary;
  - a pure `resolveSelection(settings, stage)` used by `processing/session-attempts.ts`;
  - validation that returns `invalid_agent_settings`;
  - the instruction delivery path for the style (`agents/instructions.ts` or the session runner's first message), sealed by settings revision.
- Prerequisites: None.
- Acceptance: provider-runtime (all scenarios, including "Steps on different providers" and "Existing settings carried over"); processing-agent-sessions › "Part description style delivered to sessions"; the app-settings server-side scenarios (stale revision; description style too long, enforced server-side at 500; no provider on).
- TDD approach:
  - RED tests:
    - `resolveSelection` unit cases: the step's choice, Default, a step on a provider that is off, the default provider off;
    - Postgres-tier tests: round-trip and conflict, each `invalid_agent_settings` case, the migration of a single-selection row, a Research attempt sealed on Codex with its own sign-in method beside a Claude Images attempt, style delivered once with the profile digest unchanged, and style over 500 characters refused.
  - Each fails because the tables, columns and logic don't exist yet.
- Verification: The intake-server test tiers, the contracts generation check, `pnpm lint:readability`, and the frontend typecheck for `selection` readers.
- Risks:
  - Grants missing for new columns or tables, which the test tier catches.
  - A missed `selection` reader, which the typecheck catches.

- [ ] 6.1 Confirm the settings, sealing and delivery code paths and every `selection` reader as the baseline.
- [ ] 6.2 RED: write the resolver and server tests.
- [ ] 6.3 GREEN: add the migration, the backfill and the grants.
- [ ] 6.4 GREEN: replace `selection` in the contracts, regenerate the client and update every reader.
- [ ] 6.5 GREEN: add the settings read and write, the old-column mirror and the validation.
- [ ] 6.6 GREEN: resolve and seal each stage's provider and model.
- [ ] 6.7 GREEN: deliver the style.
- [ ] 6.8 Refactor, then run the server suites, the frontend typecheck and the readability checks.

## 7. Batch defaults storage and new-batch snapshot

- PR delivery: PR-C.
- Outcome:
  - `GET` and `PUT /api/v1/batch-defaults` with a revision check.
  - Batch creation copies the default location, default supplier, Auto tags value and new-batch instructions into revision 1.
  - Missing records are skipped and recorded.
  - A batch-free catalogue read lets Settings pick existing locations and companies.
- Scope:
  - `batch_defaults` repository and routes;
  - `capture/repository.ts` `create()`;
  - the catalogue reader exposed without a batch;
  - contracts and client;
  - a Capture-visible note code for a missing default.
- Prerequisites: Task 6, for the migration and agent settings fields.
- Acceptance: capture-batch-settings (all scenarios); app-settings › "Default location no longer exists" and "Stale batch defaults" (server side).
- TDD approach: RED tests for the route conflict, the snapshot contents at creation, a missing location skipped with its note, and a later default change not altering an existing batch.
- Verification: The server suites and the contracts check.
- Risks: The catalogue lookup sits outside the creation transaction, so a record deleted between the lookup and the insert is accepted. That is acceptable, because the batch later reconciles through the existing review freshness.

- [ ] 7.1 Confirm the `create()` and catalogue reader paths as the baseline.
- [ ] 7.2 RED: write the route and snapshot tests.
- [ ] 7.3 GREEN: build the routes, the batch-free catalogue read, the snapshot and the missing-default note.
- [ ] 7.4 Refactor, then run the server suites.

## 8. Forced connection check

- PR delivery: PR-C.
- Outcome:
  - `POST /api/v1/connection-status/check` with in-flight reuse and a 5-second minimum interval.
  - `unauthorized` reported for a 401 or 403.
  - The server menu's Check connection now and Settings › InvenTree's Check now and token status both work.
- Scope:
  - `header/connection.ts` and `header/routes.ts`;
  - contracts and client;
  - `masthead/ConnectionDetails.tsx` and `settings/InvenTreeSection.tsx` (status row; the import reference shown read-only; Replace token is task 11).
- Prerequisites: None.
- Acceptance: header-connection-status › "Connection check on demand" (all scenarios); app-settings › "Check now with a refused token" and "Check now while a check is running".
- TDD approach:
  - RED server tests: reuse in flight, the 5-second window, the 401 mapping, and the cache updated.
  - RED frontend tests: the button states, Refused wording, and no double request.
- Verification: The server suites and the frontend checks.
- Risks: A probe deadline longer than the click rate, which in-flight reuse covers.

- [ ] 8.1 Confirm the cache and failure-code paths as the baseline.
- [ ] 8.2 RED: write the server and frontend tests.
- [ ] 8.3 GREEN: build the route and cache sharing, the `unauthorized` code, and both UI entry points.
- [ ] 8.4 Refactor, then run the server and frontend checks.

## 9. Settings forms for the new rows

- PR delivery: PR-D.
- Outcome: These all save and reload with conflict handling:
  - the provider cards, each with on or off, sign-in and default model;
  - the default provider;
  - provider and model per step;
  - new-batch instructions;
  - Part description style;
  - Suggest tags for new batches;
  - Batch defaults.

  "Coming later" remains only on the rows the spec lists.
- Scope:
  - the `components/settings/agents/*` subsections from task 5, with the provider cards wrapping the existing credential panels;
  - `BatchDefaultsSection.tsx` with pickers on the batch-free catalogue;
  - React Hook Form per subsection;
  - navigation-guard reporting from input events;
  - the reset note when a provider is turned off.
- Prerequisites: Tasks 5, 6 and 7.
- Acceptance: app-settings › "Agent settings section" and "InvenTree and appearance sections" (batch-default scenarios):
  - Mixing providers across steps;
  - Turning a provider off;
  - No provider on;
  - Instructions copied once;
  - Description style too long;
  - Stale settings revision;
  - the provider card status scenarios, which still hold.
- TDD approach: RED tests for each subsection's save and reload, conflict with the draft kept, the provider-off reset, no provider on, grouped step options, length limits, the missing location shown, and the dirty guard.
- Verification: The full frontend checks, and a browser pass of every Settings page against canvas v67.
- Risks: One revision is shared across agent subsections. A save in one subsection must send the loaded values for the others, not stale form state.

- [ ] 9.1 Confirm the PR-B structure and the PR-C contracts are merged, and set the baseline.
- [ ] 9.2 RED: write the form tests.
- [ ] 9.3 GREEN: build each subsection form and the Batch defaults form, removing their `DisabledFeature` wrappers.
- [ ] 9.4 Refactor, then run the frontend checks.
- [ ] 9.5 Record a demo of the working rows and attach it to PR-D.

## 10. Documentation and notes

- PR delivery: PR-D. Each earlier PR also updates the docs its own change touches.
- Outcome: Docs match the code, and `notes.md` records departures.
- Scope:
  - frontend and intake-server `ARCHITECTURE.md` and README (Settings structure, debug mode, new routes and tables);
  - `docs/PLANNED_FUNCTIONALITY.md` status;
  - the design log statuses, D32 to D35 set to Built with PR links;
  - `notes.md`.
- Prerequisites: Tasks 2 to 9 implemented. PR-E updates its own docs for task 11.
- Acceptance: Docs claims re-checked against the code.
- TDD approach: Docs only. Use reference and consistency checks.
- Verification: Link checks; each claim checked against the code before pushing.
- Risks: None.

- [ ] 10.1 Update the architecture docs and READMEs.
- [ ] 10.2 Update the index and design log statuses.
- [ ] 10.3 Write `notes.md` with the final open items.

## 11. Replace the read token

- PR delivery: PR-E.
- Outcome:
  - Settings › InvenTree replaces the app server's InvenTree read token without a restart. The new token is checked against InvenTree first, saved owner-only, and never shown again.
  - "Use the environment token" reverts.
  - Approvals and bootstrap are unchanged.
- Scope:
  - `INTAKE_SECRETS_DIR` in `intake-server/src/config.ts`, plus a launcher default under the development state directory (`tooling/dev/settings.cjs`) and the env template;
  - a `CredentialHolder` read by `inventory/transport.ts` on each request;
  - startup loading in `main.ts`, refusing a file readable by other users;
  - `PUT` and `DELETE /api/v1/inventory-credential`, with check-then-save and an atomic `0600` write;
  - request-log redaction;
  - `credential_source` and `saved_at` in connection status;
  - contracts and client;
  - the Settings › InvenTree row: write-only field, Check and save, and Revert with confirmation.
- Prerequisites: Task 8, for the status row and the probe it reuses.
- Acceptance:
  - access-identity › "Access server-only credentials" (all scenarios);
  - app-settings › "Replace the token", "Replacement refused", "Go back to the environment token".
- TDD approach:
  - RED server tests:
    - the probe runs before the write, and a refusal or unreachable target writes nothing;
    - the file mode is `0600` and the write is atomic;
    - a read in flight finishes with the old credential, and the next uses the new one;
    - a restart loads the saved file, and bootstrap is unchanged;
    - Revert deletes the file;
    - no secrets directory gives `secret_store_unavailable`;
    - a world-readable file refuses startup;
    - a planted token is absent from every response and log line.
  - RED frontend tests: the field clears after saving, the Refused and Unavailable messages show, Revert asks for confirmation, and the field is never filled from the server.
- Verification: The intake-server suites, the frontend checks, and a manual check against the local development InvenTree with a revoked and a fresh token. Record the results in the PR without the token.
- Risks:
  - Logging the request body by accident. The redaction test with a planted value covers it.
  - Coordinating with `default-env-settings`, which also edits the env template and launcher.

- [ ] 11.1 Confirm the transport credential path, startup order and request logging as the baseline.
- [ ] 11.2 RED: write the server and frontend tests.
- [ ] 11.3 GREEN: build the secrets directory setting, the holder, startup loading and the permissions check.
- [ ] 11.4 GREEN: build the routes, check-then-save, revert, redaction and status fields.
- [ ] 11.5 GREEN: build the Settings › InvenTree row.
- [ ] 11.6 Refactor, run the server and frontend checks, and do the manual token swap check.
- [ ] 11.7 Update the intake-server README and architecture docs and the env template notes for `INTAKE_SECRETS_DIR`.

## Delivery evidence and lifecycle follow-up

For each PR:

- run local review rounds until one finds nothing new, naming the reviewed SHA;
- attach evidence (screenshots, recordings) to the PR, collapsed when there are three or more items;
- raise it with no reviewers;
- merge once review is clean and CI is green.

Then update the BI items to their actual status; Done only after PR-D merges. Sync and archive the change after delivery, running `pnpm openspec:overlap --change settings-debug-mode` first.

- [ ] PR-A reviewed, published and merged
- [ ] PR-B reviewed, published and merged
- [ ] PR-C reviewed, published and merged
- [ ] PR-D reviewed, published and merged
- [ ] PR-E reviewed, published and merged
