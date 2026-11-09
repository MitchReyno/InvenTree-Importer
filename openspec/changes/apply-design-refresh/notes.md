# Implementation notes

Task 1 (PR-A) adds the design-system foundation: the `ai` tokens, the icon set, the new `components/ui` components, the short `SourceChip` and the generalised `DisabledFeature`. Tasks 2–13 remain.

## Changes to the plan

- **2026-11-10T00:53+11:00, task 1 (PR-A):** Task 1 named the icons `AiSparkle`, `Help`, `Info`, `Settings`, `Menu` and `Back`. They are exported as `AiSparkleIcon`, `HelpIcon`, `InfoIcon`, `SettingsIcon`, `MenuIcon` and `BackIcon`, so they don't collide with components such as the Settings page (Task 5) and read as icons at call sites.
- **2026-11-10T00:53+11:00, task 1 (PR-A):** `Pill` loses the `ai-proposed` status and its ✦ glyph, but screens that pass "AI-proposed" as text on a `tone="acc"` pill (`ProposedLotsGlance`, `LotObservations`, `ReviewQueue`) and `ExamineView`'s explicit `glyph="✦"` are untouched: they are screen changes for Task 7 (D22–D23), which places `AiMark` there instead.
- **2026-11-10T00:53+11:00, task 1 (PR-A):** D29 needs no `KeyValue` code of its own: its value chips follow from the short `SourceChip`, and an edited value's chip now reads "✎ You". For `Breadcrumb`, an item with an address is now always a link, so the batch screens' "Batches" alone (D14) links back. Choosing that trail is `AppMasthead`'s job in Task 2, and the masthead already hides the trail below `bp-compact`, so the component adds no phone rule.

## Unexpected challenges

- **2026-11-10T00:53+11:00, task 1:** The design system gives `ai` on `ai-weak` as 5.2:1 in light. The contrast script measures 4.8:1 (7.2:1 dark). Both pass; the app's `tokens.json` usage text states the measured ratios, and the design system's figure should be corrected there.
- **2026-11-10T01:03+11:00, task 1:** `pnpm screenshots:frontend` refuses to capture in this worktree because the web fonts don't load: `node_modules` is a symlink to the main checkout, outside the Vite root. Gallery screenshots for the PR need a run from a checkout with its own `node_modules`.

## Decisions made during implementation

- **2026-11-10T00:53+11:00, task 1:** `DisabledFeature` takes the control as a render prop (`{(disabled) => <input {...disabled} />}`) rather than cloning its child. The control often sits inside a `label`, and a stepper has two buttons, so the caller places `aria-disabled` and `aria-describedby` on the real controls. The wrapper stops clicks, presses, key presses (except Tab, Escape, caret and selection keys), `beforeinput`, change, paste, cut and drop in the capture phase, so the control's own handlers never run and nothing is sent. A press still focuses the control, so its explanation is announced. Cloning the child was rejected because it would put the attributes on the label.
- **2026-11-10T00:53+11:00, task 1:** `AiMark` with a label renders its own `inline-flex` wrapper centred on that label, as change log D25 suggests for the app. A global `:has(> .bi-ai)` rule like the design system's was rejected because `GlobalStyle` keeps only reset and root concerns.
- **2026-11-10T00:53+11:00, task 1:** `SourceChip` keeps its old props (`source`, `certainty`, `tone`, `onOpen`) and adds optional `field`, `value`, `why`, `evidence` and `onEdit` for its popover. It is now always a button, including the operator's own "You" chip, and `onOpen` moves from the chip to the popover's Open evidence action. The popover shows no `V` key hint: the shortcut belongs to Review and doesn't work from the popover. Task 7 fills in the details at each call site.
- **2026-11-10T00:53+11:00, task 1:** `DescriptionField` marks an over-limit count as "263 / 250 · over the limit" in `bad`, not the design system's "· shorten to approve". Design D7 says an existing over-limit description doesn't block approval and a proposed one is never written, so "shorten to approve" would be untrue. It counts characters by code point, as InvenTree does.
- **2026-11-10T00:53+11:00, task 1:** `CompareTable` also marks a differing field with "≠" and the hidden word "differs" in its field column, so the `warn-weak` tint isn't the only sign. `TreeView` follows `PreparationTreeView`'s keyboard model (one tab stop, arrows move and fold, Home and End jump) so Task 8 can move that view onto it.

## Open items

- Task 7 migrates the `SourceChip` call sites to pass field, value, reason and evidence; until then their popovers show only the certainty and Open evidence.
