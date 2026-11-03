---
name: planned-functionality
description: Create and maintain the Bench Intake planned-functionality index and its linked OpenSpec changes, including BI item IDs, change names, priorities, sizes, prerequisites and current statuses. Use for backlog requests and planning updates; does not implement the listed work.
---

# Planned functionality

Maintain `docs/PLANNED_FUNCTIONALITY.md` as the repository's current item index. Link directly to OpenSpec changes; there is no separate per-item detail directory. Read `docs/openspec.md` and the project-local `bench-intake` schema for detailed planning. Resolve repository paths at runtime and use the standard OpenSpec lifecycle tools.

## Capture and identity

- Read the request, existing index entries and relevant OpenSpec changes first. Search by meaning as well as title to avoid duplicates. Reuse an item for the same deliverable; split independent outcomes and link real prerequisites.
- Capture requested work faithfully. Inspect source and delivery plans when needed to distinguish future work from implemented behavior. Do not turn every limitation into a commitment unless asked to seed the backlog. Ask only for material ambiguity; otherwise record the unknown.
- Allocate the next unused BI item number after checking the index and Git history. BI means Bench Intake; pad to at least three numeric digits and allow larger numbers. Never recycle an ID or change it for title, priority or status edits.
- Choose a short descriptive kebab-case OpenSpec change name and confirm that it does not collide with an active or archived change. Keep that canonical name stable. Every delivering branch includes the exact change name, with an optional meaningful PR suffix, and every commit/PR subject includes it as the conventional-commit scope: `type(change-name): description`. BI item IDs can be additional references; they do not replace the change name.
- Reuse an existing cohesive OpenSpec change where appropriate. Otherwise verify the initialized project and use `openspec new change change-name --description "brief intent"` to create only the requested scaffold/brief. Link the actual change directory in the index. Recording an item does not automatically generate a full proposal/design/task plan or authorize implementation.

## Index and detailed planning

Each index item has a 2–5 sentence description, canonical change name, direct OpenSpec link, current status, relative size and prerequisites. Group by one primary type and then priority in the defined order. Use Unassessed/Unknown for unmade decisions; None for prerequisites requires assessment. Update empty-state prose when adding the first item or removing the last. Keep priority headings only where populated.

The index owns mutable item metadata; OpenSpec artifacts supply detailed intent, acceptance criteria, design, task checklists and PR delivery boundaries. When detailed planning is requested, use standard lifecycle skills with the `bench-intake` schema, linking applicable BI items without creating another authoritative backlog. A change can address several related index items; work without a registered item may state None with a reason.

Keep status aligned with actual evidence. Blocked needs a current explanation. Done requires evidenced acceptance and merged implementation; an open PR, an archived change or completed task checkboxes alone is insufficient. Keep only current status in the index. Recheck dependents when prerequisites change or are cancelled; reject self-dependencies and cycles. Merge duplicates through explicit replacement references and update dependents while preserving IDs and evidence. Update links when authorized archival moves a change.

## Delivery and portability

Task plans define explicit PR bundles with covered work, rationale, dependencies, branch names and verification gates. Each top-level task belongs wholly to exactly one PR; never split its subtasks or checklist work across PRs. A PR may include one or several whole top-level tasks. If a task is too broad for a sensible PR, refine it into meaningful top-level tasks before assigning bundles. Follow the governing schema's task/PR boundary rule rather than assuming a one-to-one mapping. Check completed actions off before committing their corresponding completed work, stage the task-file update in the same commit, and leave genuinely incomplete actions unchecked. Never check a publication, review or merge outcome before it occurs.

Keep planning self-contained in the repository: do not store external ticket-service resource IDs, workspace/database/view links, or service-specific routing instructions in tracked files. No external integration is required for capture or planning. Do not inspect or mutate external resources merely to maintain the index.

Check unique BI IDs, canonical-name consistency, direct OpenSpec links, type/priority placement, 2–5 sentence descriptions, current metadata and acceptance evidence. Mirror this skill and resources as identical real copies in `.agents/skills/` and `.claude/skills/`. Run `pnpm workflow-sync` after skill changes, plus relevant schema, Markdown and repository checks.

Use separate conventional branches and `github-pr-tools` for PR operations targeting `interactive-app`. Obtain independent exact-head review and selected green CI; merge only under applicable user authorization. Item maintenance grants no implementation, provider, inventory, deployment or external messaging authority beyond the actual request.
