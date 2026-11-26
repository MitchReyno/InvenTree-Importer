## ADDED Requirements

### Requirement: A turn without a free VM connection goes back to the queue

A VM turn whose wait (45 s for a tool worker, 15 s otherwise) ends with no free connection for its route while one for that route is busy SHALL go back to the queue: slot and capability released, turn not counted, no diagnostic, turn child still `none`, at the back of the queue. A turn whose route had no connection during the wait SHALL fail: a tool turn with `agent_vm_unavailable`, a subscription turn without tools with `agent_login_required` as before.

#### Scenario: All of a provider's connections are busy

- **GIVEN** a relay with turn capacity 1 running one Claude tool turn, and a session limit of 2
- **WHEN** a second Claude tool session claims a slot and its wait ends with no free connection
- **THEN** the second session is `queued` again with its turn count unchanged, holds no slot, has no new failure diagnostic, and later runs once a connection is free

#### Scenario: Another route's session is not held back

- **GIVEN** a session limit of 1, an older Claude session requeued because Claude's connections were busy, and a younger queued Codex session
- **WHEN** the slot is free
- **THEN** the Codex session claims it first

#### Scenario: No relay for the route

- **GIVEN** no Claude relay connected to the coordinator
- **WHEN** a Claude tool turn's wait ends
- **THEN** the session fails with `agent_vm_unavailable`, and its summary and recovery name the agent VM connection rather than the session configuration

#### Scenario: Cancelled while waiting

- **GIVEN** a turn waiting for a free connection
- **WHEN** its attempt is cancelled
- **THEN** it settles as cancellation does, sends nothing to any guest and releases its slot

#### Scenario: Supervisor lock lost while waiting

- **GIVEN** a turn waiting for a free connection whose worker has lost its supervisor lock to a replacement
- **WHEN** the wait ends
- **THEN** the requeue's settlement is refused by the fence and changes nothing
