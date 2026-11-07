# Change proposal

## Problem and intended outcome

Most implemented behavior has no OpenSpec spec. `openspec/specs/` holds six small capabilities, all from changes made after OpenSpec was adopted on 2026-11-03. The requirements for everything built before then are in design and plan documents written before implementation:

- the Bench Intake whole-application design;
- the TypeScript data model;
- the post-spike intake design and plan;
- the Python durable-import design, contracts and stage plan.

Some of these documents still say "proposed, not implemented" for behavior that has shipped. Agents and reviewers therefore cannot tell which statements are current requirements, which were superseded by later changes, and which describe intent that was never built.

The outcome:

- Baseline specs in `openspec/specs/` describe current behavior, checked against the code.
- The source documents and the Stage 1 spikes move into this change as historical artefacts, so nothing is lost.
- A coverage ledger records where each section of each source ended up.
- Syncing adds only new capabilities, so it cannot overwrite or overrule requirements from later work.

## Change identity and linked items

Canonical name: `baseline-specs`. Branch `docs/baseline-specs`; subjects `docs(baseline-specs): …`.

Linked BI items: none. The change records existing behavior and does not deliver product functionality.

## Current behavior and evidence

| Source (now under `sources/`) | Lines | What it is |
| --- | --- | --- |
| `bench-intake/` (README, chapters 01–09, `assets/`) | ~1,400 | Whole-application TypeScript design (2026-11-01), the T00–T13 task plan, and the package shortlist |
| `typescript-data-model/` (README, 01–06) | ~710 | Logical schema proposal; Drizzle migrations now own the schema |
| `intake/design.md`, `intake/plan.md` | ~170 | Post-spike architecture and delivery plan, superseded by the TypeScript design |
| `import-execution/design.md`, `contracts.md`, `plan.md` | ~870 | Python durable-import design, contracts and Stages 0–7 (complete) |

The Stage 1 spikes (`combined-seams`, `durable-coordination`, `importer-adapter`, `subscription-runtime`, and the `shared` fixtures and contract) and their backend tests were investigation code for the intake design. They move to `spikes/` in this change. `spikes/mcp-session-tools` stays where it is, because it belongs to the active `simplify-intake-entry` change.

## Scope and non-goals

In scope:

- Move the sources and spikes into this change with `git mv`, preserving their history.
- Write baseline specs as `ADDED` deltas for new capabilities only.
- Record design content, superseded statements and unbuilt intent in `design.md`, and section-by-section coverage in `coverage.md`.
- Keep the production `inspect_binding` API tested outside the spike suite.
- Run an overlap check before syncing, then sync.
- Repoint live documents from the moved sources to the synced specs and current guides.

Out of scope:

- Changing behavior.
- Modifying the six existing main specs, or any capability that an active change touches.
- Editing the moved spike code. It stays as written and runs from the `history/pre-openspec-cleanup` tag.
- Archiving this change.
- Capturing unbuilt intent as BI items. It is recorded, not registered.

## Reuse and dependency assessment

Not applicable to runtime. The change uses the installed OpenSpec CLI's native delta and sync behavior. Rejected alternatives:

- Rewriting the sources into the specs and deleting the originals. That loses rationale and history, and makes a no-loss claim impossible to check.
- Keeping the sources in `docs/`. That leaves two competing descriptions of the same behavior.

## Capabilities

### Reserved capability paths

The baseline must not add or modify these paths:

- **Existing main specs:** `capture-batch-settings`, `capture-grouped-evidence`, `capture-inference-preferences`, `capture-reference-selection`, `header-connection-status` and `header-workflow-status`.
- **Claimed by `redesign-batch-workspace`:** `agents-overview`, `batch-navigation`, `changes-commit`, `processing-workspace`, `review-records`, `review-workspace` and `ui-design-system`.
- **Claimed by `simplify-intake-entry`:** `processing-agent-sessions`, `processing-lot-forming` and `processing-stage-pipeline`.

The overlap check reruns this list from the tree immediately before syncing.

### New capabilities

| Capability | Behavior it owns |
| --- | --- |
| `inventory-target-protection` | Protected targets stay read-only. Writes go only to owned fakes or designated test targets. Target profiles and the development API-key mode. |
| `access-identity` | The current development identity and access mode, and what it refuses. The final InvenTree identity gate is unbuilt intent and goes in the design. |
| `capture-records` | Batches, physical lots and shared Part proposals. Immutable human notes, exact strings and quantities, revisions and conflicts, archive and resume, defaults versus overrides. Server-side split, merge and lineage. |
| `capture-media` | Retained originals, immutable deterministic crops, decoder bounds and selected attachments. |
| `approval-preparation` | Frozen preparation, exact selected approval, unselected lots unaffected, and later approval rounds. |
| `apply-execution` | A single supervised apply owner, the journal, one actual request per effect, no generic retry, lost-acknowledgement uncertainty, recovery-required states and truthful results. |
| `processing-coordination` | `/1` jobs, attempts, questions and actor lanes, logical cancellation and reap-before-release, only where `simplify-intake-entry` does not supersede them. |
| `provider-runtime` | Provider-usage gates, the supervised native runner, and the rule that web startup never launches inference. |
| `research-broker` | Evidence access, source-fetch controls, the read-only inventory broker and its receipts. |
| `live-updates` | Event projection, the update stream, cursors and reconnect. |
| `operations-backup-restore` | Schema compatibility and readiness, private archives and quarantined restore. |
| `durable-import-execution` | The `import-run` CLI and library, the SQLite journal, the canonical registry and ownership, and the recovery commands. |
| `import-request-observation` | Announce-before-dispatch, correlated outcomes, the error taxonomy and complete reads. |
| `digikey-durable-import` | The bounded DigiKey opt-in to the durable workflow. |
| `import-demo` | The loopback stub demonstration. |

The list is final only after the specs are checked against the code. A capability with no verifiable current behavior is dropped, and its content is recorded in the design.

### Modified capabilities

None.

## Impact and dependencies

- Live documents that cited the sources (`AGENTS.md`, `ARCHITECTURE.md`, `README.md`, the backend, frontend and intake-server architecture docs, and the reference README) are repointed.
- `pnpm spikes:check` is removed. The prettier and eslint ignores cover the moved spikes.
- The redesign and simplify sessions are unaffected: no reserved path is touched. If either adds a capability before this change syncs, the overlap check catches it.

## Open decisions and assumptions

- Assumed: a requirement belongs in a spec only when the code implements it. Unbuilt intent is preserved in the design rather than synced as a requirement.
- Assumed: where a source and a later change disagree, the later change wins. The source statement is listed as superseded in the ledger and never synced.
