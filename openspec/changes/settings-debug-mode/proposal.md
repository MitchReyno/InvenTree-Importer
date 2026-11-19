# Change proposal

## Problem and intended outcome

Settings has twelve controls that render disabled as "Coming later". The design refresh (BI-014) shipped them that way on purpose, and their backend was left to BI-015. The operator can't set a model per step, instructions for new batches, a Part description style or app-level batch defaults. They also can't check the InvenTree token on demand. Several of these only need storage and a hook into code that already exists.

The app also shows developer detail to everyone. Examples are session failure codes and correlation IDs, attempt IDs, source receipt IDs, note provenance, approval hashes, run IDs, file hashes and a "Local setup and diagnostics" disclosure under every page. These are useful while developing the app, but noise while using it. Nothing turns them off. The "Dev mode" pill in the masthead is a static label.

Agent behaviour is also split across pages. The rules agents follow when writing descriptions live in their own section, and "Suggest tags automatically" sits in Batch defaults, apart from the rest of Settings › Agents.

Requested outcome (Mitch, 2026-11-19):

- **Coming later rows.** Implement a substantial set of the "Coming later" Settings options.
- **Debug mode.** Add a "Debug mode" setting. When off, the existing debug elements are hidden. When on, most screens show more detailed debug information.
- **Dev mode popover.** Clicking the "Dev mode" pill opens a small popover with basic developer tools and settings, including the debug mode switch.
- **Agent settings in one place.** Move agent-behaviour settings that live outside Settings › Agents into it, as subsections reached by sub-nav links under the Agents sidebar link.
- **Design first.** Update the design canvas, including every Settings page, before this proposal. Canvas v65 holds one artboard per Settings section, plus "Debug mode off and on", "Dev mode popover" and the Masthead component. The section artboards are "Settings › Agents (subsections with sub-nav)", "Settings › InvenTree", "Settings › Batch defaults", "Settings › Appearance" and "Settings › Developer". The design log records them as D32 to D35.

## Change identity and linked items

Change name: `settings-debug-mode`. Branches `type/settings-debug-mode[-suffix]`; subjects `type(settings-debug-mode): …`.

Linked items:

- **BI-015, Design refresh backend follow-ups (`complete-design-refresh-backend`, Proposed, README only).** This change takes over the Settings part of BI-015: model per step, new-batch instructions, batch defaults, the Part description rule, the token check, Check connection now and the import reference row. BI-015 keeps the rest:
  - Records descriptions;
  - deleting written batch notes;
  - Inventory questions with answer options;
  - the Settings rows this change leaves deferred (see Scope).

  The index entry and that change's README are narrowed to match.
- **Debug mode and the Dev mode popover** have no BI item. One is allocated with the `planned-functionality` skill (task 1).

## Current behavior and evidence

**Deferred rows.** Each is wrapped in `DisabledFeature`, which renders a "Coming later" pill (`frontend/src/components/ui/DisabledFeature.tsx:149`):

| Row | Where | What exists today |
| --- | --- | --- |
| Model per step | `settings/AgentsSection.tsx:153` | One selection per actor and target (`agent_settings`, `intake-server/src/agents/schema.ts:21`). Each attempt seals the selection and settings revision when it is queued (`processing/session-attempts.ts:59-64`), and that code already knows `job.stage`. |
| Instructions for every new batch | `AgentsSection.tsx:171` | Per-batch `capture_instruction` (migration 0008) with delivery in `agents/instructions.ts`. Batch creation inserts only a title and a note (`capture/repository.ts:1220-1250`). |
| Web research switches | `AgentsSection.tsx:178` | Agents have no web access (`agents/codex.ts:13`, `agents/claude.ts:62`). Research is an allowlisted broker (`config.ts:97-160`), and readiness reports `research: 'unqualified'`. |
| API token Check now / Replace token | `settings/InvenTreeSection.tsx:69` | `GET /api/v1/connection-status` probes the target with the token (`inventory/transport.ts:240`). The result is cached for 30 s (`header/connection.ts:8`), and a 401 is not told apart from other failures (`http_error`, `connection.ts:63`). The token is env-only, baked in at boot (`main.ts:110-119`). |
| Import reference prefix | `InvenTreeSection.tsx:85` | Fixed as `bi1:${source}:${contribution}` (`execution/plan.ts:57-61`) and re-verified by plan and effects code. |
| Default location, default supplier | `settings/BatchDefaultsSection.tsx` | Per batch only: `capture_selection` defaults and `capture_settings_intent` (migrations 0002, 0014). |
| Suggest tags automatically | `BatchDefaultsSection.tsx:40` | Per-batch `shared_tags.auto`, which adds an automation note to agent input (`capture/context-input.ts:69-84`). |
| Tag every Part with its batch name | `BatchDefaultsSection.tsx:40` | Nothing. |
| Fill descriptions for, Part description style, Supplier part descriptions | `settings/DescriptionsSection.tsx` | Agents propose only the Part description (250 characters, `processing/catalogue.ts:65`). The session instructions are a fixed string (`agents/session/session-runner.ts:57`), and the profile instruction bytes are digest-verified (`processing/authority.ts:73`). |

