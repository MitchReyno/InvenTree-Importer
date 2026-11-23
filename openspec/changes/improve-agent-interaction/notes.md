# Implementation notes

PR-B delivers tasks 2–4 (stepped `/2` questions and answers). The other PR bundles add their own entries.

## Changes to the plan

None yet.

## Unexpected challenges

None yet.

## Decisions made during implementation

- **2026-11-23T17:40+11:00, task 2 (PR-B):** Step and option IDs are agent-chosen slugs (`^[a-z0-9][a-z0-9_-]{0,39}$`), not UUIDs, so an agent can name them and read them back in its answer. The design left their format open.
- **2026-11-23T17:40+11:00, task 2 (PR-B):** The `/2` ask and the `/2` question DTO carry `schema_version: 'bench-intake-question/2'`, which discriminates them from `/1`; the session envelope stays `bench-intake-session/1` with a third payload variant. The `/1` DTO's `spec` no longer repeats `subject_id`, which every question now carries at the top level.
- **2026-11-23T17:40+11:00, task 2 (PR-B):** The attention item's question summary is structured (`question.steps[]` with kind, option count and assumption, null for a runner question), and the browser words it; `detail` keeps the first step's assumption.
- **2026-11-23T17:55+11:00, task 3 (PR-B):** No new profile or instruction digest is needed for the changed guidance. The `ask` schema is published only by `agents/tools/server.ts`, and the one-question sentence goes into `openingText`'s `instructions`, which are the opening user message, not the digest-checked profile instructions. Resumed sessions keep their earlier opening.
- **2026-11-23T17:55+11:00, task 3 (PR-B):** The note line separator is " — " (prompt — answer), one line per choice or text step and per number step answered in words, as planned. A note over the limit is refused naming the step whose line crosses it; an inbox payload over 32,768 bytes is refused without a step.

## Open items

None.
