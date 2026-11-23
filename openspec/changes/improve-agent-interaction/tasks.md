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
| 2. Stepped question contracts | Contracts | None | processing-agent-sessions "Structured session questions" (limits and IDs); processing-stage-pipeline "Non-blocking questions with assumptions" (contract limits) |
| 3. Server: ask, answers and agent guidance | Intake server | 2 | processing-agent-sessions "Structured session questions", "Agents ask one thing at a time", "Stepped answer effects", "Stepped answers reach the session"; pipeline "Malformed steps", "Agent asks without an assumption" |
| 4. Stepped answer form, option cards and Needs you rows | Frontend behavior | 2, 3 | processing-workspace "Answer a question step by step", "Answer kinds in the drawer", "Inventory session drawer"; pipeline "Unclear quantity" and "Related steps in one question" (Needs you rows) |
| 5. Photo views and agent-reported web sources | Contracts, migration and intake server | None | processing-agent-sessions "Photo views are recorded", "Agent-reported web page sources" ("Invalid URL", and acceptance in "Cited datasheet"), "Bounded status lines and delivered citations" |
| 6. Session history read and photo-view crops | Contracts and intake server | 3, 5 | processing-workspace "Expandable session history", "Lot-forming entries expand with links", "Proposal, question and failure entries expand with links", "Your inputs in the session history", "Reaching and reading the session page" (Long history, scope) |
| 7. Expandable timeline and the session page | Frontend behavior | 4, 6 | processing-workspace history requirements, "Drawer and session page split", "Agent session page", "Session page header and panels", "Reaching and reading the session page"; agents-overview "Agents page" ("Open a session's page"); processing-agent-sessions "Cited datasheet" (web read on the session page) |
| 8. Stage counts and the paused flag | Contracts and intake server | None | header-workflow-status "Stage rows in workflow details" (counts), "Stage bar states" (paused) |
| 9. Activity popover stage rows and bar states | Frontend behavior | 8 | header-workflow-status "Stage rows in workflow details", "Stage bar states", "Only working stages animate", "Expand work steps and existing actions" (Resume) |
| 10. Session rows, failures in plain words and Agents filters | Contracts, intake server and frontend | 7; 9 or polish for the shared components | agents-overview "Agents page", "Session rows", "Failed rows offer recovery"; processing-workspace "Failures in plain words" |
| 11. Drawer header, activity feed and message box | Contracts, intake server and frontend, plus one instruction sentence | 6, 7, 10; 9 or polish for the shared components | processing-workspace "Session drawer header", "Activity in the app's words", "Labelled message box"; processing-agent-sessions "Status lines stay readable" |

## PR delivery map

Every implementation bundle targets `interactive-app` once its listed prerequisites have merged.

| Bundle | Outcome and included work | Task coverage | Why this boundary | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-0 | This plan, BI-019 and the BI-015 hand-over | Planning only | Review the plan before code | None; first | `interactive-app` ← `docs/improve-agent-interaction`; `docs(improve-agent-interaction): plan agent interaction improvements` | `openspec validate --strict`, `pnpm workflow-sync` unaffected; read-only review; CI green |
| PR-A | Backdrop click closes every dialog | 1 | Small, independent and immediately useful | PR-0 | `feat/improve-agent-interaction-dialog-backdrop`; `fix(improve-agent-interaction): close dialogs from their backdrop` | Frontend typecheck, lint, tests and build; demo video; review; CI |
| PR-B | `/2` questions and answers end to end: contracts, the server path, agent guidance, and the drawer's stepped form, live option cards and Needs you rows | 2, 3, 4 | Today's form can't answer a `/2` question, so the ask and the form that answers it ship together; no build asks questions its UI can't answer | PR-0 | `feat/improve-agent-interaction-question-steps`; `feat(improve-agent-interaction): ask and answer stepped questions with options` | Contracts tests, intake unit, PG and process tiers with the decoder and probe images; frontend checks; demo video; rollback note and the session worker rollout steps in the PR body; review; CI |
| PR-D | Recorded photo views, web page sources, the paged history read with session metadata and the photo-view crop route | 5, 6 | The server side of the history; the old timeline view keeps working until PR-E switches to it | PR-B merged (the history resolves `/2` questions) | `feat/improve-agent-interaction-session-history`; `feat(improve-agent-interaction): record and read a session's full history` | Contracts tests, intake unit, PG and process tiers; frontend checks, since the existing source list and timeline must read `/6` proposals and photo views; rollback note and the session worker rollout steps in the PR body; review; CI |
| PR-E | Expandable, grouped, linked entries in the drawer and the session page as a conversation | 7 | The UI over PR-D; one entry renderer for both places | PR-B and PR-D merged | `feat/improve-agent-interaction-session-page`; `feat(improve-agent-interaction): expandable agent history and session page` | Frontend checks; intake unit and PG tiers for the timeline route removal and its consumers; demo video; review; CI |
| PR-G | A session-level Agents read, one row per session, failures in plain words, recovery actions and the Agents page filters | 10 | One read and its rows; its links and failure display reach the session page | PR-E merged, and PR-F or polish merged for the shared components | `feat/improve-agent-interaction-session-rows`; `feat(improve-agent-interaction): one row per session with its real failure` | Contracts tests, intake unit and PG tiers, frontend checks; demo video; review; CI |
| PR-H | Drawer header, recent activity in the app's words, the labelled message box and readable status lines | 11 | Builds on the history read, the session page and the session-level read | PR-D, PR-E and PR-G merged, and PR-F or polish merged for the shared components | `feat/improve-agent-interaction-session-details`; `feat(improve-agent-interaction): clearer session header, activity and message box` | Contracts tests, intake unit and PG tiers for the batch activity read and the instruction text, frontend checks; demo video; review; CI |
| PR-F | Per-stage counts and the paused flag, stage rows in the activity popover and the new bar states; the shared `WorkState`, `StatePill` and `EventTime` components if `polish-ui-styling-and-loading` hasn't merged first | 8, 9 | Independent of questions and history, small enough to review end to end | PR-0; whichever of PR-F and polish merges second reuses the other's shared components | `feat/improve-agent-interaction-activity-stages`; `feat(improve-agent-interaction): show each stage's state and counts in the activity popover` | Contracts tests, intake PG tier, frontend checks; demo video; review; CI |

