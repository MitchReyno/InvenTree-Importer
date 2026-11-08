# Shared VM execution

## Purpose

Provide portable single-operator VM execution and credential management for concurrent Bench Intake research sessions.

## ADDED Requirements

### Requirement: Portable shared VM deployment

A personal deployment SHALL run its trusted services in host Compose and multiple concurrent provider processes in one persistent Linux VM using a distinct Docker engine. Both target hosts SHALL run identical release digests for each ARM64 application and guest image. Persistent data SHALL survive container replacement.

#### Scenario: Upgrade on either machine

- **WHEN** an operator replaces compatible images on the M1 or Pi 5
- **THEN** persisted evidence, session provenance and provider authentication remain usable, and startup reports unavailable infrastructure without modifying retained inventory.

#### Scenario: Deploy on both hosts

- **WHEN** the release is installed on a qualified M1 Mac and 64-bit Raspberry Pi OS on Pi 5
- **THEN** both run the same app and agent digests, and concurrent sessions on either installation share its one guest kernel.

#### Scenario: Missing virtualization or incompatible release

- **WHEN** KVM is unavailable on the Pi or app and runner protocol versions are incompatible
- **THEN** readiness identifies the failure and no session is dispatched to a host CLI.

### Requirement: Scoped guest execution and tool access

The guest SHALL provide a distinct working directory per session, shell, script execution, readable images and PDFs, and a clean browser profile. Only authenticated attempt-scoped bridge operations SHALL reach application data. The deployed network policy SHALL restrict private destinations and host mounts independently of provider configuration. Jobs running as the same guest user share a trust domain and may read files or credentials accessible to that user.

#### Scenario: Research a component

- **WHEN** a session requests authorized evidence, crops the image with its own script and reads a public datasheet
- **THEN** it can submit a proposal citing the authorized version, while its scoped bridge request for unrelated evidence is refused and host files, PostgreSQL and InvenTree remain inaccessible.

#### Scenario: Attempt to reach protected services

- **WHEN** a guest script tries to reach the host, LAN, tailnet, database, InvenTree, cloud metadata, management interface, or invokes another session’s tools using its own capability
- **THEN** network policy or application authorization refuses the operation, including redirected and IPv6 requests, and no retained inventory changes.

### Requirement: Fenced execution lifecycle

Dispatch SHALL be idempotent for an exact attempt and turn. Logical cancellation, lost contact and timeout SHALL preserve the slot until termination is confirmed. Resume SHALL bind to the original session lineage and its sealed identity.

#### Scenario: Connection lost after launch

- **WHEN** the bridge disconnects after process creation and later reconnects
- **THEN** the coordinator reconciles the original execution, avoids duplicate inference and leaves sibling sessions running when cancelling the requested turn.

#### Scenario: Concurrent cancellation and resume

- **WHEN** two sessions run and one is cancelled with a browser subprocess active
- **THEN** its processes are confirmed ended before releasing its slot, its capability is revoked, and the other session continues. A waiting session can resume its own conversation and workspace after a runner container replacement.

#### Scenario: Lost dispatch acknowledgement

- **WHEN** the coordinator reconnects after an acknowledged or possibly started launch
- **THEN** it reconciles the original execution and never automatically repeats an uncertain provider turn; missing trustworthy termination evidence retains the existing interruption workflow.

### Requirement: Personal Claude subscription token

Only the authenticated personal operator SHALL be able to set, replace and remove a masked write-only CLAUDE_CODE_OAUTH_TOKEN in Agent Settings. Reads SHALL expose configuration status only. The credential SHALL be stored privately in the VM and supplied exclusively to Claude subscription execution. Secret material SHALL be excluded from persistent application state, telemetry, error echoes, image layers and client storage.

#### Scenario: Replace or remove a credential

- **WHEN** a revision-checked credential operation is acknowledged by the paired runner
- **THEN** future eligible launches use the new state, the field clears, and stale edits fail without changing the secret.

#### Scenario: Guest unavailable

- **WHEN** the operator submits a token while the paired runner is unreachable
- **THEN** settings report a retryable failure without persisting the payload for later delivery or claiming success.

#### Scenario: Save and reopen

- **WHEN** an authorized operator explicitly saves a token over the protected management connection
- **THEN** the input clears after acknowledgement, reopening shows Configured, and the value is absent from read responses, browser persistence, events, logs, traces, app databases, backups and images.

#### Scenario: Replace or remove safely

- **WHEN** the operator replaces or removes the current credential
- **THEN** future Claude subscription launches use the new state, independent Codex and API-key routes receive no token, and removal prevents new token-backed sessions until reconfigured.

#### Scenario: Management refusal

- **WHEN** the VM is offline, the operator lacks management authority, the write has a stale revision or the request arrives over an unprotected connection
- **THEN** the operation cannot report a successful write, never queues plaintext for later delivery, and reveals no token.

#### Scenario: Expired token

- **WHEN** Claude rejects the supplied credential
- **THEN** the session reports login required with a bounded diagnostic and incurs no automatic retry or switch to API billing.

### Requirement: ChatGPT sign-in for the runner

Agent Settings SHALL support a runner-owned Codex device-code sign-in. The operator SHALL see the verification URL and temporary user code, polling or receiving status until completion, expiry or cancellation. Browser and application storage SHALL receive no provider access or refresh token.

#### Scenario: Approve from a different device

- **WHEN** the operator starts sign-in for the Pi worker and approves the displayed code on a phone
- **THEN** the matching guest confirms its ChatGPT account and stores the login privately for subsequent Codex sessions without requiring a phone-to-VM loopback callback.

#### Scenario: Denied, expired or stale attempt

- **WHEN** a sign-in is denied, expires, is cancelled or reports completion for a superseded login ID
- **THEN** it cannot mark the selected worker connected or trigger inference or a billing fallback.
