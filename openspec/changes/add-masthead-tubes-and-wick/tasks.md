# Implementation and delivery tasks

## Plan context

- **Plan:** see the [proposal](proposal.md), the [design assessment](design.md) and the [ui-design-system delta](specs/ui-design-system/spec.md). Reuse recommendation: extend the outline kit and builders; no new dependency.
- **Change name:** `add-masthead-tubes-and-wick`.
- **Linked BI items:** none (requested directly).

## Completion and commit ordering

Check off an action only after it is complete and verified, and stage the `tasks.md` update with that work. Review, publication, CI and merge actions stay unchecked until they actually happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Kit materials for glass tubes, Nixie and ribbon | Behavior | None | Theme scenario |
| 2. Octal tube and 5U4 rectifier | Behavior | 1 | Requirement (tubes) |
| 3. Nixie tube | Behavior | 1 | Nixie scenario |
| 4. Hanging loose end and solder wick | Behavior | 1 | Loose-end scenarios, still frame |
| 5. Catalogue and architecture | Behavior and docs | 2–4 | Requirement |
| 6. Review and delivery | Delivery | 1–5 | All |

## PR delivery map

| PR | Tasks | Branch | Subject | Gates |
| --- | --- | --- | --- | --- |
| PR-1 | 1–6 | `feat/add-masthead-tubes-and-wick` off `interactive-app` | `feat(add-masthead-tubes-and-wick): add vacuum tubes, a Nixie tube and solder wick to the masthead` | Readability/format checks, typecheck, frontend lint, frontend tests and build; independent exact-head review clean; selected CI green |

One PR suits this change. The parts share the kit, catalogue and scene changes, and together they make one reviewable visual outcome.

## 1. Kit materials for glass tubes, Nixie and ribbon

- **Outcome:** the outline kit supplies everything the new parts need, and all of it re-tints with the theme.
  - glass with a chosen opacity;
  - a shared heater glow;
  - Nixie lit and unlit materials;
  - ribbon fill and edge materials.
- **Scope:** `frontend/src/electronics-current/outline-kit.ts`, `finishes.ts` and `outline-kit.test.ts`.
- **Verification:** `pnpm test:frontend`.

- [x] 1.1 Baseline: run the existing kit tests.
- [x] 1.2 RED: add tests that:
  - [x] 1.2.1 cache glass opacity variants per colour and opacity;
  - [x] 1.2.2 keep Nixie unlit cathodes from writing depth;
  - [x] 1.2.3 re-tint the new materials with the theme.
- [x] 1.3 GREEN: implement the materials, and add new fills to `finishes.ts`.

## 2. Octal tube and 5U4 rectifier

- **Outcome:** two glass tube builders matching the canvas designs.
- **Scope:** new `parts/tubes.ts`.
- **Verification:** the catalogue builder test; a browser render.

- [x] 2.1 Build the octal tube:
  - noval-style envelope scaled to the octal;
  - bakelite base;
  - plate, micas and getter;
  - heater glow;
  - 8 pins.
- [x] 2.2 Build the 5U4:
  - tall base, 8 pins and a key spigot;
  - tapered glass with filleted 45° shoulders, a narrower top and a dome;
  - twin plates and filaments reaching almost to the dome;
  - micas, glass press and stem wires.

## 3. Nixie tube

- **Outcome:** a Nixie display that counts 0–9 on stacked wire numerals, with a thick lit numeral.
- **Scope:** `part-model.ts` (`DisplayState.emphasis`, mode `nixie`), `parts/displays.ts` (font, `updateDisplay` emphasis) and new `parts/nixie.ts`.
- **Verification:** `displays.test.ts`.

- [x] 3.1 RED: tests for Nixie glyph coverage, and for exactly one numeral lit and emphasised per step.
- [x] 3.2 GREEN: emphasis handling in `updateDisplay` and the `nixie` mode.
- [x] 3.3 Build the tube:
  - stroke numerals merged per numeral, plus thick copies;
  - stacking order and draw order;
  - glass, back plate, glow and pins;
  - faces the viewer.

## 4. Hanging loose end and solder wick

- **Outcome:** the wick dispenser with a loose end that hangs, follows the dispenser, reacts to the pointer and is released with its part.
- **Scope:**
  - new `rope.ts` and `parts/wick.ts`;
  - `part-model.ts` (`HangingPart`);
  - `scene.ts` (add, update and remove);
  - tests: `rope.test.ts`, `wick.test.ts`, `scene-hanging.test.ts`.
- **Verification:** `pnpm test:frontend`.

- [x] 4.1 RED: tests that the rope hangs at its set length, follows the anchor, is nudged by the pointer and stays finite.
- [x] 4.2 GREEN: Verlet rope with a pinned first point and distance constraints.
- [x] 4.3 Build the dispenser:
  - clear dish-shaped case;
  - coloured label ring with a white segment;
  - copper coil and hub;
  - a ribbon strip and its edge built from the rope each update.
- [x] 4.4 RED, then GREEN, for the scene lifecycle:
  - [x] 4.4.1 hanging objects join the scene with their part;
  - [x] 4.4.2 they update after placement;
  - [x] 4.4.3 they leave and are disposed on recycle and on `dispose()`.

## 5. Catalogue and architecture

- **Outcome:** the four types are registered and weighted, and the frontend architecture describes the hanging-part lifecycle.
- **Scope:** `part-model.ts` (`PartType`), `catalogue.ts`, `catalogue.test.ts` and `frontend/ARCHITECTURE.md`.
- **Verification:** the catalogue tests and the docs consistency check.

- [x] 5.1 Add `octalTube`, `rectifier5u4`, `nixieTube` and `solderWick` with weights 1, 1, 2 and 1.
- [x] 5.3 Raise the everyday parts so the niche additions stay occasional: resistor 9 to 11; small resistor, ceramic disc, monolithic, electrolytic, LED, diode, TO-92 and DIP 2 to 3.
- [x] 5.2 Update the frontend architecture.

## 6. Review and delivery

- **Outcome:** the reviewed PR, merged into `interactive-app`.

- [x] 6.1 Run the readability, format, typecheck, lint, test and build checks.
- [ ] 6.2 Check the browser render in both themes, and record the demo video for the PR.
- [ ] 6.3 Get an independent exact-head review, repeated until clean.
- [ ] 6.4 Open the PR, wait for green CI, then merge.
