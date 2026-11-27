# shared-vm-execution Specification

## Purpose
Provide portable single-operator VM execution and credential management for concurrent Bench Intake research sessions.

## Requirements

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

The guest SHALL provide a distinct working directory per session, shell, script execution, readable images and PDFs, and a clean browser profile. Only authenticated attempt-scoped bridge operations SHALL reach application data. The deployed network policy SHALL restrict private destinations and host mounts independently of provider configuration. A `shared-vm-agent/3` tool session's only network route SHALL be its turn's egress proxy, which allows the selected provider's hosts and, only when the attempt was sealed with public web access, public destinations. `shared-vm-agent/1` sessions keep their provider-only egress. Jobs running as the same guest user share a trust domain and may read files or credentials accessible to that user.

#### Scenario: Research a component

- **WHEN** a session sealed with public web access requests authorized evidence, crops the image with its own script and reads a public datasheet through the egress proxy
- **THEN** it can submit a proposal citing the authorized version, while its scoped bridge request for unrelated evidence is refused and host files, PostgreSQL and InvenTree remain inaccessible.

#### Scenario: Attempt to reach protected services

- **WHEN** a guest script tries to reach the host, LAN, tailnet, database, InvenTree, cloud metadata, management interface, or invokes another session's tools using its own capability
- **THEN** network policy or application authorization refuses the operation, including redirected and IPv6 requests, and no retained inventory changes.

#### Scenario: Public web access off

- **GIVEN** an attempt sealed with public web access off
- **WHEN** its session runs `curl` or `WebFetch` against a public site
- **THEN** the egress proxy refuses the connection, and the provider connection keeps working

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

### Requirement: Claude VM tool surface

A Claude `shared-vm-agent/3` session SHALL be admitted only when it reports exactly `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch` and `WebFetch` plus the app's MCP tools, with no slash commands, setting sources or other MCP servers. Using any other tool SHALL end the turn with `agent_tool_refused`.

#### Scenario: Claude session admitted

- **GIVEN** a Claude VM tool session whose CLI reports exactly the listed tools and the app's MCP server
- **WHEN** admission runs
- **THEN** the turn starts, and a `WebSearch`, `WebFetch`, `Glob` or `Grep` call doesn't end it

#### Scenario: Unexpected Claude tool

- **GIVEN** a Claude VM tool session whose CLI reports an extra tool such as `Agent` or `NotebookEdit`
- **WHEN** admission runs
- **THEN** the turn is refused before the opening message is sent

### Requirement: Codex VM tool surface

A Codex `shared-vm-agent/3` session SHALL be admitted only when its effective config has the shell, image viewing and `web_search = "live"`, with code mode, apps, plugins, memories, multi-agent, bundled skills and the request-permissions tool off. Its turns SHALL accept command, file change, image view and `webSearch` items as well as app tool calls.

#### Scenario: Codex search item

- **GIVEN** a Codex VM tool session
- **WHEN** the agent runs a web search
- **THEN** the `webSearch` item is accepted and the turn continues

#### Scenario: Codex feature switched on

- **GIVEN** a Codex VM tool session whose effective config has `features.apps` on, or web search not `live`
- **WHEN** admission runs
- **THEN** the session is refused with `agent_policy_refused`

### Requirement: Host sessions keep no built-in tools

Sessions run directly on the host (`native-agent/*`) SHALL keep no built-in tools and no web search. A VM conversation admitted under an earlier tool surface SHALL NOT be resumed under this one.

#### Scenario: Host session

- **GIVEN** a `native-agent/2` session
- **WHEN** admission runs
- **THEN** its effective config must have web search disabled and no built-in tools, or the session is refused

#### Scenario: Resuming a conversation from the old tool surface

- **GIVEN** a VM conversation admitted before this tool surface
- **WHEN** a turn tries to resume it
- **THEN** the resume is unavailable and the session starts a new conversation

### Requirement: Egress applies the sealed web setting

Each tool turn SHALL apply the public web setting sealed in its attempt. The paired supervisor SHALL hand that setting and the turn's protected hosts to the egress proxy before the provider starts, through a channel the tool worker can't write. Until it does, the proxy SHALL allow only the provider's hosts. An attempt sealed without the setting SHALL run with it off.

#### Scenario: Policy not delivered

- **GIVEN** a tool turn whose supervisor hasn't handed over the policy
- **WHEN** the agent asks for a public host
- **THEN** it is refused, and the provider's own hosts are still allowed

#### Scenario: Worker tries to change the policy

- **GIVEN** a turn sealed with public web access off
- **WHEN** the agent writes to any path it can reach, trying to turn it on
- **THEN** the proxy keeps refusing public hosts

### Requirement: Public destination checks

