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

### Briefs are built when the input is sealed

- Examine's input is sealed when its job is queued, as today. A `/7` Research or Images lot job is queued as a ready lot with its pinned identity revision and mode but no attempt; its group's input, with the brief, is sealed at claim (see multi-lot sessions).
- The lead input builder and the group claim assemble the brief from retained state into `bench-intake-input/7`.
- `read_lot` and `read_batch` serve two views: with the sealed revision, the pages of the brief the session started from; without it, the current view and its revision. Tests cover an edit between queueing and the first page read.
- The opening renders the sealed brief within 48 KiB, and summarises past it.
- The sealed manifest stays within the existing 240 KiB retained-input cap (`processing/limits.ts:2`). What doesn't fit goes to an immutable, bounded page store, `processing_input_page`, written with the input; the manifest seals each page's id and digest, so the sealed view never reads mutable capture data. A brief larger than the page store's bound is refused with `processing_input_capacity`, as today. Tests cover an edit to a field held only in a page.
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
- **Ordering:** search is a remote read, so it never runs in the transaction that triggers it (today `onLeadIdentity` runs inside the proposal transaction, `handlers.ts:1051`). The trigger commits a search request with the next per-lot search generation, naming the identity revision and keys; the search runs after commit; its result settles only if its generation is still the lot's latest, and the verdict, question or decision, and queueing commit together. An older result is discarded. The generation advances when the request commits, not when it settles, so answers, claims and new approvals check it under the lot's match lock: while a newer search is pending, an answer to the older question is refused and no stage is queued or claimed from it. Tests cover two searches on the same identity settling in reverse order, and an answer and an approval arriving before the newer search settles. Batch answers and pass 3 follow the same rule.
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
- **Parity** is measured on the rendered crop pixels, before labels, downscaling or delivery encoding. `preview_images` and approval share that render; the montage is checked separately to depict it.
- **Rejected:**
  - Python in the decoder (a second runtime);
  - scripts in the VM as the output route (no provenance).

### Worker, guest and pairing for `shared-vm-agent/4`

- The VM profile ids are hard-coded beyond policy and admission: worker pairing and driver selection (`agents/session/session-worker-main.ts:42,128-129`), the coordinator's tool-worker choice (`agents/shared-vm/coordinator.ts:120-128,244-245`), and the guest and tool-worker manifest checks (`agents/shared-vm/guest-turn.ts:100-109`, `tool-worker.ts:32`).
- Task 7 extends each of them to `/4`, with the worker image and deployment changes, a paired `/4` turn test, and a test that retained `/3` attempts drain on a `/3` worker.
- Until then, PR-A to PR-F exercise the new behaviour through `synthetic-session/1`, which takes the new contracts from PR-A; its process tests are the activation path.

### Multi-lot sessions (Mitch's decision)

