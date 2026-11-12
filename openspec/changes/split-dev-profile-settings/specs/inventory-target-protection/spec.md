# Capability delta

## MODIFIED Requirements

### Requirement: Target development profiles

The development launcher SHALL default to the owned mock inventory and select the local or an external InvenTree only from explicit settings: `INTAKE_USE_LOCAL_INVENTREE=true` selects the local development InvenTree and `INTAKE_INVENTREE_URL` selects an external server. `INTAKE_USE_MOCK_INVENTREE=true` SHALL select the mock even when local or external settings are present. `INTAKE_INVENTREE_READ_ONLY` SHALL default to false for the mock and true otherwise. Local, external and read-only mock targets MUST start no apply worker and receive no executor deployment; local and external targets also start no fake inventory service.

#### Scenario: External read-only target

- **GIVEN** `INTAKE_INVENTREE_URL` set to a canonical HTTP(S) server origin without path, userinfo, query or fragment, and a printable `INTAKE_INVENTREE_TOKEN`
- **WHEN** `pnpm dev` starts
- **THEN** the token reaches only the API process, is not saved in retained state, and the namespace is bound to the origin and credential reference so changing either selects a different default namespace.

#### Scenario: Derived credential reference

- **GIVEN** an external URL and no `INTAKE_CREDENTIAL_REF`
- **WHEN** the launcher resolves the target
- **THEN** the credential reference is `inventree_` followed by the URL host with characters outside `[A-Za-z0-9_-]` replaced by `_`; an explicit valid `INTAKE_CREDENTIAL_REF` is used instead.

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
