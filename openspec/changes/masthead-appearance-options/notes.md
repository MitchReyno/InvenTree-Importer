# Implementation notes

Implementation of the three masthead options is in progress on `feat/masthead-appearance-options` (PR-A).

## Changes to the plan

- **2026-11-19T13:26+11:00, task 3 (PR-A):** The field stacks at `z-index: -1` instead of `z-index: 0` with a positioned content wrapper. The negative layer paints above the root's ground and below all content without giving the app a stacking context or a new containing block, so the toast-over-menu order and absolute descendants are untouched. Design D2 and task 3.3.5 updated.
- **2026-11-19T13:26+11:00, task 3 (PR-A):** C's content-column cut-out is computed in CSS from the route's page-width token rather than measured by a ResizeObserver in `AppLayout`, so there is no Effect. Design D2 and task 3 scope updated.
- **2026-11-19T13:47+11:00, task 3 (correction):** The Batches list label and notes sit inside the list card, so they take no backing after all; only text placed directly on the page is patched. The Agents and Processing step pages' loose text (intro, loading and empty notes, the Capture link) takes the patch, and their outer cards take the shadow.

## Unexpected challenges

- **2026-11-19T13:26+11:00, task 3:** Under StrictMode, the double-run Effect started two overlapping dynamic imports of the scene chunk, and Vitest resolved the second to the real module rather than the mock. `ElectronicsCurrent` now loads the chunk through one shared module-level promise (reset on failure), which also avoids a duplicate import in the app.

## Decisions made during implementation

- **2026-11-19T13:26+11:00, task 3:** The patch mixins live in `components/ui/field.ts` and are exported through the `ui` barrel, so `primitives` does not import from `masthead`. The Settings nav and the Batches notes take one ground backing (`groundBehindOnField`) instead of per-item patches, which would have changed their widths and padding.
- **2026-11-19T13:17+11:00, task 2 (PR-A):** Field density is 19 parts per megapixel (25 on 1440 × 900, the artboards' count), within the existing 6–40 range, so a phone field holds 6 and a 4K window 40. Tune it here if the manual run shows a frame-time cost.

## Open items

- **2026-11-19T13:34+11:00, task 5:** In the app the parts keep the existing scene's scale, so behind the whole window they read smaller and fainter than the larger stand-in images on canvas boards B and C. Scaling field parts up is a design follow-up, not tracked yet.
