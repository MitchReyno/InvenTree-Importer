# Design assessment

## Context and grounding

The data a lot session needs already exists:

- Examine's identity proposal: `processing_proposal`, pinned by ID in `pinned_proposal_ids`.
- Observations: `capture_evidence_observation`, linked through `capture_lot_evidence_observation`.
- Operator notes, edits and answers: the capture snapshot, `processing_answer` and the inbox.
- Questions: `processing_question`.
- Evidence: the reserved media manifest.

`openingText` sends only part of this, and lot sessions have no read tool. The design adds the missing data to the session's input, and changes no ownership. The complexity is moderate: a versioned input, a read tool, a check in `ask`, a richer inbox payload, and a profile version with a live requalification.

## Goals and constraints

- The goals are those of the [proposal](proposal.md) and the deltas in `specs/`.
- **Constraints:**
  - Inputs stay sealed and digest-bound. A brief is part of the input that the attempt is pinned to.
  - Earlier attempts keep their own input version.
  - Human facts are only ever data in the brief, never instructions; the existing untrusted-data rule applies to notes.
  - No other lot's data reaches a lot session.

## Decisions and alternatives

### The brief is sealed into a new input version

- `queueJob` builds a `LotHandoffBrief` when it queues a lot session, and stores it in a new `ProcessingInputV7` (lot scopes only).
- **What the brief holds:**
  - `identity`: the pinned proposal's ID, summary, catalogue values with their sources, alternatives and `relies_on`;
  - `observations`: ID, evidence, version, page, region, readings (text, `source_kind`, agreement), visible count, description, `operator_edited`, and the earlier reading where retained;
  - `human`: notes, answers (question, steps, values) and lot edits, each with its ID to cite;
  - `asked`: questions on the lot, its Part or the batch overlapping the lot's fields, each with fields, assumptions, state and answer;
  - `evidence`: versions, with the regions Examine used;
  - `revision`.
- `openingText` renders it within a 48 KiB budget, summarising observations past it.
- **Rejected:**
  - Building the brief at turn time. That breaks the sealed-input guarantee, and two turns could start from different facts.
  - Giving lot sessions `read_batch`. It exposes other lots and the lot-forming view.

### `read_lot` returns the current brief

- It is the same builder, run at call time for the session's own lot (`principal.subjectId`). It is paged by observations and returns the brief's `revision`.
- It is registered only for lot stages, so it joins the tool boundary list.
- It is read-only and runs on the read pool.

### Duplicate-question check in `ask`

- Before storing a question, `ask` looks for an open or answered question on the same subject (or the lot's Part, or the batch) whose fields overlap.
- When it finds one, and the ask names no `new_evidence` (an evidence version or inbox item not cited by the earlier question), it returns `{ok: true, existing_question: {id, state, answer?}}` and stores nothing.
- It builds on BI-019's `/2` question, which carries fields and steps; `/1` questions are compared by `fields`.
- **Rejected:** text similarity. It's unpredictable and untestable.

### Revisions carry the change

- The `revision` inbox payload gains `changes`: a list of `{field, from, to}` or `{observation_id, reading_from, reading_to}`, plus `source: operator | session` and `proposal_id?`, alongside the existing `fields` and `reason`.
- Senders fill it: `stable-identity.ts` from the previous and new identity proposals, and the reading-correction path from the observation's old and new readings.
- The `/1` payload stays readable.

### Precedence instructions in a new profile version

- `shared-vm-agent/4` (and `native-agent/3` if that profile still ships) carries the precedence, conflict and no-re-asking rules.
- The migration adds the profile row and its digest, and admission accepts it. The live requalification runs on both providers.
- **Rejected:** putting the rules in the per-turn `instructions` field. Profile instructions are the pinned authority, and these rules change behaviour.

### Retaining earlier readings (task 1)

- If correcting an observation overwrites its readings, the correction path also stores the previous readings (`previous_readings`, operator-only history).
- If history is already kept, the brief reads it.

## State, authority and failure behavior

| Case | Outcome |
| --- | --- |
| Identity revised before the session claims its attempt | The successor is replaced as today, so its brief is built fresh |
| Revised after it started | A `revision` with `changes`; `read_lot` shows the new state |
| Brief too large | Summary in the opening; `read_lot` pages the rest |
| `read_lot` for another lot | Refused, `capability_refused` |
| A duplicate ask | No question stored; the existing one is returned to the agent |
| Earlier input versions | Run as before, with no brief |

## Verification strategy

- **Contracts:** the brief, the V7 input, `read_lot` and the revision `changes`.
- **Intake PG tier:**
  - brief assembly: identity, observations with a correction, human facts, the asked list, regions and the budget summary;
  - `read_lot` scope and paging;
  - the duplicate check (open, answered, a Part-level question, and a `new_evidence` override);
  - revision `changes` from the identity and correction paths.
- **Process tier:** a fake lot session that reads its brief, calls `read_lot` after a correction, and gets an existing question back.
- **Frontend:** the brief entry renders, collapsed and expanded.
- **Live:** the requalification on both providers with Mitch's go-ahead. Evidence: Research relying on Examine's identity, citing observations, and not re-asking an answered question.

## Migration, rollout and recovery

- Additive. The V7 input applies only to newly queued attempts.
- The migration adds the profile and, if needed, `previous_readings`.
- Rollback: the older build ignores V7 attempts that haven't started, so cancel or let them settle first. Note this in the PR body.

## Risks and open decisions

- **The brief could tip the agent toward Examine's mistakes.** Mitigation: precedence puts the evidence, as the agent reads it, above Examine's readings, and the instructions say so.
- **The duplicate check could block a genuinely new question.** Mitigation: the `new_evidence` override, and the check returns the existing question rather than failing.
