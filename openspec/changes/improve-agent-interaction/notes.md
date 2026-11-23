# Implementation notes

PR-B delivers tasks 2–4 (stepped `/2` questions and answers). The other PR bundles add their own entries.

## Changes to the plan

- **2026-11-23T18:24+11:00, task 4 (PR-B):** Every session drawer now answers its questions in place, not only Inventory's, because the processing-workspace delta says "A session drawer SHALL answer a session question in place" and the Inventory requirement says options answer "as in every session drawer". A question pinned on its step page is still answered there and linked from the drawer. The frontend architecture is updated.
- **2026-11-23T18:24+11:00, task 3 (PR-B):** The synthetic session asks a two-step question about the lot's count (a number, then how it is packed) with fields `quantity` only, so the "Unclear quantity" pipeline test keeps the identity current. The fake CLI's `ask-steps` mode asks the three-step choice, number and choice question the process test answers.

## Unexpected challenges

- **2026-11-23T17:35+11:00, PR-B:** A worktree with `node_modules` symlinked from the main checkout resolves `@invimport/contracts` to the main checkout's sources, so typecheck and tests silently ran against unchanged contracts, and root `pnpm` scripts refuse a symlinked root `node_modules`. The worktree uses its own `pnpm install --frozen-lockfile` instead; the lockfile is unchanged.

## Decisions made during implementation

- **2026-11-23T17:40+11:00, task 2 (PR-B):** Step and option IDs are agent-chosen slugs (`^[a-z0-9][a-z0-9_-]{0,39}$`), not UUIDs, so an agent can name them and read them back in its answer. The design left their format open.
- **2026-11-23T17:40+11:00, task 2 (PR-B):** The `/2` ask and the `/2` question DTO carry `schema_version: 'bench-intake-question/2'`, which discriminates them from `/1`; the session envelope stays `bench-intake-session/1` with a third payload variant. The `/1` DTO's `spec` no longer repeats `subject_id`, which every question now carries at the top level.
- **2026-11-23T17:40+11:00, task 2 (PR-B):** The attention item's question summary is structured (`question.steps[]` with kind, option count and assumption, null for a runner question), and the browser words it; `detail` keeps the first step's assumption.
- **2026-11-23T17:55+11:00, task 3 (PR-B):** No new profile or instruction digest is needed for the changed guidance. The `ask` schema is published only by `agents/tools/server.ts`, and the one-question sentence goes into `openingText`'s `instructions`, which are the opening user message, not the digest-checked profile instructions. Resumed sessions keep their earlier opening.
- **2026-11-23T17:55+11:00, task 3 (PR-B):** The note line separator is " — " (prompt — answer), one line per choice or text step and per number step answered in words, as planned. A note over the limit is refused naming the step whose line crosses it; an inbox payload over 32,768 bytes is refused without a step.
- **2026-11-23T18:24+11:00, task 4 (PR-B):** Picking an option only chooses it; Send (or "Send N answers" after the summary) sends. `OptionRow`'s escape option and option detail became optional so agent options without a detail, and choices without "Something else", use the same cards. The step progress is the "Step N of M" text without the canvas's progress segments, which PR-F reworks.

## Open items

None.
