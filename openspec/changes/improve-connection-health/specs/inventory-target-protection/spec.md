## MODIFIED Requirements

### Requirement: Target single send without retry or redirect

Each transport call SHALL emit at most one HTTP request, with no proxy discovery, retry or redirect following, and a deadline of at most five seconds, except that the two read-only connection-health requests using the active credential (API root and protected parts probe) SHALL allow ten seconds. A 3xx response MUST be refused as `target_redirect_refused` with its body discarded.

#### Scenario: Server answers 421

- **GIVEN** a controlled owned endpoint that answers an authorized POST with HTTP 421
- **WHEN** the call completes
- **THEN** the endpoint observed exactly one POST, unlike a Fetch implementation that would replay it.

#### Scenario: Redirect toward a protected sink

- **GIVEN** an owned endpoint that redirects to a protected controlled sink
- **WHEN** a read or write is made
- **THEN** the call fails with `target_redirect_refused` and the sink receives nothing.

#### Scenario: Health exception is confined to active credential observations

- **WHEN** the server checks an active target whose valid response takes nine seconds
- **THEN** the health read may succeed while candidate-token verification, catalogue and execution requests remain bounded by five seconds.
