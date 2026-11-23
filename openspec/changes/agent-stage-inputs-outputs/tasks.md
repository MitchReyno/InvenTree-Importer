# Implementation and delivery tasks

## Plan context

- **Plan:**
  - the [proposal](proposal.md) and [design](design.md);
  - the full reference, [docs/agent-sessions.md](../../../docs/agent-sessions.md);
  - deltas for `processing-stage-pipeline`, `processing-agent-sessions`, `processing-match` (new), `processing-workspace`, `capture-media`, `review-records` and `approval-preparation`.
- **Reuse:**
  - TypeScript ports of the skills' scripts on the decoder's existing `sharp` and `@napi-rs/canvas`;
  - the app's InvenTree read credential;
  - BI-019's stepped questions, history and session page.
- **Change name:** `agent-stage-inputs-outputs`. Branches are `feat/agent-stage-inputs-outputs-<suffix>`, and subjects are `type(agent-stage-inputs-outputs): …`.
- **Items:** BI-022.
- **Activation before the profile:** PR-A makes every queueing entry point follow the lead's sealed input version. PR-A to PR-F, PR-I and PR-G1 build and test the `/7` pipeline through a test-only fixture switch, because a complete `/7` flow needs typed output (PR-B), Match (PR-C), identify mode for weak-key lots (PR-D) and the pass-3 approval gate (PR-F). No configuration writes `/7` before PR-G2. PR-G2, which depends on all of them, makes `synthetic-session/1` and `shared-vm-agent/4` write `/7` for new leads. Earlier profiles keep today's pipeline.

## Completion and commit ordering

- Check a completed action in the same commit as its work.
- Review, publication, CI and merge actions stay unchecked until they happen.
- Never commit in a worktree while an intake test tier runs there.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Briefs, input `/7`, read tools and stage packs scaffold | Contracts, intake server, migration | BI-019 PR-D1 (`photo_view`) | agent-sessions "Sessions start from a sealed brief", "Session tool boundary" and "Stage tool sets" (read tools) |
| 2. Typed outputs, boundaries, revisions and no repeated questions | Contracts, intake server | 1; BI-019 PR-B and PR-D1 | agent-sessions "Typed stage outputs", "Human facts take precedence" (data), "Questions are not asked twice"; agent-sessions "Authoritative citations for fetched evidence" ("Released view after a restart"); pipeline "Revisions carry the change"; the design's citation admission over `photo_view` |
| 3. Match: search, verdicts, questions, modes and queueing | Intake server, migration, frontend | 2; BI-019 PR-B | processing-match "Deterministic search by strong keys", "Verdicts and sufficiency", "The match question", "Add stock needs an InvenTree Part", "Decisions set stage modes" ("Add stock"), "When Match searches" (its after-Examine and check-again triggers), "Match questions are pinned", "Match waits are recorded" ("Searches settle out of order"); pipeline "Examine stage and parallel successors", "Successors start on a stable identity" ("Parallel start", "Lot regrouped before successors start"), "Evidence-based currentness" (the decision and mode); workspace "Processing › Match", "Step page pattern" (the Match exception), "Inventory step page" (earlier-version batches only) |
| 4. Identify mode and identity amendments | Intake server | 3 | pipeline "Identify first when nothing can be searched", "Identity amendments update the lot", "Successors start on a stable identity" (identify-mode start); match "When Match searches" ("Alias found during research"), "Decisions set stage modes" (a paused identify session) |
| 5. Media decoder ports and recipe `/2` | Media decoder, contracts | None | capture-media "Media immutable derived crops"; the parity tests behind agent-sessions "Image and logo tools run in the app" |
| 10. Image tools and the Images review | Intake server, frontend | 2, 5 | agent-sessions "Image and logo tools run in the app", "Stage tool sets" (image tools); workspace "Images step shows proposed crops" |
| 6. Outputs into records and approval, and validation before approval | Intake server, frontend | 3, 4, 10 | review-records "Agent values are proposed until confirmed"; approval-preparation both requirements; match "Validation before approval", "Validation searches are preparation reads", "Approval checks the latest search" |
| 7. Profile scaffold, instruction packs and guides | Intake server, migration | 1 | agent-sessions "Human facts take precedence" (instructions), "Stage guides on demand" |
| 11. Activation, cutover and live requalification | Intake server, migration, live | 1–10; BI-019 PR-F | agent-sessions "Stage tool sets" (admission); the cutover and activation scenarios; live evidence |
| 8. The brief on the session page | Frontend | 1; BI-019 PR-E | workspace "The brief on the session page" |
| 9. Multi-lot Research and Images sessions | Contracts, intake server, migration, frontend | 3, 4, 10; BI-019 PR-E and PR-G | agent-sessions "Research and Images sessions serve lot groups", "Lots per session settings", "Per-lot handling inside a group", "Lots leave a group individually", "Proposals name their lot"; agent-sessions "Resume idle sessions for pending input" ("Chat for a held lot"); pipeline "Selective rework from answers and edits" (the `/7` group case) and "Evidence-based currentness" (the `/7` pins); workspace "Sessions show the lots they serve" |

