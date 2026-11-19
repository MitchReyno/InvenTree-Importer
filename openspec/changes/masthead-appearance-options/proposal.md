# Change proposal

## Problem and intended outcome

The design canvas's "Masthead options" page ("Where the electronics current lives") shows four places for the drifting electronics:

- **A · Current in the bar**: the current fills the masthead bar, between its text.
- **B · Current behind the whole window**: a dotted ground and the parts cover the whole window. The bar becomes translucent and blurred, and cards gain a shadow.
- **C · Quiet current, fading down**: the dotted ground and parts fill a band at the top of the page that fades out about 420px down. The bar has no ground or border of its own.
- **D · Whole window, dark**: B in the dark theme, with the dark part finish and LEDs and displays still glowing.

The app ships only A, so the operator cannot try or keep the others.

Requested outcome: implement B and C next to A, and let the operator pick one of them in Settings › Appearance. The choice is stored on the device like the theme and applies immediately. The developer confirmed on 2026-11-19 that D is not a separate option. It shows what B looks like in dark mode, so B (and every option) follows the Theme setting, and D is what B looks like under Dark.

## Change identity and linked items

Change name: `masthead-appearance-options`. Branch `feat/masthead-appearance-options`; subjects `type(masthead-appearance-options): …`.

Linked BI items: none. The index entry that adopted the design system names "masthead option A" (`docs/PLANNED_FUNCTIONALITY.md`, line 57); this change is a follow-up request, not an indexed item. Capture it with the `planned-functionality` skill if the developer wants it indexed.

## Current behavior and evidence

- `frontend/src/components/masthead/Masthead.tsx` draws the dotted `masthead-ground`/`masthead-dot` ground on the bar. It renders `ElectronicsCurrent` behind the row and measures the text to set four `--current-*` mask stops, so parts show only in the gap between the text.
- `frontend/src/components/masthead/ElectronicsCurrent.tsx` detects WebGL 2, lazy-loads `#/electronics-current/scene`, and follows the reduced-motion preference, the pointer and `data-theme` (via a MutationObserver on `setTheme`). At compact width, parts under the text are dimmed rather than hidden.
- `frontend/src/electronics-current/scene.ts` sizes itself to its canvas. The part count scales with **width only** (30 at 1280px, from 6 to 40), and parts spawn at any height within the canvas. A full-window canvas would therefore get bar-density parts spread over a tall field.
- `frontend/src/theme/theme.ts` keeps the theme choice in `localStorage` (`bench-intake.theme`), sets `data-theme` on `<html>` and exposes `useThemeChoice` through `useSyncExternalStore`. `main.tsx` creates the controller at startup.
- `frontend/src/components/settings/AppearanceSection.tsx` holds only the Theme row (`ThemeChoice`).
- Main specs: `ui-design-system` "Masthead and electronics current in both themes" fixes the masthead as "one bar over the electronics current (option A)". `app-settings` "InvenTree and appearance sections" lists only the theme under Appearance.
- Canvas evidence (version 1795052622-4455): artboards `MastheadA`–`MastheadD.dc.html` and `SettingsAppearance.dc.html`. No Appearance artboard shows a masthead choice yet.

## Scope and non-goals

In scope:

- **Stored choice:** a device-stored masthead style (`bar`, `window`, `fade`), defaulting to `bar` (A). It is applied as a root attribute that styles read.
- **Scene:** a field layout for the scene, so B and C get density by area and spawn parts across the field.
- **Layouts:** B and C in the masthead and app shell, in both themes. This covers the page ground, the translucent bar, card elevation and, under B, a ground-coloured patch behind each heading and other loose text that sits on the field.
- **Settings:** a Masthead row in Settings › Appearance with the three options, each named after its artboard.
- **Canvas:** the Appearance artboard updated to show the new row.
- **Docs and tests:** frontend architecture notes and tests updated.

Non-goals:

- New parts, finishes or motion for the current. A, B and C reuse the existing scene, catalogue and dark finish.
- A masthead choice in the phone menu. The menu keeps theme only.
- Server-side or per-account storage. Like the theme, the choice belongs to the device.
- Changing the bar's content, phone condensing or the batch header.

Compatibility: with no stored choice the app looks exactly as it does today (A). The theme choice and its storage are unchanged.

## Reuse and dependency assessment

No new dependency is needed. The scene already runs on `three` 0.186.1, with styled-components 6.6.0 and React 19.3.1 (`frontend/package.json`, checked 2026-11-19). The theme controller already provides the stored-preference, root-attribute and `useSyncExternalStore` pattern the masthead choice needs.

| Option | Goal fit | Limitations | Evidence (checked 2026-11-19) |
| --- | --- | --- | --- |
| Extend the existing scene with a field layout and reuse the theme controller's preference pattern | One scene and one finish set for every option; the theme and masthead choices share storage and fallback behaviour | A full-window WebGL canvas costs more GPU fill than a 64px bar; needs a density cap and pixel-ratio cap | `scene.ts`, `ElectronicsCurrent.tsx`, `theme.ts` |
| CSS-only B and C (static images of parts, as the artboards use) | Cheap; no WebGL cost | Loses the pointer stir, LED pulse and display cycling that the A spec requires of the current; a second set of part art to maintain | Artboards use `/_blob` part images as stand-ins |
| A second canvas library (for example a 2D sprite engine) | — | Duplicates the part models and finishes already in three.js; no requirement it meets better | — |

Recommendation: extend the existing stack. The artboards' static images are design stand-ins, not a target implementation.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `ui-design-system`: the masthead requirement changes from "option A only" to three selectable placements of the electronics current, each in both themes, with their layout and legibility rules.
- `app-settings`: Settings › Appearance gains the masthead choice.

## Impact and dependencies

- Frontend: `components/masthead/Masthead.tsx`, `ElectronicsCurrent.tsx`, the app shell in `App.tsx` (page ground and field canvas), `electronics-current/scene.ts` (field layout), a new masthead-style module beside `theme/theme.ts`, `components/settings/AppearanceSection.tsx` and a new choice component, card elevation and the heading patch in `components/ui` primitives and the screens' loose headings, and tests.
- Docs: `frontend/ARCHITECTURE.md` (masthead and theme sections) and the main specs on archive.
- Design canvas: the `SettingsAppearance` artboard, with the change recorded in the design log.
- No backend, contract, intake-server or database change.

## Open decisions and assumptions

Decided by the developer on 2026-11-19:

- D is not a separate option and does not force dark. It illustrates B under the dark theme; every option follows the Theme setting.
- Under B, headings on the field get a ground-coloured patch behind them, as the artboard does for "Batches". The field is not faded under the content column.

Assumptions:

- The patch also goes behind other loose text that would otherwise sit on the field, such as section leads, back links and the settings nav, where the manual check finds it below 4.5:1. Headings inside cards and the batch header band already sit on a surface and need none.
- Option labels follow the artboard titles: "In the bar", "Behind the whole window" and "Fading down".
- C's band scrolls away with the page, while B's field stays fixed to the viewport. C needs no patches: below the bar its parts stay out of the main content column, so page text in the band never has parts behind it. On a phone, where the column is the full width, C's parts show only in the bar's gap.
- At phone width every option applies, with area-based density keeping the part count low.