- **Model:** jobs stay per lot. An attempt binds 1 to N lot jobs through a new membership table, `processing_attempt_lot(attempt_id, job_id, state)`. Today the schema ties an attempt to one job: the current-attempt key (`migrations/0006_processing.sql:49-50`), questions and answers (`:94`, `:109`), and the session, inbox, answer trigger and cursor (`migrations/0018_agent_session_runtime.sql:45,90,109,121`). Task 9 owns that schema change: the attempt keeps its first lot's job as an anchor for legacy constraints; each lot job's current pointer, questions and answers reference its membership; and the session, inbox and cursor key on the group's lineage id, with each item naming its lot. Legacy ids and one-job lineages are unchanged. A PG test answers a question for a non-anchor lot and moves that lot while a peer keeps running.
- **Mode:** the group's stage and mode are claim-time properties. A lot's mode may then change inside the group: an identify lot's `match` item gives it full or gaps mode, or closes it when Research is skipped, while its peers stay in identify mode. Tests cover an identify group whose lots get different decisions.
- **Which identity changes release a lot:** changes the group's own session didn't make: Examine republishing the identity, an operator correction or regroup, or another session's amendment. The session's own amendment, and the merge and Match search it triggers, keep the lot in the group.
- **Claim:** under a per-batch-and-stage lock, so two claimers can't take the same lot, the claim takes up to the sealed cap of ready lot jobs of one stage and mode, oldest first, that Match allows: no Match wait, the current search generation, not superseded or stale. It stops adding lots before the group's combined media would pass the media input limits (`MEDIA_INPUT_MAX_VERSIONS`, 64, `contracts/src/media.ts:401`); a single lot over them fails as today. In one transaction it seals the group's `/7` input, overflow pages and media pins and creates the attempt, session and memberships; the slot is then taken as today. Lots that become ready later go to a new session. Tests cover two claimers racing and a group whose combined evidence passes 64 versions.
- **Caps:** `research_lots_per_session` (default 5) and `images_lots_per_session` (default 8), integers 1–20, in the agent settings contract and Settings › Agents › Sessions, sealed per attempt as `settings-debug-mode` seals its settings. A cap of 1 reproduces one-lot sessions.
- **Brief:** a shared section, then one section per lot, each with an equal share of the 48 KiB budget and the rest in the page store. `read_lot(lot_id)` refuses lots outside the group.
- **Outputs:** typed proposals name their lot; `subject_id` must be an active member. Release records stay per attempt, but a citation also needs the cited evidence to be in the proposal lot's scope, as the handler's lot checks do today (`agents/tools/handlers.ts:674-759`). Examine keeps its batch-wide authority to propose for a live lot. Tests cover a cross-lot citation refused, evidence genuinely shared by two lots, and a proposal after a lot's release.
- **Waits:** Match waits stay per lot. The session works on its other lots while one waits, and is parked, holding no slot, only when all its lots wait or are done. A lot's `match` item resumes that lot.
- **Inbox:** today one high-water cursor per lineage acknowledges everything up to a sequence (`agents/tools/inbox.ts:208-245`), and any unread item wakes the session (`session-execution.ts:112-145`). So lot items carry their lot and are acknowledged per lot, in a per-lot cursor beside the lineage cursor for batch-wide items. Wake-up counts only unread items of lots that aren't held. A released lot's pending items move with it to its next session. Tests cover a held lot's chat at sequence 10 and a runnable lot's answer at 11, and an all-held group staying parked without a slot.
- **Routing:** revisions, `match` items and answers for a lot go to the lineage holding it. A lot whose identity changes after the claim is released: its partial work is stale, it is requeued as its own job, and the session gets a `revision/2`.
- **Failure:** a session failure requeues each incomplete lot individually. Start fresh on one lot moves it to a new session. A session holds one slot whatever its lot count.
- **UI:** session rows and pages list the lots served; lot status comes from lot jobs. BI-019's one-subject session rows and drawer are adapted in this change's PRs, after BI-019 PR-G's session-level read, retries, Start fresh eligibility and slot totals. A test checks that one group gives one row and one slot in the totals.
- **Rejected:** adding lots to a running session (breaks the sealed input); one job per group (loses per-lot state, decisions and staleness).

### Re-steering and delivery

- `revision/2` items carry typed `changes` and a `source`.
- Every revision sender fills them: `currentness.ts`, `stable-identity.ts`, the correction and answer paths, and Match.
- Operator observation corrections now send Examine a revision and wake it.
- `ask`'s duplicate check matches subject and overlapping fields across open and answered questions, unless `new_evidence` names evidence not cited before.
- Delivered evidence is tracked durably through BI-019's `photo_view` outbox items. A view records a fetch prepared for response, which may have been withheld, so the component that hands the image to the provider records its release as an outbox item bound to the attempt and view. The native adapter records it after the MCP response write. On the VM path the guest relay stages the image and then writes the response (`agents/shared-vm/native-turn.ts:69-79`), so it acknowledges only after the image-bearing response write succeeds, through the authenticated turn channel, correlated by the forwarded request id with the attempt and view; the coordinator records release on that acknowledgement. The synthetic driver calls the tools over MCP HTTP and keeps only `structuredContent` today (`session-runner.ts:826-845`), so it records release only after inspecting a successful result that carries the image. A citation is admitted only for a released view on the current attempt; a missing or uncertain release isn't admitted, and the session can fetch again. Tests cover a withheld reply, guest staging that fails after the view commits, a response write that fails after staging succeeds, and a view from an older attempt.

### Outputs into records and approval

- Confirmed proposed values become the capture spec through the existing human edit path. Confirming is the operator's act.
- Match decisions set the lot's target, and approval effects gain:
  - an existing-Part target;
  - the Part image, on a created or an existing Part;
  - stock attachments;
  - update effects restricted to gaps-mode fields.
