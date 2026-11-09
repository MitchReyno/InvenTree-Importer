# Capability delta

## MODIFIED Requirements

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
