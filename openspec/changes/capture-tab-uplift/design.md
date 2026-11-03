# Design assessment

## Context and grounding

The [proposal](proposal.md) and [settings](specs/capture-batch-settings/spec.md)/[evidence](specs/capture-grouped-evidence/spec.md) requirements define a cross-layer Capture uplift. Existing files are under `frontend/src/components/capture/`, `components/media/` and `components/operator/InstructionsPanel.tsx`; shared contracts are in `contracts/src/capture.ts`, `media.ts` and `operator-review.ts`. Retained group identity, moves, subject links and versioned group instructions already exist. Missing contracts include composite settings, new batch context, group rename/ungroup/bulk move and per-evidence notes.

## Goals and constraints

One visible Batch settings panel and an evidence-first grouped panel, with three top actions and original-style context. Preserve physical lots, original media, exact identifiers/quantities, explicit conflict handling, retained note provenance and approved light styling. The user resolved PO scope to visible disabled/greyed-out UI only. No provider inference or additional inventory effect kind is introduced.

## Decisions and alternatives

### Settings composition and human context

Add a `BatchSettingsPanel` within the Capture workspace rather than routing to defaults/title/note editors. Reuse RHF 7.91.0 and existing quantity/reference/note controls. Remove only the Shared details navigation buttons; retain physical-lot and Part editing navigation. Batch human-note entry may have a labelled subsection in this single panel and the prominent Write a note action focuses the same retained note composer rather than creating duplicate drafts.

Add one validated composite Capture command with loaded expected revision and payload-bound delivery key for title, quantity/location defaults, supplier/date/tag context and optional appended human note. Save the panel atomically in one owning transaction; sequential title/default/note saves were rejected because partial success would misrepresent one panel save. Keep initial form values tied to the loaded draft lifetime; background queries cannot reset them. Explicit save/discard remains, with conflict readback and exact retry intent outside RHF.

New context is human evidence, not an approved inventory fact. Use observed supplier-company references (validate supplier role and target context through existing mapped company observations), calendar-date strings and bounded tags. Preserve unset/unknown/clear/set and per-lot inherit/override modes as applicable; absence in old data means unset/inherit, never guessed. Tags follow current text limits/deduplication rules. A batch context read identifies effective value and provenance plus explicit overrides per lot. Surface that context in Review without silently altering existing new-Part supplier/tag execution choices. Unsupported propagation into stock effects remains unavailable and visibly described as capture context.

Keep the PO section always visible, disabled and greyed out, with readable explanatory text and semantic disabled attributes. Neither composite command nor input manifest gains active PO intent. Do not hide it merely because no supplier is selected, and do not implement a togglable feature flag that can accidentally enable creation.

### Placement experiment before final layout

Build comparable right-side and above-content compositions in an owned fixture using the same components/state model; do not create two production form instances. Compare the original Capture hierarchy, evidence viewport space, settings reachability, tab/focus order and draft retention at representative desktop, 360px, 390px and 200% zoom. Right-side placement is the starting hypothesis because it matches the original; above-content wins if evidence/settings usability and responsive flow are better. Record screenshots and a reasoned decision before the settings implementation is accepted. Use CSS reflow of one mounted form rather than a breakpoint-driven duplicate/remount.

### Group-first evidence using existing ownership

Compose top actions over named group sections plus an ungrouped section, using existing MediaEvidenceCard/viewer/crop/upload behavior. Take photos accepts supported camera/library images, Add document targets supported documents/PDF, and Write a note focuses the retained composer. Preserve current 20 MiB/JPEG/PNG/PDF limits, explicit retention and receipt handling; do not add a new upload widget framework or assert a pending original is readable/retained. If media is unavailable, show the unavailable actions and keep note entry available where editing is allowed.

Reuse existing group IDs and versioned group instructions. Extend media commands for label changes, bounded atomic multi-evidence move and ungroup. Ungroup clears current membership and retires the group from active presentation without deleting its identity/history or group instructions. Add versioned per-evidence human annotations; reuse existing group-instruction semantics for group notes rather than copying mutable text into an unrelated notes store. The read model returns current annotation/instruction versions with stable evidence/group identity, and Review/viewer shows them beside the correct source. Moving evidence does not move notes to a different evidence identity or remove subject links.

Add-to-group first retains an original through the existing uploader, then uses a separately acknowledged membership command. If retention succeeds and membership fails, clearly show the retained original in ungrouped with a retryable move; never reupload as a repair or claim both steps were atomic. A bulk move of already retained evidence is one transaction; reject duplicates, foreign/missing IDs or stale revisions before changing any row. Existing archive/frozen/currentness checks continue to apply.

### Interaction reuse and package preflight

Keep explicit checkbox selection, destination select and Move controls as a full keyboard/touch path. Prefer a narrow dnd-kit adapter for drag, with pointer/keyboard sensors and appropriate announcements; all input methods call the same validated move command and preserve selection on failure. No arbitrary sorting/reordering feature or drag-state authority is needed. Native HTML drag is a documented fallback, but it must retain equivalent move controls and pass browser/touch checks.

