# Shared spike fixture and messages

This is the provisional `bench-intake-spike/1` contract for the subscription-runtime, durable-orchestration and importer-adapter investigations. It establishes a shared vocabulary and reproducible input, not production endpoints, an authorization mechanism, a scheduler or an approved import plan.

## Run the offline checks

From the repository root, after `pnpm install --frozen-lockfile` and `uv sync --project backend --locked`:

```sh
pnpm spikes:check
```

The command runs the shared conformance tests using the backend development environment. It needs no model login, database, network service or inventory credentials. The same tests are included in `pnpm test`. JSON Schema validation uses the development-only `jsonschema` dependency; no dependency is added to the shipped importer runtime.

## Common scenario

`fixtures/two-lots/` contains two authored PNG packet illustrations and a one-page PDF receipt, all explicitly synthetic. They describe two physical lots of the same 100 ohm, 5 percent resistor. Lot A contains 10 pieces. Lot B was opened; its label says approximately 20 remain, so the ordered quantity must not be treated as its confirmed current quantity. The drawn resistor icons are illustrations, not a count. Manufacturer and MPN remain unknown.

The first job must raise a question about lot B. The fixture user answers that 20 pieces were counted. A second immutable input revision records that answer, and a new attempt produces one shared Part proposal with two distinct stock contributions. All output still requires manual review and a separately prepared, explicitly approved execution plan.

| File | Purpose |
| --- | --- |
| `input.json` | Original evidence manifest, stable domain IDs, known facts and unresolved count |
| `input-confirmed.json` | New input revision containing the explicit counted answer |
| `messages.jsonl` | Ordered example: request, progress, question, waiting result, answer, resumed request and successful proposal result |
| `outcomes.json` | Separate terminal examples for login, capacity, interruption and failure |
| `expected-stock.json` | Hand-authored expected proposal in the real importer v2 interchange format; never approval |
| `config/` | Minimal offline vocabulary compatible with the existing demo's synthetic resistor category |
| `evidence/` | Two original synthetic PNGs and PDF receipt |

The source namespace is `SPIKE-TWO-LOTS-001`, with immutable contribution IDs `lot-a` and `lot-b` and shared Part ID `resistor-100r`. The expected importer keys are `invimport:SPIKE-TWO-LOTS-001:lot-a` and `invimport:SPIKE-TWO-LOTS-001:lot-b`. Never renumber contributions for retries or later approval rounds. This namespace is fixture-only: do not import these files into a real server.

## Message shape

[message.schema.json](schemas/message.schema.json) is the language-neutral source of truth, using JSON Schema Draft 2020-12 and local `$defs` only. Unknown fields, versions, providers and capabilities are rejected. Each adapter translates its provider/runtime-specific messages into this outer contract; raw provider events are not the contract.

Every message includes `protocol_version`, `type`, `batch_id`, `job_id`, `attempt_id` and `input_revision`. IDs are opaque lowercase identifiers; they are not target PKs or credentials. `input_revision` is the lowercase SHA-256 of the exact input-manifest bytes, not an application counter. The manifest embeds the evidence hashes, so changing an original asset requires a new manifest and revision. Whitespace changes to a manifest intentionally create a different revision.

| Type | Additional fields and meaning |
| --- | --- |
| `job.request` | Stage, explicit provider, immutable `input_ref` and an allowlisted capability set |
| `job.event` | Attempt-local sequence, `started` or `progress`, safe controlled code and optional scope IDs |
| `job.question` | Sequence, durable question ID/revision, kind, affected scope IDs and human-facing prompt |
| `job.answer` | Original question's attempt/input context, question ID/revision, value and authenticated actor reference |
| `job.result` | Sequence and exactly one status-dependent outcome: proposal artifact, outstanding question IDs, or reason code |

`succeeded` requires a proposal artifact and forbids pending questions or error reasons. `waiting_for_user` requires question IDs and forbids a proposal. Login/capacity/failure/interruption require a reason code and cannot masquerade as successful output. A successful research result means that a proposal is available for validation, not that inventory exists or is complete. The answer's value is text; domain validation still has to establish its unit, range and meaning.

