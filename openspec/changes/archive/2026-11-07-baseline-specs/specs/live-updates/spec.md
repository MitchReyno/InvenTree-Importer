# Live updates

## Purpose

Tell open browsers promptly that retained batch state has changed, through a bounded same-origin WebSocket that carries only commit-ordered cursor hints, so clients refetch authoritative snapshots instead of trusting pushed payloads, and fall back to polling whenever the channel is unavailable.

## ADDED Requirements

### Requirement: Live authorized channel

The web process SHALL serve the `bench-intake-live/1` WebSocket at `/api/v1/live` only to same-origin clients of a configured server, with at most eight connections. Each socket MUST authorize itself with one text `subscribe` frame carrying the current bootstrap CSRF token within five seconds; the token never appears in the URL.

#### Scenario: Valid subscription

- **GIVEN** a configured server and a same-origin socket
- **WHEN** the client sends `subscribe` with the current CSRF token, an optional batch ID and its retained cursors
- **THEN** the server replies with a `ready` frame listing the current cursor for each scoped stream.

#### Scenario: Refused subscription

- **GIVEN** an open socket
- **WHEN** it sends a wrong CSRF token or duplicate stream cursors, sends no subscription within five seconds, or sends a binary or second frame
- **THEN** the server closes it with code 1008.

#### Scenario: Protocol mismatch

- **GIVEN** an open socket
- **WHEN** the subscription names another protocol version such as `bench-intake-live/0`
- **THEN** the server closes it with code 1002 so the client can require a reload.

#### Scenario: Refused upgrade

- **GIVEN** a different Origin, a server in `setup_required`, or eight open connections
- **WHEN** a client requests the upgrade
- **THEN** it receives HTTP 403 `live_unavailable`.

### Requirement: Live commit-ordered cursor hints

Each `changed` frame SHALL carry only the batch ID, stream ID, the stream's committed head sequence as an exact decimal string, and a `reset` flag. Hints SHALL reflect only committed events read in a repeatable-read, read-only transaction, and MUST NOT carry event payloads, domain data or commands.

#### Scenario: Committed edit

- **GIVEN** a subscribed client
- **WHEN** a Capture edit commits
- **THEN** the client receives a `changed` frame whose sequence equals the edit response's cursor, with `reset: false` and no payload.

#### Scenario: Uncommitted event

- **GIVEN** a transaction that has appended an event but not committed
- **WHEN** the projection is read
- **THEN** it still reports the previous head, and reports the new head only after commit.

#### Scenario: Sequence beyond JavaScript precision

- **GIVEN** a stream head of `9007199254740992`
- **WHEN** one more event commits
- **THEN** the hint reports exactly `9007199254740993`.

### Requirement: Live reset on gaps

The server SHALL set `reset: true` for a stream when the client's cursor is unknown, ahead of the committed head, more than 128 events behind, or when the retained events between the cursor and the head are not contiguous. A reset tells the client to reload a complete snapshot rather than rely on an incomplete event tail.

#### Scenario: Cursor too far behind or ahead

- **GIVEN** a client cursor more than 128 events behind the head, or a cursor greater than the head
- **WHEN** the projection is read
- **THEN** that stream's hint has `reset: true`.

### Requirement: Live scope and stream limit

The projection SHALL include only batches of the configured actor, target and context, ordering the subscribed batch first and then the most recently updated, and SHALL track at most 100 streams, flagging `truncated` in the `ready` frame when more exist. A subscribed batch outside that scope, or a rotated target context, MUST end the subscription.

#### Scenario: Foreign scope

- **GIVEN** a projection read for a different actor
- **WHEN** it lists streams or names a batch of the configured actor
- **THEN** it returns no streams, or fails with `live_batch_unavailable` for the named batch.

#### Scenario: Target context rotated

- **GIVEN** an open subscription
- **WHEN** the configured target context is no longer current
- **THEN** the projection fails with `live_context_changed` and the server closes the socket with code 1012.

### Requirement: Live projection only

The live channel SHALL be a projection service: it MUST NOT receive an inventory transport or command closure, accept command frames, or dispatch any approval, answer, cancellation or edit. Reconnecting MUST NOT submit any command.

