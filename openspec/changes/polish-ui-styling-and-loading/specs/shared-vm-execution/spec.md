## ADDED Requirements

### Requirement: Read-only provider sign-in status

The intake server SHALL be able to read each VM provider's sign-in status without the management key: whether a Claude subscription token is stored (with its revision, and its save time where recorded), and whether Codex has a committed ChatGPT account or a sign-in in progress. The answer SHALL carry no token, account identifier, key or pairing material.

#### Scenario: Status without the key

- **GIVEN** a paired agent VM with a saved Claude token and Codex signed out
- **WHEN** the server reads provider status
- **THEN** it reports Claude saved with its revision and time, and Codex not signed in, and the response holds no token or account detail.

#### Scenario: VM unreachable

- **GIVEN** the agent VM is stopped or unpaired
- **WHEN** the server reads provider status
- **THEN** it reports the VM as unreachable rather than any provider as signed out.

### Requirement: Status reads never change the guest

The status read SHALL reach the guest through a bounded, read-only capability, never through the management actions. A guest without the capability, a busy guest or a timeout SHALL read as unknown, not signed out.

#### Scenario: Older guest

- **GIVEN** a paired guest image without the status capability
- **WHEN** the server reads provider status
- **THEN** it reports the status as unknown with the reason, and changes nothing on the guest.

#### Scenario: Reading leaves sign-in untouched

- **GIVEN** a Codex device sign-in that has expired but not been cancelled
- **WHEN** the server reads provider status
- **THEN** it reports the sign-in state without cancelling, completing or otherwise changing the login.
