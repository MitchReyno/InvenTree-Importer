# Change proposal

## Problem and intended outcome

The working app feels rough next to the original prototype. Four things stand out:

- **Look and language.**
  - The app is visually loose and inconsistent. Large outlined buttons are everywhere, and there's no clear primary action.
  - Internal identifiers fill the screen: evidence and original digests, revisions, actor UUIDs, "owned fake".
  - There's no dark mode.
- **Capture is very long.** Capture is about 8,400 px tall for 11 files, against about 2,100 px for 9 files in the prototype, because every evidence file is a full-width card of controls.
- **Pages repeat and features hide.**
  - Review, Approve and Results each show the same lots at a different moment.
  - Sub-views sit in small segmented controls that read as filters, so people miss important screens.
- **Records can't be checked as records.** The records an approval creates or reuses (categories, companies, manufacturer and supplier parts, parameter templates and values) can only be seen through a lot. There is no way to:
  - check them one record at a time;
  - edit a record once for every lot that shares it;
  - steer the agent that proposed them.

**Outcome.** The app follows the Bench Intake Design System and the redesign canvas, while keeping every newer requirement:

- **Design system.** Tokens, light and dark themes, components and content rules.
- **Masthead.** Option A: the electronics current stays inside one masthead bar.
- **A four-tab batch:**

  | Tab | Role | Sub-views |
  | --- | --- | --- |
  | Capture | gives | — |
  | Processing | works | Overview · Examine · Research · Images · Inventory |
  | Review | checks | Lots · Map · Records |
  | Changes | commits | Ready to add · Added |

  - A second tab row shows counts and attention badges.
  - A "need you" panel opens from the batch header.
- **Records review.** Every InvenTree record the batch touches can be browsed and edited.
- **Agents page.** An app-level list of agent sessions.

Sources:

