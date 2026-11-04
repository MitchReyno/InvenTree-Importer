# Batch settings overhaul implementation

Maintained implementation handover for [`batch-settings-overhaul`](../../openspec/changes/batch-settings-overhaul/) ([BI-003](../PLANNED_FUNCTIONALITY.md#bi-003--batch-settings-overhaul)). Status: PR-A (Tasks 1–2) in progress on `feat/batch-settings-overhaul-foundations`, targeting `interactive-app`. Later bundles have not started. Reviews, CI and merges are recorded only after they occur.

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