With public web access on, the proxy SHALL allow a `CONNECT` only to port 443 of a lowercase DNS name with an alphabetic final label and no private suffix (`.localhost`, `.internal`, `.local`, `.lan`, `.arpa`, `.onion`, `.test`, `.invalid`). Every DNS answer SHALL be a public unicast address, and the proxy SHALL connect to one it checked. Refusals SHALL name their reason: `destination_refused`, `protected_destination`, `not_public`, `resolution_failed` or `too_many_connections`.

#### Scenario: Public datasheet

- **GIVEN** a turn sealed with public web access on
- **WHEN** the agent runs `curl https://www.ti.com/lit/ds/symlink/lm358.pdf`
- **THEN** the proxy allows the connection to a checked public address and the PDF bytes reach the agent unchanged

#### Scenario: Private answer

- **GIVEN** public web access on, and a host whose DNS answers include a private address
- **WHEN** the agent connects to it
- **THEN** the proxy refuses with `not_public` and opens no upstream connection

#### Scenario: Redirect to a private address

- **GIVEN** public web access on
- **WHEN** a public page redirects to a host that resolves to a tailnet address
- **THEN** the second `CONNECT` is refused with `not_public`

#### Scenario: Port other than 443

- **GIVEN** public web access on
- **WHEN** the agent asks the proxy for `CONNECT example.com:22`
- **THEN** it is refused with `destination_refused`

#### Scenario: More than one reason applies

- **GIVEN** a request that more than one refusal reason applies to at the same moment, such as a failed protected lookup and a full tunnel cap
- **WHEN** the proxy refuses it
- **THEN** the refusal names any one of those reasons, and the request is still refused

### Requirement: Public tunnels are bounded

Each turn's egress SHALL allow at most 32 public tunnels at once, refusing more with `too_many_connections`, and SHALL close a public tunnel that carries no data in either direction for two minutes. Provider tunnels SHALL count toward neither limit; they have a separate bound of 64 open at once. DNS work SHALL have a deadline, so public traffic can't hold up the provider.

#### Scenario: Public tunnels at the cap

- **GIVEN** a turn with 32 public tunnels open
- **WHEN** the agent opens another public tunnel and then a provider tunnel
- **THEN** the public one is refused with `too_many_connections` and the provider one connects

#### Scenario: Idle public tunnel

- **GIVEN** a public tunnel that has carried no data either way for two minutes
- **WHEN** the egress checks it
- **THEN** it closes, while a tunnel still receiving a download stays open

### Requirement: Protected destinations come from the deployment

The coordinator SHALL work out each turn's protected hosts from the deployment's configuration, with no operator setting: the host of each InvenTree origin the app reads or writes, and of the origin the app is served under. An entry MAY be a DNS name or a public IP address. The proxy SHALL refuse a protected name, its subdomains, and any host resolving to a protected address, with `protected_destination`.

#### Scenario: Public InvenTree host

- **GIVEN** `INTAKE_INVENTREE_URL=https://inventory.example.com` resolving to a public address
- **WHEN** the agent connects to `inventory.example.com`, a subdomain of it, or another name sharing its address
- **THEN** the proxy refuses with `protected_destination`

#### Scenario: InvenTree configured by public address

- **GIVEN** the app reads InvenTree at `https://1.1.1.1`
- **WHEN** the agent connects to a public DNS name that resolves to `1.1.1.1`
- **THEN** the proxy refuses with `protected_destination`

#### Scenario: Inventory origin with a trailing dot

- **GIVEN** the app reads InvenTree at `https://inventory.example.com.`
- **WHEN** the turn's protected hosts are worked out
- **THEN** `inventory.example.com` is protected, and the agent can't reach it or a public alias of its address

#### Scenario: Protected origin that can't be represented

- **GIVEN** a configured origin whose host still isn't a DNS name or IP literal after being put in standard form
- **WHEN** the agent worker starts its VM bridge
- **THEN** it refuses with `session_agent_configuration_required`, and no turn is dispatched

#### Scenario: Private-suffix inventory name with a public address

- **GIVEN** the app reads InvenTree at `https://inventory.internal`, which resolves in the guest to a public address
- **WHEN** the agent connects to a public DNS name that resolves to that address
- **THEN** the proxy refuses with `protected_destination`

#### Scenario: App served on the tailnet

- **GIVEN** `pnpm dev` with `INTAKE_DEV_TAILSCALE` on and a tailnet name that resolves publicly
- **WHEN** a VM tool turn starts
- **THEN** that name is among the turn's protected hosts, while the agent worker's own app origin stays loopback

#### Scenario: Origin settings missing for the agent worker

