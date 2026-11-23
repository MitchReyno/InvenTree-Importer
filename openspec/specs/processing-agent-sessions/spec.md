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

Processing and session history SHALL display a failure category, an actionable summary and its recovery guidance. The failure summary read SHALL carry the recovery guidance, so showing it needs no details read.

**Show details.** When debug mode is on, they SHALL also offer an accessible Show details button. It reads the details on demand and shows them as a debug-marked panel. With debug mode off, the button and the diagnostic panel SHALL NOT render, and no details read is made.

**Retained details.** Details SHALL retain safe technical context across reloads, obey session read scope and exclude sensitive data before persistence, whatever the debug mode.

**Provider errors.** When a provider ends a turn with a structured error, the details SHALL include the provider's error kind from a fixed list, its result type and HTTP status when it gives them, and never the provider's message text.

**Legacy and unknown failures.** These SHALL identify unavailable information without inventing a cause or retry guarantee.

#### Scenario: Operator inspects a failed session

- **GIVEN** a failed provider turn and debug mode on
- **WHEN** the operator opens its Processing view or session-history entry and activates Show details
- **THEN** a readable diagnostic panel opens with category, stage, stable error code, timestamp, session/attempt and correlation IDs, bounded safe causes, provider/model/version when known, and recovery guidance; closing it preserves the current selection and drafts, and disclosure never starts a retry.

#### Scenario: Failed session with debug mode off

- **GIVEN** a failed provider turn and debug mode off
- **WHEN** the operator opens its Processing view or session-history entry
- **THEN** the category, summary and recovery guidance are shown, no Show details button, error code or ID is present, and no failure details request is sent

#### Scenario: Provider reports why a turn failed

- **GIVEN** debug mode on, and a Claude turn whose assistant message carries the error kind `invalid_request` and whose result type is `error_during_execution` with HTTP status 529, or a Codex turn that fails with `contextWindowExceeded` or with `httpConnectionFailed` and HTTP status 503
- **WHEN** the failure is retained and its details are opened
- **THEN** the panel shows `agent_turn_failed` with the provider error kind, and the result type or HTTP status where given. No provider message text is stored or shown. A Codex error it is retrying does not end the turn, and an expired Claude subscription keeps the kind `authentication_failed` with its login failure; the turn ends at that message, so no result type or status follows it.

#### Scenario: Unrecognized provider error kind

- **GIVEN** a provider error kind, result type or HTTP status outside its fixed list or range
- **WHEN** the failure is retained
- **THEN** each field is checked on its own: an unlisted kind is recorded as `unknown`, an unlisted result type or out-of-range status as null, and a listed value beside them is kept. The unrecognized value is not stored.

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

### Requirement: Part description style delivered to sessions

Each attempt queued after a Part description style is saved SHALL seal the style text itself in its input, and the session SHALL receive it as operator guidance in its opening message. The style SHALL NOT change the profile's digest-verified instruction bytes or relax the existing description validation (one line, at most 250 characters). A later save SHALL NOT change what a queued or running attempt received.

#### Scenario: Style reaches a new session

- **GIVEN** a saved style "Type, key values, package, then variant"
- **WHEN** a Research session for a lot is queued and starts
- **THEN** its opening message contains the style, its sealed input holds the same text, and a proposed description over 250 characters is still rejected with the existing correctable error

#### Scenario: Style changed while queued

- **GIVEN** an attempt queued with style A and waiting for a slot
- **WHEN** the operator saves style B and the attempt then starts
- **THEN** the session receives style A, and only attempts queued after the save receive B

#### Scenario: No style saved

- **GIVEN** no saved style
- **WHEN** a session is queued
- **THEN** its instructions are as they are today

### Requirement: Web tools run under a new VM profile version

VM tool sessions with the web tool surface SHALL run under `shared-vm-agent/3`, a new profile with its own fixed instructions, instruction digest and tool profile version, added without changing `shared-vm-agent/2` or any earlier migration. A worker serving `shared-vm-agent/3` SHALL settle any `shared-vm-agent/2` attempt it finds, queued or requeued by a resume, as failed with `agent_profile_retired`, keeping its history, and SHALL NOT run it under either surface.

#### Scenario: Attempt queued before the upgrade

- **GIVEN** a `shared-vm-agent/2` attempt queued before the upgrade and never started
- **WHEN** the worker now serving `shared-vm-agent/3` claims work
- **THEN** that attempt fails with `agent_profile_retired` and a summary saying to run the step again, and no provider process starts

#### Scenario: Message to a finished session from before the upgrade

- **GIVEN** a finished `shared-vm-agent/2` session with its transcript and proposals
- **WHEN** the operator sends it a message after the upgrade
- **THEN** the requeued attempt fails with `agent_profile_retired` instead of waiting, the session's history and proposals stay, and the message stays pending for a new attempt

