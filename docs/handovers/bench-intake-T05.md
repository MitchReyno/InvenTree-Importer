# T05 — retained media and explicit attachments

## Current status

Implementation is on ready PR #53 and is **not independently cleared**. Fresh review
found the capacity, handle-lifetime and attachment-choice issues recorded below; fixes
require re-review at their exact corrected head. Follow the approved [implementation plan](../bench-intake/08-implementation-plan.md)
and preserve the coordinator-owned [integration record](bench-intake-wave3-integration.md).

Actual merged query/form/readability/OpenAPI/server-state work is integrated. T06
remains a separate owner and must consume these seams only after actual T05 merge.
Hosted CI and independent domain/safety/native UI clearance remain merge gates.

## Fresh review corrections

The storage review of `0a005f45` found two material issues. Completed-version counting
ignored queued derivations, allowing publication beyond the schema's 100-version
limit. Admission now reserves completed versions plus every same-evidence derivation
without a published version, unless an explicit terminal non-publishing result exists.
It runs under the existing capture/media exclusion and takes limits from the maintained
DTO schemas. Produced versions count once; missing or ambiguous publication stays
reserved. The immutable batch derivation-history cap and existing bytes remain intact.

The empty-input handle could survive rollback before its acquisition because it had
no digest locks to check. Every handle now acquires a unique transaction-advisory
lifetime sentinel after resolving capture/media and sorted digest exclusions. Pinning
checks that original sentinel without reacquiring earlier locks. Rolling back before
acquisition invalidates the handle, even if a newer handle reacquires the same batch
locks; rolling back a later savepoint preserves it. No public API or lock order changed.

Independent discriminator controls removed each new guard separately. Both regressions
failed at their intended refusal assertion, then exact source restoration passed all
8 retention PG cases without skips. The capacity test seeds bounded immutable history,
then uses real original/derivation decoders: 99 published versions admit one pending
reservation, reject the next request, and finish with 100 and a valid snapshot. An
explicit interrupted attempt releases capacity; published derivations are not double
counted. The empty-scope regression runs without requiring a decoder image.

Fresh UI inspection also found indistinguishable crop attachment choices. A shared
label helper now identifies evidence and versions with snapshot-unique compact ID
prefixes, extending colliding prefixes. Options and visible card labels use the same
identifiers; full ID values and selection/retry intents are preserved. The regression
covers duplicate filenames and same-dimension crops with colliding initial prefixes.
Native selection and independent review of these corrected labels remain gates.

## Hard boundaries

- The original repository's real InvenTree configuration is strictly read-only.
  No real inventory request, credential copy or mutation probe occurred in T05.
- No actual agent/LLM/provider testing or usage while the user is away. Any later
  live-model test requires explicit new user authorization; use fixtures/stubs.
- Inventory writes are supported only by the explicit owned-fake media profile.
  Actual InvenTree compatibility, production identity/access and remote hosting
  are unqualified. No taxonomy, purchase-order or primary-image replacement.
- Preserve other worktrees, original staged/unstaged work and owned services.
  Reuse allocated PostgreSQL; never fault/restart shared services or migrate a
  shared development DB. Fixtures use random databases, roles and private roots.
- Use github-pr-tools for PR operations, handover for transfers and browser-harness
  for visual checks. Recordings stay off. No stacked PR or pr-review-loop.

## Implemented boundaries

| Area              | Implementation and authority                                               |
| ----------------- | -------------------------------------------------------------------------- |
| Contracts         | `contracts/src/media.ts`, `media-geometry.ts`, additive manual media DTOs  |
| Private bytes     | `media/blob-store.ts`, `store-binding.ts`, `store-identity.ts`             |
| Capture/edit/read | Media repository, typed schema/projections, content routes                 |
| Decoding          | Explicit worker, bounded Docker runner, maintained raster/PDF libraries    |
| Processing seam   | Opaque transaction-bound input handle and immutable command pins           |
| Approval          | Sealed supporting evidence, exact attachment destination and approval pins |
| Execution         | Additive media plan and immutable attachment journal under original run    |
| Browser           | Separate styled-components TSX files, RHF forms and scoped retained reads  |

