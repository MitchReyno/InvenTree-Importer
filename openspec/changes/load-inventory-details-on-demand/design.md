# Design assessment

## Context and grounding

Candidate fetching and typed search are separate in `useCatalogue`. The closed controls in `SupplierField`, `DefaultLocationField` and `BatchDefaultRow` already have saved IDs and labels. Records has a separate concern: `RecordsStage` derives filtered rows and a selected detail, but `useExistingValues` currently knows only batch, revision and a boolean. The server resolves mappings and caps the result before reading the target. The picker work is local to the frontend. The Records work crosses the client, contracts and server.

## Goals and constraints

Meet the [menu demand scenarios](specs/capture-reference-selection/spec.md) and [targeted lookup scenarios](specs/review-records/spec.md). Retain the selected value, query freshness, batch authority and lookup budgets. An operator may type as soon as the menu opens.

## Decisions and alternatives

### Let the open menu express demand

Expose optional `onMenuOpen` through the shared react-select wrapper and reference picker. Track open demand per catalogue identity in its caller, including both location controls. Enable the candidate query on open subject to editability. On close, allow an in-flight read to populate its own cache and suppress idle refetches. On subsequent open reuse fresh data, refresh stale data or retry a failed read. Include scope and model in the lifetime of open state and search results. Keep idle distinct from loading so a closed saved choice never announces a pending fetch. Preserve the search debounce, abort/generation handling, exact-ID detail and bounded fuzzy ranking even when typing precedes the candidate response. Fetching on focus would also charge operators tabbing through fields.

### Resolve a bounded set of record keys on the server

Add a read-only `POST /api/v1/batches/:id/records/existing/lookup` with JSON `{ revision: string, keys: string[] }`. A body accommodates up to 50 keys of up to 256 characters without depending on URL limits. Apply the existing app request guards for POST. Validate the schema before any target read. Reject empty, duplicate or oversized arrays with 400. Compare the expected revision with the revision returned by the same authorized projection read that supplies mappings. Refuse a mismatch with 409 before target traffic. Resolve keys from that projection, dropping absent and unmapped keys. Preserve requested order. Reuse the existing response schema with `truncated: false` for a complete bounded selection. Only the existing reader constructs target operations. Keep the legacy GET and its truncation behavior for existing callers. Filtering the old GET response in the browser would still pay for unrelated lookups and miss later records.

### Derive demand from what Records renders

Outside Locations, request the selected mapped record, if any. In Locations, derive the union of mapped keys required by filtered rows and the selected detail, including a valid mapped parent whose path supplies a draft location. Derive this set before conditional rendering, using the same selection and filter logic as the UI. Empty demand disables the query. Deduplicate and order deterministically, placing detail dependencies first. For more than 50 keys, issue bounded chunks sequentially, show completed results as available, and stop scheduling obsolete chunks after navigation. Keep one client lookup in flight per active view. Preserve current server concurrency, deadlines and body limits within each request. Scope cached responses by actor, target/context, batch, revision and requested keys. Preserve one-minute freshness. Grouping reads by demand set may reread a key when filters change, but avoids a separate HTTP request for every row.

### Preserve the connection query owner across batch navigation

Let the masthead own the scoped connection query and its fetch options. In `useApplicationAvailable`, subscribe to the matching cache entry without installing another query observer. Adapt the existing query-cache subscription pattern to expose a stable snapshot of status, fetch status and data-updated time. Preserve the existing availability calculation over Capture and connection timestamps, the 60-second freshness limit, online state, scope and recovery time. A newly mounted batch must not start its own probe or replace the fetch function. Keep the normal live invalidation: a healthy refresh succeeds, a genuine scoped read failure still degrades the service, and recovery still requires fresh evidence.

### Render Agents from the session-list page

Extend the global list with an opt-in display format. Include titles for summary groups and row-only groups beyond the summary cutoff, and each returned row's current subject label and live-lot link eligibility. Read only the authorized batch and subject keys in bounded bulk queries in the list transaction. Preserve retired, shared-Part, batch-level and missing-subject fallbacks. Use format-aware cache keys and preserve old closed-schema responses for existing clients. Adding one server capture read per group would merely move the fan-out.

### Let each settings subsection own its requests

Keep the settings form and draft queue mounted. Enable the session list while Sessions is visible and readiness while Web research is visible. Direct links activate the intended section; observe the actual region for scrolling and tall viewports where several sections fit. Disable this observer's refreshes on exit, and require an actual fresh read on re-entry before enabling Pause all. Other consumers of a shared query retain their own lifetimes.

### Resolve Ask only for a surface that could offer it

Use predicates from the displayed detail and parameter conflict matrix, independent of whether a session is already known. Acquire Processing when one could offer Ask and the batch accepts chat. Release the observer when demand disappears. Preserve pending drafts and the existing post-invalidation send check. Cached evidence alone cannot enable a send.

### Measure and split route code

Use the production build at `5e62de05` as the historical baseline for eager JavaScript. Report raw and gzip sizes in the PR, excluding CSS, fonts and lazy assets, and repeat the comparison against the implementation base. Capture a production cold inbox waterfall, compressed entry and initial dependency bytes, and cold first-navigation timing for Settings, Agents and Batch. Use React lazy, dynamic imports and a route-content Suspense boundary inside the stable app shell. Start the deep-linked route's module as soon as the route is known, independently of authorized data reads. Keep the split where the cold inbox transfers fewer bytes, and document first-navigation cost under identical conditions. Exercise direct entry, back navigation, chunk failure/retry and cached reopen. Shared navigation guards, scope providers and dirty forms must keep their identity.

