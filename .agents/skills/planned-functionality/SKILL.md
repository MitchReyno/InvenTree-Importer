---
name: planned-functionality
description: Create and maintain Bench Intake Notion tickets and their Markdown planning snapshots, including stable BI IDs, types, priorities, sizes, prerequisites and current statuses. Use for backlog requests and planning updates; does not implement the listed work.
---

# Planned functionality

Read `docs/notion-tickets.md` for the authoritative Notion database, fields, views and identity rules. Read `docs/PLANNED_FUNCTIONALITY.md` and the linked `docs/planned-functionality/` files for snapshot conventions. Resolve repository paths at runtime. Notion owns ticket identity and current metadata; Markdown is a manually maintained snapshot, not a second editable source.

## Capture and edit

- Read the request, relevant Notion tickets and existing snapshots first. Search by meaning as well as title to avoid duplicates. Reuse a ticket for the same deliverable; split independent outcomes and link real dependencies.
- Fetch the configured database and current data source schema through available Notion tools before writing. Preserve existing property options and actual relation targets. Do not infer current status from an old repository snapshot. If access is unavailable, prepare a draft without an allocated ID and explain what remains unsaved.
- Capture requested work faithfully. Inspect relevant source and delivery plans when needed to distinguish future work from implemented behavior. Do not turn every limitation into a commitment unless asked to seed the backlog. Ask only for material ambiguity; otherwise record the unknown.
- Create new tickets in the configured Notion database. Let its native Sequence allocate identity and read back the formatted Ticket ID and source URL before creating `docs/planned-functionality/BI-NNN-short-slug.md`. BI means Bench Intake; the displayed number is padded to at least three digits and can grow. Never write system/formula IDs, allocate from Markdown, reuse retired IDs or change filenames for title edits. Resolve uncertain create outcomes before retrying.
- Populate the structured fields described in the ticket guide: Name, 2–5 sentence Summary, Type, current Status, Priority, Size, Dependency assessment, Sprint, Team and appropriate Labels. Use Proposed, Unassessed, Unknown and Unscheduled for unmade decisions; leave unknown Owner unset. Fix tickets record sourced cause or an explicit Unknown in the dedicated Cause field.
- Keep one primary type. Use Notion prerequisite relations plus external prerequisite notes; assessed None and Unknown are distinct. Put scope, observable acceptance criteria, open questions, references and completion evidence in the ticket page. Capturing a ticket does not start implementation.

## Maintain current state and snapshots

Update Notion first and verify its resulting state, then refresh affected repository snapshots in a branch/PR. Keep only current metadata in the index/detail pair, matching the verified ticket values. Preserve the source ticket URL and latest snapshot check date. There is no automatic synchronization: if Notion changed elsewhere, open its current record before refreshing or changing metadata. Never overwrite Notion from a stale snapshot.

Group snapshot index entries by type, then priority in the defined order. Every entry keeps a 2–5 sentence description, detail link, current status, size and prerequisites. Each detail file also links its Notion source and supplies scope, acceptance criteria, dependency explanations, open questions and references. Update empty-state prose when adding the first snapshot or removing the last; keep priority headings only where populated.

Align ticket status with actual work. Blocked needs a current blocker. Done requires evidenced acceptance and merged implementation; a PR or completed OpenSpec checklist alone is insufficient. Preserve Done and Cancelled tickets/snapshots unless removal is requested, and do not present them as future commitments. Recheck dependents when prerequisites change or are cancelled. Reject cycles and self-dependencies. Merge duplicates through explicit replacement references and update dependents, preserving identity and evidence.

## Detailed planning

When the user asks to develop a ticket into a detailed plan, use standard OpenSpec lifecycle skills with the project-local `bench-intake` schema; see `docs/openspec.md`. Link existing Notion tickets and available detail snapshots from the proposal. One change may cover several related tickets; work without a ticket may state None with a reason. Notion remains authoritative for mutable product metadata. Capturing or editing a ticket alone does not start detailed planning or implementation.

## Validate and publish

Verify Notion properties, source URLs, prerequisite targets and generated IDs before publishing references. Check snapshot IDs/filenames, working links, type/priority placement, 2–5 sentence descriptions, matching current metadata and evidence for completion claims. Native/formula IDs may be unavailable to SQL; use supported page/row/view reads, following the current fetched schema.

Mirror this skill and its resources as identical real copies in `.agents/skills/` and `.claude/skills/`. Run `pnpm workflow-sync` after skill changes, plus relevant Markdown and repository checks. Use a separate conventional branch and `github-pr-tools` for PR operations targeting `interactive-app`. Obtain required independent exact-head review and selected green CI; merge only under the user's applicable authorization. Ticket maintenance grants no provider, inventory, deployment, external messaging or implementation authority beyond the actual request.
