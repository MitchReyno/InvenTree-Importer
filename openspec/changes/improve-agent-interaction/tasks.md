# Implementation and delivery tasks

## Plan context

- **Plan:** the [proposal](proposal.md) and [design](design.md), with deltas in `specs/` for `ui-design-system`, `processing-workspace`, `processing-stage-pipeline`, `processing-agent-sessions`, `agents-overview` and `header-workflow-status`.
- **Reuse:** extend `Dialog.tsx` rather than use `closedby` or a polyfill, extend the existing contracts and form stack, and use native `<details>` for expandable entries. No new dependency.
- **Change name:** `improve-agent-interaction`. Branches are `feat/improve-agent-interaction-<suffix>`, and subjects are `type(improve-agent-interaction): …`.
- **Items:** BI-019, plus BI-015's answer-options item, which this change takes over.
- **More to come:** Mitch will add further items. They join this plan as new top-level tasks and PR bundles.

## Completion and commit ordering

- Complete and verify a checkbox action, then check it in the same commit as its work.
- Review, publication, CI and merge actions stay unchecked until they happen.
- Never commit in a worktree while an intake test tier runs there.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Dialogs close from their backdrop | Frontend behavior | None | ui-design-system "Dialogs close from their backdrop"; processing-workspace "Step page pattern" (Session drawer) |
| 2. Stepped question contracts | Contracts | None | processing-agent-sessions "Structured session questions"; processing-stage-pipeline "Non-blocking questions with assumptions" |
| 3. Server: ask, answers and agent guidance | Intake server | 2 | processing-agent-sessions "Structured session questions", "Agents ask one thing at a time", "Stepped answer effects", "Stepped answers reach the session"; pipeline "Malformed steps" |
| 4. Stepped answer form, option cards and Needs you rows | Frontend behavior | 2, 3 | processing-workspace "Answer a question step by step", "Answer kinds in the drawer", "Inventory session drawer"; pipeline Needs you rows |
| 5. Photo views and agent-reported web sources | Contracts and intake server | None | processing-agent-sessions "Photo views are recorded", "Agent-reported web page sources" |
| 6. Session history read and photo-view crops | Contracts and intake server | 3, 5 | processing-workspace "Expandable session history", "Lot-forming entries expand with links", "Proposal, question and failure entries expand with links", "Your inputs in the session history", "Reaching and reading the session page" (Long history, scope) |
| 7. Expandable timeline and the session page | Frontend behavior | 4, 6 | processing-workspace history requirements, "Drawer and session page split", "Agent session page", "Session page header and panels", "Reaching and reading the session page"; agents-overview "Agents page" |
| 8. Stage counts and the paused flag | Contracts and intake server | None | header-workflow-status "Stage rows in workflow details" (counts), "Stage bar states" (paused) |
| 9. Activity popover stage rows and bar states | Frontend behavior | 8 | header-workflow-status "Stage rows in workflow details", "Stage bar states", "Only working stages animate" |

## PR delivery map

| Bundle | Outcome and included work | Task coverage | Why this boundary | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-0 | This plan, BI-019 and the BI-015 hand-over | Planning only | Review the plan before code | None; first | `interactive-app` ← `docs/improve-agent-interaction`; `docs(improve-agent-interaction): plan agent interaction improvements` | `openspec validate --strict`, `pnpm workflow-sync` unaffected; read-only review; CI green |
| PR-A | Backdrop click closes every dialog | 1 | Small, independent and immediately useful | PR-0 | `feat/improve-agent-interaction-dialog-backdrop`; `fix(improve-agent-interaction): close dialogs from their backdrop` | Frontend typecheck, lint, tests and build; demo video; review; CI |
| PR-B | `/2` questions and answers end to end on the server, and agent guidance | 2, 3 | One contract plus its only server consumer; the frontend keeps working on `/1` meanwhile through the normalised read model | PR-0 | `feat/improve-agent-interaction-question-steps`; `feat(improve-agent-interaction): ask stepped questions with answer options` | Contracts tests, intake unit, PG and process tiers with the decoder and probe images; review; CI |
| PR-C | The drawer's stepped form, live option cards and Needs you rows | 4 | The UI over PR-B's contract | PR-B merged | `feat/improve-agent-interaction-answer-form`; `feat(improve-agent-interaction): answer agent questions step by step` | Frontend checks; demo video; review; CI |
| PR-D | Recorded photo views, web page sources, the paged history read and the photo-view crop route | 5, 6 | The server side of the history; the old timeline view keeps working until PR-E switches to it | PR-B merged (the history resolves `/2` questions) | `feat/improve-agent-interaction-session-history`; `feat(improve-agent-interaction): record and read a session's full history` | Contracts tests, intake unit, PG and process tiers; review; CI |
| PR-E | Expandable, grouped, linked entries in the drawer and the session page as a conversation | 7 | The UI over PR-D; one entry renderer for both places | PR-C and PR-D merged | `feat/improve-agent-interaction-session-page`; `feat(improve-agent-interaction): expandable agent history and session page` | Frontend checks; demo video; review; CI |
| PR-F | Per-stage counts and the paused flag, stage rows in the activity popover and the new bar states | 8, 9 | Independent of questions and history, small enough to review end to end | PR-0 | `feat/improve-agent-interaction-activity-stages`; `feat(improve-agent-interaction): show each stage's state and counts in the activity popover` | Contracts tests, intake PG tier, frontend checks; demo video; review; CI |

