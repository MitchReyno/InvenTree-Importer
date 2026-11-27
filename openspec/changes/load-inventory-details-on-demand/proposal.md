# Load inventory details on demand

## Problem and intended outcome

An operator opening Capture to add evidence can trigger two catalogue scans before touching a picker. Opening one mapped record in Review can fetch details for 50 others and miss the selected record. Request data when the operator needs it. Show each independently available region while slower reads complete.

## Change identity and linked items

`load-inventory-details-on-demand`. Related prior work includes [BI-003, Batch settings overhaul](../../../docs/PLANNED_FUNCTIONALITY.md#bi-003--batch-settings-overhaul). This follow-up covers read timing and selection across Capture, Agents, Settings and Review, and delivery of route-specific JavaScript.

## Current behavior and evidence

- Capture's `BatchSettingsPanel` enables both `useCatalogue` queries whenever editable. Settings' `BatchDefaultRow` enables each query on mount. Saved labels already come from capture observations or saved defaults. Each cold candidate request can page through five groups of 100 in `intake-server/src/capture/catalogue.ts`. Ten upstream reads is a worst-case bound for two lists, not a latency measurement.
- `RecordsStage` already waits for a mapped selection or the Locations list. The existing-values route resolves the batch and slices the first 50 mapped records irrespective of demand. A later selected record can therefore be absent.

- The Agents page reads a capture snapshot for every batch group to derive titles, subject labels and lot links. Agent settings loads readiness and polls the session list even when their subsections are offscreen. Records loads Processing for Ask on a plain list.
- `frontend/src/App.tsx` statically imports Settings, Agents and Batch. Assess route splitting against a production inbox load and first navigation on the same build configuration.

Opening a batch reproduced a false “Intake service degraded” warning while Intake health returned 200. The Capture availability observer installs `skipToken` on the shared header connection query. A live-ready invalidation then attempts to run it and leaves the query in error. Correcting this is part of the frontend delivery.

## Scope and non-goals

Cover the Supplier, Default location and Parent location menus wherever those reference controls appear in Capture and Settings, and the existing-value lookup for Review records and location paths. Saved defaults, strict text and exact-ID search, selection validation, autosave and ordinary batch reads retain their existing contracts. Also include paged Agents display data, visibility-driven Sessions and Web research reads, gated Ask lookup and measured route-level JavaScript loading. Global header observations, unrelated session consumers and inventory writes are outside scope.

## Server improvements ranked by expected value

Priority applies within the server work. It reflects how often a path runs, how much repeated work can be removed, and the cost of preserving correctness. Latency gains remain to be measured.

| Rank | Improvement | Expected value and acceptance |
| --- | --- | --- |
| 1 | Reuse Processing within a batch attention request | Attention reads Processing directly and again through Records. Supply the same scoped result to both projections. A configured successful attention request builds Processing once and returns equivalent attention and record-derived counts. |
| 2 | Use narrow Processing reads for inbox and masthead counts | The inbox can build full snapshots for ten listed batches with jobs, and masthead step counts can do so for five batches. Read the current job states and question counts needed by each consumer. Summary-only paths perform zero proposal-body and answer-history loads while preserving counts and truncation. |
| 3 | Batch database reads for full Processing snapshots | Proposal, question and figure queries run per retained job. At the 100-job cap those three families alone can issue 300 queries. Bound their round trips by query family and chunk count, preserving per-job limits, ordering and integrity checks. |
| 4 | Reduce repeated work on conditional media previews | A matching ETag currently saves transfer after the preview bytes have been read and hashed. Resolve scope, removal state and rendition identity first. Avoid repeated blob work only where present-file integrity is established; measure cold, warm and changed-file paths separately. |

These are internal optimizations to existing reads. Their response, failure and authority contracts remain the acceptance baseline.

## Reuse and dependency assessment

The installed react-select 5.10.2 exposes menu-open events and TanStack React Query 5.105.1 provides enabled queries, freshness and shared in-flight reads. The existing wrappers already own accessible options, fuzzy ranking and scope keys. Reuse those APIs with a small demand signal. Moving loading into a separate async select would introduce another cache and require rebuilding the existing fuzzy and strict search merge. Neither a menu library nor a general data loader can resolve which mapped records belong to a batch. Extend the server's existing projection and fenced reader for that decision. No new runtime, license or dependency maintenance is required. Evidence checked 2026-11-26 in `frontend/package.json`, `pnpm-lock.yaml`, `frontend/src/forms/SearchablePicker.tsx`, `frontend/src/catalogue/useCatalogue.ts` and `intake-server/src/records/routes.ts`. Verify keyboard opening and actual call counts with instrumented tests.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `header-connection-status` covers truthful connection status across batch navigation and live refresh.
- `capture-reference-selection` governs first-open candidate reads for batch and application defaults.
- `review-records` governs mapped detail and location reads, and Ask eligibility.
- `agents-overview` covers rendering session groups and rows from a bounded page.
- `app-settings` covers reads while Sessions and Web research are in use.
- `ui-design-system` covers region-level loading, refresh and recovery. Initial deliverables are the Batches inbox, Processing Overview, Agents and the affected Settings and Records panels. Route delivery is an implementation and measurement task with existing navigation behavior as its acceptance baseline.

## Impact and dependencies

Frontend forms, Records, the browser client, shared request contracts and intake-server record routes are affected. Ship the additive server interface before switching the client. Extend the session-list contract using an opt-in response version for its closed schemas. Reuse the existing scoped query hooks, React lazy/Suspense and Vite dynamic imports. Existing catalogue endpoints suffice. No persisted-data migration is required.

## Open decisions and assumptions

Keep the existing five-minute candidate and one-minute existing-value freshness windows. Count requests against synthetic targets for acceptance.
