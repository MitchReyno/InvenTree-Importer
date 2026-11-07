# Capability delta

## Purpose

New native work starts with one Examine lead session for the batch, which finds observations, groups them into lots and identifies each lot. Research and Images then run in parallel for each lot. Questions never stop progress: agents continue on recorded assumptions, answers redo only what they affect, and running agents pick up new observations.

## ADDED Requirements

### Requirement: Examine stage and parallel successors

For `native-agent/2` work, the stage order SHALL be a batch-level Examine lead session (see processing-lot-forming), then per-lot Research and Images in parallel, then per-lot Inventory. For each lot, Examine SHALL propose the markings with citations to its observations, an identity with ranked candidates, and an optional quantity estimate with its basis. Inventory SHALL wait for the lot's current Research and Images proposals.

#### Scenario: Legacy batch display

- **GIVEN** a batch with retained `reading`/`identifying` jobs from earlier profiles
- **WHEN** Processing opens
- **THEN** those jobs, proposals and answers stay readable in their original views, and only new work uses the Examine pipeline.

### Requirement: Successors start on a stable identity

Research and Images for a lot SHALL each start as soon as that lot's identity is stable: Examine has published a current identity proposal for it, and the lot's observations have not changed since. They SHALL NOT wait for each other, for other lots, or for Examine to finish.

#### Scenario: Parallel start

- **GIVEN** an Examine lead session that has published an identity for one lot and is still grouping other observations
- **WHEN** concurrency slots are free
- **THEN** Research and Images sessions for that lot start, and both appear as running at the same time as the lead session when slots allow.

#### Scenario: Lot regrouped before successors start

- **GIVEN** a lot whose identity was published and whose Research is queued but not yet started
- **WHEN** the lead session moves one of its observations to another lot
- **THEN** the identity is no longer stable, Research does not start from it, and it starts once Examine republishes an identity for the regrouped lot.

### Requirement: Non-blocking questions with assumptions

A question SHALL name the field or fields it affects and the assumption the agent is using. After asking, the agent SHALL keep working.

- Proposals that rely on an open question SHALL show that dependency and be labelled provisional until the question is answered.
- An agent MAY enter waiting-for-input only when no useful work remains without an answer, and SHALL say so in its status line.
- Every open question in a batch SHALL appear in one Needs you list, ordered by the time it was asked.

#### Scenario: Unclear quantity

- **GIVEN** the Examine lead session cannot tell whether a reel holds 10 or 12 parts
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

### Requirement: Evidence-based currentness

Each proposal SHALL record the observations, evidence versions, notes and answers it relies on, including the lot's observation set. It SHALL become stale only when one of those changes or is removed.

#### Scenario: Evidence removed

- **GIVEN** a current proposal citing an observation
- **WHEN** that observation is moved out of the lot
- **THEN** the proposal is shown as stale, and the owning session is notified to revise it.

#### Scenario: Unrelated edit keeps a proposal current

- **GIVEN** a current identity proposal for lot A
- **WHEN** the operator edits lot B and a note that the proposal does not cite
- **THEN** the proposal for lot A stays current.

### Requirement: Lot sessions pick up observation changes

New evidence SHALL go first to the Examine lead session. When an observation is added to or removed from a lot, that lot's running or resumable Research and Images sessions SHALL receive a notice and be able to fetch the observation's crop within the session's media limits. A finished session SHALL be resumed to consider it.

#### Scenario: Photo added mid-run

- **GIVEN** a running Research session for a lot
- **WHEN** the lead session adds an observation from a new close-up photo to that lot
- **THEN** the Research session receives a notice, fetches the observation's crop, and its next proposals may cite it, without restarting from scratch.

### Requirement: Structured catalogue proposals

For `native-agent/2` work, Examine and Research proposals SHALL carry their catalogue values as structured fields, not only as a summary. These are the category, the parameter values with their templates, the manufacturer company and MPN, the supplier company, SKU and price, and the description. Each value SHALL state whether it maps to an existing target record (by its observed reference) or proposes a new one, and SHALL cite its sources.

#### Scenario: Existing manufacturer

- **GIVEN** Examine reads a maker's mark that matches an observed company
- **WHEN** it publishes its proposal
- **THEN** the manufacturer value maps to that company's observed reference, with the photo region cited.

### Requirement: Unsupported catalogue values are retained

A catalogue value that cannot enter a Part spec as is, such as a new category, a new parameter template, a parameter without an observed category mapping, a new manufacturer or supplier company, or a supplier price, SHALL be retained in the proposal as unsupported with the agent's reason. It SHALL NOT be dropped, and SHALL NOT enter a Part spec.

A description SHALL be applicable when the Part spec supports one, and unsupported otherwise.

#### Scenario: New sub-category proposed

- **GIVEN** Research finds no existing category that fits a lot's Part
- **WHEN** it publishes its proposal
- **THEN** the proposal records a new-category value with its reason and sources, marked unsupported, alongside the nearest existing categories it considered.
