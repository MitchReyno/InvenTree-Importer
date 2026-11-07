# Capability delta

## Purpose

Processing coordinates durable jobs, immutable attempts, application questions and one actor lane for the single-result profiles `synthetic-research/1`, `synthetic-research/2`, `restricted-research-stub/1` and `native-agent/1` (handlers `processing/1` to `processing/4`, queue `bench-research`). The session profiles `native-agent/2` and `synthetic-session/1` are specified by processing-agent-sessions, processing-lot-forming and processing-stage-pipeline; this capability covers only the earlier profiles and the coordination those changes leave in place.

## ADDED Requirements

### Requirement: Processing job and attempt identity

For single-result profiles, a Processing job SHALL be unique per batch, subject and stage, and every attempt SHALL bind exactly one immutable canonical input with its SHA-256, one command and one profile. Queuing a stage again SHALL create the next numbered attempt, supersede the job's nonterminal attempts and open questions, and leave earlier inputs, messages, proposals and answers unchanged.

#### Scenario: Re-queue a stage

- **GIVEN** a reading job whose attempt 1 is waiting for an answer
- **WHEN** the operator starts reading for that lot again
- **THEN** attempt 2 is queued with a new input whose parent is attempt 1's input, attempt 1 and its open question become superseded, and attempt 1's retained messages and proposals stay readable.

#### Scenario: Retained authority cannot be rewritten

- **GIVEN** a retained input, message, proposal or answer
- **WHEN** any role attempts to update or delete the row
- **THEN** the database refuses the change.

#### Scenario: Batch job capacity

- **GIVEN** a batch that already has 100 Processing jobs
- **WHEN** a start would create another job
- **THEN** the start fails with `processing_capacity` and nothing is queued.

### Requirement: Processing start command

Starting Processing SHALL require an idempotency key and the expected capture revision, refuse an archived batch, a retired lot or an unsupported stage, and make each selected stage depend on the exact attempt queued for the previous selected stage. New starts and answers MUST be refused unless a private processing-channel secret is configured.

#### Scenario: Channel secret missing

- **GIVEN** no processing-channel secret of at least 32 bytes is configured
- **WHEN** the operator starts Processing or answers a question
- **THEN** the request fails with `processing_channel_unconfigured` (503), while retained reads and cancellation still work.

#### Scenario: Start several stages

- **GIVEN** a lot with retained notes or ready media
- **WHEN** the operator starts reading, identifying and research for it
- **THEN** three jobs are queued in stage order, identifying depends on the reading attempt and research on the identifying attempt, and the receipt lists the job and attempt IDs.

#### Scenario: Retired lot in the selection

- **GIVEN** a lot that was split or merged before approval
- **WHEN** a start names it, alone or with an active lot
- **THEN** the start fails with `subject_retired` (409) and nothing is queued.

#### Scenario: Replay after a lost response

- **GIVEN** a start already committed with idempotency key K
- **WHEN** the browser resends the same payload with K
- **THEN** the original receipt is returned; resending a changed payload with K fails with `payload_conflict`.

### Requirement: Processing state projection

Job and attempt states SHALL use the vocabulary queued, running, waiting_for_user, waiting_for_login, waiting_for_capacity, ready, failed, cancelled, superseded and interrupted, and every attempt state change SHALL be recorded as a transition. A job's state SHALL follow only its current attempt: settlement of an older attempt MUST NOT change the job's state, and an older attempt MUST NOT become current again because its result arrives last.

#### Scenario: Late result from a replaced attempt

- **GIVEN** a job whose current attempt is attempt 2
- **WHEN** attempt 1 later reports a terminal state
- **THEN** attempt 1's own state is updated, the job keeps attempt 2 as current with its state unchanged, and attempt 1 is never selected again.

### Requirement: Processing actor lane

Single-result attempts SHALL run at most one at a time per actor, through one durable actor lane and the `bench-research` queue with worker and global concurrency 1. A queued attempt SHALL be claimed only while the lane is free, it is still its job's current attempt and its predecessors are ready and current. A queued attempt whose input, dependencies or media are no longer current, or whose batch is archived, SHALL be superseded at claim without running.

#### Scenario: Second attempt waits for the lane

- **GIVEN** one running attempt holding the actor lane
- **WHEN** the worker tries to claim another queued attempt for the same actor
- **THEN** the claim does nothing and the attempt stays queued until the lane is free.

#### Scenario: Input changed before claim

- **GIVEN** a queued attempt whose lot quantity was edited after it was queued
- **WHEN** the worker claims it
- **THEN** the attempt becomes superseded, no runner is started, and the lane stays free.

### Requirement: Processing lane release

The actor lane SHALL be released only by the holding attempt's own terminal envelope or question, or by an explicit interruption after its process has been reaped. Logical cancellation, supersession or subject retirement of a running attempt MUST NOT release the lane, and settling an old attempt MUST NOT release a newer attempt's claim.

#### Scenario: Cancel a running attempt

