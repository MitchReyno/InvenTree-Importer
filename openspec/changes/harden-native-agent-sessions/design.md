# Design assessment

## Context and grounding

See [proposal](proposal.md) and [session delta](specs/processing-agent-sessions/spec.md). The existing session-adapters.ts owns provider admission and protocol checks; session-runner.ts owns delivery and child lifecycle; agents/tools/handlers.ts owns validated session effects. contracts/src/index.ts owns Ajv validation. Frontend AgentSessions and Processing session components already expose retained history and status but lack the requested diagnostic disclosure. This is a cross-layer behavior change, not a presentation-only fix.

## Goals and constraints

Make confinement verifiable, model errors correctable and evidence citable; give operators useful categorized failures and safe debugging context. Preserve scoped reads, exact source validation, child reap before slot release, and native authentication/resume semantics. No inference or inventory mutation is authorized by this plan.

## Decisions and alternatives

### D1. Explicit provider admission policy

Reuse the native adapters and existing MCP stack. Introduce a version-aware admission policy whose evidence covers built-ins, deferred tools, code-mode wrappers and skill injection on fresh and resumed sessions. Disable wrapping while retaining direct intake tools. A startup MCP listing alone is insufficient. Keep runtime protocol refusal as defense in depth, not proof that a forbidden action was prevented.

Investigate these documented controls as concrete candidates, individually and in combination:

- `features.code_mode.enabled = false`: verify that disabling code mode removes its executor while keeping intake MCP tools directly callable.
- `features.code_mode.direct_only_tool_namespaces`: discover the actual intake namespace identifier from the installed CLI; verify direct calls rather than guessing its spelling.
- `mcp_servers.intake.omit_tools_from = ["code_mode"]`: verify exclusion from scripts and continued availability on the direct surface. This setting alone must not be treated as removal of the executor or other tools.

