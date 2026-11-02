# T07 restricted protocol and controlled child

## Prospective plan

Recorded before runtime edits. This bounded owner changes only `research/protocol.ts`, `research/adapter.ts`, `research/child-transport.ts`, the focused protocol/process tests and controlled child fixture, and this handover. The main T07 owner owns the broker, evidence/receipt repositories and Processing integration; the coordinator owns shared contracts/configuration/migrations. Preserve their concurrent work.

Implement an injected App Server-shaped protocol session, not a native provider launcher. The declared subset performs initialize, fresh thread/start and turn/start, then accepts only exact active-thread/turn dynamic calls for the semantic research namespace. Broker calls use a host-generated UUID retained against native call identity and exact payload. Duplicate identical calls reuse the retained response; changed duplicates, foreign identities, unknown methods/tools and native permission/shell/MCP requests fail closed. The host validates proposal/question payloads and constructs V3 envelope binding and monotonic sequence; provider text never becomes authority.

A question or terminal may release the Processing lane. Therefore the adapter closes the broker and confirms session close/reap before emitting either. Nonterminal proposals may be emitted while the lane remains held. Errors, cancellation, deadlines and malformed output also close/reap; an unconfirmed reap remains `ResearchReapPendingError`, never a safe interruption. An explicit later answer creates a new session/attempt rather than resuming a native permission handle.

The controlled transport runs only a caller-injected trusted Node script, with no shell or inherited credential environment. It frames strict JSON, limits each frame/output/time and handles stream backpressure. Close sends termination, escalates only its own child and waits for the actual close event; kill success alone is not reap. No code path selects or launches the personal Codex executable. This child fixture does not establish native tool/credential isolation or multimodal support.

Use the existing strict JSON/runtime contract validators, Node process/stream/crypto primitives, research errors and named limits. Add no packages, second schema vocabulary or workflow engine. Use explicit lifecycle/request helpers rather than compressing the adapter into callbacks. Protocol payload validation remains local and narrow; existing TypeBox schemas validate semantic tool arguments/results and application proposal/question payloads.

## Research and compatibility boundary

Official OpenAI documentation was searched and fetched before local generated-type inspection. The current App Server page describes fresh initialize/thread/turn lifecycle and experimental dynamic-tool calls. Offline generated Codex0.166.0 types establish the investigated `threadId`, `turnId`, `callId`, `namespace`, `tool`, `arguments` and response-content shapes. Their presence is not actual provider acceptance. This implementation intentionally supports a bounded fixture subset and refuses unsupported native operation.

