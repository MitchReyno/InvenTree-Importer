# T05 — retained evidence and selected media

Status: implementation in progress. The prospective owner plan was recorded before code. Base: merged T04
`10bd6c85c81d02a0a5970b002c79f55f9d41fe87`. This document records intended
work; its acceptance list is not a claim that the checks already pass.

## Scope and authority

Implement bounded private photo/PDF retention, explicit receipts, same-batch
subject links and evidence groups, authorized previews/downloads, deterministic
crop/rotation versions, and explicit original/derived attachment selections.
Integrate attachments with exact preparation, approval, original-run execution
and selected repair on a qualified owned fake. The real inventory target is
strictly read-only and unsupported for mutation. No provider, taxonomy, purchase
order, primary-image replacement, or automatic inference is included.

Preserve the existing stock-v1 decoder, approved bytes, journal and recovery
behavior. Attachments need an additive plan/build/capability version with explicit
operation dependencies. Unknown attachment acknowledgments require retained
identity plus exact content/domain verification. A confirmed file subsequently
removed never becomes replacement permission. A filename match proves nothing.

The original HTML and fifteen direct screenshots govern layout and interaction;
keep all sixteen originals unchanged. Keep the current light/neutral/blue palette.
Each runtime component belongs in its own TSX file under components and uses
styled-components. Reuse the application navigation guard and URL-pinned
preparation identities. All effects shown for approval remain fully sealed.

## Ownership and integration

Own new media modules, migration 0005, media contracts, components and relevant
review/execution changes. The coordinator owns shared exports/code generation,
package manifests/lockfiles, main/App/Batch, CaptureHeader, ActivityIndicator,
central implementation plan and shared integration record. Propose existing
capture repository/grant changes before editing. T06 runs separately; never import
its unmerged branch. The coordinator integrates shared files in this worktree.

The [wave integration record](bench-intake-wave3-integration.md) is coordinator
owned and must be preserved. No process or PostgreSQL tier starts without its
service allocation. Reuse the existing bounded PostgreSQL container with isolated
random databases/roles. Preserve previews and every other checkout's changes.

## Package and process assessment

Public npm metadata was queried directly before choosing pins. Proposed exact
server dependencies: sharp 0.35.5 (Apache-2.0, about 0.96 MB JS plus native
libvips/platform packages), pdfjs-dist 6.4.299 (Apache-2.0, about 35 MB), and
@napi-rs/canvas 1.1.0 (MIT, native platform package). libvips has its own LGPL
licensing and bundled-code notices; package license labels do not cover every
native dependency. Preserve locked transitive packages and notices in the decoder
image. The dependency footprint is accepted only for implemented decoding;
metadata is not a security audit or clean-host reproduction proof.

Alternatives: browser-only decoding cannot establish server content or hard
resource limits; shell ImageMagick/Poppler adds a separate unpinned operational
toolchain; pure PDF text libraries cannot supply actual raster page previews.
Using an octet-stream route with a strict byte limit avoids a multipart dependency
and base64 expansion. Originals are always authorized downloads, never inline
untrusted documents. Only generated raster PNG previews may be inline.

Node heap limits do not bound native decoder memory. Proposed supported decoder
boundary is an explicit isolated container with network disabled, read-only root,
bounded tmpfs, memory/CPU/PIDs and wall time. The coordinator approved this local Linux container boundary after the initial
assessment. Actual compatibility, image pins and resource tests remain to prove;
native-child mode cannot claim hard native-memory isolation.
No decoder child or worker starts implicitly from imports/migrations/web startup.

