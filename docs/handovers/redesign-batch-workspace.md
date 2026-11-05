# Batch workspace redesign implementation

Maintained implementation handover for [`redesign-batch-workspace`](../../openspec/changes/redesign-batch-workspace/) ([BI-008](../PLANNED_FUNCTIONALITY.md#bi-008--batch-workspace-redesign)). Status: PR-A (Tasks 1–3) merged as #96 (`50ff181`). PR-B (Tasks 4–6) in progress on `feat/redesign-batch-workspace-navigation`. Reviews, CI and merges are recorded only after they occur.

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

### PR-A browser qualification

Headless Chrome 155 over the DevTools protocol against the Vite dev server (`pnpm dev:ui`) and, for first paint, a production build under `vite preview`. Only owned fixtures were used: no API, provider or InvenTree.

- **Component gallery** (`tests/fixtures/components.html`, every new and restyled component with synthetic data): full-page screenshots in light and dark at 1440, 860 and 390px, and 200% zoom (a 720px viewport at device scale 2). Scroll width equalled the viewport in all eight, so no horizontal overflow; tab rows scroll inside their own container at 390px. Reviewed by eye: tones, pills, banners, problem cards, tables, chains, the question card and the recovery boxes keep their contrast in both themes. The sticky footer appears mid-page in the full-page captures because it sticks to the 900px viewport, which is expected.
- **No wrong-theme flash:** with the OS scheme light and Dark stored, `data-theme` is set to dark before `<body>` exists and the first animation frame is dark. The probe also showed the page ground came only from `GlobalStyle`, after React rendered, so the generated CSS now sets `html { background-color: var(--bg); color: var(--fg) }` (generator test first). On the production build, where `tokens.css` is a render-blocking stylesheet, the first frame of a dark reload paints `rgb(19, 23, 21)`, the dark `bg`.
- **Masthead:** the frame-sampling check and the live theme switch are recorded under Task 3.
- **Not covered:** Safari and Firefox, real GPUs (SwiftShader rendered WebGL), and the full app against the dev stack; screens beyond the masthead are restyled only through tokens in PR-A and get their own browser checks in later bundles.

### PR-A independent review

Codex `gpt-6.1-sol`, read-only, against `origin/interactive-app...<head>`; every finding was checked against the code before fixing.

| Round | Head | Findings | Outcome |
| --- | --- | --- | --- |
| 1 | `41ec49d` | 2 Important, 4 Minor | All fixed. Evidence actions kept the accent fill on hover (the primitive's hover rule had dropped them to `surface-2`, about 1.2:1); browser hover check now reads accent with `on-accent` and `brightness(1.07)` in both themes. Thumbnail fallback text uses `photo-fg` on `photo-stage`. "Preparing…" sits on a `photo-scrim` pill over the skeleton. Below 760px source chips get a 44px hit area and tag removal and theme choices are 44px tall. Evidence tiles fall back to the file name when a preview fails to load, per URL (tested). Link buttons no longer accept `busy` or `disabledReason` (type-checked test) |
| 2 | `6513708` | 1 Important, 3 Minor | All fixed. KeyValue renders a row's source chip beside the edit trigger rather than inside it (nested buttons; clicking the chip opened the editor), with a regression test. SegmentedControl, FilterChips and BulkBar controls are 44px below 760px. EvidenceGroup sends a rename once when Enter is followed by blur (tested). Toast tracks hover and focus separately, so it stays paused while its action has focus after the pointer leaves (tested) |
| 3 | `6007ef9` | 1 Important, 2 Minor | All fixed. StickyFooter publishes its height as `--sticky-footer-height` while mounted and Toast sits that far higher; in the browser the toast's bottom is 16px above the footer at 390 and 1440px in both themes (gallery fixture with both mounted). EvidenceGroup clears its rename de-duplication whenever the saved name changes, so a later identical rename is sent (tested). Masthead menu links, the evidence-tile selection tick (now a label around the checkbox), Retry and the toast action are 44px below 760px; the toast action measured 46×44px at 390px |
| 4 | `e7b52b5` | 1 Important, 2 Minor | All fixed. The masthead's end group can shrink and the connection text is bounded to 28ch with an ellipsis, keeping the full text and a `title`; with a 63-character hostname the row doesn't overflow at 800 or 1100px and the last control ends 16px inside the header. DataTable checkboxes sit in labels that are 44×44px at 390px, and inline-edit triggers and fields are 44px tall below 760px. The selected segment's focus is an inset accent ring with a 2px `bg` band inside it, so the ring borders only `bg` and `surface` (both pairs are in the contrast check); confirmed with keyboard focus in the browser. The mask check still passes |
| 5 | `f033e58` | 1 Important, 2 Minor | All fixed. EvidenceGroup suppresses only the blur that follows Enter, so a refused rename can be retried with Enter (tested) and Enter then blur still sends once. RecordChain scrolls inside itself: with a 64-character label at 390px the chain scrolls and the page doesn't overflow, and at 200% zoom the page doesn't overflow. Retry is 44×44px, record links 44px tall and the group name input 44px tall at 390px, measured in the browser |
| 6 | `c23b7ab` | 3 Minor | All fixed. Roving focus moves the tab stop with focus, so after arrowing Shift+Tab leaves the group and Tab returns to the focused option (tested). Tabs, SubTabs, NeedsYou and ChangeSummary links are 44px tall at 390px (measured). A theme change re-applies each LED's pulse before redrawing, so a light → dark → light round trip restores every material colour; the test fails with the fix removed (mutation check, file restored from a backup with a matching hash) |
| 7 | `bf82db5` | 1 Minor | Fixed. Focus rings inside the inverted toast and bulk bar use `bg` instead of `accent`, so they meet the same `bg`-on-`fg` pair as their text (in the contrast check); keyboard focus in the browser draws a 2px `bg` ring on the `fg` ground for Undo and "Apply to 2" |
| 8 | `709e181` | 1 Important, 1 Minor | Fixed. At phone width the workflow activity control draws a short word ("Idle", "Reading…", "Stale", "Offline") whenever it has no spinner or segments to show, keeps its hidden live text, and is at least 44×44px; the idle fixture at 390px drew "Idle" at 44×44px, and the unavailable case is unit-tested. The overflow menu's dialog is named "Application options" (tested) |
| 9 | `1aeef17` | 2 Minor | Fixed. The evidence tile's selection checkbox and preview button draw focus in `photo-fg` (11.6:1 on `photo-stage`, 7.0:1 on the scrim over white, both in the contrast check), the preview's ring inset because the tile clips overflow. Tabs and SubTabs draw focus inside the link so the scrolling row can't clip it, and the record chain keeps 4px of room for focus rings inside its scroll container; no page overflow at 390px or 200% zoom |
| 10 | `344c432` | 3 Minor | Fixed. The evidence preview's focus is an overlay drawn above the image: a 2px `photo-fg` ring between `photo-stage` bands, so it reads on any picture; keyboard focus on a white preview in the gallery showed the dark–white–dark ring. The breadcrumb container keeps 4px of room for its link's focus ring. The reference picker's pressed option uses `accent-weak` with `fg` text instead of react-select's default blues |
| 11 | `9fea7c7` | None | Verdict "ready". 292 tests passed in the reviewer's sandbox; token, contrast and literal-colour checks passed |

The commit after `9fea7c7` changes only this handover.

Final checks at `9fea7c7`: frontend typecheck, lint (token freshness, contrast, literal colours, ESLint), 416 tests and production build; `pnpm lint:readability`, `pnpm format:check`, `pnpm lint:markdown`, `openspec validate redesign-batch-workspace --strict`; the masthead mask check passed in every scenario.

### Design system artifact

The [design system](https://claude.ai/artifact/TbKY47cDmdA3Nuh2jufTmo) now carries the same token changes as `frontend/src/theme/tokens.json` (version 7): `photo-scrim` and `photo-fg`, the dark `part-*` values, the Public Sans Variable stack, and `color-scheme` on both theme blocks of its `tokens.css`.

### PR-A delivery

Mitch asked to merge. `interactive-app` had moved (simplify-intake-entry PR-A, #97), so `origin/interactive-app` was merged into the branch; the only conflict was `pnpm-lock.yaml`, regenerated with the font packages (16 lines over the base). All frontend checks passed again (429 tests with #97's). Squash-merged as #96 (`50ff181`). The two failing intake CI jobs fail the same way on `interactive-app`: `media-resources.test.ts` expects a 512 MiB sandbox limit after #93 raised it to 1 GiB, and two process tests time out at start-up since #97.

Reviews from PR-B on use a fresh read-only Claude reviewer subagent per round, at Mitch's request.

## PR-B plan: navigation, attention, Batches and Capture (Tasks 4–6)

### Attention read (Task 4)

- **Contract:** `contracts/src/attention.ts` adds `BatchAttention`: per-tab counts (Processing open questions; Review lots to check and decisions; Changes lots ready, failed and uncertain results) and bounded need-you items, each with a group, a title, an optional detail and a route. Registered with the other schemas and the generated client.
- **Server:** `intake-server/src/attention/` holds a pure projection over the existing processing snapshot, operator review and manual workspace reads, and a route `GET /api/v1/batches/:id/attention` registered like the header routes, reusing the same repositories, setup guard and error mapping. Until Task 9, decisions are the operator-review blocking issues that need a choice.
- **Tests first:** projection tests over fixtures (open question, changed-after-review lot, blocking issue, uncertain and failed results), then an HTTP route test.

### Navigation (Task 5)

- `frontend/src/navigation/batch-route.ts`: a pure parser and builder for the new routes and every legacy redirect in design D5, keeping the query string. `Batch.tsx` follows redirects with `location.replace`, so the navigation guard still blocks them with a dirty draft.
- `BatchHeader` shows the four tabs, the second row and badges from the attention read, plus the "N need you" pill opening the need-you panel on the Radix popover. The existing Review, Approve and Results screens mount under the new routes until Tasks 8 and 11 replace them.
- The header connection contract gains a target kind, and the connection status shows the `info` "Test InvenTree" state for the owned test target.

### Batches and Capture (Task 6)

- Batches home: continue card, compact list and search toolbar from the design-system components.
- Capture: EvidenceTile instead of the evidence cards, with crop, rotation, download and identity in the viewer; the read-only Proposed lots glance; restyled settings and groups without inline IDs and revisions.

### Verification plan

Contract and OpenAPI checks, intake tests, frontend checks, redirect tests, and a browser check of Capture at 1440, 860 and 390px and 200% zoom (under 2,500px tall for an 11-file fixture).

## PR-B results

### Task 4

- **4.1 contract:** `contracts/src/attention.ts` (`BatchAttention`, `AttentionItem`); routes are in-app hash routes under the batch, limited by pattern to Processing, Review and Changes. 3 contract tests failed first (missing `attentionClient`), then passed; contracts suite 75/75 and `pnpm contracts:check` clean.
- **4.2–4.3 projection and route:** `intake-server/src/attention/` holds the pure projection, the route and a reader composing the existing processing, operator-review and manual repositories, registered in `main.ts` beside the manual routes. Questions route to their step (Reading and Identifying to Examine); changed-after-review lots and open blocking issues route to Review › Lots; runs needing recovery or with unknown or mixed certainty route to Changes › Added. Counts stay exact when the 200 items are truncated. 4 projection and 3 route tests failed first (modules missing), then passed. A PostgreSQL test through the manual fixture (now also serving the route when processing is enabled) reviews two lots, bulk-edits one and checks that the attention read agrees with the operator-review and manual reads; it passed against the owned dev Postgres. Intake unit suite 188/188.

