# Design assessment

## Context and grounding

[docs/agent-sessions.md](../../../docs/agent-sessions.md) is the full reference for this change.

- **Part 1** documents today's code at `9db1921e`: inputs, outputs, hand-offs, re-steering, the state and event maps, and 14 gaps.
- **Part 2** is the target this change delivers: stage contracts, the Match step, the identity layering, the MCP tools, the instruction packs, and outputs into records.

This design records the decisions and the order of work, and doesn't repeat the contracts.

The complexity is high. The change touches every session's input and output, adds an app pipeline step (Match) with app-owned questions, extends the media decoder, adds a profile, and changes how Review, Records and approval use agent output.

## Goals and constraints

- **Goals:** those of the [proposal](proposal.md) and the deltas in `specs/`.
- **Constraints:**
  - Sealed inputs and pinned profiles stay immutable. A new instruction text needs a new profile row, digest, CHECK combination, contract literal and config entry.
  - Admission compares exact tool sets and forbids skills, so new tools join a new tool profile.
  - The untrusted-data rule holds: notes, images, documents and web content are data, never instructions.
  - Retained attempts of earlier profiles stay readable. New formats are forward-only.
  - InvenTree is read only through the app's read credential. Writes go only through approval.

## Decisions and alternatives

### Per-stage instruction text: a stage pack table, not one profile per stage

- `shared-vm-agent/4`'s profile row holds the shared base instructions.
- Each stage's pack is in a new immutable table `processing_stage_instructions(profile_id, stage, bytes, digest)`.
- The session input seals `stage_instructions_sha256`, and the claim checks it as it checks the profile digest today.
- The system prompt is the base followed by the stage pack.
- **Rejected:** one profile id per stage (`shared-vm-agent/4-examine` …). The worker is paired to one profile (`session-runner.ts:499-507`), and the config allow-list is one profile per worker, so per-stage profiles would need a paired worker per stage or a pairing redesign.
- **Rejected:** keeping per-stage text in the unsealed opening. It isn't digest-bound, and these rules are authority.

### Briefs are built at queue time and sealed

- `queueJob` and the lead input builder assemble the brief from retained state into `bench-intake-input/7`.
- `read_lot` and `read_batch` serve two views: with the sealed revision, the pages of the brief the session started from; without it, the current view and its revision. Tests cover an edit between queueing and the first page read.
- The opening renders the sealed brief within 48 KiB, and summarises past it.
- The sealed manifest stays within the existing 240 KiB retained-input cap (`processing/limits.ts:2`), keeping references and counts for what doesn't fit; a batch whose references alone exceed it is refused with `processing_input_capacity`, as today.
- **Rejected:** building the brief at turn time. That breaks the sealed-input guarantee.

### Typed outputs replace the generic proposal for new work

- New proposal schemas: `examine-identity/1`, `research-identity/1`, `research/1` and `images/1`.
- The `propose` handler checks the kind against the principal's stage and mode, and the field allow-list per kind. `propose_images` is a separate tool so its recipe arguments are typed.
- Records read each field from its owning kind.
- `/5` proposals stay readable, and their values keep showing as attributions.
- **Rejected:** a generic shape with a stage field allow-list. Consumers would still parse one union, and Mitch chose typed outputs.

### Match is an app module with app-owned questions

- **Module:** `intake-server/src/processing/match/`, with three parts:
  - key extraction from the merged identity and match notes;
  - search over the InvenTree read credential (`intake-server/src/inventory/`) and this app's unapproved lots;
  - verdicts, sufficiency, decisions and pass-3 validation.
