# Capability delta

## Purpose

Every application-dispatched inventory and download request in a stock import is announced before it is sent and gets a correlated, credential-free outcome. Reads that decide absence are complete or fail. Errors are classified so a failed lookup, unknown write or partial listing is never treated as proof that a record or file is absent.

## ADDED Requirements

### Requirement: Import request announced before dispatch

In an observed command (`import-stock`, `import-run`, and the DigiKey `orders`, `product`, `import-orders` and `supplier-parts` commands), every application-dispatched request SHALL emit `request_started` before it is sent and exactly one correlated terminal event. The CLI SHALL flush each start row to stderr before the call, even without a TTY.

#### Scenario: Whole stock invocation

- **GIVEN** `import-stock --write --plan` against a fake transport
- **WHEN** the import and its post-import plan run
- **THEN** stderr shows a flushed start row before every outbound call, including the plan's reads and downloads, and each start has one matching terminal row

#### Scenario: SDK paths covered

- **GIVEN** an observed import through the pinned SDK
- **WHEN** it performs startup and authentication, CRUD, OPTIONS, barcode lookup, attachment transfer, an SDK-triggered reload, pagination and an external download
- **THEN** each of those requests has its start event before the HTTP call

#### Scenario: Terminal outcome

- **GIVEN** a request that is sent
- **WHEN** it settles
- **THEN** `request_finished` reports `http_received`, `http_error`, `no_response` or `exchange_unknown` with the status, elapsed time and redirect count

#### Scenario: Cancellation before send

- **GIVEN** an observer that sets cancellation when it sees a request start
- **WHEN** that request would be sent
- **THEN** it is not sent, and a `request_cancelled` or `request_finished` event reports `not_dispatched`

#### Scenario: Transport failure

- **GIVEN** a request whose transport raises
- **WHEN** it fails
- **THEN** the terminal event reports `exchange_unknown` without the exception text

### Requirement: Import request outcome layers stay distinct

The observation SHALL report the HTTP exchange separately from SDK decoding and model construction, with decode and model events naming their originating request. A received HTTP success SHALL NOT be reported as a confirmed domain effect.

#### Scenario: Model construction fails after a create

- **GIVEN** a create whose response is received but whose SDK model construction fails
- **WHEN** the events are inspected
- **THEN** the request still shows `http_received` and a separate decode or model event names that request as its origin

#### Scenario: Constructor reload

- **GIVEN** an SDK create that triggers a reload GET
- **WHEN** decoding finishes
- **THEN** the decode event names the reload request that produced it

### Requirement: Import request correlation and sequencing

Each event SHALL carry schema version 1, run, operation, attempt, source, group and request identities, and a unique increasing sequence within its invocation. Event identity SHALL NOT be used as a mutation or idempotency key.

#### Scenario: Overlapping worker requests

- **GIVEN** legacy parameter writes and datasheet downloads running concurrently in their thread pools, one of which fails
- **WHEN** the events are collected
- **THEN** every event has a unique sequence, its own attempt and the source attribution of the line that submitted it

#### Scenario: Durable attempt

- **GIVEN** a request sent inside a durable journal attempt, including from a nested display operation
- **WHEN** its events are emitted
- **THEN** they carry the journal's run, operation, attempt and request IDs

### Requirement: Import request renderer isolation

Observer delivery SHALL be serialized and best effort, so an observer exception is counted and never changes an outcome, replays a request or stops the import. The durable dispatch guard SHALL NOT depend on observer delivery.

#### Scenario: Renderer throws after a confirmed create

- **GIVEN** a renderer that raises on every event
- **WHEN** a create is confirmed
- **THEN** the create is recorded as confirmed and is not sent again

#### Scenario: Journal lost after start delivery

- **GIVEN** a durable attempt whose journal becomes unavailable while the start event is being delivered
- **WHEN** the send would follow
- **THEN** the guard rechecks the journal and ownership and stops the send

### Requirement: Import request redaction

Events, event exports and CLI error output SHALL NOT contain credentials, tokens, authorization headers, bodies, query strings or free-form exception text. Inventory request labels SHALL use allowlisted route nouns and numeric IDs, and other targets SHALL be labelled `[other target]`.

#### Scenario: Authentication failure

- **GIVEN** an SDK authentication error whose response contains a token canary
- **WHEN** the CLI reports it
- **THEN** neither stdout, stderr, logs nor exported events contain the canary, and the output names only the safe failure type

#### Scenario: Debug logging during an import

- **GIVEN** debug logging enabled and token or username-and-password authentication
- **WHEN** an observed import builds its client and sends requests
- **THEN** SDK credential logging was disabled before construction, legacy free-form diagnostics are suppressed, and no token, password, header or payload is logged

#### Scenario: Unobserved library call

- **GIVEN** a library caller that does not opt into observation
- **WHEN** an upload fails
- **THEN** the returned result keeps its original diagnostic reason and exception cause

### Requirement: Import request observation is opt-in for libraries

Library callers SHALL produce no events or progress output unless they enter an `observing()` scope. The CLI SHALL install its plain stderr observer before connecting.

#### Scenario: Quiet library import

- **GIVEN** a library caller running `import_stock` with no observation
- **WHEN** it imports
- **THEN** nothing is written to stdout or stderr and the existing result dataclasses are returned

#### Scenario: Independent clients

- **GIVEN** two clients, only one of them observed
- **WHEN** both send requests
- **THEN** only the observed client's requests appear in its observation

