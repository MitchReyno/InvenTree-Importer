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

### Task 5

- **5.1 routes:** `frontend/src/navigation/batch-route.ts` parses and builds the new routes and names the redirect for every legacy row in design D5, carrying the remaining path and the whole query string. 25 parser tests failed first (module missing), then passed after one fix (the redirects repeated the segment after the old step or lot). `Batch.tsx` follows a redirect with `location.replace`, which fires `hashchange` through the navigation guard; a guard test shows a legacy link is held back with a dirty draft before any redirect runs, and a Batch test follows approval, results, review and processing links with their query strings. Former `#<batch>/<subject>` links still resolve to Review › Lots with `?edit=`. Every in-app link uses `batchHref`, including `EvidenceViewer`'s same-lot comparison.
- **5.2 header:** `BatchHeader` replaces `CaptureHeader` (removed) and is rendered once by `Batch`. The four tabs and the second row take their counts and badges from the attention read through `useBatchAttention`, whose key includes the batch revision; warnings and failures are badges, plain counts are counts. Review › Map is shown disabled until Task 8, and Review › Records opens an interim list of decisions linking to their lots until Task 10. Archive is disabled while any screen reports a dirty draft, which keeps the rule `CaptureHeader` enforced. `ProcessingWorkspace` lost its own step tabs (the header's second row holds them) and Examine shows the Reading and Identifying stages.
- **5.3 panel:** `NeedYouPanel` is a Radix popover named "Needs you", grouped by tab, each item linking to its route; Escape closes it and returns focus to the pill (tested).
- **5.4 screens:** Review › Lots mounts the current Review, Changes › Ready to add the current Approve (pinned preparation from the route) and Changes › Added the current Results (pinned run).
- **Test updates:** 30 existing tests asserted old route strings or the old header. Route strings moved to the new shapes; tests rendering a screen directly now start on its new route rather than relying on a redirect; header-button assertions moved to the `Batch` links; the two workspace-level "Archive disabled while dirty" checks assert the dirty report that `Batch` turns into the disabled Archive, and the revision-conflict test through `Batch` still sees Archive disabled. Frontend suite 462/462.
- **5.5 target kind:** `ConnectionStatus.target.kind` is optional (`owned_test` or `configured`; absent means configured, so older producers and fixtures stay valid). `devConfig` sets `targetKind` to `owned_test` only for `INTAKE_TARGET_PROFILE=fake`, which the dev supervisor now passes to the API child (and the standalone API allowlist accepts). A reachable, fresh owned test target reads "Test InvenTree" with the `info` dot and short word "Test"; stale and unavailable keep their warning tones. Tests failed first at all three layers (contract, server config and connection status, frontend `targetStatus`), then passed; contracts 76, intake 190, frontend 463, dev tooling 15.

### Task 6

- **6.1 Batches home:** the existing data, search, archive filter, paging and creation logic is unchanged; the page now has a primary New batch action, a continue card with its counted resume action and tab links, and one All batches card with search and Show archived in a single toolbar. Inline revision numbers are gone. Existing Batches and App tests passed unchanged (30).
- **6.2 evidence tiles:** each file is an `EvidenceTile` (via `EvidenceFileTile`) inside the existing drag handle: the preview is a ready crop if there is one, otherwise the original; `queued` is "Preparing…", any other undecoded state is one sentence without decoder detail; PDFs are tagged Document; support counts the file's linked lots. "Open <file>" shows a viewer (the existing `Modal`) with the former card (versions, crop and rotation, download, byte identity under its disclosure), the note editor and the lot links. Order note: the tile and viewer were written before their tests this time; the new tests (3 tile, 1 viewer through `MediaWorkspace`) were added afterwards and pass. Five existing media tests now open the viewer before using its controls, and one note assertion is scoped to the viewer because the note also shows on the tile. Frontend suite 467/467.
- **6.3 Proposed lots glance:** `frontend/src/processing/proposed-lots.ts` turns the active lots and the operator review into a name, a state in words (Ready, To review, Changed, Blocked) and a Review link; Task 7.1's adapter takes it over. `ProposedLotsGlance` sits at the top of Capture's settings column with no edit control and an Open Review link. Source and glance tests (4) failed first (modules missing), then passed. One existing test now accepts both "Packet A" links, the override and the glance, each checked to open the lot in Review. Frontend suite 471/471.
- **6.4 settings and groups:** evidence groups use the design-system group look (card, dashed when ungrouped, accent ring while a file is dragged over) with the name, a file count and the existing actions. Inline revisions and versions are gone from Capture: the save status reads "Saved" and the custom instructions line reads "Saved <date>", each keeping the number as `data-revision` or `data-version`. The six "Saved · revision N" assertions and the "Version 6" assertion now check those attributes, waiting for the exact number where the old test waited for the text, so the 64-bit revision check keeps its precision. A Capture test asserts no inline revision or version, and the viewer test asserts no digest on the tile. Frontend suite 472/472; build passes.
- **Browser check:** `frontend/tests/fixtures/batch-capture.html` renders the real Batches home and Batch views with synthetic clients (no API, provider or InvenTree traffic): 5 lots, 3 groups, 11 files (2 PDFs, one still preparing) and an attention projection. Capture is 2,353px tall at 1440px (limit 2,500), 3,513px at 860px, 4,854px at 390px and 3,777px at 200% zoom, with no horizontal overflow in light or dark; Batches has none at 1440px or 390px. Needs you, Review › Records and the second-row tabs were checked by screenshot. Previews show as dark tiles in the fixture because it serves no preview bytes.

### PR-B review round 1

Fresh read-only Claude reviewer at `40437af`: 3 Important, 5 Minor, 2 Nitpick. All were verified against the code; each fix had its test written first and fail first.

- **Status issues counted as decisions (Important):** every operator-review issue has `disposition: null`, so approval, unsettled history, archive and media status issues showed as "to decide". Decisions now need one of `part_choice_required`, `quantity_required`, `location_required`, `location_conflict` or `location_draft_parent_invalid`, and approved lots count nowhere in Review or in Changes › ready. The Capture glance shows approved lots as "Added".
- **Viewer could close over an unsaved note (Important):** Close and Escape are refused while the open note is dirty or saving, so the draft and the navigation guard stay consistent.
- **Architecture drift (Important):** `frontend/ARCHITECTURE.md` gains a batch navigation and attention section and the new Review URL; `intake-server/ARCHITECTURE.md` documents the attention read and `target.kind`.
- **Minor:** the last hand-built links (`DecisionPanel`, `WorkflowDetails`, `ProcessingImages`) use `batchHref`; Needs you closes once an item is chosen; failed and interrupted Processing attempts are restored as `processing.failed` and `failed_job` items, badged on Processing and their step in the stronger tone; the reader's comment no longer claims one snapshot (each projection is its own, and the client refetches on revision change); the Resume test drives `Batch` and asserts the `archived: false` edit.
- **Nitpick:** the `review-model` URL comment and the projection's `processing` comment are corrected.
- **Local PostgreSQL:** the attention PG test passes. Eight other PG tests fail locally only for environment reasons (no pinned decoder image; `docker` not on the test's PATH) and are untouched by this branch; CI's PG lane passes on the base.

### PR-B review round 2

Fresh read-only Claude reviewer at `7fb44f8`: 1 Important, 5 Minor, 1 Nitpick, all verified, each fix test-first.

- **Viewer could trap the operator (Important):** Close was disabled whenever the workspace was frozen (archived batch, a dirty settings draft, polls) or a request was unconfirmed, while the retry controls sat behind the modal. Close is now refused only while the viewer's own note has unsaved edits; during an unconfirmed save the retained request holds the text, so closing drops the editor and clears its draft. jsdom does not raise the dialog's `cancel` on Escape, so the tests dispatch `cancel` as the browser does (the round-1 Escape assertion had not exercised it).
- **Minor:** the viewer's dirty flag resets when a confirmation closes the editor; `BatchAttention.processing.steps` gives exact per-step counts so step badges no longer undercount from the 200-item list, and Records says how many decisions are not listed; approved lots read "Approved" on the glance (approval includes queued and failed runs, so "Added" overstated it); bare Changes › Ready to add returns to the preparation last shown, or the newest if it is gone; a failed attention read shows "Needs you unavailable" in the header and an alert on Records instead of loading forever.
- **Nitpick:** `reviewHash` builds through `batchHref`, so every in-app batch link does.

### PR-B review round 3

Fresh read-only Claude reviewer at `2552765`: 1 Important, 3 Minor, all verified, each fix test-first.

- **Back trapped on Changes (Important):** the round-2 return-to-preparation pushed a history entry on every bare Ready to add, so Back looped. `Batch` now remembers the last preparation shown in the batch (surviving other tabs, which unmount the workspace) and returns to it with `location.replace`; the workspace's first automatic choice also replaces. A `Batch` test asserts the redirect adds no history entry, and a workspace test asserts the replace option.
- **Unconfirmed note text could be lost (Minor):** round 2 let the viewer close during an unconfirmed save, and a refused retry then discarded the text. The viewer now stays open while its note is dirty, including while saving, and shows the retry and discard inside itself (the page behind a modal is inert). A test covers uncertain save, retry, refusal, text still in the editor.
- **Records with every decision cut (Minor):** it no longer says "Nothing needs you" above the unlisted count.
- **Doc scope (Minor):** the architecture now says where the remembered preparation lives.

### PR-B review round 4

Fresh read-only Claude reviewer at `4cc845f`: 3 Minor, 1 Nitpick, doc drift.

- **Redirect to a preparation that is gone (Minor, fixed):** round 3's `Batch` redirect did not check the preparation still existed, dropping round 2's fallback. `Batch` now only remembers the last preparation and passes it to the workspace, which opens it if current, otherwise the newest, with `replace`. A pinned preparation in the URL still asks for an explicit choice when it is gone. Tests cover both choices and assert one replace-navigation.
- **Refusal reason hidden behind the viewer (Minor, fixed):** the viewer shows the request's error while its note is dirty; the refused-retry test asserts the alert inside the dialog.
- **Viewer lock when the open file leaves the group (Minor, not reproduced):** a dirty note freezes the media snapshot (`useEvidenceWorkspace` accepts reads only while no source but a crop is dirty), so a poll cannot move the open file away. A test written for it confirmed the viewer stays; no change.
- **Duplicate history entry on Ready to add from the same preparation (Nitpick, accepted):** clicking the tab pushes bare Ready to add, which the workspace replaces with the current preparation. Linking the tab straight to the remembered preparation would reintroduce the gone-preparation problem, because the header cannot tell whether it is still current.
- **Docs:** the architecture and this handover now describe the remembered-or-newest choice; the round-2 and round-3 bullets above record the earlier behaviour.

### PR-B review round 5

Fresh read-only Claude reviewer at `007e80d`: 2 Minor, both fixed test-first.

- **Choice made from a cached read (Minor):** returning to Changes remounts the workspace on cached data, so a preparation approved elsewhere could still be chosen and then shown as unavailable. The bare choice now waits for the mount's own read (`isFetchedAfterMount`). The test seeds a cache listing the remembered preparation and a fresh read without it, and expects the newest.
- **`Batch` memory untested (Minor):** a `Batch` test again goes from a shown preparation through Capture to bare Ready to add and asserts the hash returns to it with no new history entry; removing the prop from `Batch` makes it fail (checked).

### PR-B review round 6

Fresh read-only Claude reviewer at `e088b56`: 1 Minor, fixed test-first.

- **A failed first read opened the gate (Minor):** `isFetchedAfterMount` also turns true on an error, leaving the cached list in place, so the bare choice could still pick a gone preparation. The choice now also waits while the read is in error. The test fails the mount's first read, lets the failure settle (asserting no choice yet), then refetches and expects the newest; without the fix it fails (checked).

### PR-B review round 7

Fresh read-only Claude reviewer at `7c42f99`: clean, no findings. Later commits on the branch change only this handover.

### PR-B delivery

Mitch authorised merging once review and CI were clear. CI on #100: frontend, TypeScript and Markdown passed; the intake HTTP lane's two start-up timeouts (the same tests that fail on `interactive-app`'s own push) passed on a rerun of the failed job; the PostgreSQL lane is retired by #99. Squash-merged as #100 (`4080ea9`).

## PR-C plan: Processing and Agents (Tasks 7 and 12)

Branch `feat/redesign-batch-workspace-processing` from `4080ea9`. Mitch authorised merging PR-C once review and CI are clear.

- **Sessions exist already (design D9 adjustment):** #97 retained native sessions, so the adapter reports them where a session profile is configured and none otherwise. The agent-session list gains `sessions_supported` from the configured profile, so the Agents page can say sessions are not available for this setup.
- **7.1 adapter:** `frontend/src/processing/source.ts` maps the processing snapshot to steps (Reading and Identifying to Examine), per-step job counts and outputs, open questions with their step and assumption, and sessions from jobs with a session state. Tests first: every stage maps to its step and a fixture profile yields no sessions.
- **7.2–7.3:** `ProcessingWorkspace` keeps its data and command logic; its presentation becomes an Overview (step progress, sessions, Needs you, batch instructions, activity, glances to Review and Changes) and one step-page pattern (outputs, questions, sessions, links to Review and Capture). A step without data says so.
- **7.4 drawer:** the existing session timeline and chat move into a side drawer opened from a session row, rendered only for jobs with a session.
- **12:** the Agents page gets the summary (slots in use against `session_concurrency`, model, waiting count), filters (running, waiting for you, queued, finished today), per-batch groups linking to Processing, and the not-available state.
- **Deferred to Task 14 per the tasks:** latest status lines on Overview, corrections from step outputs, and slot-counting scenarios.

## PR-C results

- **7.1 adapter:** `frontend/src/processing/source.ts` defines `ProcessingSource` (step progress in counts, open questions with step, subject and assumption, sessions, and jobs per step) and `retainedJobsSource` over the processing snapshot. Reading, Identifying and Examine jobs map to Examine; failed and interrupted count as failed; the three waiting states count as waiting. Sessions come only from jobs with a `session_state`, so the fixture profile yields none. A batch-level job reads "Whole batch" and a subject outside the batch "Unknown subject". Six tests failed first (module missing), then passed. The Capture glance keeps its own small source function until Task 14 supplies live lots.
- **7.2–7.4 Overview, step pages and drawer (one commit, since one restructure of `ProcessingWorkspace` delivers them):** the workspace keeps all its data and command logic (pinned questions, start, cancel, answer, restart) and builds a `ProcessingSource` from its snapshot.
  - **Overview** (`ProcessingOverview`): step progress in words per step ("No work yet" when empty, never a percentage), sessions only when the source has any, Needs you (each question links to itself and, for an active lot, to Review), the batch instruction field, Activity (the job cards), and links to Review and Changes with the attention counts. No lot editing.
  - **Step pages** (`StepPage`): the same parts in the same places (state, questions, sessions, outputs as the step's job cards) plus a link to evidence in Capture; Images keeps its crop list; an empty step says "No retained work on <step> yet."
  - **Drawer:** a job's session opens in a dialog with its open questions, the existing timeline and chat; it renders only for jobs with a `session_state`.
  - **Instructions:** `InstructionField` saves explicitly with the batch revision through the same `instruct` command as Capture, reports a conflict without losing the draft, and keeps its own navigation-guard source apart from the answer form.
  - The removed `ProcessingStageSummary` and `ProcessingNeedsYou` are replaced by the Overview; their Review link per lot question is kept.
  - Tests first for each new component (Overview 8, step page 2, adapter 7) and for the workspace (fixture profile shows jobs and questions by step with no session; a session job opens its drawer; the instruction guard), then GREEN. One existing test moved to the new Needs you wording. Frontend suite 506/506.
- **12 Agents page:** `AgentSessionList` gains `sessions_supported` (`sessionsSupported(config)`: whether the configured profile is a session profile); contract, unit and agents PostgreSQL tests cover it (agents PG 4/4 locally). `AgentSessions` shows the summary (slots in use from `occupies_lane` against `session_concurrency`, waiting sessions holding no slot, the model for new sessions), filter chips (all, running, waiting for you, queued, finished today), and per-batch groups named from a capture read with an Open Processing link; each session shows step, subject, latest status line, state and when that state started (finish, start or queue time). Without session support it says the server's processing profile does not run agent sessions, with no summary or filters. Tests first: four new page tests failed, then passed; the history-failure test is kept. Frontend 509/509, intake 193/193.
- **Browser check:** `frontend/tests/fixtures/processing.html` renders the real `ProcessingWorkspace` and `AgentSessions` from synthetic clients (no API, provider or InvenTree traffic): a session profile (`#overview`, `#examine`, `#agents`) and the fixture profile (`#overview-fixture`, `#research-fixture`, `#agents-fixture`). No horizontal overflow at 1440 or 390px. Screenshots checked: Overview, the Examine step with its session drawer, the Agents page, and the not-available state. Fixes from it: `Modal` had no background (white in dark mode, also the evidence viewer) and now uses the surface token with accent links; session rows no longer stretch the state pill; links inside a `Banner` inherit its tone. The screenshot script's dark theme did not take effect in these fixtures (the PR-B captures were affected too), so dark mode was checked only through the token and contrast checks.

### PR-C review round 1

Fresh read-only Claude reviewer at `8f86faf`: 1 Important, 6 Minor, 3 Nitpick. All verified; fixes test-first where behaviour changed.

- **Instruction field could save empty over the stored instructions (Important):** the field copied its text once at mount, often before the review projection for the current revision arrived (first entry, or the remount after a save). It now takes `undefined` until that projection is read (disabled, "Reading the saved instructions…"), adopts the saved text when it arrives unless the operator is editing, and only offers Save after an edit.
- **Minor:**
  - **Discard:** the field gains "Discard changes", which restores the saved text and releases the guard.
  - **Timezone-safe test:** the "Finished today" test uses local times, and passes in New York and Auckland.
  - **Empty outputs:** a step with no work renders no empty Outputs region (tested).
  - **Unique session buttons:** each is named with its step.
  - **Guard test:** it now mounts both drafts, and fails if the instruction field shares the answer's source (checked).
  - **Activity order:** the comment now states snapshot order. "Needs you, oldest first" is not met: questions carry no timestamp in the retained snapshot, so the order is job then question. This waits for Task 14's session questions.
- **Nitpick:**
  - **Doc comment:** `listAgentSessions` has its comment back.
  - **PostgreSQL assertion:** it now expects the literal `false` for `native-agent/1`.
  - **Drawer closing:** the drawer closes when the route's question changes, not on the link click, so a guard-blocked click leaves it open.
  - **Handover wording:** corrected.
- **Checks:** frontend 512/512, contracts 76, agents PG 4/4. One intake run hit the known `media-startup` start-up timeout under load; it passed on its own.

### PR-C review round 2

Fresh read-only Claude reviewer at `eafda58`: 1 Important, 4 Minor, 1 Nitpick, all fixed test-first.

- **Saving one draft discarded the other (Important):** an instruction or answer save calls `reload`, which remounts `ProcessingStage` (keyed by revision and reset), so the other draft was lost and the guard released. Each save is now held back while the other draft is unsaved, with a note saying why. The workspace test opens both drafts and asserts both saves are disabled. Discarding the instructions releases only their source, so the guard stays on for the answer.
- **Minor:**
  - **Unavailable instructions:** the field shows an alert when the saved instructions are unavailable (operator read failed or paused) instead of "Reading…" forever.
  - **Button names:** session and Review buttons now start with their visible text ("Open session: Examine · Packet A", "Open in Review: Packet A").
  - **Drawer link:** a drawer link to the question already open closes the drawer (tested).
  - **Agents banner:** the not-available banner names the server profile instead of pointing to Agent settings, which has no profile control.
- **Nitpick:** an archived batch reads "Resume the batch to change its instructions."
- **Checks:** frontend 515/515.

### PR-C review round 3

Fresh read-only Claude reviewer at `453000e`: 2 Minor, 2 Nitpick, all fixed.

- **Other draft editable during a save (Minor):** the workspace now records which draft is saving across the command and the reload, and locks the other draft's input until it finishes (the answer form read-only, the instruction field disabled). A test holds each save open and checks the other draft is locked, then unlocked.
- **Spec drift on "No session support yet" (Minor):** the agents-overview scenario and the D9 adjustment now say the page names the server's processing profile instead of linking to Agent settings, which has no profile control. The test name matches what it asserts. `openspec validate --strict` passes.
- **Nitpick:**
  - **Drawer link:** it closes the drawer only on the question's own step page, where the link changes no route.
  - **Both-drafts test:** it now checks that the answer's save re-enables once the instructions are discarded.
- **Checks:** frontend 516/516; typecheck, lint and build pass.

### PR-C review round 4

Fresh read-only Claude reviewer at `12b04f5`: 1 Minor, 1 Nitpick, both fixed. The save lock was confirmed sound: it always clears in `finally`, and it cannot overlap the answer's retry or discard.

- **Drawer left open across a step change (Minor):** a drawer link from Overview to the same question's step page changed `view` but not `questionId`, so the drawer stayed open. It now closes on any change of question or view. A test rerenders from Overview to Examine with the same question.
- **Test gap (Nitpick):** the held-answer test now resolves the reload and checks the instruction field unlocks.
- **Checks at `8d725fd`:** frontend typecheck, lint and build pass. The full frontend suite had 517 tests; under a machine load average near 58 (a demo render in parallel), a few App, OperatorSurfaces and media tests timed out at 5 s. Rerun on their own, those files pass (35/35 and 36/36).

### PR-C review round 5

Fresh read-only Claude reviewer at `8d725fd`: clean. Its only note was the missing Checks line above. Later commits on the branch change only this handover.

### PR-C delivery

CI on #102 passed on every job that ran: frontend, TypeScript, Markdown and the intake HTTP lane. The PostgreSQL lane is retired by #99, and the backend lanes don't apply. Squash-merged as #102 (`d38e6ad`) under Mitch's standing authorisation.

### Demo videos

Mitch asked for a demo-director video on every PR with visible UI changes, made without asking him, captured at 3840×2160 and rendered at 1920×1080, with a title card. Subagents recorded them from the owned fixtures, and each was attached to its PR description in a Demo section:

- #96, PR-A (68 s): masthead, theme switch, component gallery.
- #100, PR-B (64 s): Batches, header and need-you panel, Capture, Processing and Records.
- #102, PR-C (78 s): Overview, instructions, step page, drawer, fixture profile, Agents and the not-available state.

The film projects stay outside the repository. The PR-C film shows the fixture rendering correctly in dark mode, which the screenshot script had not verified.

## PR-D plan: Review Lots and Map (Task 8)

Branch `feat/redesign-batch-workspace-review-lots` from `d38e6ad`. Merge is authorised once review and CI are clear; a demo video is attached before merge.

### Existing Review, mapped before planning

- **What exists:** Review › Lots already has the three-column Evidence mode (queue, `LotEvidence`, `DecisionPanel`) and a Table mode (`TableWorkspace`, `BulkEditPanel` naming its scope), plus split, merge and move through `RestructureDialog`.
- **What does not:** there is no Exclude command, no Review command that links evidence to a lot or creates a lot from evidence (the media `link` edit and capture `add_lot` exist), and no inline question answer in Review.
- **Selection:** the Table keeps its own selection, separate from the approval selection.

## PR-D results

- **8.1 Workspace panes:** Review opens on the first queued lot, once per mount (the narrow layout's back-to-list still works), so its evidence and details show without a separate step. Each queue row has a "Show" button (named "Show <lot>", current lot marked).
  - **Details pane:** it now starts with the lot's record chain (Part, Stock item, Location, each with its state, linking to Review › Records). A per-lot "Mark reviewed" is disabled with a stated reason ("Fix N blocking problems first", "Dismiss or fix N warnings first", already reviewed or added).
  - **Exclude:** shown disabled with "Excluding a lot arrives with record edits", because no command backs it yet (gap for Task 9/10). The spec's "excluded" filter waits for the same command, since no lot can be excluded yet; it is not mapped to Retired, which means split or merged.
  - **Tests:** five new tests (open on the first lot, show a chosen lot, blocked lot reason, Exclude and no UUIDs in details, record chain) failed first, then passed. Existing tests now use "Show <lot>", and URL assertions include the auto-shown lot. Frontend 522/522.
- **8.2 problem fixes:** `frontend/src/operator/problem-actions.ts` maps each problem to its fix on the owning screen:
  - **Part not chosen:** "Choose the Part" opens the Part editor, and "Decide in Records" links to Records.
  - **Quantity and location problems:** "Set the quantity" or "Set the location" opens the lot's own editor. Every location problem except a missing location (a conflict, an invalid draft parent, an unconfirmed group) also links to "Check evidence groups in Capture".
  - **Warnings:** evidence warnings link to Capture, and a missing-evidence warning also to "Link evidence on the Map" (since round 4) (reading and crop routes were dropped in review round 1, because no server code raises them).
  - **Open question:** when the lot (or, since round 5, its Part) has an open Processing question, the details pane links to it under the record chain (since round 6), and "Answer the open question" also comes first on the problems an answer can settle (Part choice, quantity, location). Answering inline and queuing to the asking session wait for Task 14's sessions.
  - **Unroutable problems:** no fix is offered (for example unsettled source history).
  - **UI:** `IssuePanel` shows the fixes under each blocking problem and warning.
  - **Tests:** first 5 unit tests, then 1 integration test (Records link, Capture link for a warning, "Set the quantity" opening the lot editor). Each failed first, then passed.
- **8.3 Table:** one selection, held by `ManualWorkspace`, is now shared by the Workspace and the Table, and the filter was already shared through the URL, so switching views keeps both. The Workspace queue keeps its 10-lot cap. The Table can select more for bulk edits, which the contract allows up to the active-lot limit. Mark reviewed and Prepare then say "Select at most 10 lots to review or prepare together." The Table already used the design tokens from PR-A, and its bulk edit already named its scope ("applies to every selected lot or to none", "Apply to N lots"); its look was then checked in the browser. The test (select in Workspace, see it in Table, change it and the filter there, see both back in Workspace) failed first, then passed.
- **8.4 Map:** `operator/review-map.ts` derives file-level links (a file supports a lot when linked to the lot, its Part, or, since round 3, a lot it was split or merged from), flags files no active lot uses, and flags lots resting on a single file. `ReviewMap` shows Evidence and Lots side by side:
  - **Files:** "Supports" chips with Unlink, a "Link to a lot…" choice, and "New lot from this" on unused files.
  - **Lots:** "From" file lists, Split, and merge checkboxes.
  - **No instruction field:** none appears without agent sessions.

  `ReviewMapStage` reads the media snapshot and applies the edits through existing commands:
  - **Link and unlink:** the media `link` edit at the read revision.
  - **New lot from this:** capture `add_lot` with the note "Made from evidence “<file>”." When the refreshed batch shows the new lot, the file is linked to it, because `add_lot` takes no client id.
  - **Split and merge:** the existing `RestructureDialog`.

  The Map replaces the placeholder at Review › Map, and the header's Map tab is now a link.
  - **Tests:** model 2 (written alongside the model, not before), map component 5 and stage 2 (written first; they failed on the missing module). The header test now expects a Map link. Frontend 538/538; typecheck, lint and build pass.
- **Browser check and the ID fix:** `batch-capture.html` now gives `Batch` a synthetic manual client and operator projection, with a lot blocked twice and one with a warning, so Review › Lots, Table, Map and Records render.
  - **Captures:** Lots (opened on the blocked lot), the blocked lot's details, Table and Map at 1440px and 390px. No horizontal overflow.
  - **Fix found:** the evidence pane showed shortened evidence and version IDs in its source picker and note headings, against "No internal identifiers inline". `mediaDisplayLabels` now labels a file by name and kind ("Packing slip · original", "· crop N") and numbers files that share a name (round 1), with IDs only in the viewer's Details. A test written first covers it.
  - **Existing behaviour, not changed here:** Review reads its view from the URL when it mounts, so a hash change on an already-open Review page does not switch view.
  - **Checks:** frontend 539/539.

### PR-D review round 1

Fresh read-only Claude reviewer at `ac2b871`: 2 Important, 10 Minor, 1 Nitpick, all fixed, test-first except the wording changes.

- **Unlink on a Part-derived link did nothing (Important):** the map now records whether each link is direct or through the lot's Part. Part-derived links show "via shared Part" with no Unlink.
- **A failed "New lot from this" could link a later lot (Important):** `Batch.edit` reports failure as `false`. The stage now clears the pending link on `false`, and links only a new lot whose label matches. Tested with a failed save followed by a lot with the same label (tightened in round 2).
- **Minor:**
  - **`?edit=`:** auto-show keeps it in the URL.
  - **Back to the list:** the choice is kept in `history.state`, so a remount after a save does not jump to a lot.
  - **Draft location:** shown as "new" in the record chain.
  - **Map loading:** shows "Reading evidence…" instead of "No evidence" on every lot.
  - **Map restructuring:** split, merge and move are locked for lots already added. Merge and move ignore retired IDs, and Move is now offered.
  - **Duplicate file names:** numbered ("image.jpg (2)") in Review and on Capture tiles, with identifiers in the viewer's Details. The attachment picker keeps exact identity labels.
  - **Unemitted warning codes:** problem routes for them were dropped, and `possible_duplicate_part` routes to the Part comparison and Records.
  - **Label-in-name:** "New lot from this: <file>".
  - **Instruction-field test:** it now renders the normal map.
- **Nitpick:** "Choose a lot to compare…" replaces the Inspect wording.

### PR-D review round 2

Fresh read-only Claude reviewer at `b4a8815`: 4 Minor, 1 Nitpick, all fixed test-first except the doc lines. It confirmed the server stores `add_lot` labels unchanged and that evidence order is stable, so the label match and the numbering hold across polls.

- **Back to the list was lost by other URL writes (Minor):** every Review URL write now keeps the choice, and it is written only after navigation succeeds, so a blocked navigation leaves it alone. Tested by going back, changing the filter and opening the editor before a remount; the blocked case gained its own test in round 3.
- **Failed-save test (Minor):** the later lot now has the same label, so only clearing the pending link on `false` keeps the test green; checked by removing the fix.
- **Numbering across the batch (Minor):** names are numbered once over the whole media snapshot (`evidenceDisplayNames`), so a file reads the same in Capture, Review's viewer, Processing images and the Map. The Map's rows, controls and "From:" lists use the numbered names. Details pairs each numbered name with its identifier.
- **Map locks while the review is stale (Minor):** the added-lot set falls back to the last accepted review (`approvedLotIds`), since adding is never undone, and split, merge and move are disabled with a note until the latest review is read. Linking stays available.
- **Nitpick:** the handover lines on numbering and Capture links were corrected.

### PR-D review round 3

Fresh read-only Claude reviewer at `d9538a3`: 1 Important, 2 Minor, 1 Nitpick, all fixed. It confirmed the round-2 fixes.

- **The Map ignored lineage (Important):** a split or merge keeps media links on the retired lot, and the server counts a predecessor's evidence for its successors, so the Map marked the file "Used by no lot" and the successors "No evidence". `predecessorLotIds` now reads each lot's predecessors from the operator review's retired lots, and `reviewMap` walks them to the server's depth of 100. Inherited files show "via earlier lot" with no Unlink. Tested for a split followed by a merge, and for a looping lineage. Until the next operator review is read after a restructure, the lineage is the last accepted one; the Map's status note says inherited evidence waits for it.
- **Blocked return to the list (Minor):** a test now makes a draft dirty, presses back, discards and remounts, and expects the lot still open; it fails if `inspect` writes the choice unconditionally.
- **Raw names left (Minor):** the Processing images versions region and the viewer's image alt text now use the numbered names.
- **Nitpick:** the architecture says identifiers appear only in a viewer (Review's Details, Capture's file viewer).

### PR-D review round 4

Fresh read-only Claude reviewer at `7d24e81`: 2 Minor, 3 Nitpick, all fixed except the "excluded" filter, recorded as a gap. It confirmed the round-3 lineage matches the server's edges and walk.

- **Missing filters (Minor):** "Needs answer" now lists lots with an open Processing question, with a count (extended to Part questions in round 5). "Excluded" waits for the Exclude command (Task 9/10), recorded with Exclude above.
- **Stale lineage looked final (Minor):** while the latest review is unread and the batch has retired lots, the Map's "Used by no lot" and "No evidence" read "… · checking history", and "New lot from this" is disabled for files linked to a retired lot. Linking stays available.
- **Nitpicks:** the 8.4 line above mentions earlier lots; "No supporting evidence" also offers "Link evidence on the Map"; the Map's link list now offers lots the file supports only through a Part or an earlier lot, so a direct link can be added.

### PR-D review round 5

Fresh read-only Claude reviewer at `02e0374`: 3 Minor, 2 Nitpick, all fixed. It confirmed the round-4 fixes.

- **Questions on a Part (Minor):** a Processing job can be about a Part, so its question applies to every lot using that Part. `openQuestionsByLot` (in `operator/review-model.ts`, replacing `openQuestionFor` and `openQuestionLotIds`) gives each lot its own first open question, else its Part's. It drives both "Needs answer" and "Answer the open question". Unit-tested.
- **Unknown questions looked like none (Minor):** before Processing is read, or without a Processing client, the "Needs answer" count reads "…" and the filtered list says the open questions have not been read.
- **Wiring test (Minor):** an integration test gives one lot an open question, then expects only that lot under "Needs answer" with a count of 1, in the Workspace and the Table. It fails if the queue is not given the questions.
- **Nitpicks:** "No lot yet · checking history" now shows only on files linked to a retired lot, with "Used by no lot" on others; the lot-side "No evidence yet · checking history" is tested.

### PR-D review round 6

Fresh read-only Claude reviewer at `d24198f`: 1 Minor, fixed test-first. It confirmed the round-5 fixes.

- **A lot under "Needs answer" could have no way to its question (Minor):** the question link appeared only on Part-choice, quantity and location problems. The details pane now says "Processing has an open question about this lot" with "Answer the open question" under the record chain whenever the lot has one. The integration test puts a question on a lot whose only problem is missing evidence; it failed first, then passed.

### PR-D review round 7

Fresh read-only Claude reviewer at `0b8c86e`: 1 Minor, 1 Nitpick, fixed (the Minor test-first). It confirmed the round-6 fix.

- **Stale Map link target (Minor):** after a successful link the chosen lot left the "Link to a lot…" list but stayed chosen, so Link stayed enabled and could resend the link, or send one to a lot retired since. A choice that is no longer offered now counts as none. The test links, rerenders with the new link, and expects the placeholder and a disabled Link; it failed first, then passed.
- **Nitpick:** the architecture and the 8.2 Warnings line now name the Map among the places problems route to.

### PR-D review round 8

Fresh read-only Claude reviewer at `7330b65`: clean. Its one optional Nitpick was accepted: the Map remembers a lot chosen before a link, so after that link is removed the lot shows as chosen again. It is visible and harmless.

### PR-D delivery

CI on #104 passed on every job that ran (frontend, TypeScript, Markdown); the intake and backend lanes did not apply. Squash-merged as #104 (`1672e00`) under Mitch's standing authorisation. The demo (72 s) was recorded at `d9538a3` from `batch-capture.html` and attached to the PR; it shows Lots with problem fixes, the record chain and Mark reviewed, the shared Table selection, and the Map's flags, Link, New lot, Merge, Move and Split. The fixture has no single-file lot, Part link, lineage, open question or location problem, so those are not filmed.

## PR-E plan: Records (Tasks 9 and 10)

Branch `feat/redesign-batch-workspace-records` from `1672e00`. Merge is authorised once review and CI are clear; a demo video is attached before merge.

## PR-E results

- **9.1 Contract:** `contracts/src/records.ts` adds the `record` capture change (`RecordRef` target, one operation), an optional Part `description` (1–250 characters, absent when unset) and the shared `recordScope` and `applyRecordChange`. Contract tests cover every operation and refusal (12 after review).
- **Design adjustment (D6, now also in `design.md`):** the edit response stays the capture snapshot. Instead of the server listing affected Parts and lots, the browser and server share `applyRecordChange`: the UI states the scope and names a refused Part before sending, and the server applies the same function and re-validates.
- **9.2–9.4 Apply:** `repository.ts` applies a record edit in the edit's transaction, writing each rewritten spec as a new operator `choice` version through `insertSelection` (so `validatePartSpec` runs) and bumping each Part's subject revision. PostgreSQL tests, written first and failing on a temporary refusal: CAS 412 with nothing written, a company map reaching two Parts in one revision with the operator as actor, a role-mismatched company refused, a template map refused for an unmapped category and accepted with that Part excluded, a category change refused until each parameter is mapped or dropped, reviewed lots of the edited Part reading `changed_after_review` (others still reviewed), a static check that capture never imports operator review, and a description set then cleared. The owned effects fake gained a second category, mappings and single-role companies on unused pks.
- **9.3 Description:** `partEffects` and `supportedCreateBody` include it only when set. A unit test fixes the digests of a description-free spec recorded before the change; an end-to-end test sends a description to the fake and confirms the create.
- **9.5 Records read:** `projectRecords` (in contracts, so the browser fixture uses the same projection) and `GET /api/v1/batches/:id/records`. Unit tests (11 after review) and a route test (the read follows an edit and writes nothing). Locations group lots by where they resolve; a lot with no location is a decision. Tags read as Update (applied to new Parts). Images and attachments are not listed: they are chosen as evidence in Capture, and the Part record links there.
- **10 Records UI:** see `frontend/ARCHITECTURE.md` "Review Records". Twelve component tests at first (22 after review): counts, a company map with scope text and role-filtered options, a refused save keeping its draft, a template map naming the Part with no mapping and then excluding it, Part name and description (cleared to null) with origins and no Ask, a Part decision starting a new Part, a SKU edit, category change mapping and dropping, parameter edit/remove/add and tags, blocking another record while dirty, and a failed read. The first nine were written first and failed; the last three were written after the editors and passed at once. `CompanyDecision` is tested with a fixture proposal; real proposals arrive with task 14.7.
- **Browser:** `frontend/tests/fixtures/records.html` applies edits in memory with `applyRecordChange` and projects with `projectRecords`. Checked at 1440 and 390 px (no horizontal overflow) for the type rail, a company, a Part, a decision and a template.
- **Gaps:** proposed-new and unsupported values, Ask and the GCT and new-category scenarios end to end are task 14 (14.6, 14.7). Creating companies, categories and templates is shown as not supported yet.

### PR-E review round 1

Fresh read-only Claude reviewer at `36a738c`: 3 Important, 6 Minor, 2 Nitpick, all fixed; behaviour fixes test-first.

- **A section save discarded the Part's other drafts (Important):** the detail was keyed by batch revision, so an accepted save remounted every editor. It is now keyed by record only; a clean draft follows its saved value, and choice drafts (company, template, category, new parameter, new Part) clear after an accepted save. A test with saves that move the revision keeps an unsaved description across a name save; it fails with the old key.
- **One long label failed the whole read (Important):** labels joining two values are clipped to 256 characters; a projection test validates long names, codes and values.
- **A kept draft could not be retried after a 412 (Important):** a refused save offers "Load current values, keep this draft", which loads the batch (`reloadSavedValues`, clearing the stale pending edit) without remounting Records. A test refuses the first save, loads, and saves the same draft.
- **Minor:** an unknown record type in the route is ignored; a Part whose choice was cleared needs a decision; the stale banner offers "Load current values"; a description is one trimmed line (schema pattern and a single-line input); template pickers offer only templates enabled for Parts; a template already on a Part is `duplicate_parameter_mapping` with its own message, and `set_parameter` must keep its target template; `design.md` D6 and tasks 9 and 10.5 now match.
- **Nitpick:** a record edit validates each Part against the observations it already read, instead of a snapshot per Part.
- **Accepted:** other server-only refusals (for example tag rules) still use the batch's generic "Save not confirmed" path; "Load current values, keep this draft" now recovers from it.

### PR-E review round 2

Fresh read-only Claude reviewer at `fef57d0`: 1 Important, 1 Minor, 1 Nitpick, all fixed. It confirmed that loading current values keeps Records drafts (nothing remounts Records or the detail).

- **Normalised saves stayed unsaved (Important):** Tags and Description send a normalised value (tags split, trimmed and de-duplicated; description on one trimmed line), but the field kept the raw text, so it stayed dirty after the save was accepted. The field now sends the normalised form and keeps it once accepted. A test with saves that move the revision checks both fields and that another record then opens; it failed first.
- **Follow-saved read the ref late (Minor):** `useDraft`'s updater compared with a ref it reassigns, which React can read on a later render. It now compares with the old saved text captured first. A test loads current values that rename the Part and expects the clean Name to follow while the Tags draft stays; it passed before and after, since the deferred case did not reproduce in the test.
- **Nitpick:** record ids are encoded in the hash and decoded when parsed, so a tag such as "1/4W Bin" reopens.

### PR-E review round 3

Fresh read-only Claude reviewer at `3046bce`: 3 Minor, 1 Nitpick, all fixed test-first. It confirmed the round-2 fixes.

- **A failed read after a save dropped every draft (Minor):** a new revision's records read starts without data, so a failure unmounted the detail. Records keeps the last good read, shows it as out of date with editing paused, and "Load current values" loads the batch and reads records again. A test fails the read after an accepted save, keeps an unsaved description, and reads again.
- **"Latest proposal" was not the latest (Minor):** retained proposals come back ordered by stage name and random id. A field now shows the step of any proposal about the Part that it still matches. A test with an unmatched proposal read last keeps the matched step.
- **The records cap could be exceeded by a valid batch (Minor):** raised from 2000 (to 10000 here, then to the derived bound in round 4).
- **Nitpick:** the test counts above are updated.

### PR-E review round 4

Fresh read-only Claude reviewer at `8321c3b`: 1 Important, 1 Minor, both fixed test-first. It confirmed the round-3 fixes.

- **The shared Part editor dropped a description (Important):** `captureEditorChange` rebuilds a new Part's whole spec, and the editor has no description field, so saving a label or location there deleted a description set in Records. It now keeps the Part's existing description. A unit test (`capture/editor-model.test.ts`) changes only the label and expects the description kept; it failed first. Other spec writers (shared tags, processing suggestions) already spread the spec.
- **The records cap was still below the worst case (Minor):** a Part yields at most 102 records (35 of its own, 67 shared when nothing is shared with another Part), so 100 Parts give 10,200. The cap is 12,000, with the arithmetic beside it; a test projects exactly that worst case and validates it.

### PR-E review round 5

Fresh read-only Claude reviewer at `b2f93a4`: 3 Minor, 1 Nitpick, all fixed test-first. It confirmed the round-4 fixes and that every other Part spec writer keeps the description (they spread the spec), effects include it only when set, and review material takes it in by design.

- **The catalogue check still called descriptions unsupported (Minor):** `assessCatalogue` (`intake-server/src/processing/catalogue.ts`) now marks a proposed description applicable when it fits `PartDescription` (one trimmed line, at most 250 characters), and `description_unsupported` otherwise. Tests cover a fitting, a long and a multi-line description.
- **A stock item inheriting the batch quantity showed none (Minor):** the projection resolves an inherited quantity to the batch default, as approval does. A projection test covers it.
- **Docs (Minor):** `design.md` D6 and task 9.5 now say a field shows the step of a retained proposal it still matches.
- **Nitpick:** Records trims the Part name, a new Part's name, parameter values, MPN and SKU before sending; tests type padded values and expect them trimmed.

### PR-E review round 6

Fresh read-only Claude reviewer at `1fa964c`: 1 Minor, fixed test-first. It confirmed the round-5 fixes.

- **Padded values stayed unsaved (Minor):** round 5 trimmed the parameter value, MPN and SKU it sent but kept the raw draft, so after an accepted save the field stayed dirty and blocked opening another record (the round-2 failure, for these editors). `ParameterEditor` and `SourcingEditor` now keep the trimmed value once the save is accepted. A test with saves that move the revision saves a padded SKU, opens another record, and saves a padded parameter value; it failed first.

### PR-E review round 7

Fresh read-only Claude reviewer at `e9e6e6a`: 1 Minor, 2 Nitpick, all fixed. It swept every Records editor for drafts that differ from the saved value after an accepted save and found none, and confirmed the round-6 fix.

- **Tags suggested from a lot read "Set by you" (Minor):** a lot's proposal can add tags to its Part ("Add suggested tags"), but origins looked only at proposals about the Part. A Part's fields now also check proposals about its active lots. A projection test with a lot-subject proposal failed first.
- **Nitpicks:** the text, parameter and sourcing inputs are disabled while their save is in flight, so nothing typed meanwhile is replaced when the save is accepted; the test counts above are updated.

### PR-E review round 8

Fresh read-only Claude reviewer at `024a633`: 1 Minor, 1 Nitpick, both fixed. It confirmed the round-7 fixes.

- **Docs (Minor):** `intake-server/ARCHITECTURE.md`, `design.md` D6 and task 9.5 now say a field's origin can come from a proposal about the Part or one of its active lots.
- **Nitpick:** every Records editor now disables its inputs while its save is in flight, including the ones that clear after a save (new parameter, category, company, template, new Part), so input typed meanwhile is not cleared.

### PR-E review round 9

Fresh read-only Claude reviewer at `dcd63c4`: 1 Minor, 1 Nitpick, both fixed test-first. It confirmed the round-8 fixes.

- **A second save was dropped silently (Minor):** the batch sends one edit at a time, so a save clicked in another section while one was in flight returned unsaved with no reason. A shared `SavingContext` now disables every record Save (and Remove) while any record save is in flight. A test holds one save open and expects the other section's Save disabled until it ends.
- **The out-of-date banner flashed after each save (Nitpick):** until the new revision's read arrives, the previous read stands in; that is now shown as refreshing (editing paused, no warning), and the banner stays for a failed read or a settled mismatch. A test with a slow read checks there is no warning; it fails with the old condition.

### PR-E review round 10

Fresh read-only Claude reviewer at `f733137`: 2 Minor, 2 Nitpick. Both Minor findings and the first Nitpick are fixed test-first; the second Nitpick is recorded. It confirmed the round-9 fixes.

- **A lot taking a new default location read as a decision (Minor):** with Default location set to a new-location draft, the default stays `unset`, so `projectRecords` filed the lot under "No location – Needs a decision", although review counts it placed and approval creates the location. A lot whose location resolves from the batch while that draft is chosen is now listed under a new record named after the draft. A projection test covers it; with the old code it read "No location", `choose`.
- **The batch's "Discard local edits" kept record drafts (Minor):** `reloadSavedValues` remounts the other stages through `reset`, but Records keeps drafts across a reload so a refused save can be retried. The batch-level discard buttons now call `discardLocalEdits`, which reloads and, once the saved batch is read, bumps a `discarded` counter that `RecordsStage` adds to the detail's key and that clears the "Save or discard" block. A test fails without the key change.
- **Nitpick, fixed:** `reloadSavedValues` returns whether it read the batch, and "Load current values, keep this draft" stays offered when it did not.
- **Nitpick, recorded:** leaving Records mid-save and coming back remounts the stage before the batch's edit settles, so a Save clicked in that window returns unsaved with the generic message; "Load current values, keep this draft" recovers.
- **Gap:** the batch's new-supplier draft is not listed under Companies yet.

