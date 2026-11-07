# Implementation notes

Delivered in PR-A on `docs/baseline-specs`: 15 new capabilities (159 requirements), with the sources and Stage 1 spikes preserved in the change.

## Changes to the plan

- **2026-11-07, scope:** the Stage 1 spikes were added after planning started. Moving their tests out of the suite would have left `execution.adoption.inspect_binding` untested, so task 2 was added to give it standalone backend tests first.
- **2026-11-07, task 1:** the spike code is not edited to run from its new location. Its path constants mix repository and spike roots, and rewriting historical code risks changing what it proved. It runs from the `history/pre-openspec-cleanup` tag instead (design D7).
- **2026-11-07, task 4:** the overlap check grew from a one-off step into reusable tooling, wired into the sync and archive skills, because the same risk applies to every future sync.

## Unexpected challenges

- **2026-11-07, task 3:** the source documents lagged the code in many places. The SSE stream became a WebSocket carrying cursor hints. The selection model differs from the source: no candidate table and no `accepted_candidate` mode. The outbox has no claim lease, and every `/1` attempt takes the actor lane. Most identity tables were never built. Each case is recorded as "differs from implementation" in the design and kept out of the specs.
- **2026-11-07, task 3:** experience content in chapter 5 had no capability of its own and overlapped the redesign's reserved UI capabilities. The experience group produced 16 candidate requirements routed to the owning capabilities. They were folded in only where the owner verified them and found them not already covered.
- **2026-11-07, task 4:** the first run of the overlap check found that `redesign-batch-workspace` and `simplify-intake-entry` both modify `header-workflow-status`. Their requirement names don't collide, but their sync order decides the final text.

## Decisions made during implementation

- **2026-11-07, task 3:** `research-broker` is kept although only fixtures compose it (design D6), and `processing-coordination` is limited to the `/1` profiles (design D5).
- **2026-11-07, task 3:** `durable-import-execution` has 20 requirements, above the usual range, because merging them would have broken the short-description rule that strict validation enforces.

## Open items

- Unbuilt intent recorded in the design is not registered in the functionality index: the T11 identity gate, T12 release qualification, lot exclusion, enriching previously confirmed stock, and the deployment baseline.
- Three code-enforced checks have no dedicated test: `processing_channel_unconfigured`, `processing_capacity` and `agent_home_customizations_refused`.
- `openspec validate --specs --strict` warns about two over-long requirement descriptions in the existing `capture-batch-settings` spec. They predate this change, and `redesign-batch-workspace` owns that capability, so they are left to it.
- Archiving this change is a separate decision.
