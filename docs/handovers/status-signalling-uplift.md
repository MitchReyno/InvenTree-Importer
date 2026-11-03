# Status signalling uplift backlog capture

Scope: register BI-002 and the separate `status-signalling-uplift` OpenSpec brief. This is backlog capture only; no header, transport, agent, dependency or inventory implementation is included. Mutable metadata belongs to the repository index.

Plan before edits: check the merged index/history and existing changes for collisions, inspect the current masthead and original prototype header/activity control, scaffold the brief using the native CLI, link it from the index, then check Markdown, identity and local references before independent exact-head review and selected CI. Publish on `docs/status-signalling-uplift` against `interactive-app` and merge under standing authorization only when those gates pass.

BI-001 is the separately merged Capture uplift; the next unused allocation is BI-002. The current masthead has a Manual workflow label. Existing LiveUpdates and AgentSessions components provide investigation entry points, not proof that all target-health/workflow data required for the new header is available. The original prototype's Processing in progress state and `activityHTML()` supply the composition reference; the requested connection-details popover and active agents extend it. Prototype operations are simulated, and its fictional InvenTree URL must not become a production target.

No new runtime dependency is required to capture this Markdown item. Detailed proposal research should assess existing components, maintained popover frameworks and authoritative health/progress/session projections, including missing data contracts, before implementation. The two requested changes have no known ordering dependency; actual implementation prerequisites remain unassessed.

- [x] Record connection status/details, adjacent InvenTree access and the separate expandable workflow/steps/agents indicator with original mockup links.
- [x] Validate native scaffold, metadata/ID uniqueness, local links, Markdown and whitespace before committing completed capture work.

Independent review, publication, CI and merge remain separate evidence gates. The feature remains Proposed after the documentation merges.

Validation passed: native CLI resolves `bench-intake` and correctly reports the scaffold planning-incomplete; Markdown, local links, unique BI-001/BI-002 identities and whitespace checks pass. No skill or application files changed, so workflow-sync and runtime suites were not rerun.

## Full proposal plan

After both backlog PRs merged, the user requested full proposals for both items. This branch expands only `status-signalling-uplift`; application implementation remains unauthorized. Read the project-local `openspec-propose` skill and schema, resolved the repo with CLI list/context, and inspected the masthead, activity indicators, live-update provider, agent-session schema, bootstrap/health contracts and original prototype.

Author proposal, behavioral delta specs, design and detailed unchecked implementation tasks in dependency order using CLI instructions. Compare existing query/UI primitives, Radix Popover, Floating UI and native popovers using primary sources before choosing. Ground data freshness, actor/target scope, retained work and physical agent-lane occupancy in existing contracts. Add concrete PR bundles with whole-task ownership, TDD and completion-before-commit rules, then validate artifacts, references and Markdown and obtain independent exact-head review before publication. No providers, real inventory calls, external tracker access, application edits or package installations are included in this planning work.

- [x] Produce all proposal/spec/design/task artifacts and reconcile the captured brief.
- [x] Validate the complete plan, metadata, links and PR ownership before committing proposal work.

Full status plan validation passed: strict native delta validation, CLI planning-complete state, Markdown, direct local links and whitespace. Implementation checkboxes remain unchecked; only completed proposal-authoring actions are checked here. Four implementation tasks map wholly to two reasoned PR bundles. Size is assessed L for cross-layer read/UI work; no external ordering prerequisite was identified. Package source evidence was checked on 2026-11-03; no package was installed and no runtime qualification is claimed.

Independent review of `aba97ea` found two linked freshness gaps: socket-healthy state disables existing activity polling, and freshness based on last success mislabels fresh failures. The corrected plan specifies 30-second foreground connection polling independent of socket state, local 60-second expiry/visibility recomputation, and freshness based on latest completed observation. Added explicit future regression cases and revalidated specs/Markdown.

- [x] Correct both reviewed freshness gaps and verify the revised status artifacts before committing the correction.

## Implementation foundations plan

The user authorized implementation of both merged proposals. This independent branch owns whole Tasks 1 and 2 for status PR-A. Before source edits: qualify the narrowly scoped popover primitive and build its controlled wrapper; add scoped connection/work read contracts over existing target transport and retained work/session readers. Reuse one existing socket/query scope, preserve drafts and mutation authority, and keep API/update health independent of target observations. No provider calls, real inventory requests or service interference are needed: tests/fixtures use owned targets and synthetic records. Capture foundations are undergoing independent review on another isolated branch.

Dependency preflight checked the public registry and official documentation/advisory page on 2026-11-03: published `@radix-ui/react-popover`1.3.1, MIT, React/ReactDOM19 peers supported. Registry integrity is recorded in the lockfile after installation; the maintainer advisory page has no published entries, which is not proof against all transitive vulnerabilities. Verify the pinned dependency audit, unit interaction behavior and actual browser focus/portal placement before using the wrapper in the production header. Keep the wrapper small and controlled, without adopting another styling system. Actual masthead signals remain Task3; the fixture must not contact any API.

Planned read behavior: safe configured navigation URL, bounded target observations (30s foreground cadence/cache, 3s probe timeout, 60s expiry), explicit scope/freshness and bounded retained work/physically active agents. Investigate the transport's allowed harmless route before enabling any probe. HTTP and PG regressions precede implementation; no new mutation command is introduced. Record completed checklist work before committing it. Merge only after independent exact-head review and selected CI.

Headless-browser qualification resolved the native-control blocker. An isolated local Chrome profile uses Chromium's native default-zoom preference (`partition.default_zoom_level`, default-partition key `x`); CDP readback confirms `cssVisualViewport.zoom:2`, rather than emulated page scale. The header fixture at 640 CSS pixels and 360/390 CSS pixels has zero document horizontal overflow, one correctly bounded labelled disclosure, preserved neighbouring draft text, Escape close with focus restored to Connection status, and single-open switching to Workflow. Screenshots and metrics are under `docs/bench-intake/evidence/status-signalling/`. The user's existing Chrome profile remains at its original 90%; no restoration action is needed. This proves disclosure mechanics only, not future connection/work status projections. Full task checks and status API implementation remain pending.

Task 1 selected Radix 1.3.1; the conditional fallback was unnecessary because the candidate passed. Frozen installation adds 34 transitive packages. Audit comparison against the baseline adds no advisory IDs: 0 high/critical and one pre-existing moderate minimatch advisory. Seven focused interaction tests, frontend lint, shared readability, formatting, generated drift and production build passed. Build retains its existing chunk warning. Native zoom/viewport/portal/focus/draft proof is retained separately from unit tests. A fixture padding lint error was corrected and lint rerun. Task 1 is complete before its work is committed; Task 2 reads and the production header remain incomplete.
