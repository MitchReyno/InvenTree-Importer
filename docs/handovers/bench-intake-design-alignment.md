# Bench Intake design alignment

Status: implemented and qualified, awaiting exact-head independent review and publication. The implementation plan was written before code on `feat/intake-design-alignment`, based on merged `interactive-app` at `468020d`. Mitch requested prioritizing the original mockup after the read-only comparison. This task is a focused UI iteration, not T10 or Drizzle phase 2.

## Scope and ownership

One implementation owner owns frontend presentation, behavior tests, frontend architecture/README and this task record. Initial implementation was delegated; during browser qualification Mitch explicitly requested that the root agent take over the work itself. The implementation agent was stopped. The root agent inspected the retained edits, made the final inbox and stage-heading changes directly, and owns all remaining implementation, integration, browser qualification and publication. Only the fresh read-only review remains delegated. Preserve every other worktree and uncommitted file.

- Compact the masthead, batch header and review controls, preserving the decorative animation, visible development mode, truthful capability labels, five stages, keyboard navigation and practical 44px touch targets.
- Turn the inbox into a compact retained list and continue card with explicit stage links. Remove stale claims that all batches are capture-only or have no effects. Search only the loaded list and label its bounds; no fabricated workflow counts or per-batch request fanout.
- Add a read-only Review evidence viewer with explicit evidence/version/page selection, large authorized previews and bounded zoom/scroll controls. Preserve selected exact identities across polling; a missing selection is unavailable, never silently replaced by a newer version. Keep retained notes alongside it.
- Correct narrow Capture back-navigation so it returns to Capture, and make new-Part Review labels truthful.

No new package, migration, schema or public API/contract is needed. No changes to execution, approval, recovery authority, dirty-form fences, provider integration, SSE, authentication, image mutation, primary-image replacement or deployment. No actual provider calls; root `.env` stays unread/unloaded, no real InvenTree requests, and no credential copying. No merge, force-push, reset, clean, service restart, branch/worktree/data deletion, or changes to the superseded tags investigation.

## References and alternatives

Read shared/frontend guidelines and frontend architecture, the original reference index and the experience chapter before implementation. The preserved `docs/bench-intake/reference/bench-intake.html` and its screenshots own visual composition; current experience/contracts override its simulated operations. Preserve the approved light/neutral palette with blue accents.

Use existing React, styled-components, native controls and the retained media snapshot. A new viewer library adds dependency/gesture complexity without a requirement for editing; CSS scrolling and explicit zoom suffice. A new inbox projection/API would broaden shared contracts and require separate acknowledgement, so this iteration presents only known saved metadata and stage navigation. Full server-side search and workflow counts remain deferred, explicitly labelled rather than simulated.

## Sequence

1. Compact shared chrome and retain navigation/error states.
2. Improve inbox layout, links and bounded search without additional network reads.
3. Add the read-only exact-identity viewer and integrate it above notes in Review.
4. Fix Capture back routing and Part-create presentation; add behavioral regressions.
5. Format changed files; run frontend type/lint/tests/build and shared checks. Coordinator runs full PG/process tiers with immutable media images under the lease.
6. Inspect real desktop/390px/360px browser layouts and adverse viewer states against the mockup; record evidence before commit/review. Fresh read-only review covers each final commit until clean. No merge without Mitch's instruction.

## Verification and adverse cases

Tests must cover explicit version/page/zoom selection; polling with new versions preserving the chosen source; selected-source removal producing unavailable state; separate lot identity resetting the viewer; inbox loaded-list search plus archived visibility and stage links; Capture back route. Existing tests cover exact approvals, dirty navigation, conflicts and recovery and must remain green. Browser checks cover content height, horizontal overflow, keyboard controls and readable evidence at true narrow CSS widths. No CSS-mirroring or fake backend acceptance tests.

## Outcomes

Implemented compact shared chrome, explicit Capture list routing, inbox stage links and bounded title search, exact-identity read-only viewer with page/zoom/retry controls, and truthful new-Part Review presentation. Viewer selection/zoom are local to a focused lot; persistent source/page URLs, full server-side search, batch thumbnails/workflow counts and broader stage-specific redesign remain deferred. No contracts, dependencies, backend execution or migration changed.

Initial checks: frontend lint passed; build passed with the existing large-chunk advisory; typecheck passed. First frontend run passed 125/126; its only failure was the new handler test querying a desktop-CSS-hidden narrow back button by accessible role. That test now targets the underlying text for the route regression; native narrow visibility was checked separately. Focused rerun passed 13/13. Final frontend run passed 128/128 tests across 21 files; frontend/readability lint, typecheck, build, format check, Markdown lint and whitespace check passed. Build retains its pre-existing large-chunk advisory. Coordinator full tiers passed against owned fixtures: PostgreSQL 98/98 (193.46s) and process 32/32 (144.65s), each with zero failures/skips. Contracts generation/check/tests and server unit tests (122) also passed. Decoder image was `sha256:b07595e38b6f0485d165393078c4e58b0a794f0662495b066f43bf6962937fc2`; probe image was `sha256:a417eb3c62fc7aa49778fa4faa441ad02f6a302bfed9a6171fba1d6296dde831`. These tiers ran under the shared pg-docker lease. Frontend-only layout refinements do not change their tested backend/contracts bytes. Independent review is required on the exact final commit before publication; report its SHA and outcome in the PR and coordination ledger.

The prescribed initial dependency symlinks were preserved under ignored `.amp/in/dependency-links` by the coordinator after pnpm refused symlinked task run state (`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`). A frozen-lockfile install created real per-worktree dependencies using 582 reused packages and no downloads, without package/lock changes.

