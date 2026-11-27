# Implementation and delivery tasks

## Plan context

Change `load-inventory-details-on-demand` builds on [BI-003](../../../docs/PLANNED_FUNCTIONALITY.md#bi-003--batch-settings-overhaul). See the [proposal and dependency assessment](proposal.md), [design](design.md), [picker acceptance](specs/capture-reference-selection/spec.md) and [Records acceptance](specs/review-records/spec.md).

## Completion and commit ordering

Verify each action, check it and stage the task update with its implementation commit. Keep incomplete actions pending. Put measured request counts and verification outcomes in the PR description. Record design departures in implementation notes as they arise.

## Task map and dependencies

Tasks 1, 2, 4, 5 and the route baseline in 6 can start independently. Task 3 uses task 2. Task 7 exercises the affected views after their query changes.

## PR delivery map

The UI and API delivery PR contains tasks 1–7, including their tests and affected architecture references. Together they deliver the requested on-demand reads, with one compatible server/client rollout and one review. Base `interactive-app`, branch `feat/load-inventory-details-on-demand`, subject `feat(load-inventory-details-on-demand): load screens and inventory reads on demand`. Verify contracts, app suites, request counts, independent exact-head review and selected CI before merge.

A second cohesive PR covers tasks 8–11 on `perf/load-inventory-details-on-demand-server-reads`, targeting `interactive-app`, with subject `perf(load-inventory-details-on-demand): reduce repeated server reads`. Prioritize 8, 9, 10, then 11. These optimizations can start independently of the UI delivery. Coordinate the Records reader boundary with task 2 and re-run the combined contract and owned PostgreSQL tests on integration. Compare identical scoped synthetic inputs before and after, recording query counts, blob bytes, elapsed times and payload parity as applicable. Use the same independent review and CI gates.

## 1. Request reference candidates when an enabled menu opens

- [ ] 1.1 Extend Capture and Settings tests with counting catalogue clients. Establish failures for cold mount, disabled fields, clearing a saved choice, keyboard and pointer opening only the selected model, and deduplication across default and parent location.
- [ ] 1.2 Forward menu lifecycle through SearchablePicker and SearchableReferencePicker. Bind useCatalogue to scoped demand, keeping the saved selection renderable in idle, fetching and failed states.
- [ ] 1.3 Exercise fresh reopen, stale reopen, retry after failure, immediate typing and delayed responses after changing scope. Run the catalogue, reference-picker, Capture and Settings tests under the frontend test runner and verify exact call counts.

## 2. Serve targeted existing-value lookups from authorized batch mappings

- [ ] 2.1 Extend the record route integration and existing-reader tests with a counting synthetic transport. Expect one call for the sixtieth mapped record and zero for foreign/unmapped keys or a rejected input.
- [ ] 2.2 Add the bounded request schema, typed client and additive lookup operation. Validate the expected revision against the same projection that supplies the mappings. Resolve and order mapped records before reading through the existing target fences and limits. Preserve omitted, not-found and unavailable outcomes. Keep the legacy GET supported.
- [ ] 2.3 Regenerate with `pnpm contracts:generate` and verify `pnpm contracts:check`. Exercise bad keys, length and count boundaries, duplicate keys, same-key remapping before a request and between chunks, target rotation, legacy truncation and a failing upstream record in intake tests and the owned PostgreSQL route fixture. Update the intake architecture's endpoint description.

## 3. Request the details and paths needed by Review

- [ ] 3.1 Add failing frontend request assertions for opening Records with empty demand, selecting a late record, switching filters and displaying a draft location whose path needs its parent. Cover a selected detail outside the filtered list.
- [ ] 3.2 Replace the boolean batch-wide lookup with scoped keys derived from the rendered rows and selection. On stale revision discard partial details and refresh the projection. Implement bounded sequential lookups and per-chunk progress/failure. Update the frontend architecture's Records read description.
- [ ] 3.3 Exercise more than 50 required location keys, overlapping parent keys, partial failure, changing batch/revision mid-read and stale versus fresh caches. Verify lookup identities and maximum concurrency, plus UI states and retained edits.
- [ ] 3.4 Run `pnpm test`, frontend typecheck/lint/build, intake typecheck, contract checks and applicable owned PostgreSQL route tests. Record synthetic before/after request counts for both surfaces and disclose any unverified environment behavior in the PR.

## 4. Supply Agents display data with session-list pages

- [ ] 4.1 Add contract and owned database tests for bounded group titles, rows outside the summary cap, live/retired lots, shared Parts, missing subjects and actor/target isolation.
- [ ] 4.2 Add the opt-in display response and client cache identity. Resolve labels and link eligibility in bulk in the scoped list transaction. Verify the legacy closed-schema format still validates.
- [ ] 4.3 Switch AgentSessions to the enriched pages. Test opening, filtering and Load more with multiple groups and zero browser Capture calls. Record server query counts at increasing group sizes.

## 5. Gate Settings and Ask observers by demand

- [ ] 5.1 Test direct links, scrolling across overlapping visible subsections, a hidden polling interval and returning to Sessions after a live hint. Keep draft forms mounted and verify Pause all waits for a fresh read.
- [ ] 5.2 Bind Sessions polling and Web research readiness to their own visible regions. Exercise failures and unrelated active observers using synthetic clients.
- [ ] 5.3 Gate Ask reads for selected details and parameter conflicts. Verify cold ordinary lists and archived batches make zero Ask-related reads, eligible controls appear, and a fresh session is required after invalidation.

## 6. Measure and defer route JavaScript

- [ ] 6.1 Capture the same production inbox and first-navigation flows before and after splitting Settings, Agents and Batch. Compare compressed initial JS, module requests, time to first useful inbox and first destination content.
- [ ] 6.2 Keep navigation and guards mounted across route-level Suspense. Exercise keyboard and direct entry, back, failed chunk retry and dirty-form navigation. Document the measured split decision and accepted first-navigation cost.

## 7. Render independent page regions progressively

- [ ] 7.1 Write delayed-promise tests for the UI design-system scenarios. Resolve each pair of reads in both orders, fail one and retry. Assert what is visible and actionable before releasing the pending read.
- [ ] 7.2 Add an opt-in ten-row inbox identity response and fetch it independently of the existing enriched inbox GET. Verify stable keyboard and pointer destinations while the contextual Continue action becomes available. Preserve search/order and cache scope, handle mismatched revisions or membership, and verify no per-row HTTP fan-out. Show the Processing activity card independently of the jobs snapshot.
- [ ] 7.3 Give slow or failed auxiliary regions in Agents, Settings and Records local loading, failure and recovery states. Preserve navigation, accessible status, focus, drafts and command freshness. Exercise narrow and wide layouts.
- [ ] 7.4 Verify regional arrival with a throttled synthetic browser flow and a delayed/failing auxiliary endpoint. Record time to first usable region separately from time to full content, plus transferred bytes and request counts. Verify the existing warm-cache refresh behavior. Run the owning checks and update both application architecture references.

- [ ] 7.5 Reproduce inbox → batch → live-ready invalidation with the real query client, a mounted masthead and Capture availability hook. Assert the owning connection reader runs, no missing-query-function error or degraded banner appears, and no extra health polling is introduced. Implement the passive cache subscription, then exercise a failing scoped read, paused/offline state, scope change, stale timestamps and recovery. Verify edit availability remains fenced.

## 8. Reuse the Processing snapshot within attention

- [ ] 8.1 Count Processing reads for one configured attention request and assert the attention projection, including Records-derived decisions, on the same fixture.
- [ ] 8.2 Share the read within that request. Verify one successful build, standalone Records fallback, unchanged failure handling and isolation across concurrent batches or targets.

## 9. Derive inbox and masthead counts with bounded summary reads

- [ ] 9.1 Compare the current and proposed summaries on a ten-batch inbox and five counted header batches, including paused, superseded, retired and held-slot jobs, stale questions and truncated work lists.
- [ ] 9.2 Implement the summary reader inside the existing transaction. Assert identical counts, work rows and truncation, zero full-snapshot builds on the replaced paths, and zero proposal-body or answer-history reads for those counts. On the same oversized-detail fixture verify detail refuses and valid summary succeeds. Exercise scope and summary-specific refusals. Record database work and response timing.

## 10. Batch the full snapshot’s per-job queries

- [ ] 10.1 Instrument proposal, question and figure statements at 1, 10 and 100 jobs. Include empty jobs, per-job overflow, stale proposals and missing/removed figures.
- [ ] 10.2 Use bounded grouped reads and verify statement growth follows chunks, plus no figure query for a batch without questions. Compare ordered DTOs, validation failures, answer budgets and capacity refusals against the baseline.

## 11. Reduce blob work when a preview validator matches

- [ ] 11.1 Trace lookup, bytes read and hashes for cold 200, warm 304, mismatched validator, missing/corrupt file, removed evidence, rendition fallback and foreign target.
- [ ] 11.2 Implement the safe lookup/body split. Verify equivalent status, cache headers, body and authorization in each case. Record measured disk and CPU savings and any path that still requires full verification.
