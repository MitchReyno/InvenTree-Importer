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

The status read SHALL reach the guest's credential process through a status-only endpoint that is reachable only through the paired relay, needs no management key and offers no mutating action, never through the management actions. A guest without the endpoint, a busy guest or a timeout SHALL read as unknown, not signed out.

#### Scenario: Older guest

- **GIVEN** a paired guest image without the status capability
- **WHEN** the server reads provider status
- **THEN** it reports the status as unknown with the reason, and changes nothing on the guest.

#### Scenario: Reading leaves sign-in untouched

- **GIVEN** a Codex device sign-in that has expired but not been cancelled
- **WHEN** the server reads provider status
- **THEN** it reports the sign-in state without cancelling, completing or otherwise changing the login.

#### Scenario: Before any turn

- **GIVEN** a paired VM that has run no turns, with a Codex sign-in pending
- **WHEN** the server reads provider status
- **THEN** it reports Codex as signing in, and Claude's token as stored or not.

#### Scenario: Older image after an upgrade

- **GIVEN** a guest store that recorded a save time, rolled back to an older guest image
- **WHEN** the older image opens the credential store
- **THEN** it opens, the stored token works as before, and the save time is simply unread.