- **GIVEN** VM tool sessions whose agent worker didn't receive the list of protected origins
- **WHEN** the worker starts its VM bridge
- **THEN** it refuses with `session_agent_configuration_required`, and no turn is dispatched

### Requirement: Protected names that don't resolve publicly

A protected name that resolves only to non-public addresses SHALL be skipped, because the public-address check already refuses them. If a remaining protected name doesn't resolve, the proxy SHALL refuse every public host for that turn with `resolution_failed`, while still allowing the provider's hosts.

#### Scenario: Local and tailnet names

- **GIVEN** the app at `http://127.0.0.1:4330` and a tailnet name resolving to `100.64.0.0/10`
- **WHEN** the turn's protected hosts are worked out
- **THEN** neither name blocks public access; a connection to the app's IP literal is refused as `destination_refused`, and one to the tailnet name as `not_public`

#### Scenario: Protected name lookup fails

- **GIVEN** a public protected name whose lookup fails in the guest
- **WHEN** the agent connects to any public host
- **THEN** the proxy refuses with `resolution_failed` and the provider connection keeps working

### Requirement: No separate document reader

The guest SHALL NOT run a long-lived document reader or provide `bench-web`. A tool turn SHALL NOT require a reader socket.

#### Scenario: Fresh guest without a reader

- **GIVEN** a provisioned guest where no reader has ever been started
- **WHEN** a tool turn starts
- **THEN** it runs, and web access depends only on the sealed setting

### Requirement: Guest-staged evidence matches the delivered image

The guest SHALL stage the image a fetch_evidence delivery carries, and record that image's own SHA-256, size and dimensions with it. A staged image whose bytes don't match the delivery's stated digest SHALL be refused before the provider sees it. The cited source reference SHALL remain the original version. On a compatible bridge, the guest SHALL stage a legacy-format reply under the earlier digest rules.

#### Scenario: Script crops a bounded delivery

- **GIVEN** a VM session that fetched a 6144 × 8160 photo, delivered at 1940 × 2576
- **WHEN** a guest script reads the staged local file
- **THEN** the file is the 1940 × 2576 image, its recorded digest matches its bytes, and the scale needed to map back to page-preview pixels is in the result.

#### Scenario: Tampered delivery

- **GIVEN** a delivery whose image bytes don't match its stated delivered digest
- **WHEN** the guest stages it
- **THEN** staging fails with `invalid_evidence_file` and the provider receives no image.

### Requirement: Guest-reported provider error

A guest turn that ends with a provider error SHALL send the provider's error kind, result type and HTTP status with its failure outcome, using the same fixed list as the session failure. In a tool session the provider runs in the tool worker, which passes the error to its supervisor; the supervisor and the host each accept only listed values. A turn settled from the guest journal after a lost connection SHALL settle with its outcome alone.

#### Scenario: Failed provider turn in the guest

- **GIVEN** a VM turn whose Claude result fails with the error kind `invalid_request`
- **WHEN** the guest sends its failure outcome
- **THEN** the host retains `agent_turn_failed` with that provider error kind.

#### Scenario: Unlisted value from the guest

- **GIVEN** a guest frame whose provider error kind is not on the fixed list
- **WHEN** the host settles the turn
- **THEN** the failure is retained with the provider error kind `unknown`.

#### Scenario: Settled from the journal

- **GIVEN** a turn whose connection was lost and whose outcome is read back from the guest journal
- **WHEN** the host settles it
- **THEN** it settles with the journaled outcome and no provider error, as before.

### Requirement: Tool workers negotiate evidence release confirmation

Before dispatching a tool-capable VM turn, the coordinator and guest SHALL negotiate support for confirming release of evidence to the provider. Either peer SHALL refuse dispatch if its counterpart lacks support. Both delivery modes SHALL grant new citation authority only after a matching confirmation on the active turn channel.

#### Scenario: Mixed bridge versions

- **GIVEN** one peer lacks support for release confirmation
- **WHEN** the other peer negotiates a tool-capable VM turn
- **THEN** the provider turn does not start, for either inline or file delivery.

#### Scenario: A compatible bridge carries legacy-format evidence

- **GIVEN** both peers negotiated release confirmation
- **WHEN** the producing coordinator explicitly identifies its response format as legacy and the guest receives a legacy preview without a rendition digest
- **THEN** it stages the preview under the earlier digest rules and confirms only after writing the provider-facing response.


#### Scenario: Missing rendition metadata cannot downgrade a current image

- **GIVEN** the coordinator producing a current-format image labels the private delivery envelope as current using its producer version
- **WHEN** the rendition metadata is missing or malformed, even if page metadata is present
- **THEN** the guest refuses the delivery before exposing the image or confirming release.
- **AND** an image envelope with a missing or unknown format label is refused.
