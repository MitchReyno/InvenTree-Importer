# Implementation notes

The [planning PR](https://github.com/MitchReyno/InvenTree-Importer/pull/131) is merged into interactive-app. Confinement [PR-A](https://github.com/MitchReyno/InvenTree-Importer/pull/133) is merged; correctable tool results [PR-B](https://github.com/MitchReyno/InvenTree-Importer/pull/134) are ready for integration. No live inference has run.

## Changes to the plan

- **2026-11-07T17:30+11:00, task 1:** The user approved version-pinned offline full-surface qualification, strict effective-configuration checks for each turn and runtime rejection, replacing per-request subscription tool inspection. Proposal, design, delta and task 2 now state the assurance limit. The continuation remains in this change.

## Unexpected challenges

- **2026-11-07T17:24+11:00, task 1:** The generated experimental app-server protocol exposes MCP status and configuration but no identified complete model-facing tool-list method. Capturing the outgoing request at a loopback model stub establishes offline behavior, not inspection of the actual subscription turn before inference. The subsequent user-approved assurance model resolves this design choice; it does not establish live qualification.

## Decisions made during implementation

- **2026-11-07T17:24+11:00, task 1:** Prefer disabling code mode as the candidate: the installed Codex 0.166.0 called intake status directly on fresh and resumed offline turns with only intake and the four accepted exceptions exposed. Explicitly enabling code mode restored exec and wait. The direct-only namespace candidate retained exec and wait, so it cannot independently satisfy confinement. These observations use the archived loopback harness and fake credentials, not live subscription qualification.

## Open items

- Retained failure details and integrated qualification remain pending.
- Live provider qualification still needs explicit authorization. Keep native_unverified.

- **2026-11-07T17:39+11:00, task 1:** Adding skills.include_instructions=false alongside disabled code mode removed the planted skill marker on fresh and resumed clean conversations. A private HOME alone did not remove the ancestor-discovered marker. The supported candidate therefore uses both explicit controls rather than relocating authentication storage.
- **2026-11-07T17:39+11:00, task 1:** The upgrade probe started a conversation with the planted catalogue, then disabled skill instructions before resume. The marker remained in the resumed model request. Existing provider conversations need an explicit compatibility decision; recommended: require a fresh conversation under the admission policy while preserving application history and pending inbox items. The user subsequently approved requiring a fresh provider conversation while preserving application history and pending input; no production behavior has been changed.

- **2026-11-07T18:02:31+11:00, tasks 1–2:** Completed the corrected omit-tools comparison and fresh/resume skill probes. Claude 2.1.319's non-bare request includes DeferredToolPlaceholder outside its init list; an explicit synthetic call returns no-such-tool and reveals no additional tool. The maintained probes now capture that metadata and accept deliberate tool-call overrides. Disabled slash commands plus the direct intake allowlist is the selected Claude candidate. All observations used loopback endpoints and fake credentials.
- **2026-11-07T18:02:31+11:00, task 2:** Chose a private per-job admission marker bound to policy/provider/authentication/conversation. Explicit replacement is a revision-checked API command for both lead and lot sessions; it retains the existing lineage and inbox cursor and refuses a held physical slot. The API role cannot lock agent_session for update, so replacement uses the common lane/job/attempt locks and reads session state under that serialization; no new database privilege is added.

- **2026-11-07T18:13:03+11:00, task 2:** Found that Claude's ordinary system/init frame requires the initial user message, so it is insufficient as a pre-inference configuration gate. Its control initialize and mcp_status requests work before user input; admission now checks those responses and waits boundedly for connected MCP tools before sending text. Later init metadata remains defense in depth. The continuation design is expanded in this same change.

- **2026-11-07T18:19:57+11:00, task 2 review:** Independent review identified that explicit replacement dropped a successor's pinned identity proposal IDs. A regression using the actual lot pipeline reproduced the empty pin set. Replacement now decodes the prior sealed input, retains its pins and refuses a stale identity; the new attempt still undergoes claim-time currentness checks.
## Decisions made during implementation

- **2026-11-07T18:26:23+11:00, task 3:** Reuse the compiled Ajv validators and copy their issues immediately. Public paths contain only schema-owned field names and array indexes, with fixed rule descriptions and an aggregate 2 KiB limit. Existing validate callers retain invalid_contract behavior.
- **2026-11-07T18:26:23+11:00, task 4:** Return the existing media-version source shape only with successful byte delivery. Preview/crop fetches obtain the original version digest from a batch/evidence-scoped read; preview and crop hashes do not become citation digests. Recheck the capability after preview generation before granting delivery.

## Changes to the plan

- **2026-11-07T18:28:13+11:00, task 4:** Wrong preview digests were already refused by proposal authorization. Preserve that behavior as characterization rather than claiming a new fix. The missing source reference is the defect addressed by this slice; the task wording now distinguishes the two.
