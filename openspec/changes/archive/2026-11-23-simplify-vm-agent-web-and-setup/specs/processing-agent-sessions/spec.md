# Capability delta

## ADDED Requirements

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
