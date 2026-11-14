# apply-execution Specification

## Purpose

Apply an approved plan through one supervised writer that journals a committed intent before every actual request, sends each request at most once, keeps uncertain outcomes uncertain, and recovers only under the original run. Results report what is known, never what was hoped for.

## Requirements

### Requirement: Apply supported capability scope

The executor SHALL apply only plans whose version, build and capability match a qualified owned-fake capability: `owned-fake-stock/1`, `owned-fake-media/1`, `owned-fake-effects/1` or `owned-fake-effects/2`. Plans with unknown fields, a changed build, invalid scalars or an unsupported capability SHALL be refused before reservation or any request.

#### Scenario: Unsupported plan

- **GIVEN** retained plan bytes with an unknown field, a changed build or an unsupported capability
- **WHEN** apply starts
- **THEN** it refuses before any HTTP request.

#### Scenario: Record drafts without the record-creation capability

- **GIVEN** a batch with a new-location draft and a deployment without `owned-fake-effects/2`
- **WHEN** a lot using that location is prepared
- **THEN** preparation reports `record_creation_unavailable` and nothing is created.

### Requirement: Apply launch is explicit and separate

Physical apply SHALL start only from the explicit runner process after a durable start command for an approved run. Approval, web startup, module import, migrations and scheduler acknowledgement or recovery MUST NOT start a physical writer.

#### Scenario: Approval before dispatch

- **GIVEN** an accepted approval
- **WHEN** no start command has been sent
- **THEN** the run reports dispatch `not_requested` and the target has received no request.

#### Scenario: Scheduler recovery of a claimed dispatch

- **GIVEN** a run whose dispatch was already claimed
- **WHEN** the scheduler recovers that workflow
- **THEN** no new physical writer is started and the run is reported from its journal.

### Requirement: Apply single physical writer

Before any request, the supervisor SHALL hold a non-expiring host-level claim and the writer SHALL hold a dedicated, never-reconnected PostgreSQL advisory connection for the deployment. A replacement writer MUST NOT start until the supervisor has observed the original child exit, and no heartbeat, timeout or stale-process check SHALL release a claim.

#### Scenario: Database connection lost

- **GIVEN** a physical child whose dedicated database connection drops while it survives
- **WHEN** another writer tries to start
- **THEN** the host claim refuses it until the original child is reaped, and the original sends no further request.

#### Scenario: Supervisor killed mid-request

- **GIVEN** a supervisor killed while its child's stock request is in flight
- **WHEN** apply is attempted again
- **THEN** the claim is still held and exactly one stock record exists.

### Requirement: Apply external activation gate

Every mutation SHALL require a matching private activation record held outside the application database and its backups, and a durable witness written after the intent commits and before the request is sent. Missing, disabled, corrupt or mismatched external state, or a retained witness without a surviving intent, SHALL block apply, including the first writer.

#### Scenario: Restored database without later history

- **GIVEN** a database backup taken before a fake stock create, then restored
- **WHEN** apply is attempted under fresh run or source IDs
- **THEN** the surviving witness blocks it and no replacement stock is created.

#### Scenario: Activation missing

- **GIVEN** a deployment with no external activation record
- **WHEN** apply starts
- **THEN** it refuses before any HTTP request.

### Requirement: Apply one committed intent per actual request

Each actual target request, including precondition reads, verification reads and transfers, SHALL have its own committed request intent before it is sent. The transport SHALL make exactly one HTTP request per intent, with no implicit retry, redirect following or connection reuse, and with five-second transport and body deadlines. Record responses SHALL be bounded at 64 KiB; attachment downloads are bounded at the 20 MiB media maximum plus an 8 KiB frame.

#### Scenario: HTTP 421

- **GIVEN** a target that answers a create with HTTP 421
- **WHEN** one authorized create is sent
- **THEN** exactly one POST reaches the target.

#### Scenario: Lost intent acknowledgement

- **GIVEN** a stock intent whose COMMIT acknowledgement is lost
- **WHEN** apply continues
- **THEN** zero POSTs are sent and the operation is unknown.

### Requirement: Apply effect certainty

Each operation SHALL report certainty `none`, `confirmed` or `unknown`, separately from its state, and only a complete matching success response SHALL confirm a create. An intent without a result, a lost, redirected or malformed response, or an error status alone SHALL leave the effect unknown, while every trustworthy returned PK SHALL still be retained.

#### Scenario: Accepted create, lost response

- **GIVEN** a target that creates stock and then drops the response
- **WHEN** the run settles
- **THEN** the stock operation is unknown, exactly one POST was sent, and no matching-looking record is adopted as its output.

#### Scenario: Malformed response with a PK

