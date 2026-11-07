# Change proposal

## Problem and intended outcome

Planning moved to OpenSpec on 2026-11-03, but the repository still asks for a comprehensive handover for every piece of work. `docs/handovers/` now holds 73 files and about 10,000 lines. The recent ones run to 750–860 lines, mostly review-round logs, test counts and command transcripts that duplicate the PR description and CI. Architecture documents link to about 20 of them as "evidence", which mixes history into documents meant to describe the current code.

The outcome: no more handover documents. Each OpenSpec change gets a short `notes.md`, written during and after implementation, that records only what the plan and the code cannot: departures from the plan, unexpected challenges, decisions the design left open, and open items. The existing handovers are migrated into those notes or retired, and live documents stop pointing at them.

## Change identity and linked items

Canonical name: `retire-handover-documents`. Branch `docs/retire-handover-documents`; subjects `docs(retire-handover-documents): …`.

Linked BI items: none. This is repository process and documentation maintenance, not product functionality, so it has no index entry.

## Current behavior and evidence

- `AGENTS.md`, `CODE_GUIDELINES.md`, the `bench-intake` schema's apply instruction, its README and tasks template, `docs/openspec.md`, `intake-server/CODE_GUIDELINES.md` and `intake-server/TESTING.md` all require a "maintained" or "comprehensive tracked" handover. No skill mentions handovers.
- The [schema format](https://github.com/Fission-AI/OpenSpec) accepted by the installed CLI (1.16.0) allows `id`, `generates`, `description`, `template`, `instruction` and `requires` per artifact. There is no optional-artifact flag.
- The propose skill only builds artifacts in the apply-required closure. The archive skill warns about any artifact that is neither `done` nor `skipped`.

## Audit of planning and history documents

### Handovers (`docs/handovers/`, 73 files)

| Group | Files | Disposition |
| --- | --- | --- |
| Linked to an OpenSpec change | `simplify-intake-entry`, `local-inventree-dev` (+ planning), `portable-pr-planning`, `capture-tab-uplift`, `status-signalling-uplift`, `batch-settings-overhaul` (+ planning) | Distilled into that change's `notes.md`, then deleted. |
| Linked to a change under active edit | `redesign-batch-workspace` | Kept for now: another session is still adding to that change. Migrate it in a follow-up once that work lands. |
| OpenSpec tooling set-up | `openspec-setup`, `planned-functionality`, `proposal-reuse-and-ticket-planning` | Deleted. The current policy is in `docs/openspec.md` and the schema. |
| Pre-OpenSpec delivery (T00–T10 and their sub-tasks, waves, design/dev-stack/form/query/readability work, Drizzle conversions, spikes, import-execution stages 0–7 and demo, CI/lint/layout tooling, data-model and design packages) | The remaining 61 files | Deleted. They describe finished work; the code, architecture documents and Git history (they are present at `2d852e2`) hold what is still true. |

### Requirement and plan documents

These are handled by a follow-up change, `baseline-specs`, not by this one, because they hold requirements that should become synced specs under `openspec/specs/` first.

| Document | What it is now | Proposed disposition |
| --- | --- | --- |
| `docs/bench-intake/01`–`07` | Whole-application design written before implementation; its banner still says "proposed, not implemented" | Convert still-true requirements into baseline specs, checked against the code, then delete. |
| `docs/bench-intake/08-implementation-plan.md`, `09-package-candidates.md` | T00–T10 task plan and package shortlist; delivered | Delete; no requirements to carry over. |
| `docs/bench-intake/reference/` | Original mockups | Keep: used by the formatting tests, pre-commit and current changes. |
| `docs/bench-intake/evidence/` | Browser evidence per task | Keep for now; notes and architecture link to it. Review in the follow-up. |
| `docs/typescript-data-model/` | Logical schema proposal; the Drizzle schema now owns it | Carry invariants into baseline specs, then delete. |
| `docs/intake-design.md`, `docs/intake-plan.md` | Post-spike proposal and plan, superseded by the TypeScript design | Delete; repoint `ARCHITECTURE.md`. |
| `docs/import-execution-design.md`, `-contracts.md`, `-plan.md` | Python durable-import design, contracts and stage plan (stage 7 complete) | Convert contracts into baseline specs for the backend import; delete the plan and design; update `AGENTS.md` and `backend/` references. |
| `docs/repository-layout.md` | Layout guide whose scaffold paragraph is stale | Keep; correct the stale description. |
| `docs/development.md`, `import-demo.md`, `import-run.md`, `digikey-api/`, `InvenTree API.yaml`, `PLANNED_FUNCTIONALITY.md`, `openspec.md` | Current guides and indexes | Keep. |

## Scope and non-goals

In scope: the `notes` schema artifact and template, rule changes in the instruction files and the apply skill, the notes migrations, deleting the retired handovers, and removing handover links from live documents.

Not in scope: converting requirement documents into specs or deleting them (the `baseline-specs` follow-up), the `redesign-batch-workspace` handover and change directory, and syncing or archiving any change. Git history is not rewritten.

## Reuse and dependency assessment

Not applicable to runtime code. The notes file reuses the installed OpenSpec CLI's own artifact mechanism (`openspec instructions notes`, status tracking and the archive warning) rather than a convention described only in prose. Rejected: a plain convention with no schema artifact, which the archive step could not check; and keeping handovers with a length cap, which would keep the duplication with PR descriptions.

## Capabilities

### New capabilities

None.

### Modified capabilities

None. The change declares `skip_specs: true`: it changes repository process and documentation, not product behavior.

## Impact and dependencies

- The schema gains a `notes` artifact that requires `tasks`. Every existing change now shows `notes` as `ready` until it has a `notes.md`, and `isPlanningComplete` stays false until then. The propose and apply skills use the apply-required set, so planning and implementation are unaffected.
- The `baseline-specs` follow-up depends on this change only for the notes convention.

## Open decisions and assumptions

- Assumed: deleting retired handovers from the tree is acceptable because Git history keeps them at `2d852e2`.
- Assumed: checked task items in archived changes that say "update the handover" stay as written, since they describe what happened at the time.