#### Scenario: Command frame

- **GIVEN** an open socket
- **WHEN** it sends `{"type":"cancel","run_id":…}`
- **THEN** the server closes it with code 1008 and the owned fake target records no POST.

### Requirement: Live connection bounds

The server SHALL bound each connection's liveness, lifetime, input size and send queue, and SHALL terminate every open socket at shutdown.

#### Scenario: Oversized input

- **GIVEN** an open subscribed socket
- **WHEN** it sends 16,385 bytes
- **THEN** the server closes it with a non-normal close code and no target effect occurs.

#### Scenario: Slow peer

- **GIVEN** a peer whose buffered bytes plus the next frame exceed 64 KiB
- **WHEN** the server sends a frame
- **THEN** it terminates the peer instead of buffering more.

#### Scenario: Heartbeat and lifetime

- **GIVEN** an open subscription
- **WHEN** time passes
- **THEN** the server re-reads it about once a second, sends a heartbeat frame and ping every ten seconds, terminates a peer that missed the previous pong, and closes the connection after five minutes with code 1012.

### Requirement: Live events committed with domain changes

Domain transactions that change retained batch state (Capture edits and manual dispatch, cancellation and run decisions) SHALL append their stream event in the same transaction, holding the stream-head lock until commit, so event order follows commit order and a rolled-back change publishes nothing. Batch snapshots SHALL return their stream cursor from the same repeatable-read view as the state.

#### Scenario: Snapshot then hint

- **GIVEN** a client that read a batch snapshot with cursor `n`
- **WHEN** it subscribes with that cursor and a later edit commits
- **THEN** it receives a hint for `n + 1` without a reset.

### Requirement: Live client reconciliation and polling fallback

The browser SHALL pause routine polling while the channel is live and refetch retained reads after each hint, and SHALL fall back to polling and reconnect whenever the channel fails. Unsaved drafts, pinned identities and command keys MUST be preserved.

#### Scenario: Disconnect while editing

- **GIVEN** a live client with an unsaved draft
- **WHEN** the socket closes
- **THEN** routine polling resumes, the draft remains, and reconnecting sends only a new subscription.

#### Scenario: Invalid or regressing frame

- **GIVEN** a live client
- **WHEN** a frame fails validation, repeats a stream cursor, regresses a sequence, or the server closes with 1002
- **THEN** the client stops reconnecting, reports that an application update is required, asks the operator to save or discard unsaved work before reloading, and sends no command.

#### Scenario: Hint during the initial read

- **GIVEN** an initial snapshot read still in flight
- **WHEN** a hint arrives
- **THEN** the client cancels and repeats the read so the older late result is not adopted.

#### Scenario: Polling intervals

- **GIVEN** a live channel
- **WHEN** it is healthy, truncated or unavailable
- **THEN** routine polling is paused, runs every fifteen seconds, or runs every two seconds respectively, and window focus or network recovery also refetches retained reads.

#### Scenario: Reconnect

- **GIVEN** a socket that closes, goes thirty seconds without a frame or cannot connect
- **WHEN** the client recovers
- **THEN** it refreshes bootstrap authorization and reconnects with exponential backoff capped at thirty seconds plus jitter.

### Requirement: Live unverifiable workspace state

When a manual review or Processing workspace cannot refresh its retained state, it SHALL keep showing the last retained snapshot, say that status is unavailable and disable its commands until a read succeeds. Unsaved input MUST be kept.

#### Scenario: Read fails after disconnect

- **GIVEN** the manual review workspace is open and its next read fails or is paused offline
- **WHEN** it renders
- **THEN** it shows "Status unavailable. Showing the last retained snapshot; commands are disabled until the application can verify current state." and its commands are disabled.

#### Scenario: Processing read fails with an unsaved answer

- **GIVEN** a Processing workspace with a typed but unsaved answer
- **WHEN** a refresh fails
- **THEN** it shows "Processing status unavailable", disables queue, cancel and answer actions while keeping the typed value, and re-enables them after the next successful read.
