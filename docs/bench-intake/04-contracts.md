# 4. Interfaces and contracts

[Design index](README.md) · Proposed interface examples, not executable endpoints or frozen production schemas.

## Contract strategy

Use reviewed runtime schemas and OpenAPI generation as the HTTP source for generated frontend types, with explicit contract-drift tests. TypeScript interfaces alone are not parsers. Runner envelopes retain their separately versioned strict JSON Schema. Keep database rows and private runner/target data out of browser contracts. The existing `bench-intake-spike/1` is retained unchanged as a conformance/reference input. Introduce a separately named production proposal, `bench-intake-app/1`, only after examples and consuming boundaries are tested; the different name does not claim that the spike schema already provides production authorization.

Configure strict Draft 2020-12 validation for runner messages with unknown-field rejection, no coercion, no default injection and no extra-field stripping. Configure Fastify's parser/validator/serializer explicitly: framework defaults must not silently coerce input, remove unknown fields or serialize private SQL fields. Decode duplicate object keys and invalid/non-finite numbers before ordinary JSON parsing loses them. Preserve exact numeric text; domain integers/revisions/decimal quantities cross JSON as strings, not JavaScript `number`. New plan/input manifests follow the [versioned exact-byte contract](../typescript-data-model/04-execution.md#review-and-frozen-preparation), with retained vectors; hash retained server bytes, not JSONB/browser reserialization.

Version these independently: HTTP API, job envelope, trusted instructions, tool profile, plan schema/executor build, target capability profile and DB schema. A schema-valid message still needs authentication, authorization, dependency freshness, attempt ownership, correct content hashes and domain validation. Browser tabs with incompatible write contracts reload rather than submit a downgraded payload.

## Browser API shape

All paths below are under a proposed `/api/v1` and same-origin authenticated session. Reads authorize the batch/record as well as the user; mutation commands validate origin/CSRF and actor. Resource names are examples to settle during contract review.

| Surface | Operation and response |
| --- | --- |
| Session/access | Supported InvenTree login/callback/logout and local session status; initial bootstrap returns ready, sign-in-required, access-denied or access-unverified before any workspace data. Trusted issuer/owner/client setup is operator-only, not public signup |
| `batches` | Create/list/read/archive; return revision and summary counts |
| `batches/:id/evidence` | Stream bounded upload or create typed note/order-reference evidence; return retained server receipt |
| `evidence/:id/content` | Authorized content/preview download; no storage path or unscoped hash lookup |
| `batches/:id/structure` | Correct lot/Part/evidence relationships with expected revision and impact preview |
| `lots/:id/selections`, `parts/:id/selections` | Explicit typed field edits/default mode with revision checks |
| `batches/:id/defaults` | Update inherited defaults; response identifies affected lots/reviews |
| `batches/:id/process` | Start/reprocess selected jobs with recorded provider/capabilities; returns command/job IDs |
| `questions/:id/answers` | Answer current typed question using its expected revision and attempt/input context |
| `media/:id/recipes` | Create versioned recipe; derivative job returns exact output hash/size/preview |
| `reviews`, `issues/:id/resolutions` | Mark exact scope reviewed or resolve/dismiss current warning with reason |
| `batches/:id/preparations` | Read-only target-backed preparation, asynchronous if slow; return choices or frozen plan preview |
| `preparations/:id/approvals` | Approve exact digest/review binding and selected effects; atomically return immutable approval and command |
| `runs/:id` | Durable operation/effect snapshot, certainty, allowed recovery actions and cursor |
| `runs/:id/cancellation`, `runs/:id/recovery-actions` | Idempotent selected command, never arbitrary handler or raw HTTP request |
| `batches/:id/events` | SSE projection changes with durable cursor; snapshot reset on expired history |
| `settings`, `diagnostics` | Redacted target/runner/config status; secret updates through explicit protected commands |

Commands use an `Idempotency-Key` scoped to actor/action/resource, plus an expected revision such as `If-Match`. A repeated key with a different normalized semantic payload conflicts; a different JSON property order alone is not a different semantic command. Exact manifest/plan hashes remain byte-bound. Return `201` for created resources, `202` for accepted durable work, `409` for idempotency/ownership conflict, `412` for stale preconditions, `422` for domain invalidity, and explicit authentication/authorization errors. Never turn an incomplete target read into a `404` absence decision.

