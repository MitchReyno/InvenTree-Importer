# Planned functionality details

This directory holds repository detail snapshots referenced by the [planned functionality register](../PLANNED_FUNCTIONALITY.md). [Notion Tickets](../notion-tickets.md) owns identity and current metadata. There are no ticket snapshots yet.

Copy [TEMPLATE.md](TEMPLATE.md) to `BI-NNN-short-slug.md` when adding an item. Create or locate the Notion ticket and read back its allocated Ticket ID and source URL first; never allocate from Markdown. Record the source URL and latest snapshot check date; preserve IDs and filenames when changing titles. The template is guidance, not a registered item.

Keep one distinct deliverable per file. Include the current metadata, problem, intended outcome, scope, acceptance criteria, prerequisites and known open questions. Use relative links to repository evidence and complete URLs for external references. List unknowns explicitly rather than inventing estimates, approvals or implementation claims.

Use the project-level `planned-functionality` skill for additions, changes, deduplication and status maintenance. Update and verify Notion first, then refresh the index and detail file in the same PR. These files are not automatically synchronized and must not overwrite newer Notion facts. Keep current state only; do not add status histories or dated progress logs.