- **GIVEN** a running attempt holding the lane
- **WHEN** the operator cancels its job
- **THEN** the job and attempt show cancelled, global activity still reports the lane as occupied, and the lane is released only when that attempt's runner sends its terminal envelope or is interrupted after reaping.

#### Scenario: Lot retired while running

- **GIVEN** a running attempt for a lot
- **WHEN** the lot is retired
- **THEN** its proposals stop being current, and the lane stays held until that attempt's exact terminal settlement.

### Requirement: Processing envelope authentication

A runner envelope SHALL be accepted only with the attempt's private channel capability and an exact match of job, command, input digest, profile and handler version; the envelope's content MUST NOT serve as authentication. Envelopes SHALL be schema-valid, at most 32 KiB and carry the attempt's next sequence number. An identical resend of a retained sequence SHALL be adopted as a duplicate, and different bytes at a retained sequence SHALL be refused.

#### Scenario: Wrong capability or binding

- **GIVEN** a running attempt
- **WHEN** an envelope arrives with another attempt's capability, or with the right capability but a different input digest
- **THEN** it is refused with `runner_authentication_failed` (403) or `runner_binding_mismatch` (422), and nothing is retained.

#### Scenario: Sequence gap and conflicting duplicate

- **GIVEN** an attempt whose last accepted sequence is 2
- **WHEN** it sends sequence 4, or a different payload with sequence 2
- **THEN** sequence 4 is refused with `runner_sequence_conflict` and the changed sequence 2 with `payload_conflict`; an identical sequence 2 returns `duplicate`.

#### Scenario: Proposal citing an unsealed source

- **GIVEN** a running attempt
- **WHEN** its proposal cites a note, evidence version or receipt that is not in its sealed input and retained scope
- **THEN** the envelope is refused and no proposal is published.

### Requirement: Processing stale output retention

An authenticated envelope that arrives when its attempt is no longer current or running, or when its input, dependencies or media are no longer current, SHALL be retained with disposition `stale` and SHALL NOT create a current proposal or question. A stale question or terminal SHALL still end that attempt's command and release its lane; a stale proposal SHALL NOT.

#### Scenario: Proposal after cancellation

- **GIVEN** a cancelled attempt whose runner is still running
- **WHEN** the runner sends a proposal and then a terminal
- **THEN** both are retained as stale and inspectable, no current proposal appears, and the lane is released only by the terminal.

### Requirement: Processing questions end the command

An accepted question SHALL be retained as an open question bound to its attempt and input, and SHALL move the attempt and job to `waiting_for_user` and release the actor lane. No worker, lane or importer lock SHALL be held while a person answers.

#### Scenario: Question releases the lane

- **GIVEN** a running reading attempt that cannot determine a count
- **WHEN** it asks a quantity question
- **THEN** the question appears as open, the job shows waiting_for_user, and the next queued attempt for the actor can be claimed.

### Requirement: Processing answer continuation

An answer SHALL name the question's current revision, attempt, input digest and expected capture revision, with a typed value matching the question's kind and subject. One transaction SHALL apply the human capture edit, record the immutable answer, and queue a continuation attempt with a new input, command and outbox row, re-queuing dependent stages and publishing events last.

#### Scenario: Atomic continuation

- **GIVEN** an answer whose capture edit succeeds but whose final event cannot be published
- **WHEN** the transaction commits
- **THEN** it rolls back as a whole, leaving no answer, edit or continuation.

#### Scenario: Quantity answer

- **GIVEN** an open quantity question on a waiting attempt
- **WHEN** the operator answers 12 with the current revisions
- **THEN** the lot's counted quantity becomes 12 through the capture edit path, a continuation attempt is queued with a new input that names the answer, and the receipt returns the answer, attempt, command and capture revision.

#### Scenario: Question no longer current

- **GIVEN** a question whose attempt was superseded, whose input changed, or whose revision moved on
- **WHEN** the operator submits an answer
- **THEN** it fails with `stale_question` (412) and a refresh recovery, the message says the unsaved answer has been kept, and no capture edit or continuation is recorded.

#### Scenario: Redelivery after a lost commit acknowledgement

- **GIVEN** an answer that committed but whose response was lost
- **WHEN** the browser resubmits the same answer, with the same or a fresh idempotency key
- **THEN** the original continuation is returned and no second answer, edit or attempt is created; a changed value fails with `payload_conflict`.

### Requirement: Processing proposals grant no human authority

Proposals SHALL remain suggestions: they MUST NOT select human values, write capture or approve effects, and only the human answer path or an explicit human edit SHALL change capture. A quantity estimate SHALL be accepted only for a lot subject, and tag suggestions only when the sealed input carries the server-derived Auto tags request; a proposal citing that request as a source SHALL be refused.

#### Scenario: Tag suggestions without the request

- **GIVEN** an input sealed without the Auto tags request
- **WHEN** the runner proposes tags
- **THEN** the proposal is refused with `auto_tags_not_requested`.

