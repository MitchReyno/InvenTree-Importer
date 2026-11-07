# Styling audit: tokens and visual gaps

Evidence for tasks 15–20. Captured on `interactive-app` at `2d852e2` (2026-11-07) against the [design system](https://claude.ai/artifact/TbKY47cDmdA3Nuh2jufTmo) (tokens v2) and the [redesign canvas](https://claude.ai/artifact/TFjujLEMdBcqdRUBbvJKRf). Two read-only passes:

- **Token audit:** every styling value in `frontend/src` (excluding `theme/generated/`, tests and fixtures) classified as EXACT (a token with that value or role exists), NEAR (a step from a token; switching changes the look) or NONE (no token). The per-file table is not kept here: task 15's literal-value lint baseline regenerates it.
- **Visual sweep:** every owned fixture screen at 1440 and 390 px, light and dark, at 2×, with hover, focus, menus, popovers and drawers opened and computed styles measured, compared with canvas artboards rendered from the canvas sources. Deliberate deviations recorded in `docs/handovers/redesign-batch-workspace.md` are excluded. Severity: **High** clearly off-design or broken, **Medium** noticeable, **Low** polish. Gap IDs are per area: `G` global, `M` masthead, `B` Batches, `K` Capture, `P` Processing, `A` Agents, `R` Review, `X` Changes; clusters are `C1`–`C18`.

Values below are as measured on that commit; line numbers drift as tasks land.

**The design system decides values.** Where a cluster's recommendation differs from tokens v2, tokens v2 wins:

- **Motion:** the tokens keep the PR-A handoff's values, including the toast's 150ms entrance with an 8px rise and the popover's 90ms `ease-in` close (`duration-*`, `ease-*`, `offset-*`). They do not fold the toast into 120ms (C7).
- **Breakpoints:** Review drops its evidence pane under `bp-wide` (1180px), as the brand book says, not at the implemented 1000px (C8). The values are `bp-phone` 480, `bp-narrow` 600, `bp-compact` 760 and `bp-stacked` 860; 430 folds into `bp-phone` and 700 into `bp-compact`.
- **Widths:** content is `width-content` (1240px) on every page except Review and Records, which use `width-review` (1500px). The canvas's narrower Agents (1100px) and Batches (1000px) boards (G1, A1) are not separate widths.
- **Names:** the clusters' proposed names (`motion-*`, `ring-halo`, `media.wide`) are superseded by the tokens' (`duration-*`, `ring-width`, `bp-wide`).
- **Not tokenised:** the 3px focus halo folds into the 2px ring (`ring-width`, `ring-offset`), and the masthead scene's three.js palette stays local to `electronics-current/`.

## Token audit summary

Literal colours are already gone from the UI: `scripts/check-literal-colors.cjs` (run by `pnpm lint`) rejects hex/rgb/hsl outside `theme/` and `fixtures/`, and the sweep found **0** hex/rgb/hsl/named colours in component styles. Remaining colour literals are the 3D scene fills in `electronics-current/finishes.ts` (`0x` numbers the lint does not match) and alpha masks (`black`/`transparent`) in `ElectronicsCurrent.tsx`. The bulk of the work is spacing, radius and type values written as raw px that already equal a token.

| Category | EXACT | NEAR | NONE | Total |
|---|---:|---:|---:|---:|
| spacing | 189 | 59 | 38 | 286 |
| radius | 16 | 14 | 5 | 35 |
| type | 133 | 26 | 21 | 180 |
| shadow | 0 | 0 | 7 | 7 |
| colour | 1 | 0 | 3 | 4 |
| border | 0 | 0 | 1 | 1 |
| motion | 0 | 0 | 28 | 28 |
| z-index | 0 | 0 | 7 | 7 |
| breakpoint | 4 | 0 | 13 | 17 |
| opacity | 0 | 0 | 10 | 10 |
| sizing | 0 | 0 | 173 | 173 |
| **all** | **343** | **99** | **306** | **748** |

Notes on the counts:

- One row per literal per declaration, so `padding: 7px 9px` is two rows. `0`, `100%`, `auto`, `fr`, `transparent`, `currentColor` and 1px border widths are not counted.
- `type` EXACT means the **size, weight or line-height alone** matches a `type.*` style. Most of these should become the full mix-in (e.g. `font-size: 12.5px` → `${type.small}`), which can also change line-height; check each.
- `spacing` NONE is mostly 1–3px hairline nudges (1px/2px gaps, `outline-offset: 2px`) and 20/24px; see proposed `space-0-5`, `space-5`, `space-6`.
- `sizing` (min-height 44/32px, icon boxes, grid column widths) has no token group at all; it is listed for completeness. Only touch-target and control heights warrant tokens.

| Area | EXACT | NEAR | NONE | Files |
|---|---:|---:|---:|---:|
| Global CSS / app shell | 6 | 0 | 5 | 3 |
| Header / masthead | 15 | 6 | 46 | 6 |
| UI components | 96 | 59 | 139 | 32 |
| Records | 1 | 1 | 4 | 3 |
| Review (review + operator) | 99 | 16 | 55 | 21 |
| Capture (capture + media) | 59 | 8 | 21 | 19 |
| Processing | 37 | 6 | 9 | 11 |
| Changes | 2 | 1 | 2 | 2 |
| Batches / agents / settings / operations | 28 | 2 | 25 | 10 |

Top files by count: `review/ReviewWorkspace.tsx` (32), `ui/primitives.tsx` (28), `ui/AutoValueField.tsx` (23), `masthead/HeaderStatus.tsx` (22), `ui/EvidenceTile.tsx` (19), `ui/Progress.tsx` (17), `operator/EvidenceViewer.tsx` (17), `ui/PhaseRow.tsx` (15), `ui/Button.tsx` (15), `operator/ReviewTable.tsx` (15), `masthead/MastheadMenu.tsx` (15), `media/MediaCropDialog.tsx` (15).

## Inconsistency clusters

Each cluster is one role written several ways, with a recommended single value.

### C1. Two Button implementations (bypass)
- `ui/primitives.tsx:5` `Button` (46 importing files) and `ui/Button.tsx:180` `Control` (15 files) are near copies: both use min-height 32px→44px compact, `padding: 7px space-3`, `radius.btn`, weight 500, `line-height: 1.2` and `80ms linear`. Only `ui/Button` has variants, sizes, busy and `disabledReason`.
- Raw `styled.button` look-alikes outside `ui/`: `capture/BatchSettingsPanel.tsx:594 KeepButton` (`9px 14px`, radius 6px), `operator/DecisionPanel.tsx:396 LinkButton`, `operator/CompareMatches.tsx:235 InlineButton`, `operator/ReviewTable.tsx:205 ItemButton`, `review/records/RecordsStage.tsx:339/343`, `processing/ProcessingWorkspace.tsx:543 ReviewLink`, `masthead/HeaderStatus.tsx:293 TargetLink`.
- **Recommend:** make `primitives.Button` re-export `ui/Button` with `variant="secondary"`, then move call sites over. Use `variant="link"` for the link-style buttons. Control padding becomes one value: `calc(${space[2]} - 1px) ${space[3]}`, or a new `space-control-y` token (7px = 8px minus the 1px border).

### C2. Control padding: 7/9/11px (border-compensated)
`7px space-3` (Button, primitives Button), `7px 9px` (primitives Input `:98`, SessionChat `:98`, Tabs `:99`), `9px 11px` (OptionRow `:49`, AutoValueField `:201`), `space-1 9px` (Button sm), `9px space-3-5` (Toast `:68`), `9px 14px` (KeepButton), `2px 9px 2px 7px` (Pill `:77`), `2px 9px` (StatusChip `:19`), `1px 7px` (Pill count `:111`), `3px 7px` (RecordChain `:96`).
**Recommend:** keep the odd px only inside `ui/` components and write them as `calc(token - 1px)` so the token relationship shows. Feature code should use the components, not copy the padding.

### C3. Card / panel / box padding: six recipes
| Recipe | Where |
|---|---|
| `space-3-5 space-4` (14/16) | `primitives.Panel`, `batches/Batches` Card, `processing/ProcessingParts` Card, `records/RecordDetail` Card, `agents/AgentSessions` Group |
| `space-3 space-4` (12/16) | `ui/ChangeSummary` Section |
| `space-3 space-3-5` (12/14) | `ui/QuestionCard` Body; `operator/IssuePanel` Box (raw `12px 14px`) |
| `space-3` / raw `12px` | `primitives.Field`, `records/CompanyDecision`, `media/MediaEvidenceCard`, `operator/BulkEditPanel`, `operator/CompareMatches`, `operator/RestructureDialog` PreviewBox |
| `space-2-5` (10) | `ui/EvidenceGroup` |
| `20px` | `processing/QuestionAnswer` Card `:260`, `operator/Modal` `:63`, `media/MediaCropDialog` `:271` |

**Recommend:** cards use `space-3-5 space-4` (the Panel value). Inset sub-boxes such as previews and confirms use `space-3`. Dialogs use a new `space-5` (20px). Change `QuestionAnswer` Card to the card value, since it is a card, not a dialog.

### C4. Container radius: 6px used for cards and boxes
These containers use 6px (`radius.input`): ScopeBar, IssuePanel Box, RestructureDialog ChildRow and PreviewBox, BulkEditPanel PreviewBox, CompareMatches Confirm, Diagnostics container and the ReviewTable scroll frame. The role is a card, so the value should be 8px (`radius.card`). The two dialogs (`operator/Modal.tsx:65`, `media/MediaCropDialog.tsx:270`) use 8px, but `radius.dialog` is 12px. ModeSwitch (`ReviewWorkspace.tsx:624`) and KeepButton use 6px, but `radius.btn` is 7px.
**Recommend:** use the role token in each case. Every change is NEAR (2–4px visible).

### C5. Dialogs (no shared component)
`operator/Modal.tsx` and `media/MediaCropDialog.tsx` both style a native `<dialog>` with 20px padding, 8px radius and their own 760px or 600px stacking rules. `RestructureDialog`, `CompareMatches`, `EvidenceGroupPanel` and `ProcessingWorkspace` use `Modal`.
**Recommend:** add a `ui/Dialog` (radius.dialog, `space-5` padding, `shadow`, `color.overlay` backdrop, `media.compact` stacking). Build `Modal` and `MediaCropDialog` on it.

### C6. Popovers: three copies
`batches/NeedYouPanel.tsx`, `masthead/MastheadMenu.tsx` and `masthead/HeaderDisclosure.tsx` each define the same `translateY(4px)→0` keyframes, `120ms ease-out`, `z-index: 1000` and `${shadow}`. `ui/AutoValueField.tsx:173` also uses `z-index: 1000` with `shadow`.
**Recommend:** share one `popoverEnter` keyframe and a `Popover` surface (radius.popover, shadow, z.popover, motion.enter) in `ui/`.

### C7. Motion durations and easing
| Use | Value |
|---|---|
| hover colour | `80ms linear` (Button, primitives Button, SegmentedControl) |
| popover entrance | `120ms ease-out` (3×) |
| toast entrance | `150ms ease-out`, 8px offset |
| spinner | `800ms linear infinite` |
| skeleton sweep | `1300ms linear infinite` |
| pulse | `1600ms ease-in-out infinite alternate` (Progress, PhaseRow), with duplicated `pulse` keyframes |

**Recommend:** `motion-fast 80ms`, `motion-enter 120ms` (fold the toast's 150ms in), `motion-spin 800ms`, `motion-sweep 1300ms` and `motion-pulse 1600ms`, with easings `ease-enter: ease-out`, `ease-loop: ease-in-out` and `linear`. The 11 `media.reducedMotion` guards already cover each animation site.

### C8. Breakpoints: seven values, two named
`media.ts` names `compact 759.98` and `stacked 859.98`. Raw queries use 430 (`EvidenceActions`), 480 (`ProcessingParts`), 600 (`RestructureDialog`, `ImpactSummary`), 700 (×8: `App`, `ReviewWorkspace` ×4, `ReviewFilters` ×2, `EvidenceViewer`; `primitives.tsx:152` also has a 700px `max-width`, a width rather than a query), 760 (`MediaCropDialog` ×2, inclusive), 860 (`CaptureWorkspace`, `RecordsStage`, inclusive) and 1000 (`ReviewWorkspace`).
**Recommend:**
- Change 760 and 860 to `media.compact` and `media.stacked`; these are EXACT apart from the inclusive edge.
- Fold 700 into `media.compact`. This moves 60px and is the most visible change (Review stacks earlier), so check it on screenshots.
- Fold 600 into compact, or add `media.narrow 600`.
- Add `media.phone 480` for 430 and 480.
- Add `media.wide 1000` for the three-column Review grid.
- Move the breakpoint values into `tokens.json` so docs and code share them.

### C9. Focus rings: four recipes
- `outline: 2px solid accent; offset 2px` (GlobalStyle; EvidenceTile with offset 1px)
- `outline: 3px solid accent` (`ReviewTable.tsx:166`)
- `box-shadow: 0 0 0 3px accentWeak` (EvidenceGroup, EvidenceDropZone: drop or selection halo)
- `0 0 0 4px accentWeak` (StatusTimeline current step)
- `inset 2px accent + inset 4px bg` (SegmentedControl)
- `Tabs` `outline-offset: -2px`

**Recommend:** keep the global 2px/2px ring as the one focus style; drop ReviewTable's 3px. Treat the `accentWeak` halos as a separate `ring-halo` (3px). StatusTimeline's 4px becomes 3px.

### C10. Uppercase eyebrows outside `type.label`
These eyebrows hand-roll the style instead of using `type.label` or `primitives.Eyebrow` (`11px / 600 / 0.06em`): `ReviewQueue.tsx:174` GroupTitle (12px, 1.2px), `FactRow.tsx:51` dt (12px, 1px), the `ReviewTable.tsx:187` and `CompareMatches.tsx:222` headers (12px, 1px), `RecordChain.tsx:114` Kind (10.5px, 0.04em) and `DisabledFeature.tsx:62` Soon (11px, 0.04em). `DataTable.tsx:158` uses `type.label` but overrides it to 0.05em.
**Recommend:** use `${type.label}` everywhere and remove the overrides.

### C11. Tables: DataTable unused
`ui/DataTable.tsx` is imported only by the component gallery fixture. `operator/ReviewTable.tsx`, `operator/CompareMatches.tsx` and `review/records/RecordDetail.tsx` each build their own `<table>` with 13px cells and their own header style.
**Recommend:** move them onto `DataTable`, or document why not. This is larger than a token swap, so give it its own PR.

### C12. Chips and pills: three systems
- `ui/Pill` is used in 17 files; it has its own `11.5px`, `2px 9px 2px 7px` and `gap 5px`.
- `operator/StatusChip` is used in 7 files, with tones neutral/blue/green/amber/red, `12px`, `line-height 1.6`, `2px 9px`, `gap 4px` and a raw 999px radius.
- `operator/ReviewFilters` Chip duplicates `ui/FilterChips`, which is used once. It has raw `6px 12px`, 999px, min-height 36→44 and a 700px breakpoint.
- `ui/SourceChip` uses `11.5px` and `line-height 1.6`.

**Recommend:** map StatusChip tones to Pill tones and retire StatusChip. Move ReviewFilters to FilterChips. Make the chip text size `type.pill` (12px), removing the 11.5px NEAR rows.

### C13. Segmented / tab switches
`ReviewWorkspace.tsx:620-640` ModeSwitch/ModeTab (6px radius, `8px 16px`, min-height 40px) duplicates `ui/SegmentedControl` (used once) and `ui/Tabs`. **Recommend:** use SegmentedControl.

### C14. Notices: two systems
`primitives.Notice`/`ErrorNotice` (19 files) and `ui/Banner` (5 files) share the same padding and radius. **Recommend:** use Banner with tones and retire Notice in a dedicated PR.

### C15. Type sizes off-scale
- `13px` (11 rows, mostly table cells and compact buttons) → `type.small` 12.5px.
- `11.5px` (5 rows: Pill, SourceChip, StatusTimeline, EvidenceTile) → `type.pill` 12px.
- `10.5px` (2 rows) → `type.label` 11px.
- `font-weight: 700` (Banner, QuestionCard, ProblemCard, PhaseRow, HeaderStatus) → 650, the heading weight.
- `550` (AutoValueField ×2, CaptureWorkspace) → 500 or 600.
- Unitless line-heights (1, 1.15, 1.2, 1.3, 1.4, 1.45, 1.5, 1.6) → each sits with a font size that has a `type.*` px line-height. Use the mix-in, and keep `line-height: 1` only for glyph boxes.

### C16. Disabled and dimmed opacity
- 0.5: Button, primitives Button
- 0.45: Tabs, Progress
- 0.6: pulse start
- 0.75: FilterChips
- `brightness(1.07)` and `brightness(0.95)`: primary hover/active (Button, EvidenceActions)

**Recommend:** `opacity-disabled 0.5` (fold 0.45 in) and `opacity-muted 0.75`. Keep the brightness hover as a shared primary-hover mixin, not a token.

### C17. Hairline spacing (1–3px) and 20/24px
- 2px gaps appear in Tabs, Progress, AutoValueField, ProcessingParts, PreparationTreeView ×2, ReviewMap, RecordDetail, Batches, ImpactSummary, HeaderStatus and MastheadMenu, about 13 sites.
- 20px is used for dialog padding, the MediaCropDialog gap, indents in SessionTimeline, WorkflowDetails and the PreparationTreeView level, and MediaEvidenceRelations. 24px is used for App padding and the EvidenceViewer empty state. 36px is used for the RotatedCropSelection margin.

**Recommend:** add `space-0-5` (2px) for the hairline gaps. Leave 1px and 3px nudges in components that line up with borders. Add `space-5` (20px) and `space-6` (24px), and move 36px to `space-10` (NEAR: 4px wider, a visible change).

### C18. Control heights and icon sizes
- 44px touch targets appear in about 37 rows over 30 files, always under `media.compact`. 32px control heights appear in 9 files.
- Icon and glyph boxes use 14, 18, 20, 22, 24, 32 and 64/84px.
- Progress fills use 6 and 8px.

**Recommend:** add `size-touch 44px` and `size-control 32px`, plus `icon-sm 14px`, `icon-md 20px` and `icon-lg 24px`. Fold 18 and 22 into 20.

## Visual gaps by area

### V1. Global / UI components

| # | Where | Design | Implemented | Sev | Fix |
|---|---|---|---|---|---|
| G1 | App shell width, `App.tsx:226-233`; every fixture `main` uses `maxWidth:1600` | Content width 1240px; 1500px for Review and Records; 1100px for Agents and 1000px for Batches on the canvas; gutter `max(16px,2vw)` | 1600px everywhere; 24px padding, 12px below 700px | High | Make width a per-route token (1240/1500) and use `space-4` gutters |
| G2 | Breakpoints, 8 `max-width: 700px` media queries in 4 files (`App.tsx:230`, `ReviewFilters.tsx:85`, …) | 760 compact, 860 stacked, 1180 for Review's evidence pane (tokens v2 `bp-wide`) | Legacy 700px queries next to `media.compact` | Medium | Replace with `media.compact` / `media.stacked` |
| G3 | Pill default glyphs, `ui/Pill.tsx:9-17` | Canvas: Running/Sorting `⟳`, New `+`/`✦`, Queued `…`, Edited `✎`, Exists `✓` (ok tone) | `info:'+'`, `acc:'•'`, `neutral:'–'`, `outline:'–'`; callers rarely pass a glyph. So "Running" shows `+` and "Exists" shows `–` | High | Pass state glyphs from the state maps (Running `⟳` or spinner, Queued `…`, Exists `✓`); keep tone defaults only as a fallback |
| G4 | Record-state tones are inconsistent: `changes/PreparationTreeView.tsx:9-13` is `new:'acc', update:'info', exists:'neutral'`; `review/records/RecordDetail.tsx:19-25` is `new:'info', update:'acc', exists:'neutral'` | New = `info`, Update = `accent`, Exists = `ok` (RecordChain spec; canvas pills) | New and Update are swapped in Changes; Exists is neutral grey in both | High | One shared `RECORD_STATE` map (tone and glyph) used by Changes, Records and RecordChain |
| G5 | Running session tone, `processing/ProcessingParts.tsx:24,179` | Canvas Agents and Processing: Running = `acc` with `⟳` | `info` (purple) with `+` | Medium | `running: {tone:'acc', glyph:'⟳'}`; Queued `outline` `…` |
| G6 | Legacy status chips in Review and Capture (`ReviewQueue.tsx:143` `StatusChip`, Proposed lots chips) | Pills have a transparent border | Many status chips draw a 1px tone border (`× 2 blocking`, `Unset`, `Unknown`, `! Changed`) | Medium | Replace `StatusChip` with `Pill` |
| G7 | Hover transitions: only `Button.tsx:195`, `SegmentedControl.tsx:52` and `primitives.tsx:20` declare `transition` | Hover backgrounds 80ms linear on every hover surface | No transition on FilterChips, RecordChain links, SourceChip, Tabs/SubTabs, PhaseRow, DataTable cells, AutoValueField, SearchableReferencePicker options, InlineEdit, EvidenceGroup, Batches rows, HeaderStatus, MastheadMenu items, EvidenceActions (all have `:hover`, measured `transition: all 0s`) | Medium | Add a shared `hoverTransition` mixin (`background-color 80ms linear, color 80ms linear, border-color 80ms linear`) with the reduced-motion guard |
| G8 | Table row hover, `ui/DataTable.tsx` | Item and table rows: hover `surface-2` | No row hover (bg stays transparent; measured on gallery `tr`) | Medium | Add `tbody tr:hover td{background:surface-2}` |
| G9 | Popover and menu close (`MastheadMenu.tsx:54-72`, `HeaderDisclosure.tsx:52-75`, `NeedYouPanel.tsx:85-123`) | Open 120ms ease-out; **close 90ms ease-in** (opacity, translateY 4px) | Open animation present (120ms ease-out measured); no close or exit animation (only `data-state='open'` is keyed) | Low | Add `&[data-state='closed']{animation: close 90ms ease-in}` (Radix keeps the node mounted with `forceMount`/presence) |
| G10 | Toast exit, `ui/Toast.tsx:73` | Exit: opacity only, 120ms | Enter only (150ms ease-out); it unmounts instantly | Low | Exit state with a 120ms opacity transition before unmount |
| G11 | Primary hover, `Button.tsx:195` | `filter: brightness(1.07)` on hover | The filter switches instantly; the transition covers only `background-color` | Low | Add `filter 80ms linear` to the transition |
| G12 | Banner (Processing native-profile banner, Added "Stock may have been created", Capture notices) | Banner: icon column 20px, padding 10px 14px, 14/20, gap 10px | `p` at 13px/18.85px, padding 10px 12px, **no icon**, `border: 1px transparent` | Medium | Use `ui/Banner` with `tone` and `icon` |
| G13 | Native selects in Review › Map, `review/ReviewMap.tsx:138` | Select: `surface`, 1px `line-strong`, radius 6, 7px 9px | UA default: padding 0, radius 0, border `#767676`, height 20px | High | Use the styled `Select` primitive |
| G14 | Broken preview presentation (Review evidence pane) | Missing image: `photo-stage` + `photo-fg` glyph + file name; never a broken-image icon | The `<img>` alt text and a broken-image icon draw at top-left over the stage ("MCU close-up · original · page 1") | Medium | Hide the `<img>` on error and render the generic glyph and name |
| G15 | Touch targets below 760px | ≥44px | Many controls under 44px at 390: Capture 29, Map 28, Processing 16, Gallery 16, Batches 5 | Medium | Apply the `media.compact` min-height to Button `sm`, link-buttons, chips and Map controls |
| G16 | Empty states (Records detail, Processing "No work yet", drawer "No status yet") | One plain sentence plus what to do, in a muted card or section | Bare text floating outside cards, or a bold "No status yet" with an empty "Steps" heading | Low | Put empty states inside the owning card as `small` `muted` text; drop empty headings |
| G17 | Disabled-reason / secondary text "Version · Invalid Date" (Review evidence) | — | Shows "Invalid Date" | Medium (broken) | Guard date formatting for missing timestamps |

### V2. Masthead / header

| # | Where | Design | Implemented | Sev | Fix |
|---|---|---|---|---|---|
| M1 | Masthead on batch screens (`masthead/Masthead.tsx:53`) | Order: … spacer · ActivityIndicator · ConnectionStatus · Open InvenTree (ghost sm) · overflow | Most screens show a bordered "Manual workflow" pill plus `⋯` only; there is no activity or connection pill unless a `status` prop is passed (the Changes and header-status fixtures pass one) | High (if the app shell also omits status) / Medium (fixture-only) | Check that `AppMasthead` always passes `HeaderStatus`; restyle the "Manual workflow" fallback as `muted` text, not a pill |
| M2 | Compact masthead (`Masthead.tsx:106-107`, `128-130`) | Below 760px: one compact row (hide breadcrumb and activity labels) | `flex-wrap: wrap`: 105px tall (two rows) on every screen and **157px (three rows)** with status | High | Keep `nowrap` at compact and hide labels as specified; the overflow menu stays in the row |
| M3 | ActivityIndicator label | Bold 12px "2 agents working" plus an 11px ellipsised batch name, segments, warn count pill | "Processing in progress · research" / "Current batch"; a single long segment; no question count | Medium | Use the agent-count label, batch name, per-step segments and `? N` pill |
| M4 | Activity popover body | 360px; jobs with segments and step labels (10px muted), padding 10px per job | 360px ✓, 14px padding, but raw UUIDs ("Batch 10000000-…· attempt 2000…"), a numbered list, a secondary "Close" button and a long timestamp | Medium | Drop IDs from the visible text (keep them in Details), render jobs with `ProgressSegments` and remove the Close button (Escape and outside click already close it) |
| M5 | Batch header band (`batches/BatchHeader.tsx:206-217`) | Full-bleed `surface` band, bottom `line` border, inner max-width; title and meta on the left, **tabs on the right of the same row**; sub-tab row under a top `line` border | An inset card (1px border, radius 8, margin-bottom 18px) inside the page gutter; tabs on their own row under the title; the sub-tab row sits inside the card | High | Make `Band` full-bleed (outside `main`), remove the border radius, use the `flex-wrap` row with tabs `align-items:flex-end`, and give the sub-row its own `border-top` band |
| M6 | Batch meta line | "9 files · 12 lots · 8 ready to check · 6 ready to add · 2 agents working" | "5 lots · 0 Part proposals" | Low | Use the canvas summary fields |
| M7 | "Needs you" trigger | `bi-pill warn` with `?` glyph and `▾`, no border, 12px | Button with `!` glyph, 1px warn border, padding 3px 12px, 12.5px, h32, no disclosure caret | Medium | Pill styling: `?` glyph, a `▾` caret and no border |
| M8 | Main tabs counts | Capture "9 files", Processing spinner + "3 questions", Review "8 to check" + "3 to decide", Changes ok "6 ready" | Capture has no count; Review "4" neutral; Changes "1" neutral; no Processing spinner | Medium | Add the Capture count and the running spinner; Changes count `ok` tone |
| M9 | Processing sub-tabs | Each step shows a state icon (✓ / spinner) and count "7 of 12" and badges | Plain "Examine Research Images Inventory" with no counts or state icons | Medium | Feed `spinner` / badge / count from attention |
| M10 | Sub-tab hover (canvas `BatchHeader` `.bh-sub a:hover`) | `fg` text **and `surface-2` background**; current item weight 600 | Colour only; current weight 500 | Low | Add the hover background and current weight per the canvas, or record the handoff's colour-only rule as decided |
| M11 | Records page "Nothing needs you" pill next to "Archive batch" | Canvas shows no archive action in the header | "Archive batch" link-styled button in the title row | Low | Move it to the overflow or batch settings |

### V3. Batches

| # | Where | Design | Implemented | Sev | Fix |
|---|---|---|---|---|---|
| B1 | Continue card (`batches/Batches.tsx`) | `bi-continue`: 200px full-bleed image column (no padding), body padded 16px 18px, gap 10px | The image is inset with padding and a radius (a 333px square), card padding around it | Medium | Grid `200px 1fr`, `overflow:hidden`, image flush to the card edge |
| B2 | Continue eyebrow | `label` style, `muted` | "CONTINUE" in `accent` colour | Low | `color: muted` |
| B3 | Continue status | Tone pills `? 3 need you`, `⟳ Agents working`; stats line with bold numbers; live status line with spinner | Neutral grey count chips ("1 ready for approval", "3 need review"…) | Medium | Use `Pill` tones and the bold-number stats line |
| B4 | Continue actions | Primary "Answer 3 questions" + **secondary button** "Review 8 ready lots" | Primary plus four plain text links (Capture / Processing / Review / Changes) | Medium | One primary and one secondary; drop the stage-link row |
| B5 | Batch rows | `bi-brow`: grid 72px · 1fr · auto, padding 12px 14px, whole row a button with hover `surface-2`; right column has a status pill and a 120×6 progress bar | Row with stage links on the right; no status pill or bar | Medium | Rebuild the row as `bi-brow` |
| B6 | Batch row thumbnail | 72px photo (`photo-stage`) | 56px dark box whose text "Notes / known values" is **clipped mid-word** ("Notes /") | High (broken) | Render the generic glyph only (no text) at thumb size, or the first evidence preview |
| B7 | "All batches" header | One `bi-sec` row: `label` "ALL BATCHES · 5", search input, "Show archived" on the right | h2 "All batches" + input + "Search" + "Clear search" buttons | Low | Label eyebrow; search as you type, or keep the buttons as `sm` ghost |

### V4. Capture

| # | Where | Design | Implemented | Sev | Fix |
|---|---|---|---|---|---|
| K1 | Capture actions (`media/EvidenceActions.tsx:26`) | `bi-capbtn`: outlined `surface` tiles, radius 8, 14px 8px padding, 22px accent glyph, 600 label and an 11.5px muted subline; hover `surface-2` | Three solid **primary** buttons (accent fill, white text, 650 weight, h50, radius 7, no glyph or subline) | High | Add a `CaptureButton` (or a Button `variant='tile'`) per `bi-capbtn`; this also fixes "one primary per area" |
| K2 | Evidence card | A dashed `line-strong` drop-zone card, padding 16px, gap 14px; `label` "EVIDENCE · 9 files · 3 groups" + `sm` "＋ New group" | Solid card, h2 "Evidence", h3 "Evidence groups", explanatory paragraphs, md "Refresh saved evidence" / "New evidence group", and the keyboard instructions shown inline | Medium | Match the canvas structure; move the keyboard help into a `small` muted line or tooltip |
| K3 | Evidence group (`media/EvidenceGroupPanel.tsx`, `ui/EvidenceGroup.tsx`) | Name as an inline-editable input (650); a `small` meta row with **sm** "＋ Add photos" and **ghost** "Ungroup"; note textarea; the tile grid | Static title; a row of four **md** secondary buttons (Rename / Ungroup / Add photos / Add document); a surface-2 "Location for group" panel; a full-width "Edit note for group…" button | High | Use `EvidenceGroup`: inline name, sm and ghost actions; move the location into a compact field or popover |
| K4 | Per-tile "Move evidence" buttons | Drag handle and selection live **on the tile**; no per-tile button row | A separate row of "Move evidence" md buttons **above** the grid, one per tile, which does not line up with the tile columns (they wrap independently) | High | Put the move handle on the tile (top-left, on `photo-scrim`) |
| K5 | Evidence tile | Image 4:3; caption 11.5px padded 4px 6px; tick on scrim top-right; the note below the caption | Placeholder stage with the file name centred in white; a small grey square (drag handle) floats top-centre, misaligned with the tick | Medium | Generic photo glyph instead of a repeated name; align the handle to the top-left corner on `photo-scrim` |
| K6 | Proposed lots glance (`capture/ProposedLotsGlance.tsx`) | Header h2 + count + status pill; a spinner status line; rows grid 44px thumb · title (13/600) + mono meta · pill; rows padded 10px 16px with a top border; footer band on `surface-2` with sm "See the map in Review" | Rows are underlined text links with a right pill (li padding 6px 0); no thumbnails, meta or status line; footer is a muted sentence with an inline link | High | Rebuild the rows per the canvas grid; footer band on `surface-2` |
| K7 | Batch settings fields | Fields sit directly on the card in a 2-column grid; the autosave "● Saved" in the card header | Default location and Supplier each sit in **`surface-2` sub-panels** (radius 8, 12px); the purchase order is a `fieldset` with a legend in a surface-2 box; "Batch settings: Saved" and "Custom instructions: Saved" lines in the body | Medium | Remove the sub-panel backgrounds; header autosave; the PO uses `DisabledFeature` (dashed border, "Coming later" eyebrow) |
| K8 | Shared tags | Chips inline with a 140px "Add a tag" input on the same row | Full-width input on its own row with a separate label | Low | Inline chip row |
| K9 | Batch-level CTA | Full-width **primary** "Go to processing →" | Full-width **secondary** "Go to review →" (550 weight, h33) | Medium | Primary, and label it for the next step |
| K10 | Two-column balance | Evidence `flex 999 1 600px`, aside `flex 1 1 380px` (about 760 / 400 at 1240) | About 810 / 600 at 1600 | Low | Follows from G1 plus the canvas flex basis |

### V5. Processing

| # | Where | Design | Implemented | Sev | Fix |
|---|---|---|---|---|---|
| P1 | Overview layout (`processing/ProcessingWorkspace.tsx`) | Two columns: left (progress card, Needs you, Recent activity), right aside (Agent sessions, Elsewhere in this batch) | One stack of full-width cards: summary, Steps, Pipeline, Sessions, Needs you, Batch instructions, Activity | High | Two-column grid at ≥860px |
| P2 | Steps progress | One card: "4 agents working", large `ProgressSegments` (8px), step labels, instruction input + Send | Four bordered sub-cards with underlined step links and text | High | Use `ProgressSegments size='lg'` with labels |
| P3 | Pipeline row | — | A stray `ı`-like vertical glyph between "Running" and "Images", and outlined "Not started" pills with an empty glyph slot (leading space) | Medium | Use a consistent `→` separator; give waiting pills a glyph or drop the empty `<i>` |
| P4 | Needs you (`ui/NeedsYou.tsx` is not used here) | grid 44px thumb · step chip + bold title + assumption · primary sm "Answer" | Underlined link title with "Open in Review" link on the right; no thumb, step chip or button | High | Render `NeedsYou` |
| P5 | Recent activity | `StatusTimeline` (10px markers, 2px rail, tabular 11.5px times) in a card | Per-attempt bordered cards with "Open this lot in Review" links **outside** each card | High | Timeline; move the attempt detail to the step pages |
| P6 | Attempt actions | Inline action row (gap 8px) | "Open this question" and "Cancel this attempt" stacked vertically, each on its own line | Medium | `display:flex; gap: space-2; flex-wrap: wrap` |
| P7 | Sessions list | Rows: step chip (neutral) + bold lot + right pill, then status line and time; "All sessions, every batch" link | Plain text rows, ghost sm "Open session" | Medium | Match the canvas rows |
| P8 | Examine page | Header strip with spinner, title and SegmentedControl "By photo / By lot"; photo cards with a region stage and numbered observations; lead-session drawer docked right with timeline, QuestionCard and chat | Generic cards: Questions, Sessions, per-attempt cards | High (partly blocked by observation data; the layout is not) | Build the step-page pattern; at least the header strip and the docked drawer |
| P9 | Session drawer | Docked right panel (canvas) or side drawer; StatusTimeline; chat bubbles (85% max, accent-weak for own messages); composer with an inline Send | **Centred modal dialog**; empty "Steps" heading; bold "No status yet"; full-width disabled "Send" button under the textarea | High | Right-side drawer (`position:fixed; right:0; width:min(420px,100%)`) with `shadow`; `SessionChat` composer inline |
| P10 | Running indicator in PhaseRow, `ui/PhaseRow.tsx:20` | Running disc shows a spinner (canvas `⟳`), 22px disc with 1.5px ring | `glyph:'•'` | Low | Use `Spinner` inside the running disc |
| P11 | PhaseRow caret | 14px caret column (`▾` / `›`) | Renders as a small `•` / dot at the right | Low | Use a chevron glyph rotated on `aria-expanded` |

### V6. Agents

| # | Where | Design | Implemented | Sev | Fix |
|---|---|---|---|---|---|
| A1 | Page width and header (`agents/AgentSessions.tsx`) | 1100px; h1 + `small` muted intro; "Agent settings" secondary button on the right | 1600px; h1 only; no intro or button | Medium | Add the intro and button |
| A2 | Summary | **One** card, padded 12px 16px, gap 18px: `label` + slot segments (28×8) + `small` text; Model; Waiting for you; "Pause all agents" sm | Three separate bordered cards with bold sentences | Medium | A single summary card with labels and segments |
| A3 | Sessions per batch | `DataTable` (Step · Lot · Latest status · State · Since), header row on `surface-2`, times as `HH:MM` tabular | Stacked text rows with "Since 11/6/2026, 7:01:00 PM" | Medium | `DataTable` with short times |
| A4 | Pagination | — | "Newest sessions" / "Older sessions" as disabled ghost text that reads like body copy | Low | Show these only when there is more than one page, as sm secondary buttons |

### V7. Review: Lots, Map, Records

| # | Where | Design | Implemented | Sev | Fix |
|---|---|---|---|---|---|
| R1 | View switch, `review/ReviewWorkspace.tsx:621-639` | `SegmentedControl`: 1px `line-strong`, radius 7, buttons 6px 11px, **selected `fg` fill with `bg` text** | Custom `ModeTab` (role=tab): 8px 16px, min-height 40, radius 6, selected `accent-weak` + `accent` 600 | High | Use `ui/SegmentedControl` (labels "Workspace" / "Table" per the canvas) |
| R2 | Filter chips, `operator/ReviewFilters.tsx:74-96` | `FilterChips`: 3px 10px, 12.5px, radius pill, `line` border, **selected `fg` fill** | 6px 12px, 14px, min-height 36, `line-strong` border, selected `accent-weak`/`accent`/600; labels truncate ("Needs answer …") | High | Use `ui/FilterChips`; never truncate a chip label |
| R3 | Filter chips at 390px | Wrap (`.bi-filters` flex-wrap) | One row overflowing the viewport (Blocking at 449px, Warnings at 555px), clipped | Medium | `flex-wrap: wrap` (or a deliberate scroll container with fade) |
| R4 | Lot list rows (`review/ReviewQueue.tsx`) | `bi-irow`: grid 48px thumb · title (13/600, ellipsis) + status pills + mono MPN · qty; padded 7px 8px, radius 7, hover `surface-2`, current `accent-weak` + 1px `accent` border | Each lot is a padded box (12px, radius 5) on `surface-2` with a checkbox, wrapped title, status pill and a **full-width "Show" button**; current item has a thick accent left/bottom border; groups as eyebrows | High | Rebuild as `irow`; make the row the button, drop "Show" |
| R5 | Page chrome above the workspace | Only an info Banner ("6 lots are ready to add" + "Open Changes →") above the toolbar | "Review selected lots" heading, three loose "Supplier: … / Purchase date: … / Capture tags: …" text lines, a selection card, and a row of md buttons (Add physical lot / Add shared Part proposal / Edit lot details) | High | Move batch context into Records or a collapsed detail; lot actions into the detail pane |
| R6 | Keyboard hints | `Kbd` keys ("J / K move · R mark reviewed · V view evidence") | Plain text "J/K move · R mark reviewed …" | Low | Wrap the keys in `Kbd` |
| R7 | Evidence pane card | Card with a `label` header "THIS LOT'S OBSERVATIONS · 3 from 2 files" and an "Open viewer V" sm button; close-up strip | The whole card has a **2px accent outline/border** permanently (looks like focus); native-style selects and a zoom toolbar; "Human evidence" h2 | Medium | Drop the persistent accent border (use it only for focus-visible); restyle the header per the canvas |
| R8 | Lot detail facts | `KeyValue` grid (118px label · value) with SourceChips | Eyebrow sections (EXISTING PART / QUANTITY / LOCATION) separated by rules, values + bordered status chips | Medium | `KeyValue` with `SourceChip` |
| R9 | ProblemCard | Header on `bad-weak` padded 8px 12px; **issues on `surface`** with a top `line` border, 8px 12px, actions inline | The entire card is `bad-weak`, issues not on surface; large internal padding; "Decide in Records" as a separate link line | Medium | Use `ui/ProblemCard` |
| R10 | Lot actions | Sticky detail footer: primary "Mark reviewed R", reason text, "Exclude…" link; "Ask the agent" composer | Disabled secondary buttons at the top of the detail, plus md buttons at the bottom ("Edit lot values / Split lot… / Move to Part proposal…") | Medium | Match the canvas footer |
| R11 | Table lens, cells | `DataTable`: th on `surface-2`, padded 8px 10px; td 6px 10px, `vertical-align: middle`; row height about 40px | th on **white** (no surface-2); rows about 54px with **mixed vertical alignment** (pills and "None" top-aligned, links lower) | Medium | Use `ui/DataTable` inside `TableWrap` |
| R12 | Table lens, bulk bar | `BulkBar`: dark `fg` bar, padded 8px 12px, inline field + value + "Apply to 3", "Mark 3 reviewed", "Clear" | A separate white card below the table with a form (Quantity / Location selects + "Preview bulk edit") and a second row of disabled buttons | High | Use `ui/BulkBar` above the table; it shows when rows are selected |
| R13 | Table lens, item names | Plain text (rows are selectable) | Underlined accent links | Low | Plain text; the row opens the lot |
| R14 | Map | Two-pane observation → lot diagram, `label` headings, observation cards with number badges, a selected-photo stage, a "Fix lots directly" sm button group, and a Tell Examine composer in a `surface-2` band inside the aside | Plain lists: native selects (see G13), disabled "Link" buttons, "Split" as bare ghost text, chips with ×; the Tell Examine textarea sits **outside both cards** at full page width with a lone disabled button | High (layout; the region data is deferred, the styling is not) | Put Tell Examine in the right-hand card's footer band; sm buttons; styled selects; observation rows as bordered cards |
| R15 | Records type nav (`review/records/*`) | One-line rows: name left, `Count` right (`1 new · 7`, warn `1 to decide`), padded about 8px 14px; selected `accent-weak` + 1px `accent` border, radius 7 | 2–3 line blocks (name / "0 new · 2 existing" / a warn pill on its own line), 8px padding, selected `surface-2` fill with no border | High | Single-line rows with right-aligned counts; selected per the `irow` rule |
| R16 | Records list | Card with h2 + count, `label` group headings (MANUFACTURERS / SUPPLIERS), rows with a top border, bold title, a right-aligned pill, and a muted detail line; selected row `accent-weak` | Rows without dividers, title at **400 weight**, pill placed under the title, "Used by 2 lots" below | Medium | Match the row grid: title 600, pill right |
| R17 | Records page header | "Every InvenTree record this batch touches" + subline on the left, FilterChips (All / New / Updates / Needs a decision / Edited by you) on the right | No page header or filters; detail placeholder is bare text with a disclosure | Medium | Add the header row and filters |

### V8. Changes

| # | Where | Design | Implemented | Sev | Fix |
|---|---|---|---|---|---|
| X1 | Ready to add layout (`changes/ReadyToAdd.tsx`) | Two columns: "Lots to include" card (left, about 700px) and "What will change" card (right) at 1240px; page header row with a warn pill on the right | One stack at 1600px; "Ready to add" heading then a "Lots to add" card then a full-width "What will change" card | High | Two-column grid ≥860px |
| X2 | Lot rows | Rows padded about 12px 22px with top dividers: checkbox · 34px thumb · bold title + muted "500 pcs · Incoming drawer" | A bare checkbox list (label 12.5px/500, h20, **no row padding or dividers**), no thumbs or meta | High | Row grid per the canvas |
| X3 | "What will change" header | h2 + summary subline; `SegmentedControl` **at the right of the header** | SegmentedControl on its own line under the title; no summary line | Medium | Header row with the segmented control on the right |
| X4 | By type rows | Pill **before** the record (New/Update/Exists), mono IPN, name, muted detail; sections with `bi-sec` padding; collapsed sections summarised in one line | Underlined link, then the pill; Exists neutral `–`; New acc `•` (see G4) | Medium | Pill-first rows; mono IDs; plain text with a link only on the IPN |
| X5 | Sticky footer target chip | `ConnectionStatus`-style chip: `surface`, 1px `line`, info dot + "Test InvenTree" | `info` Pill with a `+` glyph | Low | Use the connection chip (dot) style |
| X6 | Added page outcome strip and rounds | Outcome strip, per-round cards with InvenTree links and pills; failures with their own fix button | Strip as plain text with a `+ Test InvenTree` pill; banner without icon; inner effect box on `surface-2`; "Pending changes" / "Not included" as bullet lists | Medium | Banner component; pills per outcome; list rows instead of bullets |

---

### Cross-cutting patterns

1. **Screens bypass the component library.** The gallery measures to spec, but Review (filters, mode switch, rows, table, bulk bar), Capture (actions, groups, proposed lots), Processing (Needs you, timeline) and Records use older local styled-components or `primitives.tsx` layouts. This is the source of most High findings (R1, R2, R4, R12, K1, K3, K6, P4, P5).
2. **Layout skeletons differ from the canvas.** Content width is 1600 instead of 1240/1500 (G1). The batch header is an inset card, not a full-bleed band with tabs on the title row (M5). Two-column pages render as one stack: Processing overview, Changes Ready, Agents (P1, X1). Long explanatory paragraphs and loose text lines sit between cards (R5, K2).
3. **Hover motion is missing almost everywhere.** Only Button, SegmentedControl and the primitives Panel transition (G7). Table rows have no hover at all (G8). Menus and toasts animate in but not out (G9, G10).
4. **State glyph and tone maps are ad hoc.** The Pill defaults (`+`, `•`, `–`) leak into real states: Running `+`, Exists `–`, New `•` (G3). Changes and Records swap New and Update tones (G4). Running is `info` instead of `acc` (G5). Legacy chips draw borders (G6).
5. **Buttons are used where the design uses compact or inline controls.** The design uses sm or ghost buttons, inline links or no control: md buttons per group and per tile (K3, K4), full-width secondary buttons (K3 "Edit note", "Go to review", drawer "Send"), stacked vertical button lists (P6), "Show" inside every lot row (R4). Primary fill is used for non-primary capture actions (K1).
6. **Phone width.** The masthead wraps to 2–3 rows (M2). Filter chips overflow (R3). Many targets are under 44px (G15). The 700px legacy breakpoint is still in use (G2).
7. **Text treatments.** Underlined accent links are used for list items where the design has plain rows (Proposed lots, Needs you, Records, By type, Map). Long locale timestamps are used where the design has tabular `HH:MM` (Agents, activity popover). Raw UUIDs show in the popover (M4).
8. **Broken or placeholder presentation.** The thumbnail text is clipped (B6). Broken-image alt text shows (G14). "Invalid Date" shows (G17). Empty headings show (P9, G16).

#### Dark theme

Dark tokens apply consistently. No dark-only regressions were found beyond the light findings above. The light-only fixtures (`capture-settings`, `grouped-capture`, `evidence-drag`, `header-*`) needed `data-theme` set by the capture script because they don't call `themeController()`. That is a fixture gap, not an app one.

