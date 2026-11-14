# Change proposal

## Problem and intended outcome

Capture fragments batch settings behind Shared details navigation buttons, while the evidence panel lacks the original mockup's prominent entry actions and grouped composition. Consolidate settings into one Batch settings panel and make evidence capture/group context easier to use without weakening retained identity or draft protection. Compare right-side and above-content settings placement before selecting the final responsive layout.

## Change identity and linked items

Canonical name: `capture-tab-uplift`; linked [BI-001](../../../../docs/PLANNED_FUNCTIONALITY.md#bi-001--capture-tab-uplift). The index owns mutable metadata. Branches retain the exact name, for example `feat/capture-tab-uplift-settings`; subjects use `feat(capture-tab-uplift): …`. This plan does not implement or release the feature.

## Current behavior and evidence

`CaptureQueue.tsx` exposes Batch defaults, Batch title and Write a human note under Shared details. `CaptureEditor.tsx` already uses React Hook Form with explicit saves and fixed loaded defaults; `CaptureWorkspace.tsx` and App own dirty-navigation/revision behavior. `EvidencePanel.tsx` embeds human notes and MediaWorkspace, whose MediaUpload retains originals/keys/receipts and whose MediaEvidenceRelations already creates groups, moves single evidence and links subjects.

`contracts/src/media.ts` and migrations `0005_media.sql`/`0008_operator_review.sql` already retain group identity and group instructions. They do not expose rename/ungroup/bulk move or per-evidence notes. `CaptureDefaults` currently contains only quantity/location; supplier, purchase date and batch tags need explicit retained context contracts rather than ornamental unsaved inputs. Existing Part supplier/tags in `effects.ts` are distinct execution choices, not equivalent batch settings.

The [original Capture](../../../../docs/bench-intake/reference/03-capture.png), [interactive HTML](../../../../docs/bench-intake/reference/bench-intake.html) and [provenance/limits](../../../../docs/bench-intake/reference/README.md) are primary visual references. Main `openspec/specs/` contains no capability definitions yet. Prototype simulated operations do not override current authority.

## Scope and non-goals

One visible Batch settings panel replaces the Shared details navigation buttons and contains title, defaults, batch human-note entry, supplier, purchase date, storage location, tags, inheritance explanations and visible item overrides. Preserve existing quantity/default controls as well as the mockup elements. Existing lot/Part editors remain focused subject editors; this does not combine physical lots.

Add prominent Take photos, Add document and Write a note actions above grouped evidence. Include group creation/rename/notes, per-evidence notes, add-to-group, ungroup, selection/move and drag interactions with keyboard/touch equivalents, retaining the ungrouped area and evidence-to-subject links.

**User decision:** include the mockup's purchase-order fields/components, visibly disabled and greyed out with an explanation that PO creation is not yet available. They must produce no PO commands, payload fields or effects. Supplier/date/tags in this uplift are retained human capture context with per-lot inheritance/overrides, visibly distinguished from approved inventory effects. Existing Part supplier/tag choices remain authoritative only through their existing review/approval workflow; this change does not automatically propagate context into inventory mutations.

No new execution effect kinds, provider inference, automatic stock/Part/PO creation, autosave, original-byte replacement or redesign of other tabs is included. Header signalling is a separate change with no required ordering.

## Reuse and dependency assessment

Checked 2026-11-03: frontend manifests/lockfile pin React 19.3.1, React Hook Form 7.91.0, TanStack Query 5.105.1 and styled-components 6.6.0. Current form/upload/group/instruction components supply most policy. No drag library is declared.

| Option | Fit and strengths | Limitations / adoption cost / decision | Primary evidence and proof still needed |
| ------ | ----------------- | ------------------------------------- | -------------------------------------- |
| Existing RHF, query/media/group/instruction components | Already preserve drafts, exact revision/key ownership and retained originals; lowest migration cost | Recommended foundation. RHF manages fields, not transaction/approval authority; shared panel needs an explicit composite command rather than sequential saves | [RHF useForm](https://react-hook-form.com/docs/useform), [MIT source manifest](https://github.com/react-hook-form/react-hook-form/blob/master/package.json), plus repository source. Installed 7.91.0 supports React 19 peers; exercise actual combined-form conflicts |
| dnd-kit core | Multiple containers and pointer/touch/keyboard sensors fit group moves; accessibility helpers avoid bespoke sensor machinery | Recommended narrow drag adapter after preflight. MIT; source observed 6.3.1, React peer >=16.8, extra accessibility/utilities dependencies. Requires selected-version maintenance/security check, compatible sensors, announcements and cancellation integration; no sortable framework needed just to move groups | [Official repository](https://github.com/clauderic/dnd-kit), [manifest](https://github.com/clauderic/dnd-kit/blob/master/packages/core/package.json). Docs site was unavailable during research; source was inspected. Exact published pin and React 19.3.1/touch integration remain implementation proof |
| Native HTML drag plus explicit move controls | No package; desktop drag and existing select/buttons can share one command | Viable fallback, but native drag alone does not deliver complete keyboard/touch UX; custom interaction/testing burden is higher. Do not claim HTML drag makes accessible movement automatic | [Browser drag API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API). Browser-specific behavior must be measured |
| Full upload/form/design framework replacement | Could supply broad widgets | Reject: existing retained uploader and form stack already own important semantics. A framework migration adds lock-in and may lose exact retry/receipt/draft behavior without solving domain policy | Existing MediaUpload/CaptureEditor and manifests; no new uploader framework is justified |

Keep existing ownership and introduce only a qualified drag primitive if it reduces the interaction burden. Pin a verified published version and record advisory/license/lockfile evidence during the focused implementation preflight; no package is installed by this planning change. Application code must continue owning revision conflicts, evidence/lot identity, grouped commands and approval boundaries.

## Capabilities

### New capabilities

- `capture-batch-settings`: consolidated retained batch context, visible inheritance/overrides, disabled PO affordances and layout comparison.
- `capture-grouped-evidence`: three top evidence actions and durable group/note/movement behavior with equivalent input methods.

### Modified capabilities

None; no existing main OpenSpec capability paths are present. Behavioral delta specs are required.

## Impact and dependencies

Frontend Capture/media/operator instruction composition; shared TypeBox/OpenAPI contracts; server Capture/media context commands and read projections; additive PostgreSQL state for new context/notes/group lifecycle. Reuse existing group and original-evidence tables and source/subject identity. Review must display context/override provenance without treating it as approval. Existing target observations/mappings support location/supplier references; browser strings do not become trusted target IDs.

No dependency on BI-002. Existing media limits, decoding, preview authorization, archived/frozen protection and fake-only execution restrictions remain. Context schema changes must participate in review/input freshness so old approvals/processing snapshots cannot silently claim current context.

## Open decisions and assumptions

PO scope is resolved: disabled UI only. Assume supplier/date/tags are human capture context, not new inventory execution effects; label this limitation visibly. Final panel placement is deliberately selected by the planned right-versus-top experiment with retained evidence, not fixed prematurely. Drag-library proof and exact release selection are explicit preflight work. No further product-scope question blocks proposal completion.
