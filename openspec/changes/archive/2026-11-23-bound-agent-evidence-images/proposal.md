# Change proposal

## Problem and intended outcome

An agent session can be sent an evidence image the provider refuses, and when that happens the operator learns nothing about why. On 2026-11-22 Mitch's Examine session `f1836b8e` (Claude, `claude-opus-5-5`, subscription, VM) failed with `agent_turn_failed` seconds after it posted "Reading batch and fetching evidence photos". Its batch holds 6144 × 8160 originals. The retained diagnostic has the code and stage only.

The intended outcome:

- Every image the session tool server returns to an agent fits the providers' image limits, at the most detail the model can use.
- A failed provider turn records the provider's own error kind as a fixed code, so the next failure like this names its cause.

## Change identity and linked items

- Change: `bound-agent-evidence-images`.
- BI-018, a new Fixes item in `docs/PLANNED_FUNCTIONALITY.md`. Related: BI-017 (`simplify-vm-agent-web-and-setup`), whose requalification exposed the problem.

## Current behavior and evidence

`fetch_evidence` (`intake-server/src/agents/tools/handlers.ts`) has two paths, and neither bounds pixel dimensions:

| Path | Who uses it | What the agent gets |
| --- | --- | --- |
| Original delivery | Lot sessions (Research, Images, Inventory) fetching a manifest version without a page or region | The original upload's bytes, unchanged, if they fit the 8 MiB per-run budget |
| Preview delivery | Examine, and any page or region request | A whole page resized to 768 px long edge, or a region cut from the full-resolution decoded preview and returned unscaled as PNG |

The provider limits, from [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision), checked 2026-11-22:

- At most 8000 × 8000 px per image.
- When a request holds more than 20 images, at most 3000 px on either side for every image in it.
- At most 10 MB per image, measured on the base64 encoding, on the Claude API.
- Claude processes at most 2,576 px on the long edge (its high-resolution tier) and downscales anything larger, so pixels beyond that are never seen.

So a lot session fetching a 6144 × 8160 original sends an image the API refuses outright. An Examine region crop of most of such a page is several thousand pixels across, and is refused once the conversation holds more than 20 images. Whether session `f1836b8e` hit one of these limits is an unverified assumption: nothing retained says which error Claude returned.

The failure record (`intake-server/src/agents/failure-model.ts`) keeps allowlisted codes only, by design. The provider's own error kind is discarded:

- **Claude Code 2.1.319** marks an assistant message with an `error` kind from a fixed list (`authentication_failed`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `unknown` and a few account states). It ends with a `result` whose `subtype` is `success`, `error_during_execution` or `error_max_turns`. These were read from the CLI binary in the runner image.
- **codex-cli 0.166.0** reports a failed turn's `TurnError.codexErrorInfo`: a fixed string (`contextWindowExceeded`, `usageLimitExceeded`, `rateLimitExceeded`, `serverOverloaded`, `badRequest`, …) or a one-key object such as `httpConnectionFailed`, which carries an optional HTTP status. This was read from `codex app-server generate-json-schema`.

For VM sessions the provider runs in the guest. The guest's final frame carries only an outcome string, such as `{ failure: 'agent_turn_failed' }`.

## Scope and non-goals

In scope:

- Bound every image `fetch_evidence` returns, on both paths and for host and VM sessions, to a 2,576 px long edge.
- Report the delivered image's dimensions and scale so the agent can map positions back to the page.
- Keep citations, source SHA-256 and region coordinates in their existing spaces.
- Stop sending raw original uploads to agents. Lot sessions get the decoded preview, bounded, like Examine, so untrusted originals stay inside the decoder boundary.
- Record the provider's error kind, plus Claude's result subtype and any HTTP status, as allowlisted fields of the session failure. Carry them across the guest's final frame, and show them in the diagnostic panel.

Non-goals:

- The Claude Files API. Claude Code on a subscription sends tool-result images inline, the Files API needs an API key, and `file_id` isn't documented inside `tool_result`.
- Provider message text, prompts or payloads in diagnostics. They stay excluded.
- A provider error for a turn settled from the guest journal after a lost connection. The journal stores the outcome string only.
- Changing the 768 px Examine overview size or the 8 MiB per-run budget.
- Re-running session `f1836b8e`. That is Mitch's call once this ships.

## Reuse and dependency assessment

`sharp` 0.35.5 is already the intake server's image library: the Examine 768 px resize and `regionCropCache` use it. Bounding is one more `resize({ fit: 'inside', withoutEnlargement: true })` on images it already decodes. No new dependency is relevant.

| Option | Goal fit and strengths | Limitations and cost | Evidence (2026-11-22) | Unknowns |
| --- | --- | --- | --- | --- |
| Resize with the existing `sharp` in the tool server | Covers host and VM sessions in one place; reuses the decoded preview and crop code | A resize per whole-page fetch, already done for the 768 px overview | `handlers.ts`, `media/region-crops.ts`, `intake-server/package.json` | Encoding size at 2,576 px; measured in tests |
| Claude Files API (`file_id`) | Avoids inline base64 | Not reachable from Claude Code subscription sessions; needs an API key; `file_id` in `tool_result` undocumented; the pixel limits still apply | [Files API](https://platform.claude.com/docs/en/build-with-claude/files), [vision](https://platform.claude.com/docs/en/build-with-claude/vision) | None needed; rejected |
| Resize in the guest (`stageEvidence`) | Leaves host traffic unchanged | Host-run sessions stay unbounded; decodes images in the guest; two code paths | `shared-vm/stage-evidence.ts` | Rejected |

The tool server owns the bound, so every runtime gets the same images. Error kinds come from the providers' own structured fields; no text matching is needed, and none is added.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `processing-agent-sessions`:
  - delivered images are bounded and say how they were scaled;
  - citations stay on the original version;
  - failure diagnostics gain the provider's error kind.
- `shared-vm-execution`: the guest's staged file is the delivered image, and the guest reports the provider error kind with a failed turn.

## Impact and dependencies

- **Intake server:**
  - `agents/tools/handlers.ts`: both `fetch_evidence` paths;
  - `agents/failure-model.ts` and the session adapters: provider error capture;
  - `agents/shared-vm/` `native-outcome.ts`, `guest-turn.ts`, `coordinator.ts` and `stage-evidence.ts`.
- **Contracts:** `SessionToolResult` fetch metadata gains the delivered image's size and scale. `SessionFailure` gains an optional `provider_error`.
- **Frontend:** the failure debug panel shows the provider error.
- **Compatibility:** retained diagnostics without `provider_error` stay valid. An older guest without the new frame field still settles as before. Admission is unaffected.
- **Live check:** a VM session fetching a 6144 × 8160 original succeeds, and a deliberately failing turn shows its provider error. This needs Mitch's go-ahead for provider use.

## Open decisions and assumptions

- **Encoding:** an unscaled image tries PNG, anything else JPEG at falling quality, all within a 1.25 MiB cap per image (see the design).
- **Assumption:** 2,576 px is the useful maximum for current Claude models, from the vision docs' high-resolution tier. Codex models get the same bound.
- **Decision (Mitch, 2026-11-22):** fix by bounding images rather than the Files API; plan as an OpenSpec change; implementation authorized.
