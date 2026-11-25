# Implementation and delivery tasks

## Plan context

- **Plan:** the [proposal](proposal.md) and [design](design.md), with deltas in `specs/` for `ui-design-system`, `processing-workspace`, `processing-stage-pipeline`, `processing-agent-sessions`, `agents-overview` `header-workflow-status` and `shared-vm-execution`.
- **Reuse:** rebuild `Dialog.tsx` on `@radix-ui/react-dialog`, from the Radix family the frontend already uses for popovers, extend the existing contracts and form stack, and use native `<details>` for expandable entries. Radix Dialog is the only new dependency.
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
| 5. Photo views and agent-reported web sources | Contracts, migration, intake server and frontend | None | processing-agent-sessions "Photo views are recorded", "Agent-reported web page sources" ("Invalid URL", and acceptance in "Cited datasheet"), "Bounded status lines and delivered citations" |
| 6. Session history read and photo-view crops | Contracts and intake server | 3, 5 | processing-workspace "Expandable session history", "Lot-forming entries expand with links", "Proposal, question and failure entries expand with links", "Your inputs in the session history", "Reaching and reading the session page" (Long history, scope) |
| 7. Expandable timeline and the session page | Frontend behavior | 4, 6 | processing-workspace history requirements, "Drawer and session page split", "Agent session page", "Session page header and panels", "Reaching and reading the session page"; agents-overview "Agents page" ("Open a session's page"); processing-agent-sessions "Cited datasheet" (web read on the session page) |
| 8. Stage counts and the paused flag | Contracts and intake server | None | header-workflow-status "Stage rows in workflow details" (counts), "Stage bar states" (paused) |
| 9. Activity popover stage rows and bar states | Frontend behavior | 8 | header-workflow-status "Stage rows in workflow details", "Stage bar states", "Only working stages animate", "Expand work steps and existing actions" (Resume) |
| 10. Session rows, failures in plain words and Agents filters | Contracts, intake server and frontend | 7; 9 or polish for the shared components | agents-overview "Agents page", "Agents filter rules", "Session rows", "Failed rows offer recovery"; processing-workspace "Failures in plain words" |
| 11. Drawer header, activity feed and message box | Contracts, intake server and frontend, plus one instruction sentence | 6, 7, 10; 9 or polish for the shared components | processing-workspace "Session drawer header", "Activity in the app's words", "Labelled message box"; processing-agent-sessions "Status lines stay readable" |
| 12. Configurable VM evidence delivery | Intake server and deployment tooling | 5 (merged) | processing-agent-sessions "Configurable VM evidence delivery" |
| 13. Answered questions fold away | Contracts, migration, intake server and frontend | 4 and 7 (merged) | processing-workspace "Answered questions fold away", "An answer form says why it can't send", "Answer a question step by step" (focus); processing-agent-sessions "Answered questions report their answer and delivery" |
| 14. Question pictures | Contracts, media decoder, migration, intake server and frontend | 13 | processing-agent-sessions "Questions carry pictures", "Agents preview their pictures"; processing-workspace "Questions show the agent's pictures", "A larger view of a question picture" |

## PR delivery map

Every implementation bundle targets `interactive-app` once its listed prerequisites have merged.

| Bundle | Outcome and included work | Task coverage | Why this boundary | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-0 | This plan, BI-019 and the BI-015 hand-over | Planning only | Review the plan before code | None; first | `interactive-app` ← `docs/improve-agent-interaction`; `docs(improve-agent-interaction): plan agent interaction improvements` | `openspec validate --strict`, `pnpm workflow-sync` unaffected; read-only review; CI green |
| PR-A | Backdrop click closes every dialog | 1 | Small, independent and immediately useful | PR-0 | `feat/improve-agent-interaction-dialog-backdrop`; `fix(improve-agent-interaction): close dialogs from their backdrop` | Frontend typecheck, lint, tests and build; demo video; review; CI |
| PR-B | `/2` questions and answers end to end: contracts, the server path, agent guidance, and the drawer's stepped form, live option cards and Needs you rows | 2, 3, 4 | Today's form can't answer a `/2` question, so the ask and the form that answers it ship together; no build asks questions its UI can't answer | PR-0 | `feat/improve-agent-interaction-question-steps`; `feat(improve-agent-interaction): ask and answer stepped questions with options` | Contracts tests, intake unit, PG and process tiers with the decoder and probe images; frontend checks; demo video; rollback note and the session worker rollout steps in the PR body; review; CI |
| PR-D1 | Recorded photo views and agent-reported web page sources | 5 | Has no prerequisites, so it starts in wave 1; it also unblocks BI-022, which needs only the `photo_view` record | PR-0 | `feat/improve-agent-interaction-photo-views`; `feat(improve-agent-interaction): record photo views and web page sources` | Contracts tests, intake unit, PG and process tiers; frontend checks, since the existing source list and timeline must read `/6` proposals and photo views; rollback note and the session worker rollout steps in the PR body; review; CI |
| PR-D2 | The paged history read with session metadata and the photo-view crop route | 6 | The server side of the history; the old timeline view keeps working until PR-E switches to it | PR-B (the history resolves `/2` questions) and PR-D1 merged | `feat/improve-agent-interaction-session-history`; `feat(improve-agent-interaction): read a session's full history` | Contracts tests, intake unit, PG and process tiers; rollback note and the session worker rollout steps in the PR body; review; CI |
| PR-E | Expandable, grouped, linked entries in the drawer and the session page as a conversation | 7 | The UI over PR-D2; one entry renderer for both places | PR-B and PR-D2 merged | `feat/improve-agent-interaction-session-page`; `feat(improve-agent-interaction): expandable agent history and session page` | Frontend checks; intake unit and PG tiers for the timeline route removal and its consumers; demo video; review; CI |
| PR-G | A session-level Agents read, one row per session, failures in plain words, recovery actions and the Agents page filters | 10 | One read and its rows; its links and failure display reach the session page | PR-E merged, and PR-F or polish merged for the shared components | `feat/improve-agent-interaction-session-rows`; `feat(improve-agent-interaction): one row per session with its real failure` | Contracts tests, intake unit and PG tiers, frontend checks; demo video; review; CI |
| PR-H | Drawer header, recent activity in the app's words, the labelled message box and readable status lines | 11 | Builds on the history read, the session page and the session-level read | PR-D2, PR-E and PR-G merged, and PR-F or polish merged for the shared components | `feat/improve-agent-interaction-session-details`; `feat(improve-agent-interaction): clearer session header, activity and message box` | Contracts tests, intake unit and PG tiers for the batch activity read and the instruction text, frontend checks; demo video; review; CI |
| PR-F | Per-stage counts and the paused flag, stage rows in the activity popover and the new bar states; the shared `WorkState`, `StatePill` and `EventTime` components if `polish-ui-styling-and-loading` hasn't merged first | 8, 9 | Independent of questions and history, small enough to review end to end | PR-0; whichever of PR-F and polish merges second reuses the other's shared components | `feat/improve-agent-interaction-activity-stages`; `feat(improve-agent-interaction): show each stage's state and counts in the activity popover` | Contracts tests, intake PG tier, frontend checks; demo video; review; CI |
| PR-I | Configurable inline or file evidence delivery, launch wiring and regressions | 12 | One transport behavior across its configuration and guest boundaries | PR-D1 merged; independent of the remaining UI work | `interactive-app` ← `feat/improve-agent-interaction-evidence-delivery`; `feat(improve-agent-interaction): configure VM evidence delivery` | Development, deployment and intake checks; independent review before publication; CI |
| PR-J | An answered question folds to its Answered line with its delivery state, in the drawer, the step page and the session page; named reasons replace `stale`; the answer summary and acknowledgement log in the Processing read; the drawer's messages and answers in time order | 13 | The bug fix and the card it needs, with the read that feeds it; one review of the answer surfaces | PR-B and PR-E merged (both are); independent of `polish-ui-styling-and-loading` task 15, which fixes the cancelled reload | `interactive-app` ← `feat/improve-agent-interaction-answered-questions`; `fix(improve-agent-interaction): show an answered question as answered` | Contracts tests, intake unit and PG tiers, frontend checks; demo video; rollout steps in the PR body; review; CI |
| PR-K | Pictures on agent questions: the shared view recipe and decoder operation, figure validation, render requests and the figure route, `ask` previews, the card layouts and the larger view | 14 | One feature end to end; the shared renderer lands with its first consumer | PR-J merged (the same card); BI-022's PR-E1 waits for this PR | `interactive-app` ← `feat/improve-agent-interaction-question-pictures`; `feat(improve-agent-interaction): agent questions carry pictures` | Contracts and decoder tests, intake unit, PG and process tiers with the decoder and probe images, frontend checks; demo video; rollout steps and forward-only note in the PR body; review; CI |

