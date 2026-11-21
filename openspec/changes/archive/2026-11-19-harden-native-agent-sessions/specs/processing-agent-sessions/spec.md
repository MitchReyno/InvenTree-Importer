## MODIFIED Requirements

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

## ADDED Requirements

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
