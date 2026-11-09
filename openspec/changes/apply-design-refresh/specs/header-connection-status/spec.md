# Capability delta

## MODIFIED Requirements

### Requirement: Independent connection observations

The application SHALL show a labelled target-connection indicator with expandable details: on desktop, the connection control in the masthead; at phone width, a status dot on the menu button, announced in its accessible name, with the full connection control inside the menu. Details SHALL distinguish API availability, live-update transport/fallback and configured InvenTree target reachability, each with freshness and observed/unknown/unavailable state. A successful local API or socket response MUST NOT imply target reachability.

#### Scenario: Socket healthy but inventory unreachable

- **GIVEN** live updates are connected and a target read observation failed
- **WHEN** the header and connection details render
- **THEN** target reachability is unavailable, transport remains connected, and the distinct observations are visible without relying on color alone.

#### Scenario: Missing or stale target observation

- **GIVEN** no configured target or no completed target observation within 60 seconds, or the last observation belongs to a previous target context
- **WHEN** the indicator renders
- **THEN** it shows unconfigured or unknown/stale rather than connected, discards previous-context observations, and identifies the last checked time when available. A newly completed failed probe is fresh unavailable, not stale merely because no recent success exists.

#### Scenario: Phone indicator

- **GIVEN** a 390px viewport and an unreachable target
- **WHEN** the masthead renders
- **THEN** the menu button's dot shows the unavailable state, its accessible name says "InvenTree unreachable", and the menu holds the full connection details.

### Requirement: Accessible connection disclosure

The connection control SHALL be keyboard operable, announce expanded state, and expose labelled details with Escape dismissal and focus return. At phone width the control SHALL sit inside the masthead menu, where the same rules apply. Popover and menu content SHALL remain within the viewport at 360px and 390px widths and at 200% zoom; it MUST NOT be clipped by the decorative masthead.

#### Scenario: Keyboard and narrow viewport

- **GIVEN** keyboard focus on the menu button in a 360px viewport
- **WHEN** the menu is opened, the connection details are explored and the menu is dismissed with Escape
- **THEN** the labelled details and Open InvenTree link remain usable without document horizontal scrolling, and focus returns to the menu button.

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
