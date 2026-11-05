# Batch workspace redesign implementation

Maintained implementation handover for [`redesign-batch-workspace`](../../openspec/changes/redesign-batch-workspace/) ([BI-008](../PLANNED_FUNCTIONALITY.md#bi-008--batch-workspace-redesign)). Status: PR-A (Tasks 1–3) in progress on `feat/redesign-batch-workspace-foundation`. Reviews, CI and merges are recorded only after they occur.

## Authority and boundaries

Mitch authorized implementation with `/opsx:apply redesign-batch-workspace` after the plan merged in #94. The normal PR workflow applies: an isolated branch per bundle, independent read-only review of the exact head, then selected green CI. Merging needs Mitch's instruction. No live provider call, real InvenTree request or change to real local data is authorized; browser checks use the owned fake and synthetic content.

Toolchain: the shell default Node 22 and pnpm 8 don't satisfy the pins. Commands run with the nvm-installed Node 24.22.2 (`.node-version`) and pnpm 12.16.1. `pnpm install --frozen-lockfile` in the worktree changed no lockfile before the font packages were added.

Baseline at `8f4a81c`: `pnpm --filter @invimport/frontend test` passed 310/310.

## PR-A plan: foundation (Tasks 1–3)

Scope is the [PR-A handoff](../../openspec/changes/redesign-batch-workspace/handoff-pr-a.md): tokens, themes, fonts, the component library, the sweep onto tokens and masthead option A. Non-goals: no route, data, contract or copy change, except where the handoff names one (the masthead order and the overflow menu holding Agent settings).

### Tokens and theme (Task 1)

| Piece | Location | Notes |
| --- | --- | --- |
| Token source | `frontend/src/theme/tokens.json` | Copy of the design system's file with the handoff's changes: `photo-scrim`, `photo-fg`, dark `part-*`, the "Public Sans Variable" stack |
| Generator | `frontend/scripts/generate-tokens.cjs` | Writes `tokens.css` (`:root, [data-theme="light"]` and `[data-theme="dark"]` blocks with `color-scheme`) and `tokens.ts` (typed `var(--…)` map and type styles). `--check` fails when either file is stale |
| Contrast | `frontend/scripts/check-contrast.cjs` | WCAG relative luminance over a named pair list (text 4.5:1, non-text 3:1), both themes; names each failing pair |
| Literal colours | `frontend/scripts/check-literal-colors.cjs` | Rejects hex, `rgb()`/`rgba()` and `hsl()` in `src/**` outside `src/theme/`, tests and the proof fixtures |
| Theme controller | `frontend/src/theme/theme.ts` | Pure choice/resolve/apply functions, try/catch storage under `bench-intake.theme`, a `matchMedia` listener while the choice is System, and a `useSyncExternalStore` hook for the menu |
| Pre-paint | inline script in `index.html` | Sets `data-theme` before first paint. The app sends no CSP, so the inline script is allowed |
| Fonts | `@fontsource-variable/public-sans` and `@fontsource/ibm-plex-mono` (400, 500), both 5.3.0, OFL-1.1, checked on the registry on 2026-11-06 | Imported once from `GlobalStyle.tsx`, so Vite bundles them locally |

The three scripts are `.cjs` standalone tools per the shared guidelines, run by `lint` in the frontend package so CI's frontend lint job runs them. Their logic is exported and tested with Vitest.

### Components (Task 2)

New components go in `frontend/src/components/ui/`, one per file, each with a test of its states, keyboard behaviour and accessible name. Existing controls keep their behaviour and tests; only their styles move to tokens. `primitives.tsx` keeps all its exports and props.

The sweep maps the current palette onto tokens by role, not by nearest hex: text `#233349` → `fg`, `#526179` → `muted`, borders `#d5dce5` → `line`, blue actions `#164a93`/`#266ac5` → `accent`, pale blue fills → `accent-weak`, warm fills → `warn-weak`, and so on. The light theme therefore takes the design system's values, as the design's compatibility note expects.

### Masthead (Task 3)

One bar in the handoff's order, with an overflow menu (Radix popover) holding Agents, Agent settings and the theme radio group. The current mask and phone dimming move to the handoff values. `finishes.ts` gains light and dark finishes; the scene re-tints materials and fog when `data-theme` changes, observed with a `MutationObserver`, without rebuilding geometry.

### Verification plan

- RED first for the generator check, contrast pairs, literal-colour check, theme switching and storage failures, each new component, and the masthead slot order and phone-width hiding.
- `pnpm typecheck`, `pnpm lint:frontend` (including the three scripts), `pnpm test:frontend`, `pnpm build`, `pnpm lint:readability`, `pnpm format:check`.
- Browser (headless, against the dev stack with the owned fake): a component gallery and the masthead at 1440, 860 and 390px and 200% zoom in both themes; no wrong-theme flash on a dark reload; masthead frame sampling showing no part pixels over the text boxes; the reduced-motion still frame.

## PR-A results

Recorded as each task completes.

### Task 1

- **1.1 tokens:** the generator test failed to load before `generate-tokens.cjs` existed, and its committed-files case failed until the files were generated; then 6/6. `--check` runs first in frontend `lint`.
- **1.2 contrast:** 5/5 after the module existed (RED: import missing). The real token set has no failing pair; the lowest are light `part-outline` on `masthead-ground` 3.13:1 (non-text, 3:1) and light `ok` on `ok-weak` 4.8:1. A darkened dark `muted` fails naming `dark: muted on surface`. Runs in `lint` and `build`.
- **1.3 theme:** 9/9 after `theme.ts` existed (RED: import missing): OS default, explicit choice persisted, OS changes followed only under System, throwing and missing storage, unknown stored value, subscriber and disposal, the hook, and the `index.html` pre-paint script evaluated with each stored value and scheme. The no-flash browser reload is part of the PR-A browser qualification.
- **1.4 fonts:** `@fontsource-variable/public-sans` and `@fontsource/ibm-plex-mono` 5.3.0, exact pins, added with pnpm 12.16.1. The production build emits the `woff2` files under `dist/assets`. Headless Chrome against `vite preview` with a throwaway probe page: Public Sans Variable loaded with its 100–900 axis and IBM Plex Mono 500 loaded, both from the local server; a 40px probe measured 341.5px at 400, 349.9px at 650 and 354.9px at 750, so both design weights render. Full frontend suite 330/330.
- `frontend/CODE_GUIDELINES.md` still asks migrations to preserve the current palette. This change replaces the palette under Mitch's approved plan, so that sentence is left as Mitch's text and not edited here.

### Task 2

- **2.1–2.4 components:** each component's test file failed to load before the component existed (RED), then passed. 87 tests across 26 files in `components/ui` cover variants, states, keyboard behaviour and accessible names. Two fixes while turning them green: the select-all indeterminate state is asserted before any click (a click clears it natively), and inline edit returns focus in an effect rather than an animation frame. QuestionCard's legend is the fieldset's first child so the group is named by the question.
- **2.5 restyle:** AutosaveStatus, the reference picker, AutoValueField, the tags input, DisabledFeature and all 23 `primitives.tsx` exports use tokens and the handoff measurements; their existing tests pass unchanged. "Saved · revision N" is unchanged. Controls are at least 32px tall on desktop and 44px below 760px.
- **2.6 sweep:** a role-based script mapped each literal by property (text, fill or border) and old palette family to a token across 50 files, then the JS tone tables (StatusChip, IssuePanel, the react-select styles) and quoted interpolations were fixed by hand. Photo containers (batch thumbnail, viewer preview, media card, crop source) now sit on `photo-stage`, and the crop box is outlined in `highlight` with no fill. The header dot's tone is exposed as `data-tone`, because jsdom drops `var()` values, and the two hex assertions in `HeaderStatus.test.tsx` now check it (an allowed styling assertion edit). The only remaining literals are the masthead mask stops, which Task 3.2 replaces. Frontend suite 385/385.
- Run Prettier from the repository root: from `frontend/` it doesn't see the root `.prettierignore` and reformats the generated token files.

### Task 3

- **3.1 masthead:** `targetStatus` (9 cases, RED: missing export) gives the connection summary unchanged plus its tone (`ok` only when reachable and fresh, `warn` stale, `bad` unavailable, `muted` otherwise) and the short phone word; `targetSummary` keeps its API. Masthead tests cover slot order, the overflow menu (Agents, Agent settings, theme radios switching `data-theme`, Escape returning focus to "More") and the breadcrumb's phone-width marker; HeaderStatus asserts the activity labels and full connection text are visually hidden, not removed, at phone width, with an `aria-hidden` short word drawn from `data-short`. App drops its separate "Application" nav row; `AppMasthead` builds the breadcrumb and reads the batch title through the same scoped capture query the batch screen uses. The Dev badge keeps today's always-on behaviour rather than becoming dev-build only, so PR-A changes no behaviour there. The proof fixtures pass `status` instead of `actions`.
- **3.2 mask and browser check:** `frontend/scripts/check-masthead-mask.cjs` (`pnpm --filter @invimport/frontend check:masthead <fixture URL> [--out dir]`) drives headless Chrome over the DevTools protocol with Node's built-in WebSocket, no new dependency. Per theme and width it hides the text row, takes a canvas-hidden reference and six frames 350ms apart, and counts pixels inside each text box that differ from the reference. The first run with the handoff's fixed stops failed: parts showed behind the activity pill at 1440px (up to 2,442 pixels) and, at 1100px, the bar wrapped. The fix keeps the bar on one row above 760px (the breadcrumb ellipsises), and the masthead measures its left text and status group into four mask stops whose fades shrink to fit the gap. The handoff row and design D4 now say so, with the fixed stops kept as the fallback. Final run against `tests/fixtures/header-status.html` with a breadcrumb: 0 part pixels in text at 1440 and 1100 in both themes and with reduced motion; parts drawn in the gap at 1440 (1,000–1,900 pixels); reduced-motion frames identical (0 moved pixels) with parts drawn; 390px dims parts under the text by design and is recorded only. The fixture's descendant `nav` rule was scoped to its own scenario buttons because it also wrapped the breadcrumb.
- **3.3 dark finish:** 9 new tests failed first (missing `FINISHES`, `fillFor`, `setTheme` and the `theme` option), then passed. `finishes.ts` builds both finishes from the generated tokens; the light finish equals the previous constants exactly, including the white LED tint blends. Dark fills (part fills, resistor code and plastic fills, the unlit segment, glass) mix 72% towards dark `part-base`; LED and display lit colours are unchanged. The outline kit records each material with its tint and `setTheme` re-colours the same material objects, so no geometry or material is rebuilt; LED materials stop being tracked when disposed. The scene re-colours its fog and re-renders a reduced-motion still frame; `ElectronicsCurrent` starts in the page theme and follows `data-theme` with a `MutationObserver`. Outline contrast is enforced by the contrast script: `part-outline` on `masthead-ground` 3.13:1 light, 8.0:1 dark. Browser: the mask check still passes in both themes with dark parts visible in the gap, and a live switch from light to dark under reduced motion re-tinted the same still frame (80,124 pixels changed) without a reload.

