# Design assessment

## Context and grounding

This is a large, mostly frontend change, with one bounded backend addition: record-level edits. It touches three applications.

- **frontend.** Every screen changes:
  - Styling today is module-scope styled-components with a single light palette (`frontend/ARCHITECTURE.md`, "Module-scope styled-components…"). Shared controls live in `components/ui/primitives.tsx`.
  - Batch routing is in `components/batches/Batch.tsx` (lines 52–54 and 344–345). Segments are `capture | processing | review | approve | results`. `approve/<preparation>` and `results/<run>` pin identities.
  - The masthead and electronics current are in `components/masthead/` and `src/electronics-current/`.
- **contracts and intake-server.**
  - **Part specs.** A Part's choice is `CapturePartChoice` (`contracts/src/capture.ts`), with `create` carrying an `InventoryPartSpec`:
    - a name;
    - a category, mapped parameter templates and their category mappings;
    - a manufacturer company with an MPN, and a supplier company with a SKU;
    - tags.
  - **References.** Every reference is a `mappedReference` that must match a complete target observation (`intake-server/src/capture/part-spec.ts`, `validatePartSpec`). New companies and locations are reference drafts that the executor creates (`create_company`, `create_location` in `contracts/src/effects.ts`).
  - **Edits.** Edits go through `CaptureEdit`, carrying `expected_revision` and a CAS on the batch revision.
  - **Review state.** `changed_after_review` is not stored. `intake-server/src/operator-review/review-state.ts` computes it when a review is read, by comparing the retained review bytes with the lot's current material (`subjectReviewState`, `lotReviewState`). Any change to a Part's `choice` selection changes that material.
  - **Selections.** A Part's spec is one `capture_selection` row (`field: 'choice'`) with one `actor_id` (`intake-server/src/capture/schema.ts`), so provenance is recorded per selection, not per field.
