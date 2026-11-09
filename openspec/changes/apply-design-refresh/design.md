# Design assessment

## Context and grounding

Most of this change is frontend work on the component library and screens that `redesign-batch-workspace` built. Two parts touch other boundaries:

- **Direct upload:** frontend only. The upload endpoint already retains on receipt (`intake-server/src/media/repository.ts`); the Retain click is a browser-only gate in `components/media/MediaUpload.tsx`.
- **Evidence deletion:** the one backend feature. Media history rows are never deleted or re-pointed: the triggers in `0005_media.sql:196-204` refuse DELETE and batch changes, and only `media_batch.revision` advances. Evidence is cited by observations (0019), lot membership, decode commands, attachment selections, approval pins and frozen processing inputs (`processing/provenance.ts`).

**Complexity:** medium-large across screens, but each slice uses existing patterns. Decision D6 adds one new backend concept, an append-only removal.

**Design sources:**

- the canvas (v58) and design system (v20) linked from the proposal;
- the design change log entries D1–D31, which name the screens and likely components for each change.

## Goals and constraints

- **Requirements:** meet the delta specs for `app-settings`, `batch-navigation`, `ui-design-system`, `review-records`, `processing-workspace`, `changes-commit`, `capture-grouped-evidence` and `header-connection-status`.
- **Design-system names:** keep component names identical to the design system (`ui-design-system` › Components carry the design system's names).
- **Disabled, not faked:** build every deferred control fully in the frontend, but disabled with `DisabledFeature` wording, and send no request (`app-settings` › Deferred settings).
- **Append-only:** keep history append-only. Nothing deletes or rewrites a `media_*`, `capture_note` or observation row.
- **No inventory effects:** no new inventory effects and no new provider usage.

## Decisions and alternatives

### D1. Design-system foundation first, in `components/ui`

New components:

- `AiMark`, `IconButton`, `HelpButton`, `SettingsNav`, `SettingRow`, `Switch`, `NumberStepper`, `DescriptionField`, `TreeView`, `CompareTable`;
- a `SourceChipPopover` built on `Popover.tsx`;
- an `icons.tsx` holding the six inline SVGs.

Tokens:

- `ai` and `ai-weak` join the CSS custom properties (`theme` tokens) for both themes.
- `info` keeps its value.

Changes to existing components:

- `SourceChip` takes `source`, `certainty`, `tone` and an `evidence` slot. It renders the short form, with the popover holding the rest.
- `Pill` loses the ✦ glyph.

**Rejected:**

- *A headless UI library:* it duplicates the tested `Popover`, `Dialog` and focus helpers.
- *Inline per-screen styles:* they break the "components carry the design system's names" requirement.

### D2. Header: server menu replaces the Open InvenTree button and the "⋯" menu

**Desktop masthead.**

- `HeaderStatus` holds activity, then connection, then a Settings `IconButton`.
- `ConnectionDetails` becomes the server menu. It gains the Open InvenTree link that `HeaderStatus` rendered, the development badge line and a Server settings link. It keeps the existing bounded observation read. "Check connection now" renders disabled (BI-015).
- `MastheadMenu.tsx` is removed. Theme moves to Settings › Appearance and reuses the stored preference key; Agents is reached from Settings and the activity popover.

**Phone masthead.** At phone width the masthead renders brand, development badge, the activity chip (mark, spinner, segments) and a menu `IconButton` opening a sheet with Agents, Settings, server details and theme. The condensed sticky row is a `BatchHeader` variant driven by an `IntersectionObserver` on the full header.

**Rejected:**

- *Keeping the "⋯" menu beside the gear:* the user retired it.
- *A bottom tab bar:* P5 is undecided.

### D3. Batch header counts from one helper

`batches/BatchHeader.tsx` moves the tabs onto their own row under the title. A pure `tabCount(attention)` helper picks one count per tab: the attention count if any, otherwise the total. It is unit-tested against the D16 table in the change log.

The need-you aggregate from `redesign-batch-workspace` (design D8) still feeds the pill. The activity chip and Overview sub-tab stop rendering their copies.

### D4. Settings shell on the existing `#settings` route

`App.tsx` routes `#settings` and `#settings/<section>` to a new `components/settings/Settings.tsx`. The sections are `agents` (default), `inventree`, `defaults`, `descriptions` and `appearance`.

- **Agents section:** wraps `AgentSettingsForm` unchanged (same contract, revision and conflict handling) inside `SettingRow`s, plus the disabled "More control" card. Pause all reuses the pause command behind `AgentSessions.tsx`, and the slot meter reads the existing agent sessions query.
- **InvenTree section:** reads the existing connection observation. The token row, Check now, Replace token and import reference prefix render disabled (BI-015).
- **Back link:** uses a `returnTo` held in navigation state when Settings is opened. It falls back to Batches for a direct load.
- **Unsaved edits:** leaving Settings uses the existing navigation guard.

**Rejected:**

- *A modal settings dialog:* too much content, and it isn't linkable.

### D5. Direct upload as a sequential client queue

`MediaUpload` adds `multiple` to its inputs. `selected()` validates each file (same type and size rule) and enqueues the valid ones with their own `Idempotency-Key`. The queue then runs one file at a time:

1. Read the current media revision.
2. Call the existing `upload`.
3. On `retained`, run `finish` (refresh, then move to the chosen group).

**Failures:**

- A 4xx (`invalid_upload`, `media_capacity`, a revision conflict after one re-read) marks that file "Not added" with the server's reason.
- A lost response marks it "Upload not confirmed" and the queue moves on. Retry resends the identical request: same key, expected revision, label and bytes. Replays are checked before the revision (`media/repository.ts:40-44`), so a receipt means it was kept, and a 412 proves it wasn't. On a 412 the file is sent once more with a new key at the current revision.
- Moving a retained file into its chosen group also advances the revision, so the queue re-reads it before each upload.

The queue counts as dirty work for the existing `onDirtyChange` and navigation guard.

**Rejected:**

- *Parallel uploads:* each upload advances the revision, so they would conflict.
- *A server-side batch upload endpoint:* new contract for no user-visible gain.

### D6. Evidence removal as an append-only event

**Scope:** photos and documents (media evidence). Written batch notes are `capture_note` rows in the capture records, not media evidence, so deleting them is deferred to BI-015 with a disabled action. An evidence note is still cleared by saving it empty.

**Migration `0031_media_evidence_removal.sql`** adds `media_evidence_removal`, modelled on `media_group_selection`:

```text
id uuid PK, batch_id uuid, evidence_id uuid, revision bigint > 0,
actor_id uuid → operator, removed boolean,   -- true = removed, false = restored
UNIQUE(batch_id, evidence_id, revision), FK (batch_id, evidence_id) → media_evidence
```

It is protected by the same `reject_authority_change()` trigger. An item's current state is its latest row by revision; no row means present. Grants are added in `media/grants.ts` (API write; processing, agent and executor roles read).

**Commands.** `contracts/src/media.ts` adds `remove` and `restore` to the `MediaEdit` kinds, handled in `media/edit.ts` and posted to `/media/commands`. Each carries `evidence_ids[]`, the expected revision and an idempotency key. One transaction:

1. locks the media batch and checks the revision;
2. refuses with `media_removal_refused` if a `media_approval_pin` (an approved run) pins an item, or the batch is archived or frozen;
3. inserts one row per item;
4. marks the current proposals that cite a removed version stale with the existing `evidence_removed` reason (`processing/currentness.ts`), and sends the existing revision notices to the Examine, Research and Images sessions of the affected lots (restore sends them again);
5. advances the revision and records a `media_removed` or `media_restored` event.

A replay with the same key returns the first result. The command doesn't write `capture_lot`, so it doesn't cross into capture authority; the `reexamine` flag is not used.

**Where removal is enforced:**

| Path | Change |
| --- | --- |
| `media/read.ts`, projection | Removed items leave the main lists; they're returned in a separate `removed` list for "Deleted files" |
| `processing/examine-trigger.ts` (candidate query and `uncoveredVersions`) | Skips removed versions |
| Agent evidence reads (research broker and session tools) | Refuse or omit removed versions |
| Processing input builder and preparation | Skip removed evidence; frozen inputs keep their manifest, so provenance checks still hold |
| `media/execution-pins.ts` `lockApprovedMedia` | Refuses to pin a removed version, so a stale preparation can't be approved |
| Records and review projections | A lot whose observations and subject links all point at removed evidence gets a "No evidence" blocking problem |

**UI:**

- Each tile gets an actions menu: Open, Move to group…, Delete….
- The bulk bar gains "Delete N files…".
- A confirmation `Dialog` lists the affected lots from the projection.
- A `Toast` offers Undo (`restore`). A "Deleted files" disclosure at the end of Capture lists removed files with Restore.
- Delete is disabled, with the refusal reason, when the projection marks the item as pinned.

**Rejected:**

- *Hard delete:* refused by the triggers, and it would break frozen provenance.
- *Reusing lot exclusion:* exclusion is per lot, not per evidence.
- *Setting `reexamine` on lots:* nothing in processing reads it, and writing `capture_lot` from a media command crosses into capture authority.
- *Moving to a hidden "trash" group:* groups are hints, and processing would still read the item.

### D7. Descriptions: show what exists, disable what can't be stored

- **Part:** keeps `set_description`. It gains `DescriptionField` with "n / 250" and an over-limit state that blocks approval through the existing problem routing.
- **Existing records:** descriptions for existing parts, companies, categories, parameter templates and locations are already read on request (`records/existing.ts:110-114`) and shown in `RecordDetail`'s "In InvenTree" table. `DescriptionField` renders them read-only from that query. No contract or projection change: the records projection is built from the database and must not read the target.
- **No description yet:** new companies, manufacturer parts, supplier parts, locations, categories and templates have no contract field, and existing manufacturer and supplier parts aren't read. These render a disabled `DescriptionField` explaining "Agent-written descriptions for these come later" (BI-015).

### D8. Screens

Applied per design change log entry. The table names the owning component, with paths from the log.

| Entries | Owner and change |
| --- | --- |
| D3, D21 | `changes/ReadyToAdd.tsx` and `PreparationTreeView.tsx`: a two-column layout in both views, and a location shown only when it differs from the batch default |
| D7 | `processing/StepPage.tsx` with a new `ProcessingInventory.tsx`, using `CompareTable` when the duplicate question carries both records; missing fields read "Not known" |
| D8 | `review/records/RecordsStage.tsx`: Locations type with list and detail; mapping edits follow "Unsupported record changes are honest" |
| D17 | `review/records/PartEditor.tsx`: the "Who proposed what" panel is removed; `AskControl` is headed "Ask an agent about this Part" |
| D18–D20 | Hand-off cards and helper sentences removed; help moves to `HelpButton` (Capture groups, Map legend); Review shortcuts become a "Shortcuts" button |
| D22–D27 | `AiMark` placements per the log; `SourceChip` popover everywhere chips render; `KeyValue` uses it |

## State, authority and failure behavior

| Area | State and authority | Failure and recovery |
| --- | --- | --- |
| Upload queue | Browser memory only until each receipt; server authority unchanged | Per-file "Not added" or Retry with the same key; the navigation guard protects the queue |
| Removal | Append-only `media_evidence_removal` rows under the media revision and actor; batch-scoped authorization as other media commands | Stale revision 412, pinned 409 `media_removal_refused`, replay returns the first result; restore is a later `removed=false` row, available any time because removed files can't be approved |
| Agent notice | Existing `evidence_removed` stale reason and revision notices, written in the same transaction | Sessions pick them up through the existing notice path; a lost wake is retried by the existing delivery loop |
| Settings | Existing agent settings contract and revision; theme preference unchanged | Conflict shows Reload and keeps the edit; deferred controls send nothing |
| Server menu | Existing bounded connection observation and sanitized URL | Unavailable states as today |

**Security:**

- The removal command authorizes like other media commands for the batch.
- Removed bytes stay private and are never served by the projection.
- Approved-run evidence can't be removed, so execution journals keep their attachments.

## Verification strategy

- **Frontend unit and UI** (Vitest and Testing Library, `pnpm test` in `frontend/`):
  - components with their states, keyboard handling and focus return;
  - `tabCount` against the D16 table;
  - the upload queue with mocked `upload`: multi-file, 4xx, lost response then Retry with the same key, dirty guard;
  - delete dialog content and the disabled refusal;
  - the Settings back link;
  - phone header at 390px via the existing viewport helpers.
- **Contracts:** schema tests for `remove`/`restore` and the projection's removed and pinned fields.
- **Intake server Postgres tier** (`pnpm test:intake:pg`):
  - removal and restore commands: revision, idempotent replay, refusal when pinned or archived;
  - triggers refuse UPDATE and DELETE on the new table;
  - stale reasons and notices written for affected lots;
  - approval refuses a preparation citing a removed version;
  - processing inputs exclude removed evidence while frozen inputs keep their manifest.
- **Intake server process tier** (`pnpm test:intake:process`): the Examine trigger and agent evidence reads skip removed versions.
- **Updated tests:** existing tests that click Retain or Discard are rewritten to the pick-to-upload flow, not deleted.
- **Manual evidence on PRs:** demo recordings for the header, Settings, Capture upload and delete, and Records descriptions. A recording proves only the fixtures shown.

## Migration, rollout and recovery

- **Migration:** `0031` is additive (a new table, trigger and indexes), with no data rewrite. Rolling back the app leaves the table unused. Existing evidence has no removal rows and stays present.
- **Spec sync:** sync this change only after `redesign-batch-workspace` is archived, and run `pnpm openspec:overlap --change apply-design-refresh` first.
- **Feature exposure:** no feature flags. Deferred controls ship disabled.

## Risks and open decisions

- **Notice load:** deleting a photo used by many lots notifies all their sessions at once. This uses the existing notice path; the dialog states the count first.
- **Approval-time pinning:** pinning happens only at approval, so a file selected as an attachment but not yet approved can still be removed. Approval then refuses the stale preparation (see the table above), and Review shows the attachment's evidence as removed.
- **Open decision for the user:** deletion ships with its backend here (recommended) rather than being disabled under BI-015.
