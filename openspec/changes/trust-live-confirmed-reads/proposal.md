# Change proposal

## Problem and intended outcome

After `polish-ui-styling-and-loading`, returning to Review or Processing shows cached data at once, but commands stay disabled until a verified read lands. It's usually under a second, and quiet, but it is still a wait every time.

The browser already keeps a live-update stream that refetches reads after change hints (live-updates "Live client reconciliation and polling fallback").

**What a healthy stream doesn't prove.** Reconciliation is debounced and works by invalidating queries. That leaves several gaps:

- a read that isn't mounted can stay unrefetched after a hint;
- a hint can arrive while an earlier read is still in flight;
- some commands, such as batch Pause and Resume, send no expected revision. A stale cache could therefore cause a wrong write there, not just a refused one.

**The outcome sought:** on a return visit, an audited set of commands becomes available at once when the cached read has its own proof of currency. That proof is a successful HTTP read whose request started after the newest relevant hint, for a resource the subscription covers, within the same unbroken subscription and the same resource scope. In every other case, the page waits for a read as it does today.

This is option 3 from the 2026-11-23 discussion. Mitch asked for it as its own change, after option 2.

## Change identity and linked items

- Change: `trust-live-confirmed-reads`. Subjects use `type(trust-live-confirmed-reads): …`.
- **BI-021.**
- **Prerequisite:** BI-020 (`polish-ui-styling-and-loading`), whose `useFreshRead` hook and successful-read latch are where this rule would live.

## Current behavior and evidence

- Commands are enabled only by a successful read made since the page opened (the successful-read latch, plus Review's capture-revision check; see `polish-ui-styling-and-loading/design.md`).
- The live channel delivers commit-ordered cursor hints with gap and reset handling (live-updates "Live commit-ordered cursor hints", "Live reset on gaps"). `frontend/src/components/operations/LiveUpdates.tsx` debounces reconciliation and invalidates queries; it doesn't refetch inactive ones.
- Most commands send an expected revision that the server checks, but not all. Batch Pause and Resume (`intake-server/src/agents/routes.ts`, `contracts/src/agents.ts` `AgentPauseUpdate`) carry none.

## Scope and non-goals

In scope:

- A per-query currency proof: a successful HTTP read whose request started after the newest hint relevant to that query, for a resource the subscription covers, within the current, complete subscription and resource scope.
- The proof is cleared synchronously when a relevant hint is received, before the debounced reconciliation runs, and on a gap, reset or truncation, a reconnect, the fall-back to polling, a scope change, or a failed read.
- An audited allowlist of commands that may use the proof. Each has a server-checked expected revision. Commands without one, such as Pause and Resume, keep waiting for a read made since the page opened.
- Tests for each way the proof can be cleared, and for a hint arriving during an in-flight read.

Non-goals:

- Reads restored after a reload: the stream wasn't watching, so they always wait.
- Changes to server-side revision checks, other than any the audit finds missing for an allowlisted command.

## Reuse and dependency assessment

There is no external candidate. This is a rule over the existing live channel and TanStack Query state. The design must show that every channel break clears the proof before any command trusts it.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `live-updates`: "Commands wait quietly for a verified read" (added by `polish-ui-styling-and-loading`) gains the stream-confirmed case, for allowlisted commands only.

## Impact and dependencies

- **Where the work is:** mainly the frontend (`queries/`, the live-update client). The command audit may find a revision check missing on the server.
- **Prerequisite:** BI-020 merged.
- **Trade-off:** this relaxes the rule that only a read made since the page opened can enable commands, for allowlisted commands with server-checked revisions only.

## Open decisions and assumptions

- Which commands are allowlisted: decided by the audit when this change is planned in full.
- Specs, design and tasks are written when the change is picked up.
