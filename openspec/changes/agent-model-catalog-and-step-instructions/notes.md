# Implementation notes

The plan for exact provider models, an effort choice and instructions for each step, delivered as PR-A to PR-E after the plan PR. No implementation PR has started.

## Changes to the plan

None.

## Unexpected challenges

None.

## Decisions made during implementation

- **2026-11-25T15:02+11:00, planning:** step instruction edits reach only work queued after the save, not running sessions. BI-022's implementing session suggested delivering an edit as an `instruction` inbox item; that kind is bound to a batch's saved `capture_instruction`, settings are global so one edit would wake finished sessions in every batch, and the approved board keeps running sessions on their text. Recorded as an open item for Mitch.

## Open items

- **2026-11-25T15:02+11:00, task 5:** PR-D waits for BI-022's PR-A (#275, sealed briefs) to merge, then adds the `/6` field and the `/7` brief entry together for the attempts #275 seals. BI-022's provider-backed `/7` profile (PR-G1/G2) and multi-lot groups (PR-I) carry `step_guidance` from the settings snapshot they seal the selection from; task 7 (PR-F) captures the text on each queued lot and keeps groups consistent once BI-022's PR-I merges. BI-022's PR-G2 activation should follow PR-F; asked of BI-022's implementing session and listed for Mitch.
- **2026-11-25T15:02+11:00, task 6:** the live catalogue read and the two effort sessions need Mitch's go-ahead.
- **2026-11-25T15:02+11:00, planning:** whether a step instruction edit should also reach running sessions, as a new inbox kind that doesn't wake finished sessions, is Mitch's call; not planned.
