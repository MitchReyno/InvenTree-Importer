# Design assessment

## Context and grounding

Most of this change is frontend work on the component library and screens that `redesign-batch-workspace` built. Two parts touch other boundaries:

- **Direct upload:** frontend only. The upload endpoint already retains on receipt (`intake-server/src/media/repository.ts`); the Retain click is a browser-only gate in `components/media/MediaUpload.tsx`.
- **Evidence deletion:** the one backend feature. Media history rows are never deleted or re-pointed: the triggers in `0005_media.sql:191-204` refuse DELETE and batch changes, and only `media_batch.revision` advances. Evidence is cited by observations (0019), lot membership, decode commands, attachment selections, approval pins and frozen processing inputs (`processing/provenance.ts`).

**Complexity:** medium-large across screens, but each slice uses existing patterns. Decision D6 adds one new backend concept, an append-only removal.

**Design sources:**

- the canvas (v58) and design system (v20) linked from the proposal;
- the design change log entries D1–D31, which name the screens and likely components for each change.

## Goals and constraints

- **Requirements:** meet the delta specs for `app-settings`, `batch-navigation`, `ui-design-system`, `review-records`, `processing-workspace`, `changes-commit`, `capture-grouped-evidence`, `capture-media`, `processing-stage-pipeline`, `approval-preparation`, `header-connection-status` and `header-workflow-status`.
- **Design-system names:** keep component names identical to the design system (`ui-design-system` › Components carry the design system's names).
- **Disabled, not faked:** build every deferred control fully in the frontend, but disabled through `DisabledFeature` (generalised in Task 1 to wrap any control with `aria-disabled`, so it stays focusable and announces its explanation), and send no request (`app-settings` › Deferred settings).
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
- `ConnectionDetails` becomes the server menu. It already renders the Open InvenTree link (the `inventree` prop); the change removes the separate `BarTarget` button from `HeaderStatus` and adds the development badge line and a Server settings link. It keeps the existing bounded observation read. "Check connection now" renders disabled (BI-015).
- `MastheadMenu.tsx` is removed. Theme moves to Settings › Appearance and reuses the stored preference key; Agents is reached from Settings and the activity popover.

**Phone masthead.** At phone width the masthead renders brand, development badge, the activity chip (mark, spinner, segments) and a menu `IconButton` opening a sheet with Agents, Settings, server details and theme. The menu button carries the connection state as a dot and in its accessible name, so the indicator stays on the masthead (`header-connection-status` › Independent connection observations, modified). The condensed sticky row is a `BatchHeader` variant driven by an `IntersectionObserver` on the full header.

**Rejected:**

- *Keeping the "⋯" menu beside the gear:* the user retired it.
- *A bottom tab bar:* P5 is undecided.

### D3. Batch header counts from one helper

`batches/BatchHeader.tsx` moves the tabs onto their own row under the title. A pure `tabCount(tab, attention)` helper returns one count and tone per tab, unit-tested against this table:

| Tab | Count and tone |
| --- | --- |
| Capture | none |
| Processing | open questions (warn), else none |
| Processing › Overview | none |
| Processing › step | lots done of total ("7/12"), or that step's questions (warn) when any |
| Review | lots to check (plain); its sub-tabs carry the decisions |
| Review › Lots | lots needing answers (warn), else all lots (plain) |
| Review › Map | unused photos or observations (warn), else none |
| Review › Records | record decisions (warn), else all records (plain) |
| Changes and Ready to add | lots ready to add (ok) |
| Changes › Added | items needing attention (bad), else none |

The need-you aggregate from `redesign-batch-workspace` (design D8) still feeds the pill. The activity chip and Overview sub-tab stop rendering their copies.

### D4. Settings shell on the existing `#settings` route

`App.tsx` routes `#settings` and `#settings/<section>` to a new `components/settings/Settings.tsx`. Its route match and the `currentBatch` derivation (`App.tsx`, the `currentBatch` derivation and the exact `route === 'settings'` match) change from an exact `settings` match to a `settings` prefix, so `#settings/inventree` isn't read as a batch. The sections are `agents` (default), `inventree`, `defaults`, `descriptions` and `appearance`.

- **Agents section:** restyles `AgentSettingsForm` onto `SettingRow`s: option cards for provider, a segmented control for authentication, a model select and a `NumberStepper` for sessions at once. The contract, revision and conflict handling stay the same, and saving stays explicit with one Save action. The existing `PersonalClaudeCredential` and `ChatGPTSignIn` panels from `AgentSettings.tsx` move into the section. The endpoints (`/personal-runner/claude`, `/personal-runner/codex`) are POST-only, need the typed management key and exist only under `INTAKE_PERSONAL_MANAGEMENT`, so a provider card shows the status of its panel rather than reading its own. Each panel keeps its status in local state, and `ChatGPTSignIn` polls sign-in through a TanStack query, so a child callback would need an Effect that passes query data to the parent, which `frontend/CODE_GUIDELINES.md` (Effects) forbids. Instead the state is lifted: each panel's state, handlers and (for Codex) the sign-in poll query move unchanged into a hook (`usePersonalClaudeCredential`, `useChatGPTSignIn`) that Settings calls once and passes to both the panel and its provider card. The card therefore mirrors the panel: "Not checked" while the panel shows no status (before a check, after a collapse or a key edit), Claude "Configured" or "Unconfigured" (the panel's own words), Codex "Connected", "Signing in", "Not connected" or "Declined", and "Check failed" while the panel shows its error. The panels show one message for every failure (personal management off, refused key, network error), and the frontend has no personal-management flag, so the card doesn't try to tell these apart. The disabled "More control" card sits below. Pause all reuses the pause command behind `AgentSessions.tsx`, and the slot meter reads the existing agent sessions query.
- **InvenTree section:** reads the existing connection observation. The token row, Check now, Replace token and import reference prefix render disabled (BI-015).
- **Back link:** uses a `returnTo` held in navigation state when Settings is opened. It falls back to Batches for a direct load.
- **Unsaved edits:** leaving Settings uses the existing navigation guard.