### Requirement: Processing exact predecessor lineage

Stage dependencies SHALL reference exact predecessor attempts in the same batch that advance through the stage order reading, identifying, research, images, inventory. A replaced, cancelled, interrupted or inconsistently projected predecessor SHALL make its consumers noncurrent transitively, a corrupt or missing retained edge SHALL be refused rather than treated as no dependency, and no read or settlement SHALL redirect an old predecessor ID to its replacement.

#### Scenario: Predecessor replaced while a consumer runs

- **GIVEN** a running research attempt that depends on a ready identifying attempt
- **WHEN** identifying is queued again
- **THEN** the research output becomes stale, its lane stays held until its own terminal, and the new identifying attempt is not substituted into its dependencies.

#### Scenario: Cancelled ancestor

- **GIVEN** queued images and inventory attempts descending from a reading attempt
- **WHEN** that reading job is cancelled
- **THEN** the queued descendants are no longer current and are superseded at claim without occupying the lane.

### Requirement: Processing input currentness

A single-result attempt's input SHALL stay current only while its own subject, its linked Part, their selected media and notes, and, for restricted research, its admitted source URLs still match the sealed input; changes to unrelated subjects SHALL NOT affect it. A retired subject, pending media, exceeded media input capacity or an unsupported create choice SHALL make the input noncurrent and expose a safe blocker without hiding the attempt's history or held lane.

#### Scenario: Unrelated lot edited

- **GIVEN** a queued attempt for lot A
- **WHEN** the operator edits unrelated lot B
- **THEN** lot A's attempt stays current and can be claimed.

#### Scenario: Media still decoding

- **GIVEN** an attempt whose subject gained an evidence version that is not yet ready
- **WHEN** Processing is read
- **THEN** the attempt is shown noncurrent with the `media_not_ready` blocker, and its retained history stays listed.

### Requirement: Processing cancellation

Cancelling SHALL require an idempotency key, the job's expected revision and its current attempt, and SHALL succeed only for a non-archived batch whose current attempt is queued, running, waiting for the user, login or capacity, or interrupted. It SHALL mark that attempt and job cancelled and supersede the job's other nonterminal attempts and open questions.

#### Scenario: Stale cancellation

- **GIVEN** a job whose revision moved on after the browser loaded it
- **WHEN** the operator cancels with the old revision
- **THEN** the request fails with `stale_attempt` (412) and a refresh recovery, and nothing changes.

#### Scenario: Cancel a finished attempt

- **GIVEN** a job whose current attempt is ready
- **WHEN** the operator cancels it
- **THEN** the request fails with `attempt_terminal`.

### Requirement: Processing durable command dispatch

Each attempt's command and outbox row SHALL commit with the domain change that created it, and a dispatcher SHALL deliver eligible rows to DBOS under the stable workflow ID `processing:<attempt id>` with the handler version as application version. An existing workflow SHALL be acknowledged only if its identity, queue, version and complete arguments equal the retained command, and the worker SHALL recheck its handler version, payload, profile and channel binding at claim.

#### Scenario: Bounded eligible delivery

- **GIVEN** more than ten queued current attempts with ready predecessors for the configured actor, target and context
- **WHEN** the dispatcher runs once
- **THEN** it delivers the ten oldest commands, and attempts that are not current, have unready predecessors, or belong to another handler or scope are not delivered.

#### Scenario: Redelivery of the same command

- **GIVEN** a command whose DBOS workflow was enqueued but whose acknowledgement was lost
- **WHEN** the dispatcher delivers it again
- **THEN** the existing workflow is compared argument by argument, found equal and acknowledged, and no second workflow starts.

#### Scenario: Conflicting existing workflow

- **GIVEN** an existing workflow with the same ID but a different application version or arguments
- **WHEN** the dispatcher delivers the command
- **THEN** the outbox row records a durable `version_conflict` or `payload_conflict`, leaves the eligible set and is not retried, and unrelated eligible rows are still delivered.

#### Scenario: Retained command from an older handler

- **GIVEN** a queued attempt whose retained command names an earlier handler version
- **WHEN** a newer worker runs
- **THEN** the command is not executed under the newer build, the attempt shows the `worker_version_conflict` blocker, and an explicit fresh attempt is needed.

### Requirement: Processing interruption without revival

If a runner throws or returns without a terminal envelope, the attempt SHALL become interrupted and release the lane only after the runner has returned. A restart MUST NOT revive a claimed session, a native permission callback or an old attempt; new work SHALL require an explicit fresh attempt. An unconfirmed child reap SHALL fail with `research_reap_unconfirmed` and keep the lane held.

#### Scenario: Worker killed during a claimed attempt

- **GIVEN** a claimed attempt whose worker process is killed
- **WHEN** DBOS recovers the workflow on restart
- **THEN** the claim is refused because the attempt is no longer queued, no runner starts again, and the operator must queue a fresh attempt after the old process is confirmed gone and interrupted.