The [official configuration reference](https://developers.openai.com/codex/config-reference) documents these controls, but support in the deployed CLI remains unverified. Compare effective configuration and the complete model-facing tool declarations for fresh and resumed sessions; include a negative control with wrapping enabled. Separate direct-call availability from removal of exec and from confinement of all remaining tools. Do not silently upgrade the CLI or change host-global settings to make a probe pass.

First establish a no-inference probe against the intended executable's configuration/schema and protocol. Verify the complete offered surface using a controlled model endpoint where supported, without sending credentials or private input. If the CLI offers no reliable way to constrain and verify the surface before inference, mark that configuration unsupported; do not claim a post-execution rejection establishes containment. Exact flags and compatible CLI versions must be recorded from that probe. Preserve only the four inert exceptions enumerated in the delta and test their inability to read resources or execute server requests. Deferred advisor metadata is acceptable only if demonstrably non-callable and unable to reveal another tool; otherwise refuse it. Reject an SDK replacement because it changes native authentication and resume ownership.

The suggested `--sandbox workspace-write --ask-for-approval on-request` controls filesystem access and approval escalation, not the offered tool catalogue. It would broaden the current read-only/never policy and add approval requests that the adapter rejects. Evaluate its semantics in the task 1 probe only if relevant; do not adopt it as a confinement fix. The app-server adapter sets policy through thread/start and validates the returned policy, so ordinary CLI flags are not a drop-in adapter change. See [Codex security](https://developers.openai.com/codex/security).

### D2. Contract diagnostics without schema duplication

Use Ajv's structured errors through an additive contracts helper, leaving existing validate callers' error behavior stable. Copy errors immediately; emit at most 8 issues with JSON Pointer paths and fixed rule descriptions, with a 2 KiB aggregate budget. Include required-property names safely, escape paths, and never include input values. Retain validation_failed and strict schema/currentness/authority checks. Do not add a second validator or hand-maintained proposal schema. Update generated contracts and regression tests together.

### D3. Cite fetched versions

Add an authoritative source reference to the successful fetch result for both manifest and preview/new-evidence paths. Build it from scoped media metadata using the exact existing proposal-source shape. Separate original-version provenance from preview/crop hashes. Return it only alongside successful content delivery; retain the existing per-run budget and delivered-version tracking. Inbox notices remain hints, avoiding two independent provenance authorities. Restart continues to require refetching; no durable grant is inferred from knowing a hash.

### D4. Retained categorized diagnostics and disclosure

Introduce an additive session-failure diagnostic DTO and retained record owned by agents, linked to the exact session, attempt and turn. Categories are Authentication, Configuration, Tool policy, Validation, Evidence, Provider/network, Timeout, Interrupted and Internal/unknown. Cancellation remains an operator action, not a generic error. Use typed errors or stable protocol codes; do not classify by matching arbitrary provider prose. Unknown failures remain unknown.

Record a concise summary, stable code, stage, timestamp, correlation ID, known provider/model/CLI version, safe structured causes and recovery guidance. A sanitizer at the capture boundary allowlists fields, caps causes at 4 and the total diagnostic payload at 16 KiB, and records truncation. Safe protocol method/exit code/deadline metadata and sanitized stack frames can help debugging. Raw stderr, prompts, capabilities, SQL, private filesystem paths and arbitrary exception objects are excluded. Redaction happens before database writes and logs, not only in React. Missing fields remain explicitly unavailable.

Persist failure settlement and its diagnostic reference together where transactional ownership permits. A persistence failure must not masquerade as complete diagnostics or prevent physical reap; emit a safe correlation-only operational event and retain the original failure semantics. Expose details through the existing session scope checks, with a bounded details read if the full object would inflate history lists. List DTOs carry category/summary and detail availability. Old rows remain readable with no invented details.

Use one reusable frontend SessionFailureDetails component in the owning components directory, used by Processing and AgentSessions history. Show category, summary and a semantic button with aria-expanded/aria-controls; expandable details support keyboard operation, readable structured fields, loading/unavailable states and explicit close. Lazy reads use existing scoped TanStack Query keys and validated clients. Opening/closing details never retries work or resets drafts. Do not add a UI library: the existing React and disclosure primitives suffice.

### D5. Qualification is an evidence gate

Repair the qualification harness's chat predicate to require causally relevant output after reading the message; test reply, question and status plus unrelated-activity negatives. Recover the prior harness from attached qualification evidence if it is not tracked, or author a reproducible replacement using the existing process fixtures. Record exact CLI, provider, authentication and model matrix before any authorized run. Keep native_unverified while any supported cell or criterion is missing. Do not automatically broaden a passing configuration to other versions, models or authentication modes.

## State, authority and failure behavior

Diagnostics are observations, not commands or retry authorization. They follow actor/target/session scope and existing retained-history lifecycle. Recoverable tool validation failures return correctable diagnostics without terminating a healthy session. Terminal policy/protocol failures abort and reap before capacity release; failed reap leaves the slot occupied. Preserve pending inbox items, currentness and cancellation ordering. Source hashes do not confer access. No new inventory permissions are introduced.

## Verification strategy

Use contracts tests for diagnostic and citation schemas; PostgreSQL session-tools tests for authority, rejection without effects, successful delivered citations and persisted/scoped diagnostics; process sessions/session-worker tests for both provider adapters, resume, unknown tool surfaces and reap ordering. Inject credentials and hostile strings into diagnostic fixtures and verify neither persistence nor rendered details contain them. Frontend tests exercise category, expansion by keyboard, legacy/unavailable reads, scope changes and preserved drafts. Run an isolated browser walkthrough of both disclosure entry points. Stub tests prove application boundaries only. Live matrix qualification requires fresh explicit authorization and evidence attached to its PR.

## Migration, rollout and recovery

Use an additive diagnostic table or nullable structured field through the existing migration system; finalize the narrower storage choice after tracing settlement queries. Deploy the migration before readers/writers and support old rows. No rewrite or deletion of historical sessions is planned. Drain owned workers before adapter upgrades; do not resume unknown in-flight calls. Roll back code while retaining diagnostic data and source versions. Keep qualification disabled rather than fall back to a permissive adapter. Update owning agents, server and frontend architecture documentation with the implementation.

## Risks and open decisions

Provider pre-turn tool visibility is the principal feasibility risk. Task 1 is a concrete go/no-go probe; failure blocks confinement qualification, not the independent diagnostic/citation work. CLI proof of fit and live authorization remain outstanding. No promise of general host containment is made. The previous four exceptions conflict with the literal main spec and are reconciled explicitly in this delta. Diagnostics must remain useful without retaining sensitive provider payloads; structured codes/context are preferred over raw debug dumps.

## Continuing this change after investigation

Task 1 is a decision point within this change, not its delivery endpoint. When a suitable avenue is established, record the evidence-backed decision here and expand this change's proposal, delta specs, design and tasks to cover the concrete remaining work. Replace provisional assumptions with verified constraints, include compatibility and failure cases discovered by the probe, and revise the PR map while retaining whole-task ownership. Record the decision and departures in this change's notes.md during implementation. The continuation stays in `harden-native-agent-sessions`; do not create a separate follow-up specification for the work needed to deliver the selected approach. If no avenue meets the boundary, keep that outcome and unresolved work here without weakening the requirements or marking the change complete.
