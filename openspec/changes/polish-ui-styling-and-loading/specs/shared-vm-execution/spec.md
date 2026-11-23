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

Each provider's status read SHALL reach that provider's credential process through a status-only endpoint, on a private listener reachable only through the paired relay, needing no management key and offering no mutating action. A provider whose service is missing, older, busy or times out SHALL read as unknown, independently of the other, never as signed out.

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

- **GIVEN** a guest store that recorded a save time, rolled back to an older guest image which then replaces the token
- **WHEN** the store is opened again by the newer image
- **THEN** it opens, the replaced token works, and no save time is shown, because the recorded time belongs to an older revision.

#### Scenario: Not reachable from the browser

- **GIVEN** the browser-facing management listener
- **WHEN** a request is sent through it to a status-only path
- **THEN** it is refused, and only the paired relay reaches the status endpoints.
