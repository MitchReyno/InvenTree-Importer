# Capability delta

## Purpose

New native work runs as one Examine stage per lot, which reads markings and identifies the item together. Research and Images then run in parallel. Questions never stop progress: agents continue on recorded assumptions, answers redo only what they affect, and running agents pick up new evidence.

## ADDED Requirements

### Requirement: Examine stage and parallel successors

For `native-agent/2` work, the stage order SHALL be Examine, then Research and Images in parallel, then Inventory.

- **Examine** SHALL propose the transcribed markings with citations, an identity with ranked candidates, and an optional quantity estimate.
- **Research and Images** SHALL each start as soon as Examine has published an identity proposal, without waiting for each other or for Examine to finish.
- **Inventory** SHALL wait for current Research and Images proposals.

#### Scenario: Parallel start

- **GIVEN** an Examine session that has published an identity proposal and is still working on the quantity
- **WHEN** a concurrency slot is free
- **THEN** Research and Images sessions for that lot start, and both appear as running at the same time when slots allow.

#### Scenario: Legacy batch display

- **GIVEN** a batch with retained `reading`/`identifying` jobs from earlier profiles
- **WHEN** Processing opens
- **THEN** those jobs, proposals and answers stay readable in their original views, and only new work uses the Examine pipeline.

### Requirement: Non-blocking questions with assumptions

A question SHALL name the field or fields it affects and the assumption the agent is using. After asking, the agent SHALL keep working.

- Proposals that rely on an open question SHALL show that dependency and be labelled provisional until the question is answered.
- An agent MAY enter waiting-for-input only when no useful work remains without an answer, and SHALL say so in its status line.
- Every open question in a batch SHALL appear in one Needs you list, ordered by the time it was asked.

#### Scenario: Unclear quantity

- **GIVEN** Examine cannot tell whether a reel holds 10 or 12 parts
- **WHEN** it asks a quantity question assuming an estimated 10
- **THEN** the question appears in Needs you, its identity proposal and Research continue, and the quantity proposal shows as provisional on 10.

#### Scenario: Agent asks without an assumption

- **GIVEN** a question submitted without affected fields or an assumption
- **WHEN** the tool server validates it
- **THEN** it is refused with a validation error, so the agent cannot block silently.

### Requirement: Selective rework from answers and edits

An answer, or an operator correction of a proposal, SHALL be delivered to the session that asked and to every session that relies on the changed field. That includes sessions which started from it but have published nothing yet. When an answer changes the identity, Research and Images SHALL receive it through their inbox rather than being cancelled.

#### Scenario: Corrected part number

- **GIVEN** Research running on candidate 74HC00, and Images finished
- **WHEN** the operator answers the identity question with 74HCT00
- **THEN** both sessions receive the answer, their old proposals are stale at once and replaced when revised, and the quantity proposal stays current.

### Requirement: Superseded values invalidate relying proposals immediately

When an answer or correction supersedes a value, proposals relying on the old value SHALL become stale in the same commit, so Inventory cannot consume them. Proposals that do not rely on it SHALL stay current.

#### Scenario: Correction before the first downstream output

- **GIVEN** Research started from identity 74HC00 and has published nothing, while Inventory is queued for the lot
- **WHEN** the operator corrects the identity to 74HCT00
- **THEN** Research receives the correction, and Inventory stays waiting until current Research and Images proposals for 74HCT00 exist.

### Requirement: Evidence-based currentness and new evidence pickup

Each proposal SHALL record the evidence versions, notes and answers it relies on. It SHALL become stale only when one of those changes or is removed. When new evidence is linked to a lot, that lot's running or resumable Examine, Research and Images sessions SHALL receive a new-evidence notice and be able to fetch it within the session's media limits. A finished session SHALL be resumed to consider the evidence.

#### Scenario: Photo added mid-run

- **GIVEN** a running Examine session for a lot
- **WHEN** a new close-up photo is linked to that lot
- **THEN** the session receives a new-evidence notice, fetches the photo, and its next proposals may cite it, without restarting from scratch.

#### Scenario: Evidence removed

- **GIVEN** a current proposal citing a photo
- **WHEN** that photo is unlinked from the lot
- **THEN** the proposal is shown as stale, and the owning session is notified to revise it.
