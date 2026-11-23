## MODIFIED Requirements

### Requirement: Apply supported capability scope

The executor SHALL apply only plans whose version, build and capability match a qualified owned-fake capability: `owned-fake-stock/1`, `owned-fake-media/1`, `owned-fake-effects/1`, `owned-fake-effects/2` or `owned-fake-effects/3`. Plans with unknown fields, a changed build, invalid scalars or an unsupported capability SHALL be refused before reservation or any request.

#### Scenario: Unsupported plan

- **GIVEN** retained plan bytes with an unknown field, a changed build or an unsupported capability
- **WHEN** apply starts
- **THEN** it refuses before any HTTP request.

#### Scenario: Record drafts without the record-creation capability

- **GIVEN** a batch with a new-location draft and a deployment without `owned-fake-effects/2`
- **WHEN** a lot using that location is prepared
- **THEN** preparation reports `record_creation_unavailable` and nothing is created.

#### Scenario: Part image effects on an older capability

- **GIVEN** a deployment with `owned-fake-effects/2` and a lot whose confirmed Part image targets an existing Part
- **WHEN** the lot is prepared
- **THEN** preparation reports that the Part image effect is unavailable, and retained `bench-effects-plan/2` plans still apply.
