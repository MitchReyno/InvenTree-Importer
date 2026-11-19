# processing-agent-sessions Specification

## Purpose

Native Claude and Codex agents work in long-lived, resumable sessions. These sessions stream status, proposals and questions to the operator as work proceeds, and accept queued answers, chat and new-evidence notices at any time. They stay inside a narrow, app-owned tool boundary.

## Requirements

### Requirement: Session tool boundary

A `native-agent/2` session SHALL reach the application only through an app-owned tool server scoped to that session. The tool server SHALL offer exactly these tools:

- status
- read_batch, record_observation, propose_lot and regroup (the Examine lead session only)
- propose
- ask
- reply
- fetch_evidence
- read_inbox

The session SHALL have no shell, filesystem, web, arbitrary code execution, collaboration, image generation, arbitrary MCP, inventory-write or approval tools. Codex MAY expose only the previously accepted inert exceptions list_mcp_resources, list_mcp_resource_templates, read_mcp_resource and request_user_input: the intake server SHALL expose no resources and server-initiated requests SHALL be refused. User skill catalogues and deferred callable tools outside this boundary MUST NOT be available.

#### Scenario: Session starts with only app tools

- **GIVEN** a queued `native-agent/2` attempt for Claude or Codex
- **WHEN** the adapter starts the provider session
- **THEN** the adapter admits only a provider version covered by offline full-surface qualification, verifies the required effective configuration and scoped MCP tools before each fresh or resumed turn, and refuses unknown versions or configuration drift. Runtime checks reject forbidden tool events. Offline qualification does not attest the exact tool list of each subscription request.

#### Scenario: Wrapped or deferred tools

- **GIVEN** a provider exposes exec-wrapped intake tools or a deferred advisor tool
- **WHEN** a fresh or resumed turn is admitted
- **THEN** that configuration fails offline qualification or is refused by admission/runtime checks; a runtime refusal does not undo an already executed action. An incomplete init list alone is not qualification evidence.

### Requirement: Session-scoped tool capability

Every tool call SHALL be authenticated with a capability bound to one session, its attempt scope and its batch. Calls with an expired, wrong-scope or other-session capability MUST be refused and MUST NOT change retained state.

#### Scenario: Capability replay from another session

- **GIVEN** a tool call carrying the capability of a different or terminated session
- **WHEN** the tool server receives it
- **THEN** the call is refused with a typed error, and no outbox item, inbox read marker or capture change is recorded.

### Requirement: Lot-forming tools only for the lead session

The record_observation, propose_lot and regroup tools SHALL be refused for any session other than the batch's Examine lead session.

#### Scenario: Lot-forming tool from a lot session

- **GIVEN** a Research session for one lot
- **WHEN** it calls propose_lot
- **THEN** the call is refused with a typed error, and no capture change is recorded.

### Requirement: Streamed status and outbox delivery

A session SHALL be able to emit outbox items at any point while it runs: status lines, evidence observations, lot proposals, regroupings, field proposals, questions and chat replies. Each item SHALL be validated, persisted in order and published to the operator while the session continues. Status lines SHALL form an ordered step timeline for the session.

#### Scenario: Status lines while working

- **GIVEN** a running session
- **WHEN** it emits three status lines and then a proposal
- **THEN** the operator sees the status lines in order with timestamps, the latest one appears as the session's current activity, and the proposal appears without the session ending.

### Requirement: Bounded status lines and delivered citations

A status line SHALL be one line of at most 120 characters, and the server SHALL rate-limit status lines. Proposals and questions SHALL cite only evidence and notes delivered to that session.

#### Scenario: Invalid outbox item

- **GIVEN** a proposal citing an evidence version not delivered to the session, or a status line over 120 characters
- **WHEN** the session submits it
- **THEN** the tool call returns a validation error the agent can correct, and nothing is published.

### Requirement: Queued inbox in every session state

Operator answers, chat messages and new-evidence notices SHALL be accepted and persisted at once, whatever the session is doing. Submitting the same item twice with the same idempotency key SHALL return the original receipt.

