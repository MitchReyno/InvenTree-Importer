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
- **Rejected:** one profile id per stage (`shared-vm-agent/4-examine` …). The worker is paired to one profile (`session-runner.ts:499-507`), and the config allow-list is one profile per worker, so per-stage profiles would need four paired workers or a pairing redesign.
- **Rejected:** keeping per-stage text in the unsealed opening. It isn't digest-bound, and these rules are authority.

### Briefs are built at queue time and sealed

- `queueJob` and the lead input builder assemble the brief from retained state into `bench-intake-input/7`.
- `read_lot` and `read_batch` rebuild the same view at call time with its current revision.
- The opening renders the sealed brief within 48 KiB, and summarises past it.
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
- **Questions:** `processing_question` gains an owner kind (`session` or `app`) and a nullable attempt. Match questions use BI-019's stepped question contract, and answers go through a Match answer route that records the decision and queues stages.
- **Queueing:** Match queues Research and Images with their modes, replacing `onLeadIdentity`'s direct queueing. A paused identify-mode session gets a `match` inbox item.
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
- **Rejected:**
  - Python in the decoder (a second runtime);
  - scripts in the VM as the output route (no provenance).

### Re-steering and delivery

- `revision/2` items carry typed `changes` and a `source`.
- Every revision sender fills them: `currentness.ts`, `stable-identity.ts`, the correction and answer paths, and Match.
- Operator observation corrections now send Examine a revision and wake it.
- `ask`'s duplicate check matches subject and overlapping fields across open and answered questions, unless `new_evidence` names evidence not cited before.
- Delivered evidence is tracked durably through BI-019's `photo_view` outbox items.

### Outputs into records and approval

- Confirmed proposed values become the capture spec through the existing human edit path. Confirming is the operator's act.
- Match decisions set the lot's target, and approval effects gain:
  - an existing-Part target;
  - the Part image (`create_part`);
  - stock attachments;
  - update effects restricted to gaps-mode fields.
- Validation before approval runs as a preparation gate.

## State, authority and failure behavior

| Concern | Handling |
| --- | --- |
| InvenTree unreachable during Match | The match state reads "couldn't search"; stages don't start; Check again retries |
| Search result changes after a decision | Pass 3 blocks approval until the operator decides again |
| Amendment conflicts with Examine or a human value | Not merged; a question settles it |
| A paused identify session whose decision skips research | The session is closed as finished; its identity amendment stays |
| Tool results too large | Previews and montages are sized to the frame and image limits from BI-018 |
| Earlier profiles | No briefs, no Match; they run as before and stay readable |

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

- Migrations add the profile, the stage instructions, `processing_match`, the question owner kind, and the new outbox and inbox kinds.
- Rollout is forward-only: an older build can't read `/7` inputs or typed proposals. Before rolling back, let new attempts settle or cancel them. This is recorded in each PR body.
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
