# Design assessment

## Context and grounding

The change touches only the frontend: the masthead, the app shell's page ground, the electronics-current scene, the theme controller and Settings › Appearance. No server, contract or stored-data boundary is involved.

Existing patterns this builds on:

- **Theme preference** (`frontend/src/theme/theme.ts`): a controller with injected storage, media query and root element, holding the choice in `localStorage` (`bench-intake.theme`), writing `data-theme` on `<html>` and read through `useSyncExternalStore`. An inline script in `frontend/index.html` sets `data-theme` before first paint. Storage failures fall back silently.
- **Current host** (`components/masthead/ElectronicsCurrent.tsx`): WebGL 2 detection, a lazy scene import, reduced motion, window pointer listeners, a `data-theme` MutationObserver calling `setTheme`, and full disposal on unmount. `Masthead.tsx` owns the bar ground and measures the text gap into four `--current-*` mask stops.
- **Scene** (`electronics-current/scene.ts`): sizes to its canvas. `desiredCount()` scales with width only (30 at 1280px, from 6 to 40), and `openHeightNear` spawns within the canvas height. The flow drifts right to left with gentle vertical waves (`flow.ts`).
- **Settings** (`components/settings/AppearanceSection.tsx`): one `SettingRow` with `ThemeChoice`, a radiogroup also used by `PhoneMenu`.

Complexity: moderate. Most of the work is layout and CSS. The scene needs one new layout input. The theme controller is unchanged: every option follows the Theme setting, and the canvas option D is B under the dark theme, not a separate option.

## Goals and constraints

- Meet the modified requirements in `specs/ui-design-system/spec.md` and `specs/app-settings/spec.md`.
- No visible change for devices without a stored masthead style.
- Keep the current's existing guarantees in every style and theme: lazy three.js, still frame, disposal, no application-state effects, `aria-hidden`.
- Follow the frontend guidelines. Use `useSyncExternalStore` for the stored preference, keep component-owned styles colocated, use token-driven values (the literal checker applies), and add no Effect where an event handler or render-time derivation suffices.

## Decisions and alternatives

### D1. One masthead-style preference, applied as a root attribute

Add `frontend/src/theme/masthead-style.ts`, modelled on `theme.ts`:

- **Values:** `MastheadStyle = 'bar' | 'window' | 'fade'`, stored under `bench-intake.masthead`, defaulting to `bar`.
- **Effect:** it writes `data-masthead` on `<html>`, and `useMastheadStyle()` exposes the choice.
- **Pre-paint:** the inline script in `index.html` sets `data-masthead` too, so the first paint is correct.

The shared storage read and write, with their try/catch fallback, move into a small `theme/device-preference.ts` helper used by both controllers. This avoids a second copy of the fallback policy.

Rejected:

- A React context holding the style. Styles and the pre-paint script need it outside React, and the theme already proves the root-attribute pattern.
- Widening the theme controller into one "appearance" controller. That mixes two independent choices and their tests.

### D2. One field canvas, positioned by style; the bar canvas stays for A

Two hosts render `ElectronicsCurrent`:

| Style | Host | Canvas box | Mask |
| --- | --- | --- | --- |
| `bar` | `Masthead` (as today) | the bar | horizontal text gap (existing) |
| `window` | new `MastheadField` in the app shell, before the content | `position: fixed; inset: 0`, behind content (`z-index` token for the background layer) | none: legibility comes from heading patches (D3) |
| `fade` | `MastheadField` | `position: absolute`, top of the page, 420px tall, scrolls with the page | vertical fade (opaque to 140px, clear at 420px) intersected with the bar's text-gap mask within the bar's height (`mask-composite: intersect`), reusing `Masthead`'s measured stops |

The host is picked during render from `useMastheadStyle()`, so only one canvas exists at a time. Changing style unmounts the old host, and the existing cleanup releases its scene. The field's mask stops are CSS custom properties, like the bar's. C reuses the bar's existing ResizeObserver stops: `Masthead` sets them on the document root rather than on its own element, so the field can read them.

Ground and chrome by style, all in styled-components keyed off `[data-masthead]` on the root:

- **`bar`:** unchanged.
- **`window`:** the dotted ground (`masthead-ground` / `masthead-dot`) moves to `body`. The bar is `surface` at 70% via `color-mix`, with `backdrop-filter: blur` and its bottom rule. `Panel` and card primitives take the `shadow` token.
- **`fade`:** the bar loses its ground and rule; the page keeps `bg`. The field draws the dotted ground inside its masked band.

Rejected:

- One canvas that is resized and re-masked across styles. It keeps a single GPU context alive, but needs the scene to relayout in place and the host to move between DOM parents. Remounting is simpler and already correct.
- Fading the field under the content column. The developer chose heading patches instead (2026-11-19), which keep parts at full strength everywhere, as the artboard shows.

### D3. Ground patches behind text on the field

Under `window`, text that sits directly on the field gets a patch of `masthead-ground`, as the artboard's "Batches" heading does: small horizontal padding with a matching negative margin, so the text does not move, plus the small radius token. Parts pass behind the patch, never the text.

- **Where:** a shared `onField` css mixin in `components/ui/primitives.tsx`, active only under `[data-masthead='window']`. `PageTitle` applies it. Other loose headings and text opt in where they sit on the field. Each screen is swept: Batches, Agents, Settings (title, section titles and leads, nav, back link), Records stage, and any other text found by the manual check.
- **Not on surfaces:** headings inside `Panel`, cards, dialogs and the batch header band already sit on `surface` and do not opt in, so no ground-coloured chip appears inside a card.
- **Themes:** the patch uses the ground token, so it follows the theme with no extra work.

