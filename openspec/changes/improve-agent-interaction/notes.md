# Implementation notes

Implementation of BI-019's agent interaction work, delivered PR by PR as the tasks' delivery map sets out. PR-D1 (task 5) records photo views and agent-reported web page sources; the other PRs are in progress or to come.

## Changes to the plan

None.

## Unexpected challenges

None.

## Decisions made during implementation

- **2026-11-23T17:43+11:00, task 5 (PR-D1):** Readers of the outbox union are the session timeline read (`agents/tools/timeline.ts`), the status-line readers (`agents/tools/outbox.ts`, the session list and header), the reply lookup in `handlers.ts`, and the frontend `SessionTimeline` and `SessionChatPanel`; the last two filter by kind, so only the timeline needed a `photo_view` label, "Prepared a photo for the agent", since a view may exist for an image that was withheld. Readers of proposal sources are the `propose` handler's delivery and removal checks, the retained decoder (`processing/retained.ts`), the evidence-removal staling query (`processing/currentness.ts`, which matches only delivered kinds), `processing/stable-identity.ts`, Review's records projection (`contracts/src/records-projection.ts`, which reads a proposal's catalogue whatever its version and never its sources), and the frontend `ProcessingSources` (Examine, the job cards and Review's lot evidence). No Review or Inventory path counts a source as a receipt or verified evidence beyond these, so treating `web_page` as unverified meant keeping it out of every delivery and receipt check and labelling it agent-reported.
- **2026-11-23T17:43+11:00, task 5 (PR-D1):** A web page URL is checked twice: the contract's pattern (http(s) scheme in any case, no whitespace or control characters, no `@` in the authority, at most 2048 characters) and `webPageUrlAccepted`, which also requires the WHATWG parser to accept it with a host and no credentials. A custom AJV format was rejected because the tool's JSON Schema is advertised to provider CLIs, which may not know it. The handler reports a parser refusal as a `format` issue at `/proposal/sources/<n>/url`.
- **2026-11-23T17:43+11:00, task 5 (PR-D1):** The uncertain-outcome result is a new tool error code, `outcome_uncertain`. The final fetch transaction takes the batch row `FOR SHARE`, which conflicts with an evidence removal's `FOR UPDATE`, and then the job, attempt and session rows through the same check `withSession` uses (`requireRunningSession`). A metadata-only answer (no image, or an exhausted budget) goes through the same transaction but records no view.
- **2026-11-23T17:43+11:00, task 5 (PR-D1):** `photo_view` records the requested region as `{x, y, width, height}` in page-preview pixels, like the tool result's `delivered.region`; the preview size it refers to is the page's, so the crop route in task 6 can recut it.
- **2026-11-23T17:43+11:00, task 5 (PR-D1):** A `web_page` source shows outside debug mode as a "Web page" source chip in the warn style, certainty "Agent-reported", whose popover links the page (opened in a new tab, `noopener noreferrer`). The other source identities stay in the debug-only list. The URL limit counts code points, as JSON Schema's `maxLength` does.

## Open items

- The session page's web-read entry for a cited URL is task 7 (PR-E); the photo-view crop route is task 6 (PR-D2).