Primary source: [Codex App Server](https://learn.chatgpt.com/docs/app-server). No provider process, account/entitlement request, authentication-store read, actual model call or paid fallback was performed. The original configured InvenTree remains strictly read-only; this subtask sends it no requests.

## Planned verification

Inspect existing Node test/fixture conventions, then test observable boundaries:

- Successful fresh handshake, exact opaque broker result and host-bound proposal/terminal.
- Question is emitted only after confirmed child close; new run receives a fresh thread/turn.
- Duplicate native call identity adopts one result/UUID; changed payload or conflicting wire identity refuses without another broker effect.
- Wrong thread/turn/namespace, unknown tool/request and native permission frames cannot call the broker or become application questions.
- Cancellation, stream end, malformed JSON, partial/oversized output, frame/output/session/request limits and broken writes remain bounded and reap the exact child.
- A deliberately unconfirmed injected close produces the dedicated reap-pending error and no terminal/question.
- Real controlled Node-child tests verify exact close, ignored-TERM escalation, filtered synthetic environment, malformed/oversized framing and short timeouts without PG, Docker, browser, TCP ports or providers.

Run focused tests, server types and owned readability/format/Markdown checks. Root permits these isolated child tests without the shared heavy-service lease; only one bounded child runs per test at a time. Do not acquire or interfere with Claude's current PG/browser window. Request the exclusive Git index before any owned commit.

## Current status

Implemented and frozen for integration. The adapter, protocol guards, controlled transport and deterministic fixtures are complete. Code-intelligence is unavailable; its checks are skipped, not passed. No source outside this subtask is owned, and no shared service or credential was used.

## Prospective review correction plan

Independent review found two blocking gaps after initial integration: the adapter's cached broker reply bypasses the broker's replay currentness check, and an unresolved publication callback can prevent cancellation/deadline cleanup. Record this correction plan before runtime edits.

First add failing offline regressions through the actual broker for revoked inventory and literal-PNG replay, plus stalled-publication tests that observe close before releasing the callback. Retain one host UUID per exact broker call, but replay through `broker.call` so authority is rechecked without repeating reads or receipt publication. Keep semantic proposal acknowledgements separately idempotent.

Make each publication check activity before invoking the callback and bound its wait by the attempt cancellation/deadline. Keep the deadline active through cleanup and final publication, while preserving reap before question/terminal delivery. Cancellation does not undo a callback already started: its result is uncertain, late rejection must be observed, and no later callback may start. Reap independently of the stalled callback. Run focused protocol/child tests, server types and owned lint/format/Markdown checks, then request the index before committing only owned paths. No models, inventory service, PG or shared services are needed.

## Implemented boundaries

The host validates input hashes, semantic arguments/results and proposal/question schemas. It binds each wire call to its exact thread, turn, call ID, namespace, tool and payload. Native IDs remain opaque; receipt request IDs are separate host-generated UUIDs. Cached duplicate calls cannot create another broker effect or change their payload. Extra private broker fields cannot cross the protocol boundary.

Lifecycle helpers close the broker and confirm session cleanup before question or terminal delivery. Cancellation during cleanup suppresses late questions. A stalled or late session factory cannot establish safe cleanup and reports `ResearchReapPendingError`; a session returned later is closed asynchronously. The protocol reader also bounds total frames so a notification flood cannot starve cancellation.

The child transport uses strict UTF-8 NDJSON, bounded frames and combined output, short deadlines and an explicit minimal environment. It closes stdin, signals only its owned child, escalates ignored termination and awaits the actual close event. Successful signal delivery alone never establishes reap. No transport-created temporary files need cleanup.

## Verification evidence

The initial pre-review focused run passed **14/14**, with zero failures or skips: nine injected protocol cases and five real controlled-child cases. It did not catch the two gaps recorded below. Run with:

```sh
pnpm --filter @invimport/intake-server exec tsx --test --test-concurrency=1 \
  tests/research-protocol.test.ts tests/process/research-child.test.ts
```

The tests cover exact opaque identities and host UUIDs, duplicate conflicts, foreign contexts, unsupported native operations, private-result rejection, confirmed reap, unconfirmed-reap retention, cancellation during cleanup and late session construction. Controlled child cases reconstruct literal PNG and PDF artifact bytes and verify their SHA before source-bound proposals. They also check question delivery after close, environment filtering, ignored-TERM escalation, exact PID disappearance, malformed/invalid UTF-8/partial/oversized output, output floods and deadlines.

The first combined run exposed an environment expectation: macOS adds `__CF_USER_TEXT_ENCODING` to the child. The assertion now permits that platform metadata while still proving a synthetic parent canary is absent. The corrected run passed, followed by three additional cleanup/wire regressions and the final 14-case pass.

Server typecheck and targeted runtime readability lint passed. Owned formatting, Markdown and whitespace checks are recorded with the final integration report. These checks used no PG, Docker, browser, fixed port, inventory request or actual model/provider. No owned service or child remains running.

## Qualification limits and remaining integration

This is `restricted-research-stub/1`, qualified only as `fixture_only`. The trusted Node fixture verifies byte transport, protocol binding and process lifecycle; it does not interpret PNG/PDF contents. It does not prove native App Server acceptance, arbitrary-script sandboxing, credential/tool/network isolation or provider multimodal support. Unsupported native methods, notifications and ordering fail closed. Actual provider qualification remains blocked by the user's no-model-usage instruction.

The main T07 owner owns combined Processing/receipt integration; the coordinator owns current-image qualification and fresh independent review. Focused protocol/child results must remain distinct from those broader proofs. Request the exclusive index before staging only this subtask's seven paths.

## Independent review corrections and evidence

Independent reviewers reproduced two blockers on the integrated implementation. Broker-tool duplicates reused an adapter-cached result without passing through the broker's currentness check. Also, an unresolved proposal publication prevented timeout cleanup, and final question/terminal publication ran after the attempt deadline had been cleared.

The correction retains a host UUID with each exact native call. Broker replay now calls the actual broker again with that same UUID; the broker rechecks authority and reuses its own immutable cached result without another external read or receipt publication. Semantic proposal acknowledgement replay remains idempotent. Changed payloads still fail before replay.

Publication now checks activity before invoking a callback and races its wait against the overall attempt signal. That deadline remains active during resource cleanup and final publication. A separate resource signal stops protocol operations without disabling the final publication deadline. Cleanup confirms reap independently of a stalled callback. An already-started publication remains an uncertain effect: cancellation cannot undo it. Its late rejection is observed, the callback is never reused and no later question/terminal callback starts. Question/terminal publication still begins only after confirmed reap.

Behavioral red evidence was recorded before runtime edits: four actual-broker subcases showed missing replay currentness checks, including revoked inventory and literal-PNG results being returned again. Three stalled-publication subcases remained pending beyond 150 ms despite a 30 ms deadline. An initial regression setup error, a missing hash import, was corrected before these behavioral results were recorded.

The corrected focused run passed **24/24**, zero failures/skips, in approximately 4.1 seconds. This includes 17 top-level cases and seven replay/publication subcases. Actual-broker current replays perform one read and at most one receipt publication; revoked replays publish no duplicate response or application envelope. All three stalled proposal/question/terminal waits stop on deadline, and late callback rejection remains handled.

A further actual controlled-child regression exercises both deadline and explicit cancellation while proposal publication stays unresolved. It observes successful physical close before releasing the callback, then proves the already-started callback can still finish without any additional publication. This adds process evidence to the injected-session close markers. It uses only the existing trusted fixture, one child at a time and no services.

After these corrections, server typecheck, targeted adapter readability lint, owned Prettier, handover Markdown and whitespace checks passed. No model/provider/inventory calls or PG/Docker/browser services were used. The coordinator owns combined qualification and fresh reviewer rechecks of the corrected head; the `fixture_only` limitations above remain unchanged.
