# Change proposal

## Problem and intended outcome

A lot's Research, Images and Inventory sessions start knowing almost nothing of what the Examine lead session found. Mitch asked on 2026-11-23 that a lot session be given:

- Examine's findings: classifications, transcriptions, descriptions and its identity;
- the item's captured evidence, so it can form its own view;
- human-provided facts, weighted highest.

The session should flag conflicts with what a human said, but never re-flag what Examine or another session already raised. His examples: you correct a wrong transcription of component markings, or you answer a question Examine asked about the same thing.

The outcome sought:

- **A hand-off brief.** Every lot session starts from a brief containing:
  - Examine's current identity, with its ID so it can be relied on;
  - the lot's observations: their regions, readings, source types, confidence, visible counts and descriptions;
  - the operator's corrections, answers, notes and lot edits, marked as human;
  - every question already asked about the lot or its Part, with its answer;
  - the lot's evidence, with the regions Examine used.
- **Precedence instructions:** human facts first, then the evidence as the agent reads it, then Examine's readings, then web sources.
- **Conflicts:** a conflict with a human fact is asked once, citing what conflicts, and never overridden quietly.
- **No re-asking, enforced:** `ask` returns the existing question instead of asking again about the same subject and fields, unless the agent names new evidence or a new conflict.
- **Updates carry the change itself.** A revision names the changed fields with old and new values, or the corrected reading with your value, instead of a one-line summary.
- **`read_lot`.** A read-only tool returns the current brief, so a resumed session re-reads the state instead of relying on its earlier context.
- **The brief on the session page.** It is the first item of a lot session's conversation, so you can see what the agent started from.

The design is on canvas v76, "Lot session hand-off: the brief Research starts from" (design log D43).

## Change identity and linked items

- Change: `lot-session-handoff`. Branches are `feat/lot-session-handoff-<suffix>`, and subjects are `type(lot-session-handoff): …`.
- **BI-020** (new): Lot session hand-off.
- Related: BI-019 (`improve-agent-interaction`), whose stepped `ask` (PR-B) and session page (PR-E) this builds on, and BI-017, which also edits the session runner's instructions.

## Current behavior and evidence

- **The opening:** `openingText` in `intake-server/src/agents/session/session-runner.ts` sends a lot session:
  - the lot record (label, quantity, estimate and basis, `evidence_observation_ids`);
  - the linked Part record;
  - the notes;
  - the evidence IDs;
  - defaults, web guidance and instructions.
- **What it leaves out:** `pinned_proposal_ids` and the manifest's `observations` (`contracts/src/processing.ts`, `inputV6Shared`). So Examine's identity, its readings and the regions it used never reach the session.
- **No way to look them up:** lot sessions have no `read_batch` (`LEAD_ONLY` in `agents/tools/server.ts`). Observation IDs can be cited (`handlers.ts` checks they belong to the lot), but their contents can't be read. A pinned proposal can be relied on, but its ID isn't given.
- **Revisions:** an identity revised after a successor has run sends `revision` with `fields: ['identity']` and "The lot's identity was revised: ‹summary›" (`processing/stable-identity.ts`).
- **Asking twice:** nothing stops a session asking what another session already asked.
- **A conflicting instruction:** the `shared-vm-agent/3` instructions (migration `0033`) say "Cite web facts by URL in the proposal's sources", but proposal sources have no URL kind. BI-019 plans the agent-reported web source.
- **Unverified:** whether an observation keeps its earlier reading once the operator corrects it. `CaptureEvidenceObservation` carries `operator_edited` and the current `readings`; task 1 settles this.

## Scope and non-goals

In scope:

- the brief, assembled server-side from retained state and sealed into the session input;
- its opening text, size budget and `read_lot`;
- the duplicate-question check in `ask`;
- revision items carrying the change;
- the precedence instructions in a new profile version, with its admission and a live requalification;
- the brief as the first item on the session page.

Non-goals:

- Free-form chat between agents (decided against on 2026-11-23).
- Changing Examine's own tools.
- Retaining the model's prose.
- The agent-reported web source (BI-019).

Authority is unchanged. Briefs are read-only and contain only this batch's data for the session's own lot, its Part and the batch level.

## Reuse and dependency assessment

No external package is relevant. The data is all retained in the intake database. The work is assembling it, sealing it into the existing versioned session input, and an instruction change. It reuses:

- `ProcessingInputV6` (as a new version);
- the session-scoped tool server;
- the outbox and inbox;
- the session page from BI-019.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `processing-agent-sessions`: the hand-off brief, `read_lot` in the tool boundary, the precedence and no-re-asking rules, and the duplicate-question check.
- `processing-stage-pipeline`: revisions carry the change.
- `processing-workspace`: the brief on the session page.

## Impact and dependencies

- **Contracts:** a `ProcessingInputV7` (or a brief field on a new input version), `LotHandoffBrief`, `read_lot` arguments and result, and the `revision` inbox payload with changes.
- **Intake server:** `processing/session-input.ts`, `agents/session/session-runner.ts`, `agents/tools/server.ts` and `handlers.ts`, `processing/stable-identity.ts`, the correction and answer paths that send revisions, and a new `shared-vm-agent/4` profile with its migration and admission.
- **Frontend:** a brief entry kind on the session page.
- **Prerequisites:**
  - BI-019 PR-B (the stepped `ask`), for the duplicate-question check;
  - BI-019 PR-D and PR-E (the history read and session page), for the brief on the page;
  - coordinate instruction edits with BI-017.
- **Live run:** the requalification needs Mitch's go-ahead.

## Open decisions and assumptions

- **Assumed:** the brief's budget is 48 KiB of text. Past it, observations are summarised and `read_lot` returns the rest in pages.
- **Assumed:** "already asked" covers questions on the lot, its Part, and batch-level questions naming the lot's fields.
- **Assumed:** a duplicate means the same subject and an overlapping field set, open or answered. The agent may ask again only with `new_evidence` naming evidence or a conflict not in the earlier question.
- **Open:** if earlier readings aren't retained after a correction, the brief shows the corrected reading marked "your correction" without the old value. Retaining old values is then a small addition in task 1.
