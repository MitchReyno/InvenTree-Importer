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

A status line SHALL be one line of at most 120 characters, and the server SHALL rate-limit status lines. Proposals and questions SHALL cite only evidence and notes delivered to that session, except that a proposal MAY cite an agent-reported web page, which is not delivered evidence.

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

A tool-capable VM coordinator SHALL accept `INTAKE_VM_EVIDENCE_IMAGE=preview|original`, defaulting to `preview` for an unset or empty value and rejecting unknown values at startup. In original mode a whole-page fetch of a ready JPEG or PNG SHALL deliver the exact bytes of the authorized version, including embedded metadata, up to the remaining 8 MiB run budget. Both file and inline delivery use those same bytes. Crops and PDF pages use the bounded preview in either mode.

Outside the whole-photo original mode, every image fetch_evidence returns to an agent SHALL be cut from the version's decoded page preview, be at most 2,576 px on its long edge and at most 1.25 MiB encoded. The result SHALL state the delivered width, height and scale relative to the page preview, and the per-run image budget SHALL count the delivered bytes.

#### Scenario: Large original in a lot session

- **GIVEN** preview mode and a lot session whose manifest delivers a 6144 × 8160 photo
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

- **GIVEN** preview mode, an Examine session and a page of any size
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

#### Scenario: Exact photo bytes

- **WHEN** original mode fetches a whole ready photo
- **THEN** its delivered digest matches the pinned version and its scale is 1. If its bytes exceed the remaining budget, only metadata is returned and no new citation is granted.

### Requirement: Structured session questions

The `ask` tool SHALL take one question: its subject, its reason, the fields it affects and 1–4 steps. Each step SHALL carry a prompt, an answer kind (choice, number or text) and the assumption the agent continues with. A choice step SHALL carry 2–6 options, each with a stable ID, a label of up to 80 characters and an optional detail of up to 160, and whether "Something else" is allowed. A number step SHALL be about one live lot.

#### Scenario: Valid choice question

- **GIVEN** a Research session unsure between ATmega328P-AU and ATmega328PB-AU
- **WHEN** it calls ask with one choice step offering both, assuming ATmega328P-AU
- **THEN** the question is stored open, the tool returns its ID, and the session keeps working.

#### Scenario: Invalid structure

- **GIVEN** an ask with duplicate option IDs, an option label over 80 characters, or a step without an assumption
- **WHEN** the tool server validates it
- **THEN** it returns a correctable validation result with issues naming the step and field, and nothing is stored.

### Requirement: Agents ask one thing at a time

The `ask` tool description and the session instructions SHALL tell the agent to ask about one thing per question, to split unrelated questions into separate asks, to use steps only for parts that belong together, and to offer options when the answer is one of a few.

#### Scenario: Instructions reach both providers

- **GIVEN** a Claude or Codex session starting on any processing step
- **WHEN** its tool list and opening instructions are built
- **THEN** both carry the one-question guidance and the `ask` schema with steps.

### Requirement: Stepped answer effects

An answer to a session question SHALL give exactly one value per step, matching that step's kind; a number step MAY carry text instead. One transaction SHALL record the answer and apply its capture effects: a number step sets the lot's quantity, keeping its basis in the answer, and the other steps are saved as one note on the question's subject, each line pairing a step's prompt with its label or text.

#### Scenario: Effects fail together

- **GIVEN** a stepped answer whose quantity edit succeeds but whose note edit is then refused
- **WHEN** the transaction runs
- **THEN** it rolls back as a whole, the lot's quantity is unchanged, the question stays open, and the refusal is reported.

#### Scenario: Note over the limit

- **GIVEN** a stepped answer whose combined note, including a number step answered in words, would exceed the capture note limit
- **WHEN** the server validates it
- **THEN** it is refused as an invalid answer naming the step, before any capture edit.

### Requirement: Stepped answers reach the session

The asking session SHALL receive one `answer` inbox item carrying each step's value, with the option ID for a picked choice, and sessions relying on the affected fields SHALL be told as for any answer. An answer SHALL name the question's current revision, attempt, input digest and expected capture revision, and a repeated submission with the same idempotency key and payload SHALL return the first answer, while a different payload under that key SHALL be refused.

#### Scenario: Choice answer delivered with its option

- **GIVEN** a running session that asked a one-step choice question, with fewer than 20 unread inbox items
- **WHEN** the operator sends the option "ATmega328PB-AU"
- **THEN** a note records the question and "ATmega328PB-AU", and the session's next read_inbox returns the answer with that option's ID.

#### Scenario: Step value of the wrong kind or a missing step

- **GIVEN** an answer that omits a step, names an unknown option ID, or gives a number for a choice step
- **WHEN** the server validates it
- **THEN** it is refused as an invalid answer, and no capture edit, answer or inbox item is recorded.

### Requirement: Photo views are recorded

