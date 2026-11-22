# Design assessment

## Context and grounding

Two independent fixes share one change because they come from one incident: a VM Examine session failed silently, seconds after it started fetching evidence. The proposal holds the evidence and the provider limits.

Affected boundaries:

| Boundary | Current code | Change |
| --- | --- | --- |
| Agent images | `agents/tools/handlers.ts` `fetch_evidence` and `previewFetchEvidence` | One bounded delivery path from the decoded preview (`fetchEvidenceImage`) |
| Tool result contract | `contracts/src/sessions.ts` `SessionToolResult` | Adds `delivered` |
| Guest staging | `agents/shared-vm/stage-evidence.ts` | Stages the delivered image, checked against `delivered.sha256` |
| Failure record | `agents/failure-model.ts`, `contracts/src/session-failures.ts` | Adds an optional `provider_error` |
| Provider adapters | `agents/session/session-adapters.ts` (Claude stream and Codex app-server) | Capture the structured error kind |
| Guest outcome | `shared-vm/native-outcome.ts`, `guest-turn.ts`, `coordinator.ts` | Final failure frame carries `provider_error` |
| Diagnostic panel | `frontend/src/components/agents/SessionFailureDetails.tsx` | Shows the provider error |

**Complexity:** moderate. It's conventional work along existing seams. The risk lies in the guest–host frame, whose old and new versions must interoperate, and in the citation rule (crop bytes are never the cited digest), which must survive the path merge.

## Goals and constraints

- Specs: `processing-agent-sessions` › Bounded agent evidence images, and Categorized failures with diagnostic disclosure; `shared-vm-execution` › Guest-staged evidence matches the delivered image, and Guest-reported provider error.
- Untrusted originals stay inside the decoder boundary (`media/region-crops.ts` header). The tool server never decodes an original upload.
- Citations keep naming the original version and its SHA-256 (Authoritative citations for fetched evidence).
- Diagnostics keep excluding provider text (Sensitive or cross-session diagnostics).

## Decisions and alternatives

### Bound at 2,576 px in the tool server

`LONG_EDGE_PX = 2576`, the Claude vision docs' high-resolution maximum. It is below the 3,000 px limit that applies once a request holds more than 20 images, and far below 8,000 px.

- **Rejected: Files API.** It is not reachable from Claude Code subscription sessions (see the proposal).
- **Rejected: a resize in the guest.** Host-run sessions would stay unbounded, and the guest would decode images.
- **Rejected: a lower bound such as 1,568 px.** It would throw away detail the high-resolution tier uses. Small text is better read through a region fetch anyway.

### One preview-based path for every delivery

Today's lot-session "original" branch is removed, and `fetch_evidence` always reads the decoded page preview.

- **Whole page:** Examine keeps its 768 px overview. Every other session gets the page bounded at 2,576 px.
- **Region:** cut from the full-resolution preview through the existing `regionCropCache` (its full-size PNG), then bounded in the handler. The crop cache and its keys are unchanged.

Rationale: the original branch sent undecoded uploads straight to providers, could send any pixel size, and duplicated authorization and budget code.

Accepted trade-off: a requested page without a decoded preview is refused as `validation_failed`, where a raw original used to be sent. Undecoded, encrypted and unsupported versions never reach `fetch_evidence`: a lot manifest refuses them as `media_not_ready`, and Examine leaves them out.

### Encoding and size cap

Every delivered image is at most `AGENT_IMAGE_MAX_BYTES` (1.25 MiB), so its base64 fits the smallest relay frame a tool reply crosses (about 2 MiB on the non-tool-worker path) and stays far under Claude's 10 MB. An unscaled image or the Examine overview tries PNG first; anything else, or a PNG over the cap, is JPEG at quality 90, 80, 70 then 60. An image that fits at no quality is returned as metadata only, like an exhausted budget.

### Result metadata

The result gains `delivered`, describing the image actually sent:

```ts
delivered: {
  page: number
  width: number
  height: number
  scale: number // delivered px per page-preview px, at most 1
  region?: { x: number; y: number; width: number; height: number }
  media_type: 'image/png' | 'image/jpeg'
  sha256: string
}
```

The rest of the result keeps its meaning: `pages` still lists page-preview sizes, regions stay in page-preview pixels, and `source` is still the original version. `stageEvidence` now always checks the staged bytes against `delivered.sha256`, so the special case for original deliveries goes away.

