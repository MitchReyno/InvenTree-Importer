# Wave 3 — shared integration record

## Prospective plan

Recorded before coordinator changes to shared code. T04 merged as PR #46 at `10bd6c85c81d02a0a5970b002c79f55f9d41fe87`, after independent server and UI clearance of `88d3d34f674d9334e68f875f2f6833320f964394` and six selected CI passes. Three unrelated checks skipped. The first manual journey is qualified against the owned fake only.

T04 ran from the coordinator allocation at 10:08 UTC to merge at 12:13 UTC on 2026-11-01. That observed span includes implementation, checks, independent review and fixes. It is one data point, not a schedule estimate for later tasks.

T05 media and T06 processing are independent feature branches from that merged base. Each fresh owner records its own plan and owns its domain implementation. The coordinator owns shared-file integration in both worktrees and reserves reviewer capacity.

## Ownership

The coordinator applies agreed changes to:

- Contract registration, generation scripts and generated artifacts. Each feature owner authors its own new schema module.
- Workspace and application manifests, the lockfile, scripts and CI selectors when needed.
- Server route registration and the frontend application shell, batch routing, stage header and global activity indicator.
- Existing capture repository/grant seams when both features need an intentional public interface.
- The central implementation plan and cross-application architecture map.

Feature owners propose exact interfaces, versions, examples, consumers, dependencies and route/component wiring before these shared edits. They do not independently run package additions, lock regeneration or generation against competing shared registrations. Frozen installation and their owned module edits remain normal owner work.

## Integration sequence

1. Read each owner's proposal and the current implementation. Resolve overlapping types, lock ordering and caller authority once, then notify both owners.
2. Apply only the proposal needed by that feature in its own worktree. Never import unpublished sibling modules or bind a consumer to another branch.
3. Generate artifacts with the pinned toolchain and verify the affected public contracts and consumers. Preserve original references, canonical vectors and applied migrations.
4. Prefer the ready T05 feature merge first. T06 then checkpoints its preserved work and incorporates actual merged trunk with a normal merge. Verify ancestry and inspect material conflict resolutions before qualification.
5. Each ready PR receives fresh independent review and selected CI checks at its exact head. Material fixes require re-review. Merge only into `interactive-app`.

## Invariants carried forward

Global navigation must preserve meaningful unsaved human input. Approval and question surfaces pin the identity being acted on; polling must not replace it with the latest record. Missing or stale authority blocks the action.

The complete displayed preparation remains bound to the sealed retained response. New media or processing interfaces must preserve immutable old approvals, cumulative source history, explicit recovery and the prohibition on automatic uncertain-write retries.

Media publication, pinning, collection and processing input retention need one documented lock order before integration. Consumers use owning modules rather than sibling SQL internals. No new generic retry or workflow framework is planned.

The real server named by the original root environment remains strictly read-only. No mutation or denial probes, credential copying or provider inference is part of this integration task. Owned fake effects stay explicit.

## Verification and service coordination

After each shared change, run generation drift and affected type, lint and feature checks. Run real PostgreSQL/process cases for behavioral or authority changes. Test actual failure boundaries; do not mirror implementation details or repeat unrelated suites without a reason.

Reuse the existing PostgreSQL service and its 40-connection budget. Owners request heavy-test windows and preview namespaces through the coordinator. Retained previews and databases are not reset or stopped merely to make a new fixture convenient.

## Decisions and results

### First shared contracts and decoder proposal

T05 proposed `mediaSchemas` from its owned `media.ts` module, batch-scoped upload/command/download/preview routes and exact server dependencies: sharp 0.35.5, pdfjs-dist 6.4.299 and @napi-rs/canvas 1.1.0. Package metadata and alternatives are recorded in its owner handover; installed compatibility remains to be qualified.

The coordinator approved a bounded local Linux decoder container. It has no network, a read-only root, dropped capabilities, a non-root user, bounded CPU/memory/swap/PIDs/temp space/time and only per-job input/output mounts. Native child-only execution cannot claim a hard native-memory bound. This does not change the provider hosting scope.

