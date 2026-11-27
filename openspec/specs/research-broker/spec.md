# research-broker Specification

## Purpose

The restricted research broker gives a research session bounded, read-only access to staged evidence, exact server-admitted web sources and exact inventory reads, and retains a receipt for every source it relies on. It serves the `fixture_only` `restricted-research-stub/1` profile (handler `processing/3`, tool profile `restricted-research-tools/1`), is composed explicitly by its caller, and never launches a native provider. Session tools for `native-agent/2`, including `fetch_evidence`, are specified by processing-agent-sessions.

## Requirements

### Requirement: Research broker composition without write authority

The research broker SHALL be built only from an injected semantic inventory reader, the owning media content reader, Processing attempt access and a receipt store, with no apply interface. The protocol adapter SHALL receive only a broker factory and an injected session factory, and MUST NOT receive a database connection, the channel capability or an inventory credential. Building the broker SHALL NOT start a provider or worker.

#### Scenario: Restricted profile selected

- **GIVEN** `INTAKE_PROCESSING_PROFILE=restricted-research-stub/1`
- **WHEN** the web process and the native agent worker start
- **THEN** the web process registers routes only, the native worker refuses the profile with `native_agent_configuration_required`, and no research session is launched.

### Requirement: Research tool vocabulary

A research session SHALL be offered only `read_evidence`, `fetch_source`, `read_source` and `lookup_inventory` through the broker, plus `submit_proposal` and `ask_question`, all in one namespace and bound to the exact thread, turn and call identities. Unknown tools and native permission requests SHALL fail closed without creating an application question, and the host, not the session, SHALL construct each application envelope's identity and sequence.

#### Scenario: Native permission request

- **GIVEN** a running research session
- **WHEN** it sends a native permission request or calls a tool outside the vocabulary
- **THEN** the session fails closed, no application question is created, and nothing is published.

#### Scenario: Foreign call identity

- **GIVEN** a running research session
- **WHEN** a tool call names another thread or turn
- **THEN** the call is refused and the broker performs no read.

### Requirement: Research authority checked on every call

Every broker call SHALL confirm that the attempt's command, input, dependencies, media scope and held actor lane are still current before it does any work and again before it returns, using a read-only transaction that ends before any network request. A source fetch SHALL check again after DNS resolution and before sending. Removing a source admission SHALL make the input noncurrent and block even cached results, while adding an admission SHALL NOT broaden an existing input.

#### Scenario: Source admission revoked mid-session

- **GIVEN** a research session that already fetched an admitted URL
- **WHEN** that URL is removed from the server's admitted sources and the session repeats the call
- **THEN** the cached result is refused, the lane stays held until the attempt's command-ending output, and no current proposal is published.

### Requirement: Research staged evidence reads

`read_evidence` SHALL accept only an evidence version and digest that are members of the attempt's sealed media manifest, and SHALL check the stored bytes' size, SHA-256 and PNG, JPEG or PDF type before returning base64 chunks of at most 96 KiB, within 2 MiB of evidence per session. A foreign version, wrong hash or out-of-range request SHALL be refused before any content read.

#### Scenario: Version from another batch

- **GIVEN** a research session for lot A
- **WHEN** it requests an evidence version that is not in its sealed manifest
- **THEN** the request is refused and no stored bytes are read.

### Requirement: Research inventory reads

`lookup_inventory` SHALL perform only an exact Part or location read by primary key through a closure with no mutation methods or credentials, and SHALL return only the model, primary key and safe label. Searches, stock reads, mutations, raw API paths and catalogue operations SHALL NOT be reachable through it. A failed read SHALL be reported as `research_inventory_unavailable`, never as a successful absence.

#### Scenario: Read fails

- **GIVEN** an inventory transport that errors
- **WHEN** a session looks up a Part
- **THEN** the call fails with `research_inventory_unavailable` and no observation or selection is recorded.

#### Scenario: Wider read requested

