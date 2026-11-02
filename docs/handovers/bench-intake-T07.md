# T07 — restricted provider integration

## Prospective implementation plan

Prepared before runtime edits on merged `be3be4c`. Codex owns T07; Claude Code owns T08 in its separate worktree. The approved implementation plan, owning architectures and T05/T06 handovers govern this work. Shared contract registration/generation, manifests, lockfile, migrations and application shell remain coordinator-owned until an explicit handoff.

Mitch explicitly exempted this initiative from feature flags. Actual application agent/model/provider usage remains prohibited until explicit later authorization. All integration and fault evidence in this task will use deterministic protocol stubs. No signed-in provider process, login/logout, auth-store access, entitlement request or paid fallback is part of the implementation or tests.

The original configured InvenTree is strictly read-only, including mutation/denial probes. Tests never discover its environment or copy personal credentials. Only owned fake read transports and isolated test databases are used. The stopped user preview stays stopped; retained Capture and shared PostgreSQL are not restarted or reset.

### Outcome and non-goals

Build a bounded provider-neutral research boundary with an App Server-shaped deterministic adapter, exact staged evidence access, a semantic inventory-read broker, constrained source fetching and retained source receipts. Integrate it with the already merged immutable Processing inputs, envelope acceptance, questions and physical-lane settlement.

The coherent acceptance journey is a real PNG/PDF artifact bound to an exact input, read through an opaque capability by a deterministic protocol child, followed by source-bound proposal or application question. A human answer creates a fresh attempt; it never resumes an old native permission handle. Cancellation, stale input and child exit preserve exact attempt ownership and physical occupancy until terminal/reap.

Do not add actual native inference, automatic provider startup, generic shell/browser/MCP tools, raw inventory transport access, write credentials, remote pairing, provider parity, deployment or final identity. Actual provider entitlement, media support and complete native tool/credential isolation remain explicitly unqualified.

### Evidence gathered before implementation

Official OpenAI documentation was searched and opened before local CLI inspection. App Server is the appropriate protocol shape for authentication, approvals and streamed interaction; its dynamic tool surface is experimental. Native command sandboxing does not govern every connector/browser/model/auth connection, so a sandbox setting alone cannot establish the required read-only research boundary. The adapter must refuse unsupported native operation rather than rely on trusted prompts.

The installed CLI reports `codex-cli 0.166.0`. Only `--version`, generator help and offline `app-server generate-ts --experimental` were run. No server or model turn was started. Version-matched generated types confirm exact thread/turn/call identities and dynamic tool response shapes. Generated protocol bindings are investigation evidence, not runtime validation or proof of native support.

Primary sources:

