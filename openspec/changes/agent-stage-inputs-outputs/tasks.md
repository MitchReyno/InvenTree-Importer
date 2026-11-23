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
- **Activation before the profile:** `synthetic-session/1` takes the new contracts from PR-A, so PR-A to PR-F exercise them in process tests before PR-G adds `shared-vm-agent/4`. Earlier profiles keep today's pipeline.

## Completion and commit ordering

- Check a completed action in the same commit as its work.
- Review, publication, CI and merge actions stay unchecked until they happen.
- Never commit in a worktree while an intake test tier runs there.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Briefs, input `/7`, read tools and stage packs scaffold | Contracts, intake server, migration | BI-019 PR-D (`photo_view`) | agent-sessions "Sessions start from a sealed brief", "Session tool boundary" and "Stage tool sets" (read tools) |
| 2. Typed outputs, boundaries, revisions and no repeated questions | Contracts, intake server | 1; BI-019 PR-B and PR-D | agent-sessions "Typed stage outputs", "Human facts take precedence" (data), "Questions are not asked twice"; pipeline "Revisions carry the change"; the design's citation admission over `photo_view` |
| 3. Match: search, verdicts, questions, modes and queueing | Intake server, migration, frontend | 2; BI-019 PR-B | processing-match "Deterministic search by strong keys", "Verdicts and sufficiency", "The match question", "Decisions set stage modes" ("Add stock"), "When Match searches" (after Examine and Check again), "Match questions are pinned", "Match waits are recorded"; pipeline "Examine stage and parallel successors", "Successors start on a stable identity" ("Parallel start", "Lot regrouped before successors start"), "Evidence-based currentness" (the decision and mode); workspace "Processing › Match", "Step page pattern" (the Match exception), the Inventory removals |
| 4. Identify mode and identity amendments | Intake server | 3 | pipeline "Identify first when nothing can be searched", "Identity amendments update the lot", "Successors start on a stable identity" (identify-mode start); match "When Match searches" ("Alias found during research"), "Decisions set stage modes" (a paused identify session) |
| 5. Image and logo tools in the media decoder, and the Images review | Media decoder, intake server, frontend | 2 | capture-media "Media immutable derived crops"; agent-sessions "Image and logo tools run in the app", "Stage tool sets" (image tools); workspace "Images step shows proposed crops" |
| 6. Outputs into records and approval, and validation before approval | Intake server, frontend | 3, 4, 5 | review-records "Agent values are proposed until confirmed"; approval-preparation both requirements; match "Validation before approval" |
| 7. Profile `shared-vm-agent/4`, instruction packs, guides and live requalification | Intake server, migration, live | 1–6, 9 | agent-sessions "Human facts take precedence" (instructions), "Stage guides on demand", "Stage tool sets" (read_guide and admission); live evidence |
| 8. The brief on the session page | Frontend | 1; BI-019 PR-E | workspace "The brief on the session page" |
| 9. Multi-lot Research and Images sessions | Contracts, intake server, migration, frontend | 3, 4; BI-019 PR-E | agent-sessions "Research and Images sessions serve lot groups", "Lots per session settings", "Per-lot handling inside a group", "Typed stage outputs" (the lot); workspace "Sessions show the lots they serve" |

## PR delivery map