## Parallel work

How the PR map above lets work run at the same time. A PR can start once every PR it depends on has merged; PRs in the same wave share no dependency on each other and can be built by separate people or agents at once.

| Wave | Can run in parallel | Waits for |
| --- | --- | --- |
| 1 | PR-A · PR-B · PR-D1 · PR-F | PR-0 (all four); PR-F coordinates its shared components with `polish-ui-styling-and-loading` |
| 2 | PR-D2 · PR-I | PR-D2 waits for PR-B and PR-D1; PR-I waits only for PR-D1 |
| 3 | PR-E | PR-B and PR-D2 |
| 4 | PR-G · PR-J | PR-E (both); PR-F or polish for the shared components (PR-G) |
| 5 | PR-H · PR-K | PR-D2, PR-E and PR-G, with PR-F or polish (PR-H); PR-J (PR-K) |

- **Critical path:** PR-B → PR-D2 → PR-E → PR-G → PR-H, five PRs in sequence; PR-B → PR-D2 → PR-E → PR-J → PR-K is the same length. PR-A, PR-B, PR-D1, PR-D2, PR-E, PR-F and PR-I have merged, so PR-G and PR-J can run now. PR-A has slack; PR-F can start after PR-0 but holds PR-G unless polish lands first. PR-D1 runs beside PR-B; PR-D2 starts once the later of the two merges.
- **Most parallel moment:** wave 1, four PRs. PR-I can also proceed independently after PR-D1; the remaining UI bundles follow their dependency chain.
- **Conflicts to expect between parallel PRs:** PR-B and PR-F both change the Processing read the frontend uses (questions and step counts), and both touch `ProcessingWorkspace.tsx`, which `polish-ui-styling-and-loading` also edits. PR-B and PR-D1 both change `contracts/src/sessions.ts`, `processing.ts` and `agents/tools/handlers.ts`, and whichever lands first adds the shared envelope writer's size check. PR-G, PR-H, PR-J and PR-K all touch the drawer and `ProcessingWorkspace.tsx`, and PR-J and PR-K both change `DrawerAnswers.tsx` and the question DTO; `polish-ui-styling-and-loading` PR-J changes the same answer handler's reload. Whichever merges later rebases, and PR-J and PR-K each renumber their migration if another lands first.
- **Effect on BI-022:** `agent-stage-inputs-outputs` waits for this change's PR-B (stepped questions), PR-D1 (`photo_view`), PR-E (session page) and PR-G (session rows). PR-D1 is in wave 1, so it doesn't hold BI-022 back. BI-022's PR-E1 now also waits for PR-K, whose shared view recipe and decoder operation its recipe `/2` extends.

### Re-carving that would allow more parallel work

Mitch applied the first suggestion on 2026-11-23; the map above includes it. The others stay proposals and are not applied.

1. **Applied: split PR-D into photo views and the history read.** Task 5 (recorded photo views and agent-reported web sources) has no prerequisites, so as **PR-D1** it runs in wave 1 instead of waiting for PR-B with the history read. **PR-D2** keeps task 6 (the history read and crop route) after PR-B. This also unblocks BI-022 sooner: BI-022's PR-A and PR-B need only the `photo_view` record, so they wait for PR-D1 instead of the whole history read. Cost: one more PR and a migration landing before its main reader.
2. **Split PR-G into the session-level read and the session-page links.** Task 10's server read, failures in plain words, recovery actions, row grouping and Agents filters don't need the session page; only the row title opening the session page does. **PR-G1** could run in wave 2, once PR-F or polish provides the shared state words; the link (**PR-G2**) folds into PR-E or follows it. That takes PR-G off the critical path. Cost: the Agents rows link to the drawer until PR-E lands.
3. **Split PR-H into the message box and the rest.** The labelled message box and the status-line instruction sentence (O6 and part of task 11) depend on nothing else in this change. **PR-H1** could run in wave 1; the drawer header and recent activity (**PR-H2**) still need the history read, the session page and the session-level read. Cost: one more small PR.
4. **Stack PR-E on PR-D2.** PR-E's renderer and page can be built against PR-D2's contract as soon as that contract is settled, on a branch stacked on PR-D2, and merged straight after it. This shortens wall-clock time without changing the merge order. Cost: rebasing PR-E if PR-D2's contract changes in review.