- [Codex App Server](https://learn.chatgpt.com/docs/app-server).
- [Agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security).
- [Authentication](https://learn.chatgpt.com/docs/auth).
- [ipaddr.js API](https://github.com/whitequark/ipaddr.js/blob/main/README.md), [package metadata](https://github.com/whitequark/ipaddr.js/blob/main/package.json) and [MIT licence](https://github.com/whitequark/ipaddr.js/blob/main/LICENSE).

### Existing seams and required additive authority

Processing `/2` is immutable metadata-only authority: its instructions expressly prohibit media-byte access and tools. It cannot be relabelled as a staged-evidence provider profile. Preserve all `/1` and `/2` instruction bytes, inputs, commands, accepted messages and applied migrations.

Propose an additive `restricted-research-stub/1` profile, `processing/3` handler and `bench-intake-input/3`, command `/3` and runner `/3` formats. The qualification remains `fixture_only`. The trusted policy allows only the semantic research broker and explicitly prohibits actual inference, direct filesystem/network tools, credentials, selections and mutations. A server-side config selection enables new `/3` attempts; absent selection preserves `/2` defaults. A `/3` worker never claims older command formats as its build.

The new input retains exact current capture/media authority and binds the restricted tool-policy version. It does not embed ephemeral thread IDs or permission handles. Explicit answer continuations create new `/3` command authority while preserving the existing selected historical predecessor semantics. Old queued versions retain truthful version blockers; old displayed proposals remain readable.

Existing note/media proposal source variants remain unchanged. Research source responses require an additive source variant rather than pretending a fetched page is a human note or media upload. Proposed `/3` proposals may additionally cite an opaque retained research-receipt ID and exact digest; server acceptance and retained display verify that receipt's complete actor/target/batch/attempt/command binding through the owning research interface. Shared source/contract changes require coordinator integration before consumers.

### Owned modules and interfaces

Own focused modules under `intake-server/src/research/`, their tests, owning architecture and this handover. Keep policy, persistence, transport and adapter lifetimes separate.

1. **Policy and schemas:** bounded semantic requests/results for `read_evidence`, `lookup_inventory`, `fetch_source`, `submit_proposal` and `ask_question`. No request accepts actor/target credentials, filesystem paths, arbitrary HTTP verbs/headers, shell commands or authority identities supplied by the provider. Existing TypeBox/AJV remains the schema vocabulary; strict JSON decoding rejects duplicate keys and unknown fields.
2. **Staged evidence:** exact version/evidence/digest membership comes from the verified retained command-media manifest. An injected owning content seam reads those immutable bytes, verifies digest/size/type and returns a bounded opaque artifact. Native paths never become public IDs. PNG/PDF tests use literal actual bytes; a deterministic response does not claim image interpretation or native PDF support.
3. **Inventory reads:** inject only the owning semantic read interface, never its credential-bearing transport object. Bind the configured target/context and attempt at construction. Allow supported exact Part/location reads, validate complete bounded responses and return safe projections with retained receipt identity. Denial/incomplete/malformed/unavailable reads are typed failures, never successful absence.
4. **Source fetching:** accept only bounded public HTTP(S) URLs with no userinfo or arbitrary headers. Reject private/reserved/mapped/ambiguous destinations before send. Resolve once, validate every DNS answer and pin the chosen address through the actual transport lookup while retaining the original Host/TLS name. Redirects are refused, not followed. Bound request/body deadlines, bytes, calls and concurrency. No cookies, target credential or provider token crosses this boundary.
5. **Retained receipts:** an owning repository stores exact bounded source bytes or canonical safe inventory projections plus immutable digests and complete attempt/command/actor/target context. No repair-on-read. Proposed PostgreSQL storage avoids introducing an uncoordinated blob/GC namespace; all inserts and grants require the coordinator's additive migration. Receipts are audit/source authority, never permission handles or human selections.
6. **Scoped broker:** verify the exact active command/attempt before effects and again before returning a result. The current check is injected from an owning Processing seam; research must not duplicate sibling SQL internals. No database transaction is held across external HTTP. Cancellation closes the broker and prevents late results or stale callback reuse. Per-session budgets and exact request IDs bound duplicate replies.
7. **Protocol adapter:** only the declared dynamic tools are dispatched. Validate exact thread, turn and call identities; refuse every command/file/network permission or raw MCP request. Application questions come only from the semantic tool, not native permission prompts. Provider output cannot set envelope binding or sequence: the host constructs those from its verified command and monotonic counter. Terminal/question ends the session, and no old callback is used by a fresh attempt.
8. **Deterministic process transport:** bounded framed JSON over an injected transport plus real controlled child fixtures, output/message/time limits, explicit cancellation and confirmed reap. There is no default path that launches the personal `codex` binary. The production native route remains disabled/unsupported; operator capability status must say stub-only.

### Alternatives and dependencies

The Codex SDK shortens job automation but does not remove protocol/authentication/isolation qualification. App Server's request lifecycle matches persisted application questions and strict tool dispatch better; use its documented shape with deterministic stubs, not a claim that its native runtime is already safe.

Use the existing TypeBox/AJV and Node process/HTTP/crypto primitives. Do not install a second runner/schema/workflow package. A new MCP server is unnecessary for this first adapter because its allowlisted dynamic tool request surface is already explicit; no unrestricted MCP capability is exposed.

Propose pinned `ipaddr.js` for maintained IPv4/IPv6 range classification instead of writing another address parser. Maintainer metadata advertises MIT licensing and Node compatibility; registry availability/version must be checked before coordinator installation. The package classifies addresses, not DNS pinning, redirect policy, credentials or request bounds. Those remain explicit application policy and tests.

### Implementation sequence

1. Settle additive profile/source-receipt contracts, dependency addition and owning Processing/content seams with the coordinator. Record concrete changes and migration allocation; no competing shared edits.
2. Implement and test pure request validation, source address policy and pinned bounded transport in the new owning module. Use controlled transports/resolvers and literal independent expected classifications.
3. Implement staged artifact access and scoped broker with injected authority/read interfaces. Add receipt persistence only through the agreed migration/repository boundary.
4. Implement the protocol adapter and controlled child transport. Keep actual native startup absent and capability qualification explicit.
5. Integrate new Processing profile/handler and retained receipt source verification through delegated paths. Exercise actual PostgreSQL/HTTP/DBOS and real child stubs against actual PNG/PDF artifacts.
6. Reconcile owning architecture, plan adjustments, exact versions, commands, results and residual gates. Request an index allocation for owned commits; independent review and GitHub operations remain coordinator-owned.

### Independent verification plan

Before new test files, inspect current normal/PG/process fixture conventions. Tests use the maintained runners, not Jest or an additional framework.

- Exact artifact bytes/hash/type; foreign version, wrong digest, altered blob, oversized content and unlinked scope refused without a read leak.
- Semantic inventory allowlist, exact string identities, configured target binding, unavailable/denied/partial/malformed responses and zero mutation transport access.
- IPv4/IPv6/mapped/private/reserved/metadata addresses, mixed DNS answers, DNS rebinding, redirects, oversized/stalled response bodies, no credential forwarding and exactly one HTTP send.
- Wrong thread/turn/call, unknown tool/method, duplicate changed call payload, permission request, oversized frame/output and unsupported continuation fail safely.
- Source receipts are immutable, exact-parent and verified before proposal acceptance/display; foreign/missing/corrupt receipt never becomes a current source.
- Question/answer creates a fresh exact attempt, retains human values and does not reuse old permission handles. Stale result/cancel/restart retains physical occupancy until terminal/reap; old output cannot clear a new lane.
- Actual DBOS delivery/restart and child stub prove coordination only. No inference, entitlement or real inventory compatibility claim is made.

Run focused normal tests, server/contract types, readability, formatting and generated-drift checks. PG/Docker/process checks require the shared exclusive lease and exact cleanup. Coordinate full tiers and image input changes with root. Code-intelligence checks are skipped because the connector is unavailable; other checks are not bypassed.

## Current status

Runtime implementation is ready for coordinator integration and independent review. The additive V3 profile, leaf research schemas, source admission, broker/evidence/inventory readers, exact receipt repository and Processing source/currentness checks are implemented. The coordinator owns shared V3 contract generation, migration `0009_research.sql`, configuration, package lock and minimal receipt display. A fresh protocol owner owns the adapter/child transport and its handover. No actual model/provider or real inventory request occurred.

### Settled scope and adjustments

- Exact source URL admission is server-only, sorted/deduplicated, sealed in InputV3 and rechecked against current configuration. Discovery/search is unsupported in this first slice. Adding an admission cannot broaden an old input; removal makes it stale.
- Inventory support is exact Part/location lookup only, through the existing semantic capture parser. Stock/search are deferred rather than exposed through arbitrary HTTP.
- Native startup/continuation is absent. The explicit App Server-shaped fixture adapter is not evidence of native sandbox isolation. Questions/terminal require confirmed fixture reap, and an unconfirmed-reap error keeps physical lane ownership.
- Existing profile1/2 trusted bytes, tool policy and defaults remain intact. Per-profile tool versions replace the previous global no-tools comparison.
- Package assessment selected exact `ipaddr.js`2.5.0 (MIT, Node>=10, zero runtime dependencies) from published maintainer/registry metadata. GitHub main3.0.0 was not installed. Node core transport handles pinned connections and budgets; no additional runner/schema/workflow package was added.
- `factory.ts` explicitly composes owning Processing access, owning authorized media bytes, safe inventory read closure and receipt repository. Constructing it starts neither provider nor worker. Root main remains registration/configuration only.

### Verification completed by T07 owner

Pinned runtime: Node24.22.2, pnpm12.16.1. Code intelligence was unavailable; local types/lint and focused boundary checks were used. Final self-review added an exact selected-profile check before worker claims and a regression assertion in the existing receipt/grants PG case. The seven-case passing run preceded that final guard; its added assertion awaits the coordinator combined rerun.

1. `pnpm --filter @invimport/intake-server exec tsx --test tests/research-broker.test.ts tests/research-model.test.ts tests/research-source.test.ts`: **14/14 passed, zero skips**. This includes exact literal PNG/PDF identity/foreign/altered evidence, semantic safe projections, duplicate/call limits, URL admission/SSRF/mixed/protected-address policy, canceled DNS, redirect refusal, actual owned loopback Host/no-auth and byte bounds.
2. `pnpm --filter @invimport/intake-server typecheck`: passed after runtime, factory and PG tests. Focused runtime ESLint also passed after factory/receipt integration. The repository ESLint configuration ignores test files (five explicit warnings, no errors); tests were typechecked and executed instead. Final coordinator lint/format remains required after protocol integration.
3. `node intake-server/scripts/run-media-pg.cjs '' research`: **7/7 passed, zero skips** on the single existing owned PG17 service, with fresh random databases/roles and exact disposal. Cases cover broker receipt to V3 proposal/terminal/restart, exact receipt adoption/foreign read scope/runtime grant denials, source admission revocation with held lane, concurrent18publications yielding16receipts/2refusals,4MiB cap and corrupt retained bytes refused without repair, V3 research question/human answer preserving historical Reading and exact old-answer adoption after later edit, and `executeProcessingCommand` through an explicit deterministic protocol session into real broker/receipt/settlement.
4. The first PG run exposed the old `processing_profile_tool_profile_version_check` during additive seed. Root corrected only draft0009 to map exact profile/handler/tool triples; no previous migration was edited. Later test-only failures came from corruption injection violating the length CHECK and using a pre-answer capture revision; those fixtures were corrected. The recorded final run above passed all cases.
5. The PG corruption test disables only user triggers in its own random database, alters same-length bytes, reenables triggers and proves read refusal/no repair. No global fault, service restart or real target request was used. Every fixture disposed its HTTP listener, connections, random roles and database. The shared heavy lease was acquired atomically and removed after completion.

### Remaining coordinator qualification

The protocol owner records its independent actual Node child/framing/PNG/PDF fixture results in the protocol handover. Those are transport proofs, not model interpretation. Root must run final generated drift, formatting/lint, normal tiers, current-image rebuild and maintained PG/process tiers after file freeze, then obtain fresh independent reviews. The existing decoder image was not used or claimed as current-image qualification by this owner. Browser/T08 compatibility and semantic retirement guards remain coordinator/Claude scope; this branch does not import unmerged Capture semantics.

Actual inference, account entitlement, native multimodal behavior, native outbound/tool/credential containment and subscription usage are expressly **unqualified**. Do not test them without explicit later user authorization. No actual provider executable, login/auth store, real inventory endpoint or original `.env` was used.

## Integrated acceptance extension (prospective)

The coordinator requested one remaining combined acceptance case after the owned checkpoint: public HTTP and actual DBOS delivery through the explicit controlled Node protocol child, owning media bytes and real retained PNG/PDF. Existing seven PG cases use an in-process session; sibling process cases prove transport independently. Neither alone establishes this combined boundary.

Own only a new `tests/process/research-processing.test.ts` and support/fixture files with `research-processing` prefix. Reuse existing owned Processing/DBOS/media helpers, the injected restricted adapter/factory and controlled child. Stage actual PNG/PDF through owning media APIs, verify exact content hashes in the child, end with an application question only after reap, answer through public HTTP, and prove a fresh exact continuation/session plus retained inspection after restart. Include a receipt-backed proposal through the real broker without external network. Keep this one bounded vertical scenario; do not duplicate T06 matrices or alter frozen production runtime without coordination.

Write offline first, then acquire the shared exclusive lease before PG/Docker/process execution. Use only the existing owned PG service and explicit decoder image. The old image can support preliminary codec checks but cannot establish current-source image qualification. All real provider/native/model usage, original environment loading and real inventory access remain forbidden. Record exact child/listener/database/role/blob cleanup and honest image/DBOS/byte-verification limits before independent review.
