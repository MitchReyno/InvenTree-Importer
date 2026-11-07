# Handoff spec: PR-A foundation

> **Spacing names:** this handoff predates tokens v3, which renamed the spacing scale to a 2px unit without changing values. Each name here maps to v3 by doubling its number, with a half step adding one: `space-1` 4px is now `space-2`, `space-1-5` 6px is `space-3`, `space-3` 12px is `space-6`, `space-4` 16px is `space-8` and `space-10` 40px is `space-20`.

Implementation spec for PR-A of `redesign-batch-workspace` (tasks 1–3): tokens and themes, fonts, the component library and masthead option A. It turns the [Bench Intake Design System](https://claude.ai/artifact/TbKY47cDmdA3Nuh2jufTmo) into values and behaviour that can be checked in a PR. The [redesign canvas](https://claude.ai/artifact/TFjujLEMdBcqdRUBbvJKRf) shows the components in context.

Precedence:

- Values here are copied from the design system's `tokens.json` and `components/bundle.css` as published on 2026-11-05.
- If this file and the artifact disagree, this file wins for PR-A. Update the artifact to match.
- The [specs](specs/) and [design](design.md) win over this file on behaviour.

## Overview

PR-A changes how the app looks, not what it does:

- Every screen keeps its current behaviour and moves onto tokens and the new components.
- The masthead becomes one bar.
- A theme choice is added.
- Later bundles build screens from these components, so each component here must be complete: variants, states, keyboard behaviour and accessibility.

## Layout foundations

| Rule | Value | Why |
| --- | --- | --- |
| Base grid | 4px; spacing comes only from the `space-*` scale | Keeps density consistent |
| Page gutter | at least `space-4` (16px) | Phone readability |
| Content width | 1240px standard; 1500px for Review and Records | Review needs three panes |
| Section padding | `space-3-5` vertical, `space-4` horizontal | Prototype density |
| Column gap | `space-4-5` (18px) | Prototype two-column hierarchy |
| Breakpoints | 1180px (Review drops the evidence pane), 860px (two columns stack), 760px (masthead compacts, Review becomes list then item), 390px (reference phone) | Content-driven, taken from the prototype |
| Touch targets | at least 44×44px below 760px; at least 32px tall on desktop | Bench use with gloves or a phone in hand |

Fluid components fill their container. None has a fixed width unless this file gives one.

## Design tokens

### Colour

Each name becomes a CSS custom property (`var(--accent)`). Text pairs meet 4.5:1 in both themes; the contrast script in task 1.2 enforces this.

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `bg` | #f3f5f2 | #131715 | Page background |
| `surface` | #ffffff | #1a1f1c | Cards, inputs, popovers |
| `surface-2` | #eaeee9 | #222824 | Hover, chips, table headers |
| `line` | #d5dbd4 | #323a35 | Card and row borders |
| `line-strong` | #b9c2b8 | #47514a | Control borders (1.8:1 light, 2.0:1 dark; never the only cue) |
| `fg` | #1b211d | #e5eae6 | Body text |
| `muted` | #5a645c | #9ba69e | Secondary text |
| `accent` / `accent-weak` / `on-accent` | #28598a / #e2ebf4 / #ffffff | #82b2e2 / #1d2b39 / #0d1620 | Primary actions, links, selection, focus |
| `ok` / `ok-weak` | #2c7448 / #e0f0e5 | #74c492 / #1a2e21 | Done, ready, exists |
| `warn` / `warn-weak` | #8d5a00 / #fbefd6 | #e3b452 / #33280f | Needs answer, warnings, overrides |
| `bad` / `bad-weak` | #a8271f / #fbe4e1 | #f2918a / #3a1c1a | Blocking, failed |
| `info` / `info-weak` | #5a4a9a / #ebe7f7 | #b4a6ee / #272140 | New, proposed, test target |
| `overlay` | rgba(18,24,20,.55) | rgba(0,0,0,.65) | Dialog backdrop |
| `photo-stage` | #2f3b38 | #2f3b38 | Behind photos |
| `photo-scrim` (new) | rgba(0,0,0,.65) | rgba(0,0,0,.65) | Behind labels and controls drawn over photos |
| `photo-fg` (new) | #ffffff | #ffffff | Text and glyphs on `photo-stage` or `photo-scrim` (11.6:1 on `photo-stage`) |
| `bar` / `bar-fg` | #20282a / #dfe6e3 | #0c0f0e / #c9d2ce | Dark bars (bulk bar alternative, phone capture bar) |
| `highlight` | #ffd34d | #ffd34d | Crop handles, region outlines |
| `masthead-ground` / `masthead-dot` | #f3f5f8 / #dde3eb | #141a17 / #1f2723 | Masthead and dot grid |
| `part-outline` / `part-crease` / `part-base` | #7d8ca3 / #bcc5d2 / #f6f8fa | **#9fb0c8 / #4a5566 / #1d2430** | Electronics-current finish (dark values are new in PR-A, design D4) |
| `dev-fg` / `dev-bg` / `dev-line` | #644813 / #fff3d8 / #e7d09c | #e3b452 / #33280f / #5c4a1c | Dev mode badge |
| `shadow` | 0 1px 2px rgba(20,30,25,.06), 0 4px 16px rgba(20,30,25,.06) | 0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.3) | Floating layers only |