### Show independently ready sections

- **Batches inbox.** Search, new-batch and archive controls already render first. Supply the ordered page of authorized batch identities and titles before expensive workflow enrichment. Add an opt-in identity-only inbox response backed by listCaptureBatches with the explicit ten-row limit. The ordinary Capture list defaults to 100. Use the existing enriched inbox GET for the same search, archive filter, offset and ordering. Keep a stable Open batch link as titles arrive. Reserve the contextual Continue action until workflow data determines its label and destination. Fetch enrichment once for that page, matching by batch ID and revision where applicable. Never create a per-row request waterfall. During concurrent edits or pagination, discard mismatches and refresh the page. Empty results require a completed identity read.
- **Processing Overview.** After capture establishes scope, the activity query and full Processing snapshot can resolve independently. Render Recent activity when its read succeeds even if jobs, questions and their controls are pending. Keep their existing local layout and freshness gates. Start independent reads together once their own prerequisites exist.
- **Agents, Settings and Records.** Render grouped session rows independently of capacity settings, saved fields independently of options or readiness, and record lists independently of target fields and Ask. Preserve unknown/unavailable labels for missing inputs.
- Reuse region-sized ReadState and skeletons. Keep failures and retry with the failed region, retain good siblings during refresh, reserve space and announce busy state per region without a chorus of duplicate announcements. Preserve focus, scroll and unsaved edits as siblings settle. A cold bootstrap or unauthorized scope can still gate protected data. Apply the layout-preserving skeleton and refresh rules from `polish-ui-styling-and-loading` at region level.

## State, authority and failure behavior

Browser keys identify application records. Resolve them against the server's projection at request time, and retain target-context fences around upstream reads. A missing mapping produces no result. An actual upstream 404 and an unavailable lookup retain their respective statuses. Send the displayed revision with every chunk. A stale-revision refusal cancels remaining chunks, invalidates the affected projection and discards partial details for that revision. Recompute demand after the refreshed projection arrives. Keep failed chunks distinguishable from empty data and retain successful siblings. Changing scope, batch, revision or selection during a request must never apply its data or loading/error state to the new view. Saved forms and pending edits are independent of these reads.

## Server read design, in priority order

1. **Batch attention.** In `attention/reader.ts`, start one request-local Processing promise. Give the Records reader an explicit way to consume that result alongside capture and media. Keep its standalone entry point and its existing Processing-error fallback. Preserve the attention endpoint’s own failure behavior. Reuse only within the same batch, actor and target context.
2. **Inbox and masthead.** Replace the full-snapshot calls in `processing/read.ts` (inbox) and `header/processing.ts` with a shared summary reader in the caller’s transaction. Select only fields needed for state, currency, open-question and ready-lot rules. Keep existing predicates for supersession, retired subjects, paused batches and held slots. The open batch still supplies header work rows. Preserve ordering, truncation flags and read bounds. For representable detail snapshots, compare results with the existing projections. If detail exceeds its byte budget, the detail endpoint still refuses it and a separately valid bounded summary succeeds. Preserve summary limits and refusals for invalid scope or facts needed to compute current state.
3. **Full Processing snapshot.** Fetch proposals and questions for selected job/attempt IDs in bounded sets and fetch figures only for relevant questions. Enforce each job’s result cap plus overflow sentinel in the database, group by stable IDs, and preserve original deterministic ordering. Share batch-version evidence within the transaction where applicable. Retain digest, citation, currentness and byte-budget validation. Never replace bounded per-job reads with an unbounded batch history scan.
4. **Preview revalidation.** In `media/content.ts` and `media/routes.ts`, separate authorized rendition lookup from reading the body. Preserve the selected fallback rendition, private cache headers, removal rules and scope checks on every request. A database digest alone does not establish that the on-disk file still exists and is intact. Start with exact behavior-parity fixtures. Reuse a prior verification only if the store can reliably establish the same safe, unchanged file; otherwise reverify. Measure disk bytes and hashes independently from HTTP bytes. Retain the verified path if equivalent integrity cannot be established.

## Verification strategy

Exercise pointer and keyboard opens through the actual forms with counting clients. Check closed-field navigation, clear, disabled fields, both location menus, fresh reopen, error retry, typed search races and target rotation. For Records, test the validated route with a scoped synthetic batch and a counting target transport, including 60+ records, absent and foreign keys, malformed bodies, partial upstream failure, fence refusal and legacy GET. Exercise view selection, filtering, draft parent paths, multiple chunks and late responses through Records. Verify counts and requested identities. Wall-clock improvement on an installed target remains unmeasured.

## Migration, rollout and recovery

Deploy the additive route with the existing GET supported, then switch the frontend. Roll back the frontend first if necessary. All operations are transient reads. No database migration or backfill.

## Risks and open decisions

First open incurs a cold read. The loading state must support immediate typing and keyboard dismissal. Measure time to first usable region separately from time to complete data. Synthetic counts establish request behavior only. No outstanding product decision.
