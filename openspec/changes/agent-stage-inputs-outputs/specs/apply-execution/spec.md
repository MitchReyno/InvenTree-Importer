## MODIFIED Requirements

### Requirement: Apply supported capability scope

The executor SHALL apply only plans whose version, build and capability match a qualified owned-fake capability: `owned-fake-stock/1`, `owned-fake-media/1`, `owned-fake-effects/1`, `owned-fake-effects/2` or `owned-fake-effects/3`. Plans with unknown fields, a changed build, invalid scalars or an unsupported capability SHALL be refused before reservation or any request.

#### Scenario: Unsupported plan

- **GIVEN** retained plan bytes with an unknown field, a changed build or an unsupported capability
- **WHEN** apply starts
- **THEN** it refuses before any HTTP request.

#### Scenario: Record drafts without the record-creation capability

- **GIVEN** a batch with a new-location draft and a deployment with only `owned-fake-effects/1`
- **WHEN** a lot using that location is prepared
- **THEN** preparation reports `record_creation_unavailable` and nothing is created.

#### Scenario: Switch waits for retained runs

- **GIVEN** a retained `bench-effects-plan/2` run that is queued, recovery-required, or settled incomplete with a recovery action offered
- **WHEN** the operator activates the `/3` deployment
- **THEN** new earlier-version approvals are fenced under the target lock, and activation is refused until that run settles on its own runner, so one writer holds the target.

#### Scenario: Part image effects on an older capability

- **GIVEN** a deployment with `owned-fake-effects/2` and a lot whose confirmed Part image targets an existing Part
- **WHEN** the lot is prepared
- **THEN** preparation reports that the Part image effect is unavailable, and retained `bench-effects-plan/2` plans still apply.

#### Scenario: New location under the third effects version

- **GIVEN** a runner with only `owned-fake-effects/3` and a batch with a new-location draft
- **WHEN** a lot using that location is prepared and applied
- **THEN** the location is created and the lot's stock uses it.

#### Scenario: Add stock under the third effects version

- **GIVEN** a `/3` runner deployment with `owned-fake-effects/3` and `owned-fake-media/1`, activated after every retained `/2` run settled, and a `bench-effects-plan/3` plan that sets an existing Part's image, creates stock and attaches its stock image
- **WHEN** it applies
- **THEN** all three effects run under the `/3` runner, which is the target's only writer.
