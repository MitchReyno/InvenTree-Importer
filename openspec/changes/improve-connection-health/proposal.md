# Change proposal

## Problem and intended outcome

During Capture uploads an operator repeatedly sees an inventory outage message. The same indicator currently represents a failed local request and a failed remote probe. Give the operator an answer to two questions: can this browser reach Intake, and what did Intake last observe about its configured InvenTree? Keep both checks responsive under load and shorten the wait for multi-photo previews.

## Change identity and linked items

`improve-connection-health` follows the delivered [BI-002 status signalling uplift](../../../docs/PLANNED_FUNCTIONALITY.md#bi-002--status-signalling-uplift). This is a follow-up, not a reopening of that item.

## Current behavior and evidence

- `frontend/src/components/masthead/HeaderStatus.tsx` and `frontend/src/header/observations.ts` fold bootstrap and connection-query errors into the target summary. Foregrounding triggers both header reads in `useHeaderObservations.ts`.
- `intake-server/src/header/{binding,connection}.ts` fences a cached or new read with two database checks. The API pool has four slots. Fresh observations last 30 seconds in cache and both outbound reads have three-second deadlines. The previous healthy spot check did not capture a failure during upload. Pool contention and probe timeouts are candidate causes.
- `intake-server/src/live/routes.ts` sends heartbeats after reading stream heads. `api/server.ts` already exposes a process-liveness route. Neither signal proves a mutation was saved.
- `frontend/src/media/useUploadQueue.ts` sequences revision-checked writes. The dev worker awaits one decode, backfill or figure step at a time. The host dispatcher admits one decode and rejects concurrent requests. The deployed decode CLI is one-shot.

## Scope and non-goals

Cover the masthead, phone menu, Settings, browser and server observations, and bounded capacity for independent retained photos. Keep revision checks, read-only target credentials, live transport reconciliation, deployment isolation, and existing manual one-command operation. Agent reasoning lanes, inventory writes and parallel browser writes are outside scope.

## Reuse and dependency assessment

Evidence checked 2026-11-25. Fastify 5.12.7, ws 8.22.1 and pg 8.16.3 are already pinned in the Intake project. Extend the existing liveness route, React Query observation owner and fenced PostgreSQL worker claims. This avoids a new runtime or licensing surface. A small application scheduler is needed to interpret freshness, token scope and queue capacity. A separate one-client health pool isolates scoped reads, at the cost of one budgeted database connection per Intake process. [pg pool API](https://node-postgres.com/apis/pool)

BullMQ's v5 worker concurrency could distribute jobs and manage worker lifetimes. Adopting a queue backend and reconciling its retry and ownership model with permanent decode claims would increase operating and migration costs. It would still need host-wide decoder admission and per-image isolation. Keep the existing queue and qualify the extra slot with measured resource use. [BullMQ concurrency](https://docs.bullmq.io/guide/workers/concurrency)

## Capabilities

### New capabilities

None.

### Modified capabilities

- `header-connection-status` — both connection states, independent schedules, priority, freshness, recovery and diagnostics.
- `capture-media` — bounded parallel decoding of independent retained images under interactive load.

## Impact and dependencies

Update generated client contracts, Intake HTTP/live services, UI and media launchers for local and deployed installations. Reuse the existing liveness-only and live-updates contracts. Replace BI-002's debug-only API visibility with an operator-visible Intake connection. Synthetic acceptance needs PostgreSQL, a controllable inventory endpoint, and the pinned isolated decoder. No external inventory target is required.

## Open decisions and assumptions

Propose ten-second deadlines and two decode slots as a qualification candidate. One slot remains the default for hosts without qualifying measurements. The three-second timeout is a plausible explanation for some incidents, not a confirmed cause of the reported incidents.
