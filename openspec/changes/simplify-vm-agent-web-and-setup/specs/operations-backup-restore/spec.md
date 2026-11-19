# Capability delta

## MODIFIED Requirements

### Requirement: Operations liveness and readiness

`GET /api/v1/health` SHALL report liveness only, and `GET /api/v1/readiness` SHALL return 200 only when the development key is configured, the target context is current and the schema is compatible, otherwise 503 `readiness_unavailable`. Readiness SHALL report `web: available` when the processing profile gives sessions web access, and `web: unavailable` otherwise. Readiness MUST NOT send inventory requests or publish database errors or connection settings.

#### Scenario: Ready local development

- **GIVEN** a configured key, current target context and exact migrations
- **WHEN** readiness is requested
- **THEN** it returns 200 with `deployment: restricted-local-development`, `identity: deferred_T11`, `web` set from the profile, `updates: websocket-with-polling-fallback`, `apply: separately-supervised-owned-fake-only` and media `configured` or `disabled`, and no key or database URL.

#### Scenario: Web state follows the profile

- **GIVEN** the `shared-vm-agent/3` profile, and separately the `synthetic-session/1` profile
- **WHEN** readiness is requested
- **THEN** it reports `web: available` for the first and `web: unavailable` for the second, and the local setup diagnostics show the same state instead of a fixed provider-qualification message

#### Scenario: Drifted schema or rotated context

- **GIVEN** a changed migration digest or a target whose current context differs from configuration
- **WHEN** readiness is requested
- **THEN** it returns 503 `readiness_unavailable` with recovery `wait`.