References: [sharp constructor](https://sharp.pixelplumbing.com/api-constructor/),
[sharp image operations](https://sharp.pixelplumbing.com/api-operation/),
[PDF.js](https://github.com/mozilla/pdf.js),
[canvas](https://github.com/Brooooooklyn/canvas).

## Intended boundaries and implementation order

1. Define strict media DTOs and exact recipe/version semantics; send coordinator
   the exports/routes/props and pins before shared integration.
2. Add private content-addressed store. Stage in owned directories with no-follow
   checks, hash server bytes, sync file, publish atomically and sync directory.
   Hold digest-level exclusion across publication and database receipt. GC takes
   the same exclusion, checks positive references/pins and only removes old
   positively unreferenced blobs. Crash-created orphans never imply retention.
3. Add additive SQL with same-batch composite foreign keys, immutable versions,
   restricted grants, approval pins and explicit current selections. Authorize
   actor/batch/object for every read or command; hashes are not capabilities.
4. Add bounded decoder protocol and real JPEG/PDF fixtures. Normalize EXIF
   orientation, then crop integer source pixels, then rotate quarter turns and
   encode fixed PNG bytes. Retain source hash, page, coordinates, decoder/build
   and encoder settings with every immutable output. No unsupported document
   silently becomes ready; retain honest encrypted/malformed/unsupported states.
5. Add capture evidence browser, groups/links, focused crop controls and receipt
   states using authoritative layout. Browser coordinate conversions are explicit
   and independently checked against source pixels.
6. Add selected destinations to a new exact preparation version, pin originals
   and derivatives atomically with approval, and execute qualified fake attachment
   effects with separate committed request intents and original-run recovery.
7. Exercise the real fake journey, restart, eligible attachment repair and later
   lot round; prove stock count does not increase during attachment repair.
8. Complete the checked results and limitations here, ready PR to interactive-app
   through github-pr-tools, then return exact head/checks to the coordinator.

## Acceptance and adverse tests to record

- Actual file/HTTP/PostgreSQL boundaries; independent literal hashes/pixels/counts.
- Interruption before publication/receipt, restart and publication-versus-GC race.
- Traversal, symlink, wrong actor/batch/object, oversize/page/pixel/time/memory
  failures, encrypted/malformed/unsupported bytes and decoder interruption.
- Immutable outputs, asymmetric EXIF/crop/rotation coordinates, exact source hash,
  recipe/destination binding, selected and supporting evidence approval pins.
- Lost attachment acknowledgment, trustworthy identity in malformed responses,
  wrong domain/content, confirmed-then-removed file, cancellation and selected
  original-run repair without another stock POST. Unknown same-source effects
  continue blocking later work; no broad retry or filename attribution.
- A negative control must fail for a plausible disabled boundary, then restore
  original code and rerun the discriminating check.
- Desktop, true narrow and nondefault state visual inspection with browser-harness
  recordings off; committed small inspected screenshots and safe receipts.
- Frozen dependencies/generation, types/lint/build/format, relevant PG/process
  fault tiers and normal suite. Do not claim real-target compatibility, full backup
  or power-loss durability from owned fixtures.

## Decisions and observations during implementation

The coordinator approved the bounded local Linux Docker decoder and the additive
v2 stock-plus-attachment plan boundary. The existing stock-v1 decoder and approved
bytes remain unchanged. Attachment children must stay under the same original
approval/run/source guard/supervisor; no mutable side-plan may extend an old
approval.

The first actual crop test caught the shared canonical encoder's deliberate
refusal of numeric scalars. Media coordinates use bounded integer pixels. Added
`media-json/1` encoding and retained its exact JSON strings inside the existing
semantic-idempotency envelope; this does not modify stock/foundation canonical
bytes. The decoder protocol uses a bounded JSON header plus raw bytes, avoiding
base64 overhead and the API JSON parser's smaller input ceiling. Protocol
construction now precedes spawning the container, so an encoding failure cannot
leave an idle decoder behind.

Initial file checks passed three cases. Actual isolated image/PDF checks passed
five authored cases across current runs: literal PNG crop/rotation pixels and
repeated exact bytes; JPEG EXIF orientation; PDF raster dimensions/colours;
unsupported/malformed input; and a password-protected synthetic PDF. These are
local Linux arm64 observations, not cross-platform qualification. The encrypted
fixture was generated once using the existing pinned pypdf 6.21.0 development
environment with a fixture-only password and RC4-128; no Python runtime is used by
the application or decoder. AES fixture generation initially lacked the optional
cryptography dependency; no dependency was added for that test-data task.

Current tested decoder image:
`sha256:597bcd2449837adfcb87c05e3f71c328a5f3170f3e28ba81400e6b2bed062aa4`.
Base is Node 24.22.2 bookworm-slim manifest
`sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c`.
The explicit source/manifests/lock allowlist produced a roughly 283 KB context;
102 production packages were installed from the frozen workspace lock. The image
must be rebuilt and rechecked after subsequent decoder-source changes.

Runtime jobs use no network/mounts, read-only root, non-root UID, no capabilities,
no-new-privileges, one CPU, 512 MiB memory and equal memory+swap, 32 PIDs and a
64 MiB noexec/nosuid tmpfs. Internal coreutils timeout kills the Node job after
25 seconds; the host bounds CLI wait to 30 seconds and cleanup wait to five.
Docker-daemon unavailability cannot be treated as proof that a process exited;
an interrupted durable claim remains unavailable for automatic retry.

Refined lock order: capture batch/sorted subjects, shared media-revision advisory
lock, sorted blob digests, processing/run authority, stream. GC takes digest locks
and positive-reference reads only; it never subsequently locks a batch. Media
publishers can take the advisory lock without mutable capture privileges. Decoder
command claim locking needs PostgreSQL UPDATE privilege on the immutable command
ID column; the immutable trigger still rejects actual updates. Role tests remain
required before claiming this boundary verified.

## Prospective form and dependency audit follow-up

The coordinator's separate forms work adopts pinned React Hook Form and is being
reviewed independently. After it actually merges, adapt MediaCropDialog and the
substantive evidence-group form to that maintained form state. Preserve source
coordinates, selected File bytes, original media revision/idempotency keys,
synchronous global dirty reporting and immutable selection/pin policy. Do not
infer that a form library grants approval or resolves ambiguous acknowledgments.

At the user's request, the owner identified three remaining bespoke mechanisms
for assessment; none was installed or rewritten from that audit:

- [execa](https://github.com/sindresorhus/execa) could simplify decoder subprocess
  lifecycle and bounded streams. Docker containment, explicit container cleanup,
  private environment and interrupted-command authority remain application policy.
- [file-type](https://github.com/sindresorhus/file-type) could replace custom magic
  signatures. Detection is advisory, not validity/security or permission proof;
  the current three signatures may be too small to justify its dependency cost.
- [canonicalize](https://github.com/erdtman/canonicalize) could own JSON key sorting
  and quoting. Safe integer validation and exact media-json/1 vectors must remain
  explicit, and stock-v1 canonical bytes may never change.

Compatibility, licensing/dependency cost and actual byte/behavior parity remain
research work for those candidates. Existing package adoption is not a reason to
add another dependency without a concrete simplification.

## Attachment v2 implementation checkpoint

Before executor edits, the additive design is: `bench-media-plan/1` with
`bench-media/1` build and `owned-fake-media/1` capability. Preserve stock-v1 code
and bytes; dispatch versions through a new named decoder. V2 retains the same
stock operations and separate immutable attachment children keyed by the retained
human selection ID, with exact version/blob/size/type/original/recipe-digest and
stock-operation destination dependency.

The owned fake will expose an explicit attachment contract distinct from actual
InvenTree compatibility. Every create/read/verification receives a retained intent.
A qualified no-effect receipt must bind artifact, stock destination and content;
an error status alone is not retry permission. Known output IDs are checkpointed
before subsequent content verification. Unknown acknowledgments permit explicit
read-only artifact/domain/content reconciliation, never filename attribution.
Confirmed-then-removed files remain historical effects and cannot be replaced.

Attachment settlement contributes to the existing run/source guard and external
witness checks. The existing physical supervisor remains the only writer. Selected
repair uses the original run and retained child, preserves confirmed stock and
must demonstrate no additional stock POST. The next PG/process tier will qualify
this new boundary after shared service allocation; current media retention tests
do not prove these future executor behaviors.

## Prospective maintained crop interaction

User approved react-image-crop 11.1.2; the coordinator installed its exact pin.
The installed ISC license, React >=16.13.1 peer and absence of runtime dependencies
were checked alongside the tagged README/types. Use its maintained touch/keyboard
rectangle UI, with explicit conversion to normalized integer source pixels.

Actual `src/addons/browserCrop.ts` inspection found its rotation helper rotates
around the full image before cropping and does not swap output dimensions. That
is incompatible with this task's crop-first quarter-turn recipe. Do not pass
quarter turns to that helper. Keep simple left/right 90-degree controls; show a
crop-first local preview only if it matches independent saved-pixel checks. The
retained Sharp result remains authoritative, and EXIF normalization occurs before
the library receives its source preview.

## Superseding rotated-selection request

User subsequently selected Moveable and requires the **crop rectangle itself to
rotate while the base image remains fixed**, with rotation hit areas offset just
outside corners and a lockable aspect ratio. The earlier react-image-crop
assessment is preserved as chronology; it is no longer the selected UI package.
No react-image-crop UI code was adopted.

Proposed exact pin is react-moveable 0.56.0, MIT. Public registry metadata identifies
source revision `7722addf758da09480808f1e03c5b9e3061f855b`; the exact tarball's
license and type declarations were inspected. It has thirteen direct dependencies
and about 4.62 MB unpacked contents. It declares no React peer guarantee: actual
React 19.3.1/TypeScript 6 browser qualification is required. Its declared controls
include corner rotation positions, around-control rotation, padding, ratio locking
and custom rotation targets. Validate the required gesture in the actual browser
before assuming these APIs satisfy it.

Before changing contracts, the owner proposed an additive
`documentary-rotated-region/1` recipe. It retains normalized source identity/page
and dimensions, exact fixed-point source rectangle center/width/height, clockwise
millidegree angle, explicit output dimensions and an optional aspect-lock hint.
All four selected corners must remain inside the source. Output extracts the
rotated source rectangle into an upright image; it does not rotate the base UI
image or reinterpret the existing crop-first quarter-turn recipe.

The coordinator received the concrete geometry/interface proposal. Decoder
interpolation, pixel-center and rounding policy still need an experiment and
independent asymmetric vectors before implementation acceptance. Retain exact
prepared bytes. A separate output panel must identify the current recipe and show
its matching server-prepared result; a provisional canvas must not masquerade as
retained output.

## Rotated-region sampling decision before contract changes

The new recipe uses normalized source **edge** coordinates in integer millionths
of a pixel. Angles are clockwise millidegrees in `[0,359999]`. Width and height
are positive; output dimensions are nearest integer (half upwards), minimum one.
Every rotated selection corner must remain inside the normalized source edges.
Aspect locking is an explicit width/height ratio hint and does not rotate the image.

Sampling uses Sharp 0.35.5's maintained affine operation with libvips 8.18.7
bicubic interpolation. Source and output pixel centers are integers; the edge
coordinate center therefore subtracts one half. The inverse mapping from each
output pixel is the selected center plus the clockwise-rotated displacement from
the output center, scaled by physical selection width/output width and height/output
height. Quarter-angle sine/cosine values are exact. Libvips's default affine canvas
bounds use nearest-away-from-zero rounding, which is accounted for explicitly.
The transformed intermediate is separately bounded to 48 million pixels before
native allocation, as well as the existing per-output pixel and byte limits.

Primary references: [Sharp affine](https://sharp.pixelplumbing.com/api-operation/#affine),
[libvips affine implementation](https://github.com/libvips/libvips/blob/v8.18.7/libvips/resample/affine.c),
[transform bounds](https://github.com/libvips/libvips/blob/v8.18.7/libvips/resample/transform.c),
and [rounding definition](https://github.com/libvips/libvips/blob/v8.18.7/libvips/include/vips/util.h).
A native scratch experiment on a 64×48 asymmetric gradient at 37 degrees, with a
20×12 output, matched independently calculated inverse coordinates within one
8-bit channel level across every pixel. This is algorithm evidence, not browser
or container qualification; those checks remain required.

## Shared merge and first attachment journey checkpoint

Actual merged readability/OpenAPI trunk is integrated through `9e08fe8`. Shared
upload limit is now `MEDIA_SOURCE_MAX_BYTES`; retained upload and decoder source
limits consume it. Capture editor dirtiness and media pending state are separate:
media input freezes Capture editing, Capture input freezes media edits, and both
block navigation. Two interaction regressions passed, including failed file retry
with exactly the same bytes, request key and original revision across rerender.

The first two actual PG/HTTP/physical-child media journeys passed against the
owned fake. Positive no-effect repair kept one original approval, one stock POST
and two attachment attempts, with exact retained bytes and stock destination.
A lost attachment ACK stayed unknown through wrong destination and changed bytes;
explicit content verification completed without a second POST. Removing a confirmed
attachment retained historical confirmation and only permitted read-only inspection.
All isolated test databases/roles/private roots/listeners/children were cleaned.
These focused cases do not qualify all interruption, resource or restore boundaries.

## Current in-progress checkpoint after attachment and crop integration

This remains unfinished T05 work, not a review-ready qualification claim.

- Manual recovery now has separate strict stock `operation_keys` and attachment
  `attachment_keys` request branches. Attachment results and prepared effects are
  visible in their own components. Old stock-only output omits new media fields.
- Apply validates all approved media bytes before stock dispatch. Attachment writes
  and reads have separate committed intents, external witnesses and content/domain
  verification. Physical apply still uses the original supervisor and run.
- Moveable 0.56.0 controls only the crop overlay. RHF owns frame/aspect and group
  forms. The crop dialog follows the original editor-left/result-right hierarchy.
  A retained derivation ID plus exact recipe gates its output; no latest fallback.
- Optional `derivation_id` is backward compatible. Collision returns typed 409;
  uncertain UI retries retain original ID, key, recipe and expected revision.
- New decoder input/output structural validation uses interpreted TypeBox. The
  current decoder input change still needs a final rebuilt-image regression run.
- Contracts: 21 passed. Frontend: 17 passed before the final fields-component
  extraction; targeted types pass afterward. Maintained readability passed before
  that extraction and must be repeated at submission.

Tested rotated decoder image is
`sha256:19e60044e7cd6ac3a2e66402b45d71657c0d6c6029bb7f45b3440cdf982a4419`.
Its 336 KB explicit build context excluded credentials and personal state. All
then-current eight decoder cases passed, including photographic raw transport,
37-degree independent inverse pixel geometry and exact repeated bytes. A new
literal quarter-angle rotated-region case is authored but not run yet.

The owned attachment fake now flips a byte without changing length. The earlier
passing changed-content case used shorter bytes and therefore proved size refusal;
the strengthened hash-specific negative and a deliberate hash-check mutant remain
pending. No real inventory target has been contacted.

The real 4340 media browser fixture is authored, but has not started. It uses a
new disposable DB/private blob root and explicit decoder loop, with no apply
runner. It awaits the coordinator's App/Batch wiring after actual PR51 integration.
The retained 4310 namespace is untouched.

Execa 10.2.1 was assessed from its exact tagged MIT package and official
[termination](https://github.com/sindresorhus/execa/blob/v10.2.1/docs/termination.md)
and [output](https://github.com/sindresorhus/execa/blob/v10.2.1/docs/output.md)
documentation. It requires Node >=22 and adds twelve direct runtime dependencies.
It would remove only a small completion wrapper here: explicit named-container
cleanup, binary ceilings, private environment and safe failure policy remain
application responsibilities. The coordinator accepted retaining `node:child_process`.

The coordinator has approved durable DB↔blob-root identity binding rather than
relying on single-DB provisioning as an undocumented assumption. That migration,
marker API and swapped-root startup qualification are the next bounded change;
the coordinator owns production startup integration. No shared root was used or
collected by any fixture.
