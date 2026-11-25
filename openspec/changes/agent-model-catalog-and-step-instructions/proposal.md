# Change proposal

## Problem and intended outcome

Mitch asked for three changes to Settings › Agents on 2026-11-25 and approved the canvas boards for them (canvas v108, "Agent settings proposals (R1–R5)" and the Screens board `SettingsAgentsProposal`):

1. **Instructions for each step** (R3, board FixStepInstructions). "For the each step section of the agent settings, allow providing custom instructions to each different step." Today there is one instruction box, copied into each new batch, and every step's agent reads the same text, so a rule meant for Research alone also reaches Examine and Images.
2. **Exact models from each provider** (R4, board FixModelEffort). "Fetch the full list of exact available models for each provider — have it dynamically shown … include model numbers, such as "Opus 5.5", "Opus 5", "Opus 4.5", "Haiku 5"." Today the picker offers a fixed list the app ships with: Claude's `sonnet`, `opus` and `haiku` aliases and four Codex IDs. An alias doesn't say which version runs, and the Codex list misses models the account's Codex now offers.
3. **An effort choice beside every model** (R4). "Wherever there is a model selector on the agents page, there should be an additional drop down to select the effort level for the model — the list of values should be dynamically shown based on the actual available values." Today no effort is sent, so each CLI picks its own.

The model list also needs honest states (R5, board FixModelCatalogStates): while the first read is loading, after a failed read, when no list has ever been read, and when a saved model is no longer offered.

The outcome:

- **Step instructions:** each agent step (Examine, Research, Images) has optional instructions of up to 1,000 characters, with Save and Discard, sealed into each new session of that step as operator guidance.
- **Model list:** each provider's picker lists the exact models that provider offers this sign-in, by name with version and with the exact ID beside it, read from the provider's own CLI where turns run and kept with the time it was read.
- **Effort:** beside every model picker, an Effort select lists the levels the chosen model accepts. Default sends no effort. The chosen level is sealed into each session and passed to the CLI.
- **States:** a first read shows "Reading Codex's models…"; a failed read keeps the last list with its time and "Try again"; a never-read provider shows a built-in list marked "may be out of date"; a saved model that is no longer offered stays selected with a warning.

## Change identity and linked items

- **Change name:** `agent-model-catalog-and-step-instructions`. Branches are `feat/agent-model-catalog-and-step-instructions-<suffix>`, and subjects `type(agent-model-catalog-and-step-instructions): …`.
- **Item:** [BI-023](../../../docs/PLANNED_FUNCTIONALITY.md#bi-023--exact-agent-models-effort-and-step-instructions), allocated here as the next free number (BI-022 is the highest in the index and in Git history).
- **Related:** R1 and R2 from the same approval are planned in `polish-ui-styling-and-loading` (BI-020) as tasks 16 and 17. The boards tag R3 to `agent-stage-inputs-outputs` and R4–R5 to a `provider-model-catalog` change; Mitch's planning brief put R3–R5 together in this new change instead, because they share the step rows, the settings contract and the sealing of the session's input.

## Current behavior and evidence

Checked at `67eed1d7` on `interactive-app`:

- **Models are free text with a suggestion list.** `AGENT_MODEL_SUGGESTIONS` (`contracts/src/agents.ts`) lists Claude `sonnet`, `opus`, `haiku` and Codex `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-luna`. `ModelPicker` (`frontend/src/components/settings/agents/ModelPicker.tsx`) groups them by provider, disables an off provider's group and offers a typed exact ID per provider once it passes the model ID check. The settings contract carries models as plain strings and the server checks them on save (`checkAgentSettings`, `^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$`); the sealed `AgentSelection` has its own pattern with the same characters and 128-character limit, and the frontend uses the save's. All three reject `[` wherever they apply: enabled providers' default models, explicit step choices and sealed selections (a disabled provider's default is checked only for length and storage).
- **No effort anywhere.** `AgentSelection` (`contracts/src/agent-selection.ts`) is `{provider, authentication, model}` with no other properties. Claude sessions run `--model` without `--effort` (`agents/session/session-adapters.ts`, `runClaudeSession`). Codex sessions send `turn/start {threadId, input}` with no model or effort (`runCodexSession`).
- **The settings that reach a session are sealed at queue time.** `prepareSessionAttempt` (`processing/session-attempts.ts`) reads the settings, resolves the step's selection (`agents/resolve-selection.ts`) and seals it with the settings revision, the web setting and the Part description style into a `bench-intake-input/6` manifest (`processing/session-input.ts`). The style is rendered into the opening message as operator guidance, kept out of the profile instructions and their digest (`openingText` in `agents/session/session-runner.ts`); a later save doesn't change a queued or running attempt (processing-agent-sessions "Part description style delivered to sessions").
- **Batch instructions are not sealed.** They are `capture_instruction` rows, delivered to every live session of the batch as `instruction` inbox items when saved and to each new session when its job or attempt is created (`agents/instructions.ts`). Migration `0030_instruction_inbox.sql` binds each `instruction` item to a saved `capture_instruction` of the batch. "Instructions for every new batch" (`new_batch_instructions`, up to 8,192 characters) is copied into a new batch once.
- **The steps.** Settings have four steps, `examine`, `research`, `images` and `inventory` (`AGENT_SETTINGS_STAGES`). `agent-stage-inputs-outputs` (BI-022) replaces Inventory with the app's Match step, which has no agent.
- **The CLIs already answer catalogue requests without a turn.** The Claude session admission already sends `control_request {subtype: "initialize"}` before any user text (`agents/session/claude-session-admission.ts`) and reads only the version and configuration from the reply. Feasibility checks made for the boards, with no paid calls, found:
  - Claude, subscription: the `initialize` reply's `models[]` gives `value`, `resolvedModel`, `displayName`, `supportsEffort` and `supportedEffortLevels` (the Agent SDK's `supportedModels()`). Effort is passed with `--effort low|medium|high|xhigh|max` (`claude --help`, 2.1.332).
  - Claude, API key: `GET /v1/models` gives `display_name` and `capabilities.effort`. It must never be called with the subscription token.
  - Codex, ChatGPT sign-in: app-server `model/list` gives `displayName`, `hidden`, `isDefault`, `defaultReasoningEffort` and `supportedReasoningEfforts`. Effort goes in `turn/start`'s `effort`.
  - Codex, API key: `model/list` returns only the catalogue built into that Codex version. OpenAI `GET /v1/models` gives IDs only, enough to mark which models the key can use.