With the other three also applied, the waves would be: 1 — PR-A, PR-B, PR-D1, PR-F, PR-H1; 2 — PR-D2, PR-G1; 3 — PR-E (built on a stack during wave 2, with PR-G2's link); 4 — PR-H2. The critical path would drop from five PRs to four (PR-B → PR-D2 → PR-E → PR-H2), and up to five PRs could be in progress at once.

## 1. Dialogs close from their backdrop

- **PR delivery:** PR-A.
- **Outcome:** clicking the dimmed backdrop of any `Dialog` closes it through `onClose`. It is ignored while `closeDisabled` is set, and a press that starts inside the dialog never closes it.
- **Scope and approach:**
  - `frontend/src/components/ui/Dialog.tsx`: rebuild `Dialog` on `@radix-ui/react-dialog` (Portal, Overlay, Content, Title), with the guards in `onEscapeKeyDown` and `onInteractOutside` (see design). Keep the opener and `returnFocus` focus return, the `side` drawer and the surface's look.
  - `MediaCropDialog`, the one direct `DialogSurface` user, moves off its native `<dialog>` onto the same Radix layer, with its own close guard, so there is one modal system. `RemovalDialog`, `RestructureDialog`, `CompareMatches`, `EvidenceGroupPanel` and the session drawer already use `Dialog`.
- **Prerequisites:** none.
- **Acceptance:** ui-design-system "Dialogs close from their backdrop", all scenarios; processing-workspace "Step page pattern", scenario "Session drawer".
- **TDD approach:** `Dialog.test.tsx` cases fail first, because there is no backdrop handler. The Radix rebuild keeps them as behaviour tests.
- **Verification:**
  - `pnpm --filter frontend typecheck`, `lint`, `test` (the Dialog and ProcessingWorkspace drawer tests) and `build`;
  - a demo film.
- **Risks and decisions:** a Radix modal marks the page behind it `aria-hidden` and blocks its pointer events, as the native modal made it inert in browsers; jsdom tests that reached the page behind an open dialog now say so. A Radix popover opened inside a dialog must stay usable.

- [x] 1.1 Read the shared and frontend code guidelines and the frontend architecture. List every `Dialog` and `DialogSurface` user and how each closes.
- [x] 1.2 RED: add `Dialog.test.tsx` cases:
  - [x] 1.2.1 A backdrop click calls `onClose`.
  - [x] 1.2.2 A backdrop click with `closeDisabled` set doesn't call it.
  - [x] 1.2.3 A press inside that is released on the backdrop doesn't close, including a press on the surface's own padding.
  - [x] 1.2.4 A click on the content doesn't close.
- [x] 1.3 RED: add a `ProcessingWorkspace` drawer test: a backdrop click with an unsaved answer shows the close-blocked banner.
- [x] 1.4 GREEN: implement the handler, and give `MediaCropDialog` the same backdrop handling through its close guard, with a test.
- [x] 1.5 Run the frontend checks. Record a demo video (title card, click outside the drawer, end card) for the PR description.

## 2. Stepped question contracts

- **PR delivery:** PR-B.
- **Outcome:** `/2` question and answer shapes, the envelope and inbox unions reading both versions, and the `questionView` function that derives the normalised view from either variant.
- **Scope and approach:** `contracts/src/sessions.ts` and `processing.ts` (the read-model question DTO), and `attention.ts` (the attention item gains the question's title, kind or step count and per-step assumptions); the error body's optional `step_id` for `invalid_answer`, kept on `IntakeRequestError` by `client-policy.ts`; plus tests in `contracts/tests/`. The shapes are in the design.
- **Prerequisites:** none.
- **Acceptance:** "Structured session questions", scenario "Invalid structure" (contract limits); pipeline "Malformed steps" (contract limits).
- **TDD approach:** contract tests for the valid and invalid shapes fail before the schemas exist.
- **Verification:** `pnpm --filter @invimport/contracts test` and typecheck.
- **Risks and decisions:** keep `/1` exports unchanged, so the runner paths compile untouched. The question DTO becomes a version-discriminated union: the `/1` variant keeps `spec`, the `/2` variant carries its steps, and both carry the shared fields; the normalised view is derived by `questionView`, not sent (see design).

- [x] 2.1 Read the shared code guidelines and the contracts README. Confirm every consumer of `SessionAskArgs`, `ProcessingAnswer`, `SessionInboxItem` and the question DTO.
- [x] 2.2 RED: tests for the `/2` ask, covering 1–4 steps, 2–6 options and the label, detail and prompt lengths. Add `/2` answer tests and envelope and inbox decoding of both versions.
- [x] 2.3 GREEN: add the schemas, types and the normalised question view.
- [x] 2.4 Run the contracts tests and the workspace typecheck.

## 3. Server: ask, answers and agent guidance

- **PR delivery:** PR-B.
- **Outcome:**
  - `ask` stores `/2` questions, with handler checks for unique IDs, one number step and a lot subject.
  - `/2` answers apply up to two capture edits atomically and deliver one inbox item with option IDs.
  - `/1` questions still answer.
  - The read model returns each question's content once, in its version's variant.
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

- [x] 3.1 Read the shared and intake-server code guidelines and `intake-server/ARCHITECTURE.md`. Map where `/1` question specs are decoded for the read model and the answer route.
- [x] 3.2 RED: write the `ask` handler PG tests.
  - [x] 3.2.1 Store a valid `/2` question.
  - [x] 3.2.2 Refuse duplicate step IDs or option IDs, two number steps, a number step without a live lot, and a number step whose question doesn't list `quantity` in its fields, asserting that each tool response names the affected step by index or ID; and schema refusals (five steps, one option) whose issue paths name `/steps` or the step's options; and an ask within every field limit whose sealed envelope exceeds 32,768 bytes, refused as a correctable tool error with nothing stored.
  - [x] 3.2.3 A batch near the snapshot limit with retained `/1` questions and `/2` asks that fit the per-attempt question budget still reads in the Processing snapshot, each question's content carried once.
- [x] 3.3 RED: write the answer PG tests.
  - [x] 3.3.1 A quantity plus a note, applied in one transaction.
  - [x] 3.3.2 Rollback when the note edit is refused after the quantity edit, with the refusal injected.
  - [x] 3.3.3 Refusal of a combined note over the 8192-character limit, before any edit, with the response naming the step, and of an answer whose note fits but whose payload, measured as PostgreSQL's `jsonb` text, exceeds 32,768 bytes, including one that fits as compact JSON.
  - [x] 3.3.4 Refusal of a wrong kind, an unknown option or a missing step.
  - [x] 3.3.5 A number step answered in words is accepted: the text reaches the inbox, the note is written and the lot quantity is unchanged.
  - [x] 3.3.6 Same-key replay returns the first receipt; a different payload under that key is refused; a new key with the same payload adopts the answer; a new key with a different payload gets `payload_conflict`.
  - [x] 3.3.7 A number answer marks a proposal relying on the lot's quantity stale.
  - [x] 3.3.8 An inbox payload carrying the option ID and the number step's basis.
  - [x] 3.3.9 A `/1` answer still accepted.
  - [x] 3.3.10 A `/2` answer to an earlier runner question is refused before the runner branch reads `input.value`, and retained `/1` runner answers still succeed.
- [x] 3.4 RED: an attention read PG test with an open `/2` stepped question, a `/1` session question and an earlier runner question, each carrying its title and kind or step count, with assumptions where recorded and none for the runner question; `/2` lot and Part questions count against their affected lots.
- [x] 3.5 GREEN: implement the `ask` and answer branches and the version-discriminated read model.
- [x] 3.6 Update the `ask` description and the runner's opening instructions. Teach the fake CLI and the synthetic session a stepped ask, and add a process test that answers it and reads the inbox.
- [x] 3.7 Update `intake-server/src/agents/ARCHITECTURE.md` (the question shape and answer effects). Run the intake unit, PG and process tiers, including a read of a database already holding `/2` questions and answers.

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

- [x] 4.1 Read the shared and frontend code guidelines, the frontend architecture and the canvas boards. A choice is picked, then sent (decided 2026-11-23).
- [x] 4.2 RED: component tests:
  - [x] 4.2.1 A one-step choice: send with Send, and "Something else" text.
  - [x] 4.2.2 Steps: Back and Next, the summary with Change, and "Send N answers".
  - [x] 4.2.3 A number step: the inline error for prose, blocked Next, and "Answer in words".
  - [x] 4.2.4 The `/1` question fallback, and draft pinning across a supersede with every step kept.
  - [x] 4.2.5 Needs you rows with kind, step count and assumptions, from the attention read.
  - [x] 4.2.6 Review shows the answer form on the affected lot for `/2` lot and Part questions, through the shared `subject_id`.
  - [x] 4.2.7 A `/2` question on the Inventory step, on a job card and in Review shows its title, steps and `reason` from the shared fields, the Inventory comparison included, and a `/1` question shows as before.
  - [x] 4.2.8 The drawer's chat renders after a `/2` answer is saved, with `/1` and `/2` answers both in its timeline.
  - [x] 4.2.9 A confirmed 422 naming a step, submitted from the drawer through `perform()`, keeps the draft editable and marks that step; an uncertain failure retries only the original payload and key.
- [x] 4.3 GREEN: implement the form, the option cards and the rows. Remove `OPTIONS_NOT_CARRIED` and its placeholders.
- [x] 4.4 Update the fixtures (`ProcessingProof`) with a stepped and a choice question for the demo. Update the frontend architecture if component ownership changes.
- [x] 4.5 Run the frontend checks. Record the demo video for the PR description.

## 5. Photo views and agent-reported web sources

- **PR delivery:** PR-D1.
- **Outcome:** each delivered `fetch_evidence` image appends a `photo_view` outbox item, and proposals can cite an agent-reported `web_page` URL.
- **Scope and approach:**
  - `contracts/src/sessions.ts`: the outbox union, and `SessionProposeArgs` and the `SessionEnvelope` proposal variant, which accept only `/5` today and validate before the retained decoder sees the version, so both accept `/5` and `/6`; `processing.ts`: a `/6` session proposal accepting a `web_page` source in its top-level `sources`, and the validated Processing projection;
  - a migration extending the outbox `kind` check (0018) to allow `photo_view`;
  - `intake-server/src/agents/tools/handlers.ts`: `fetchEvidenceImage` reserves the image budget before its final transaction and appends the view in it; it releases the reservation on a refusal or a known rollback, and keeps it on a commit with an unknown outcome, returning no image in either case; the delivered-citation check skips `web_page`; the shared envelope writer's size check, unless task 3 has already added it;
  - the `propose` tool description;
  - where Review and Inventory read sources, so `web_page` is treated as unverified;
  - the existing frontend readers, so they keep working before PR-E: `ProcessingSources.tsx` shows a `web_page` source as a "Web page" chip marked agent-reported instead of assuming a `receipt_id`, and the old `SessionTimeline.tsx` gives `photo_view` a plain label rather than its raw kind.
- **Prerequisites:** none.
- **Acceptance:** "Photo views are recorded", all scenarios; "Agent-reported web page sources", scenario "Invalid URL", and the proposal's acceptance and its agent-reported chip in "Cited datasheet"; "Bounded status lines and delivered citations". Task 7 owns the session page's web-read entry.
- **TDD approach:** PG tests fail first for a delivered versus refused fetch, and for the `web_page` scheme, length and credential checks.
- **Verification:** contracts tests; `pnpm db:intake test` on the handler and evidence tests; the frontend typecheck, lint and tests.
- **Risks and decisions:** every consumer of proposal sources must accept `/6`; list them in 5.1.

- [x] 5.1 Read the shared and intake-server code guidelines. List every reader of the outbox union and of proposal sources.
- [x] 5.2 RED: contract tests for `photo_view` and `web_page`. PG tests:
  - [x] 5.2.1 A delivered fetch appends one `photo_view` with the delivered size and digest, and publishes `session_changed` in the same transaction.
  - [x] 5.2.2 Through the MCP endpoint, a commit with an unknown outcome returns the uncertain-outcome result and no image, not "changed nothing". A refused or over-budget fetch appends nothing, and a refused final transaction releases the budget and returns no image, including when a removal, a capability revocation, or a cancellation or supersession committed after encoding but before the capability is revoked races the final transaction; a commit with an unknown outcome keeps the reservation and returns no image.
  - [x] 5.2.3 A `web_page` source is accepted for `https` without a delivery check, refused for `file:`, credentials or a URL over 2048 characters, and refused in `relies_on` or catalogue sources.
  - [x] 5.2.4 A `/6` proposal with a `web_page` source goes through the advertised `propose` tool, is stored, and reads through the retained decoder and the ordinary Processing snapshot read, beside a retained `/5` proposal.
  - [x] 5.2.5 Frontend: the existing source list shows a stored `/6` proposal's `web_page` source as a "Web page" chip marked agent-reported, and the old timeline labels a `photo_view`.
  - [x] 5.2.6 A `/6` proposal within every field limit whose sealed envelope exceeds 32,768 bytes (many long `web_page` URLs) is refused as a correctable tool error, with nothing stored or published.
- [x] 5.3 GREEN: implement both. Make the source readers treat `web_page` as unverified.
- [x] 5.4 Update the `propose` description to say how to cite a page read with WebFetch. Run the intake unit and PG tiers.

## 6. Session history read and photo-view crops

- **PR delivery:** PR-D2.
- **Outcome:**
  - `readSessionHistory` returns resolved entries (summary, details, typed links, `who`, attempt headers), newest page first, in pages of 200 with one opaque `before` cursor and no forward read, each page and its metadata taken from one snapshot;
  - the operator's inputs are included;
  - the same scoped read returns the session's metadata: each attempt's number, state and times, the agent selection and model, where it ran and its sealed web setting;
  - retired targets become "gone" links;
  - a session-scoped route recuts a photo view's crop.
- **Scope and approach:**
  - `contracts/src/sessions.ts` (`SessionHistory`, `SessionHistoryEntry`, and `moves` on new regroup outbox items);
  - `regroup` in `capture/evidence-observations.ts`, which returns each move's outcome, and the regroup handler, which records the moves with their source lots and outcomes;
  - `propose_lot`, which takes an optional `separation_reason` and records it on its `lot` outbox item with what the call did (formed, extended, suggested or unchanged);
  - `read_inbox` in `agents/tools/handlers.ts`, which publishes `session_changed` when it advances the acknowledgement cursor;
  - `intake-server/src/agents/tools/timeline.ts` and its route in `processing/routes.ts`;
  - `media/region-crops.ts` for the crop route, `GET …/photo-views/:attemptId/:seq/crop`.
  - Keep the current timeline response until PR-E switches over, then remove it in PR-E.
- **Prerequisites:** tasks 3 and 5.
- **Acceptance:** the history requirements' server-side scenarios: resolution per kind, "Linked record no longer exists", "Answer in the history", "Long history", and "Session from another batch or account".
- **TDD approach:** PG tests per entry kind, plus pagination and scope, fail first against the new read.
- **Verification:** `pnpm db:intake test` on the timeline and route tests, and a process test reading a fake session's history.
- **Risks and decisions:** resolution must stay one query per kind, not one per entry; check the plans in 6.5.

- [x] 6.1 Read the intake-server architecture. Map how each outbox and inbox kind resolves to labels, state and links.
- [x] 6.2 RED: PG tests:
  - [x] 6.2.1 Each entry kind resolves its summary, details and links.
  - [x] 6.2.2 A retired lot or a removed version gives a "gone" link.
  - [x] 6.2.3 With rows written by the existing append paths, answers and chat appear as the operator's from their actor, an instruction saved before a Start fresh and relayed to the new attempt placed at its relay time, with its save time in its details and labelled relayed, and `evidence` and `revision` notices (including an identity revision from another session) as the app's, and one above the acknowledgement cursor reads as not read yet; a `read_inbox` call that advances the cursor publishes `session_changed` in its transaction, and one that doesn't move it publishes nothing.
  - [x] 6.2.4 Attempt headers say how an attempt ended, and why it started where the retained input shows it; turns within an attempt are not attempts; a failure or resume with no new inbox or outbox item still updates its header on the next read; the span runs from the queue time, not a turn's `started_at`; an attempt cancelled before its first turn, one cancelled after a settled turn, an idle attempt superseded by Start fresh after a prior turn, and an attempt that finished, was resumed and was then cancelled show the end time of their latest terminal transition, not an earlier turn's.
  - [x] 6.2.5 A regroup with recorded moves shows them, and a mixed regroup shows which moves were applied and which only suggested; an older regroup lists its destination lots; an observation revised in place shows its values labelled current in both its entries; earlier attempts' failures resolve; a lot edited after formation shows its values labelled current, and after an operator's quantity change shows the selected quantity apart from the agent's estimate and basis.
  - [x] 6.2.6 The `before` cursor pages without gaps or duplicates across retries with repeated sequences and equal timestamps, and across inbox and outbox rows with equal timestamps; the page, its cursor and the metadata come from one snapshot; every read returns the metadata and acknowledgement cursor, including a read of the newest page with no new entries.
  - [x] 6.2.7 A proposal links every open question that makes it provisional, with two matching questions.
  - [x] 6.2.8 The session metadata for a retried session, including the web setting from each attempt's manifest.
  - [x] 6.2.9 Another batch or account gets `session_not_found`.
- [x] 6.3 RED: route tests for the photo-view crop: the recorded region bounded as delivered, a full-page view, two attempts with the same sequence, 404 for a removed version, and scope.
- [x] 6.4 GREEN: implement the read, the contract and the crop route.
- [x] 6.5 Check the queries batch per kind, and update `intake-server/src/agents/ARCHITECTURE.md`. Run the intake unit, PG and process tiers, including a read of a database already holding `/6` proposals and photo views. A PG test finds a read issues as many statements for a page of many entries as for a few, and the PG history tests read `/6` proposals and photo views written by the existing tools; tier results are on the PR.

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

- [x] 7.1 Read the shared and frontend code guidelines, the frontend architecture and the canvas boards (option B is the page layout).
- [x] 7.2 RED: route tests for parsing and building the session page route.
- [x] 7.3 RED: renderer tests:
  - [x] 7.3.1 Each kind's details and links.
  - [x] 7.3.2 "gone" links.
  - [x] 7.3.3 Grouping of consecutive entries.
  - [x] 7.3.4 The drawer's summary lines and "Open full session".
- [x] 7.4 RED: page tests:
  - [x] 7.4.1 One conversation in time order, with attempt dividers, including one whose reason isn't retained and reads only "Attempt N".
  - [x] 7.4.2 Filter chips and Load older; an invalidation re-reads the newest page and replaces it, keeping loaded older pages without duplicates; one new entry keeps the entry it pushed off the newest page; more than one page of new entries between refreshes drops the older pages and Load older continues from the new page; answering a matching question in another job refreshes a proposal's provisional links on the newest page; a chat sent from another tab shows after the next invalidation, and an acknowledgement with no new entry shows through the `session_changed` that `read_inbox` publishes.
  - [x] 7.4.3 Sending a message once.
  - [x] 7.4.4 Answering a question in place, with the drawer's draft shown as superseded, and commands disabled while the page's Processing read is loading, failed or paused, including a warm cache whose mounted read is still pending.
  - [x] 7.4.5 Not found, and the debug block only in debug mode.
  - [x] 7.4.6 A correction sent before a Start fresh sits at its send time, shown as the app's notice of the operator's correction; observations from different photos stay ungrouped; a mixed photo and web run is one drawer line.
  - [x] 7.4.7 The photos and sources panels on a long session say older entries are not loaded, and list an older photo view and source once Load older loads them.
- [x] 7.5 GREEN: implement the renderer, the drawer change, the page and the entry points (Agents rows, session lists, failure details). Remove the old timeline response.
- [x] 7.6 Update the fixtures and the frontend architecture. Run the frontend checks, and the intake unit and PG tiers for the removed timeline response and its consumers. Record the demo video for the PR description.

## 8. Stage counts and the paused flag

- **PR delivery:** PR-F.
- **Outcome:** the header and attention reads count each step's `waiting`, `queued`, `questions` and `ready_lots`, the header read also each step's `failed`, the batch's live `lots`, and the batch's `paused` flag; each `active_sessions` entry gains `current`, whether its attempt is its job's current one; the header read also lists the scoped paused batches in `paused_batches`, up to 20 with a `truncated` flag.
- **Scope and approach:** `contracts/src/header.ts` (`stepJobs`, batch step entries, `paused_batches`), `contracts/src/attention.ts` (`stepWork`), `intake-server/src/header/processing.ts`, `work.ts` and the attention read, using `agents/pause.ts` for paused.
- **Prerequisites:** none.
- **Acceptance:** the counts in "Stage rows for a working batch", "No count for a stage" and "Paused batch"; the `current` flag behind "Cancelled attempt still holding a slot".
- **TDD approach:** PG tests asserting the new counts for a batch with waiting, queued, running and paused work fail first.
- **Verification:** contracts tests; `pnpm db:intake test` on the header and attention tests.
- **Risks and decisions:** keep the counts in the existing queries; no extra per-step query.

- [x] 8.1 Read the shared and intake-server code guidelines. Map how `stepJobs` and `stepWork` are counted today.
- [x] 8.2 RED: contract tests for the new fields. PG tests for a batch with one waiting-for-you, one queued, one running and one ready job, with open questions, retired lots, a stage with live lots but no jobs yet, a ready Part job beside a live lot with no job at that step, a paused batch, a batch paused with no jobs, more than five paused batches with one that has no work (in `paused_batches`, not cut by the `batch_steps` cap), more than 20 (truncated), `current` false on an earlier attempt of the job that still holds its slot (set up in the fixture, since Start fresh refuses while any attempt of the job holds one), and a failed Research job beside running Images in a batch other than the open one.
- [x] 8.3 GREEN: implement the counts and the paused flag in both reads.
- [x] 8.4 Run the contracts tests and the intake unit and PG tiers.

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

- [x] 9.1 Read the shared and frontend code guidelines, the frontend architecture and the D42 board.
- [x] 9.2 RED: `workSegments` tests:
  - [x] 9.2.1 State precedence, including a stage with both working and failed jobs, and a turn still running after the batch is paused, which reads working while the batch shows Paused and Resume.
  - [x] 9.2.2 A stage with no jobs yet is never done.
  - [x] 9.2.3 No fill without counts, and an uncounted running stage and an uncounted waiting stage read working and waiting for you from their retained jobs.
  - [x] 9.2.4 Examine waiting on questions reads as waiting for you.
- [x] 9.3 RED: tests for `ProgressSegments`' states, patterns and animation (only working, none under reduced motion), and for the popover's stage rows, links, counts, status lines (a finished stage with a cancelled attempt still holding a slot shows a reason, not that attempt's line, as in "Cancelled attempt still holding a slot") and Resume (including an open batch paused with no jobs), no animation on rows from a failed or stale read, including a finished stage and a stage whose sessions fall outside `active_sessions`, which show a reason rather than an agent line ("Stage with no listed session").
- [x] 9.4 GREEN: implement the states, the popover layout and the rows. Update the component gallery.
- [x] 9.5 Run the frontend checks. Record the demo video for the PR description.

## 10. Session rows, failures in plain words and Agents filters

- **PR delivery:** PR-G.
- **Outcome:**
  - one row per session on the Agents page and Processing's session list, with earlier attempts folded;
  - failures in plain words from the recorded provider error and cause, with advice behind help and codes only in debug mode;
  - titles that open the session, and recovery actions on failed rows;
  - Agents filter chips opening on Needs attention, with batches that need nothing collapsed and archived batches only under All.
- **Scope and approach:**
  - `contracts/src/agents.ts` and `intake-server/src/agents/session/sessions.ts`: a session-level read paging by job, with the selected filter applied before paging, scoped chip and batch counts, slot and waiting totals independent of the filter, a summary of every batch in scope including those with no matching sessions, an optional batch scope that Processing's session list reads under All with Load more, each job's earlier attempts, the batch's archived flag, where it ran and its sealed web setting;
  - the `start_fresh` eligibility predicate extracted from `processing/session-replacement.ts`, as a read-only preflight of every check the command makes before its first write, including media from `media/inputs.ts` and the profile, agent settings and input size from `processing/session-attempts.ts` and the channel secret from `processing/attempts.ts`, on the session-level read's rows, the history metadata and the Processing snapshot's jobs, used by the Agents rows, the Processing step cards, the drawer's existing Start fresh button (`SessionPanel.tsx`) and the session page;
  - `contracts/src/session-failures.ts` and `agents/failures.ts`: a sanitized `cause` on the failure summary, built from the recorded provider error and cause code, with the failed attempt's last status line and its time, under the same read scope;
  - `frontend/src/components/agents/AgentSessions.tsx`, the Processing session list in `components/processing/`, the other readers of the Agents read (`settings/agents/SlotMeter.tsx` through `AgentsSection.tsx`, and `firstStart` in `ProcessingWorkspace.tsx`), which move to its scoped totals, `components/agents/SessionFailureDetails.tsx`, and the failure-text mapping beside the contracts' allowlists (`CLAUDE_ERROR_KINDS`, `CODEX_ERROR_KINDS`, cause codes).
  - It uses the shared state words and time format from `polish-ui-styling-and-loading`.
- **Prerequisites:** task 7, for the session page that row titles and failure details open; the shared components from task 9 or polish, whichever merged first.
- **Acceptance:** "Opens on what needs attention", "Archived batches only under All", "Agents filter rules" ("Waiting for sign-in needs attention", "Stopped attempt still holding a slot" and "Cancelled today after settling yesterday"), "Retries fold into one row", "Failed row recovery", "Provider overloaded", "Old failure without a cause"; and the Start fresh clause of processing-workspace "Proposal, question and failure entries expand with links", on the session page's failure entries.
- **TDD approach:** grouping, Needs attention derivation and failure-text tests fail first.
- **Verification:** contracts tests, the intake unit and PG tiers for the read and the failure summary, frontend checks, and a demo video of the Agents page on a Heyyy-like fixture going from 8 rows to 3, and of earlier attempts expanding under a Processing job card.
- **Risks and decisions:** the canvas boards FixSessionRows, FixFailureCause, FixSessionLinks and FixAgentsFilters are the reference.

- [x] 10.1 Read the code guidelines and the Fixes page boards.
- [x] 10.2 RED: PG tests for the session-level read (a retry chain that would have spanned two attempt pages, the archived flag, the selected filter applied before paging, and chip and batch counts that include a failed session beyond the first page of all sessions; slot use, queued and waiting totals and each batch's first start that count sessions hidden by the Needs attention filter or beyond the first page, with the first start taken from the earliest running transition so a resumed attempt doesn't move it; `start_fresh` eligibility for a slot held by an earlier attempt of the job, a stale pinned identity, an archived batch, a retired lot, a lot whose linked evidence is still preparing and a failed session whose step's provider was disabled after the attempt, an otherwise eligible session whose new input would exceed its size limit, an unconfigured processing channel, including on a Processing step card for a failed job with no history open and outside the first Agents page; Needs attention including a current attempt that can't resume and one waiting for sign-in, and excluding a failure superseded by a successful retry; Done today's count and filter using the browser's day bounds across a client/server date boundary, the count checked while another chip is selected, and an attempt that last settled yesterday and was cancelled today counted as done today; Working excluding a current attempt cancelled today that still holds its slot, which Done today and the slot total count, checked on rows and chip counts alike; the batch-scoped read under All returning a job's earlier attempts for a job outside the first Agents page; and a batch summary that lists a batch with no matching sessions as collapsed) and the failure summary's `cause` with debug mode off, with the failed attempt's last status line and time when that status is outside the newest history page; frontend tests for folded attempts, Needs attention (including a failure followed by success), collapsed and archived batches, failure sentences for each recorded kind and the "not recorded" case, row links and actions, Start fresh from the Agents page running only under the session page's command guard and disabled with its reason for an archived batch or retired lot, and opening failure details never starting a retry; a Processing step card, on a direct step-page visit, expanding a job's earlier attempts from the history metadata when the job is beyond the first page of both the Agents read and the batch-scoped read; the drawer's Start fresh disabled with its reason while an earlier attempt holds a slot; a settings save in the same tab refreshing an open Processing card's and session page's Start fresh, and a stale Start fresh in another tab refused with its reason and refreshing the reads; and Settings' slot meter and the Processing overview's start time read from the new totals.
- [x] 10.3 GREEN: implement the read, the failure cause and the rows.
- [x] 10.4 Run the contracts tests, the intake unit and PG tiers and the frontend checks, and record the demo video.

## 11. Drawer header, activity feed and message box

- **PR delivery:** PR-H.
- **Outcome:**
  - the drawer header with state, model, where it ran, web, time span, retries and Open full session;
  - recent activity in the app's words, linked to its lot, record or, for an observation before any lot, Capture, with the agent's note muted;
  - the labelled message box;
  - one instruction sentence asking for plain status lines without internal IDs.
- **Scope and approach:** the drawer in `ProcessingWorkspace.tsx` (it rebases on polish's edits), with its header built from task 6's history metadata and the earlier failures' causes from task 10's failure summary; a bounded batch activity read (`readBatchActivity` in `agents/tools/`, its contract and route) reusing task 6's resolver; `ProcessingOverview.tsx` recent activity from that read; the shared message box component; and `openingText` in `agents/session/session-runner.ts`.
- **Prerequisites:** tasks 6, 7 and 10 (task 10 for the failure causes), and the shared components from task 9 or polish, whichever merged first.
- **Acceptance:** "Retried session in the drawer", "Proposal in recent activity", "Sending a message", "Status after proposing".
- **TDD approach:** component tests, and a session-runner test for the instruction sentence, fail first.
- **Verification:** contracts tests, the intake unit and PG tiers, frontend checks, and a demo video.
- **Risks and decisions:** the boards FixDrawerHeader, FixActivityFeed and FixMessageBox are the reference.

- [x] 11.1 Read the code guidelines and the Fixes page boards.
- [x] 11.2 RED: header tests, including a drawer opened from Processing for a session absent from the Agents read's first page and filter; activity entry tests, including an Examine observation recorded before any lot linking to Capture, message box tests, the opening-instructions test, and a PG test that the batch activity read returns the newest entries across several jobs, including jobs outside the first Agents page.
- [x] 11.3 GREEN: implement them.
- [x] 11.4 Run the checks, and record the demo video.

## Delivery evidence and lifecycle follow-up

- [ ] PR-0: review the plan read-only (`codex exec -m gpt-6.2-sol -s read-only`, round by round), fix findings, publish, CI green, merge.
- [x] PR-A: implement task 1, review the exact head, publish with the demo, CI green, merge. Merged as #252 at `17c3d509`.
- [x] PR-B: implement tasks 2, 3 and 4, review the exact head, publish with the demo, CI green, merge. Merged as #251 at `54477ac3`.
- [x] PR-D1: implement task 5, review the exact head, publish, CI green, merge. Merged as #257 at `4fcdbd54`.
- [x] PR-D2: implement task 6, review the exact head, publish, CI green, merge. Merged as #260 at `14a5c632`.
- [x] PR-E: implement task 7, review the exact head, publish with the demo, CI green, merge. Merged as #263 at `49a87cd0`.
- [x] PR-F: implement tasks 8 and 9, review the exact head, publish with the demo, CI green, merge. Merged as #258 at `d09984bc`.
- [x] PR-G: implement task 10, review the exact head, publish with the demo, CI green, merge. Merged as #266 at `75eb9a65`.
- [ ] PR-H: implement task 11, review the exact head, publish with the demo, CI green, merge.
- [x] PR-I: implement task 12, review the exact head, publish, CI green, merge. Merged as #262 at `b383ca91`.
- [x] PR-J: implement task 13, review the exact head, publish with the demo, CI green, merge. Merged as #269 at `80260c93`.
- [x] PR-K: implement task 14, review the exact head, publish with the demo, CI green, merge. Merged as #272 at `4a2a3c85`.
- [ ] Update BI-019's status as PRs merge. It is Done only after PR-A, PR-B, PR-D1, PR-D2, PR-E, PR-F, PR-G, PR-H, PR-I, PR-J and PR-K merge and its acceptance is evidenced.
- [ ] Mark the design log entries D37 (PR-A), D38 (PR-B), D39 and D41 (PR-E) and D42 (PR-F) Built, with their PRs (D40's page layout was replaced by D41).
- [ ] Before archiving, run `pnpm openspec:overlap --change improve-agent-interaction`, sync the specs, and record final open items in `notes.md`.


## 12. Configurable VM evidence delivery

- **PR delivery:** PR-I.
- **Outcome:** an operator can select file-only evidence delivery for tool-capable VM sessions while preserving inline compatibility.
- **Scope:** development environment/settings and VM relay launch, relay and guest launcher, guest evidence staging, tests, example environment and operator/architecture docs.
- **Non-goals:** UI controls, transport ceiling changes, new provider tools, database schema changes, automatic retries or live inventory actions.
- **Prerequisite:** task 5 merged.
- **Acceptance:** all scenarios of "Configurable VM evidence delivery".
- **Approach:** pass a validated enum explicitly through existing launch boundaries; preserve verification, temporary-file ownership, cleanup and upstream authority.
- **Verification:** focused RED/GREEN tests and applicable intake, tooling, types and formatting checks; native visual inspection is separately qualified.

- [x] 12.1 Add regressions for both modes, large/repeated results, refusals, integrity/write failures, validation and launch propagation; observe the new behavior fail.
- [x] 12.2 Implement the enum from development settings and standalone relay to the VM tool worker and evidence projection, preserving explicit inline delivery and cleanup.
- [x] 12.3 Document configuration, provider file-opening guidance, lifetime and rollout; run the applicable checks and record limitations.
- [x] 12.5 Implement and test coordinator/guest release confirmation before new citation grants. Cover first and repeated fetches outside the manifest, staging and response failures, duplicate or stale confirmations, worker restart, incompatible peers, and legacy preview/original digest handling over compatible peers in both modes. Bind the image format to the producing encoder contract. Test a stripped current rendition with pages and missing/unknown tags against an explicitly legacy preview. Verify the subsequent proposal decision through the coordinator.
- [x] 12.4 Independently review the exact implementation before publication; publish and verify selected CI only when requested. Merged as #262.

- [x] 12.6 Configure whole-photo preview or original independently of delivery mode, and verify exact bytes, budgets, crop semantics and launch configuration.

## 13. Answered questions fold away

- **PR delivery:** PR-J.
- **Outcome:**
  - an answered question folds to one line under "Answered", below the open questions, with what was answered and a clock (waiting in the inbox) or a tick (read, with its time), and expands to the question, the assumption, the answer, its effects, the delivery trail and links;
  - the same card in the drawer, the step page and the session page;
  - the step page never pins a non-open question into a form, and its own confirmed answer never shows the superseded warning;
  - named standings replace `stale`; the superseded warning shows only with a draft or an unconfirmed retry;
  - the Processing read carries each answered question's summary, effects and delivery, with read times from a new acknowledgement log;
  - the drawer shows messages, replies and answers in one time-ordered list, as the session page does: author-labelled bubbles, each answer once with its question quoted and linked, and "Sending…" on a message until it is saved, with a rail of dots on agent actions and a now dot while the session works (boards FixDrawerChat and FixDrawerChatRail).
- **Scope and approach:**
  - `contracts/src/processing.ts`: the `answer` member (with `values_omitted`), `session_history` and `replaced_by` on both question variants, and `contracts/src/sessions.ts`: the optional `replaces` on `SessionAskArgsV2` (design "Answered questions fold away");
  - a migration adding the append-only `agent_session_ack` interval log with a baseline row per existing cursor, the runner role's `INSERT` and the API role's `SELECT` on it (`processing/grants.ts`), and the stored replacement;
  - `agents/tools/handlers.ts`: `ask`'s `replaces` check (same job, earlier, unanswered), closing the replaced question;
  - `agents/tools/inbox.ts` (`acknowledgeSessionInbox` logs each advance) and the steered-turn settlement in `agents/session/session-runner.ts`, which must publish `session_changed` when it moves the cursor;
  - `processing/read.ts`: the answer summary from `processing_answer` and the question, the inbox item by `answer:<question_id>`, and the cursor and log; `requireRoom`'s per-question allowance in `agents/tools/handlers.ts`;
  - `components/batches/Batch.tsx`: the per-batch confirmed-outcome store and focus target, carried across a rekey beside `drawerRestore`;
  - `frontend/src/components/processing/SessionPanel.tsx` (one list through `ConversationRow`, no separate message list), `ChatBubble.tsx` (author labels and the quoted question on an answer), `SessionChatPanel.tsx` (the composer and the pending "Sending…" bubble) and `processing/session-history.ts` (drawer rows that keep chat, replies and answers; `chatMessages` removed);
  - `frontend/src/components/processing/QuestionAnswer.tsx` (`questionStanding` replacing `stale`), `SteppedAnswerForm.tsx`, `SingleAnswerForm.tsx`, a new `AnsweredQuestion.tsx` and its group, `DrawerAnswers.tsx` (answered questions keep a line instead of disappearing), and `ProcessingWorkspace.tsx` (the first-pin branch takes only an open question; the answer handler records its confirmed receipt and moves focus).
- **Prerequisites:** tasks 4 and 7, merged in PR-B (#251) and PR-E (#263). Independent of `polish-ui-styling-and-loading` task 15; with only this task, a cancelled reload still shows polish's old banner, but the card is right.
- **Acceptance:** processing-workspace "Answered questions fold away" and "An answer form says why it can't send", all scenarios, and the focus clause of "Answer a question step by step"; processing-workspace "An answered line without its summary", "Messages and answers in time order", "An action rail beside the history" and the revised "Your inputs in the session history"; processing-agent-sessions "Answered questions report their answer and delivery", "Answer summaries fit the snapshot" and "A question can name the one it replaces", all scenarios.
- **TDD approach:** the step-page regression fails first on today's code with the superseded warning; `questionStanding` cases and the PG read tests fail before the fields exist.
- **Verification:**
  - contracts tests; `pnpm db:intake test` on the read, inbox and runner tests (with `INTAKE_MEDIA_DECODER_IMAGE` and `INTAKE_MEDIA_PROBE_IMAGE`);
  - the frontend typecheck, lint, tests and build;
  - a demo video: answering on the step page, the line folding, the clock turning to a tick as the agent reads it, and expanding it.
- **Risks and decisions:** the canvas boards FixAnsweredQuestion, FixDrawerChat and FixDrawerChatRail (variant B, chosen) are the reference. "Read" is the session's acknowledgement, never a claim that it acted. If BI-022's PR-B (the `/7` duplicate check) has merged first, this PR exempts an ask that names the open question it `replaces` from that check, with its test.

- [x] 13.1 Read the shared, frontend and intake-server code guidelines, the frontend and intake-server architecture and the board. List every reader of `stale` and every surface that mounts `QuestionAnswer`.
- [x] 13.2 RED: frontend tests:
  - [x] 13.2.1 The step-page regression: render `ProcessingWorkspace` with `?question=`, answer it, return it answered from `client.read`, and again after a remount; it shows the Answered line, never a form or the superseded warning, and focus moves to the next open question or the "Answered" heading.
  - [x] 13.2.2 `questionStanding` for each standing, with and without a draft or an unconfirmed retry.
  - [x] 13.2.3 The line's states: sending (locked, no fold), saved from the confirmed outcome before the read lands, waiting, "will read it when it resumes", read with its time, read with no time, values omitted, couldn't send with Try again resending the same key, replaced with its link, and "No longer asked" after a Start fresh beside an unrelated open question.
  - [x] 13.2.6 A confirmed answer followed by a failed Processing read, and one followed by a reload that remounts Processing: both show the folded line and move focus to the chosen target; the confirmed outcome is dropped when a fresh read returns the question answered in the full, compact or state-only tier, and the group orders state-only lines after timed ones; for a runner question with `session_history` false, the full tier shows the answer summary with no read state and only the lot link, and the compact and state-only tiers show "Answered · details not shown" with only the lot link; with `session_history` true (a reused job a later session ran), the line links to the session with no read state.
  - [x] 13.2.4 Answered on the session page while the drawer holds a draft: the draft is kept with "Answered elsewhere" and Send unavailable; without a draft the drawer shows the line.
  - [x] 13.2.7 The drawer's one list (board FixDrawerChat): messages, replies and answers in the history read's order, including entries with equal times; an answer shown once, as the operator's bubble quoting "Examine asked" and the question with a link to it, and its effect note beside the time; a just-sent message showing "Sending…" in place of its time until a read returns it; "You" on the operator's bubbles and the stage name on the agent's, in the drawer and on the session page; photo views and web reads still folded in the drawer; no separate message list. The rail (board FixDrawerChatRail): a dot on every action row and none on bubbles; a solid segment between adjacent actions and a dashed one across bubbles; the filled now dot on the latest action only while the session is working, a plain dot when paused, waiting or done; no animation under reduced motion; the hidden live region still announcing the current activity; the same dots on the session page.
  - [x] 13.2.5 The expanded line's question, struck-through assumption, answer, effects, trail and links, for a `/2` and a `/1` question.
- [x] 13.3 RED: PG tests for the answer summary (a truncated text step, a choice with "Something else", a number with its basis, multibyte and escaped text within the byte bound), effects, delivery before and after `read_inbox` and after a steered turn commits its items, a `session_changed` from each cursor move, an answer acknowledged before the migration still read with no time after a later advance, an earlier runner question with no delivery, a retained batch near the serialized snapshot cap with many answered rows read across the upgrade in the full, compact and state-only tiers rather than the read failing, a compact answer with a recorded read time fitting its reserved size, `session_history` computed with the history route's job check, false for a job with only runner attempts (one with an `agent_session` row whose history read returns 404) and true for a reused job a later session attempt ran, and kept in every tier, `replaces` accepted and refused, and the API reading the log under its deployed role.
- [x] 13.4 GREEN: implement the contract, the migration, the log, the read, the standings, the card and the pin rule.
- [x] 13.5 Update `frontend/ARCHITECTURE.md` and `intake-server/src/agents/ARCHITECTURE.md`. Run the checks, and record the demo video for the PR description.

## 14. Question pictures

- **PR delivery:** PR-K.
- **Outcome:**
  - `ask` takes up to 5 figures and a `preview: true` dry run, with no new tool name;
  - the shared view recipe `bench-intake-view/1` and the decoder's `render_view`, run by the media worker from durable render requests;
  - a session-scoped figure route serving each view and thumbnail;
  - the card layouts for 1, 2 and 3–5 figures with marks as an overlay, and the larger view in a dialog, in the drawer, the step page, the session page and the expanded Answered line;
  - the agent guidance on when and how to attach pictures.
- **Scope and approach:**
  - `contracts/src/sessions.ts` (`SessionAskArgsV2` figures and preview), `processing.ts` (figures on the `/2` question DTO) and `media.ts` (the view recipe);
  - `media-decoder/src/` (`render_view`, reusing `rotated-region.ts`, and the marked preview) and its protocol;
  - a migration for `processing_figure_render`; the media worker's claim and the media GC (`media/worker.ts`, `media/gc-main.ts`);
  - `agents/tools/handlers.ts` (`ask` validation through `requireDeliveredSources` plus the delivered page, `recordMediaDelivery` and `confirmEvidence` recording pages, render requests, the preview wait and its bounded image reply) and `ask-guidance.ts`;
  - the VM relay and guest (`agents/shared-vm/evidence-request.ts`, `stage-evidence.ts`, `native-turn.ts`): an aggregate frame limit for preview replies, staging several images in the configured delivery mode, and a preview-only result that grants no citation;
  - a supervised render consumer (`media/render-worker-main.ts`) with its retention sweep and lease recovery, added to `tooling/deployment/host-media.compose.yaml` with the dispatcher socket, and run in `pnpm dev` by the existing media child (`intake-server/src/dev/media-main.ts`) through the local decoder launcher;
  - `media/routes.ts` for the figure route, beside the photo-view crop route;
  - `frontend/src/components/processing/` (a figures component and its dialog on `ui/ModalFrame`), the answer forms and `AnsweredQuestion.tsx`;
  - the fake CLI and synthetic session ask with a figure, for tests and the demo.
- **Prerequisites:** task 13 (the same card).
- **Acceptance:** processing-agent-sessions "Questions carry pictures" and "Agents preview their pictures"; processing-workspace "Questions show the agent's pictures" and "A larger view of a question picture", all scenarios.
- **TDD approach:** decoder, contract, PG and component tests fail first, before the recipe, the operation and the card exist.
- **Verification:**
  - decoder and contracts tests; `pnpm db:intake test` and `test:process` with the decoder and probe images, including the media worker rendering a photo region and a PDF page;
  - the frontend typecheck, lint, tests and build;
  - a demo video of a question with one, two and four pictures, the larger view, hiding the marks and opening the photo in Capture.
- **Risks and decisions:**
  - The canvas boards QuestionFigures and QuestionFigureDialog are the reference.
  - Light adjustment is not in this task; BI-022's recipe `/2` adds it on top of this view recipe.
  - Document pages ship with photos: PDF evidence pages are already decoded and served as page previews.
  - A preview waits on the media worker; `FIGURE_PREVIEW_WAIT_MS` bounds it, and the agent can call again.
  - If BI-022's PR-B (the `/7` duplicate check) has merged first, this PR makes a `preview: true` ask skip that check, with its test.

- [x] 14.1 Read the shared, frontend and intake-server code guidelines, the decoder README, the intake-server and media architecture and the boards. Confirm that admission still compares only tool names, and record where.
- [x] 14.2 RED: contracts and decoder tests:
  - [x] 14.2.1 The ask's figure limits (5 figures, 8 marks, caption 80, why 200, label 40) and the view recipe's bounds (quarter turns, ±15° straightening).
  - [x] 14.2.2 `render_view` on a photo and a PDF page: the cut region, quarter turns, straightening with the corner guard, the view and thumbnail sizes, and the marked preview differing from the view only by its marks.
- [x] 14.3 RED: PG and process tests:
  - [x] 14.3.1 `ask` refusals naming the figure: a version never delivered, a removed version, a missing page, a region outside the page, too many figures or marks; a manifest version the session never fetched refused; an unfetched page of a fetched PDF version refused, under direct delivery and under VM file and inline delivery with the page bound to the release receipt (in each VM mode the fetched page is refused before the acknowledgement and accepted after it, while another page of the same version stays refused), while a proposal citing that version is still admitted; a valid ask, including one citing a version announced and fetched after the manifest was sealed, storing its figures and render requests in one transaction.
  - [x] 14.3.2 A preview returning the marked renders within the image budget, storing no question; a preview retried with edited marks rendering again; a preview that times out returning a retryable result with no images; too many pending previews refused as busy; file and inline delivery of a five-image preview through the paired VM path within the aggregate frame limit, and a correctable refusal above it, with no citation granted.
  - [x] 14.3.3 The supervised render consumer, started with the dispatcher socket as the deployment starts it, rendering a five-figure preview and recovering an expired lease without a manual worker run, and the dev media child rendering a preview through the local launcher; claiming and rendering requests, an expired lease reclaimed, a request failing three times settling as failed, `processing_changed` on settlement; the sweep removing unreferenced and expired preview renders and a removed version's renders and releasing their pins, under the deployed roles.
  - [x] 14.3.4 The figure route: a ready view, still preparing, a removed version, another batch's or account's session, and a figure index out of range.
- [x] 14.4 RED: frontend tests for each layout, the thumbnail strip's arrow keys, marks as an overlay, "Photo removed" and "Preparing picture…", the dialog (zoom, Fit, Whole photo, previous and next, the marks switch, the listed marks, Open in Capture and Add a photo), and pictures in the expanded Answered line.
- [x] 14.5 GREEN: implement the contract, the operation, the render queue, the route, the handler, the guidance and the UI. Teach the fake CLI and the synthetic session an ask with a figure.
- [x] 14.6 Update `media-decoder/README.md`, `intake-server/ARCHITECTURE.md`'s retained media section, `intake-server/src/agents/ARCHITECTURE.md` and `frontend/ARCHITECTURE.md`. Run the checks, and record the demo video for the PR description.
