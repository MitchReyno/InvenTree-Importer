# Capability delta

## MODIFIED Requirements

### Requirement: Independent connection observations

The application SHALL show a labelled target-connection indicator with expandable details: on desktop, the connection control in the masthead; at phone width, a status dot on the menu button, announced in its accessible name, with the full connection control inside the menu. Details SHALL always show the configured InvenTree target's reachability with its freshness and observed/unknown/unavailable state. When debug mode is on, details SHALL also distinguish API availability and live-update transport/fallback, each with freshness and state. A successful local API or socket response MUST NOT imply target reachability.

#### Scenario: Socket healthy but inventory unreachable

- **GIVEN** live updates are connected, a target read observation failed and debug mode is on
- **WHEN** the header and connection details render
- **THEN** target reachability is unavailable, transport remains connected, and the distinct observations are visible without relying on color alone.

#### Scenario: Inventory unreachable with debug mode off

- **GIVEN** live updates are connected, a target read observation failed and debug mode is off
- **WHEN** the connection details render
- **THEN** target reachability is unavailable with its last check, no transport or API observation is shown, and the connected socket doesn't make the target look reachable.

#### Scenario: Missing or stale target observation

- **GIVEN** no configured target or no completed target observation within 60 seconds, or the last observation belongs to a previous target context
- **WHEN** the indicator renders
- **THEN** it shows unconfigured or unknown/stale rather than connected, discards previous-context observations, and identifies the last checked time when available. A newly completed failed probe is fresh unavailable, not stale merely because no recent success exists.

#### Scenario: Phone indicator

- **GIVEN** a 390px viewport and an unreachable target
- **WHEN** the masthead renders
- **THEN** the menu button's dot shows the unavailable state, its accessible name says "InvenTree unreachable", and the menu holds the full connection details.

## ADDED Requirements

### Requirement: Connection check on demand

The server menu's "Check connection now" and Settings › InvenTree's "Check now" SHALL run one fresh target check, skipping the cached observation, and the result SHALL update the masthead observation. A check SHALL use only the existing bounded read transport and create no inventory effects.

#### Scenario: Check succeeds

- **GIVEN** a reachable target and an accepted token
- **WHEN** the operator chooses Check connection now
- **THEN** the menu shows Connected with the new check time, and the masthead indicator updates without waiting for the 30-second cycle

### Requirement: Token refusal reported separately

A check's result SHALL tell an accepted token apart from a refused one (HTTP 401 or 403, reported as `unauthorized`) and from an unreachable or otherwise failing target.

#### Scenario: Token refused

- **GIVEN** a target that answers 401 to the probe
- **WHEN** the check runs
- **THEN** the observation is unavailable with `unauthorized`, the menu says the token was refused, and no credential appears in the response or UI

### Requirement: Forced checks are rate limited

Forced checks SHALL be limited to one in flight per target context and one every 5 seconds, counted from the last forced check, not from background observations. A forced request inside that window SHALL return the latest result instead of starting another. A change of the read credential SHALL discard the cached observation and reset the window.

#### Scenario: Repeated clicks

- **GIVEN** a forced check finished 2 seconds ago
- **WHEN** Check connection now is chosen again
- **THEN** no new probe is sent, and the latest result is shown

#### Scenario: Check right after a background poll

- **GIVEN** a background connection read completed 1 second ago and no forced check has run
- **WHEN** Check connection now is chosen
- **THEN** a fresh probe runs

#### Scenario: Credential replaced

- **GIVEN** a cached `unauthorized` observation
- **WHEN** the read token is replaced or reverted
- **THEN** the cached observation is discarded, and the next connection read probes with the new credential

### Requirement: Connection diagnostics only in debug mode

The connection details' technical disclosure SHALL render only when debug mode is on. It holds the API status, last API read, transport state and freshness, target state and the raw failure code. The target state, last check, the sentence on what approvals write to, Check connection now and Open InvenTree SHALL stay visible either way.

#### Scenario: Debug mode off

- **GIVEN** debug mode off and a failed target probe with code `timeout`
- **WHEN** the server menu opens
- **THEN** it says InvenTree is unreachable with the last check time, and no "Details" disclosure or `timeout` code is present