The [proposal's research](proposal.md#reuse-and-dependency-assessment) records source observed version 6.3.1, MIT/peer evidence and maintenance limits. Before relying on it, verify the exact published release/advisories/lock impact and exercise React 19.3.1, sensors, cancellation and scrolling in an owned fixture. This proposal installs nothing and claims no proof of runtime fit. A failed candidate is a prerequisite failure, not permission to ship inaccessible custom dragging; update the selected approach after equivalent proof.

## State, authority and failure behavior

PostgreSQL owns settings/context/annotation/group membership. Use existing loaded revision, authenticated actor/target/context, payload-bound command keys, command receipts and strict TypeBox validation; browser read labels never become authority. RHF and local selection/open state only own drafts and presentation. Keep pending upload/move/settings identities through failed acknowledgements; reconcile reads before deciding whether to retry the exact original request.

Context and group/note changes affect processing input/proposal currency and review/preparation dependencies. Materialize current context records as explicitly labelled untrusted human-context notes carrying retained record IDs, actors and versions in the existing processing note shape; this preserves frozen input schemas and original bytes. Bind the same records into review fact digests. Extend dependency materialization to include the exact retained versions; invalidate affected previous proposals/preparations rather than marking their bytes current. This does not relaunch inference automatically. Do not change already retained approval/operation bytes or broaden an approval's subject scope. Any supported group mutation must check the same current-editability boundary in its transaction, not solely in UI disabled state.

One coordinated dirty registry covers settings, lot/Part editor, group/evidence notes and pending uploads/crops. Allow one active mutating draft at a time unless all participating loaded revisions are explicitly coordinated; visible other controls remain readable and explain why editing is temporarily unavailable. The global save/discard guard protects navigation. Polling and responsive reflow preserve the mounted draft, current focus and exact strings. Grouping never combines lots, and media notes/links never choose attachments or approve effects.

## Verification strategy

- Contract/server regressions: composite save all-or-nothing; exact quantity/PK/date modes; supplier observation role/context; bounded tags; no PO intent; archive/frozen guards; repeated exact keys and conflicting payload refusal.
- PostgreSQL tests: additive context roundtrip, explicit overrides, group rename/retirement/history, multi-move rollback, foreign group refusal, annotation versions and stale preparation/processing input after relevant edits. Use real owned PG transactions, not mocks that bypass them.
- Frontend regressions: single panel/no Shared details buttons; disabled PO UI; draft conflicts/uncertain receipts/reflow; top3 actions; grouped rendering/notes and selection; media-disabled/unsupported/retained-but-unmoved cases; keyboard and touch move equivalence.
- Browser evidence: both layout candidates, chosen rationale, desktop/360px/390px/200% zoom, keyboard/focus/order, camera/library chooser fallback, group drag and alternate controls, viewer/Review notes and refresh. Synthetic media/owned previews only; browser screenshots do not prove backend containment or real decoding/provider execution.
- Future owning commands: `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm typecheck`, focused frontend/contract/server tests, `pnpm test:intake:pg`, affected `pnpm test:intake:process`, `pnpm lint:frontend`, `pnpm lint:readability`, `pnpm build` and required formatting checks. Proposal validation is separate from these future application checks.

## Migration, rollout and recovery

Use additive versioned migrations for batch/per-lot capture context and per-evidence annotation history, extending existing group tables/commands rather than replacing media identities. Preserve old data with unset/inherit defaults and no invented supplier/date/tags. Generate contracts and update readers/manifest builders together, then add UI consumers after foundations merge. Version write contracts where needed so incompatible older tabs cannot omit newly required concurrency/currency checks; the existing update-required flow is the fallback.

Back up only owned fixture data for migration qualification and exercise upgrade/readback plus consumer rollback. Roll back consumers before removing new API support; retain new rows/history and original bytes rather than destructive down-migration. Retained historical plans remain immutable. No real data migration, target writes or deployment is authorized by this planning work.

## Risks and open decisions

Main risks: treating contextual supplier/tags as execution choices, partial settings saves, losing group history on ungroup, breaking input/preparation currentness, or resetting drafts when panels move. Explicit contracts and boundary tests address them. Final layout and exact drag dependency are bounded implementation experiments with recorded decisions before their consumers ship. PO scope is resolved; no additional user decision is required to complete planning. Runtime proof remains future work.

## Implementation dependency refresh

The Task 4 preflight on 2026-11-03 found that official documentation now labels `@dnd-kit/core` legacy. The [current React adapter](https://dndkit.com/react/quickstart/) explicitly supports React 18/19; exact React/DOM 0.5.3 packages were selected instead, with eight additional locked packages and no added advisory IDs against the current baseline. Its pre-1.0 API is an accepted maintenance cost, contained by the small adapter and exact pins. The legacy candidate was not installed. Owned React 19.3.1/StrictMode browser proof passed pointer/keyboard/touch, Escape cancellation and real auto-scrolling, with stable identity and neighbouring draft. The [qualification record](../../../docs/bench-intake/evidence/grouped-evidence/README.md) distinguishes this package proof from subsequent retained UI/transaction integration. This refresh changes the dependency choice, not feature or authority scope.
