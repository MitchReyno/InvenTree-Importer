# Proposal reuse assessment and Notion tickets

## Plan recorded before implementation

The user requested proposal-stage investigation of suitable external packages, dependencies and frameworks, including their pros/cons relative to existing or custom implementation. Add an explicit assessment to proposal instructions/template and shared schema practices, with design carrying forward validated decisions. Research is proportional to the actual goal, uses current primary sources and version/compatibility evidence, and does not force a dependency where simple existing code suffices.

During preparation, the user also explicitly approved the existing Bench Intake Notion workspace for tickets and requested a scrum board. Create a ticket database there, inspect the connector's supported properties/views, preserve stable BI identifiers and record any unsupported automation honestly. Notion will own ticket identity and current metadata; repository Markdown becomes a manually maintained snapshot with links. Update active schema/skill/register guidance consistently through this PR. Do not invent tickets, owners, sprint dates or delivery commitments.

Scope: project schema instructions/templates/README, OpenSpec usage and active register/skill guidance; a Notion scrum board under the already identified workspace. Keep standard lifecycle skills, native spec operations, existing branch/PR rules and application boundaries. No application runtime changes, provider calls, inventory operations or additional packages are needed. Both workstreams are owned by this agent; all edits are on a separate branch from current `interactive-app`, preserving unrelated worktrees.

## Additional task-detail requirement

The user also requested a deeper task document: multiple meaningful tasks per nontrivial change, each with sufficient detail and its own checkbox list, with nested subtasks supported. Make TDD more explicit at task level (baseline, RED, GREEN, refactor/verify) while retaining justified alternatives for documentation, behavior-preserving work and practical verification limits. Do not turn every checkbox into a separate test ceremony or create artificial tasks for trivial work.

## Implementation and verification plan

1. Inspect current Notion database/view capabilities and the destination page. Create the supported tracker structure and read it back; use stable source IDs and URLs for repository links. Create views only when supported and verify their actual grouping/filtering.
2. Add proposal reuse research: inspect current code/manifests/locks, search credible alternatives when relevant, compare fit, pros/cons, maintenance, licensing, compatibility and total adoption cost, then recommend reuse/adoption/custom work with cited evidence and explicit unknowns. Keep routine decisions autonomous within the user's authorized scope.
3. Update metadata ownership and BI allocation/reference rules without claiming automatic synchronization. Mirror any skill edits as identical real copies.
4. Validate schema and instruction/template output in disposable fixtures, Markdown, links, workflow synchronization and skill frontmatter. These instructions/config changes need meaningful structural/consistency checks; do not add tests asserting prose or rerun unrelated application suites without cause.
5. Commit, obtain independent read-only exact-head review, fix and re-review findings, push and raise a focused PR targeting `interactive-app`. Merge only after selected CI and review are clear under standing authorization.

## Current result

Created the authoritative [Bench Intake Tickets database](https://app.notion.com/p/2415a2ee1ff1454294b708cf2319c472) under the approved workspace. Data source: `collection://ac36d1dd-2861-4b08-b66f-713b7a30b3f3`. It has native BI Sequence allocation, formatted Ticket ID, Status, Type, Priority/rank, Size, Sprint, Owner, Summary, Dependency assessment, Prerequisite notes, Team, Labels, Cause, OpenSpec/PR references and system timestamps. Added paired Prerequisites/Dependents self-relations targeting this same source.

Created and fetched the saved Scrum board, Product backlog and By type and priority views; their actual grouping, subgrouping, filters, sorts and visible properties match the ticket guide. Renamed the default unfiltered view All tickets, and added an inline linked scrum board to the workspace. View IDs: scrum `40d82920-b528-8109-9a04-000c2163de86`, backlog `40d82920-b528-81fc-b08b-000c97e7ba10`, type/priority `40d82920-b528-81c1-a6f1-000cee88642e`, all `3787746b-cfea-4e42-932a-6ff7b5e0c5d1`, inline `40d82920-b528-816b-9302-000c3647b417`.

An unfiltered view query returned zero records with no further page. No dummy ticket, BI number, sprint date or owner was invented. Formula properties were created and are present in the fetched schema; their code URLs are not supported by fetch, and no real-record formula evaluation is claimed. The workflow requires reading back the first actual ticket's native/formatted ID before publishing references. SQL reports the formula columns unavailable; guidance directs page/row/view reads. Notion is authoritative; Markdown refresh remains manual with source URLs and latest check dates, not a claimed automatic sync.

Proposal instructions/template now require proportional reuse research based on current primary evidence, goal fit, trade-offs, versions/compatibility, maintenance, license/security and total adoption cost. Design carries the assessment forward and refreshes it for material changes. No additional package was needed for this implementation: it uses the already installed OpenSpec CLI and connected Notion database/view capabilities. Task instructions/template now require substantive task context/checklists, optional nested subtasks and explicit task-level RED/GREEN/refactor/verification by default for behavioral work, with justified alternatives for other work types.

Validation: OpenSpec 1.16.0 schema validation passes. Twelve disposable CLI observations pass, including normal prerequisite transitions, native spec skipping, strict behavioral/nonbehavioral validation, contradictory/malformed-delta rejection, held merge progress, nested checkbox progress (one of six complete), and native archive/main-spec compatibility. Actual proposal/design/tasks/apply instructions resolve to the project schema and templates. Both skill frontmatter validators, exact mirror comparison, active file-link checks, Markdown and whitespace pass; workflow-sync passes 8 tests. No tests pin prose wording. Unrelated application/runtime, scanner, PG/process and live integrations were not rerun for these documentation/schema/skill instructions.

Independent exact-head review and PR/hosted CI remain pending. No existing Notion documents were rewritten, and no application/provider/inventory operations occurred.