- the design system ([Bench Intake Design System](https://claude.ai/artifact/TbKY47cDmdA3Nuh2jufTmo));
- the screens and reasoning ([Bench Intake Redesign canvas](https://claude.ai/artifact/TFjujLEMdBcqdRUBbvJKRf), Screens and Journey & ownership pages);
- the original prototype (`docs/bench-intake/reference/`).

## Change identity and linked items

- **Change:** `redesign-batch-workspace`.
- **Branches:** `feat/redesign-batch-workspace-<bundle>`, plus this planning branch `docs/redesign-batch-workspace-plan`.
- **Subjects:** `type(redesign-batch-workspace): …`.
- **Linked items:**
  - [BI-008](../../../docs/PLANNED_FUNCTIONALITY.md#bi-008--batch-workspace-redesign) (this change).
  - It depends on [BI-006 agent-led intake](../../../docs/PLANNED_FUNCTIONALITY.md#bi-006--agent-led-intake) (`simplify-intake-entry`) for the agent-backed parts.

## Current behavior and evidence

- **Styling.** Module-scope styled-components set a single light palette. Shared controls live in `frontend/src/components/ui/primitives.tsx` (158 lines). There are no theme tokens and no dark theme (`frontend/ARCHITECTURE.md`, "Module-scope styled-components…").
- **Stages and routes.** The batch has five stages: Capture, Processing, Review, Approve and Results. Routes are `#<batch>/<segment>`, with `approve/<preparation>` and `results/<run>` parsed in `frontend/src/components/batches/Batch.tsx`.
  - Review (`components/review/ManualWorkspace.tsx`) selects lots and edits subjects.
  - Approve shows the frozen plan (`PreparedRecordEffects`).
  - Results shows journal certainty and recovery (`components/results/`).
- **Masthead.** `components/masthead/Masthead.tsx` has two rows: brand and status, then a navigation slot. `ElectronicsCurrent.tsx` masks the scene at 140–330 px and 230–120 px. The finishes in `electronics-current/finishes.ts` are light-only.
- **Records model.** The backend already models these record kinds:
  - **Part specs:** `InventoryPartSpec` with category, mapped parameter templates and category mappings, manufacturer with MPN, supplier with SKU, and tags.
  - **Mapped references:** category, parameter_template, category_parameter and company.
  - **Effect kinds:** `create_stock`, `create_part`, `parameter`, `manufacturer`, `supplier`, `part_attachment`, `create_location` and `create_company` (`contracts/src/effects.ts`).
  - **Not supported:** creating categories or parameter templates, and updating existing Part fields.
- **Comparison with the prototype.** Screenshots taken on 2026-11-05 of the running dev app against the prototype show:
  - processing results rendered as paragraphs of agent text instead of phase outcomes;
  - an empty Review middle and right pane until "Inspect" is pressed;
  - approval-boundary warnings repeated on each page.
- **Planned agent work.** `simplify-intake-entry` plans the agent sessions, the outbox and inbox, AI-proposed lots and the Examine stage, but none of it is implemented yet. The canvas, and its revision merged in #95, refined the model:
  - a single **Examine lead session** finds observations (regions of photos), groups them into lots and identifies them in one loop;
  - Sort is no longer a separate step.

  That refinement is in `simplify-intake-entry` (#95). This change only consumes its contracts.

## Scope and non-goals

**In scope**

1. **Design system adoption.**
   - Copy the tokens from the design system into the repository and use them for both themes.
   - Theme control: follow the system setting, with an explicit Light or Dark override that is remembered per browser.
   - Self-host the Public Sans and IBM Plex Mono fonts.
   - Rebuild the shared primitives from the design system components, and restyle every screen.
   - Content rules:
     - IDs, revisions and digests appear only on demand;
     - each limit is stated once, in one place;
     - uncertainty is described in words.
2. **Masthead option A.**
   - A single bar with the breadcrumb.
   - The mask is widened so parts never cross the text.
   - A dark finish for the electronics current.
3. **Batch navigation.**
   - Four tabs and the second tab row, with counts and attention badges.
   - The "need you" panel.
   - Redirects from the legacy `approve` and `results` routes, with no broken links.
4. **Capture.**
   - Compact evidence tiles.
   - Evidence controls (crop, download, byte identity) move into the viewer.
   - A read-only Proposed lots glance.
5. **Processing.**
   - Overview: progress by step, sessions, Needs you, batch instructions and activity.
   - Step pages built from one pattern, with a session drawer.
   - Profiles without native sessions render their retained jobs in the same structure.
6. **Review.**
   - Lots, as a Workspace or a Table.
   - Map: lots and their evidence. It works at region level once observations exist and at whole-file level until then.
   - Records:
     - browse by type: categories, companies, Parts, manufacturer parts, supplier parts, parameters, locations, stock items, images and attachments, tags;
     - backend support for record-level edits within the supported effect kinds, each with its stated scope;
     - a steering message routed to the proposing step.
7. **Changes.**
   - Ready to add: lot selection; "What will change" By type or as a Tree, grouped by category or location; one approve action.
   - Added: run outcomes, InvenTree links, recovery and the activity log.
   - It reuses the existing preparation, frozen plan, approval and results authority.
8. **App-level pages.** A redesigned Batches home and the Agents page.

**Non-goals**

- **The agent backend:** sessions, tools, outbox and inbox, Examine, and the observation and region data model. These belong to `simplify-intake-entry` and its revision.
- **New InvenTree effect kinds:** creating categories or parameter templates, supplier price breaks, and updating existing Part fields. They are shown as "Not supported yet" with the nearest supported choice. One small extension is in scope: an optional Part description on created Parts (design D6), following the existing location and company description pattern.
- **Disabled features:** purchase orders and automatic logos stay disabled.
- **Masthead options B, C and D.**
- **Any real InvenTree mutation profile.**

**Compatibility**

- All existing commands, revisions, frozen-plan identities and results certainty stay unchanged.
- Old links redirect.
- Approval still freezes exactly what was shown.
- Accessibility floors stay in place: text contrast at least 4.5:1 in both themes, visible focus, and no reliance on colour alone.

## Reuse and dependency assessment

| Option and relevant version | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence and date checked | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| **Keep styled-components 6.6.0 and drive it with CSS custom properties generated from the design system `tokens.json`** | Already in place, used by every component and approved. Variables switch themes without re-rendering. The design system ships the same variable names. | Some components must be rewritten anyway, and module-scope literals must be removed from about 90 files. | `frontend/package.json`, `frontend/ARCHITECTURE.md`; design system `tokens.json` and `tokens.css` (2026-11-05) | A lint rule or check is needed to stop new literal colours |
| Tailwind CSS v4 or vanilla-extract | Strong token tooling | A full styling rewrite and a second styling system during migration, with no gain in capability | — | Rejected |
| **Self-host fonts via `@fontsource-variable/public-sans` 5.3.0 and `@fontsource/ibm-plex-mono` 5.3.0** (OFL-1.1) | No third-party network at runtime, which suits the loopback, offline-friendly dev app. The variable build renders the design system's 650 and 750 weights exactly. Pinned versions. | Adds roughly 200–400 KB of woff2 font files, loaded lazily | npm registry, 2026-11-05 | None |
| Google Fonts CDN | Zero bundling | A runtime network call, and fonts are unavailable offline | — | Rejected for the app; the design system artifact keeps it |
| **Custom ARIA tree** (WAI-ARIA tree pattern) for "What will change" | The tree is shallow (at most 5 levels), small (under 200 nodes) and read-mostly | Keyboard navigation has to be written by hand | WAI-ARIA APG tree pattern | Tests are needed for keyboard navigation |
| react-arborist 4.0.1 (MIT) | Virtualisation and drag-and-drop | Overkill, adds 40+ KB, and its drag-and-drop model isn't needed | npm registry, 2026-11-05 | Rejected |
| **Existing `@radix-ui/react-popover` 1.3.1** for the "need you" panel, activity and connection disclosures | Already installed and accessible | — | `frontend/package.json` | — |
| **Record edits through the existing capture subject commands and mapped-reference model** (`InventoryPartSpec`, `mappedReference`), adding batch-scoped record commands for shared references | Reuses revision, CAS and provenance authority. Effects stay inside supported kinds. | Needs a new read model that groups Parts, companies, categories and templates across lots | `contracts/src/effects.ts`, `intake-server/src/capture/*`, `review/effects-plan.ts` | Design decides the command shapes and how a record-wide edit fans out to lots |
| A separate "records" service with its own storage | A clean API | Duplicates capture authority and risks divergent truth | — | Rejected |

**Recommendation.**

- Keep styled-components, driven by token CSS variables.
- Self-host the fonts.
- Use Radix for popovers, a custom ARIA tree, and add no other UI dependency.
- Build record editing on the existing capture and effect model, with a batch-level records projection and record-scoped commands.

## Capabilities

### New capabilities

- **`ui-design-system`:** tokens and themes, theme control, typography, the component vocabulary, content rules (provenance on demand, limits stated once), and the masthead and electronics current in both themes.
- **`batch-navigation`:** four tabs, the second tab row with counts and attention badges, the "need you" panel, and legacy route redirects.
- **`processing-workspace`:** Overview, step pages, the session drawer, and how retained non-session jobs are presented.
- **`review-workspace`:** Lots (Workspace and Table), the evidence pane, problem routing, and the Map.
- **`review-records`:**
  - browsing records by type, with existing against proposed values and sources;
  - record-level edits with stated scope;
  - steering routed to the proposing step;
  - unsupported effect kinds shown honestly.
- **`changes-commit`:** Ready to add (selection, By type and Tree, approve) and Added (outcomes, recovery, activity), on the existing preparation and results authority.
- **`agents-overview`:** the app-level Agents page.

### Modified capabilities

- **`capture-batch-settings`:**
  - "Evidence-based responsive placement" changes: Capture may show a read-only Proposed lots glance (not an editing pane);
  - the screen uses design-system tokens instead of the fixed light palette.
- **`header-workflow-status`:** "Accessible workflow disclosure and layout" changes to a single masthead bar with the breadcrumb, activity and connection, plus the masthead mask rules.
  - `simplify-intake-entry` changes a different requirement of this spec, "Active-agent occupancy". The two deltas do not overlap.

## Impact and dependencies

- **Applications:**
  - `frontend`: every screen, the primitives, the masthead and electronics-current finishes, navigation, the theme control and fonts.
  - `contracts`: the records projection, record command schemas, the "What will change" tree projection, and the "need you" aggregate.
  - `intake-server`: record commands under the capture and review authority, read models, and routes.
  - `docs`: the frontend architecture and a design-system note.
- **State:** no new tables are expected for records. Shared references and Part specs already live in capture state. Design confirms this.
- **Dependencies:**
  - Agent-backed panels (sessions, Needs you questions, live lots, regions) depend on `simplify-intake-entry`. They render the current retained jobs and questions until it lands.
  - `simplify-intake-entry`'s revision for the Examine lead session and the observations → lots model merged in #95. Its implementation is out of this change.
- **Evidence limits:** screens are qualified in a headless browser against the owned fake and fixture profiles. No live provider or real InvenTree.

## Open decisions and assumptions

- **Decided by the operator:**
  - the UI lives here and the agent backend stays in `simplify-intake-entry`;
  - Records includes backend editing;
  - masthead option A.
- **Assumption:** new effect kinds (new category, new parameter template, supplier price breaks, updates to existing Part fields) are out of scope and shown as "Not supported yet". They become a follow-up BI item. An optional description on created Parts is in scope because the executor already sends descriptions for locations and companies.
- **Dependency:** `simplify-intake-entry` was revised for the Examine lead session and the observations → lots model, and merged in #95. Its `processing-lot-forming` spec stores observations (evidence version plus a region: a normalised rectangle or a document line range) in `capture_evidence_observation`, and links them to lots through `capture_lot_evidence_observation`. Region-level Map links read those tables. Its design D11 has BI-006 supply only data and contracts. This change's `ProcessingSource` adapter takes its sessions and observations once those exist.
- **Assumption:** the theme choice is stored per browser as a convenience, not server state.
- **Assumption:** the dark finish for electronics-current parts is designed in this change: the outline and fills are re-tinted and checked against `masthead-ground` dark.
- **Open:** none blocking.
