# Design assessment

## Context and grounding

This is a substantial cross-layer behaviour change, not a label-only refactor. Read the [proposal](proposal.md), [settings delta](specs/capture-batch-settings/spec.md), [reference delta](specs/capture-reference-selection/spec.md) and [inference delta](specs/capture-inference-preferences/spec.md). Existing capture settings are one atomic command, while instructions use a separate versioned command. Immutable notes are append-only. Capture references bind observations and target context; PostgreSQL owns revision authority. `LiveUpdates.tsx` invalidates scoped Query reads and does not acknowledge commands.

Owning files include `frontend/src/components/capture/BatchSettingsPanel.tsx`, `CaptureContextFields.tsx`, `ReferenceField.tsx`, `InstructionsPanel.tsx` under `components/operator/`, `frontend/src/capture/editor-model.ts`, `contracts/src/capture.ts`, `contracts/src/effects.ts`, `intake-server/src/capture/`, `intake-server/src/processing/`, `intake-server/src/review/` and `intake-server/src/execution/`. Changes to instructions, forms and command hooks must reuse the existing retained-command/dirty owners rather than create disconnected save loops. Additive migrations are owned by `intake-server/`; exact immutable approval and media-input versions remain supported.

## Goals and constraints

- Default to the original mockup's evidence-left/settings-right two-column layout with a narrow stack; remove Physical lots and Part proposals panes and preserve evidence actions, groups and the approved light palette.
- Save valid settings automatically to application state; maintain truthful revision, provenance, dirty-navigation and uncertainty semantics.
- Provide one Default location with more-specific assignments and searchable supplier/location forms; retain separate physical lots.
- Keep new records as explicit reviewed intents until supervised execution; leave PO and automatic logo discovery disabled.
- Retain exact human choices and legacy inputs. No live provider or target calls are needed for implementation qualification unless separately authorized.

## Decisions and alternatives

### Reusable input composition

Recommend `react-select` 5.10.2 behind an application-owned `SearchableReferencePicker`, subject to the focused proof below; reuse installed RHF Controller and styled-components. Do not expose package option objects as retained references. `onCreateOption` opens a typed form; it does not create an inventory record. Use one TSX file per component under `components/ui/` or `components/capture/` as appropriate.

Concrete reusable components: `SearchableReferencePicker` (location/supplier/parent), `OptionalNotesField` (batch/order with Hide versus Remove), `AutoValueField` (Auto/None/Manual dropdown-style popover with a dedicated manual text/date input area), `SharedTagsInput` (manual chips and independent Auto), and `AutosaveStatus` (textual status and recovery actions). Keep domain payload building outside these presentation components. Existing native date/text inputs suffice; do not add a date framework. Auto/None/Manual fields use the installed Radix Popover, not React Select: a trigger shows the current choice, the popover lists Auto, None and Manual as radio-style choices, and Manual reveals a separate labelled input area inside the same popover. Do not embed a text input inside an ordinary selectable option unless its focus, keyboard and accessibility behaviour is separately qualified. React Select is reserved for the searchable supplier, Default location and parent-location pickers. Keep logo retention in existing upload/decode ownership with explicit validation and reference identity rather than a raw URL or browser File embedded in JSON.

