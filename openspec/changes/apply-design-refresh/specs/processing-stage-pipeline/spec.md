# Capability delta

## ADDED Requirements

### Requirement: Evidence removal and restore notices

When a file is removed, proposals that cite one of its versions SHALL become stale with the reason `evidence_removed`. The Examine lead session SHALL receive a batch notice, and the affected lots' running or resumable Research and Images sessions SHALL receive a notice keyed by the removal revision, so a later removal after a restore is delivered again. A restore SHALL reach the Examine lead as new evidence. The Examine trigger and agent evidence reads SHALL skip removed versions.

#### Scenario: Remove, restore, remove

- **GIVEN** a photo cited by a lot's Research proposal
- **WHEN** the photo is removed, restored and removed again
- **THEN** the proposal is stale after the first removal and stays stale, the Research session receives a notice for each removal, and the lead receives the restored photo as new evidence

#### Scenario: Removed before Examine read it

- **GIVEN** a photo the Examine lead has not read yet
- **WHEN** it is removed
- **THEN** Examine is not woken for it and agent tools can't read it