#### Scenario: Duplicate answer submission

- **GIVEN** an answer already accepted with idempotency key K
- **WHEN** the browser resubmits it with key K after a lost response
- **THEN** the original receipt is returned and only one inbox item exists.

### Requirement: Inbox delivery to running sessions

A running session SHALL be able to read pending items with read_inbox. Where the provider supports in-turn input, the adapter SHALL also deliver them that way. Delivery SHALL be at least once: each item has a stable ID and sequence, an item counts as delivered only once the session acknowledges its sequence, and unacknowledged items SHALL be redelivered after a lost response or crash. A redelivered item MUST NOT produce a second distinct answer or chat entry.

#### Scenario: Answer while the agent is running

- **GIVEN** a running Examine session that asked a quantity question and continued
- **WHEN** the operator answers it
- **THEN** the answer is recorded immediately, the session receives it on its next read_inbox call or in-turn delivery, and its later proposals cite that answer.

#### Scenario: Crash after delivery, before acknowledgement

- **GIVEN** read_inbox returned an answer, but the worker stopped before the session acknowledged it
- **WHEN** the session is resumed
- **THEN** the answer is delivered again with the same item ID, and the operator still sees exactly one answer.

### Requirement: Resume idle sessions for pending input

When a waiting, paused or finished session has a pending inbox item, the system SHALL schedule a resume of that session's provider conversation with the queued items, within the concurrency limit.

#### Scenario: Chat with a finished session

- **GIVEN** a session that has finished
- **WHEN** the operator sends a chat message
- **THEN** the message is queued, the session's provider conversation is resumed with it, and the agent's reply appears in that session's chat.

#### Scenario: Resume fails

- **GIVEN** a queued inbox item for a finished session whose provider conversation cannot be resumed (for example, a missing transcript or a sign-in failure)
- **WHEN** the resume is attempted
- **THEN** the item stays pending, the session shows a typed waiting-for-login or resume-unavailable state, and the operator can start a fresh session that receives the pending items.

### Requirement: Waiting does not hold capacity

The number of `native-agent/2` sessions actively running provider turns SHALL be limited by a configurable concurrency limit. The default is 3, and it is set in Agent settings. A session that is waiting for input, paused or finished SHALL NOT count against the limit. Queued or resuming sessions SHALL start in queue order as slots free.

#### Scenario: Fourth session queues

- **GIVEN** a concurrency limit of 3 and three running sessions
- **WHEN** a fourth session becomes ready
- **THEN** it shows as queued, and it starts when one of the three finishes or goes to waiting.

### Requirement: Cancellation and recovery

Cancelling a session SHALL abort its active turn and reap its process group before the session releases its slot. An unconfirmed reap SHALL keep the slot occupied and visible. After a worker restart, the system SHALL NOT silently continue a turn that was in flight. Such a session SHALL become interrupted, keep its outbox and pending inbox, and resume only through an explicit operator action or a new pending inbox item.

#### Scenario: Worker restarts mid-turn

- **GIVEN** a running session when the worker stops abruptly
- **WHEN** the worker starts again
- **THEN** the session is shown as interrupted, its delivered status lines and proposals remain, and no provider call is started until a resume is requested or triggered by the inbox.

### Requirement: Correctable proposal validation

A rejected proposal SHALL return a bounded, sanitized field path and reason for contract errors while preserving the existing error code. Invalid proposals MUST NOT publish state. Diagnostics MUST NOT echo submitted values or secrets.

#### Scenario: Correct and retry a malformed proposal

- **GIVEN** a proposal missing a required nested field
- **WHEN** propose is called
- **THEN** the response names that field and the violated rule, permits a corrected retry, and publishes nothing until the corrected proposal passes all validation and authority checks.

### Requirement: Authoritative citations for fetched evidence

A successful fetch_evidence delivery SHALL include the complete source reference accepted by proposal validation, including exact evidence/version identity and authoritative SHA-256. Preview and crop bytes MUST NOT be mistaken for the cited original version's digest. Merely receiving a notice or knowing a digest SHALL NOT establish delivery authority.