Bootstrap is the only pre-workspace status surface and returns safe capability names, requirements version and retry/sign-out actions, never batch contents or credentials. Missing required rights/scopes is a blocking authorization response; an unavailable/incomplete check is retryable access-unverified, not permission granted or a false missing-rights claim. Every domain route still enforces current session/owner/object authorization; approval, dispatch/resumption and privileged inventory sends recheck effective user rights and delegated scope. InvenTree remains the final authority for its requests; there is no more-privileged service-account fallback. Exact API permission discovery must be qualified without mutation against the deployed server.

## Illustrative approval command

```json
{
  "preparation_id": "prep_example",
  "expected_plan_sha256": "<64 lowercase hex characters>",
  "expected_review_fingerprint": "<64 lowercase hex characters>",
  "selected_lot_ids": ["lot_a"],
  "expected_target_revision": "4"
}
```

Illustrative IDs stand in for validated UUIDs. Actor identity comes from the server session, not an `approved_by` body field. The server rejects a caller-supplied effect list, private filename or target URL. The approval transaction derives the full immutable scope from the stored preparation, checks the request agrees and creates approval/run/initial journal/command/outbox/event together. A successful response means approval was durably accepted, not that stock was created.

## Error and state vocabulary

```text
error:
  code: stable public code
  message: safe human-readable explanation
  resource / field / current_revision: bounded context when appropriate
  recovery: refresh | answer | reauthenticate | wait | review | none
  correlation_id: log lookup, never a credential

operation outcome:
  state + effect_certainty + confirmed_effects + unresolved_attempts
  supported_actions[] with required expected revision
```

Representative codes: `revision_conflict`, `stale_question`, `payload_conflict`, `unsupported_capability`, `login_required`, `access_denied`, `access_unverified`, `capacity_wait`, `target_continuity_required`, `execution_owned`, `uncertain_write`, `retained_blob_missing`, `restore_blocked`. Distinguish application login from provider-runtime sign-in in typed context; one does not grant the other. A public error does not include raw runtime stderr, auth headers, provider prompts or target response bodies. Preserve restricted diagnostic causes server-side with redaction and retention limits.

## Runner command/result boundary

```diagram
Application authority                       Restricted research runner
┌───────────────────────────┐              ┌────────────────────────────┐
│ immutable job input       │── command ──►│ verify input/artifact bytes│
│ job/attempt/revision      │              │ verify route/tool profile  │
│ allowed evidence/tools    │              │ bounded native session     │
│ trusted instruction hash  │◄ envelopes ──│ progress/question/proposal │
└───────────┬───────────────┘              └────────────────────────────┘
            ▼
  strict schema + auth + attempt + freshness + domain + hash acceptance
```

Commands name logical IDs, input manifest/hash, allowed artifact references, selected provider/runtime/skill profile and bounded task instructions. They never carry target write credentials or a generic shell command supplied by the browser. Results are safe typed progress, question, proposal-artifact or explicit terminal state messages. Authenticate the runner identity; the server compares the authorized job/attempt and capabilities, not a claim inside an untrusted result. Enforce message byte limits, sequence monotonicity and payload-bound duplicate handling.

A same-host runner uses a private authenticated Unix socket or bounded local channel. Its schema/authentication still matters because untrusted evidence/provider tools are inside that trust boundary. Remote pairing requires a reviewed short-lived credential lifecycle, TLS, scoped artifact access and stale-owner rejection; it is deferred, not implied by local stdio support. Application questions and native permission handles have different record types and lifetimes.

## Tools: permission vocabulary, not agent discretion

