# Change proposal

## Problem and intended outcome

After `redesign-batch-workspace` shipped, the design was refined on the [Bench Intake Redesign canvas](https://claude.ai/artifact/TFjujLEMdBcqdRUBbvJKRf) (v58) and the [Bench Intake Design System](https://claude.ai/artifact/TbKY47cDmdA3Nuh2jufTmo) (v20). The app still shows the older design. Five problems stand out:

- **Crowded header.** The batch name appears three times. The "needs you" count appears up to five times. Tab badges carry phrases ("8 to check", "3 to decide"). The masthead holds a separate Open InvenTree button and a "⋯" menu.
- **Noise.**
  - Every proposed value carries a long source chip ("Packet label · Label and slip agree").
  - Headings carry grey helper sentences.
  - Hand-off cards and the keyboard hint line repeat what the tabs already say.
- **Hidden InvenTree descriptions.** InvenTree records have description fields that the app mostly hides.
- **No settings home.** Settings has no page of its own: agent settings sit at `#settings`, and the theme lives in the "⋯" menu.
- **Capture friction.**
  - Picking a file waits for an explicit Retain or Discard click, one file at a time.
  - Evidence can't be deleted, so a wrong photo stays in the batch and keeps feeding agents.

**Outcome.** The app matches the refined design and design system:

- **Header:** a calmer header and batch header.
- **Content:** short source chips with details in a popover, and descriptions where InvenTree has them.
- **Settings:** a Settings page.
- **Agent mark:** a purple AI sparkle marks where a person meets an agent.
- **Phone header:** slim, and compact on scroll.
- **Capture:** uploads start as soon as files are picked, and evidence can be deleted with undo.

Each design change is listed with its ID (D1–D31) in the design change log kept beside the canvas. This change implements all of them except the proposals still awaiting a decision.

## Change identity and linked items

- **Change:** `apply-design-refresh`.
- **Branches:** `feat/apply-design-refresh-<bundle>`, plus this planning branch `docs/apply-design-refresh-plan`.
- **Subjects:** `type(apply-design-refresh): …`.
- **Linked items:**
  - [BI-014](../../../docs/PLANNED_FUNCTIONALITY.md#bi-014--design-refresh) (this change).
  - [BI-015](../../../docs/PLANNED_FUNCTIONALITY.md#bi-015--design-refresh-backend-follow-ups) holds the backend work this change deliberately defers behind disabled controls.
  - Builds on [BI-008](../../../docs/PLANNED_FUNCTIONALITY.md#bi-008--batch-workspace-redesign) (`redesign-batch-workspace`, Done).

## Current behavior and evidence

- **Masthead.** `frontend/src/components/masthead/HeaderStatus.tsx` places Open InvenTree to the right of the connection control, as required by `header-connection-status` › Safe target details and navigation.
  - `MastheadMenu.tsx` holds the theme radio group, Agents and Agent settings (`#settings`).
  - Inside a batch, the breadcrumb shows "Batches / batch title".
- **Batch header.** `components/batches/BatchHeader.tsx` puts the tabs on the right and a summary line under the title. Its tab and sub-tab badges follow `batch-navigation` › Second tab row ("its own count and attention badge").
- **Source chips.** `components/ui/SourceChip.tsx` renders `{source} · {certainty}` inline. Clicking it opens the evidence.
- **Descriptions.**
  - Only new Parts carry a description: `contracts/src/records-projection.ts:575`, with the `set_description` op at `contracts/src/records.ts:46`.
  - `intake-server/src/records/existing.ts` already reads descriptions of existing parts, companies, categories, parameter templates and locations from InvenTree. It doesn't read manufacturer or supplier part descriptions.
  - New manufacturer parts, supplier parts, companies, locations, categories and templates have no description field.
- **Agent settings.** `contracts/src/agent-selection.ts` and `contracts/src/agents.ts` hold provider (Claude or Codex), authentication (subscription or API key), model and `session_concurrency` (1–8, default 3), and nothing more. The `#settings` route renders `components/agents/AgentSettings.tsx`.
- **Uploads.**
  - `components/media/MediaUpload.tsx` keeps the picked file in browser state and needs a Retain click. Retain calls `POST /api/v1/batches/:id/media/originals`; Discard only clears local state.
  - The server has no staged state: an upload *is* retention, and the receipt is always `retained` (`intake-server/src/media/repository.ts`).
  - The pickers take one file (`files?.[0]`, no `multiple`).
  - Each upload advances the batch's media revision, so several uploads must run one after another.
  - Tests that click Retain or Discard: `MediaUpload.test.tsx`, `CaptureWorkspace.media.test.tsx`, `MediaWorkspace.query.test.tsx`, `MediaWorkspace.groups.test.tsx`.
- **Evidence deletion.**
  - Nothing deletes evidence today.
  - `0005_media.sql` makes every `media_*` table reject UPDATE and DELETE, so runtime history is append-only.
  - `capture_note` and `media_evidence_note` are append-only too.
  - Active observations can't be deleted (`0019_evidence_observations.sql`, `evidence_observation_delete_refused`).
  - Evidence is referenced by observations, lot membership, derivations, decode commands, attachment selections, approval pins and frozen processing inputs (`intake-server/src/processing/provenance.ts`).
- **Settings and agent features the design adds but the app lacks:**
  - a model per step;
  - instructions copied into every new batch;
  - web research switches;
  - app-level batch defaults;
  - rules for how agents write descriptions;
  - descriptions on new non-Part records.

## Scope and non-goals

**In scope.** These are the design change log entries, grouped by area:

- **Design-system foundation** (D22–D27, D29):
  - `ai` and `ai-weak` tokens, plus the `ai-sparkle`, `help`, `info`, `settings`, `menu` and `back` icons.
  - New components: `AiMark`, `IconButton`, `HelpButton`, `SettingsNav`, `SettingRow`, `Switch`, `NumberStepper`, `DescriptionField`, `TreeView`, `CompareTable`.
  - The short `SourceChip` with a details popover.
  - Pill and count rules, and the KeyValue and Breadcrumb updates.
- **Header and navigation** (D2, D4, D11, D13–D16, D28):
  - Settings gear.
  - Server menu holding Open InvenTree.
  - Breadcrumb that doesn't repeat the batch title.
  - Activity chip without a "needs you" count.
  - Tabs left under the title, with one count each and a short summary.
  - The "⋯" menu retired.
  - Phone masthead slimmed to brand, Dev badge, agents status button and menu, and compacted on scroll.
- **Settings** (D5, D6, D9, D12):
  - A Settings page with section nav and a back link.
  - Agents section with the stored settings.
  - InvenTree section with connection details.
  - Appearance section for theme.
  - Batch defaults and description rules shown disabled.
  - The Agents page links to Settings.
- **Screens** (D1, D3, D7, D8, D17–D21, D22, D26, D27):
  - Descriptions where available.
  - Tree view keeps "Lots to include".
  - Processing › Inventory step page.
  - Review › Records · Locations.
  - The approved removals.
  - AI sparkle placements, help buttons and short source chips across screens.
- **Capture:**
  - Direct multi-file upload (D30).
  - Evidence deletion with undo and refusal rules (D31). This includes its backend, because it is a requested capability, not a proposed extra.

**Built but disabled, backend deferred to BI-015.** The design adds these controls, but each needs a new contract, storage or agent behaviour:

- The Agents "More control" card: model per step, instructions for every new batch, web research switches.
- App-level batch defaults and the description rules on Settings › InvenTree.
- Description fields for new companies, manufacturer parts, supplier parts, locations, categories and parameter templates.
- Showing existing manufacturer and supplier part descriptions, which the server doesn't read yet.

Each is shown with a `DisabledFeature`-style explanation and no fabricated behaviour.

**Non-goals:**

- Undecided proposals: P2 (Batches · Agents masthead links), P5 (phone bottom tab bar), R10 ("Coming later" in one place).
- The declined P3 and R12.
- Duplicate-upload detection by digest.
- Hard deletion of bytes or history.
- Deleting evidence that an approved run used.
- Any change to InvenTree writes.

**Compatibility.**

- Existing batches keep their evidence and history.
- Removal is additive and append-only.
- `#settings` keeps working and becomes Settings › Agents.
- Old links keep the redirects from `redesign-batch-workspace`.

**Authority.** Nothing here grants provider, inventory, deployment or external messaging authority. Delete changes only the batch's own capture state.

## Reuse and dependency assessment

The frontend already has React, styled-components and the BI-008 `components/ui` library. Popovers, dialogs, toasts and focus handling exist (`Popover.tsx`, `Dialog.tsx`, `Toast.tsx`, `useRovingFocus.ts`). The intake server already has append-only command patterns: group selection, lot exclusion (0024) and re-examine (0022).

| Option | Goal fit and strengths | Limitations and cost | Evidence (checked 2026-11-09) | Unknowns |
| --- | --- | --- | --- | --- |
| Extend the existing `components/ui` library and intake-server command pattern | Matches the design system names already used. No new dependency. Removal follows the existing append-only selection tables. | Custom code for the tree, popover-based chip and upload queue | `frontend/src/components/ui/*`, `0005_media.sql`, `0022`, `0024` | None material |
| Add a headless UI library (e.g. Radix Popover, Menu) | Accessible menus and popovers off the shelf | A second popover and focus system beside `Popover.tsx`, plus restyling to tokens; no gain over the existing tested primitives | `frontend/package.json` has no headless UI library; `Popover.test.tsx` covers focus return | — |
| Add an upload library (e.g. Uppy) | Parallel or resumable uploads | Uploads must be serial because of the media revision, and they're idempotent per request key. A library would fight that contract. | `media/routes.ts:107-136`, `MediaUpload.tsx` | — |

**Recommended direction.** Extend the existing stack. The remaining custom work is small and already patterned: a sequential upload queue, the removal command and its read-model filter, and token-styled components.

## Capabilities

### New capabilities

- `app-settings`: the Settings page, its sections, the back link, the disabled deferred controls, and theme selection.

### Modified capabilities

- `capture-grouped-evidence`: uploads start on pick and accept several files. Adds deleting and restoring evidence.
- `header-connection-status`: Open InvenTree moves into the connection menu.
- `batch-navigation` (added by `redesign-batch-workspace`): one count per tab, tabs left of the summary, phone header behaviour.
- `ui-design-system` (added by `redesign-batch-workspace`): the AI mark, short source chips with a popover, help buttons in place of helper text, descriptions with their limits.
- `review-records` (added by `redesign-batch-workspace`): descriptions on records, the Locations view.
- `processing-workspace` (added by `redesign-batch-workspace`): the Inventory step page.
- `changes-commit` (added by `redesign-batch-workspace`): the Tree view keeps "Lots to include".

## Impact and dependencies

- **Applications:**
  - `frontend/` across masthead, batches, capture, media, processing, review, changes, agents, settings and `ui`.
  - `contracts/`: media removal commands, removed state in the media projection.
  - `intake-server/`: a removal migration, commands, read model, processing input builder, and re-examine on removal.
- **Specs:** `redesign-batch-workspace` must be archived (its delta specs synced to main) before this change syncs, because four modified capabilities exist only in that change. Run `pnpm openspec:overlap --change apply-design-refresh` before syncing.
- **Evidence:** demo recordings for the UI PRs go on the PRs, not in the repository.

## Open decisions and assumptions

- **Assumption:** delete is undoable until the batch is approved. Restoring adds a new event rather than reverting rows, matching the append-only rules.
- **Assumption:** deleting a lot's only evidence leaves the lot with a blocking problem, not an automatic exclusion (canvas "Capture › delete evidence").
- **Assumption:** written notes can be deleted the same way as files. An evidence note is cleared by saving an empty revision, as today.
- **Recommendation, for the user to confirm:** deletion ships with its backend in this change. It could instead be built disabled under BI-015 if the user prefers to keep this change frontend-only.