| Bundle | Outcome | Tasks | Why this boundary | Prerequisites and order | Base, branch and subject | Gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-0 | This plan, the design doc and BI-022 | Planning | Review before code | None | `interactive-app` ← `docs/agent-stage-inputs-outputs`; `docs(agent-stage-inputs-outputs): plan agent stage inputs and outputs` | `openspec validate --strict`; review; CI |
| PR-A | Sealed briefs and read tools | 1 | The data path everything else reads | PR-0; BI-019 PR-D | `interactive-app` ← `feat/agent-stage-inputs-outputs-briefs`; `feat(agent-stage-inputs-outputs): give every session a sealed brief` | Contracts, intake unit, PG and process tiers; review; CI |
| PR-B | Typed outputs, boundaries, revisions and the duplicate check | 2 | The contract every stage publishes to | PR-A; BI-019 PR-B and PR-D | `interactive-app` ← `feat/agent-stage-inputs-outputs-typed-outputs`; `feat(agent-stage-inputs-outputs): typed stage outputs with enforced boundaries` | Intake tiers; review; CI |
| PR-C | Match replaces the Inventory agent | 3 | One pipeline change with its UI and question | PR-B; coordinate with BI-019 PR-F's popover if it has merged | `interactive-app` ← `feat/agent-stage-inputs-outputs-match`; `feat(agent-stage-inputs-outputs): match lots against InvenTree before research` | Intake tiers, frontend checks; demo video; review; CI |
| PR-D | Identify mode and identity amendments | 4 | Builds on Match's search passes | PR-C | `interactive-app` ← `feat/agent-stage-inputs-outputs-identify`; `feat(agent-stage-inputs-outputs): identify items before matching them` | Intake tiers; review; CI |
| PR-E | Image and logo tools, recipe `/2` and the Images review | 5 | Decoder ports with their consumers | PR-B | `interactive-app` ← `feat/agent-stage-inputs-outputs-images`; `feat(agent-stage-inputs-outputs): images proposed as recipes and rendered by the app` | Decoder parity tests, intake tiers, frontend checks; demo video; review; CI |
| PR-F | Outputs into records and approval, and validation before approval | 6 | Everything that reaches InvenTree, reviewed together | PR-C, PR-D, PR-E | `interactive-app` ← `feat/agent-stage-inputs-outputs-records`; `feat(agent-stage-inputs-outputs): confirmed agent output reaches records and approval` | Intake tiers including execution tests, frontend checks; review; CI |
| PR-G | The new profile, instruction packs and guides, live-qualified | 7 | The behaviour change and its live proof together | PR-A to PR-F and PR-I; Mitch's go-ahead for the live run | `interactive-app` ← `feat/agent-stage-inputs-outputs-profile`; `feat(agent-stage-inputs-outputs): stage instruction packs in a new agent profile` | Admission tests, intake tiers, live evidence on the PR; review; CI |
| PR-I | Multi-lot Research and Images sessions | 9 | One session model change with its settings, claim, routing and UI | PR-D; BI-019 PR-E | `interactive-app` ← `feat/agent-stage-inputs-outputs-lot-groups`; `feat(agent-stage-inputs-outputs): run research and images sessions over several lots` | Contracts tests, intake tiers, frontend checks; demo video; review; CI |
| PR-H | The brief on the session page | 8 | UI over PR-A, after the page exists | PR-A; BI-019 PR-E | `interactive-app` ← `feat/agent-stage-inputs-outputs-brief-page`; `feat(agent-stage-inputs-outputs): show the brief a session started from` | Frontend checks; demo video; review; CI |

## 1. Briefs, input `/7`, read tools and stage packs scaffold

- **PR delivery:** PR-A.
- **Outcome:**
  - every new session's input seals its brief (shared plus stage), rendered in the opening within 48 KiB;
  - `read_lot` and full `read_batch` return the current brief;
  - the brief's sections exist from PR-A, and each is filled as its data arrives: match state in PR-C, the merged identity in PR-D, the vocabulary in PR-G;
  - the stage instruction table and the input's `stage_instructions_sha256` exist, initially empty for earlier profiles;
  - the immutable page store for what doesn't fit in the manifest;
  - read tools page the sealed brief by its revision, or return the current view with its revision;
  - the manifest stays within the 240 KiB retained-input cap.
- **Scope:**
  - `contracts/src/processing.ts` (`/7`, the brief);
  - `intake-server/src/processing/session-input.ts` and queueing;
  - `agents/session/session-runner.ts` (opening, claim check);
  - `agents/tools/` (read tools);
  - a migration for `processing_stage_instructions`.
- **TDD approach:** PG tests for assembly of each section, the human marking, the asked-list scope, regions, budget summaries, the retained-input cap, read-tool scope and paging, an edit between queueing and the first page read, and an edit to a field held only in a page fail first.
- **Verification:** contracts tests, and `pnpm db:intake test` and `test:process` (with the decoder and probe images).

- [ ] 1.1 Read the code guidelines, the intake architecture and the doc's Part 1. Check whether correcting an observation keeps its earlier readings, and record the answer in `notes.md`.
- [ ] 1.2 RED: contract and PG tests for the brief, `/7`, `read_lot`, `read_batch` with full readings, and the stage-instructions claim check.
- [ ] 1.3 GREEN: implement them, retaining earlier readings if needed.
- [ ] 1.4 Add a process test with a fake session reading its brief. Update `intake-server/src/agents/ARCHITECTURE.md`, and run the tiers.

## 2. Typed outputs, boundaries, revisions and no repeated questions

- **PR delivery:** PR-B.
- **Outcome:**
  - the typed proposals and their stage and mode checks;
  - `revision/2` with typed changes from every sender;
  - Examine woken by operator corrections;
  - `ask` returning an existing question unless it names new evidence;
  - the release of a `photo_view` recorded by the relay or adapter that hands the image over, and citations admitted only for a released view on the current attempt.