#### Scenario: Retained instructions stay valid

- **GIVEN** retained `shared-vm-agent/2` attempts and their sealed instruction digests
- **WHEN** the new profile is added
- **THEN** the `shared-vm-agent/2` profile row and its digest are unchanged, so those attempts still decode and display

### Requirement: Web settings sealed per attempt

Each attempt queued for a profile that gives sessions web access SHALL seal "Allow public web pages" and "Prefer manufacturer datasheets" as read from the saved agent settings, with the settings revision it read. Later saves SHALL NOT change a queued or running attempt. An attempt sealed before these fields existed SHALL run with both off. Attempts for other profiles SHALL seal both as off.

#### Scenario: Save while queued

- **GIVEN** an attempt queued with public web pages on
- **WHEN** the operator turns the setting off before the attempt gets a slot
- **THEN** the attempt still runs with public web access, and only attempts queued after the save run without it

#### Scenario: Attempt from before the change

- **GIVEN** a queued attempt whose sealed input has no web fields
- **WHEN** it runs in the VM
- **THEN** its turn has public web access off

### Requirement: Instructions describe the VM web tools

A VM tool session's fixed instructions SHALL say:

- use search to find sources;
- `WebFetch` returns a summary, so use it to find and skim pages;
- use `curl` for raw pages and documents such as PDF datasheets, where exact values come from;
- cite web facts by URL in the proposal's sources.

Sessions without web tools SHALL receive no web guidance.

#### Scenario: Host session

- **GIVEN** a `native-agent/2` session
- **WHEN** it opens
- **THEN** its instructions and opening message mention no web tools

### Requirement: Opening message carries the session's web settings

A VM tool session's opening message SHALL say whether public web pages are allowed for it, and SHALL add the manufacturer datasheet preference when that setting is on. Neither SHALL change the profile's digest-verified instruction bytes.

#### Scenario: Web on with datasheet preference

- **GIVEN** an attempt sealed with both web settings on
- **WHEN** its session opens
- **THEN** the opening message says public web pages are allowed and to prefer manufacturer datasheets over distributor pages, and the instruction digest is the profile's

#### Scenario: Web off

- **GIVEN** an attempt sealed with public web pages off
- **WHEN** its session opens
- **THEN** the opening message says public web pages are not available and to rely on search results and staged evidence, and a `curl` to a public site is refused by the egress proxy

### Requirement: Bounded agent evidence images

Every image fetch_evidence returns to an agent SHALL be cut from the version's decoded page preview, be at most 2,576 px on its long edge and at most 1.25 MiB encoded. The result SHALL state the delivered width, height and scale relative to the page preview, and the per-run image budget SHALL count the delivered bytes.

#### Scenario: Large original in a lot session

- **GIVEN** a lot session whose manifest delivers a 6144 × 8160 photo
- **WHEN** the agent fetches that evidence without a page or region
- **THEN** it receives a 1940 × 2576 image with its width, height and scale stated. The result's source reference names the original version and its SHA-256, and a proposal citing that reference is accepted.

#### Scenario: Large region of a page

- **GIVEN** an Examine session and a page preview of 6144 × 8160
- **WHEN** the agent requests a region 5000 px wide and 6000 px tall in page-preview pixels
- **THEN** it receives that region scaled to fit within 2,576 px, with the scale stated, and the cited source is the version, not the crop.

#### Scenario: Small region or small page

- **GIVEN** a region, or a lot session's page, no larger than 2,576 px on either side
- **WHEN** the agent fetches it
- **THEN** it receives it at its own size, never enlarged, with scale 1, and a later region request still uses page-preview pixels.

#### Scenario: Examine overview

- **GIVEN** an Examine session and a page of any size
- **WHEN** the agent fetches it without a region
- **THEN** it receives an overview at most 768 px on its long edge, lossless where it fits the size cap, with its scale stated.

#### Scenario: Requested page has no preview

- **GIVEN** a version the session may fetch, whose requested page has no decoded preview
- **WHEN** the agent fetches it
- **THEN** the result refuses with `validation_failed`, grants no delivery authority, and sends no original bytes. Encrypted and undecoded versions never reach a session: a lot manifest refuses them as `media_not_ready` and Examine leaves them out.

#### Scenario: Too large at any quality, or removed meanwhile

- **GIVEN** a cut that exceeds 1.25 MiB even at the lowest JPEG quality, or evidence the operator removes while its preview is read
- **WHEN** the agent fetches it
- **THEN** the result carries metadata only, or refuses with `media_evidence_removed`; no image is sent, the budget is not charged, and no delivery authority is granted.
