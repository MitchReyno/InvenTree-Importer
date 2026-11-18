# inventory-target-protection Specification

## Purpose

Keep every configured InvenTree target read-only from Bench Intake unless it is an owned disposable loopback fake, so development, tests and read-only profiles can never create, change or retry a remote inventory effect on a protected server.

## Requirements

### Requirement: Target writes only to owned disposable loopback targets

The inventory transport SHALL refuse every mutation call unless its profile is `owned-disposable`, names a nonempty protected-origin deny set, and targets a literal loopback HTTP origin (`127.0.0.1` or `[::1]`) that is not in the protected set. A refused mutation MUST fail with `mutation_target_refused` before any request is sent.

#### Scenario: Owned fake accepts one write

- **GIVEN** an `owned-disposable` profile for `http://127.0.0.1:<port>` with a nonempty protected set that does not include it
- **WHEN** the apply process sends one retained stock request
- **THEN** exactly one POST reaches the owned fake.

#### Scenario: Protected, DNS or public destination

- **GIVEN** a `protected-read-only` profile, an empty protected set, a DNS name, a LAN or public origin, or a destination grouped with a protected origin
- **WHEN** a stock, Part, parameter, company, location or attachment send is attempted
- **THEN** it fails before the transport is called and the protected endpoint records no request.

### Requirement: Target protected loopback grouping

Protected-host classification SHALL use the WHATWG-canonical hostname without its terminal dot and SHALL group `localhost`, IPv4 `127.0.0.0/8`, IPv6 `::1` and IPv4-mapped IPv6 `127.0.0.0/8` as one host across all ports. It MUST NOT resolve DNS or widen the set of writable destinations.

#### Scenario: Loopback alias of a protected origin

- **GIVEN** a protected origin spelled `localhost.`, `127.0.0.2`, `127.1`, `[::1]` or an IPv4-mapped `[::ffff:127.0.0.1]`, on the destination's port or another port
- **WHEN** an owned-disposable write targets `http://127.0.0.1:<port>`
- **THEN** the write is refused with `mutation_target_refused` before transport, because any protected loopback spelling denies the whole loopback group.

#### Scenario: Loopback alias as the destination

- **GIVEN** an owned-disposable profile whose destination is `localhost.`, `[::ffff:127.0.0.1]` or `127.0.0.2`
- **WHEN** a write is attempted
- **THEN** it is refused, because only literal `127.0.0.1` and `[::1]` HTTP origins are writable.

#### Scenario: Nearby addresses stay distinct

- **GIVEN** a protected loopback origin
- **WHEN** the protected origin is instead `126.255.255.255`, `128.0.0.1`, their IPv4-mapped forms or `localhost.invalid`
- **THEN** it is not treated as a loopback alias, and an owned write to `127.0.0.1` proceeds with exactly one request.

### Requirement: Target single send without retry or redirect

Each transport call SHALL emit at most one HTTP request, with no proxy discovery, retry or redirect following, and a deadline of at most five seconds. A 3xx response MUST be refused as `target_redirect_refused` with its body discarded.

#### Scenario: Server answers 421

- **GIVEN** a controlled owned endpoint that answers an authorized POST with HTTP 421
- **WHEN** the call completes
- **THEN** the endpoint observed exactly one POST, unlike a Fetch implementation that would replay it.

#### Scenario: Redirect toward a protected sink

- **GIVEN** an owned endpoint that redirects to a protected controlled sink
- **WHEN** a read or write is made
- **THEN** the call fails with `target_redirect_refused` and the sink receives nothing.

### Requirement: Target semantic read allowlist

The transport SHALL accept only named semantic reads (Part, tagged Part, location, stock, category, parameter template, category parameter, company and Part attachment metadata or file) with a validated positive primary key no larger than the signed 64-bit maximum, and only the `list_locations` and `list_supplier_companies` list reads. It MUST NOT accept a raw URL, path or HTTP action.

#### Scenario: Bounded list read

- **GIVEN** a list read with `limit` 1–100, `offset` at most 10,000 and an optional search of at most 100 characters without control characters
- **WHEN** it is sent
- **THEN** the request uses the fixed path with `ordering=name` and an always-present limit, and a caller timeout may only shorten the five-second deadline.

#### Scenario: Non-semantic or malformed read

- **GIVEN** an unknown operation kind, a zero, negative, non-decimal or out-of-range PK, an over-limit page or an attachment path outside same-origin `/media/attachments/`
- **WHEN** the read is requested
- **THEN** it is refused before any request is sent.

### Requirement: Target binding enforcement

Every transport call SHALL name the target and context its profile was built for, and server routes that read the target SHALL check the database's current target context before the read and again before publishing its result. A mismatched binding MUST fail before network traffic, and a rotated context MUST make the request fail with `target_context_changed` (HTTP 409).

#### Scenario: Wrong binding

- **GIVEN** a transport built for one target and context
- **WHEN** a call names a different target or context
- **THEN** it fails with `target_binding_mismatch` and sends nothing.

#### Scenario: Context rotates during a read

- **GIVEN** a catalogue or connection read in flight
- **WHEN** the target's current context changes before the result is published
- **THEN** the late result is discarded with `target_context_changed`, and the next request is refused before any target traffic.

### Requirement: Target effect capability gating

Owned-fake mutation kinds SHALL require the matching capability on the owned profile: location and company creation need `owned-fake-effects/2`; Part, parameter, manufacturer, supplier, stock and Part attachment effects accept `owned-fake-effects/1` or `/2`; stock attachments need `owned-fake-media/1`. A missing capability MUST refuse the send before transport.

