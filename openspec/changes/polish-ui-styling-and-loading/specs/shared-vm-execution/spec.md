## MODIFIED Requirements

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
- **THEN** the input clears after acknowledgement, reopening shows "Token saved", and the value is absent from read responses, browser persistence, events, logs, traces, app databases, backups and images.

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

Agent Settings SHALL support a runner-owned Codex device-code sign-in. The operator SHALL see the verification URL and temporary user code, polling or receiving status until completion, expiry, cancellation or the sign-in dialog closing. Closing the dialog SHALL first make one final protected poll, which completes a login already approved, then cancel a login still pending, so none is left for the read-only status to report as signing in indefinitely. Browser and application storage SHALL receive no provider access or refresh token.

#### Scenario: Approve from a different device

- **WHEN** the operator starts sign-in for the Pi worker and approves the displayed code on a phone
- **THEN** the matching guest confirms its ChatGPT account and stores the login privately for subsequent Codex sessions without requiring a phone-to-VM loopback callback.

#### Scenario: Denied, expired or stale attempt

- **WHEN** a sign-in is denied, expires, is cancelled or reports completion for a superseded login ID
- **THEN** it cannot mark the selected worker connected or trigger inference or a billing fallback.

#### Scenario: Closing the dialog mid-sign-in

- **GIVEN** a Codex device sign-in in progress in its dialog
- **WHEN** the operator closes the dialog
- **THEN** one final protected poll runs, an approved login is completed, a login still pending is cancelled, and the card then reads the result.

## ADDED Requirements

### Requirement: Read-only provider sign-in status

The intake server SHALL be able to read each VM provider's sign-in status without the management key: whether a Claude subscription token is stored (with its revision, and its save time where recorded), and whether Codex has a committed ChatGPT account or a sign-in in progress. Each known state SHALL say when it was checked. The answer SHALL carry no token, account identifier, key or pairing material.

#### Scenario: Status without the key

- **GIVEN** a paired agent VM with a saved Claude token and Codex signed out
- **WHEN** the server reads provider status
- **THEN** it reports Claude saved with its revision and time, and Codex not signed in, and the response holds no token or account detail.

#### Scenario: VM unreachable

- **GIVEN** the agent VM is stopped or unpaired
- **WHEN** the server reads provider status
- **THEN** it reports the VM as unreachable rather than any provider as signed out.

### Requirement: Status reads never change the guest

Each provider's status read SHALL reach that provider's credential process through a status-only endpoint that accepts only the authenticated paired worker, needs no management key and offers no mutating action. A timed-out read SHALL be abandoned on both sides. A provider whose service is missing, older, busy or times out SHALL read as unknown, independently of the other, never as signed out.

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

- **GIVEN** the browser-facing management listener, or a process in another namespace
- **WHEN** it sends a request to a status-only path
- **THEN** it is refused, and only the authenticated paired worker reaches the status endpoints.

#### Scenario: One provider times out

- **GIVEN** a deployment running both providers, where Codex's credential process doesn't answer
- **WHEN** the server reads provider status
- **THEN** Claude's status is reported, Codex reads as unknown because it timed out, and the abandoned Codex request's own work stops on the guest; only a background Codex check keeps running, until its own timeout.

### Requirement: Codex status answered from the last check

Codex SHALL answer each read at once from its last completed check, with its time and whether a newer one runs. A read SHALL start one background check, never two at once, when there is no result or the last check ended over the freshness window ago; Check again SHALL start one when none runs and the interval since the last start has passed. While a check runs and none has succeeded, Codex SHALL read as unknown because it is checking, never signed out.

#### Scenario: Codex check slower than the read

- **GIVEN** a signed-in Codex whose account check takes longer than the status read's budget
- **WHEN** the server reads provider status before any check has finished, and again after one has
- **THEN** the first read answers within its budget with Codex checking, and the later read reports Codex signed in with the time it was checked.

#### Scenario: Stale result

- **GIVEN** a Codex result whose last check ended longer ago than the freshness window
- **WHEN** several reads arrive together
- **THEN** each reports that result with its time, and exactly one new check starts.

#### Scenario: Check again

- **GIVEN** a fresh Codex result
- **WHEN** the operator chooses Check again, twice in quick succession
- **THEN** each answer comes at once with the last result marked as refreshing, one new check starts, and the second request within the interval starts none.

### Requirement: Codex checks stop and are forgotten

A background Codex check SHALL stop at its own timeout, its account process killed and reaped. A failed check SHALL keep the previous result with its time, or read as unknown when there is none. A sign-in change (a completed, cancelled or expired login, or a sign-out) SHALL stop a running check rather than wait for it, and SHALL discard the last result so the next read checks again.

#### Scenario: A Codex check times out

- **GIVEN** a Codex account check that never answers
- **WHEN** its timeout passes
- **THEN** its account process is gone, and Codex reads as its previous result with that result's time, or as unknown because it timed out when there was none.

#### Scenario: Sign-in change during a check

- **GIVEN** a Codex check in progress
- **WHEN** the operator signs out
- **THEN** the sign-out runs without waiting for the check, the check's result is never reported, and the next read after signing in again checks afresh.
