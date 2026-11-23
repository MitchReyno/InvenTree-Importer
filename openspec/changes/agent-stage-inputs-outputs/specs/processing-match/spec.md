## Purpose

The Match step decides, before research or photo work is spent, whether each lot is already in InvenTree or in another unapproved batch, asks the operator when it might be, and sets what Research and Images do. It searches deterministically and records why each candidate matched.

## ADDED Requirements

### Requirement: Deterministic search by strong keys

Match SHALL search InvenTree (Parts, manufacturer Parts, supplier Parts and stock) through the Match search reads (see inventory-target-protection), and this app's unapproved lots in other batches, within the configured actor, target and target context, using every strong key of the lot's current identity: an MPN or type with a manufacturer, an NSN, an IPN or SKU read from a label, or a candidate Part's stock with the label's batch code. Each candidate SHALL record the keys that matched.

#### Scenario: Exact match

- **GIVEN** a lot identified as RC0603FR-0710KL by Yageo, and InvenTree Part RES-0144 with that manufacturer Part
- **WHEN** Match searches
- **THEN** it records RES-0144 as an exact candidate matched by MPN and manufacturer.

#### Scenario: InvenTree unavailable

- **GIVEN** the InvenTree read fails
- **WHEN** Match searches
- **THEN** the lot's match state says the search couldn't run, Research and Images do not start, and the step offers Check again.

### Requirement: Import reference lookup

When a lot's identity becomes stable, before any identify-mode Research, Match SHALL look up its generated import reference (`bi1:<source>:<contribution>`) in this app's retained approvals of that original contribution, which decide the hit whatever became of its stock. A stock read by PK SHALL report the status of any known output. The import reference SHALL detect duplicates only, and SHALL NOT count as a strong identity key. A hit SHALL open the match question and hold Research and Images.

#### Scenario: Stock this app created

- **GIVEN** a house-numbered lot whose import reference an earlier approval already created as stock
- **WHEN** its identity becomes stable
- **THEN** Match records an original-contribution hit and opens its question, and identify-mode Research doesn't start.

#### Scenario: Approved but no stock now

- **GIVEN** a lot whose original contribution was approved, and whose stock was never created, is uncertain, or was later deleted
- **WHEN** Match looks it up
- **THEN** it is still an original-contribution hit that links the earlier run and reports its stock status, and no stage runs for the lot.

### Requirement: Original-contribution hits

An import reference hit SHALL be an original-contribution hit, not an identity candidate. Its question SHALL offer only already imported (leave the lot out) and inspecting or recovering the earlier run, never new Part or add stock, and no Research or Images SHALL run for the lot. The lot SHALL stay ineligible for another stock approval, as preparation's contribution history requires.

#### Scenario: Hit on an approved contribution

- **GIVEN** a lot whose original contribution an earlier round approved
- **WHEN** Match's question for it opens
- **THEN** it links the earlier run and offers already imported, and no stage is queued for the lot.

### Requirement: Already imported is a Match decision

Already imported on an original-contribution hit SHALL be recorded on the Match decision, not as a Capture exclusion, and Review and Changes SHALL show the contribution as already approved.

#### Scenario: Answered already imported with no stock

- **GIVEN** that question, where the earlier approval created no stock
- **WHEN** the operator answers already imported
- **THEN** the answer is recorded on the Match decision, Review shows the contribution as already approved, and the Capture exclusion guard and approval history are unchanged.

### Requirement: When Match searches

Match SHALL search after Examine's stable identity when it has a strong key (a lot without one is identified first, as the pipeline's "Identify first when nothing can be searched" requires), after each identity amendment the app applies that yields searchable keys, when a session adds an alias as a match note, and when the operator asks to check again.

#### Scenario: Alias found during research

- **GIVEN** a lot decided as new, with Research running in full mode
- **WHEN** Research's match note adds the cross-reference 1N914
- **THEN** Match searches with it, and a new candidate pauses Research and opens a match question.

### Requirement: When Match doesn't search