**Rejected:**

- *A modal settings dialog:* too much content, and it isn't linkable.

### D5. Direct upload as a sequential client queue

`MediaUpload` adds `multiple` to its inputs. `selected()` validates each file (same type and size rule) and enqueues the valid ones with their own `Idempotency-Key`. Each queued file shows an indeterminate "Uploading…" state: the existing `fetch` upload reports no byte progress, and the plan doesn't add an XHR path just for a bar. The queue then runs one file at a time:

1. Read the current media revision.
2. Call the existing `upload`.
3. On `retained`, run `finish` (refresh, then move to the chosen group).

**Failures:**

- A 4xx (`invalid_upload`, `media_capacity`, a revision conflict after one re-read) marks that file "Not added" with the server's reason.
- A lost response marks it "Upload not confirmed" and the queue moves on. Retry resends the identical request: same key, expected revision, label and bytes. Replays are checked before the revision (`idempotentMedia` in `media/encoding.ts:28-46`), so a receipt means it was kept, and a 412 proves it wasn't. On a 412 the file is sent once more with a new key at the current revision.
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
2. refuses with `media_removal_refused` if a `media_approval_pin` pins an item (an approval used it, as an attachment or supporting evidence); an archived batch is refused by `lockMediaBatch` with the existing `batch_archived` 409. `lockMediaBatch` also refuses `restore` in an archived batch;
3. inserts one row per item, and appends an `unset` attachment selection for any removed version that was selected, so a new preparation can't silently drop it;
4. marks current proposals stale with the existing `evidence_removed` reason (`processing/currentness.ts`) when they rely on the removed item through any of three joins: a media source on one of its versions, an `evidence_observation` source whose observation's `evidence_version_id` is one of its versions, or one of its evidence notes. Like the existing `observationRemoved`, it then runs `cascadeAll(..., 'evidence_removed')`, so proposals built on a stale proposal go stale too and Inventory waits. Its notes also leave new inputs. Stale marks are final (`processing-stage-pipeline` › Evidence-based currentness), so a restore doesn't revive them; the sessions revise. It sends a batch notice to the Examine lead, and notices to the affected lots' Research and Images sessions (`lotSessions`), keyed by the removal revision so a later removal after a restore is delivered again. A restore appends its own `evidence` inbox item for the lead, keyed `restored:<evidence>:<revision>`, because `examine-trigger.ts` skips versions the lead has seen, observed or pinned;
5. advances the revision and records a `media_removed` or `media_restored` event.

A replay with the same key returns the first result. The command doesn't write `capture_lot`, so it doesn't cross into capture authority; the `reexamine` flag is not used.

**Where removal is enforced:**

