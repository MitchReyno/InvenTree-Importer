# OpenSpec planning

OpenSpec is initialized with the `spec-driven` schema. There are no feature proposals or maintained behavior specs yet. The CLI is installed separately from the repository; this setup was generated with OpenSpec 1.16.0.

## Relationship to planned functionality

The planned functionality register at `docs/PLANNED_FUNCTIONALITY.md` owns the overview of item type, priority, current status, size and prerequisites. Per-item detail files under `docs/planned-functionality/` can link an OpenSpec change when the work benefits from requirements, design and task breakdown. Small fixes do not require an OpenSpec change.

Keep priority and status in the register and item detail, rather than adding a competing backlog in OpenSpec. When archiving a change moves its files, update any item links in the same PR. Merged code and acceptance evidence determine completion; archive state alone does not establish Done.

## Agent entry points

Use the project-level `openspec-explore`, `openspec-propose`, `openspec-apply-change`, `openspec-update-change`, `openspec-sync-specs` and `openspec-archive-change` skills. Codex accepts skill invocation such as `$openspec-explore`. Claude Code also has `/opsx:explore`, `/opsx:propose`, `/opsx:apply`, `/opsx:update`, `/opsx:sync` and `/opsx:archive` commands. No Cursor-specific integration was generated in this initialization.

These are agent commands or skills. Terminal commands include `openspec --version`, `openspec list --json` and `openspec validate --all`. Follow repository authorization, review and PR rules when using any workflow.

## Updating the integration

Run `openspec update` from the repository root after updating the CLI, then inspect the generated diff. The shared skills contain a local invocation note explaining the mapping between Claude command examples and project-level skill names. Reapply that note and mirror all six skill directories as identical real copies after regeneration; native Claude command files remain host-specific.

The `.agents/skills/.openspec-target` marker records the generator's owner for the shared tree. Keep it generated; it is excluded only at the skill root from authored-skill copy comparisons. Files with the same name inside a skill remain subject to comparison.

Run `pnpm workflow-sync` and Markdown lint after updates. Keep changes on a separate branch and PR targeting `interactive-app`; obtain independent review and green selected CI before merging. The existing architecture and delivery plans remain authoritative for implemented boundaries and qualification limits.
