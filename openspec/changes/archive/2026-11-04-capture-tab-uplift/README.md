# Capture tab uplift

BI-001 is implemented and merged into `interactive-app`; the [functionality index](../../../../docs/PLANNED_FUNCTIONALITY.md) owns its current metadata. The [proposal](proposal.md), [requirements](specs/capture-batch-settings/spec.md), [design](design.md) and [task plan](tasks.md) preserve the accepted scope and delivery boundaries. The [implementation notes](notes.md) record departures from the plan and remaining limits. The selected layout places Batch settings on the desktop right and stacks it on narrow screens; the sections below retain the original request context.

## Batch settings

Move every settings panel currently reached through the **Shared details** buttons into one **Batch settings** section containing all those elements in one panel. Remove those navigation buttons; do not retain separate button-selected settings panels. At request time, entry points included Batch defaults, Batch title and Write a human note in `frontend/src/components/capture/CaptureQueue.tsx`.

Include the same elements as the original mockup's shared-details section, accounting for supplier, purchase date, storage location, tags, inheritance and visible per-item overrides as well as the existing settings. Inventory all original controls during proposal development rather than treating this list as exhaustive. The user resolved the purchase-order option: include its fields/components visibly disabled and greyed out with a clear unavailable explanation until PO creation is supported. Do not submit PO intent or create POs.

Experiment with placement before selecting the final layout: compare a right-side Batch settings panel with a full-width panel above the rest of Capture. Evaluate desktop, narrow screens, reading order, evidence visibility and editing usability; retain the current approved light/neutral palette and blue accents. Neither candidate placement is fixed by this brief.

## Main evidence panel

Bring its layout and functionality closer to the original mockup. Put three prominent evidence actions at the top: **Take photos** (camera/library), **Add document** (receipt, invoice, PDF), and **Write a note** (including pasted text). Use evidence groups to organize related material, such as the front and back of one packet, while retaining evidence identity and separate physical lots.

Use the original's named groups, group notes, per-evidence notes, add-to-group, ungroup and move-between-groups interactions as the behavior reference. Preserve an ungrouped area and assess the original selection/move and drag interactions with keyboard/touch equivalents. Groups provide context; one piece of evidence may support several items and grouping must not merge physical lots or authorize inventory operations.

## Original references and proposal follow-up

- [Preserved original mockup and provenance](../../../../docs/bench-intake/reference/README.md).
- [Interactive original mockup](../../../../docs/bench-intake/reference/bench-intake.html): Capture view.
- [Original Capture screenshot](../../../../docs/bench-intake/reference/03-capture.png).
- [Current experience](../../baseline-specs/sources/bench-intake/05-experience.md) and [contracts](../../baseline-specs/sources/bench-intake/04-contracts.md) for implemented authority and limitations.
- Existing Capture components under `frontend/src/components/capture/` for the current settings/evidence behavior.

At proposal time, assess existing components, packages/frameworks and any missing persistence contracts before custom implementation. Specify save/discard, inheritance/overrides, group identity, accessibility and adverse-state behavior, and resolve unsupported mockup controls explicitly. No dependency on the separate status-signalling uplift is implied; both should follow the same visual reference.