Token changes in PR-A relative to the design system's `tokens.json`, made in both the repository copy and the design system artifact: `photo-scrim` and `photo-fg` (new), the dark `part-*` values, the `font-sans` stack with "Public Sans Variable", and `color-scheme: light` in the generated CSS. The two with reasons worth stating:

- **`photo-scrim` and `photo-fg`** replace the literal `rgba(0,0,0,.6–.65)` and `#fff` in evidence tiles and close-ups, so the literal-colour check needs no exception for them. The contrast script checks `photo-fg` on `photo-stage` and on `photo-scrim` over white.
- **Dark `part-*` values:**
  - The outline is 8.0:1 on the dark ground.
  - The light outline is 3.13:1 on the light ground.
  - Creases are decorative, so they have no contrast floor.

### Space, radius and type

| Group | Tokens |
| --- | --- |
| Space | `space-1` 4 · `space-1-5` 6 · `space-2` 8 · `space-2-5` 10 · `space-3` 12 · `space-3-5` 14 · `space-4` 16 · `space-4-5` 18 · `space-10` 40 |
| Radius | `radius-xs` 3 (kbd) · `radius-sm` 4 (source chip, focus) · `radius-thumb` 5 · `radius-input` 6 · `radius-btn` 7 · `radius-card` 8 · `radius-popover` 10 · `radius-dialog` 12 · `radius-pill` 999 |
| Families | `font-sans`: `"Public Sans Variable", "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif` (`@fontsource-variable/public-sans` registers the family as "Public Sans Variable"). `font-mono`: `"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace` (`@fontsource/ibm-plex-mono` 400/500). The same stacks go back into the design system's `tokens.json` |

| Style | Size / line height / weight | Usage |
| --- | --- | --- |
| `brand` | 22/28/750, letter-spacing −0.01em; "Intake" at 450 | Wordmark |
| `h1` | 20/24/650 | Page or batch title |
| `h2` | 16/19/650 | Card titles |
| `h3` | 14/17/650 | Section titles |
| `body` / `body-strong` | 14/20/400 and 600 | Default |
| `small` | 12.5/18/400 | Meta, help |
| `pill` | 12/18/600 | Pills |
| `label` | 11/14/600, uppercase, 0.06em | Eyebrows, table headers |
| `button-lg` | 15/18/500 | Large buttons |
| `mono` / `mono-strong` | 12.5/18/400 and 500 | MPNs, IPNs, SKUs, date codes, quantities in lists, keys |

