# Masthead electronics animation

Status: implemented, independently reviewed, and review findings resolved. Ready to publish as a PR to `interactive-app`. Mitch asked for it to be merged once CI is green.

## Background and chronology

Mitch asked for subtle animated electronic components flowing around the main title at the top of the page. Design exploration happened first on a private Claude Design canvas, outside the repository: five 2D concepts, then 3D variants. Mitch iterated on the "tinted outline 3D" variant, the one called H on the canvas. He then asked for it to be added to the UI as a new React component, with a PR to `interactive-app`.

This plan was written after that design exploration and before any repository code change. The canvas prototype is a reference only. It is not copied verbatim: it was a single classic-JS file written for a design runtime.

## Scope

- Replace the plain masthead in `App.tsx` with a `Masthead` component. It keeps the existing "Bench Intake" brand and "Manual workflow" label, and adds a faint square dot grid with a 3D animation behind them.
- **Animation:** isometric outline-style electronic parts with very light muted fills, drifting right to left along a gentle current. They fade out near the title and the label.
  - **Parts:** resistors (beige or blue, colour-code bands), capacitors, LEDs with a soft pulsing glow, DIP/SOIC/QFP/EPROM packages, transistors, regulators, switches, a pot, headers, a relay, a transformer and 14-/7-segment displays.
  - **Pointer:** moving the pointer over the masthead stirs nearby parts. Switches react: buttons bounce, toggles snap over and DIP sliders flip.
  - **Displays:** displays loosely face the viewer and animate their characters.
- Respect `prefers-reduced-motion`: render one static frame and never start the loop.
- **No WebGL:** if WebGL is unavailable (old browsers, jsdom tests), render nothing extra; the masthead stays as plain text.
- Load three.js lazily, so the animation never delays the application shell or enters the main chunk.

Non-goals: no change to capture, review, results, contracts, server or backend. No dark mode; the application has no theme switch. The canvas has a dark variant that can follow later. No new global styles beyond what already exists.

## Affected files and interfaces

- `frontend/src/App.tsx`: uses `<Masthead />` instead of its inline masthead styled components.
- `frontend/src/components/masthead/Masthead.tsx`: header layout, dot grid, brand and label. It mounts `ElectronicsCurrent`.
- `frontend/src/components/masthead/ElectronicsCurrent.tsx`: decorative `aria-hidden` canvas. An effect owns the scene lifetime: dynamic import, start, pointer forwarding and disposal on unmount.
- `frontend/src/electronics-current/`: non-React scene modules, with one responsibility each:
  - palette and finishes;
  - outline material kit;
  - part builders grouped by family (passives, semiconductors, integrated circuits, electromechanical, displays);
  - weighted catalogue;
  - pure flow/separation/stir maths;
  - the scene controller (renderer, isometric camera, loop, resize, recycling, disposal).
- `frontend/package.json` and the root `pnpm-lock.yaml`: add `three` and `@types/three`.
- `frontend/ARCHITECTURE.md`: describe the decorative masthead, its fallbacks and dependency ownership.

The component has no props that carry domain data. It never fetches, writes or touches application state.

## Alternatives considered

- **CSS or SVG 2D animation** (the first canvas concepts): no dependency. Mitch chose the 3D outline variant after comparing them, so this would not meet the request.
- **A hand-written WebGL renderer:** removes the dependency, but would reimplement projection, materials, fog and sprites. That is far more code to own and review than a maintained renderer.
- **three.js:** maintained, MIT-licensed, ES module with named exports, and widely used. This is the selected option.

## Package research

- **three 0.186.1:** MIT, no runtime dependencies. Published 2026-09-24, well settled; 0.187.0 is only three days old and was skipped deliberately. ES module `exports` entry; the declared `sideEffects` covers only `src/nodes`, so named imports tree-shake. The canvas prototype ran on 0.160.0. APIs used: `WebGLRenderer`, `OrthographicCamera`, basic/line/sprite materials, `onBeforeCompile`, `EdgesGeometry`, lathe/capsule/spline geometry and `DataTexture`. These must be verified against 0.186.1 types and runtime.
- **@types/three 0.186.0:** MIT, matching minor version, development-only. It pulls type packages for optional addons (fflate, meshoptimizer, tween, rapier compat, webxr). They never reach the browser bundle; they add install weight only.
- **Bundle cost:** three is loaded through a dynamic import, so it lands in a separate chunk fetched after the shell renders. The main chunk must not grow by the three.js size; the build output must show that.