#### Scenario: Record create under the first effects version

- **GIVEN** an owned loopback profile with `owned-fake-effects/1`
- **WHEN** a location or company create is attempted
- **THEN** it is refused before transport and no request reaches any target.

### Requirement: Target web process read-only transport

The web API SHALL build its inventory transport only from server configuration as a read-only profile, accepting no browser-supplied origin, credential or action. Mutation capability SHALL exist only in the separately launched apply runner, which MUST refuse any profile that is not an owned literal-loopback target.

#### Scenario: Read origin configured for the web API

- **GIVEN** `INTAKE_READ_ORIGIN` and a configured development key
- **WHEN** the web API starts
- **THEN** capture, catalogue, header and preparation reads use the read-only transport, and any send through it is refused.

#### Scenario: Runner configured for a real server

- **GIVEN** a runner configuration whose profile is not owned-disposable, is not literal loopback HTTP, or has no protected origins
- **WHEN** the apply runner starts
- **THEN** it refuses with `owned_fake_manual_runner_required` and receives no write closure.

#### Scenario: Web transport profile

- **GIVEN** the web API is started with a read origin
- **WHEN** its transport is constructed
- **THEN** the profile is `protected-read-only` and its protected set includes that read origin, so it cannot be used for a write even toward its own target.

### Requirement: Target development profiles

The development launcher SHALL default to the owned mock inventory and select the local or an external InvenTree only from explicit settings: `INTAKE_USE_LOCAL_INVENTREE=true` selects the local development InvenTree and `INTAKE_INVENTREE_URL` selects an external server. `INTAKE_USE_MOCK_INVENTREE=true` SHALL select the mock even when local or external settings are present. `INTAKE_INVENTREE_READ_ONLY` SHALL default to false for the mock and true otherwise. Local, external and read-only mock targets MUST start no apply worker and receive no executor deployment; local and external targets also start no fake inventory service.

#### Scenario: External read-only target

- **GIVEN** `INTAKE_INVENTREE_URL` set to a canonical HTTP(S) server origin without path, userinfo, query or fragment, and a printable `INTAKE_INVENTREE_TOKEN`
- **WHEN** `pnpm dev` starts
- **THEN** the token reaches only the API process, is not saved in retained state, and the namespace is bound to the origin and credential reference so changing either selects a different default namespace.

#### Scenario: Derived credential reference

- **GIVEN** an external URL and no `INTAKE_CREDENTIAL_REF`
- **WHEN** the launcher resolves the target
- **THEN** the credential reference is `inventree_` followed by the URL's host name, without the port, with characters outside `[A-Za-z0-9_-]` replaced by `_`, truncated to 128 characters; an explicit valid `INTAKE_CREDENTIAL_REF` is used instead.

#### Scenario: Local development InvenTree

- **GIVEN** `INTAKE_USE_LOCAL_INVENTREE=true`
- **WHEN** the launcher starts
- **THEN** it reads only from `http://127.0.0.1:4320` with the view-only reader token from private state, binds the namespace to the local instance ID, and refuses any supplied URL, credential reference, token or admin URL.

#### Scenario: Mock takes precedence

- **GIVEN** `INTAKE_USE_MOCK_INVENTREE=true` together with `INTAKE_USE_LOCAL_INVENTREE=true` or an external URL
- **WHEN** the launcher resolves the target
- **THEN** it selects the mock, ignores the local and external settings, and names the ignored settings in its startup output.

#### Scenario: Mock explicitly disabled without a server

- **GIVEN** `INTAKE_USE_MOCK_INVENTREE=false` and neither the local switch nor a URL
- **WHEN** the launcher resolves the target
- **THEN** it refuses with `inventree_server_required`.

#### Scenario: Read-only mock

- **GIVEN** the mock target and `INTAKE_INVENTREE_READ_ONLY=true`
- **WHEN** `pnpm dev` starts
- **THEN** the fake inventory serves reads, the API receives no executor deployment and no apply worker starts, so preparation cannot authorize an effect; the retained mock namespace is the same one the writable mock uses.

#### Scenario: Writes to a real server

- **GIVEN** the local or an external target and `INTAKE_INVENTREE_READ_ONLY=false`
- **WHEN** the launcher resolves the target
- **THEN** it refuses with `inventree_writes_not_supported` before any setup.

#### Scenario: Owned fake target label

- **GIVEN** the mock target, writable or read-only
- **WHEN** connection status is read
- **THEN** `target.kind` is `owned_test`, while the local and external targets report `configured`.

#### Scenario: Incomplete external settings

- **GIVEN** a URL without a token, a token without a URL, a non-origin URL, an invalid credential reference, or both the local switch and a URL without the mock override
- **WHEN** the launcher resolves the target
- **THEN** it refuses with a fixed error code that does not include the supplied values; the local switch with a URL fails with `conflicting_development_target_settings`.

#### Scenario: Profile selection

- **GIVEN** no inventory settings, `INTAKE_USE_LOCAL_INVENTREE=true`, or `INTAKE_INVENTREE_URL` with a token
- **WHEN** the launcher resolves the target
- **THEN** it selects the mock, the local development InvenTree or the external server respectively, and passes the child processes the same internal target values (`fake`, `local-inventree`, `read-only`) as before, so existing namespaces stay bound.