## PR delivery map

| Bundle | Outcome | Tasks | Why this boundary | Prerequisites and order | Base, branch and subject | Gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-0 | This plan, the design doc and BI-022 | Planning | Review before code | None | `interactive-app` ← `docs/agent-stage-inputs-outputs`; `docs(agent-stage-inputs-outputs): plan agent stage inputs and outputs` | `openspec validate --strict`; review; CI |
| PR-A | Sealed briefs and read tools | 1 | The data path everything else reads | PR-0; BI-019 PR-D1 | `interactive-app` ← `feat/agent-stage-inputs-outputs-briefs`; `feat(agent-stage-inputs-outputs): give every session a sealed brief` | Contracts, intake unit, PG and process tiers; review; CI |
| PR-B | Typed outputs, boundaries, revisions and the duplicate check | 2 | The contract every stage publishes to | PR-A; BI-019 PR-B and PR-D1 | `interactive-app` ← `feat/agent-stage-inputs-outputs-typed-outputs`; `feat(agent-stage-inputs-outputs): typed stage outputs with enforced boundaries` | Intake tiers; review; CI |
| PR-C | Match replaces the Inventory agent | 3 | One pipeline change with its UI and question | PR-B; BI-019 PR-B (stepped questions) | `interactive-app` ← `feat/agent-stage-inputs-outputs-match`; `feat(agent-stage-inputs-outputs): match lots against InvenTree before research` | Intake tiers, frontend checks; demo video; review; CI |
| PR-D | Identify mode and identity amendments | 4 | Builds on Match's search passes | PR-C | `interactive-app` ← `feat/agent-stage-inputs-outputs-identify`; `feat(agent-stage-inputs-outputs): identify items before matching them` | Intake tiers; review; CI |
| PR-E1 | Media decoder ports and recipe `/2` | 5 | Depends only on the contracts and the decoder, so the longest single task starts in wave 1 | PR-0 | `interactive-app` ← `feat/agent-stage-inputs-outputs-decoder-ports`; `feat(agent-stage-inputs-outputs): port the image and logo scripts to the media decoder` | Decoder parity tests, contracts tests; review; CI |
| PR-E2 | Image tools, `propose_images` and the Images review | 10 | Exposes PR-E1's operations to sessions with their consumers | PR-B, PR-E1 | `interactive-app` ← `feat/agent-stage-inputs-outputs-images`; `feat(agent-stage-inputs-outputs): images proposed as recipes and rendered by the app` | Intake tiers, frontend checks; demo video; review; CI |
| PR-F | Outputs into records and approval, and validation before approval | 6 | Everything that reaches InvenTree, reviewed together | PR-C, PR-D, PR-E2 | `interactive-app` ← `feat/agent-stage-inputs-outputs-records`; `feat(agent-stage-inputs-outputs): confirmed agent output reaches records and approval` | Intake tiers including execution tests, frontend checks; review; CI |
| PR-I | Multi-lot Research and Images sessions | 9 | One session model change with its settings, claim, routing and UI | PR-D, PR-E2; BI-019 PR-E and PR-G | `interactive-app` ← `feat/agent-stage-inputs-outputs-lot-groups`; `feat(agent-stage-inputs-outputs): run research and images sessions over several lots` | Contracts tests, intake tiers, frontend checks; demo video; review; CI |
| PR-G1 | The profile scaffold, instruction packs and guides, behind the test-only switch | 7 | Lets the long pack and guide work start early; nothing selects the profile yet | PR-A | `interactive-app` ← `feat/agent-stage-inputs-outputs-profile-scaffold`; `feat(agent-stage-inputs-outputs): add the stage profile, packs and guides` | Profile and guide tests, intake tiers; Mitch's review of the wording; review; CI |
| PR-G2 | Activation, cutover and the live requalification | 11 | The behaviour change and its live proof together | All other PRs; BI-019 PR-F (the popover's Match row); Mitch's go-ahead for the live run | `interactive-app` ← `feat/agent-stage-inputs-outputs-activation`; `feat(agent-stage-inputs-outputs): switch on the stage profile` | Admission tests, intake tiers, live evidence on the PR; review; CI |
| PR-H | The brief on the session page | 8 | UI over PR-A, after the page exists | PR-A; BI-019 PR-E | `interactive-app` ← `feat/agent-stage-inputs-outputs-brief-page`; `feat(agent-stage-inputs-outputs): show the brief a session started from` | Frontend checks; demo video; review; CI |

## Parallel work

How the PR map above lets work run at the same time. A PR can start once every PR it depends on has merged; PRs in the same wave share no dependency on each other and can be built by separate people or agents at once.

**External gates** (BI-019, PR #243): BI-022 PR-A waits for BI-019 PR-D1; PR-B waits for BI-019 PR-B and PR-D1; PR-C waits for BI-019 PR-B; PR-H waits for BI-019 PR-E; PR-I waits for BI-019 PR-E and PR-G; PR-G2 waits for BI-019 PR-F.

| Wave | Can run in parallel | Waits for |
| --- | --- | --- |
| 1 | PR-A · PR-E1 (and drafting the pack wording for PR-G1) | PR-0; BI-019 PR-D1 (PR-A) |
| 2 | PR-B · PR-G1 · PR-H | PR-A (all three); BI-019 PR-B and PR-D1 (PR-B); BI-019 PR-E (PR-H) |
| 3 | PR-C · PR-E2 | PR-B (both); BI-019 PR-B (PR-C); PR-E1 (PR-E2) |
| 4 | PR-D | PR-C (PR-E2 may still be in progress) |
| 5 | PR-F · PR-I | PR-C, PR-D and PR-E2 (PR-F); PR-D, PR-E2, BI-019 PR-E and PR-G (PR-I) |
| 6 | PR-G2 | everything else; BI-019 PR-F; Mitch's go-ahead for the live run |

- **Critical path:** PR-A → PR-B → PR-C → PR-D → PR-F → PR-G2 and PR-A → PR-B → PR-C → PR-D → PR-I → PR-G2, six PRs in sequence each; the BI-019 gates and actual PR durations decide which is longer. PR-E1, PR-E2, PR-G1 and PR-H have slack.
- **Most parallel moment:** wave 2, three PRs; waves 1, 3 and 5 have two each. PR-H can run alongside anything from wave 2 on.
- **Conflicts to expect between parallel PRs:** PR-C and PR-E2 both add session tools to `agents/tools/server.ts` and `handlers.ts` and both add migrations, so whichever merges second rebases and renumbers its migration. PR-F and PR-I both touch the Processing read and session rows.

### Re-carving that would allow more parallel work

Mitch applied suggestions 2 and 5 on 2026-11-23, and BI-019 split its photo views into PR-D1, which this map now waits for instead of BI-019's whole PR-D; the map above includes all three. Suggestions 1, 3 and 4 stay proposals.

1. **Superseded by BI-019's PR-D1: move PR-A off BI-019 PR-D.** PR-A needs `photo_view` only for durable delivery tracking, which the citation rules in PR-B use. Moving that piece into PR-B lets PR-A start right after PR-0 instead of waiting for BI-019's history work. Cost: none beyond moving one task item. Alternatively, BI-019's own proposed re-carving splits its photo views into an early PR-D1; waiting for that instead keeps this map as it is while still not waiting for BI-019's history read.
2. **Applied: split PR-E into decoder ports and wiring.** The decoder ports (recipe `/2`, `inspect_region`, `preview_images`, `match_logo`, the logo set and their parity tests) depend only on the contracts and the media decoder, not on PR-B. As **PR-E1** they can start in wave 1, beside PR-A; **PR-E2** (the intake tools, `propose_images`, and the Images review) still follows PR-B. The parity work is likely the longest single task, so this moves it off the critical path. Cost: one more PR and a contract that lands before its consumer.
3. **Split PR-C into the Match search core and the Match flow.** **PR-C1**: key extraction, InvenTree and cross-batch search, verdicts, sufficiency and `processing_match` storage, tested against a fake read model with keys supplied by fixtures, so it can start in wave 2 beside PR-B. **PR-C2**: questions, decisions, modes, queueing and Processing › Match, after PR-B and BI-019 PR-B. Cost: the core lands before anything calls it; the key-extraction interface must be settled early.
4. **Split PR-F into records and approval.** **PR-F1**: proposed values on Parts and their confirmation in Review only needs PR-B's typed outputs, so it can run in wave 3. **PR-F2**: Match targets, image effects, gaps-fill effects and pass 3 still wait for C, D and E. Cost: one more PR; Review shows proposed values before they can be approved into new effects.
5. **Applied: start PR-G's content early.** The instruction packs and guide text (task 7.1, which needs Mitch's review of the wording) can be drafted from wave 1 as a reviewed document, and the profile row, stage-instructions table and guides (**PR-G1**) can land behind the test-only switch after PR-A. Only admission, the switch-on, the cutover and the live requalification (**PR-G2**) stay last. Cost: the guide text may need revising as later PRs settle the output contracts.

With suggestions 3 and 4 also applied, PR-C1 and PR-F1 would join wave 2 and wave 3, and up to four PRs could be in progress at once.

## 1. Briefs, input `/7`, read tools and stage packs scaffold

- **PR delivery:** PR-A.
- **Outcome:**
  - every `/7` session's input, written through the test-only fixture switch until PR-G2, seals its brief (shared plus stage), rendered in the opening within 48 KiB;
  - `read_lot` and full `read_batch` return the current brief;
  - the brief's sections exist from PR-A, and each is filled as its data arrives: match state in PR-C, the merged identity in PR-D, the vocabulary in PR-G1;
  - the stage instruction table and the input's `stage_instructions_sha256` exist, initially empty for earlier profiles;
  - the immutable page store for what doesn't fit in the manifest;
  - read tools page the sealed brief by its revision, or return the current view with its revision;
  - stable-identity queueing, Start and replacement follow the lead's sealed input version, not process config; Start on a batch with no lead keeps today's configured pipeline while no configuration writes `/7`, and from PR-G2 waits for the `/7` lead;
  - the manifest stays within the 240 KiB retained-input cap.
- **Scope:**
  - `contracts/src/processing.ts` (`/7`, the brief);
  - `intake-server/src/processing/session-input.ts` and queueing;
  - `agents/session/session-runner.ts` (opening, claim check);
  - `agents/tools/` (read tools);
  - a migration for `processing_stage_instructions`.
- **TDD approach:** PG tests for assembly of each section, the human marking, the asked-list scope, regions, budget summaries, the retained-input cap, read-tool scope and paging, an edit between queueing and the first page read, an edit to a field held only in a page, and a retained synthetic `/6` lead receiving new evidence without queueing `/7` successors fail first.
- **Verification:** contracts tests, and `pnpm db:intake test` and `test:process` (with the decoder and probe images).

- [ ] 1.1 Read the code guidelines, the intake architecture and the doc's Part 1. Correcting an observation replaces its readings in place and sets `operator_edited` (`capture/evidence-observations.ts:968-985`), so `read_batch` projects only the current markings; the brief's corrections need the reading before and after, so task 1 retains it.
- [ ] 1.2 RED: contract and PG tests for the brief, `/7`, `read_lot`, `read_batch` with full readings, and the stage-instructions claim check.
- [ ] 1.3 GREEN: implement them, retaining the earlier reading, author and time when an observation is corrected. A correction made before this change shows its current reading marked as corrected, with the earlier reading not known. The before-and-after brief test drives a real observation correction.
- [ ] 1.4 Add a process test with a fake session reading its brief. Update `intake-server/src/agents/ARCHITECTURE.md`, and run the tiers.

## 2. Typed outputs, boundaries, revisions and no repeated questions

- **PR delivery:** PR-B.
- **Outcome:**
  - the typed proposals and their stage and mode checks;
  - `revision/2` with typed changes from every sender;
  - Examine woken by operator corrections;
  - `ask` in `/7` sessions returning an existing question unless it names new evidence or a new conflict;
  - the release of a `photo_view` recorded by the native adapter or synthetic driver that hands the image over, and citations admitted only for a released view on the current attempt; the VM relay's acknowledgement is task 11's.
- **Scope:** the contracts, `agents/tools/handlers.ts`, `processing/currentness.ts`, `stable-identity.ts`, `session-answers.ts`, and the capture correction paths.
- **TDD approach:** PG tests for kind and field refusals, a `/7` `propose_lot` estimate refused while one `examine-identity/1` estimate reaches Review, each revision sender's changes, the correction wake, the duplicate-check cases, a withheld reply, a native response write that fails, a view from an older attempt, a released view cited after a worker restart, and a synthetic fetch followed by an admitted citation fail first.
- **Verification:** intake tiers.

- [ ] 2.1 Map every revision sender and every proposal reader.
- [ ] 2.2 RED: write the tests listed above.
- [ ] 2.3 GREEN: implement them. Keep `/5` readers working.
- [ ] 2.4 Run the tiers.

## 3. Match: search, verdicts, questions, modes and queueing

- **PR delivery:** PR-C.
- **Outcome:**
  - the Match module with key extraction, InvenTree and cross-batch search, verdicts, the sufficiency check and the `processing_match` state;
  - app-owned match questions on BI-019's stepped form in their own store, pinned to the match revision and candidates, including the batch form;
  - searches run after commit and settle only as the lot's latest search generation;
  - persisted Match waits checked at claim, resume, Start and replacement, with late candidates holding running and queued stages;
  - decisions setting modes and queueing Research and Images, which replaces `onLeadIdentity`'s direct queueing;
  - Inventory no longer queued for the new profile;
  - Processing › Match replacing Inventory for batches whose lead input is `/7`, while batches with no lead or an earlier-version lead keep the Inventory step.
- **Scope:**
  - a new `intake-server/src/processing/match/`;
  - `inventory/` read helpers;
  - the match question store and its Needs you read;
  - a migration;
  - the Match exception on the step page as it stands when PR-C is built; the spec deltas are reconciled with BI-019 once, before archive (see the lifecycle follow-up);
  - `frontend/src/components/processing/` (Match step, Needs you);
  - the Inventory step shown only for batches with no lead or an earlier-version lead.
- **TDD approach:** PG tests against a fake InvenTree read model fail first. They cover every verdict, sufficiency, question options, each decision's modes, waiting stages, the search-failure state, the batch question, Needs you before any lot job exists, a stale question's refused answer, a restart between a search request's commit and its read, two searches on the same identity settling in reverse order, two decisions on the same identity with the first `match` item still pending, an answer arriving before a newer search settles, and a second identity change between a decision and the resume. The paused identify session, a late candidate while Images runs and an unrelated inbox item while Research waits are task 4's, since they need identify mode and late matches. Frontend tests cover the Match step rows a retained `/6` batch with an open Inventory question keeping its Inventory step, and a batch with no lead keeping it.
- **Verification:** intake tiers, frontend checks, and a demo video.
- **Risks and decisions:** the search strategy and normalisation are open questions. Record the chosen rules in `notes.md`.

- [ ] 3.1 Read the guidelines and the D44–D45 boards. Settle the search endpoints and MPN normalisation.
- [ ] 3.2 RED: write the Match PG tests and the frontend tests.
- [ ] 3.3 GREEN: implement the module, questions, modes, queueing and the Match step.
- [ ] 3.4 Run the checks, and record the demo video.

## 4. Identify mode and identity amendments

- **PR delivery:** PR-D.
- **Outcome:**
  - Research identify mode publishing `research-identity/1` and pausing;
  - the merged identity with per-field sources and an identity revision that successors pin;
  - label and draft Part proposals for agent-made, unedited lots, and new label and draft Part suggestions for edited lots, since today's edited-lot suggestions cover observation membership only;
  - replacing amendments opening a question;
  - Match passes 2 and late matches.
- **Scope:** `processing/stable-identity.ts` (merged identity), `capture/` (proposed lot edits), the match module, and inbox `match` items.
- **TDD approach:** PG and process tests fail first. They cover the house-numbered reel flow, refinement updating the label, a replacing amendment, an edited lot getting suggestions, a late alias, a late candidate while Images runs, and an unrelated inbox item arriving while Research waits.
- **Verification:** intake tiers.

- [ ] 4.1 RED: write the tests listed above.
- [ ] 4.2 GREEN: implement them.
- [ ] 4.3 Run the tiers.

## 5. Media decoder ports and recipe `/2`

- **PR delivery:** PR-E1.
- **Outcome:**
  - recipe `/2`: straightening of at most 15° and hue-keeping light adjustments, with its contract;
  - `inspect_region`, `preview_images` and `match_logo` ported to TypeScript in the decoder as decoder operations, with the logo set bundled;
  - nothing calls them yet outside tests.
- **Scope:** `media-decoder/src/`, `contracts/src/media.ts` and the decoder's dispatch protocol.
- **Prerequisites:** none beyond PR-0; this task deliberately has no intake dependency so it can start in wave 1.
- **TDD approach:** parity tests against the skills' scripts' outputs on fixtures fail first, measured on the rendered crop pixels before labels, downscaling or encoding. They include resistor-band hue and the corner guard, matcher top-1 on degraded logos, and grid labels in source pixels.
- **Verification:** decoder tests and contracts tests.
- **Risks and decisions:** the light-adjustment bounds are open; record the chosen bounds in `notes.md`.

- [ ] 5.1 Read the guidelines, the decoder README and the skills' scripts. Generate parity fixtures from the scripts.
- [ ] 5.2 RED: write the parity tests.
- [ ] 5.3 GREEN: implement the ports and recipe `/2`.
- [ ] 5.4 Run the decoder and contracts tests.

## 10. Image tools and the Images review

- **PR delivery:** PR-E2.
- **Outcome:**
  - `inspect_region`, `preview_images` and `match_logo` exposed as intake session tools over task 5's decoder operations;
  - `propose_images` publishing `images/1`;
  - the VM relay carrying the new tools' image replies within one aggregate per-run budget;
  - Processing › Images showing proposed crops to confirm, redo or crop in Capture.
- **Scope:** `intake-server/src/media/`, `agents/tools/` and the relay in `agents/shared-vm/` (`evidence-request.ts`, `native-turn.ts`), and `frontend/src/components/processing/ProcessingImages.tsx`.
- **Prerequisites:** tasks 2 and 5.
- **TDD approach:** the tool scope tests, montage and logo-sheet replies over the real relay, and the frontend review tests fail first.
- **Verification:** intake tiers, frontend checks, and a demo video.

- [ ] 10.1 RED: write the tool, relay and UI tests.
- [ ] 10.2 GREEN: implement the tools, `propose_images` and the review.
- [ ] 10.3 Run the checks, and record the demo video.

## 6. Outputs into records and approval, and validation before approval

- **PR delivery:** PR-F.
- **Outcome:**
  - proposed values on agent-made Parts, confirmed in Review, with each field from its owning stage;
  - Match decisions as lot targets;
  - confirmed images as the Part image and stock attachments;
  - gaps-mode update effects;
  - the Part image and gaps fill as new effect kinds in a new plan version, gated by the target's capability;
  - Match pass 3 as a preparation gate, recorded on the preparation and checked at approval.
- **Scope:** `contracts/src/records-projection.ts`, `intake-server/src/records/` and `review/`, `execution/effects/`, `inventory/transport.ts`, and the Review frontend.
- **TDD approach:** projection, preparation and effects tests fail first. They cover proposed and confirmed values, never overwriting operator values, the existing-Part target, the image effects on a created and an existing Part (including an image added to the existing Part after preparation, refused as a conflict), gaps-only effects, a gaps fill refused when the field was filled meanwhile (the race between that read and the update is documented, not prevented), retained earlier-version plans, uncertain effects against the owned fake, the pass-3 block, its searches recorded as preparation target reads, a partial selection and a retained earlier-profile batch left ungated, a preparation made on a `/6` lead refused at approval after an upgrade, and approval refusing a preparation while a newer search is pending on the same identity, after it settles, or after a failed validation read.
- **Verification:** intake tiers including the execution tests, and frontend checks.

- [ ] 6.1 RED: write the tests listed above.
- [ ] 6.2 GREEN: implement them.
- [ ] 6.3 Run the checks.

## 7. Profile scaffold, instruction packs and guides

- **PR delivery:** PR-G1.
- **Outcome:**
  - the new profile row with base instructions, and per-stage packs written from the skills, in the stage-instructions table;
  - `read_guide` and `read_vocabulary`;
  - all of it reachable only through the test-only fixture switch; no configuration selects the profile yet.
- **Scope:** migrations for the profile row and its stage packs, `processing/session-policy.ts`, the guides, and the two tools in `agents/tools/`.
- **Prerequisites:** task 1. The pack wording can be drafted from wave 1, before task 1 merges.
- **TDD approach:** profile and guide tests fail first: the claim's stage-instructions digest check, `read_guide` sections sealed with the profile, and `read_vocabulary` paging.
- **Verification:** intake tiers.
- **Risks and decisions:** Mitch reviews the instruction wording; later PRs may revise a pack as their output contracts settle. Until PR-G2 activates `/4`, only tests seal it, so a later migration may replace its packs; from activation, a revision is a new profile.

- [ ] 7.1 Draft the base and stage packs from the skills; get Mitch's review of the wording.
- [ ] 7.2 RED: write the profile, stage-instructions and guide tests.
- [ ] 7.3 GREEN: write the migrations, policy entry, guides, `read_guide` and `read_vocabulary`.
- [ ] 7.4 Run the tiers.

## 11. Activation, cutover and live requalification

- **PR delivery:** PR-G2.
- **Outcome:**
  - the new tool profile admitted on both providers;
  - the default profile switched to `synthetic-session/1`;
  - `/7` turned on for new leads of `shared-vm-agent/4` and of `synthetic-session/1` on the local synthetic driver, replacing the test-only fixture switch; the paired bridge route keeps `/6`, with a process test for each route;
  - the activity popover's Match row from BI-019 PR-F, showing Match for `/7` batches and Inventory for the others;
  - a live requalification on Claude and Codex.
- **Scope:**
  - `config.ts` and `agents/session/session-admission.ts`;
  - pairing and driver selection in `agents/session/session-worker-main.ts`, and `agents/shared-vm/coordinator.ts`, `guest-turn.ts` and `tool-worker.ts`;
  - the VM release acknowledgement in `agents/shared-vm/native-turn.ts`, `tool-client.ts` and the coordinator;
  - the web-policy gates for `/4`: sealed public-page access in `agents/shared-vm/turn-policy.ts` and protected origins in `protected-hosts.ts`, changed together;
  - the worker image and deployment;
  - the cutover: the drain fence and the drain's completion check for `/3`, and the upgrade action, superseding the batch's queued or waiting earlier-version successors, for a finished or idle earlier-profile lead (`processing/session-replacement.ts` and the session drawer);
  - `tooling/dev/` and the README;
  - the live harness.
- **Prerequisites:** tasks 1–10; BI-019 PR-F, so the popover's Match row ships with activation; Mitch's go-ahead for the live run.
- **TDD approach:** admission and profile tests fail first, with a paired `/4` turn with sealed web on and off and a protected origin refused, the VM release acknowledgement through the isolated relay (guest staging failing after the view commits, a response write failing after staging succeeds, an immediate citation behind a delayed acknowledgement, an acknowledgement whose commit is delayed past the bound, and an acknowledgement that never arrives, which leaves the view uncitable and the turn running), retained `/3` attempts draining on a `/3` worker before cutover, a batch with a retained lead across the cutover, evidence arriving during a running `/3` turn and on a batch without a lead, an answered waiting lead carried into its upgrade, a still-open question answered after the upgrade, a Start during the Examine trigger's quiet period waiting for the `/7` lead, a cutover starting with a paused batch and a gated Inventory attempt, and upgrading a finished lead with pending evidence and retained history. The live run is manual evidence.
- **Verification:** intake tiers, plus live runs on `bench-agent-m1-local` recorded on the PR. They cover an exact match decided before research, a house-numbered item identified then matched, and Images producing a Part image.
- **Risks and decisions:** the live run is a sample, not a guarantee.

- [ ] 11.1 RED: write the admission, activation, cutover and relay acknowledgement tests.
- [ ] 11.2 GREEN: implement admission, the default profile change, `/7` activation, pairing, the web-policy gates and the cutover.
- [ ] 11.3 Run live with Mitch's go-ahead, and attach the evidence to the PR.

## 8. The brief on the session page

- **PR delivery:** PR-H.
- **Outcome:** the brief as the first, collapsible item of a session's conversation, with corrections marked.
- **Scope:** the history read's `brief` entry, and the session page in `frontend/src/components/processing/`.
- **TDD approach:** read and component tests fail first.
- **Verification:** frontend checks, and a demo video.

- [ ] 8.1 RED: write the history-read and component tests.
- [ ] 8.2 GREEN: implement them.
- [ ] 8.3 Run the checks, and record the demo video.

## 9. Multi-lot Research and Images sessions

- **PR delivery:** PR-I.
- **Outcome:**
  - an attempt binds 1 to N lot jobs of one stage and mode (`processing_attempt_lot`), each lot job pointing at the attempt that holds it;
  - the claim groups queued lots that Match allows, oldest first, up to the attempt's sealed cap, and seals the group into the `/7` input;
  - "Lots per Research session" (default 5) and "Lots per Images session" (default 8), integers 1–20, in the agent settings and Settings › Agents › Sessions, sealed per attempt;
  - one brief section per lot within the budget split, and `read_lot` scoped to the group;
  - typed proposals naming a lot of the group;
  - per-lot Match waits and identify pauses inside a running session;
  - revisions, `match` items and answers routed to the session holding the lot, and a lot released and requeued when its identity changes after the claim;
  - per-lot retry after a session failure, Start fresh moving one lot, and one slot per session;
  - a durable dispatch and recovery path for unclaimed lot jobs in a new `unclaimed` job state with a nullable current attempt, a versioned Start and Start fresh receipt that may name no attempt, and the Processing read showing them before claim;
  - the group's lineage and attempt as the authority for session liveness, resume, recovery, settlement and capabilities, with active membership for lot operations;
  - session rows and pages naming the lots they serve, adapting BI-019's one-subject rows and drawer after its PR-G.
- **Scope:** `contracts/src/agents.ts` and `processing.ts`; `processing/session-attempts.ts`, the claim in `agents/session/session-runner.ts` and `session-execution.ts`; the job-keyed constraints in migrations 0006 and 0018; per-lot inbox acknowledgement in `agents/tools/inbox.ts`; inbox routing; `processing/session-replacement.ts`; a migration; `frontend/src/components/settings/` and `frontend/src/components/processing/` session rows and page.
- **TDD approach:** PG and process tests fail first. They cover grouping by stage, mode and cap; the cap taken from sealed settings after a settings change; a lot that is waiting, superseded or stale left out of a claim; a per-lot pause in identify mode while the session works on another lot; release and requeue on an identity change after the claim; per-lot retry after a failure; Start fresh on one lot; `read_lot` refusing a lot outside the group; a proposal naming another lot refused; Examine still proposing for any live lot of its batch; one slot per session; a restart between queueing an unclaimed lot and its claim; a cancel racing a claim with each side winning, a cancel before a retry claim, and a lot failing before claim; a release revision reaching a parked original group while the released lot carries its pending items; a Start command retried before and after its lot is claimed; releasing or starting fresh on the anchor lot while a peer publishes and settles, then parks, receives an answer and resumes; a held lot's own later `match` item leaving its earlier chat deliverable; a declined earlier delivery stopping that lot's delivery before its later mode change; a self-amendment keeping a lot in its group and a peer's amendment releasing it; an identify group whose lots get different decisions; a question answered for a non-anchor lot and that lot moved while a peer runs; a held lot's chat at sequence 10 with a runnable lot's answer at 11; an all-held group staying parked, and woken by one lot's decision; a cancel racing a claim and cancelling the anchor lot while a peer runs; two claimers racing; a group whose combined evidence passes 64 media versions; a cross-lot citation refused, an Images recipe for lot A over evidence exclusive to lot B refused, shared evidence accepted, and a proposal after release refused; and one group giving one row and one slot in the totals. Frontend tests cover the settings fields and the session rows.
- **Verification:** contracts tests, intake tiers, frontend checks, and a demo video.

- [ ] 9.1 Read the guidelines and the `settings-debug-mode` settings pattern. Map every reader of a job's current attempt and of a lineage's single subject.
- [ ] 9.2 RED: write the tests listed above.
- [ ] 9.3 GREEN: implement the group model, claim, settings, brief sections, routing, release, retry and UI.
- [ ] 9.4 Run the checks, and record the demo video.

## Delivery evidence and lifecycle follow-up

- [ ] PR-0: review the plan read-only, fix findings, publish, CI green, merge.
- [ ] PR-A to PR-I: each implemented, reviewed at its exact head, published (with a demo where the UI changes), CI green and merged, in prerequisite order: PR-A and PR-E1, then PR-B and PR-G1, then PR-C and PR-E2, PR-D, PR-F and PR-I, and PR-G2 last. PR-H needs only PR-A and BI-019 PR-E and can merge at any point after them.
- [ ] Update BI-022 as PRs merge. It is Done only after every PR has merged and the live evidence is accepted.
- [ ] Mark design log D43–D46 Built.
- [ ] Before archiving, and after BI-019 syncs, reconcile the deltas with the specs in one pass: rebase the `Step page pattern` delta on BI-019's version, keeping its full text and scenarios plus the Match exception; add a modified `Non-blocking questions with assumptions` on BI-019's text that tells agent questions from Match questions; and carry BI-019's change to the pipeline's quantity-question scenario. Then run `pnpm openspec:overlap --change agent-stage-inputs-outputs`, sync after BI-019 (both edit `processing-workspace`, `processing-agent-sessions` and `processing-stage-pipeline`), and record open items in `notes.md`.