All paths above are under `intake-server/src` unless another root is named.
The coordinator owns manifests/lock, generated contracts, CI, main/App/Batch and
shared plan/guidance integration. T05 owns the media/domain files and this handover.

### Retention and root identity

Uploads are raw bounded octet streams, at most `MEDIA_SOURCE_MAX_BYTES` (20 MiB).
Receipts mean committed ownership plus durable original bytes; readability and
preview preparation are separate. Logical evidence has opaque IDs, groups and
subject links. Original bytes and derived versions remain immutable.

A private root binds to the DB's immutable `media_store_identity` UUID.
`BlobStore.initialize(root, storeId)` validates an exact private no-follow marker.
It refuses mismatched identities and nonempty unmarked roots, without adoption,
rebind or deletion. Startup reads identity through the existing DB pool; absent
DB/default root discovery is forbidden. A copied UUID is the same restored
logical authority, not automatic fork or backup qualification.

Publication uses exclusive staging, file sync, atomic no-overwrite linking and
directory sync. Existing bytes are adopted only after exact hash/content checks.
Publication and collection share digest transaction locks. Collection requires an
explicit candidate, a cutoff at least 24 hours old and a positive reference check;
there is no scan, refcount decrement, unpin or retained-history deletion.

`media:decode` processes one explicitly configured unclaimed command.
`media:gc` considers one explicitly configured digest/cutoff. Neither discovers an
environment file, starts at web import, or acquires inventory/provider credentials.
GC's role has only schema usage and SELECT on identity/version/preview/approval-pin/
command-pin tables. It reads identity and collects through the same checked-out
transaction client.

### Decoder and recipes

The normal decoder supports actual JPEG/PNG raster data and PDF pages. EXIF
orientation is normalized before source coordinates. Raster output is sRGB,
white-flattened PNG with pinned encoder settings. Only generated PNG previews are
inline; originals are authorized downloads. Unsupported/encrypted/malformed/limit
states do not imply ready output. Observed infrastructure failures retain an
interrupted result; claims are not retry leases and are never auto-reclaimed.

Configured limits: 20 MiB source/output, 30 PDF pages, 24 million pixels per page,
48 million total/intermediate pixels, 32 MiB total output, 25-second inner deadline,
30-second outer deadline and bounded five-second cleanup. Linux containers have
512 MiB memory with equal memory+swap, one CPU, 32 PIDs, 64 MiB noexec/nosuid tmpfs,
read-only root, nonroot user, dropped capabilities, no-new-privileges and no network.
The runner refuses implicit image pulls and explicitly reaps its named child.

`documentary-crop/1` retains its integer crop-first/quarter-turn behavior.
The additive `documentary-rotated-region/1` uses source-edge coordinates in integer
millionths of a pixel and clockwise millidegrees. It samples the rotating selection
upright while the displayed source stays fixed. All four corners must remain inside
source edges. Output dimensions round to nearest integer, halves upward, minimum
one. Aspect locking binds a rational width/height hint with fixed-point tolerance.

