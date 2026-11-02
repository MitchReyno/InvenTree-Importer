# Bench Intake remaining mockup work

Status: implemented and qualified, awaiting fresh exact-head review. The implementation plan below was written before source changes. Root is the sole implementer on `feat/intake-mockup-completion`, based on `interactive-app` at `dd222c49a362d1af7a8a3292e248a17421d4edde`. Mitch requested the remaining mockup work after the completed design alignment, T10 and Drizzle passes. Fresh agents review exact commits read-only; publication and pinned merge into `interactive-app` are already authorized after clean review and green CI.

## Scope and interfaces

Complete the deferred design items recorded in `bench-intake-design-alignment.md`: retained inbox thumbnails and workflow observations, server-wide title search, persistent exact evidence source/version/page URLs, and stage-specific composition. The original HTML and screenshots own visual hierarchy; current experience/contracts own behavior. Keep the approved light/neutral palette and blue accents.

Root owns frontend components and URL helpers, contracts/generated clients, a read-only inbox projection composed from owning repositories, meaningful tests, architecture and this record. Extend read-only listing with bounded server-side search/pagination and expose inbox observations without browser per-batch request fanout. Existing command, approval and execution contracts remain authoritative. New presentation counts cannot authorize preparation or execution. No migration, dependency or grant change is planned. Any unavailable optional capability must be explicit, rather than fabricated zero counts.

Keep exact revision and inventory IDs as strings. Persistent viewer URLs must bind evidence, version, page and preview identity; a missing selection must remain unavailable rather than adopt a newer version. Preserve dirty-form fences, pinned approvals, uncertain retry identities, keyboard behavior and all five stages. A source/page change is local navigation, never a command.

## Alternatives and dependencies

Use the existing React, styled-components, TanStack Query, TypeBox/AJV, Drizzle and module repository seams. No additional package solves these domain projections or identity rules. Avoid importing sibling SQL into Capture, adding a new router, or copying prototype localStorage/timers. Prefer a bounded application-level projection over one browser request per batch; inspect and record its database/query cost before claiming performance improvements. Search must run before the server limit and handle literal wildcard characters safely.

Broader provider qualification, login/permissions, autosave, new agent dialogue, supplier/PO creation, new inventory effects and deployment are outside this design task. No actual model/provider calls, root `.env` loading/copying, real InvenTree requests or credentials copying. Preserve retained worktrees/data, the superseded tags changes, retained port 4310 and user port 4350. No main/PR32 merge, force push, reset, clean or deletion.

## Sequence and verification

1. Compare the preserved original screenshots/HTML and current owned preview at desktop and true narrow CSS widths; record concrete composition changes.
2. Implement bounded scoped server search and retained inbox observations, with contract validation and real PostgreSQL boundary coverage for older matches, actor/target isolation, pagination, archival and truthful summaries.
3. Implement inbox cards/list, stage composition and exact viewer URL parsing/navigation. Add component regressions for server search/error states and exact viewer reload/unavailability without disturbing drafts.
4. Update owning architecture and this record with actual outcomes and limitations. Run types, readability/frontend lint, formatting, Markdown, generated contract drift, frontend/server tests and build.
5. Run complete PostgreSQL and process tiers under the atomic pg-docker lease using explicit immutable media images. Qualify desktop/390/360 CSS pixels, 200% zoom, keyboard/dirty behavior and exact page reload in the owned browser preview under both leases, recordings off.
6. Commit; fresh read-only reviewer checks the exact SHA. Fix findings and repeat until clean. Push, publish a focused PR into `interactive-app`, verify selected hosted CI and merge pinned to the reviewed head. Preserve the branch/worktree and append coordination evidence.

## Evidence

Pending implementation and qualification. The historical prototype is a reference, not backend proof. Code intelligence is unavailable in this harness; its checks are skipped, with local source inspection and required checks retained.

## Implemented outcome and decisions

The remaining deferred inbox and evidence-navigation work is implemented. The new read-only `/api/v1/inbox` response extends the existing summary shape with validated workflow observations; the application composes this list reader with the existing Capture command client. The original `/api/v1/batches` response stays compatible and now accepts optional title/archive/offset query fields. Search runs before the page limit and matches literal text rather than interpreting SQL wildcard syntax. Query offsets are bounded decimal strings because the shared strict validator deliberately does not coerce HTTP query strings. Inbox pages contain ten batches; each read is scoped to actor, target and context.

The composer uses one read-only repeatable-read transaction and owning module projections. It reuses full operator review rules, exact original-round snapshots, ready original previews and current Processing snapshots. Counts can overlap: a lot can need review and also have a blocking issue. The open-question/job totals reuse the destination Processing snapshot with its actual server profile/source policy, including logical supersession. They are not permission to answer or proof that a physical runner is available. Per-batch projection work remains bounded by the page and existing domain limits; this is not a constant-cost query or a measured throughput improvement. Browser per-batch projection fanout was avoided without adding a parallel truth model. Production grants and migrations are unchanged; the manual fixture adds SELECT on two already-existing Processing tables; the no-job path uses only the job probe.

