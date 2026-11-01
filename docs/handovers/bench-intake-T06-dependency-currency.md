# T06 dependency currency correction

## Prospective plan

Prepared at ready PR #54 head `a70d55e` before changing runtime code. Independent review reproduced a running research attempt publishing an accepted proposal after its exact reading predecessor was replaced, without any capture or media change. The owner will correct the retained dependency authority and its claim, settlement, read/activity and answer consumers.

Own only Processing runtime modules, focused PostgreSQL regressions and this handover. The coordinator owns shared integration documentation and publication; an independent reviewer owns the existing synthetic browser preview. Preserve all concurrent work. Use the allocated owned PostgreSQL service with isolated fixture databases; do not restart services or drive the browser.

Verify that each attempt's retained dependency rows exactly match its sealed manifest IDs. Traverse the bounded, increasing-stage predecessor graph through verified Processing authority. The prospective investigation initially included comparing each ancestor's input with latest capture/media; the policy decision below narrows that interpretation to preserve explicit answer continuations. A dependency must still be its job's selected attempt with a consistent state, including transitive predecessors. Never redirect an old ID to a replacement attempt. Missing, extra or malformed retained edges are authority errors, not a successful empty graph.

Separate graph currency from readiness: a selected queued predecessor does not make its queued dependent stale, but cannot authorize dispatch/claim, an answer or accepted worker output. Read models retain history while projecting replaced/broken dependency graphs as superseded. A stale nonterminal message must retain bytes without publishing a proposal/question or releasing the physical lane; exact terminal settlement or reap remains required.

Use existing `loadProcessingAuthority`, owning media descriptor APIs, canonical/shape validation, PostgreSQL transactions and pinned Drizzle APIs. No dependency or migration is needed: package code cannot determine this domain's exact attempt authority. Keep existing sealed V1/V2 bytes and payload-bound answer adoption behavior unchanged. Capture/media exclusion already serializes same-batch mutations; graph verification adds no later domain lock or nested transaction.

First add public HTTP/real-PG regressions for an already-running stale dependency (including activity and held lane), retained ready output becoming stale, a stale question answer, transitive replacement and malformed/missing dependency bindings. Include a healthy queued/ready graph control. Run these against the original code and record actual failures, implement the shared correction, then run focused Processing PG, normal server/model tests, types, readability, formatting and Markdown checks. Independent re-review remains required.

All evidence is deterministic fixture evidence. No actual model/provider call or personal credential access is authorized. The original configured InvenTree is strictly read-only, including mutation/denial probes; this task sends it no requests.


## Policy clarification and implemented behavior

During implementation, the coordinator and independent reviewer agreed that historical predecessor lineage must be distinguished from a fresh consumer's input. An explicit research answer edits capture and creates a new research/downstream input while retaining its exact selected ready reading predecessor. Recomputing that historical reading input against the new quantity/note would strand an authorized continuation; rebuilding upstream work would change the approved continuation policy.

The correction therefore verifies every retained graph node's immutable command/input/profile/media binding and complete dependency edge set, then checks selected identity and consistent raw state transitively. It does not reinterpret an old predecessor against the latest capture/media. The root consumer's existing complete capture/media freshness check remains unchanged. Replaced, cancelled, superseded, interrupted or inconsistent predecessors invalidate descendants; queued/running/waiting selected predecessors can keep queued descendants current but cannot authorize a claim, answer or accepted output.

`authority.ts` joins the exact job identity, verifies manifest subject/stage and compares canonical sorted dependency IDs against a bounded Drizzle edge read. Missing/extra edges fail with `processing_dependency_binding_invalid`. The new `dependencies.ts` traverses at most the existing batch job budget, checks same-batch/increasing-stage edges and reuses `loadProcessingAuthority` for each node. No new lock, transaction, migration, package, grant or sealed format was introduced.

Claims, authenticated settlement, question answers and snapshot/activity currency share this status. Read snapshots retain accepted proposal/question history while marking stale work superseded. An authenticated stale proposal is retained with disposition stale, creates no current proposal and keeps its physical lane. Exact terminal settlement or explicit interruption after reap still releases only its own claim. Payload-bound adoption of an already committed answer remains before new-command currency checks.

## Regression evidence

Before runtime changes, all six initial new real-PG cases failed at their intended assertions: stale direct/transitive proposals were accepted, retained ready dependents stayed ready, a stale question answer returned 200 instead of 412, and missing/extra dependency edges returned a successful snapshot. The original independent reproduction is retained separately by the coordinator.

After correction, all **eight named PostgreSQL cases passed**:

- Replaced direct predecessor rejects already-running proposal, projects stale activity and retains the physical lane until its exact terminal.
- Ready accepted output remains inspectable but becomes noncurrent through direct/transitive replacement; a ready replacement cannot redirect the old ID.
- Stale question answer refuses with 412, preserving capture and creating no answer/continuation.
- Already-running research detects replacement beyond its immediate selected ready identifying predecessor.
- Missing and extra retained edges each fail closed before a claim. The missing-edge fault changes only its disposable test database trigger/data; the trigger is restored before fixture disposal.
- Healthy research answer changes the exact human quantity and continues research/images using the exact ready historical reading dependency.
- Cancelling an unfinished transitive predecessor invalidates queued descendants without occupying a lane.

The fixed-suite runner also reports empty discovery files when a name pattern excludes all their cases; those records are not claimed as additional PostgreSQL scenarios. The eight named cases use real public HTTP/PG and deterministic direct runner calls, with exact fixture cleanup and no skips. No actual model, protected inventory, browser or Docker request was made by this correction owner. Normal server tests use their owning controlled loopback sinks. Complete corrected PG/process and fresh independent review remain with the coordinator.


## Owner validation and integration checkpoint

Final bounded-edge source passed all eight named dependency PG cases again, zero failures/skips. The runner reported 21 records because 13 excluded discovery files contain no matching named test; only the eight named cases are claimed here. The maintained normal server suite passed **58/58**, including the existing model/provenance checks.

Passed checks: intake-server TypeScript, shared runtime readability ESLint, focused source ESLint, full Prettier check, focused Markdown lint and whitespace check. Reproducible commands from repository root use the pinned workspace toolchain:

```sh
pnpm --filter @invimport/intake-server test
pnpm --filter @invimport/intake-server typecheck
pnpm lint:readability
pnpm format:check
pnpm exec remark docs/handovers/bench-intake-T06-dependency-currency.md intake-server/src/processing/ARCHITECTURE.md --frail --no-stdout
node intake-server/scripts/run-media-pg.cjs 'replaced predecessor|ready output and transitive|stale predecessor question|running output checks ancestors|retained (missing|extra) dependency edge|fresh research answer|cancelled transitive predecessor' all-pg
```

The fixed-suite runner reuses only private owned PostgreSQL helper state and creates isolated fixture namespaces; it does not start/restart a service or discover the original environment. The coordinator granted the exclusive index checkpoint for only the seven Processing runtime/schema files (including the new dependency module), focused PG test, this handover and owning architecture. Coordinator qualification/wave3 documentation remains unstaged and outside this commit.

The coordinator will publish, run complete corrected PostgreSQL/process tiers with current immutable images and obtain fresh exact-head independent review. This owner does not claim whole-feature clearance, final hosted CI or merge readiness.