- **GIVEN** a create response with a valid PK but missing fields
- **WHEN** it is checkpointed
- **THEN** the PK is retained as attributed, the operation stays unknown, and it can be confirmed only by an explicit check of that output.

#### Scenario: Known refusal before dispatch

- **GIVEN** a request refused locally before it was sent
- **WHEN** it is checkpointed
- **THEN** it records `proven_not_sent` with certainty `none`.

### Requirement: Apply unknown outcomes block further creates

An unknown create SHALL block its sibling operations, earlier recovery selections, later rounds for the same source and any further create attempt. No stock, Part or record SHALL be adopted by searching for a matching payload, name or barcode.

#### Scenario: Unknown create in round A

- **GIVEN** lot A's stock create is unknown
- **WHEN** recovery of A's untouched operations or a round for lot B is requested
- **THEN** both are refused and no request is sent.

### Requirement: Apply durable cancellation

Cancellation SHALL be a durable, idempotent request on the run, checked before every new request authorization, and a later cancellation SHALL revoke recovery selections made before it. A request already authorized MAY finish and SHALL be settled or left unknown, and cancellation SHALL NOT roll back or erase confirmed effects.

#### Scenario: Cancel during a request

- **GIVEN** a run whose first stock request is in flight
- **WHEN** cancellation is requested
- **THEN** that request may complete, the next lot's request is never authorized, and the run reports the cancellation.

#### Scenario: Cancellation before authorization

- **GIVEN** a queued run with a pending operation
- **WHEN** cancellation is recorded before that operation is authorized
- **THEN** no request is sent, and only that original pending operation may later be resumed.

### Requirement: Apply original-run recovery

Recovery SHALL be a selected action under the original run and approval: resume operations proven not sent, verify a known output, verify or repair a selected attachment, or assess an attributed effect. Recovery MUST NOT create replacement stock, replenish consumed or deleted stock, upload a removed confirmed attachment again, or overlap a later run that holds the source.

#### Scenario: Resume proven-not-sent work

- **GIVEN** a run interrupted after a known local refusal before dispatch
- **WHEN** the operator selects recovery of that operation
- **THEN** it runs under the original run and approval, creating exactly one stock record.

#### Scenario: Verify consumed stock

- **GIVEN** confirmed stock that was later consumed or deleted
- **WHEN** it is verified
- **THEN** a receipt records the finding, the original effect is unchanged, and no create is offered.

#### Scenario: Overlapping repair

- **GIVEN** a later round holding the source
- **WHEN** repair of the earlier run is requested
- **THEN** it is refused until the source is released.

### Requirement: Apply attachment confirmation

An attachment transfer SHALL be confirmed only when the downloaded bytes and hash match the approved artifact and its destination matches the approved stock or Part, and a lost acknowledgement SHALL stay unknown until that check. Every supporting blob SHALL be checked before the first stock request, and an attachment failure SHALL NOT hide confirmed stock.

#### Scenario: Attachment fails after stock

- **GIVEN** confirmed stock and an attachment upload proven not sent
- **WHEN** the operator selects attachment repair
- **THEN** only the original attachment is transferred and no second stock POST is sent.

#### Scenario: Lost attachment acknowledgement

- **GIVEN** an attachment upload whose response is lost
- **WHEN** the run is read
- **THEN** the attachment is unknown and only explicit hash-and-destination verification is offered, never a replacement upload.

### Requirement: Apply truthful run results

A run SHALL report its round, state, overall and per-operation certainty, dispatch state, confirmed and attributed stock IDs and allowed recovery actions from its retained journal. An interrupted physical owner SHALL make the run `recovery_required`, never permission to relaunch.

#### Scenario: Run vocabulary

- **GIVEN** any retained run
- **WHEN** it is read
- **THEN** its state is one of `queued`, `running`, `stopping`, `settled_complete`, `settled_incomplete` or `recovery_required`, and its certainty one of `none`, `confirmed`, `unknown` or `mixed`.

#### Scenario: Writer killed after a checkpoint

- **GIVEN** a physical child killed after committing a stock intent, or after committing its confirmed result
- **WHEN** the run is read after restart
- **THEN** the intent-only operation is unknown and never retried, and the confirmed one reports its original stock PK.

#### Scenario: Refused value

- **GIVEN** a supported effect whose latest create got HTTP 400 and has no attributed record
- **WHEN** the run is read
- **THEN** the effect is marked `rejected`, its certainty stays unknown and the run stays `recovery_required`.

#### Scenario: Permission error is not a rejection

- **GIVEN** a parameter create refused with a permission error
- **WHEN** the run is read
- **THEN** the effect is not marked `rejected`, and its certainty is unknown.
