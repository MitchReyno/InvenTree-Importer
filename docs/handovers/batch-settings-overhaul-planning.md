# Batch settings overhaul planning and uplift archival

## Scope and current state

Planning only. The user requested synchronization and archival of the delivered Capture/status uplifts, a full `batch-settings-overhaul` proposal, and separate minimal future-work entries for automatic supplier logos and PO support. No application code, runtime dependency, retained local database, real inventory or provider is changed by this planning PR.

The proposal uses the original mockup as the default Capture composition, removes the Physical lots and Part proposals panes, and retains manual subject editing in Review. The index owns current BI metadata. [BI-003](../PLANNED_FUNCTIONALITY.md#bi-003--batch-settings-overhaul) links the full plan; BI-004 and BI-005 remain briefs only.

## User decisions and assumptions

Confirmed: sync before archive; PO stays disabled with future support captured separately; Default location is one fallback overridden by specific Part/group assignments; quantity comes from evidence/inference with questions where no defensible estimate exists; remove Capture subject panes and default to the mockup layout. The plan records routine assumptions for specific lot/Part/group precedence, ambiguous groups, API-versus-socket availability, note Hide/Remove and a disabled expandable PO preview.

App-local autosave is separate from external new-record execution. New supplier/location forms stage attributable intents; approval and supervised effects remain explicit. Future PO and automatic logo work are not added as hidden implementation prerequisites.

## Archive assessment and sync evidence

`openspec list --json` resolved the initialized repository root. Both uplifts use `bench-intake`; artifact status was complete. Native task counts were Capture 37/37 and status 26/26. Accepted-delivery records in the existing handovers and merged index entries supply implementation evidence; archival itself does not establish Done.

All four selected deltas contained only ADDED requirements and meaningful Purpose sections. Their main specs did not exist. After the user chose sync, current specs instructions were fetched and considered. Each new main spec keeps the delta Purpose and requirement/scenario bodies verbatim, with a canonical capability title and one Requirements section. All four main specs passed `openspec validate --specs`. Content comparison verified every added block and Purpose before either directory moved. No sync remained in flight during archival.

Archive locations:

- `openspec/changes/archive/2026-11-04-capture-tab-uplift/`
- `openspec/changes/archive/2026-11-04-status-signalling-uplift/`

Both preserve `.openspec.yaml` and all authored artifacts. Relative links inside moved Markdown were adjusted one level deeper; index links point to the archives. Historical request/implementation prose remains historical. `portable-pr-planning` was not selected and remains untouched.

## Proposal and reuse assessment

The CLI created `batch-settings-overhaul` using the configured `bench-intake` schema. Instructions were fetched in proposal → specs → design → tasks dependency order, with dependency files re-read from disk. Four artifact types are present, including three capability deltas. `capture-batch-settings` modifies the synced baseline; two new capabilities own reference selection and inference preferences. Existing grouped evidence and header behaviour are preserved.

Source inspection covered Capture settings/queue/workspace/reference/context forms, public capture DTOs, server capture routes/read adapter, fixed inventory transport, live-update projection, owning frontend/server architecture and package manifests. The original Capture screenshot and HTML were inspected for composition, without modifying preserved references.

Research checked official InvenTree schema documentation, React Select source/manifest/license and TanStack mutation guidance on 2026-11-04. The proposal compares existing-stack reuse, React Select 5.10.2, custom accessible pickers and HTTP/socket write alternatives. It recommends a gated React Select adapter proof and existing HTTP command/socket-hint split. No package was added or claimed qualified. New-record target compatibility and live inference remain unqualified. Implementation tasks name the exact proof gaps, TDD regressions and owning checks.

Nine whole top-level tasks are assigned to four reasoned PR bundles; none is split across PRs. PR-B groups input qualification, panel autosave and Capture layout relocation. Task numbering remains stable when the later layout request adds Task 9. All implementation checkboxes remain pending.

## Validation and review

- `openspec validate --specs`: four synced main specs passed.
- `openspec validate batch-settings-overhaul --strict`: passed after shortening four long requirement statements without dropping their scenarios/design constraints.
- `openspec status --change batch-settings-overhaul`: four of four planning artifacts complete; implementation not started.
- Scoped Markdown lint: passed across authored and moved Markdown.
- BI allocation history: only BI-001 and BI-002 previously appeared; new IDs BI-003 through BI-005 are unique.
- Link/identity checks and independent exact-head review: results recorded below when performed.

The initial sandbox dependency install could not resolve the npm registry and was stopped. An authorized host install uses the existing frozen lockfile in this isolated worktree; it adds no runtime dependency. No runtime tests are necessary for this docs-only change. Schema/skill code is unchanged, so workflow-sync is not selected.

## Publication and recovery

Changes remain on the isolated conventional `docs/batch-settings-overhaul` branch targeting `interactive-app`. Use independent exact-head review before opening the planning PR and selected green CI before any authorized merge. No new implementation is authorized by this proposal request. A planning merge does not complete BI-003 or either future item.

Recovery is a normal revert of the planning commit/PR; preserve baseline/archive consistency and index links together. No data or service rollback is involved. Future implementation rollout and unknown-effect recovery are detailed in the new design/tasks rather than claimed delivered here.