| Path | Change |
| --- | --- |
| `media/read.ts`, projection | Removed items leave the main lists and come back in a separate `removed` list for "Deleted files". Each item gains `pinned_by` (the approval's id from `media_approval_pin`, with its time from `executor_run.approval_id` → `executor_run.command_id` → `command.created_at`), `lot_ids` (lots it feeds through observations or subject links), `sole_evidence_lot_ids` (lots whose `hasSupportingEvidence` would become false) and `selected_attachment_of` (records whose attachment selection the delete clears) for the dialog and refusal state. Removed items show a thumbnail and label only |
| Operator byte routes (`GET /media/versions/:id`, previews, `media/region-crops.ts`) | Serve only the thumbnail preview of a removed version; refuse the original, other previews and region crops |
| Review projections (evidence pane, Map regions) | Omit observations on removed versions |
| Other media edits (`move`, `move_many`, `link`, attachment selection, `derive`, evidence note) | Refused with `media_evidence_removed` 409 on a removed item |
| `ungroup` | Also moves removed members to ungrouped, so a restore never returns a file to a retired group; restore uses the file's group only if it is still active |
| `review/model.ts` `hasSupportingEvidence` | Ignores removed items, so a lot left without present evidence raises the existing dismissible `no_supporting_evidence` warning |
| `media/commands.ts` `requireUploadCapacity` | Unchanged: removed items keep counting towards the 200-item cap, so `MediaSnapshot.evidence` (max 200) plus the `removed` list (max 200) together stay within it |
| `capture/evidence-observations.ts` `requireEvidenceRegion` (used by `recordObservation` and `applyObservationEdit`) | Refuses removed versions with `media_evidence_removed`. It takes `lockMediaRevision` after the capture lock it already holds, matching `lockMediaBatch`'s order (capture batch, then media revision) |
| `leadBatchView` | Omits observations on removed versions |
| `processing/examine-trigger.ts` (candidate query and `uncoveredVersions`) | Skips removed versions |
| Agent evidence reads (research broker and session tools) | Refuse or omit removed versions; lot-session observation views omit observations on removed versions |
| `agents/tools/handlers.ts` proposal publication source check | Refuses `media_version` sources whose version is removed, `evidence_observation` sources on a removed version, and `note` sources that resolve to a removed item's `media_evidence_note`, with `media_evidence_removed`, even if they were delivered before the removal |
| Processing input builder and preparation | Skip removed evidence; frozen inputs keep their manifest, so provenance checks still hold |
| `review/approve-preparation.ts` | Checks for removed evidence first, before re-materialising and comparing the plan, and refuses with `approval_evidence_removed` (409); otherwise `stale_preparation` would fire first |
| `media/execution-pins.ts` `lockApprovedMedia` | Also refuses a removed version, as defence in depth |

**UI:**

- Each tile gets an actions menu: Open, Move to group…, Delete….
- The bulk bar gains "Delete N files…".
- A confirmation `Dialog` lists the affected lots, any lot left without evidence, and any attachment selection it clears.
- A `Toast` offers Undo (`restore`). A "Deleted files" disclosure at the end of Capture lists removed files with Restore.
- Delete is disabled, with the refusal reason, when the projection marks the item as pinned.

**Rejected:**

- *Hard delete:* refused by the triggers, and it would break frozen provenance.
- *Reusing lot exclusion:* exclusion is per lot, not per evidence.
- *Setting `reexamine` on lots:* writing `capture_lot` from a media command crosses into capture authority. The Examine lead's batch notice replaces the flag; `leadBatchView` would otherwise show it to the lead.
- *Moving to a hidden "trash" group:* groups are hints, and processing would still read the item.

### D7. Descriptions: show what exists, disable what can't be stored

- **Part:** keeps `set_description`, already capped at 250 by `PartDescription`. It gains `DescriptionField` with "n / 250". Only catalogue proposals that would exceed the limit (`description_unsupported`) show an over-limit state. Such a description is never written (`processing/catalogue.ts` doesn't copy unsupported values), and the field shows the existing "Not supported yet" block, because the value lands in the Part record's `unsupported` list (`contracts/src/records-projection.ts`) that `RecordDetail` renders; approval isn't blocked.
- **Existing records:** descriptions for existing parts, companies, categories, parameter templates and locations are already read on request (`records/existing.ts:110-114`) and shown in `RecordDetail`'s "In InvenTree" table. `DescriptionField` renders them read-only from that query, over-limit or not, without blocking. No contract or projection change: the records projection is built from the database and must not read the target.
- **New locations and suppliers created in Capture:** `CaptureLocationDraft` and `CaptureCompanyDraft` already carry `description` (`contracts/src/capture-intent.ts`), so Records shows it.
- **No description yet:** manufacturer parts, supplier parts, agent-proposed companies, categories and templates have no contract field; existing manufacturer and supplier parts and location types aren't read. These render a disabled `DescriptionField` with `DisabledFeature` wording that follows R10 (BI-015).

### D8. Screens

Applied per design change log entry. The table names the owning component, with paths from the log.

| Entries | Owner and change |
| --- | --- |
| D3, D21 | `changes/ReadyToAdd.tsx` and `PreparationTreeView.tsx`: a two-column layout in both views, and a location shown only when it differs from the batch default |
| D7 | `processing/StepPage.tsx` with a new `ProcessingInventory.tsx`, using `CompareTable` when the duplicate question carries both records; missing fields read "Not known" |
| D8 | `review/records/RecordsStage.tsx`: Locations type with list and detail; mapping edits follow "Unsupported record changes are honest" |
| D17 | No app change: the app never had the canvas's "Who proposed what" panel, and its per-field `AskControl` ("Ask {step}", `RecordDetail.tsx:232-240`) already meets `review-records` › Steering routed to the proposing step, so it stays |
| D18–D20 | Hand-off cards and helper sentences removed; help moves to `HelpButton` (Capture groups, Map legend); Review shortcuts become a "Shortcuts" button |
| D22–D27 | `AiMark` placements per the log; `SourceChip` popover everywhere chips render; `KeyValue` uses it |

## State, authority and failure behavior

| Area | State and authority | Failure and recovery |
| --- | --- | --- |
| Upload queue | Browser memory only until each receipt; server authority unchanged | Per-file "Not added" or Retry with the same key; the navigation guard protects the queue |
| Removal | Append-only `media_evidence_removal` rows under the media revision and actor; batch-scoped authorization as other media commands | Stale revision 412, pinned 409 `media_removal_refused`, replay returns the first result; restore is a later `removed=false` row, available unless the batch is archived; removed files can't be approved |
| Agent notice | Existing `evidence_removed` stale reason and revision notices, written in the same transaction | Sessions pick them up through the existing notice path; a lost wake is retried by the existing delivery loop |
| Settings | Existing agent settings contract and revision; theme preference unchanged | Conflict shows Reload and keeps the edit; deferred controls send nothing |
| Server menu | Existing bounded connection observation and sanitized URL | Unavailable states as today |

**Security:**

- The removal command authorizes like other media commands for the batch.
- Removed files' originals and crops are refused on every route; only their thumbnail reaches the operator, for "Deleted files" and the confirmation. Nothing of them reaches agents.
- Approved-run evidence can't be removed, so execution journals keep their attachments.

## Verification strategy

- **Frontend unit and UI** (Vitest and Testing Library, `pnpm test` in `frontend/`):
  - components with their states, keyboard handling and focus return;
  - `tabCount` against the table in D3;
  - the upload queue with mocked `upload`: multi-file, 4xx, lost response then Retry with the same key, dirty guard;
  - delete dialog content and the disabled refusal;
  - the Settings back link;
  - phone header at 390px via the existing viewport helpers.
- **Contracts:** schema tests for `remove`/`restore` and the projection's removed and pinned fields.
- **Masthead check:** `pnpm --filter @invimport/frontend check:masthead` for the masthead layout and mask (PR-B).
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

- **Migration:** `0031` is additive (a new table, trigger, indexes and grants), with no data rewrite. Rolling back the app leaves the table unused. Existing evidence has no removal rows and stays present. Task 11 proves this against a database migrated to 0030 with existing evidence.
- **Spec sync:** run `pnpm openspec:overlap --change apply-design-refresh` before syncing.
- **Feature exposure:** no feature flags. Deferred controls ship disabled.

## Risks and open decisions

- **Restore and stale proposals:** a restore can't revive proposals the delete made stale, so an accidental delete costs agent work. The confirmation names the affected lots first, and the lead treats the restored file as new evidence.
- **Notice load:** deleting a photo used by many lots notifies all their sessions at once. This uses the existing notice path; the dialog states the count first.
- **Approval-time pinning:** pinning happens only at approval, so a file selected as an attachment but not yet approved can still be removed. Approval then refuses the stale preparation (see the table above), and Review shows the attachment's evidence as removed.
- **Decided (user, 2026-11-09):** deletion ships with its backend here rather than being disabled under BI-015.
