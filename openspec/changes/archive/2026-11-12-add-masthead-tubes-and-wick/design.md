# Design assessment

## Context and grounding

This is a moderate, frontend-only change inside `frontend/src/electronics-current/`. Three of the parts are new geometry, and follow the existing builder pattern (`parts/*.ts` returning `createPart(group, options)`). Two things are new to the architecture:

- **Nixie numerals:** wire-formed and stacked, with a thick copy shown only while lit. This extends the display mechanism.
- **The wick's loose end:** world-space geometry that hangs freely, so it cannot be a child of the part's rotating group. This needs a small, explicit lifecycle in the scene.

The canvas designs are the visual reference: the `TintedOutline3D` and `ComponentLibrary` artboards in the private Bench Intake header animations canvas. Their prototype code is not copied verbatim.

## Goals and constraints

- Meet the [added requirement](specs/ui-design-system/spec.md).
- Keep the existing theme contract: every new material is created through the kit's tinting so `setTheme` re-tints it in place.
- Keep the scene's resource ownership. Anything a part adds to the scene is removed and disposed with that part and on `dispose()`.
- Make no change to existing part geometry or motion. Only the everyday parts' weights rise, so the niche additions stay occasional.

## Decisions and alternatives

### Tube glass and heater glow come from the kit

`glass(geometry, colour, opacity)` gains an optional opacity. The cache is keyed by colour and opacity, so recycled tubes still share materials. The tubes use a clearer glass (opacity 0.4).

A single shared, warm `tubeGlow` sprite material serves every tube. Rejected: a per-tube glow material. It would need per-part disposal and would add nothing, because the glow does not pulse.

### Nixie numerals as merged stroke meshes with an emphasis copy

Each numeral's strokes (tube geometry along Catmull-Rom curves or straight polylines) are merged into one mesh with `mergeGeometries`, so the existing display update can switch one material per numeral.

A second, thicker merged mesh per numeral is kept in a new optional `DisplayState.emphasis` map. `updateDisplay` shows it only while that numeral is lit.

Draw order keeps the lit numeral visible:

- **Unlit numerals:** a faint, translucent material that does not write depth.
- **Lit material:** draws after the unlit numerals and before the glass.

A new display mode, `nixie`, counts 0–9 like `seven` with its own font. Rejected: a separate Nixie update path. It would duplicate the step timing and the change-only material switching that `updateDisplay` already owns.

### The loose end is a hanging part the scene owns

`PartModel` gains an optional `hanging: HangingPart`:

- `objects`: the world-space meshes and lines;
- `update(frame)`;
- `dispose()`.

The scene handles its lifecycle:

- **Build:** the scene adds `objects` when it builds the part.
- **Render:** it calls `update` in `render()` after `placeAll()`, so the pin point uses the part's current pose. A new rope hangs straight down on its first update, and reduced motion only passes 0 seconds, which adds no motion, so the still frame shows the end hanging straight.
- **Removal and dispose:** it removes and disposes of the objects in `removePart`, so recycling and `dispose()` release them.

The rope maths is a pure module (`rope.ts`):

- Verlet integration under gravity, with the first point pinned to the anchor;
- a pointer nudge in the camera plane using the existing `stirFalloff`, which changes point velocities (a drag along with the pointer's motion, a push away from it, and a speed cap in units per second that never slows a point already moving faster) like the flow's stir, so it reacts the same at any frame rate;
- distance constraints over several iterations, then a pass that holds each segment at its exact length.

The wick builder turns the rope points into a flat ribbon strip and its outline, with the width along the dispenser's axis.

Rejected alternatives:

- **The ribbon as a child of the part group:** it would rotate rigidly with the dispenser instead of hanging.
- **A physics engine:** see the proposal's reuse assessment.

## State, authority and failure behavior

- **No new state outside the current:** no application state, network or storage is involved.
- **Ribbon state:** the ribbon's points belong to its part and live as long as the part.
- **Non-finite values:** NaN cannot propagate from a zero-length segment, because the constraint uses a minimum length. A degenerate width direction falls back to a perpendicular of the tangent.
- **Dispose order:** `dispose()` already removes every part before disposing the kit.
- **Ribbon materials:** the fill and edge are kit-owned and tinted, so they re-tint with the theme and are disposed with the kit.

## Verification strategy

| Area | Check |
| --- | --- |
| Rope maths (`rope.test.ts`) | Settles hanging below the anchor at its set length; follows a moved anchor; a pointer nudge moves nearby points and a fast flick keeps the rope's length; positions stay finite over long runs, including zero frame time. |
| Wick builder (`wick.test.ts`) | The hanging ribbon stays attached to the dispenser's rim through rotation; disposal releases its geometry. |
| Displays (`displays.test.ts`) | Nixie glyph coverage; exactly one numeral lit and emphasised per step. |
| Kit (`outline-kit.test.ts`) | Glass opacity variants are cached separately and shared; Nixie unlit cathodes do not write depth. |
| Scene (`scene.test.ts`) | With the catalogue forced to the wick, hanging objects join the scene with their parts, start at their dispensers' rims after each render and leave it on recycle and dispose. |
| Catalogue (`catalogue.test.ts`) | Every builder, including the new ones, produces geometry. |
| Browser | A real WebGL render in both themes, recorded as PR evidence. |

## Migration, rollout and recovery

Not applicable. The change is client-side decoration with no stored data, so reverting the PR removes it.
