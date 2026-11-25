# Design assessment

## Context and grounding

Two hops share one red badge. Raising the timeout alone would leave the wrong service named and keep local status queued behind application reads. The [header delta](specs/header-connection-status/spec.md) changes the operator contract. The [media delta](specs/capture-media/spec.md) addresses a separate source of perceived slowness. Claiming, decoding and publishing are already separate stages. The change crosses browser timing, API admission and host resource limits.

## Goals and constraints

Give each observation an owner, timestamp, deadline and recovery path. Keep the live-updates protocol, authenticated target context, Capture freshness gates, revision order and isolated decoder. Apply the same status policy to the desktop masthead, phone menu and Settings.

## Decisions and alternatives

### Browser to Intake

Use the existing authorized socket's ten-second application heartbeat as cheap browser liveness. Run its timer independently of projection reads after subscription, keeping pong expiry, five-minute lifetime, scope-change closure and the 30-second transport fallback. Frames carry no new state. A slow projection may close the stream. HTTP still works independently.

On mount, missing heartbeat after ten seconds, network return or resume, issue one same-origin, uncached, schema-validated GET /api/v1/health with a ten-second deadline. While socket delivery is unavailable, repeat HTTP on the healthy ten-second cadence. Coalesce concurrent focus, timer and reconnect signals. While disconnected retry between four and five seconds after completion with bounded jitter. A fresh valid heartbeat can recover contact immediately. Pause redundant probes in suspended tabs, mark old evidence stale on resume and reject late results from earlier generations. An ordinary query error requests confirmation. A responsive Intake with failed bootstrap/status/readiness is degraded. During initial confirmation show Checking. A proxy error page, invalid payload or silent connection cannot establish liveness. Use failed liveness with no newer success to declare disconnection. A healthy socket plus failed HTTP means API degraded. Never let process liveness satisfy a Capture edit gate.

Mount the local observer above App's bootstrap error branch so a cold start can recover without the header provider. Set the generated GET /api/v1/health budget to ten seconds. After a valid HTTP liveness response retry a failed bootstrap automatically, coalescing retries and retaining authorization checks before mounting scoped reads.

### Intake to InvenTree

Start one scheduler per configured context in the owning Intake API process, including when no clients poll. Schedule from completion, once at startup, then 30 seconds on success or 4–5 seconds after transient failure. Stop timers and abort outstanding reads on shutdown or context/credential rotation. Persistent configuration or credential failures wait for correction or the healthy cadence. Share one in-flight cycle across reads/manual checks and bypass cached observations for accepted forced checks. Preserve the five-second forced-check throttle and generation fencing.

Use the existing bounded, redirect-refusing transport. Fetch GET /api/ for service identity/version and the existing authorized GET /api/part/?limit=1 to verify read access, concurrently under **one ten-second budget** including body validation/cancellation. A root-only heartbeat could accept a public response while the configured token fails. The protected response is authoritative for usable access. If the protected read succeeds, root failure only suppresses version. If only the root succeeds, surface “InvenTree responded; inventory read unavailable” (or token refused). Distinguish network timeout/no response from a responding service returning errors, unexpected content or refused authentication. Record local scheduling/context-read failures as unknown/degraded. Retain the previous timestamp only as history. Only a fresh, scoped failed reachability observation can assert a target outage.

Regular status GETs return the latest authorized snapshot promptly; schedule refreshes server-side. Keep existing DTO fields and expose additional cause/observation information additively or negotiate a version for strict decoders. On recovery qualify the snapshot by a check completed after local reconnection (coalesced manual check or next cycle). Fence reads on both sides of asynchronous work. Keep local health free of database checkout, target reads and media queues. Reserve one capped pg connection for scoped health fences per API process within the deployment connection budget, releasing it before network I/O. Bound and coalesce equivalent scoped reads; never serve a cached snapshot across an unverifiable scope. Keep ordinary requests progressing. Align generated client deadlines for manual checks above the ten-second remote budget plus bounded local overhead. Retain separate bootstrap/readiness budgets.

While the active browser shows a transient target failure or unknown status, refresh the scoped snapshot every four seconds, with a single in-flight read. This reads the server cache only. With a responsive status endpoint the recovered badge appears within five seconds of publication, including in polling-only mode. Stop fast polling on recovery, permanent configuration failure, suspension or loss of Intake contact.

### Photo processing

