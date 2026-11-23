## MODIFIED Requirements

### Requirement: Apply supported capability scope

The executor SHALL apply only plans whose version, build and capability match a qualified owned-fake capability: `owned-fake-stock/1`, `owned-fake-media/1`, `owned-fake-effects/1`, `owned-fake-effects/2` or `owned-fake-effects/3`. Plans with unknown fields, a changed build, invalid scalars or an unsupported capability SHALL be refused before reservation or any request.

#### Scenario: Unsupported plan

- **GIVEN** retained plan bytes with an unknown field, a changed build or an unsupported capability
- **WHEN** apply starts
- **THEN** it refuses before any HTTP request.

#### Scenario: Record drafts without the record-creation capability

- **GIVEN** a batch with a new-location draft and a deployment with neither `owned-fake-effects/2` nor `/3`
- **WHEN** a lot using that location is prepared
- **THEN** preparation reports `record_creation_unavailable` and nothing is created.

#### Scenario: Switch waits for retained runs

- **GIVEN** a retained `bench-effects-plan/2` run that is queued, recovery-required, or settled incomplete with a write-capable recovery action such as `resume_effect` or `repair_attachment` offered
- **WHEN** the operator activates the `/3` deployment
- **THEN** new earlier-version approvals are fenced under the target lock, and activation is refused until that run settles on its own runner, so one writer holds the target.

#### Scenario: Writer still stopping

- **GIVEN** a `bench-effects-plan/2` run whose authorized request is still open after cancellation was requested
- **WHEN** the operator activates the `/3` deployment
- **THEN** activation waits until the earlier writer's child exit is confirmed, whatever the run's projected state.

#### Scenario: Irrecoverably uncertain run at the switch

- **GIVEN** a `bench-effects-plan/2` run left recovery-required with no attributable remote record, whose child exit is confirmed
- **WHEN** the operator activates the `/3` deployment
- **THEN** the run is retired with its journal and contribution-history block kept and its write authority revoked, and activation proceeds.

#### Scenario: Verification alone doesn't block the switch

- **GIVEN** a settled `bench-effects-plan/2` run that offers only `verify_effect`
- **WHEN** the operator activates the `/3` deployment
- **THEN** activation proceeds, and the verification stays available through the verify-only runner.

#### Scenario: Verifying an earlier run after the switch

- **GIVEN** a completed `bench-effects-plan/2` run that offers `verify_effect`, on a target now served by the `/3` deployment
- **WHEN** the operator asks to verify it
- **THEN** a read-only verification entry point, keeping the run's original build and journal bindings and holding no writer claim, performs the check, and no earlier-version write can be dispatched.

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

### Requirement: Apply single physical writer

Before any request, the supervisor SHALL hold a non-expiring host-level claim and the writer SHALL hold a dedicated, never-reconnected PostgreSQL advisory connection for the deployment. A replacement writer MUST NOT start until the supervisor has observed the original child exit, and no heartbeat, timeout or stale-process check SHALL release a claim. The read-only verification entry point for an earlier run is exempt: it holds no writer claim, sends only reads, journals each read intent before sending it, and can't dispatch a mutation; every mutation-capable path keeps both claims.

#### Scenario: Database connection lost

- **GIVEN** a physical child whose dedicated database connection drops while it survives
- **WHEN** another writer tries to start
- **THEN** the host claim refuses it until the original child is reaped, and the original sends no further request.

#### Scenario: Supervisor killed mid-request

- **GIVEN** a supervisor killed while its child's stock request is in flight
- **WHEN** apply is attempted again
- **THEN** the claim is still held and exactly one stock record exists.

#### Scenario: Read-only verification beside the writer

- **GIVEN** the `/3` writer holding its claims
- **WHEN** an earlier run's `verify_attachment` runs through the read-only entry point
- **THEN** it journals and sends only its read, takes no writer claim, and the `/3` writer's claims are unchanged.

### Requirement: Apply attachment confirmation

An attachment transfer SHALL be confirmed only when the downloaded bytes and hash match the approved artifact and its destination matches the approved stock or Part, and a lost acknowledgement SHALL stay unknown until that check. A Part attachment whose response was lost before its remote PK was retained can't be checked; it SHALL stay unknown with manual inspection offered, never another upload. Every supporting blob SHALL be checked before the first stock request, and an attachment failure SHALL NOT hide confirmed stock.

#### Scenario: Attachment fails after stock

- **GIVEN** confirmed stock and an attachment upload proven not sent
- **WHEN** the operator selects attachment repair
- **THEN** only the original attachment is transferred and no second stock POST is sent.

#### Scenario: Lost attachment acknowledgement

- **GIVEN** an attachment upload whose response is lost
- **WHEN** the run is read
- **THEN** the attachment is unknown and, when its remote record is attributed, only explicit hash-and-destination verification is offered, never a replacement upload.

#### Scenario: Datasheet lost before its PK

- **GIVEN** a datasheet attachment upload whose response was lost before its remote PK was retained
- **WHEN** the run is read
- **THEN** the attachment is unknown, manual inspection in InvenTree is offered, and no verification or replacement upload is.