- **State:** per-lot match state in a `processing_match` table (keys, candidates with reasons, verdict, decision, modes, revision).
- **Questions:** a separate store, `processing_match_question` and its answer. `processing_question` can't hold them: it requires a job, attempt, input and message, its answer requires a continuation attempt (`migrations/0006_processing.sql:81-100`), and `processing/read.ts:248-262` reads through inner joins to all of them, while the match question exists before any lot job. Match questions use BI-019's stepped question contract and are pinned to the match revision and the candidate set they quote. Answers go through a Match answer route that records the decision and queues stages; an answer to a stale question is refused. Needs you reads both stores. Tests cover Needs you before any lot job exists and after a search makes a question stale.
- **Ordering:** search is a remote read, so it never runs in the transaction that triggers it (today `onLeadIdentity` runs inside the proposal transaction, `handlers.ts:1051`). The trigger commits a search request with the next per-lot search generation, naming the identity revision and keys; the search runs after commit; its result settles only if its generation is still the lot's latest, and the verdict, question or decision, and queueing commit together. An older result is discarded, and a settled generation supersedes questions from older ones. Tests cover two searches on the same identity settling in reverse order. Batch answers and pass 3 follow the same rule.
- **Queueing:** Match queues Research and Images with their modes, replacing `onLeadIdentity`'s direct queueing for the new profiles.
- **Waits:** `processing_match` persists which of the lot's stages wait for Match, because `waiting_input` holds only while the job has its own open question and any inbox item resumes it (`session-runner.ts:770-790`, `session-execution.ts:112-145`). Claim, resume, Start and replacement check the wait. A paused identify-mode session, or one held by a late candidate, stays parked with unrelated inbox items pending, until a `match` inbox item delivers its mode. A running session told of a late candidate stops at the end of its turn. A resumed session keeps its sealed brief; the `match` item that ends its wait names the merged identity revision and mode, and its later proposals rely on that revision. Today the pin is checked only before the first turn (`session-runner.ts:524-529`), so the wait check also compares the identity revision at each resume, and a change after the decision searches again and keeps the wait. Tests cover a second identity change between the decision and the resume. Proposals published under a mode the decision changes are marked stale. Tests cover a late candidate while Images runs and an unrelated inbox item arriving while Research waits.
- **Rejected:**
  - an Inventory agent with a search tool (unrecorded search, a session per lot);
  - asking through an agent (it costs a session to relay an app decision).

### Identity layering

- The lot's identity is a merged view over Examine's base proposal and Research's amendments, built by the app. Each field records its source proposal.
- Changing it bumps an identity revision, which successors pin instead of a single proposal id. `pinnedIdentityCurrent` checks the revision.
- For agent-made, unedited lots, the merge proposes the label and draft Part fields through the capture edit path, as the lead's own lot edits do. Edited lots get suggestions.
- A replacing amendment (a different part) isn't merged. It opens a question.

### Image work in the media decoder, in TypeScript

- The decoder is TypeScript on `sharp` 0.35.5 and `@napi-rs/canvas` 1.1.0 (`media-decoder/package.json`). The skills' Python scripts are reimplemented there:
  - **recipe `/2` rendering:** crop, quarter turns, affine straightening at most 15° with a corner guard, and white balance, contrast, gamma and sharpening that keep hue;
  - **the grid overlay:** canvas text over a `sharp` rendition;
  - **the montage:** `sharp` composite;
  - **the logo matcher:** Otsu thresholding, both polarities, 48×48 normalised correlation with aspect weighting, on raw buffers.
- **Parity tests:** each port is tested against outputs from the original scripts on fixtures.
- **The logo set** (6.9 MB, private use approved) is bundled with the decoder image.
- **The intake MCP tools** call the decoder through the existing dispatcher, so the decoder role stays restricted.
- **Delivery:** on the VM relay only `fetch_evidence` gets the larger image envelope and has its replies staged (`agents/shared-vm/evidence-request.ts`, `native-turn.ts`). The relay is extended to the new image tools with one aggregate per-run image budget, and montage and logo-sheet replies are tested over the real relay.
- **Parity** is measured on the rendered crop pixels, before labels, downscaling or delivery encoding.
- **Rejected:**
  - Python in the decoder (a second runtime);
  - scripts in the VM as the output route (no provenance).

### Worker, guest and pairing for `shared-vm-agent/4`

- The VM profile ids are hard-coded beyond policy and admission: worker pairing and driver selection (`agents/session/session-worker-main.ts:42,128-129`), the coordinator's tool-worker choice (`agents/shared-vm/coordinator.ts:120-128,244-245`), and the guest and tool-worker manifest checks (`agents/shared-vm/guest-turn.ts:100-109`, `tool-worker.ts:32`).
- Task 7 extends each of them to `/4`, with the worker image and deployment changes, a paired `/4` turn test, and a test that retained `/3` attempts drain on a `/3` worker.
- Until then, PR-A to PR-F exercise the new behaviour through `synthetic-session/1`, which takes the new contracts from PR-A; its process tests are the activation path.

### Re-steering and delivery

- `revision/2` items carry typed `changes` and a `source`.
- Every revision sender fills them: `currentness.ts`, `stable-identity.ts`, the correction and answer paths, and Match.
- Operator observation corrections now send Examine a revision and wake it.
- `ask`'s duplicate check matches subject and overlapping fields across open and answered questions, unless `new_evidence` names evidence not cited before.
- Delivered evidence is tracked durably through BI-019's `photo_view` outbox items. A view records a fetch prepared for response, which may have been withheld, so the component that hands the image to the provider records its release as an outbox item bound to the attempt and view: the VM relay after guest staging and the response write, the native adapter after the MCP response write. A citation is admitted only for a released view on the current attempt; a missing or uncertain release isn't admitted, and the session can fetch again. Tests cover a withheld reply, guest staging that fails after the view commits, and a view from an older attempt.

