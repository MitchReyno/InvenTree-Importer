# Implementation and delivery tasks

## Plan context

- **Plan:** the [proposal](proposal.md) and [design](design.md), with deltas for `processing-agent-sessions`, `processing-stage-pipeline` and `processing-workspace`.
- **Reuse:** no external dependency.
- **Change name:** `lot-session-handoff`. Branches are `feat/lot-session-handoff-<suffix>`, and subjects are `type(lot-session-handoff): …`.
- **Items:** BI-020.

## Completion and commit ordering

- Check a completed action in the same commit as its work.
- Review, publication, CI and merge actions stay unchecked until they happen.
- Never commit in a worktree while an intake test tier runs there.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. The brief, its input version and `read_lot` | Contracts and intake server | None | "Lot sessions start from a hand-off brief", "Lot sessions can re-read their brief", "Session tool boundary" |
| 2. Duplicate-question check and revisions with changes | Intake server | BI-019 PR-B | "Questions are not asked twice", "Revisions carry the change" |
| 3. Precedence instructions, profile and requalification | Intake server and live | 1, 2 | "Human facts take precedence"; live evidence |
| 4. The brief on the session page | Frontend | 1, BI-019 PR-E | "The brief on the session page" |

## PR delivery map

| Bundle | Outcome | Tasks | Why this boundary | Prerequisites and order | Base, branch and subject | Gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-0 | This plan and BI-020 | Planning | Review before code | None | `interactive-app` ← `docs/lot-session-handoff`; `docs(lot-session-handoff): plan the lot session hand-off` | `openspec validate --strict`; review; CI |
| PR-A | The brief sealed in the input, the opening and `read_lot` | 1 | The data path, usable by the existing instructions | PR-0 | `feat/lot-session-handoff-brief`; `feat(lot-session-handoff): give lot sessions Examine's findings` | Contracts, intake unit, PG and process tiers; review; CI |
| PR-B | No re-asking, and revisions that carry the change | 2 | Both change what a session is told after it starts | PR-A, BI-019 PR-B | `feat/lot-session-handoff-no-repeats`; `feat(lot-session-handoff): stop repeated questions and send revision changes` | Intake tiers; review; CI |
| PR-C | Precedence rules in a new profile, with the live requalification | 3 | The behaviour change and its live proof together | PR-A, PR-B; Mitch's go-ahead for the live run | `feat/lot-session-handoff-profile`; `feat(lot-session-handoff): weigh human facts first in lot sessions` | Admission tests, intake tiers, live evidence on the PR; review; CI |
| PR-D | The brief on the session page | 4 | The UI over PR-A, after the page exists | PR-A, BI-019 PR-E | `feat/lot-session-handoff-page`; `feat(lot-session-handoff): show the brief a lot session started from` | Frontend checks; demo video; review; CI |

## 1. The brief, its input version and `read_lot`

- **PR delivery:** PR-A.
- **Outcome:** lot sessions start with a sealed brief rendered in their opening within budget, and can call `read_lot`.
- **Scope and approach:**
  - contracts (`LotHandoffBrief`, `ProcessingInputV7`, `read_lot`);
  - `processing/session-input.ts` and `queueJob`, which build and seal the brief;
  - `agents/session/session-runner.ts` (`openingText`);
  - `agents/tools/server.ts` and `handlers.ts` (`read_lot`);
  - whether earlier readings are retained, adding `previous_readings` if not.
- **Prerequisites:** none.
- **Acceptance:** "Research starts with Examine's findings", "A corrected transcription", "Brief over budget", "Resumed after a correction", and the tool boundary.
- **TDD approach:** PG tests for assembly, budget, scope and paging fail first.
- **Verification:**
  - contracts tests;
  - `pnpm db:intake test` and `test:process` (both need the decoder and probe images);
  - one opening captured from a fake session, attached to the PR.
- **Risks and decisions:** the 48 KiB budget; settle the earlier-readings question in 1.1 and record it in `notes.md`.

- [ ] 1.1 Read the code guidelines and the intake architecture. Check whether correcting an observation keeps its earlier readings, and record the answer.
- [ ] 1.2 RED: write the tests.
  - [ ] 1.2.1 Contract tests for the brief and V7.
  - [ ] 1.2.2 PG tests: assembly of each section, human facts marked, the asked list scope, regions, and the budget summary.
  - [ ] 1.2.3 PG tests: `read_lot` own-lot only, paging and revision.