The inbox now follows the reference's centered Continue card with documentary thumbnail, primary next action, compact retained rows and useful nonzero workflow links. Empty evidence has an explicit notes/known-values placeholder. Search submits on an explicit button/Enter action and supports archived visibility and page navigation; typing alone performs no requests. Missing reads offer retry and never imply successful empty results.

Review links pin evidence, version, page and preview identity. Default selection is canonicalized into the focused Review URL; subsequent source/page changes preserve view/filter fields. Reload restores exact identity; malformed/partial links and removed or changed pages remain unavailable until explicit selection. Mode/filter navigation preserves the link, and changing lot clears it. Zoom remains local. Existing dirty-input and exact approval boundaries are unchanged.

Processing has linked stage summaries, an explicit queue-selection disclosure and an Images gallery over saved originals/documentary crops. The gallery reads only; attachment selection and crop preparation stay in their existing owners. Browser inspection led to compact notices and placing image output inspection before queue controls. Approve has a frozen-scope summary beside exact effects and excluded-lot Review links. Results preserves explicit round navigation and refuses to substitute another round when a pinned round is unavailable. Capture and Review retain the already aligned evidence/details composition and the five-stage navigation.

No additional package, migration, provider capability, autosave, agent-chat command, supplier/PO creation or inventory effect was introduced. The original reference HTML/screenshots remain byte-for-byte preserved. Unimplemented historical prototype actions remain outside current contracts.

## Verification results

- Full PostgreSQL: **117 passed, zero failures/skips**, using the final immutable decoder/probe images under the pg-docker lease. The first full run passed 116; the final rerun includes the additional ready-thumbnail test. New real-PG assertions cover search beyond 100 newer batches, literal `%`/`_`, paging, invalid query refusal, actor/target isolation, archive inclusion, exact review/approval observations and only-ready thumbnail publication. The thumbnail journey checks that inbox reads send no inventory requests.
- Full process tier: **35 passed, zero failures/skips** under the same lease, including actual DBOS/web/restart, decoder containment and immutable execution/recovery boundaries.
- Contracts: **33 passed**; server unit tests: **125 passed**, zero failures/skips. The first sandbox attempt could not create tsx's local IPC pipe; the complete rerun outside the filesystem sandbox passed. No deadlines or safety checks were weakened.
- Frontend: **141 passed** across 24 files, including server-search submission/paging/error state, exact evidence URL remount/refusal, read-only Images/error state and unavailable pinned-round refusal. Existing dirty drafts, conflict and exact command tests remain green.
- Types, frontend/readability lint, generated-contract drift, formatting, Markdown and build passed. Build retains the existing large-chunk advisory. Python/scanner behavior and skills/agents were unchanged; their suites were not rerun. Code-intelligence tools were unavailable and their checks are skipped, not passed.
- The first focused PG test harness incorrectly called `close` rather than its fixture's `dispose`; that teardown typo was corrected before full qualification. The stuck test child was stopped. Its two owned failed-fixture databases/temp directories are deliberately retained; no shared service or retained user data was removed. Subsequent fixtures use the proper disposal path.

Immutable image IDs: decoder `sha256:81a8a2ff365e9c8785ecaaf9809f1a9897368027a310076d9d0c71f9da624846`; probe `sha256:fac5c81faf9f49ca24574623ce334a3070d2d13d87042ec17dce53ffe6ddc4f5`. These are the rebuilt images after the final bounded query-string schema adjustment; earlier image IDs remain retained locally.

## Native browser qualification

The [observations](../bench-intake/evidence/mockup-completion/browser-checks.json) and screenshots use an owned 4330 preview, separate synthetic database/fake, synthetic packet photo, documentary crop and two-page vector PDF. Browser recordings stayed off. The root `.env`, actual provider runtimes, real inventory, retained 4310 and user 4350 were untouched.

