# Design assessment

## Context and grounding

The change touches four boundaries, each with an existing pattern to follow:

| Boundary | Today (checked at `67eed1d7`) | Pattern followed |
| --- | --- | --- |
| Agent settings | `agent_settings` (with `stage_selections` jsonb and the text settings) and `agent_provider_settings` (`enabled`, `authentication`, `default_model`) in `agents/schema.ts`; `saveAgentSettings` with the revision check and save receipts (`agents/settings.ts`); `checkAgentSettings` applies the model ID check | Add fields beside the existing ones, validated in `checkAgentSettings`, saved through the same receipts |
| Sealed session input | `prepareSessionAttempt` resolves the selection and seals `agent`, `settings_revision`, `web` and `part_description_style` into `bench-intake-input/6` (`processing/session-input.ts`); `openingText` renders the style as operator guidance outside the profile digest | The Part description style's precedent, for step instructions and effort |
| Provider sessions | `runClaudeSession` and `runCodexSession` (`agents/session/session-adapters.ts`) take the sealed `selection`; the guest runs the same driver (`agents/shared-vm/native-turn.ts`) after validating the manifest (`guest-turn.ts`) | Pass the sealed effort to the same adapters |
| Guest reads | Provider status: a status-only endpoint in each guest credential process, a status connection per provider through the relay, the coordinator's read with deadlines, and an API ↔ worker request over `NOTIFY` (`agents/provider-status*.ts`, `agents/shared-vm/credential-status.ts`, `coordinator.ts`) | The same pairing, relay and deadline rules, on a connection of its own, with a table instead of `NOTIFY` for the result |

