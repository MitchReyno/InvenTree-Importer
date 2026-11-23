## ADDED Requirements

### Requirement: Revisions carry the change

A revision delivered to a session SHALL name each changed field with its previous and new value, or the corrected reading with the observation, the earlier reading where retained and the new one, and who made the change: the operator or another session. A one-line reason MAY accompany it.

#### Scenario: Identity revised after Research started

- **GIVEN** Research running on ECS-160-18-4X
- **WHEN** Examine revises the lot's identity to ECS-160-20-4X citing slip line 4
- **THEN** Research's inbox item names the MPN change from ECS-160-18-4X to ECS-160-20-4X, Examine as its source and the new proposal ID.

#### Scenario: Reading corrected by the operator

- **GIVEN** Research and Images relying on an observation
- **WHEN** the operator corrects its reading
- **THEN** both receive one item naming the observation, the old and new reading and the operator as its source, and their relying proposals are stale.
