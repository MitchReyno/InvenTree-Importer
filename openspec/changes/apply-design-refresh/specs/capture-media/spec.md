# Capability delta

## ADDED Requirements

### Requirement: Media removed evidence

A removed evidence item SHALL keep its retained bytes and history, but its bytes, previews and crops SHALL NOT be served to agents or new processing inputs. Edits that act on it (move, link, attachment selection, derive, evidence note) SHALL be refused with `media_evidence_removed` (409) until it is restored. Removed items SHALL NOT count towards the batch's 200-item upload capacity.

#### Scenario: Edit a removed file

- **GIVEN** a removed photo
- **WHEN** a request moves it to a group or selects it as an attachment
- **THEN** the request is refused with `media_evidence_removed` and nothing changes

#### Scenario: Capacity after deleting

- **GIVEN** a batch at 200 evidence items, one of which is then removed
- **WHEN** another file is uploaded
- **THEN** the upload is retained
