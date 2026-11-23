## ADDED Requirements

### Requirement: Read-only provider sign-in status

The intake server SHALL be able to read each VM provider's sign-in status without the management key: whether a Claude subscription token is saved (with its revision and save time), and whether Codex is signed in to a ChatGPT account. It SHALL ask the guest over the existing paired channel, and the answer SHALL carry no token, account identifier or key. Changing a credential SHALL still need the management key.

#### Scenario: Status without the key

- **GIVEN** a paired agent VM with a saved Claude token and Codex signed out
- **WHEN** the server reads provider status
- **THEN** it reports Claude saved with its revision and time, and Codex not signed in, and the response holds no token or account detail.

#### Scenario: VM unreachable

- **GIVEN** the agent VM is stopped or unpaired
- **WHEN** the server reads provider status
- **THEN** it reports the VM as unreachable rather than any provider as signed out.

#### Scenario: Last session outcome

- **GIVEN** the latest Claude session failed with a refused credential after the token was saved
- **WHEN** the server reads provider status
- **THEN** Claude is reported as saved but refused, with the failure time.
