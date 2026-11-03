# Bench Intake OpenSpec planning

The project uses the custom [`bench-intake` schema](../openspec/schemas/bench-intake/README.md) with the standard OpenSpec lifecycle skills. The integration was generated with OpenSpec 1.16.0. There are no real change proposals or maintained behavior specs yet.

## Capture, plan and identify

The [Notion ticket tracker](notion-tickets.md) owns identity, current priority, size, prerequisites, sprint assignment and status. The [planned-functionality register](PLANNED_FUNCTIONALITY.md) and its [detail directory](planned-functionality/README.md) are manually maintained snapshots. **BI** means **Bench Intake**: use stable IDs such as `BI-001`. The `planned-functionality` project-level skill creates/updates Notion tickets and reads back their allocated IDs before publishing references; title and priority changes do not change identity.

Capture a future idea in Notion first when requested, then refresh relevant repository snapshots. An item can remain a short description with unknown estimates or prerequisites. Capture does not automatically start OpenSpec planning or implementation. When detailed planning is requested, link the relevant BI Notion tickets and available detail snapshots from an OpenSpec proposal; one change may address several related items. Work without a registered item can state None with a reason.

## Schema workflow

The schema produces proposal, behavior specs, design assessment and tasks. It incorporates focused discovery, source-grounded planning, proposal-stage reuse/dependency research, testable scenarios, meaningful alternatives and detailed outcome tasks without adding OpenSpec Plus skills or another orchestrator. Proposals compare relevant packages/frameworks, existing-stack reuse and custom implementation using current primary evidence, pros/cons, compatibility and adoption cost; design carries that assessment forward.

Design is an explicit assessment for every schema-driven change. It can be brief when existing architecture suffices. Pure documentation, tooling or behavior-preserving refactors can declare `skip_specs: true` in their change metadata; then specs are intentionally skipped and no behavioral requirements are invented. Existing changes keep the schema declared in their own metadata; selecting a new default does not migrate them.

Planning-only requests stop with a reviewable plan. Existing plan-and-implement authorization can continue through apply without requesting the same permission again. The schema batches unresolved material questions, allows relevant source reads in every phase, scales verification to the work, and uses the project's correction/review rounds and publication workflow. The schema's [shared practices](../openspec/schemas/bench-intake/README.md#shared-working-practices) define the details and limits.

## Agent and CLI entry points

Use the project-level `openspec-explore`, `openspec-propose`, `openspec-apply-change`, `openspec-update-change`, `openspec-sync-specs` and `openspec-archive-change` skills. Codex accepts skill invocation such as `$openspec-propose`. Claude Code also has `/opsx:explore`, `/opsx:propose`, `/opsx:apply`, `/opsx:update`, `/opsx:sync` and `/opsx:archive` commands. No Cursor-specific integration was generated in this initialization.

Those are agent invocations. Terminal commands include:

```bash
openspec schema validate bench-intake --json
openspec new change change-slug
openspec status --change change-slug --json
openspec instructions proposal --change change-slug --json
```

The CLI is installed separately from the repository. Invoke it from the correct repository root and preserve the output paths and artifact scope it resolves. Structural validation does not establish artifact quality, user approval, live provider behavior or inventory-write authority.

## Delivery and product status

Tasks are broken into multiple coherent work units for nontrivial changes, each with outcome/scope, prerequisites, acceptance references, approach, verification and its own checkbox list. Nested subtasks are available for meaningful substeps. Behavioral tasks default to explicit baseline, RED, GREEN and refactor/verification steps; justified alternatives retain appropriate checks for documentation and behavior-preserving work. Tasks use native checkboxes for actual deliverables, including applicable review and publication work. Keep a held merge task pending. A task implemented and verified, a merged implementation, a BI item Done and an archived change are separate facts.

Merged code and acceptance evidence determine whether a BI item is Done. Archive state alone does not. Update Notion first, then manually refresh current-status snapshots and links when an authorized archive moves referenced artifacts. Do not claim automatic synchronization. Existing architecture, execution qualification and project authorization boundaries remain in force.

## Maintaining the integration

Custom schema instructions, templates and shared practices live under `openspec/schemas/bench-intake/`. Do not overwrite them when updating standard OpenSpec integration files. Changes follow the schema's [qualification guidance](../openspec/schemas/bench-intake/README.md#maintenance-and-qualification).

After updating the CLI, run `openspec update` from the repository root and inspect the generated diff. Shared standard skills have local adaptations for agent invocation and persistent user authorization. Reapply those notes to skills and native commands after regeneration, then mirror skill directories as identical real copies. Native Claude command files remain host-specific. The schema supplies planning policy; standard skills retain lifecycle ownership.

The `.agents/skills/.openspec-target` marker records the generator owner for the shared tree. Keep it generated; the workflow-copy comparison excludes only that root marker. Same-name files inside a skill remain authored resources subject to comparison.

Run `pnpm workflow-sync` after skill changes, plus Markdown and applicable repository checks. Obtain independent exact-head review before publication and selected green CI before any authorized merge into `interactive-app`. An explicit merge hold remains effective until lifted.