Each image delivered by `fetch_evidence` SHALL be recorded in the session's history with the evidence, version, page, region, and the delivered size and digest, in the final transaction before the image is returned. A refused or over-budget fetch SHALL NOT be recorded as a view, and an image whose view can't be confirmed as recorded SHALL NOT be returned. A view means the image was prepared for the tool response, not that the provider read it.

#### Scenario: Delivered and refused fetches

- **GIVEN** a session fetches one region successfully and then exceeds its image budget
- **WHEN** its history is read
- **THEN** it holds one photo view, for the delivered region, with the delivered dimensions.

#### Scenario: Commit outcome unknown

- **GIVEN** a fetch whose final transaction loses its commit acknowledgement
- **WHEN** the handler finishes
- **THEN** no image is returned and the budget stays reserved, and a view may exist for the withheld image.

### Requirement: Agent-reported web page sources

A proposal MAY cite a web page by URL in its top-level sources, with an optional title and the time the agent says it read it. The app SHALL show such a source as reported by the agent, with no saved copy, and SHALL NOT treat it as verified evidence. A cited URL SHALL be an absolute `https` or `http` URL of at most 2048 characters.

#### Scenario: Cited datasheet

- **GIVEN** a VM Research session that read a datasheet with WebFetch
- **WHEN** it proposes an identity citing that URL
- **THEN** the proposal is accepted without the URL counting as delivered evidence, its source chip reads "Web page" marked agent-reported, and the session page lists the URL as a web read linked to that proposal.

#### Scenario: Invalid URL

- **GIVEN** a proposal citing `file:///etc/passwd` or a URL over 2048 characters
- **WHEN** the tool server validates it
- **THEN** it returns a correctable validation result naming the source, and nothing is stored.

### Requirement: Lot-forming calls record what they did

Each `propose_lot` outbox item SHALL record its outcome (formed, extended, suggested or unchanged) and any supplied `separation_reason`. Each `regroup` item SHALL record each move's source lot, destination lot and outcome (applied, suggested or unchanged).

#### Scenario: Determining a proposal's outcome

- **WHEN** the server classifies a lot proposal
- **THEN** it considers the label, Part, estimate and memberships applied and suggestions written. Clearing the Re-examine flag alone counts as unchanged.
- **AND** if PostgreSQL cannot store the supplied reason, the call returns a correctable validation result before writing anything.

#### Scenario: Lot kept apart

- **GIVEN** the lead session forms "10 kΩ resistor — packet B" with the separation reason "same MPN as packet A, date code 2407 vs 2341"
- **WHEN** the operator expands its history entry
- **THEN** the entry reads "Formed 10 kΩ resistor — packet B" and shows that reason, while an entry for a call that gave no reason says the reason was not retained.

#### Scenario: Suggestion only

- **GIVEN** an agent lot and an observation the operator placed in another lot
- **WHEN** the lead session extends the agent lot with that observation, and then repeats the call
- **THEN** the first entry reads "Suggested changes to" the lot and the second "Proposed no change to" it, and Capture holds one suggestion.

### Requirement: Status lines stay readable

The session instructions SHALL tell the agent to write status lines in plain words about the item, without internal IDs such as proposal, observation or attempt identifiers.

#### Scenario: Status after proposing

- **GIVEN** a Research session that has just published a proposal
- **WHEN** it reports status
- **THEN** the instructions it received ask for a line such as "Proposed GE S2CN1 diodes as a 1N4148-class switching diode", not "Proposal f067afc5 published".

### Requirement: Configurable VM evidence delivery

Tool-capable VM sessions SHALL support `INTAKE_VM_EVIDENCE_DELIVERY` with values `inline` and `file`. Unset or empty SHALL select `file`; any other value SHALL be refused before launching a turn. The development launcher and standalone relay SHALL forward the selected mode to the tool worker. Routes without VM file tools SHALL retain their existing delivery.

#### Scenario: File delivery

