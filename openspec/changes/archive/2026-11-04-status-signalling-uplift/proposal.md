# Change proposal

## Problem and intended outcome

The masthead says “Manual workflow” while work/connection information lives elsewhere. Operators need separate, persistent connection and workflow indicators in the top header, with expandable details, current steps and active agents. Follow the preserved mockup's **Processing in progress** composition while using real retained application observations.

## Change identity and linked items

Canonical name: `status-signalling-uplift`; linked item: [BI-002](../../../../docs/PLANNED_FUNCTIONALITY.md#bi-002--status-signalling-uplift). The index owns current metadata. Delivering branches retain the exact name, for example `feat/status-signalling-uplift-connections`; subjects use `feat(status-signalling-uplift): …`.

## Current behavior and evidence

`frontend/src/components/masthead/Masthead.tsx` renders a static label outside the scoped query/live providers in `App.tsx`. `components/ui/ActivityIndicator.tsx` and `processing/ProcessingActivity.tsx` already read bounded global activity; `operations/LiveUpdates.tsx` owns WebSocket/fallback state. `agents/AgentSessions.tsx` reads paginated retained sessions, including physical lane occupancy after logical cancellation. Reuse these owners rather than adding another polling/socket system.

`contracts/src/index.ts` Health proves local API liveness only; Bootstrap exposes opaque target IDs but no public target URL or reachability. ProcessingActivity lacks per-job step detail. Consequently a green socket cannot prove InvenTree reachability, and header phase progress needs an explicit bounded read contract. Main `openspec/specs/` has no capabilities yet; these are new delta capabilities, not claims that existing behavior is absent from source.

The [original reference](../../../../docs/bench-intake/reference/README.md), [interactive prototype](../../../../docs/bench-intake/reference/bench-intake.html) and [Processing screenshot](../../../../docs/bench-intake/reference/04-processing.png) own composition. Its timers, fictional target and localStorage are not implementation authority.

## Scope and non-goals

Replace the top-right label with target connection status and a details popover; keep Open InvenTree to its right. Add a distinct expandable workflow status/actions control on the same header row, persistent across tab navigation. Show retained steps, work needing attention and active agents, with truthful freshness/partial coverage.

Preserve the decorative masthead, approved light palette, existing dirty-navigation guard, API authorization and real-inventory mutation restrictions. No new execution commands, agent scheduling, provider calls, credential input, telemetry service, automatic retries of mutations or changes to Capture are included. Navigation to existing workflows supplies actions; cancellation continues through the owning Processing/Results surface.

## Reuse and dependency assessment

Checked 2026-11-03 against frontend manifests/lockfile: React 19.3.1, styled-components 6.6.0 and TanStack Query 5.105.1 are installed; no popover library is declared. Existing activity clients, query scopes and polling fallback remain the data foundation.

| Option | Fit and advantages | Costs, constraints and decision | Primary evidence / remaining proof |
| ------ | ------------------ | ------------------------------ | ---------------------------------- |
| Existing queries, scoped providers and CSS | Retains authorization, polling and retained-state ownership; no new runtime service | Extend read projections and lift presentation into the scoped shell; custom freshness and scope policy remain application-owned | Repository files above; contract/integration regressions required |
| Radix React Popover | Managed focus, dismissal and collision handling; unstyled composition fits existing styled-components | Recommended narrow primitive, not a new design system. MIT; adds transitive focus/layer/positioning dependencies, so inspect exact published package and lock changes before installation | [Official API](https://www.radix-ui.com/primitives/docs/components/popover), [source manifest](https://github.com/radix-ui/primitives/blob/main/packages/react/popover/package.json). Source observed 1.3.1, React peer includes 19; docs display 1.2.0. Release/pin and React 19.3.1/browser integration are not yet proved |
| Floating UI React | Flexible positioning and interaction hooks; MIT; source observed 0.27.20 with React >=17 peer | Viable alternative but requires more assembly of roles/focus/dismissal for these two controls; larger custom interaction responsibility than Radix | [Official React guide](https://floating-ui.com/docs/react), [manifest](https://github.com/floating-ui/floating-ui/blob/master/packages/react/package.json). Published version and runtime fit require verification if selected |
| Native Popover API / existing details | Avoids dependency; browser supplies top-layer/light-dismiss behavior | Viable fallback if target browser matrix passes. Application still owns dialog semantics, positioning and focus testing; details alone does not meet the requested anchored popover composition | [Browser API guide](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using). Browser support and viewport positioning need a focused proof |

Prefer Radix after the explicit implementation preflight; do not treat source-main versions as a released pin. Refresh maintenance, license and advisories for the selected exact release, exercise focus/portal placement in the actual masthead, and record the result before relying on it. If it fails, choose the documented alternative with equivalent acceptance evidence and update the plan. No package is installed by this proposal. A UI library cannot own target identity, freshness, bounded work completeness or agent occupancy; retain that custom domain projection.

## Capabilities

### New capabilities

- `header-connection-status`: independent connection observations, details and safe configured-target navigation.
- `header-workflow-status`: scoped retained work/steps, active agents and accessible persistent activity disclosure.

### Modified capabilities

None; no existing main OpenSpec capability paths exist. This is a behavioral proposal, so specs are required.

## Impact and dependencies

Affected owners: frontend scoped shell, masthead/activity components; shared TypeBox/OpenAPI clients; server authenticated read projections/configuration and bounded target observation adapter. Existing target transport and retained Processing/manual/agent records supply identity and state. No new database authority or external status service is needed. Independent from BI-001; the two changes share visual references, not a required merge order.

## Open decisions and assumptions

Assume an application-wide summary with the current batch prioritized, plus visible scope and truncation. Use navigation actions to existing workflows instead of creating cancellation/approval controls in the popover. Exact package release selection is a bounded preflight task; the architecture and fallback acceptance are defined above. No unresolved user scope decision blocks this plan.
