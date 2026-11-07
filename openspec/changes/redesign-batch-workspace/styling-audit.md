# Styling audit: tokens and visual gaps

Evidence for tasks 15–23. The first two passes were captured on `interactive-app` at `2d852e2` (2026-11-07) against the [design system](https://claude.ai/artifact/TbKY47cDmdA3Nuh2jufTmo) and the [redesign canvas](https://claude.ai/artifact/TFjujLEMdBcqdRUBbvJKRf). The third pass, at `5e7c4d5`, is under [Component and structural audit](#component-and-structural-audit). Three read-only passes:

- **Token audit:** every styling value in `frontend/src` (excluding `theme/generated/`, tests and fixtures) classified as EXACT (a token with that value and a fitting role exists in the property's own family; a value equal to a token of the wrong role, or sharing only a role, is NEAR), NEAR (a step from a token; switching changes the look) or NONE (no token). The per-file table is not kept here: task 15's literal-value lint baseline regenerates it.
- **Visual sweep:** every owned fixture screen at 1440 and 390 px, light and dark, at 2×, with hover, focus, menus, popovers and drawers opened and computed styles measured, compared with canvas artboards rendered from the canvas sources. Deliberate deviations recorded in the change's [notes](notes.md) are excluded. Severity: **High** clearly off-design or broken, **Medium** noticeable, **Low** polish. Gap IDs are per area: `G` global, `M` masthead, `B` Batches, `K` Capture, `P` Processing, `A` Agents, `R` Review, `X` Changes; clusters are `C1`–`C18`.
- **Component and structural audit:** every design-system component rendered beside its app counterpart (light and dark, 2×, measured), component names compared, and every canvas screen read against the app's source for missing elements, affordances, diagrams, counts and interactions. Its gaps continue the per-area IDs.

**Token names** in this file use tokens v3's 2px spacing scale (`space-N` is N×2px), though the audit ran against v1's names.

Values below are as measured on that commit; line numbers drift as tasks land. **The token audit classified values against tokens v1**, before the design system added version 2's tokens. Most of its NONE rows for motion, z-index, breakpoints, opacity and sizes, and the proposed `space-1`, `space-10` and `space-12`, are EXACT under v2.

**The design system decides values.** Where a cluster's recommendation differs from tokens v3, tokens v3 wins:

- **Motion:** the tokens keep the PR-A handoff's values, including the toast's 150ms entrance with an 8px rise and the popover's 90ms `ease-in` close (`duration-*`, `ease-*`, `offset-*`). They do not fold the toast into 120ms (C7).
- **Breakpoints:** Review drops its evidence pane under `bp-wide` (1180px), as the brand book says, not at the implemented 1000px (C8). The values are `bp-phone` 480, `bp-narrow` 600, `bp-compact` 760 and `bp-stacked` 860; 430 folds into `bp-phone` and 700 into `bp-compact`.
- **Widths:** content is `width-content` (1240px) on every page except Review and Records, which use `width-review` (1500px). The canvas's narrower Agents (1100px) and Batches (1000px) boards (G1, A1) are not separate widths.
- **Names:** the clusters' proposed names (`motion-*`, `motion.enter`, `z.popover`, `ring-halo`, `media.wide`, `space-control-y`) are superseded by the tokens' (`duration-*`, `duration-enter` and `ease-enter`, `z-popover`, `ring-width`, `bp-wide`); border-compensated control padding stays a `calc()` of a token, which the lint allows.
- **Glyph boxes:** tokens v3 has no 18px or 22px size. The canvas's 22px PhaseRow disc (P10) and capture-tile glyph (K1) and the 18px boxes stay no-token literals rather than folding into `icon-md` (C18).
- **Exact means equal value:** a value that only shares a token's role, such as a 6px card radius against `radius-card`, is NEAR, not EXACT (design D11). Type rows that match one property swap through that property's variable.
- **Delivery:** where a cluster recommends its own PR (C11, C14), the plan's placement in tasks 19 and 20 (PR-K) applies.
- **Not tokenised:** the 3px focus halo folds into the 2px ring (`ring-width`, `ring-offset`), and the masthead scene's three.js palette stays local to `electronics-current/`.

## Token audit summary

Literal colours are already gone from the UI: `frontend/scripts/check-literal-colors.cjs` (run by `pnpm lint`) rejects hex/rgb/hsl outside `theme/` and `fixtures/`, and the sweep found **0** hex/rgb/hsl/named colours in component styles. Remaining colour literals are the 3D scene fills in `electronics-current/finishes.ts` (`0x` numbers the lint does not match) and alpha masks (`black`/`transparent`) in `ElectronicsCurrent.tsx`. The bulk of the work is spacing, radius and type values written as raw px that already equal a token.

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
- `type` EXACT means the **size, weight or line-height alone** matches a `type.*` style. A single matching property swaps through that property's own type variable (design D11). Moving to the full style when the line-height or weight differs is a NEAR, visible change.
- `spacing` NONE is mostly 1–3px hairline nudges (1px/2px gaps) and 20/24px, which tokens v3 covers with `space-1`, `space-10` and `space-12`; `outline-offset: 2px` is a focus ring, judged against `ring-offset`.
- `sizing` (min-height 44/32px, icon boxes, grid column widths) had no token group under v1. Tokens v2's `size` family covers control and touch heights, icon sizes, rings, offsets and content widths; grid track widths stay literals.

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
- `ui/primitives.tsx:5` `Button` (46 importing files) and `ui/Button.tsx:180` `Control` (15 files) are near copies: both use min-height 32px→44px compact, `padding: 7px space-6`, `radius.btn`, weight 500, `line-height: 1.2` and `80ms linear`. Only `ui/Button` has variants, sizes, busy and `disabledReason`.
- Raw `styled.button` look-alikes outside `ui/`: `capture/BatchSettingsPanel.tsx:594 KeepButton` (`9px 14px`, radius 6px), `operator/DecisionPanel.tsx:396 LinkButton`, `operator/CompareMatches.tsx:235 InlineButton`, `operator/ReviewTable.tsx:205 ItemButton`, `review/records/RecordsStage.tsx:339/343`, `processing/ProcessingWorkspace.tsx:543 ReviewLink`, `masthead/HeaderStatus.tsx:293 TargetLink`.
- **Recommend:** make `primitives.Button` re-export `ui/Button` with `variant="secondary"`, then move call sites over. Use `variant="link"` for the link-style buttons. Control padding becomes one value: `calc(${space[4]} - 1px) ${space[6]}`, or a new `space-control-y` token (7px = 8px minus the 1px border).

### C2. Control padding: 7/9/11px (border-compensated)
`7px space-6` (Button, primitives Button), `7px 9px` (primitives Input `:98`, SessionChat `:98`, Tabs `:99`), `9px 11px` (OptionRow `:49`, AutoValueField `:201`), `space-2 9px` (Button sm), `9px space-7` (Toast `:68`), `9px 14px` (KeepButton), `2px 9px 2px 7px` (Pill `:77`), `2px 9px` (StatusChip `:19`), `1px 7px` (Pill count `:111`), `3px 7px` (RecordChain `:96`).

**Recommend:** keep the odd px only inside `ui/` components and write them as `calc(token - 1px)` so the token relationship shows. Feature code should use the components, not copy the padding.

### C3. Card / panel / box padding: six recipes
| Recipe | Where |
|---|---|
| `space-7 space-8` (14/16) | `primitives.Panel`, `batches/Batches` Card, `processing/ProcessingParts` Card, `records/RecordDetail` Card, `agents/AgentSessions` Group |
| `space-6 space-8` (12/16) | `ui/ChangeSummary` Section |
| `space-6 space-7` (12/14) | `ui/QuestionCard` Body; `operator/IssuePanel` Box (raw `12px 14px`) |
| `space-6` / raw `12px` | `primitives.Field`, `records/CompanyDecision`, `media/MediaEvidenceCard`, `operator/BulkEditPanel`, `operator/CompareMatches`, `operator/RestructureDialog` PreviewBox |
| `space-5` (10) | `ui/EvidenceGroup` |
| `20px` | `processing/QuestionAnswer` Card `:260`, `operator/Modal` `:63`, `media/MediaCropDialog` `:271` |

**Recommend:** cards use `space-7 space-8` (the Panel value). Inset sub-boxes such as previews and confirms use `space-6`. Dialogs use a new `space-10` (20px). Change `QuestionAnswer` Card to the card value, since it is a card, not a dialog.

### C4. Container radius: 6px used for cards and boxes
These containers use 6px (`radius.input`): ScopeBar, IssuePanel Box, RestructureDialog ChildRow and PreviewBox, BulkEditPanel PreviewBox, CompareMatches Confirm, Diagnostics container and the ReviewTable scroll frame. The role is a card, so the value should be 8px (`radius.card`). The two dialogs (`operator/Modal.tsx:65`, `media/MediaCropDialog.tsx:270`) use 8px, but `radius.dialog` is 12px. ModeSwitch (`ReviewWorkspace.tsx:624`) and KeepButton use 6px, but `radius.btn` is 7px.

**Recommend:** use the role token in each case. Every change is NEAR (2–4px visible).

### C5. Dialogs (no shared component)
`operator/Modal.tsx` and `media/MediaCropDialog.tsx` both style a native `<dialog>` with 20px padding, 8px radius and their own 760px or 600px stacking rules. `RestructureDialog`, `CompareMatches`, `EvidenceGroupPanel` and `ProcessingWorkspace` use `Modal`.

**Recommend:** add a `ui/Dialog` (radius.dialog, `space-10` padding, `shadow`, `color.overlay` backdrop, `media.compact` stacking). Build `Modal` and `MediaCropDialog` on it.

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
- Change 760 and 860 to `media.compact` and `media.stacked`; these are EXACT apart from the inclusive edge, which moves by a fraction of a pixel (an inclusive 760px becomes below 759.98px). The screenshot diff cannot see that, so the swap steps record it.
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

**Recommend:** keep the global 2px/2px ring as the one focus style; drop ReviewTable's 3px. Superseded by tokens v3: the `accentWeak` halos fold into the 2px ring (`ring-width`, `ring-offset`), and StatusTimeline's 4px moves to it too.

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
- Unitless line-heights (1, 1.15, 1.2, 1.3, 1.4, 1.45, 1.5, 1.6) → each sits with a font size that has a `type.*` px line-height. Moving them to the style's line-height is a NEAR, visible change; keep `line-height: 1` only for glyph boxes.

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

**Recommend:** add `space-1` (2px) for the hairline gaps. Leave 1px and 3px nudges in components that line up with borders. Add `space-10` (20px) and `space-12` (24px), and move 36px to `space-20` (NEAR: 4px wider, a visible change).

### C18. Control heights and icon sizes
- 44px touch targets appear in about 37 rows over 30 files, always under `media.compact`. 32px control heights appear in 9 files.
- Icon and glyph boxes use 14, 18, 20, 22, 24, 32 and 64/84px.
- Progress fills use 6 and 8px.

**Recommend:** add `size-touch 44px` and `size-control 32px`, plus `icon-sm 14px`, `icon-md 20px` and `icon-lg 24px`. Fold 18 and 22 into 20.

## Visual gaps by area

### V1. Global / UI components

| # | Where | Design | Implemented | Sev | Fix |
|---|---|---|---|---|---|
| G1 | App shell width, `App.tsx:226-233`; every fixture `main` uses `maxWidth:1600` | Content width 1240px; 1500px for Review and Records; 1100px for Agents and 1000px for Batches on the canvas; gutter `max(16px,2vw)` | 1600px everywhere; 24px padding, 12px below 700px | High | Make width a per-route token (1240/1500), with `space-12` side padding at desktop and at least `space-8` at phone width |
| G2 | Breakpoints, 8 `max-width: 700px` media queries in 4 files (`App.tsx:230`, `ReviewFilters.tsx:85`, …) | 760 compact, 860 stacked, 1180 for Review's evidence pane (tokens v3 `bp-wide`) | Legacy 700px queries next to `media.compact` | Medium | Replace with `media.compact` / `media.stacked` |
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
| P6 | Attempt actions | Inline action row (gap 8px) | "Open this question" and "Cancel this attempt" stacked vertically, each on its own line | Medium | `display:flex; gap: space-4; flex-wrap: wrap` |
| P7 | Sessions list | Rows: step chip (neutral) + bold lot + right pill, then status line and time; "All sessions, every batch" link | Plain text rows, ghost sm "Open session" | Medium | Match the canvas rows |
| P8 | Examine page | Header strip with spinner, title and SegmentedControl "By photo / By lot"; photo cards with a region stage and numbered observations; lead-session drawer docked right with timeline, QuestionCard and chat | Generic cards: Questions, Sessions, per-attempt cards | High (task 14 delivered pixel regions with source dimensions, so the region overlays can be drawn now) | Build the step-page pattern; at least the header strip and the docked drawer |
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
2. **Layout skeletons differ from the canvas.** Content width is 1600 instead of 1240/1500 (G1). The batch header is an inset card, not a full-bleed band with tabs on the title row (M5). Two-column pages render as one stack: Processing overview, Changes Ready (P1, X1). Long explanatory paragraphs and loose text lines sit between cards (R5, K2).
3. **Hover motion is missing almost everywhere.** Only Button, SegmentedControl and the primitives Panel transition (G7). Table rows have no hover at all (G8). Menus and toasts animate in but not out (G9, G10).
4. **State glyph and tone maps are ad hoc.** The Pill defaults (`+`, `•`, `–`) leak into real states: Running `+`, Exists `–`, New `•` (G3). Changes and Records swap New and Update tones (G4). Running is `info` instead of `acc` (G5). Legacy chips draw borders (G6).
5. **Buttons are used where the design uses compact or inline controls.** The design uses sm or ghost buttons, inline links or no control: md buttons per group and per tile (K3, K4), full-width secondary buttons (K3 "Edit note", "Go to review", drawer "Send"), stacked vertical button lists (P6), "Show" inside every lot row (R4). Primary fill is used for non-primary capture actions (K1).
6. **Phone width.** The masthead wraps to 2–3 rows (M2). Filter chips overflow (R3). Many targets are under 44px (G15). The 700px legacy breakpoint is still in use (G2).
7. **Text treatments.** Underlined accent links are used for list items where the design has plain rows (Proposed lots, Needs you, Records, By type, Map). Long locale timestamps are used where the design has tabular `HH:MM` (Agents, activity popover). Raw UUIDs show in the popover (M4).
8. **Broken or placeholder presentation.** The thumbnail text is clipped (B6). Broken-image alt text shows (G14). "Invalid Date" shows (G17). Empty headings show (P9, G16).

#### Dark theme

Dark tokens apply consistently. No dark-only regressions were found beyond the light findings above. The light-only fixtures (`capture-settings`, `grouped-capture`, `evidence-drag`, `header-*`) needed `data-theme` set by the capture script because they don't call `themeController()`. That is a fixture gap, not an app one.


## Component and structural audit

Two read-only passes on `interactive-app` at `5e7c4d5` (2026-11-07), against design system version `1794021600-edd8` and the canvas sources:

- **Components:** every design-system component's preview was rendered from its `tokens.css` and `components/bundle.css`, beside its app counterpart from the Vite fixtures, at 1440 px in light and dark at 2×, and their computed styles were measured. Component names were compared by export, file name and `aria-label`.
- **Screens:** every canvas screen was read against the app's source for structural gaps: missing elements, affordances, diagrams, counts, legends, empty and warning states, grouping, ordering and interactions. Token and pixel values are out of scope here, since the passes above cover them.

**Build status.** "Buildable" means the data or command exists on the branch. Task 14 delivered sessions, region observations, the lead session, Tell Examine and Ask. "Data-blocked" names the missing field or command; those gaps are planned in tasks 22 and 23. "Behaviour" marks a gap that needs new interaction on an existing command, planned in task 21.

### Component names

The design system's name wins, and the app changes, everywhere but one place: its Tabs and its StickyFooter and ChangeSummary groups say Approve and Results, while the app's specs, canvas and code say **Changes** (Ready to add, Added), so the design system changes. Every rename and extraction lands in the task that owns the files (design D12).

| Design-system name | App today | Change | Task |
| --- | --- | --- | --- |
| ActivityIndicator, with `ActivityPopover` | The first disclosure in `masthead/HeaderStatus.tsx`, with `WorkflowDetails` | Extract `masthead/ActivityIndicator.tsx` and `ActivityPopover`; keep the `aria-label` "Workflow activity" | 16 |
| ConnectionStatus | The second disclosure in `HeaderStatus.tsx`, with `ConnectionDetails` | Extract `masthead/ConnectionStatus.tsx`; `ConnectionDetails` stays its popover body; `HeaderStatus` becomes `MastheadStatus` or dissolves | 16 |
| NeedsYou (panel) | `batches/NeedYouPanel.tsx` | Rename to `NeedsYouPanel` | 16 |
| BatchRow, ContinueCard | `<li>` rows and a local styled `ContinueCard` in `batches/Batches.tsx` | Extract `batches/BatchRow.tsx` (with `BatchThumbnail` as its part) and `batches/ContinueCard.tsx` | 16 |
| TextField | No component; `primitives.tsx` `Label`, `Input`, `Select`, `TextArea`; raw controls in `agents/AgentSettingsForm.tsx` | Add `ui/TextField.tsx` (label, control, help or error) from the primitives' control styles; `OptionalNotesField` becomes its notes variant | 15 |
| ProgressSegments; Loading | `ui/Progress.tsx` exports `ProgressSegments`, `Spinner`, `Skeleton` and `VisuallyHidden` | Split into `ui/ProgressSegments.tsx` and `ui/Loading.tsx` (`Spinner`, `Skeleton`); `VisuallyHidden` moves to a utility | 15 |
| Pill (with its count) | `ui/Pill.tsx` exports `Pill`, `Count` and `Badge` | Keep them in `Pill.tsx` as documented variants (the design system documents `bi-count` under Pill) | 15 |
| CaptureActions | `media/EvidenceActions.tsx` | Rename to `capture/CaptureActions.tsx` | 17 |
| EvidenceGroup | `media/EvidenceGroupPanel.tsx`, a screen copy | `EvidenceGroupPanel` renders `ui/EvidenceGroup` and is renamed `EvidenceGroupContainer`, or folds into it | 17 |
| QuestionCard | `processing/QuestionAnswer.tsx`, a screen copy | `QuestionAnswer` becomes the form logic inside `ui/QuestionCard` | 18 |
| SessionChat | `processing/SessionChat.tsx` shares the library's name but is a different component | Rename to `SessionChatPanel`, a container that renders `ui/SessionChat` | 18 |
| StatusTimeline | `processing/SessionTimeline.tsx`, a second timeline | `SessionTimeline` renders `ui/StatusTimeline` | 18 |
| ProblemCard | `operator/IssuePanel.tsx`, a screen copy | Retire `IssuePanel` (R9) | 19 |
| KeyValue | `operator/FactRow.tsx`, a screen copy | Retire `FactRow` (R8) | 19 |
| ItemRow | A local `QueueRow` in `review/ReviewQueue.tsx` | Extract `review/ItemRow.tsx` (R4); Records lists reuse it (R15, R16) | 19 |
| Tabs, StickyFooter, ChangeSummary labels | The app says Changes | The design system changes (DS1) | Done in the design system |

Duplicates already covered elsewhere keep their IDs: Button (C1), Pill and `StatusChip` (C12, G6), Banner and `primitives.Notice` (C14), FilterChips and `ReviewFilters`, SegmentedControl and the Review mode switch (C13), DataTable and the Review tables (C11). `HeaderDisclosure` folds into the shared `Popover`, and `Modal` and `MediaCropDialog` into `Dialog` (task 15.7). `BulkBar` stays part of DataTable, `InlineEdit` part of KeyValue, and `ProblemList` part of ProblemCard.

### Design-system changes

Made in the design system artifact with this plan, so both sides agree before task 15 starts:

- **DS1:** Tabs, StickyFooter and ChangeSummary say Changes, with Ready to add and Added, not Approve and Results.
- **DS2:** the bundle's `.bi button { font: inherit }` outranked `.bi-conn` and `.bi-act`, so the previews drew those pills at 14px instead of 12.5px. The pill rules now win.
- **DS3:** Pill documents the count's `bad` tone and its 999+ cap; Banner documents its `plain` tone and action slot.
- **DS4:** TextField documents the disabled control (dashed `line-strong` on `surface-2`).
- **DS5:** new cards for Kbd, Loading (spinner and skeleton), Popover, Dialog and MastheadMenu; the Masthead card lists the overflow menu as its last slot.
- **DS6 (with task 18.5, not yet made):** remove the PhaseRow card. No canvas screen uses it, the Processing overview shows steps with `ProgressSegments`, and task 18.5 deletes the app's unused `ui/PhaseRow`.

### New gaps by area

Severity and status as in the sections above. Spec quotes name the delta spec in this change.

#### Library (task 15 unless noted)

| ID | Gap | Fix | Sev | Task |
| --- | --- | --- | --- | --- |
| G18 | `SourceChip` is used on no screen. Records shows "Proposed by Research" as text, Lots shows `FactRow` provenance, Examine shows none. review-records requires "a source chip per value". | Chips keyed by the proposing step and operator edits on Lots (with R8), Examine and Records; the evidence-kind and confidence half is data-blocked (task 22) | Medium | 18, 19, 20, 22 |
| G19 | `QuestionCard` is used on no screen; `QuestionAnswer` uses a select for the answer basis, puts the assumption in body `fg` and has no close-ups or ghost actions | `QuestionAnswer` renders `QuestionCard` with `OptionRow` answers, close-ups, a small muted assumption and the ghost row (Add a photo, Decide later, Chat about this) | Medium | 18 |
| G20 | AutoValueField's closed trigger is a stacked box (label caption above a bold mode word), not one row of bold label, accent mode pill and muted hint | Restyle the trigger | Medium | 15 |
| G21 | NeedsYou's title is an underlined link and its right column is a step pill instead of the sm primary "Answer" | Title as plain bold text, the step as a neutral chip before it, `Button` sm primary "Answer" | Medium | 15, 18 (screen) |
| G22 | DisabledFeature hides its explanation in a hover tooltip, and puts the eyebrow above the label | Print the explanation inline as a small line; order label, eyebrow, explanation | Medium | 15 |
| G23 | AutosaveStatus's conflict and unconfirmed states are bordered boxes with stacked md buttons ("Discard my edits and load saved values") | One inline line with one sm "Reload" or "Retry" | Medium | 15 |
| G24 | No screen raises a Toast, so undoable actions (Mark reviewed, Move evidence, Apply to N) give no confirmation with Undo | Raise the shared Toast after each undoable action | Medium | 17, 19 |
| G25 | `OptionRow` is used on no screen; choices are selects and buttons | Use it for answers (G19) and match choices (`CompareMatches`) | Low | 18, 19 |
| G26 | EvidenceTile truncates its failure sentence on the stage; its caption line-height is 20px (design about 17px); preparing shows a chip on a flat stage instead of the shimmer with "Preparing…" in the caption | One legible failure sentence with retry; caption type from the token; skeleton while preparing | Medium | 17 |
| G27 | KeyValue marks an edited value with muted "· edited" text instead of the "You · Your edit" source chip; the gallery says "You · Entered" | Use the source chip and the design's words | Low | 19 |
| G28 | PhaseRow puts a state word beside the title, and its waiting disc is empty where the design shows the step number | Lapses: no canvas screen uses PhaseRow, so task 18.5 deletes it (design D12) | Low | 18 |
| G29 | ProblemCard groups per problem with per-lot issues, where the design's header is the severity group and each problem is an issue row; it has no ghost secondary action | Follow the design's grouping and add the ghost action ("Dismiss…", "Show in Part") | Low | 19 |
| G30 | DataTable's selection column is about 120px (design 40px); BulkBar has no field select and says "Clear selection" | Narrow the column; add the field select; say "Clear" | Low | 19 |

#### Masthead and batch header (task 16)

| ID | Gap | Fix | Sev |
| --- | --- | --- | --- |
| M12 | Review's and Changes' sub-tabs lack their own counts and badges: Map has none, Records only its to-decide badge, Lots only to-check, Added only its problem badge, and no tab gives a total. batch-navigation: "Each sub-view SHALL have its own count and attention badge". | Lots total and to-answer, Map "! N unused photo", Records total and to-decide, Ready to add "N lots", Added "N run" and its problem badge. The unused-evidence count joins `BatchAttention`, or comes from the media snapshot as the Map computes it. | High |
| M13 | The Need-you panel has no header ("Needs you", count, close), no step chip (it shows the group word), no warn or bad tone pills and no footer | Follow `NeedsYouPanel`: headings name the kind and owning tab, the chip names the step (from the item's route) | Medium |
| M14 | At phone width the batch header has no "← Batches" link, and its tab counts are not compact | Add the back link above the title at phone width; numeric-only counts | Medium |
| M15 | The activity popover's jobs have no batch-title heading with a state pill and no one-line latest status; status lines sit in a separate "Agent sessions" section with provider and model text. The body carries diagnostics (scope paragraph, lane occupancy, input currency, "Fine-grained step coverage is incomplete…" per job, raw state words), an h2 "Workflow details" row, 44px links at desktop and a duplicate "Agent sessions" link. It is 700px tall for two jobs where the design is 206px. | `ActivityPopover`: one job per item (title, Pill, `ProgressSegments` with step labels, the latest session status line, one link); IDs, lanes, coverage caveats and provider details behind a Details disclosure | High |
| M16 | The activity trigger draws its own segment copy: only steps with a retained state (so one segment in the fixture), no partial fill for the running step, waiting steps not dimmed. It has no "Research: 3 of 5" text and no "+N" badge, and idle reads "Application-wide" instead of "Nothing running". | Reuse `ProgressSegments` over the planned steps from the states the header read carries, add "+N" and say "Nothing running" (task 16). The partial fill and "Research: 3 of 5" need step counts the header read lacks (`steps_complete` only), so they wait for task 23.9; until then progress shows as unknown, never invented. | Medium |
| M17 | The trigger is 34px with 3/10 padding and a 6px gap (design 36px, 4/10/4/8, 8px), and the status group's gap is 8px (design 12px) | Size from the tokens | Low |
| M18 | Connection details are three diagnostic sections with long timestamps and a caveat sentence, with no host or version line and no Open InvenTree link. The pill is 32px (design about 28px) and says "unavailable" (design "unreachable"). | Host, last check and the Open InvenTree link, with the test-target sentence once; diagnostics behind Details. The server version is data-blocked: the connection status carries none (task 23.8). | Medium |
| M19 | The breadcrumb has no leading `/` after the DevBadge, and its current crumb is `fg` (design muted) | Follow the design | Low |

#### Batches and Agents (task 16 unless noted)

| ID | Gap | Fix | Sev | Task |
| --- | --- | --- | --- | --- |
| B8 | Rows and the Continue card lack the batch's current stage line ("Sorting into lots · 5 found so far"), evidence counts ("4 photos · 1 receipt") and the "1 possible duplicate" stat. Data-blocked: `InboxWorkflow` carries none of them. | Extend the batch list read (task 23), then show them | Medium | 23 |
| B9 | Times are long locale timestamps ("Last saved 11/6/2026, 8:00:00 PM") where the design uses relative times ("Last activity 42 min ago"); an explanatory footnote sits under the list | Relative times; drop the footnote | Low | 16 |
| A5 | Agents' batch groups have no "? N need you" pill | Count waiting sessions per batch from the same list | Low | 16 |
| A6 | Sessions cannot be opened from Agents, and no route deep-links a session drawer | A session route parameter that opens the drawer on Processing (behaviour) | Medium | 21 |
| A7 | Agent settings uses raw inputs and selects with browser borders, 40px height and 14/600 labels | `TextField` and the shared select | Medium | 16 |

#### Capture (task 17)

| ID | Gap | Fix | Sev |
| --- | --- | --- | --- |
| K11 | Batch notes sit in Batch settings behind "Add batch notes"; the canvas shows "Notes for the whole batch" always, in the evidence card, with "Agents read these notes while they work" | Move the field; keep its autosave | Medium |
| K12 | Group meta lacks the lot count ("2 files · 2 lots"), and tiles have no inline "＋ Note" or "Edit note" link | Add both; the per-file lot counts are already computed | Low |
| K13 | Default location lists every lot's inheritance in a `<details>` instead of one line ("2 lots override this: …") | One help line naming the overrides | Low |
| K15 | At phone width the canvas order is capture tiles, Proposed lots (three rows and "See all N lots"), groups, then Batch settings collapsed with a summary; the app stacks all evidence first and expands settings | Follow the canvas order; the collapse keeps drafts (capture-batch-settings) | Medium |
| K6 (cont.) | The glance has no "Finding…" skeleton row while Examine runs and no status pill in its header | Add both | Low |

#### Processing (task 18 unless noted)

| ID | Gap | Fix | Sev | Task |
| --- | --- | --- | --- | --- |
| P12 | Examine titles photos "Photo N" and prints raw `region x,y · w×h` inline; file names, group meta ("Not in a group · 3 observations · feeds 3 lots"), page totals and "Open photo" are missing. ui-design-system: "Screens SHALL use bench language". | File names from `evidenceDisplayNames`, the meta and totals, coordinates behind Details | Medium | 18 |
| P13 | Examine has no corrections: no "Edit readings", "Adjust regions" or "Ask for a sharper photo", no "Corrected by you" pill. processing-workspace, Correct a reading. The capture edit `kind: 'observation'` exists, and no frontend sends it. | Behaviour: correct readings and regions through that edit; ask for a sharper photo through the lead session's chat | High | 21 |
| P14 | "Lots formed" has no Stable or Question pills, no reasoning line, no truncation, no count or "Open the map"; its AI-proposed pill is `info` where the Capture glance uses `acc` | Add them; one tone for AI-proposed (ui-design-system, One status vocabulary) | Medium | 18 |
| P15 | "Elsewhere in this batch" has no unused-photo item linking to the Map | Add it from the same count as M12 | Low | 18 |
| P16 | The progress card lacks "N agents working · Started HH:MM · N lots formed by HH:MM", the activity card its "Full log" link and the sessions card "N running · limit N". "Pause all" needs a pause command (task 23). | Add the lines and links now; Pause all in task 23 | Low | 18, 23 |
| P17 | The page-end "2 lots to check" and "1 ready to add" glances are underlined links in bordered boxes | `Button` sm secondary, or links in a row | Low | 18 |

#### Review Lots and Map (task 19 unless noted)

| ID | Gap | Fix | Sev | Task |
| --- | --- | --- | --- | --- |
| R18 | **The Map draws no links.** review-workspace, Review map: "evidence on one side and lots on the other, with links between them … Links SHALL be drawn". The canvas is a three-column diagram: observations grouped under per-photo headings as 40px cards with numbered region badges and document-line badges (L1, L8), a 140px SVG gutter of curved connectors, and lot cards with "· N obs." (warn "! 1 obs." for one observation). Connectors are solid `line-strong` for a region or file that shows the lot, dotted for a document line that supports it, and `accent` for the selected photo's links, whose cards turn `accent-weak`. A caption explains the line styles; a title row ("How photos became lots") carries warn pills for unlinked observations and single-observation lots; an observation in no lot has a dashed warn card ("! not in a lot"); long lists end "N more lots below"; at phone width the diagram scrolls sideways. The app shows two lists with "Supports:" chips and "Region → lot" text. | Draw the diagram from `operator/review-map.ts`; dotted also for links inherited through a shared Part or an earlier lot (design D12); the SVG is decorative and each card keeps its links as text for assistive technology | High | 19 |
| R19 | Lot details show only Part, Quantity and Location; the canvas adds Manufacturer, MPN, Package, Date code and Unit price with source chips | Manufacturer and MPN from the Part spec, Package and Date code from its parameters; unit price stays out (supplier prices are not supported, review-records); confidence words in task 22 | Medium | 19, 22 |
| R20 | The Table lacks MPN, D/C and Supplier SKU columns, one State column with the full status vocabulary, per-cell ◆ override and your-edit underline markers, and their legend | Add them; the Excluded state follows the Exclude command (task 22.4) and unit price stays out | Medium | 19 |
| R21 | The Map has no selected-photo stage for adjusting regions or adding one ("Drag a region's corner to adjust it", "Add a region") | Behaviour, through the capture edit `kind: 'observation'` | Medium | 21 |
| R22 | The Map's direct edits are file-level only; regions are read-only text. The canvas offers "Move region to lot…", "New lot from region", "Same item as…", "Merge lots" and "Split a lot…". | Behaviour: move a region with `observation_move`; new lot from a region with `add_lot` then the move. "Same item as…" has no command (task 23). | High | 21, 23 |
| R23 | The single-source flag counts files, not observations (`singleSource` is `fileIds.length === 1`), and uses `info`: a lot built from one region and a lot built from three regions of the same photo get the same flag | Count `lot.evidence_observation_ids` once observations exist; warn tone; "! 1 lot on a single observation" | Medium | 19 |

#### Records and Changes (task 20 unless noted)

| ID | Gap | Fix | Sev | Task |
| --- | --- | --- | --- | --- |
| R24 | Records show one value per field, not existing against proposed. review-records: "Each record SHALL show … existing against proposed values". Data-blocked: the records projection carries no target's current values. | Read the current values of each mapped record (task 22), then show both | High | 22 |
| R25 | The Part record has no record breadcrumb or previous and next Part, and "Used by" gives a count, not each lot as a link with its review-state pill | Add them | Low | 20 |
| R26 | Parameters are edited one at a time, not as a per-category Part × template matrix with missing, new, added and conflict markers, a legend and a "New parameter templates · N to decide" aside | The matrix, grouping and new-template aside now; the "required here" and source-conflict markers, and each conflict's row (both values with their sources, the value used and why, and "Use 35 V" and "Ask Research"), need template-required flags and retained per-value alternatives (task 23.3) | Medium | 20, 23 |
| R28 | The Part record has no reuse banner ("≈ Not reusing RES-0031 …: different tolerance") and no category reasoning beyond a proposed-new category's reason | Data-blocked: no "nearest existing Part not reused" reason, and no reason for choosing an existing category with its alternative, is retained (task 23.4) | Low | 23 |
| X7 | The tree has no count pills ("＋ 15 new", "⟳ 1 update", "✓ 9 existing"), no "Expand all" or "Only changes", no node kind labels and no collapsed-category summaries | Add them; `PreparationNode.kind` and `state` exist | Medium | 20 |
| X8 | Unticked lots vanish from the tree instead of showing dimmed with their reason, and Update rows have no field diff (`Dielectric · empty → X7R`). Data-blocked: the preparation tree carries only ticked lots and a `detail` string. | Extend the tree read (task 23) | Medium | 23 |
| X9 | Added is one stack, not two columns: no "All" and "Needs attention N" filter, problems not first, no RecordChain links per lot, Not included lists names without reasons, and there is no "Ready to add N" card. Ready to add's Left out also lists lots, not reasons with counts. | Two columns; filter; problems first; RecordChain links; reasons grouped with counts and Review links. Activity times wait for run timestamps (task 23). | Medium | 20, 23 |

### Recorded as deliberate, not planned

- **K14:** the canvas has editable "Order or receipt number" and "Purchase date" fields and an "Also suggest tags automatically" toggle. The app keeps order and date inside the disabled purchase-order preview and has no auto-tag setting, as capture-batch-settings's current field behaviour asks over the mockup's controls (notes).
- **R27:** the canvas summarises "Who proposed what" by step with one Ask composer. The app's per-field "Proposed by" and Ask follow review-records' steering requirement (notes).
- **Unit prices** (R19, R20): supplier prices are not supported yet (review-records), so no price column or row is added.
