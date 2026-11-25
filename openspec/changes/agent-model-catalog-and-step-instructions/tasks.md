# Implementation and delivery tasks

## Plan context

- **Plan:** the [proposal](proposal.md) and [design](design.md), with deltas in `specs/` for `app-settings`, `processing-agent-sessions`, `shared-vm-execution` and `processing-workspace`.
- **Reuse:** the pinned Claude Code and Codex CLIs already in the guest image, the providers' models APIs for API keys, and the existing settings save, sealing, opening and guest-connection paths. No new dependency.
- **Change name:** `agent-model-catalog-and-step-instructions`. Branches are `feat/agent-model-catalog-and-step-instructions-<suffix>`, and subjects `type(agent-model-catalog-and-step-instructions): …`.
- **Item:** BI-023.
- **Boards:** FixStepInstructions (R3), FixModelEffort (R4), FixModelCatalogStates (R5) and the Screens board SettingsAgentsProposal, canvas v108.

## Completion and commit ordering

- Check an action in the same commit as its verified work.
- Review, publication, CI and merge stay unchecked until they happen.
- Never commit in a worktree while a test run uses it.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Effort in the settings and the selection | Contracts and intake server | None | app-settings "Effort beside every model picker" (the saved values; the select itself is task 4); processing-agent-sessions "Sessions run at the sealed effort" (resolution and sealing) |
| 2. Sessions pass the sealed effort | Intake server and guest | 1 | processing-agent-sessions "Sessions run at the sealed effort", all scenarios |
| 3. The model catalogue: read, stored and served | Intake server, guest VM and contracts | 1 (the `AgentEffort` type) | shared-vm-execution "Model lists read without a provider turn", all scenarios; the data behind app-settings "Models listed from each provider" and "Model list states" |
| 4. Model pickers, Effort and the list's states | Frontend | 1, 3 | app-settings "Models listed from each provider", "Model list states", "A saved model no longer offered", "Effort beside every model picker"; processing-workspace "Step header warns of a model no longer offered" |
| 5. Instructions for each step | Contracts, intake server, guest and frontend | BI-022 PR-A (#275) merged | app-settings "Instructions for each step"; processing-agent-sessions "Step instructions sealed into each attempt", all scenarios except "Lots queued on either side of an edit" (task 7) |
| 6. Live catalogue and effort check | Manual verification | 2, 3, 4 merged; Mitch's go-ahead | shared-vm-execution "Model lists read without a provider turn" against the real providers; processing-agent-sessions "Sessions run at the sealed effort" in a real session |
| 7. Step instructions in multi-lot groups | Intake server | 5 merged; BI-022 PR-I (multi-lot sessions) merged | processing-agent-sessions "Step instructions sealed into each attempt" (Lots queued on either side of an edit) |

## PR delivery map

| Bundle | Outcome and included work | Task coverage | Why this boundary | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-0 | This plan, BI-023, and tasks 16 and 17 in `polish-ui-styling-and-loading` | Planning | Review the plan before code | None; first | `interactive-app` ← `docs/agent-settings-plan`; `docs(agent-model-catalog-and-step-instructions): plan exact models, effort and step instructions` | `openspec validate --strict` for both changes; `pnpm openspec:overlap`; `pnpm lint:markdown`; read-only review; CI |
| PR-A | Effort saved per step and per provider, resolved and sealed with the model, and passed to Claude and Codex | 1, 2 | One data path from the setting to the CLI, reviewed with its adapter tests; useful on its own through the API | PR-0 | `interactive-app` ← `feat/agent-model-catalog-and-step-instructions-effort`; `feat(agent-model-catalog-and-step-instructions): seal and send the chosen effort` | Contracts tests; intake unit, PG and process tiers; the pinned-version proof in the PR description; review; CI |
| PR-B | The catalogue reader in the guest and on the host, its connection, table, schedule and API, with the built-in fallback | 3 | Server and VM work, reviewed on its own with the process tier, as the provider status was | PR-A (the `AgentEffort` type) | `interactive-app` ← `feat/agent-model-catalog-and-step-instructions-catalog`; `feat(agent-model-catalog-and-step-instructions): read each provider's models` | Contracts tests; frontend typecheck (the contracts it imports); intake unit, PG and process tiers with the decoder and probe images; review; CI |
| PR-C | The pickers listing the catalogue, the Effort select beside each, the list's states, and the Processing pill; `AGENT_MODEL_SUGGESTIONS` retired | 4 | The UI over PR-A and PR-B, reviewed with captures | PR-A and PR-B merged | `interactive-app` ← `feat/agent-model-catalog-and-step-instructions-pickers`; `feat(agent-model-catalog-and-step-instructions): exact models and effort in agent settings` | Frontend typecheck, lint, tests and build; contracts tests and the intake typecheck, unit and PG tiers (the retired constant's server and test-support readers); captures at 1440 and 390 px; demo video; review; CI |
| PR-D | Instructions for each step: the setting, the sealed `/6` field and `/7` brief entry, and the editor | 5 | One end-to-end feature, after BI-022's brief exists so both input versions land together | PR-A merged; BI-022 PR-A (#275) merged; rebase on PR-C if it merged first (both edit `StepModels`) | `interactive-app` ← `feat/agent-model-catalog-and-step-instructions-step-instructions`; `feat(agent-model-catalog-and-step-instructions): instructions for each step` | Contracts tests; intake unit, PG and process tiers; frontend checks; demo video; review; CI |
| PR-F | Step text captured on each queued lot, and groups that only take lots queued with the same text | 7 | It integrates with BI-022's multi-lot claim, which doesn't exist until BI-022's PR-I; kept apart so PR-D isn't held | PR-D merged; BI-022 PR-I merged; before BI-022's PR-G2 activates `/7` (asked of BI-022) | `interactive-app` ← `feat/agent-model-catalog-and-step-instructions-groups`; `feat(agent-model-catalog-and-step-instructions): keep each group's step instructions consistent` | Intake unit, PG and process tiers; review; CI |
| PR-E | The live checks recorded in `notes.md`, with the evidence on the PR | 6 | A docs-only record of a check that needs Mitch's go-ahead, kept apart so it doesn't hold the code PRs | PR-A, PR-B and PR-C merged; Mitch's go-ahead | `interactive-app` ← `docs/agent-model-catalog-and-step-instructions-live-check`; `docs(agent-model-catalog-and-step-instructions): record the live model and effort check` | `pnpm lint:markdown`; evidence attached; review; CI |

**Order:** PR-A first; PR-B after it; PR-C after both; PR-D whenever PR-A and BI-022's #275 have merged; PR-F after PR-D and BI-022's PR-I; PR-E once PR-A to PR-C have merged.

## 1. Effort in the settings and the selection

- **PR delivery:** PR-A.
- **Outcome:** the agent settings save an effort per step and a default effort per provider; `resolveSelection` returns the model and its effort as one pair; `/6` inputs seal it in `agent`, and the `/1` path never does. (`/7` seals `agent: null` until BI-022's provider-backed profile, which carries it in `AgentSelection`.)
- **Scope and approach:** `contracts/src/agent-selection.ts` (`AgentEffort`, optional `effort`), `contracts/src/agents.ts` (`AgentStageSelection.effort`, `AgentProviderSettings.default_effort`), `agents/settings.ts` (`checkAgentSettings`, read and save), `agents/schema.ts` and a migration for `default_effort`, `agents/resolve-selection.ts`, `processing/session-attempts.ts` and `processing/attempts.ts` (strip it for `/1`). The design is "Settings fields" and "Effort is sealed with the selection".
- **Prerequisites:** none.
- **Acceptance:** "Sessions run at the sealed effort" (A step on Default; sealing); the saved values behind "Effort beside every model picker".
- **TDD approach:** contract tests for the new shapes, a `resolveSelection` test pairing the step's or the provider's effort with its model, and a PG test sealing an attempt with an effort fail first.
- **Verification:** contracts tests; intake unit and PG tiers.
- **Risks and decisions:** none beyond the design.

- [x] 1.1 Read the shared and intake-server code guidelines, `intake-server/ARCHITECTURE.md`, `agents/ARCHITECTURE.md` and the settings save path.
- [x] 1.2 RED:
  - [x] 1.2.1 contract tests: `AgentSelection` with and without `effort`; an effort failing the shape is refused; settings with step and provider efforts round-trip;
  - [x] 1.2.2 `resolveSelection`: a step's own model with its effort; a step on Default with the provider's default effort; a step whose provider is off falling back to the default provider's pair;
  - [x] 1.2.3 PG: a save with efforts through the receipts; an attempt queued after it seals the pair; an attempt queued before it keeps the old one; a `/1` attempt seals no effort.
- [x] 1.3 GREEN: the contract, the migration, validation, resolution and sealing.
- [x] 1.4 Regenerate the OpenAPI contract, run the contracts tests and the intake unit and PG tiers.

## 2. Sessions pass the sealed effort

- **PR delivery:** PR-A.
- **Outcome:** a Claude turn runs with `--effort <level>` and a Codex turn sends `effort` on every `turn/start` when the sealed selection has one; with none, nothing is sent. Host and guest drivers behave the same.
- **Scope and approach:** `agents/session/session-adapters.ts` (`runClaudeSession` args, `runCodexSession` `turn/start`, and a dispatch report), the guest's `native-turn.ts` path and its turn frames through `shared-vm/coordinator.ts`, the session row's `sent_effort` (with its migration and the session read), and `agents/ARCHITECTURE.md`. The design is "Effort is sealed with the selection and passed to the CLI".
- **Prerequisites:** task 1.
- **Acceptance:** "Sessions run at the sealed effort", all scenarios.
- **TDD approach:** adapter tests against the fake CLIs the session tests already use, asserting the argument list and each `turn/start` payload, fail first.
- **Verification:** intake unit tier; the process tier for a guest turn with an effort; the pinned-version proof in the PR description.
- **Risks and decisions:** if the pinned versions don't accept the flag or field, stop at 2.1 and ask Mitch.

- [x] 2.1 Proof of fit, offline: `claude --help` from `@anthropic-ai/claude-code` 2.1.319 lists `--effort` with its levels, and `codex app-server generate-json-schema` from `@openai/codex` 0.166.0 has `effort` on `TurnStartParams`. Record the result in the PR description; stop and ask Mitch if either is missing.
- [x] 2.2 RED: adapter tests for Claude fresh and resumed turns with and without an effort, and Codex `turn/start` after `thread/start` and after `thread/resume`, with `turn/steer` carrying none; a PG test that the session row records the effort once dispatched, none for Default or a synthetic attempt, and none when the turn fails before dispatch (Codex failing between `onStarted` and `turn/start`).
- [x] 2.3 GREEN: pass the effort in both adapters, and record `sent_effort` on the session row.
- [x] 2.4 A process-tier test of a guest turn sealed with an effort reaching the fake CLI, with the guest's dispatch report recorded through the coordinator. Update `agents/ARCHITECTURE.md`. Run the intake tiers.

## 3. The model catalogue: read, stored and served

- **PR delivery:** PR-B.
- **Outcome:** the session worker reads each enabled provider's models for its current sign-in, on the host or in the guest, without a turn; stores them in `agent_model_catalog` with their read time and CLI version; refreshes on start, on request, on a CLI version change and every 12 hours; and serves them, or the built-in list, at `GET /api/v1/agents/models`, with `POST /api/v1/agents/models/refresh`.
- **Scope and approach:**
  - **Contracts:** the catalogue DTO and limits, the two routes, and `BUILT_IN_MODEL_CATALOG`. `AGENT_MODEL_SUGGESTIONS` stays for `ModelPicker` until task 4 removes it.
  - **Guest:** each management process's `sign_in_generation` (Claude's store revision; a Codex counter advanced on promotion or logout), and a catalogue reader in each provider's management process (Claude: the pinned CLI's `initialize`; Codex: `model/list` under the shared account lock; API keys: the models APIs), served on a `bench-model-catalog/1` connection through the relay.
  - **Coordinator and relay:** the connection kind, its 20 s budget and 64 KiB frame, and `guest_outdated`.
  - **Worker:** the reader for host profiles, normalisation, the table writes with the sign-in generation and the in-flight fence, the schedule, the `NOTIFY` listener and the supervisor-pass check, and the admission-reported CLI version trigger.
  - **API:** the read and refresh routes (a refresh may carry the sign-in invalidation), with grants.
  - The design is "The model catalogue".
- **Prerequisites:** task 1 (`AgentEffort`).
- **Acceptance:** shared-vm-execution "Model lists read without a provider turn", all scenarios; the API states behind app-settings "Models listed from each provider" and "Model list states".
- **TDD approach:** normalisation tests from recorded fixtures of the pinned versions' replies, PG tests for the table and schedule, and process tests over the real relay with a fake guest reader fail first.
- **Verification:** contracts tests; intake unit, PG and process tiers with the decoder and probe images; no live provider call.
- **Risks and decisions:** the pinned versions' reply shapes and where API keys live in the guest are confirmed at 3.1 before code. A mode with no route to its key keeps the built-in list.

- [ ] 3.1 Proof of fit, offline and with no paid call:
  - [ ] 3.1.1 capture the pinned Claude Code 2.1.319 `initialize` reply with a placeholder token and the network refused, and again through the guest's Anthropic-only egress in a local test VM with no token, to learn whether `models[]` needs the network; keep the reply as a test fixture with any account detail removed;
  - [ ] 3.1.2 generate Codex 0.166.0's app-server schema and confirm `model/list`'s fields and paging;
  - [ ] 3.1.3 find where each shared-VM API-key route gets its key (`environment.ts` and the guest's turn environment), and record which modes keep the built-in list;
  - [ ] 3.1.4 stop and ask Mitch if a pinned version lacks `models[]` effort levels or `model/list`.
- [ ] 3.2 RED:
  - [ ] 3.2.1 normalisation: Claude aliases folded into one exact model; `opus[1m]`-style IDs folded or left out; older Claude models marked; Codex hidden models left out with `isDefault` and default effort kept; the API-key `usable` marks; oversized and malformed answers refused;
  - [ ] 3.2.2 PG: a good read written with `read_at`, `cli_version` and its sign-in generation; a failed read keeping the last list and recording a fixed failure code; an `invalidate` refresh through `request_model_catalog_refresh` under the API role setting `stale_sign_in` and `invalidation_seq` at once, and the API role unable to change anything else on the table; a reply arriving after the guest's sign-in commit but before the invalidation discarded by the pre-publish generation check; on a host profile with no guest connected, an API-key reply discarded when the key's HMAC changed during the read, and a host subscription read stored with no generation and no fence; a delayed reply from the old generation, arriving after the invalidation, discarded and read again; a generation poll finding a new sign-in with no browser request marking the row stale and requesting a read; `stale_sign_in` kept after a failed reread and cleared only by a list published under the current generation; the API answering each state; a refresh request read and cleared; the 12 h and 5 min schedule under a controlled clock; a CLI version change from admission requesting a read; the API's states (`current`, `reading`, `failed`, `never_read` with the built-in list); the API's grants (read and request only);
  - [ ] 3.2.3 process: the `bench-model-catalog/1` connection through the real relay with a fake guest reader answering, exceeding the frame, timing out (reader reaped) and absent (`guest_outdated`); a status read during a catalogue read still answering within its deadline; a generation-only answer starting no CLI; a Claude token replaced during a read discarding it; a Codex sign-in change waiting for a read under the shared lock;
  - [ ] 3.2.4 no read sends a user message, and a Claude subscription read never calls a models API.
- [ ] 3.3 GREEN: the guest reader, the connection, the worker, the table, the schedule and the API.
- [ ] 3.4 Update `agents/ARCHITECTURE.md` and the deployment README (the guest image refresh). Run the contracts tests and the intake tiers, building the decoder and probe images first.

## 4. Model pickers, Effort and the list's states

- **PR delivery:** PR-C.
- **Outcome:** every model picker in Settings › Agents lists the catalogue by name and exact ID, with the older and "Saved, not offered" groups; an Effort select sits beside each; the list shows its reading, failed, built-in and not-offered states; Processing's step header shows the "Not offered" pill.
- **Scope and approach:** `components/settings/agents/` (`ModelPicker`, `StepModels`, `ProviderCard`, `ProvidersAndSteps`, `provider-form.ts`, `settings-fields.ts`), a new `EffortSelect` and `useModelCatalog` query, retiring `AGENT_MODEL_SUGGESTIONS` (the picker reads the catalogue; `intake-server/src/agents/settings.ts`'s unsaved defaults and first-save fallback and `frontend/src/test/agent-settings.ts` and `intake-server/tests/support/agent-settings.ts` take `DEFAULT_MODEL_BEFORE_SAVE` with today's IDs), the sign-in dialogs requesting a refresh once they confirm a sign-in, Check again requesting one, the Processing step header, and the Settings fixture. The design is "Pickers, Effort and states in Settings".
- **Prerequisites:** tasks 1 and 3 merged.
- **Acceptance:** app-settings "Models listed from each provider", "Model list states", "A saved model no longer offered", "Effort beside every model picker"; processing-workspace "Step header warns of a model no longer offered"; polish's "One searchable model picker" and "Model picker limits and exact IDs" still pass.
- **TDD approach:** component tests over fixture catalogues for each scenario fail first; the existing `ModelPicker` tests are updated from the suggestion list to a fixture catalogue.
- **Verification:**
  - the frontend typecheck, lint, tests and build;
  - captures of each state at 1440 and 390 px;
  - a demo video of searching by name, choosing an effort, a model lacking the level resetting it, a failed read and a saved model no longer offered, using fixtures.
- **Risks and decisions:** the Effort select is a native select, per the dropdown guideline.

- [ ] 4.1 Read the shared and frontend code guidelines, `frontend/ARCHITECTURE.md`'s Settings › Agents section and the three boards.
- [ ] 4.2 RED:
  - [ ] 4.2.1 the picker: names with IDs, search by either, Claude's collapsed older group (including a list of only 4.x models), "Saved, not offered" first, the API-key "can't use" mark, the exact-ID option unchanged;
  - [ ] 4.2.2 the states: reading with the saved ID and effort kept, failed with the shown list's time and Try again, the built-in list's mark with Effort only Default, Check again and a confirmed sign-in requesting a refresh, no not-offered warning in Settings or the Processing pill while the list is `stale_sign_in`, including after a failed reread, and both views recovering without a reload when the new list lands; refetching every 1 s for 30 s and then every 30 s while reading or stale, Settings and Processing that start from `current` learning of a stale list and its recovery through the 60 s idle refetch with no focus change or reload, and refetching on window focus before that timer fires; the sign-in dialog confirming only after the API acknowledges the invalidation, with its own view showing the list as stale at once while the catalogue GET is held pending; a hidden tab refetching when shown again;
  - [ ] 4.2.3 Effort: options in the provider's order with labels, "Default · Low" for Codex and plain "Default" for Claude, disabled "No effort levels", the reset notice and one autosave for the model and effort, a saved unaccepted effort kept with its warning, and the provider card's default pair;
  - [ ] 4.2.4 the Processing pill showing for a not-offered model, linking to the step row, and hidden for the built-in or unread list.
- [ ] 4.3 GREEN: the query, the picker groups, `EffortSelect`, the states and the pill; retire `AGENT_MODEL_SUGGESTIONS`, with the server's settings tests showing the unsaved defaults and first-save fallback unchanged.
- [ ] 4.4 Update `frontend/ARCHITECTURE.md` and the Settings fixture. Run the frontend checks, capture the states and record the demo video.

## 5. Instructions for each step

- **PR delivery:** PR-D.
- **Outcome:** Examine, Research and Images each have optional instructions of up to 1,000 characters, saved with Save and Discard; each attempt of a step seals the step's text saved when its work was queued and gets it as operator guidance, in the `/6` opening and in the `/7` brief's operator-sourced material; edits reach only work queued after them.
- **Scope and approach:**
  - **Contracts:** `stage_instructions` in the settings; the optional `stage_instructions` in `/6`; a `step_guidance` entry in the brief's `human` section and the `/7` manifest field, in the brief contract once #275 has merged.
  - **Intake server:** the column and migration, `checkAgentSettings` (1,000 code points; Examine, Research and Images only), sealing at queue time in `prepareSessionAttempt` for `/6` and for the `/7` lead and single-lot attempts #275 seals, `openingText`, and the brief builder's rendering under "Operator guidance for this step". Multi-lot groups and the provider-backed `/7` profile are BI-022's later PRs (design: "Later BI-022 work").
  - **Guest:** the manifest field it validates.
  - **Frontend:** a `StepInstructions` editor per step row in `StepModels`, a text form per step on the existing save queue, the count with amber from 900, the paste cut and its message.
  - The design is "Where step instructions reach the agent".
- **Prerequisites:** BI-022 PR-A (#275) merged; task 1 merged (the settings migration order).
- **Acceptance:** app-settings "Instructions for each step"; processing-agent-sessions "Step instructions sealed into each attempt", all scenarios except "Lots queued on either side of an edit", which is task 7's.
- **TDD approach:** contract tests for the limits, PG tests sealing a step's text and keeping it across an edit, an opening and brief rendering test, and editor tests fail first.
- **Verification:**
  - contracts tests; intake unit, PG and process tiers (a `/7` synthetic session through BI-022's test-only switch);
  - frontend checks;
  - a demo video of adding Research instructions, the paste cut and a new session's opening holding the text, using fixtures.
- **Risks and decisions:** don't edit BI-022's change artifacts; if #275 changes the brief's shape before merging, follow the merged shape and note it in `notes.md`. If #275 is abandoned, ship the `/6` path alone and record the `/7` entry as an open item.

- [ ] 5.1 Read the guidelines, BI-022's merged brief code and design, and the board. Confirm #275 has merged.
- [ ] 5.2 RED:
  - [ ] 5.2.1 contracts: settings with 1,000 and 1,001 code points, an Inventory key refused, empty removed; a `/6` manifest with and without the field; the brief's `step_guidance` entry;
  - [ ] 5.2.2 PG: a Research attempt seals Research's text only; Examine and Images seal none; an edit after sealing leaves the attempt, its resume and its inbox unchanged; the next attempt seals the new text; a `/7` synthetic lead and single-lot attempt seal the text saved before they were queued, and one queued with A keeps A after B is saved; profile and stage pack digests unchanged;
  - [ ] 5.2.3 the opening renders the guidance after the app's rules, and the `/7` brief renders it under "Operator guidance for this step" in the `human` section; a retained input without it renders as before;
  - [ ] 5.2.4 the editor: the quiet button, focus on open, the count and amber from 900, typing stopping at 1,000, the paste cut with its announced message, Save and Discard per step, clearing removes.
- [ ] 5.3 GREEN: the setting, sealing, rendering and editor.
- [ ] 5.4 Update `agents/ARCHITECTURE.md`, `frontend/ARCHITECTURE.md` and `docs/agent-sessions.md` (what every session receives). Run the contracts tests, the intake tiers and the frontend checks, and record the demo video.

## 6. Live catalogue and effort check

- **PR delivery:** PR-E.
- **Outcome:** evidence that the real guest reads each signed-in provider's models with no turn, and that a real session sent the chosen effort and completed; the effort the provider applied stays unverified.
- **Scope and approach:** with Mitch's go-ahead and his `pnpm dev` with the refreshed guest image: Check again for each provider, the stored row and the Settings page compared with the provider's own list; then one short session per provider at a non-default effort, checking that the session completed and that its recorded `sent_effort` is the chosen level. Neither pinned CLI reports the effort it applied, so the effective effort is recorded as unverified.
- **Prerequisites:** PR-A, PR-B and PR-C merged; Mitch's go-ahead for each live step.
- **Acceptance:** shared-vm-execution "Model lists read without a provider turn"; processing-agent-sessions "Sessions run at the sealed effort".
- **TDD approach:** none: a live verification of merged behaviour. Its contract is the checklist below and the evidence on the PR.
- **Verification:** captures and trimmed outputs on PR-E; `notes.md` records the result and anything unexpected.
- **Risks and decisions:** the sessions are real provider turns with their cost; the read itself makes no paid call.

- [ ] 6.1 Ask Mitch for the go-ahead, naming the reads and the two short sessions.
- [ ] 6.2 Read each provider's list in the real guest and compare it with the provider's own list; confirm no turn started.
- [ ] 6.3 Run one short session per provider at a non-default effort; confirm it completed and its `sent_effort` matches, and record the effective effort as unverified.
- [ ] 6.4 Record the outcome in `notes.md`, attach the evidence to PR-E, and run `pnpm lint:markdown`.

## 7. Step instructions in multi-lot groups

- **PR delivery:** PR-F.
- **Outcome:** a queued lot keeps the step text it was queued with, and a multi-lot group takes only lots queued with the same text, so a session's guidance is always its lots' queue-time text.
- **Scope and approach:** the queued-lot record BI-022's PR-I adds (a sealed copy or digest of the step text, written when the lot is queued, in this change's migration), the group claim's lot selection, and the brief builder for groups. The design is "Later BI-022 work".
- **Prerequisites:** task 5 merged; BI-022 PR-I (multi-lot sessions) merged.
- **Acceptance:** processing-agent-sessions "Step instructions sealed into each attempt", Lots queued on either side of an edit.
- **TDD approach:** a PG test queueing a lot under A, saving B, queueing a second lot, then claiming, fails first: today the group would take both lots and seal the text read at claim.
- **Verification:** intake unit, PG and process tiers.
- **Risks and decisions:** this task integrates with code BI-022 writes; follow its merged shape and record departures in `notes.md`. Ask BI-022's implementing session to hold its PR-G2 activation for this task once PR-I merges.

- [ ] 7.1 Read BI-022's merged multi-lot claim and its design, and confirm where a queued lot's record is written.
- [ ] 7.2 RED: the A, edit, B, claim regression; two lots queued with the same text grouping as before; a lot queued before this task (no captured text) grouping only with lots that have none and sealed with no step text, as a retained input is.
- [ ] 7.3 GREEN: capture the text at queue time and filter groups by it.
- [ ] 7.4 Update `agents/ARCHITECTURE.md` and run the intake tiers.

## Delivery evidence and lifecycle follow-up

- [x] PR-0: review the plan read-only (`codex exec -m gpt-6.2-sol -s read-only`), fix, publish, CI green, merge. Merged as #278 at `2dd1206d`.
- [ ] PR-A: implement tasks 1 and 2, review the exact head, publish with the pinned-version proof, CI green, merge.
- [ ] PR-B: implement task 3, review the exact head, publish, CI green, merge.
- [ ] PR-C: implement task 4, review the exact head, publish with the captures and the demo, CI green, merge.
- [ ] PR-D: implement task 5, review the exact head, publish with the demo, CI green, merge.
- [ ] PR-F: implement task 7 once BI-022's PR-I has merged, review the exact head, publish, CI green, merge.
- [ ] PR-E: run task 6 with Mitch's go-ahead, publish the evidence, CI green, merge.
- [ ] Update BI-023 as PRs merge. It is Done only after PR-A to PR-D and PR-F merge and their acceptance is evidenced; the live check (PR-E) is recorded separately.
- [ ] Mark R3, R4 and R5 in the design log as Built, with their PRs.
- [ ] Before syncing: re-run strict validation and `pnpm openspec:overlap --change agent-model-catalog-and-step-instructions`. `polish-ui-styling-and-loading` adds "One searchable model picker" and "Model picker limits and exact IDs" to app-settings; sync it first.
- [ ] Before archiving, run `pnpm openspec:overlap --change agent-model-catalog-and-step-instructions`, sync the specs and record open items in `notes.md`.
