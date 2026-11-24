# Change proposal

## Problem and intended outcome

Mitch reported these problems while working with agents in a live batch on 2026-11-23, and from the canvas review that followed:

1. **The session drawer ignores clicks outside it.** It is dimmed like a modal, but clicking the dimmed page does nothing; only Esc and Close close it.
2. **Answering an agent's question is clunky and can fail.** An agent asks one free-form prompt that may hold several questions. It sets the question to `quantity` or `clarification`, and the operator gets one field. A prose reply to a `quantity` question fails with "Enter a positive exact quantity with at most six decimal places." Mitch reported that error in a live session. There is no way to offer answer choices: the drawer shows two disabled option cards saying "Questions don't carry the session's answer options yet".
3. **A session's history says little.** The drawer's timeline shows status lines and generic entries ("Published a proposal", "Proposed a lot") with no details and no links. The operator's own answers and instructions don't appear in it.
4. **There is nowhere to see everything a session did**: which photos it looked at, which pages it read, and how each attempt started and ended.
5. **The activity bar misreports waiting work.** In the masthead activity popover, a stage that has made progress but waits on questions is drawn like a stage that hasn't started: `ProgressSegments` has one `waiting` state, drawn empty at 45% opacity, for both. A working stage only pulses its fill, and a paused batch looks the same as a running one.
6. **The popover says too little per stage.** It shows one bar, the newest status line and one link, with no per-stage counts, status or navigation.
7. **Sessions are hard to read and act on.** Found on the canvas "Fixes: before and after" page (v77–v78) and approved by Mitch:
   - The Agents page shows one row per attempt, so retries flood it (Mitch's Heyyy batch showed 8 rows for 3 sessions). Processing's list already shows one card per job, but hides its earlier attempts.
   - Failures show generic category advice instead of the recorded cause.
   - Only a row's step name links, to the drawer; the row's title and the failure details don't open the session.
   - The drawer header says little.
   - The Agents page opens on everything.
   - Recent activity shows the agent's raw status lines with internal IDs.
   - The message box has no label or hint.

The outcome sought:

- Any dialog, the session drawer included, closes when the operator clicks its backdrop, through its own close guard; where Esc closes the dialog, the backdrop does the same. An unsaved answer still stops the close and shows the existing warning. The crop editor, which ignores Esc, closes from its backdrop only when its crop is unsent or confirmed.
- An agent asks **one question per `ask`**. A question has one step, or up to four related steps that the drawer shows one at a time and sends together.
- Each step has its own answer kind:
  - **choice**: 2–6 options from the agent, shown as clickable cards, with an optional "Something else…" text answer;
  - **number**: a lot's quantity, counted or estimated;
  - **text**.
- A number step checks the value as it is typed, with a plain fix, and offers "Answer in words" when a number can't be given.
- The agent states the assumption it works on for each step, and the drawer and Needs you show it.

- Every history entry with more to show expands in place to its details, and links to the pages it concerns. Runs of the same action are grouped. The operator's inputs (answers and instructions) and the app's notices of new photos and revisions appear in the history; chat stays in the chat.
- Each session gets a page inside its batch's Processing that shows it as one conversation, oldest first: action rows, chat bubbles, question cards answered in place, the operator's inputs and attempt dividers. It has filters, a message box, side panels for the photos it viewed and the sources it cited, and debug details. The drawer summarises photo views and web reads in one line and links to the page.
- The activity popover is 520 px wide on desktop, with one row per stage linking to its step page, showing a count where there is one, a state and a short status line.
- Each stage's bar shows done, working, waiting for you, paused, queued, not started or failed. Only a stage being worked on now animates, and a paused batch is hatched and offers Resume.

The design for items 1 and 2 is on the Bench Intake Redesign canvas, v70. The boards are "Session drawer: click outside to close, one question at a time" and "Agent questions: choices, numbers, words and steps", with the "Proposal: agent questions" sticky. The design log entries are D37 and D38. Items 3 and 4 are in v71–v75: "Session timeline: expandable entries with links", and the session page as "Option B (chosen) · Agent session page as a conversation", beside the unchosen option A (D39–D41). Items 5 and 6 are on the Masthead options page: "Activity popover: stage rows, counts and bar states" (D42).

Mitch will add more agent-interaction items to this change. This proposal covers the seven above and configurable VM evidence delivery; later items are folded in with `openspec-update-change`.

## Change identity and linked items

- Change: `improve-agent-interaction`. Branches use `feat/improve-agent-interaction-<suffix>`, and subjects `type(improve-agent-interaction): …`.
- **BI-019** (new): Agent interaction improvements.
- **BI-015** (`complete-design-refresh-backend`): this change takes over its item "Inventory questions that carry their answer options". BI-015 keeps the existing-record comparison fields (InvenTree column and date code).

## Current behavior and evidence

- **The drawer:**
  - Before this change, `frontend/src/components/ui/Dialog.tsx` opened a native `<dialog>` with `showModal()` and closed only on `cancel` (Esc) or its Close button, with no pointer handling for the backdrop. Task 1 rebuilt it on Radix Dialog.
  - `ProcessingWorkspace.tsx` passes an `onClose` that shows "Save or discard your answer before closing this session" while an answer draft is unsaved.
- **The ask tool:**
  - `SessionAskArgs` in `contracts/src/sessions.ts` takes `{kind: quantity|clarification, subject_id, prompt, reason, fields, assumption}`; `prompt` is free text of up to 2048 characters.
  - The tool description in `intake-server/src/agents/tools/server.ts` doesn't tell the agent to ask one thing at a time.
- **The answer form:**
  - `QuestionAnswer.tsx` builds `bench-intake-answer/1` with `{kind: quantity, value, basis}` or `{kind: clarification, text}`. It validates against the contract only on submit, with one fixed message per kind ("Enter a positive exact quantity with at most six decimal places." or "Enter a clarification of up to 2048 characters.").
  - `DrawerAnswers.tsx` draws two hard-coded disabled option cards (`OPTIONS_NOT_CARRIED`).
- **Server effects** (`intake-server/src/processing/session-answers.ts`):
  - A quantity answer sets the lot quantity through one capture edit, and a clarification becomes one note.
  - Both reach the asking session as an `answer` inbox item and mark relying proposals stale.
  - `CaptureEdit` carries one `change`.
- **Older questions:** runner questions of earlier profiles use `ProcessingQuestionSpec` and `processing/answers.ts`, with a continuation attempt. They stay as they are.
- **History:**
  - `SessionTimeline.tsx` maps outbox kinds to fixed strings (`stepText`) and drops replies. Entries carry only IDs (`lot_id`, `proposal_id`, …) and have no links.
  - `agents/tools/timeline.ts` reads one job's outbox and inbox, up to the newest 500 of each stream (`TIMELINE_LIMIT`), with `truncated`; it does not page. Outbox sequences restart with each attempt, and inbox sequences run per job.
  - `fetch_evidence` deliveries are charged to an in-memory image budget (`handlers.ts`), and nothing is recorded in the history.
  - Session proposals (`bench-intake-proposal/5`) cite notes and media versions (`ProcessingSource`, shared with `/4`), and the handler refuses any source not delivered to the session; host research receipts exist only in the older `/3` union (`ProcessingSourceV3`). A VM agent that read a page with WebFetch has no way to cite it, and web reads inside the provider are seen only by the egress proxy, as hosts.
  - Routes exist for a lot, the map, a record, a step with a question and Capture (`navigation/batch-route.ts`); there is no session page.
- **Activity popover:**
  - `components/masthead/ActivityPopover.tsx` renders one `ProgressSegments` bar per batch, the newest status line and "Open processing".
  - `frontend/src/header/workSegments.ts` keeps `done` and `failed` but maps every other non-running state to `waiting`, so a stage waiting for the operator and one not started look the same; a step with no counted jobs falls back to its retained jobs' state, without a fraction. `ProgressSegments.tsx` fills a running step without a count to an invented 50% (`RUNNING_WITHOUT_FRACTION`).
  - The header read's step counts (`contracts/src/header.ts`, `stepJobs`) carry `jobs`, `ready` and `running`, and the attention read adds `questions` and `failed`. They count jobs of active subjects (`processing/steps.ts`), not lots, so a step with no jobs yet reads `0 of 0`. Neither has waiting-for-you or queued counts, or the batch's paused flag, which lives in `intake-server/src/agents/pause.ts`.
- **Specs:** current requirements are in `processing-workspace` (the session drawer and the Inventory session drawer's disabled option cards), `processing-stage-pipeline` ("Non-blocking questions with assumptions") and `processing-agent-sessions`.
- **Agents and failures:**
  - The Agents read (`agents/session/sessions.ts`) pages by attempt, 50 at a time, with `job_id` and `latest_on_job`; it carries no batch archive flag or web setting.
  - Its failure summary (`agents/failures.ts`) holds the category, summary and recovery. The provider error and cause are loaded only when the details are opened in debug mode (`SessionFailureDetails.tsx`).
  - The regroup outbox item keeps only the destination lot IDs, and an attempt records no reason for starting.
- **Unverified:** the exact prompt of the failed question in Mitch's screenshot. That its answer was prose to a `quantity` question is inferred from the only client-side message of that shape.

## Scope and non-goals

In scope:

- Backdrop click closes every `Dialog` through its existing `onClose`, and does nothing while `closeDisabled` is set. A press that starts inside the dialog and is released on the backdrop doesn't close it.
- A versioned session question with 1–4 steps and three answer kinds, plus its versioned answer. The `ask` tool, its validation and its description change to match.
- The drawer's stepped answer form with a check-your-answers summary, option cards, inline number validation and "Answer in words".
- Answer effects:
  - a number step sets the lot's quantity;
  - choice and text steps are saved as one note on the subject;
  - the session receives every step's value, with the option id for a choice.
- Needs you and Overview rows show each question's kind or step count and its assumptions.
- Agent instructions that ask one question per `ask` and offer options when the answer is one of a few.
- A server-built session history view: each entry has its summary, details and typed link targets, the operator's inputs are included, and older entries page in.
- Expandable, grouped entries in the drawer, with one summary line for runs of photo views and web reads.
- A recorded photo view for each delivered `fetch_evidence` image.
- Configurable VM evidence delivery: `INTAKE_VM_EVIDENCE_DELIVERY=inline|file`, default `inline`; file mode supplies a temporary local image path and citation metadata without inline image bytes.
- A proposal source kind for an agent-reported web page URL, shown as unverified.
- The batch-scoped session page as a conversation, with a message box and questions answered in place, linked from the drawer, the Agents page, the session lists and the failure details.
- Per-step `waiting` and `queued` counts, `questions`, the batch's live `lots`, and the batch's `paused` flag in the header and attention reads.
- Stage rows in the activity popover, and the new bar states and animation rules in `ProgressSegments` (also used on the Processing overview).
- From the Fixes page:
  - one row per session on the Agents page, from a read that pages by session, and earlier attempts folded beneath the row there and on Processing's job cards (S1);
  - failures in plain words from the recorded provider error and cause, carried in the failure summary so they show without debug mode, with advice behind help (S2);
  - row titles that open the session, and recovery actions on failed rows (S3);
  - the drawer header (S4);
  - Agents page filter chips opening on Needs attention, with batches that need nothing collapsed and archived batches only under All (S6);
  - recent activity in the app's words, with the agent's note muted, and instructions to keep internal IDs out of status lines (S8);
  - the labelled message box (O6).

Non-goals:

- Multi-select choices.
- Answering from the Overview without opening the drawer.
- A heuristic that refuses prompts containing several question marks.
- Changing the earlier runner question path (`ProcessingQuestionSpec`, `bench-intake-answer/1`); retained `/1` session questions keep the current form.
- The existing-record comparison fields that BI-015 keeps.
- Saved copies of web pages or an app-side `fetch_web` tool with receipts (the provenance follow-up named in BI-017).
- Hosts read through the egress proxy in the history (a later addition).

Compatibility:

- Retained session envelopes with the `/1` ask payload must still decode and stay answerable.
- Tools and contracts stay app-owned. Configurable evidence delivery changes only the representation returned inside tool-capable VM sessions; it adds no tool or filesystem authority.
- `native-agent/2` and `shared-vm-agent/3` sessions get the new `ask` schema through the same tool server, so no profile bump is needed. The admission checks compare tool names, not schemas; design confirms this. `shared-vm-agent/2` is retired and keeps only its readable history.

## Reuse and dependency assessment

| Option and relevant version | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence and date checked | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| Native `<dialog closedby="any">` light dismiss | No JavaScript; routes through `cancel`, so the existing guard applies | Not supported in Safari, including 26.x previews; iOS light dismiss is tracked separately. Mitch uses Safari and a phone, so a fallback is needed anyway | [caniuse wf-dialog-closedby](https://caniuse.com/wf-dialog-closedby), [WebKit 284592](https://bugs.webkit.org/show_bug.cgi?id=284592), [Chrome light-dismiss guide](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/light-dismiss-a-dialog.md.txt), checked 2026-11-23 | Behavior under jsdom tests |
| `dialog-closedby-polyfill` (npm) | Fills Safari | A new runtime dependency for a few lines of code; the package page sits under a supply-chain incident notice | [socket.dev listing](https://socket.dev/npm/package/dialog-closedby-polyfill), checked 2026-11-23 | Maintenance and provenance |
| Extend `Dialog.tsx`: pointerdown and click on the dialog element outside its content box, calling `onClose` (first recommended, then replaced) | Works in every browser; no dependency | Four review rounds found pointer and click edge cases in the custom handler, with one still open | The superseded handler (`ui/useBackdropClick.ts` in this change's earlier commits; see notes.md); the [Chrome guide's fallback pattern](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/light-dismiss-a-dialog.md.txt) | Each browser's pointer and click reporting |
| `@radix-ui/react-dialog` 1.3.1 (recommended; Mitch's decision, 2026-11-23) | Owns outside-press, Escape, focus trapping and nested layers; one modal system for every dialog; the existing `onClose` guard and `closeDisabled` apply through `preventDefault()` | One new package. It pins the same shared primitives as the installed `@radix-ui/react-popover` 1.3.1, released the same day. MIT licence, as the installed Radix packages. No GitHub security advisory for it or `@radix-ui/react-popover`; `pnpm audit --prod` reports nothing in the Radix packages; the release carries npm provenance attestations | [npm @radix-ui/react-dialog](https://www.npmjs.com/package/@radix-ui/react-dialog), released 2026-10-12; the [GitHub advisory database](https://github.com/advisories?query=ecosystem%3Anpm+radix-ui); checked 2026-11-23 | Behaviour under jsdom tests. Radix alone only sets `aria-hidden` on the page behind, and leaves live regions exposed; `ModalFrame` adds the `inert` page, as the native modal had it. The provenance attestations were listed, not independently verified |
| Expandable entries: native `<details>`/`<summary>` | Built-in keyboard and screen-reader behavior, no dependency; the canvas draws it this way | Styling of the marker varies a little by browser | MDN `<details>`; the canvas v71 boards | None material |
| Stepped questions: a form or wizard library | — | The repository already uses `react-hook-form` and its own `OptionRow`, `Fieldset` and `QuestionCard`; a wizard library adds nothing these can't do | `frontend/package.json`, `frontend/src/forms` | — |
| Stepped questions: extend contracts, `QuestionAnswer` and `DrawerAnswers` (recommended) | Keeps the TypeBox contract as the single source for the agent schema, server validation and the form | Custom UI work | The current source listed above | — |

**Recommendation:**

- Rebuild `Dialog.tsx` on `@radix-ui/react-dialog` for the backdrop click, with the crop editor on the same layer.
- Build the stepped question on the existing contracts and form stack.
- Use native `<details>` for expandable entries, and the existing route helpers for links.
- `@radix-ui/react-dialog` is the only new dependency.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `processing-workspace`: the session drawer closes from its backdrop, and steps are answered in the drawer. The Inventory drawer's option cards become live. Expandable history with links, the operator's inputs in it, the drawer/page split and the session page.
- `agents-overview`: each session row links to its session page.
- `header-workflow-status`: stage rows in the workflow details, the stage bar states, only working stages animating, and Resume as the one command in the workflow details.
- `agents-overview` also gains session rows, recovery actions and the Needs attention and Done today filter rules. `processing-workspace` gains failures in plain words, the drawer header, activity in the app's words and the labelled message box. `processing-agent-sessions` gains readable status lines.
- `processing-stage-pipeline`: non-blocking questions are one question with 1–4 steps, each with an answer kind and an assumption.
- `processing-agent-sessions`: the `ask` tool's structured question, the delivery of stepped answers to the session, recorded photo views and agent-reported web page sources, which "Bounded status lines and delivered citations" now allows as the one undelivered source kind.
- `ui-design-system`: dialogs close from their backdrop.

## Impact and dependencies

- **Contracts:**
  - a `/2` ask payload and question spec;
  - a `bench-intake-answer/2` answer;
  - a new `answer` inbox payload variant;
  - the session envelope union.
- **Intake server:**
  - `agents/tools/handlers.ts` (`ask`) and the `server.ts` description;
  - `processing/session-answers.ts`, which applies up to two capture edits in one transaction, and `capture/repository.ts`, whose locked edit handle applies only one edit today;
  - the read model that returns questions to the frontend;
  - the session runner prompt.
- **History and page:** `agents/tools/timeline.ts` and its route in `processing/routes.ts`; a migration allowing a new `photo_view` outbox kind; the proposal source union; `SessionTimeline.tsx`; a new session page and route in `navigation/batch-route.ts`; the Agents page rows (`agents/AgentSessions.tsx`) and the Agents read (`agents/session/sessions.ts`).
- **Frontend:** `Dialog.tsx`, `QuestionAnswer.tsx`, `DrawerAnswers.tsx`, `ui/QuestionCard.tsx`, and the Needs you and Overview rows.
- **Fixtures:** the fake CLI and synthetic session gain stepped questions for tests and the demo.
- **Prerequisites:** none.
- **Coordination with `polish-ui-styling-and-loading`:** that change owns the shared state words (S7: Working, Waiting for you, Queued, Paused, Done, Failed, Not started) and the time format (S5: "Today 13:35"). This change uses both, through the shared `WorkState`, `StatePill` and `EventTime` components in `frontend/src/components/ui`; whichever change lands first defines them. If polish hasn't merged when PR-F starts, PR-F adds them with polish's words and format, and PR-G and PR-H wait for PR-F or polish. Polish also modifies processing-workspace's "Processing overview" requirement and adds "Step pages count their own step" and header-workflow-status's "The summary names what needs attention"; this change leaves those alone. Both changes edit `ProcessingWorkspace.tsx`, so whichever merges second rebases. Coordinate any `session-runner.ts` prompt edit with `simplify-vm-agent-web-and-setup`, which is still open.

## Delivery and parallel work

The work is eight PRs after the plan. Tasks › "Parallel work" sets out exactly which can be built at the same time: PR-A, PR-B, PR-D1 and PR-F together first, then PR-D2, PR-E, PR-G and PR-H one after another, a critical path of five. Mitch applied one re-carving on 2026-11-23: recorded photo views and web sources (PR-D1) are split from the history read (PR-D2), so they start in wave 1 and BI-022 can start without the history read. Three further re-carvings stay proposals.

## Open decisions and assumptions

Decided by Mitch on 2026-11-23:

- A choice is clicked, then sent (Send or Next).
- Up to 4 steps and 2–6 options per choice; one option per step (no multi-select).
- Every dialog closes from its backdrop, through its own close guard.
- The operator's inputs appear in the history; chat stays in the chat.
- Photo views are recorded, and runs of the same action are grouped.
- Web reads: exact URLs for pages the agent cites, shown as agent-reported; proxy hosts later.
- The session page is batch-scoped and shown as a conversation (option B). It has a message box, and questions are answered in place with the same form as the drawer.
- The activity popover gets stage rows, counts, a status line and new bar states. It is wider on desktop.

Assumptions:

- An option label is up to 80 characters, with an optional detail of up to 160.
- "Something else" is allowed per step by the agent (`other: true`), on by default for choice steps.
- A number step needs a live lot subject. "Answer in words" turns that step's value into text, and the lot quantity is then unchanged.
- A stepped answer is sent once, after the summary. Partial answers are not sent.
- The history read returns 200 entries per page, newest first, from one snapshot, with a `before` cursor for older pages. On each change the drawer and the page re-read the newest page; the drawer reads only that page.
