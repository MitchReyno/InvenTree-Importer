# Batch settings overhaul implementation

Maintained implementation handover for [`batch-settings-overhaul`](../../openspec/changes/batch-settings-overhaul/) ([BI-003](../PLANNED_FUNCTIONALITY.md#bi-003--batch-settings-overhaul)). Status: PR-A (Tasks 1–2) merged into `interactive-app` as #85. PR-B (Tasks 3, 4 and 9) merged as #87. PR-C (Tasks 5 and 6) is open as #88 from `feat/batch-settings-overhaul-review`; its review is clean and its selected CI passed, so Task 6.5 is checked and the PR is ready to squash-merge. PR-D has not started. Reviews, CI and merges are recorded only after they occur.

## Authority and boundaries

Mitch authorized implementation of the whole change through its four planned PR bundles, including the normal PR workflow and squash-merge into `interactive-app` after clear independent review and green selected CI. No live provider call, real InvenTree request or mutation, or change to real local data is authorized. Qualification uses owned disposable PostgreSQL databases, controlled fake HTTP targets and synthetic content. PO creation and automatic logo discovery stay disabled placeholders.

Planning reconciliation (first PR-A commit): Auto/None/Manual fields use Radix Popover dropdowns with a dedicated manual-input area inside the popover; React Select is reserved for the searchable supplier, Default location and parent-location pickers. Design, proposal, the PO spec requirement and Task 3 now say so; strict change validation passed.

Toolchain: the shell default Node 22/pnpm 8 do not satisfy the repository pins. Commands run with the nvm-installed Node 24.22.2 (matching `.node-version`) and pnpm 12.16.1. `pnpm install --frozen-lockfile` changed no lockfile.

## PR-A plan: retained intent model (Task 1)

### Baseline (1.1)

Current authority: `settings` edits write title, quantity/location default selections, one batch-level `capture_context` version (supplier observation, purchase date, tags as unset/unknown/clear/set selections) and an optional appended immutable note. Per-lot `CaptureLotContext` adds `inherit`. Processing and Review consume context through `capture/context-input.ts` (labelled human context notes) and fact digests; nothing in context becomes an effect. Snapshots omit `context` when absent, keeping old bytes.

Baseline fixtures: a legacy-command batch (settings with supplier/date/tags, lot override, appended note) is created through the current public repository in a PG regression, and its complete snapshot is compared after the new code is in place. A static legacy snapshot fixture in contracts must keep validating and must map to intent deterministically.

### Additive format

New pure module `contracts/src/capture-intent.ts` owns the DTOs and the legacy mapping, shared by browser and server:

| Record | Shape | Notes |
| --- | --- | --- |
| `CaptureSettingsIntent` | `supplier {absent, selection: unset \| existing(company ref) \| draft(draft_id)}`, `order {reference, purchase_date}` as Auto/None/Manual values, `shared_tags {manual[], auto}` | Versioned by batch revision; only a supplier-role company observation can be `existing` |
| Setting notes | `batch` and `order` scopes, current text or `null` tombstone | Append-only; Remove writes a `null` version, history stays readable; Hide is UI-only |
| Reference drafts | stable client `draft_id`; `location {name, description, parent}` or `company {name, description, also_manufacturer, logo}` | Append-only versions; kind fixed per draft by an identity row; absent from a complete save means retired |

Edits use a new complete-state `batch_settings` change: title, `default_location` (existing ref/clear/unset or a location draft), intent, notes and the active draft set. The server writes only what differs from current retained state, then bumps the revision once under the existing batch lock, payload-bound idempotency and expected-revision check. Old `settings`/`defaults` kinds stay accepted; a legacy `settings.context` write after an intent exists is refused with `settings_intent_superseded` so two authorities cannot diverge.

Each intent change also writes the derived batch-level legacy `capture_context` row, so Processing, Review fingerprints and lot inheritance keep their existing inputs:

| Intent | Derived legacy selection |
| --- | --- |
| supplier absent / existing / draft / unset | clear / set(ref) / unknown / unset |
| purchase date manual / none / auto | set / clear / unset |
| manual tags non-empty / empty | set / unset |

Read-time mapping when no intent exists: legacy set → manual or existing; clear → none or absent; unset and unknown → auto (unresolved Auto is unknown for review, so legacy unknown keeps that meaning). Tags map to manual with Auto off. Nothing is rewritten in the database.

Migration `0014_capture_settings_intent.sql` adds `capture_settings_intent`, `capture_setting_note`, `capture_reference_draft_identity` and `capture_reference_draft`, all append-only through `reject_authority_change()`. Drafts carry logo `(batch_id, evidence_id, version_id)` columns with a composite FK to `media_version`, so a logo is proved same-batch retained media without capture reading media internals beyond `media_type`. Grants extend `grantCapture`/`grantCaptureRead`. Snapshot fields `settings_intent`, `setting_notes` and `reference_drafts` are omitted when absent.

Limits: manual order reference 1–128 characters; notes 1–8192; at most 16 active drafts; draft names 1–100 and descriptions up to 250 characters; logo media must be an original or derived PNG/JPEG.

Deferred to their owning tasks: Part/group location assignment models (Task 5), Processing consumption of batch/order notes and Auto tag/quantity inference (Task 6), and draft execution (Task 7). This task's "assignment provenance" is the actor/version provenance of retained intent, notes and drafts.

### Verification

RED first: contract tests reject the new change until DTOs exist; PG tests for intent round-trip, distinct batch/order notes, Remove history, legacy tag mapping with Auto off, draft kind immutability, foreign/non-supplier references, archived refusal and restart. Then `pnpm typecheck`, `pnpm contracts:check`, `pnpm test:intake`, targeted and full `pnpm db:intake test`.

### Task 1 results

- RED: `contracts/tests/capture-intent.test.ts` failed to load before `capture-intent.ts` existed; the PG regressions in `tests/pg/capture-intent.test.ts` could not run before the migration and owner module.
- GREEN: contracts 11/11 for intent and existing settings tests; PG 4/4 new tests (restricted runtime role) plus the existing capture/settings PG files 7/7.
- Negative control: disabling only the `settings_intent_superseded` guard made exactly the divergence regression fail; the source was restored from a pre-mutation backup and its SHA-256 matched.
- Upgrade: a legacy batch written directly under migrations ≤0013 reads after 0014 with exactly the pre-0014 snapshot field set and its legacy context/quantity values unchanged, maps to intent, accepts a location draft with an observed parent, survives a reopened pool and keeps revision digests unchanged; DELETE on every new table fails with `23000`.
- Whole workspace: `pnpm typecheck`, `pnpm contracts:check`, `pnpm lint:readability`, `pnpm test:intake` (contracts 48, server 160) and `pnpm test:frontend` (184) passed.
- Full PG tier first ran 124/136 passing with 4 environmental failures (no `docker` on PATH for operations dump/restore, missing `INTAKE_MEDIA_DECODER_IMAGE`) and 8 decoder-gated skips. With Docker's bundled CLI on PATH and the newest retained immutable decoder image `sha256:9f3d6918…cfcf59`, the inbox, operations and processing-media files passed 8/8. No decoder source changed on this branch. The full tier is rerun with that environment before review.

Limitations: logo media is any same-batch retained PNG/JPEG evidence version, so a logo upload also appears as evidence until PR-B/PR-D give it a dedicated upload path. Older frontend builds fail closed on the new snapshot fields and need reload, as with earlier additive fields.

## PR-A plan: bounded catalogue search (Task 2)

### Target shapes (2.1)

Checked against versioned InvenTree source at tag `1.5.0` (`INVENTREE_API_VERSION = 530`, matching the inspected local image), not latest documentation. Files were fetched read-only into a job scratch directory; no InvenTree server was contacted.

| Model | List endpoint and filters | Fields admitted by the adapter |
| --- | --- | --- |
| Location | `GET /api/stock/location/`; `search` over `name, description, pathstring, tags`; default ordering by tree | `pk`, `name`, `description`, `pathstring`, `parent`, `structural` |
| Supplier | `GET /api/company/?is_supplier=true`; `search` over `name, description, website, tax_id`; ordering `name` | `pk`, `name`, `description`, `is_supplier`, `is_manufacturer` |

The REST settings use `LimitOffsetPagination` with no default page size. A list request without `limit` returns the entire unpaginated catalogue, so the adapter always sends `limit` and `offset` and accepts only the paginated `{count, next, previous, results}` envelope. Upstream `next`/`previous` URLs are never followed; the next request is rebuilt from a validated offset against the fixed origin. Redirects are already refused by the transport.

### Policy

- Two scoped read routes per model (`location`, `supplier`), both authorizing the batch (actor/target/context, not archived) before any target traffic and fencing the current target context before and after reads:
  - **Search** sends the strict upstream `search` for the query (one page of at most 50) and, for a numeric query, an exact detail read by ID. A missing ID is `not_found`, not an error. A company returned without the supplier role invalidates the response.
  - **Candidates** reads up to 500 records by name, in pages of 100, with no search filter. This bounded snapshot is the fuzzy-matching source, independent of strict upstream filtering; `truncated` and `total` disclose partial coverage.
- Tiers: exact ID, then exact name, then name matches, then approximate (fuzzy) suggestions. Fuzzy scoring is applied in the browser over search results plus the snapshot, deduplicated by exact PK (Task 3). The server never fuzzy-substitutes an ID.
- Bounds: query 1–100 characters without control characters; offset at most 10,000; 512 KiB per page body and the transport's 5-second deadline per request; 15 seconds total for a snapshot; at most two concurrent catalogue reads per server process, otherwise `catalogue_busy` (429).
- Failures: any transport error, non-2xx, malformed JSON, missing/invalid field or count is `catalogue_unavailable` (503). An HTTP 200 with an invalid body is never a usable result. Empty `results` means no matches in the searched set, reported with its coverage, never absence from the catalogue.
- Selection binds through the existing `observations` command, which performs the final detail read and retains the observation; search results are not observations.

### Task 2 results

- RED: `tests/catalogue.test.ts` failed to load before `capture/catalogue.ts` existed; generated client and route paths did not exist.
- GREEN: reader/transport fast tests 7/7 (bounded strict search, ambiguous names kept distinct by PK/path, numeric exact ID with `not_found` and missing supplier role, a 620-record catalogue snapshot capped at 500 with truncation and a typo record absent from strict search, twelve invalid HTTP 200/denied bodies, query bounds and the two-read concurrency limit, stalled/oversized body cancellation, fixed transport paths); contracts client 2/2; HTTP/PG 2/2 against a controlled loopback target with a restricted role.
- HTTP/PG covers authorization before traffic (unknown batch, bad model, over-long or control-character query, missing query, archived, unconfigured target: zero target requests), redirect, 500 and unpaginated bodies as unavailable with the redirect sink never reached, upstream `next` links never followed, a target-context rotation during a read (409) and the refusal of the next read before traffic, and final selection through the observation command.
- Negative control: removing only the post-read context fence made the HTTP/PG rotation case fail; the route file was restored from backup with a matching SHA-256.
- The location model has no supplier-like role flag; `structural` locations are returned with that flag for the picker to label, not filtered.

### PR-A tier results and independent review

Full tiers on `bd4c751` content with Docker's bundled CLI on PATH and decoder image `sha256:9f3d6918…cfcf59`: PostgreSQL 138/138 with no skips; process 36/40 with the four unchanged test-only `INTAKE_MEDIA_PROBE_IMAGE` kernel-probe gates skipped (the same gate earlier PRs retained).

A Claude review subagent was stopped by Mitch before reporting; independent reviews now use Codex (`gpt-6.1-sol`, read-only sandbox). Codex reviewed exactly `origin/interactive-app..bd4c751a13c1e9baf377f20613c05016a60b5a6d` and found:

1. Important: a title-only `batch_settings` save rederived every legacy field, collapsing retained `unknown` supplier/date and `clear` tags to `unset`. Fixed with the pure `nextLegacyContext`, which rederives only fields whose intent changed. Contract and PG regressions cover a title-only save (no new legacy version) and a tags-only change (supplier/date stay `unknown`).
2. Minor: `strictJson` kept its 256 KiB default below the advertised 512 KiB page limit. The parser now receives the page limit; a ~400 KB valid page regression fails with the old default (negative control, restored by SHA-256) and passes now.
3. Minor: the snapshot deadline was checked only before each page. Each page body read now receives only the remaining budget and the deadline is rechecked after every page; an injected-clock regression with four 4-second pages is refused.
4. Minor: the handover overclaimed byte-identical upgrade snapshots. The upgrade regression now asserts the exact pre-0014 field set and the claim is narrowed to that plus unchanged legacy values.

Codex found no issues in append-only/FK enforcement, draft identity/retirement, reference validation, revision/idempotency, grants, authorization/context fences, pagination URL handling, concurrency cleanup or write-capability isolation. After the fixes: affected PG 13/13. The corrected candidate needs a fresh Codex review before publication.

Full PostgreSQL tier on `164e761`: 139/139, no skips.

Codex re-review of exactly `origin/interactive-app..164e761ca37825d200a84f6e9f12d56f00fc97aa` confirmed the parser-limit and upgrade-claim fixes and found two remaining issues:

1. Important: the legacy comparison used `JSON.stringify`, so unchanged intent sent with reordered keys still rederived a field and could erase a retained `unknown`. `nextLegacyContext` now uses key-order-independent structural equality. Contract and PG regressions send reordered keys; the contract regression fails with the old comparison (negative control, restored by SHA-256).
2. Minor: the snapshot budget excluded waiting for response headers, so a read could run to about 20 seconds. The transport `list` now accepts a caller timeout that may only shorten its 5-second deadline (integer 1–5000, otherwise refused), and each snapshot request and body read receives only the remaining budget. The injected-clock regression now proves refusal by 15,000 ms with request timeouts `[5000, 5000, 5000, 3]`.

After these fixes the affected PG files pass.

Codex third review of exactly `origin/interactive-app..72f2e6e76b4dd2d63b595a2c5f5043f0878944d6` (base `7456166`) found no issues in Tasks 1–2, tests, documentation or checkboxes and confirmed both round-two fixes; its 17 targeted tests passed.

Selected CI for [#85](https://github.com/MitchReyno/InvenTree-Importer/pull/85) on `72f2e6e` (run 41806847936) passed: Changed paths, Lint / Markdown, Lint / TypeScript, Test / Frontend, Test / Intake contracts and HTTP, and Test / Intake PostgreSQL and process. Backend lint/test and shared workflow sync were skipped by path selection. This commit adds only this record, the task 2.5 checkbox and the repository `.nvmrc` (the same Node 24.22.2 pin as `.node-version`); `git range-diff` shows the reviewed patches unchanged.

## PR-B plan: inputs, autosave panel and Capture layout (Tasks 3, 4, 9)

Branch `feat/batch-settings-overhaul-panel` was started on PR-A's reviewed head while [#85](https://github.com/MitchReyno/InvenTree-Importer/pull/85) awaited merge; it is rebased onto `interactive-app` once #85 merges and its PR always targets `interactive-app`.

### Package proof (3.1)

The proof ran in a disposable harness outside the repository before anything was installed here.

- `react-select` 5.10.2: MIT; peers React 16.8–19 declared; runtime dependencies are Emotion (`@emotion/react`, `@emotion/cache`), `@floating-ui/dom`, `react-transition-group`, `memoize-one`, `prop-types` and `use-isomorphic-layout-effect`. Its last release was 2025-07-11, a maintenance risk to watch. Emotion is a second styling runtime; it is contained in `SearchableReferencePicker` through one `styles` adapter, and no animated components are used.
- `fuse.js` 7.1.0: Apache-2.0 with no runtime dependencies. Stable 7.5.0 exists; the plan's inspected 7.1.0 is pinned and the 7.6 prerelease is not adopted.
- Install delta: 55 lockfile packages (react-select, Emotion and its Babel macro chain, react-transition-group, fuse.js). `pnpm audit --prod` reports the same single pre-existing moderate advisory as before the install (minimatch through the OpenAPI generator tooling), so the delta adds none. `pnpm install --frozen-lockfile` is clean.
- Production bundle (harness, Vite 8.3.5): +110.6 KB raw / +37.5 KB gzip for picker, react-select and Fuse.
- jsdom with React 19.3.1 StrictMode and RHF 7.91.0 Controller: typo matches survive only with `filterOption={null}` (the default substring filter hides `Mousr`); arrows/Enter/Escape; RHF reset; stale async responses; Enter during IME composition does not select. A controlled `inputValue` must be cleared on `set-value`, `input-blur` and `menu-close`.
- Ranking latency over 500 candidates, rebuilding the Fuse index per query: p50 6.0 ms, p95 6.6 ms, max 15.5 ms.
- Headless Chromium (cached Playwright build, fresh context): desktop 1280 keyboard, 360px touch and emulated 200% zoom (640 CSS px at DPR 2) all offered and selected the intended record with an `aria-live` announcement and no horizontal overflow. Real browser zoom is checked again during PR-B browser qualification.

### Task 3 results

Components, each in its own file with a test file beside it:

- `capture/reference-rank.ts`: shared ranker. Exact ID, exact name and name-prefix tiers precede Fuse suggestions (names weighted 3:1 over path/description, threshold 0.4, no fuzzy matching below three characters; within suggestions, name matches precede secondary-only matches). Ties use numeric ID order. An all-digit query matches IDs only, so ID lookup never fuzzy-substitutes. Case, whitespace and accents fold for matching only.
- `ui/SearchableReferencePicker.tsx`: merges the bounded candidate snapshot with current search results (deduplicated by PK), places the exact-ID detail read first, and uses `filterOption={null}`. A response is used only for the query it answered; searches are debounced 250 ms and aborted when superseded. Coverage, unavailability (selection kept, no empty catalogue claimed) and disabled reasons are visible text linked as the combobox description. The create option calls `onCreate(name)` to open a draft form; it never selects or creates a record.
- `ui/AutoValueField.tsx`: Radix Popover trigger showing the current choice, native radio group for Auto/None/Manual, and a separate labelled text or native date input below the radios when Manual is chosen. Escape closes and returns focus to the trigger. The last manual text is restored when Manual is chosen again.
- `ui/OptionalNotesField.tsx`: the toggle hides and shows without changing the value (hidden text is reported as kept); Remove emits `null` for a tombstone.
- `ui/SharedTagsInput.tsx`: Enter, comma or blur add trimmed manual tags; duplicates are refused case-insensitively, keeping the first spelling; 32 tags of 100 characters; Enter during IME composition is ignored; Auto is an independent checkbox.
- `ui/DisabledFeature.tsx`: a focusable group carries the coming-soon explanation as its description and tooltip, because a disabled checkbox cannot take focus.
- `ui/AutosaveStatus.tsx`: textual saved/pending/saving/invalid/disconnected status, plus alerts with explicit recovery for conflict (discard and load saved values) and unconfirmed saves (retry the same save or check saved values).

Found during implementation: react-select drops a passed `aria-describedby` and hides a disabled input with `visibility: hidden`, which removes the named combobox from the accessibility tree. The picker appends its status ID through a module-scope custom `Input` and keeps the input visible; tests assert the disabled combobox keeps its name and description.

Verification: 38 new tests, full frontend 222/222, typecheck, ESLint and Prettier. Browser evidence for these components is gathered on the integrated panel in Tasks 4 and 9.

### Task 4 baseline (4.1)

Before this change `BatchSettingsPanel` was an RHF form with explicit Save/Discard that sent the legacy `settings` change through `Batch.edit`. `Batch` holds the accepted snapshot as edit authority, keys `CaptureWorkspace` by `batch.id:revision:reset` (so every own save remounted Capture), and keeps one payload-bound edit intent: a 412 shows current saved values and an uncertain outcome allows only the identical retry. Batch instructions used `InstructionsPanel`/`InstructionForm` with their own retained command and a full reload after acknowledgement. Navigation dirtiness flows synchronously from Capture to `useNavigationGuard`. API availability is observed by the header's `header-connection` query; `LiveUpdates` socket frames only invalidate reads.

Ownership chosen:

- `capture/save-queue.ts` (`SaveQueue`) is the per-batch serialized owner, mounted by `BatchSettingsPanel` for the Capture lifetime. Capture is now keyed by `batch.id:reset` only, so own acknowledgements no longer remount it; explicit discard still remounts through `reset`.
- Lanes: `settings` (complete-state `batch_settings`), `instructions` (existing instruct command) and `logo` (supplier logo upload). One request is in flight at a time across lanes; each freezes payload, expected revision and key. A logo upload's receipt carries no revision, so the queue takes expected + 1 (every retained command advances by exactly one); a foreign change in between surfaces as a 412 on the next command.
- `Batch` exposes raw ports (`save`, `read`, `instruct`, `uploadLogo`, `catalogue`, `accept`, `connected`); `accept` keeps the newest snapshot when acknowledgements and reads resolve out of order. `Batch` adopts a newer polled snapshot only while Capture reports no local edits; the panel then resets to it. A dirty panel never resets.
- Availability: editing needs a fresh scoped observation, either the shared `header-connection` read or the batch's own capture read, succeeded within 60 seconds and not now failing, and the browser must not report offline. A five-second clock and focus/visibility events re-evaluate freshness. No second probe loop. Socket health is not an input, so polling fallback keeps settings editable. Reconnection reads the batch before admitting writes.
- Evidence media/note commands and settings commands could race on the revision, so each pauses while the other is unacknowledged (the earlier mutual-exclusion contract kept in autosave form). Capture reads the batch after an evidence change resolves so the clean panel adopts the new revision.

### Task 4 results

- `BatchSettingsPanel` now has the title, Add batch notes, one Default location (`DefaultLocationField`: picker, new-location draft with parent picker, remove), supplier (`SupplierField`: No supplier keeping the selection, picker, new-supplier draft with manufacturer flag, PNG/JPEG logo upload and disabled Find automatically), `PurchaseOrderPreview` directly below supplier, Shared part tags and Custom instructions, with a textual `AutosaveStatus` per lane. Quantity mode, Note relates to, Batch human note, Capture tags mode and the Save/Discard buttons are removed. The override summary links each lot to its pinned Review subject.
- Selecting a catalogue record observes it first; only the observed reference is retained. Drafts not referenced by a current selection are omitted from the complete-state command, which retires them.
- `settings-model.ts` builds the command as a deep copy. Found during testing: RHF mutates nested form values in place, which had silently rewritten the queue's frozen saved payload so a No supplier change compared equal and was never sent; the supplier regression failed until the copy was added.
- Validation uses the contract with a positive placeholder revision; the queue supplies the real one.

TDD record: the queue tests (10) were written before `SaveQueue` and failed for the missing module; two negative controls (dropping the in-flight guard on "matches saved", and minting a new key on retry) each failed their target test and were restored by SHA-256. The panel, Capture and App tests were written alongside the panel implementation rather than strictly first; the obsolete explicit-save assertions were replaced only by tests covering the replacement behaviour (debounce, blur, invalid title, IME, in-flight newer input, uncertain retry, conflict keep/discard, instruction serialization, disconnect/reconnect, socket-only and target-only failure, clean adoption, notes Hide/Remove, supplier observe and No supplier, override links, navigation guard).

### Task 9 baseline (9.1)

The original Capture screenshot and HTML put evidence actions and groups in the primary left column and shared details, overrides and Go to review on the right. The implementation before this change used a three-column queue/context/settings grid with `CaptureQueue` and a persistent `CaptureEditor` pane. Callers depending on the queue selection: `EvidencePanel` (lot/Part context cards, scoped notes, Write a note focusing the settings note), `MediaWorkspace` (subject attachment choice) and the hash `#<batch>/<subject>` (focused editor, narrow back button).

### Task 9 results

- `CaptureWorkspace` is two columns (evidence | Batch settings + Go to review), one column under 860px. `CaptureQueue` and `InstructionsPanel` are deleted; retained lots, Parts, links and commands are unchanged.
- Write a note opens `EvidenceNoteForm`, an explicit append-only batch note (`kind: 'note'`), closing only when `Batch.edit` reports success (`edit` now resolves `false` when nothing was saved).
- Review gains Add physical lot, Add shared Part proposal, Edit lot details and Edit shared Part, opening `ReviewSubjectEditor` (`?edit=<id|add_lot|add_part>`) with `CaptureEditor` and the extracted `SubjectAttachmentChoice`. Its close is disabled while dirty; the route parameter is cleared during a save and restored if it fails, so the post-save remount does not reopen it. Per-lot exact quantity correction stays in `QuickLotEdit`.
- `Batch` redirects legacy `#<batch>/<subject>` links to Review (`/review/<lot>?edit=<lot>` or `?edit=<part|add_lot|add_part>`) with `location.replace`, which passes through the navigation guard.

Verification: frontend 244 tests, typecheck, ESLint, readability lint, Prettier, Markdown lint and production build pass. PR-B changes no server code; on its head `pnpm test:intake` passes 168/168 and the affected PostgreSQL files (`capture-intent`, `capture-catalogue`) pass 7/7, covering `batch_settings` revision checks, idempotent acknowledgement and catalogue reads.

Browser qualification ([evidence](../bench-intake/evidence/batch-settings-overhaul/README.md)): owned synthetic fixture at 1280, 390 and 360 CSS pixels in headless Playwright Chromium (touch enabled for the narrow runs), and at native 200% zoom (CDP `zoom: 2`, CSS 640 and 360) in Google Chrome `--headless=new` with an owned profile. Every run had zero horizontal overflow, no subject panes, an acknowledged autosave with title focus retained, keyboard fuzzy supplier selection (`Mousr` → Mouser), Escape keeping picker focus, disabled PO controls and a keyboard-reachable logo explanation. Qualification found the settings panel's leftover `grid-area` squeezing it into an implicit narrow column below 860px; it was removed and the runs repeated.

### PR-B independent review

#### Round 1

Codex (`gpt-6.1-sol`, read-only) reviewed exactly `1514e91..bfe0a3b`: no Critical findings; six Important and four Minor. Round 2 found that 1, 2 and 4 were only partly fixed; see Round 2.

1. Important: a dirty Review subject editor did not fence the Decision panel or table, whose commands remount Review and lose the draft. Review now disables each command surface while another dirty source exists (`hasOtherSources`), and the manual subject actions while anything is dirty. The Decision panel's legacy Edit in Capture link is removed. Regression: an add-lot draft disables the focused lot's quantity correction.
2. Important: the relocated attachment choice ignored its dirty state and recovery. It now reports an `attachment` dirty source, shows retained-command errors with exact retry and discard, and reloads saved values after a confirmed change. Regression: an uncertain change keeps the editor open, and the exact retry resends the same request and then reloads.
3. Important: saved instructions arriving after Capture never populated the textbox. A new saved instruction version is adopted while the operator has not typed; negative control confirmed.
4. Important: instruction text finished during IME composition never reached its lane, and pending debounces kept running. Composition keeps navigation dirty and schedules the lane that owns the composed field when it ends; negative control confirmed. Round 2 replaced the per-lane pause with a queue-wide suspension.
5. Important: a rerender during reconnection could release queued writes before the read finished. Reconciliation is tracked separately from connection; writes and exact retries wait for a successful read, and a failed read retries after two seconds. Regression rerenders while the read is pending.
6. Important: availability did not enforce freshness. See Availability above; regression: a capture observation older than 60 seconds disables settings until a fresh read.
7. Minor: a refused logo stayed "Uploading". The refusal is shown, the rejected draft is discarded (`SaveQueue.discard`) and a replacement file can be chosen.
8. Minor: a failed strict search looked like no matches. The picker discloses search unavailability while keeping candidates and selection.
9. Minor: ID tie-breaking used `Number`, losing order beyond 2^53. It now compares with `BigInt`; regression with `9999999999999999` and `10000000000000000`.
10. Minor: the evidence README cited `results.json`, which the repository ignores. The record is committed as `browser-results.json`.

Also restored: projection-mismatch coverage (a polled operator projection at a newer revision keeps the instruction draft until the Batch-level discard-and-reload), alongside the separate instruction-conflict test. Fixed in `52845e2`; frontend 257/257 tests.

#### Round 2

Codex reviewed exactly `1514e91..52845e2`: no Critical findings; five Important and two Minor. Round-1 findings 3 and 5–10 were confirmed fixed. Each fix below has a regression test that fails when the fix is reverted (negative controls restored by SHA-256):

1. Important: after an uncertain acknowledgement, editing back to the old saved value was dropped as "matches saved", so the exact retry reported saved while the field showed another value. A lane with an unconfirmed request now keeps every draft; regressions revert before and after the lost acknowledgement.
2. Important: the subject form and attachment choice in the Review editor shared one fence, so either save could remount Review over the other's draft. They now have separate `subjectDisabled` and `attachmentDisabled` fences, including exact retry; discarding stays reachable.
3. Important: a reconnection read settling after Capture unmounted (explicit discard/reload) could revive the old queue. `SaveQueue.dispose` now stops all dispatch (updates, reconnection and retry), and the panel ignores late reads and retry timers after unmount.
4. Important: a late supplier or location observation could override a newer choice (No supplier, a later record) and replace drafts created while it was pending. Each field orders choices with `useIntentTicket`: only the newest still-mounted choice applies, against current drafts read from the form. Location selection and parent choice are ordered separately; typing draft text supersedes neither.
5. Important: an evidence note and media editing did not fence each other, so one's save could remount Capture over the other's draft. While media is dirty, Write a note and the note form are disabled; while a note is dirty, media editing is disabled. The assertion that a pending original disables Write a note is restored.
6. Minor: composition start paused only the composed lanes, so a waiting lane could stall after composition. `SaveQueue.suspend`/`resume` now hold every dispatch during composition, and resuming sends each ready lane.
7. Minor: tag text typed but not yet added did not protect navigation. `SharedTagsInput` reports pending text, and the panel stays dirty until it is added or cleared.

Fixed in `6d07b5d`; frontend 267/267 tests.

#### Round 3

Codex reviewed exactly `1514e91..6d07b5d`: no Critical findings; three Important and one Minor. Round-2 fixes 1, 2, 4 and 6 were confirmed correct. Each fix below has a regression test that fails when the fix is reverted:

1. Important: StrictMode's effect replay disposed the queue permanently, so development autosave never sent. `useSaveQueue` re-activates the queue on effect setup; a genuinely unmounted queue still never dispatches. Regressions are hook-level (`useSaveQueue.test.tsx`), because the integrated panel test did not reproduce the replay.
2. Important: `Batch` rebuilds its settings ports on every render, which replaced Capture's dirty callbacks, and `useDirtySources` reported clean whenever its parent callback changed. That released navigation protection and the evidence fences while an upload stayed pending. Capture's reporting now reads current ports and callbacks through a ref, and `useDirtySources` reports clean only on unmount, giving a replaced callback the current state. Regressions: a pending original survives rerender with new ports, and a hook test replaces the callback while dirty.
3. Important: a shared Part linked to no lot had no Review entry point after creation. Review now lists "Edit unlinked shared Part: <label>" for each such Part; regression reopens one in a batch with no lots.
4. Minor: a comma typed during IME composition added the unfinished text as a tag. Delimiters wait for composition to end.

Fixed in `35d2ed2`; frontend 272/272 tests.

#### Round 4

Codex reviewed exactly `1514e91..35d2ed2`: no Critical findings; two Important and two Minor. All four round-3 fixes were confirmed. Each code fix below has a regression test that fails when the fix is reverted:

1. Important: a clean reset could set the instruction lane's saved baseline to empty before the projection arrived, and a later projection only changed the textbox. Clearing those instructions then compared equal to the stale baseline and showed Saved while the server kept them. A new instruction version now becomes the lane's baseline (`SaveQueue.adoptSaved`, only for a lane with no draft or unacknowledged request), and a reset without a projection leaves the instruction baseline alone rather than treating it as confirmed empty.
2. Important: settings resumed as soon as an evidence change finished, while the read of the new revision was still pending, so a settings edit could be sent against the old revision and conflict. Settings stay paused until that read is accepted. If it fails, an alert explains that settings remain paused and offers "Refresh saved settings".
3. Minor: unsent drafts made while disconnected had no recovery, because the fields were disabled and the host's discard needs a server read. "Discard unsent settings edits" now appears while disconnected and nothing has been sent or left unconfirmed. It drops the drafts locally and restores the saved values, and in-flight or unconfirmed requests keep their own recovery. Regressions cover instructions and the title.
4. Minor: the status line at the top of this handover still described PR-A as in progress. It now states the current status.

Fixed in `49bd191`; frontend 276/276 tests.

#### Round 5

Codex reviewed exactly `1514e91..49bd191`: no Critical findings; two Important and two Minor. Findings 1–3 completed round-4 fixes 1–3. Each fix below has a regression test that fails when the fix is reverted:

1. Important: round-4's adoption re-sent the operator's acknowledged local instructions when a newer projection from another client arrived, overwriting it. A clean instruction lane (no draft, nothing unacknowledged) now takes the newer saved text without sending; only an outstanding draft or a composition in progress keeps the operator's text.
2. Important: overlapping post-evidence refreshes could release the settings gate on an older read, admitting writes against a stale revision. Only the newest refresh generation may accept its snapshot, release the gate or report failure; regressions resolve the reads in both orders.
3. Minor: local discard ignored tag text that was typed but not added (for example a refused duplicate). Pending tag text now makes discard available, and discarding remounts the tag input to clear it.
4. Minor: inside the fuzzy tier, a record matching only in secondary fields could outrank a name match. Name matches now precede secondary-only matches, then score, then numeric ID.

Fixed in `856b82e`; frontend 281/281 tests.

#### Round 6

Codex reviewed exactly `1514e91..856b82e`: no Critical findings; one Important and one Minor. All four round-5 fixes were confirmed. Each fix has a regression test that fails when the fix is reverted:

1. Important: after an attachment acknowledgement, the workspace cleared attachment dirtiness before its follow-up read and the host reload, so a subject edit started in that gap was remounted away. The Review attachment now stays dirty from dispatch through the host reload, including exact retry. Regression delays both the read and the reload.
2. Minor: pending tag text reached navigation only through two passive effects. The tag input now reports from the input event, and the panel forwards new pending text to its owner synchronously; clearing still goes through the effect, so an unmounting input cannot report dirty after its owner reported clean. Regressions use React `Profiler` commit ordering, because effects flush inside the test's `act`.

Fixed in `84846df`; frontend 284/284 tests.

#### Round 7

Codex reviewed exactly `1514e91..84846df`: no Critical findings; two Important and one Minor. Both round-6 fixes were confirmed. Each fix has a regression test that fails when the fix is reverted:

1. Important: during a conflict, reverting a field to its old saved value dropped the draft, so "Keep my edits" sent nothing and reported Saved while the server held another value. A conflicted queue now keeps every draft, as an unconfirmed one already did.
2. Important: discarding unsent edits restored instructions from the last projection, which could be older than the queue's acknowledged text when the follow-up read failed. Discard now restores the lane's acknowledged value (`SaveQueue.savedValue`).
3. Minor: the empty Compare matches dialog linked to Capture, which no longer reads Parts. The round-7 fix only changed the link target; round 8 completed it.

Fixed in `867fb4f`; frontend 287/287 tests.

#### Round 8

Codex reviewed exactly `1514e91..867fb4f`: no Critical findings; one Important and one Minor. Round-7 fixes 1 and 2 were confirmed; fix 3 was incomplete. Each fix has a regression test that fails when the fix is reverted:

1. Important: composed text does not enter the queue until composition ends, so a newer snapshot adopted during composition (for example after an instruction acknowledgement) reset the field. Clean adoption now also waits for composition.
2. Minor: Review reads `?edit=` only when it mounts, so the dialog's new link changed the hash without opening the editor. The dialog now closes and hands over to Review's editor owner (`openEditor`); the regression clicks through to the shared Part editor.

Fixed in `dd0628c`; frontend 289/289 tests.

#### Round 9

Codex reviewed exactly `1514e91..dd0628c`: no Critical or Important findings, and both round-8 fixes were confirmed. One Minor: the browser qualification summary above attributed every run to Google Chrome, while the evidence README records the desktop and narrow runs in Playwright Chromium. The summary now matches the README. This round changed documentation only.

#### Merge and CI

Mitch waived a review round for the docs-only round-9 fix. `interactive-app` had advanced with #86, so the branch merged it (one documentation conflict). `range-diff` against the reviewed patches showed every other patch unchanged. The merged tree equalled the rebased tree that passed typecheck, lint, Prettier, build, frontend 289/289 and intake fast tests. PR #87 was opened at head `f1955b5` and squash-merged by Mitch as `f9b8fe1`. Selected CI on that head passed: Shared workflow sync, Frontend, Intake PostgreSQL and process, Intake contracts and HTTP, TypeScript lint, Markdown lint and Changed paths; Backend lint and test were skipped (no backend paths). The PostgreSQL check finished after the merge and passed.

Limitations: draft persistence across a browser crash/reload is not promised (beforeunload protection only). Batch-level evidence edits (`Batch.edit`) and media commands remain separate owners from the settings queue; they are serialized with settings and with each other by fencing rather than by sharing the queue. The `App.media` test now waits for the photo input to enable, because the panel's initial reconnection read shifts when the first fresh media read completes.


## PR-C plan: location precedence and inference review (Tasks 5, 6)

Branch `feat/batch-settings-overhaul-review`, stacked on the PR-B branch and targeting `interactive-app` after PR-B merges.

### Task 5 baseline (5.1)

- Representation: lot `location` is `inherit | unset | unknown | clear | set{CaptureRef}`; the batch default is the same without `inherit`, stored as append-only `capture_selection` rows (`subject_id` null for the default). A `draft` Default location (PR-A) is stored as `unset`. Shared Parts and evidence groups carry no location.
- The only resolver is `intake-server/src/review/model.ts`: `inherit` takes the batch default; anything but `set` or `clear` blocks with `location_required`. The result is sealed as `effectiveLocation` in the lot's review facts and becomes `ManualEffect.location_id`, which execution plans, preconditions and verification read. Processing does not resolve locations; its inputs embed the raw lot, linked Part and batch defaults.
- Operator commands set lot locations (bulk edit), copy them to split children and keep them on merge only when every source agrees.
- Staleness is recomputed, not recorded: processing compares rebuilt input bytes, and preparations compare rebuilt review material. Group moves and evidence links already change a lot's media digest.

Compatibility rules for the new assignments:

1. Part and group assignments are `set` or `clear`; absence means no assignment. Commands use `unset` to remove one. `unknown` is not an assignment.
2. Resolution per physical lot: a lot value other than `inherit` wins (including `unset`/`unknown`, which still block); otherwise the linked shared Part's assignment; otherwise the assignments of every group holding evidence linked to that lot, which must agree; otherwise the batch default. `clear` at any level stops the fallback.
3. Different group assignments with no higher-precedence value block approval with `location_conflict`; nothing arbitrary is chosen. When media is unavailable and the lot would fall through to group level while any group assignment exists, resolution blocks instead of guessing.
4. New fields are additive and omitted when absent, so existing snapshots, processing inputs, review facts and sealed approvals keep their exact bytes. A lot resolved from a Part or group records that source in its review facts.
5. A Part assignment is an application default for its lots, never an InvenTree Part field. Quantities and lot identities are unchanged by resolution.

### Task 5 results

- 5.2 RED: `contracts/tests/capture-location.test.ts` was written first and failed for the missing resolver. It covers each precedence level, agreeing and conflicting groups, a Part over conflicting groups, `clear` at lot, Part and group level, unread group membership, and a batch-default change moving only fallback lots with quantities unchanged.
- 5.3 GREEN: `contracts/src/capture-location.ts` (schemas, `resolveLotLocation`, `lotLocationGroups`), migration `0015`, `capture/locations.ts`, the `part.location` and `group_location` edits, Review materialization through the resolver, the Review editor's Part location control, evidence-group location controls and Review source labels (`From shared Part`, `From evidence group`, `Groups disagree`, `Groups unconfirmed`).
- 5.4: `intake-server/tests/pg/capture-locations.test.ts` checks storage, validation (unknown or retired group, unobserved reference, immutability) and, through real media groups, per-lot resolution, conflict blocking, Part precedence, group `clear`, a default change changing only the fallback lot's dependency digest, and an evidence move changing only the moved lot's digest. Preparations compare exactly these rebuilt dependency bytes, so the same changes make affected preparations stale. Pinned review vectors are unchanged. A processing test shows the Part assignment's value never enters sealed inputs; the Part edit's revision bump still makes earlier attempts for its lots stale, as any Part edit does.
- The PG tests were written alongside the server code, not strictly first. Negative controls (restored by SHA-256) made the resolver's conflict check and Part `clear`, the Review wiring, the processing stripping and the frontend group label each fail their tests. One control first passed and exposed a missing Part-`clear` case, which was added.
- Checks: contracts 8/8 location tests and the full contract suite; intake fast tests; PG `capture-locations` 3/3 plus `operator-review`, `manual`, `capture-intent`, `capture-groups`, `media-input-scopes`, `processing-compatibility` and `capture` (36/36); frontend typecheck, ESLint and tests; readability and Markdown lint; Prettier; generated contracts.
- Limitations: group membership comes from evidence linked to the lot itself, not evidence linked only to its shared Part. Operator split and merge commands copy only lot-level locations, as before.


### Task 6 baseline and plan (6.1)

Current seams:

- Inputs `bench-intake-input/1`–`/4` (and, from round 2, `/5`) embed the raw subject, linked Part, batch defaults, human notes and labelled capture-context notes (`capture/context-input.ts`); manual shared tags reach processing only as a context note, and Auto is not represented.
- Outputs are free-text proposals (`/1`–`/3`, summary plus note/media/research sources) or questions (`quantity` for lot subjects, `clarification`). A quantity answer is the only materialization path: `processing/answers.ts` turns it into a human `lot` quantity edit. `basis` (`counted`/`estimated`) is retained only in the sealed answer.
- Staleness: `processingInputIsCurrent` rebuilds the input and compares bytes. A stale output is retained as `disposition: 'stale'` and never becomes a proposal or question; a stale question cannot be answered. A newer human count changes the lot bytes, so any earlier attempt is stale.
- New-Part tags come only from `InventoryPartSpec.tags` in a Part `create` choice (deduplicated exactly or ASCII case-insensitively by `inventory/tags.ts`). Existing Parts have no tag mutation.

Plan (no new input or handler versions):

1. Auto intent: a labelled capture-context note states "Shared part tags: Auto requested" when intent asks for it, so existing manifests for legacy batches keep their bytes and an intent change makes earlier attempts stale.
2. Output: `bench-intake-proposal/4` adds an optional evidence-bound `quantity` suggestion (`value`, `status: 'estimated'`, lot subjects only) and optional `tags` suggestions (accepted only when Auto was requested), with the `/2`/`/3` source rules. No defensible estimate stays a quantity question.
3. Review shows a suggestion's source and estimated status. "Use this quantity" is a human lot edit and is offered only while the attempt is current and the lot has no human count (its own or an inherited exact batch default). Tag suggestions are shown apart from human tags; accepting adds them, deduplicated, to a shared Part's `create` spec. An existing Part's tags are never changed, and Review says so.
4. Order Auto/None/Manual: verify no Auto value is fabricated and manual values stay exact; PO stays inactive.

### Task 6 results

- 6.2 RED: `contracts/tests/processing-suggestions.test.ts` failed first: a valid `/4` estimate in a `bench-intake-runner/2` envelope was refused.
- 6.3 GREEN:
  - `ProcessingProposalV4` in contracts, admitted only by the synthetic runner envelope.
  - The requested-automation note (`automationIntentNotes`), added to every input version only when Auto tags are on. It is intent, not evidence: it never admits an input and no proposal may cite it.
  - Acceptance rules in `processing/messages.ts`: estimates for lots only, and tags only with Auto requested.
  - `ProcessingSuggestions` in Review.
- 6.4 verification:
  - `tests/pg/processing-suggestions.test.ts`: a lot estimate is retained and never becomes a count, a Part estimate is refused, tags without Auto are refused, tags with Auto are accepted, and a newer human count makes a later estimate `stale` with the human count kept.
  - A fast test shows Auto order context adds no value and batches without Auto tags keep their input bytes.
  - Only the server-derived requested-automation note (fixed per-batch identity and exact text) admits tag suggestions; the PG test quotes the marker in an ordinary batch note and is still refused.
  - Frontend tests: acceptance is an explicit edit, a human count is kept, tags merge case-insensitively into a new Part, and an existing Part's tags are untouched.
- Negative controls (restored by SHA-256) failed each target test: the estimated-only status, the lot-only rule, the Auto requirement, the intent note, and the human-count and existing-Part guards in Review.
- Existing PG suites `processing`, `processing-media`, `processing-compatibility`, `research`, `capture-intent` and `operator-review` pass (30/30).
- Provider limits: suggestions come only from the deterministic fixture path. The native runner and live inference are unchanged and unqualified; no schema pass or fixture estimate qualifies model reasoning. Acceptance needs a ready attempt (the snapshot marks non-current inputs `superseded`) from a successful Processing read made after mount at the displayed capture revision; a quantity also needs the lot to have no human count, including an exact batch default it inherits. Acceptance is always an explicit human edit.
- 6.5 remains open until PR-C's review and selected CI are evidenced.

### PR-C independent review

#### Round 1

Codex (`gpt-6.1-sol`, read-only) reviewed exactly `f9b8fe1..81c0441`: no Critical findings; four Important and three Minor. It found no issues in the precedence/clear/conflict resolver, retired-group filtering, the migration, FKs and grants, legacy absent-field compatibility, quantity preservation, `/4` source binding, older-format admission or Auto order values. Each fix has a regression test that fails when the fix is reverted (negative controls restored by SHA-256):

1. Important: Review offered a suggestion after its attempt was superseded (changed evidence, Auto turned off, a tag removed). Acceptance now needs the attempt `ready`; the snapshot marks any attempt whose input is no longer current `superseded`, and Review shows it as history only.
2. Important: the group location control called the capture command directly, with no retained choice, dirtiness or fences. `GroupLocationControl` keeps the chosen value dirty until acknowledgement, reports through the media dirty sources (so settings and notes are fenced), respects sibling fences and offers retry of the same change or discard.
3. Important: batch manual shared tags never reached a new Part's tags. `SharedTagsChoice` in the decision panel shows them as human tags and offers an explicit edit adding them to a new shared Part's create spec; existing Parts are only explained.
4. Important: any note containing the marker text admitted tag suggestions. Admission now needs the server-derived note: a fixed per-batch identity (`automationNoteId`) and the exact text.
5. Minor: Review's tag merge lowercased all Unicode. `tagKey` in contracts follows the inventory adapter (fold only all-printable-ASCII names), and a server test keeps it equal to `approvedTagNamesValid`.
6. Minor: the Review table dropped the location source label. It now shows the value and its source.
7. Minor: the processing test claimed unchanged bytes without the Part revision bump. It now models the revision and asserts only that the location value stays out.

#### Round 2

Codex reviewed exactly `f9b8fe1..2c69fb6`: no Critical findings; three Important and one Minor. Round-1 fixes 3–7 were confirmed.

1. Important: cached Processing data could still enable acceptance after the capture revision moved. `ManualWorkspace` now passes `processingCurrent` only after a successful mounted read that is not refetching or failing and whose `capture_revision` matches the displayed batch; otherwise suggestions are history. Regression in `LotEvidence.test.tsx`.
2. Important: automatic tag acceptance had no reachable current path, because processing inputs refused a subject or linked Part whose choice is `create`, while tags can only be added to a `create` spec. Mitch chose a new create-capable input. `bench-intake-input/5` (same `synthetic-research/2` profile and `processing/2` handler, otherwise identical to `/2`) is built only when the subject or linked Part has a create choice; inputs without one stay `/2` byte for byte, and research (`/3`), native (`/4`) and legacy (`/1`) inputs still refuse create. The currency rebuild uses the same constructor, so a create choice appearing or leaving makes a retained input stale. Regressions: a fast constructor test and a PG journey (Auto on, create choice, `/5` attempt, accepted tag suggestion, job still `ready` at the current revision); negative controls on the attempt constructor, the currency rebuild and version selection each fail.
3. Important: discarding an unconfirmed group location cleared local state while `Batch` still held the retained command. Discard now runs the owner's explicit reload (which clears that command and remounts Capture); while the control is still mounted the reload failed, so the change and its protection stay. Regression in `CaptureWorkspace.media.test.tsx`.
4. Minor: the status line at the top of this handover was stale. Updated, along with the Task 6 freshness note.

#### Round 3

Codex reviewed exactly `f9b8fe1..12d3ab9`: no Critical or Minor findings; one Important. Round-2 fixes 1–4 and input `/5` were confirmed.

1. Important: the requested-automation note counted as evidence. With Auto tags on and no other evidence, it admitted an input and could be the only source of a `/4` quantity estimate. `isAutomationIntentNote` (`capture/context-input.ts`) now excludes it from the `/1` and `/2`/`/5` admission checks, and provenance refuses any proposal that cites it (`runner_source_mismatch`, every proposal version). With real evidence the input is still admitted, so the quantity question path is unchanged. Regression in `processing-provenance.test.ts`; negative controls on each of the three checks fail.

#### Round 4

Codex reviewed exactly `f9b8fe1..71f731a`: no Critical or Minor findings; one Important. The round-3 fix was confirmed.

1. Important: the producers still cited every input note, so with Auto tags on the development runner's proposal was refused (`runner_source_mismatch`) and its attempt never reached `ready`; the native prompt also offered the intent note as an inspected source. `evidenceNotes` (`capture/context-input.ts`) now filters the citable notes in provenance, the development runner (moved to `src/dev/synthetic-runner.ts` so tests run the real code), the native prompt (`agents/prompt.ts`, which still shows every note as context) and the process-test worker. Regressions: a PG test runs the development runner on an Auto batch through acceptance to `ready` (`processing-suggestions.test.ts`), and a PG test stages a native prompt for an Auto batch (`agents.test.ts`); negative controls on both filters fail. The process-test worker's filter has no failing control, because the process tests do not enable Auto.

#### Round 5

Codex reviewed exactly `f9b8fe1..c526b69`: no Critical findings; one Important and one Minor. The round-4 fix was confirmed for the development runner, native prompt and process-test worker.

1. Important: a lot with `quantity: inherit` and an exact human batch quantity already has a human count, but the estimate guard checked only the lot's own `set` mode, so an estimate could replace it. `ProcessingSuggestions` now receives the batch default (`defaultQuantity`) and resolves an inherited quantity before the guard. Regression in `ProcessingSuggestions.test.tsx`; negative control fails.
2. Minor: the browser qualification fixture (`tests/fixtures/processing-browser.ts`) was another producer citing every note, and it refused input `/5`. It keeps its own question branch and now delegates proposals to `syntheticDevelopmentRunner`, which admits `/2` and `/5`, cites only evidence notes and is covered by the Auto PG test. The fixture is a long-lived manual entrypoint and was not launched. A sweep of remaining note-source producers found only `research-protocol-child.cjs`; Round 6 corrected the reasoning recorded for it here.

#### Round 6

Codex reviewed exactly `f9b8fe1..cbac3f0`: no Critical or Important findings; one Minor. Both round-5 fixes were confirmed.

1. Minor: `research-protocol-child.cjs` cited `manifest.notes[0]`. In proposal mode it never reads an artifact, so a media-only Auto input made it cite the intent note (the Round 5 note above wrongly assumed it cited media). It now cites the first note that is not the intent note (its identity mirrors `automationNoteId`) and otherwise the first media version. Regression in `tests/process/research-child.test.ts` (media-only Auto input, provenance accepts the proposal); negative control fails.

#### Round 7

Codex reviewed exactly `f9b8fe1..d3ddca9`: no Critical, Important or Minor findings. The round-6 fix was confirmed, and its sweep found no other proposal producer or guard with the same defect.

#### PR and CI

PR #88 was opened against `interactive-app` at head `d3ddca9`. `interactive-app` had not moved (`f9b8fe1`), so no merge or rebase was needed. Selected CI on that head passed: Frontend, Intake PostgreSQL and process, Intake contracts and HTTP, TypeScript lint, Markdown lint and Changed paths. Backend lint, Backend test and Shared workflow sync were skipped because no backend or skill paths changed. This docs-only commit then checked Task 6.5.
