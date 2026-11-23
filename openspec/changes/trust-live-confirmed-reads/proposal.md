# Change proposal

## Problem and intended outcome

After `polish-ui-styling-and-loading`, a return to Review or Processing shows cached data at once, but commands stay disabled until a fresh read lands. This is usually under a second and is now quiet, but it's still a wait every time.

The browser already holds a live-update stream that refetches reads after each change hint (live-updates "Live client reconciliation and polling fallback"). Suppose a read was refreshed after the latest hint, and the stream has been healthy since, with no gap, reset or reconnect. Then that read is as current as a fresh one, and could enable commands at once.

The outcome is that commands are available immediately on a return visit when the stream vouches for the cached read, and wait for a read as today whenever it can't.

This is option 3 from the 2026-11-23 discussion. Mitch asked for it as its own change, after option 2.

## Change identity and linked items

- Change: `trust-live-confirmed-reads`. Subjects use `type(trust-live-confirmed-reads): …`.
- **BI-021.**
- **Prerequisite:** BI-020 (`polish-ui-styling-and-loading`), whose `useFreshRead` hook is where this rule would live.

## Current behavior and evidence

- Commands are enabled only by a read made since the page opened (`isFetchedAfterMount`, plus Review's capture-revision check). See `polish-ui-styling-and-loading/design.md`.
- The live channel delivers commit-ordered cursor hints with gap and reset handling (live-updates "Live commit-ordered cursor hints", "Live reset on gaps"). Clients refetch after hints and poll when the channel is not live.
- The server checks expected revisions on commands. A command made against a stale revision is refused (`stale_question`, `revision_conflict` and the like), so a wrong cache can't cause a wrong write; it causes a refused one.

## Scope and non-goals

In scope:

- A "confirmed by the stream" mark on a cached read: refreshed after the newest hint for its scope, while the channel stayed healthy and unbroken since.
- `useFreshRead` treating such a read as `current` for commands.
- Clearing the mark on any gap, reset, reconnect, polling fallback, scope change or failed read.
- Tests for each break.

Non-goals:

- Persisted reads after a reload. They always wait, because the stream wasn't watching while the tab was gone.
- Changing server-side revision checks.

## Reuse and dependency assessment

There's no external candidate. This is a rule over the existing live channel and TanStack Query state. Its design must show that every channel break clears the mark, before it is trusted.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `live-updates`: "Commands wait quietly for a current read" (added by `polish-ui-styling-and-loading`) gains the stream-confirmed case.

## Impact and dependencies

- **Code:** frontend only (`queries/`, the live-update client).
- **Prerequisite:** BI-020 merged.
- **The trade-off:** this relaxes the rule that only a read made since the page opened can enable commands. Server revision checks remain the guarantee against wrong writes. A missed hint would mean a refused command, not a wrong one.

## Open decisions and assumptions

- Whether the rule applies to every workspace, or only to Review and Processing first. To decide when this change is planned in full.
- Specs, design and tasks are written when the change is picked up.
