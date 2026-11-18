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

- **Masthead.** `frontend/src/components/masthead/HeaderStatus.tsx` renders a separate Open InvenTree button (`BarTarget`) to the right of the connection control, as required by `header-connection-status` › Safe target details and navigation. `ConnectionDetails` already repeats the link inside the panel.
  - `MastheadMenu.tsx` holds the theme radio group, Agents and Agent settings (`#settings`).
  - Inside a batch, the breadcrumb shows "Batches / batch title".
- **Batch header.** `components/batches/BatchHeader.tsx` puts the tabs on the right and a summary line under the title. Its tab and sub-tab badges follow `batch-navigation` › Second tab row ("its own count and attention badge").
- **Source chips.** `components/ui/SourceChip.tsx` renders `{source} · {certainty}` inline. Clicking it opens the evidence.
- **Descriptions.**
  - Only new Parts carry a description: `contracts/src/records-projection.ts:575`, with the `set_description` op at `contracts/src/records.ts:46`.
  - `intake-server/src/records/existing.ts` already reads descriptions of existing parts, companies, categories, parameter templates and locations from InvenTree. It doesn't read manufacturer or supplier part descriptions.
  - New locations and suppliers created in Capture carry a description (`contracts/src/capture-intent.ts`). Manufacturer parts, supplier parts, agent-proposed companies, categories and templates have no description field.
- **Agent settings.** `contracts/src/agent-selection.ts` and `contracts/src/agents.ts` hold provider (Claude or Codex), authentication (subscription or API key), model and `session_concurrency` (1–8, default 3). The `#settings` route renders `components/agents/AgentSettings.tsx`, which also shows the personal Claude credential and ChatGPT sign-in panels backed by `/personal-runner/claude` and `/personal-runner/codex`.
- **Uploads.**
  - `components/media/MediaUpload.tsx` keeps the picked file in browser state and needs a Retain click. Retain calls `POST /api/v1/batches/:id/media/originals`; Discard only clears local state.
  - The server has no staged state: an upload *is* retention, and the receipt is always `retained` (`intake-server/src/media/repository.ts`).
  - The pickers take one file (`files?.[0]`, no `multiple`).
  - Each upload advances the batch's media revision, so several uploads must run one after another.
  - Tests that click Retain or Discard: `MediaUpload.test.tsx`, `CaptureWorkspace.media.test.tsx`, `MediaWorkspace.query.test.tsx`, `MediaWorkspace.groups.test.tsx`.
- **Evidence deletion.**
  - Nothing deletes evidence today.
  - `0005_media.sql` stops `media_*` history rows from being deleted or moved to another batch; only `media_batch.revision` advances. Runtime history is append-only.
  - `capture_note` and `media_evidence_note` are append-only too.
  - Active observations can't be deleted (`0019_evidence_observations.sql`, `evidence_observation_delete_refused`).
  - Evidence is referenced by observations, lot membership, derivations, decode commands, attachment selections, approval pins and frozen processing inputs (`intake-server/src/processing/provenance.ts`).
  - Written batch notes are `capture_note` rows in the capture records (`components/capture/EvidenceNoteForm.tsx`), not media evidence.
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
  - The approved removals. D17 needs no app change: the canvas's "Who proposed what" panel never existed in the app, whose per-field Ask controls stay.
  - AI sparkle placements, help buttons and short source chips across screens.
- **Capture:**
  - Direct multi-file upload (D30).
  - Deleting photos and documents, with Undo, a "Deleted files" list with Restore, and refusal rules (D31). This includes its backend, because it is a requested capability, not a proposed extra.
  - "✦ New" pills become "＋ New" (D23).

**Built but disabled, backend deferred to BI-015.** The design adds these controls, but each needs a new contract, storage or agent behaviour:

- The Agents "More control" card: model per step, instructions for every new batch, web research switches.
- App-level batch defaults and the description rules on Settings › InvenTree.
- Description fields for manufacturer parts, supplier parts, and agent-proposed companies, categories and parameter templates.
- Showing existing manufacturer part, supplier part and location type descriptions, which the server doesn't read yet.
- The Settings › InvenTree token row (status, Check now, Replace token), the import reference prefix, and Check connection now in the server menu.
- Deleting written batch notes, which live in the capture records rather than media evidence.
- The Inventory question's option cards, and the existing record's fields in the Inventory comparison: questions carry neither the session's answer options nor the existing record yet, so the cards show disabled and the comparison's InvenTree column reads "Not known".

Each is shown with a `DisabledFeature`-style explanation and no fabricated behaviour.

**Deliberate exclusions:**

- Autosave on Settings › Agents. The design shows "✓ Saved", but `AgentSettingsForm` saves explicitly under one revision for provider, authentication and model together. Autosave would need per-field saves and conflict handling for a form edited rarely, so Settings keeps the explicit Save.

- No `reexamine` flag on delete. Change log D31 asks for lot re-examination (0022), but a media command writing `capture_lot` would cross into capture authority; the Examine lead's batch notice and the lot sessions' notices replace it.

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

