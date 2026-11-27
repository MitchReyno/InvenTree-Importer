# Access identity

## Purpose

Describe the single-operator development access mode the web API enforces today: server-configured attribution under a restricted server-side InvenTree API key, exact same-origin request checks, strict request and response contracts, and the refusals that stop unconfigured or foreign requests. It is not a verified human login or the final InvenTree permission gate.

## ADDED Requirements

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
- **THEN** it shows a "Dev mode" badge beside the wordmark.

### Requirement: Access setup-required refusal

While the server is in `setup_required`, workspace routes (Capture, operator review, manual review, media, attention, records and header work) SHALL refuse with `setup_required` (HTTP 503), every state-changing request SHALL be refused, and live-update upgrades SHALL be refused. Health and bootstrap SHALL remain available.

#### Scenario: Unconfigured workspace read

- **GIVEN** a database is configured but no development key is supplied
- **WHEN** the browser lists batches
- **THEN** the response is 503 `setup_required` and contains no batch data.

### Requirement: Access server-configured attribution

The actor, target and target-context IDs SHALL come only from server configuration (`INTAKE_ACTOR_ID`, `INTAKE_TARGET_ID`, `INTAKE_TARGET_CONTEXT_ID`, with stable development placeholders), and SHALL remain stable across web restarts. Requests MUST NOT be able to choose an actor, target, context, origin or credential, and the CSRF token SHALL be regenerated at every server start.

#### Scenario: Web restart

- **GIVEN** a web entry point started twice with the same configuration
- **WHEN** bootstrap is read after each start
- **THEN** both report the same actor, target and context IDs, and the CSRF tokens differ.

#### Scenario: Browser-supplied actor

- **GIVEN** a command body carrying an unexpected `actor` property
- **WHEN** it reaches the API
- **THEN** strict validation rejects it with HTTP 400 rather than attributing the command to that actor.

### Requirement: Access exact Host and Origin

The configured origin SHALL be a canonical `http://127.0.0.1` origin (default port 4310), and the server MUST refuse to start otherwise with `loopback_origin_required`. Every request whose Host differs from that origin's host, or that carries a different Origin, SHALL be refused with HTTP 403 `access_denied`; no CORS is enabled.

#### Scenario: Hostile Host or Origin

- **GIVEN** a configured server
- **WHEN** a request arrives with Host `evil.example` or Origin `http://evil.example`
- **THEN** it receives 403 `access_denied` before any route runs, including bootstrap.

### Requirement: Access command authorization

Every request other than GET, HEAD or OPTIONS SHALL require a configured server, the exact configured Origin and the current per-start CSRF token in `X-Intake-CSRF`, or be refused with HTTP 403 `access_denied`. Domain commands SHALL also require a payload-bound UUID `Idempotency-Key`.

#### Scenario: Valid command token

- **GIVEN** the CSRF token from bootstrap and the exact Origin
- **WHEN** a command is posted
- **THEN** it reaches its route; the same request with a different 64-hex token, without Origin or after a server restart is refused with 403.

#### Scenario: Replayed idempotency key

- **GIVEN** a committed command under one idempotency key
- **WHEN** the same key is sent with reordered properties, and again with a changed value
- **THEN** the first replay returns the original result and the second fails with `payload_conflict`.

#### Scenario: Missing idempotency key

- **GIVEN** a valid Origin and CSRF token
- **WHEN** a Capture command is posted without an `Idempotency-Key`
- **THEN** it is refused with `idempotency_key_required` (HTTP 400).

### Requirement: Access scoped records

Batch lists, reads, commands and derived projections SHALL include only records owned by the configured actor, target and target context. Records created under another actor, or the same actor with another target or context, MUST NOT appear in lists, searches or live projections.

#### Scenario: Foreign batch

- **GIVEN** a batch retained under a different actor, and another under the same actor for a different target
- **WHEN** the configured operator searches the inbox by their titles
- **THEN** neither batch is returned.

### Requirement: Access strict request decoding

JSON request bodies SHALL be decoded as fatal UTF-8, parsed strictly and validated against the registered Draft 2020-12 contract with no coercion, default injection or removal of unknown fields. Invalid bodies MUST be refused with HTTP 400 and bodies over 256 KiB with HTTP 413.

#### Scenario: Adversarial command bodies

- **GIVEN** bodies with a duplicate escaped key, invalid UTF-8, 65 levels of nesting, a numeric revision, `1e999`, a revision above the signed 64-bit maximum, a quantity with seven fractional digits or an extra `raw_url` field
- **WHEN** each is posted
- **THEN** each is rejected with 400 and nothing is executed.

#### Scenario: Valid exact values

- **GIVEN** a revision of `9223372036854775807` and a quantity of `0.000001`, or an omitted, cleared or inherited selection
- **WHEN** it is posted
- **THEN** it is accepted and echoed byte-for-byte as exact strings and modes.

### Requirement: Access validated responses and safe errors

Responses SHALL be validated against their complete registered contract before serialization, so an unexpected private field fails as HTTP 500 instead of being sent. Error responses SHALL use the `code`, `message`, `recovery` (`refresh`, `wait`, `review` or `none`) and `correlation_id` shape and MUST NOT include original exception messages, SQL, request bodies, keys or connection strings.

#### Scenario: Private field leak

- **GIVEN** a route that returns an object with an undeclared field
- **WHEN** it responds
- **THEN** the client receives a 500 `internal_error` whose body omits the field's value.

### Requirement: Access server-only credentials

The development API key SHALL be supplied only by explicit server-side injection (`INTAKE_DEV_API_KEY` with a credential reference matching `^[a-zA-Z0-9_-]{1,128}$`). Runtime entry points MUST NOT discover an environment file, fall back to a username and password, or place the key in bootstrap, readiness, error or log output; only the explicit development launchers load their selected env file.

#### Scenario: Invalid credential reference

- **GIVEN** a credential reference containing characters outside the allowed set
- **WHEN** the server configuration is loaded
- **THEN** startup fails with `invalid_credential_reference`.