- **Scope:** the contracts, `agents/tools/handlers.ts`, `processing/currentness.ts`, `stable-identity.ts`, `session-answers.ts`, and the capture correction paths.
- **TDD approach:** PG tests for kind and field refusals, each revision sender's changes, the correction wake, the duplicate-check cases, a withheld reply, guest staging failing after the view commits, a view from an older attempt, and a synthetic fetch followed by an admitted citation fail first.
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
  - Processing › Match replacing Inventory.
- **Scope:**
  - a new `intake-server/src/processing/match/`;
  - `inventory/` read helpers;
  - the match question store and its Needs you read;
  - a migration;
  - the activity popover's fourth row, if BI-019 PR-F has merged;
  - rebasing the `Step page pattern` delta on BI-019's version once BI-019 syncs, keeping its full text and scenarios plus the Match exception, and adding a modified `Non-blocking questions with assumptions` on BI-019's text that tells agent questions from Match questions;
  - `frontend/src/components/processing/` (Match step, Needs you);
  - removal of the Inventory step for new work.
- **TDD approach:** PG tests against a fake InvenTree read model fail first. They cover every verdict, sufficiency, question options, each decision's modes, waiting stages, the search-failure state, the batch question, Needs you before any lot job exists, a stale question's refused answer, two searches on the same identity settling in reverse order, an answer and an approval arriving before a newer search settles, and a second identity change between a decision and the resume. The paused identify session, a late candidate while Images runs and an unrelated inbox item while Research waits are task 4's, since they need identify mode and late matches. Frontend tests cover the Match step rows.
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
  - label and draft Part proposals for agent-made, unedited lots;
  - replacing amendments opening a question;
  - Match passes 2 and late matches.
- **Scope:** `processing/stable-identity.ts` (merged identity), `capture/` (proposed lot edits), the match module, and inbox `match` items.
- **TDD approach:** PG and process tests fail first. They cover the house-numbered reel flow, refinement updating the label, a replacing amendment, an edited lot getting suggestions, a late alias, a late candidate while Images runs, and an unrelated inbox item arriving while Research waits.
- **Verification:** intake tiers.

- [ ] 4.1 RED: write the tests listed above.
- [ ] 4.2 GREEN: implement them.
- [ ] 4.3 Run the tiers.

## 5. Image and logo tools in the media decoder, and the Images review

- **PR delivery:** PR-E.
- **Outcome:**
  - recipe `/2`: straightening of at most 15° and hue-keeping light adjustments;
  - `inspect_region`, `preview_images` and `match_logo` ported to TypeScript in the decoder, with the logo set bundled;
  - `propose_images` publishing `images/1`;
  - the VM relay carrying the new tools' image replies within one aggregate per-run budget;
  - Processing › Images showing proposed crops to confirm, redo or crop in Capture.
- **Scope:** `media-decoder/src/`, `contracts/src/media.ts`, `intake-server/src/media/`, `agents/tools/` and the relay in `agents/shared-vm/` (`evidence-request.ts`, `native-turn.ts`), and `frontend/src/components/processing/ProcessingImages.tsx`.
- **TDD approach:** parity tests against the skills' scripts' outputs on fixtures fail first, measured on the rendered crop pixels before labels, downscaling or encoding. They include resistor-band hue and the corner guard, matcher top-1 on degraded logos, and grid labels in source pixels. Then the tool scope tests, montage and logo-sheet replies over the real relay, and the frontend review tests.
- **Verification:** decoder tests, intake tiers, frontend checks, and a demo video.
- **Risks and decisions:** the light-adjustment bounds are open; record the chosen bounds in `notes.md`.

- [ ] 5.1 Read the guidelines, the decoder README and the skills' scripts. Generate parity fixtures from the scripts.
- [ ] 5.2 RED: write the parity, tool and UI tests.
- [ ] 5.3 GREEN: implement the ports, the tools and the review.
- [ ] 5.4 Run the checks, and record the demo video.

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
- **TDD approach:** projection, preparation and effects tests fail first. They cover proposed and confirmed values, never overwriting operator values, the existing-Part target, the image effects on a created and an existing Part (including an image added to the existing Part after preparation, refused as a conflict), gaps-only effects, a gaps fill refused when the field was filled meanwhile (the race between that read and the update is documented, not prevented), retained earlier-version plans, uncertain effects against the owned fake, the pass-3 block, and approval refusing a preparation older than the latest match revision.
- **Verification:** intake tiers including the execution tests, and frontend checks.