Rejected: applying the patch to every `Heading` and `Subheading` by default. Most of them sit inside panels, where a ground chip on a surface would look wrong.

### D4. Scene field layout: density by area, a capped pixel ratio

`ElectronicsCurrentOptions` gains `layout: 'band' | 'field'`, defaulting to `'band'`, which keeps current behaviour exactly.

For `'field'`:

- **Count:** `desiredCount()` uses area, at the bar's reference density of 30 parts per 1280 × 64 px scaled down. The artboards show about 25 parts on 1440 × 900, so the density is a named constant tuned to that. The count is clamped to the same 6–40 range, so a 4K window cannot exceed 40.
- **Spread:** spawn heights use the full field, and `openHeightNear` already spreads them.
- **Pixel ratio:** capped at 1.5 for the field (the bar keeps its current ratio). This bounds fill cost on a full-window canvas.
- **Resize:** follows the existing resize path. For B the canvas is viewport-sized and does not change on scroll, so scrolling never relayouts.

Rejected: a separate scene module for the field. The flow, catalogue and finishes are identical; only count and bounds differ.

### D5. Settings row: a radiogroup of three named options

Add `components/settings/MastheadChoice.tsx`, a radiogroup like `ThemeChoice`, in a "Masthead" `SettingRow` under Theme. The help text reads "Where the drifting electronics sit." Each option has its artboard label and a one-line description:

- In the bar: the masthead only.
- Behind the whole window: dotted ground under every page.
- Fading down: a band at the top that fades out.

Picking an option calls the controller in the change handler; no Effect is involved. `ThemeChoice` and `PhoneMenu` are unchanged.

Rejected: thumbnail previews. They are not in the design, and each would be a small animated or static mock to maintain. The canvas Appearance artboard is updated with the text row to keep design and app aligned.

## State, authority and failure behavior

```text
localStorage ─► masthead-style controller ─► <html data-masthead> ─► styles, field host, patches
localStorage ─► theme controller (unchanged) ─► <html data-theme> ─► tokens, scene.setTheme
index.html inline script sets both attributes before first paint
```

- **State:** device-local only, owned by the two independent controllers. There is no server state, authority or identity. Nothing is sent anywhere.
- **Failures:**
  - Missing or throwing storage gives `bar`, and the theme as today; a choice made then lasts for the session.
  - An unknown stored value is treated as `bar`.
  - Without WebGL 2 the CSS ground and chrome still apply, with no canvas content and no three.js download.
  - A scene start failure leaves the plain ground, as today.
- **Concurrency:** a style change during a pending lazy scene import is covered by the existing `unmounted` guard in `ElectronicsCurrent`.
- **Accessibility:** both canvases stay `aria-hidden` with no pointer events. Text contrast on B relies on the ground patches, which are checked in verification.

## Verification strategy

| Outcome or risk | Check | Boundary established |
| --- | --- | --- |
| Preference read, write, fallback and unknown values; pre-paint parity | Vitest unit tests for `masthead-style.ts` and `device-preference.ts` with fake storage; a test that runs the `index.html` inline script in jsdom for each stored combination | Controller logic and the pre-paint rule in jsdom |
| Masthead and theme choices stay independent | Settings test: change one, assert the other's attribute and selection are unchanged, then remount from storage | jsdom only |
| Patches only on the field | Primitive test: `PageTitle` gains the patch only under `data-masthead="window"`; a `Heading` inside `Panel` never does | Computed style rules in jsdom (presence, not visual result) |
| Settings row is remembered and applies immediately | `Settings.test.tsx`: pick Fading down, assert `data-masthead`, remount from storage | jsdom only |
| One host per style; switching disposes the old one | Component test with a stubbed `WebGL2RenderingContext` and a mocked scene module: `dispose` is called once on switch and only one canvas exists | Host lifecycle, not GPU behaviour |
| Field density and bounds | `scene.test.ts`: area-based count at 1440 × 900, 390 × 844 and 3840 × 2160 stays within 6–40; spawn heights fall within the field; `band` counts are unchanged | Pure scene maths |
| Visual fidelity, legibility and fixed/scrolling behaviour for A, B and C, light and dark, desktop and phone | Manual browser run through `pnpm dev` (headless browser where possible), compared with artboards A–C, and with D for B under Dark. Every screen's loose text on B is spot-checked for 4.5:1 and any missing patch added with the browser's contrast tool. Captures go on the PR, and a demo recording is attached per the UI-PR practice | Real rendering; manual evidence |
| Repository gates | `pnpm typecheck`, `pnpm lint:frontend` (includes the literal and contrast checks), `pnpm test:frontend`, `pnpm build` | Declared frontend checks |

jsdom has no WebGL, so no automated test proves GPU rendering or performance. The manual run covers that, and the PR states it.

## Migration, rollout and recovery

- **Migration:** none. The new preference defaults to today's behaviour, and the theme is untouched.
- **Rollback:** reverting the change leaves at most a harmless unused `bench-intake.masthead` key in browser storage.
- **Not applicable:** observability and live operations; the feature is decorative and local.

## Risks and open decisions

- **GPU cost of a full-window canvas** on low-end devices. Mitigations: the 40-part cap, the 1.5 pixel-ratio cap for the field, and the existing still frame under reduced motion. Watch for a frame-time regression during the manual run; if there is one, record it in `notes.md` and lower the density constant.
- **`backdrop-filter` over a WebGL canvas** can be costly in some browsers. Mitigation: the blur applies only to the 64px bar.
- **A missed patch** leaves some loose text on the field less legible. Mitigation: the manual sweep of every screen under B in both themes; findings are fixed before review.
- Open decisions: None. The developer resolved both on 2026-11-19 (D follows the theme; heading patches).