### Outputs into records and approval

- Confirmed proposed values become the capture spec through the existing human edit path. Confirming is the operator's act.
- Match decisions set the lot's target, and approval effects gain:
  - an existing-Part target;
  - the Part image, on a created or an existing Part;
  - stock attachments;
  - update effects restricted to gaps-mode fields.
- These need new execution authority: `create_part` is a JSON create with no image (`execution/effects/effects-body.ts:68-76`), and `inventory/transport.ts` has no Part update. The Part image and the gaps fill are new effect kinds in a new plan version, each gated by the target's declared capability. A gaps fill carries the value it expects to be missing; the executor re-reads the field just before the update and refuses it as a conflict when it is no longer empty. InvenTree has no conditional update, so a competing write between the read and the update can still be overwritten. This narrower guarantee is stated with the effect. Retained plans of the earlier version still execute, and uncertain effects follow the existing no-blind-replay rules; PR-F tests them against the owned fake.
- Validation before approval runs as a preparation gate. A preparation records the pass-3 result it was built from, and approval refuses one older than the lot's latest match revision. Approval's own idempotency is per command and binding (`review/approve-preparation.ts:64-75`), not a uniqueness guarantee in InvenTree.

## State, authority and failure behavior

| Concern | Handling |
| --- | --- |
| InvenTree unreachable during Match | The match state reads "couldn't search"; stages don't start; Check again retries |
| Search result changes after a decision | Pass 3 blocks approval until the operator decides again |
| Amendment conflicts with Examine or a human value | Not merged; a question settles it |
| A paused identify session whose decision skips research | The session is closed as finished; its identity amendment stays |
| Tool results too large | Previews and montages are sized to the frame and image limits from BI-018 |
| Earlier profiles (`native-agent/2`, `shared-vm-agent/1` and `/3`) | No briefs, no Match; they keep the Inventory pipeline, run as before and stay readable |

## Verification strategy

- **Contracts:** the input `/7`, the brief, the typed proposals, recipe `/2`, `revision/2`, the match records and the tool schemas.
- **Intake PG tier:**
  - brief assembly and budget;
  - stage and mode boundaries;
  - the duplicate-question check;
  - revision changes from every sender;
  - Match search against a fake InvenTree read model: verdicts, sufficiency, questions, modes, late matches, pass 3;
  - the identity merge and the label proposal;
  - effects for images and gaps.
- **Media decoder:** parity tests for each port against the scripts' outputs on fixtures, including the hue-preservation check on resistor bands.
- **Process tier:** a fake session per stage running through briefs and tools; an identify-then-match flow end to end.
- **Frontend:** the Match step, the match question, the Images review, Review confirmation and the brief entry.
- **Live:** a requalification on Claude and Codex with Mitch's go-ahead. It covers an exact match decided before research, a house-numbered item identified then matched, and Images producing a Part image.

## Migration, rollout and recovery

- Migrations add the profile, the stage instructions, `processing_match`, the match question store, and the new outbox and inbox kinds.
- **Cutover:** an actor's supervisor holds an actor-wide lock (`agents/worker.ts`), so `/3` and `/4` workers can't drain the same actor at once. Drain `/3` work, or pause its batches, before switching the actor's profile. The new behaviour is keyed on the sealed input version `/7`, so retained `synthetic-session/1` `/6` inputs keep today's behaviour. New evidence reaches a batch's existing Examine lineage whatever its profile (`processing/examine-trigger.ts:143-171`), so a batch with an earlier-profile lead says so, and Start fresh replaces the lead with a `/4` attempt. A process test covers a batch with a retained lead across the cutover.
- Rollout is forward-only. Settling or cancelling attempts leaves `/7` inputs and typed proposals retained, which older readers such as `session-input.ts` reject. The last safe rollback point is before the first such write; after it, recovery is a fix forward, as BI-019 adopted. The new build reads every earlier format. Each PR body says so.
- The default profile change from `synthetic-research/2` to `synthetic-session/1` affects dev setups without `INTAKE_PROCESSING_PROFILE`. It is called out in the README.

## Risks and open decisions

- **Search quality decides Match's value.** MPN normalisation and alias search need tuning on real data. The early passes and pass 3 limit the cost of a miss.
- **Instruction quality decides the stages' value.** The live requalification is a sample, not a guarantee.
- **Open questions** (doc 2.10):
  - the light bounds;
  - vocabulary paging;
  - the search strategy;
  - caching and how long a decision stays valid;
  - an auto-accept setting.
