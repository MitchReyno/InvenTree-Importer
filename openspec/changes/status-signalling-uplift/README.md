# Status signalling uplift

Capture the requested application-header uplift as BI-002 in the [functionality index](../../../docs/PLANNED_FUNCTIONALITY.md), which owns its current metadata. This brief records future intent; full proposal, requirements, design and task planning remain to be developed.

## Connection status and InvenTree access

Replace the **Manual workflow** element in the top-right masthead with a clearly visible connection-status indicator inspired by the original mockup. Clicking it opens a popover with more connection details. Keep the **Open InvenTree** link to its right, following the original header composition and using the actual configured target rather than the prototype's fictional URL.

The proposal should define which connection the compact indicator represents and how the popover distinguishes InvenTree reachability from application/API and live-update transport health. Do not report a healthy WebSocket as proof of a healthy InvenTree connection. Include meaningful unavailable, stale/unknown and reconnecting behavior based on actual observed signals rather than simulated success; decide the precise detail fields during planning.

## Workflow status and actions

On the same header row, add a separate workflow status/actions indicator inspired by the original mockup's **Processing in progress** state. Keep current work visible while navigating between tabs. Expand it to show current work status, the steps/phases and progress, relevant workflow actions, and active agents.

Use the original compact activity control, phase segments and expanded background-work view as the composition reference. The active-agent disclosure is an explicit requested addition even where the historical mockup does not model real agent sessions. Determine batch/global scope, multiple concurrent jobs, available actions and authoritative agent/work projections during proposal development; retain existing action authorization and avoid inventing live progress or active agents from fixtures.

Connection health and workflow activity are distinct concepts and must remain independently understandable. Plan keyboard-accessible popovers, clear labels beyond color, sensible focus/dismissal behavior and responsive layouts for the shared header row. Retain the approved light/neutral palette and blue accents.

## Original references and proposal follow-up

- [Original mockup and provenance](../../../docs/bench-intake/reference/README.md).
- [Interactive original mockup](../../../docs/bench-intake/reference/bench-intake.html): select **Processing in progress** and inspect the header activity control, including while switching tabs.
- [Original Processing screenshot](../../../docs/bench-intake/reference/04-processing.png) and [Capture header](../../../docs/bench-intake/reference/03-capture.png).
- Current masthead: `frontend/src/components/masthead/Masthead.tsx`.
- Existing live-update signal: `frontend/src/components/operations/LiveUpdates.tsx`; this represents update transport and does not establish InvenTree reachability.
- Existing agent-session UI: `frontend/src/components/agents/AgentSessions.tsx`; assess its retained data and visibility boundaries before reuse.

Investigate existing components, packages/frameworks and server contracts before choosing a custom popover, aggregation or status mechanism. Identify missing health/progress/session data and explicit acceptance checks for healthy, unavailable, stale, idle and active states. The Capture uplift is a separate change, with no known ordering requirement; assess any shared integration dependencies rather than imposing one.
