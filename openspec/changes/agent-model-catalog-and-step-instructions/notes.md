# Implementation notes

The plan for exact provider models, an effort choice and instructions for each step, delivered as PR-A to PR-F after the plan PR (#278). PR-A, effort in the settings, the sealed selection and both CLIs, is the first implementation PR.

## Changes to the plan

- **2026-11-25T18:30+11:00, planning:** the plan PR's six read-only review rounds (GPT-6.2 Sol) reshaped the catalogue's sign-in handling (a guest-owned generation, a conditional publish and a `stale_sign_in` state), added task 7 / PR-F for multi-lot groups, and moved `sent_effort` to a dispatch report. Round 6's three findings were fixed without a further round; the PR description lists them.
- **2026-11-26, PR-A:** one migration, `0042_agent_effort.sql`, adds both `agent_provider_settings.default_effort` (task 1) and `agent_session.sent_effort` (task 2), since both ship in PR-A.
- **2026-11-26, PR-A:** the effort's shape is checked by the contract (`AgentEffort`) and a column `CHECK`, so a bad effort is refused as `invalid_contract` before `checkAgentSettings`, not as `invalid_agent_settings`. The design said "checked only for shape on save", which this keeps; only the error code differs from the model ID's.
- **2026-11-26, PR-A:** the `/4` input's schema takes `OneTurnAgentSelection`, which has no `effort`, as well as `nativeInputManifest` dropping it, so a one-turn input can't carry one even if a caller forgot to strip it.

## Unexpected challenges

- **2026-11-26, PR-A, task 2.1:** Codex 0.166.0 describes `TurnStartParams.effort` as overriding "the reasoning effort for this turn and subsequent turns". This does no harm here: a session resumes only its own attempt's thread (`agent_session.native_session_id` belongs to the attempt), and every turn of an attempt sends the same sealed effort or none, so no turn inherits another attempt's override.

## Decisions made during implementation

- **2026-11-26, PR-A:** `default_effort` is optional in the settings DTO (absent is Default) rather than a required nullable field, matching the step's optional `effort` and keeping clients that send the whole settings object valid; the column is nullable. `sent_effort` appears in the session history attempt only, absent while none was sent; the session list and header reads are unchanged.
- **2026-11-26, PR-A:** Claude's effort counts as dispatched once the opening is written to a process started with `--effort`, which comes before its `init`; Codex's once the `turn/start` carrying it is written, after `onStarted`. In the shared VM the guest reports it in a `sentEffort` frame, and the coordinator refuses any value other than the sealed one.
- **2026-11-25T15:02+11:00, planning:** step instruction edits reach only work queued after the save, not running sessions. BI-022's implementing session suggested delivering an edit as an `instruction` inbox item; that kind is bound to a batch's saved `capture_instruction`, settings are global so one edit would wake finished sessions in every batch, and the approved board keeps running sessions on their text. Recorded as an open item for Mitch.

## Open items

- **2026-11-25T15:02+11:00, task 5:** PR-D waits for BI-022's PR-A (#275, sealed briefs) to merge, then adds the `/6` field and the `/7` brief entry together for the attempts #275 seals. BI-022's provider-backed `/7` profile (PR-G1/G2) and multi-lot groups (PR-I) carry `step_guidance` from the settings snapshot they seal the selection from; task 7 (PR-F) captures the text on each queued lot and keeps groups consistent once BI-022's PR-I merges. BI-022's PR-G2 activation should follow PR-F; asked of BI-022's implementing session and listed for Mitch.
- **2026-11-25T15:02+11:00, task 6:** the live catalogue read and the two effort sessions need Mitch's go-ahead.
- **2026-11-25T15:02+11:00, planning:** whether a step instruction edit should also reach running sessions, as a new inbox kind that doesn't wake finished sessions, is Mitch's call; not planned.
- **2026-11-26, PR-A, until PR-C:** the current Settings page saves a step's choice as `{provider, model}`, so changing a step's model in the UI drops that step's saved effort; a provider card's change keeps its `default_effort`. Effort is set through the API until PR-C's Effort select.