### Provider error as a separate optional object

`SessionFailure` gains an optional `provider_error`:

```ts
provider_error?: {
  kind: string // Claude assistant `error`, or Codex `codexErrorInfo` (the string, or the object's one key)
  result: string | null // Claude result subtype
  http_status: number | null // integer 100–599
}
```

`kind` comes from a fixed list per provider, which is the union of the values found in the CLIs, plus `unknown`. `result` comes from a fixed list: `error_during_execution`, `error_max_turns`, `success`. An unlisted value becomes `unknown` or `null`.

The adapter stores the last error kind it saw. When it throws `agent_turn_failed`, it attaches the error kind to the `NativeSessionError` as a new optional `providerError` property. `sessionFailure` validates and copies it.

- **Rejected: encoding the kind in the code** (`agent_turn_failed:invalid_request`). That would multiply codes and break the existing categories.
- **Rejected: matching message text.** The guidelines' patterns to avoid rule it out, and the providers give structured kinds.

### Guest frame

`nativeTurnOutcome` returns `{ outcome, providerError? }`. The journal still stores the outcome alone, so its exact-match parsing is unchanged. The final frame becomes `{ failure, provider_error? }`. The coordinator validates `provider_error` against the same lists before attaching it to the `NativeSessionError`.

Compatibility: an old guest sends no field. An old host drops the unknown key, because `msg.failure` is read by name. For staging, a guest updated before its host keeps the old rule when a reply has no `delivered`: the bytes must match the source digest, unless page sizes mark a preview cut.

## State, authority and failure behavior

- **Authorization and budget:** unchanged. The authorization and the `deliveredMedia` grant happen as in `previewFetchEvidence` today. The budget counts delivered bytes. A delivery over the remaining budget returns the metadata result without an image, as the preview path does now.
- **Concurrency:** none added. A crop cache write already uses a unique staging name and a rename.
- **Partial failure:**
  - If the resize throws, no image is sent, the budget is untouched and no delivery authority is granted, as with a failed byte read today.
  - If the guest's digest check fails, staging throws `invalid_evidence_file`, and the existing handling ends the tool call.
- **No data migration:** retained failures without `provider_error` stay valid, and the field is optional in the contract.

## Verification strategy

| Outcome | Check |
| --- | --- |
| Bound, scale, encoding and cap | `fetch_evidence` handler tests with a 3000 × 4000 synthetic preview (over the bound in the same 3:4 shape as the failing photos): whole page, a large region, a small region, a detailed region too large as PNG, an Examine overview. Each asserts the dimensions, scale, media type, `delivered.sha256`, the 1.25 MiB cap, and that `source` is the original. |
| No original bytes sent | Handler test: the fetch reads the preview blob and never the original upload's blob. |
| No preview | Handler test: refusal, and no `deliveredMedia` grant. |
| Guest staging | `stage-evidence` tests: a delivered digest match stages; a mismatch throws. |
| Claude and Codex error kinds | Adapter tests with the fake CLIs emitting `error: 'invalid_request'` plus `subtype: 'error_during_execution'`, and `codexErrorInfo` as a string and as an `httpConnectionFailed` object. Unlisted values become `unknown`. |
| Frame and settle | `native-outcome` and coordinator tests. Contract tests for `SessionFailure` with and without `provider_error`. |
| Panel | `SessionFailureDetails` test renders the provider error, and renders nothing for its absence. |
| Live | With Mitch's go-ahead: a VM lot session fetching a 6144 × 8160 original succeeds, and Mitch's Examine batch is retried. |

The PostgreSQL and process tiers run locally, because the handlers and session flow are covered there.

## Migration, rollout and recovery

The runner image must be rebuilt for the guest half to work. `pnpm dev` does that automatically through the runner's source digest. A host running against an older guest still bounds images, and simply gets no `provider_error`. Contract objects reject unknown fields, so code rolled back past this change would refuse retained diagnostics that carry `provider_error`. A rollback must keep the optional contract field, and revert only the behavior. Nothing touches inventory.

## Risks and open decisions

- **Codex's own image limits aren't documented** in the sources checked. 2,576 px is assumed to be safe for it.
- **The "no preview yet" refusal** may surprise a lot session that fetches just after an upload. The message already tells the agent to retry.
- None open for Mitch.