- **Pinned versions differ from the checked ones.** The guest pins Claude Code 2.1.319 and Codex 0.166.0 (`tooling/deployment/guest/package.json`), and admission requires exactly those. The feasibility checks used 2.1.331–2.1.332 and 0.170.0. Whether the pinned versions return the same fields and accept `--effort` and `turn/start.effort` is not yet confirmed (task 2.1 and task 3.1).
- **Provider status is the nearest precedent for a guest read.** `GET /api/v1/agents/provider-status` asks the session worker over PostgreSQL `NOTIFY`, and the worker asks each guest credential process over a status connection with a 4,096-byte frame (polish task 12). A model list doesn't fit that frame, and PostgreSQL's `NOTIFY` payload is limited to about 8,000 bytes, so the list needs a table.

## Scope and non-goals

In scope:

- Optional per-step instructions for Examine, Research and Images: stored with the agent settings, 1,000 characters each, edited with Save and Discard; sealed into each attempt's input as operator guidance, kept out of the profile instructions and their digest, in today's opening message and, once BI-022's sealed brief exists, in its own brief section.
- A model catalogue per provider and sign-in mode, read by the session worker (on the host, or in the guest VM for shared-VM profiles) from the pinned CLI or the provider's models API, stored in a table with its read time and CLI version, refreshed on a schedule and on demand, with a built-in fallback.
- A sealed `effort` on the step and provider settings and on `AgentSelection`, passed as Claude's `--effort` and Codex's `turn/start` `effort`.
- The Settings › Agents model pickers listing the catalogue, an Effort select beside each picker, and the catalogue's states; the Processing step header warning while a step uses a model no longer offered.

Non-goals:

- **Instructions for Inventory or Match.** Inventory is being replaced by Match, which runs no agent (the board shows three steps).
- **Changing the pinned CLI versions.** If a pinned version lacks a field this change needs, the task stops and asks Mitch; a version bump needs its own requalification.
- **Delivering step instruction edits to running sessions.** A saved edit applies to work queued after it, as the other settings do (see the design).
- **Per-batch model or effort choices**, and changes to "Instructions for every new batch".
- **The one-turn `/1` runner** (`agents/claude.ts`, `agents/codex.ts`, `native-agent/1`): its inputs never seal effort.

## Reuse and dependency assessment

