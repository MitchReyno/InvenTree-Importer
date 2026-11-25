# Implementation and delivery tasks

## Plan context

[Proposal and reuse assessment](proposal.md) · [Design and qualification protocol](design.md) · [Connection scenarios](specs/header-connection-status/spec.md) · [Media scenarios](specs/capture-media/spec.md). Canonical name: `improve-connection-health`. [BI-002](../../../docs/PLANNED_FUNCTIONALITY.md#bi-002--status-signalling-uplift) supplies the existing status capabilities.

## Completion and commit ordering

Verify each action, mark it complete, and stage this file with the corresponding implementation commit. Keep review, CI, merge and qualification pending until evidenced. Record departures in notes.md and routine evidence on the PR.

## Task map and dependencies

T1 establishes server observations. T2 consumes them. T3 delivers media admission independently of T1; T4 uses both bundles to qualify the mixed workload.

## PR delivery map

| Bundle | Whole tasks | Purpose and order | Base, branch and subject | Gates |
| --- | --- | --- | --- | --- |
| A | T1, T2 | Ship the two-hop contract and UI together. First merge. | interactive-app · feat/improve-connection-health-observations · feat(improve-connection-health): distinguish Intake and inventory connectivity | Fault matrix, contract compatibility, accessible UI evidence, independent exact-head review and green CI |
| B | T3, T4 | Qualify the worker and dispatcher together under interactive load. Qualification needs A. | interactive-app · feat/improve-connection-health-media · perf(improve-connection-health): bound parallel image decoding | Database/decoder process tests, matched benchmarks, integrity and resource gates, independent exact-head review and green CI |

## T1. Supply timely, scoped server observations

- [x] Baseline the liveness route, scoped status read, 3-second remote cutoff, 30-second cache, client budgets and socket ticks. Capture synthetic latency, pool wait and current failure classifications.
- [x] RED: reproduce a 9-second protected success labelled offline with the original deadline.
- [ ] Historical RED evidence remains partial for autonomous checks, heartbeat delay under pool pressure and credential/context rotation. Post-change verification covers these cases.
- [x] GREEN: implement the scheduled target checks, coalesced manual check, cancellation, short recovery cadence, budgeted health pool, schema-compatible snapshots and separate root/auth outcomes. Decouple socket heartbeat from projection without weakening scope closure. Introduce reason and elapsed-time observations.
- [x] Verify with fake clocks, generated-client checks, actual sockets, saturated PostgreSQL pool and target stub. Cover startup, shutdown, fresh-cache checks, refused token, redirects, root failure, target timeout and local DB failure. Update Intake architecture and endpoint docs.

## T2. Present and recover both connections

- [x] Baseline focus/file picker refresh, mount, offline and stale behavior. RED: make a local-only failure produce the existing erroneous inventory warning in a regression; cover both health legs and debug modes.
- [x] GREEN: implement the shared browser liveness owner, gated probe coalescing and recovery state table across desktop, phone and Settings. Preserve edit safety, drafts, last-check times, focus and navigation.
- [x] Exercise nine/ten-second boundaries, delayed response after recovery, sleep/resume, polling-only and stale target results. Verify desktop and phone accessibility including Escape, announcements, 360/390px and 200% zoom. Check old/new client behavior and update frontend architecture.
- [x] Run project contract checks, frontend typecheck/lint/tests/build and pnpm test. Attach failing-hop demonstrations and measured load evidence, review exact head, address findings and obtain selected green CI before authorized merge to interactive-app.

- [x] Exercise a cold-start outage through the generated health client, a nine-second liveness response, automatic bootstrap retry, and a recovered target displayed within five seconds of publication with the socket disabled.

## T3. Admit independent decodes within shared limits

- [x] Exercise the last-slot race with a competing figure worker and one-shot photo client. Assert against the claim table that a photo denied admission stays eligible. Apply the same check to the direct development launcher before selecting a shared admission implementation.

- [ ] Baseline dev media loop, one-shot host entry point, deployed dispatcher, per-kind admission and worker completion transactions. RED: two retained versions cannot overlap today; exercise contention with figures, backfill and simultaneous one-shot clients.
- [x] GREEN: reserve before claim in dev and host modes, implement one or two bounded slots, supervised draining, bounded input/output memory, fair maintenance and deterministic shutdown. Keep browser uploads ordered, claims durable and the one-command CLI usable.
- [ ] Use PostgreSQL and the pinned isolated decoder to check duplicate bytes, concurrent completions in one batch, conditional publication, interrupted ownership, resource exhaustion, old one-slot behavior, refused unauthorised requests and capacity reclamation. Update media launch and deployment documentation.

## T4. Qualify mixed-load operation and select host defaults

- [ ] Compare the original four-ordinary pool and the three-ordinary, one-health allocation at one decoder slot. Record pool waits, queue depth, ordinary-read p95 and role headroom separately from the decoder-slot comparison.

- [ ] Run the design's reproducible one-versus-two-slot workload. Use measured comparison in place of a test-first cycle for tuning. Record environment and resource ceilings before each series. Separate upload time, queue delay, decode and publication time.
- [ ] Verify coverage and exact output for all retained versions, interactive p95, local heartbeat p95, target timeouts and recovery times. Include a saturated and a recovering run. Document the qualified profile or retain one slot when evidence is insufficient.
- [ ] Verify startup, rolling upgrade, drain and downgrade in a disposable deployment, and run pnpm test plus affected deployment and frontend checks. Attach benchmark distributions, resource peaks and limits to the PR. Obtain independent exact-head review, resolve findings, wait for selected green CI and merge only when authorized.