The [proposal research](proposal.md#reuse-and-dependency-assessment) compares package reuse and custom interaction code. React Select's React 19 peer declaration and MIT license are inspected, not tested integration. Before adoption, install the exact candidate only in an owned qualification environment, inspect lockfile/advisory delta and check StrictMode, RHF controlled values, async stale-response rejection, keyboard/focus announcements, IME, touch and 200% zoom. Package failure requires a documented replacement decision and equivalent qualification, not a silent custom fallback. Disable Emotion animation extras; contain styling through one adapter. Record actual bundle delta and maintenance implications in the handover. This is the precise remaining proof-of-fit gate, not generic investigation.

### Autosave keeps HTTP command authority

Retain scoped validated HTTP commands and existing socket hints. Socket writes add another admission/replay/acknowledgement protocol and cannot solve conflicts or ambiguous delivery. TanStack mutation scope can serialize calls but cannot establish authority; an app-owned per-batch save coordinator controls the retained command lifecycle. Do not use persistence plugins or automatic mutation retries that replay on reconnect.

Use a 500ms idle debounce for valid settings, flush on blur for valid completed fields, and pause during IME composition. A checkbox/select change can schedule immediately. The interval is a UI choice, not a persistence guarantee. Instructions participate in the same per-batch revision queue while retaining their own immutable instruction command. Settings and instructions may produce separate acknowledged commands; expose their pending/error states separately and mark the panel fully saved only when both match the current drafts.

| State | Behaviour |
| --- | --- |
| Clean | Display acknowledged retained values and revision. |
| Dirty/invalid | Preserve RHF draft, report navigation dirtiness synchronously; validate locally and do not send invalid values. |
| Saving | Freeze exact payload, loaded revision and delivery key; retain later edits separately. One batch mutation at a time, including instructions. |
| Acknowledged | Adopt only that receipt as the next revision. Do not reset newer draft fields; construct their next request from the acknowledged result only when no external conflict is known. |
| Conflict | Stop queue; preserve local and server versions. Offer explicit compare/reload/keep-and-resolve controls; no automatic merge. |
| Unconfirmed | Freeze original request identity and stop new commands. Reconcile saved state or explicitly retry identical bytes/key; no automatic newly keyed retry. |
| Disconnected | Disable/grey editable controls, keep draft and request state in the mounted owner. Reconnect performs scoped read/reconciliation before admitting writes. |

A socket refresh never resets a dirty editor. When a server revision includes another client's change, accepting an own-command receipt does not authorize overwriting it. Navigation remains guarded while dirty/invalid/pending/unconfirmed, and intentional discard/reload is a recovery action even though normal Save/Discard buttons disappear. Do not promise draft persistence across a browser crash or reload; warn through the existing navigation/beforeunload protections. No general offline durable queue is introduced.

### Connection availability is scoped and layered

Use a shared fresh app-API observation, aligned with the header's existing 60-second freshness contract, plus immediate request failures and online/offline hints. `navigator.onLine` alone is not proof. Derive editability from current actor/target/context, API availability, archive/freeze and permission state. Recheck on focus/visibility return before commands; bound freshness timers even when the browser suspends. No second health probe loop or socket belongs to the panel.

A socket outage with fresh HTTP fallback does not disable local settings. Target failure disables target search/dispatch and displays unavailability; it cannot claim an empty list. Existing selected observations remain readable with freshness. Scope changes cancel/ignore obsolete responses and preserve the previous draft under its original scope for explicit reconciliation; never carry its values or delivery keys into a new target automatically.

### Search and new-record authority

Add typed paginated semantic list operations for locations and supplier companies to the fixed-target read adapter, with bounded query length, page sizes, response bytes/deadlines and allowlisted query fields. Authorize the batch before target traffic; never follow an upstream pagination URL supplied by the target without reconstructing a validated same-origin request. Query keys include scope, model, search and cursor. Debounce search separately from autosave and discard older results. Search primarily uses name matches, then other supported fields; exact numeric ID lookup supplements list search. Read observations bind the final selected record, not every keystroke.

Fuzzy search is shared across supplier, Default location and parent location. Prefer exact-pinned Fuse.js 7.1.0 for approximate scoring after a small pure ranking adapter assigns exact ID/name tiers. Normalize query whitespace/case/accents for matching only; preserve displayed labels and exact IDs. Weight names above description/path and use stable ID tie-breaking. Calibrate a conservative threshold against one-character omissions/insertions and unrelated-name false positives; short queries should favour exact/prefix matches rather than a noisy fuzzy list. Disable React Select's default substring filter for already ranked results so it cannot hide typo matches.

Candidate retrieval is part of fuzzy search, not a later UI detail. Extend Task 2's catalogue adapter to provide a scoped bounded name/identity candidate snapshot independent of the typed strict upstream filter. Start with at most 500 candidates per model/context, bounded page requests and existing response/deadline limits; expose truncation and provide explicit search refinement/exact-ID lookup when that cap is reached. Do not promise complete-catalogue fuzzy recall beyond this set or silently walk the whole inventory. Keep candidates private under the existing actor/target/context query lifetime and invalidate on scope changes; supplement with current exact text/ID results, deduplicate by exact identity, and retain the coverage label. Task 2 proves a typo match outside the upstream strict result set is still retrieved when inside the admitted candidate set. Task 3 proves the picker does not re-filter it away. No server-side search index, hosted search service or new socket is needed.

The proposal compares Fuse.js with reusing the existing substring filter (insufficient typo tolerance) and custom edit-distance code (unnecessary algorithm/maintenance ownership). Version 7.1.0 source declares Apache-2.0 and no runtime dependencies; current main is a prerelease and is not selected. This inspection is not a package integration proof: Task 3 must record exact lock/advisory/bundle costs, Node/browser/TypeScript fit, threshold fixtures and worst-case latency for the bounded set before adoption.

The official schemas linked in the proposal support feasibility; target API-version compatibility must be qualified against fixtures/versioned serializers, not inferred from latest documentation. Parent location is an existing observed reference for this change; recursive creation chains are unnecessary. Match supplier flag before accepting a company. Required form fields are name; description and existing parent or manual logo are optional. Also set as manufacturer applies only to a new supplier intent, not an unsolicited patch to an existing company. Names are not identifiers; duplicate suggestions lead to explicit reuse or differentiated intent.

Add versioned app-retained new-location/new-company intents. Optional logos use owned private retained bytes with type/size/decode limits; upload acknowledgement and form autosave are separate. Add new effect types through the existing prepare/approve/supervised-run owner with exact dependencies, result mapping and original-run recovery. An approved created parent/company output may feed only its declared dependent operation. No browser/web autosave route gets a write credential. Use an owned fake profile for qualification; actual target write profile stays unavailable until independently qualified. Reusing a confirmed known output must never repeat the create. Cancellation, lost acknowledgements and restart retain uncertainty rather than retrying name-based POSTs.

### Location resolution and physical identity

Retain explicit location intent at physical-lot, shared-Part and evidence-group scopes; resolve lot → Part → applicable group → batch. A Part location is an application default for its lots, not a field written to InvenTree Part. Group context applies only to lots connected by retained evidence links; evidence membership alone is not a new lot identity. Several applicable groups with the same reference agree; different references block resolution unless a higher-precedence assignment applies. Explicit clear suppresses lower-level fallback; legacy unset/unknown distinctions remain preserved and surfaced for resolution. Changing default or links increments relevant revision and invalidates stale processing/preparations without altering approved history. Review shows effective source and permits exact per-lot correction.

### Quantity and tag proposals retain human authority

Remove only Batch settings Quantity mode, not stored exact quantity semantics or per-lot correction. Existing human quantities remain chosen values. Extend Processing input with versioned automation intent and output with supporting evidence, estimated status and questions when no defensible quantity exists. Old attempt output cannot overwrite new human input. Current provider unavailability remains visible; deterministic fixtures qualify this workflow without claiming live inference. Reviewed acceptance materializes an exact quantity through existing human-edit/approval boundaries.

Manual tags and Auto form separate fields. Manual values map to reviewed new-Part tag intent; auto values remain separately attributed suggestions until accepted. Preserve explicit removals against stale suggestions and deduplicate with an explicit case policy consistent with the target tag adapter. Existing-Part reuse exposes tags as context or unsupported intent, never replaces an existing collection. This change does not add a new existing-Part tag mutation profile.

### Notes, order preview and future capabilities

Keep batch and order notes as distinct versioned fields; Hide is UI state and Remove creates a tombstone/current-empty revision. Historical append-only notes stay readable and are not concatenated automatically into a new note or stripped of Part/lot scope. Relabel existing instructions without changing their scope or promising new consumption by an adapter that ignores them.

PO stays disabled immediately below supplier. A separate enabled disclosure can show/hide the disabled future-field preview; the checkbox itself cannot toggle. `AutoValueField` models Auto/None/Manual even in disabled preview, with Auto as the new-field default and exact manual lexical/date values preserved on migration. Add order notes follows the same disabled conditional layout. The future [PO item](../../purchase-order-support/) owns activation and actual conditional editing; the present preview creates no active PO intent. Batch notes, supplier, tags and custom instructions remain active when connected. [Automatic logos](../../automatic-supplier-logos/) remains README/metadata only; its disabled control has a focusable explanation wrapper because disabled native inputs cannot receive focus.

### Capture composition and relocated subject editing

`CaptureQueue.tsx` and the persistent subject editor currently make Capture a three-column subject workspace. Remove them from Capture composition; do not delete retained lots/Parts, storage tables, evidence links or their command contracts. Match the original Capture screenshot/HTML hierarchy: batch/stage header, three evidence actions and grouped originals in the primary column, Batch settings and a Review entry point in the second. On narrow screens use one column with a clear heading/focus order. Latest field requirements override the prototype's field positions; preserve the approved light palette and truthful status rather than copying simulated behaviour.

Move manual subject create/edit, Part choice and per-lot exact quantity correction into Review through a focused editor using existing capture commands, with explicit revision, freeze and dirty protections. Review already owns subject inspection and restructuring; extend that owner rather than creating a hidden replacement Capture pane. Direct links from the settings override summary go to the pinned Review subject. Legacy `#batch/subject` entry points must route consistently to Review and preserve navigation guards. Decouple evidence upload/note/group state from removed queue-selected subjects; Write a note retains its evidence-note flow and group/Part location context remains explicit. The task's browser evidence must prove no lost manual-start workflow as well as absence of the two panes.

## State, authority and failure behavior

Additive versioned capture settings/context, note-current/tombstone records, assignment sources and new-record drafts coexist with old immutable command history. Keep exact PK/quantity strings, actor/target binding, expected revisions and payload-bound keys. Existing old snapshots and sealed approvals remain readable; never rewrite immutable migrations or approval bytes. Group/Part location, accepted inference, note removals and instruction updates must publish the existing stale-input/review events transactionally. Captured intent, accepted human choice, approved execution and confirmed inventory result remain distinct representations.

## Verification strategy

| Boundary | Evidence required |
| --- | --- |
| Controls and package fit | React 19/RHF tests and owned headless browser: keyboard, search races, IME, touch, disabled tooltip, Auto/None/Manual popover focus/Escape/return-focus and manual-area entry, manual tags + Auto, hide/remove, native date, 360/390px and real 200% browser zoom. |
| Autosave | Fake-time component tests for debounce/blur/composition/serialization and navigation; HTTP/PG tests for conflict, lost acknowledgement, exact retry, instructions interleaving, disconnect/reconnect and stale scope. |
| Search and drafts | Public-contract/HTTP tests for limits, permissions, fixed origins, pagination, ID/name matching, invalid parent, missing supplier role, stale responses and logo upload uncertainty. No live target needed. |
| Assignment and inference | PG/Processing/Review tests for precedence, conflicting groups, retained overrides, question fallback, human correction over stale output, new-Part tags and existing-Part exclusions. |
| New-record effects | Owned-fake PG/process tests for approval binding, duplicate/unknown creation, dependency attribution, cancellation, restart and known-output reuse. No synthetic result counts as real-target compatibility. |
| Compatibility | Old command/snapshot/input/approval fixtures still parse; migration/grants and restart verified against disposable databases, preserving history. |

Owning commands: root `pnpm typecheck`, `pnpm contracts:check`, `pnpm lint:frontend`, `pnpm lint:readability`, `pnpm test:frontend`, `pnpm test:intake`, `pnpm db:intake test`, `pnpm db:intake test:process` and `pnpm build`, plus formatting/Markdown checks. Use the configured owned disposable DB wrappers; do not migrate/reseed shared local data. Tests and live operation qualifications are separate.

## Migration, rollout and recovery

Introduce additive schema/contracts first with backward-compatible reads and feature gating. Preserve historical notes and contexts; map existing capture tags to manual intent with Auto false, retain chosen supplier/date modes, exact counts and per-lot override provenance. Existing absent fields stay absent/unknown rather than inventing data. Do not enable new UI until its server contracts and permissions are available. Roll out the revised panel only after end-to-end fake qualification. Rollback disables the new UI/write admission and keeps added retained data readable; do not drop data or reinterpret unknown external effects. Record how to resume original operations and inspect unsupported intents.

## Risks and open decisions

No blocking product question remains. Accepted assumptions and PO-preview limitation are explicit in the proposal. Risks: React Select adds a second styling runtime; new-record effects are larger than UI polish; group links can be ambiguous; autosave interacts with instruction and review revisions. Focused proof, layered delivery and adversarial tests are required. Real provider inference, target-specific write compatibility and general host containment remain unqualified; no proposal claims they have passed.