Tone colours and sub-element styles that a row below doesn't restate (Banner, ProblemCard and Count tones, PhaseRow discs, ProgressSegments colours, DataTable cells, StatusTimeline markers and rail, SessionChat bubbles) follow the design system's `components/bundle.css` exactly; the component tests assert them. `Count` adds a `bad` tone (`bad-weak` with `bad` text), which the bundle lacks. A running segment with no `fraction` fills 50%.

The design system's component CSS also uses a few fixed lengths below the space scale, such as 7px button padding, 9px chip padding, 11.5px meta text and 10.5px tags. They are component constants: keep them exactly, and don't add new ones. The literal-colour check covers colours only.

### Theme control

- `data-theme` on `<html>` holds `light` or `dark`. With no stored choice it follows `prefers-color-scheme`.
- A pre-paint inline script in `index.html` sets the attribute before first paint, using the stored choice or the media query.
- The choice is stored in `localStorage` under `bench-intake.theme` as `light`, `dark` or `system`. Every read and write is wrapped in try/catch, so missing storage falls back to `system`.
- A `matchMedia` listener follows OS changes while the choice is `system`.
- The generator emits `color-scheme: light` on `:root, [data-theme="light"]` and `color-scheme: dark` on `[data-theme="dark"]`, so native controls and scrollbars match.
- The theme menu lives in the masthead overflow (see Masthead): a three-option radio menu.

## Components

Each component lives in `frontend/src/components/ui/`, uses only tokens, and is exported with these props. "Slot" means `children`.

### Actions

