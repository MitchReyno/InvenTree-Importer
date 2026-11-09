# Capability delta

## ADDED Requirements

### Requirement: Media removed evidence

A removed evidence item SHALL keep its retained bytes and history. Only its thumbnail preview SHALL be served, to the operator, for "Deleted files" and the delete confirmation; its original, other previews and region crops SHALL be refused, and nothing of it SHALL reach agents or new processing inputs. Review projections SHALL omit observations on its versions. Edits that act on it (move, move of several files, link, attachment selection, derive, evidence note) SHALL be refused with `media_evidence_removed` (409) until it is restored. Ungrouping a group SHALL move its removed members to ungrouped too. A removed item SHALL NOT count as supporting evidence for a lot. Observations SHALL NOT be recorded or edited on a removed version, and the Examine lead's batch view SHALL omit observations on removed versions. Removed items SHALL keep counting towards the batch's 200-item capacity, so the snapshot bounds hold. 

#### Scenario: Edit a removed file

- **GIVEN** a removed photo
- **WHEN** a request moves it to a group or selects it as an attachment
- **THEN** the request is refused with `media_evidence_removed` and nothing changes

#### Scenario: Original of a removed file

- **GIVEN** a removed photo
- **WHEN** its original or a region crop is requested
- **THEN** the request is refused, while its thumbnail still loads in "Deleted files"

#### Scenario: Observation on a removed photo

- **GIVEN** an Examine turn still running when its photo is removed
- **WHEN** it records an observation on that photo
- **THEN** the observation is refused with `media_evidence_removed` and no lot is linked to it