## 1. Dialogs close from their backdrop

- **PR delivery:** PR-A.
- **Outcome:** clicking the dimmed backdrop of any `Dialog` closes it through `onClose`. It is ignored while `closeDisabled` is set, and a press that starts inside the dialog never closes it.
- **Scope and approach:**
  - `frontend/src/components/ui/Dialog.tsx`: `pointerdown` and `click` on the `<dialog>`, with the rectangle check (see design).
  - `MediaCropDialog`, the one direct `DialogSurface` user, gets the same handling through its own close guard. `RemovalDialog` and `EvidenceGroupPanel` already use `Dialog`.
- **Prerequisites:** none.
- **Acceptance:** ui-design-system "Dialogs close from their backdrop", all scenarios; processing-workspace "Step page pattern", scenario "Session drawer".
- **TDD approach:** `Dialog.test.tsx` cases fail first, because there is no backdrop handler.
- **Verification:**
  - `pnpm --filter frontend typecheck`, `lint`, `test` (the Dialog and ProcessingWorkspace drawer tests) and `build`;
  - a demo film.
- **Risks and decisions:** jsdom has no real layout, so tests stub `getBoundingClientRect`.

- [ ] 1.1 Read the shared and frontend code guidelines and the frontend architecture. List every `Dialog` and `DialogSurface` user and how each closes.
- [ ] 1.2 RED: add `Dialog.test.tsx` cases:
  - [ ] 1.2.1 A backdrop click calls `onClose`.
  - [ ] 1.2.2 A backdrop click with `closeDisabled` set doesn't call it.
  - [ ] 1.2.3 A press inside that is released on the backdrop doesn't close, including a press on the surface's padding where both events target the dialog itself.
  - [ ] 1.2.4 A click on the content doesn't close.
- [ ] 1.3 RED: add a `ProcessingWorkspace` drawer test: a backdrop click with an unsaved answer shows the close-blocked banner.
- [ ] 1.4 GREEN: implement the handler, and give `MediaCropDialog` the same backdrop handling through its close guard, with a test.
- [ ] 1.5 Run the frontend checks. Record a demo video (title card, click outside the drawer, end card) for the PR description.

## 2. Stepped question contracts