Artifact references contain `path`, `sha256` and `media_type`. Paths are restricted relative POSIX names within the staged job bundle; they cannot be URLs, absolute paths or traversal segments. Consumers must still enforce filesystem containment, reject escaping symlinks and verify the bytes before use. Schema shape validation alone cannot prove file ownership or integrity. JSON and JSONL are UTF-8; a wire JSONL stream has one complete JSON object per line. Reject duplicate object keys and non-finite numbers when decoding; schema validation cannot see keys already overwritten by a permissive decoder. Provider token fragments should be assembled before being adapted into a message.

## Correlation and acceptance rules

- The application creates job/attempt identities. A retry of delivery retains the same identity and unchanged decoded payload. A different attempt or input gets a new identity/revision; do not silently reuse an identity with changed arguments.
- Check job, batch, attempt and input revision against the currently authorized attempt before accepting an emitted message. Reject a schema-valid result from an obsolete attempt or input. These checks require application state and are not expressible by validating one JSON object in isolation.
- Sequence numbers start at 1 and increase across events, questions and results within an attempt. `(job_id, attempt_id, sequence)` identifies an emitted message. A redelivery with identical decoded JSON content can be ignored; the same identity with different content is a conflict. Object-key order and transport whitespace are not different content. Do not confuse this sequence with a durable SSE cursor or the importer's invocation-local sequence.
- Persist questions before reporting their IDs. An answer identifies the original question revision and input, and must come from an authorized human action. Record the answer, produce a new input manifest and dispatch a new attempt. Do not answer an obsolete in-memory provider permission request with an application answer.
- Only accept a `succeeded` output after its bytes and domain content validate. The supplied proposal is checked by the actual offline importer parser and validator. The expected fixture is an oracle, not text to reveal to a real agent before testing its result.
- Capabilities are permission requests, not grants merely because the message lists them. There is no inventory-write capability, approval token, target URL, shell command or provider credential field in this contract. Evidence text cannot expand permissions. Human answers authorize planning choices, never mutations.
- Interruption does not prove the absence of side effects. The importer adapter retains the real engine's canonical ownership and uncertainty rules. No generic replay, state-root replacement or new source identity is authorized by any result status.

The checks protect fixture/schema consistency, digest references and real importer compatibility. They do not implement transactional dispatch, stale-result rejection against a database, deduplication, authentication, provider sessions, inventory reconciliation or crash recovery. Each spike must demonstrate those behaviors at its own actual boundary.

## How the parallel spikes consume this

1. The provider spike stages only the selected input manifest and its evidence, changes the request provider to the tested runtime and supplies fresh attempt IDs. It must actually read the PNG/PDF, ask for the current count and return a validated proposal. Keep the expected proposal out of the agent workspace. Account/deployment entitlement is a separate gate; no API-key fallback is implied.
2. The coordinator spike uses the JSONL transcript and outcome examples as a synthetic runner. Exercise duplicate dispatch, changed-payload duplicate IDs, obsolete input/results, question revision conflicts and restart. Prove the application acceptance rules instead of assuming the fixture already implements them.
3. The importer spike uses `expected-stock.json` and the fixture vocabulary with an owned persistent fake target. Its supervisor supplies fake target/config/state bindings; they are intentionally absent from agent messages. First validate offline, then prove frozen approval, start/adopt, partial outcomes and selected recovery. Existing demo setup is a separate owned workspace; copying this fixture does not seed its registry or database automatically.

After these independent investigations, run the combined end-to-end journey. Reconcile message fields based on evidence before promoting the contract to production. Any incompatible change to this version requires a new protocol version and corresponding examples; vendor SDK upgrades alone do not change it.

## Sources and evidence

The schemas follow the [JSON Schema Draft 2020-12 specification](https://json-schema.org/draft/2020-12). The offline validator uses the standard [jsonschema validation API](https://python-jsonschema.readthedocs.io/en/stable/validate/), with no remote schema resolution. The PNGs were authored with Pillow and the PDF with pypdf using a built-in Helvetica font; all are original fictional test assets, without real purchase, vendor or inventory data. The receipt was rendered and visually checked; hashes bind its committed bytes rather than promising that arbitrary PDF generators reproduce identical bytes.