- These need new execution authority: `create_part` is a JSON create with no image (`execution/effects/effects-body.ts:68-76`), and `inventory/transport.ts` has no Part update. The Part image and the gaps fill are new effect kinds in a new plan version, each gated by the target's declared capability. A gaps fill carries the value it expects to be missing; the executor re-reads the field just before the update and refuses it as a conflict when it is no longer empty. InvenTree has no conditional update, so a competing write between the read and the update can still be overwritten. This narrower guarantee is stated with the effect, and Mitch accepted it on 2026-11-23: the effects stay enabled. The Part image on an existing Part has the same expected-empty guard: a re-read before the upload, a conflict if an image exists, and the same documented race. Retained plans of the earlier version still execute, and uncertain effects follow the existing no-blind-replay rules; PR-F tests them against the owned fake.
- Validation before approval runs as a preparation gate. A preparation records, for every lot, the search generation of the successful pass 3 it was built from. Approval checks each under the same lot locks that request searches, and refuses when a newer search has been requested, settled or not, or when the validation read failed. Approval's own idempotency is per command and binding (`review/approve-preparation.ts:64-75`), not a uniqueness guarantee in InvenTree.

## State, authority and failure behavior

| Concern | Handling |
| --- | --- |
| InvenTree unreachable during Match | The match state reads "couldn't search"; stages don't start; Check again retries |
| Search result changes after a decision | Pass 3 blocks approval until the operator decides again |
| Amendment conflicts with Examine or a human value | Not merged; a question settles it |
| A paused identify session whose decision skips research | The session is closed as finished; its identity amendment stays |
| Tool results too large | Previews and montages are sized to the frame and image limits from BI-018 |
| A session fails holding several lots | Each incomplete lot is requeued individually; finished lots keep their proposals |
| A lot's identity changes after claim | That lot is released and requeued; the session is told, and keeps its other lots |
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
- **Multi-lot sessions (PG and process):** grouping by stage, mode and cap; the cap from sealed settings; per-lot pause in identify mode; release and requeue on an identity change; per-lot retry after a failure; `read_lot` scope.
- **Frontend:** the Match step, the match question, the Images review, Review confirmation, the brief entry, the lots on session rows and pages, and the two settings.
- **Live:** a requalification on Claude and Codex with Mitch's go-ahead. It covers an exact match decided before research, a house-numbered item identified then matched, and Images producing a Part image.

## Migration, rollout and recovery

- Migrations add the profile, the stage instructions, `processing_match`, the match question store, and the new outbox and inbox kinds.
- **Pipeline version by lineage:** from PR-A, the first PR that writes `/7`, a batch follows its Examine lead's sealed input version. Stable-identity queueing, Start and replacement read it from the lead instead of process config (`processing/stable-identity.ts:145-169`), and PR-A carries the retained-synthetic regression. A `/7` lead uses briefs and Match; an earlier lead keeps the Inventory pipeline. Every queueing entry point (the lead's queueing, Start and replacement) takes the lead's version, so a retained `synthetic-session/1` `/6` lead never queues `/7` successors. A process test in PR-A covers a retained synthetic lead receiving new evidence.
- **Upgrading a lead:** replacement today accepts only failed, cancelled, interrupted, unavailable or login-waiting sessions (`processing/session-replacement.ts:19-25`), so a drained lead that `finished` can't be started fresh. Task 7 adds an upgrade action, server and UI, that replaces a finished or idle earlier-profile lead with a `/7` attempt, keeping its history and pending evidence. It also supersedes the batch's queued or waiting earlier-version successors, which would otherwise wait for an old-profile worker (`session-runner.ts:497-507`), and requeues their lots through Match; finished ones stay readable.
- **Cutover (Mitch accepted these steps on 2026-11-23):** an actor's supervisor holds an actor-wide lock (`agents/worker.ts`), so `/3` and `/4` workers can't drain the same actor at once. Drain `/3` work, or pause its batches, before switching the actor's profile. The new behaviour is keyed on the sealed input version `/7`, so retained `synthetic-session/1` `/6` inputs keep today's behaviour. New evidence reaches a batch's existing Examine lineage whatever its profile (`processing/examine-trigger.ts:143-171`), so a batch with an earlier-profile lead says so, and the upgrade action replaces the lead with a `/4` attempt. A process test covers a batch with a retained lead across the cutover.
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
