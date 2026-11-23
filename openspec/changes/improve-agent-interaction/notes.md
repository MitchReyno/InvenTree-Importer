# Implementation notes

Implementation is under way: PR-F (tasks 8 and 9) is being built, and the other PRs are in progress or waiting on their prerequisites.

## Changes to the plan

None.

## Unexpected challenges

- **2026-11-23T19:05+11:00, task 9 (PR-F):** The D42 canvas board wasn't reachable from the implementing session, so the bar and row design follows D42's entry in the design log and the spec scenarios.

## Decisions made during implementation

- **2026-11-23T17:48+11:00, task 8 (PR-F):** A step's `waiting` counts jobs in `waiting_for_user` or `waiting_for_login`, since both wait for something only the operator can give, and `queued` counts `queued` and `waiting_for_capacity`. The design said only "waiting for the operator" and "queued".
- **2026-11-23T17:48+11:00, task 8 (PR-F):** `paused_batches` is an array of `{batch_id, title}` with a separate top-level `paused_truncated`, matching the read's existing `work_truncated` and `sessions_truncated`, rather than an object holding both. The new count fields, `paused`, `lots` and `current` are required, not optional: the server and frontend deploy from one build, and a tab from before the deploy shows the existing unavailable state.
- **2026-11-23T17:48+11:00, task 8 (PR-F):** The header and attention reads share one count, `countStageWork` in `processing/steps.ts`, so the attention read's per-step questions and failures now come from the jobs rather than from its item list; the values are the same. The inbox's per-step counts keep their three fields (`countSteps`), since its contract wasn't in scope.
- **2026-11-23T18:57+11:00, task 9 (PR-F):** `polish-ui-styling-and-loading` had merged only its plan, so PR-F adds the shared `WorkState` type, `StatePill` and `EventTime` in `components/ui` with polish's seven state words and its time format ("Today 13:35", "Yesterday 23:56", "Fri 20 Nov · 21:09", the year outside the current one, the device's clock, the full date and seconds on hover). Polish adopts them and still owns migrating the other screens' words and times and replacing `stateWords`; PR-F uses them only in the activity popover, the bars and the gallery.
- **2026-11-23T18:57+11:00, task 9 (PR-F):** Examine is done when every counted Examine job is ready (the lead job, plus any legacy Reading or Identifying job), since the counts carry no separate lead state, and it never shows a share: done fills it, in progress tints it. A lot stage fills to `ready_lots / lots` in every state, failed and queued included; an uncounted done or failed stage fills in full and any other uncounted stage tints its whole bar.
- **2026-11-23T18:57+11:00, task 9 (PR-F):** A queued stage's pill reads "Queued", as the spec's scenario has it, not D42's "Queued · 3"; a working one reads "N working". Each state's bar has its own colour and pattern (working striped with a moving sheen, still under reduced motion or from a stale read; paused hatched; queued outlined; not started faint), and the rows carry the glyph and word. On a phone the workflow details take the window's width less the existing gutter rather than a separate sheet component.
- **2026-11-23T18:57+11:00, task 9 (PR-F):** The Processing overview's bar uses the same derivation from its own snapshot. For that, Processing's step counts now count `waiting_for_capacity` as queued rather than waiting, matching the header read, and gain `readyLots` and `lots`.
