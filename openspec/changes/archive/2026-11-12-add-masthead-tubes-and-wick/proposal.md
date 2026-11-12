# Change proposal

## Problem and intended outcome

The masthead electronics current drifts a set of modelled parts (resistors, capacitors, ICs, switches, displays) behind the wordmark. Mitch designed four further parts on the masthead design canvas: an octal vacuum tube, a 5U4 rectifier, an IN-14 style Nixie tube and a solder wick dispenser whose loose end hangs and swings. He asked for them to be added to the app's masthead.

Afterwards, these four parts appear among the drifting parts in both themes, following the canvas designs.

## Change identity and linked items

Change name: `add-masthead-tubes-and-wick`. Branch: `feat/add-masthead-tubes-and-wick`. Subjects: `feat(add-masthead-tubes-and-wick): …`.

Linked BI items: none. This is decorative masthead polish that Mitch requested directly, and it has no backlog entry.

## Current behavior and evidence

- `frontend/src/electronics-current/catalogue.ts` registers 43 part types and their weights. Builders live in `parts/*.ts`, and each returns a `PartModel` (`part-model.ts`).
- `outline-kit.ts` draws parts in the outline style. It offers `body`, `detail`, `lead` and `glass` meshes, LED and display materials, and theme re-tinting through `setTheme`.
- `parts/displays.ts` drives segment displays through `updateDisplay` with `text`, `count` and `seven` modes.
- `scene.ts` owns placement, motion, recycling and disposal. Every part's geometry is a child of its own group. No part currently has geometry that moves independently of that group.
- The `ui-design-system` spec requires the current to keep its behaviour in both themes, with outlines at least 3:1 against the masthead ground.

## Scope and non-goals

In scope:

- The octal tube: noval-style straight glass on a bakelite base, with a plate, micas, a getter, a heater glow and 8 pins.
- The 5U4 rectifier: a tall base with 8 pins and a key spigot; glass that tapers out to a 45° shoulder, a narrower top and a dome; twin plates with filaments reaching almost to the dome.
- The Nixie tube: ten stacked wire-formed numerals counting 0–9. The lit numeral is thicker and is never hidden by the unlit ones.
- The solder wick dispenser: a clear dish-shaped case, a coloured label ring, a copper coil, and a short loose end that hangs under gravity, swings as the dispenser moves and reacts to the pointer.
- Slightly higher weights for the most common parts (resistors, ceramic and electrolytic capacitors, LEDs, diodes, TO-92 transistors, DIP ICs), so the niche additions stay occasional finds.
- Catalogue weights for the new parts, theme re-tinting for the new materials, tests and frontend architecture text.

Non-goals:

- The canvas's other experiments: the 7-pin tube, toroids and the component-library grid.
- Changes to existing part geometry, masthead layout or motion rules.

## Reuse and dependency assessment

Checked 2026-11-12 against the installed `three` 0.186.1 (`frontend/package.json`, root `pnpm-lock.yaml`).

| Option | Fit | Notes |
| --- | --- | --- |
| Extend the existing outline kit and builders (recommended) | Full | Glass, lathe/tube geometry, sprites and theme tinting already exist. `three/addons/utils/BufferGeometryUtils.js` (`mergeGeometries`) ships in the installed package, so each Nixie numeral can be one mesh. |
| A physics package (for example Rapier, cannon-es) for the loose end | Poor | A 12-point hanging strip needs only Verlet integration with distance constraints, a few dozen lines. A physics engine adds hundreds of KB, an extra runtime and a separate world to keep in sync with the scene's own motion. |
| Pre-modelled glTF assets | Poor | They would need a loader, assets and a separate pipeline, and would not follow the outline kit's theme tinting. |

The loose end's rope maths stays custom in a pure, unit-tested module. No dependency is added.

## Capabilities and impact

- Modified capability: `ui-design-system` gains a requirement for the new parts.
- Frontend only: `frontend/src/electronics-current/` and `frontend/ARCHITECTURE.md`. No server, contract or data change.
