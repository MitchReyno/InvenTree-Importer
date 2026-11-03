# Bench Intake tickets

The [scrum board](https://app.notion.com/p/2415a2ee1ff1454294b708cf2319c472?v=40d82920b52881099a04000c2163de86) uses [Bench Intake Tickets](https://app.notion.com/p/2415a2ee1ff1454294b708cf2319c472) as the authoritative tracker in the [Bench Intake workspace](https://app.notion.com/p/40b82920b5288178b312e5153a9c6066). Notion owns ticket identity, current status, type, priority, size, prerequisites and sprint assignment. The [Markdown register](PLANNED_FUNCTIONALITY.md) and its [detail files](planned-functionality/README.md) are manually maintained snapshots with source links; they are not automatically synchronized.

## Views

- **Scrum board:** grouped by each Status option, sorted by Priority rank, with Sprint, Owner, Type and Priority quick filters. Cancelled tickets are excluded; Done remains available for completed work.
- **Product backlog:** Proposed or Planned tickets with an empty or Unscheduled sprint, sorted by priority and sequence.
- **By type and priority:** board grouped by Type and subgrouped by Priority, with status/sprint quick filters.
- **All tickets:** unfiltered table for lookup and completeness checks, ordered by sequence.

A linked scrum board is also embedded in the workspace page. No sprint, date, owner or delivery commitment is invented: Sprint initially offers only Unscheduled. Add meaningful sprint labels when work is actually planned; this setup does not create a separate sprint database, burndown automation or automatic sprint selection. Views organize work and are not access-control boundaries.

## Identity and capture

The system-managed **Sequence** allocates the native BI number. The read-only **Ticket ID** formula displays it with at least three numeric digits, such as `BI-001`; larger numbers are not truncated. Native `BI-1` and formatted `BI-001` are the same identity. Do not change the sequence prefix, write system/formula values, allocate IDs from Git history, or reuse removed IDs.

Search for an existing matching ticket before creating one. Create in this database, then read back its actual sequence, formatted Ticket ID and URL before writing repository references or filenames. No real tickets existed at setup verification; the first real capture must verify its generated values before publishing references. If a create result is uncertain, inspect for the created record rather than retrying blindly. If Notion is unavailable, prepare an unassigned draft and report what remains unsaved; do not claim a new ticket or allocate an offline BI number.

On capture, populate Name, a 2–5 sentence Summary, Type, Status, Priority, Size, Dependency assessment, Team and Labels. Use Proposed, Unassessed, Unknown and Unscheduled when the corresponding decisions have not been made. Team is Bench Intake; include an appropriate initiative, reactive or ktlo label. Leave Owner unset when unknown. Fix tickets use the dedicated Cause property for sourced cause information or an explicit Unknown explanation.

Use the ticket page body for scope, observable acceptance criteria, evidence, open decisions and detailed links. Keep OpenSpec and Pull requests properties current where applicable. A ticket-only request does not authorize implementation or launch full OpenSpec planning.

## Prerequisites and current status

Use the paired **Prerequisites** / **Dependents** self-relations for ticket dependencies. **Dependency assessment** distinguishes Unknown from assessed None and Known dependencies. **Prerequisite notes** records external requirements, explanations and current satisfaction; an empty relation alone does not prove no dependencies. Reject self-dependencies and cycles; reassess dependents when a prerequisite changes or is cancelled.

Keep status aligned with actual progress: Proposed, Planned, In progress, Blocked, In review, Done or Cancelled. Blocked needs a current explanation. A task checklist, an open PR, green CI or an archived OpenSpec change alone does not establish Done: require acceptance evidence and merged implementation. Record only current status in Markdown snapshots; Notion's platform history is not copied into a progress log.

## Repository snapshots and planning

The `planned-functionality` project-level skill updates Notion first, verifies the result, then refreshes relevant Markdown through the normal branch/PR workflow. Snapshots retain the required type/priority grouping, 2–5 sentence summary, detail link, current status, size and prerequisites, plus the Notion source URL and latest snapshot check date. Preserve stable filenames when titles change.

When Notion changes outside that workflow, Markdown can be stale. Open the source ticket for current facts; do not overwrite it from an older snapshot. No webhook, schedule or automatic synchronization is configured. Planned item creation and snapshot maintenance are separate from implementation authorization.

Detailed plans use the [Bench Intake OpenSpec schema](../openspec/schemas/bench-intake/README.md). Link existing tickets without copying mutable ticket fields into another authoritative backlog. Proposals assess reuse and dependencies; task plans contain detailed checklists and proportionate TDD/verification work.

## Connector operation and verification

Fetch the database to resolve its current data source before reading or writing. The source created for this tracker is `collection://ac36d1dd-2861-4b08-b66f-713b7a30b3f3`. Inspect actual properties and relation targets rather than relying on remembered schemas. Ticket ID and Priority rank are formulas and were reported unavailable in SQL queries; use supported page/row/view reads instead of inventing SQL columns.

Setup verification checked the parent workspace, property types/options, self-relation targets, saved view grouping/filter/sort configurations and an empty unfiltered view. It did not create a dummy ticket, consume a BI number or claim runtime verification of formula values on a real record. Read back the first actual ticket's generated values during normal capture.
