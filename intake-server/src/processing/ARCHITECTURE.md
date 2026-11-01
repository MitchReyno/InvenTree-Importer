# Processing authority

This module implements durable coordination for the explicit synthetic research fixture. It does not qualify a native provider, personal account entitlement, tool sandbox, OAuth permission gate or actual AI result. T07 owns that later integration. The web process registers routes explicitly and never starts a worker.

## Inputs and attempts

`processing_input` retains canonical `bench-intake-input/1` bytes and SHA-256, exact string values, source/subject lineage, selected human values, notes, dependency attempt IDs and answer identity. Trusted instruction bytes and their digest live in the immutable synthetic profile; the manifest binds that digest and the restricted tool-profile version. Runtime decoders verify both retained-byte integrity and strict shape before treating JSON as a domain type.

A logical job is unique by batch, subject and stage. Its selected attempt is an exact-parent foreign key; a new attempt never rewrites the old input or messages. Stage dependencies reference exact attempts in the same batch and advance through the stage order, preventing dependency cycles. Old dependency IDs never redirect to newer attempts automatically. An accepted human answer creates fresh downstream attempts with an explicit replacement closure in the same transaction.

## Authority and delivery

Browser commands use the existing server-bound development actor/target/context and origin/CSRF checks. Idempotency compares the full normalized payload and retains the original response. The deployment must explicitly configure a persistent private processing-channel secret; no ephemeral fallback is generated. Missing configuration permits retained inspection and cancellation while blocking new starts/answers.

DBOS delivers immutable commands through the existing complete workflow-name/class/config/queue/version/argument comparison. Worker claims recheck the actual build, command bytes, input bytes, profile and current attempt. A durable lane serializes research for the server actor in the synthetic single-owner profile. That is not proof of a real personal provider account binding; T07 must qualify the native account route.

The coordinator authenticates each versioned envelope with a private capability scoped to its attempt. The injected research adapter receives staged input and trusted instructions with a bound result callback; it receives no channel capability, database connection, inventory credential or apply interface. Unknown envelope kinds, wrong parent/context, sequence gaps and conflicting duplicate payloads fail. Authenticated stale messages remain retained but cannot publish a current proposal or question.

## Questions and human edits

A question ends its attempt command and releases the lane. A human answer pins the exact question revision, attempt, input digest and capture revision. Counted/estimated quantity and clarification values remain typed; only the human answer path can update capture selections or append a human note. A proposal cannot choose human values or approve effects.

Answer handling takes capture locks before the lane/job/attempt/question locks, reuses the owning capture edit validation and publishes events last. Answer, human edit, new immutable input, continuation attempt, command, outbox and events commit together. A deferred publication check rolls back an applied capture edit if its final event is omitted. Public capture responses read the cursor after publication. Exact answer redelivery adopts the original continuation, including after a lost commit acknowledgement or a fresh delivery key; changed payload conflicts.

Application questions cannot represent native permission handles. A cancelled/interrupted/superseded attempt never becomes current by replaying an old message. The process fixture reaps its old child before marking its ephemeral callback interrupted and requests a fresh attempt explicitly. No automatic native session resumption is implemented.

## UI and retained display

Processing has Overview, Reading, Identifying, Research, Images and Inventory views under the existing five primary stages. Question forms pin their first exact question/context; polling updates validity without replacing the editing target or resetting dirty input. Global navigation uses the inherited dirty guard. Complete question/proposal payloads are compared with their accepted sealed producer message before display or answering.

Manual notes support standalone T06. Media consumption remains pending the merged T05 owning resolver/pin interface; processing contains no media SQL, decoder or duplicate blob authority. Actual provider sign-in, capacity and interruption are typed outcomes, but fixture outcomes do not establish real provider support.

## Verification and limits

The T06 handover records current PostgreSQL, HTTP, DBOS process, browser and normal-suite evidence separately. The original repository environment's InvenTree server remains strictly read-only. Tests use random owned databases, synthetic identities and explicit fixture workers without loading that environment or constructing a target/provider transport.
