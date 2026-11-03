# Native agent sessions and global model default

Status: planning recorded before source implementation on `feat/intake-agent-sessions`, based on `interactive-app` at `f33b325470260785b2fb6384ef371ddd6e0732c8`.

## Requested behavior

The operator selects one global provider, authentication route and model before starting agents. That selection applies across batches and stages to new attempts. Queued and running attempts retain their selection. The UI exposes queued, active and finished session history, including cancelled, failed and interrupted outcomes, without exposing credentials or private reasoning.

The implementation owner is the primary agent. Fresh independent agents perform read-only review of each commit. Publication and squash merge into `interactive-app` are already authorized after clean review and green checks.

## Boundaries and alternatives

Use the existing Processing queue, attempt identity, currentness checks, account lane, retained envelopes and human question/answer flow. Do not build a second task coordinator or relabel a fixture profile as actual inference. Add `native-agent/1`, `bench-intake-input/4`, `processing/4` and corresponding command/envelope variants; keep retained versions 1–3 unchanged.

Use the unmodified Codex app-server and Claude Code headless CLI. No new SDK dependency is needed: Node child processes carry their documented JSON protocols. Codex supports API-key and ChatGPT login; Claude supports an API key or the host CLI's pre-existing subscription login. Never import subscription tokens into an SDK or collect them in the browser. API keys come from the explicitly supervised worker environment. The web process receives no provider credential.

Codex uses a dedicated host-configured `CODEX_HOME`, with the operator signing in there directly. Never copy an existing auth store. Claude subscription uses native host authentication with safe mode and no built-in tools; bare mode is unsuitable because it disables keychain access. Authentication modes must not silently fall back to another billing route.

The initial native profile returns validated source-bound suggestions or human questions. It grants no shell, filesystem, MCP, browser, inventory-write or approval tools. Stage names do not grant extra capabilities. Deliver retained notes and authorized image content explicitly; unsupported document content must be identified as unavailable, never described as inspected. External source fetching and semantic tool calls remain with the separately qualified broker profile until a native tool integration is qualified.

Existing browser WebSockets remain projection hints. Session reads use that stream for invalidation and bounded fallback polling; commands retain HTTP revision/idempotency authority. Neither opening settings nor reading sessions starts inference.

## Planned additive schema and public interfaces

Migration `0011_agent_sessions.sql` owns constraints and authority. Owning Drizzle declarations remain row mappings:

- `agent_settings`: one row per operator/target/context; positive bigint revision and validated provider/auth/model fields. Expected-revision updates refuse conflicts. Absence means no native default, rather than guessing a billable model.
- The immutable input/4 seals the settings revision and provider/auth/model alongside existing capture and media authority. New attempts read the settings under a transaction lock; later default changes do not invalidate or rewrite their inputs.
- `agent_session`: one row per native Processing attempt, bound by foreign key; timestamps, native session ID, actual model and bounded safe progress. Processing remains authoritative for lifecycle and cancellation. No provider stdout, credentials or reasoning are retained.
- Global settings GET/PUT and paginated session GET routes use existing local origin/CSRF protections and actor/target/context scope. Shared TypeBox contracts, generated OpenAPI and validated clients own the boundary.
- An explicit separately supervised native worker claims only native queued commands. Restart interrupts previously claimed sessions instead of resuming or repeating inference. Cancellation stops the child and confirms reap before releasing its lane. Session failures remain visible.

## Implementation sequence

1. Add contracts, migration, grants and settings repository with conflict tests; bind the default atomically when attempts are created.
2. Extend Processing authority/profile handling additively, and expose scoped session history with currentness and safe progress.
3. Implement bounded native transports, strict structured results, exclusive authentication environment, timeout/cancellation/reap behavior and a separate worker entrypoint.
4. Add settings and sessions pages, a model selector with custom exact IDs, clear host-login/key instructions, preserved dirty drafts and scoped live refresh.
5. Update owning architecture and operator documentation. Run generated-contract, type, formatting, lint, frontend/server tests, full PostgreSQL/process tiers and browser checks before independent exact-commit review and publication.

## Verification and safety

Tests use controlled CLI executables and isolated synthetic services. Exercise both providers/authentication routes, settings conflicts, default changes after queueing, cross-scope denial, malformed/oversized streams, tool refusal, credential omission, cancellation, child reap, failed startup, interrupted restart and finished history. Actual provider access, entitlement and inference remain unverified: prior instructions prohibit model calls during this work.

Preserve the user testing app on port 4330 and its retained database/media, the unrelated ports 4310/4350, all existing worktrees and dirty files. Never load the original repository `.env`, send real InvenTree requests, copy credentials, deploy, merge `main`/PR 32, force-push, reset/clean or delete retained data. Coordinate heavy tests through the existing pg-docker lease without stopping the user preview.

## Sources and compatibility evidence

Official interfaces were checked before implementation, together with offline CLI help and generated Codex schemas. Installed versions observed: Codex CLI 0.166.0 and Claude Code 2.1.316. Help/schema inspection does not prove successful inference or account entitlement.

- [Codex app-server protocol](https://developers.openai.com/codex/app-server)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Claude Code programmatic use](https://code.claude.com/docs/en/headless)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code compliance and native login boundary](https://code.claude.com/docs/en/legal-and-compliance)

## Execution evidence

Pending implementation and qualification. This record will be updated with actual checks, review findings and any justified scope changes.

Implementation refinement: global history reads retained attempt state and latest-on-job identity with bounded joined queries, rather than reloading every batch Processing projection. Evidence freshness and actionable proposals remain with the batch projection. This avoids a potentially large database read fan-out for a metadata list. Crash recovery deliberately refuses an occupied lane pending host confirmation, instead of releasing it on restart.

### Initial implementation checks

The primary agent implemented all source changes. Frozen install, generated contracts, typechecks, readability/frontend lint, complete fast suites (contracts 33, server 140), frontend 149 and build passed. The full serial PostgreSQL tier passed 120 tests with zero failures/skips; the later focused native set passed all three tests, including 53-attempt keyset pagination. Full worker/process and browser qualification are pending at the initial review commit.

Controlled CLI checks exercise both providers/authentication routes, malformed/oversized streams, unexpected tools, missing/ambiguous result refusal, SIGTERM-resistant cancellation and a backpressured stdin cancellation. A stronger cancellation test exposed and fixed a waiting-read deadlock; escalation is now independent of the caller returning from a blocked write. Worker startup qualification also found a missing migration-ledger read grant and a DBOS pool-size requirement; the runner receives that read only and uses the established three-connection system pool.

Codex API-key and subscription modes use separate state directories. The API-key route uses a fixed OpenAI endpoint and an environment key without a login/store write. The subscription route requires the operator's own direct login in the dedicated Codex home. Claude bare mode is used only for API-key authentication, while subscription preflight uses native CLI account metadata. Actual authentication, inference, entitlement and native containment remain unverified because no real provider calls are authorized for these tests.