Attachment support uses an additive executable-plan version, preserving the stock-v1 decoder and bytes. New attachment authority remains under the original run/source guard/supervisor; an old approval never gains mutable extra effects.

T06 proposed `processingSchemas` from its owned `processing.ts` module and versioned snapshot/start/cancel/answer/activity routes. No new dependency is proposed. Root registration and generated clients will follow these exact public DTOs.

The shared lock order places capture batch/sorted subjects before media revision/sorted blob digests, then processing lane/job/question and finally stream events. Collection may hold digest locks but must not acquire earlier batch/media locks afterward. Owners must qualify publication/pinning races and report any incompatible ordering before implementation.

### Readability correction

The user identified continued condensed code despite the formatter/guidance. Both owners paused new surface additions for a structural pass. Blank lines between functions/methods, readable names/conditions/queries and cohesive responsibilities are submission gates. The coordinator is adding concrete spacing enforcement and a read-only diagnostic audit; Prettier alone is insufficient.

No shared code change or dependency compatibility result is claimed yet. Append actual edits, checks and review outcomes below; feature handovers retain their own detailed evidence.


### Query foundation, form and package refinements

The independent query uplift merged as PR #47 at a1e1c180f0aadf7f590619c3839ac5023644e7b9. Exact reviewed head 292fed56 passed independent contracts/server typechecks, 44 fast tests, PostgreSQL foundation 6/6 and actual DBOS delivery/restart 1/1; selected hosted CI passed 4 with 5 unrelated skips. Owner qualification separately passed the normal suite, PG 30/30 and process 9/9. The qualified transaction body remains unchanged. T05 fast-forwarded and T06 normally merged actual trunk with all coordinator unstaged work preserved.

The coordinator added grantCaptureRead and grantProjection to T05. Actual restricted decoder tests passed publication while denying capture writes, commands, command mutation, version deletion and attachment selection. The previous changed-payload HTTP500 was corrected through the actually merged CommandPayloadConflict type; the full retained-original HTTP/file/restart journey now passes with409 and same-key lost-ACK adoption. Owners release their PG windows explicitly; no duplicate service is introduced.

Mitch approved React Hook Form after package comparison. Capture/new-batch implementation is isolated as ready PR #48, with one independent P2 fixed: createIntent must outlive the mountable editing form. Corrected native/code verification and screenshots are retained in its tracked handover/evidence. T05's matching provisional copies remain until a normal actual-trunk integration; the coordinator will reconcile them, preserving the final correction. T06 records its prospective QuestionAnswer adaptation and waits for the actual dependency merge.

A fresh readability owner owns an independent branch for maintained ESLint spacing/control checks and the explicit avoid-pattern guidance. It will integrate the actual form merge before mechanical baseline normalization. T05/T06 must incorporate actual merged tooling before final qualification; a passing Prettier run alone is insufficient.

Mitch also approved TanStack Query, generated OpenAPI clients, a bounded Execa trial and more consistent TypeBox reuse. Crop interaction was refined to Moveable: rotate the crop box by dragging outside its corners, keep the base image fixed, allow aspect locking and produce a matching rotated output. The central plan records these requirements; the media owner proposes an additive recipe rather than changing retained v1 semantics. Package metadata does not establish installed compatibility.

### Explicit media runtime wiring plan

Before editing main/config/bootstrap, the coordinator will add a backward-compatible optional media_enabled bootstrap field. The runtime composition supplies true only after explicit INTAKE_BLOB_ROOT initialization and media route registration; a path string alone does not enable the capability. There is no default directory or environment-file discovery. An explicit blob root without a database, an empty root, a symlink or a nonprivate root fails startup. Existing no-media deployments retain manual Capture.

Server construction remains free of connections/workers/filesystem initialization. Main initializes the explicitly configured store and passes a narrow runtime-feature object to server construction, registers media routes only with that store, and passes mediaEnabled to manual configuration. Bootstrap exposes no filesystem path. A subprocess regression will check refusal before root creation when the database is missing; existing BlobStore tests cover private/symlink/corruption boundaries. Generated artifacts will be refreshed against the owning schema and subsequently through the merged OpenAPI tooling.

### Runtime and service checks

