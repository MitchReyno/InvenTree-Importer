# Design assessment

## Context and grounding

This is a documentation/schema/skill change. Standard OpenSpec lifecycle skills remain the drivers; the project schema supplies planning instructions. Existing application architecture and runtime boundaries are unaffected.

## Goals and constraints

Use repository-owned item metadata and direct OpenSpec links, stable canonical change names, explicit PR bundles, and truthful completion marks committed with completed work. Do not contact external resources or rewrite merged history. Keep the accepted proposal research and flexible TDD guidance.

## Decisions and alternatives

### Decision: Direct OpenSpec detail ownership

The index owns current BI item metadata and links directly to actual OpenSpec changes. Capture may create only a brief scaffold. Remove the duplicate detail directory and retired integration guide. Keeping another per-item detail copy was rejected because it duplicates the change's intent/design/tasks and encourages drift.

### Decision: Stable names for delivery identity

Use one short descriptive kebab-case slug for the active change directory, all delivering branches and conventional commit/PR scopes. Separate PR branches may add meaningful bundle suffixes. BI remains an independent stable item reference. A native archive may add its normal date prefix without changing the canonical slug.

### Decision: Evidence before completion bookkeeping

Check completed actions before committing their corresponding completed work and stage the task-file update with it. Keep incomplete actions unchecked. Review/publication/CI/merge results are recorded only after they occur; the commit rule does not justify pre-checking future events. An enforced commit hook was rejected as unnecessary runtime/tooling work outside this instruction-focused change.

### Decision: PR scope is a delivery decision

The plan will include explicit PR bundles, work coverage, rationale, real dependencies, branch names and gates. The unresolved top-level-task splitting constraint must be clarified before finalizing this part of the schema.

## State, authority and failure behavior

Only repository files change. No external integration is accessed, mutated or deleted. Remove specific resource references from historical records while preserving their meaningful validation facts; history itself is unchanged. Capture creates no application implementation authority.

## Verification strategy

Run schema validation and enriched instruction/progress checks in disposable fixtures; inspect nested-checkbox behavior, spec skipping and native lifecycle compatibility. Run Markdown/link audits, complete tracked-reference and filename scans, skill validators/mirror checks, and workflow-sync. Independent read-only review verifies policy consistency and the final PR map. Application, scanner and live integration tests are not relevant to these prose-only policy changes.

## Migration, rollout and recovery

There are no real item detail records to migrate and no live data migration. Removing repository integration guidance leaves external resources as they are. Reverting the PR would restore repository instructions, not perform external operations. Existing changes retain their declared schema; future planning follows the updated template.

## Risks and open decisions

The task-to-PR constraint is ambiguous and pending clarification. Canonical naming and checkbox ordering are instructions rather than mechanical enforcement, so commits require staged-diff inspection and the normal independent review gates.
