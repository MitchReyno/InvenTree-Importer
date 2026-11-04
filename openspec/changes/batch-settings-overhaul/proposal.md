# Change proposal

## Problem and intended outcome

Batch settings exposes internal selection modes, record-ID reads and explicit save controls. Replace these with concise, searchable inputs, optional notes and truthful autosave while preserving retained drafts, exact identities, review and approval. Quantity should be proposed from evidence and inference, then reviewed; when there is no defensible estimate, ask the operator.

## Change identity and linked items

Canonical name: `batch-settings-overhaul`; linked [BI-003](../../../docs/PLANNED_FUNCTIONALITY.md#bi-003--batch-settings-overhaul). Delivering branches contain this name and subjects use `type(batch-settings-overhaul): description`. The index owns current metadata. [Automatic supplier logos](../automatic-supplier-logos/) and [purchase-order support](../purchase-order-support/) are separate brief placeholders, not implementation prerequisites.

## Current behavior and evidence

- `frontend/src/components/capture/BatchSettingsPanel.tsx` uses React Hook Form and one explicit settings save, with quantity/location modes, appended notes and separate disabled PO controls. `CaptureContextFields.tsx` adds supplier-by-ID, date modes and capture-only tags; `ReferenceField.tsx` requires an ID read before selection.
- `contracts/src/capture.ts` and `intake-server/src/capture/` retain transactional settings, exact references, immutable notes/context and revisions. `CaptureQueue.tsx` renders the Physical lots and Part proposals panes; `CaptureWorkspace.tsx` currently uses a three-column queue/evidence/settings grid with a subject editor below. Existing location defaults apply to physical lots; evidence groups and shared Parts do not currently own location defaults.
- `frontend/src/components/operations/LiveUpdates.tsx` and `intake-server/src/live/` already provide scoped WebSocket invalidation with HTTP reads and fallback polling. HTTP commands own revisions, idempotency and acknowledgement. Socket freshness and target reachability are separate observations.
- `intake-server/src/inventory/transport.ts` supports fixed-target semantic reads, not searchable catalogue lists or location/company creation. The supervised executor remains owned-fake qualified; real inventory mutations and live inference remain unqualified. New create forms cannot be presented as existing capability.
- The synced `capture-batch-settings` baseline requires explicit save/discard and disabled PO fields. This change explicitly modifies that contract, preserving other capabilities and archived implementation evidence.

## Scope and non-goals

Use the [original Capture screenshot](../../../docs/bench-intake/reference/03-capture.png) and [HTML Capture composition](../../../docs/bench-intake/reference/bench-intake.html) as the default: evidence actions/groups form the primary left column and Batch settings the right column, with a single-column narrow reflow. Remove the Physical lots and Part proposals panes from Capture, including their persistent queue/editor chrome. Retain the approved light/neutral palette and real contracts; the mockup's dark mode, simulated status, inactive known-part input and fake links are not copied as behaviour. Explicit changes in this request override the mockup's older field arrangement.

| Area | Intended behaviour |
| --- | --- |
| Title and batch notes | Small Add batch notes button below title reveals optional multiline batch notes. Hide preserves content; Remove clears current content through an attributable revision. |
| Quantity | Remove Quantity mode from Batch settings. Evidence-derived, labelled estimates stay proposals; human Review can correct exact per-lot quantities. No defensible estimate produces a question, never a guessed executable count. |
| Default location | One fuzzy-searchable, single-selection input. Explicit lot/part/group assignments precede the batch fallback; no automatic stock splitting. Offer New location with required name, optional description and searchable optional existing parent. |
| Supplier | Fuzzy-searchable single selection or new-supplier draft with name, optional logo, description and Also set as manufacturer. No supplier disables the picker. Find automatically is disabled with a keyboard-accessible coming-soon tooltip. |
| PO and order context | Disabled Create a purchase order directly below supplier. Prepare Auto/None/manual order-receipt number, Auto/None/manual calendar purchase date and optional order notes; Auto is the new-field default. Preserve a disabled, expandable preview of these future fields. No active PO intent or execution. |
| Tags and instructions | Shared part tags accepts manual tags plus independent Auto toggle; either or both are valid. Rename Batch instructions to Custom instructions. Preserve manual intent and proposal provenance. |
| Persistence | Valid edits autosave to the app, with visible saving/saved/error/conflict states. Grey out controls when the scoped app connection is unavailable; preserve drafts and uncertainty. Reuse HTTP commands and the existing socket for invalidation. |

This request authorizes planning only. It does not authorize implementation, provider calls or real inventory changes. Proposed location/supplier creation is staged as reviewed intent for supervised execution, never an external write on typing/autosave. PO execution, automatic logo discovery, arbitrary existing-Part tag replacement and a general offline editor are excluded.

## Reuse and dependency assessment

Sources checked 2026-11-04; package inspection is not integration proof.

| Option and version | Fit and strengths | Limits, cost and recommendation | Primary evidence / proof remaining |
| --- | --- | --- | --- |
| Existing RHF 7.91.0, TanStack Query 5.105.1, Radix Popover 1.3.1 and styled-components 6.6.0 | Keep form/read ownership and visual language; reuse native text/date controls and existing notes/instructions. Radix Popover hosts the Auto/None/Manual dropdowns with a dedicated manual-input area; React Select is not used for them. | Installed stack; MIT packages. Query serialization alone does not own revisions or uncertain acknowledgements. Retain the domain command owner; do not enable automatic mutation replay. | `frontend/package.json`, existing tests, [Query mutation guidance](https://tanstack.com/query/latest/docs/framework/react/guides/mutations). |
| React Select 5.10.2 | Searchable async/creatable selections and tag entry, controlled TypeScript values and React 19 peer support. Prefer a small reusable adapter to custom combobox keyboard policy. | MIT; adds Emotion, floating-ui and transition dependencies to a styled-components app. Exact pin, lockfile/advisory delta and accessible React 19 proof required before production adoption; no dependency installed by this proposal. | [Manifest](https://github.com/JedWatson/react-select/blob/master/packages/react-select/package.json), [usage](https://github.com/JedWatson/react-select#readme), [license](https://github.com/JedWatson/react-select/blob/master/LICENSE). |
| Fuse.js 7.1.0 alongside the picker adapter | Typo-tolerant scoring with weighted fields; framework-independent and no runtime dependencies. Recommend for name-first fuzzy ranking, keeping exact name/ID tiers ahead of scored matches. | Apache-2.0; additional package/index cost, bounded candidate retrieval and threshold calibration required. It cannot recover records excluded by upstream strict text filtering. Pin and qualify the version before adoption; do not silently adopt the current prerelease. | [Versioned manifest](https://github.com/krisk/Fuse/blob/v7.1.0/package.json), [configuration](https://github.com/krisk/Fuse/blob/v7.1.0/src/core/config.js), [license](https://github.com/krisk/Fuse/blob/v7.1.0/LICENSE), checked 2026-11-04. |
| Custom searchable picker on existing Radix primitives | Avoids added styling dependencies and permits narrow composition. | Requires implementing and maintaining combobox/listbox focus, announcements, async races and mobile selection. Reject as first choice because these are substantial standard interaction behaviours; use only if the scoped package proof fails and record the reason. | Existing popover implementation is disclosure evidence, not combobox qualification. |
| HTTP commands + shared WebSocket hints versus socket writes | Existing split retains transactional HTTP acknowledgements and live reads. | Socket commands need new correlation, CSRF/auth, backpressure, deduplication and reconnect uncertainty contracts without a demonstrated benefit for low-frequency settings edits. Keep current split; no additional socket/client library. | `LiveUpdates.tsx`, `intake-server/src/live/routes.ts`, scoped retained command tests. |

Official InvenTree [location schema](https://docs.inventree.org/en/latest/api/schema/stock/) and [company schema](https://docs.inventree.org/en/latest/api/schema/company/) document search and creation. These are feasibility evidence, not proof against the configured target/version. Name-first fuzzy ranking belongs in the app; React Select's [default filter](https://github.com/JedWatson/react-select/blob/master/packages/react-select/src/filters.ts) only normalizes case/accents and matches substrings, so it does not supply typo tolerance. Apply fuzzy matching to a bounded scoped catalogue candidate set, not only results already filtered by a misspelled upstream search; disclose incomplete coverage and never infer record absence. Numeric exact-ID lookup remains separate and exact. Existing detail reads can supplement search using existing detail reads rather than promising that upstream text search matches IDs. Bounded public adapter tests must cover pagination, parent identity and supplier/manufacturer flags. Business policy, scope, effect attribution and safe recovery remain custom domain responsibilities.

## Capabilities

### New capabilities

- `capture-reference-selection`: bounded searchable reference selection, new location/supplier intents and deterministic location precedence.
- `capture-inference-preferences`: reviewable quantity estimates, Auto/None/manual order context and shared manual/automatic Part-tag intent.

### Modified capabilities

- `capture-batch-settings`: simplified panel, optional notes, connected autosave and prepared disabled PO controls. Existing grouped-evidence and header requirements remain unchanged.

## Impact and dependencies

Affected owners: frontend capture/UI forms and dirty navigation; contracts/public generated client; server capture/read/processing/review; supervised execution for new location/company effects; additive database migrations and fake-target qualification. Existing immutable approval/input formats must remain readable. Preserve original evidence, lots, overrides and historical notes; no automatic migration of evidence labels to exact counts or human selections.

The default location requires new attributable part/group assignment support, not a multi-value default. Shared Part tags must reach the existing reviewed new-Part path; applying them to an existing Part needs separately approved semantics and is outside this change. New location/company effects require a versioned supervised profile with fake qualification before controls can claim execution availability. Preparation fields do not depend on future PO or logo implementation.

## Open decisions and assumptions

Manual lot/Part create/edit, exact quantity correction and existing-Part choice remain reachable in Review using the existing scoped capture commands; Capture evidence selection is independent of queue selection. Legacy subject links resolve to the corresponding Review subject with existing dirty-navigation protection, rather than opening a replacement persistent Capture pane.

No further blocking product questions identified. Routine assumptions for review:

- Add batch notes means batch-level notes; Add order notes is a separate order-scoped field. Hide is presentation-only and Remove retires current text without erasing history.
- Location precedence is explicit physical lot, then shared Part, then an applicable evidence-group assignment, then batch default. Conflicting applicable group locations require resolution; they are never chosen arbitrarily.
- Active connection means a fresh, authenticated/scoped application API connection. A healthy HTTP fallback remains editable if the socket drops. Target failure disables catalogue reads/creation availability, not otherwise healthy app-local edits.
- Auto order/date means evidence extraction with review, not a random reference or today's date. Auto tags starts unchecked for migrated data; new batches also start unchecked, avoiding unrequested inference. Auto number/date never replaces retained explicit manual values.
- Because PO stays disabled, its dependent future inputs are read-only in an expandable preview. The future PO change owns enabling the checkbox and conditional editable form; current supplier, batch notes, tags and custom instructions remain usable.
