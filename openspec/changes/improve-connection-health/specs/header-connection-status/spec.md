# Header connection status delta

## MODIFIED Requirements

### Requirement: Independent connection observations

The masthead SHALL label browser-to-Intake and Intake-to-InvenTree separately in its expandable connection control and Settings. At phone width the menu button SHALL announce the primary status and carry a status dot, with full details inside. A disconnected Intake SHALL take precedence and suppress current target claims. When Intake responds but a scoped API dependency fails, the control SHALL distinguish degraded service from loss of contact. Labels and freshness SHALL be understandable with debug off and without color.

#### Scenario: Socket healthy but inventory unreachable

- **GIVEN** fresh Intake liveness and a current failed network probe from Intake to InvenTree
- **WHEN** either status surface opens
- **THEN** it shows Intake connected and InvenTree unreachable with the check time, regardless of socket state.

#### Scenario: Inventory unreachable with debug mode off

- **GIVEN** Intake is connected and its fresh target probe timed out
- **WHEN** debug is off
- **THEN** both labelled states and the last check remain visible, and the technical disclosure stays hidden.

#### Scenario: Missing or stale target observation

- **GIVEN** an unconfigured target, no completed observation, a previous target context or an observation older than 60 seconds
- **WHEN** Intake is connected
- **THEN** the target is unconfigured, checking, or stale as applicable, a previous-context result is discarded, and only an applicable observation has a last-check time.

#### Scenario: Phone indicator

- **GIVEN** an unreachable target and a reachable Intake at 390px
- **WHEN** the phone menu is closed
- **THEN** its dot and accessible name identify InvenTree unreachable, switching to Intake disconnected if Intake subsequently loses contact.

#### Scenario: Local outage and recovery

- **GIVEN** the last target observation was healthy or failed
- **WHEN** Intake liveness fails and subsequently recovers
- **THEN** the UI says “No connection to Intake” with target status unavailable to check, preserves drafts, and waits for a current-context observation on recovery before presenting current target status.

#### Scenario: Cold-start outage

- **GIVEN** Intake was offline at first load and the browser has no bootstrap scope
- **WHEN** Intake returns and bootstrap succeeds
- **THEN** the offline view recovers automatically, and scoped target reads begin only after authorization.

#### Scenario: Partial failure

- **GIVEN** Intake responds to its heartbeat
- **WHEN** a scoped status read fails or live updates fall back to polling
- **THEN** an unavailable scoped read reports an unknown target and degraded Intake service, while transport fallback alone leaves independently verified connection states intact.

### Requirement: Connection diagnostics only in debug mode

Technical details SHALL appear only in debug mode and show API read and transport freshness, target state and sanitized failure code. Both connection labels, last check, approvals explanation, check action and safe navigation SHALL remain available as applicable with debug off.

#### Scenario: Debug mode off

- **GIVEN** a fresh target timeout and responsive Intake
- **WHEN** the menu opens with debug off
- **THEN** it names both connections and the target check time and omits the raw timeout code.

## ADDED Requirements

### Requirement: Regular and independent health checks

An active browser SHALL observe Intake every ten seconds with HTTP fallback. Intake SHALL check its configured target on startup and every 30 seconds after healthy completion, independently of browser traffic. Each leg SHALL allow ten seconds per check and retry transient failures within five seconds of completion.

#### Scenario: Busy server

- **GIVEN** slow inventory reads, occupied ordinary database connections and a backlog of retained photos
- **WHEN** health checks run against responsive endpoints
- **THEN** local liveness proceeds independently of database and decode work, a nine-second valid target reply can succeed, and one delayed target cannot delay the local heartbeat.

#### Scenario: Recovery and bounded traffic

- **GIVEN** several tabs, focus changes and a timed-out target
- **WHEN** recovery, normal polling and manual checks coincide
- **THEN** at most one probe cycle runs per target context, transient recovery observes the five-second bound, and successful recovery restores the healthy cadence.

#### Scenario: Recovery reaches the visible badge

- **GIVEN** the active browser shows a transient target failure or unknown status and Intake has completed a successful probe
- **WHEN** the scoped status endpoint responds promptly
- **THEN** the browser reads and displays the recovered state within five seconds without requiring focus, a live socket or operator action.

#### Scenario: Reachable service with rejected credentials

- **GIVEN** the API root responds but the protected read refuses the configured token
- **WHEN** the result is published
- **THEN** the UI reports the refusal, and neither a successful root reply nor the heartbeat grants access.

#### Scenario: Proxy answers the root during an inventory outage

- **GIVEN** the protected read times out
- **WHEN** the root returns a gateway error, a redirect, or a body that is not a valid JSON object
- **THEN** the root supplies no evidence of InvenTree contact and the UI reports the target as unreachable.

#### Scenario: Foreground confirmation during an active liveness check

- **GIVEN** a previously connected tab resumes with its last successful Intake observation over ten seconds old
- **WHEN** a liveness check is pending and several confirmation requests arrive
- **THEN** the tab shows Checking while contact is uncertain and schedules one coalesced follow-up within the applicable retry cadence, with at most one HTTP liveness request in flight.

#### Scenario: Manual check while the recovered target is still unknown

- **GIVEN** Intake has recovered and the browser has captured a scoped server observation as its recovery baseline
- **WHEN** an operator check returns a newer server observation or confirms the target is unconfigured
- **THEN** the header shows that result immediately. A cached result at or before the baseline keeps the gate closed, and a reply from an earlier recovery cannot replace the new result.