Sharp affine uses pinned libvips bicubic sampling and explicit source/output pixel
centers. Default affine bounds use nearest-away-from-zero rounding. Intermediate
allocation is checked before rasterization. References: [Sharp affine](https://sharp.pixelplumbing.com/api-operation/#affine),
[libvips affine](https://github.com/libvips/libvips/blob/v8.18.7/libvips/resample/affine.c),
[bounds](https://github.com/libvips/libvips/blob/v8.18.7/libvips/resample/transform.c)
and [rounding](https://github.com/libvips/libvips/blob/v8.18.7/libvips/include/vips/util.h).

### Transactions and typed queries

Order remains capture batch/sorted subjects → shared media exclusion → sorted blob
digests → processing/run authority → streams. Preceding target/source domains remain
where required by execution. GC takes digest locks only and never moves backward.

T05 corrected a missing shared media advisory lock in ordinary edits. A row lock
alone did not serialize with decoder publication. This is a material concurrency
fix, not a mechanical query rewrite.

Routine reads, projections, validation and inserts use Drizzle through the original
client, with `executeDatabaseQuery` preserving pg errors. Reviewed SQL owns DDL and
constraints. Decimal bigint strings retain existing exact DTO/command bytes.
A media-owned transaction-local fence sets `pg_catalog, public, pg_temp` before
initial authorization/reads. The shared foundation transaction body is unchanged.

Intentional explicit SQL remains for atomic `SKIP LOCKED` claiming, advisory/row
locks and lock introspection, atomic revision increments, positive GC reference
checks, immutable command/approval pin authority and trusted grants. Startup's tiny
identity read is explicitly public-qualified because supported Drizzle APIs reject
`pgSchema('public')`. Immutable pin reads are public-qualified even when called
through a pool outside a media transaction.

### Opaque processing seam

`lockMediaInputs(client, binding, batchId, subjectIds)` resolves authorized scope and
locks every sorted digest before processing lane/job/question locks. Its frozen
handle exposes `manifest`, `manifestDigest`, copied frozen version descriptors and
`pinCommand(commandId)`. Pinning takes no earlier batch/digest lock; it validates
backend/transaction identity, held locks, command owner/context and exact captured
manifest. The caller cannot expand scope or use the handle after transaction change
or rollback to a savepoint preceding its locks. Empty scopes also retain bindings.

### Preparation and attachment execution

Existing stock-v1 decoder/encoded plan behavior remains unchanged. Additive
`bench-media-plan/1`, build `bench-media/1`, requires `owned-fake-media/1`.
Preparation seals exact supporting versions/hashes/provenance and explicit selected
original/derived attachments to each new stock destination. Old responses omit new
optional fields. Approval retains exact pins; missing authority is never rebuilt
from current selections. All approved media bytes are verified before any stock POST.

Attachments are immutable children of the original approval/run. Every target read
or write has a committed intent, and creates receive an external witness. An error
status is not retry permission: no-effect receipts must bind artifact, destination
and bytes. Unknown ACKs permit explicit read-only identity/content reconciliation.
Confirmation requires the downloaded hash, size and stock/artifact domain together.
A confirmed file later removed remains a historical effect and cannot be replaced.
Selected attachment repair skips the stock loop and creates no extra stock record.

### Browser state

Runtime components each have their own TSX file and use the approved light/neutral/
blue palette. Original HTML/direct screenshots govern layout; all sixteen original
reference files remain unchanged. The crop editor follows the original left editor /
right result hierarchy, stacking at narrow widths.

Moveable owns overlay gestures only, including offset corner rotation hit areas.
The source image is never CSS-rotated. Exact ratio normalization corrects CSS layout
rounding; server recipe bounds remain authoritative. The native dialog portals to
`document.body`, so hiding Capture's context column cannot hide an open modal.

RHF owns frame/aspect and group forms. File bytes, expected revision, request key
and derivation identity remain domain-owned. Optional `derivation_id` permits exact
receipt correlation and returns typed 409 on collision. An uncertain crop freezes
editing and retries the same request. Explicitly starting another crop captures a
new current revision/key/ID. Output requires both the exact ID and exact recipe.

TanStack Query coordinates scoped retained observations directly. Failed, paused or
not-yet-fetched-after-mount reads cannot authorize changes from warm cache. Polling
cannot reset pending file/group/crop input. Capture and media dirtiness are separate;
each blocks incompatible edits/navigation without enabling an unchanged Save.

## Package decisions and cost

| Package               | Pin     | License / actual role                                   |
| --------------------- | ------- | ------------------------------------------------------- |
| sharp                 | 0.35.5  | Apache-2.0; maintained native raster/affine operations  |
| pdfjs-dist            | 6.4.299 | Apache-2.0; actual PDF rendering, shipped local assets  |
| @napi-rs/canvas       | 1.1.0   | MIT; native PDF raster surface                          |
| react-moveable        | 0.56.0  | MIT; overlay gestures, no declared React peer guarantee |
| react-hook-form       | 7.91.0  | MIT; actual field/form coordination                     |
| @tanstack/react-query | 5.105.1 | MIT; scoped observation cache, no command authority     |
| drizzle-orm           | 0.45.4  | Apache-2.0; existing typed query dependency             |

Native libvips and bundled dependencies have their own licenses/notices; package
labels are not a complete native-license or security audit. Sharp adds native
platform packages; PDF.js is about 35 MB unpacked. Moveable is about 4.62 MB unpacked
with thirteen direct dependencies; twenty packages were resolved on adoption.
The explicit Linux production install currently contains 104 packages. The final
frontend build reports about 822 KB raw / 256 KB gzip with the unsuppressed chunk
advisory. These costs are accepted for implemented behavior, not hidden promises.

React-image-crop was investigated but never adopted; its helper rotated the image
before cropping, contrary to the selected UX. The provisional dependency was removed.
Execa 10.2.1 was assessed from tagged official [termination](https://github.com/sindresorhus/execa/blob/v10.2.1/docs/termination.md)
and [output](https://github.com/sindresorhus/execa/blob/v10.2.1/docs/output.md) APIs.
Its twelve runtime dependencies would remove little of the required named-container
cleanup/binary policy. Coordinator accepted retaining `node:child_process`.

## Observed verification

- Contracts: 21 passed, including exact legacy recipe acceptance and rotated bounds.
- Frontend: 61 passed after the merged masthead integration, including scoped warm-cache failures, new crop intent revisions,
  cross-panel draft guards and the narrow portaled dialog regression.
- Media PG: 8/8 restored controls after capacity and handle-lifetime corrections, including HTTP lost receipt/restart, role faults,
  per-output pixels, publication-vs-GC, opaque handle ownership/order, temp shadows,
  and actual SELECT-only single-candidate GC CLI behavior.
- Attachment PG/physical child: 2/2 after query/fence changes. Repair keeps one stock
  POST; lost ACK/wrong destination/same-length corrupt bytes never authorize retry.
  Confirmed deletion permits inspection only. No real target is involved.
- Actual decoder: 9/9 on Linux arm64, including EXIF JPEG, real/encrypted/bounded PDF,
  photographic input/output above 262 KB, literal legacy/new quarter-angle pixels,
  independent non-square 37-degree inverse sampling and repeated exact PNG bytes.
- Root independently observed original-DB bind/reopen and swapped-DB startup refusal
  across three actual main launches. The final complete PG tier repeated this case successfully.

Current production image: `sha256:99b15169e7d8c286bbe7f2f7a5241be9feb9d714a53200d496bf639b4c58f888`.
The 355.95 KB allowlisted context excludes credentials, tests/probes and personal state.
Dedicated resource cases passed 4/4 with an explicitly selected test-only probe.
The runtime inspector observed cgroup memory/swap/CPU/PID limits, no addressed external
network interface or route, no host bind mounts, dropped capabilities and a read-only
root. Native allocation produced a Docker kernel OOM event plus exit 137. The actual
wall timeout was approximately 25 seconds; oversized binary output was bounded and
the exact container was reaped. These are observed local Linux arm64 boundaries.

Current probe image: `sha256:c54c14637775b1648023e674d41c0114402b13fa9da6f18267f7f10a19e5eb31`.
It extends the exact production image with two allowlisted test-only files. A retained
content-addressed production tag prevents temporary probe-alias removal from deleting
the production manifest; the builder verifies its original image ID after cleanup.

Negative controls deliberately disabled download hash validation, the shared media
lock, the read search-path fence and the decoder read-only-root flag. Each strengthened
regression failed at its
intended assertion; exact owned source bytes were restored before passing controls.
The first hash mutant still left certainty unknown because an independent reducer
checked the retained digest; the added journal assertion then detected its false
positive receipt. This proves those discriminators, not exhaustive concurrency.

## Browser evidence and limits

Browser-harness used the real production build/API/PG/decoder with recordings off.
Actual pointer resize and outside-corner rotation kept the source fixed. Displayed
preview/download SHA-256 both equal
`fd95d4bc3e642b3a9497f62950d2f41d3c6973130fd2ca233a22b13a2f39ac12`
(111867 bytes), matching the retained exact recipe/version. At 390 CSS pixels the
portaled dialog stayed visible with no horizontal overflow and its output loaded.

Inspected [desktop](../bench-intake/evidence/T05/crop-desktop.png),
[phone selection](../bench-intake/evidence/T05/crop-phone-selection.png),
[phone output](../bench-intake/evidence/T05/crop-phone-output.png),
[exact receipt](../bench-intake/evidence/T05/retained-crop-receipt.json),
[narrow receipt](../bench-intake/evidence/T05/narrow-layout-receipt.json) and
[independent target summary](../bench-intake/evidence/T05/target-summary.json)
are portable synthetic evidence. The target summary has zero inventory POSTs and
zero approvals. The allocated preview was stopped/cleaned and only its own tab closed.

Native dropdown automation did not commit aspect selection. The controlled select
change was therefore used before real pointer resize. **Actual native aspect-control
selection still requires the fresh UI reviewer**; do not claim that control cleared.
These checks are not a full accessibility audit or production-device certification.

## Combined coordinator verification and remaining gates

The coordinator ran the maintained root `pnpm test`: 36 frontend tests, 21 contract tests,
47 server tests and 2,038 backend tests passed. Backend retained four known skips and 43 scanner/TUI
exclusions. The complete PG tier passed 39/39 and the process tier 22/22, with both
explicit images and zero skips. This includes actual startup, legacy stock, media,
attachments, DBOS/process interruption and all four resource probes.

Frozen install, contract generation drift, all application types, production build,
full lint and Prettier checks passed. Initial unused mock parameters and four test
formatting issues were fixed in test-only checkpoint `9783462`; six focused tests and
types/lint passed afterward. No runtime source changed during that cleanup.

The exact new CI build step was executed locally. Both builders wrote private
exclusive image-ID files, Actions-style environment export selected both images,
and the production image remained inspectable after probe alias cleanup. See the
[CI build receipt](../bench-intake/evidence/T05/ci-build.json). All 21 maintained CI
path-selector tests passed. Hosted CI still needs its own run; local execution does
not establish hosted platform compatibility.

The later parallel masthead merge (#52, `28f56be`) is preserved through actual merge
`2822c97`. Its manifest/lock changes required a fresh image build. Both current
images passed all nine decoder and four resource cases with zero skips. The final
frontend suite passed 61 tests; types, build, generation, lint and format passed on
Node24/pnpm12. Current chunks are 825.58 KB application / 570.37 KB lazy scene, with
unsuppressed advisories. Prior full PG/process/backend proof above covers unchanged
runtime source; hosted CI will repeat those tiers at the published head. See the
[post-trunk receipt](../bench-intake/evidence/T05/post-trunk-qualification.json).

Publish ready directly to `interactive-app`, then obtain fresh independent
storage/decoder, execution/approval and native UI reviews. Actual native aspect-control
selection is still explicitly required. Material findings need fixes and exact-head
re-review before the authorized selected-CI-green merge.

Relevant commands from repository root:

```sh
node intake-server/scripts/build-media-image.cjs
node intake-server/scripts/build-media-probe.cjs
node intake-server/scripts/run-media-pg.cjs '' retention
node intake-server/scripts/run-media-pg.cjs '' executor
node intake-server/scripts/run-media-pg.cjs '' startup
pnpm --filter @invimport/intake-server media:decode
pnpm --filter @invimport/intake-server media:gc
```

The builders/workers/tests require their documented explicit image/DB/root settings.
No command loads the original `.env`. Tests never migrate a live shared intake DB.
Remaining limits: Linux arm64 qualified here; other platforms and CI runs need their
own evidence. No full backup/restore, power-loss or concurrent restored-fork guarantee
is inferred from these fixtures. No actual provider/model invocation is authorized.


### Corrected-head coordinator checks

At owner checkpoint `bd09931`, all 62 frontend tests, application types, production
build, full lint, format and generated drift checks passed. The exact CI build step
also passed with both new images retained after alias cleanup; see the
[review-fix receipt](../bench-intake/evidence/T05/review-fix-qualification.json).
The application chunk advisory is 826.24 KB / 257.27 KB gzip; the lazy scene remains
570.37 KB / 145.09 KB gzip. No advisories were suppressed.

The owner observed eight corrected retention cases and separate red/green controls.
Fresh corrected-head storage and native UI review are still pending; these passing
checks do not clear the three findings by themselves. Execution review found no
material issue at the earlier head and must confirm its unchanged scope at the final
head. No actual-model or real inventory calls occurred.

## Native forced-close correction plan

A fresh correction owner starts from `e6d109aa` after the independent browser reviewer reproduced a second Escape forcing native closure while React kept the crop mounted and the navigation guard active. The [HTML close-watcher contract](https://html.spec.whatwg.org/multipage/interaction.html#close-watcher-infrastructure) permits a later close request to bypass cancellation; `onCancel` alone cannot own lifecycle cleanup.

Scope is only `MediaCropDialog.tsx`, its focused component tests and this record. Use the existing native dialog/React APIs; no package, contract, service, inventory or provider change is needed. The coordinator retains shared integration and builds; the independent reviewer retains its existing fixture and browser lease.

Reconcile the native close event with the component lifetime. Dismissing an unsent local draft explicitly discards it; dismissing a confirmed prepared view closes that view. A pending or uncertain request instead restores the same dialog and exact frozen request identity until confirmation or the existing explicit discard action. Guard redundant reopening; if modal restoration fails, expose the preserved controls as an open nonmodal recovery view rather than leave a hidden guard.

First reproduce the hidden-dialog regression. Then cover unsent/confirmed dismissal and parent guard cleanup, pending close followed by rejection and exact retry, explicit uncertain discard, and a failed modal reopen. Run focused/full frontend tests, types, lint/readability/format and diff checks without rebuilding `dist`. Native browser re-review and the eventual build remain coordinator-owned gates. Tests use deterministic in-process stubs; no model/provider usage, protected inventory request, credential access, PG/Docker action or preview replacement is authorized.

### Forced-close result and verification

The component now handles native `close` as well as `cancel`. An unsent local draft or confirmed prepared view closes through the parent callback, unmounting the editor and clearing its guard. Pending and uncertain requests restore the same mounted dialog; no save, payload change, new key or new derivation is created. An uncertain request still requires exact retry or the existing explicit discard button. If `showModal()` fails during restoration, an open nonmodal view keeps those controls and the preserved request accessible with an explanatory error.

Four new component regressions first failed against the previous code at the retained-guard and closed-dialog assertions. With the fix, all eight crop tests pass. The new cases cover initial cancellable versus forced noncancellable closure, parent cleanup and reopening, confirmed dismissal, pending rejection followed by exact retry and explicit discard, and visible recovery after a failed modal restoration.

All 66 frontend tests, root application typechecks, frontend lint, shared readability checks, full Prettier check and the focused Markdown/diff checks passed. The owner did not rebuild assets or access the browser/service lease. The independent reviewer must still replay native Escape/focus recovery at the corrected exact head; component events are not native browser qualification. No model/provider, inventory, credential, database or container operation occurred.