Root media wiring is implemented in main/config/api-server and Bootstrap. The optional public media_enabled flag defaults false and true is supplied by the runtime only after the explicit store exists and media routes are registered. Main supplies the same mediaEnabled value to ManualConfig. It launches no decoder or apply worker. A real subprocess test verifies a blob root without a database refuses startup before any root is created; default bootstrap, actual parser/serializer/client and restart cases pass, six focused tests total. Current generated artifacts match the current owning schemas, pending the separate actual OpenAPI tooling merge.

A fuller elevated service refresh corrected an earlier overstatement: the retained Capture service on4310 is still live (web60739, historical parent31155); only the old4330 preview was confirmed absent. The short4340 form fixture has exited0 and cleaned only its own random namespace. Preserve4310 and use it for subsequent Capture checks where compatible. No duplicate PostgreSQL service was created.

PR #48 merged at e592a80a3882f1bc737f09601cdac162bd52772a after exact-head independent code/UI clearance of3d29baf and7selectedCIpasses/2unrelatedskips. T05 checkpointed only root provisional form/guideline/dependency files, then normally merged actual trunk as12fef74. Root-owned conflicting form sources were resolved byte-identically to the cleared trunk; media dependencies and all unrelated owner work were preserved. T06 root checkpoint a287f50 and actual merge cf5c143 preserve its processing checkpoint and shared integration.

The readability review identified one minor coverage edge: the overload spacing exception also allows adjacent ambient declare-function and ordinary function declarations. The manual blank-line guideline still applies. Root/readability owner owns the explicit next readability-maintenance follow-up to narrow that exception and add its adverse fixture; it is not a runtime correctness finding and does not hold the current PR for cosmetic iteration.

### Query-state review follow-up

PR #51 merged as `0a9ab840e6acaf738d1da6bd8bd9c68ae3095133`. Independent review cleared the exact head `504b227680688c58eeecd60f31396bdc45b7f62e`; seven selected hosted checks passed and two backend checks skipped. Independent checks covered 25 frontend tests, StrictMode, and warm Capture cache with a failed mounted read and explicit reload. No material finding remained.

The coordinator and fresh T08 owner own a wording follow-up: separate header status from command disabling. `ManualWorkspace` passes unavailable state as `CaptureHeader` busy, so the small saved-state label says “Saving / reading…” while the prominent unavailable notice and disabled approval are correct. This nonblocking wording nit did not delay the merge.

### Future package candidates

Mitch requested a shortlist for upcoming phases. `docs/bench-intake/09-package-candidates.md` records candidates and adoption conditions for T07–T12. It is linked from the maintained implementation plan. No additional installation is authorized by the shortlist alone.


### Actual shared integration after PR #51

T05 merged actual trunk as `6a1c91d`; T06 merged it as `d57d06d`. Frozen installs retained all approved package pins. Root T05 checkpoint `9396e62` connects the optional media client from App through Batch to Capture, only when bootstrap explicitly returns `media_enabled: true`. Its three public-client integration cases cover true, false and omitted flags. Root also adds the explicit one-command `media:decode` entry point; web startup does not launch it.

Before the owner's subsequent query adaptation, all 32 frontend tests, workspace types, maintained readability, generated-contract drift and production frontend build passed. The build reports an 821.02 KB chunk (255.26 KB gzip); this advisory is retained. After adapting its retained queries, the media owner reports 34 frontend tests passing. Final whole-feature checks and independent review remain required.

Root main reuses one database pool to read the immutable media store UUID before initializing its private blob root. The actual startup regression passed: initial binding and bootstrap advertisement, same-database reopen with unchanged marker bytes, and a different-database refusal before listening. All three child launches and both random databases were cleaned. The marker does not qualify forked/restored deployment authority; restore remains a separate protocol.

The owner strengthened attachment corruption to a one-byte change of unchanged length. An intentionally disabled download hash check produced a false positive journal receipt and failed the new assertion; the independent settlement reducer still refused completion. The exact source was restored, then both original controls passed. This demonstrates two distinct defenses without claiming the earlier shorter-content test proved hashing.

