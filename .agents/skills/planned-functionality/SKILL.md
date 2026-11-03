---
name: planned-functionality
description: Create, edit and maintain the interactive app planned functionality register and per-item details, including classification, priorities, sizes, prerequisites and current statuses. Use for backlog requests and planning updates; does not implement the listed work.
---

# Planned functionality

Maintain `docs/PLANNED_FUNCTIONALITY.md` and its linked files under `docs/planned-functionality/`. Read the index for field definitions and `docs/planned-functionality/TEMPLATE.md` for the detail structure. Resolve these paths from the repository root.

## Capture and edit

- Read the request and relevant existing entries before editing. Search by meaning as well as title to avoid duplicates. Update an existing item when it represents the same deliverable; split independent outcomes into distinct items and link their dependencies.
- Capture requested work faithfully. Consult relevant delivery plans or code when needed to distinguish future work from implemented behavior. Do not turn every documented limitation into a new commitment unless asked to seed the register. Ask only when missing information prevents a faithful entry; otherwise record the unknown.
- Allocate the next unused `PF-NNN` ID, checking the index, detail files and Git history. Never reuse retired IDs. Create `docs/planned-functionality/PF-NNN-short-slug.md` from the template, preserving its ID and filename across later title changes.
- Choose one primary type and group the index by type, then priority in the defined order. Use Unassessed for unclear priority and Unknown for unassessed size or prerequisites. Estimates are relative scope, not deadlines. Use None for prerequisites only after assessing them.
- Give every index item a 2–5 sentence description, detail link, current status, size and prerequisites. Keep the description and shared metadata identical in the detail file. The detail file also supplies scope, observable acceptance criteria, prerequisite explanations, open questions and references.

## Maintain current state

Replace obsolete values in both files in the same change; keep no status history or dated progress log. Check the actual work before changing status. A PR alone does not establish Done: require merged implementation into the app trunk and evidence for acceptance criteria. For Blocked, state the current blocker. Keep Done and Cancelled items unless removal is requested, and do not present them as future commitments.

Link prerequisites by PF ID with relative links and explain whether they are satisfied. External requirements need a concrete description and a source when available. Recheck dependent entries when a prerequisite changes or is cancelled; do not silently remove the dependency or infer that blocked work can resume. Reject self-dependencies and circular chains. When merging duplicates, preserve references through an explicit replacement link and update dependents rather than leaving broken links.

Update the register/directory's empty-state prose when adding the first item or removing the last. Keep priority headings only where populated. Avoid changing implementation plans, acceptance gates or application code as a side effect of backlog maintenance.

## Validate and publish

Check unique IDs, one detail file per entry, working relative links, type/priority placement, 2–5 sentence summaries and matching current metadata. Ensure every prerequisite names an existing item or a concrete external requirement; flag missing information explicitly. Confirm that completion claims match linked evidence.

Mirror this skill and its supporting files as identical real copies in `.agents/skills/` and `.claude/skills/`. Run `pnpm workflow-sync` after skill changes and the repository's Markdown checks for changed documents. Follow applicable repository checks and independent review requirements.

Use a separate conventional branch and the `github-pr-tools` skill for PR operations. The current initiative trunk is `interactive-app`; verify it rather than creating a similarly named trunk. Raise changes as PRs targeting that trunk. Merge only when authorized, independent review is clear and selected CI checks are green; pin the merge to the reviewed full head SHA. Permission to record a feature does not authorize its implementation or live application/inventory operations.