**Debug and developer UI shown to everyone.** All paths are under `frontend/src`:

- `App.tsx:278` renders `operations/Diagnostics.tsx` under every page.
- `masthead/ConnectionDetails.tsx:113-129` has a Details disclosure with transport state and the raw `failure_code`.
- `agents/SessionFailureDetails.tsx:81-104` has a Show details panel with code, stage, correlation, attempt, lineage, turn, provider, model, CLI version, provider session and cause codes.
- Processing:
  - `processing/QuestionAnswer.tsx:276` shows "Attempt ab12cd34 · question revision N";
  - `processing/ProcessingSources.tsx:12-39` shows raw receipt IDs;
  - `processing/ExamineView.tsx:508` has a region Details disclosure.
- Capture:
  - `capture/EvidencePanel.tsx:107` has a "Retained source identity" disclosure;
  - `capture/HumanNote.tsx:25` has "Note attribution";
  - `capture/CaptureContextSummary.tsx:21` shows record IDs, version and actor;
  - `media/MediaNoteSummary.tsx:16` has "Note provenance";
  - `operator/InstructionForm.tsx:91` shows "Version N".
- `batches/Batch.tsx:566-592` has a JSON dump of the saved revision.
- Changes:
  - `changes/ReadyToAdd.tsx:323` has "Exact approval binding";
  - `changes/RoundOutcome.tsx:293` has "Round details";
  - `changes/PartAttachments.tsx:29` and `changes/AttachmentOutcome.tsx:33` show file hashes and version IDs.

**Dev mode pill.** `masthead/DevBadge.tsx` is rendered unconditionally (`Masthead.tsx:41`, `ConnectionDetails.tsx:98`), as `access-identity` requires. It is a static `<span>`. The only device-local preference is the theme, stored under `bench-intake.theme` in `localStorage` through `theme/theme.ts` and read with `useSyncExternalStore`.

**Settings structure.**

- `settings/Settings.tsx:23` lists five sections.
- Routes are `#settings/<section>` (`navigation/app-route.ts`).
- `SettingsNav` (`components/ui`) has no nested items.

## Scope and non-goals

**Implemented Settings rows.** Each is stored per actor and target, revision-checked like agent settings, and applied only to sessions and batches started after a save:

- **Model per step.** Examine, Research, Images and Inventory each take "Same as Model" or a model from the selected provider. The attempt seals the resolved model.
- **Instructions for every new batch.** Copied into a new batch as its first whole-batch instruction. Existing batches are unchanged.
- **Part description style.** Plain-words guidance delivered to sessions that propose Part descriptions, sealed with the settings revision.
- **Suggest tags for new batches.** The initial value of a new batch's Auto tags.
- **Default location and default supplier.** Existing InvenTree records only, copied into a new batch's defaults at creation.
- **API token status and Check now.** A forced connection check that reports Accepted, Refused (a 401 or 403 from the target) or Unavailable, with its time. The masthead's "Check connection now" uses the same check.
- **Import reference.** Shown read-only as the fixed `bi1:‹source›:‹lot›` format, with no edit control and no "Coming later" pill.

**Agent settings in one place.** Settings › Agents becomes one page with subsections:

- Sessions and sign-in
- Models per step
- Instructions
- Descriptions and naming
- Tag suggestions
- Web research

Sub-nav links under the Agents link jump to each subsection, and each has its own route, `#settings/agents/<subsection>`.

- The Descriptions and naming section is removed; `#settings/descriptions` redirects to its subsection.
- "Suggest tags automatically" moves out of Batch defaults.

**Debug mode.**

- A device-local preference, off by default, stored like the theme.
- It is switched from the new Settings › Developer section and from the Dev mode popover.
- When off, the developer details listed above are hidden.
- When on, they show as marked DEBUG blocks, and each main screen adds a collapsible Debug panel. The panel shows the route, the relevant IDs and revisions, live-update state and read freshness, from data the screen already holds.

**Settings › Developer.** Holds:

- the debug mode switch;
- the local setup check, moved from the page footer;
- Reload app data, which invalidates every query but keeps drafts;
- Copy debug info, a non-secret plain-text summary of the build, route, readiness and live-update state.

**Dev mode popover.** The Dev mode pill becomes a button that opens a dialog popover with:

- the build summary;
- the debug mode switch;
- a short readiness summary;
- Check setup again, Reload app data and Copy debug info;
- a link to Settings › Developer.

**Still "Coming later".** These keep `DisabledFeature` with honest explanations, because each needs a capability that doesn't exist:

- **Web research switches:** there is no public-web research path.
- **Replace token:** there is no secure secret store or transport rebuild.
- **Fill descriptions for:** only the Part switch is on and fixed; other record types need new effect kinds.
- **Supplier part description source:** needs a new effect kind.
- **Tag every Part with its batch name:** new tag effect work.

These stay with BI-015.

**Non-goals.**