- **PR delivery:** PR-B.
- **Outcome:** `/2` question and answer shapes, the envelope and inbox unions reading both versions, and the normalised question view for the read model.
- **Scope and approach:** `contracts/src/sessions.ts` and `processing.ts` (the read-model question DTO), and `attention.ts` (the attention item gains the question's title, kind or step count and per-step assumptions); the error body's optional `step_id` for `invalid_answer`, kept on `IntakeRequestError` by `client-policy.ts`; plus tests in `contracts/tests/`. The shapes are in the design.
- **Prerequisites:** none.
- **Acceptance:** "Structured session questions", scenario "Invalid structure" (contract limits); pipeline "Malformed steps" (contract limits).
- **TDD approach:** contract tests for the valid and invalid shapes fail before the schemas exist.
- **Verification:** `pnpm --filter @invimport/contracts test` and typecheck.
- **Risks and decisions:** keep `/1` exports unchanged, so the runner paths compile untouched. The question DTO becomes a version-discriminated union: the `/1` variant keeps `spec`, the `/2` variant carries its steps, and both carry the shared fields and the normalised view (see design).

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
  - `processing/session-answers.ts` and the question read in `processing/`, and the error handler in `processing/routes.ts`, which sends `step_id` with an `invalid_answer` that names a step; the answer route and `answerQuestion` in `processing/answers.ts`, which validate the widened `ProcessingAnswer` and so must refuse a `/2` answer for an earlier runner question before its profile branch dereferences `input.value`;
  - `attention/projection.ts`, whose question items today carry only `spec.prompt` and one assumption, so the masthead's Needs you rows get the normalised view;
  - `capture/repository.ts`: an ordered form of the locked edit handle that applies several edits under one lock and publishes once;
  - `agents/session/session-runner.ts` (coordinate with `simplify-vm-agent-web-and-setup`);
  - `tests/fixtures/session-agent.cjs`; `agents/session/synthetic-turn.ts`.
- **Prerequisites:** task 2.
- **Acceptance:** "Agents ask one thing at a time", "Stepped answer effects" and "Stepped answers reach the session", all scenarios; "Structured session questions", scenarios "Valid choice question" and "Invalid structure"; pipeline "Malformed steps", "Agent asks without an assumption" and "Unclear quantity" (stored and the session continues).
- **TDD approach:** PG-tier tests for the `ask` refusals, the atomic two-edit answer with rollback, idempotent retry and inbox delivery fail first. A process test runs the fake CLI's stepped ask end to end.
- **Verification:** `pnpm db:intake test` on the affected files, and `test:process` for sessions. Both need `INTAKE_MEDIA_DECODER_IMAGE` and `INTAKE_MEDIA_PROBE_IMAGE`.
- **Risks and decisions:** the note line format is "prompt — answer", one line per step; record any change in `notes.md`. The `ask` tool must not advertise `/2` in a build without task 4's form, which is why tasks 2–4 share PR-B.

- [ ] 3.1 Read the shared and intake-server code guidelines and `intake-server/ARCHITECTURE.md`. Map where `/1` question specs are decoded for the read model and the answer route.
- [ ] 3.2 RED: write the `ask` handler PG tests.
  - [ ] 3.2.1 Store a valid `/2` question.
  - [ ] 3.2.2 Refuse duplicate step IDs or option IDs, two number steps, a number step without a live lot, and a number step whose question doesn't list `quantity` in its fields, asserting that each tool response names the affected step by index or ID; and schema refusals (five steps, one option) whose issue paths name `/steps` or the step's options.
- [ ] 3.3 RED: write the answer PG tests.
  - [ ] 3.3.1 A quantity plus a note, applied in one transaction.
  - [ ] 3.3.2 Rollback when the note edit is refused after the quantity edit, with the refusal injected.
  - [ ] 3.3.3 Refusal of a combined note over the 8192-character limit, before any edit, with the response naming the step, and of an answer whose note fits but whose payload, measured as PostgreSQL's `jsonb` text, exceeds 32,768 bytes, including one that fits as compact JSON.
  - [ ] 3.3.4 Refusal of a wrong kind, an unknown option or a missing step.
  - [ ] 3.3.5 A number step answered in words is accepted: the text reaches the inbox, the note is written and the lot quantity is unchanged.
  - [ ] 3.3.6 Same-key replay returns the first receipt; a different payload under that key is refused; a new key with the same payload adopts the answer; a new key with a different payload gets `payload_conflict`.
  - [ ] 3.3.7 A number answer marks a proposal relying on the lot's quantity stale.
  - [ ] 3.3.8 An inbox payload carrying the option ID and the number step's basis.
  - [ ] 3.3.9 A `/1` answer still accepted.
  - [ ] 3.3.10 A `/2` answer to an earlier runner question is refused before the runner branch reads `input.value`, and retained `/1` runner answers still succeed.
- [ ] 3.4 RED: an attention read PG test with an open `/2` stepped question, a `/1` session question and an earlier runner question, each carrying its title and kind or step count, with assumptions where recorded and none for the runner question; `/2` lot and Part questions count against their affected lots.
- [ ] 3.5 GREEN: implement the `ask` and answer branches and the normalised read model.
- [ ] 3.6 Update the `ask` description and the runner's opening instructions. Teach the fake CLI and the synthetic session a stepped ask, and add a process test that answers it and reads the inbox.
- [ ] 3.7 Update `intake-server/src/agents/ARCHITECTURE.md` (the question shape and answer effects). Run the intake unit, PG and process tiers, including a read of a database already holding `/2` questions and answers.

## 4. Stepped answer form, option cards and Needs you rows

- **PR delivery:** PR-B.
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
  - `SessionChatPanel.tsx`, whose `answerText` reads `payload.value` and would throw on a stepped answer, so it reads both answer payloads;
  - `QuestionAnswer.tsx`'s submit handler, so a confirmed `invalid_answer` clears the pinned submission and marks the named step, while an uncertain failure keeps the original payload and key; and `perform()` in `ProcessingWorkspace.tsx`, which today replaces every failure with `processing_command_not_confirmed`, so it rethrows a confirmed `invalid_answer` with its code and `step_id`;
  - the readers of `question.spec.subject_id`, which move to the shared `subject_id`: `operator/review-model.ts` (which lots show an answer form in Review) and, in task 3, `attention/projection.ts`;
  - the other readers of `question.spec.kind`, `prompt` or `reason`, which move to the normalised view: `ProcessingInventory.tsx` (open questions beside the comparison), `ProcessingJobCard.tsx`, `ProcessingWorkspace.tsx` and `processing/source.ts`;
  - the processing fixtures.
- **Prerequisites:** tasks 2 and 3, in the same PR.
- **Acceptance:** "Answer a question step by step" and "Answer kinds in the drawer", all scenarios; "Inventory session drawer"; pipeline "Unclear quantity" and "Related steps in one question" (Needs you rows).
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
  - [ ] 4.2.5 Needs you rows with kind, step count and assumptions, from the attention read.
  - [ ] 4.2.6 Review shows the answer form on the affected lot for `/2` lot and Part questions, through the shared `subject_id`.
  - [ ] 4.2.7 A `/2` question on the Inventory step, on a job card and in Review shows its title, steps and `reason` from the shared fields, the Inventory comparison included, and a `/1` question shows as before.
  - [ ] 4.2.8 The drawer's chat renders after a `/2` answer is saved, with `/1` and `/2` answers both in its timeline.
  - [ ] 4.2.9 A confirmed 422 naming a step, submitted from the drawer through `perform()`, keeps the draft editable and marks that step; an uncertain failure retries only the original payload and key.
- [ ] 4.3 GREEN: implement the form, the option cards and the rows. Remove `OPTIONS_NOT_CARRIED` and its placeholders.
- [ ] 4.4 Update the fixtures (`ProcessingProof`) with a stepped and a choice question for the demo. Update the frontend architecture if component ownership changes.
- [ ] 4.5 Run the frontend checks. Record the demo video for the PR description.

## 5. Photo views and agent-reported web sources

- **PR delivery:** PR-D.
- **Outcome:** each delivered `fetch_evidence` image appends a `photo_view` outbox item, and proposals can cite an agent-reported `web_page` URL.
- **Scope and approach:**
  - `contracts/src/sessions.ts`: the outbox union, and `SessionProposeArgs` and the `SessionEnvelope` proposal variant, which accept only `/5` today and validate before the retained decoder sees the version, so both accept `/5` and `/6`; `processing.ts`: a `/6` session proposal accepting a `web_page` source in its top-level `sources`, and the validated Processing projection;
  - a migration extending the outbox `kind` check (0018) to allow `photo_view`;
  - `intake-server/src/agents/tools/handlers.ts`: `fetchEvidenceImage` reserves the image budget before its final transaction and appends the view in it; it releases the reservation on a refusal or a known rollback, and keeps it on a commit with an unknown outcome, returning no image in either case; the delivered-citation check skips `web_page`;
  - the `propose` tool description;
  - where Review and Inventory read sources, so `web_page` is treated as unverified;
  - the existing frontend readers, so they keep working before PR-E: `ProcessingSources.tsx` shows a `web_page` source as a "Web page" chip marked agent-reported instead of assuming a `receipt_id`, and the old `SessionTimeline.tsx` gives `photo_view` a plain label rather than its raw kind.
- **Prerequisites:** none.
- **Acceptance:** "Photo views are recorded", all scenarios; "Agent-reported web page sources", scenario "Invalid URL", and the proposal's acceptance and its agent-reported chip in "Cited datasheet"; "Bounded status lines and delivered citations". Task 7 owns the session page's web-read entry.
- **TDD approach:** PG tests fail first for a delivered versus refused fetch, and for the `web_page` scheme, length and credential checks.
- **Verification:** contracts tests; `pnpm db:intake test` on the handler and evidence tests; the frontend typecheck, lint and tests.
- **Risks and decisions:** every consumer of proposal sources must accept `/6`; list them in 5.1.

- [ ] 5.1 Read the shared and intake-server code guidelines. List every reader of the outbox union and of proposal sources.
- [ ] 5.2 RED: contract tests for `photo_view` and `web_page`. PG tests:
  - [ ] 5.2.1 A delivered fetch appends one `photo_view` with the delivered size and digest, and publishes `session_changed` in the same transaction.
  - [ ] 5.2.2 Through the MCP endpoint, a commit with an unknown outcome returns the uncertain-outcome result and no image, not "changed nothing". A refused or over-budget fetch appends nothing, and a refused final transaction releases the budget and returns no image, including when a removal, a capability revocation, or a cancellation or supersession committed after encoding but before the capability is revoked races the final transaction; a commit with an unknown outcome keeps the reservation and returns no image.
  - [ ] 5.2.3 A `web_page` source is accepted for `https` without a delivery check, refused for `file:`, credentials or a URL over 2048 characters, and refused in `relies_on` or catalogue sources.
  - [ ] 5.2.4 A `/6` proposal with a `web_page` source goes through the advertised `propose` tool, is stored, and reads through the retained decoder and the ordinary Processing snapshot read, beside a retained `/5` proposal.
  - [ ] 5.2.5 Frontend: the existing source list shows a stored `/6` proposal's `web_page` source as a "Web page" chip marked agent-reported, and the old timeline labels a `photo_view`.
- [ ] 5.3 GREEN: implement both. Make the source readers treat `web_page` as unverified.
- [ ] 5.4 Update the `propose` description to say how to cite a page read with WebFetch. Run the intake unit and PG tiers.

## 6. Session history read and photo-view crops

- **PR delivery:** PR-D.
- **Outcome:**
  - `readSessionHistory` returns resolved entries (summary, details, typed links, `who`, attempt headers), newest page first, in pages of 200 with one opaque `before` cursor and no forward read, each page and its metadata taken from one snapshot;
  - the operator's inputs are included;
  - the same scoped read returns the session's metadata: each attempt's number, state and times, the agent selection and model, where it ran and its sealed web setting;
  - retired targets become "gone" links;
  - a session-scoped route recuts a photo view's crop.
- **Scope and approach:**
  - `contracts/src/sessions.ts` (`SessionHistory`, `SessionHistoryEntry`, and `moves` on new regroup outbox items);
  - `regroup` in `capture/evidence-observations.ts`, which returns each move's outcome, and the regroup handler, which records the moves with their source lots and outcomes;
  - `read_inbox` in `agents/tools/handlers.ts`, which publishes `session_changed` when it advances the acknowledgement cursor;
  - `intake-server/src/agents/tools/timeline.ts` and its route in `processing/routes.ts`;
  - `media/region-crops.ts` for the crop route, `GET …/photo-views/:attemptId/:seq/crop`.
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
  - [ ] 6.2.3 With rows written by the existing append paths, answers and chat appear as the operator's from their actor, an instruction saved before a Start fresh and relayed to the new attempt placed at its relay time, with its save time in its details and labelled relayed, and `evidence` and `revision` notices (including an identity revision from another session) as the app's, and one above the acknowledgement cursor reads as not read yet; a `read_inbox` call that advances the cursor publishes `session_changed` in its transaction, and one that doesn't move it publishes nothing.
  - [ ] 6.2.4 Attempt headers say how an attempt ended, and why it started where the retained input shows it; turns within an attempt are not attempts; a failure or resume with no new inbox or outbox item still updates its header on the next read; the span runs from the queue time, not a turn's `started_at`; an attempt cancelled before its first turn, one cancelled after a settled turn, an idle attempt superseded by Start fresh after a prior turn, and an attempt that finished, was resumed and was then cancelled show the end time of their latest terminal transition, not an earlier turn's.
  - [ ] 6.2.5 A regroup with recorded moves shows them, and a mixed regroup shows which moves were applied and which only suggested; an older regroup lists its destination lots; an observation revised in place shows its values labelled current in both its entries; earlier attempts' failures resolve; a lot edited after formation shows its values labelled current, and after an operator's quantity change shows the selected quantity apart from the agent's estimate and basis.
  - [ ] 6.2.6 The `before` cursor pages without gaps or duplicates across retries with repeated sequences and equal timestamps, and across inbox and outbox rows with equal timestamps; the page, its cursor and the metadata come from one snapshot; every read returns the metadata and acknowledgement cursor, including a read of the newest page with no new entries.
  - [ ] 6.2.7 A proposal links every open question that makes it provisional, with two matching questions.
  - [ ] 6.2.8 The session metadata for a retried session, including the web setting from each attempt's manifest.
  - [ ] 6.2.9 Another batch or account gets `session_not_found`.
- [ ] 6.3 RED: route tests for the photo-view crop: the recorded region bounded as delivered, a full-page view, two attempts with the same sequence, 404 for a removed version, and scope.
- [ ] 6.4 GREEN: implement the read, the contract and the crop route.
- [ ] 6.5 Check the queries batch per kind, and update `intake-server/src/agents/ARCHITECTURE.md`. Run the intake unit, PG and process tiers, including a read of a database already holding `/6` proposals and photo views.

## 7. Expandable timeline and the session page

- **PR delivery:** PR-E.
- **Outcome:**
  - one entry renderer (native `<details>`) with typed links and grouping;
  - the drawer's history with summary lines for photo views and web reads, and "Open full session";
  - the batch-scoped session page as a conversation (option B): action rows, chat bubbles, question cards answered in place, the operator's inputs, attempt dividers, filter chips, Load older, a refresh that re-reads the newest page, a message box, the photos it viewed, the sources it cited and debug details;
  - Agents page rows and failure details link to it;
  - `web_page` source chips marked agent-reported, and web reads on the page.
- **Scope and approach:**
  - `frontend/src/components/processing/SessionTimeline.tsx` and a new session page component;
  - `navigation/batch-route.ts` (the `sessionJobId` route, and a Capture route naming one photo, which shows "Photo removed" for a removed one);
  - `components/agents/AgentSessions.tsx`, `SessionFailureDetails.tsx`;
  - the processing fixtures;
  - removal of the old timeline response.
- **Prerequisites:** tasks 4 and 6.
- **Acceptance:** "Expandable session history", "Lot-forming entries expand with links", "Proposal, question and failure entries expand with links", "Your inputs in the session history", "Drawer and session page split", "Agent session page", "Session page header and panels", "Reaching and reading the session page" (including "Message from the page", "Answer on the page", "Long history" and "Many entries between refreshes"), and agents-overview "Open a session's page"; processing-agent-sessions "Cited datasheet" (the web read on the session page). The Start fresh clause of "Proposal, question and failure entries expand with links" belongs to task 10; this task shows the failure summary and its details link.
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
  - [ ] 7.4.1 One conversation in time order, with attempt dividers, including one whose reason isn't retained and reads only "Attempt N".
  - [ ] 7.4.2 Filter chips and Load older; an invalidation re-reads the newest page and replaces it, keeping loaded older pages without duplicates; one new entry keeps the entry it pushed off the newest page; more than one page of new entries between refreshes drops the older pages and Load older continues from the new page; answering a matching question in another job refreshes a proposal's provisional links on the newest page; a chat sent from another tab shows after the next invalidation, and an acknowledgement with no new entry shows through the `session_changed` that `read_inbox` publishes.
  - [ ] 7.4.3 Sending a message once.
  - [ ] 7.4.4 Answering a question in place, with the drawer's draft shown as superseded, and commands disabled while the page's Processing read is loading, failed or paused, including a warm cache whose mounted read is still pending.
  - [ ] 7.4.5 Not found, and the debug block only in debug mode.
  - [ ] 7.4.6 A correction sent before a Start fresh sits at its send time, shown as the app's notice of the operator's correction; observations from different photos stay ungrouped; a mixed photo and web run is one drawer line.
  - [ ] 7.4.7 The photos and sources panels on a long session say older entries are not loaded, and list an older photo view and source once Load older loads them.
- [ ] 7.5 GREEN: implement the renderer, the drawer change, the page and the entry points (Agents rows, session lists, failure details). Remove the old timeline response.
- [ ] 7.6 Update the fixtures and the frontend architecture. Run the frontend checks, and the intake unit and PG tiers for the removed timeline response and its consumers. Record the demo video for the PR description.

## 8. Stage counts and the paused flag

- **PR delivery:** PR-F.
- **Outcome:** the header and attention reads count each step's `waiting`, `queued`, `questions` and `ready_lots`, the header read also each step's `failed`, the batch's live `lots`, and the batch's `paused` flag; each `active_sessions` entry gains `current`, whether its attempt is its job's current one; the header read also lists the scoped paused batches in `paused_batches`, up to 20 with a `truncated` flag.
- **Scope and approach:** `contracts/src/header.ts` (`stepJobs`, batch step entries, `paused_batches`), `contracts/src/attention.ts` (`stepWork`), `intake-server/src/header/processing.ts`, `work.ts` and the attention read, using `agents/pause.ts` for paused.
- **Prerequisites:** none.
- **Acceptance:** the counts in "Stage rows for a working batch", "No count for a stage" and "Paused batch"; the `current` flag behind "Cancelled attempt still holding a slot".
- **TDD approach:** PG tests asserting the new counts for a batch with waiting, queued, running and paused work fail first.
- **Verification:** contracts tests; `pnpm db:intake test` on the header and attention tests.
- **Risks and decisions:** keep the counts in the existing queries; no extra per-step query.

- [ ] 8.1 Read the shared and intake-server code guidelines. Map how `stepJobs` and `stepWork` are counted today.
- [ ] 8.2 RED: contract tests for the new fields. PG tests for a batch with one waiting-for-you, one queued, one running and one ready job, with open questions, retired lots, a stage with live lots but no jobs yet, a ready Part job beside a live lot with no job at that step, a paused batch, a batch paused with no jobs, more than five paused batches with one that has no work (in `paused_batches`, not cut by the `batch_steps` cap), more than 20 (truncated), `current` false on an attempt superseded by Start fresh that still holds its slot, and a failed Research job beside running Images in a batch other than the open one.
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
- **Scope and approach:** `frontend/src/components/ui/ProgressSegments.tsx`, `header/workSegments.ts`, `components/masthead/ActivityPopover.tsx`, `ActivityIndicator.tsx`, `processing/ProcessingOverview.tsx` (the shared bar), and the component gallery; if `polish-ui-styling-and-loading` hasn't merged, the shared `WorkState`, `StatePill` and `EventTime` components in `components/ui`, with polish's words and time format.
- **Prerequisites:** task 8.
- **Acceptance:** "Stage rows in workflow details", "Stage bar states" and "Only working stages animate", all scenarios; "Expand work steps and existing actions", scenario "Resume while the work read is stale", with its other scenarios still passing.
- **TDD approach:** `workSegments` and `ProgressSegments` tests for each state, and popover tests for rows, links and Resume, fail first.
- **Verification:**
  - the frontend typecheck, lint, tests and build;
  - a demo video of the popover with a working, a waiting-for-you and a paused stage;
  - a reduced-motion check.
- **Risks and decisions:** the Processing overview uses the same bar, so check it in the demo too.

- [ ] 9.1 Read the shared and frontend code guidelines, the frontend architecture and the D42 board.
- [ ] 9.2 RED: `workSegments` tests:
  - [ ] 9.2.1 State precedence, including a stage with both working and failed jobs, and a turn still running after the batch is paused, which reads working while the batch shows Paused and Resume.
  - [ ] 9.2.2 A stage with no jobs yet is never done.
  - [ ] 9.2.3 No fill without counts, and an uncounted running stage and an uncounted waiting stage read working and waiting for you from their retained jobs.
  - [ ] 9.2.4 Examine waiting on questions reads as waiting for you.
- [ ] 9.3 RED: tests for `ProgressSegments`' states, patterns and animation (only working, none under reduced motion), and for the popover's stage rows, links, counts, status lines (a finished stage with a cancelled attempt still holding a slot shows a reason, not that attempt's line, as in "Cancelled attempt still holding a slot") and Resume (including an open batch paused with no jobs), no animation on rows from a failed or stale read, including a finished stage and a stage whose sessions fall outside `active_sessions`, which show a reason rather than an agent line ("Stage with no listed session").
- [ ] 9.4 GREEN: implement the states, the popover layout and the rows. Update the component gallery.
- [ ] 9.5 Run the frontend checks. Record the demo video for the PR description.

## 10. Session rows, failures in plain words and Agents filters

- **PR delivery:** PR-G.
- **Outcome:**
  - one row per session on the Agents page and Processing's session list, with earlier attempts folded;
  - failures in plain words from the recorded provider error and cause, with advice behind help and codes only in debug mode;
  - titles that open the session, and recovery actions on failed rows;
  - Agents filter chips opening on Needs attention, with batches that need nothing collapsed and archived batches only under All.
- **Scope and approach:**
  - `contracts/src/agents.ts` and `intake-server/src/agents/session/sessions.ts`: a session-level read paging by job, with the selected filter applied before paging, scoped chip and batch counts, slot and waiting totals independent of the filter, a summary of every batch in scope including those with no matching sessions, each job's earlier attempts, the batch's archived flag, where it ran and its sealed web setting;
  - the `start_fresh` eligibility predicate extracted from `processing/session-replacement.ts`, with a read-only check of media availability from `media/inputs.ts`, on the session-level read's rows, the history metadata and the Processing snapshot's jobs, used by the Agents rows, the Processing step cards and the session page;
  - `contracts/src/session-failures.ts` and `agents/failures.ts`: a sanitized `cause` on the failure summary, built from the recorded provider error and cause code, under the same read scope;
  - `frontend/src/components/agents/AgentSessions.tsx`, the Processing session list in `components/processing/`, the other readers of the Agents read (`settings/agents/SlotMeter.tsx` through `AgentsSection.tsx`, and `firstStart` in `ProcessingWorkspace.tsx`), which move to its scoped totals, `components/agents/SessionFailureDetails.tsx`, and the failure-text mapping beside the contracts' allowlists (`CLAUDE_ERROR_KINDS`, `CODEX_ERROR_KINDS`, cause codes).
  - It uses the shared state words and time format from `polish-ui-styling-and-loading`.
- **Prerequisites:** task 7, for the session page that row titles and failure details open; the shared components from task 9 or polish, whichever merged first.
- **Acceptance:** "Opens on what needs attention", "Archived batches only under All", "Retries fold into one row", "Failed row recovery", "Provider overloaded", "Old failure without a cause"; and the Start fresh clause of processing-workspace "Proposal, question and failure entries expand with links", on the session page's failure entries.
- **TDD approach:** grouping, Needs attention derivation and failure-text tests fail first.
- **Verification:** contracts tests, the intake unit and PG tiers for the read and the failure summary, frontend checks, and a demo video of the Agents page on a Heyyy-like fixture going from 8 rows to 3, and of earlier attempts expanding under a Processing job card.
- **Risks and decisions:** the canvas boards FixSessionRows, FixFailureCause, FixSessionLinks and FixAgentsFilters are the reference.

- [ ] 10.1 Read the code guidelines and the Fixes page boards.
- [ ] 10.2 RED: PG tests for the session-level read (a retry chain that would have spanned two attempt pages, the archived flag, the selected filter applied before paging, and chip and batch counts that include a failed session beyond the first page of all sessions; slot use, queued and waiting totals and each batch's first start that count sessions hidden by the Needs attention filter or beyond the first page, with the first start taken from the earliest running transition so a resumed attempt doesn't move it; `start_fresh` eligibility for a slot held by an earlier attempt of the job, a stale pinned identity, an archived batch, a retired lot and a lot whose linked evidence is still preparing, including on a Processing step card for a failed job with no history open and outside the first Agents page; Needs attention including a current attempt that can't resume and one waiting for sign-in, and excluding a failure superseded by a successful retry; Done today's count and filter using the browser's day bounds across a client/server date boundary, the count checked while another chip is selected; and a batch summary that lists a batch with no matching sessions as collapsed) and the failure summary's `cause` with debug mode off; frontend tests for folded attempts, Needs attention (including a failure followed by success), collapsed and archived batches, failure sentences for each recorded kind and the "not recorded" case, row links and actions, Start fresh from the Agents page running only under the session page's command guard and disabled with its reason for an archived batch or retired lot, and opening failure details never starting a retry; and Settings' slot meter and the Processing overview's start time read from the new totals.
- [ ] 10.3 GREEN: implement the read, the failure cause and the rows.
- [ ] 10.4 Run the contracts tests, the intake unit and PG tiers and the frontend checks, and record the demo video.

## 11. Drawer header, activity feed and message box

- **PR delivery:** PR-H.
- **Outcome:**
  - the drawer header with state, model, where it ran, web, time span, retries and Open full session;
  - recent activity in the app's words, linked to the lot, with the agent's note muted;
  - the labelled message box;
  - one instruction sentence asking for plain status lines without internal IDs.
- **Scope and approach:** the drawer in `ProcessingWorkspace.tsx` (it rebases on polish's edits), with its header built from task 6's history metadata and the earlier failures' causes from task 10's failure summary; a bounded batch activity read (`readBatchActivity` in `agents/tools/`, its contract and route) reusing task 6's resolver; `ProcessingOverview.tsx` recent activity from that read; the shared message box component; and `openingText` in `agents/session/session-runner.ts`.
- **Prerequisites:** tasks 6, 7 and 10 (task 10 for the failure causes), and the shared components from task 9 or polish, whichever merged first.
- **Acceptance:** "Retried session in the drawer", "Proposal in recent activity", "Sending a message", "Status after proposing".
- **TDD approach:** component tests, and a session-runner test for the instruction sentence, fail first.
- **Verification:** contracts tests, the intake unit and PG tiers, frontend checks, and a demo video.
- **Risks and decisions:** the boards FixDrawerHeader, FixActivityFeed and FixMessageBox are the reference.

- [ ] 11.1 Read the code guidelines and the Fixes page boards.
- [ ] 11.2 RED: header tests, including a drawer opened from Processing for a session absent from the Agents read's first page and filter; activity entry and message box tests, the opening-instructions test, and a PG test that the batch activity read returns the newest entries across several jobs, including jobs outside the first Agents page.
- [ ] 11.3 GREEN: implement them.
- [ ] 11.4 Run the checks, and record the demo video.

## Delivery evidence and lifecycle follow-up

- [ ] PR-0: review the plan read-only (`codex exec -m gpt-6.2-sol -s read-only`, round by round), fix findings, publish, CI green, merge.
- [ ] PR-A: implement task 1, review the exact head, publish with the demo, CI green, merge.
- [ ] PR-B: implement tasks 2, 3 and 4, review the exact head, publish with the demo, CI green, merge.
- [ ] PR-D: implement tasks 5 and 6, review the exact head, publish, CI green, merge.
- [ ] PR-E: implement task 7, review the exact head, publish with the demo, CI green, merge.
- [ ] PR-F: implement tasks 8 and 9, review the exact head, publish with the demo, CI green, merge.
- [ ] PR-G: implement task 10, review the exact head, publish with the demo, CI green, merge.
- [ ] PR-H: implement task 11, review the exact head, publish with the demo, CI green, merge.
- [ ] Update BI-019's status as PRs merge. It is Done only after PR-A, PR-B, PR-D, PR-E, PR-F, PR-G and PR-H merge and its acceptance is evidenced.
- [ ] Mark the design log entries D37 (PR-A), D38 (PR-B), D39 and D41 (PR-E) and D42 (PR-F) Built, with their PRs (D40's page layout was replaced by D41).
- [ ] Before archiving, run `pnpm openspec:overlap --change improve-agent-interaction`, sync the specs, and record final open items in `notes.md`.