## 1. Dialogs close from their backdrop

- **PR delivery:** PR-A.
- **Outcome:** clicking the dimmed backdrop of any `Dialog` closes it through `onClose`. It is ignored while `closeDisabled` is set, and a press that starts inside the dialog never closes it.
- **Scope and approach:**
  - `frontend/src/components/ui/Dialog.tsx`: `pointerdown` and `click` on the `<dialog>`, with the rectangle check (see design).
  - Check `RemovalDialog`, `EvidenceGroupPanel` and the other direct `DialogSurface` users.
- **Prerequisites:** none.
- **Acceptance:** ui-design-system "Dialogs close from their backdrop", all scenarios; processing-workspace "Session drawer".
- **TDD approach:** `Dialog.test.tsx` cases fail first, because there is no backdrop handler.
- **Verification:**
  - `pnpm --filter frontend typecheck`, `lint`, `test` (the Dialog and ProcessingWorkspace drawer tests) and `build`;
  - a demo film.
- **Risks and decisions:** jsdom has no real layout, so tests stub `getBoundingClientRect`.

- [ ] 1.1 Read the shared and frontend code guidelines and the frontend architecture. List every `Dialog` and `DialogSurface` user and how each closes.
- [ ] 1.2 RED: add `Dialog.test.tsx` cases:
  - [ ] 1.2.1 A backdrop click calls `onClose`.
  - [ ] 1.2.2 A backdrop click with `closeDisabled` set doesn't call it.
  - [ ] 1.2.3 A press inside that is released on the backdrop doesn't close.
  - [ ] 1.2.4 A click on the content doesn't close.
- [ ] 1.3 RED: add a `ProcessingWorkspace` drawer test: a backdrop click with an unsaved answer shows the close-blocked banner.
- [ ] 1.4 GREEN: implement the handler. Move direct `DialogSurface` users onto it, or record each exception in `notes.md`.
- [ ] 1.5 Run the frontend checks. Record a demo video (title card, click outside the drawer, end card) for the PR description.

## 2. Stepped question contracts

- **PR delivery:** PR-B.
- **Outcome:** `/2` question and answer shapes, the envelope and inbox unions reading both versions, and the normalised question view for the read model.
- **Scope and approach:** `contracts/src/sessions.ts` and `processing.ts` (the read-model question DTO), plus tests in `contracts/tests/`. The shapes are in the design.
- **Prerequisites:** none.
- **Acceptance:** "Structured session questions" (limits and IDs); pipeline "Malformed steps" (contract-level limits).
- **TDD approach:** contract tests for the valid and invalid shapes fail before the schemas exist.
- **Verification:** `pnpm --filter @invimport/contracts test` and typecheck.
- **Risks and decisions:** keep `/1` exports unchanged, so the runner paths compile untouched.

