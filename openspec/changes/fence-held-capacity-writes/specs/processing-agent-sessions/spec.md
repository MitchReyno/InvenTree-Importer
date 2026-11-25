## ADDED Requirements

### Requirement: Held capacity writes need the supervisor lock

Before it writes, in the same transaction, a slot claim, a turn child record, a `/1` lane claim or the startup interruption of a running session SHALL check that its worker's own supervisor connection holds the actor's supervisor lock, and a turn's settlement SHALL check that no other worker holds it. A write that fails its check SHALL be refused with `agent_supervisor_lock_lost`, changing nothing. Claims SHALL stay serialized per actor.

#### Scenario: Claim after the lock is lost

- **GIVEN** a worker whose supervisor connection has ended, and a replacement worker that has taken the lock and checked held capacity
- **WHEN** the old worker tries to claim a slot for a queued session
- **THEN** the claim is refused with `agent_supervisor_lock_lost`, no slot is held, the session stays queued and no driver runs

#### Scenario: Turn child recorded during the replacement's check

- **GIVEN** a worker holding a slot whose turn recorded nothing outside the worker, and a replacement worker checking held capacity after the first worker lost its lock
- **WHEN** the old worker records a VM command for that turn while the check runs
- **THEN** the record is refused with `agent_supervisor_lock_lost`, the slot keeps its `none` record, and the replacement releases the slot, interrupts the session and starts

#### Scenario: Lane claim after the lock is lost

- **GIVEN** a `/1` worker whose supervisor connection has ended, and a replacement that has found the lane free
- **WHEN** the old worker claims a queued native command
- **THEN** the claim is refused with `agent_supervisor_lock_lost`, the lane stays free and the attempt stays queued

#### Scenario: Settlement after another worker took the lock

- **GIVEN** a worker whose supervisor connection has ended, and a replacement worker that holds the lock
- **WHEN** the old worker settles a turn
- **THEN** the settlement is refused and changes nothing, and is retried within a 20 s bound; while the replacement still holds the lock the slot keeps its record for a start to check

#### Scenario: Settlement after a replacement refused to start

- **GIVEN** a worker whose supervisor connection has ended, whose settlement was refused while a replacement held the lock
- **WHEN** the replacement refuses to start and releases the lock within the retry bound
- **THEN** the retried settlement commits and releases the slot

#### Scenario: Startup interruption after the lock is lost

- **GIVEN** a worker whose supervisor connection ends while it interrupts sessions left running, and a replacement that took the lock
- **WHEN** the old worker interrupts its next session
- **THEN** the interruption is refused with `agent_supervisor_lock_lost` and the session keeps the state the replacement gave it

#### Scenario: Settlement while no worker holds the lock

- **GIVEN** a worker whose supervisor connection has ended, and no worker holding the lock
- **WHEN** its turn ends with its child confirmed gone and it settles the turn
- **THEN** the settlement commits as before and releases the slot, and a worker that takes the lock afterwards sees it settled

#### Scenario: Writes of the lock holder

- **GIVEN** a worker that holds the actor's supervisor lock
- **WHEN** it claims slots, records turn children, settles turns and claims the lane
- **THEN** each write commits as before, and concurrent turns' writes do not wait for each other beyond the existing per-actor claim serialization

### Requirement: A new supervisor waits for fenced writes in flight

After taking the supervisor lock and before checking held capacity, a starting worker SHALL wait for fenced writes already past their lock check to finish, so none commits after its check. Past a 30 s bound it SHALL refuse to start with `agent_supervisor_writes_in_flight`. The startup check's decisions SHALL be unchanged.

#### Scenario: Claim in flight when the lock is lost

- **GIVEN** a worker's claim transaction that passed its lock check, then the worker's supervisor connection ends before the claim commits
- **WHEN** a replacement worker takes the lock
- **THEN** the replacement waits for the claim to finish before checking held capacity, and its check sees and decides the claimed slot

#### Scenario: Writes still in flight past the bound

- **GIVEN** a fenced transaction of a worker that lost its lock, still open
- **WHEN** a replacement worker takes the lock and the transaction stays open past the bound
- **THEN** the replacement refuses to start with `agent_supervisor_writes_in_flight`, releases its lock and changes nothing
