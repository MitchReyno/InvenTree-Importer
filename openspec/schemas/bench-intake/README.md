# Bench Intake schema

This project-local OpenSpec schema supplies planning and delivery guidance to the standard OpenSpec lifecycle skills. It uses source-grounded discovery, testable behavior, proportionate design and verifiable task slices. It does not install OpenSpec Plus or replace the project's engineering and PR workflows.

## Structure and lifecycle

```text
proposal → specs → design → tasks → apply
```

This schema deliberately uses specs before design, while allowing findings in later phases to revise earlier artifacts within authorized scope. `schema.yaml` defines artifact instructions and dependencies. `templates/` defines document shape. Standard OpenSpec skills own creation, status, apply, updates, synchronization and archival; project instructions and existing project-level skills own implementation standards, source access, Git, review and CI. Schema prose guides the agent; CLI validation and artifact existence do not prove approval, correctness or execution guarantees.

The project default is `bench-intake`. Use the installed CLI from the repository root:

```bash
openspec schema which bench-intake --json
openspec schema validate bench-intake --json
openspec new change change-slug
openspec status --change change-slug --json
openspec instructions proposal --change change-slug --json
```

Resolve the actual project and artifact paths through the CLI. Keep this schema with its repository; do not silently substitute a global schema or assume a machine-specific checkout path. Standard lifecycle behavior remains authoritative for resolved output paths and native spec operations.

## Capture and identification