#### Scenario: New evidence during a session

- **GIVEN** a same-batch evidence notice delivered after the initial manifest
- **WHEN** the session successfully fetches that version and cites the returned source reference
- **THEN** source validation accepts the delivered reference subject to existing currentness checks.

#### Scenario: Failed or unauthorized fetch

- **GIVEN** a wrong-batch version, failed byte delivery or exhausted budget
- **WHEN** fetch_evidence is attempted
- **THEN** no delivery authority is granted and a subsequent citation is refused; after worker restart evidence must be fetched again under the existing delivery rules.

### Requirement: Categorized failures with diagnostic disclosure

Processing and session history SHALL display a failure category, actionable summary and accessible Show details button. Details SHALL retain safe technical context across reloads, obey session read scope and exclude sensitive data before persistence. Legacy or unknown failures SHALL identify unavailable information without inventing a cause or retry guarantee.

#### Scenario: Operator inspects a failed session

- **GIVEN** a failed provider turn
- **WHEN** the operator opens its Processing view or session-history entry and activates Show details
- **THEN** a readable diagnostic panel opens with category, stage, stable error code, timestamp, session/attempt and correlation IDs, bounded safe causes, provider/model/version when known, and recovery guidance; closing it preserves the current selection and drafts, and disclosure never starts a retry.

#### Scenario: Legacy and unknown failures

- **GIVEN** an older failed session with no retained diagnostics, or an unclassified failure
- **WHEN** its details are opened
- **THEN** the UI shows unavailable legacy details or an Unknown category with the available correlation context, without claiming the failure is retryable.

#### Scenario: Sensitive or cross-session diagnostics

- **GIVEN** an exception containing a secret or a details request outside the caller's scope
- **WHEN** diagnostics are retained or read
- **THEN** credentials, capabilities, connection strings, private paths, raw prompts and evidence payloads are excluded before persistence; debug text and stacks are sanitized and bounded, raw exceptions are never exposed, and unauthorized reads reveal no diagnostic record.

### Requirement: Evidence-based native qualification

The profile SHALL remain native_unverified until the supported provider/model/authentication/CLI-version matrix passes tool confinement, corrected proposals, new-evidence citations, status, chat, resume and cancellation checks. A chat SHALL count as handled only when a causally subsequent reply, question or status addresses the read chat; unrelated activity SHALL NOT pass it. Synthetic tests SHALL NOT establish live qualification.

#### Scenario: Partial qualification

- **GIVEN** one supported configuration fails or has not been exercised
- **WHEN** qualification results are recorded
- **THEN** the profile remains native_unverified and the failed or untested boundary is reported explicitly.

### Requirement: Version-pinned admission assurance

Admission SHALL require a supported executable version with offline full-surface qualification and effective-configuration checks on every fresh or resumed turn. Unknown versions or configuration drift MUST fail closed. Runtime rejection SHALL remain defense in depth. The system MUST NOT claim per-request subscription tool attestation from offline API-key probes.

#### Scenario: Provider upgrade or configuration drift

- **GIVEN** an unqualified CLI version or changed effective confinement settings
- **WHEN** a fresh or resumed turn is requested
- **THEN** it is refused before inference, with configuration or policy failure details, and native_unverified remains until the required live qualification passes.

### Requirement: Legacy conversation compatibility

A provider conversation created before the current admission policy SHALL NOT resume under the new policy. The application SHALL preserve its history and pending input, explain that a fresh conversation is required, and offer an explicit operator action to start a replacement under the current policy. Existing source and input authority checks SHALL still apply.

#### Scenario: Resume a pre-policy conversation

- **GIVEN** a retained session without proof that its provider conversation began under the current admission policy
- **WHEN** a resume is requested or scheduled
- **THEN** no provider turn starts, history and pending inbox items remain available, and the operator can explicitly start a replacement conversation without losing pending input or duplicating accepted effects.