| Component | Variants and props | Measurements | Notes |
| --- | --- | --- | --- |
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'warn' \| 'link'`, `size: 'sm' \| 'md' \| 'lg'`, `icon?` (glyph, decorative), `disabled`, `disabledReason?`, `busy?`, `as: 'button' \| 'a'` | md: padding 7px `space-3`, `radius-btn`, 1px border. sm: `space-1` 9px, 12.5px. lg: `space-3` `space-4`, `button-lg`. Gap `space-1-5` | One primary per area. Labels name verb and scope. `link` is an underlined text button with no padding |
| `Kbd` | slot | mono 11px, 1px border with 2px bottom, `radius-xs`, padding 0 `space-1` | Shortcut hints only |

### Status

| Component | Variants and props | Measurements | Notes |
| --- | --- | --- | --- |
| `Pill` | `tone: 'ok' \| 'warn' \| 'bad' \| 'info' \| 'acc' \| 'neutral' \| 'outline'`, `glyph`, slot (word) | padding 2px 9px 2px 7px, gap 5px, `radius-pill`, `pill` type; glyph box 14px at 11px | Always glyph and word. Never interactive |
| `Count` | `tone: 'default' \| 'warn' \| 'ok' \| 'bad'` | 11.5px, padding 1px 7px, radius 10px | Tab and filter counts |
| `SourceChip` | `source`, `certainty`, `tone: 'default' \| 'likely' \| 'conflict' \| 'user'`, `onOpen` | 11.5px, padding 0 5px, `radius-sm`, 1px `line` border, line height 1.6 | A button: opens the provenance viewer. Text is `Source · Certainty`, never a percentage |
| `Banner` | `tone: 'info' \| 'warn' \| 'bad' \| 'ok' \| 'plain'`, `icon`, slot, `action?` | padding `space-2-5` `space-3-5`, gap `space-2-5`, `radius-card`, icon column 20px | At most one per page, at the top of the content column |
| `ProblemCard` | `severity: 'blocking' \| 'warning'`, `title`, `summary`, `issues: {title, text, actions}[]` | header padding `space-2` `space-3`; issues on `surface` with a top `line` border | Blocking cards render first |
| `Toast` | `message`, `action?: {label, onClick}`, `durationMs = 5000` | padding 9px `space-3-5`, `radius-card`, `fg` background with `bg` text, `shadow` | Bottom centre, 16px above the safe area. Never covers a sticky footer's primary button |
| `ProgressSegments` | `steps: {label, state: 'done' \| 'running' \| 'waiting', fraction?}[]`, `size: 'sm' \| 'lg'` | sm: 14×6px segments, 2px gap, radius 2. lg: flexible width, 8px tall | Text alternative lists every step and state |
| `Spinner` | `size = 12` | 2px ring, right edge transparent | Decorative; the label carries the meaning |
| `Skeleton` | `width`, `height` | `radius-thumb`, gradient `surface-2` → `line` → `surface-2` | Preparing previews only |

### Navigation

| Component | Variants and props | Measurements | Notes |
| --- | --- | --- | --- |
| `Tabs` | `items: {id, label, count?, countTone?, badge?: {label, tone: 'warn' \| 'bad' \| 'ok'}, href, disabled?}[]`, `current` | padding 9px `space-3` `space-2-5`, 2px bottom border (accent when current), weight 500, gap `space-1` | Links, so deep links work. A disabled item renders without `href`, with `aria-disabled="true"` and `tabIndex={-1}`. Scrolls horizontally with no visible scrollbar |
| `SubTabs` | same item shape as Tabs, plus per-item `spinner?` | padding 7px `space-2-5` 9px, 13px; used in the header band (PR-B) | The second tab row. Each item can show a count and an attention badge |
| `SegmentedControl` | `options: {id, label}[]`, `value`, `onChange` | 1px `line-strong` border, `radius-btn`; buttons padded `space-1-5` 11px; selected uses `fg` background with `bg` text | Only for views of the same list |
| `FilterChips` | `options: {id, label, count}[]`, `value`, `onChange` | `radius-pill`, padding 3px `space-2-5`, 12.5px; selected uses `fg` background | Counts always shown, zero included |
| `Breadcrumb` | `items: {label, href?}[]` | gap `space-1-5`, `muted` separators, `accent` links | Masthead only. Hidden below 760px |

### Data display

| Component | Variants and props | Measurements | Notes |
| --- | --- | --- | --- |
| `EvidenceTile` | `preview`, `name`, `support` ("1 lot"), `note?`, `selectable`, `selected`, `kind: 'photo' \| 'document'`, `state: 'ready' \| 'preparing' \| 'failed'`, `onOpen`, `onSelect` | grid minimum 140px, `radius-input`, image 4:3 on `photo-stage`, caption 11.5px padded `space-1` `space-1-5`; tick and document tag on `photo-scrim` at `space-1` from the corner | Preview opens the viewer. No IDs on the tile |
| `EvidenceGroup` | `name` (inline-editable), `note`, `count`, `actions`, `dropState: 'none' \| 'over'`, `ungrouped?` | padding `space-2-5`, gap `space-2`, `radius-card`; ungrouped is a dashed, transparent box; `over` adds a 3px `accent-weak` ring and an `accent` border | Drop target for drag and move |
| `KeyValue` | `rows: {label, value, source?, state: 'plain' \| 'edited' \| 'override' \| 'inherited', onEdit?}[]` | grid 118px plus fluid, gap `space-1` `space-2-5`; value padded 3px `space-1-5`, radius 5 | Edited: 2px `accent` underline. Override: "· overrides batch" in `warn`. Inherited: "· from batch" in `muted` |
| `RecordChain` | `links: {kind, label, state: 'exists' \| 'new' \| 'update' \| 'choose' \| 'none', href}[]` | link padding 3px 7px, `radius-input`; kind 10.5px uppercase; status 12px/600; arrow 12px `muted` | New: dashed `info` border. Update: `accent`. Choose: `warn` |
| `DataTable` | `columns`, `rows`, `selection`, `onCellEdit` | header `label` type on `surface-2`, padded `space-2` `space-2-5`; cells padded `space-1-5` `space-2-5`; 13px | Lives inside `TableWrap` (horizontal scroll, `radius-card`). Selected row on `accent-weak`. ◆ marks an override; an underline marks an edit |
| `BulkBar` | `count`, `field`, `value`, `onApply`, `onClear`, `extraActions?` | `fg` background with `bg` text, padded `space-2` `space-3`, `radius-card` | The apply label states its scope ("Apply to 3") |
| `ChangeSummary` | `sections: {title, count, items}[]` | section padded `space-3` `space-4`; header count in mono 13px `muted` | Rows can carry a `Pill` and link to Review |
| `StickyFooter` | `summary`, `primary` (Button lg), `leading?` | padded `space-3` `space-3-5`, `radius-card`, `shadow`, sticky to the bottom | The only non-floating element with a shadow |

### Processing and agents

| Component | Variants and props | Measurements | Notes |
| --- | --- | --- | --- |
| `PhaseRow` | `state: 'done' \| 'running' \| 'waiting'`, `title`, `outcome`, `badges`, `expanded`, `onToggle` | grid 24px · fluid · auto · 14px; padded `space-3` `space-4`; status disc 22px with a 1.5px ring | A disclosure button (`aria-expanded`) |
| `QuestionCard` | `question`, `why`, `closeups?: {label, image}[]`, `assumption`, `answer` (slot), `secondary` | 1px `warn` border, `radius-card`; header on `warn-weak` padded `space-2-5` `space-3-5`; body padded `space-3` `space-3-5`, gap `space-3`; close-ups in two columns, 4:3 | States the assumption in use |
| `OptionRow` | radio group; `options: {id, title, detail}[]` | grid 18px plus fluid, padded 9px 11px, `radius-btn`; selected on `accent-weak` with `accent` border | Always includes an escape option |
| `StatusTimeline` | `entries: {text, time, current?}[]` | rows padded 5px 0; marker 10px with a 2px rail; current marker has a 4px `accent-weak` halo and bold text; time 11.5px tabular | Newest last |
| `NeedsYou` | `items: {thumb?, title, assumption, step?, href}[]` | grid 44px · fluid · auto; padded `space-2-5` `space-3` | Each item links to its owner |
| `SessionChat` | `messages: {who, text, mine}[]`, `onSend`, `disabled?` | message max 85% width, padded `space-2` `space-2-5`, `radius-card`; own messages right-aligned on `accent-weak` | Composer stays enabled except for a cancelled session |

### Restyled existing controls

These keep their current behaviour and tests. Only their styling moves to tokens.

| Control | Spec |
| --- | --- |
| `TextField`, `Select`, `TextArea` | `surface` background, 1px `line-strong` border, `radius-input`, padding 7px 9px; label above (12.5px/600, `space-1` gap); help below in `muted` and errors in `bad`, 12.5px; textarea minimum 84px; invalid state uses a `bad` border |
| `SearchableReferencePicker` | control padded 5px 9px; menu is a `surface` card with `shadow`, padded `space-1`; options padded `space-1-5` `space-2`; selected option on `accent-weak`; the PK in mono 12px `muted`; the "Create …" row in `info` with a dashed top rule |
| `AutoValueField` | trigger padded `space-1-5` `space-2-5`, `radius-btn`; mode pill 12px/600 (Auto `accent` on `accent-weak`; None and Manual on `surface-2`); options in a `Popover` as `OptionRow`s |
| `OptionalNotesField` | Behaviour unchanged; its textarea uses the `TextArea` styling above |
| `SharedTagsInput` | tags as chips (`surface-2`, `radius-pill`, padding 2px 9px, a remove button labelled "Remove tag X") |
| `DisabledFeature` | Task 15.9 later printed the explanation inline and removed the tooltip (see `notes.md`). Behaviour unchanged here: the explanation stays a `role="tooltip"` shown on focus or hover and dismissed with Escape, as its tests assert. Styling: 1px dashed `line-strong` border, `radius-card`, padded `space-2-5` `space-3`, `muted`; "Coming later" eyebrow 11px uppercase in `info`; the tooltip uses `fg` background with `bg` text, `radius-sm`, padded `space-1-5` `space-2`, `shadow` |
| `AutosaveStatus` | 12.5px `muted` with a 7px dot, one tone per `AutosaveState`: `saved` `ok`; `pending` and `saving` `accent`; `invalid`, `rejected`, `unconfirmed` and `disconnected` `warn` with `warn` text; `conflict` `bad` with `bad` text. The recovery box shown for `conflict` and `unconfirmed` (the existing "Retry the same save" and "Discard my edits and load saved values" buttons, labels unchanged) uses `bad-weak` with a 1px `bad` border for `conflict`, `warn-weak` with a 1px `warn` border for `unconfirmed`, `radius-input`, padded `space-2-5` `space-3`. In PR-A the saved text stays "Saved · revision N" exactly, as six existing assertions expect. PR-B (task 6.4) changes it to "Saved" together with those tests |
| `primitives.tsx` exports | All 23 exports (`Panel`, `Button`, `Notice`, `Field`, `Input`, `Eyebrow` and the rest) stay exported with the same props, because 77 files import them. Their literal colours, radii and spacing move to tokens. Later bundles replace their call sites with the new components; PR-F removes whatever is left unused |
| `Popover` (Radix) | `surface`, 1px `line` border, `radius-popover`, `shadow`, padded `space-1` |

## States and interactions

| Element | State | Behaviour |
| --- | --- | --- |
| Any interactive element | Focus-visible | 2px solid `accent` outline, 2px offset, `radius-sm`. Never removed |
| Button secondary or ghost | Hover | Background `surface-2` |
| Button primary | Hover / active | `filter: brightness(1.07)` / `brightness(0.95)` |
| Button | Disabled | 50% opacity, `not-allowed` cursor; `disabledReason` shown next to it as `small` `muted` text and linked by `aria-describedby` |
| Button | Busy | Spinner replaces the icon, the label stays, and `aria-busy="true"`; repeat clicks are ignored |
| Tab or SubTab | Current / hover / disabled | `fg` text with an `accent` underline / `fg` text / 45% opacity |
| FilterChip or SegmentedControl option | Pressed | `fg` background, `bg` text, `aria-pressed="true"` |
| SourceChip | Hover / focus | `accent` border and text |
| Item and table rows | Hover / selected | `surface-2` / `accent-weak`, plus an `accent` border on list rows |
| KeyValue value | Hover / editing | `line` border on `surface-2` / swaps to a TextField in place; Enter saves, Escape cancels |
| EvidenceTile | Selected / preparing / failed | 2px `accent` outline / Skeleton with "Preparing…" / one sentence plus Retry; no decoder detail |
| EvidenceGroup | Drag over | `accent` border and a 3px `accent-weak` ring |
| Toast | Hover or focus | The auto-dismiss timer pauses |

## Masthead (option A)

| Part | Spec |
| --- | --- |
| Bar | One row, minimum height 56px; padded `space-2-5` `space-4`; gap `space-3`; `masthead-ground` with a `masthead-dot` grid (1px dots, 16px pitch); bottom `line` border |
| Order | Wordmark · `DevBadge` (dev builds only) · Breadcrumb · spacer · ActivityIndicator · ConnectionStatus · Open InvenTree (ghost sm; with no safe navigation URL, today's `muted` text "Open InvenTree unavailable" in the same slot, not a button) · overflow menu. The overflow menu holds Agents (`#agents`), Agent settings (`#settings`), which replaces today's "Application" nav, and the theme choice |
| Wordmark | `brand` style; links to Batches |
| DevBadge | `dev-*` tokens, `radius-pill`, 11px/600, padding 2px `space-2` |
| ActivityIndicator | `accent` border on `accent-weak`, `radius-pill`, maximum width 460px; label 12px bold plus an 11px name that ellipsises after 160px; small segments; current step 11.5px `muted`; idle uses `line` on `surface`; opens a Popover listing jobs, 360px wide |
| ConnectionStatus | `surface`, 1px `line`, `radius-pill`, padding 3px `space-2-5`, 12.5px; 8px dot plus the text from today's `targetSummary` (`frontend/src/header/observations.ts`), unchanged in PR-A. Dot tone follows that same logic: `ok` only when the target is good (fresh and reachable; hostname or "InvenTree connected"); `warn` for "InvenTree status stale"; `bad` for "InvenTree unavailable" (target or API); `muted` for "InvenTree target unconfigured", "InvenTree status unknown" and "Reading connection…". Stale data is always marked stale, never shown as `ok`. The `info` tone with "Test InvenTree" needs a target-kind field the contract doesn't have yet; PR-B adds it (task 5.5) |
| Electronics current | Canvas behind the row, `aria-hidden`, `pointer-events: none`. Mask: transparent behind the left text (wordmark, DevBadge, breadcrumb) and behind the status group, plus 16px clearance, fading in over 140px and out over 120px between them; the masthead measures both ends, and the fades shrink to fit a narrow gap and close when there is none. Without a measurement the stops fall back to transparent 0–460px, opaque from 600px to (width − 420px), transparent in the last 300px. Above 760px the bar stays on one row: the breadcrumb ellipsises before the status group moves. Below 760px, the existing dim-under-text behaviour, moved from today's 700px breakpoint (`ElectronicsCurrent.tsx`) and re-tuned so its dimmed band covers the wordmark, DevBadge and the compact controls. Light finish: today's `finishes.ts`. Dark finish: outline and crease from the dark `part-*` tokens; every fill colour (`fills`, `RESISTOR_CODE_FILLS`, `PLASTIC_FILLS`, `UNLIT_SEGMENT`) is the light value mixed 72% towards dark `part-base`; `BASE_FILL` becomes `part-base` and the `0xffffff` blends in `outline-kit.ts` use `part-base`; `BACKGROUND_COLOUR` (the fog source in `scene.ts`) becomes `masthead-ground`. All of these follow the active theme. On a theme change, materials and fog are re-tinted without rebuilding geometry, and with reduced motion the still frame is rendered once more |
| 760px and below | Hide only the breadcrumb and the activity labels; the activity shows spinner, segments and badge. Open InvenTree keeps its desktop form (ghost sm button, or the `muted` unavailable text). The connection trigger keeps its name "Connection status". The full `targetSummary` text stays in its existing `role="status"` span, visually hidden below 760px (not removed). A short visible word per state is marked `aria-hidden`: the hostname (truncated with CSS, `max-width: 14ch` and `text-overflow: ellipsis`, never by cutting the string), "Stale", "Offline", "Not set up", "Unknown" or "Reading…". Status never relies on colour alone |