- [Inbox desktop](../bench-intake/evidence/mockup-completion/inbox-desktop.png), [390px](../bench-intake/evidence/mockup-completion/inbox-390.png), [360px](../bench-intake/evidence/mockup-completion/inbox-360.png) and [submitted search](../bench-intake/evidence/mockup-completion/inbox-search.png): loaded original thumbnail, compact rows, primary Review action and retained server search. Native typing kept inbox reads at 4; submission raised them to 5 and returned the retained receipt. The older-than-100 case is real-PG coverage, not a claim about the smaller browser fixture.
- [Review desktop](../bench-intake/evidence/mockup-completion/review-desktop.png), [PDF 390px](../bench-intake/evidence/mockup-completion/review-pdf-390.png) and [360px](../bench-intake/evidence/mockup-completion/review-pdf-360.png): native source/page selection produced the exact URL, and document reload restored PDF page 2 with its authorized preview loaded. Removed/changed preview and malformed URL refusal are component evidence; no browser database mutation was used to simulate them.
- [Processing desktop](../bench-intake/evidence/mockup-completion/processing-desktop.png), [360px](../bench-intake/evidence/mockup-completion/processing-360.png), [Images desktop](../bench-intake/evidence/mockup-completion/images-desktop.png) and [390px](../bench-intake/evidence/mockup-completion/images-390.png): actual unconfigured-runner state, all stage links, saved originals and crop choices. Images moved ahead of queue controls after visual inspection. No actual Processing inference was started.
- [200% browser zoom](../bench-intake/evidence/mockup-completion/images-200-percent.png): actual native browser zoom gave device-pixel ratio 2 and a 648×450 CSS viewport; no document horizontal overflow. Browser zoom was restored to its original 90%. This is a bounded Images reflow check, not an accessibility certification.
- [Approve desktop](../bench-intake/evidence/mockup-completion/approve-desktop.png) and [390px](../bench-intake/evidence/mockup-completion/approve-390.png): native UI selected/reviewed/prepared only Packet A (17 pieces), with Packet B explicitly excluded. The frozen summary's singular/plural wording was subsequently corrected without changing its scope or command.
- [Results desktop](../bench-intake/evidence/mockup-completion/results-desktop.png) and [390px](../bench-intake/evidence/mockup-completion/results-390.png): the exact approval reached original round 1, queued but not dispatched, with zero confirmed stock. No apply runner was started and no stock application was requested for this UI journey. Full process tests separately exercise confirmed effects.
- A native unsaved Capture title disabled all five stage controls. Explicit discard released the guard and preserved the saved batch title; no title save was submitted.

No document horizontal overflow was observed in the checked 1440/390/360 CSS layouts. The phone uses actual narrow CSS dimensions, accounting for the browser's pre-existing 90% zoom. Raw logs and preview setup are local ignored artifacts; tracked screenshots contain only synthetic evidence. Cleanup and exact-head review/publication status are recorded in the external coordination ledger.


## Independent review round 1 and corrections

Fresh read-only review of `77ad0a894480f19dcb9c4088af1e576dd648b3b6` requested three correctness changes. The reviewer independently passed 22 focused frontend tests, frontend types and generated drift; no PG/Docker/browser or provider/target work was started by the reviewer.

1. Query-only Review count links reached the router as `review?filter=...` and incorrectly selected Capture. Batch now strips the query before choosing stage/resource IDs; an App-level test follows the actual inbox link into Review.
2. The viewer initialized from the URL but did not follow an accepted same-document source/page change for the same mounted lot. Hash/popstate handling now reconciles exact inspection identity after the application's synchronous dirty-URL guard, and only while the URL still names that lot. Polling remains unable to replace selection. Tests cover valid page changes, unavailable/malformed replacements and composition with the real dirty guard.
3. Inbox Processing counts originally used raw saved rows. They now reuse the actual configured destination snapshot and its dependency/supersession rules. Main explicitly shares its Processing configuration with the inbox composition. A no-job probe avoids loading a full Processing snapshot for batches without jobs. A real-PG regression creates an open question plus queued work, changes human dependencies, and compares inbox totals with Processing while proving that the underlying question row can remain open.

The root also applied the existing 44px Summary control to the new queue disclosure and added wrapping for unbroken Continue titles and Images filenames. No production grant, migration, dependency, authority or command behavior changed. The previous test counts above describe the first qualified candidate; final review-fix qualification is recorded below once complete.


### Review-fix native evidence

The root repeated the new routing/inspection cases against a fresh owned preview. Clicking the actual `2 need review` count opened the Review stage with its filter, rather than Capture. Same-lot URL navigation switched the displayed PDF page 2 → 1 → 2 without document reload; `performance.timeOrigin` stayed identical. Replacing the preview with an unavailable exact ID, then using an incomplete source query, each removed the image and explicitly refused substitution. These are now native browser observations as well as component regressions.

The fresh fixture also included long unbroken labels. [Continue title at 390px](../bench-intake/evidence/mockup-completion/long-title-390.png) and [Images filename at 390px](../bench-intake/evidence/mockup-completion/long-filename-390.png) both had no horizontal document overflow. The new queue disclosure uses the existing 44px Summary control. Retained viewer images use native lazy loading so opening a large gallery does not eagerly request every distant preview. The earlier screenshots remain the representative short-label layout evidence.

### Final review-fix qualification

The corrected candidate passed **118 PostgreSQL**, **35 process**, **33 contract**, **125 server unit** and **144 frontend** tests, with zero failures/skips. The complete PG/process tiers ran under the held pg-docker lease; no shared service was restarted or faulted. Types, frontend/readability lint, format, generated drift, Markdown and build passed again. The existing build chunk advisory remains.

Current decoder image: `sha256:638d240dc81b715d94af8b6613a3c190f89d7f379e9dfd8d4bcef8cd17383c7e`; probe: `sha256:f8d71e36f02539583f3bb8764c1cce22c32a598f6ba58d92aacfb561928774e1`. These replace the first candidate's images for the final qualification; every earlier image/ID file remains retained. The root closed only its fresh qualification tab and gracefully disposed the fresh preview. The original failed-fixture retention exception remains as recorded above. Fresh independent review is required on the follow-up commit before publication; its verdict/SHA and the eventual PR/merge are recorded in the coordination ledger rather than a self-referential extra commit.
