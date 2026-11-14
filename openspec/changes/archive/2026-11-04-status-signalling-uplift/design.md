# Design assessment

## Context and grounding

This is a cross-layer presentation/read-contract change. [Proposal](proposal.md) records source evidence, package comparisons and original references. New requirements are [connection status](specs/header-connection-status/spec.md) and [workflow status](specs/header-workflow-status/spec.md). Masthead currently sits outside `ServerStateProvider`/`LiveUpdates`; existing activity and session components already use scoped TanStack Query clients. Reuse those paths rather than duplicate subscriptions.

## Goals and constraints

Put two independent disclosures and safe target access in the top header, preserve work visibility across tabs and expose truthful retained work/steps/agents. Keep draft/revision ownership, physical lane occupancy and current authorization unchanged. The existing background canvas remains decorative and must not intercept controls. Header updates must not remount active editors or move the navigation guard's ownership.

## Decisions and alternatives

### Scoped shell and reusable disclosure

Move masthead presentation within the existing scoped live/query provider tree, or pass a scoped header model through a thin shell without adding a second provider instance. Preserve the app's existing scope key lifecycle. Extract shared activity selectors from the current indicators; replace their redundant global strip once equivalent header details exist. Keep existing page-level diagnostics and detailed views.

Prefer a small styled Radix Popover wrapper for both controls, using non-modal disclosures, portalled content and one controlled open panel at a time. The [proposal comparison](proposal.md#reuse-and-dependency-assessment) documents alternatives and checked source versions. Implementation Task 1 must confirm a published exact release, React 19.3.1 compatibility, license/advisories, focus restoration and clipping behavior before installation is relied on. Source inspection is not an integration proof. Native popover is the fallback after equivalent browser/focus checks; Floating UI remains viable if deeper positioning needs justify its additional assembly. Do not install multiple competing systems or replace the styling stack.

### Connection observation contract

Add an authenticated same-origin read projection, proposed as `GET /api/v1/connection-status`, with target/context IDs, sanitized navigation URL/label, target observation state, observed-at time and safe failure code. The URL comes from the server-selected existing target profile; strip credentials and do not accept a browser target address. Extend TypeBox schemas, generated OpenAPI and typed clients together. Preserve request Origin/CSRF/read-scoping rules rather than bypassing them through public health.

Target state is unconfigured, unknown, reachable or unavailable; freshness is a separate property. Reuse the server's existing authorized inventory read transport and validation/DNS/redirect policy. A bounded read-only probe uses the target's existing harmless read route, selected from its supported adapter and tested against an owned fake. No write or provider call is part of a probe. Timeout after 3 seconds, coalesce concurrent probes per target/context, cache results for at least 30 seconds and mark observations stale after 60 seconds; bound cache lifetime/size and discard on context/credential-profile changes. Test exact route/auth/redirect behavior before enabling it. Failed or absent configuration returns a safe state and never a guessed URL.

The frontend derives API availability from the projection/bootstrap request and update-transport state from a read-only context exposed by `LiveUpdates`; neither becomes target reachability. Use one scoped connection query with a 30-second foreground polling cadence even when the update socket is healthy, because target observations have no socket hints. Reconcile on focus/reconnect; hidden tabs may pause network polling, but a local expiry deadline must retire a reachable observation at 60 seconds and recompute immediately on visibility/focus. Base freshness on the latest completed observation, so a fresh failed probe remains unavailable rather than unknown. This adds no second socket or per-render target probe; server coalescing/cache still bounds target traffic. Display each signal separately in details, including last observation/freshness; target status owns the compact connection label. Stale reachable becomes “status unknown” with the last observation visible, not a fresh green state.

### Bounded work and active-session projection

Add an authenticated `GET /api/v1/header-work` projection over existing retained manual/processing/session readers. It returns a bounded summary with current-batch preference, typed workflow identity, known stage/state and step observations, safe links/route identities, physical active sessions and explicit `truncated` flags per collection. Proposed limits: 100 work entries and 50 active sessions, ordered deterministically; a current batch must not displace the coverage warning. Filter active sessions by physical occupancy in the server query before pagination, rather than filtering the first general-history page. Do not expose native-session IDs, credentials or private tool transcripts in the header.

Use existing processing stage/state and retained execution receipts for steps. If no numeric progress denominator exists, show a state/stage label or indeterminate indicator; no inferred percentage. Preserve logically cancelled/superseded but occupied lanes as active. Show completion only from retained terminal records, not a disappearing job. Existing WebSocket projection hints invalidate the scoped query; retain bounded polling/focus reconciliation to cover streams outside subscription bounds. Older responses from another actor/target/context cannot populate the current header.

Compact view prioritizes active current-batch work, then attention-needed work, then other active work; details identify application-wide scope and list the remaining visible entries. Fresh complete empty reads establish idle/no active agents. Failures and partial results preserve labelled stale observations, not false emptiness. Navigation actions link to existing Processing, Results and Agent sessions; cancel/retry/approve remain in their owning views with current authorization.

## State, authority and failure behavior

Server-retained records own progress/session state; local open/closed state owns disclosures only. Query keys include server scope identity; use the existing generation/currentness mechanism when targets change. Expanding a disclosure performs reads only, never mutation or approval. Opening InvenTree uses the sanitized configured HTTP(S) URL in a new tab with `noopener noreferrer`, preserving current drafts. Missing URL renders an explanatory unavailable state.

Do not persist header status in localStorage, aggregate percentages across incomparable jobs or treat a socket connection as command acknowledgement. An unavailable work read cannot disable unrelated saved editor state; keep each unavailable area explicit and preserve existing draft navigation handling. Limit polite announcements to meaningful state changes rather than every heartbeat.

## Verification strategy

- Contract/static and server tests: sanitize links, preserve scope, target unavailable/timeout/redirect refusal, cache/coalescing/expiry and active-only selection outside history page one. Use controlled clocks and owned fake inventory; never contact a real target for qualification.
- PostgreSQL tests: active occupancy despite logical cancellation, bounded/truncated work and target/context isolation. Existing retained readers supply original execution identity and currency.
- React regressions: healthy socket plus unavailable target, stale/unknown data, query failures, scope switch races, current-batch priority, partial active agents, existing dirty navigation and no duplicate subscription.
- Browser evidence: original Processing state composition, desktop/360px/390px/200% zoom, keyboard/escape/focus, screen-reader labels, no canvas clipping, link isolation and preserved draft across tabs. Package focus/portal behavior needs actual browsers; jsdom is insufficient.
- Owning commands: `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm typecheck`, relevant Vitest/server files via owning test commands, `pnpm test:intake:pg`, `pnpm test:intake:process` for changed read integration, `pnpm lint:frontend`, `pnpm lint:readability`, `pnpm build`, and required formatting checks. These are future implementation gates, not tests run by this planning PR.

## Migration, rollout and recovery

Additive read contracts precede header consumption. No inventory/database migration is expected; any needed read index is a separately reviewed additive migration within the read-model task. Old frontend clients remain valid. Roll back the new header consumer before removing read APIs; retain existing detailed work/session views and authoritative execution records. Do not use rollback as a reason to replay mutations. Validate generated contracts and deployment compatibility together; a plan grants no live deployment or target-probe authorization.

## Risks and open decisions

Main risks are false connectivity, clipped disclosures, expensive polling/probes, incomplete active-session counts and loss of dirty editor identity. Bounds, explicit freshness and boundary regressions address them. Exact published popover release and adapter probe route are implementation preflight evidence, with failure preventing their dependent task from proceeding. No unresolved product-scope decision remains; the plan does not claim runtime integration has already been demonstrated.