## Responsive behaviour

| Width | Changes |
| --- | --- |
| Above 1180px | Default layouts |
| 860–1180px | Review drops the evidence pane (later bundles); components unchanged |
| 760–860px | Two-column pages stack. Tabs scroll horizontally |
| Below 760px | Masthead compacts as above. KeyValue stacks its label above the value. Touch targets are at least 44px (buttons gain height, not padding). Toasts span the width minus the gutters |
| 390px | Reference phone; no horizontal page overflow. Tables and chains scroll inside their own containers |
| 200% zoom | Same as below 760px at desktop widths; nothing clipped |

## Content and edge cases

| Case | Rule |
| --- | --- |
| Long titles (batch, lot, Part) | One line with ellipsis in rows and tabs, and the full text in `title` and the accessible name; wrapping in headings and detail panes |
| Part numbers and SKUs | Never truncated in KeyValue or tables. Use `overflow-wrap: anywhere` |
| Counts | Exact up to 999, then "999+". Zero counts stay visible in filters |
| Wordmark plus a long breadcrumb | The breadcrumb ellipsises its last item first and never pushes status controls out of the row |
| Missing image | `photo-stage` with a `photo-fg` generic glyph and the file name in `photo-fg`. Never a broken-image icon |
| Font not loaded | System fallbacks; layout must not shift by more than one line (font-display `swap`) |
| Theme storage blocked | Follow the OS; the menu still works for the session |
| WebGL 2 missing or reduced motion | Plain masthead ground / one still frame |
| Empty lists | One plain sentence with what to do next, never just "No data" |
| Errors | The sentence comes from the content rules ("what happened, what you can do"), with the raw error only behind Details |