- [ ] 1.3 GREEN: implement the brief builder, sealing, the opening rendering and `read_lot`, plus earlier-reading retention if needed.
- [ ] 1.4 Add a process test with a fake lot session reading its brief and calling `read_lot`. Update `intake-server/src/agents/ARCHITECTURE.md`, and run the tiers.

## 2. Duplicate-question check and revisions with changes

- **PR delivery:** PR-B.
- **Outcome:**
  - `ask` returns an existing covering question unless `new_evidence` is named;
  - `revision` items carry `changes` and their source, from the identity and correction paths.
- **Scope and approach:** `agents/tools/handlers.ts` (`ask`), the contracts' inbox payload, `processing/stable-identity.ts`, and the reading-correction path.
- **Prerequisites:** BI-019 PR-B merged.
- **Acceptance:** "Examine already asked", "New evidence justifies asking", "Identity revised after Research started", "Reading corrected by the operator".
- **TDD approach:** PG tests fail first.
- **Verification:** the intake unit, PG and process tiers.
- **Risks and decisions:** field overlap on `/1` questions uses `fields` only.

- [ ] 2.1 Map every revision sender, and the question lookup by subject, Part and batch.
- [ ] 2.2 RED: write the tests.
  - [ ] 2.2.1 Duplicate checks: open, answered, Part-level, batch-level and the `new_evidence` override.
  - [ ] 2.2.2 Revision `changes` from the identity path and from an operator correction.
- [ ] 2.3 GREEN: implement both.
- [ ] 2.4 Run the tiers.

## 3. Precedence instructions, profile and requalification

- **PR delivery:** PR-C.
- **Outcome:** a new profile version whose instructions carry the precedence, conflict and no-re-asking rules, admitted and live-qualified on Claude and Codex.
- **Scope and approach:** a migration adding the profile, `processing/session-policy.ts`, admission, the deployment notes, and the live harness (`tooling/deployment/tests/dispatch/live-tools.sh`).
- **Prerequisites:** tasks 1 and 2, and Mitch's go-ahead for the live run.
- **Acceptance:** "Doubting a correction", plus live evidence of reliance on Examine's identity, observation citations and no re-asking.
- **TDD approach:** admission and profile tests fail first. The live run is manual evidence.
- **Verification:** the intake tiers, and live runs on `bench-agent-m1-local` with web on and off, recorded on the PR.
- **Risks and decisions:** provider behaviour is not guaranteed by tests; the live evidence is a sample.

- [ ] 3.1 Draft the instructions and get Mitch's review of the wording.
- [ ] 3.2 RED: profile and admission tests for the new version.
- [ ] 3.3 GREEN: write the migration, the policy and admission.
- [ ] 3.4 Run live on both providers with Mitch's go-ahead, and attach the evidence to the PR.

## 4. The brief on the session page

- **PR delivery:** PR-D.
- **Outcome:** the brief appears as the first, collapsible item of a lot session's conversation, with corrections marked.
- **Scope and approach:** the history read gains a `brief` entry from the sealed input; the session page renders it (`components/processing/`).
- **Prerequisites:** task 1 and BI-019 PR-E.
- **Acceptance:** "See what Research started from".
- **TDD approach:** read and component tests fail first.
- **Verification:** the frontend checks and a demo video.
- **Risks and decisions:** none.

- [ ] 4.1 RED: write the tests.
  - [ ] 4.1.1 A history-read test for the brief entry.
  - [ ] 4.1.2 Component tests, collapsed and expanded, with the corrected reading marked.
- [ ] 4.2 GREEN: implement the entry and the rendering.
- [ ] 4.3 Run the frontend checks, and record the demo video.

## Delivery evidence and lifecycle follow-up

- [ ] PR-0: review the plan read-only, fix findings, publish, CI green, merge.
- [ ] PR-A: implement task 1, review the exact head, publish, CI green, merge.
- [ ] PR-B: implement task 2, review the exact head, publish, CI green, merge.
- [ ] PR-C: implement task 3 with the live evidence, review the exact head, publish, CI green, merge.
- [ ] PR-D: implement task 4, review the exact head, publish with the demo, CI green, merge.
- [ ] Update BI-020 as PRs merge. It is Done only after PR-D merges and the live evidence is accepted.
- [ ] Mark design log D43 Built.
- [ ] Before archiving, run `pnpm openspec:overlap --change lot-session-handoff`, then sync and record open items in `notes.md`.