A lot still awaiting its first identify-mode amendment SHALL NOT be searched remotely for a match-note alias. Unresolved and replacing amendments SHALL open their questions instead of a key search.

#### Scenario: Replacing amendment

- **GIVEN** a lot whose Research amendment says the markings decode to a different part
- **WHEN** it is published
- **THEN** a question opens and no remote key search runs until the question is resolved.

### Requirement: Verdicts and sufficiency

Match SHALL give each lot a verdict: no match, exact (a strong key and the manufacturer agree), possible (a weak key or partial agreement) or duplicate (the same generated import reference, or the candidate Part's stock with the same batch code). For a candidate Part it SHALL list what InvenTree is missing: datasheet, the category's key parameters, Part image, manufacturer Part, and supplier Part for this supplier.

#### Scenario: What the Part is missing

- **GIVEN** an exact candidate Part with an image and manufacturer Part but no datasheet and two key parameters empty
- **WHEN** Match records it
- **THEN** it lists "datasheet" and the two parameters as missing.

### Requirement: Fillable gaps

Only a missing datasheet, key parameters and Part image SHALL be fillable on an existing Part. A missing manufacturer or supplier Part SHALL be shown in the match question, but SHALL NOT by itself offer fill what's missing or produce an effect.

#### Scenario: Only a supplier Part missing

- **GIVEN** an exact candidate Part that lacks only a supplier Part for this supplier
- **WHEN** the match question is asked
- **THEN** it shows the missing supplier Part and offers add stock, but not add stock and fill what's missing.

### Requirement: The match question

A lot with candidates SHALL get one app-owned question, listed in Needs you, quoting the candidates, the keys that matched, the agents' match notes and what the Part is missing. Its options SHALL be add stock, add stock and fill what's missing (only when a fillable field is missing), new Part, already imported (leave the lot out) and something else. Research and Images for the lot SHALL NOT start while it is open. Several lots with exact matches MAY be offered as one batch question listing each.

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

The stages a lot's match state holds SHALL be recorded with it and checked whenever a stage is claimed, resumed, started or replaced. An inbox item other than the `match` item that delivers a mode SHALL NOT resume a waiting stage. A search SHALL run outside the transaction that requested it and settle only if it is the lot's latest search request; a committed request SHALL still run after a restart.

#### Scenario: Unrelated message while waiting

- **GIVEN** a Research session paused in identify mode while its match question is open
- **WHEN** the operator sends it a chat message
- **THEN** the message stays pending, the session stays parked, and it resumes when the decision's mode arrives.

#### Scenario: Identity changed during a search

- **GIVEN** a search running on a lot's identity revision 3
- **WHEN** Examine republishes the identity as revision 4 before the search settles
- **THEN** the revision 3 result is discarded and Match searches again on revision 4.

#### Scenario: Searches settle out of order

- **GIVEN** two searches on the same identity, the second requested by Check again
- **WHEN** the second settles before the first
- **THEN** the first result is discarded when it arrives.

### Requirement: Add stock needs an InvenTree Part

The match question SHALL offer add stock, and add stock and fill what's missing, only for a candidate with an InvenTree Part. A candidate that is only another unapproved lot SHALL be shown as a competing lot, with the other options.

#### Scenario: Candidate only in another batch

- **GIVEN** a lot whose only candidate is an unapproved lot in another batch, with no InvenTree Part
- **WHEN** the match question is asked
- **THEN** it shows the other lot as competing and offers new Part, already imported and something else, but not add stock.

### Requirement: Decisions set stage modes

The operator's decision SHALL set the lot's target and its stages' modes: new Part (Research full, Images full); fill what's missing (Research for the missing fields only; Images stock, with a Part image only if the Part has none); add stock (Research skipped; Images as for fill); already imported (the lot left out).

#### Scenario: Add stock

- **GIVEN** the decision "add stock to RES-0144", whose Part already has an image
- **WHEN** it is recorded
- **THEN** no Research session runs for the lot, Images runs for stock images only, and the lot targets RES-0144.

### Requirement: Decisions reach a paused identify lot

A paused identify-mode Research lot SHALL receive its decision's mode, or have its membership closed when Research is skipped, keeping its identity amendment. The session SHALL close only when no member needs it.

#### Scenario: One lot skipped

- **GIVEN** a Research session identifying lots A and B
- **WHEN** lot A is decided as add stock
- **THEN** lot A's membership closes with its amendment kept, and the session keeps identifying lot B.

### Requirement: A decision binds only its lot

When lots share a draft Part and one is decided as add stock to an existing Part, the decision SHALL relink only that lot to the existing Part, in the same commit, and SHALL leave the other lots on the draft.

#### Scenario: Shared draft, one switch

- **GIVEN** lots A and B sharing a draft Part
- **WHEN** lot A is decided as add stock to RES-0144
- **THEN** A targets RES-0144 and B stays on the draft Part.

### Requirement: Validation before approval

Preparation SHALL run Match's search again for each selected lot of a batch whose lead input is `/7`, with the lot's final identifiers and import references. A Part created since the decision, an approval of the lot's original contribution in this app's retained history, stock on the target Part with its batch code that the decision didn't already cover, or a final identity that no longer fits the decision SHALL be a blocking item until the operator decides again.

#### Scenario: Stock the decision already covered

- **GIVEN** a lot decided as add stock to RES-0144 after the question showed stock with its batch code
- **WHEN** pass 3 finds that same stock unchanged
- **THEN** it is not a finding, while stock with the batch code that appeared after the decision blocks the lot.

#### Scenario: Part created meanwhile

- **GIVEN** a lot decided as a new Part 1N4148W-7-F
- **WHEN** a Part with that MPN is added to InvenTree before approval
- **THEN** the Ready view shows a blocking item for the lot, and approval waits until the operator decides again.

### Requirement: Validation without a searchable key

For a selected `/7` lot the operator decided as new Part with no strong key, pass 3 SHALL record a no-searchable-key validation that checks the retained contribution history and binds that decision. If the lot later gains a strong key, approval SHALL need the normal validation search.

#### Scenario: Unidentified lot imported as new

- **GIVEN** a lot whose identification was unresolved and that the operator decided as new Part
- **WHEN** preparation runs
- **THEN** pass 3 records a no-searchable-key validation bound to that decision, and approval accepts it; after Research later adds an MPN, approval needs a new validation search.

### Requirement: Validation searches are preparation reads

Match's validation searches SHALL be preparation target reads, each with its committed intent and retained result, and an unavailable read SHALL block. Unselected lots and lots of earlier-profile batches SHALL be neither searched nor blocked by this gate.

#### Scenario: Partial selection with retained work

- **GIVEN** a `/7` batch with lots A and B, where only A is selected, and a retained earlier-profile batch selected in another preparation
- **WHEN** both preparations run
- **THEN** only lot A is searched, lot B's open match question doesn't block A's preparation, and the earlier-profile preparation runs without Match's gate.

### Requirement: Approval checks the latest search

A preparation SHALL record each selected `/7` lot's validation search generation. Approval SHALL refuse it when a newer search for a lot has been requested, settled or not, when the validation read failed, when the batch's lead is now `/7` and a selected lot has no recorded successful validation, or when, under the lot's Match lock, the lot has an open question or its identity or outcome revision differs from the one pass 3 pinned. An approval that already committed SHALL replay unchanged.

#### Scenario: Check again before approval

- **GIVEN** a prepared batch whose lot passed validation
- **WHEN** the operator asks Match to check that lot again and approves before the search settles
- **THEN** approval is refused until a new validation passes.

#### Scenario: Question opened after preparation

- **GIVEN** a prepared lot whose validation passed
- **WHEN** a replacing amendment opens a question without a search, and the operator approves the original preparation
- **THEN** approval is refused for the open question.

#### Scenario: Prepared before an upgrade

- **GIVEN** a preparation made while the batch's lead was `/6`
- **WHEN** the lead is upgraded to `/7` and the operator approves that preparation
- **THEN** approval is refused until a preparation with Match's validation exists.