**Authority.** Nothing here grants provider, inventory, deployment or external messaging authority. Delete changes only the batch's own media state and tells its agents.

## Reuse and dependency assessment

The frontend already has React, styled-components and the BI-008 `components/ui` library. Popovers, dialogs, toasts and focus handling exist (`Popover.tsx`, `Dialog.tsx`, `Toast.tsx`, `useRovingFocus.ts`). The intake server already has append-only command patterns such as group selection and lot exclusion (0024).

| Option | Goal fit and strengths | Limitations and cost | Evidence (checked 2026-11-09) | Unknowns |
| --- | --- | --- | --- | --- |
| Extend the existing `components/ui` library and intake-server command pattern | Matches the design system names already used. No new dependency. Removal follows the existing append-only selection tables. | Custom code for the tree, popover-based chip and upload queue | `frontend/src/components/ui/*`, `0005_media.sql`, `0022`, `0024` | None material |
| Add more headless UI primitives (e.g. Radix Menu) | Accessible menus off the shelf | `Popover.tsx` is already built on `@radix-ui/react-popover` 1.3.1; a menu library adds a second focus model for two small menus that `Popover` and `useRovingFocus` already cover | `frontend/package.json`, `ui/Popover.tsx`, `Popover.test.tsx` | — |
| Add an upload library (e.g. Uppy) | Parallel or resumable uploads | Uploads must be serial because of the media revision, and they're idempotent per request key. A library would fight that contract. | `media/routes.ts:107-136`, `MediaUpload.tsx` | — |

**Recommended direction.** Extend the existing stack. The remaining custom work is small and already patterned: a sequential upload queue, the removal command and its read-model filter, and token-styled components.

## Capabilities

### New capabilities

- `app-settings`: the Settings page, its sections, the back link, the disabled deferred controls, and theme selection.

### Modified capabilities

- `capture-grouped-evidence`: uploads start on pick and accept several files. Adds deleting and restoring photos and documents.
- `header-connection-status`: Open InvenTree moves into the connection menu; at phone width the indicator is a dot on the menu button, with the control inside the menu.
- `capture-media`: removed evidence keeps its bytes and still counts towards capacity, isn't served beyond a thumbnail, and refuses edits and new observations.
- `processing-stage-pipeline`: stale reasons and notices on removal; restore as new evidence.
- `approval-preparation`: removed evidence blocks approval.
- `header-workflow-status` (modified by `redesign-batch-workspace`): the masthead's order ends with the Settings button, and the phone bar holds brand, Dev, agents status button and menu.
- `batch-navigation` (added by `redesign-batch-workspace`): one count per tab, tabs under the title, phone header behaviour.
- `ui-design-system` (added by `redesign-batch-workspace`): the AI mark, short source chips with a popover, help buttons in place of helper text, disabled controls that explain themselves, descriptions with their limits.
- `review-records` (added by `redesign-batch-workspace`): descriptions on records, the Locations view.
- `processing-workspace` (added by `redesign-batch-workspace`): Overview drops the repeated counts; the Inventory step page.
- `changes-commit` (added by `redesign-batch-workspace`): the Tree view keeps "Lots to include"; lot rows name only an overriding location.

## Impact and dependencies

- **Applications:**
  - `frontend/` across masthead, batches, capture, media, processing, review, changes, agents, settings and `ui`.
  - `contracts/`: media `remove` and `restore` edits; the media projection's removed list and its `pinned_by`, `lot_ids`, `sole_evidence_lot_ids` and `selected_attachment_of` fields; the `media_evidence_removed`, `media_removal_refused` and `approval_evidence_removed` refusals.
  - `intake-server/`: a removal migration and grants; the edit handler; the read model; the Examine trigger, agent evidence reads, processing inputs and preparation; approval pinning; stale reasons and notices on removal.
- **Specs:** `redesign-batch-workspace` is archived and its specs are synced to main, so the modified capabilities (batch-navigation, ui-design-system, review-records, processing-workspace, changes-commit, header-workflow-status) all exist there. Run `pnpm openspec:overlap --change apply-design-refresh` before syncing.
- **Evidence:** demo recordings for the UI PRs go on the PRs, not in the repository.

## Open decisions and assumptions

- **Assumption:** a deleted file can be restored at any time from "Deleted files". Restoring adds a new event rather than reverting rows, matching the append-only rules. Approval refuses removed files, so restore never conflicts with an approved run.
- **Assumption:** deleting a lot's only evidence raises the existing dismissible `no_supporting_evidence` warning rather than a new blocking problem or an automatic exclusion. The canvas said "blocked"; this softens it to the app's existing gate.
- **Exclusion:** upload tiles show an indeterminate "Uploading…" instead of the canvas's progress bar, because the existing upload request reports no byte progress.
- **Decided (user, 2026-11-09):** deletion ships with its backend in this change, because it was requested directly. It is not built disabled under BI-015.
