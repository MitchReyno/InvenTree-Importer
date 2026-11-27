## ADDED Requirements

### Requirement: Read current values for requested batch record keys

Review SHALL read current target values only for mapped records needed by the open detail or displayed location paths. The targeted read MUST resolve keys against the authorized batch projection and preserve target-context checks, per-record result states and bounded target traffic.

#### Scenario: Open a record after the former cutoff

- **GIVEN** a batch with 60 mapped records and no cached details
- **WHEN** the operator opens the sixtieth record in Companies
- **THEN** only that company's mapped target detail is requested and its current values or lookup status are displayed

#### Scenario: List paths in a mixed batch

- **GIVEN** a Locations list with existing locations, a draft with a valid mapped parent and unrelated companies
- **WHEN** paths are displayed
- **THEN** lookup includes only the mapped location keys required for those paths, including the parent, and each distinct key is requested once per fresh read
- **AND** a selected location outside the first 50 mapped records can receive its details

#### Scenario: Stale or invalid key

- **GIVEN** a key absent from the authorized batch mapping or a request exceeding the supported limit
- **WHEN** the server handles the targeted read
- **THEN** the absent key causes no target lookup and an oversized request is refused before target traffic
- **AND** a target-context change during a read prevents its result being served under the new context

#### Scenario: Navigation while a lookup is pending

- **GIVEN** record A's detail is loading
- **WHEN** the operator selects B or changes batch revision before A's response arrives
- **THEN** the fields and lookup status shown for B come only from a matching key, revision and scope

#### Scenario: A stable record key is remapped between reads

- **GIVEN** the displayed batch revision maps a Part key to one target Part and a newer revision maps that key to another
- **WHEN** a lookup or later chunk requests the displayed revision
- **THEN** the server refuses the revision mismatch before reading the target and the client refreshes the projection before combining or presenting further details

### Requirement: Load Ask session state for eligible record controls

Records SHALL request Processing on behalf of Ask only when the view could display an actionable Ask control. Every send SHALL retain the current read and session eligibility checks.

#### Scenario: Browse, open a detail and return to the list

- **GIVEN** a chat-capable batch with an ordinary record list
- **WHEN** no detail or parameter conflict needs Ask
- **THEN** Records makes no Ask-related Processing read or poll
- **WHEN** a detail with an agent-attributed field, eligible location, or a parameter-matrix conflict is displayed
- **THEN** Records may read Processing to resolve the session and shows Ask only for an eligible session
- **AND** a live invalidation prevents sending until a qualifying read completes

#### Scenario: Archived batch

- **WHEN** Records displays an archived batch
- **THEN** Ask triggers no Processing read and cannot send a message