- [ ] 2.1 Read the shared code guidelines and the contracts README. Confirm every consumer of `SessionAskArgs`, `ProcessingAnswer`, `SessionInboxItem` and the question DTO.
- [ ] 2.2 RED: tests for the `/2` ask, covering 1–4 steps, 2–6 options and the label, detail and prompt lengths. Add `/2` answer tests and envelope and inbox decoding of both versions.
- [ ] 2.3 GREEN: add the schemas, types and the normalised question view.
- [ ] 2.4 Run the contracts tests and the workspace typecheck.

## 3. Server: ask, answers and agent guidance

- **PR delivery:** PR-B.
- **Outcome:**
  - `ask` stores `/2` questions, with handler checks for unique IDs, one number step and a lot subject.
  - `/2` answers apply up to two capture edits atomically and deliver one inbox item with option IDs.
  - `/1` questions still answer.
  - The read model returns the normalised view.
  - The tool description, the runner instructions and the fakes are updated.
- **Scope and approach:**
  - `intake-server/src/agents/tools/handlers.ts` and `server.ts`;
  - `processing/session-answers.ts` and the question read in `processing/`;
  - `agents/session/session-runner.ts` (coordinate with `simplify-vm-agent-web-and-setup`);
  - `tests/fixtures/session-agent.cjs`; `agents/session/synthetic-turn.ts`.
- **Prerequisites:** task 2.
- **Acceptance:** "Agents ask one thing at a time", "Stepped answer effects" and "Stepped answers reach the session", all scenarios; "Structured session questions" "Invalid structure".
- **TDD approach:** PG-tier tests for the `ask` refusals, the atomic two-edit answer with rollback, idempotent retry and inbox delivery fail first. A process test runs the fake CLI's stepped ask end to end.
- **Verification:** `pnpm db:intake test` on the affected files, and `test:process` for sessions. Both need `INTAKE_MEDIA_DECODER_IMAGE` and `INTAKE_MEDIA_PROBE_IMAGE`.
- **Risks and decisions:** the note line format is "prompt — answer", one line per step; record any change in `notes.md`.

- [ ] 3.1 Read the shared and intake-server code guidelines and `intake-server/ARCHITECTURE.md`. Map where `/1` question specs are decoded for the read model and the answer route.
- [ ] 3.2 RED: write the `ask` handler PG tests.
  - [ ] 3.2.1 Store a valid `/2` question.
  - [ ] 3.2.2 Refuse duplicate step IDs or option IDs, two number steps, and a number step without a live lot.
- [ ] 3.3 RED: write the answer PG tests.
  - [ ] 3.3.1 A quantity plus a note, applied in one transaction.
  - [ ] 3.3.2 Rollback when the note edit is stale.
  - [ ] 3.3.3 Refusal of a wrong kind, an unknown option or a missing step.
  - [ ] 3.3.4 Idempotent retry.
  - [ ] 3.3.5 An inbox payload carrying the option ID.
  - [ ] 3.3.6 A `/1` answer still accepted.
- [ ] 3.4 GREEN: implement the `ask` and answer branches and the normalised read model.
- [ ] 3.5 Update the `ask` description and the runner's opening instructions. Teach the fake CLI and the synthetic session a stepped ask, and add a process test that answers it and reads the inbox.
- [ ] 3.6 Update `intake-server/src/agents/ARCHITECTURE.md` (the question shape and answer effects). Run the intake unit, PG and process tiers.

## 4. Stepped answer form, option cards and Needs you rows

- **PR delivery:** PR-C.
- **Outcome:** the canvas v70 design is built:
  - one-step answers;
  - Step N of M with Back and Next;
  - a check-your-answers summary;
  - option cards, with "Something else";
  - inline number errors and "Answer in words";
  - Needs you and Overview rows with kind, step count and assumptions;
  - the disabled option placeholders removed.
- **Scope and approach:**
  - `frontend/src/components/processing/QuestionAnswer.tsx`, `DrawerAnswers.tsx`;
  - `components/ui/QuestionCard.tsx`;
  - the Needs you and Overview rows (`components/batches/NeedsYouPanel.tsx`, `processing/ProcessingOverview.tsx`);
  - the processing fixtures.
- **Prerequisites:** task 3 merged.
- **Acceptance:** "Answer a question step by step" and "Answer kinds in the drawer", all scenarios; "Inventory session drawer"; pipeline "Related steps in one question" (row display).
- **TDD approach:** component tests for each scenario fail before the form changes. Existing pinned-draft tests keep passing.
- **Verification:**
  - the frontend typecheck, lint, tests and build;
  - a demo video of a stepped question answered with options, plus prose rejected in a number step and then answered in words.
