# Capability delta

## MODIFIED Requirements

### Requirement: Scoped guest execution and tool access

The guest SHALL provide a distinct working directory per session, shell, script execution, readable images and PDFs, and a clean browser profile. Only authenticated attempt-scoped bridge operations SHALL reach application data. The deployed network policy SHALL restrict private destinations and host mounts independently of provider configuration. A session's only network route SHALL be its turn's egress proxy, which allows the selected provider's hosts and, only when the attempt was sealed with public web access, public destinations. Jobs running as the same guest user share a trust domain and may read files or credentials accessible to that user.

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

## ADDED Requirements

### Requirement: Claude VM tool surface

A Claude `shared-vm-agent/3` session SHALL be admitted only when it reports exactly `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `TodoWrite`, `WebSearch` and `WebFetch` plus the app's MCP tools, with no slash commands, setting sources or other MCP servers. Using any other tool SHALL end the turn with `agent_tool_refused`.

#### Scenario: Claude session admitted

- **GIVEN** a Claude VM tool session whose CLI reports exactly the listed tools and the app's MCP server
- **WHEN** admission runs
- **THEN** the turn starts, and a `WebSearch`, `WebFetch`, `Glob`, `Grep` or `TodoWrite` call doesn't end it

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

With public web access on, the proxy SHALL allow a `CONNECT` only to port 443 of a lowercase DNS name with an alphabetic final label and no private suffix (`.localhost`, `.internal`, `.local`, `.lan`, `.arpa`, `.onion`, `.test`, `.invalid`). Every DNS answer SHALL be a public unicast address, and the proxy SHALL connect to one it checked. Refusals SHALL name their reason: `destination_refused`, `protected_destination`, `not_public` or `resolution_failed`.

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
- **THEN** neither name blocks public access, and connections to them are still refused as `not_public`

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