- Changing the import reference format, which earlier approvals depend on.
- Server-side storage of debug mode.
- Showing secrets or credentials in debug output; the existing sanitization still applies.
- Debug panels on the phone-only menus.
- Removing the Dev mode pill. `access-identity` still requires it in development builds.
- Changing what running sessions use.

**Compatibility.**

- Settings writes stay revision-checked.
- New columns default so that existing rows behave as today: every step "Same as Model", no instructions, no style text, Auto tags off, no batch defaults.
- Older attempt manifests, which don't carry a per-step model, keep their sealed selection.

## Reuse and dependency assessment

No external package is relevant. Every part extends an existing pattern in this repository:

| Option | Goal fit and strengths | Limitations and cost | Evidence (checked 2026-11-19) | Unknowns |
| --- | --- | --- | --- | --- |
| Extend `agent_settings` and its revisioned route for the agent rows; add one revisioned batch-defaults row with the same key | Reuses the revision check, grants, contracts client and the sealing at queue time | Needs a migration, column grants (`processing/grants.ts`) and regenerated contracts | `agents/settings.ts`, `agents/routes.ts:30`, `contracts/src/agents.ts:19` | None material |
| Copy the theme's `localStorage` plus `useSyncExternalStore` controller for debug mode | The established device-local pattern; no server change | Per device, not per operator; acceptable for a developer aid | `frontend/src/theme/theme.ts:6-110` | None |
| Deliver the description style through the existing instruction delivery path | Keeps the digest-verified profile bytes unchanged | Sealing must include the settings revision, which the manifest already carries | `agents/instructions.ts`, `processing/authority.ts:73` | Exact message placement is decided in design |
| A feature-flag or devtools library (for example a React devtools panel) | — | Adds a dependency for a switch and a panel that existing components cover | — | Rejected |
| Server-side debug flag | Shared across devices | Server and contract work for a single-operator development aid | — | Rejected for now |

Recommended direction: extend the existing settings storage and delivery paths, and copy the theme preference pattern. No new dependency.

## Capabilities

### New capabilities

- `debug-mode`: the device-local debug preference, what is hidden when it is off, the per-screen Debug panel, Settings › Developer and the Dev mode popover.

### Modified capabilities

- `app-settings`: the section nav with Agents subsections and a Developer section; the agent, InvenTree and batch-default rows that now work; the reduced deferred list; Descriptions and naming moved under Agents.
- `provider-runtime`: "Provider default sealed at queue time" seals the per-step model.
- `capture-batch-settings`: new batches start from the app-level defaults (location, supplier, instructions, Auto tags).
- `header-connection-status`: Check connection now works and reports token refusal; the Details disclosure shows only in debug mode.
- `processing-agent-sessions`: the failure diagnostic disclosure is limited to debug mode, keeping category, summary and recovery guidance for everyone.
- `ui-design-system`: "Provenance on demand" puts internal identifiers behind debug mode rather than behind any Details disclosure.
- `access-identity`: the masthead mode badge becomes a button that opens the Dev mode popover.

## Impact and dependencies

- **intake-server:**
  - a migration extending `agent_settings`, plus a new `batch_defaults` table;
  - grants, settings read and write, per-stage resolution in `session-attempts.ts`;
  - new-batch defaults in `capture/repository.ts` `create()`;
  - description-style delivery;
  - a forced connection check with a distinct `unauthorized` code.
- **contracts:**
  - `AgentSettings` and `AgentSettingsUpdate` fields;
  - batch-defaults DTOs and client;
  - the connection-check route;
  - regenerated `generated/`.
- **frontend:**
  - Settings sections and nav, and `SettingsNav` nested items;
  - routes;
  - a debug preference controller and `DebugDetails` and `DebugPanel` components;
  - about fifteen call sites gated;
  - the Dev mode popover;
  - the Diagnostics move.
- **Docs:** frontend and intake-server architecture and README, `docs/PLANNED_FUNCTIONALITY.md`, and the `complete-design-refresh-backend` README.
- **Design:** canvas v65 (D32 to D35 in the design log).
- **Prerequisites:** none. This doesn't depend on the open `default-env-settings` change.

## Open decisions and assumptions

Decided (Mitch, 2026-11-19):

- **Debug mode storage.** It is device-local and off by default, including in development builds.
- **Failure details.** With debug mode off, a failed session still shows its category, summary and recovery action. Only "Show details" (codes and IDs) needs debug mode. This narrows `processing-agent-sessions`, which today shows details to everyone.
- **Where debug mode lives.** It is in a new Settings › Developer section rather than Appearance.
- **Snapshot, not inheritance.** Batch defaults and instructions are copied into a batch when it is created. Later changes to the app-level values don't touch existing batches.

Open:

1. **Which rows to build.** This change builds the rows listed under "Implemented Settings rows" and keeps the others "Coming later", following the feasibility evidence in "Current behavior and evidence". Mitch asked for more explanation on 2026-11-19 and hasn't confirmed it yet.

Assumed:

- **Which tag setting moves.** Only "Suggest tags automatically" moves to Agents. "Tag every Part with its batch name" stays in Batch defaults, because it is deterministic rather than agent behaviour.