The [Notion Tickets database](https://app.notion.com/p/2415a2ee1ff1454294b708cf2319c472) owns ticket identity, current priority, size, prerequisites and product status. The [register](../../../docs/PLANNED_FUNCTIONALITY.md) and its detail files are manually refreshed repository snapshots. See [ticket workflow](../../../docs/notion-tickets.md). Use the `planned-functionality` project-level skill for capture and maintenance. Adding an idea does not start detailed OpenSpec planning or authorize implementation.

Identifiers use **BI** for **Bench Intake**: `BI-001`, `BI-002`, and so on. Notion allocates a native Sequence; the Ticket ID formula displays it with at least three numeric digits. Create and read back the Notion ticket before using its ID; never allocate from Markdown or write the system/formula fields. IDs are permanent, never recycled, and do not encode type, priority, status or release. The numeric portion can grow beyond three digits. Native `BI-1` and displayed `BI-001` refer to the same sequence; preserve the displayed form in project references. Detail filenames retain the ID and stable slug when titles change.

A proposal links relevant existing BI Notion tickets and available repository snapshots; one change may address several related IDs. Work without a registered item can state None with a reason. Do not allocate fake IDs, treat repository snapshots as a second editable source of ticket metadata, or create a competing status history. Branches and pull requests can reference IDs, for example `feat/bi-014-bulk-lot-editing` and `feat(BI-014): add bulk lot editing`, while following governing repository conventions. Task numbers such as `1.1` remain local to the change.

## Shared working practices

### Discovery and questions

Establish the problem, outcome, scope, non-goals and impact. Reuse recent answers and inspect discoverable facts before asking. Batch related unresolved questions and include recommendations with trade-offs. Ask when a decision materially affects product behavior, scope, compatibility or authority; record reasonable minor assumptions. Do not invent alternatives to force a choice or seek approval section by section.

Inspect relevant source, tests, architecture and existing specs proportionately in any phase. Separate observed behavior from desired behavior and untested claims. Record useful evidence paths, and investigate actual integration boundaries before promising their behavior. Preserve relevant findings across phases and refresh them when material inputs change.

### Reuse research before custom implementation

Every proposal includes a reuse and dependency assessment. Inspect relevant existing code, declared dependencies and locked versions first. For goals plausibly served by external packages, dependencies or frameworks, investigate credible maintained candidates using current primary sources such as official documentation, release notes, source repositories, license terms and advisories. Search results or familiarity alone are not evidence of fit.

Compare viable candidates with extending the current stack and custom implementation. Weigh requirement coverage, strengths, limitations, maintenance, runtime/version compatibility, licensing/security, adoption effort, ongoing operational/dependency cost and relevant migration or lock-in risks. Record source links, versions/date checked, unknowns and unexecuted proof-of-fit tests. Make an evidence-backed recommendation and explain why rejected options or custom work are appropriate. There is no fixed number of candidates and no rule requiring a new dependency. For trivial or non-runtime work, explain why further ecosystem research is not relevant rather than adding busywork.

Keep the proposal focused on goal fit and feasibility, then carry its evidence into design. Refresh the investigation when constraints materially change. An assessment is not proof that an integration works and grants no additional installation, provider or live-operation authority; any evaluation stays within the existing task authorization. Ask for genuinely consequential unresolved choices, not repeated approval for routine choices already within scope.

### Authority and scope

Honor the user's existing scope and authorization. A request for planning only ends with a reviewable plan. A request that already authorizes implementation can continue through apply after planning; do not demand the same permission again. Recording a future item grants no implementation authority.

Use existing repository ownership and delegation rules. Independent reviewers inspect read-only; implementation delegation or parallelism requires the applicable authorization and isolated ownership. This schema grants no provider usage, inventory operations, deployment or external messaging permission. Respect explicit holds on merging or publication.

### Proportional artifacts

Every schema-driven change has a proposal, design assessment and task plan. Design is a required assessment, not an optional missing prerequisite: simple changes can state briefly that existing patterns suffice, with the relevant evidence and checks. Expand decisions, alternatives, accepted downsides, failure handling and migration only where justified. Consolidate repetition; do not preserve a discovery transcript or enforce document density quotas.

For a genuine nonbehavioral change, set `skip_specs: true` in its `.openspec.yaml`, retain the schema metadata, declare no capability changes and create no delta specs. Native OpenSpec marks specs skipped and satisfies that dependency. This is appropriate for pure documentation, tooling and behavior-preserving refactors, never for avoiding a behavioral contract. Existing changes retain the schema declared in their metadata; changing the project default does not migrate them.

When behavior changes, use native delta specs under the exact capability paths and preserve complete modified requirement blocks. New-capability Purpose and scenario headings must remain compatible with native validation and archive. Planning artifacts describe intended behavior; main specs should not claim unimplemented behavior merely because a proposal exists.

### Design, slicing and verification

Capture selected decisions, meaningful rejected alternatives and reasons. Prefer suitable existing libraries and research new ones when needed. Keep important state, authority, effects, compatibility and recovery reasoning explicit. A synthetic child process, fake inventory target or schema check proves only its exercised boundary.

Decompose nontrivial changes into multiple substantive tasks with explicit outcomes, scope, approach, prerequisites, acceptance references, verification and risks. Every task has a checklist; nested subtasks can capture meaningful substeps or cases. Prefer cohesive outcome slices while allowing necessary technical, investigation, migration, configuration, test-only and documentation work. A truly trivial change can justify a single implementation task. Native task progress counts nested checkbox items independently; do not check a parent action complete while its required subtasks remain incomplete. Keep acceptance traceability without forcing one PR per checkbox or serializing independent slices artificially.

Choose verification for the kind of work. Behavioral tasks default to explicit TDD-oriented checklist steps: establish baseline, write/run a regression that fails for the intended reason (RED), implement/verify the intended behavior (GREEN), then refactor as useful and recheck surrounding contracts. Record the expected failure and actual verification. A task that cannot reasonably use test-first work explains why and supplies an equivalent verification strategy; do not silently omit testing discipline. Existing and characterization tests can support refactors. Documentation needs consistency and reference checks. Tests may be parameterized or cover several scenarios; manual checks need recorded evidence. Do not test prose wording or require a test for each production line. Do not delete existing work to restart a test ceremony.

Never suppress failures or introduce skips to pass a gate. Report existing skips, unavailable environments, synthetic evidence and untested boundaries honestly. An environment limitation does not establish a passed criterion; retain the limitation or blocker while continuing unaffected work. Use the owning project's declared commands and required checks rather than generic language-agnostic test flags.

### Review, corrections and completion

Self-check every artifact for coverage, consistency, evidence and scope. Substantial plans should receive an independent read-only artifact review where available and authorized; record a missing independent review as a limitation. Fix findings, verify corrections and repeat review after material revisions until no new issues remain. Do not impose a single-shot review rule. Reconcile discovered conflicts rather than treating an earlier artifact as infallible.

Before apply, verify the complete non-skipped artifact dependency set and refresh stale inputs. An existing tasks file can be reported done even after a prerequisite file is removed; that is not permission to implement from an incomplete plan.

Before raising or updating a PR, follow the repository's required independent review of the exact candidate commit. Re-review a changed candidate or establish unchanged reviewed patches using the governing process. Use the existing Git/PR skills, conventional branches, maintained handovers and selected CI. Schema instructions do not replace branch protection or the user's merge decision.

Keep these facts distinct: a task implemented and verified, a plan ready, a PR under review, an implementation merged, and a change archived. Check a task only for its own completed deliverable. Keep publication or merge tasks pending while held. Mark a linked BI ticket Done only after its acceptance criteria and merged implementation are evidenced. Update Notion first, refresh affected repository snapshots, and update links when archival moves a change. Preserve only current status in repository snapshots and do not imply automatic synchronization.

## Maintenance and qualification

The planning practices were informed by [OpenSpec Plus 1.6.1](https://github.com/sudokar/openspec-plus/tree/311dd818f2de99d38c1f0a144fc4946895d6aed4); these files are project-authored adaptations. There is no Plus auto-update hook or additional skill orchestrator. Standard OpenSpec integration updates and custom schema changes are reviewed separately; do not overwrite the schema while regenerating skills.

After schema changes, validate structure and template resolution with the installed CLI, then exercise instructions, prerequisite transitions, skipped specs, native checkbox progress and strict validation in temporary projects. Do not create synthetic qualification items in the real register or real change tree. Record the CLI version, actual outcomes and limits in the change's handover. Structural qualification does not prove that an agent will produce a good plan; independent review and realistic exercises supply separate evidence.