The scoped package assessment is committed as `ce063c0`. React Router is an additional T08 candidate, alongside the earlier table and accessibility primitives; none of these future candidates has been installed. Package choice remains conditional on concrete phase requirements and exact-release qualification.


### T05 final local qualification

Stable media checkpoint `11d6bae` and test-only cleanup `9783462` passed the combined coordinator gates:

- Normal suite: 36 frontend, 21 contract, 47 server and 2,038 backend tests passed. The backend retained four known skips and 43 scanner/TUI exclusions.
- Complete owned PG: 39/39 passed. Process tier: 22/22 passed. Both exact images were selected, with zero skips and no remaining owned test windows.
- Frozen install, generated drift, application types, full lint, format and production build passed. The build advisory remains 821.82 KB raw / 255.59 KB gzip.

CI now builds both production and test-only probe images before PG/process tests. The exact step passed locally using private exclusive output files and Actions-style environment export. Probe alias cleanup preserves the production manifest through a content-addressed tag and verifies its original ID. Hosted CI remains pending until PR publication; 21 path-selector tests passed. No actual LLM/provider calls or real inventory requests were made.

Mitch's newest restriction is committed in both maintained plans: provider integration tests use stubs until explicit later live-usage authorization. Earlier permission to exercise signed-in native providers does not override it. Processing's current shared UI checkpoint `aae8672` plus question/archive fixes `f930db4` pass all 37 frontend tests; actual T05 media integration and whole-feature review remain pending there.


### Parallel masthead integration

PR #52 merged independently into trunk as `28f56be`. Root integrated it normally into T05 (`2822c97`) and T06 (`6f4eb77`), preserving the new Masthead component and both feature branches. Dependency conflicts retained Moveable plus Three and all pinned lock entries. Frozen host installs passed; no original references changed.

Post-merge frontend suites passed 61 tests in T05 and 62 in T06. Pinned-toolchain builds passed with the upstream lazy scene retained. T05 types, generated drift, full lint and format passed. Its exact CI image step rebuilt both images, retained both manifests after probe cleanup, and the new images passed all 13 decoder/resource cases with zero skips. Earlier full PG/process/backend checks cover unchanged runtime source; the ready PR still needs fresh independent reviews and selected hosted CI.


### Final T05 architecture reconciliation plan

Before merging, the coordinator will update the root and frontend architecture summaries: their older manual-slice paragraphs still say uploads are unavailable and only the stock fake profile is qualified, contradicting the implemented T05 sections. Keep owning module detail in its current architecture, preserve the original references and distinguish optional retained media from unimplemented provider inference and final identity. No runtime or package change belongs to this documentation correction.

The ready PR has independently cleared storage and execution at corrected runtime heads. Current completed hosted qualification is 41 PostgreSQL and 22 process tests, with zero skips; all eight selected checks passed at `e6d109aa`. Native review additionally found repeated Escape could force dialog closure without releasing React's dirty guard. Focused correction `64389a2` passed four discriminating regressions and all 66 frontend tests; the independent native reviewer then passed fresh/prepared dismissal and byte-identical uncertain retry. A separate narrow attachment-select overflow is being corrected before final native clearance.

Validate the architecture reconciliation with focused Markdown/format/link checks and inspect the final changed files. Final exact-head reviews and selected hosted CI remain merge gates. No model/provider usage, protected inventory request or new service is part of this work.


### Architecture reconciliation result

The root summary now describes optional retained uploads, the private database/root binding and additive fake media execution. The frontend summary removes its obsolete no-upload claim and records native-close reconciliation. Owning architecture links remain repository-relative; original design references are unchanged. Focused Markdown and whitespace checks passed.

The attachment-width correction is committed as `3c26827`: a bounded existing styled Select plus a wrapping accessible selected-identity description preserves full UUID commands and card/option correlation. Its meaningful identity/command regression failed before the markup change; all 66 frontend tests, application types, lint/readability/format and focused Markdown checks pass. Final native width/identity review and selected exact-head hosted CI remain pending. Storage and server runtime are unchanged from the independently cleared `e6d109aa`; execution reviewer confirmed the intervening native-close delta at `64389a2`.
