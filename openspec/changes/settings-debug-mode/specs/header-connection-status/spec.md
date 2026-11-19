# Capability delta

## ADDED Requirements

### Requirement: Connection check on demand

The server menu's "Check connection now" and Settings › InvenTree's "Check now" SHALL run one fresh target check, skipping the cached observation. The checks SHALL be limited to one in flight per target context and to one every 5 seconds. A request inside that window SHALL return the latest result instead of starting another.

The result SHALL tell these apart:

- the target accepted the token;
- the target refused it (HTTP 401 or 403, reported as `unauthorized`);
- the target was unreachable or failed otherwise.

The result SHALL update the masthead observation. A check SHALL use only the existing bounded read transport and create no inventory effects.

#### Scenario: Check succeeds

- **GIVEN** a reachable target and an accepted token
- **WHEN** the operator chooses Check connection now
- **THEN** the menu shows Connected with the new check time, and the masthead indicator updates without waiting for the 30-second cycle

#### Scenario: Token refused

- **GIVEN** a target that answers 401 to the probe
- **WHEN** the check runs
- **THEN** the observation is unavailable with `unauthorized`, the menu says the token was refused, and no credential appears in the response or UI

#### Scenario: Repeated clicks

- **GIVEN** a check finished 2 seconds ago
- **WHEN** Check connection now is chosen again
- **THEN** no new probe is sent, and the latest result is shown

### Requirement: Connection diagnostics only in debug mode

The connection details' technical disclosure SHALL render only when debug mode is on. It holds the API status, last API read, transport state and freshness, target state and the raw failure code. The target state, last check, the sentence on what approvals write to, Check connection now and Open InvenTree SHALL stay visible either way.

#### Scenario: Debug mode off

- **GIVEN** debug mode off and a failed target probe with code `timeout`
- **WHEN** the server menu opens
- **THEN** it says InvenTree is unreachable with the last check time, and no "Details" disclosure or `timeout` code is present
