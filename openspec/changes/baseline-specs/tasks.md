# Implementation and delivery tasks

## Plan context

Canonical change: `baseline-specs`; no linked BI item (see the [proposal](proposal.md)). The [design](design.md) records decisions D1–D8, and the [coverage ledger](coverage.md) maps every source heading. Branch `docs/baseline-specs`; subjects `docs(baseline-specs): …`.

## Completion and commit ordering

Check each action after it is done and verified, and commit the `tasks.md` update with its work. Review, publication, CI and merge actions stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Move sources and spikes | Documentation/tooling | None | Proposal scope; D1, D7 |
| 2. Keep production coverage | Test | 1 | D7 |
| 3. Convert to specs, design and ledger | Documentation | 1 | D2–D6; every source heading ledgered |
| 4. Overlap check | Tooling | None | D8 |
| 5. Repoint live documents | Documentation | 3 | Proposal impact |
| 6. Sync | Documentation | 3, 4, 5 | D2; overlap check clean on the latest trunk |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Baseline specs synced, sources and spikes preserved in the change, live documents repointed | Tasks 1–6 in full | Syncing without the moves leaves two competing descriptions, and moving without syncing leaves live documents pointing at a change directory. The overlap check guards the sync in the same review | None | `interactive-app`, `docs/baseline-specs`, `docs(baseline-specs): baseline specs from the pre-OpenSpec documents` | Strict validation, overlap check, coverage check, backend and tooling tests, Markdown/format/link checks, independent exact-head review, selected CI |

## 1. Move sources and spikes

- PR delivery: PR-A.
- Outcome: the documents and the Stage 1 spikes live in this change with their history.
- Scope and approach: `git mv` of `docs/bench-intake/` chapters, README and assets; `docs/typescript-data-model/`; `docs/intake-*`; `docs/import-execution-*`; the five spikes, the spikes README and `backend/tests/spikes/`. Repair links resolved against the old locations. The reference mockups and `spikes/mcp-session-tools` stay.
- Verification: no broken relative link; prettier and eslint ignore the moved spikes.

- [x] 1.1 Move the sources and spikes.
- [x] 1.2 Repair relative links in and into the moved files.
- [x] 1.3 Update the prettier and eslint ignores, and remove `pnpm spikes:check`.

## 2. Keep production coverage

- PR delivery: PR-A.
- Outcome: `execution.adoption.inspect_binding` keeps tests in the normal suite.
- Scope and approach: `backend/tests/execution/test_adoption.py` against the real `Registry`, `RunStore` and `load_run_status`.
- TDD approach: characterization of existing behavior, proven by mutation (each branch broken in turn, then restored from a copy).
- Verification: the new tests and the backend suite.

- [x] 2.1 Write standalone tests for every branch of `inspect_binding`.
- [x] 2.2 Confirm by mutation that each branch is detected.

## 3. Convert to specs, design and ledger

- PR delivery: PR-A.
- Outcome: 15 new capability deltas, a design record and a ledger covering all 259 source headings.
- Scope and approach: five groups converted their assigned sections, checking the code for every requirement and routing candidate requirements between groups.
- Verification: `openspec validate baseline-specs --strict`; the heading-coverage check; spot review.

- [x] 3.1 Write the capability deltas.
- [x] 3.2 Assemble `design.md` and `coverage.md`, and confirm every source heading has a row.

## 4. Overlap check

- PR delivery: PR-A.
- Outcome: `pnpm openspec:overlap --change <name> [--new-capabilities-only]` reports sync conflicts. It is documented in `docs/openspec.md` and `openspec/config.yaml`, used by the sync and archive skills, and run in CI.
- TDD approach: unit tests with temporary workspaces for each conflict kind, and for the CLI exit codes.
- Verification: `pnpm test:openspec`; the CI path tests; `pnpm workflow-sync`.

- [x] 4.1 Add the checker, its tests, scripts and CI step.
- [x] 4.2 Add the step to the sync and archive skills (both mirrors and native commands) and the guide.

## 5. Repoint live documents

- PR delivery: PR-A.
- Outcome: no live document treats a moved source as current. Each points at the synced spec or a current guide.
- Scope and approach: `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `backend/ARCHITECTURE.md`, `backend/README.md`, `frontend/ARCHITECTURE.md`, `intake-server/ARCHITECTURE.md`, `docs/bench-intake/reference/README.md`.
- Verification: a search for links into `openspec/changes/baseline-specs/` from outside it; Markdown checks.

- [x] 5.1 Repoint the live references.

## 6. Sync

- PR delivery: PR-A.
- Outcome: the 15 capabilities exist in `openspec/specs/`, and no existing spec has changed.
- Scope and approach: rebase onto the latest `interactive-app`, rerun the overlap check in new-capabilities-only mode, then sync.
- Verification: the overlap check is clean; `openspec validate --specs --strict`; the diff shows only new files under `openspec/specs/`.

- [ ] 6.1 Rebase onto the latest trunk and rerun the overlap check.
- [ ] 6.2 Sync the deltas and validate the main specs.

## Delivery evidence and lifecycle follow-up

- [ ] D.1 PR-A: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization.

Archiving this change is a separate decision. Its synced specs and preserved sources stay valid either way.
