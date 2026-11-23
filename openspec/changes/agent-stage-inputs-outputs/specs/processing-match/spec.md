## Purpose

The Match step decides, before research or photo work is spent, whether each lot is already in InvenTree or in another unapproved batch, asks the operator when it might be, and sets what Research and Images do. It searches deterministically and records why each candidate matched.

## ADDED Requirements

### Requirement: Deterministic search by strong keys

Match SHALL search InvenTree (Parts, manufacturer Parts, supplier Parts and stock) through the app's read credential, and this app's other unapproved lots, using every strong key of the lot's current identity: an MPN or type with a manufacturer, an NSN, an IPN or SKU read from a label, or the import reference or barcode with the batch. Each candidate SHALL record the keys that matched.

#### Scenario: Exact match

- **GIVEN** a lot identified as RC0603FR-0710KL by Yageo, and InvenTree Part RES-0144 with that manufacturer Part
- **WHEN** Match searches
- **THEN** it records RES-0144 as an exact candidate matched by MPN and manufacturer.

#### Scenario: InvenTree unavailable

- **GIVEN** the InvenTree read fails
- **WHEN** Match searches
- **THEN** the lot's match state says the search couldn't run, Research and Images do not start, and the step offers Check again.

### Requirement: When Match searches

Match SHALL search after Examine's stable identity, after each identity amendment, when a session adds an alias as a match note, and when the operator asks to check again.

#### Scenario: Alias found during research

- **GIVEN** a lot decided as new, with Research running in full mode
- **WHEN** Research's match note adds the cross-reference 1N914
- **THEN** Match searches with it, and a new candidate pauses Research and opens a match question.

### Requirement: Verdicts and sufficiency

Match SHALL give each lot a verdict: no match, exact (a strong key and the manufacturer agree), possible (a weak key or partial agreement) or duplicate (the same import reference or barcode with the batch). For a candidate Part it SHALL list what InvenTree is missing: datasheet, the category's key parameters, Part image, manufacturer Part, and supplier Part for this supplier.

#### Scenario: What the Part is missing

- **GIVEN** an exact candidate Part with an image and manufacturer Part but no datasheet and two key parameters empty
- **WHEN** Match records it
- **THEN** it lists "datasheet" and the two parameters as missing.

### Requirement: The match question

A lot with candidates SHALL get one app-owned question, listed in Needs you, quoting the candidates, the keys that matched, the agents' match notes and what the Part is missing. Its options SHALL be add stock, add stock and fill what's missing (only when something is missing), new Part, already imported (leave the lot out) and something else. Research and Images for the lot SHALL NOT start while it is open. Several lots with exact matches MAY be offered as one batch question listing each.

#### Scenario: Waiting for the decision

- **GIVEN** a lot with an exact candidate
- **WHEN** the match question is open
- **THEN** Research and Images for that lot stay unstarted, and other lots continue.

### Requirement: Match questions are pinned

A match question SHALL be pinned to the lot's match revision and the candidates it quotes. While a newer search for the lot is requested and not yet settled, or after it has replaced the question, an answer SHALL be refused and nothing queued from it. Match questions are app questions; the non-blocking rule for agent questions doesn't stop them holding Research and Images.

#### Scenario: Candidates changed before the answer

- **GIVEN** an open match question quoting RES-0144
- **WHEN** a new search adds RES-0201 and replaces the question, and the operator then answers the old one
- **THEN** the answer is refused and Needs you shows the new question.

### Requirement: Match waits are recorded

The stages a lot's match state holds SHALL be recorded with it and checked whenever a stage is claimed, resumed, started or replaced. An inbox item other than the `match` item that delivers a mode SHALL NOT resume a waiting stage. A search SHALL run outside the transaction that requested it and settle only if it is the lot's latest search request.

#### Scenario: Unrelated message while waiting

- **GIVEN** a Research session paused in identify mode while its match question is open
- **WHEN** the operator sends it a chat message
- **THEN** the message stays pending, the session stays parked, and it resumes when the decision's mode arrives.

#### Scenario: Identity changed during a search

- **GIVEN** a search running on a lot's identity revision 3
- **WHEN** Examine republishes the identity as revision 4 before the search settles
- **THEN** the revision 3 result is discarded and Match searches again on revision 4.

### Requirement: Decisions set stage modes

The operator's decision SHALL set the lot's target and its stages' modes: new Part (Research full, Images full); fill what's missing (Research for the missing fields only; Images stock, with a Part image only if the Part has none); add stock (Research skipped; Images as for fill); already imported (the lot left out). A paused identify-mode Research session SHALL receive its mode, or be closed when Research is skipped.

#### Scenario: Add stock

- **GIVEN** the decision "add stock to RES-0144", whose Part already has an image
- **WHEN** it is recorded
- **THEN** no Research session runs for the lot, Images runs for stock images only, and the lot targets RES-0144.

#### Scenario: Searches settle out of order

- **GIVEN** two searches on the same identity, the second requested by Check again
- **WHEN** the second settles before the first
- **THEN** the first result is discarded when it arrives.

### Requirement: Validation before approval

Before approval preparation, Match SHALL search again with each lot's final identifiers and import references. A Part created since the decision, stock that now exists with the same barcode and batch, or a final identity that no longer fits the decision SHALL be a blocking item until the operator decides again.

#### Scenario: Part created meanwhile

- **GIVEN** a lot decided as a new Part 1N4148W-7-F
- **WHEN** a Part with that MPN is added to InvenTree before approval
- **THEN** the Ready view shows a blocking item for the lot, and approval waits until the operator decides again.

### Requirement: Approval checks the latest search

A preparation SHALL record each lot's validation search generation. Approval SHALL refuse it when a newer search for a lot has been requested, settled or not, or when the validation read failed.

#### Scenario: Check again before approval

- **GIVEN** a prepared batch whose lot passed validation
- **WHEN** the operator asks Match to check that lot again and approves before the search settles
- **THEN** approval is refused until a new validation passes.
