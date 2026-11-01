# Markdown readability follow-up

## Prospective plan

Mitch requested a separate follow-up to fix dense Markdown and add guidance. This task starts from merged formatting PR #43 (`ff6efbe3336d537ea12ab92220923c95b8dff7d7`) on `docs/markdown-readability`. No content edits preceded this plan.

### Scope and ownership

Edit these maintained reading paths:

- Shared, frontend and intake-server code guidelines.
- Bench Intake operations and data-model identity/execution chapters.
- The active formatting handover, keeping its historical claims and evidence truthful.

Add this task record. Capture concurrently owns application implementation, architecture, experience and implementation-plan documents; do not edit those or import its unmerged branch. All existing worktrees and changes remain intact.

### Editorial approach

Read each document in full before editing. Separate prerequisites, actions, outcomes and exceptions into coherent paragraphs or lists. Add descriptive subheadings where they help navigation, preserving existing anchors. Remove repeated explanations only where the owning statement remains explicit. Keep commands, safety constraints, error/state names, versions, links and evidence.

Add concise Markdown guidance with an example. Keep source paragraphs unwrapped; fixed-width line wrapping does not solve rendered readability. Preserve code, tables, diagrams and original references. No formatter, package or runtime change is needed: existing remark owns Markdown and accepts this structure.

Frontend guidance must also record Mitch's explicit convention: styled-components and separate component TSX files under `frontend/src/components/`. This is a required implementation direction; capture owns the migration and version qualification. Do not claim it has already merged or change its current palette/layout.

### Sequence and verification

1. Read and revise the seven agreed documents, recording substantive choices here.
2. Inspect the full diff for lost constraints or changed claims; compare links, existing headings, code blocks, numeric/version evidence and explicit prohibitions.
3. Run maintained remark checks, whitespace checks and relative-link checks. Review representative rendered Markdown structure through headings, lists and short paragraphs; paragraph size is a diagnostic, not a quota.
4. Commit and publish a ready non-stacked PR to `interactive-app`. The coordinator assigns fresh independent review and checks selected CI before any merge.

No inventory/provider access, credential copying, service allocation or shared hook installation is part of this task. Runtime tests are not required for prose-only edits; no runtime behavior change or fresh full-suite claim is made.

## Implemented edits

The seven approved files now separate access prerequisites/results, cumulative contribution-history cases, ownership failure handling and backup/restore steps. Existing schema/threat/evidence tables and diagrams remain intact. The formatting record distinguishes initial qualification, resumed checks and later executor qualification, preserving chronology and failures rather than retroactively upgrading evidence.

Shared guidelines now explain paragraph focus, descriptive headings, useful lists/tables, direct wording and rendered reading order, with a short cancellation example. They retain one source line per paragraph/list item and explicitly reject word quotas and unnecessary fragmentation. The three guideline documents were also tightened instead of merely adding more prose.

Frontend guidance replaces the former stylesheet direction with Mitch's explicit styled-components and one-component-per-TSX-file convention. It names the required `frontend/src/components/` structure and preserves palette/layout. Capture owns the migration and tagged-template qualification; this PR changes no styling tool, dependency or component.

## Verification and limits

Read all seven documents and inspected their diffs. The semantic review retained these contracts:

- Every-load complete permission/scope qualification, denial/unverified distinctions and per-request actor/object checks.
- Exact quantities, immutable identities, atomic preparation/approval records and cumulative history across rounds.
- Unknown-write blocking, original-run recovery, process exclusion and no automatic replay/force-clear.
- External restore activation, native credential boundaries and no authorized live transition from design publication.
- Historical test counts, versions, failed setup attempts and observed-versus-untested distinctions.

A temporary check using the installed unified/remark Markdown parser compared the base and edited trees. It confirmed every existing heading, link destination, inline contract token, code/diagram body and original table cell content remained. Relative links/anchors resolve, and every prose/list paragraph occupies one source line. This is structural verification plus manual semantic review, not a proof that arbitrary wording changes are equivalent.

Parsed paragraph diagnostics (including list items, excluding table cells/code):

| Document            | Longest paragraph before → after, words |
| ------------------- | --------------------------------------- |
| Shared guidelines   | 125 → 44                                |
| Operations          | 115 → 65                                |
| Formatting record   | 147 → 90                                |
| Identity            | 135 → 64                                |
| Execution           | 164 → 63                                |
| Frontend guidelines | 48 → 44                                 |
| Server guidelines   | 52 → 39                                 |

These measurements describe this edit, not an enforced threshold. Added structure and removed repetition make the safety requirements easier to locate; they were not deleted to meet a size target.

Installed pinned tooling with `pnpm install --frozen-lockfile --offline`: 505 packages reused, zero downloads, lock unchanged. Targeted remark and final whitespace/changed-file checks are recorded below after completion. The first remark check caught a missing final newline in the edited formatting record; corrected it without changing meaning.

No runtime tests, actual browser Markdown render or formatter tagged-template qualification was performed in this prose-only task. Earlier PR43 runtime evidence remains historical. No inventory/provider request, root environment access, credential copy, service change or shared hook installation occurred.

## Review and remaining work

Publish ready to `interactive-app`; fresh independent review and selected CI remain coordinator gates. No local reviewer approval is claimed here. The host provides no subscription API, so the coordinator polls exact-head CI and feedback with github-pr-tools.

Capture-owned architecture, experience, plan and application docs remain untouched while its work is active. Assess their remaining density after integration rather than importing an unmerged branch. Backend README/architecture also contain dense prose but are outside this bounded first follow-up.

Final local result: all eight changed/new Markdown files pass targeted `pnpm exec remark ... --frail --no-stdout`; `git diff --check` is clean. The final changed-file inspection contains only the seven approved documents and this new task record. No source, lock, generated artifact, reference asset or capture-owned document changed.