Reuse PostgreSQL claims and isolated decoder processes. Preserve `useUploadQueue` order: each upload consumes the previous accepted revision. Start decoding retained versions while subsequent uploads continue. The dev loop sleeps even after a successful new decode; drain eligible foreground work immediately when capacity exists. Move maintenance sweeps to one owner. Admit at most one backfill at a time and provide recurring service to waiting figures.

Implement a bounded slot allocator at the actual launch boundary, shared by decodes, figures and backfill. Reserve capacity **before durable claim**. In deployed mode use a bounded dispatcher reservation tied to the existing Unix connection, consumed once for the pinned decoder; bind the reservation to its request and reclaim unused reservations on disconnect or bounded expiry. Keep old one-shot calls compatible with one-slot deployments. Use the same admission semantics for the direct dev launcher. Scope host configuration to one owning launcher/dispatcher so extra worker processes cannot multiply slots. Release capacity only after child exit and bounded output disposal; never automatically replay an ambiguous claim. Keep DB transactions short, and atomically publish per-version results and events under concurrent completion. Fair selection across classes must retain the existing at-most-one-in-flight-backfill delay for new work.

Use one slot by default; qualify two per host profile. Retain per-job CPU, memory, PID, timeout and byte limits and budget simultaneous input/output buffers plus decoder containers in aggregate. Host a supervised drain mode using the same worker functions alongside the explicit one-command entry point. A general distributed queue adds a second claim/recovery model without solving dispatcher admission; see the [proposal](proposal.md).

## State, authority and failure behavior

| Observation | Primary status | Target detail |
| --- | --- | --- |
| Startup or resumed with expired evidence | Checking Intake | Waiting for Intake |
| Both local paths silent after confirmation | No connection to Intake | Current target status unavailable |
| Local liveness succeeds, scoped read fails | Intake responding, service degraded | Unknown |
| Local HTTP succeeds, socket closed | Intake connected | Show verified target; polling in diagnostics |
| Intake connected and target replies 401/403 | InvenTree refused the token | Show last check and credential source |
| Intake connected and target times out with no valid response | InvenTree unreachable | Show last check and reason |

Healthy, stale, unconfigured and owned-test target identities continue to use the existing safe navigation and freshness rules. Distinguish the primary fault in accessible text and announce transitions once. Health observations cannot authorize commands, acknowledge uploads, overwrite drafts or grant inventory writes.

## Verification strategy

Use fake clocks for 9-second success, ten-second expiry, jitter, retries, resume, generation changes and late replies. Use process tests with a controlled inventory stub, four occupied ordinary API connections, healthy and broken sockets, lost HTTP, token refusal, and concurrent tabs. Show that each leg can fail and recover independently, including a reachable root with failed protected read. Exercise the actual generated client, desktop, phone and debug-off Settings.

Compare the current worker, revised one-slot worker and two-slot worker with the same pinned decoder and isolated DB. On each supported host profile run five paired warm trials of 12 synthetic camera-size photos including portrait rotations and duplicate bytes, with a figure, a backfill and sustained Capture reads. Record upload-confirmed to last preview and first preview, batch wall time, p95 ordinary read/liveness latency, target duration, DB wait, peak RSS including children, CPU and error counts. Measure against the better one-slot baseline, same inputs and rates. Accept two slots only for ≥20% median batch improvement, ≤10% ordinary-read p95 regression, local liveness p95 <1s, no spurious disconnects or extra errors, and peak use within a predeclared host memory/CPU budget. A slower host keeps one slot. Check checksum/identity, no missing previews, capacity races, stop/drain, crash after claim, and out-of-order completion against real PostgreSQL and the isolated decoder.

## Migration, rollout and recovery

Ship compatible server observations before switching UI consumers; test old/new client pairs and use the established update-required path if a contract change is incompatible. Treat startup and rolling changes as unknown until fresh. Roll out worker admission at one slot first, then opt qualified profiles into two. Stop new admissions and drain running work before reducing capacity or reverting dispatcher versions. Preserve durable claims and media. No inventory migration is required.

The active agent-stage-inputs-outputs delta also touches capture-media, specifically immutable derived crops. These requirements are disjoint. Either archive order is compatible with the current deltas; repeat the overlap check before syncing.

## Risks and open decisions

These timings and performance thresholds are proposed acceptance values. A blocked process can still miss a heartbeat. Record low-cardinality durations and failure class for local delivery, scope checkout, target probe and decoder queue wait without tokens, raw responses or photo identifiers. Mixed-load results determine the per-host default.
