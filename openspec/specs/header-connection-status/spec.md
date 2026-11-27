# header-connection-status Specification

## Purpose

Keep operators aware of target connectivity without confusing local application or update-transport health with inventory reachability.

## Requirements

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

### Requirement: Safe target details and navigation

The server SHALL supply a sanitized configured target label and HTTP(S) navigation URL tied to the authorized target context. The connection control SHALL open a server menu holding the target state, last check, one sentence on what approvals write to, the development badge in development builds, and Open InvenTree. The masthead SHALL NOT show a separate Open InvenTree button. The UI SHALL never construct the link from prototype data or credentials. Target observations SHALL use the existing bounded read transport against server-selected configuration only; header reads MUST NOT create inventory effects.

#### Scenario: Configured target navigation

- **GIVEN** an authorized sanitized target URL without userinfo, query credentials or fragments
- **WHEN** Open InvenTree is activated from the server menu
- **THEN** it opens that target in a separate tab with opener isolation and does not trigger a mutation or lose the current draft.

#### Scenario: Configuration or observation unavailable

- **GIVEN** no valid target navigation URL or an unavailable observation service
- **WHEN** the server menu opens
- **THEN** it shows a labelled unavailable link state or explanation, never a fictional fallback URL, and keeps saved work and drafts accessible.

### Requirement: Accessible connection disclosure

The connection control SHALL be keyboard operable, announce expanded state, and expose labelled details with Escape dismissal and focus return. At phone width the control SHALL sit inside the masthead menu, where the same rules apply. Popover and menu content SHALL remain within the viewport at 360px and 390px widths and at 200% zoom; it MUST NOT be clipped by the decorative masthead.

#### Scenario: Keyboard and narrow viewport

- **GIVEN** keyboard focus on the connection trigger in a 360px viewport
- **WHEN** it is opened, explored and dismissed with Escape
- **THEN** its labelled details and link remain usable without document horizontal scrolling, and focus returns to the trigger.

#### Scenario: Phone menu

- **GIVEN** keyboard focus on the menu button in a 360px viewport
- **WHEN** the menu is opened, the connection details are explored and the menu is dismissed with Escape
- **THEN** the labelled details and Open InvenTree link remain usable without document horizontal scrolling, and focus returns to the menu button.

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

Technical details SHALL appear only in debug mode and show API read and transport freshness, target state and sanitized failure code. Both connection labels, last check, approvals explanation, check action and safe navigation SHALL remain available as applicable with debug off.

#### Scenario: Debug mode off

- **GIVEN** a fresh target timeout and responsive Intake
- **WHEN** the menu opens with debug off
- **THEN** it names both connections and the target check time and omits the raw timeout code.

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