#### Scenario: Offline validation

- **GIVEN** `import-stock --validate`, `--schema` or `--vocabulary`
- **WHEN** it runs
- **THEN** it stays outside the observation and network scope

### Requirement: Import request event export

`import-run --events FILE` SHALL atomically write the invocation's retained events as `invimport-observation/1` JSONL, each record carrying the invocation `stream` ID and its local sequence. These sequences SHALL be separate from the durable journal sequence that `status` reports.

#### Scenario: Renderer missed events

- **GIVEN** a renderer that failed on some events during execution
- **WHEN** the event file is written at the end of the invocation
- **THEN** it contains every retained event in sequence, and the next invocation replaces it with a new stream

#### Scenario: Export path becomes unwritable

- **GIVEN** a completed write whose event destination cannot be written
- **WHEN** the command finishes
- **THEN** the result has `events_saved: false`, the exit code is 1 (130 when cancelled) and no write is replayed

### Requirement: Import error categories

Execution errors SHALL carry one category from `absent`, `validation`, `conflict`, `denied_auth`, `transient`, `transport`, `invalid_response`, `uncertain_write`, `programmer_error` and `local_journal_failure`, plus a lowercase identifier code with no SDK text. Operation state, effect certainty and retry policy SHALL be recorded separately, so state alone never grants a retry.

#### Scenario: Handler raises a raw SDK error

- **GIVEN** a handler that raises an exception carrying response text
- **WHEN** its attempt settles
- **THEN** the journal stores only a safe category and code, never the raw message

#### Scenario: Separate certainty and retry

- **GIVEN** a failed operation
- **WHEN** its result is recorded
- **THEN** it holds a certainty of `none`, `confirmed` or `unknown` and a retry policy of `never`, `read`, `reconcile` or `review` alongside its state

### Requirement: Import barcode lookup classification

Barcode lookup SHALL treat only HTTP 400 with the error exactly `No match found for barcode data` as absence, and SHALL be recorded as a read although it is a POST. Barcode linking SHALL read ownership back and MUST NOT delete stock unless a different stock owner is confirmed.

#### Scenario: Lookup timeout

- **GIVEN** a barcode lookup that times out, is denied or returns malformed or non-stock owner data
- **WHEN** the import continues
- **THEN** it is an error, not absence, and no stock is created for that line

#### Scenario: Link response lost

- **GIVEN** a link request whose response is lost but which did apply
- **WHEN** ownership is read back
- **THEN** the intended owner confirms success and no delete is sent

#### Scenario: Uncertain link

- **GIVEN** a link whose outcome and read-back are both uncertain
- **WHEN** the error is raised
- **THEN** no delete is sent and the error keeps the created stock PK

#### Scenario: Barcode already owned elsewhere

- **GIVEN** a link that fails because another stock item owns the barcode
- **WHEN** ownership is read back
- **THEN** the error names both stock PKs, and only the duplicate this call created is removed

### Requirement: Import complete collection reads

Absence-deciding inventory reads SHALL return a complete collection or raise `DiscoveryError`, never an empty or partial success. Pagination SHALL follow only same-origin, same-API-root links within page and row bounds.

#### Scenario: Match on the second page

- **GIVEN** a matching record that appears only on page 2
- **WHEN** the importer checks for it before creating
- **THEN** it finds the record and does not create a duplicate

#### Scenario: Late page fails

- **GIVEN** a listing whose third page fails
- **WHEN** a parameter absence check runs
- **THEN** it raises and no missing value is created

#### Scenario: Unsafe pagination

- **GIVEN** a foreign or escaping `next` link, a repeated page, a bound exceeded or a malformed row
- **WHEN** the read follows it
- **THEN** the read fails, and a foreign link is refused before dispatch

### Requirement: Import attachment outcomes

Attachment upload SHALL return one of `uploaded`, `already_satisfied`, `failed` or `unknown`, and a failed or malformed listing SHALL block the upload. The legacy boolean and count APIs SHALL keep counting only confirmed new uploads.

#### Scenario: Existing file on page 2

- **GIVEN** an attachment with the same name listed on page 2
- **WHEN** upload is requested
- **THEN** the outcome is `already_satisfied`, no POST is sent and the legacy boolean stays false

#### Scenario: Listing fails

- **GIVEN** an attachment listing that fails on a later page
- **WHEN** upload is requested
- **THEN** the outcome is `failed` and no POST is sent

#### Scenario: Lost upload response

- **GIVEN** an upload whose response is lost
- **WHEN** the outcome is returned
- **THEN** it is `unknown`, while an explicit client rejection is `failed`

### Requirement: Import DigiKey read retries

The DigiKey request loop SHALL be the only transient retry owner for DigiKey reads, with up to 4 observed attempts and capped exponential backoff. It SHALL retry only GETs and POSTs explicitly marked as read-only search.

#### Scenario: Arbitrary POST fails

- **GIVEN** a DigiKey POST that is not a read-only search, or a permanent HTTP failure
- **WHEN** it fails
- **THEN** it is not retried

#### Scenario: Token grant

- **GIVEN** a token request that fails
- **WHEN** the error is reported
- **THEN** exactly one attempt was observed and the error contains no credential or response body

#### Scenario: Cancel during backoff

- **GIVEN** a read waiting to retry after a transient failure
- **WHEN** cancellation is requested
- **THEN** no further attempt or later work is sent