| Tool | Allowed authority |
| --- | --- |
| `read_evidence` | Read only staged job evidence by opaque ID/hash, bounded page/region |
| `search_sources` / `fetch_source` | Approved network fetch broker with SSRF/redirect/size controls and retained source receipts |
| `lookup_inventory` | Typed read operations through a broker constrained to the acting user's delegated authority and read allowlist; no raw credential exposure; endpoint semantics, not HTTP verb alone |
| `propose_media_recipe` | Propose crop/rotation/destination; no original overwrite or inventory upload |
| `submit_proposal` | Typed candidate assertions and source references; no selection/approval |
| `ask_question` | Typed scoped planning question; persists only after acceptance |

Do not expose raw unrestricted MCP, the apply socket, arbitrary filesystem writes or a generic `requests` tool with write credentials. Native provider tools are allowed only if the selected profile can enforce the same authority. If the runtime cannot provide that boundary, the adapter is unsupported for unattended research until constrained—not “safe because the prompt says read-only”.

## Preparation and execution interface

Preparation accepts explicit selected IDs and a snapshot of resolved values/decisions. It returns either typed unresolved choices or an immutable plan and effects projection. Pure validation and target reads are separate from mutation handlers. Executors accept only an existing authorized command/run binding; they do not accept a mutable batch ID as sufficient authority.

The proposed plan contains operation kind/ID, logical subject, typed inputs, required outputs, preconditions, selected attribution, artifact digests and repair policy. Persist effect outcomes separately; never mutate the approved plan to include later results. Effect-derived provenance is deferred from the smallest slice; introducing it requires retained versioned artifacts and transfer history bound to an explicitly approved policy, not a silent new attachment destination.

## Progress and reconnect

The database transaction that changes product state appends its durable UI event. `LISTEN/NOTIFY` or an in-process signal can wake SSE readers, but is not the durable source. Apply progress uses a bounded lossy observation channel; terminal state and known effects come from the journal. Safe coalescing can drop repetitive byte/token counts; it cannot drop an authoritative state transition before persistence.

```diagram
request result/effects + operation projection + ui_event → one PostgreSQL COMMIT
                                                                   │
                                                            SSE delivery
                                                                   │
                                                         browser query cache
                                                                   │ gap
                                                  consistent snapshot + cursor
```

Unlike the Python adapter seam, journal checkpoint, affected domain projection and event share one PostgreSQL transaction. Read models/caches can be rebuilt from that journal after a crash, never by repeating execution. Ordinary product edits append their event in their own domain transaction without a remote send. An in-process wakeup or progress IPC is not checkpoint authority.

A snapshot returns a consistent state plus cursor from the same repeatable-read snapshot. The browser requests events strictly after that cursor. Server-assigned cursors obey the commit ordering in [domain](02-domain.md); event replay is idempotent. If history expired, send an explicit reset instruction and a new snapshot, not an incomplete event tail. Slow clients have bounded buffers and reconnect. Browser disconnection never owns job cancellation. SSE responses are authorized, noncached and proxy-buffering aware; a polling fallback reads the same projections.

## Compatibility tests

Retain shared malformed/duplicate/unknown-field/number/path/hash vectors. Add request/response fixtures for every public union and cross-version incompatibility. Validate generated clients against the actual server parser/serializer, not just TS compilation. Test old tabs, out-of-order delivery, duplicate cursor IDs, rollback/commit ordering, expired event windows and cross-batch object access. No runtime type assertion or schema generator alone is acceptance evidence.

## Retained Capture context additions

The implemented Capture edits endpoint accepts one composite `settings` command for batch title/defaults, human supplier/date/tag context and an optional human note. The existing lot edit accepts per-lot context in the same transaction as its other changes. Loaded revisions and payload-bound keys remain mandatory. Context is human evidence, not an approval or new inventory effect; PO intent is not an accepted field. Absent new context is omitted from legacy snapshots.

Media edits add group rename/retirement, atomic multi-evidence moves and versioned evidence notes. Group instructions retain their existing versioned authority. Ungrouping preserves original evidence, links and historical group/instruction identity. Additive `media-inputs/3` includes scoped group/evidence context; /1 and /2 retained bytes remain valid, and Processing still refuses Part-attachment scopes. See the [implemented server boundary](../../intake-server/ARCHITECTURE.md#capture-settings-and-grouped-context-foundations) and generated API contracts for exact fields. UI consolidation and its acceptance evidence are separate delivery tasks.
