# Capability delta

## ADDED Requirements

### Requirement: Media removed evidence

A removed evidence item SHALL keep its retained bytes and history. Only its thumbnail preview SHALL be served, to the operator, for "Deleted files" and the delete confirmation; its original, other previews and region crops SHALL be refused, and nothing of it SHALL reach agents or new processing inputs. Review projections SHALL omit observations on its versions. Edits that act on it (move, link, attachment selection, derive, evidence note) SHALL be refused with `media_evidence_removed` (409) until it is restored. Removed items SHALL NOT count towards the batch's 200-item upload capacity.

#### Scenario: Edit a removed file

- **GIVEN** a removed photo
- **WHEN** a request moves it to a group or selects it as an attachment
- **THEN** the request is refused with `media_evidence_removed` and nothing changes

#### Scenario: Original of a removed file

- **GIVEN** a removed photo
- **WHEN** its original or a region crop is requested
- **THEN** the request is refused, while its thumbnail still loads in "Deleted files"

#### Scenario: Capacity after deleting

- **GIVEN** a batch at 200 evidence items, one of which is then removed
- **WHEN** another file is uploaded
- **THEN** the upload is retained
