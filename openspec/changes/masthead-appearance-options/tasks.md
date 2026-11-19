# Implementation and delivery tasks

## Plan context

- **Change:** `masthead-appearance-options`.
- **Artifacts:** [proposal](proposal.md) and [design](design.md). Specs (both modified): [ui-design-system](specs/ui-design-system/spec.md) and [app-settings](specs/app-settings/spec.md).
- **Reuse decision:** extend the existing scene (`three` 0.186.1) and the theme controller's stored-preference pattern; no new dependency.
- **Linked BI items:** None. This is a follow-up design request, not an indexed item.
- **Design source:** the redesign canvas, Masthead options page, artboards `MastheadA`–`MastheadD` and `SettingsAppearance`.

## Completion and commit ordering

Check an action only after it is done and verified, and stage the `tasks.md` update in the same commit as the work. Review, publication, CI and merge actions stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 0. Confirm the open decisions | decision | developer's answer | proposal decisions of 2026-11-19 |
| 1. Masthead-style preference | behavior | None | app-settings: remembered, storage unavailable; ui-design-system: default unchanged |
| 2. Scene field layout | behavior | None | ui-design-system: area density, still frame |
| 3. Field host, B and C layouts, ground patches | behavior | 1, 2 | ui-design-system: B (both themes), patches, C, no WebGL 2, style changes in place |
| 4. Appearance row | behavior | 1 | app-settings: all scenarios |
| 5. Canvas, docs and manual qualification | docs, design, manual | 3, 4 | visual parity with the artboards; architecture current |
| 6. Review and delivery | lifecycle | 1–5 | review, CI and merge gates |

Tasks 1 and 2 are independent and can run in parallel.

## PR delivery map

One PR carries tasks 1–6. The preference, the scene layout, the layouts and the settings row only make sense together: shipping the preference without the layouts, or the layouts without a way to choose them, leaves a dead control or unreachable code. The change is frontend-only, with no migration, so there is no rollout reason to split it.

| Bundle | Outcome and included work | Coverage | Why this boundary | Prerequisites and order | Base, branch and subject | Gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Three masthead options selectable in Settings › Appearance | Tasks 1–6 | One user-visible feature; no part is useful alone | Task 0 answered first | Base `interactive-app`; branch `feat/masthead-appearance-options`; subject `feat(masthead-appearance-options): offer the masthead options in Appearance` | `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend`, `pnpm build`; manual A–C evidence in both themes and demo recording on the PR; independent exact-head review; green selected CI |

## 0. Confirm the open decisions

- PR delivery: PR-A, before any implementation commit.
- Outcome: the developer decided on 2026-11-19 that D is not a separate option (it shows B under the dark theme, and every option follows the Theme setting), and that text on the field gets ground patches rather than a content-column fade.
- Prerequisites: None.
- Acceptance: the proposal, design and specs reflect both answers.
- Verification: `openspec validate masthead-appearance-options --strict`.
- Risks: None.

- [x] 0.1 Ask the developer both questions with the recommendations from the proposal.
- [x] 0.2 Update the proposal, design and specs to match the answers; remove the resolved items from their open-decision sections; validate the change.

## 1. Masthead-style preference

