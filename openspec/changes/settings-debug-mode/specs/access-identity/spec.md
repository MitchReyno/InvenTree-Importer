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