| Option and relevant version | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence and date checked | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| Read the catalogue from the pinned CLIs already in the guest image: Claude Code `initialize` and Codex app-server `model/list` | Lists exactly what turns will run, per sign-in, including effort levels; no new dependency; the session code already speaks both protocols | Needs a reader process in the guest and a larger frame than the status read; the pinned versions' fields aren't confirmed | `claude-session-admission.ts` (initialize already sent), `session-adapters.ts` (app-server JSON-RPC); feasibility checks on 2026-11-25 with Claude Code 2.1.331 and Codex 0.170.0 | The pinned 2.1.319 and 0.166.0 reply shapes (tasks 2.1, 3.1); whether Claude's `initialize` needs the network |
| The provider HTTP models APIs (`GET /v1/models`) for every mode | Simple HTTP; Anthropic's gives effort per model | Needs an API key: Claude's must never be called with the subscription token, and OpenAI's gives IDs only, no names or effort; a subscription has no key | Anthropic and OpenAI models API references, checked 2026-11-25 | None for the API-key modes, where it is used |
| `@anthropic-ai/claude-agent-sdk` `supportedModels()` | The same list through a typed API | A second Claude runtime beside the pinned CLI the guest admits; it spawns the CLI anyway | Agent SDK reference, checked 2026-11-25 | Not pursued |
| Keep a shipped list, updated by hand | No reads | Out of date as soon as a provider ships a model; it is what Mitch asked to replace | `AGENT_MODEL_SUGGESTIONS` | Kept only as the never-read fallback |

**Recommendation:** read from the pinned CLIs for subscriptions, and from the models APIs only for API keys (Claude's names and effort; OpenAI's to mark which built-in Codex models the key can use). No new package. Per-step instructions and effort reuse the existing settings save, sealing and opening paths, following the Part description style's precedent.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `app-settings`: added requirements for step instructions, the provider model lists and their states, a saved model no longer offered, and the Effort select. "One searchable model picker" and "Model picker limits and exact IDs", which `polish-ui-styling-and-loading` adds and which are not yet synced, are left as they are; the new requirements add to them.
- `processing-agent-sessions`: step instructions sealed into each attempt and given as operator guidance; the sealed effort passed to the provider.
- `shared-vm-execution`: the guest reads each provider's model list without a provider turn.
- `processing-workspace`: the step header warns while a step uses a model its provider no longer offers.

## Impact and dependencies

- **Contracts:** `AgentSelection` gains an optional `effort`; the agent settings gain `effort` per step, `default_effort` per provider and `stage_instructions`; a model catalogue DTO and route; `AGENT_MODEL_SUGGESTIONS` becomes the built-in catalogue. `bench-intake-input/6` gains an optional sealed `stage_instructions` field; BI-022's `/7` brief gains an operator guidance entry. Older inputs decode unchanged.
- **Intake server:** settings columns and validation; sealing; the session adapters passing effort; a catalogue table, reader, refresh schedule and API.
- **Guest VM:** a catalogue read in each provider's management service, reached over a catalogue connection of its own beside the status connection. The guest validates the sealed input, so the guest image ships with the contract change, as every `/6` field has.
- **Frontend:** `ModelPicker`, `StepModels`, `ProviderCard`, a new Effort select and step instruction editor in Settings › Agents, a catalogue query, and the Processing step header.
- **Coordination with BI-022 (`agent-stage-inputs-outputs`):** its PR-A (#275, "give every session a sealed brief") is in review. This change doesn't edit BI-022's change files. The step instructions PR waits for #275 to merge and then adds the guidance both to the `/6` opening and to the `/7` brief of the attempts #275 seals; BI-022's later provider-backed `/7` profile and multi-lot groups carry the same field from the settings they seal (see the design, "Where step instructions reach the agent").
- **Migrations:** each PR that needs one takes the next free number when it is written (BI-022's #275 takes `0039`).
- **Live checks:** reading the catalogue against the real providers, and a real session run with an effort, need Mitch's go-ahead (task 6).

## Open decisions and assumptions

Decided by Mitch on 2026-11-25 (boards FixStepInstructions, FixModelEffort, FixModelCatalogStates and SettingsAgentsProposal, canvas v108, approved as drawn):

- The per-step instruction limit is 1,000 characters; the count turns amber from 900, typing stops at 1,000, and a paste is cut there with a message.
- A saved model that is no longer offered stays selected with a warning, and sessions still try it.
- Codex with an API key uses the built-in catalogue of its Codex version, with the models the key can use marked from OpenAI's `/v1/models`.
- Older Claude 4.x models are listed under a collapsed "Older models" group.
- An effort of Default sends no effort, so the CLI default applies.

Assumptions (recorded, not asked):

- The catalogue refreshes on worker start, on a sign-in change, on a CLI version change, on "Check again", and every 12 hours; a failed read is retried after 5 minutes.
- An "older" Claude model is one whose major version is 4 or lower, as approved, or below the newest major version in Claude's list, so models stay grouped as later versions ship. Codex lists its models in `model/list` order, leaving out hidden ones, with no older group.
- A model ID the catalogue gives with characters the model ID check rejects (such as Claude's `opus[1m]`) is folded into its resolved model, or left out when it has none.
- Step instructions are offered for Examine, Research and Images only, as the board draws; Inventory keeps its model and effort but no instructions while it exists.