## Implementation steps

1. Add the pinned dependencies with the pinned pnpm, and update the single root lockfile.
2. Port the scene into typed modules. Builders describe geometry and finishes. A material kit applies outline, crease, fill, glass, LED and segment materials explicitly, replacing the prototype's post-hoc material-swap pass. Geometry transforms are applied to the geometry itself, so outline shells stay even.
3. Add the `ElectronicsCurrent` and `Masthead` components and wire `App.tsx`.
4. **Behaviour:**
   - Part count scales with masthead width, so narrow screens are not crowded.
   - The pointer is tracked on `window` and mapped to the canvas rectangle, because the brand text sits above the canvas.
   - Separation keeps the flow evenly spaced.
   - Parts leaving the left edge are replaced with a freshly chosen type.
5. Run the readability autofix, Prettier, lint, typecheck, tests and build. Update the architecture doc and this handover.

## Verification plan

- **Unit tests for pure modules:**
  - catalogue weights and coverage;
  - every display glyph used by the animation exists;
  - flow targets stay bounded, and separation pushes overlapping parts apart symmetrically.
- **Component tests through roles:**
  - the masthead renders the brand and label text;
  - the decorative canvas is hidden from assistive technology;
  - rendering stays stable when WebGL is unavailable;
  - reduced motion does not start an animation loop.
- **Adverse cases:**
  - no WebGL context;
  - unmount before the dynamic import resolves, which must not start a scene afterwards;
  - unmount after start, which must cancel the loop and dispose renderer and geometry.
- **Checks:** root `pnpm format:readability`, `pnpm format`, `pnpm lint:readability`, `pnpm format:check`, `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend` and `pnpm build`.
- **Browser:** a visual check in a real browser is separate evidence from jsdom. Record it honestly if it is not done.
- **Review:** fresh independent review before the PR is opened, per the initiative branch rule. Findings are recorded here.

## Safety boundaries

No server, PostgreSQL, provider or inventory operations are needed. Nothing is written outside this worktree. No credentials are read or displayed.

## Implementation record

Dependencies were added with the pinned pnpm 12.16.1 on the pinned Node 24.22.2: `three` 0.186.1 (runtime) and `@types/three` 0.186.0 (development), exact versions, single root lockfile.

The scene was ported into typed modules rather than copied:

- **Material kit:** the prototype's post-hoc material-swap pass is replaced by an explicit outline kit. Builders call `body`, `detail`, `lead`, `glass`, `ledBody` or `segment`, so whether a surface gets a silhouette is decided where the part is described. Rotations and squashes are applied to geometry, so outline shells stay even without a baking step.
- **Randomness:** builders take an injected random source, so tests can make them deterministic.
- **Pure motion:** flow, separation and stir maths are pure functions on plain vectors.

Decisions and plan adjustments made during implementation:

- **WebGL 2 detection:** three.js r163+ renders only through WebGL 2. The component checks `WebGL2RenderingContext` before the dynamic import. Unsupported browsers and jsdom therefore never download three.js. This also keeps existing App tests free of jsdom canvas warnings.
- **Pointer tracking:** the pointer is tracked on `window` and mapped to the canvas rectangle, because the title and label sit above the canvas. Movement outside the canvas deactivates stirring, and leaving the page clears it.
- **Part count:** it scales with masthead width (about 30 at 1280 px, clamped to 6–40).
- **Narrow screens:** the browser check showed the desktop fade hid every part on a 366 px masthead. Narrow screens now dim parts to 25% under the title and label instead.

## Verification summary

