# Planned functionality register

## Plan and scope

Create `docs/PLANNED_FUNCTIONALITY.md`, reserve `docs/planned-functionality/` with a detail-file template and usage guide, and add the mirrored project-level `planned-functionality` skill. Group index entries by type and then priority; each entry has a stable ID, a 2–5 sentence description, a detail link, current status, size and prerequisites. This is documentation maintenance only; it does not implement features or authorize application or inventory operations.

The user called the trunk `interactive-branch`; live branch discovery found only `interactive-app`, and repository initiative guidance confirms that base. Use a separate conventional branch, independent exact-head review before PR creation, selected green CI and a pinned squash merge. Preserve unrelated worktrees and local data.

No feature requests were supplied in the initial brief. Ask whether to seed documented outstanding work; until answered, prepare an empty register rather than invent product commitments. The follow-up adds priority subgroups, work size and prerequisites. No dependencies or scripts are needed: Markdown and a reusable template cover the workflow.

## Implementation and verification plan

1. Define type, priority, status and size vocabulary with explicit unknown values; use stable IDs and relative links.
2. Write the index, directory guide, detail template and mirrored skill. Keep current status only, with Git supplying history.
3. Check relative links, metadata consistency, exact mirror contents and skill frontmatter. Run Markdown lint, workflow sync and the repository's normal suite.
4. Commit, obtain fresh read-only review of the exact SHA and fix any findings before opening the PR. Verify live PR head/base and selected CI before merging.

Adverse cases for review: duplicate requests, unassessed estimates, missing or completed prerequisites, stale completion claims, conflicting metadata, moved detail files and ambiguity between product plans and delivery plans. Do not mark work done merely because a PR exists.

## Current result

The index, reserved detail directory guide/template and mirrored `planned-functionality` skill are complete. The register is intentionally empty until concrete items are supplied. Types are Feature, Fix, Improvement and Maintenance; each type groups items by Critical, High, Normal, Low or Unassessed priority. Relative size and explicit prerequisite assessment are required in both representations.

The user asked whether OpenSpec could help and requested initialization commands. Advice: install its CLI globally once, initialize in the repository, and link deeper specs from item details where useful. No OpenSpec installation or generated configuration is included in this change.

Validation: all six changed Markdown files pass remark; both skill copies pass `quick_validate.py` and recursive comparison; all document links resolve; workflow synchronization passes 7 tests. Frontend normal tests pass 144 tests; contracts pass and intake server passes 125 tests. Backend normal tests are running. Initial sandbox attempts could not use the uv cache or tsx IPC; rerunning with permitted host access resolves those environment restrictions. The pinned package manager attempted a dependency refresh with blocked downloads; local normal tests use available pnpm 8.15.3 and pinned Node 24.22.2. Hosted selected CI remains required.

Independent exact-head review and PR publication are pending. No application behavior, provider calls or live inventory writes are part of this work.
