# Capability delta

## MODIFIED Requirements

### Requirement: Access development-key bootstrap

Bootstrap SHALL report the single-operator development-key mode with its server-configured actor, target and context, `mutation_enabled: false` and `permission_gate: deferred_T11`. It MUST NOT return the key, contact the target or claim a verified session or permissions.

#### Scenario: Configured development key

- **GIVEN** the server is started with a development API key and credential reference
- **WHEN** the browser reads bootstrap
- **THEN** it receives `configured`, the stable server-configured IDs and a 64-hex-character CSRF token, and the response body does not contain the key.

#### Scenario: Missing key or reference

- **GIVEN** no API key, or the default `unconfigured` reference
- **WHEN** bootstrap is read
- **THEN** it returns `setup_required` with `csrf_token: null`, and no login or target request is attempted.

#### Scenario: Fixed development descriptor

- **GIVEN** any server configuration
- **WHEN** bootstrap is read
- **THEN** it reports `mode: development-key`, the banner "Single-operator development mode — not a verified human session", and `status: configured` only when a nonempty key and a credential reference other than `unconfigured` are supplied.

#### Scenario: Masthead mode badge

- **GIVEN** the application shell is open
- **WHEN** the masthead renders
- **THEN** it shows a "Dev mode" pill beside the wordmark, as a button whose accessible name says it opens developer tools, and activating it opens the Dev mode popover.

### Requirement: Access server-only credentials

The development API key SHALL be supplied only by explicit server-side injection (`INTAKE_DEV_API_KEY` with a credential reference matching `^[a-zA-Z0-9_-]{1,128}$`). Runtime entry points MUST NOT discover an environment file, fall back to a username and password, or place any credential in bootstrap, readiness, error or log output; only the explicit development launchers load their selected env file.

**Replacement read token.** The InvenTree read token MAY be replaced through Settings by a write-only request. The server SHALL:

- check the candidate against the target before saving it;
- save it only in a server-owned secret file under an explicitly configured secrets directory, with owner-only permissions, replaced whole;
- use it for inventory reads in place of the injected key;
- never return it in any response.

Without a configured secrets directory, replacement SHALL be refused with `secret_store_unavailable`. Bootstrap's development-key status SHALL keep depending only on the injected key.

#### Scenario: Invalid credential reference

- **GIVEN** a credential reference containing characters outside the allowed set
- **WHEN** the server configuration is loaded
- **THEN** startup fails with `invalid_credential_reference`.

#### Scenario: Replacement never leaves the server

- **GIVEN** a saved replacement token
- **WHEN** settings, connection status, readiness, Copy debug info and error responses are read, and the server logs are inspected
- **THEN** none contains the token

#### Scenario: Saved replacement survives a restart

- **GIVEN** a saved replacement token
- **WHEN** the server restarts
- **THEN** inventory reads use the saved token, and bootstrap still reports the development-key status from the injected key

#### Scenario: No secrets directory

- **GIVEN** no secrets directory is configured
- **WHEN** a replacement is submitted
- **THEN** it fails with `secret_store_unavailable`, nothing is written, and Settings explains that the server must be configured for it