No provider or protected-target qualification is implied by this task.


## Browser-led composition refinement

The first coordinator desktop inspection found that the evidence image still began too low because repeated lot/Part context, explanation and two labelled control rows preceded it. Before commit, move the preview/empty state directly below the evidence heading, with its caption and source/page/zoom controls below. Retain per-note provenance and explicit selection behavior. At widths of at least 1100 CSS pixels, place batch title/counts and stage navigation in one row; narrow screens keep stacked navigation. Development and unavailable-state notices remain visible. This is a layout correction within the original scope, not a change to retained identity or command authority.


A coordinator read-state inspection found that the viewer's cached-snapshot warning did not cover a failed initial media read. Review now propagates capability-aware first-read loading and unavailable states to the evidence panel, so an absent snapshot never implies that the lot has no files. The focused regression covers loading → unavailable with no image or empty-list claim. No query/authority policy changed.


The coordinator's first 390px inspection also found that stacked scope buttons, keyboard hints and wrapping filter chips still pushed the image below the opening viewport. Narrow Review now uses two equal-width wrapping scope buttons, keeps the labelled filter group in a keyboard-focusable horizontally scrolling row with 44px buttons, and omits only the desktop keyboard hint text. All filters and safety notices remain reachable/visible; page overflow remains a browser acceptance check at 360px and 390px.

The root agent removed the duplicated latest batch from the saved list while its Continue card is visible. Searching still includes that batch in the results; clearing search restores the single Continue card. A regression exercises both transitions without extra batch reads. The repeated manual-workflow paragraph is consolidated into the stage heading's visible “Owned fake only” label. Provider limitations remain in the application footer and Processing notices; approval retains its explicit target warning.

## Native browser evidence

Observed through browser-harness with recordings disabled, under both browser and pg-docker leases. The owned preview used port 4330, a new isolated database, synthetic packet image plus documentary crop and a two-page vector PDF, and the persistent inventory fake. The real server, original `.env`, provider runtimes, retained 4310 and user port 4350 were untouched. No inventory apply runner was started for these UI checks.

The final [viewport measurements](../bench-intake/evidence/design-alignment/viewport-checks.json) record actual CSS dimensions, accounting for the browser's existing 90% zoom rather than assuming the requested emulation width. There was no document horizontal overflow at 1440, 390 or 360 CSS pixels. Review image top moved to approximately 480, 679 and 694 CSS pixels respectively; the narrow image now begins inside the opening viewport. This is a composition measurement, not performance or accessibility certification.

- [Desktop Review](../bench-intake/evidence/design-alignment/review-desktop.png): queue, large loaded evidence, saved decisions and compact desktop title/stage row.
- [390px Review](../bench-intake/evidence/design-alignment/review-390.png) and [360px Review](../bench-intake/evidence/design-alignment/review-360.png): focused list-to-lot flow, bounded filter row, image-first evidence, reachable source/page/zoom controls and retained notes.
- [390px Capture list](../bench-intake/evidence/design-alignment/capture-list-390.png): native back action returned from a focused lot to `#<batch>/capture`; a document reload retained Capture/list visibility instead of routing to Processing.
- [390px inbox](../bench-intake/evidence/design-alignment/inbox-390.png): one Continue card, no duplicate list row, bounded search and explicit stage links.
- Native controls selected the synthetic PDF's second page; its exact authorized preview loaded. Zoom changed to 150% and source selection reset it to 100%. Component tests additionally cover polling identity preservation, removed page/version/preview refusal and failed-preview retry; those adverse data changes were not injected into the browser database.
- An unsaved lot-label draft disabled stage/back navigation. Explicit discard restored saved input; no edit or inventory command was submitted. Inbox search produced the matching/empty states, and stage URLs were inspected. Browser screenshots are synthetic evidence, not actual component identification or live inventory qualification.

After qualification the owned preview parent received SIGTERM and exited cleanly, the owned browser tab was closed, and both owned leases were released. Port 4330 was free; the retained 4310 listener remained PID 60739. Worktrees and the superseded tags investigation were preserved. Raw tier logs and the synthetic preview script are local ignored artifacts; the screenshots and measurements above are tracked evidence. This checkout uses pnpm workspace checks rather than a root Makefile. Python/scanner behavior was unchanged and its suites were not rerun.

## Network follow-up

Mitch noticed repetitive requests and asked about WebSockets and future autosave during this task. Source inspection confirms that media-enabled Review can mount six independent two-second pollers: global inventory activity, global Processing activity, operator review, manual workspace, media snapshot and Processing snapshot (approximately 180 requests per minute per open tab). The inbox changes add no per-batch projection reads.

The existing T10 plan specifies durable SSE, cursor-based reconnect and polling fallback. The root agent initially recommended that path with ordinary acknowledged HTTP saves. Mitch then clarified that future agent interaction should support cancellation and further dialogue, and expressed a preference for WebSockets. The root agent accepted WebSockets as the preferred direction for that bidirectional interaction channel. Carry this newer preference into a concrete T10 interface proposal and plan adjustment rather than silently implementing the older SSE assumption.

The proposed connection must carry typed, correlated questions/answers, cancellation and progress updates; durable command acknowledgement and retained reconnect cursors remain necessary. Autosave still needs revision conflicts and stable retry identities. Connection loss does not mean cancellation, and cancellation cannot roll back an already dispatched inventory request. No concrete wire contract has been acknowledged, and no transport or autosave code was added to this UI task. Polling and explicit saves remain unchanged; do not describe reduced request traffic or WebSocket support as implemented.