- **GIVEN** a tool-capable Claude or Codex VM session configured for file delivery or with an unset or empty setting
- **WHEN** an authorized image fetch succeeds
- **THEN** the guest applies the digest rules in [Guest-staged evidence matches the delivered image](../../../../specs/shared-vm-execution/spec.md#requirement-guest-staged-evidence-matches-the-delivered-image) and saves the delivered bytes in an owner-only temporary file and returns its path, source and rendition metadata, and instructions to open it with the provider's image/file tool, with no inline image bytes.
- **AND** the file is removed when the turn ends, and the response instructs the agent to fetch again on later turns and cite source metadata rather than the temporary path.

#### Scenario: Inline compatibility

- **GIVEN** a tool-capable VM session with the setting explicitly set to inline
- **WHEN** an image fetch succeeds
- **THEN** its existing inline image and staged-file metadata are returned.

#### Scenario: Refused or unavailable image

- **GIVEN** either delivery mode
- **WHEN** the fetch is refused or returns metadata only
- **THEN** no file is created and the result is unchanged.
- **AND** a digest mismatch or failed file write returns no successful file result.

#### Scenario: Oversized inline image becomes a bounded file result

- **GIVEN** a delivered image whose base64 representation exceeds the Codex frame limit
- **WHEN** file mode stages it
- **THEN** the returned metadata and path fit the existing transport limit without losing the delivered bytes or citation metadata, including across repeated fetches.


#### Scenario: Staging cannot establish a new citation after a failed delivery

- **GIVEN** a tool-capable VM worker fetching a version outside the manifest for the first time, in either delivery mode
- **WHEN** the file write, digest check, provider-facing response write or confirmation of that write fails
- **THEN** a subsequent proposal citing that version is refused even if the prepared photo appears in history.
- **AND** a later confirmed delivery can authorize that version under the existing citation rules; a failed repeat fetch does not revoke an earlier valid delivery.

#### Scenario: Staging a legacy-format preview

- **GIVEN** a pairing that negotiated evidence release confirmation and explicitly identifies the image format as legacy
- **WHEN** the guest stages a legacy preview with page metadata and no delivered digest
- **THEN** it computes the digest of the staged preview and retains the original source citation. For a legacy original it verifies the source digest. A modern rendition with missing or malformed required digest metadata is refused.

### Requirement: Answered questions report their answer and delivery

Within the budget of "Answer summaries fit the snapshot", the Processing read SHALL return, with each answered question, when it was answered, a bounded summary of each step's answer, the answer's capture effects and, for a session question, whether the session has acknowledged the answer in its inbox and when. A read time SHALL come from the acknowledgement that first reached the answer; one acknowledged before read times were kept SHALL be read with no time.

#### Scenario: Waiting, then read

- **GIVEN** an answered `/2` question whose answer is above the session's acknowledgement cursor, in a snapshot whose answers all fit in full
- **WHEN** Processing is read, and read again after the session's read_inbox acknowledges past the answer
- **THEN** the first read gives the answer waiting with no read time, and the second gives it read at that acknowledgement's time.

#### Scenario: Earlier runner question

- **GIVEN** an answered question of an earlier runner profile, in a snapshot whose answers all fit in full
- **WHEN** Processing is read
- **THEN** it carries the answer's time and summary with no inbox delivery, and says whether the history route would serve its job now: no for a job with only runner attempts, yes for a job a later session attempt ran.

### Requirement: Answer summaries fit the snapshot

When the answers would pass the Processing snapshot's size limit, the read SHALL budget them newest first: the full answer while it fits, then its time and delivery with the values marked omitted, then no `answer` member. Every answered question SHALL keep its session-history flag in every tier. A snapshot that is too large even without answer members SHALL fail as an oversized snapshot does today.

#### Scenario: Many answers near the size limit

- **GIVEN** a retained batch near the snapshot's size limit with many answered questions
- **WHEN** Processing is read
- **THEN** the read succeeds, the newest answers carry their summaries, older ones carry only their time and delivery with values omitted, any that still don't fit carry no answer member, and every answered question keeps its session-history flag.

### Requirement: A question can name the one it replaces

An `ask` MAY name an earlier question of the same session that it replaces, while that question is unanswered. The earlier question SHALL close and the Processing read SHALL return which question replaced it.

#### Scenario: Replacing a question

- **GIVEN** an open question asking for a lot's count, which new evidence makes wrong
- **WHEN** the session asks again naming the open question as replaced
- **THEN** the earlier question closes, the read gives the new question as its replacement, and an ask naming an answered question or another session's question is refused as correctable.

### Requirement: Questions carry pictures

An `ask` MAY carry up to 5 figures in the agent's order. Each SHALL name an evidence page delivered to the session, a view (a region of the page, quarter turns and straightening of at most 15°), up to 8 marks (circle, ellipse, box, arrow, highlight or a label of at most 40 characters), a caption of at most 80 characters and why it is shown in at most 200. The app SHALL render each view from the original without changing it, and SHALL NOT burn marks into it.

#### Scenario: Valid figure

- **GIVEN** a Research session that fetched IMG_3020
- **WHEN** it asks with one figure cropping the worn suffix, turned upright, with one box and the label "Worn: B or nothing?"
- **THEN** the question is stored with its figure, and the operator's picture is rendered from the original with the box drawn over it.

#### Scenario: Invalid figure

- **GIVEN** an ask whose figure names evidence never delivered to the session, a page of a delivered PDF that the session was never given, a region outside the page, six figures or nine marks
- **WHEN** the tool server validates it
- **THEN** it returns a correctable result naming the figure and field, and nothing is stored.

### Requirement: Agents preview their pictures

An `ask` with `preview: true` SHALL validate and render its figures with their marks drawn in, return them to the agent within its image budget, and SHALL NOT store or show a question; its renders are temporary. A preview not rendered within its bounded wait SHALL return no images and a result the agent can retry.

#### Scenario: Preview then ask

- **GIVEN** an Examine session preparing a question with two figures
- **WHEN** it calls ask with `preview: true` and then without it
- **THEN** the first call returns both rendered figures with marks, stores no question and tells the operator nothing, and the second stores one question whose pictures match the preview apart from the marks being an overlay.