- **Agent-backed data.** Sessions, Needs you, regions and live lots come from `simplify-intake-entry` (planned, revised in #95), which isn't implemented yet. Until it lands, the UI reads the existing retained processing jobs and questions (`frontend/src/processing/`).

**Evidence for the visual target.** The design system artifact (tokens, 41 components, content rules) and the redesign canvas, both read on 2026-11-05.

## Goals and constraints

- **Outcomes.** These follow the proposal and the spec deltas in `specs/*`:
  - the design system adopted in two themes;
  - masthead option A;
  - four tabs and a second tab row;
  - Review across Lots, Map and Records, with record edits;
  - Changes as Ready to add and Added;
  - the Processing structure and the Agents page;
  - every screen styled from the design system's tokens and components, matching the canvas (D11).
- **Constraints.**
  - No change to approval, preparation or results authority or identities.
  - No new effect kinds, and no real InvenTree profile.
  - Existing links keep working.
  - Drafts and the navigation guard behave exactly as now.
  - Text contrast is at least 4.5:1 in both themes.
  - No third-party runtime network.

## Decisions and alternatives

### D1. Tokens as CSS custom properties consumed by styled-components

- **Decision.**
  - `frontend/src/theme/tokens.json` is a copy of the design system's `tokens.json`, kept in step with it.
  - A small build-time script generates `tokens.css`, with `:root`, `[data-theme="light"]` and `[data-theme="dark"]` blocks, plus a typed `tokens.ts` map of variable names. Components use `var(--accent)` through that map, never literals.
  - `GlobalStyle` imports `tokens.css`.
- **Why.** Theme switching needs no re-render or `ThemeProvider` prop threading. The design system already uses the same variable names. styled-components stays as approved.
- **Rejected.**
  - A styled-components `ThemeProvider` object: every themed value would re-render on a switch, and it would duplicate the design system's CSS contract.
  - Tailwind or vanilla-extract: a full rewrite (see the proposal's reuse table).
- **Enforcement.** A lint check (`frontend/scripts/check-literal-colors.cjs` (`.cjs` per `CODE_GUIDELINES.md`), run in `pnpm lint:frontend`) rejects hex, rgb and hsl literals in `src/components/**` outside `theme/`. Photo-stage SVG fixtures are allowlisted.
- **Trade-off.** A one-time sweep of every component is needed.

### D2. Theme control

- **Decision.** The `data-theme` attribute is set on `<html>`:
  - from `matchMedia('(prefers-color-scheme: dark)')` by default;
  - overridden by a Light, Dark or System menu in the masthead overflow;
  - persisted in `localStorage` under `bench-intake.theme`, with every read and write in try/catch.
  
  `color-scheme` is set on each theme block. An inline script in `index.html` sets the attribute before first paint, so the page doesn't flash the wrong theme.
- **Rejected.** A server-side user preference. The app has one operator per browser and no profile store, and the proposal records this assumption.

### D3. Self-hosted fonts

- **Decision.** Pin `@fontsource-variable/public-sans` 5.3.0 (OFL-1.1, weight axis 100–900), so the design system's 650 and 750 render exactly. Pin `@fontsource/ibm-plex-mono` 5.3.0 (OFL-1.1) and import only its 400 and 500 weights. Plex Mono has no variable package and needs none. Both were checked on the npm registry on 2026-11-05.
- **Rejected.** Google Fonts at runtime, because it fails offline.

### D4. Electronics-current dark finish and option-A mask

- **Decision.** Split `electronics-current/finishes.ts` into `finishes.light` and `finishes.dark`.
  - The scene controller reads the active theme and re-tints the existing materials when `data-theme` changes. It observes the attribute rather than rebuilding geometry.
  - The dark finish uses outline `#9fb0c8`, crease `#4a5566` and fill tints mixed 72% towards the dark `part-base` (`#1d2430`). It is checked with a contrast script for outlines at least 3:1 against the ground.
  - The mask is transparent behind the measured left text and status group, with 140 px and 120 px fades that shrink to fit the gap between them; the fixed stops (transparent 0–460 px, opaque from 600 px to width − 420 px, transparent in the last 300 px) are only the fallback. The browser check found the fixed stops let parts behind the activity pill at 1440 px. At phone width it uses the existing dim-under-text behaviour.
- **Rejected.** Hiding the current in dark mode, which would lose the brand element.
- **Values.** The dark `part-base` is `#1d2430`. The values are recorded as tokens in [handoff-pr-a.md](handoff-pr-a.md) and copied back into the design system artifact.

### D5. Routes and redirects

- **Decision.** New batch routes:

  | Tab | Routes |
  | --- | --- |
  | Capture | `#<batch>/capture` |
  | Processing | `#<batch>/processing/<step>`, where step is overview, examine, research, images or inventory |
  | Review | `#<batch>/review/lots[/<lot>][?view=table]`, `#<batch>/review/map`, `#<batch>/review/records/<type>[/<record>]` |
  | Changes | `#<batch>/changes/ready[/<preparation>][?view=tree&group=category\|location]`, `#<batch>/changes/added[/<run>]` |

  - `Batch.tsx` keeps the old segments as redirects:

    | Old | New |
    | --- | --- |
    | `approve` and `approve/<p>` | `changes/ready` and `changes/ready/<p>` |
    | `results` and `results/<r>` | `changes/added` and `changes/added/<r>` |
    | `review` | `review/lots` |
    | `review/<lot>`, where `<lot>` is not `lots`, `map` or `records` | `review/lots/<lot>` |
    | `processing` | `processing/overview` |
    | `processing/reading[/<question>]`, `processing/identifying[/<question>]` | `processing/examine[/<question>]` |

  - Every redirect keeps the full query string unchanged, including `filter`, `edit` and the pinned evidence parameters `source`, `version`, `page` and `preview` (`frontend/src/operator/review-model.ts`, `evidence-location.ts`).
  - Redirects run through `useNavigationGuard`, so dirty drafts block them as before.
  - Existing legacy subject redirects are chained, never dropped.
- **Rejected.** Keeping Approve and Results as hidden routes with their old components. That gives two UIs for one authority.

### D6. Record-level edits on the existing capture authority

- **Decision.** Add one `CaptureEdit` change kind, `record`, in `contracts/src/capture.ts`. Its target is a discriminated `RecordRef`:

  | Variant | Meaning |
  | --- | --- |
  | `{ kind: 'company', role: 'manufacturer' \| 'supplier', pk }` | An observed company in one role, used by one or more Parts |
  | `{ kind: 'parameter_template', pk }` | An observed parameter template used by one or more Parts |
  | `{ kind: 'part', part_subject_id }` | A Part |
  | `{ kind: 'manufacturer_part' \| 'supplier_part', part_subject_id }` | A Part's manufacturer or supplier part |
  | `{ kind: 'parameter', part_subject_id, template_pk }` | One parameter on a Part |

  It carries an operation:

  | Operation | Applies to | Effect |
  | --- | --- | --- |
  | `map_to_existing { reference }` | company | Point every Part using the company in that role at another observed company with the same role |
  | `map_template { template, category_mappings, exclude_parts }` | parameter_template | Point every affected Part's parameter at another observed template |
  | `set_category { reference, parameter_mappings, drop_parameters }` | part | Change one Part's category |
  | `set_name { value }`, `set_tags { tags }` | part | Rename a Part, replace its tags |
  | `set_description { value \| null }` | part | Set a Part's description, or clear it with `null` |
  | `set_parameter { template, category_mapping, value }`, `remove_parameter` | parameter | Add, edit or remove a parameter |
  | `set_mpn { company, mpn }`, `set_sku { company, sku }` | manufacturer_part, supplier_part | Edit the manufacturer or supplier part |

  - The server applies the change in a single transaction at `expected_revision`.
  - It rewrites every affected Part's `InventoryPartSpec` in place, re-validated with `validatePartSpec`.
  - Each rewritten `choice` selection is written as a new version with the operator as its actor. Per-field origin in the UI comes from comparing the current spec with the retained processing proposals about the Part or one of its active lots: a field shows the step of a proposal it still matches (retained proposals have no reliable order). An AI lot's unaccepted quantity reads "Estimated by Examine". Only the selection row stores an actor.
  - It does not call into operator-review. Rewriting a Part's selection changes its material in `materialize()` (`intake-server/src/review/model.ts`), so reviewed lots that use the Part read as `changed_after_review`.
  - On a revision mismatch it returns 412 with current values, as other capture edits do.
- **Scope.** Records edits only change Parts whose `choice` is already `create` with an `InventoryPartSpec`.
  - A Part with no spec yet (`unset` or `unknown`) shows "Needs a decision".
  - Its actions use the existing `CaptureEdit { kind: 'part', choice }`: choose an existing Part, or start a new one with a name and an observed category.
  - The browser and server share `applyRecordChange` and `recordScope` (`contracts/src/records.ts`). The UI derives the affected Parts and lots, its "applies to … used by N lots" text, and any refusal naming a Part, before sending; the server applies the same function and re-validates. The edit response stays the capture snapshot. (Adjusted during PR-E; it was a response listing the affected IDs.)
- **Validation rules.** `validatePartSpec` checks every reference against a complete target observation. It also checks that each parameter's `category_mapping` matches the Part's category and its template, and that templates aren't duplicated on a Part. Each operation must therefore supply the following:
  - **Companies:** `map_to_existing` keeps the role. The new company must be observed with `manufacturer` or `supplier` mapping, matching the role being edited.
  - **Templates:** `map_template` supplies a `category_parameter` mapping for each category among the affected Parts. A Part is refused with `parameter_category_incompatible` unless it is named in `exclude_parts` if either:
    - its category has no mapping in the request;
    - it already has a parameter with the new template.
  - **Categories:** category changes are per Part only, never batch-wide. `set_category` supplies a mapping in the new category for each parameter it keeps and names each parameter it drops. Anything neither mapped nor dropped is refused.
- **Companies cannot be created for a Part.** A Part's manufacturer and supplier must be an existing observed company: `partEffects()` reads `company.pk`, and `create_company` always sends `is_supplier: true`. Creating a company for a Part is therefore "Not supported yet", along with new categories and templates. The batch's new-supplier draft is unchanged and edited in Batch settings.
- **Rejected.**
  - Editing each Part through the existing `part` change one by one from the UI. It isn't atomic across Parts, and a CAS failure mid-way would leave a mixed state.
  - A separate records store, which duplicates authority.
  - Batch-wide category edits, because their parameter mappings differ per Part.
- **Part description.** `InventoryPartSpec` gains an optional `description` (max 250 characters, InvenTree's limit).
  - It is added together to `partEffects()`, the `create_part` body in `supportedCreateBody()`, the plan decoding in `decodeEffectsPlan()` and the owned fake, so that `fieldsMatch()` confirms it.
  - When unset or cleared, the property is deleted from the spec, never written as `null` or `""`. That way `canonical(spec)`, `partSpecDigest()` and the recomputed effects stay byte-identical for every existing frozen plan.
  - Location and company creates already send descriptions, so this follows an existing pattern.
- **Proposed-new and unsupported values.** Today no store holds structured catalogue proposals that cannot be mapped: `ProcessingProposal` carries only summaries and sources. The records projection therefore has two sources:
  - **From capture state, available now:** mapped records, and the "Needs a decision" Parts above.
  - **From BI-006, once it lands:** the `catalogue` block of its `bench-intake-proposal/5` (its design D13). There, each value is `existing` or `proposed_new` with sources, and values the executor can't apply carry a reason. A `proposed_new` company with a likely existing match is shown as a decision whose actions are `map_to_existing` or "not supported yet".
  
  Neither source writes an unsupported value into a Part spec. Before BI-006 the screen shows no proposed-new values rather than inventing them.

### D7. Records and What-will-change projections

- **Decision.** Add two read routes. Neither changes any stored row.
  - `GET /api/v1/batches/:id/records`: the records projection, built from capture state, the latest operator-review projection, target observations and (after BI-006) catalogue proposals. For each record it gives:
    - type and state (new, exists, update, choose or unsupported);
    - proposed against existing values;
    - per-field source and proposing step, where one is known;
    - the lots and Parts using it;
    - decisions needed.
  - `GET /api/v1/preparations/:id/tree`, alongside the existing `/api/v1/preparations/:id/approvals`. It returns a deterministic hierarchy computed when read from that preparation's stored plan.
    - It never alters `ManualPreparationResult`, `ManualPreview`, `preview_bytes` or `response_bytes`, all of which are byte-compared or re-validated on replay (`runs.ts`, `preparations.ts`).
    - It returns one flat list of records, each once, with a parent (its category, Part or stock item) and, for a stock item, its location; the By type view and the Tree view (by category or by location) are built from that list.
    - Plans in `bench-effects-plan/1` and `/2` give Category › Part, with the Part's parameters, manufacturer part, supplier part, stock items and attachments under it; new locations and companies are listed with what they set.
    - Plans in `bench-stock-plan/1` and `bench-media-plan/1` give each existing Part with its stock items (located by location) and their attachments.
    - An unknown plan version returns `nodes: null`, and the UI offers By type only, from the preview.
  - Added reports a value InvenTree refused as invalid from the run read's `rejected` flag and links it to where it is set (its Part record or lot in Review, or a new location's or supplier's draft in Capture). The executor still records a refused create as unknown, so its round holds the batch's source and a corrected value cannot be sent until a refused create can be settled. That settling is follow-up executor work, outside this change.
  - The tree and the By type view come from the same stored plan, so they cannot disagree.
- **Rejected.**
  - Adding the tree to the preparation response, which would break replay of stored results.
  - Building the tree in the browser from flat effects, because the plan already owns dependency order.

### D8. Need-you aggregate

- **Decision.** Add `GET /api/v1/batches/:id/attention`, returning counts and items grouped by owner:
  - processing questions, and failed or interrupted attempts in their step;
  - review lots changed since review, blocking, or needing an answer;
  - record decisions: the records read's records waiting for a choice (a Part, a lot's Part or quantity, a location), one per record and routed to it, not status such as an earlier approval;
  - changes failures or uncertain results.
  
  Each item carries a route. The tab badges and the panel both use it.
- **Rejected.** Computing counts separately in each tab, which would let them disagree.

### D9. Agent-backed panels before `simplify-intake-entry`

- **Decision.** Processing, the Agents page, the Map and the session drawer depend on a `ProcessingSource` adapter interface in `frontend/src/processing/`. Today's adapter maps retained jobs to steps:
  - Reading/Identifying shows as Examine;
  - research, image and inventory jobs map to their steps.
  
  Questions map to Needs you, and the adapter has no sessions. The `simplify-intake-entry` adapter replaces it once those contracts land. Region-level Map links need observations, so the Map renders file-level links until then (spec: Review map). In the revised `simplify-intake-entry`, observations are stored in `capture_evidence_observation` and `capture_lot_evidence_observation` (merged in #95; distinct from the target-read `capture_observation`), and a lot's file-level evidence links are derived from them, so the file-level Map keeps working after it lands. Per its design D11 (merged), BI-006 supplies data and contracts, and builds any UI it needs on whichever components are on `interactive-app`. This change's `ProcessingSource` adapter takes its sessions and observations once those contracts exist.
- **Adjustment (PR-C).** BI-006's first PR (#97) already retains native agent sessions: jobs carry `session_state`, and `GET /api/v1/agent-sessions` lists sessions across batches with state, latest status line and lane use. The retained-jobs adapter therefore reports those sessions where a session profile exists, and nothing where one does not, so nothing is fabricated. The agent-session list also says whether the configured profile supports sessions, so the Agents page can say "not available for this setup" rather than show an empty list. The profile is server configuration, not an Agent settings choice, so the page names the profile rather than linking to Agent settings. Task 14 keeps observations, region-level Map links, Tell Examine, Ask and catalogue proposals.
- **Rejected.** Blocking this change on `simplify-intake-entry`.

### D10. Component library

- **Decision.**
  - Rebuild `components/ui/` as the design-system component set: Button, Pill, SourceChip, Banner, ProblemCard, Tabs and SubTabs, SegmentedControl, FilterChips, EvidenceTile and EvidenceGroup, PhaseRow, QuestionCard, KeyValue, RecordChain, DataTable with BulkBar, ChangeSummary, StickyFooter, StatusTimeline, NeedsYou, SessionChat, AutosaveStatus (restyled) and Toast.
  - Retain the existing autosave, reference picker, Auto-value field and tags input logic. Only their styling moves to tokens.
  - Implement the tree as a custom WAI-ARIA tree, since it is small and shallow.
  - Use the existing Radix popover for the need-you panel and the disclosures.
- **Rejected.** Adding a component library, because the design system is already specified.

### D11. Styling uplift on design-system tokens v3

- **Context.** D1's sweep moved every colour onto tokens and left other styling alone. The [audit](styling-audit.md) found 748 untokenised values in `frontend/src` (classified against tokens v1: 343 exact, 99 near, 306 with no token; tokens v3 covers most of the motion, z-index, breakpoint, opacity and size values among the 306) and 83 visual gaps against the canvas (27 High). Most High gaps come from screens still rendering local controls where a `components/ui/` component exists.
- **Decision.**
  - The design system's tokens move to version 3. Version 2 adds 2px, 20px and 24px spacing steps, `radius-round` and the `duration`, `easing`, `zIndex`, `breakpoint`, `opacity` and `size` families. Version 3 renames the spacing scale to a 2px unit, so `space-N` is N×2px (`space-1` 2px through `space-20` 40px) and no name is fractional; no value changes. `frontend/src/theme/tokens.json` copies it, as D1 says, and the generator emits every family as CSS custom properties and typed constants. Media queries cannot read custom properties, so `ui/media.ts` takes the breakpoints from the generated constants.
  - The spacing rename reuses names with new values (`space-4` was 16px and is now 8px), so the app's `space[...]` keys are renamed in one mapped pass when the tokens are copied, with the screenshot diff unchanged, never name by name.
  - Equality is judged only against the tokens meant for the CSS property: margin, padding, gap and inset against `space-*`; `border-radius` against `radius-*`; width, height, `min-width`, `min-height` and `max-height` against `size-*` and `icon-*`; `max-width` against `width-*`; `outline-width`, `outline-offset` and ring `box-shadow` spreads against `ring-*`; translate distances against `offset-*`; type properties against the type variables; durations, easings, `z-index`, opacity and media-query widths against their own families. A value equal to a token in that family whose role fits is swapped for it. A value that equals a token whose role does not fit (a 6px card radius equals `radius-input`) is left for the visible step, which moves it to its role's token (`radius-card`). Where its role has no token (a 32px image that equals `size-control`), it stays a literal with an annotated allow comment saying why. A value a step away from a token, or one that only shares a token's role (such as a 6px card radius against `radius-card`), moves to the token as a deliberate, visible change; when it equals another token of the wrong role, the lint flags it and it stays in the baseline until then. The generator emits each type style's size, line-height, weight and letter-spacing as its own variable as well as the whole style, so a property that matches alone swaps exactly; the whole style replaces a rule only when every property matches. A value with no token stays a literal, and grid track widths (`grid-template-*`, which the lint does not check) stay literals even where one equals a size token. Other literals that stay: 1px and 3px nudges that line up with borders, and one-off sizes, as well as the masthead scene palette and photo masks.
  - Each area's work lands as two kinds of commit. Token swaps come first and must leave every fixture screenshot pixel-identical. Visible changes follow (near values, moving onto shared components and the visual-gap fixes), with before-and-after screenshots.
  - A screenshot-diff check over every owned fixture page, in light and dark at 1440 and 390 px, proves the token-swap commits.
  - The literal-colour lint (D1) extends to raw spacing, radius, shadow, type, z-index, duration, easing, breakpoint, opacity and size values in components that equal a token. It allows values with no token, `calc()` adjustments of a token (such as a border-compensated `calc(var(--space-6) - 1px)`), the scene palette and photo masks. It starts from a recorded baseline of today's token-equal values, which each task may only shrink, and becomes strict once the baseline is empty.
  - Screens use the shared components: one `Button`, `Pill` for every status (with the design's glyph and colour per state), `FilterChips`, `SegmentedControl`, `DataTable` with `BulkBar`, `Banner` in place of `primitives.Notice`, and new `Dialog` and `Popover` surfaces for the two dialogs and three popovers.
  - Tasks follow the app's areas so each PR is reviewable alone: the foundation and component library first (task 15), then the shell, masthead, Batches and Agents (16), Capture (17), Processing (18), Review Lots and Map (19), and Records and Changes (20), which ends by making the lint strict.
- **Why.** Exact swaps change nothing a person can see, so the screenshot diff, not a reviewer, proves them. Keeping them out of the visible commits lets review focus on the changes that alter the look. The baseline lint stops new literals arriving while the work is in progress.
- **Rejected.**
  - One commit per screen mixing swaps and visual changes: a reviewer could not tell which lines change the look.
  - Folding the toast's motion into the popover's, and keeping Review's 1000px breakpoint: both would change the design rather than follow it. The tokens keep the PR-A handoff's motion and the brand book's 1180px.
  - Tokenising the masthead scene's three.js palette: it is not CSS, and only the scene uses it.
- **Trade-off.** Each area's files are touched twice, once for swaps and once for visible changes, in the same PR.

### D12. Component alignment and structural gaps

- **Context.** D11's audit compared token values and screen styling. A third pass ([Component and structural audit](styling-audit.md#component-and-structural-audit)) compared each design-system component with its app counterpart, and each canvas screen with the app's structure. It found 14 component-name mismatches or competing copies, 12 library components that no screen uses, and gaps that are not styling: the Map draws no links (R18), regions cannot be corrected or moved (P13, R21, R22), and some designed values have no data behind them (R24, X8, B8).
- **Decision.**
  - **One name per component.** Every component has the design system's name, and its file is named after its main export. A screen copy of a library component is retired in favour of the library one, or becomes a container that renders it. The design system changes only where the app's name is the established one: the Changes tab and its Ready to add and Added sub-tabs replace its Approve and Results. Library renames land in task 15; screen extractions and retirements land in the task that owns the files. `PhaseRow`, which this change built in task 2 but no canvas screen uses, is deleted from the app and its design-system card removed (task 18.5) rather than kept unused.
  - **Map links are drawn.** Review › Map draws curved connectors between observation (or file) cards and lot cards. A solid line means a region or file shows the lot, and a dotted line means a document line, or a link inherited through a shared Part or an earlier lot, supports it. The canvas shows dotted only for document lines; inherited links are support too, and the caption says so. The selected photo's links are drawn in `accent`. The drawing is decorative (`aria-hidden`), and each card keeps its links as text.
  - **Buildable structural gaps go to their area tasks** (16–20), beside the styling they share files with.
  - **Behaviour on existing commands is task 21.** The capture edit `kind: 'observation'` (create or adjust a region and its readings) and `observation_move` already exist, and no screen uses the first. Task 21 builds Examine corrections ("Correct a reading"), region editing and region-level moves on the Map, Review's inline answer, and opening a session from Agents. This closes the unmet spec behaviours listed in the notes, except Needs you oldest first.
  - **Spec-required data is task 22.** Records' existing-against-proposed values (review-records), a source kind and agreement for values so uncertainty reads in words (ui-design-system, Provenance on demand), question timestamps for Needs you oldest first (processing-workspace), and the Exclude command (review-workspace) need contract and server changes.
  - **Design detail without data is task 23.** The batch list's stage line and counts, the tree's unticked lots and field diffs, parameter-required and conflict markers, the reuse reason, run timestamps, Pause all, "Same item as…", the InvenTree version, the activity indicator's step counts, when lots formed and delivering a changed batch instruction to sessions need new fields or commands. Pause all and "Same item as…" change behaviour, so they gain their own requirements (processing-workspace, review-workspace); the rest need none. They come last, so the spec-required work is not held up by them.
  - **No dead code is left behind.** A task that replaces code deletes what it replaced in the same task: screen copies of library components, legacy primitives, superseded styles, props, routes, fallbacks and the tests that only cover them. Nothing is kept as a compatibility path, because the app has essentially one user; data stays readable through additive contracts and migrations instead (BI-011's rule). Task 15 adds an unused-code check over the frontend, contracts and intake server, with a recorded baseline of today's unused files and exports that a change may only shrink, so no task can add to it. The cleanup stays inside the change's scope: a task removes only dead code it creates or code in what it touches that the change makes obsolete, never unrelated dead code elsewhere, which stays in the baseline for BI-011. Code kept for a planned task, in this change or another planned item (such as BI-004's automatic logos or BI-005's purchase orders), is not dead code: it stays, marked with an allow comment naming that task or item, and the check accepts it.
  - Three canvas details are recorded as deliberate rather than planned (notes): editable order and purchase-date settings with automatic tags (K14), the by-step "Who proposed what" summary (R27), and unit prices (R19, R20).
- **Why.** Matching names let a reader move between the design system, the canvas and the code without a lookup table. Separating behaviour and data from styling keeps the area PRs about the look, and puts the risky changes (new contracts, server writes) in PRs reviewed for that.
- **Rejected.**
  - Renaming the design system to the app's names: most app names are local or accidental (`NeedYouPanel`, a second `SessionChat`), while the design-system names are already used by the canvas, its READMEs and this plan.
  - Folding tasks 21–23 into the area tasks: the area PRs would mix restyling with new server writes and contracts.
  - Dropping the data-blocked design detail: every gap the audit found is to be planned, not left implicit.
- **Trade-off.** BI-008 grows from eleven PRs to fourteen (PR-L, PR-M and PR-N).

## State, authority and failure behavior

```text
browser ──CaptureEdit{record}──▶ capture repository (CAS on batch revision)
   │                                   ├─ rewrite Part specs (validatePartSpec)
   │                                   ├─ provenance: human, per field
   │                                   └─ lot material changes → review reads changed_after_review
   ├──GET records / attention / preparation{tree}──▶ read models (no writes)
   └──existing prepare / approve / results commands (unchanged)
```

- **Authority.** Record edits reuse the capture route's CSRF, actor and target-context checks. A mapping must reference a complete observation in the batch's target context, as `validatePartSpec` already requires. Nothing here grants effect authority: approval still freezes a prepared plan.
- **Identity.** Preparation and run IDs survive redirects unchanged. A record edit changes the batch revision, so an open preparation goes stale. It stays disabled until a fresh preparation is made, which is the existing behaviour.
- **Failure.**
  - A 412 keeps the draft and shows current values.
  - An uncertain acknowledgement follows the existing explicit retry or reload.
  - A failed records or attention read keeps the last snapshot, labelled as stale, and disables edits.
- **Compatibility.**
  - Old routes redirect.
  - Old `CaptureEdit` kinds are unchanged.
  - The theme defaults to the OS setting, so the light theme looks as before apart from the token values.

## Verification strategy

| Area | How it is checked |
| --- | --- |
| Tokens | A contract test that the copied `tokens.json` matches the generated CSS. A contrast script fails the build on any text token below its threshold in either theme. The literal-colour lint runs in CI. |
| Theme | Component tests for switching and persistence, including storage throwing. A browser check that no wrong-theme flash occurs on reload in dark mode. |
| Routes | Unit tests for every legacy route redirect, including a dirty-draft block and pinned preparation and run IDs. |
| Record edits | Server integration tests on the owned database for every operation: CAS 412, fan-out to multiple Parts in one transaction, `lotReviewState` returning `changed_after_review` for reviewed lots of an edited Part, `set_category` refusal for unmapped parameters, and re-validation failures, role-mismatched company maps, `map_template` refusal for Parts without a category mapping, and clearing a description. Part description: an existing frozen-plan fixture without a description decodes with unchanged digests, and a description reaches the owned fake and is confirmed. The tree route reads a stored preparation of each plan version, and leaves replayed preparation results byte-identical. |
| Contracts | Schema and OpenAPI tests for `record`, records, attention and the preparation tree. |
| Tree | Keyboard tests following the WAI-ARIA tree pattern, and a property test that the tree and By type views have equal node counts per state. |
| Screens | Component tests for each new screen with fixture data. Headless-browser screenshots of each canvas screen in both themes at 1440 px, 860 px and 390 px, plus 200% zoom, against the owned fake. Results go in each PR's description, and departures from the plan in the [notes](notes.md). |
| Masthead | A browser check that, in both themes, no part pixel overlaps the text boxes (sampled frames) and the reduced-motion still frame shows. |
| Styling uplift | Generator contract tests for every token family. The extended literal-value lint, against its shrinking baseline and finally strict. The screenshot diff, which must show no change for a token-swap commit. Before-and-after screenshots of every changed screen in both themes at 1440 and 390 px, plus 860 px and 200% zoom where layouts change. |
| Excluded | Live provider sessions and real InvenTree. These are synthetic or fixture only, and the PR descriptions and [notes](notes.md) say so. |

## Migration, rollout and recovery

- **No data migration.** Record edits write new `choice` selection versions, and `changed_after_review` is already computed when a review is read.
- **Rollout.** Ship in bundles on `interactive-app`, each releasable:
  1. tokens, theme and primitives;
  2. masthead and navigation with redirects;
  3. Capture and Batches;
  4. Processing;
  5. Review Lots and Map;
  6. records backend and Records UI;
  7. Changes;
  8. the Agents page.
  
  Until a screen is redesigned, it uses the new primitives through the token map.
- **Rollback.** Revert the bundle. Old routes are still handled by the redirects, and no retained effect depends on the UI.

## Risks and open decisions

- **Scope.** Mitigated by the bundle order and by keeping agent-backed data behind the `ProcessingSource` adapter.
- **Record fan-out.** Editing a shared reference key could change more Parts than expected. Every control states its scope from the server response, and the edit is one revision, so it can be inspected and corrected.
- **`simplify-intake-entry` implementation.** Its revision merged in #95, but none of it is built yet. Region-level Map links, live sessions and proposed-new catalogue values arrive with its implementation.
- **Styling scope.** Some visual gaps are layout rework rather than restyling: the batch header band, the two-column Processing overview, the docked session drawer, Review's lot rows and the two-column Ready to add. They are in scope (tasks 16, 18, 19 and 20) and are the largest items in their PRs.
- **Visible change.** Near values and the 700px to 760px and 1000px to 1180px breakpoint moves change where layouts stack. Each is listed in its PR and shown in before-and-after screenshots.
- **New contracts (tasks 22 and 23).** They add fields to retained reads and, for the source kind and agreement, to what sessions report. Each change is additive, so older snapshots stay readable, and each has its own contract tests.
- **Open decisions.** None.