- PR delivery: PR-A.
- Outcome: a stored, device-local masthead style on `<html data-masthead>`, applied before first paint and independent of the theme.
- Scope: new `frontend/src/theme/device-preference.ts` and `frontend/src/theme/masthead-style.ts`; `frontend/src/theme/theme.ts` (uses the shared storage helper, behaviour unchanged); `frontend/index.html` inline script; `frontend/src/main.tsx` start-up; tests beside each module. Design D1.
- Acceptance: app-settings "Masthead choice is remembered" (controller part) and "Storage unavailable"; ui-design-system "Default style is unchanged".
- TDD: the new controller tests fail because the modules do not exist; the existing `theme.test.ts` stays green as the characterization check for the extracted storage helper.
- Verification: `pnpm --filter frontend exec vitest run src/theme` (or the project's equivalent single-file run), then `pnpm typecheck`.
- Risks: the pre-paint script and the controller must agree; a parity test covers it.

- [x] 1.1 Baseline: run the existing theme tests and record that they pass.
- [x] 1.2 RED: write failing tests.
  - [x] 1.2.1 Masthead-style controller: default `bar`, stored values, unknown values, throwing or missing storage, and subscribers notified on change.
  - [x] 1.2.2 Pre-paint parity: the `index.html` script sets the same `data-masthead` as the controller for each stored value, and its `data-theme` result is unchanged.
- [x] 1.3 GREEN: extract `device-preference.ts` from `theme.ts`, add the masthead-style controller and `useMastheadStyle`, wire it in `main.tsx`, and extend the inline script.
- [x] 1.4 Refactor; run `pnpm format` and `pnpm lint:frontend`.

## 2. Scene field layout

- PR delivery: PR-A.
- Outcome: `createElectronicsCurrent` accepts `layout: 'field'`, with density by area within 6–40 parts, spawn heights across the field and a pixel-ratio cap. The `band` layout behaves exactly as before.
- Scope: `frontend/src/electronics-current/scene.ts`, `scene.test.ts`. Design D4.
- Acceptance: ui-design-system delta, the density bullet; the "No WebGL 2 or reduced motion" still-frame clause for the field.
- TDD: new `scene.test.ts` cases for field counts at 1440 × 900, 390 × 844 and 3840 × 2160, for spawn heights within the field, and for a height-only resize under reduced motion (count updated, parts in bounds, no animation loop) fail because `layout` is ignored and height changes do not relayout. Existing band counts stay green as the characterization check.
- Verification: the scene test file, then `pnpm typecheck`.
- Risks: tuning the density constant against the artboards (about 25 parts at 1440 × 900); record the chosen value and any change in `notes.md`.

- [x] 2.1 Baseline: run `scene.test.ts` and record the existing band counts.
- [x] 2.2 RED: add the field-count, bounds, height-only resize and pixel-ratio cases; confirm they fail.
- [x] 2.3 GREEN: implement the `layout` option with named constants for density and pixel-ratio cap, and relayout the field when its height changes.
- [x] 2.4 Refactor; confirm the band cases are unchanged.

## 3. Field host, B and C layouts, ground patches

- PR delivery: PR-A.
- Outcome: each style renders as designed.
  - `bar`: as today.
  - `window`: fixed full-window field and dotted ground, translucent blurred bar, raised cards, and a ground patch behind each heading and other loose text on the field, in both themes.
  - `fade`: a 420px band at the top that scrolls away, with parts clear of the bar's text and out of the main content column below the bar.
  - Exactly one canvas exists at a time.
- Scope:
  - `frontend/src/components/masthead/ElectronicsCurrent.tsx`: accepts the layout and its mask styling.
  - New `frontend/src/components/masthead/MastheadField.tsx`.
  - `Masthead.tsx`: style-dependent ground and bar; mask stops published on the root for C.
  - `App.tsx`: the field host before the content.
  - `GlobalStyle.tsx`: the body ground under `window` styles, limited to the root.
  - `components/ui/primitives.tsx`: the `onField` patch mixin and a `$onField` opt-in on the heading primitives (never on by default); card shadow under `window`.
  - `components/masthead/MastheadBackdrop.tsx`: picks the field host by style, keyed by it.
  - `components/ui/field.ts`: the ground, patch and raised-card mixins.
  - Loose headings and text on the field across screens (Batches, Agents, Settings, Records stage and any found later), opting in to `onField`.
  - Tests in `AppMasthead.test.tsx` or `Masthead.test.tsx`.
  - Design D2 and D3.
- Acceptance: ui-design-system "Behind the whole window", "Behind the whole window in the dark theme", "Headings inside surfaces get no patch", "Compact width keeps its dimming", "Fading down", "No WebGL 2 or reduced motion" and "Style changes in place".
- TDD: component tests with a stubbed `WebGL2RenderingContext` and a mocked scene module. They assert which host mounts for each `data-masthead` value, that the scene receives `layout: 'field'` for B and C, and that switching style (A→B, B→C, C→B, and once while the lazy import is pending, under StrictMode) disposes the old scene once and leaves one canvas and one live scene. A primitive test asserts that a `PageTitle` with `$onField` carries the patch only under `window`, and that the setup panel's `PageTitle` and a `Heading` in a `Panel` never do. A test asserts that under `fade` the content edges reach the field's mask. They fail because neither the field host nor the patch exists. Visual layout cannot be asserted in jsdom; task 5 covers it manually.
- Verification: the masthead test files; `pnpm lint:frontend` (the literal and contrast checks must pass with token values only); `pnpm build`.
- Risks: a missed patch on some screen (task 5's sweep catches it). `mask-composite` support for C's combined mask (supported in current evergreen browsers; confirm in the manual run). `backdrop-filter` cost over the canvas.

- [x] 3.1 Baseline: run the masthead tests and record the result.
- [x] 3.2 RED: add the host-selection, layout-option, disposal-on-switch and patch tests; confirm they fail.
- [x] 3.3 GREEN: make the layouts render.
  - [x] 3.3.1 Add `MastheadField` with the `window` and `fade` canvas boxes and C's mask (fade, bar text gap with its compact dimming, content-column cut-out computed from the route's page-width token).
  - [x] 3.3.2 Make the `Masthead` bar and ground depend on the style, and publish its text-gap stops on the root.
  - [x] 3.3.3 Add the body ground and card elevation under the `window` styles.
  - [x] 3.3.4 Add the `onField` patch mixin and the `$onField` opt-in, and opt in the loose headings and text placed on the field on each screen.
  - [x] 3.3.5 Mount the field host from `App.tsx`, chosen during render from `useMastheadStyle()` and keyed by the style, at `z-index: -1` with no wrapper or new layer token.
- [x] 3.4 Refactor; run `pnpm format`, `pnpm lint:frontend` and `pnpm build`.

## 4. Appearance row

- PR delivery: PR-A.
- Outcome: Settings › Appearance offers the three masthead options and applies a choice immediately, independently of the theme.
- Scope: new `frontend/src/components/settings/MastheadChoice.tsx`; `AppearanceSection.tsx`; `Settings.test.tsx`. Design D5.
- Acceptance: every app-settings scenario in this change.
- TDD: `Settings.test.tsx` cases fail because there is no Masthead group. They cover picking Fading down and checking `data-masthead`; remounting with stored Fading down selected; and changing the masthead and theme in turn without either changing the other.
- Verification: `Settings.test.tsx`; `pnpm typecheck`.
- Risks: None beyond task 1's.

- [ ] 4.1 Baseline: run `Settings.test.tsx`.
- [ ] 4.2 RED: add the masthead-choice and independence tests; confirm they fail.
- [ ] 4.3 GREEN: add `MastheadChoice` with its three labelled options and descriptions, and add the Masthead row.
- [ ] 4.4 Refactor; run `pnpm format` and `pnpm lint:frontend`.

## 5. Canvas, docs and manual qualification

- PR delivery: PR-A.
- Outcome:
  - The canvas `SettingsAppearance` artboard shows the Masthead row, and the change is recorded in the design log.
  - `frontend/ARCHITECTURE.md` describes the masthead styles, the field host, the ground patches and the new preference.
  - Each option is checked against its artboard in a real browser.
- Scope: the redesign canvas (`SettingsAppearance.dc.html` only); the design log; `frontend/ARCHITECTURE.md` (theme and masthead paragraphs, Settings paragraph); the change's `notes.md`.
- Acceptance: the proposal outcome (three options selectable, matching artboards A–C, and B under Dark matching D); loose text on B at least 4.5:1 in both themes; C's band scrolls away; B stays fixed.
- TDD approach: not applicable. This is design, documentation and manual rendering evidence. Verification uses reference and consistency checks for the docs, and a recorded browser run for the visuals.
- Verification: `pnpm dev` with a headless browser (visible only if the developer wants to watch). For A, B and C, capture light and dark, desktop (1440 × 900) and phone (390 × 844), at the top and scrolled. Sweep every screen under B in both themes for loose text without a patch, and spot-check contrast. Under B, confirm the field paints above the ground and below the bar, page content, the condensed phone row, popovers, dialogs and toasts, and that a toast stays above an open menu overlapping it. Watch for frame-time regressions. Record a demo with the `demo-record` skill. All evidence goes on the PR, not in the repository.
- Risks: GPU cost on the full-window field; record any tuning in `notes.md`.

- [ ] 5.1 Update the `SettingsAppearance` artboard with the Masthead row and log the change in the design log.
- [ ] 5.2 Update `frontend/ARCHITECTURE.md` and check that its claims match the code.
- [ ] 5.3 Run the manual qualification matrix and capture the evidence for the PR.
- [ ] 5.4 Record the demo and keep it for the PR description.
- [ ] 5.5 Write `notes.md` entries for departures, tuning and remaining limitations.

## 6. Review and delivery

- PR delivery: PR-A.
- Outcome: a reviewed, green PR into `interactive-app`, merged per the repository's standing merge practice.

- [ ] 6.1 Run `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend` and `pnpm build` on the final commit.
- [ ] 6.2 Independent read-only review of the exact head against the code guidelines; fix and re-review until a round finds nothing new; name the reviewed SHA.
- [ ] 6.3 Re-check every claim in the PR body, docs and specs against the code; open the PR with the evidence and demo attached.
- [ ] 6.4 Selected CI green; merge.

## Delivery evidence and lifecycle follow-up

Record each PR's reviewed commit, check results and merged state after they happen. There are no indexed BI items to update. Sync the specs and archive the change only when authorized, after `pnpm openspec:overlap --change masthead-appearance-options` is clean.