| Check | Observed result |
| --- | --- |
| Frontend tests | 38 passed after review fixes (13 existing, 25 new: catalogue, displays, flow, outline kit, scene controller, masthead component) |
| Readability fix/check, Prettier fix/check | Passed; only files in this change were reformatted |
| Root typecheck (frontend, contracts, server) | Passed |
| Frontend lint and readability rule fixtures | Passed |
| Production build | Passed. Main chunk 525.21 kB (161.06 kB gzip), previously 521.45 kB. Separate `scene` chunk 570.37 kB (145.09 kB gzip), loaded only after the shell and only with WebGL 2. Vite's existing >500 kB advisory now also names the scene chunk; it is not suppressed. |
| Browser check | Chrome 155.0.8059.86 against the standalone Vite dev server (API unavailable, so the page shows its connection error). The canvas created a 2920×238 drawing buffer for a 1460×119 CSS box at DPR 2. Screenshots showed outlined tinted parts (resistors, DIP/QFP/SOIC, a lit 7-segment display, LEDs, capacitors, a transistor) drifting over the dot grid and fading before the title and label. At 390 px: no horizontal overflow (scroll width 390), and parts visible after the narrow-fade fix. |

Component tests cover: visible brand and label; `aria-hidden` canvas; no scene import without WebGL 2; the reduced-motion preference passed through; pointer forwarding; disposal on unmount; and no scene started when unmounted before the chunk resolves.

Pure-module tests cover:

- every builder produces geometry at several random values;
- weighted picking reaches every type and favours resistors;
- LEDs carry a glow, and displays face the viewer;
- every displayed glyph exists, and segment updates skip unchanged steps;
- the flow drifts left with soft boundaries;
- separation is symmetric, and stir falloff behaves at its limits.

## Limits

- **Browsers:** only Chrome was checked. Safari and Firefox rendering, and real low-end GPU frame cost, were not measured.
- **Console:** browser console output was not captured.
- **Rendering in tests:** jsdom tests cannot exercise WebGL rendering. The reduced-motion static frame and real pointer stirring were exercised only through component wiring and the canvas prototype, not through an automated browser test.
- **Visual baseline:** no visual regression baseline exists in this repository.

## Independent review

A fresh reviewer read every new file and the relevant three.js 0.186.1 sources. It re-ran tests, typecheck, lint, Prettier and a scratch build, and found no blockers.

**Confirmed by the reviewer:**
- **Bundle:** three.js is absent from the main chunk; it lives only in the lazy scene chunk.
- **three.js API:** the `begin_vertex` shader replacement and the geometry signatures are correct for 0.186.1, and the shared sprite geometry is never disposed.
- **Lifetime:** unmount before the import resolves and React StrictMode double mounting are safe.
- **Recycling:** replacing a part inside the frame loop cannot cascade.
- **Guidelines and accessibility:** no violations.

Findings and resolution:

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | should-fix | `kit.glass()` created a material per call, which accumulated in the kit while glass parts recycled | Glass materials are now shared per colour. Regression test added. |
| 2 | should-fix | The scene controller had no tests; the planned reduced-motion and disposal cases were unverified | Added `scene.test.ts`: real three.js with a fake renderer, stubbed frames and observers, seeded random. It covers reduced motion (no loop, one frame), disposal (loop cancelled, observers disconnected, geometries and renderer freed), off-screen pause and resume, recycling that keeps the count over about 90 simulated seconds, and finite positions under pointer stirring. It also exposed an extra empty render at start-up under reduced motion, now removed. |
| 3 | should-fix | The loop kept rendering while the masthead was scrolled off-screen | An `IntersectionObserver` pauses and resumes the loop; it is disconnected on dispose |
| 4 | nit | Under reduced motion, a resize left a layout built for the old width | Under reduced motion, the static frame is re-laid out when the width changes |
| 5 | nit | The glow texture used nearest filtering | Linear filtering, covered by a test |
| 6 | nit | A set-up error leaked the WebGL context and was swallowed; a frame error would repeat every frame | Set-up failure disposes the renderer and rethrows; development builds warn. The next frame is scheduled only after a successful step and render. |
| 7 | nit | The outline thickness comment overstated a constant 1 px | Comment corrected: thickness scales with part size |
| 8 | nit | The pointer could stay active at a stale spot after scrolling; the pixel ratio was read once | The pointer clears on scroll and `pointercancel`; the pixel ratio is re-read on resize |
| 9 | nit | Small per-frame allocations | Left as is: negligible at about 30 parts, and no profile shows a cost |
| 10 | nit | The plan's reduced-motion component test did not match the record | Resolved by the scene controller tests (finding 2) |

**After the fixes:**
- **Checks:** all required checks passed again.
- **Browser:** a fresh Chrome check confirmed the loop still animates; screenshots three seconds apart differ.
