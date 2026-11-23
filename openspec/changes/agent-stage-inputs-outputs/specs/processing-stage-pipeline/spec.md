## MODIFIED Requirements

### Requirement: Examine stage and parallel successors

For `native-agent/2` work under the earlier session profiles, the stage order SHALL be a batch-level Examine lead session (see processing-lot-forming), then per-lot Research and Images in parallel, then per-lot Inventory. For each lot, Examine SHALL propose the markings with citations to its observations, an identity with ranked candidates, and an optional quantity estimate with its basis. Inventory SHALL wait for the lot's current Research and Images proposals.

A batch SHALL follow its Examine lead's sealed input version at every queueing entry point, including Start and replacement. For work whose lead input is `bench-intake-input/7` (`shared-vm-agent/4` and `synthetic-session/1`), the stage order SHALL be the Examine lead session, then the app's Match step for each lot (see processing-match), then per-lot Research and Images in the modes Match sets; a lot without a strong search key runs identify-mode Research before Match instead. No Inventory agent session SHALL be queued. Examine SHALL publish the same findings, with the markings verbatim, as one `examine-identity/1` proposal per lot.

#### Scenario: Legacy batch display

- **GIVEN** a batch with retained `reading`/`identifying` jobs from earlier profiles
- **WHEN** Processing opens
- **THEN** those jobs, proposals and answers stay readable in their original views, and only new work uses the Examine pipeline.

#### Scenario: No Inventory session

- **GIVEN** a lot whose Research and Images outputs are current in a batch whose lead input is `/7`
- **WHEN** processing continues
- **THEN** no Inventory session is queued, and the lot's target comes from its Match decision.

### Requirement: Successors start on a stable identity

Research and Images for a lot SHALL each start as soon as that lot's identity is stable: Examine has published a current identity proposal for it, and the lot's observations have not changed since. They SHALL NOT wait for each other, for other lots, or for Examine to finish.

For `/7` work, a lot with a strong search key SHALL also start them only when Match allows them: Match has either found no match or recorded an operator's decision that runs the stage. Identify mode is exempt from this gate: a lot without a strong search key SHALL start Research in identify mode before any key search, once Match's import reference lookup has completed without a hit, while Images waits for Match.

#### Scenario: Parallel start

- **GIVEN** an Examine lead session that has published an identity for one lot and is still grouping other observations
- **WHEN** concurrency slots are free
- **THEN** Research and Images sessions for that lot start, and both appear as running at the same time as the lead session when slots allow. Under the new profiles this needs the identity's strong key and either Match's settled no-match verdict or a recorded decision that runs both stages.

#### Scenario: Lot regrouped before successors start

- **GIVEN** a lot on an input earlier than `/7` whose identity was published and whose Research is queued but not yet started
- **WHEN** the lead session moves one of its observations to another lot
- **THEN** the identity is no longer stable, Research does not start from it, and it starts once Examine republishes an identity for the regrouped lot.

#### Scenario: Regrouped `/7` lot with a candidate

- **GIVEN** a `/7` lot whose Research is queued but not yet started
- **WHEN** the lead regroups it, and Examine's republished identity has a strong key that finds a candidate
- **THEN** Research and Images stay held through the new search and while the match question is open.

### Requirement: Evidence-based currentness

Each proposal SHALL record the observations, evidence versions, notes and answers it relies on, including the lot's observation set. It SHALL become stale only when one of those changes or is removed, or, for `/7` work, when one of the pins below changes.

For `/7` work, outputs that establish the identity and outputs that depend on it SHALL record different pins. An `examine-identity/1` proposal has no further pins. A `research-identity/1` amendment SHALL also pin the identity revision it was based on when published (the sealed starting revision, or the merged revision a later `match` item delivered), with the sealed starting revision recorded separately, and SHALL stay current when its own merge advances the revision or Match then records a decision; it becomes stale when another change advances the revision. A `research/1` or `images/1` proposal SHALL also pin the identity revision and the Match decision and stage mode it was produced under, and becomes stale when any of them changes.

#### Scenario: Evidence removed

- **GIVEN** a current proposal citing an observation
- **WHEN** that observation is moved out of the lot
- **THEN** the proposal is shown as stale, and the owning session is notified to revise it.

#### Scenario: Unrelated edit keeps a proposal current