- [ ] 6.1 RED: write the tests listed above.
- [ ] 6.2 GREEN: implement them.
- [ ] 6.3 Run the checks.

## 7. Profile `shared-vm-agent/4`, instruction packs, guides and live requalification

- **PR delivery:** PR-G.
- **Outcome:**
  - the new profile with base instructions and per-stage packs written from the skills;
  - `read_guide` and `read_vocabulary`;
  - the new tool profile admitted on both providers;
  - the default profile switched to `synthetic-session/1`;
  - a live requalification on Claude and Codex.
- **Scope:**
  - migrations;
  - `processing/session-policy.ts`, `config.ts` and `agents/session/session-admission.ts`;
  - pairing and driver selection in `agents/session/session-worker-main.ts`, and `agents/shared-vm/coordinator.ts`, `guest-turn.ts` and `tool-worker.ts`;
  - the web-policy gates for `/4`: sealed public-page access in `agents/shared-vm/turn-policy.ts` and protected origins in `protected-hosts.ts`, changed together;
  - the worker image and deployment;
  - the cutover: draining `/3`, the pipeline version inherited from the lead at every queueing entry point, and the upgrade action for a finished or idle earlier-profile lead (`processing/session-replacement.ts` and the session drawer);
  - the guides;
  - `tooling/dev/` and the README;
  - the live harness.
- **TDD approach:** admission and profile tests fail first, with a paired `/4` turn with sealed web on and off and a protected origin refused, retained `/3` attempts draining on a `/3` worker before cutover, a batch with a retained lead across the cutover, a retained synthetic `/6` lead receiving new evidence, and upgrading a finished lead with pending evidence and retained history. The live run is manual evidence.
- **Verification:** intake tiers, plus live runs on `bench-agent-m1-local` recorded on the PR. They cover an exact match decided before research, a house-numbered item identified then matched, and Images producing a Part image.
- **Risks and decisions:** Mitch reviews the instruction wording before the live run.

- [ ] 7.1 Draft the base and stage packs from the skills; get Mitch's review of the wording.
- [ ] 7.2 RED: write the profile, admission and guide tests.
- [ ] 7.3 GREEN: write the migrations, policy, admission, guides and the default profile change.
- [ ] 7.4 Run live with Mitch's go-ahead, and attach the evidence to the PR.

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
  - session rows and pages naming the lots they serve, adapting BI-019's one-subject rows and drawer.
- **Scope:** `contracts/src/agents.ts` and `processing.ts`; `processing/session-attempts.ts`, the claim in `agents/session/session-runner.ts` and `session-execution.ts`; inbox routing; `processing/session-replacement.ts`; a migration; `frontend/src/components/settings/` and `frontend/src/components/processing/` session rows and page.
- **TDD approach:** PG and process tests fail first. They cover grouping by stage, mode and cap; the cap taken from sealed settings after a settings change; a lot that is waiting, superseded or stale left out of a claim; a per-lot pause in identify mode while the session works on another lot; release and requeue on an identity change after the claim; per-lot retry after a failure; Start fresh on one lot; `read_lot` refusing a lot outside the group; a proposal naming another lot refused; and one slot per session. Frontend tests cover the settings fields and the session rows.
- **Verification:** contracts tests, intake tiers, frontend checks, and a demo video.

- [ ] 9.1 Read the guidelines and the `settings-debug-mode` settings pattern. Map every reader of a job's current attempt and of a lineage's single subject.
- [ ] 9.2 RED: write the tests listed above.
- [ ] 9.3 GREEN: implement the group model, claim, settings, brief sections, routing, release, retry and UI.
- [ ] 9.4 Run the checks, and record the demo video.

## Delivery evidence and lifecycle follow-up

- [ ] PR-0: review the plan read-only, fix findings, publish, CI green, merge.
- [ ] PR-A to PR-I: each implemented, reviewed at its exact head, published (with a demo where the UI changes), CI green and merged, in the order above.
- [ ] Update BI-022 as PRs merge. It is Done only after every PR has merged and the live evidence is accepted.
- [ ] Mark design log D43–D46 Built.
- [ ] Before archiving, reconcile the deltas with the specs after BI-019's sync: BI-019 modifies `Inventory session drawer`, which this change removes, and `Step page pattern`, which PR-C rebases; and it changes the pipeline's quantity-question scenario. Then run `pnpm openspec:overlap --change agent-stage-inputs-outputs`, sync after BI-019 (both edit `processing-workspace`, `processing-agent-sessions` and `processing-stage-pipeline`), and record open items in `notes.md`.
