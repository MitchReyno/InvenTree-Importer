# Implementation notes

BI-001 was delivered in three PRs: tasks 1–2 in [#75](https://github.com/MitchReyno/InvenTree-Importer/pull/75), task 3 in [#76](https://github.com/MitchReyno/InvenTree-Importer/pull/76) and tasks 4–5 in [#78](https://github.com/MitchReyno/InvenTree-Importer/pull/78). Purchase-order controls remain disabled until PO creation is supported.

## Changes to the plan

- **Proposal:** the original mockup's purchase-order fields conflicted with the no-PO-creation boundary. The decision was to show them disabled and greyed out rather than drop them.
- **Task 2 (PR-A):** the read projections that Review and the viewer consume were verified in task 2. Showing notes in those views stayed in task 4, and the final journeys in task 5.
- **Task 3 (PR-B):** per-lot context became part of the existing atomic lot edit instead of a separate sequential save.
- **Task 3 (PR-B):** review found that the shared composer had lost the Batch/Part/lot note scope selector. The fix restored it through an additive optional `settings.note_subject_id`, validated under the Capture subject lock in the same transaction. No migration was needed.
- **Task 4 (PR-C):** batch-only instructions moved inside Batch settings. Group instructions moved next to their evidence, and `InstructionsPanel` became a batch-instruction consumer only.

## Unexpected challenges

- **Task 1 (PR-A):** splitting a lot lost per-lot context that had just been added. Split now copies explicit context. Merge keeps shared modes and marks conflicting ones unknown.
- **Task 1 (PR-A):** wrapping long notes and escape-heavy tags in metadata could push them past the frozen note limits. Group and evidence note text is now kept verbatim, with scope and version sealed separately. Capture context stores tag values as bounded, length-prefixed raw strings. A small Unicode-text validator aligns TypeBox code-point bounds with the HTTP JSON Schema.
- **Task 1 (PR-A):** a stale group instruction editor could append to a group that had already been retired. Group instruction writes now check active membership under the shared Capture lock.
- **Task 3 (PR-B):** the existing Batch command created a fresh request key on every retry. Retries now keep the exact revision, payload and key through an uncertain save. A different payload is allowed only after explicit reconciliation.
- **Task 3 (PR-B):** discarding during an in-flight save could race the acknowledgement. Discard is now fenced while a submission is pending, and request validation runs before a key is retained.
- **Task 4 (PR-C):** the batch instructions panel registered a media observer with no client, which failed on shared-cache invalidation. Duplicate filenames also produced ambiguous control labels. Both were fixed, and collision-safe labels are used only when filenames collide.

## Decisions made during implementation

- **Task 1 (PR-A):** current human context reaches Processing as labelled context notes in the existing untrusted human-note input fields. The frozen `/1`–`/4` input shapes stay unchanged. Context never becomes an executor supplier or tag choice. Scoped group and evidence context uses a new `media-inputs/3` without rewriting `/1` or `/2`.
- **Task 3 (PR-B):** right-side desktop settings were chosen over placing them above the content. At 1440 CSS pixels, evidence starts at y214 instead of y1201. The comparison is in [capture-settings evidence](../../../../docs/bench-intake/evidence/capture-settings/).
- **Task 4 (PR-C):** drag and drop uses `@dnd-kit/react@0.5.3` rather than the 6.x core API, which upstream now marks as legacy. Pointer, keyboard and touch all call the same atomic multi-move command. The rejected options are recorded in [grouped-evidence evidence](../../../../docs/bench-intake/evidence/grouped-evidence/README.md).
- **Task 4 (PR-C):** after an upload, group assignment is a separate command. If membership fails, the retained original stays Ungrouped and selected for reconciliation, and it is never uploaded again.

## Open items

- Purchase-order controls are disabled until PO creation exists.