- **GIVEN** a current identity proposal for lot A
- **WHEN** the operator edits lot B and a note that the proposal does not cite
- **THEN** the proposal for lot A stays current.

#### Scenario: Mode changed by a new decision

- **GIVEN** a Research proposal produced in full mode
- **WHEN** a late match is decided as add stock
- **THEN** the proposal is shown as stale.

### Requirement: Selective rework from answers and edits

An answer, or an operator correction of a proposal, SHALL be delivered to the session that asked and to every session that relies on the changed field. That includes sessions which started from it but have published nothing yet. When an answer changes the identity, Research and Images SHALL receive it through their inbox rather than being cancelled.

For `/7` Research and Images sessions, which serve lot groups, an identity change that the group's own session did not make SHALL instead release that lot from the group and requeue it as its own job through Match, and the session SHALL receive a revision naming the release; its other lots continue. The session's own amendment, and the merge and search it triggers, SHALL keep the lot in the group.

#### Scenario: Corrected part number

- **GIVEN** Research running on candidate 74HC00 under an input earlier than `/7`, and Images finished
- **WHEN** the operator answers the identity question with 74HCT00
- **THEN** both sessions receive the answer, their old proposals are stale at once and replaced when revised, and the quantity proposal stays current.

#### Scenario: Correction and own amendment in one group

- **GIVEN** a `/7` Research session serving lots A and B
- **WHEN** the operator corrects lot A's identity, and the session's own amendment refines lot B's identity
- **THEN** lot A is released and requeued through Match with the session told, and lot B stays in the group.

## ADDED Requirements

### Requirement: Identify first when nothing can be searched

For `/7` work, a lot whose identity has no strong search key SHALL start Research in identify mode once Match's import reference lookup has completed without a hit. Research SHALL resolve the canonical MPN, the manufacturer and every alias it can source (house numbers, packaging codes, cross-references, alternate markings), publish them as a `research-identity/1` amendment, and pause until Match has searched with them.

#### Scenario: House-numbered reel

- **GIVEN** a reel whose label carries only the distributor's number TK-1N4148
- **WHEN** Examine publishes its identity and the import reference lookup completes without a hit
- **THEN** Research starts in identify mode, Images waits, and when Research amends the identity with MPN 1N4148W-7-F and the alias TK-1N4148, Match searches with both.

### Requirement: Unresolved identification

When identify mode cannot establish a strong key, Research SHALL publish its `research-identity/1` amendment marked unresolved, with what it tried. Match SHALL then ask the operator, offering new Part (Research and Images in full mode on what is known), already imported, or something else, and Images SHALL wait for that answer.

#### Scenario: Nothing found

- **GIVEN** a reel with only an unknown house number
- **WHEN** identify-mode Research finds no MPN or other strong key
- **THEN** it publishes an unresolved amendment, Match asks the operator, and Images starts only after the answer.

### Requirement: Identity amendments update the lot

For `/7` work, a lot SHALL have one current identity: Examine's base merged with Research's amendments, each field recording its stage, proposal and source. An amendment MAY add identifiers and aliases and refine fields, which update an agent-made, unedited lot's proposed label and draft Part. It SHALL NOT silently replace Examine's identity with a different part, and SHALL NOT change an operator's value. Successors SHALL pin the merged identity's revision.

#### Scenario: Refined identifiers

- **GIVEN** an agent-made lot labelled "Reel TK-1N4148" that the operator hasn't edited
- **WHEN** Research's amendment adds MPN 1N4148W-7-F and manufacturer Diodes Inc.
- **THEN** the lot's proposed label becomes "1N4148W-7-F diodes (TK-1N4148)", Review shows each field's source for confirmation, and Examine receives a revision naming the added fields.

#### Scenario: A different part

- **GIVEN** Examine's identity 1N4148
- **WHEN** Research's amendment says the markings decode to 1N914
- **THEN** both identities are shown, the lot's identity is not replaced, and the conflict is settled by a question.

### Requirement: Revisions carry the change

A revision delivered to a `/7` session SHALL name each change with its previous and new value (a field, a reading, a proposal, or a match decision), who made it (the operator, a session or Match), and the new brief revision.

#### Scenario: Reading corrected by the operator

- **GIVEN** Research and Images relying on an observation
- **WHEN** the operator corrects its reading
- **THEN** both receive one item naming the observation, the old and new reading and the operator as its source, and their relying proposals are stale.
