## MODIFIED Requirements

### Requirement: Examine stage and parallel successors

For `native-agent/2` work under the earlier session profiles, the stage order SHALL be a batch-level Examine lead session (see processing-lot-forming), then per-lot Research and Images in parallel, then per-lot Inventory. For each lot, Examine SHALL propose the markings with citations to its observations, an identity with ranked candidates, and an optional quantity estimate with its basis. Inventory SHALL wait for the lot's current Research and Images proposals.

For `shared-vm-agent/4` and `synthetic-session/1` work, the stage order SHALL be the Examine lead session, then the app's Match step for each lot (see processing-match), then per-lot Research and Images in the modes Match sets. No Inventory agent session SHALL be queued. Examine SHALL publish the same findings, with the markings verbatim, as one `examine-identity/1` proposal per lot.

#### Scenario: Legacy batch display

- **GIVEN** a batch with retained `reading`/`identifying` jobs from earlier profiles
- **WHEN** Processing opens
- **THEN** those jobs, proposals and answers stay readable in their original views, and only new work uses the Examine pipeline.

#### Scenario: No Inventory session

- **GIVEN** a lot whose Research and Images outputs are current under `shared-vm-agent/4` or `synthetic-session/1`
- **WHEN** processing continues
- **THEN** no Inventory session is queued, and the lot's target comes from its Match decision.

### Requirement: Successors start on a stable identity

Research and Images for a lot SHALL each start as soon as that lot's identity is stable: Examine has published a current identity proposal for it, and the lot's observations have not changed since. They SHALL NOT wait for each other, for other lots, or for Examine to finish.

For `shared-vm-agent/4` and `synthetic-session/1`, they SHALL also start only when Match allows them: Match has either found no match or recorded the operator's decision. A lot without a strong search key SHALL start Research in identify mode while Images waits.

#### Scenario: Parallel start

- **GIVEN** an Examine lead session that has published an identity for one lot and is still grouping other observations
- **WHEN** concurrency slots are free
- **THEN** Research and Images sessions for that lot start (under the new profiles, once Match finds no match for it), and both appear as running at the same time as the lead session when slots allow.

#### Scenario: Lot regrouped before successors start

- **GIVEN** a lot whose identity was published and whose Research is queued but not yet started
- **WHEN** the lead session moves one of its observations to another lot
- **THEN** the identity is no longer stable, Research does not start from it, and it starts once Examine republishes an identity for the regrouped lot.

## ADDED Requirements

### Requirement: Identify first when nothing can be searched

Under `shared-vm-agent/4` and `synthetic-session/1`, a lot whose identity has no strong search key SHALL start Research in identify mode. Research SHALL resolve the canonical MPN, the manufacturer and every alias it can source (house numbers, packaging codes, cross-references, alternate markings), publish them as a `research-identity/1` amendment, and pause until Match has searched with them.

#### Scenario: House-numbered reel

- **GIVEN** a reel whose label carries only the distributor's number TK-1N4148
- **WHEN** Examine publishes its identity
- **THEN** Research starts in identify mode, Images waits, and when Research amends the identity with MPN 1N4148W-7-F and the alias TK-1N4148, Match searches with both.

### Requirement: Identity amendments update the lot

Under `shared-vm-agent/4` and `synthetic-session/1`, a lot SHALL have one current identity: Examine's base merged with Research's amendments, each field recording its stage, proposal and source. An amendment MAY add identifiers and aliases and refine fields, which update an agent-made, unedited lot's proposed label and draft Part. It SHALL NOT silently replace Examine's identity with a different part, and SHALL NOT change an operator's value. Successors SHALL pin the merged identity's revision.

#### Scenario: Refined identifiers

- **GIVEN** an agent-made lot labelled "Reel TK-1N4148" that the operator hasn't edited
- **WHEN** Research's amendment adds MPN 1N4148W-7-F and manufacturer Diodes Inc.
- **THEN** the lot's proposed label becomes "1N4148W-7-F diodes (TK-1N4148)", Review shows each field's source for confirmation, and Examine receives a revision naming the added fields.

#### Scenario: A different part

- **GIVEN** Examine's identity 1N4148
- **WHEN** Research's amendment says the markings decode to 1N914
- **THEN** both identities are shown, the lot's identity is not replaced, and the conflict is settled by a question.

### Requirement: Revisions carry the change

A revision delivered to a session of `shared-vm-agent/4` or `synthetic-session/1` SHALL name each change with its previous and new value (a field, a reading, a proposal, or a match decision), who made it (the operator, a session or Match), and the new brief revision.

#### Scenario: Reading corrected by the operator

- **GIVEN** Research and Images relying on an observation
- **WHEN** the operator corrects its reading
- **THEN** both receive one item naming the observation, the old and new reading and the operator as its source, and their relying proposals are stale.
