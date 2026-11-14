# Capability delta

## ADDED Requirements

### Requirement: Evidence removal and restore notices

When a file is removed, proposals that rely on it SHALL become stale with the reason `evidence_removed`: those citing one of its versions, those citing an observation on one of its versions, and those citing its evidence notes. Proposals that depend on a stale proposal SHALL go stale too, as with other removals. Its notes SHALL leave new inputs. The Examine lead session SHALL receive a batch notice, and the affected lots' running or resumable Research and Images sessions SHALL receive a notice keyed by the removal revision, so a later removal after a restore is delivered again. A restore SHALL append its own evidence notice to the Examine lead, keyed by the restore revision, because the existing trigger skips versions the lead has already seen. The Examine trigger and agent evidence reads SHALL skip removed versions. Publishing a proposal SHALL be refused when it cites a removed version, an observation on one, or an evidence note of a removed item, even if it was delivered before the removal.

#### Scenario: Remove, restore, remove

- **GIVEN** a photo cited by a lot's Research proposal
- **WHEN** the photo is removed, restored and removed again
- **THEN** the proposal is stale after the first removal and stays stale, the Research session receives a notice for each removal, and the lead receives the restored photo as new evidence

#### Scenario: Removed before Examine read it

- **GIVEN** a photo the Examine lead has not read yet
- **WHEN** it is removed
- **THEN** Examine is not woken for it and agent tools can't read it

#### Scenario: Can't cite a removed photo

- **GIVEN** a Research session that was delivered a photo before it was removed
- **WHEN** it publishes a proposal citing the photo, an observation on it or its evidence note
- **THEN** the publication is refused with `media_evidence_removed`

#### Scenario: Stale through an observation

- **GIVEN** an identity proposal citing an observation on a photo, not the photo itself
- **WHEN** the photo is removed
- **THEN** the proposal becomes stale with `evidence_removed`

#### Scenario: Downstream proposal goes stale

- **GIVEN** an Inventory proposal built on a Research proposal that cites a photo
- **WHEN** the photo is removed
- **THEN** both proposals become stale and Inventory waits for current inputs