## Motion

All motion stops under `prefers-reduced-motion: reduce`, except the spinner, which stays visible but stops rotating.

| Element | Trigger | Animation | Duration | Easing |
| --- | --- | --- | --- | --- |
| Spinner | Running | Rotate 360° | 800ms, infinite | linear |
| Skeleton | Preparing | Background sweep | 1300ms, infinite | linear |
| Running step (PhaseRow, segments) | Running | `accent-weak` opacity pulse, 0.6 to 1 | 1600ms, infinite | ease-in-out |
| Popover and menu | Open / close | Opacity 0→1 and translateY 4px→0 / reverse | 120ms / 90ms | ease-out / ease-in |
| Toast | Enter / exit | Opacity and translateY 8px→0 / opacity only | 150ms / 120ms | ease-out |
| Hover backgrounds | Hover | Background colour | 80ms | linear |
| Theme switch | Change | None (instant), to avoid a flash of mixed colours | — | — |
| Electronics current | Always | Existing scene behaviour, unchanged | — | — |

## Accessibility

- **Focus order** follows DOM order: masthead (wordmark, breadcrumb, activity, connection, Open InvenTree, overflow), then page content. Popovers trap nothing; Escape closes them and returns focus to their trigger.
- **Tabs and SubTabs** are `<nav>` link lists with `aria-current="page"`, not ARIA tablists, because each item is a route. Counts are part of the accessible name ("Review, 8 to check, 3 to decide").
- **SegmentedControl and FilterChips** use `aria-pressed` buttons in a labelled group. Arrow keys move between options and Space or Enter selects.
- **Pills** are text, not live regions. Status changes that matter (save outcome, toast) use one polite live region per page.
- **SourceChip** is a button named "Source: Packet label, Label and slip agree. Open evidence".
- **ProgressSegments** are `aria-hidden`, with a visually hidden text list of steps and states beside them.
- **EvidenceTile:** the preview is a button named "Open {name}"; the selection tick is a checkbox named "Select {name}".
- **QuestionCard and OptionRow** are a `fieldset` with a `legend` holding the question, and native radios.
- **DisabledFeature** is focusable and described by its explanation, because disabled controls can't take focus.
- **The electronics current** is `aria-hidden`; the masthead's text alternatives come from its controls.
- **Contrast:** text meets 4.5:1 (3:1 at 24px or larger) in both themes; non-text UI meets 3:1, except `line-strong` borders, which are never the only cue.

## Acceptance checks for PR-A

- Every component above has component tests for its variants, states, keyboard behaviour and accessible name.
- The contrast script passes in both themes; the literal-colour check passes (`photo-scrim` removes the photo exceptions).
- Browser screenshots of a component gallery page and the masthead at 1440px, 860px and 390px, plus 200% zoom, in both themes, recorded in a handover, since replaced by the [notes](notes.md).
- Masthead frame sampling shows no part pixels over text boxes in either theme, and the reduced-motion still frame shows.
- Existing frontend tests stay green with no behaviour change. The only test edits allowed in PR-A are styling assertions: the hex dot colours in `HeaderStatus.test.tsx`, and masthead layout and slot assertions in `Masthead.test.tsx` and `App.test.tsx` for the moved Agent settings link.