`agent-stage-inputs-outputs` (BI-022) is being implemented at the same time. Its PR-A (#275) adds `bench-intake-input/7` and a sealed brief with `batch`, `human`, `asked`, `evidence` and `match` sections (`contracts/src/brief.ts` in that PR); operator-sourced entries carry `source: 'human'`. Its stage instruction packs go in an immutable `processing_stage_instructions` table, whose digest the input seals and the claim checks. Nothing in this change edits BI-022's files.

**Complexity:** medium to high. The settings and effort parts are small extensions of existing paths. The catalogue is a new read in the guest, a table and a refresh schedule. The proof of fit against the pinned CLI versions is the main unknown.

## Goals and constraints

- **Goals:** those of the [proposal](proposal.md) and the deltas in `specs/` (app-settings, processing-agent-sessions, shared-vm-execution, processing-workspace).
- **Constraints:**
  - Sealed inputs stay immutable, and profile and stage instruction digests are unchanged by anything the operator saves.
  - The untrusted-data rule holds: operator guidance is data the session follows after the app's own rules, never authority to widen tools or skip validation.
  - The subscription token is never sent to a models API; no catalogue read sends a user message or starts a paid turn.
  - Retained `/6` and `/7` inputs without the new fields keep running as they do.
  - The pinned CLI versions (Claude Code 2.1.319, Codex 0.166.0) are what admission allows; this change doesn't move them.

## Decisions and alternatives

### Settings fields

- **Step effort:** `stage_selections.<stage>` becomes `{provider, model, effort?}`. A step on Default has no entry, as today, and uses the provider's default effort.
- **Provider default effort:** `agent_provider_settings.default_effort`, nullable. Null is Default.
- **Step instructions:** `agent_settings.stage_instructions` jsonb, `{examine?, research?, images?}`, each 1–1,000 Unicode code points (the frontend counts code points, as `InstructionsForm` does). An empty box removes the key. Inventory has no entry; a save carrying one is refused.
- **Effort values:** provider-defined strings, checked only for shape on save (`^[a-z][a-z0-9_-]{0,31}$`), never against the catalogue, which may be stale or unread. The contract names the type `AgentEffort`.
- **Saving:** effort autosaves with the model it sits beside (the O8 rule for choices); step instructions are text with Save and Discard, one form per step so editing one step's text doesn't hold another's. Both go through `saveAgentSettings`, its revision check and receipts.
- **Migrations:** PR-A's adds `default_effort` (the `stage_selections` jsonb needs no column change; its shape is checked in `checkAgentSettings`). PR-D's adds `stage_instructions` with its grant. Each takes the next free number when it is written.

### Effort is sealed with the selection and passed to the CLI

- `AgentSelection` gains an optional `effort` (`AgentEffort`). `resolveSelection` returns the step's own effort with its own model, or the provider's `default_effort` with its `default_model`, so the sealed selection is always one consistent pair. Absent means Default.
- `/6` inputs seal it inside `agent`. #275's `/7` seals `agent: null` (synthetic only), so it carries no effort; BI-022's provider-backed `/7` profile seals an `AgentSelection`, so it carries the effort with no further work here. The `/1` one-turn path (`processing/attempts.ts`, `native-agent/1`) strips it, so `bench-intake-input/4` never carries it.
- **Claude:** `runClaudeSession` adds `--effort <level>` after `--model` on every fresh and resumed turn when the sealed selection has one.
- **Codex:** `runCodexSession` adds `effort` to every `turn/start`. `turn/steer` carries none; it continues the turn.
- **Record:** the session row keeps the effort the adapter dispatched (`sent_effort`, beside the resolved model it already keeps). The adapter reports it only once dispatched: for Claude when the opening is written to a process started with `--effort` (after admission, before `init`), for Codex when a `turn/start` carrying it was written, which comes after `onStarted` today. On the VM route the guest forwards the report in its turn frames, as it forwards the session ID and model through the coordinator. A turn that fails before dispatch records none. Neither pinned CLI reports the effort it applied (Codex's `Turn` has no effort field), so the effective effort stays the provider's to honour.
- **Admission:** the effort changes no tool, permission or MCP configuration, so admission's checks are unchanged; `admissionIdentity` stays as it is.
- **Proof of fit (task 2.1):** the pinned Claude Code 2.1.319 must accept `--effort` and Codex 0.166.0's `TurnStartParams` must have `effort`, checked offline (`claude --help` from the pinned package; `codex app-server generate-json-schema`). If either lacks it, task 2 stops and asks Mitch; moving a pin is a separate change with its own requalification.
- **Rejected:** sending effort through Codex `thread/start` config (`-c model_reasoning_effort`). It fixes the effort at thread creation, so a resumed thread couldn't take the sealed value, and `turn/start` is the documented place.

### Where step instructions reach the agent

The coordination with BI-022 follows the two constraints its implementing session asked for on 2026-11-25:

1. **Separate from the stage packs.** Step instructions are operator settings. They are never stored in `processing_stage_instructions`, which holds immutable, profile-owned packs, and never counted in `stage_instructions_sha256` or the profile's instruction digest.
2. **Sealed with the input, like other input.** They are sealed from the same settings snapshot, and at the same moment, as the attempt's model selection and `settings_revision`: at queue time for every input this change writes, so the existing rule holds that a save reaches only sessions queued after it. A later edit never changes a sealed attempt.

How they appear:

- **`/6` (today's inputs):** an optional `stage_instructions` string (1–1,000 characters) in the manifest, set only for the attempt's own stage. `openingText` adds it as `stage_instructions`, with one sentence in the instructions: it is the operator's guidance for this step, to follow after the app's rules. This is exactly the Part description style's path.
- **`/7` (BI-022's brief):** a `step_guidance` entry, `{kind: 'step_guidance', source: 'human', stage, text}`, in the brief's `human` section, which BI-022 renders as operator-sourced material weighed above agent findings. It is shown under its own heading, "Operator guidance for this step". The `/7` manifest seals the same text, so the brief and the manifest agree.
- **Ordering:** the step instructions PR (PR-D) waits for BI-022's PR-A (#275) to merge, then adds the `/6` field and the `/7` brief entry together, for the attempts #275 seals: the Examine lead and single-lot attempts, through `processing/session-attempts.ts`. #275's `/7` exists only for `synthetic-session/1`, with `agent` and `settings_revision` null, so PR-D seals the text into `/7` from the settings read at the same queueing. By the time PR-D was built, BI-022's #294 had added the stage profile `shared-vm-agent/4`, which seals `/7` with a provider selection read from the settings, so PR-D tests `/7` step instructions through `/4` (`synthetic-session/1` reads no settings and seals none; see `notes.md`). While BI-022 keeps `/7` behind its test-only switch (until its PR-G2), production sessions use the `/6` path.
- **Later BI-022 work:** its provider-backed `/7` profile (PR-G1/G2) changes only the sealed `agent` and `settings_revision`; PR-D's builder already seals the step text at queue time, so it carries over, and the effort comes with `AgentSelection`. Multi-lot groups (BI-022 PR-I) seal one input at claim from several unclaimed lots, so the text must be captured when each lot is queued: task 7 adds that capture on the queued lot and a grouping rule, that a group takes only lots queued with the same step text, so a session never mixes guidance from either side of an edit. Task 7 waits for BI-022's PR-I and is tested there with a lot queued under A, an edit to B, a second lot queued, and a claim. BI-022's activation of `/7` (its PR-G2) should therefore follow task 7 whenever its PR-I has merged; that ordering is asked of BI-022's implementing session, recorded in `notes.md` and listed for Mitch, since this change can't edit BI-022's plan. If #275 were abandoned, PR-D ships the `/6` path alone and the `/7` entry moves to whichever change adds a brief.
- **How an edit reaches running sessions:** it doesn't. A saved edit applies to work queued after it; running, waiting and queued attempts, and their resumed turns, keep the text their work was queued with. This is what the board draws ("running sessions keep the text they started with") and what every other agent setting does (app-settings "Agent settings section": values apply only to sessions queued after the save).
- **Rejected: delivering an edit as an `instruction` inbox item**, as BI-022's session suggested. It doesn't fit the code or the approved design:
  - `instruction` items are bound by migration `0030_instruction_inbox.sql`'s trigger to a saved `capture_instruction` row of the batch, and the opening tells the agent an instruction item is "the operator's saved instruction for the batch, or for one evidence group"; per-step guidance would need a new kind, a source table and new wording.
  - Settings are global, so one edit would fan out to every live session of that step in every batch, and the wake sweep resumes `waiting_input`, `finished` and `interrupted` sessions for an unread item (`agents/instructions.ts`), restarting finished work across all batches.
  - The board and the existing settings rule say running sessions keep their settings.
  - If Mitch later wants edits delivered, a new `step_guidance` inbox kind for sessions of that step in non-ended states, without waking finished ones, is the shape to plan; it is recorded as an open decision.
- **Rejected:** appending the text to the profile or stage instruction bytes. It would change a digest-verified authority with operator data.

### The model catalogue

**Who reads, and where.** The session worker owns the catalogue, as it owns the guest connection:

| Profile and sign-in | Read | Where |
| --- | --- | --- |
| Shared VM, Claude subscription | Pinned Claude CLI, `control_request {subtype: "initialize"}` only, then stdin closed; `models[]` | In the guest, with the credential injection and Anthropic-only egress a turn uses (`environment.ts`), started by the Claude management process |
| Shared VM, Codex ChatGPT | App-server `initialize`, then `model/list` (all pages), under the shared account lock turns take | In the guest's Codex management process, beside `CodexAccount`'s `account/read` |
| Claude API key | `GET https://api.anthropic.com/v1/models` with the key (paged) | Where that profile's API-key turns get their key: the host worker for host profiles; the guest's turn environment for shared VM |
| Codex API key | App-server `model/list` (the version's built-in catalogue), then `GET https://api.openai.com/v1/models` with the key to mark usable IDs | As above |
| Host profiles (`native-agent/2`) | The same requests, with the host CLI | The session worker on the host |

Task 3.1 confirms, before code, that the pinned 2.1.319 and 0.166.0 return these fields, whether Claude's `initialize` needs the network, and where each API-key route holds its key in the shared VM. A provider mode with no route to its key in the shared VM keeps the built-in list.

**Transport for the shared VM.** A catalogue connection kind of its own, greeting `bench-model-catalog/1`, one per provider, from the guest management process to the coordinator through the relay, with the status connection's pairing identity and relay mechanics. It answers one read at a time within 20 s (`CATALOG_READ_MS`), with a 64 KiB frame limit (`CATALOG_FRAME_BYTES`), and stops and reaps its reader process when the budget runs out or the connection closes. A guest that doesn't greet with it is `guest_outdated`.

- **Rejected:** reading through the status connection. Its 4 KiB frame and 1.8 s deadline are the status read's guarantees; a 20 s catalogue read would hold a connection status reads wait on.
- **Rejected:** reading during a session's admission, where Claude's `initialize` is already sent. It only covers Claude, only runs when a session runs, and couples a settings read to a turn.

**Storage.** `agent_model_catalog`, one row per scope (actor, target, target context), provider and authentication:

- `models` jsonb, `cli_version`, `source` (`cli` or `api`), `read_at` (the last successful read), and `attempted_at`, `failure` (a fixed code: `timeout`, `guest_outdated`, `vm_unreachable`, `signed_out`, `malformed`, `unavailable`) for the last attempt;
- `refresh_requested_at`, which the API sets and the worker clears, and `sign_in_generation` (of the stored list), `latest_generation` and `stale_sign_in` (see "Sign-in changes").

A failed read updates only the attempt fields, so the last good list and its `read_at` stay.

**Sign-in changes.** A list belongs to the sign-in it was read under, not only the mode:

- **Generation:** each guest management process owns a persisted, non-secret `sign_in_generation` that changes whenever its sign-in does: Claude's credential store revision (already kept with `credential_meta`), and a Codex counter the management container advances when it promotes a sign-in or logs out (the pinned `account/read` has no account ID to hash). API keys the worker holds use an HMAC of the key under a worker-held key, never the key. Host subscriptions, whose sign-in the host CLI keeps for itself (`environment.ts`), have no generation the worker can read: their lists get no sign-in fence and are refreshed by the schedule and Check again, a stated limit. Each answer carries the generation it was read under: a Codex read runs under the shared account lock turns take, and a Claude read is discarded in the guest when the generation changed during it.
- **The row's latest generation:** the row keeps `latest_generation`, the newest generation the worker has observed, `stale_sign_in` and `invalidation_seq`. The API changes the row only through one function, `request_model_catalog_refresh(scope, provider, invalidate)`, owned by the worker's role and the only thing the API role may execute on the table: it sets `refresh_requested_at`, and with `invalidate` sets `stale_sign_in` and increments `invalidation_seq` in the same statement. The sign-in dialogs call it with `invalidate` once the guest confirms a token saved or removed, or a ChatGPT sign-in completed or disconnected.
- **Outside the app's dialogs:** a sign-in change made through the guest's management service without the app's dialog (its CLI, or another client of the management listener) advances the generation all the same, and the worker's generation poll every 60 s (`CATALOG_GENERATION_POLL_MS`), a generation-only answer that starts no CLI, observes it; 60 s is the stated detection window. Changes that bypass the management service, such as editing the guest's files by hand, are outside what the generation can see.
- **Conditional publish:** before storing a list, the worker takes the current generation from the list's source (for a guest read, a generation-only answer from the guest; for a host API-key read, the HMAC of the key the worker holds now; a host subscription read has none and skips this check) and stores the list, in one transaction, only while the reply's generation equals both that answer and the row's `latest_generation`, and `invalidation_seq` is the value read when the read started; otherwise it discards the reply and reads again. A change committed in the guest before that check therefore never lets an old reply become current, and one committing just after it is followed by the dialog's invalidation (which comes after the guest's commit) or, outside the dialogs, by the next poll.
- **Stale state:** while `stale_sign_in` is set, including after a failed reread, the API answers `stale_sign_in` with the earlier list and its time, and Settings and Processing show no "Not offered" or "Not accepted" warning from it. Only a list published under the current generation clears it.
- **Clients:** the catalogue query, shared by Settings and Processing, refetches every 1 s while any provider is `reading` or `stale_sign_in` for up to 30 s, then every 30 s while either lasts, and otherwise every 60 s while mounted and on window focus, so an open view learns of a change and of the recovery without a reload. The app's query client turns focus refetching off (`queries/client.ts`), so this query sets `refetchOnWindowFocus` itself. A sign-in dialog reports its sign-in confirmed only after the API has acknowledged the `invalidate` refresh and it has marked that provider's cached list `stale_sign_in` in its own client (`setQueryData`), before the refetch it then starts, so the view that made the change never shows the old list as current even while that refetch is pending. If the API refuses the `invalidate` request, the dialog isn't held: it says the list may be out of date for up to a minute and the request isn't resent, since the guest's sign-in generation poll (60 s, the window for changes made outside the app) marks the list all the same once that sign-in method is in use; the worker polls only the saved method's list (Mitch's decision in PR-C). Other views converge at their next refresh: the idle refetch runs only while the tab is visible (`refetchIntervalInBackground` stays off), and a hidden tab refetches when it is focused again.
- **Rejected:** keying rows by account. It would keep lists for accounts no longer signed in, and the generation already tells the worker when a list stopped applying. The worker validates each answer against the contract before writing: at most 200 models, names up to 80 characters, at most 12 effort levels each, and the whole row within 64 KiB.

- **Rejected:** returning the list over `NOTIFY`. Its payload is limited to about 8,000 bytes.

**Normalisation (worker, before storing):**

- Each entry is `{id, name, older, default, efforts, default_effort, usable}`.
- **Claude CLI:** `id` is `resolvedModel` (else `value`); aliases resolving to the same ID fold into one entry, keeping `displayName` of the exact model; entries whose ID fails the model ID check, such as `opus[1m]`, are left out unless they resolve to a valid ID. `efforts` is `supportedEffortLevels` when `supportsEffort`, else empty. `default_effort` is null (Claude doesn't name it).
- **Claude API:** `id` and `display_name` without its "Claude " prefix; `efforts` from `capabilities.effort`.
- **Codex:** `hidden` models are left out; `name` is `displayName`; `default` is `isDefault`; `efforts` from `supportedReasoningEfforts`; `default_effort` from `defaultReasoningEffort`. With an API key, `usable` is whether `/v1/models` lists the ID; otherwise null.
- **Older:** a Claude model whose major version (parsed from its ID) is 4 or lower, as approved, or below the newest major version in the list. Codex has none.

**When it reads.** The worker reads a provider's row:

- on start, for each enabled provider's current authentication;
- when `refresh_requested_at` is set: by Check again on a provider card, by a sign-in dialog once it confirms a sign-in or a token's save or removal, and by a switch of a provider's authentication;
- when its generation poll finds a different sign-in;
- when a turn's admission reports a CLI version different from the row's `cli_version`;
- 12 hours after `read_at` (`CATALOG_MAX_AGE_MS`), and 5 minutes after a failed attempt (`CATALOG_RETRY_MS`).

The API writes `refresh_requested_at` and sends `NOTIFY bench_model_catalog` with no payload; the worker listens and also checks each supervisor pass, so a lost notification only delays the read. Reads are one at a time per provider.

**API.** `GET /api/v1/agents/models` returns, for each provider's current authentication, `{state, source, cli_version, read_at, attempted_at, failure, models}`, where `state` is `current`, `reading` (a refresh is requested or running), `failed` (with the last good list), `stale_sign_in` (the list is from an earlier sign-in; see above) or `never_read`; with `never_read` or no list, `models` is the built-in list, marked `builtin: true`. `POST /api/v1/agents/models/refresh {provider, invalidate?}` requests a read; `invalidate: true`, sent by the sign-in dialogs, also marks the list stale (see "Sign-in changes"). The read carries no key, token or account.

**Built-in list.** `BUILT_IN_MODEL_CATALOG` is added to the contracts in PR-B. PR-C retires `AGENT_MODEL_SUGGESTIONS`: `ModelPicker` reads the catalogue instead, and the two other readers, the server's defaults for unsaved settings and its first-save fallback (`agents/settings.ts`) and the frontend test helper (`frontend/src/test/agent-settings.ts`), take a `DEFAULT_MODEL_BEFORE_SAVE` constant holding today's first suggestion per provider, so their behaviour is unchanged. The list holds the exact IDs and names the pinned CLIs offered when task 3 is implemented, and no effort levels (Effort offers only Default for it). It is updated when the guest pins move.

### Pickers, Effort and states in Settings

- **`ModelPicker`** reads a `useModelCatalog` query beside `useProviderStatus` (`serverQueryKey(scope, 'model-catalog')`), refetching as "Sign-in changes" describes. Options show the name with the exact ID in mono; search matches either; Claude's older models sit in a collapsed "Older models" group; a saved model not in the list sits first in "Saved, not offered". The exact-ID option and the off-provider rule are unchanged.
- **Effort** is a styled native select (the dropdown guideline's short fixed list, O11) beside every picker: each step and each provider card's "Default model and effort". Its options come from the chosen model's `efforts`, with labels `low` Low, `medium` Medium, `high` High, `xhigh` Extra high, `max` Max and any other value capitalised. Default names `default_effort` when the list gives one. A model with no levels disables it. Picking a model that lacks the saved level sets Default and shows a one-line notice under the row, saved together in one autosave.
- **States** follow the board: "Reading <provider>'s models…" inside the list while `reading` with no list; an amber notice inside the list with the time of the shown list and Try again when `failed`; "Built-in list, may be out of date" for the built-in list; the card's line "13 models · read from Claude Code in the agent VM today 09:12", using the shared time format.
- **Processing:** the step page header shows the "Not offered" pill while the step's saved model isn't in a read list, linking to `#settings/agents/models`. It reads the same catalogue query.

## State, authority and failure behavior

| Case | Outcome |
| --- | --- |
| No list ever read, read running | "Reading…"; saved choice shown by ID; typed exact ID still accepted |
| No list ever read, read failed | Built-in list, marked; Effort only Default |
| Read failed after a good read | Last good list with its time, amber notice and Try again; no page banner |
| Sign-in changed, new read not in or failed | `stale_sign_in`: the earlier list, marked, with no not-offered warnings; an earlier read can't publish |
| Guest image older than this change | `guest_outdated`; last stored or built-in list |
| Saved model not in the read list | Stays selected; "Saved, not offered" group and warning; sessions still try it; Processing pill |
| Saved effort the model doesn't accept | Stays saved with a warning; sessions send it as saved |
| Effort Default | Nothing sent; the CLI's default applies |
| Step instructions edited | Work queued after the save gets the new text; work queued before keeps its own |
| Provider turned off | Unchanged: steps fall back to Default and say so; the default provider's model and effort apply |

**Authority:** the catalogue is display data. It never changes a saved setting or decides what a session may run; the provider's own answer does. The catalogue route is read-only for the browser apart from requesting a refresh, which reads nothing secret. Step instructions are operator data inside the sealed input, under the existing untrusted-data rules.

**Secrets:** a catalogue read uses the same credentials a turn uses, in the same place, and stores only model IDs, names and efforts. Failures store a fixed code, never provider text.

## Verification strategy

- **Contracts:** `AgentSelection` with and without `effort`; the settings update with effort and step instructions, including 1,000 and 1,001 code points and an Inventory key refused; the catalogue DTO's limits; `/6` decoding a retained manifest without the new fields.
- **Intake unit:** `resolveSelection` pairing model and effort; `openingText` with and without step instructions, and the profile digest unchanged; the Claude args and Codex `turn/start` with and without effort, through the real adapters against fake CLIs; catalogue normalisation from recorded reply fixtures of the pinned versions (folding, `[` IDs, hidden, older, API-key marking).
- **PG tier:** settings save and receipts with the new fields; the catalogue table (failure keeps the last list, refresh requests, the sign-in generation, its poll and the publication fence, the 12 h and 5 min schedule under a controlled clock); sealing at queue time for `/6` and for the `/7` attempts #275 seals; an edit after sealing leaving the attempt unchanged and sending no inbox item.
- **Process tier:** the catalogue connection through the real relay with a fake guest reader: a good read, an oversized frame, a timeout with the reader reaped, an outdated guest; the worker's start, notify and pass-driven reads.
- **Frontend:** picker groups, search by name or ID, the older and "Saved, not offered" groups, each state, the Effort select's options, Default naming, the reset notice, the disabled select, the step instruction editor's count, amber, paste cut and Save and Discard, and the Processing pill.
- **Live (Mitch's go-ahead, task 6):** a catalogue read of each signed-in provider in the real guest, starting no turn, and one short session per provider with a non-default effort, checking the CLI received it.

## Migration, rollout and recovery

- Migrations are additive: nullable columns and a new table, with grants for the API (read, and execute on the refresh function only) and the worker (write).
- The guest image changes in PR-B (the catalogue reader) and in PR-A and PR-D (the manifest it validates gains fields). `pnpm dev` rebuilds a stale runner image; the deployment README names the refresh.
- Forward-only: a manifest with `effort` or `stage_instructions` is rejected by an older guest or worker, as each earlier `/6` field was. Rolling back past a migration needs the backup taken before it.
- Without a catalogue read, everything works as today with the built-in list.

## Risks and open decisions

- **Pinned versions may lack a field.** If 2.1.319 or 0.166.0 lacks `--effort`, `turn/start.effort`, `models[]` effort levels or `model/list`, the affected task stops and asks Mitch whether to move the pin, which needs a requalification.
- **Claude's `initialize` might call the network.** If so, the read runs with the turn's Anthropic-only egress; it is still not a paid request, which task 3.1 confirms.
- **Open for Mitch, not blocking:** whether a step instruction edit should also reach running sessions as a new inbox kind (rejected for now; see "Where step instructions reach the agent").
- **Live checks** need Mitch's go-ahead (task 6).