- **GIVEN** the capture reader also supports catalogue reads
- **WHEN** the research adapter is asked for anything other than a Part or location by primary key
- **THEN** the read is refused before the transport is called.

### Requirement: Research source admission

A restricted input SHALL seal at most 16 exact, server-admitted source URLs; neither the browser nor the session can add one. Admitted URLs SHALL be http or https, at most 2048 bytes, with no credentials, fragment, non-default port or control characters. Fetching SHALL require one to eight explicitly configured protected origins, and an empty set SHALL refuse every fetch.

#### Scenario: Encoded exfiltration attempt

- **GIVEN** an admitted URL `https://example.test/datasheet`
- **WHEN** a session asks to fetch the same URL with an added query string or credentials
- **THEN** the fetch is refused with `research_source_refused` before any DNS lookup.

### Requirement: Research source fetch controls

A fetch SHALL refuse unless all of at most 16 DNS answers are public unicast addresses that no protected origin resolves to, and SHALL connect to one pinned address keeping the admitted Host and TLS server name. It SHALL send no authentication or cookies, follow no redirect and never retry.

#### Scenario: Response limits

- **GIVEN** an admitted source
- **WHEN** it answers with a status other than 200, a compressed encoding, a type other than `text/html`, `text/plain` or `application/pdf`, a body over 1 MiB, or no complete answer within 5 seconds
- **THEN** the fetch is refused, and cancellation prevents any late send or result.

#### Scenario: Mixed DNS answer

- **GIVEN** an admitted host that resolves to one public and one private address
- **WHEN** a session fetches it
- **THEN** the fetch is refused and no request is sent.

#### Scenario: Redirect response

- **GIVEN** an admitted URL that answers with a redirect
- **WHEN** a session fetches it
- **THEN** the redirect is not followed or retried, and the fetch is refused.

### Requirement: Research receipts

Every web or inventory read SHALL be retained as an immutable receipt of its exact bytes or observation, bound to actor, target, context, batch, attempt, command, input and a host request ID, and verified on every read without repair. An attempt SHALL hold at most 16 receipts and 4 MiB, and public proposals SHALL expose only receipt IDs and digests.

#### Scenario: Receipt from another attempt

- **GIVEN** a proposal citing a receipt retained for a different attempt, command or input
- **WHEN** it is submitted
- **THEN** it is refused, and runtime roles cannot update, delete or truncate any receipt to make it fit.

#### Scenario: Concurrent publications at the budget

- **GIVEN** an attempt with 15 retained receipts
- **WHEN** two fetches try to publish a receipt at the same time
- **THEN** exactly one receipt is retained, the other fails with `research_capacity`, and no partial row remains.

#### Scenario: Corrupted receipt

- **GIVEN** a retained receipt whose bytes no longer match its digest
- **WHEN** it is read for publication or display
- **THEN** the read fails with `research_receipt_corrupt` and the receipt is not repaired.

### Requirement: Research session budgets and duplicate calls

A research session SHALL be limited to 32 tool calls, one call at a time, 256 KiB per frame, 2 MiB of output and 30 seconds. A repeated call with the same call ID and arguments SHALL return the cached result after rechecking authority, without repeating the read or receipt; the same call ID with different arguments SHALL be refused without a second effect. Closing the broker SHALL cancel its lifetime and clear the cache.

#### Scenario: Thirty-third call

- **GIVEN** a session that has made 32 tool calls
- **WHEN** it makes a new call
- **THEN** the call fails with `research_capacity` and no content is read.

### Requirement: Research reap before publication

The adapter SHALL emit an application question or terminal only after confirming that the research session has been closed and reaped. An unconfirmed reap SHALL raise a distinguished error that leaves the actor lane held, and a session SHALL NOT be resumed after a restart; new work requires a fresh attempt.

#### Scenario: Reap not confirmed

- **GIVEN** a research session that cannot be confirmed closed
- **WHEN** it would emit a question
- **THEN** no question or terminal is published and the lane stays held until a known-reaped interruption.