- **Risks and decisions:** none open; a choice is picked, then sent.

- [ ] 4.1 Read the shared and frontend code guidelines, the frontend architecture and the canvas boards. A choice is picked, then sent (decided 2026-11-23).
- [ ] 4.2 RED: component tests:
  - [ ] 4.2.1 A one-step choice: send with Send, and "Something else" text.
  - [ ] 4.2.2 Steps: Back and Next, the summary with Change, and "Send N answers".
  - [ ] 4.2.3 A number step: the inline error for prose, blocked Next, and "Answer in words".
  - [ ] 4.2.4 The `/1` question fallback, and draft pinning across a supersede with every step kept.
  - [ ] 4.2.5 Needs you rows with kind, step count and assumptions.
- [ ] 4.3 GREEN: implement the form, the option cards and the rows. Remove `OPTIONS_NOT_CARRIED` and its placeholders.
- [ ] 4.4 Update the fixtures (`ProcessingProof`) with a stepped and a choice question for the demo. Update the frontend architecture if component ownership changes.
- [ ] 4.5 Run the frontend checks. Record the demo video for the PR description.

## 5. Photo views and agent-reported web sources

- **PR delivery:** PR-D.
- **Outcome:** each delivered `fetch_evidence` image appends a `photo_view` outbox item, and proposals can cite an agent-reported `web_page` URL.
- **Scope and approach:**
  - `contracts/src/sessions.ts` (the outbox union) and `processing.ts` (a `/6` proposal with the `web_page` source);
  - `intake-server/src/agents/tools/handlers.ts` (`fetchEvidenceImage`'s final transaction, and propose validation);
  - the `propose` tool description;
  - where Review and Inventory read sources, so `web_page` is treated as unverified.
- **Prerequisites:** none.
- **Acceptance:** "Photo views are recorded" and "Agent-reported web page sources", all scenarios.
- **TDD approach:** PG tests fail first for a delivered versus refused fetch, and for the `web_page` scheme, length and credential checks.
- **Verification:** contracts tests; `pnpm db:intake test` on the handler and evidence tests.
- **Risks and decisions:** every consumer of proposal sources must accept `/6`; list them in 5.1.

- [ ] 5.1 Read the shared and intake-server code guidelines. List every reader of the outbox union and of proposal sources.
- [ ] 5.2 RED: contract tests for `photo_view` and `web_page`. PG tests:
  - [ ] 5.2.1 A delivered fetch appends one `photo_view` with the delivered size and digest.
  - [ ] 5.2.2 A refused or over-budget fetch appends nothing.
  - [ ] 5.2.3 A `web_page` source is accepted for `https`, and refused for `file:`, credentials or a URL over 2048 characters.
- [ ] 5.3 GREEN: implement both. Make the source readers treat `web_page` as unverified.
- [ ] 5.4 Update the `propose` description to say how to cite a page read with WebFetch. Run the intake unit and PG tiers.

## 6. Session history read and photo-view crops

- **PR delivery:** PR-D.
- **Outcome:**
  - `readSessionHistory` returns resolved entries (summary, details, typed links, `who`, attempt headers) in pages of 200 with a `before` cursor;
  - the operator's inputs are included;
  - retired targets become "gone" links;
  - a session-scoped route recuts a photo view's crop.
- **Scope and approach:**
  - `contracts/src/sessions.ts` (`SessionHistory`, `SessionHistoryEntry`);
  - `intake-server/src/agents/tools/timeline.ts` and its route in `processing/routes.ts`;
  - `media/region-crops.ts` for the crop route.
  - Keep the current timeline response until PR-E switches over, then remove it in PR-E.
- **Prerequisites:** tasks 3 and 5.
- **Acceptance:** the history requirements' server-side scenarios: resolution per kind, "Linked record no longer exists", "Answer in the history", "Long history", and "Session from another batch or account".
- **TDD approach:** PG tests per entry kind, plus pagination and scope, fail first against the new read.
- **Verification:** `pnpm db:intake test` on the timeline and route tests, and a process test reading a fake session's history.
- **Risks and decisions:** resolution must stay one query per kind, not one per entry; check the plans in 6.5.

- [ ] 6.1 Read the intake-server architecture. Map how each outbox and inbox kind resolves to labels, state and links.
- [ ] 6.2 RED: PG tests:
  - [ ] 6.2.1 Each entry kind resolves its summary, details and links.
  - [ ] 6.2.2 A retired lot or a removed version gives a "gone" link.
  - [ ] 6.2.3 Answers, instructions, evidence and revise items appear as the operator's.
  - [ ] 6.2.4 Attempt headers say why an attempt started and how it ended.
  - [ ] 6.2.5 The `before` cursor pages without duplicates.
  - [ ] 6.2.6 Another batch or account gets `session_not_found`.
- [ ] 6.3 RED: route tests for the photo-view crop: the delivered region, 404 for a removed version, and scope.
- [ ] 6.4 GREEN: implement the read, the contract and the crop route.
- [ ] 6.5 Check the queries batch per kind, and update `intake-server/src/agents/ARCHITECTURE.md`. Run the intake unit, PG and process tiers.

## 7. Expandable timeline and the session page

- **PR delivery:** PR-E.
- **Outcome:**
  - one entry renderer (native `<details>`) with typed links and grouping;
  - the drawer's history with summary lines for photo views and web reads, and "Open full session";
  - the batch-scoped session page as a conversation (option B): action rows, chat bubbles, question cards answered in place, the operator's inputs, attempt dividers, filter chips, Load older, the live merge, a message box, the photos it viewed, the sources it cited and debug details;
  - Agents page rows and failure details link to it.
- **Scope and approach:**
  - `frontend/src/components/processing/SessionTimeline.tsx` and a new session page component;
  - `navigation/batch-route.ts` (the `sessionJobId` route);
  - `components/agents/AgentSessions.tsx`, `SessionFailureDetails.tsx`;
  - the processing fixtures;
  - removal of the old timeline response.
- **Prerequisites:** tasks 4 and 6.
- **Acceptance:** "Expandable session history", "Lot-forming entries expand with links", "Proposal, question and failure entries expand with links", "Your inputs in the session history", "Drawer and session page split", "Agent session page", "Session page header and panels", "Reaching and reading the session page" (including "Message from the page" and "Answer on the page"), and agents-overview "Open a session's page".
- **TDD approach:** component and route tests per scenario fail first, before the renderer and page exist.
- **Verification:**
  - the frontend typecheck, lint, tests and build;
  - a demo video expanding entries in the drawer, following links, opening the session page, filtering and loading older entries;
  - a phone-width check of the page.
- **Risks and decisions:** keep the drawer light; it reads only the newest page.

- [ ] 7.1 Read the shared and frontend code guidelines, the frontend architecture and the canvas boards (option B is the page layout).
- [ ] 7.2 RED: route tests for parsing and building the session page route.
- [ ] 7.3 RED: renderer tests:
  - [ ] 7.3.1 Each kind's details and links.
  - [ ] 7.3.2 "gone" links.
  - [ ] 7.3.3 Grouping of consecutive entries.
  - [ ] 7.3.4 The drawer's summary lines and "Open full session".
- [ ] 7.4 RED: page tests:
  - [ ] 7.4.1 One conversation in time order, with attempt dividers.
  - [ ] 7.4.2 Filter chips, Load older, and the live merge without duplicates.
  - [ ] 7.4.3 Sending a message once.
  - [ ] 7.4.4 Answering a question in place, with the drawer's draft shown as superseded.
  - [ ] 7.4.5 Not found, and the debug block only in debug mode.
- [ ] 7.5 GREEN: implement the renderer, the drawer change, the page and the entry points (Agents rows, session lists, failure details). Remove the old timeline response.
- [ ] 7.6 Update the fixtures and the frontend architecture. Run the frontend checks, and record the demo video for the PR description.

## 8. Stage counts and the paused flag

- **PR delivery:** PR-F.
- **Outcome:** the header and attention reads count each step's `waiting`, `queued` and `questions`, the Examine step's `lots`, and the batch's `paused` flag.
- **Scope and approach:** `contracts/src/header.ts` (`stepJobs`, batch step entries), `contracts/src/attention.ts` (`stepWork`), `intake-server/src/header/processing.ts`, `work.ts` and the attention read, using `agents/pause.ts` for paused.
- **Prerequisites:** none.
- **Acceptance:** the counts in "Stage rows for a working batch", "No count for a stage" and "Paused batch".
- **TDD approach:** PG tests asserting the new counts for a batch with waiting, queued, running and paused work fail first.
- **Verification:** contracts tests; `pnpm db:intake test` on the header and attention tests.
- **Risks and decisions:** keep the counts in the existing queries; no extra per-step query.

- [ ] 8.1 Read the shared and intake-server code guidelines. Map how `stepJobs` and `stepWork` are counted today.
- [ ] 8.2 RED: contract tests for the new fields. PG tests for a batch with one waiting-for-you, one queued, one running and one ready job, with open questions, retired lots and a paused batch.
- [ ] 8.3 GREEN: implement the counts and the paused flag in both reads.
- [ ] 8.4 Run the contracts tests and the intake unit and PG tiers.

## 9. Activity popover stage rows and bar states

- **PR delivery:** PR-F.
- **Outcome:**
  - `ProgressSegments` draws done, working, waiting for you, paused, queued, not started and failed, each with its own pattern or glyph;
  - only working animates, and nothing does under reduced motion;
  - no fill is invented without counts;
  - the popover is 520 px on desktop, with stage rows linking to step pages and showing counts, a state pill and a status line;
  - a paused batch offers Resume.
- **Scope and approach:** `frontend/src/components/ui/ProgressSegments.tsx`, `header/workSegments.ts`, `components/masthead/ActivityPopover.tsx`, `ActivityIndicator.tsx`, `processing/ProcessingOverview.tsx` (the shared bar), and the component gallery.
- **Prerequisites:** task 8.
- **Acceptance:** "Stage rows in workflow details", "Stage bar states" and "Only working stages animate", all scenarios.
- **TDD approach:** `workSegments` and `ProgressSegments` tests for each state, and popover tests for rows, links and Resume, fail first.
- **Verification:**
  - the frontend typecheck, lint, tests and build;
  - a demo video of the popover with a working, a waiting-for-you and a paused stage;
  - a reduced-motion check.
- **Risks and decisions:** the Processing overview uses the same bar, so check it in the demo too.

- [ ] 9.1 Read the shared and frontend code guidelines, the frontend architecture and the D42 board.
- [ ] 9.2 RED: `workSegments` tests:
  - [ ] 9.2.1 State precedence.
  - [ ] 9.2.2 No fill without counts.
  - [ ] 9.2.3 Examine waiting on questions reads as waiting for you.
- [ ] 9.3 RED: tests for `ProgressSegments`' states, patterns and animation (only working, none under reduced motion), and for the popover's stage rows, links, counts, status lines and Resume.
- [ ] 9.4 GREEN: implement the states, the popover layout and the rows. Update the component gallery.
- [ ] 9.5 Run the frontend checks. Record the demo video for the PR description.

## Delivery evidence and lifecycle follow-up

- [ ] PR-0: review the plan read-only (`codex exec -m gpt-6.2-sol -s read-only`, at most three rounds), fix findings, publish, CI green, merge.
- [ ] PR-A: implement task 1, review the exact head, publish with the demo, CI green, merge.
- [ ] PR-B: implement tasks 2 and 3, review the exact head, publish, CI green, merge.
- [ ] PR-C: implement task 4, review the exact head, publish with the demo, CI green, merge.
- [ ] PR-D: implement tasks 5 and 6, review the exact head, publish, CI green, merge.
- [ ] PR-E: implement task 7, review the exact head, publish with the demo, CI green, merge.
- [ ] PR-F: implement tasks 8 and 9, review the exact head, publish with the demo, CI green, merge.
- [ ] Update BI-019's status as PRs merge. It is Done only after PR-E and PR-F merge and its acceptance is evidenced.
- [ ] Mark the design log entries D37, D39, D41 and D42 Built (D40's page layout was replaced by D41), with their PRs.
- [ ] Before archiving, run `pnpm openspec:overlap --change improve-agent-interaction`, sync the specs, and record final open items in `notes.md`.
